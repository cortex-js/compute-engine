import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

/**
 * ROADMAP CE-569: defects of the compiled `When(e, c)`, which selected the
 * value `e` from a condition that was not decided `True`.
 *
 * - JavaScript: the condition was read by its truthiness. A condition that is
 *   `true` for an input the caller did not supply (`undefined !== 0` is
 *   `true`, `!(0 < undefined)` is `true`, `_SYS.heaviside(undefined)` is
 *   `1`) selected the value, and so did a boolean input with a truthy value
 *   that is not a boolean (`c = 1`). The interpreter has no value there. The
 *   condition is now tested for being decided first. Only an ordering
 *   relation between symbols and number literals, or an `And`/`Or` of them,
 *   keeps the plain conditional expression, because its plain code is
 *   falsy when it is undecided. A condition read by its value must be
 *   exactly `true`; a value that is not a boolean no longer raises.
 *   The same holds for each cell of a literal list of conditions.
 * - JavaScript: `c = True` for a boolean `c` was always `false`: the
 *   absence guard of the equality tested `typeof c === 'number'`.
 * - Python: a condition read by its value (a boolean input) was read by its
 *   truthiness, so `c = 1` selected the value. The value is now selected only
 *   for a boolean `True`, as in `If`.
 *
 * The other tests check that the cases the fixes do not change still agree
 * with the interpreter.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
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

describe('CE-569 — javascript: an input that is not supplied', () => {
  it('When(5, x ≠ 0) has no value', () => {
    const ce = engine();
    const f = js(ce, ['When', 5, ['NotEqual', 'x', 0]]);
    expect(f.run!({ x: 1 })).toBe(5);
    expect(f.run!({ x: 0 })).toBeNaN();
    expect(f.run!({})).toBeNaN();
  });

  it('When(5, ¬(x > 0)) has no value', () => {
    const ce = engine();
    const f = js(ce, ['When', 5, ['Not', ['Greater', 'x', 0]]]);
    expect(f.run!({ x: -1 })).toBe(5);
    expect(f.run!({ x: 1 })).toBeNaN();
    expect(f.run!({})).toBeNaN();
  });

  it('When(5, ¬c) has no value', () => {
    const ce = engine();
    const f = js(ce, ['When', 5, ['Not', 'c']]);
    expect(f.run!({ c: false })).toBe(5);
    expect(f.run!({ c: true })).toBeNaN();
    expect(f.run!({})).toBeNaN();
  });

  it('When(x, c) and When(x, c ∧ x > 0) select x only for c = true', () => {
    // The interpreter holds `When(x, 1)` and `When(x, 0)` unevaluated: a
    // condition that is not a boolean gives no value.
    const ce = engine();
    for (const v of [1, 0]) {
      const held = ce.box(['When', 'x', v]).subs({ x: 2 }).N();
      expect(held.operator).toBe('When');
    }
    for (const json of [
      ['When', 'x', 'c'],
      ['When', 'x', ['And', 'c', ['Greater', 'x', 0]]],
    ]) {
      const f = js(ce, json);
      expect(f.run!({ x: 2, c: true })).toBe(2);
      expect(f.run!({ x: 2, c: false })).toBeNaN();
      expect(f.run!({ x: 2, c: 1 })).toBeNaN();
      expect(f.run!({ x: 2, c: 0 })).toBeNaN();
      expect(f.run!({ x: 2 })).toBeNaN();
    }
    expect(js(ce, ['When', 'x', 'c']).code).toBe(
      '((_.c) === true ? (_.x) : NaN)'
    );
  });

  it('When(x, ¬c) selects x only for c = false', () => {
    const ce = engine();
    const f = js(ce, ['When', 'x', ['Not', 'c']]);
    expect(f.run!({ x: 2, c: false })).toBe(2);
    expect(f.run!({ x: 2, c: true })).toBeNaN();
    expect(f.run!({ x: 2, c: 0 })).toBeNaN();
    expect(f.run!({ x: 2, c: 1 })).toBeNaN();
  });

  it('an ordering relation keeps the plain conditional expression', () => {
    const ce = engine();
    const f = js(ce, ['When', ['Power', 'x', 2], ['Greater', 'x', 0]]);
    expect(f.code).toBe('((0 < _.x) ? ((_.x * _.x)) : NaN)');
    expect(f.run!({})).toBeNaN();
  });

  it('an And of ordering relations keeps the plain conditional expression', () => {
    const ce = engine();
    const f = js(ce, [
      'When',
      'x',
      ['And', ['Greater', 'x', 0], ['Less', 'y', 1]],
    ]);
    expect(f.code).toBe('((0 < _.x && _.y < 1) ? (_.x) : NaN)');
    expect(f.run!({ x: 0.5, y: 0 })).toBe(0.5);
    expect(f.run!({ x: 0.5, y: 2 })).toBeNaN();
    expect(f.run!({ y: 0 })).toBeNaN();
  });

  it('a relation over a computed operand tests the input first', () => {
    // `_SYS.heaviside(undefined)` and `_SYS.pow(undefined, 0)` are `1`.
    const ce = engine();
    const h = js(ce, ['When', 5, ['Greater', ['Heaviside', 'x'], 0]]);
    expect(h.run!({ x: 1 })).toBe(5);
    expect(h.run!({ x: -1 })).toBeNaN();
    expect(h.run!({})).toBeNaN();
    const p = js(ce, ['When', 5, ['Greater', ['Power', 'x', 'y'], 0]]);
    expect(p.run!({ x: 2, y: 1 })).toBe(5);
    expect(p.run!({ y: 0 })).toBeNaN();
  });

  it('a condition that is not provably boolean selects nothing, without raising', () => {
    // `b` is undeclared. The interpreter holds `When(5, 1)` unevaluated.
    const ce = engine();
    expect(ce.box(['When', 5, 1]).evaluate().operator).toBe('When');
    const f = js(ce, ['When', 5, 'b']);
    expect(f.run!({ b: true })).toBe(5);
    expect(f.run!({ b: false })).toBeNaN();
    expect(f.run!({ b: 1 })).toBeNaN();
    expect(f.run!({})).toBeNaN();
    // The same answer as `If(b, 5)`.
    const g = js(ce, ['If', 'b', 5]);
    for (const b of [true, false, 1, undefined]) {
      const w = f.run!({ b } as never) as number;
      const i = g.run!({ b } as never) as number;
      if (Number.isNaN(i)) expect(w).toBeNaN();
      else expect(w).toBe(i);
    }
  });

  it('a literal list of conditions tests each cell for being decided', () => {
    const ce = engine();
    const json = [
      'When',
      5,
      ['List', ['NotEqual', 'x', 0], ['Not', ['Greater', 'x', 0]]],
    ];
    const expr = ce.box(json as never);
    const f = js(ce, json);
    // No value in either cell for an `x` that is not supplied: the
    // interpreter keeps both cells as held restrictions.
    const held = Array.from(expr.evaluate().each());
    expect(held.map((cell) => cell.operator)).toEqual(['When', 'When']);
    const none = f.run!({}) as number[];
    expect(none.length).toBe(2);
    expect(none[0]).toBeNaN();
    expect(none[1]).toBeNaN();
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
      ['When', ['Power', 'x', 2], ['Greater', 'x', 0]],
      ['When', 5, ['NotEqual', 'x', 0]],
      ['When', 'x', ['Not', ['Greater', 'x', 0]]],
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

describe('CE-569 — python: a condition read by its value', () => {
  it('When(x, c) selects the value only for a boolean True', () => {
    const ce = engine();
    const r = compile(ce.box(['When', 'x', 'c']), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.code).toBe(
      "((x) if (isinstance(c, (bool, np.bool_)) and c) else float('nan'))"
    );
  });

  it('When(x, ¬c) selects the value only for a boolean False', () => {
    const ce = engine();
    const r = compile(ce.box(['When', 'x', ['Not', 'c']]), {
      to: 'python',
      fallback: false,
    } as never);
    expect(r.code).toBe(
      "((x) if (isinstance(c, (bool, np.bool_)) and not c) else float('nan'))"
    );
  });

  it('a relation keeps the plain conditional expression', () => {
    const ce = engine();
    const r = compile(
      ce.box(['When', ['Power', 'x', 2], ['Greater', 'x', 0]]),
      {
        to: 'python',
        fallback: false,
      } as never
    );
    expect(r.code).toBe("((x ** 2) if (0 < x) else float('nan'))");
  });

  const run = TEST_PYTHON === undefined ? it.skip : it;
  run('the compiled code runs: a value of c that is not a boolean', () => {
    const ce = engine();
    const cases: Array<[unknown, Record<string, string>, string]> = [
      [['When', 'x', 'c'], { x: '2.0', c: 'True' }, '2.0'],
      [['When', 'x', 'c'], { x: '2.0', c: 'False' }, 'nan'],
      [['When', 'x', 'c'], { x: '2.0', c: '1' }, 'nan'],
      [['When', 'x', ['Not', 'c']], { x: '2.0', c: '0' }, 'nan'],
      [
        ['When', 'x', ['And', 'c', ['Greater', 'x', 0]]],
        { x: '2.0', c: '1' },
        'nan',
      ],
      [
        ['When', 'x', ['And', 'c', ['Greater', 'x', 0]]],
        { x: '2.0', c: 'True' },
        '2.0',
      ],
      // A value that is a variable named like the generated parameter.
      [
        ['When', '_CND', ['And', 'c', ['Greater', 'x', 0]]],
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
      "['When', 5, ['Equal', 'c', 'True']]",
      ['When', 5, ['Equal', 'c', 'True']],
    ],
    [
      "['When', 5, ['NotEqual', 'c', 'True']]",
      ['When', 5, ['NotEqual', 'c', 'True']],
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

describe('CE-569 — javascript: an unsupplied boolean or string input', () => {
  // A comparison with an input the caller did not supply is undecided,
  // whatever the type of the input: the interpreter keeps it unevaluated.
  const CASES: Array<[string, unknown, Array<Record<string, unknown>>]> = [
    [
      'If(c = True, 5, -1)',
      ['If', ['Equal', 'c', 'True'], 5, -1],
      [{}, { c: true }, { c: false }],
    ],
    [
      'When(5, c ≠ True)',
      ['When', 5, ['NotEqual', 'c', 'True']],
      [{}, { c: true }, { c: false }],
    ],
    [
      'If(s = "a", 5, -1)',
      ['If', ['Equal', 's', { str: 'a' }], 5, -1],
      [{}, { s: 'a' }, { s: 'b' }],
    ],
    [
      'When(5, s ≠ "a")',
      ['When', 5, ['NotEqual', 's', { str: 'a' }]],
      [{}, { s: 'a' }, { s: 'b' }],
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
  it('When(5, s < t) with one string input missing has no value', () => {
    // An unsupplied `s` would compare as the string 'undefined'.
    const ce = engine();
    ce.declare('s', 'string');
    ce.declare('t', 'string');
    const json = ['When', 5, ['Less', 's', 't']];
    const expr = ce.box(json as never);
    const f = js(ce, json);
    expect(expr.subs({ t: ce.string('z') }).evaluate().operator).toBe('When');
    expect(f.run!({ t: 'z' })).toBeNaN();
    expect(f.run!({ s: 'a', t: 'b' })).toBe(5);
    expect(f.run!({ s: 'b', t: 'a' })).toBeNaN();
  });

  it('an assigned symbol whose value reads an input', () => {
    // `a` compiles to its value, `Heaviside(x)`, which is `1` for an
    // unsupplied `x`.
    const ce = engine();
    ce.assign('a', ce.box(['Heaviside', 'x']));
    const json = ['When', 5, ['Greater', 'a', 0]];
    const f = js(ce, json);
    expect(f.run!({})).toBeNaN();
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
    // With `x` omitted, the condition is undecided and the comparison is
    // not evaluated, so `Random()` does not draw, for `If` and for `When`.
    // With `x` supplied, each draws once.
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
    const w = ['When', 5, ['Less', ['Random'], 'x']];
    const i = ['If', ['Less', ['Random'], 'x'], 5, -1];
    expect(draws(w, {})).toBe(draws(i, {}));
    expect(draws(w, { x: 2 })).toBe(1);
    expect(draws(i, { x: 2 })).toBe(1);
  });
});

describe('CE-569 — the cases the fixes do not change', () => {
  it('a list of conditions restricts element by element', () => {
    const ce = engine();
    const json = ['When', 'x', ['List', ['Greater', 'x', 0], ['Less', 'x', 1]]];
    const f = js(ce, json);
    // Each condition is a value with no value for an unsupplied `x`
    // (`unsuppliedComparisonGuard`), so every cell is masked then.
    expect(f.code).toBe(
      '_SYS.restrict([((0 < _.x) || ((_.x !== undefined) ? false : undefined)), ((_.x < 1) || ((_.x !== undefined) ? false : undefined))], _.x, false, NaN)'
    );
    expect((f.run!({}) as number[]).every((v) => Number.isNaN(v))).toBe(true);
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

  it('a point value: the interpreter gives Missing, javascript undefined', () => {
    const ce = engine();
    const expr = ce.box(['When', ['Tuple', 'x', 'y'], ['Greater', 'x', 0]]);
    expect(expr.subs({ x: 1, y: 2 }).evaluate().toString()).toBe('(1, 2)');
    expect(expr.subs({ x: -1, y: 2 }).evaluate().symbol).toBe('Missing');
    const f = compile(expr, { to: 'javascript', fallback: false });
    expect(f.run!({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(f.run!({ x: -1, y: 2 })).toBeUndefined();
  });

  it('a complex value: the masked value is the complex NaN', () => {
    const ce = engine();
    const f = js(ce, ['When', ['Multiply', 'z', 'x'], ['Greater', 'x', 0]]);
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
      ['When', 'k', ['Greater', 'k', 'x']],
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
