import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The macro kind: `ce.declare(name, { macro: rawJson })`
 * (`docs/plans/2026-11-12-macro-kind-spec.md`). A name of the input that
 * resolves to a macro is replaced by the raw body, boxed at that place, in
 * the scope of the occurrence and in the same form. Each test uses its own
 * engine: a declaration changes what a later boxing gives.
 */

type J = any;

const fn = (ce: ComputeEngine, body: J, ...params: string[]) =>
  ce.box(['Function', body, ...params]);

const X2_Y2 = ['Add', ['Power', 'x', 2], ['Power', 'y', 2]];

describe('the rule (section 1)', () => {
  test('1. a macro keeps a raw body and has no value and no type of its own', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const def = ce.lookupDefinition('A') as J;
    expect(def.value.macro).toEqual(X2_Y2);
    expect(def.value.value).toBeUndefined();
    expect(def.value.type.toString()).toBe('unknown');
  });

  test('2. the name is replaced by the body where the input is boxed', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    expect(ce.box(['Add', 'A', 1]).json).toEqual([
      'Add',
      ['Power', 'x', 2],
      ['Power', 'y', 2],
      1,
    ]);
  });

  test('2. the body takes the source range of the name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const expr = ce.box([
      'Multiply',
      2,
      { sym: 'A', sourceOffsets: [4, 5] },
    ] as J);
    const body = expr.ops!.find((x) => x.operator === 'Add')!;
    expect(body.sourceOffsets).toEqual([4, 5]);
  });

  test('3. a macro named in the body is expanded too', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.declare('B', { macro: ['Add', 'A', 1] });
    expect(ce.box('B').json).toEqual(['Add', ['Power', 'x', 2], 1]);
  });

  test('3. a macro that reaches itself is macro-cycle at the occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'B', 1] });
    ce.declare('B', { macro: ['Multiply', 2, 'A'] });
    expect(ce.box('A').json).toEqual([
      'Add',
      ['Multiply', 2, ['Error', "'macro-cycle'", "'A'"]],
      1,
    ]);
  });

  test('3. a macro that names itself is macro-cycle', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'A', 1] });
    expect(ce.box('A').json).toEqual([
      'Add',
      ['Error', "'macro-cycle'", "'A'"],
      1,
    ]);
  });

  test('3. a macro written twice is not a cycle', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Sin', 'x'] });
    ce.declare('B', { macro: ['Add', 'A', ['Cos', 'A']] });
    expect(ce.box('B').isValid).toBe(true);
    expect(ce.box('B').json).toEqual([
      'Add',
      ['Sin', 'x'],
      ['Cos', ['Sin', 'x']],
    ]);
  });

  test('4. a function is not a macro: its body reads its own scope', () => {
    // `g` reads the global `x`, also when it is called from a function whose
    // parameter is `x` (row 3).
    const ce = new ComputeEngine();
    ce.assign('g', fn(ce, ['Add', 'u', 'x'], 'u'));
    ce.assign('f', fn(ce, ['g', 1], 'x'));
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('x + 1');
  });

  test('5. a form boxed before the declaration is not boxed again', () => {
    const ce = new ComputeEngine();
    const early = ce.box(['Add', 'A', 1]);
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(early.json).toEqual(['Add', 'A', 1]);
    expect(early.evaluate().json).toEqual(['Add', 'A', 1]);
  });

  test('6. a parameter of the same name hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.assign('f', fn(ce, ['Add', 'A', 1], 'A'));
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('6. an index of the same name hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Sum', 'A', ['Limits', 'A', 1, 3]]).evaluate().json).toBe(6);
  });

  test('6. a declared local of the same name hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(
      ce
        .box(['Block', ['Declare', 'A', "'integer'", 4], ['Add', 'A', 1]])
        .evaluate().json
    ).toBe(5);
  });

  test('6. a declaration of a pushed scope hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.pushScope();
    ce.declare('A', 'integer');
    expect(ce.box(['Add', 'A', 1]).json).toEqual(['Add', 'A', 1]);
    ce.popScope();
    expect(ce.box(['Add', 'A', 1]).json).toEqual(['Add', ['Power', 'x', 2], 1]);
  });

  test('7. a symbol that resolves to a macro has no value, the type unknown, and evaluates to itself', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const a = ce.symbol('A');
    expect(a.json).toBe('A');
    expect(a.type.toString()).toBe('unknown');
    expect(a.value).toBeUndefined();
    expect(a.evaluate().json).toBe('A');
    expect(a.N().json).toBe('A');
  });
});

describe('how a host declares one (section 2)', () => {
  test('the body is any MathJSON expression, checked and not boxed', () => {
    const ce = new ComputeEngine();
    // A body that names an operator that does not exist yet is not boxed at
    // the declaration.
    ce.declare('A', { macro: ['Later', 'x'] });
    ce.declare('B', { macro: 3 });
    ce.declare('C', { macro: { sym: 'x' } });
    expect(ce.box('B').json).toBe(3);
    expect(ce.box('C').json).toBe('x');
    expect(() => ce.declare('D', { macro: {} as J })).toThrow(
      /Invalid argument for "D"/
    );
    expect(() => ce.declare('E', { macro: [] as J })).toThrow(
      /Invalid argument for "E"/
    );
  });

  test('a body that boxes to an Error gives that Error at each occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Sqrt'] });
    const expr = ce.box(['Add', 'A', 'A']);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('missing');
  });

  test('a field beside macro is refused', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('A', { macro: 1, value: 2 } as J)).toThrow(
      /Invalid argument for "A"/
    );
    expect(() => ce.declare('A', { macro: 1, type: 'real' } as J)).toThrow(
      /Invalid argument for "A"/
    );
    expect(ce.lookupDefinition('A')).toBeUndefined();
  });

  test('the definition is a value definition with the raw body', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const def = ce.lookupDefinition('A') as J;
    expect('value' in def).toBe(true);
    expect('operator' in def).toBe(false);
    expect(def.value.macro).toEqual(X2_Y2);
  });

  test('a second declaration in the same scope is the redeclaration error', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: 1 });
    expect(() => ce.declare('A', { macro: 2 })).toThrow(/already declared/);
    expect(() => ce.declare('A', 'real')).toThrow(/already declared/);
  });

  test('a macro declared again in a new scope replaces it there', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: 1 });
    ce.pushScope();
    ce.declare('A', { macro: 2 });
    expect(ce.box('A').json).toBe(2);
    ce.popScope();
    expect(ce.box('A').json).toBe(1);
  });

  test('ce.assign(), an evaluated Assign and ce.withValues() on a macro are errors', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: 1 });
    expect(() => ce.assign('A', 3)).toThrow(/macro/);
    expect(() => ce.box(['Assign', 'A', 5]).evaluate()).toThrow(/macro/);
    expect(() => ce.withValues({ A: 3 }, () => 0)).toThrow(/macro/);
    expect((ce.lookupDefinition('A') as J).value.macro).toBe(1);
  });

  test('ce.box(name) is the body boxed in the current scope', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'x', 1] });
    expect(ce.box('A').json).toEqual(['Add', 'x', 1]);
  });

  test('LaTeX A(x+1) is a product, with A expanded', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.parse('A(x+1)').json).toEqual([
      'Multiply',
      ['Add', 'x', 1],
      ['Power', 'x', 2],
    ]);
  });

  test('MathJSON A(1) stays a call of the name, as for a valueless symbol', () => {
    // The head of a call is not an occurrence: the call is kept, as a call
    // of a name declared `unknown` is.
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const call = ce.box(['A', 1]);
    expect(call.json).toEqual(['A', 1]);
    expect(call.evaluate().json).toEqual(['A', 1]);
  });
});

describe('the examples (section 3)', () => {
  test('row 1: A = x^2 + y^2, f(x) = A + 1, f(3) is y^2 + 10', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    ce.assign('f', fn(ce, ['Add', 'A', 1], 'x'));
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('y^2 + 10');
  });

  test('row 2: a chain of macros, f(3) is 10', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.declare('B', { macro: ['Add', 'A', 1] });
    ce.assign('f', fn(ce, 'B', 'x'));
    expect(ce.box(['f', 3]).evaluate().json).toBe(10);
  });

  test('row 3: a function reads a global, f(3) is x + 1', () => {
    const ce = new ComputeEngine();
    ce.assign('g', fn(ce, ['Add', 'u', 'x'], 'u'));
    ce.assign('f', fn(ce, ['g', 1], 'x'));
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('x + 1');
  });

  test('row 4: k(v) = v + x, A = x + k(1), f(x) = A, f(3) is x + 4', () => {
    const ce = new ComputeEngine();
    ce.assign('k', fn(ce, ['Add', 'v', 'x'], 'v'));
    ce.declare('A', { macro: ['Add', 'x', ['k', 1]] });
    ce.assign('f', fn(ce, 'A', 'x'));
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('x + 4');
  });

  test('row 5: A = x^2, g(u) = u + A, f(x) = g(1), f(3) is x^2 + 1', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.assign('g', fn(ce, ['Add', 'u', 'A'], 'u'));
    ce.assign('f', fn(ce, ['g', 1], 'x'));
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('x^2 + 1');
  });

  test('row 6: the host expression A + 1, and its .json', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const expr = ce.parse('A + 1');
    expect(expr.toString()).toBe('x^2 + y^2 + 1');
    expect(expr.json).toEqual(['Add', ['Power', 'x', 2], ['Power', 'y', 2], 1]);
  });

  test('row 7: an index of the reader captures, sum of A over k is 6x', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Multiply', 'k', 'x'] });
    expect(ce.parse('\\sum_{k=1}^{3} A').evaluate().toString()).toBe('6x');
    expect(ce.parse('\\sum_{k=1}^{3} A').json).toEqual([
      'Sum',
      ['Multiply', 'k', 'x'],
      ['Limits', 'k', 1, 3],
    ]);
  });

  test('row 8: A = x, f(x) = [A, sum over x of A], f(10) is [10, 6]', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: 'x' });
    ce.assign(
      'f',
      fn(ce, ['List', 'A', ['Sum', 'A', ['Limits', 'x', 1, 3]]], 'x')
    );
    expect(ce.box(['f', 10]).evaluate().json).toEqual(['List', 10, 6]);
  });

  test('row 9: A = n f(n-1), f(n) = {n = 0: 1, A}, f(4) is 24', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Multiply', 'n', ['f', ['Subtract', 'n', 1]]] });
    ce.assign('f', fn(ce, ['If', ['Equal', 'n', 0], 1, 'A'], 'n'));
    expect(ce.box(['f', 4]).evaluate().json).toBe(24);
  });

  test('row 10: a reader assigned before the declaration reads the name', () => {
    const ce = new ComputeEngine();
    ce.assign('f', fn(ce, 'A', 'x'));
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const r = ce.box(['f', 3]).evaluate();
    expect(r.json).toBe('A');
    expect(r.type.toString()).toBe('unknown');
  });
});

describe('the hard cases (section 6)', () => {
  test('a reader boxed before the declaration has the type unknown', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box('A');
    const parsed = ce.parse('A');
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(boxed.type.toString()).toBe('unknown');
    expect(parsed.type.toString()).toBe('unknown');
    expect(boxed.value).toBeUndefined();
  });

  test('a reader boxed before the declaration: no error, a symbol with no value', () => {
    const ce = new ComputeEngine();
    const reader = ce.box(['Multiply', 2, 'A']);
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(reader.isValid).toBe(true);
    expect(reader.evaluate().json).toEqual(['Multiply', 2, 'A']);
  });

  test('an already boxed reader under a binder built with ce.function binds its variable', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Multiply', 'k', 'x'] });
    const sum = ce.function('Sum', [
      ce.box('A'),
      ce.box(['Limits', 'k', 1, 3]),
    ]);
    expect(sum.evaluate().toString()).toBe('6x');
  });

  test('ce.function with a boxed operand boxes nothing again', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'x', 1] });
    const e = ce.box('A');
    expect(ce.function('Add', [e, ce.number(1)]).toString()).toBe('x + 2');
  });

  test('a held operand keeps the name, also at ReleaseHold (depends on CE-1258)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Hold', 'A']).json).toEqual(['Hold', 'A']);
    expect(ce.box(['Hold', ['Add', 'A', 1]]).json).toEqual([
      'Hold',
      ['Add', 'A', 1],
    ]);
    // `ReleaseHold` makes the operand canonical during an evaluation, where
    // nothing is expanded.
    expect(
      ce.box(['ReleaseHold', ['Hold', ['Add', 'A', 1]]]).evaluate().json
    ).toEqual(['Add', 'A', 1]);
  });

  test('a held operand boxed before the declaration reads the name (rule 5; depends on CE-1258)', () => {
    // The held symbol was boxed before `A` was declared: it is a free name,
    // which is canonical, so the release does not box it again.
    const ce = new ComputeEngine();
    const held = ce.box(['Hold', 'A']);
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['ReleaseHold', held]).evaluate().json).toBe('A');
  });

  test('a macro whose body calls Hold (depends on CE-1258)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Hold', ['Add', 'x', 1]] });
    expect(ce.box('A').json).toEqual(['Hold', ['Add', 'x', 1]]);
    ce.assign('f', fn(ce, ['ReleaseHold', 'A'], 'x'));
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('a rule: a macro name in the replacement is made canonical during the operation and stays the name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const r = ce
      .box(['Add', 'z', 1])
      .replace({ match: ['Add', '_a', 1], replace: ['Multiply', '_a', 'A'] });
    expect(r?.json).toEqual(['Multiply', 'A', 'z']);
  });

  test('the name is not kept in .json and .latex', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const e = ce.parse('2A');
    expect(JSON.stringify(e.json)).not.toContain('"A"');
    expect(e.latex).not.toContain('A');
  });

  test('the raw form keeps the name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    expect(ce.parse('A+1', { form: 'raw' }).json).toEqual(['Add', 'A', 1]);
    expect(ce.box(['Add', 'A', 1], { form: 'raw' }).json).toEqual([
      'Add',
      'A',
      1,
    ]);
  });

  test('the head of a definition row is an occurrence like any other', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: X2_Y2 });
    const row = ['Equal', 'A', X2_Y2];
    const expanded = ['Equal', X2_Y2, X2_Y2];
    expect(ce.box(row).json).toEqual(expanded);
    expect(ce.box(row, { form: 'structural' }).json).toEqual(expanded);
  });

  test('the structural form expands, with the body boxed structurally', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Divide', 'x', 2] });
    // The structural form keeps the written shape of the body.
    const structural = ce.box(['Multiply', 3, 'A'], { form: 'structural' });
    expect(structural.json).toEqual(['Multiply', 3, ['Divide', 'x', 2]]);
    expect(ce.box(['Multiply', 3, 'A']).json).not.toEqual(structural.json);
  });

  test('the structural form: a parameter hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(
      ce.box(['Function', ['Add', 'A', 1], 'A'], { form: 'structural' }).json
    ).toEqual(['Function', ['Add', 'A', 1], 'A']);
    // Another name below the same binder is expanded.
    expect(
      ce.box(['Function', ['Add', 'A', 1], 'u'], { form: 'structural' }).json
    ).toEqual(['Function', ['Add', ['Power', 'x', 2], 1], 'u']);
  });

  test('the structural form: an index hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(
      ce.box(['Sum', 'A', ['Limits', 'A', 1, 3]], { form: 'structural' }).json
    ).toEqual(['Sum', 'A', ['Limits', 'A', 1, 3]]);
    expect(
      ce.box(['Sum', 'A', ['Limits', 'k', 1, 3]], { form: 'structural' }).json
    ).toEqual(['Sum', ['Power', 'x', 2], ['Limits', 'k', 1, 3]]);
  });

  test('the structural form: a position that takes a name keeps it, and hides the macro in the call', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const S = { form: 'structural' } as const;
    expect(ce.box(['Assign', 'A', 5], S).json).toEqual(['Assign', 'A', 5]);
    expect(ce.box(['Declare', 'A', "'real'"], S).json).toEqual([
      'Declare',
      'A',
      "'real'",
    ]);
    expect(ce.box(['Solve', ['Equal', 'A', 1], 'A'], S).json).toEqual([
      'Solve',
      ['Equal', 'A', 1],
      'A',
    ]);
    expect(ce.box(['Limits', 'A', 1, 2], S).json).toEqual([
      'Limits',
      'A',
      1,
      2,
    ]);
  });

  test('the structural form: ce.rebind keeps a name operand', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const s = ce.box(['Assign', 'A', 5], { form: 'structural' });
    expect(ce.rebind(s, { form: 'structural' } as J).json).toEqual([
      'Assign',
      'A',
      5,
    ]);
  });

  test('the structural form: a deep nest of binders below a binder', () => {
    // The deep-tree work stack carries the hidden names of each binder.
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    let j: J = ['Add', 'A', 'u'];
    for (let i = 0; i < 3000; i++) j = ['Function', j, 'A'];
    const e = ce.box(['Sum', j, ['Limits', 'k', 1, 2]], { form: 'structural' });
    expect(e.isValid).toBe(true);
    // `.json` of a tree this deep overflows the stack: walk it.
    const heads = new Set<string>();
    const todo = [e];
    while (todo.length > 0) {
      const x = todo.pop()!;
      if (x.ops) {
        heads.add(x.operator);
        todo.push(...x.ops);
      }
    }
    expect(heads.has('Power')).toBe(false);
  });

  test('the structural form: a local of a Block hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(
      ce.box(['Block', ['Declare', 'A', "'integer'", 4], ['Add', 'A', 1]], {
        form: 'structural',
      }).json
    ).toEqual(['Block', ['Declare', 'A', "'integer'", 4], ['Add', 'A', 1]]);
  });

  test('the structural form: a holdUntil never constant in the body keeps its name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'x', 'ImaginaryUnit'] });
    expect(ce.box(['Multiply', 2, 'A'], { form: 'structural' }).json).toEqual([
      'Multiply',
      2,
      ['Add', 'x', 'ImaginaryUnit'],
    ]);
  });

  test('the structural form: ce.rebind keeps the hiding', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const s = ce.box(['Function', ['Add', 'A', 1], 'A'], {
      form: 'structural',
    });
    expect(ce.rebind(s, { form: 'structural' } as J).json).toEqual([
      'Function',
      ['Add', 'A', 1],
      'A',
    ]);
  });

  test('the partial canonical form expands', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'x', 'x'] });
    expect(
      ce.box(['Multiply', 2, 'A'], { form: ['Number'] } as J).json
    ).toEqual(['Multiply', 2, ['Add', 'x', 'x']]);
  });

  test('a body with Random is evaluated once per occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Random'] });
    const e = ce.box(['Subtract', 'A', 'A']);
    expect(e.json).not.toBe(0);
    expect(JSON.stringify(e.json).match(/Random/g)?.length).toBe(2);
  });

  test('the type of the body differs between readers', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'x', 1] });
    expect(ce.box('A').type.toString()).toBe('number');
    ce.pushScope();
    ce.declare('x', 'integer');
    expect(ce.box('A').type.toString()).toBe('integer');
    ce.popScope();
  });
});

describe('the routes by which a name is boxed', () => {
  test('LaTeX', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.parse('A + 1').json).toEqual(['Add', ['Power', 'x', 2], 1]);
  });

  test('ce.box of MathJSON', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Add', 'A', 1]).json).toEqual(['Add', ['Power', 'x', 2], 1]);
    expect(ce.box(['Add', { sym: 'A' }, 1]).json).toEqual([
      'Add',
      ['Power', 'x', 2],
      1,
    ]);
  });

  test('a function body at ce.assign', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    ce.assign('f', ['Function', ['Add', 'A', 1], 'x']);
    expect(ce.box(['f', 3]).evaluate().json).toBe(10);
  });

  test('a binder body', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'k', 2] });
    expect(ce.box(['Sum', 'A', ['Limits', 'k', 1, 3]]).evaluate().json).toBe(
      14
    );
  });

  test('ce.function with a boxed operand', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'k', 2] });
    const sum = ce.function('Sum', [
      ce.box('A'),
      ce.box(['Limits', 'k', 1, 3]),
    ]);
    expect(sum.evaluate().json).toBe(14);
  });

  test('the raw form', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box('A', { form: 'raw' }).json).toBe('A');
  });

  test('ce.symbol() is not expanded', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.symbol('A').json).toBe('A');
  });

  test('macros named t and x: Solve of a linear system and a derivative keep their working variables', () => {
    const ce = new ComputeEngine();
    ce.declare('t', { macro: ['Add', 'q', 100] });
    ce.declare('x', { macro: ['Add', 'q', 200] });
    const system = ce.box([
      'List',
      ['Equal', ['Add', 'a', 'b'], 3],
      ['Equal', ['Subtract', 'a', 'b'], 1],
    ]);
    const solution = system.solve(['a', 'b']) as J;
    expect(solution.a.json).toBe(2);
    expect(solution.b.json).toBe(1);
    expect(
      ce
        .box(['D', ['Power', ['Sin', 'a'], 2], 'a'])
        .evaluate()
        .toString()
    ).toBe('2sin(a) * cos(a)');
    expect(
      ce
        .box(['Integrate', ['Multiply', 'a', 'a'], ['Limits', 'a', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('1/3');
  });
});

describe('positions that take a name are not occurrences', () => {
  test('Solve(eq, A)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Solve', ['Equal', ['Add', 'A', 1], 0], 'A']).json).toEqual([
      'Solve',
      ['Equal', ['Add', 'A', 1], 0],
      'A',
    ]);
  });

  test('D(f, A)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    const d = ce.box(['D', ['Power', 'A', 3], 'A']);
    expect(d.json).toEqual(['D', ['Power', 'A', 3], 'A']);
    expect(d.evaluate().json).toEqual(['Multiply', 3, ['Power', 'A', 2]]);
  });

  test('Limit', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(
      ce.box(['Limit', ['Function', ['Add', 'A', 1], 'A'], 2]).evaluate().json
    ).toBe(3);
  });

  test('Function(body, A)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Function', ['Add', 'A', 1], 'A']).json).toEqual([
      'Function',
      ['Block', ['Add', 'A', 1]],
      'A',
    ]);
  });

  test('Sum with the index A', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Sum', 'A', ['Limits', 'A', 1, 3]]).json).toEqual([
      'Sum',
      'A',
      ['Limits', 'A', 1, 3],
    ]);
  });

  test('the target of Assign and Declare', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(ce.box(['Assign', 'A', 5]).json).toEqual(['Assign', 'A', 5]);
    expect(ce.box(['Declare', 'A', "'real'", 2]).json).toEqual([
      'Declare',
      'A',
      "'real'",
      2,
    ]);
  });
});

describe('a macro name as the operand of a lazy operator', () => {
  // The handler reads the raw body, as it reads the program with the body
  // written in place of the name: each value equals the hand-expanded one.
  const CASES: [string, Record<string, J>, J][] = [
    ['D(A, x)', { A: ['Power', 'x', 3] }, ['D', 'A', 'x']],
    ['Integrate(A, x)', { A: ['Power', 'x', 3] }, ['Integrate', 'A', 'x']],
    [
      'Integrate(A, Limits(x, 0, 1))',
      { A: ['Power', 'x', 3] },
      ['Integrate', 'A', ['Limits', 'x', 0, 1]],
    ],
    [
      'NIntegrate(A, 0, 1)',
      { A: ['Function', ['Power', 'x', 3], 'x'] },
      ['NIntegrate', 'A', 0, 1],
    ],
    [
      'Limit(A, 2)',
      { A: ['Function', ['Power', 'x', 2], 'x'] },
      ['Limit', 'A', 2],
    ],
    [
      'Map(L, A)',
      { A: ['Function', ['Add', 'x', 1], 'x'] },
      ['Map', ['List', 1, 2], 'A'],
    ],
    ['ND(A, 2)', { A: ['Function', ['Power', 'x', 2], 'x'] }, ['ND', 'A', 2]],
    ['Series(A, x)', { A: ['Exp', 'x'] }, ['Series', 'A', 'x']],
    ['If(A, 1, 2)', { A: ['Greater', 'y', 0] }, ['If', 'A', 1, 2]],
    ['a chain: D(B, x)', { A: ['Power', 'x', 3], B: 'A' }, ['D', 'B', 'x']],
  ];
  const byHand = (macros: Record<string, J>) => {
    const walk = (j: J): J =>
      typeof j === 'string' && j in macros
        ? walk(macros[j])
        : Array.isArray(j)
          ? j.map(walk)
          : j;
    return walk;
  };

  test.each(CASES)(
    '%s gives the value of the hand-expanded form',
    (_, macros, program) => {
      const withMacro = new ComputeEngine();
      withMacro.assign('y', 5);
      for (const [name, body] of Object.entries(macros))
        withMacro.declare(name, { macro: body });
      const hand = new ComputeEngine();
      hand.assign('y', 5);
      expect(withMacro.box(program).evaluate().json).toEqual(
        hand.box(byHand(macros)(program)).evaluate().json
      );
    }
  );

  test('a Dictionary entry that is a macro name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Tuple', "'a'", 1] });
    expect(ce.box(['Dictionary', 'A']).evaluate().json).toEqual({
      dict: { a: 1 },
    });
  });

  test('Integrate(A, x) is the integral of the body', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 3] });
    expect(ce.box(['Integrate', 'A', 'x']).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 4],
      ['Power', 'x', 4],
    ]);
  });

  test('a macro that reaches itself at a lazy operand is macro-cycle', () => {
    const ce = new ComputeEngine();
    ce.declare('B', { macro: ['Add', 'B', 1] });
    // The same depth as at a canonical operand: `B` is `B + 1` once.
    expect(ce.box(['D', 'B', 'x']).json).toEqual([
      'D',
      ['Add', ['Error', "'macro-cycle'", "'B'"], 1],
      'x',
    ]);
  });

  test('a cycle through a lazy operand that holds its operand is macro-cycle', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Unevaluated', 'A'] });
    expect(ce.box(['Unevaluated', 'A']).json).toEqual([
      'Unevaluated',
      ['Unevaluated', ['Error', "'macro-cycle'", "'A'"]],
    ]);
    expect(ce.box('A').json).toEqual([
      'Unevaluated',
      ['Error', "'macro-cycle'", "'A'"],
    ]);
  });

  test('a name that the operator binds is not expanded', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    // `Function(A, A)` is the identity: its parameter hides the macro.
    expect(ce.box([['Function', 'A', 'A'], 7]).evaluate().json).toBe(7);
    expect(
      ce
        .box(['Sum', 'A', ['Limits', 'j', 1, 2], ['Limits', 'A', 1, 3]])
        .evaluate().json
    ).toBe(12);
  });
});

describe('a macro name at an operand that takes a name', () => {
  // The macro name behaves as a variable of that name: each program gives
  // what it gives with the name `z`, on an engine with no macro, in the
  // canonical form (evaluated) and in the structural form. The body `q^7` is
  // never the right answer.
  const PROGRAMS: [string, J][] = [
    ['Limit(A + 1, A, 0)', ['Limit', ['Add', 'A', 1], 'A', 0]],
    ['Limit(A + 1, A, 0, 1)', ['Limit', ['Add', 'A', 1], 'A', 0, 1]],
    ['Solve(2A = 4, A)', ['Solve', ['Equal', ['Multiply', 2, 'A'], 4], 'A']],
    [
      'Solve(eq, [A, y])',
      [
        'Solve',
        [
          'List',
          ['Equal', ['Add', 'A', 'y'], 3],
          ['Equal', ['Subtract', 'A', 'y'], 1],
        ],
        ['List', 'A', 'y'],
      ],
    ],
    [
      'Solve(eq, A in Reals)',
      [
        'Solve',
        ['Equal', ['Power', 'A', 2], 4],
        ['Element', 'A', 'RealNumbers'],
      ],
    ],
    [
      'FindRoot(A^2 - 2, [(A, 1)])',
      [
        'FindRoot',
        ['Subtract', ['Power', 'A', 2], 2],
        ['List', ['Tuple', 'A', 1]],
      ],
    ],
    [
      'FindFit(data, A x + b, [A, (b, 0)], x)',
      [
        'FindFit',
        ['List', ['Tuple', 0, 1], ['Tuple', 1, 3], ['Tuple', 2, 5]],
        ['Add', ['Multiply', 'A', 'x'], 'b'],
        ['List', 'A', ['Tuple', 'b', 0]],
        'x',
      ],
    ],
    ['Factor(A^2 - 1, A)', ['Factor', ['Subtract', ['Power', 'A', 2], 1], 'A']],
    [
      'Apart(1/(A^2 - 1), A)',
      ['Apart', ['Divide', 1, ['Subtract', ['Power', 'A', 2], 1]], 'A'],
    ],
  ];
  const rename = (j: J): J =>
    j === 'A' ? 'z' : Array.isArray(j) ? j.map(rename) : j;
  const result = (
    ce: ComputeEngine,
    j: J,
    form: 'canonical' | 'structural'
  ) => {
    const e = ce.box(j, { form });
    return JSON.stringify((form === 'canonical' ? e.evaluate() : e).json);
  };

  test.each(PROGRAMS)('%s', (_, program) => {
    for (const form of ['canonical', 'structural'] as const) {
      const withMacro = new ComputeEngine();
      withMacro.declare('A', { macro: ['Power', 'q', 7] });
      const byName = new ComputeEngine();
      expect(result(withMacro, program, form)).toEqual(
        result(byName, rename(program), form)
          .replace(/"z"/g, '"A"')
          .replace(/'z'/g, "'A'")
      );
    }
  });

  test('a start value in a spec is an occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('S', { macro: 1 });
    const program = (start: J) => [
      'FindRoot',
      ['Subtract', ['Power', 'z', 2], 2],
      ['List', ['Tuple', 'z', start]],
    ];
    expect(ce.box(program('S')).evaluate().json).toEqual(
      new ComputeEngine().box(program(1)).evaluate().json
    );
  });
});

describe('the walk of the raw operands of a lazy call', () => {
  test('the operands of the caller are not changed', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { macro: ['Power', 'q', 7] });
    const raw = { form: 'raw' } as J;
    const a = ce.box('a', raw);
    const spec = ce.function(
      'List',
      [ce.function('Tuple', [a, ce.number(1)], raw)],
      raw
    );
    ce.function('FindRoot', [
      ce.box(['Subtract', ['Power', 'a', 2], 2], raw),
      spec,
    ]);
    // The variable of `FindRoot` is a name there, and an occurrence here.
    expect(a.canonical.json).toEqual(['Power', 'q', 7]);
    const eq = ce.box(['Equal', ['Multiply', 2, 'a'], 4], raw);
    ce.function('Solve', [eq, ce.box('a', raw)]);
    expect(eq.canonical.json).toEqual([
      'Equal',
      ['Multiply', 2, ['Power', 'q', 7]],
      4,
    ]);
  });

  test.each([
    ['\\lim_{x\\to A^+} \\frac{1}{x-A}', '\\lim_{x\\to 2^+} \\frac{1}{x-2}'],
    [
      '\\lim_{x\\to A} \\frac{x^2-A^2}{x-A}',
      '\\lim_{x\\to 2} \\frac{x^2-2^2}{x-2}',
    ],
  ])(
    'the point of a Limit of a Function literal is an occurrence: %s',
    (latex, byHand) => {
      const ce = new ComputeEngine();
      ce.declare('A', { macro: 2 });
      const e = ce.parse(latex);
      const hand = new ComputeEngine().parse(byHand);
      expect(e.json).toEqual(hand.json);
      expect(e.evaluate().json).toEqual(hand.evaluate().json);
    }
  );

  test('a raw node of another engine is not recorded as free for it', () => {
    const lazy = { lazy: true, signature: '(any) -> any' } as J;
    const ce1 = new ComputeEngine();
    ce1.declare('B', { macro: 1 });
    ce1.declare('Lz', lazy);
    const ce2 = new ComputeEngine();
    ce2.declare('A', { macro: ['Power', 'q', 7] });
    ce2.declare('Lz', lazy);
    const node = ce2.box(['Add', 'A', 1], { form: 'raw' });
    ce1.function('Lz', [node]);
    expect(ce2.function('Lz', [node]).json).toEqual([
      'Lz',
      ['Add', ['Power', 'q', 7], 1],
    ]);
  });

  describe('the forms of Limit, with a macro x', () => {
    const X: J = ['Add', 'q', 3];
    const replace = (j: J, by: J): J =>
      j === 'x' ? by : Array.isArray(j) ? j.map((y) => replace(y, by)) : j;
    const value = (ce: ComputeEngine, j: J) =>
      JSON.stringify(ce.box(j).evaluate().json);
    const withMacro = () => {
      const ce = new ComputeEngine();
      ce.declare('x', { macro: X });
      return ce;
    };
    test.each([
      ['Limit(t^2, x, 1)', ['Limit', ['Power', 't', 2], 'x', 1]],
      ['Limit(Sin, x, 0)', ['Limit', 'Sin', 'x', 0]],
    ] as [string, J][])('%s: x is the point, an occurrence', (_, program) => {
      expect(value(withMacro(), program)).toEqual(
        value(new ComputeEngine(), replace(program, X))
      );
    });
    test.each([
      [
        'Limit(sin(x)/x, To(x, 0))',
        ['Limit', ['Divide', ['Sin', 'x'], 'x'], ['To', 'x', 0]],
      ],
      [
        'Limit(sin(x)/x, x, 0)',
        ['Limit', ['Divide', ['Sin', 'x'], 'x'], 'x', 0],
      ],
    ] as [string, J][])('%s: x is the variable, a name', (_, program) => {
      expect(value(withMacro(), program)).toEqual(
        value(new ComputeEngine(), replace(program, 'z')).replace(/"z"/g, '"x"')
      );
    });
  });

  test('the second operand of NLimit is the point, an occurrence', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'q', 7] });
    expect(ce.box(['NLimit', ['Add', 'A', 1], 'A', 0]).json).toEqual(
      new ComputeEngine().box([
        'NLimit',
        ['Add', ['Power', 'q', 7], 1],
        ['Power', 'q', 7],
        0,
      ]).json
    );
  });

  const chain = (leaf: J, depth: number): J => {
    let j = leaf;
    for (let i = 0; i < depth; i++) j = ['Add', j, 1];
    return j;
  };

  test('a raw operand 5,000 levels deep', () => {
    const ce = new ComputeEngine();
    ce.declare('Unrelated', { macro: 1 });
    expect(
      ce.box([
        'FindRoot',
        ['Subtract', chain('x', 5000), 6000],
        ['List', ['Tuple', 'x', 1]],
      ]).operator
    ).toBe('FindRoot');
    expect(
      ce.box(['Solve', ['Equal', chain('x', 5000), 0], 'x']).operator
    ).toBe('Solve');
    ce.declare('M', { macro: ['Multiply', 2, 'x'] });
    ce.declare('Lz', { lazy: true, signature: '(any) -> any' } as J);
    let node: J = ce.box(['Lz', chain('M', 5000)]).op1;
    while (node.operator === 'Add') node = node.op1;
    expect(node.json).toEqual(['Multiply', 2, 'x']);
  });

  test('an opaque operand of a nested lazy call, and a nested Hold, keep the name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'q', 7] });
    ce.declare('Quote', {
      lazy: true,
      signature: '(any) -> any',
      operands: (ops: J) => ops.map(() => ({ kind: 'opaque' })),
    } as J);
    ce.declare('Lz', { lazy: true, signature: '(any) -> any' } as J);
    expect(ce.box(['Lz', ['If', 'c', ['Quote', 'A'], 0]]).json).toEqual([
      'Lz',
      ['If', 'c', ['Quote', 'A'], 0],
    ]);
    expect(ce.box(['Lz', ['If', 'c', ['Hold', 'A'], 0]]).json).toEqual([
      'Lz',
      ['If', 'c', ['Hold', 'A'], 0],
    ]);
    expect(ce.box(['Lz', ['If', 'c', 'A', 0]]).json).toEqual([
      'Lz',
      ['If', 'c', ['Power', 'q', 7], 0],
    ]);
  });

  test('a statement keeps its source offsets, and a body takes those of the name', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Add', 'y', 1] });
    const block = ce.box({
      fn: [
        'Block',
        { fn: ['Add', 'A', { num: '1' }], sourceOffsets: [2, 7] },
        { sym: 'A', sourceOffsets: [9, 10] },
      ],
      sourceOffsets: [0, 12],
    } as J);
    expect(block.json).toEqual(['Block', ['Add', 'y', 2], ['Add', 'y', 1]]);
    expect(block.ops!.map((x) => x.sourceOffsets)).toEqual([
      [2, 7],
      [9, 10],
    ]);
  });
});

describe('nothing is expanded during an evaluation', () => {
  test('a macro name inside a raw operand of a lazy call is expanded at boxing', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Subtract', ['Multiply', 2, 'x'], 4] });
    expect(ce.box(['Solve', ['Equal', 'A', 0], 'x']).evaluate().json).toEqual([
      'List',
      2,
    ]);
  });

  test('a macro name below a binder inside a raw operand reads the index', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Multiply', 'k', 'x'] });
    const program = (a: J): J => [
      'FindRoot',
      ['Subtract', ['Sum', a, ['Limits', 'k', 1, 3]], 12],
      ['List', ['Tuple', 'x', 1]],
    ];
    const byHand = new ComputeEngine();
    expect(ce.box(program('A')).evaluate().json).toEqual(
      byHand.box(program(['Multiply', 'k', 'x'])).evaluate().json
    );
    const solve = (a: J): J => [
      'Solve',
      ['Equal', ['Sum', a, ['Limits', 'k', 1, 3]], 12],
      'x',
    ];
    expect(ce.box(solve('A')).evaluate().json).toEqual(
      byHand.box(solve(['Multiply', 'k', 'x'])).evaluate().json
    );
  });

  test('an index inside a raw operand hides the macro', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'q', 7] });
    const program: J = [
      'Solve',
      ['Equal', ['Sum', ['Multiply', 'A', 'x'], ['Limits', 'A', 1, 3]], 12],
      'x',
    ];
    expect(ce.box(program).evaluate().json).toEqual(
      new ComputeEngine().box(program).evaluate().json
    );
  });

  test.each([
    ['Factor', ['Factor', ['Subtract', ['Power', 'A', 2], 1], 'A']],
    [
      'Apart',
      ['Apart', ['Divide', 1, ['Subtract', ['Power', 'A', 2], 1]], 'A'],
    ],
  ] as [string, J][])(
    '%s with a macro-named variable, evaluate and evaluateAsync',
    async (_, program) => {
      const ce = new ComputeEngine();
      ce.declare('A', { macro: ['Power', 'q', 7] });
      const rename = (j: J): J =>
        j === 'A' ? 'z' : Array.isArray(j) ? j.map(rename) : j;
      const byName = JSON.stringify(
        new ComputeEngine().box(rename(program)).evaluate().json
      ).replace(/"z"/g, '"A"');
      expect(JSON.stringify(ce.box(program).evaluate().json)).toEqual(byName);
      expect(
        JSON.stringify((await ce.box(program).evaluateAsync()).json)
      ).toEqual(byName);
    }
  );
});

describe('the count of macros is per engine', () => {
  test('an engine with no macro boxes as before when another engine has one', () => {
    const one = new ComputeEngine();
    one.declare('A', { macro: ['Power', 'x', 2] });
    const other = new ComputeEngine();
    expect((one as J)._macroCount).toBe(1);
    expect((other as J)._macroCount).toBe(0);
    expect(other.box(['Add', 'A', 1]).json).toEqual(['Add', 'A', 1]);
  });
});

describe('compiled code (section 4)', () => {
  const TARGETS = ['javascript', 'glsl', 'interval-js', 'python'] as const;

  test.each(TARGETS)('row 1 compiles on %s', (to) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('A', { macro: X2_Y2 });
    const c = compile(ce.box(['Add', 'A', 1]), { to } as never) as J;
    expect(c.success).toBe(true);
    if (to === 'javascript') expect(c.run({ x: 3, y: 1 })).toBe(11);
  });

  test.each(TARGETS)('row 7 compiles on %s', (to) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('A', { macro: ['Multiply', 'k', 'x'] });
    const c = compile(ce.parse('\\sum_{k=1}^{3} A'), { to } as never) as J;
    expect(c.success).toBe(true);
    if (to === 'javascript') expect(c.run({ x: 2 })).toBe(12);
  });

  test.each([
    ['javascript', 'const _cse1 = Math.sin((_.x * _.x) + (_.y * _.y))'],
    ['glsl', 'float _cse1 = _gpu_sin((x * x) + (y * y));'],
    [
      'interval-js',
      'const _cse1 = _IA.sin(_IA.add(_IA.square(_.x), _IA.square(_.y)))',
    ],
    ['python', 'for _cse1 in [np.sin(x ** 2 + y ** 2)]'],
  ])('a body written three times is one shared local on %s', (to, fragment) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('A', { macro: ['Sin', X2_Y2] });
    const c = compile(
      ce.box(['Add', ['Multiply', 'x', 'A'], ['Divide', 1, 'A'], 'A']),
      { to } as never
    ) as J;
    expect(c.success).toBe(true);
    expect(c.code).toContain(fragment);
    expect(c.code.match(/_cse1 =|_cse1 in/g)?.length).toBe(1);
  });
});

describe('a document of Tycho: locals of a block read by a macro', () => {
  const reader = (n: number) => [
    'Block',
    ['Declare', 'x', "'unknown'", ['Range', 1, n]],
    ['Declare', 'y', "'unknown'", ['Range', 1, n]],
    'd',
  ];
  const doubles = (n: number) => [
    'List',
    ...Array.from({ length: n }, (_, i) => 2 * (i + 1)),
  ];

  test('the block reads the macro with its own locals', () => {
    const ce = new ComputeEngine();
    ce.declare('d', { macro: ['Add', 'x', 'y'] });
    expect(ce.box(reader(100)).evaluate().json).toEqual(doubles(100));
  });

  test('the same document in LaTeX', () => {
    const ce = new ComputeEngine();
    ce.declare('d', { macro: ['Add', 'x', 'y'] });
    expect(
      ce.parse('x \\coloneq [1...100]; y \\coloneq [1...100]; d').evaluate()
        .json
    ).toEqual(doubles(100));
  });
});

describe('section 5: a stored body and an inlined body', () => {
  test('5a: Max in a stored function and ElementMax', () => {
    const ce = new ComputeEngine();
    ce.assign('y_r', ce.box(['List', 1, 2, 3]));
    ce.assign('d', fn(ce, ['Max', 0, ['Subtract', 'x', 'y_r']], 'x'));
    expect(ce.box(['d', 2]).evaluate().json).toBe(1);
    ce.assign('dm', fn(ce, ['ElementMax', 0, ['Subtract', 'x', 'y_r']], 'x'));
    expect(ce.box(['dm', 2]).evaluate().json).toEqual(['List', 1, 0, 0]);
    expect(ce.box(['ElementMax', 1, 2]).evaluate().json).toBe(2);
  });

  test('5a: At of a sum of a list-valued function', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('t \\mapsto [\\cos t, \\sin t]'));
    ce.assign('A', ce.parse('t \\mapsto \\sum_{i=0}^{2} a(2^i t)'));
    expect(ce.box(['At', ['A', 0], 1]).evaluate().json).toBe(3);
    expect(ce.box(['A', 't']).type.toString()).toBe('vector<2>');
    expect(ce.box(['At', ['A', 't'], 1]).type.toString()).toBe('number');
    ce.declare('t', 'real');
    const c = compile(ce.box(['At', ['A', 't'], 1]), {
      to: 'javascript',
    } as never) as J;
    expect(c.success).toBe(true);
  });

  test('5b: a parameter whose use admits a list takes the list whole', () => {
    const ce = new ComputeEngine();
    ce.assign('r', fn(ce, ['ElementMax', 0, ['At', 'p', 1]], 'p'));
    expect(ce.box(['r', ['List', 3, -1]]).evaluate().json).toBe(3);
    ce.assign(
      'l',
      fn(
        ce,
        [
          'Sqrt',
          ['Add', ['Power', ['At', 'p', 1], 2], ['Power', ['At', 'p', 2], 2]],
        ],
        'p'
      )
    );
    ce.assign('k', fn(ce, ['ElementMax', 0, ['l', 'p']], 'p'));
    expect(ce.box(['k', ['List', 3, 4]]).evaluate().json).toBe(5);
  });

  test('5b: a call maps over a list argument at another parameter', () => {
    const ce = new ComputeEngine();
    ce.assign('tri', fn(ce, ['Sum', 'j', ['Limits', 'j', 1, 'n']], 'n'));
    expect(ce.box(['tri', ['List', 1, 2, 3]]).evaluate().json).toEqual([
      'List',
      1,
      3,
      6,
    ]);
    ce.assign('dd', fn(ce, ['ElementMax', 0, 'p'], 'p'));
    expect(ce.box(['dd', ['List', 1, -2, 3]]).evaluate().json).toEqual([
      'List',
      1,
      0,
      3,
    ]);
  });
});
