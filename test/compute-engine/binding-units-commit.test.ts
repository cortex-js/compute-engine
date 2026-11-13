import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression, InferResult } from '../../src/compute-engine';
import { loadGroupTheory } from '../../src/compute-engine/library/group-theory';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { isValueDef } from '../../src/compute-engine/boxed-expression/utils';
import { unitEnvironmentsOf } from '../../src/compute-engine/binding-unit';

// Phase D of slice 1 of binding units: rules 11 (`ce.infer()`), 12 (`ce.assume()`) and 13 (trials, rollback
// frames and checkpoints) of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`.

function engine(): ComputeEngine {
  return new ComputeEngine();
}

/** The first occurrence of the symbol `name` in `expr`, depth first. */
function occurrence(expr: Expression, name: string): Expression | undefined {
  if (expr.symbol === name) return expr;
  for (const op of expr.ops ?? []) {
    const found = occurrence(op, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The type of the first occurrence of `name` in `expr`. */
function typeOf(expr: Expression, name: string): string | undefined {
  return occurrence(expr, name)?.type.toString();
}

/** The number of ancestors of `scope`. */
function depth(scope: { parent: unknown }): number {
  let n = 0;
  for (
    let s = scope.parent as { parent: unknown } | null;
    s;
    s = s.parent as never
  )
    n += 1;
  return n;
}

/** A result of `ce.infer()` as strings: `name: type @ depth` and
 * `name: reason @ depth`. */
function summary(result: InferResult): {
  declared: string[];
  skipped: string[];
} {
  return {
    declared: result.declared.map(
      (d) => `${d.name}: ${d.type.toString()} @ ${depth(d.scope)}`
    ),
    skipped: result.skipped.map(
      (d) => `${d.name}: ${d.reason} @ ${depth(d.scope)}`
    ),
  };
}

/** The entries of the environments that the occurrences of `exprs` read, as
 * `name: type`, sorted. */
function entries(exprs: Expression[]): string[] {
  const result: string[] = [];
  for (const env of unitEnvironmentsOf(exprs))
    for (const [, name, type] of env.entries())
      result.push(`${name}: ${type.toString()}`);
  return result.sort();
}

function inferredType(ce: ComputeEngine, name: string): string | undefined {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !isValueDef(def)) return undefined;
  return `${def.value.type.toString()}${def.value.inferredType ? ' (inferred)' : ''}`;
}

describe('RULE 11: ce.infer()', () => {
  test('a requirement of one unit types the input of another', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const b = ce.parse('x > 1');
    expect(compile(b).success).toBe(false);
    expect(summary(ce.infer([a, b]))).toEqual({
      declared: ['x: number @ 1'],
      skipped: [],
    });
    expect(inferredType(ce, 'x')).toBe('number (inferred)');
    const result = compile(b);
    expect(result.success).toBe(true);
    expect((result.run as (v: object) => boolean)({ x: 2 })).toBe(true);
  });

  test('a conflict declares nothing, and each unit keeps its own type', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const c = ce.parse('x(3)');
    expect(summary(ce.infer([a, c]))).toEqual({
      declared: [],
      skipped: ['x: conflict @ 1'],
    });
    expect(ce.lookupDefinition('x')).toBeUndefined();
    expect(typeOf(a, 'x')).toBe('number');
    const result = compile(a);
    expect(result.success).toBe(true);
    expect((result.run as (v: object) => number)({ x: 2 })).toBe(3);
  });

  test('the order of the expressions does not change the result', () => {
    for (const order of [
      ['x + 1', 'x(3)', '2y', '\\sin(y)'],
      ['\\sin(y)', 'x(3)', '2y', 'x + 1'],
    ]) {
      const ce = engine();
      const exprs = order.map((latex) => ce.parse(latex));
      expect(summary(ce.infer(exprs))).toEqual({
        declared: ['y: number @ 1'],
        skipped: ['x: conflict @ 1'],
      });
    }
  });

  test('a second call that conflicts with the first changes nothing', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    const c = ce.parse('x(3)');
    expect(summary(ce.infer([a])).declared).toEqual(['x: number @ 1']);
    expect(summary(ce.infer([c]))).toEqual({
      declared: [],
      skipped: ['x: conflict @ 1'],
    });
    expect(inferredType(ce, 'x')).toBe('number (inferred)');
  });

  test('an inferred definition in the home scope is narrowed', () => {
    const ce = engine();
    ce.declare('x', { type: 'unknown', inferred: true });
    const def = ce.lookupDefinition('x');
    const a = ce.parse('x + 1');
    expect(inferredType(ce, 'x')).toBe('unknown (inferred)');
    expect(summary(ce.infer([a])).declared).toEqual(['x: number @ 1']);
    // The same definition, narrowed.
    expect(ce.lookupDefinition('x')).toBe(def);
    expect(inferredType(ce, 'x')).toBe('number (inferred)');
  });

  test('the candidate is met with the type of the inferred definition', () => {
    const ce = engine();
    ce.assign('x', 3);
    const a = ce.parse('x + 1');
    // `integer` met with `number` is `integer`, the type the definition
    // already has: the narrowing writes nothing, and nothing is reported.
    expect(summary(ce.infer([a]))).toEqual({ declared: [], skipped: [] });
    expect(inferredType(ce, 'x')).toBe('integer (inferred)');
    expect(a.evaluate().json).toBe(4);
  });

  test('a free name and a definition of the same name in its home scope are one candidate', () => {
    const ce = engine();
    ce.declare('S', '(string) -> string');
    const a = ce.parse('x + 1');
    ce.declare('x', { type: 'unknown', inferred: true });
    const b = ce.box(['S', 'x']);
    // `a` reads `x` as a free name, keyed on its home scope; `b` reads the
    // inferred definition, keyed on that definition. Both are `x` in the
    // global scope: `number` and `string` conflict.
    expect(summary(ce.infer([a, b]))).toEqual({
      declared: [],
      skipped: ['x: conflict @ 1'],
    });
    expect(inferredType(ce, 'x')).toBe('unknown (inferred)');
  });

  test('a definition key whose scope was popped is out of scope', () => {
    const ce = engine();
    ce.pushScope();
    ce.assign('x', 3);
    const a = ce.parse('x + 1');
    ce.popScope();
    expect(summary(ce.infer([a]))).toEqual({
      declared: [],
      skipped: ['x: out-of-scope @ 2'],
    });
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('a definition key replaced by an explicit declaration is defined', () => {
    const ce = engine();
    ce.declare('x', { type: 'unknown', inferred: true });
    const a = ce.parse('x + 1');
    ce.declare('x', 'string');
    expect(summary(ce.infer([a]))).toEqual({
      declared: [],
      skipped: ['x: defined @ 1'],
    });
    expect(inferredType(ce, 'x')).toBe('string');
  });

  test('a definition that is not inferred is not changed', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    ce.declare('x', 'string');
    expect(summary(ce.infer([a]))).toEqual({
      declared: [],
      skipped: ['x: defined @ 1'],
    });
    expect(inferredType(ce, 'x')).toBe('string');
  });

  test('an assignment narrows a type that ce.infer() declared', () => {
    // The declaration is an inference write, so an assignment narrows it as
    // it narrows any inferred type.
    const ce = engine();
    ce.infer([ce.box(['Multiply', 'x', 'v'])]);
    expect(ce.box('v').type.toString()).toBe('number');
    ce.assign('v', 5);
    expect(ce.box('v').type.toString()).toBe('integer');

    const ce2 = engine();
    ce2.infer([ce2.box(['Multiply', 'x', 'w'])]);
    ce2.assign('w', ce2.box(Infinity));
    expect(ce2.box('w').type.toString()).toBe('infinity');
  });

  test('the fresh-matrix repair does not retype a name that ce.infer() typed', () => {
    const ce = engine();
    const a = ce.box(['Add', 'A', 1]);
    a.evaluate();
    ce.infer([a]);
    expect(inferredType(ce, 'A')).toBe('number (inferred)');
    const det = ce.box(['Determinant', ['Add', 'A', 'B']]);
    expect(det.isValid).toBe(false);
    expect(inferredType(ce, 'A')).toBe('number (inferred)');
    // A name that only an earlier unit required is still repaired: the
    // requirement of that unit is not committed.
    const other = engine();
    other.box(['Add', 'A', 1]).evaluate();
    const repaired = other.box(['Determinant', ['Add', 'A', 'B']]);
    expect(repaired.isValid).toBe(true);
    expect(typeOf(repaired, 'A')).toBe('matrix');
  });

  test('a home scope that was popped', () => {
    const ce = engine();
    ce.pushScope();
    const a = ce.parse('x + 1');
    ce.popScope();
    expect(summary(ce.infer([a]))).toEqual({
      declared: [],
      skipped: ['x: out-of-scope @ 2'],
    });
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('a name read as a variable with no requirement is untyped', () => {
    const ce = engine();
    expect(summary(ce.infer([ce.box(['Tuple', 'N'])]))).toEqual({
      declared: [],
      skipped: ['N: untyped @ 1'],
    });
    const n = ce.lookupDefinition('N');
    expect(n !== undefined && 'operator' in n).toBe(true);
  });

  test('a library name read as a variable is declared as a variable', () => {
    const ce = engine();
    const a = ce.parse('N + 1');
    expect(compile(a).success).toBe(false);
    expect(summary(ce.infer([a])).declared).toEqual(['N: number @ 1']);
    expect(inferredType(ce, 'N')).toBe('number (inferred)');
    const result = compile(a);
    expect(result.success).toBe(true);
    expect((result.run as (v: object) => number)({ N: 2 })).toBe(3);
  });

  test('a call head is declared with its function type', () => {
    const ce = engine();
    const a = ce.parse('f(2) + 1');
    expect(summary(ce.infer([a])).declared).toEqual(['f: function @ 1']);
    expect(inferredType(ce, 'f')).toBe('function (inferred)');
    // The head is resolved when the call is evaluated.
    ce.assign('f', ce.parse('t \\mapsto 2t'));
    expect(a.evaluate().json).toBe(5);
  });

  test('a call whose operands hold no free name: `x(3)`', () => {
    const ce = engine();
    const c = ce.parse('x(3)');
    expect(summary(ce.infer([c])).declared).toEqual(['x: function @ 1']);
  });

  test('the free name of a function literal, in the scope of the literal', () => {
    const ce = engine();
    const f = ce.parse('x \\mapsto x + y');
    expect(summary(ce.infer([f]))).toEqual({
      declared: ['y: number @ 1'],
      skipped: [],
    });
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  test('the result of an operation is read through its environment', () => {
    const ce = engine();
    const s = ce.parse('x + 1').simplify();
    expect(summary(ce.infer([s])).declared).toEqual(['x: number @ 1']);
  });

  test('the result is sorted by name, then by the depth of the scope', () => {
    const ce = engine();
    const a = ce.parse('x + b');
    ce.pushScope();
    const c = ce.parse('2x + a');
    expect(summary(ce.infer([c, a])).declared).toEqual([
      'a: number @ 2',
      'b: number @ 1',
      'x: number @ 1',
      'x: number @ 2',
    ]);
    ce.popScope();
  });
});

describe('RULE 12: ce.assume() declares the names it constrains', () => {
  test('an inequality', () => {
    const ce = engine();
    const a = ce.parse('x + 1');
    expect(ce.assume(ce.parse('x > 0'))).toBe('ok');
    expect(ce.lookupDefinition('x')).toBeDefined();
    expect(ce.parse('x').isPositive).toBe(true);
    // The expression boxed before reads the definition.
    expect(occurrence(a, 'x')!.isPositive).toBe(true);
  });

  test('an equality', () => {
    const ce = engine();
    expect(ce.assume(ce.parse('y = 3'))).toBe('ok');
    expect(inferredType(ce, 'y')).toBe('integer (inferred)');
    expect(ce.parse('y + 1').evaluate().json).toBe(4);
  });

  test('a membership', () => {
    const ce = engine();
    expect(ce.assume(ce.box(['Element', 'z', 'RealNumbers']))).toBe('ok');
    expect(inferredType(ce, 'z')).toBe('real (inferred)');
  });

  test('a disequality derived from a part bound narrows the type of a use', () => {
    // `Im(tau) > 0` derives `tau ≠ 0`. The definition that `assume()` made
    // has the type `unknown`, and the use under `Imaginary` requires
    // `complex | infinity` in its unit: the exclusion is added to that.
    const ce = engine();
    ce.assume(
      ce.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
    );
    expect(ce.expr(['Imaginary', 'tau']).op1.type.toString()).toBe(
      'complex & !0 | infinity'
    );
    // A use that requires nothing gets no exclusion: `!0` needs a base.
    expect(ce.expr('tau').type.toString()).toBe('number');
  });
});

describe('RULE 13: trials and rollback frames', () => {
  test('the trials of the arms of an overloaded operator leave no requirement', () => {
    const declare = (ce: ComputeEngine) =>
      ce.declare('G', {
        signature: '((integer) -> integer) & ((string) -> boolean)',
        evaluate: ([v]) => v,
      });
    const off = new ComputeEngine();
    declare(off);
    const expected = off.box(['G', 'x']).op1.type.toString();
    expect(expected).toBe('integer | string');

    const ce = engine();
    declare(ce);
    const e = ce.box(['G', 'x']);
    // Each arm is tried in an environment that is thrown away, so both arms
    // are viable for the free `x`.
    expect(e.op1.type.toString()).toBe(expected);
    expect(e.type.toString()).toBe(off.box(['G', 'y']).type.toString());
    expect(entries([e])).toEqual(['x: integer | string']);
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });

  function check(ce: ComputeEngine, source: string) {
    const { ast, diagnostics } = parseSource(source, undefined, ce);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    return staticDiagnostics(ce, ast!, source);
  }

  test('an Epsil static check leaves no requirement and no declaration', () => {
    const ce = engine();
    const a = ce.parse('u + 1');
    const before = entries([a]);
    check(ce, 'let z = u(3)\nlet w = v + 1\nz');
    expect(entries([a])).toEqual(before);
    expect(typeOf(a, 'u')).toBe('number');
    for (const name of ['u', 'v', 'w', 'z'])
      expect(ce.lookupDefinition(name)).toBeUndefined();
    // The check required `number` of `v`. A unit boxed after the check does
    // not read that requirement: it is not in the environment of the check.
    const later = ce.box(['Tuple', 'v']);
    expect(typeOf(later, 'v')).toBe('unknown');
    expect(entries([later])).toEqual([]);
  });

  test('static-check-rollback: inference onto an outer definition is undone', () => {
    const ce = engine();
    ce.declare('u', 'unknown');
    const def = ce.lookupDefinition('u')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    check(ce, 'let z = u + 1\nz');
    expect(ce.lookupDefinition('u')).toBe(def);
    expect(def.value.type.toString()).toBe('unknown');
    expect(ce.lookupDefinition('z')).toBeUndefined();
  });

  test('the group-theory library checks its input before it declares anything', () => {
    const ce = engine();
    ce.declareType('GroupDescriptor', 'integer', { alias: true });
    expect(() => loadGroupTheory(ce)).toThrow(
      'The type "GroupDescriptor" is already defined'
    );
    expect(ce.lookupDefinition('GroupOrder')).toBeUndefined();
    expect(ce.lookupDefinition('Permutation')).toBeUndefined();
    expect(ce._typeRegistry['Permutation']).toBeUndefined();
    // An engine with no conflict loads it.
    const fresh = engine();
    expect(loadGroupTheory(fresh).operatorCount).toBeGreaterThan(0);
  });

  test('the group-theory library: a value of the name of a minted constructor', () => {
    // The alias rows mint a constructor, which claims the name in the value
    // namespace: the load is refused before any type is declared.
    const ce = engine();
    ce.declare('GroupDescriptor', 'integer');
    expect(() => loadGroupTheory(ce)).toThrow(
      'The symbol "GroupDescriptor" is already declared in the current scope: a type declaration also declares a value constructor of the same name'
    );
    expect(ce._typeRegistry['Permutation']).toBeUndefined();
    expect(ce._typeRegistry['PermutationGroup']).toBeUndefined();
    expect(ce.lookupDefinition('GroupOrder')).toBeUndefined();
  });

  test('the group-theory library: a later refusal undoes the declarations', () => {
    const ce = engine();
    const declare = ce.declare.bind(ce);
    let count = 0;
    jest.spyOn(ce, 'declare').mockImplementation(((...args: unknown[]) => {
      count += 1;
      if (count === 3) throw new Error('refused');
      return (declare as (...a: unknown[]) => ComputeEngine)(...args);
    }) as never);
    expect(() => loadGroupTheory(ce)).toThrow('refused');
    jest.restoreAllMocks();
    expect(ce._typeRegistry['Permutation']).toBeUndefined();
    expect(ce._typeRegistry['GroupDescriptor']).toBeUndefined();
    expect(ce.lookupDefinition('GroupDescriptor')).toBeUndefined();
    expect(ce.lookupDefinition('GroupOrder')).toBeUndefined();
    // The load succeeds afterwards.
    expect(loadGroupTheory(ce).operatorCount).toBeGreaterThan(0);
  });
});

describe('RULES 3 AND 4: a stored literal and a name declared unknown', () => {
  test('the signature of a stored literal is read in the scope it is written in', () => {
    // The body of `angle` reads the global `P`. The literal of `point` has a
    // parameter `P`, and its block reads the signature of `angle` from the
    // scope of that parameter: the result is still `list<real>`, so the
    // local `q` declared `unknown` with the value `angle(P)` is a list.
    const ce = engine();
    ce.declare('P', 'list<real>');
    ce.declare('angle', 'function');
    ce.assign('angle', ce.box(['Function', ['Block', 'P'], 't']));
    const literal = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'q', "'unknown'", ['angle', 'P']],
        ['Tuple', ['Cos', 'q'], ['Sin', 'q']],
      ],
      'P',
    ]);
    expect(typeOf(literal.op1.ops[1], 'q')).toBe('list<real>');
    expect(literal.op1.ops[0].ops[2].type.toString()).toBe('list<real>');
  });

  test('the requirement of a unit on a name declared unknown does not let a call skip its argument check', () => {
    // `h(m)` requires `m: integer`, and the occurrence of `m`, declared
    // `unknown`, reads that requirement (rule 4). It is no proof about the
    // value: the call stays `h(m)`, and with `m := 1.5` it is an error.
    const ce = engine();
    ce.declare('h', '(integer) -> integer');
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 'k'], 'k']));
    ce.declare('m', 'unknown');
    const expr = ce.box([
      'Tuple',
      [
        'Block',
        ['Declare', 'r', "'unknown'", ['g', ['h', 'm']]],
        ['Assign', 'm', 1.5],
        'r',
      ],
    ]);
    const value = expr.evaluate().op1;
    expect(value.operator).toBe('Error');
    expect(value.toString()).toMatch(/incompatible-type/);
  });
});
