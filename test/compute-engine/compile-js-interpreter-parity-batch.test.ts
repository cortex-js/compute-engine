/**
 * Compiled JavaScript against the interpreter, for operands whose type does
 * not give their shape: a top-typed element (`missing | unknown`), a
 * possibly-point operand, a list exponent, an absent cell on the complex
 * lane, and a root whose degree is known only at run time.
 *
 * Each test compiles an expression BEFORE its symbol is assigned (compiled
 * code reads an assigned symbol as its value), then compares the compiled
 * run with `.evaluate()` for several values of the symbol, or checks that
 * the compilation declines.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** The MathJSON spelling of a JavaScript value: an array is a `List`, and
 * `undefined` is `Missing`. */
function toMathJson(v: unknown): unknown {
  if (Array.isArray(v)) return ['List', ...v.map(toMathJson)];
  if (v === undefined) return 'Missing';
  return v;
}

/** A compiled value as a number or a list of numbers: `NaN` stays `NaN`,
 * a complex `{re, im}` is spelled `re+im i`. */
function spell(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(spell);
  if (typeof v === 'object' && v !== null && 're' in v && 'im' in v) {
    const z = v as { re: number; im: number };
    return `${z.re}+${z.im}i`;
  }
  return v;
}

/** An interpreted value spelled as `spell` spells a compiled one. */
function spellInterpreted(e: Expression): unknown {
  if (e.operator === 'List') return e.ops!.map(spellInterpreted);
  if (e.isNaN === true) return NaN;
  const re = e.re;
  const im = e.im;
  if (typeof im === 'number' && im !== 0) return `${re}+${im}i`;
  return re;
}

/** For each value of `symbol`: the interpreted value and the compiled value,
 * or `'declined'` when the expression does not compile. */
function parity(
  ce: ComputeEngine,
  expr: Expression,
  symbol: string,
  values: ReadonlyArray<unknown>
): Array<[unknown, unknown]> | 'declined' {
  let run: (vars: Record<string, unknown>) => unknown;
  try {
    const result = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never) as unknown as {
      run: (vars: Record<string, unknown>) => unknown;
    };
    run = result.run;
  } catch {
    return 'declined';
  }
  return values.map((v) => {
    ce.assign(symbol, ce.box(toMathJson(v) as never));
    return [spellInterpreted(expr.evaluate().N()), spell(run({ [symbol]: v }))];
  });
}

/** `compiled` and `interpreted` agree: the same shape, numbers within
 * `1e-12`, and `NaN` where the other is `NaN`. */
function expectSame(compiled: unknown, interpreted: unknown): void {
  if (Array.isArray(interpreted) && Array.isArray(compiled)) {
    expect(compiled.length).toBe(interpreted.length);
    interpreted.forEach((x, i) => expectSame(compiled[i], x));
  } else if (typeof interpreted === 'number' && Number.isNaN(interpreted))
    expect(compiled).toBeNaN();
  else if (typeof interpreted === 'number' && typeof compiled === 'number')
    expect(compiled).toBeCloseTo(interpreted, 12);
  else expect(compiled).toEqual(interpreted);
}

function expectParity(rows: Array<[unknown, unknown]> | 'declined'): void {
  expect(rows).not.toBe('declined');
  for (const [interpreted, compiled] of rows as Array<[unknown, unknown]>)
    expectSame(compiled, interpreted);
}

/** `g := t ↦ [t, 2t]`, `h := (t: number) ↦ [t, 2t]` and `x: any`. */
function engineWithG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', 'function');
  ce.assign('g', ce.parse('t \\mapsto [t, 2t]'));
  ce.declare('h', 'function');
  ce.assign('h', ce.parse('(t: number) \\mapsto [t, 2t]'));
  ce.declare('x', 'any');
  return ce;
}

const X_VALUES = [
  3,
  [1, 2],
  [
    [1, 2],
    [3, 4],
  ],
  [[1, 2], [3]],
];

describe('CE-370: Max and Min flatten every level of an element that may be a list', () => {
  test.each([
    ['Max', 'g'],
    ['Min', 'g'],
    ['Max', 'h'],
    ['Min', 'h'],
  ])('%s(%s(x)[1], 1)', (head, f) => {
    const ce = engineWithG();
    const expr = ce.box([head, ['At', [f, 'x'], 1], 1] as never);
    expectParity(parity(ce, expr, 'x', X_VALUES));
  });

  test.each([['Max'], ['Min']])('%s(g(x)[1]) with one operand', (head) => {
    const ce = engineWithG();
    const expr = ce.box([head, ['At', ['g', 'x'], 1]] as never);
    expectParity(parity(ce, expr, 'x', X_VALUES));
  });

  test('an absent element gives NaN on both routes', () => {
    const ce = engineWithG();
    const expr = ce.box(['Max', ['At', ['g', 'x'], 1], 1] as never);
    const rows = parity(ce, expr, 'x', [[]]);
    expect(rows).toEqual([[NaN, NaN]]);
  });
});

describe('CE-221: the sum of a point and a number declines', () => {
  test('At(P, 1) + 1 with P: broadcastable<tuple<number, number>>', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    const expr = ce.box(['Add', ['At', 'P', 1], 1] as never);
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false } as never)
    ).toThrow(/may be a point/);
    // The interpreter answers an error for a list of points.
    ce.assign('P', ce.box(['List', ['Tuple', 3, 4], ['Tuple', 6, 8]] as never));
    expect(expr.evaluate().toString()).toContain('incompatible-type');
  });

  test.each([
    ['Add', 'P', 1],
    ['Subtract', 'P', 1],
    ['Add', 2, 'P'],
  ])('%s(%s, %s) with P: broadcastable<tuple<number, number>>', (h, a, b) => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    const expr = ce.box([h, a, b] as never);
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false } as never)
    ).toThrow(/may be a point/);
  });

  test('the product of a point and a number still compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    const expr = ce.box(['Multiply', 'P', 2] as never);
    const run = compile(expr, { to: 'javascript', fallback: false } as never)
      .run as (v: unknown) => unknown;
    expect(run({ P: [3, 4] })).toEqual([6, 8]);
    ce.assign('P', ce.box(['Tuple', 3, 4] as never));
    expect(expr.evaluate().toString()).toBe('(6, 8)');
  });

  test('the sum of two points still compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'broadcastable<tuple<number, number>>');
    const expr = ce.box(['Add', 'P', 'P'] as never);
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false } as never)
    ).not.toThrow();
  });
});

describe('CE-215.1: a list exponent with a fractional cell takes the complex lane', () => {
  test('p^[2, 0.5] with p: tensor<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const expr = ce.box(['Power', 'p', ['List', 2, 0.5]] as never);
    expectParity(
      parity(ce, expr, 'p', [
        [
          [1, 2],
          [3, -4],
        ],
        [-1, -4],
      ])
    );
  });

  test('p^[1/3, 0.5] with p: list<number> keeps the real root of an odd denominator', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const expr = ce.box([
      'Power',
      'p',
      ['List', ['Rational', 1, 3], 0.5],
    ] as never);
    expectParity(parity(ce, expr, 'p', [[-8, -4]]));
  });

  test('p^[2, 0.5] with p: real fans out on the complex lane', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    const expr = ce.box(['Power', 'p', ['List', 2, 0.5]] as never);
    expectParity(parity(ce, expr, 'p', [-4, 4]));
  });

  test('an integer list exponent stays on the real lane', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const expr = ce.box(['Power', 'p', ['List', 2, 3]] as never);
    const code = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).code;
    expect(code).not.toContain('cpow');
    expectParity(parity(ce, expr, 'p', [[-8, -4]]));
  });
});

describe('CE-214.5: a complex kernel of NaN is NaN', () => {
  test('Sqrt(Sum(p)) with an absent cell', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number | missing>');
    const expr = ce.box(['Sqrt', ['Sum', 'p']] as never);
    expectParity(
      parity(ce, expr, 'p', [
        [undefined, 1],
        [-4, 1],
        [3, 1],
      ])
    );
  });

  test('Sqrt(Sum(p)) with an absent cell beside a row', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number | list<number> | missing>');
    const expr = ce.box(['Sqrt', ['Sum', 'p']] as never);
    expectParity(parity(ce, expr, 'p', [[undefined, [1, 2]]]));
  });
});

describe('a root whose degree is known only at run time', () => {
  test('Root(p, 3) and Root(p, 2.2) over a list p', () => {
    for (const degree of [3, 2.2, 5]) {
      const ce = new ComputeEngine();
      ce.declare('p', 'list<number>');
      const expr = ce.box(['Root', 'p', degree] as never);
      expectParity(parity(ce, expr, 'p', [[-8, -32, 27]]));
    }
  });

  test('Root(p, n) with a variable degree', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.declare('n', 'real');
    const expr = ce.box(['Root', 'p', 'n'] as never);
    const run = compile(expr, { to: 'javascript', fallback: false } as never)
      .run as (v: unknown) => unknown;
    for (const [p, n] of [
      [-8, 3],
      [-32, 5],
      [-8, 2.2],
      [16, 4],
    ]) {
      ce.assign('p', p);
      ce.assign('n', n);
      expect(run({ p, n }) as number).toBeCloseTo(expr.evaluate().N().re, 12);
    }
  });
});
