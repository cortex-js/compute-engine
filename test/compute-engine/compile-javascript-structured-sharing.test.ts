import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Shared subexpressions on the structured route of the JavaScript compiler
// (the `numeric-kernel` profile): a node object reached on several paths
// (a DAG) is lowered once where its first lowering is visible, the value is
// pure and cannot abort, and no local changed in between
// (docs/plans/2026-11-11-structured-shared-subexpressions.md).
//
// Sharing a pure value changes no double: each shape is compared with the
// same expression with a distinct node object at every position
// (`unshare()`), with `Object.is`, and with the existing compiler with
// `cse: false, constantFold: false` when its tree is canonical. The
// structural checks (operation counts, code sizes) are the proof that the
// work is linear; a time ceiling is asserted only in a `CE_PERF=1` run, as
// in `compile-cse-shared-subtrees.test.ts`.

const OPTIONS = { cse: false, constantFold: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

function expectFast(ms: number, ceiling: number): void {
  if (process.env.CE_PERF === '1') expect(ms).toBeLessThan(ceiling);
}

function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

/** An engine with the test operations: `Trace` states an effect, `Trusted`
 *  is pure. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('z', 'complex');
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops: readonly Expression[]) => ops[0],
  } as never);
  ce.declare('Trusted', {
    signature: '(real) -> real',
    pure: true,
    evaluate: (ops: readonly Expression[]) => ops[0],
  } as never);
  return ce;
}

const TRACES: string[] = [];
(globalThis as { __ceShareTrace?: unknown }).__ceShareTrace = (
  id: string,
  v: number
) => {
  TRACES.push(`${id}(${v})`);
  return v;
};
const structured = () =>
  new ScalarFragmentJavaScriptTarget(
    'structured',
    new Map([
      ['Trace', 'trace'],
      ['Trusted', 'trusted'],
    ]),
    {
      trace: (id: string, operands: readonly string[]) =>
        `globalThis.__ceShareTrace(${JSON.stringify(id)}, ${operands.join(', ')})`,
    }
  );

function run(result: CompilationResult<'javascript'>, args: readonly unknown[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

/** Equal values, `0` equal to `-0`, within 1e-12 relative. */
function close(a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return (
    (Number.isNaN(a) && Number.isNaN(b)) ||
    a === b ||
    (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))
  );
}

/** A copy of `expr` with a distinct node object at every function position.
 *  A scoped node keeps its scope. */
function unshare(ce: ComputeEngine, expr: Expression): Expression {
  if (!expr.ops) return expr;
  return ce._fn(
    expr.operator,
    expr.ops.map((op) => unshare(ce, op)),
    expr.localScope ? { scope: expr.localScope } : undefined
  );
}

/** A copy of `expr` in which the function nodes for which `pick` holds are
 *  one node object per structure (the first one met), so the program
 *  reaches that object on several paths. A scoped node keeps its scope. */
function share(ce: ComputeEngine, expr: Expression, pick: (node: Expression) => boolean): Expression {
  const objects = new Map<string, Expression>();
  const visit = (node: Expression): Expression => {
    if (!node.ops) return node;
    const ops = node.ops.map(visit);
    const copy = ops.every((op, i) => op === node.ops![i])
      ? node
      : ce._fn(node.operator, ops, node.localScope ? { scope: node.localScope } : undefined);
    if (!pick(node)) return copy;
    const key = JSON.stringify(node.json);
    const known = objects.get(key);
    if (known !== undefined) return known;
    objects.set(key, copy);
    return copy;
  };
  return visit(expr);
}

/** Every operation of `program`, in its regions and in its functions. */
function operationsOf(program: IRProgram): IROperation[] {
  const result: IROperation[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      result.push(op);
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
      if (op.kind === 'loop' || op.kind === 'build') visit(op.body);
      if (op.kind === 'and' || op.kind === 'or') op.rest.forEach(visit);
    }
  };
  visit(program.root);
  for (const fn of program.functions) visit(fn.body);
  return result;
}

/** The lowered and verified program of `expr` on the structured route. */
function programOf(expr: Expression, options: object = {}): IRProgram {
  return lowerStructuredFragment(structured().prepareStructured(expr, { ...OPTIONS, ...options }));
}

/** The number of operations of `kind` in the program of `expr`. */
function count(expr: Expression, kind: string, options: object = {}): number {
  return operationsOf(programOf(expr, options)).filter((op) => op.kind === kind || ('fn' in op && op.fn === kind)).length;
}

//
// The shapes of the design note
//

type Shape = (ce: ComputeEngine, e: Expression, k: number) => Expression;
const F = (ce: ComputeEngine, op: string, ...ops: Expression[]) => ce.function(op, ops);
const SHAPES: Record<string, { step: Shape; canonical: boolean }> = {
  // `Add(e, e)` is not canonical (a canonical `Add` is flat), and the
  // existing compiler writes it as a flat left fold: not compared with it.
  'Add(e, e)': { step: (ce, e) => ce._fn('Add', [e, e]), canonical: false },
  'Arctan2(e, e)': { step: (ce, e) => ce._fn('Arctan2', [e, e]), canonical: true },
  'Sin(e) + Cos(e)': {
    step: (ce, e) => F(ce, 'Add', F(ce, 'Sin', e), F(ce, 'Cos', e)),
    canonical: true,
  },
  'Add(e, If(x > k, e, 1))': {
    step: (ce, e, k) => ce._fn('Add', [e, ce._fn('If', [F(ce, 'Greater', ce.symbol('x'), ce.number(k)), e, ce.One])]),
    canonical: true,
  },
  'If(x > k, e + 1, 2e)': {
    step: (ce, e, k) =>
      ce._fn('If', [
        F(ce, 'Greater', ce.symbol('x'), ce.number(k)),
        ce._fn('Add', [e, ce.One]),
        ce._fn('Multiply', [e, ce.number(2)]),
      ]),
    canonical: true,
  },
};

/** `e_0 = x + 1`, then `e_k = step(e_(k-1), k - 1)`. */
function level(ce: ComputeEngine, d: number, step: Shape): Expression {
  let e = F(ce, 'Add', ce.symbol('x'), ce.One);
  for (let k = 0; k < d; k++) e = step(ce, e, k);
  return e;
}

const POINTS = [0.3, -1.7, 2.5, 7.25, -0];

describe('the shapes of the note, the same doubles as the unshared tree', () => {
  for (const [name, { step, canonical }] of Object.entries(SHAPES))
    test(name, () => {
      const ce = engine();
      for (const d of [2, 3, 5, 8, 10, 12]) {
        // The `If` shape is lowered once per path: its depth is bounded
        // by the size of its program.
        if (name.startsWith('If(') && d > 10) continue;
        const shared = level(ce, d, step);
        const a = compile(shared, PROFILE);
        const b = compile(unshare(ce, shared), PROFILE);
        const existing = canonical ? compile(shared, { ...OPTIONS, fallback: false }) : undefined;
        for (const x of POINTS) {
          const v = a.run!({ x }) as number;
          expect([d, x, Object.is(v, b.run!({ x }))]).toEqual([d, x, true]);
          if (existing) expect([d, x, Object.is(v, existing.run!({ x }))]).toEqual([d, x, true]);
        }
        // The shared form is not larger, past the few levels where its
        // `const` statements cost more than the copies.
        if (d >= 8) expect(a.code.length).toBeLessThanOrEqual(b.code.length);
      }
    });

  test('the value of the interpreter at a small depth', () => {
    const ce = engine();
    for (const { step } of Object.values(SHAPES)) {
      const shared = level(ce, 3, step);
      const a = compile(shared, PROFILE);
      for (const x of POINTS) {
        const expected = shared.subs({ x: ce.number(x) }).N().re;
        expect(close(a.run!({ x }), expected)).toBe(true);
      }
    }
  });
});

describe('linear code and time at depth 40', () => {
  test('Floor of the doubling DAG', () => {
    const ce = engine();
    const d = 40;
    const e = level(ce, d, SHAPES['Add(e, e)'].step);
    const [result, ms] = timed(() => compile(F(ce, 'Floor', e), PROFILE));
    expectFast(ms, 2000);
    expect(result.code.length).toBeLessThan(60 * d);
    // Doubling a double is exact.
    expect(result.run!({ x: 0.3 })).toBe(Math.floor(2 ** d * 1.3));
    // One addition per level, and the one of `x + 1`.
    expect(count(F(ce, 'Floor', e), 'add')).toBe(d + 1);
  });

  test('Floor of the Arctan2 DAG', () => {
    const ce = engine();
    const d = 40;
    const e = level(ce, d, SHAPES['Arctan2(e, e)'].step);
    const [result, ms] = timed(() => compile(F(ce, 'Floor', e), PROFILE));
    expectFast(ms, 2000);
    expect(result.code.length).toBeLessThan(60 * d);
    expect(count(F(ce, 'Floor', e), 'atan2')).toBe(d);
  });

  test('Floor of the sin/cos DAG, at depth 30 and 40', () => {
    const ce = engine();
    for (const d of [30, 40]) {
      const e = level(ce, d, SHAPES['Sin(e) + Cos(e)'].step);
      const [result, ms] = timed(() => compile(F(ce, 'Floor', e), PROFILE));
      expectFast(ms, 2000);
      expect(result.code.length).toBeLessThan(80 * d);
      let v = 0.3 + 1;
      for (let k = 1; k <= d; k++) v = Math.sin(v) + Math.cos(v);
      expect(result.run!({ x: 0.3 })).toBe(Math.floor(v));
    }
  });

  test('a shared node in one branch of an If, also used before it', () => {
    const ce = engine();
    const d = 40;
    const e = level(ce, d, SHAPES['Add(e, If(x > k, e, 1))'].step);
    const [result, ms] = timed(() => compile(e, PROFILE));
    expectFast(ms, 2000);
    expect(result.code.length).toBeLessThan(80 * d);
    const existing = compile(e, { fallback: false });
    for (const x of POINTS) expect(Object.is(result.run!({ x }), existing.run!({ x }))).toBe(true);
  });

  test('the preparation of the three Floor DAGs finishes, with the facts of the tree at depth 5', () => {
    const ce = engine();
    for (const name of ['Add(e, e)', 'Arctan2(e, e)', 'Sin(e) + Cos(e)']) {
      const deep = F(ce, 'Floor', level(ce, 40, SHAPES[name].step));
      const [, ms] = timed(() => structured().prepareStructured(deep, OPTIONS));
      expectFast(ms, 1000);
      // The facts of each position of the DAG and of the tree.
      const shared = F(ce, 'Floor', level(ce, 5, SHAPES[name].step));
      const tree = unshare(ce, shared);
      const facts = (root: Expression): string[] => {
        const { scope } = structured().prepareStructured(root, OPTIONS).annotation;
        const result: string[] = [];
        const visit = (node: Expression) => {
          const f = scope.facts.get(node) as
            | { type: { kind: string }; representation?: string; conversions?: readonly { kind: string }[] }
            | undefined;
          result.push(`${node.operator}:${f?.type.kind}:${f?.representation}:${(f?.conversions ?? []).map((c) => c.kind).join(',')}`);
          for (const op of node.ops ?? []) visit(op);
        };
        visit(root);
        return result;
      };
      expect(facts(shared)).toEqual(facts(tree));
    }
  });
});

describe('the limit of operations', () => {
  test('a decline of a node reached on many paths has no value text', () => {
    // `Map` is outside the profile; the text of its 40-level DAG callback
    // would write 2^40 nodes.
    const ce = engine();
    const t = ce.symbol('t');
    let body: Expression = t;
    for (let k = 0; k < 40; k++) body = F(ce, 'Arctan2', body, body);
    const e = F(ce, 'Map', F(ce, 'Function', body, t), F(ce, 'List', ce.number(-1), ce.number(2)));
    const [outcome, ms] = timed(() => {
      try {
        compile(e, PROFILE);
        return undefined;
      } catch (err) {
        return err as Error & { diagnostic?: { code: string; operator?: string; value?: string } };
      }
    });
    expectFast(ms, 2000);
    expect(outcome?.diagnostic).toMatchObject({ code: 'outside-profile', operator: 'Map' });
    expect(outcome?.diagnostic?.value).toBeUndefined();
    // A small node keeps its text.
    const small = F(ce, 'Map', F(ce, 'Function', F(ce, 'Sin', t), t), F(ce, 'List', ce.One));
    expect(() => compile(small, PROFILE)).toThrow(
      expect.objectContaining({ diagnostic: expect.objectContaining({ value: expect.any(String) }) })
    );
  });

  test('a program over the limit declines with outside-profile', () => {
    const ce = engine();
    const e = level(ce, 20, SHAPES['If(x > k, e + 1, 2e)'].step);
    const [outcome, ms] = timed(() => {
      try {
        compile(e, PROFILE);
        return undefined;
      } catch (err) {
        return err as Error & { diagnostic?: { code: string; message: string } };
      }
    });
    expectFast(ms, 2000);
    expect(outcome?.diagnostic?.code).toBe('outside-profile');
    expect(outcome?.message).toBe(
      "Could not compile with the profile 'numeric-kernel': the program has more than 100000 operations, the limit of the profile"
    );
    // With a fallback, the interpreter computes it.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fallback = compile(e, { profile: 'numeric-kernel' });
      expect(fallback.success).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

//
// Where a value is shared, and where it is not
//

describe('regions', () => {
  // `s = Sin(x + 1)`, one node object at each position.
  const sinOf = (ce: ComputeEngine) => F(ce, 'Sin', F(ce, 'Add', ce.symbol('x'), ce.One));
  const gt = (ce: ComputeEngine, a: Expression, k: number) => F(ce, 'Greater', a, ce.number(k));

  /** `expr` compiled, compared with `unshare(expr)` and with the existing
   *  compiler, with `Object.is`. */
  function agree(ce: ComputeEngine, expr: Expression, points = POINTS): void {
    const a = compile(expr, PROFILE);
    const b = compile(unshare(ce, expr), PROFILE);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of points) {
      const v = a.run!({ x });
      expect([x, Object.is(v, b.run!({ x })), Object.is(v, existing.run!({ x }))]).toEqual([x, true, true]);
    }
  }

  test('a node in both branches of an If is lowered in each branch', () => {
    const ce = engine();
    const s = sinOf(ce);
    const expr = ce._fn('If', [gt(ce, ce.symbol('x'), 0), ce._fn('Add', [s, ce.One]), ce._fn('Multiply', [s, ce.number(2)])]);
    expect(count(expr, 'sin')).toBe(2);
    const root = programOf(expr).root.operations;
    expect(root.some((op) => 'fn' in op && op.fn === 'sin')).toBe(false);
    agree(ce, expr);
  });

  test('a node lowered before an If is shared in both branches', () => {
    const ce = engine();
    const s = sinOf(ce);
    const expr = ce._fn('Add', [
      s,
      ce._fn('If', [gt(ce, ce.symbol('x'), 0), ce._fn('Add', [s, ce.One]), ce._fn('Multiply', [s, ce.number(2)])]),
    ]);
    expect(count(expr, 'sin')).toBe(1);
    agree(ce, expr);
  });

  test('a node in the condition of an If is shared in its branches', () => {
    const ce = engine();
    const s = sinOf(ce);
    const expr = ce._fn('If', [gt(ce, s, 0), ce._fn('Add', [s, ce.One]), ce.number(3)]);
    expect(count(expr, 'sin')).toBe(1);
    agree(ce, expr);
  });

  test('And and Or: the first operand is shared with the others, two later operands are not', () => {
    const ce = engine();
    const s = sinOf(ce);
    const lt = (a: Expression, k: number) => F(ce, 'Less', a, ce.number(k));
    const first = ce._fn('If', [ce._fn('And', [lt(s, 0.9), gt(ce, s, -0.9)]), ce.One, ce.number(2)]);
    expect(count(first, 'sin')).toBe(1);
    agree(ce, first);
    const later = ce._fn('If', [
      ce._fn('Or', [gt(ce, ce.symbol('x'), 5), lt(s, -0.5), gt(ce, s, 0.5)]),
      ce.One,
      ce.number(2),
    ]);
    expect(count(later, 'sin')).toBe(2);
    agree(ce, later);
  });

  test('Which: a node of a condition is shared in its value, not in a later clause', () => {
    const ce = engine();
    const s = sinOf(ce);
    const x = ce.symbol('x');
    const tested = ce._fn('Which', [gt(ce, s, 0), ce._fn('Add', [s, ce.One]), ce.True, ce.number(-1)]);
    expect(count(tested, 'sin')).toBe(1);
    agree(ce, tested);
    const values = ce._fn('Which', [
      gt(ce, x, 1),
      s,
      gt(ce, x, -1),
      ce._fn('Multiply', [s, ce.number(3)]),
      ce.True,
      ce.number(-1),
    ]);
    expect(count(values, 'sin')).toBe(2);
    agree(ce, values);
  });

  test('a node in the body and in the bounds of a Sum', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    const n = ce.symbol('n');
    const k = ce.symbol('k');
    // `u = 2n` in both bounds: the bounds are evaluated in one region, one
    // after the other.
    const u = ce._fn('Multiply', [ce.number(2), n]);
    const bounds = ce._fn('Sum', [k, ce._fn('Limits', [k, u, ce._fn('Add', [u, ce.number(3)])])]);
    const ops = operationsOf(programOf(bounds));
    expect(ops.filter((op) => op.origin === u && op.kind === 'multiply')).toHaveLength(1);
    // `t = Sin(x + 1)` twice in the body: one value per pass.
    const t = sinOf(ce);
    const body = ce._fn('Sum', [
      ce._fn('Add', [ce._fn('Multiply', [k, t]), t]),
      ce._fn('Limits', [k, ce.One, n]),
    ]);
    expect(count(body, 'sin')).toBe(1);
    // With constant bounds, the terms are written out: each term reads its
    // own index, and lowers the body again.
    const unrolled = ce._fn('Sum', [
      ce._fn('Add', [ce._fn('Multiply', [k, t]), t]),
      ce._fn('Limits', [k, ce.One, ce.number(3)]),
    ]);
    expect(count(unrolled, 'sin')).toBe(3);
    for (const expr of [bounds, body, unrolled]) {
      const a = compile(expr, PROFILE);
      const b = compile(unshare(ce, expr), PROFILE);
      const existing = compile(expr, { ...OPTIONS, fallback: false });
      for (const [x, nv] of [
        [0.3, 2],
        [-1.5, 4],
        [2, 0],
      ]) {
        const v = a.run!({ x, n: nv });
        expect([x, nv, Object.is(v, b.run!({ x, n: nv })), Object.is(v, existing.run!({ x, n: nv }))]).toEqual([
          x,
          nv,
          true,
          true,
        ]);
      }
    }
  });

  test('two conversions of one shared real value', () => {
    const ce = engine();
    const s = sinOf(ce);
    // `s` real in the sum, and converted to complex as the value of the
    // else branch of a complex `If`.
    const expr = ce._fn('Add', [s, ce._fn('If', [gt(ce, ce.symbol('x'), 0), ce.symbol('z'), s])]);
    const ops = operationsOf(programOf(expr));
    expect(ops.filter((op) => 'fn' in op && op.fn === 'sin')).toHaveLength(1);
    expect(ops.filter((op) => op.kind === 'convert').length).toBeGreaterThanOrEqual(1);
    const a = compile(expr, PROFILE);
    const b = compile(unshare(ce, expr), PROFILE);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of POINTS)
      for (const z of [
        { re: 1, im: 2 },
        { re: -0.5, im: 0 },
      ]) {
        const v = a.run!({ x, z } as never) as { re: number; im: number };
        const w = b.run!({ x, z } as never) as { re: number; im: number };
        const e = existing.run!({ x, z } as never) as { re: number; im: number };
        expect([Object.is(v.re, w.re), Object.is(v.im, w.im)]).toEqual([true, true]);
        expect([Object.is(v.re, e.re), Object.is(v.im, e.im)]).toEqual([true, true]);
      }
  });
});

describe('effects and aborts', () => {
  beforeEach(() => {
    TRACES.length = 0;
  });

  test('a node with an effect, reached twice, runs twice', () => {
    const ce = engine();
    const t = ce._fn('Trace', [sinOfX(ce)]);
    const expr = ce._fn('Add', [t, t]);
    expect(count(expr, 'trace')).toBe(2);
    const result = structured().compile(expr, OPTIONS);
    expect(result.run!({ x: 0.5 })).toBe(2 * Math.sin(0.5));
    expect(TRACES).toEqual([`trace(${Math.sin(0.5)})`, `trace(${Math.sin(0.5)})`]);
  });

  test('a pure node reached twice in one region runs once, and once in each arm of an If', () => {
    const ce = engine();
    const t = ce._fn('Trusted', [sinOfX(ce)]);
    const sum = ce._fn('Add', [t, t]);
    expect(count(sum, 'trace')).toBe(1);
    expect(structured().compile(sum, OPTIONS).run!({ x: 0.5 })).toBe(2 * Math.sin(0.5));
    expect(TRACES).toEqual([`trusted(${Math.sin(0.5)})`]);
    TRACES.length = 0;
    const arms = ce._fn('If', [
      F(ce, 'Greater', ce.symbol('x'), ce.Zero),
      ce._fn('Add', [t, ce.One]),
      ce._fn('Multiply', [t, ce.number(2)]),
    ]);
    const result = structured().compile(arms, OPTIONS);
    expect(result.run!({ x: 0.5 })).toBe(Math.sin(0.5) + 1);
    expect(result.run!({ x: -0.5 })).toBe(Math.sin(-0.5) * 2);
    expect(TRACES).toEqual([`trusted(${Math.sin(0.5)})`, `trusted(${Math.sin(-0.5)})`]);
  });

  test('a call of a helper that can abort, reached twice, runs twice against the budget', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const { diagnostics } = executeEpsil(
      ce,
      `
function g(n: integer) -> real {
  let s = 0.0
  for k in 1..n { s = s + k }
  s
}
function f(n: integer) -> real { g(n) * 2 }
`
    );
    expect(diagnostics).toEqual([]);
    const definition = ce.lookupDefinition('f') as { operator?: { _lambdaLiteral?: Expression } };
    const f = definition.operator!._lambdaLiteral!;
    // `g(n) * 2` becomes `g(n) + g(n)` with one node object for the call.
    const call = find2(f, 'g')!;
    expect(call).toBeDefined();
    const literal = replace(ce, f, (node) => (node.operator === 'Multiply' ? ce._fn('Add', [call, call]) : undefined));
    const options = { ...OPTIONS, iterationBudget: 10 };
    expect(count(literal, 'call', options)).toBe(2);
    const result = structured().compile(literal, options);
    // One call is 4 passes, two are 8; one call of 6 passes, two are 12.
    expect(run(result, [4])).toBe(20);
    const failure = (r: CompilationResult<'javascript'>) => {
      try {
        run(r, [6]);
      } catch (e) {
        return (e as Error).name;
      }
      return undefined;
    };
    expect(failure(result)).toBe('CancellationError');
    expect(failure(compile(literal, { ...options, fallback: false }))).toBe('CancellationError');
    // Without a budget, the call cannot abort, and it is shared.
    expect(count(literal, 'call')).toBe(1);
    expect(run(structured().compile(literal, OPTIONS), [6])).toBe(42);
  });
});

function sinOfX(ce: ComputeEngine): Expression {
  return ce.function('Sin', [ce.symbol('x')]);
}

describe('an aggregate inside an expression', () => {
  const engineN = () => {
    const ce = engine();
    ce.declare('n', 'integer');
    return ce;
  };
  const sumOf = (ce: ComputeEngine, body: Expression, lo: Expression, hi: Expression) =>
    ce._fn('Sum', [body, ce._fn('Limits', [ce.symbol('k'), lo, hi])]);
  const kx = (ce: ComputeEngine) => ce._fn('Multiply', [ce.symbol('k'), ce.symbol('x')]);

  /** `expr` with `x` real and `n` integer, compared with its unshared copy
   *  and with the existing compiler, with `Object.is`. */
  function agree(ce: ComputeEngine, expr: Expression, inputs: Record<string, number>[]): void {
    const a = compile(expr, PROFILE);
    const b = compile(unshare(ce, expr), PROFILE);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const input of inputs) {
      const v = a.run!(input as never);
      expect([input, Object.is(v, b.run!(input as never)), Object.is(v, existing.run!(input as never))]).toEqual([
        input,
        true,
        true,
      ]);
    }
  }
  const XN = [0.3, -1.7, 2.5].flatMap((x) => [0, 1, 4].map((n) => ({ x, n })));

  test('a value lowered before a Sum is shared after it', () => {
    const ce = engineN();
    const s = F(ce, 'Sin', F(ce, 'Add', ce.symbol('x'), ce.One));
    const expr = ce._fn('Add', [s, sumOf(ce, kx(ce), ce.One, ce.symbol('n')), s]);
    expect(count(expr, 'sin')).toBe(1);
    expect(compile(expr, PROFILE).code.match(/Math\.sin/g)).toHaveLength(1);
    agree(ce, expr, XN);
  });

  test('a node that holds a Sum is shared: a 40-level DAG over a Sum has linear code', () => {
    const ce = engineN();
    const dag = (d: number) => {
      let e = ce._fn('Add', [ce.symbol('x'), sumOf(ce, kx(ce), ce.One, ce.symbol('n'))]);
      for (let k = 0; k < d; k++) e = ce._fn('Arctan2', [e, e]);
      return e;
    };
    for (const d of [2, 5, 8]) agree(ce, dag(d), XN);
    const [result, ms] = timed(() => compile(dag(40), PROFILE));
    expectFast(ms, 2000);
    expect(result.code.length).toBeLessThan(80 * 40 + 1000);
    expect(count(dag(40), 'atan2')).toBe(40);
    expect(count(dag(40), 'loop')).toBe(1);
  });

  test('a Sum with constant bounds, its terms written out, inside a shared node', () => {
    const ce = engineN();
    const sum = sumOf(ce, kx(ce), ce.One, ce.number(3));
    let e = ce._fn('Add', [ce.symbol('x'), sum]);
    for (let k = 0; k < 6; k++) e = ce._fn('Arctan2', [e, e]);
    expect(count(e, 'atan2')).toBe(6);
    agree(ce, e, XN);
  });

  test('3,000 sibling sums compile in a time linear in their number', () => {
    // Each aggregate notes the writes outside its scope as they happen and
    // removes its index after it. A comparison of every binding at the exit
    // of each aggregate took 1 s here (quadratic); this takes about 0.25 s.
    const ce = engineN();
    const terms: Expression[] = [];
    for (let i = 1; i <= 3000; i++)
      terms.push(sumOf(ce, ce._fn('Add', [kx(ce), ce.number(i)]), ce.One, ce.number(3)));
    const expr = ce.function('Add', terms);
    const [result, ms] = timed(() => compile(expr, PROFILE));
    expectFast(ms, 600);
    // Σ_i Σ_{k=1}^{3} (k·x + i) = 6·3000·x + 3·(3000·3001/2).
    expect(result.run!({ x: 0.5 } as never)).toBe(9000 + 13504500);
  });

  test('one body node object in two aggregates with other index values is lowered in each', () => {
    const ce = engineN();
    const body = F(ce, 'Sin', kx(ce));
    const expr = ce._fn('Add', [
      sumOf(ce, body, ce.One, ce.symbol('n')),
      sumOf(ce, body, ce.number(2), ce._fn('Add', [ce.symbol('n'), ce.number(3)])),
    ]);
    expect(count(expr, 'sin')).toBe(2);
    agree(ce, expr, XN);
    // With constant bounds, each written-out term has its own index.
    const unrolled = ce._fn('Add', [
      sumOf(ce, body, ce.One, ce.number(2)),
      sumOf(ce, body, ce.number(3), ce.number(4)),
    ]);
    expect(count(unrolled, 'sin')).toBe(4);
    agree(ce, unrolled, XN);
  });

  test('a node that reads the index, also used outside the aggregate where its name is an input', () => {
    const ce = engineN();
    ce.declare('k', 'real');
    const t = F(ce, 'Sin', ce._fn('Add', [ce.symbol('k'), ce.symbol('x')]));
    const expr = ce._fn('Add', [t, sumOf(ce, t, ce.One, ce.symbol('n')), t]);
    // One `sin` of the input `k`, shared by the two uses outside, and one
    // in the body of the loop.
    expect(count(expr, 'sin')).toBe(2);
    const a = compile(expr, PROFILE);
    const b = compile(unshare(ce, expr), PROFILE);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const { x, n } of XN)
      for (const k of [0.5, -2]) {
        const v = a.run!({ x, n, k } as never);
        expect([x, n, k, Object.is(v, b.run!({ x, n, k } as never)), Object.is(v, existing.run!({ x, n, k } as never))]).toEqual([
          x,
          n,
          k,
          true,
          true,
        ]);
      }
  });
});

describe('the text of a node in a refusal', () => {
  /** The message of the decline of `make(d)` with the profile and the
   *  shadow measure on. */
  function message(make: (ce: ComputeEngine, d: number) => Expression, d: number): [string, number] {
    const ce = engine();
    ce._jsProfileShadow = true;
    const expr = make(ce, d);
    return timed(() => {
      try {
        compile(expr, PROFILE);
        return 'compiled';
      } catch (e) {
        return (e as Error).message;
      }
    });
  }
  /** `d_0 = z`, `d_k = d_(k-1) + d_(k-1)` with one node object. */
  const doubled = (ce: ComputeEngine, d: number) => {
    let e: Expression = ce.symbol('z');
    for (let k = 0; k < d; k++) e = ce._fn('Add', [e, e]);
    return e;
  };
  const SHAPES: [string, (ce: ComputeEngine, d: number) => Expression, string][] = [
    ['Arcosh of a complex operand that is not a name', (ce, d) => ce._fn('Arcosh', [doubled(ce, d)]), 'Add(…)'],
    [
      'the exponential of a complex operand that reads Pi',
      (ce, d) => ce._fn('Power', [ce.E, ce._fn('Multiply', [ce.Pi, doubled(ce, d)])]),
      'Multiply(…)',
    ],
  ];
  for (const [name, make, short] of SHAPES)
    test(name, () => {
      // A small node is written in full.
      expect(message(make, 2)[0]).toMatch(/z \+ z/);
      // At depth 20 the full text has 2^20 terms: the message has the head.
      const [text, ms] = message(make, 20);
      expect(text).toContain(short);
      expect(text.length).toBeLessThan(400);
      expectFast(ms, 1000);
      // Depth 40 finishes.
      expect(message(make, 40)[0]).toContain(short);
    });
});

describe('products', () => {
  /** `expr` with `x` and `y` real, compared with its unshared copy and with
   *  the existing compiler, with `Object.is`. */
  function agree(ce: ComputeEngine, expr: Expression): void {
    const a = compile(expr, PROFILE);
    const b = compile(unshare(ce, expr), PROFILE);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of POINTS)
      for (const y of [0.4641588833612779, -3, 7]) {
        const v = a.run!({ x, y } as never);
        expect([x, y, Object.is(v, b.run!({ x, y } as never)), Object.is(v, existing.run!({ x, y } as never))]).toEqual([
          x,
          y,
          true,
          true,
        ]);
      }
  }
  const engineXY = () => {
    const ce = engine();
    ce.declare('y', 'real');
    return ce;
  };

  test('a factor reached twice in one product is lowered once', () => {
    const ce = engineXY();
    const s = F(ce, 'Sin', F(ce, 'Add', ce.symbol('x'), ce.One));
    const expr = ce._fn('Multiply', [s, s, ce.symbol('y')]);
    expect(count(expr, 'sin')).toBe(1);
    agree(ce, expr);
  });

  test('a quotient factor reached twice: its parts once, each division in its place', () => {
    // `x * (s/y) * (s/y)` is `((x * s) / y * s) / y`, as the existing
    // emitter reads `x * s / y * s / y`: the two divisions stay.
    const ce = engineXY();
    const s = F(ce, 'Sin', F(ce, 'Add', ce.symbol('x'), ce.One));
    const q = ce._fn('Divide', [s, ce.symbol('y')]);
    const expr = ce._fn('Multiply', [ce.symbol('x'), q, q]);
    expect(count(expr, 'sin')).toBe(1);
    expect(count(expr, 'divide')).toBe(2);
    agree(ce, expr);
  });

  test('a factor reached twice in a product with a rational factor', () => {
    const ce = engineXY();
    const s = F(ce, 'Sin', F(ce, 'Add', ce.symbol('x'), ce.One));
    const expr = ce._fn('Multiply', [ce.number([2, 3]), s, s]);
    expect(count(expr, 'sin')).toBe(1);
    agree(ce, expr);
  });

  test('a folded power of two literals reached twice', () => {
    const ce = engineXY();
    const p = ce._fn('Power', [ce.number(2), ce.number(0.5)]);
    const expr = ce._fn('Add', [ce._fn('Multiply', [p, ce.symbol('x')]), ce._fn('Multiply', [p, ce.symbol('y')])]);
    agree(ce, expr);
  });
});

describe('a Block at the root', () => {
  const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
    'Declare',
    name,
    `'${type}'`,
    value,
  ];

  test('statements of a root Block that share a node', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      declare('a', 'real', ['Sin', 'x']),
      declare('b', 'real', ['Multiply', ['Sin', 'x'], 2]),
      ['Assign', 'a', ['Add', 'a', ['Cos', 'a']]],
      ['Add', 'a', 'b', ['Cos', 'a']],
    ];
    const tree = ce.expr(json);
    const shared = share(ce, tree, (node) => node.operator === 'Sin' || node.operator === 'Cos');
    // `sin(x)` reads no local: each statement after the first is a change of
    // the locals, so it is lowered in each statement. `cos(a)` before and
    // after the write of `a` reads two values of `a`, and the last
    // statement reads it once.
    expect(count(shared, 'sin')).toBe(2);
    expect(count(shared, 'cos')).toBe(2);
    const a = compile(shared, PROFILE);
    const b = compile(tree, PROFILE);
    const existing = compile(tree, { ...OPTIONS, fallback: false });
    for (const x of POINTS) {
      const v = a.run!({ x });
      expect([x, Object.is(v, b.run!({ x })), Object.is(v, existing.run!({ x }))]).toEqual([x, true, true]);
      const s = Math.sin(x);
      const a1 = s + Math.cos(s);
      expect(close(v, a1 + 2 * s + Math.cos(a1))).toBe(true);
    }
  });

  test('a node shared within one statement of a root Block', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      declare('a', 'real', ['Add', 'x', 1]),
      ['Multiply', ['Sin', 'a'], ['Add', ['Sin', 'a'], 1]],
    ];
    const tree = ce.expr(json);
    const shared = share(ce, tree, (node) => node.operator === 'Sin');
    expect(count(shared, 'sin')).toBe(1);
    const a = compile(shared, PROFILE);
    const existing = compile(tree, { ...OPTIONS, fallback: false });
    for (const x of POINTS) expect(Object.is(a.run!({ x }), existing.run!({ x }))).toBe(true);
  });
});

describe('locals', () => {
  const typed = (name: string, type: string): MathJsonExpression => ['Typed', name, `'${type}'`];
  const declare = (name: string, type: string, value: MathJsonExpression): MathJsonExpression => [
    'Declare',
    name,
    `'${type}'`,
    value,
  ];

  /** The `Function` literal `json`, with one node object for each node
   *  that `pick` names, its unshared copy, and the value of the
   *  interpreter at `args`. */
  function check(json: MathJsonExpression, pick: (node: Expression) => boolean, cases: number[][], sins: number) {
    const ce = engine();
    const tree = ce.expr(json);
    const shared = share(ce, tree, pick);
    expect(count(shared, 'sin')).toBe(sins);
    const a = structured().compile(shared, OPTIONS);
    const b = structured().compile(tree, OPTIONS);
    const profile = compile(shared, PROFILE);
    const existing = compile(tree, { ...OPTIONS, fallback: false });
    for (const args of cases) {
      const v = run(a, args);
      expect([args, Object.is(v, run(b, args)), Object.is(v, run(profile, args)), Object.is(v, run(existing, args))]).toEqual([
        args,
        true,
        true,
        true,
      ]);
      const expected = ce.expr(['Apply', json, ...args] as MathJsonExpression).evaluate().N().re;
      expect([args, close(v, expected)]).toEqual([args, true]);
    }
    return shared;
  }
  const isSin = (node: Expression) => node.operator === 'Sin';

  test('a node that reads a local written between two uses is lowered again', () => {
    // `a = w; y = sin(a); a = a + 1; z = sin(a); y + z` with one object
    // for `sin(a)`.
    check(
      [
        'Function',
        [
          'Block',
          declare('a', 'real', 'w'),
          declare('y', 'real', ['Sin', 'a']),
          ['Assign', 'a', ['Add', 'a', 1]],
          declare('z', 'real', ['Sin', 'a']),
          ['Add', 'y', 'z'],
        ],
        typed('w', 'real'),
      ],
      isSin,
      [[0.5], [-2], [0]],
      2
    );
  });

  test('a node in one statement is shared', () => {
    check(
      [
        'Function',
        ['Block', declare('a', 'real', 'w'), ['Multiply', ['Sin', 'a'], ['Add', ['Sin', 'a'], 1]]],
        typed('w', 'real'),
      ],
      isSin,
      [[0.5], [-2]],
      1
    );
  });

  test('a node in a loop body that reads a carried value: one per pass, not the value before or after the loop', () => {
    // `sin(s)` before the loop, twice in its body, and after it.
    check(
      [
        'Function',
        [
          'Block',
          declare('s', 'real', 'w'),
          declare('t', 'real', ['Sin', 's']),
          [
            'Loop',
            ['Assign', 's', ['Add', ['Sin', 's'], ['Multiply', 0.5, ['Sin', 's']]]],
            ['Element', 'k', ['Range', 1, 'n']],
          ],
          ['Add', 't', ['Sin', 's']],
        ],
        typed('w', 'real'),
        typed('n', 'integer'),
      ],
      isSin,
      [
        [0.5, 3],
        [-2, 1],
        [1, 0],
      ],
      3
    );
  });
});

describe('a helper', () => {
  test('the same node object in the root and in the body of a helper', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const { diagnostics } = executeEpsil(
      ce,
      `
function g(t: real) -> real { sin(t) + 1 }
function f(t: real) -> real { g(t) * 3 }
`
    );
    expect(diagnostics).toEqual([]);
    const literalOf = (name: string) =>
      (ce.lookupDefinition(name) as { operator?: { _lambdaLiteral?: Expression } }).operator!._lambdaLiteral!;
    const g = literalOf('g');
    const f = literalOf('f');
    // The node `sin(t)` of the body of `g`.
    const find = (node: Expression): Expression | undefined =>
      node.operator === 'Sin' ? node : node.ops?.map(find).find((n) => n !== undefined);
    const sin = find(g)!;
    expect(sin).toBeDefined();
    const call = find2(f, 'g')!;
    for (const ops of [
      [sin, call],
      [call, sin],
    ]) {
      const literal = replace(ce, f, (node) => (node.operator === 'Multiply' ? ce._fn('Add', ops) : undefined));
      // One `sin` in the root, one in the function.
      const program = programOf(literal);
      expect(program.functions).toHaveLength(1);
      expect(operationsOf(program).filter((op) => 'fn' in op && op.fn === 'sin')).toHaveLength(2);
      const result = structured().compile(literal, OPTIONS);
      const existing = compile(literal, { ...OPTIONS, fallback: false });
      for (const t of [0.5, -2, 3])
        expect([t, Object.is(run(result, [t]), run(existing, [t]))]).toEqual([t, true]);
      expect(close(run(result, [0.5]), 2 * Math.sin(0.5) + 1)).toBe(true);
    }
  });
});

function find2(node: Expression, operator: string): Expression | undefined {
  if (node.operator === operator) return node;
  for (const op of node.ops ?? []) {
    const found = find2(op, operator);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A copy of `expr` in which each node for which `to` gives a node is that
 *  node. A scoped node keeps its scope. */
function replace(ce: ComputeEngine, expr: Expression, to: (node: Expression) => Expression | undefined): Expression {
  const replaced = to(expr);
  if (replaced !== undefined) return replaced;
  if (!expr.ops) return expr;
  const ops = expr.ops.map((op) => replace(ce, op, to));
  if (ops.every((op, i) => op === expr.ops![i])) return expr;
  return ce._fn(expr.operator, ops, expr.localScope ? { scope: expr.localScope } : undefined);
}
