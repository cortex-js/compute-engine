import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { subsIfCaptureFree } from '../../src/compute-engine/boxed-expression/subs-capture-mode';

// `subs()` avoids variable capture: when a replacement holds a free name that
// a binder binds, and the substitution replaces an occurrence in the scope of
// that name, the binder renames the name to a fresh name first (`k` becomes
// `k_1`, or `k_2` when `k_1` is used). Before, the replacement was inserted
// as it was, and the binder captured the name: `Sum(j + k, Limits(k, 1, 3))`
// with `j` replaced by `k` gave `Sum(k + k, …)`, whose value is `12`.

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

function subs(
  json: Json,
  map: Record<string, Json>,
  form?: 'raw'
): Expression {
  const expr = ce.box(json, form ? { form } : undefined);
  const boxed: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(map)) boxed[k] = ce.box(v);
  return expr.subs(boxed);
}

describe('SUBS RENAMES A BINDER THAT WOULD CAPTURE A REPLACEMENT', () => {
  test('Sum', () => {
    const result = subs(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]], {
      j: 'k',
    });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'k_1'],
      ['Limits', 'k_1', 1, 3],
    ]);
    expect(result.evaluate().toString()).toBe('3k + 6');
  });

  test('Product', () => {
    const result = subs(
      ['Product', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]],
      { j: 'k' }
    );
    expect(result.json).toEqual([
      'Product',
      ['Add', 'k', 'k_1'],
      ['Limits', 'k_1', 1, 3],
    ]);
    expect(result.evaluate().json).toEqual([
      'Multiply',
      ['Add', 'k', 1],
      ['Add', 'k', 2],
      ['Add', 'k', 3],
    ]);
  });

  test('a definite Integrate, whose integrand is a Function literal', () => {
    // The parameter of the integrand and the variable of the limits get the
    // same fresh name.
    const result = subs(
      ['Integrate', ['Multiply', 'j', 'x'], ['Limits', 'x', 0, 1]],
      { j: 'x' }
    );
    expect(result.json).toEqual([
      'Integrate',
      ['Function', ['Block', ['Multiply', 'x', 'x_1']], 'x_1'],
      ['Limits', 'x_1', 0, 1],
    ]);
    expect(result.evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      'x',
    ]);
  });

  test('Comprehension', () => {
    const result = subs(
      ['Comprehension', ['Add', 'j', 'k'], ['Element', 'k', ['Range', 1, 3]]],
      { j: 'k' }
    );
    expect(result.json).toEqual([
      'Comprehension',
      ['Add', 'k', 'k_1'],
      ['Element', 'k_1', ['Range', 1, 3]],
    ]);
  });

  test('a Function literal', () => {
    const result = subs(['Function', ['Power', 'y', 'x'], 'x'], { y: 'x' });
    expect(result.json).toEqual([
      'Function',
      ['Block', ['Power', 'x', 'x_1']],
      'x_1',
    ]);
    expect(ce.box(['Apply', result, 2]).evaluate().json).toEqual([
      'Power',
      'x',
      2,
    ]);
  });

  test('a destructuring parameter', () => {
    const result = subs(
      ['Function', ['Add', 'y', 'a', 'b'], ['Tuple', 'a', 'b']],
      { y: 'a' }
    );
    expect(result.json).toEqual([
      'Function',
      ['Block', ['Add', 'a', 'a_1', 'b']],
      ['Tuple', 'a_1', 'b'],
    ]);
  });

  test('a local of a Block', () => {
    const result = subs(
      ['Block', ['Declare', 't', "'unknown'", 1], ['Add', 'y', 't']],
      { y: 't' }
    );
    expect(result.json).toEqual([
      'Block',
      ['Declare', 't_1', "'unknown'", 1],
      ['Add', 't', 't_1'],
    ]);
    expect(result.evaluate().toString()).toBe('t + 1');
  });

  test('nested binders are each renamed', () => {
    const result = subs(
      [
        'Sum',
        ['Sum', ['Add', 'j', 'k', 'm'], ['Limits', 'm', 1, 2]],
        ['Limits', 'k', 1, 2],
      ],
      { j: ['Add', 'k', 'm'] }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Sum', ['Add', 'k', 'k_1', 'm', 'm_1'], ['Limits', 'm_1', 1, 2]],
      ['Limits', 'k_1', 1, 2],
    ]);
    expect(result.evaluate().toString()).toBe('4k + 4m + 12');
  });

  test('the fresh name is not a name used in the expression', () => {
    const result = subs(
      ['Sum', ['Add', 'j', 'k', 'k_1'], ['Limits', 'k', 1, 3]],
      { j: 'k' }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'k_1', 'k_2'],
      ['Limits', 'k_2', 1, 3],
    ]);
  });

  test('an extra parameter of an integrand is replaced, with no capture', () => {
    // The parameter list of an integrand is not read: `a` is free.
    const result = subs(
      [
        'Integrate',
        ['Function', ['Multiply', 'a', 'x'], 'x', 'a'],
        ['Limits', 'x', 0, 1],
      ],
      { a: 'x' }
    );
    expect(result.evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      'x',
    ]);
  });

  test('a closure value below a renamed binder keeps its captured locals', () => {
    const engine = new ComputeEngine();
    // A closure that captured `a = 2`.
    const closure = engine
      .box([
        'Block',
        ['Declare', 'a', "'unknown'", 2],
        ['Function', ['Multiply', 'a', 'x'], 'x'],
      ])
      .evaluate();
    const sum = engine.function('Sum', [
      engine.function('Add', [
        engine.function('Apply', [closure, engine.symbol('j')]),
        engine.symbol('k'),
      ]),
      engine.box(['Limits', 'k', 1, 3]),
    ]);
    expect(sum.subs({ j: engine.symbol('k') }).evaluate().toString()).toBe(
      '6k + 6'
    );
  });

  test('a substitution object changed between two calls', () => {
    const sum = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]]);
    const sub: Record<string, Expression> = { j: ce.symbol('z') };
    sum.subs(sub);
    sub.j = ce.symbol('k');
    expect(sum.subs(sub).json).toEqual([
      'Sum',
      ['Add', 'k', 'k_1'],
      ['Limits', 'k_1', 1, 3],
    ]);
  });

  test('a raw expression stays raw', () => {
    const result = subs(
      ['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]],
      { j: 'k' },
      'raw'
    );
    expect(result.isCanonical).toBe(false);
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'k_1'],
      ['Limits', 'k_1', 1, 3],
    ]);
    expect(result.evaluate().toString()).toBe('3k + 6');
  });
});

describe('SUBS DOES NOT RENAME A BINDER WITH NO CAPTURE', () => {
  test('a replacement of the index itself leaves the binder unchanged', () => {
    const json: Json = ['Sum', 'j', ['Limits', 'j', 1, 3]];
    expect(subs(json, { j: 5 }).json).toEqual(json);
  });

  test('the variable of D is replaced at a point', () => {
    expect(
      subs(['D', ['Power', 'x', 2], 'x'], { x: 3 })
        .evaluate()
        .json
    ).toEqual(6);
  });

  test('a binder with no collision keeps its identity', () => {
    const expr = ce.box(['Multiply', 'j', ['Sum', 'k', ['Limits', 'k', 1, 3]]]);
    const sum = expr.ops!.find((x) => x.operator === 'Sum')!;
    const result = expr.subs({ j: ce.symbol('k') });
    expect(result.ops!.find((x) => x.operator === 'Sum')).toBe(sum);
  });

  test('the name of a call is not replaced, so it causes no rename', () => {
    const json: Json = ['Function', ['g', 'x'], 'x'];
    const expr = ce.box(json);
    expect(expr.subs({ g: ce.symbol('x') })).toBe(expr);
  });

  test('a bound of the own Limits clause is outside the scope of the index', () => {
    const result = subs(['Sum', 'k', ['Limits', 'k', 1, 'j']], { j: 'k' });
    expect(result.json).toEqual(['Sum', 'k', ['Limits', 'k', 1, 'k']]);
  });

  test('a rule replacement binds the names of its wildcards', () => {
    // A rule rewrites structure: the `k` of the matched `_f` is bound by the
    // `Sum` that the replacement writes.
    const result = ce
      .box(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]])
      .replace({
        match: ['Sum', '_f', ['Limits', 'k', 1, 3]],
        replace: ['Sum', ['Add', '_f', 'k'], ['Limits', 'k', 1, 3]],
      });
    expect(result?.json).toEqual([
      'Sum',
      ['Add', 'j', 'k', 'k'],
      ['Limits', 'k', 1, 3],
    ]);
  });
});

describe('A BINDER THAT CANNOT BE RENAMED BEFORE IT RUNS', () => {
  // The target of an `Assign` of a held `Block` is a local of the block only
  // when the name is not declared where the block is released. With `s`
  // declared, `s := 3` writes the declared `s`, so the target is not renamed
  // and the replacement is inserted as it is.
  test('the target of an Assign of a held Block', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'integer');
    const held = engine.box([
      'Hold',
      ['Block', ['Assign', 's', 3], ['Add', 'y', 's']],
    ]);
    const result = held.subs({ y: engine.symbol('s') });
    expect(result.json).toEqual([
      'Hold',
      ['Block', ['Assign', 's', 3], ['Add', 's', 's']],
    ]);
    expect(engine.box(['ReleaseHold', result]).evaluate().json).toEqual(6);
    expect(subsIfCaptureFree(held, { y: engine.symbol('s') })).toBeUndefined();
  });

  // A `Declare` in a branch of an `If` makes a local only when the branch
  // runs, so the read of `w` after the `If` denotes the local or not.
  test('a Declare in a branch of an If of a held Block', () => {
    const held = ce.box([
      'Hold',
      [
        'Block',
        ['If', 'True', ['Declare', 'w', 'integer'], 0],
        ['Add', 'y', 'w'],
      ],
    ]);
    const result = held.subs({ y: ce.symbol('w') });
    expect(result.json).toEqual([
      'Hold',
      [
        'Block',
        ['If', 'True', ['Declare', 'w', 'integer'], 0],
        ['Add', 'w', 'w'],
      ],
    ]);
    expect(subsIfCaptureFree(held, { y: ce.symbol('w') })).toBeUndefined();
  });

  test('subsIfCaptureFree gives the renamed result when a rename is possible', () => {
    const sum = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]]);
    expect(subsIfCaptureFree(sum, { j: ce.symbol('k') })?.json).toEqual([
      'Sum',
      ['Add', 'k', 'k_1'],
      ['Limits', 'k_1', 1, 3],
    ]);
  });
});
