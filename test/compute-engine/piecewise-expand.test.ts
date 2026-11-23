import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/** `PiecewiseExpand(json)` evaluated: the conditional value. */
function expand(ce: ComputeEngine, json: unknown): Expression {
  return ce.box(['PiecewiseExpand', json] as any).evaluate();
}

/** The value of `e` at the point, by `evaluate()`. */
function at(e: Expression, point: Record<string, number>): string {
  return e.subs(point).evaluate().toString();
}

describe('PIECEWISE EXPAND: the conditional value agrees with evaluate()', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');

  // -2, 0 and 2 on each side of the jump, 1 and 3 the boundaries of Max(x, 1)
  // and Min(x, 3), and a fraction
  const samples = [-2, -1 / 2, 0, 1, 3, 2, 7];
  const points: Record<string, number>[] = [];
  for (const x of samples) for (const y of [-3, 0, 1, 4]) points.push({ x, y });

  const cases: [string, unknown][] = [
    ['Abs(x)', ['Abs', 'x']],
    ['Sign(x)', ['Sign', 'x']],
    ['Heaviside(x)', ['Heaviside', 'x']],
    ['Max(x, y)', ['Max', 'x', 'y']],
    ['Min(x, y)', ['Min', 'x', 'y']],
    ['Max(x, 1)', ['Max', 'x', 1]],
    ['Min(x, 3)', ['Min', 'x', 3]],
    ['Max(x, 1, y)', ['Max', 'x', 1, 'y']],
    ['Min(x, 3, y)', ['Min', 'x', 3, 'y']],
    ['Abs(x - Max(x, 1))', ['Abs', ['Subtract', 'x', ['Max', 'x', 1]]]],
    ['Abs(x - 1)', ['Abs', ['Subtract', 'x', 1]]],
    ['Sign(x) * Abs(y)', ['Multiply', ['Sign', 'x'], ['Abs', 'y']]],
    [
      'Heaviside(x) + Heaviside(y)',
      ['Add', ['Heaviside', 'x'], ['Heaviside', 'y']],
    ],
    ['Abs(Abs(x) - 1)', ['Abs', ['Subtract', ['Abs', 'x'], 1]]],
    ['Max(Abs(x), Sign(y))', ['Max', ['Abs', 'x'], ['Sign', 'y']]],
    ['Min(Heaviside(x), y)', ['Min', ['Heaviside', 'x'], 'y']],
    ['Sin(Abs(x)) + 2', ['Add', ['Sin', ['Abs', 'x']], 2]],
    ['Abs(x) ^ 2', ['Power', ['Abs', 'x'], 2]],
    ['Sign(x - y)', ['Sign', ['Subtract', 'x', 'y']]],
    [
      'Max(x, y) - Min(x, y)',
      ['Subtract', ['Max', 'x', 'y'], ['Min', 'x', 'y']],
    ],
    ['Abs(x) < 1', ['Less', ['Abs', 'x'], 1]],
    ['[Abs(x), Sign(y)]', ['List', ['Abs', 'x'], ['Sign', 'y']]],
  ];

  for (const [name, json] of cases) {
    const e = ce.box(json as any);
    const p = expand(ce, json);
    test(`PiecewiseExpand(${name}) is a Which`, () => {
      expect(p.operator).toBe('Which');
    });
    test(`PiecewiseExpand(${name}) agrees with evaluate() at ${points.length} points`, () => {
      for (const pt of points)
        expect(`${JSON.stringify(pt)} ${at(p, pt)}`).toBe(
          `${JSON.stringify(pt)} ${at(e, pt)}`
        );
    });
  }
});

describe('PIECEWISE EXPAND: the form', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');

  const forms: [string, unknown, string][] = [
    ['Abs(x)', ['Abs', 'x'], 'Which(0 <= x, x, "True", -x)'],
    ['Sign(x)', ['Sign', 'x'], 'Which(0 < x, 1, x < 0, -1, "True", 0)'],
    [
      'Heaviside(x)',
      ['Heaviside', 'x'],
      'Which(x < 0, 0, 0 < x, 1, "True", 1/2)',
    ],
    ['Max(x, y)', ['Max', 'x', 'y'], 'Which(0 <= x - y, x, "True", y)'],
    ['Min(x, y)', ['Min', 'x', 'y'], 'Which(x - y <= 0, x, "True", y)'],
    // The argument of the Abs is 0 where x >= 1, so that arm has no split
    [
      'Abs(x - Max(x, 1))',
      ['Abs', ['Subtract', 'x', ['Max', 'x', 1]]],
      'Which(0 <= x - 1, 0, "True", 1 - x)',
    ],
  ];
  for (const [name, json, expected] of forms)
    test(`PiecewiseExpand(${name}) = ${expected}`, () => {
      expect(expand(ce, json).toString()).toBe(expected);
    });

  test('Heaviside(0) is 1/2, as Heaviside(0) evaluates', () => {
    const p = expand(ce, ['Heaviside', 'x']);
    expect(at(p, { x: 0 })).toBe('1/2');
    expect(ce.box(['Heaviside', 0]).evaluate().toString()).toBe('1/2');
  });

  const unchanged: [string, unknown][] = [
    ['no step function', ['Add', ['Sin', 'x'], 'y']],
    ['a symbol', 'x'],
    ['a number', 3],
    [
      'a held Sum, whose index is bound',
      ['Sum', ['Abs', 'k'], ['Tuple', 'k', 1, 3]],
    ],
    [
      'a Which, which holds its arms',
      ['Which', ['Less', 'x', 0], ['Abs', 'x'], 'True', 1],
    ],
    ['the Max of a list', ['Max', ['List', 1, 2]]],
  ];
  for (const [name, json] of unchanged)
    test(`${name} is returned unchanged`, () => {
      const e = ce.box(json as any);
      expect(expand(ce, json).isSame(e)).toBe(true);
    });

  test('the Abs and Sign of a complex argument are left alone', () => {
    const c = new ComputeEngine();
    c.declare('z', 'complex');
    expect(expand(c, ['Abs', 'z']).toString()).toBe('|z|');
    expect(expand(c, ['Sign', 'z']).toString()).toBe('Sign(z)');
  });

  test('the Max, Min and Heaviside of a complex or number argument are left alone', () => {
    // At `z = 1 + i`, `Max(z, 1)` stays unevaluated: a split on `z - 1 >= 0`
    // would give `1`.
    const c = new ComputeEngine();
    c.declare('z', 'complex');
    c.declare('w', 'number');
    for (const json of [
      ['Max', 'z', 1],
      ['Min', 'z', 1],
      ['Max', 'w', 1],
      ['Heaviside', 'z'],
    ])
      expect(expand(c, json).isSame(c.box(json as any))).toBe(true);
  });

  test('the Abs of an unknown is left alone, as its sign is not a case', () => {
    const c = new ComputeEngine();
    expect(expand(c, ['Abs', 'u']).toString()).toBe('|u|');
  });

  test('Max and Min of unknowns split with no assumption', () => {
    const c = new ComputeEngine();
    expect(expand(c, ['Max', 'u', 'v']).operator).toBe('Which');
    expect(expand(c, ['Min', 'u', 'v']).operator).toBe('Which');
  });

  test('a sum of 20 Abs is returned unchanged, without building the arms', () => {
    const c = new ComputeEngine();
    const terms = Array.from({ length: 20 }, (_, i) => {
      c.declare(`x${i}`, 'real');
      return ['Abs', `x${i}`];
    });
    const start = Date.now();
    expect(expand(c, ['Add', ...terms]).operator).not.toBe('Which');
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('equal conditions from different operands are merged', () => {
    const c = new ComputeEngine();
    c.declare('x', 'real');
    c.declare('y', 'real');
    const r = expand(c, ['Add', ['Abs', 'x'], ['Max', ['Add', 'x', 'y'], 'y']]);
    expect(r.operator).toBe('Which');
    expect(r.nops).toBe(4); // two arms
  });

  test('an impure expression is returned unchanged', () => {
    const json = ['Abs', ['Subtract', ['Random'], ['Rational', 1, 2]]];
    expect(expand(ce, json).operator).not.toBe('Which');
    const sum = ['Add', ['Abs', 'x'], ['Random']];
    expect(expand(ce, sum).operator).not.toBe('Which');
  });

  test('Max() and Min() with no operand are returned unchanged', () => {
    for (const head of ['Max', 'Min']) {
      const json = [head];
      expect(expand(ce, json).isSame(ce.box(json as any))).toBe(true);
    }
  });

  test('a call that would pass the arm limit is returned unchanged', () => {
    const json = [
      'Multiply',
      ...Array.from({ length: 6 }, (_, i) => ['Sign', ['Subtract', 'x', i]]),
    ];
    expect(expand(ce, json).operator).not.toBe('Which');
  });
});

describe('PIECEWISE EXPAND: assumptions', () => {
  test('with x > 0, Abs(x) is x and Sign(x) is 1', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', 'x', 0]));
    expect(expand(ce, ['Abs', 'x']).toString()).toBe('x');
    expect(expand(ce, ['Sign', 'x']).toString()).toBe('1');
    expect(expand(ce, ['Heaviside', 'x']).toString()).toBe('1');
    expect(expand(ce, ['Max', 'x', 0]).toString()).toBe('x');
    expect(expand(ce, ['Min', 'x', 0]).toString()).toBe('0');
  });

  test('with x < 0, Abs(x) is -x', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Less', 'x', 0]));
    expect(expand(ce, ['Abs', 'x']).toString()).toBe('-x');
    expect(expand(ce, ['Sign', 'x']).toString()).toBe('-1');
    expect(expand(ce, ['Heaviside', 'x']).toString()).toBe('0');
  });

  test('with x >= 0, the arm for x < 0 goes and Sign(x) keeps the zero', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['GreaterEqual', 'x', 0]));
    expect(expand(ce, ['Abs', 'x']).toString()).toBe('x');
    expect(expand(ce, ['Sign', 'x']).toString()).toBe(
      'Which(0 < x, 1, "True", 0)'
    );
  });

  test('with x > 3, the constant never wins Max(x, 2, y)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', 'x', 3]));
    ce.declare('y', 'real');
    expect(expand(ce, ['Max', 'x', 2, 'y']).toString()).toBe(
      'Which(0 <= x - y, x, "True", y)'
    );
  });

  test('the assumptions are only read: the engine keeps its own', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expand(ce, ['Abs', 'x']);
    expect(ce.box(['Greater', 'x', 0]).evaluate().toString()).not.toBe(
      '"True"'
    );
    expect(expand(ce, ['Abs', 'x']).operator).toBe('Which');
  });

  const ce = new ComputeEngine();
  ce.assume(ce.box(['Greater', 'a', 0]));
  ce.declare('x', 'real');
  const cases: [string, unknown][] = [
    ['Abs(a)', ['Abs', 'a']],
    ['Abs(a - x)', ['Abs', ['Subtract', 'a', 'x']]],
    ['Max(a, x, 0)', ['Max', 'a', 'x', 0]],
    ['Sign(a) * Abs(x)', ['Multiply', ['Sign', 'a'], ['Abs', 'x']]],
    ['Heaviside(a - x)', ['Heaviside', ['Subtract', 'a', 'x']]],
  ];
  for (const [name, json] of cases) {
    const e = ce.box(json as any);
    const p = expand(ce, json);
    test(`with a > 0, PiecewiseExpand(${name}) agrees with evaluate() where a > 0`, () => {
      for (const a of [1 / 2, 1, 5])
        for (const x of [-3, 0, 1, 1 / 2, 5])
          expect(at(p, { a, x })).toBe(at(e, { a, x }));
    });
  }
});

describe('PIECEWISE EXPAND: every route reads the same value', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');

  const cases: [string, unknown][] = [
    ['Abs(x - Max(x, 1))', ['Abs', ['Subtract', 'x', ['Max', 'x', 1]]]],
    ['Max(x, y) - Min(x, 1)', ['Subtract', ['Max', 'x', 'y'], ['Min', 'x', 1]]],
    ['Sign(x) * Abs(y)', ['Multiply', ['Sign', 'x'], ['Abs', 'y']]],
    ['Heaviside(x - y)', ['Heaviside', ['Subtract', 'x', 'y']]],
  ];
  const points = [-2, 0, 1, 3].flatMap((x) =>
    [-1, 0, 2].map((y) => ({ x, y }))
  );

  for (const [name, json] of cases) {
    const e = ce.box(json as any);
    const p = expand(ce, json);
    test(`PiecewiseExpand(${name}): .N() agrees with evaluate()`, () => {
      for (const pt of points)
        expect(p.subs(pt).N().re).toBe(e.subs(pt).evaluate().re);
    });
    test(`PiecewiseExpand(${name}): the compiled form agrees with the interpreter`, () => {
      const compiled = compile(p);
      expect(compiled.success).toBe(true);
      const run = compiled.run as (v: Record<string, number>) => number;
      // `+ 0` reads -0 as 0
      for (const pt of points)
        expect(run(pt) + 0).toBe(e.subs(pt).evaluate().re);
    });
  }
});
