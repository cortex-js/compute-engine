import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

/**
 * ROADMAP CE-569: defects of the compiled `If(c, e)`, which selected the
 * value `e` from a condition that was not decided `True`.
 *
 * - JavaScript: a condition read by its value that is not provably boolean
 *   (`b: boolean | real`) must be exactly `true`; a value that is not a
 *   boolean selects nothing and does not raise.
 * - JavaScript: `c = True` for a boolean `c` was always `false`: the
 *   absence guard of the equality tested `typeof c === 'number'`.
 *
 * The host supplies every input with a value of its declared type, so an
 * input left out, and a value outside the declared type (`c = 1` for a
 * `boolean` `c`), are not tested: the result is not specified.
 *
 * The other tests check that the cases the fixes do not change still agree
 * with the interpreter.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('b', 'boolean | real');
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('c', 'boolean');
  return ce;
}

function js(ce: ComputeEngine, json: unknown) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r;
}

const SAMPLES = [-2, -0.5, 0, 0.25, 1, 3, NaN];

describe('CE-569 — javascript: When over a condition', () => {
  it('When(5, x ≠ 0) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['NotEqual', 'x', 0], 5]);
    expect(f.run!({ x: 1 })).toBe(5);
    expect(f.run!({ x: 0 })).toBeNaN();
  });

  it('When(5, ¬(x > 0)) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', ['Greater', 'x', 0]], 5]);
    expect(f.run!({ x: -1 })).toBe(5);
    expect(f.run!({ x: 1 })).toBeNaN();
  });

  it('When(5, ¬c) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', 'c'], 5]);
    expect(f.run!({ c: false })).toBe(5);
    expect(f.run!({ c: true })).toBeNaN();
  });

  it('When(x, c) and When(x, c ∧ x > 0) select x only for c = true', () => {
    const ce = engine();
    for (const json of [
      ['If', 'c', 'x'],
      ['If', ['And', 'c', ['Greater', 'x', 0]], 'x'],
    ]) {
      const f = js(ce, json);
      expect(f.run!({ x: 2, c: true })).toBe(2);
      expect(f.run!({ x: 2, c: false })).toBeNaN();
    }
    // A `boolean` input is tested by its truthiness.
    expect(js(ce, ['If', 'c', 'x']).code).toBe('((_.c) ? (_.x) : NaN)');
  });

  it('When(x, ¬c) selects x only for c = false', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', 'c'], 'x']);
    expect(f.run!({ x: 2, c: false })).toBe(2);
    expect(f.run!({ x: 2, c: true })).toBeNaN();
  });

  it('an ordering relation keeps the plain conditional expression', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Greater', 'x', 0], ['Power', 'x', 2]]);
    expect(f.code).toBe('((0 < _.x) ? ((_.x * _.x)) : NaN)');
  });

  it('an And of ordering relations keeps the plain conditional expression', () => {
    const ce = engine();
    const f = js(ce, ['If', ['And', ['Greater', 'x', 0], ['Less', 'y', 1]], 'x']);
    expect(f.code).toBe('((0 < _.x && _.y < 1) ? (_.x) : NaN)');
    expect(f.run!({ x: 0.5, y: 0 })).toBe(0.5);
    expect(f.run!({ x: 0.5, y: 2 })).toBeNaN();
  });

  it('a relation over a computed operand', () => {
    const ce = engine();
    const h = js(ce, ['If', ['Greater', ['Heaviside', 'x'], 0], 5]);
    expect(h.run!({ x: 1 })).toBe(5);
    expect(h.run!({ x: -1 })).toBeNaN();
    const p = js(ce, ['If', ['Greater', ['Power', 'x', 'y'], 0], 5]);
    expect(p.run!({ x: 2, y: 1 })).toBe(5);
  });

  it('a condition that is not provably boolean selects nothing, without raising', () => {
    // `b` is declared `boolean | real`, so it is not provably boolean.
    // The interpreter gives an `Error` for `If(1, 5)`: the condition of an
    // `If` must be a boolean.
    const ce = engine();
    expect(ce.box(['If', 1, 5]).evaluate().operator).toBe('Error');
    const f = js(ce, ['If', 'b', 5]);
    expect(f.run!({ b: true })).toBe(5);
    expect(f.run!({ b: false })).toBeNaN();
    expect(f.run!({ b: 1 })).toBeNaN();
    // The same answer as `If(b, 5)`.
    const g = js(ce, ['If', 'b', 5]);
    for (const b of [true, false, 1]) {
      const w = f.run!({ b } as never) as number;
      const i = g.run!({ b } as never) as number;
      if (Number.isNaN(i)) expect(w).toBeNaN();
      else expect(w).toBe(i);
    }
  });

  it('a literal list of conditions agrees with the interpreter in each cell', () => {
    const ce = engine();
    const json = ['If', ['List', ['NotEqual', 'x', 0], ['Not', ['Greater', 'x', 0]]], 5];
    const expr = ce.box(json as never);
    const f = js(ce, json);
    for (const x of SAMPLES) {
      const cells = Array.from(expr.subs({ x }).N().each());
      const actual = f.run!({ x }) as number[];
      expect(actual.length).toBe(cells.length);
      cells.forEach((cell, k) => {
        if (cell.isNaN === true || cell.symbol === 'Missing')
          expect(actual[k]).toBeNaN();
        else expect(actual[k]).toBe(cell.re);
      });
    }
  });

  it('the compiled value agrees with the interpreter', () => {
    const ce = engine();
    for (const json of [
      ['If', ['Greater', 'x', 0], ['Power', 'x', 2]],
      ['If', ['NotEqual', 'x', 0], 5],
      ['If', ['Not', ['Greater', 'x', 0]], 'x'],
    ]) {
      const expr = ce.box(json as never);
      const f = js(ce, json);
      for (const x of SAMPLES) {
        const expected = expr.subs({ x }).N();
        const actual = f.run!({ x }) as number;
        if (expected.isNaN === true) expect(actual).toBeNaN();
        else expect(actual).toBeCloseTo(expected.re, 12);
      }
    }
  });
});

describe('CE-569 — python: a boolean condition', () => {
  it('When(x, c) reads a boolean input by its truthiness', () => {
    const ce = engine();
    const r = compile(ce.box(['If', 'c', 'x']), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.code).toBe(
      "((x) if (c) else (float('nan')))"
    );
  });

  it('When(x, ¬c) reads a boolean input by its truthiness', () => {
    const ce = engine();
    const r = compile(ce.box(['If', ['Not', 'c'], 'x']), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.code).toBe(
      "((x) if (not c) else (float('nan')))"
    );
  });

  it('a relation keeps the plain conditional expression', () => {
    const ce = engine();
    const r = compile(
      ce.box(['If', ['Greater', 'x', 0], ['Power', 'x', 2]]),
      {
        to: 'python',
        fallback: false,
      } as never
    );
    expect(r.code).toBe("((x ** 2) if (0 < x) else (float('nan')))");
  });

  const run = TEST_PYTHON === undefined ? it.skip : it;
  run('the compiled code runs', () => {
    const ce = engine();
    // An input must have a type (`untyped-input` otherwise): the input
    // named like the generated parameter is declared.
    ce.declare('_CND', 'real');
    const cases: Array<[unknown, Record<string, string>, string]> = [
      [['If', 'c', 'x'], { x: '2.0', c: 'True' }, '2.0'],
      [['If', 'c', 'x'], { x: '2.0', c: 'False' }, 'nan'],
      [['If', ['Not', 'c'], 'x'], { x: '2.0', c: 'False' }, '2.0'],
      [
        ['If', ['And', 'c', ['Greater', 'x', 0]], 'x'],
        { x: '2.0', c: 'True' },
        '2.0',
      ],
      // A value that is a variable named like the generated parameter.
      [
        ['If', ['And', 'c', ['Greater', 'x', 0]], '_CND'],
        { _CND: '7', x: '2.0', c: 'True' },
        '7',
      ],
    ];
    for (const [json, inputs, expected] of cases) {
      const code = compile(ce.box(json as never), {
        to: 'python',
        fallback: false,
      } as never).code;
      const assigns = Object.entries(inputs)
        .map(([k, v]) => `${k} = ${v}`)
        .join('\n');
      const out = execFileSync(TEST_PYTHON!, [
        '-c',
        `import math\nimport numpy as np\n${assigns}\nprint(${code})`,
      ])
        .toString()
        .trim();
      expect([JSON.stringify(json), inputs, out]).toEqual([
        JSON.stringify(json),
        inputs,
        expected,
      ]);
    }
  });
});

describe('CE-569 — javascript: an equality over booleans', () => {
  it.each([
    [
      "['If', ['Equal', 'c', 'True'], 5]",
      ['If', ['Equal', 'c', 'True'], 5],
    ],
    [
      "['If', ['NotEqual', 'c', 'True'], 5]",
      ['If', ['NotEqual', 'c', 'True'], 5],
    ],
    [
      "['If', ['Equal', 'c', 'True'], 5, -1]",
      ['If', ['Equal', 'c', 'True'], 5, -1],
    ],
    [
      "['If', ['NotEqual', 'c', 'True'], 5, -1]",
      ['If', ['NotEqual', 'c', 'True'], 5, -1],
    ],
    ["['If', ['Equal', 'c', 'd'], 5, -1]", ['If', ['Equal', 'c', 'd'], 5, -1]],
  ])('%s agrees with the interpreter', (_label, json) => {
    const ce = engine();
    ce.declare('d', 'boolean');
    const expr = ce.box(json as never);
    const f = js(ce, json);
    for (const [c, d] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      const expected = expr
        .subs({ c: c ? ce.True : ce.False, d: d ? ce.True : ce.False })
        .evaluate();
      const actual = f.run!({ c, d }) as number;
      if (expected.isNaN === true) expect([c, d, actual]).toEqual([c, d, NaN]);
      else expect([c, d, actual]).toEqual([c, d, expected.re]);
    }
  });
});

describe('CE-569 — javascript: a comparison of a boolean or string input', () => {
  const CASES: Array<[string, unknown, Array<Record<string, unknown>>]> = [
    [
      'If(c = True, 5, -1)',
      ['If', ['Equal', 'c', 'True'], 5, -1],
      [{ c: true }, { c: false }],
    ],
    [
      'If(c ≠ True, 5)',
      ['If', ['NotEqual', 'c', 'True'], 5],
      [{ c: true }, { c: false }],
    ],
    [
      'If(s = "a", 5, -1)',
      ['If', ['Equal', 's', { str: 'a' }], 5, -1],
      [{ s: 'a' }, { s: 'b' }],
    ],
    [
      'If(s ≠ "a", 5)',
      ['If', ['NotEqual', 's', { str: 'a' }], 5],
      [{ s: 'a' }, { s: 'b' }],
    ],
  ];
  it.each(CASES)('%s agrees with the interpreter', (_label, json, inputs) => {
    const ce = engine();
    ce.declare('s', 'string');
    const expr = ce.box(json as never);
    const f = js(ce, json);
    for (const input of inputs) {
      const sub: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input))
        sub[k] =
          v === true
            ? ce.True
            : v === false
              ? ce.False
              : ce.string(v as string);
      const expected = expr.subs(sub as never).evaluate();
      const actual = f.run!(input as never) as number;
      // No value in the interpreter (a held expression, an error) is NaN.
      const value =
        expected.isNumberLiteral === true && expected.isNaN !== true
          ? expected.re
          : NaN;
      expect([input, actual]).toEqual([input, value]);
    }
  });
});

describe('CE-569 — javascript: an operand that is not a bare numeric read', () => {
  it('When(5, s < t) over two string inputs', () => {
    const ce = engine();
    ce.declare('s', 'string');
    ce.declare('t', 'string');
    const json = ['If', ['Less', 's', 't'], 5];
    const f = js(ce, json);
    expect(f.run!({ s: 'a', t: 'b' })).toBe(5);
    expect(f.run!({ s: 'b', t: 'a' })).toBeNaN();
  });

  it('an assigned symbol whose value reads an input', () => {
    // `a` compiles to its value, `Heaviside(x)`.
    const ce = engine();
    ce.assign('a', ce.box(['Heaviside', 'x']));
    const json = ['If', ['Greater', 'a', 0], 5];
    const f = js(ce, json);
    expect(f.run!({ x: 1 })).toBe(5);
    expect(f.run!({ x: -1 })).toBeNaN();
    // The interpreter, with `x` assigned: 5 for x = 1, NaN for x = -1.
    const expr = ce.box(json as never);
    ce.assign('x', 1);
    expect(expr.evaluate().re).toBe(5);
    ce.assign('x', -1);
    expect(expr.evaluate().isNaN).toBe(true);
  });

  it('a draw in the condition: When counts the draws as If does', () => {
    // Each draws once.
    const ce = engine();
    const draws = (json: unknown, input: Record<string, number>): number => {
      const f = js(ce, json);
      const random = Math.random;
      let n = 0;
      Math.random = () => {
        n += 1;
        return random();
      };
      try {
        f.run!(input);
      } finally {
        Math.random = random;
      }
      return n;
    };
    const w = ['If', ['Less', ['Random'], 'x'], 5];
    const i = ['If', ['Less', ['Random'], 'x'], 5, -1];
    expect(draws(w, { x: 2 })).toBe(1);
    expect(draws(i, { x: 2 })).toBe(1);
  });
});

describe('CE-569 — the cases the fixes do not change', () => {
  it('a list of conditions restricts element by element', () => {
    const ce = engine();
    const json = ['If', ['List', ['Greater', 'x', 0], ['Less', 'x', 1]], 'x'];
    const f = js(ce, json);
    expect(f.code).toBe('_SYS.restrict([0 < _.x, _.x < 1], _.x, false, NaN)');
    for (const x of [-1, 0.5, 2]) {
      const cells = Array.from(
        ce
          .box(json as never)
          .subs({ x })
          .N()
          .each()
      );
      const actual = f.run!({ x }) as number[];
      expect(actual.length).toBe(cells.length);
      cells.forEach((cell, k) => {
        if (cell.isNaN === true || cell.symbol === 'Missing')
          expect(actual[k]).toBeNaN();
        else expect(actual[k]).toBe(cell.re);
      });
    }
  });

  it('a point value: the interpreter and javascript give the NaN point', () => {
    const ce = engine();
    const expr = ce.box(['If', ['Greater', 'x', 0], ['Tuple', 'x', 'y']]);
    expect(expr.subs({ x: 1, y: 2 }).evaluate().toString()).toBe('(1, 2)');
    expect(expr.subs({ x: -1, y: 2 }).evaluate().toString()).toBe(
      '(NaN, NaN)'
    );
    const f = compile(expr, { to: 'javascript', fallback: false });
    expect(f.run!({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(f.run!({ x: -1, y: 2 })).toEqual([NaN, NaN]);
  });

  it('a complex value: the masked value is the complex NaN', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Greater', 'x', 0], ['Multiply', 'z', 'x']]);
    const masked = f.run!({ x: -1, z: { re: 1, im: 2 } }) as {
      re: number;
      im: number;
    };
    expect(masked.re).toBeNaN();
    expect(masked.im).toBeNaN();
    const kept = f.run!({ x: 2, z: { re: 1, im: 2 } }) as {
      re: number;
      im: number;
    };
    expect(kept).toEqual({ re: 2, im: 4 });
  });

  it('a Sum of When agrees with the interpreter', () => {
    const ce = engine();
    const expr = ce.box([
      'Sum',
      ['If', ['Greater', 'k', 'x'], 'k'],
      ['Limits', 'k', 1, 5],
    ]);
    const f = compile(expr, { to: 'javascript', fallback: false });
    for (const x of [-1, 0.5, 3]) {
      const expected = expr.subs({ x }).N();
      const actual = f.run!({ x }) as number;
      if (expected.isNaN === true) expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected.re, 12);
    }
  });
});
