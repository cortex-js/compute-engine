import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import type { RoundingTies } from '../../src/compute-engine/global-types';

/**
 * The engine setting `ce.roundingTies` selects the rule that `Round` uses for
 * a value exactly halfway between two integers (a tie). The default rounds a
 * tie away from zero. The rule applies to every lane of the evaluation (an
 * exact rational, a machine float, a big decimal, a list of machine numbers,
 * an exact constant at a jump under `.N()`), to the sign of `Round`, and to
 * the code that `compile()` makes for each target.
 *
 * Requested in cortex-js/compute-engine#417.
 *
 * The engine is built inside each test, because the precision of the
 * big-number library is module-global: an engine built at one precision
 * changes the precision of an engine built before it.
 */

const RULES: RoundingTies[] = [
  'away-from-zero',
  'to-even',
  'toward-zero',
  'toward-positive-infinity',
  'toward-negative-infinity',
];

/** The ties, and the value of `Round` of each one under each rule. */
const TIES = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];
const EXPECTED: Record<RoundingTies, number[]> = {
  'away-from-zero': [-3, -2, -1, 1, 2, 3, 4],
  'to-even': [-2, -2, 0, 0, 2, 2, 4],
  'toward-zero': [-2, -1, 0, 0, 1, 2, 3],
  'toward-positive-infinity': [-2, -1, 0, 1, 2, 3, 4],
  'toward-negative-infinity': [-3, -2, -1, 0, 1, 2, 3],
};

/** Values that are not ties, near a tie and at large magnitudes: every rule
 * rounds them to the nearest integer. `2^52 + 1` is an odd integer that
 * `floor(x + 0.5)` gets wrong (the sum is rounded), and
 * `0.49999999999999994` is the largest double below one half. */
const NOT_TIES = [
  2.4,
  2.6,
  -2.4,
  -2.6,
  0.49999999999999994,
  -0.49999999999999994,
  2 ** 52 + 1,
  -(2 ** 52 + 1),
  7,
  0,
];

function engine(ties: RoundingTies, precision?: number): ComputeEngine {
  const ce = new ComputeEngine();
  if (precision !== undefined) ce.precision = precision;
  ce.roundingTies = ties;
  return ce;
}

/** `+ 0` turns a negative zero into zero. */
const re = (x: { re: number }): number => x.re + 0;

describe('the roundingTies setting', () => {
  test('the default rounds a tie away from zero', () => {
    const ce = new ComputeEngine();
    expect(ce.roundingTies).toBe('away-from-zero');
    expect(re(ce.box(['Round', 2.5]).evaluate())).toBe(3);
  });

  test('an unknown rule is an error, and the rule does not change', () => {
    const ce = new ComputeEngine();
    expect(() => {
      ce.roundingTies = 'half-even' as RoundingTies;
    }).toThrow(/Expected one of/);
    expect(ce.roundingTies).toBe('away-from-zero');
  });

  test('a change of the rule discards the cached values', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Round', ['Rational', 5, 2]]);
    expect(re(expr.evaluate())).toBe(3);
    ce.roundingTies = 'to-even';
    expect(re(expr.evaluate())).toBe(2);
    // The sign of the same expression is computed again with the new rule.
    const half = ce.box(['Round', ['Rational', 1, 2]]);
    ce.roundingTies = 'away-from-zero';
    expect(half.sgn).toBe('positive');
    ce.roundingTies = 'to-even';
    expect(half.sgn).toBe('zero');
  });

  test('a checkpoint restores the rule', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.roundingTies = 'to-even';
    ce.restore(cp);
    expect(ce.roundingTies).toBe('away-from-zero');
  });
});

describe.each(RULES)('Round with the tie rule %s', (rule) => {
  test('a machine float', () => {
    const ce = engine(rule);
    expect(TIES.map((x) => re(ce.box(['Round', x]).evaluate()))).toEqual(
      EXPECTED[rule]
    );
    for (const x of NOT_TIES)
      expect([x, re(ce.box(['Round', x]).evaluate())]).toEqual([
        x,
        Math.round(x) + 0,
      ]);
  });

  test('an exact rational', () => {
    const ce = engine(rule);
    expect(
      TIES.map((x) => re(ce.box(['Round', ['Rational', 2 * x, 2]]).evaluate()))
    ).toEqual(EXPECTED[rule]);
  });

  test('a big decimal', () => {
    const ce = engine(rule, 50);
    expect(
      TIES.map((x) => re(ce.box(['Round', ce.number(String(x))]).N()))
    ).toEqual(EXPECTED[rule]);
    // One part in 10⁴⁰ above a tie is not a tie.
    expect(
      re(
        ce
          .box([
            'Round',
            ce.number('2.5000000000000000000000000000000000000001'),
          ])
          .N()
      )
    ).toBe(3);
  });

  test('a list of machine numbers (more than 100, the eager kernel)', () => {
    const ce = engine(rule);
    const values = Array.from({ length: 150 }, (_, i) => TIES[i % TIES.length]);
    const result = ce.box(['Round', ['List', ...values]]).evaluate();
    expect([...result.each()].map(re)).toEqual(
      values.map((_, i) => EXPECTED[rule][i % TIES.length])
    );
  });

  test('the step form rounds the tie of the quotient', () => {
    const ce = engine(rule);
    // −0.125/(1/100) is −12.5 and 0.375/(1/100) is 37.5.
    const step = ['Rational', 1, 100];
    const neg = ce.box(['Round', ['Rational', -1, 8], step]).evaluate();
    const pos = ce.box(['Round', ['Rational', 3, 8], step]).evaluate();
    const want = {
      'away-from-zero': ['-13/100', '19/50'],
      'to-even': ['-3/25', '19/50'],
      'toward-zero': ['-3/25', '37/100'],
      'toward-positive-infinity': ['-3/25', '19/50'],
      'toward-negative-infinity': ['-13/100', '37/100'],
    }[rule];
    expect([neg.toString(), pos.toString()]).toEqual(want);
  });

  test('an exact constant at a tie, under N', () => {
    // `(√2 + √3)² − 2√6 − 1/2` is exactly `9/2`, but no evaluation folds it.
    // Under `.N()` its enclosure stays at the jump, and it is taken to be
    // AT the jump: the tie rule decides.
    const ce = engine(rule);
    const x = ce.parse(
      '\\operatorname{Round}((\\sqrt2+\\sqrt3)^2-2\\sqrt6-\\frac12)'
    );
    const want = {
      'away-from-zero': 5,
      'to-even': 4,
      'toward-zero': 4,
      'toward-positive-infinity': 5,
      'toward-negative-infinity': 4,
    }[rule];
    expect(re(x.N())).toBe(want);
  });

  test('the sign of Round of a big decimal just above a tie', () => {
    // The double of this value is 0.5, a tie; its big decimal is not one.
    const ce = engine(rule, 50);
    const x = ce.number('0.50000000000000000001');
    expect(ce.box(['Round', x]).sgn).toBe('positive');
    expect(re(ce.box(['Round', x]).N())).toBe(1);
  });

  test('the sign of Round of a symbol at least one half', () => {
    const ce = engine(rule);
    ce.assume(ce.parse('x \\ge \\frac12'));
    const tieGoesUp =
      rule === 'away-from-zero' || rule === 'toward-positive-infinity';
    expect(ce.box(['Round', 'x']).sgn).toBe(
      tieGoesUp ? 'positive' : 'non-negative'
    );
  });

  test('compiled JavaScript matches the interpreter', () => {
    const ce = engine(rule);
    const f = compile(ce.box(['Round', 'x']), { fallback: false });
    for (const x of [...TIES, ...NOT_TIES])
      expect([x, f.run!({ x }) + 0]).toEqual([
        x,
        re(ce.box(['Round', x]).evaluate()),
      ]);
    // A step of 0.1: the quotients `−2.5`, `2.5`, … are ties in the
    // interpreter's decimal division, and the compiled code finds them too.
    // The multiple `k·0.1` is a float product (`3·0.1` is
    // `0.30000000000000004`), so the values are compared to 12 digits.
    const g = compile(ce.box(['Round', 'x', 0.1]), { fallback: false });
    for (const x of [-0.25, 0.25, 0.75, -0.75, 1.05])
      expect(g.run!({ x })).toBeCloseTo(re(ce.box(['Round', x, 0.1]).N()), 12);
  });

  test('compiled interval JavaScript matches the interpreter at a point', () => {
    const ce = engine(rule);
    const f = compile(ce.box(['Round', 'x']), { to: 'interval-js' });
    for (const x of [...TIES, ...NOT_TIES]) {
      const r = f.run!({ x: { lo: x, hi: x } }) as {
        kind: string;
        value: { lo: number; hi: number };
      };
      const want = re(ce.box(['Round', x]).evaluate());
      expect([x, r.kind, r.value.lo + 0, r.value.hi + 0]).toEqual([
        x,
        'interval',
        want,
        want,
      ]);
    }
  });
});

describe('a compiled function keeps the rule of its compilation', () => {
  test('JavaScript', () => {
    const ce = engine('away-from-zero');
    const before = compile(ce.box(['Round', 'x']), { fallback: false });
    ce.roundingTies = 'to-even';
    const after = compile(ce.box(['Round', 'x']), { fallback: false });
    expect(before.run!({ x: 2.5 })).toBe(3);
    expect(after.run!({ x: 2.5 })).toBe(2);
    expect(after.code).toContain('_SYS.roundToEven(');
  });

  test('an automatically compiled Map is compiled again', () => {
    const ce = engine('away-from-zero');
    ce.precision = 'machine';
    ce.assign(
      'halfRound',
      ce.box(['Function', ['Round', ['Divide', 'x', 2]], 'x'])
    );
    // More than 100 elements: a lazy `Map`, whose element function is
    // compiled when it is drained.
    const m = ce.box(['halfRound', ['Range', 1, 120]]).evaluate();
    const drain = () => [...m.N().each()].slice(0, 6).map(re);
    expect(drain()).toEqual([1, 1, 2, 2, 3, 3]);
    ce.roundingTies = 'to-even';
    _resetMapAutoCompileStats();
    expect(drain()).toEqual([0, 1, 2, 2, 2, 3]);
    // The new values come from a new compiled function, not from the
    // interpreter.
    expect(stats.attempts).toBe(1);
    expect(stats.compiledHits).toBeGreaterThan(0);
  });
});

describe('an interval that contains a tie', () => {
  test('to-even: the jump at 0.5 is continuous from the left, at 1.5 from the right', () => {
    const ce = engine('to-even');
    const f = compile(ce.box(['Round', 'x']), { to: 'interval-js' });
    expect(f.run!({ x: { lo: 0.2, hi: 0.8 } })).toMatchObject({
      kind: 'singular',
      at: 0.5,
      continuity: 'left',
      value: { lo: 0, hi: 1 },
    });
    expect(f.run!({ x: { lo: 1.2, hi: 1.8 } })).toMatchObject({
      kind: 'singular',
      at: 1.5,
      continuity: 'right',
      value: { lo: 1, hi: 2 },
    });
  });

  test('the rule is the second argument of _IA.round, left out for the default', () => {
    const ce = engine('away-from-zero');
    expect(compile(ce.box(['Round', 'x']), { to: 'interval-js' }).code).toBe(
      '_IA.round(_.x)'
    );
    ce.roundingTies = 'toward-zero';
    expect(compile(ce.box(['Round', 'x']), { to: 'interval-js' }).code).toBe(
      '_IA.round(_.x, "toward-zero")'
    );
  });
});

describe('the shader code of each rule', () => {
  const glsl = new GLSLTarget();
  const wgsl = new WGSLTarget();
  const code: Record<RoundingTies, [string, string]> = {
    'away-from-zero': ['_gpu_round(x)', '_gpu_round(x)'],
    'to-even': ['roundEven(x)', 'round(x)'],
    'toward-zero': ['_gpu_round_tz(x)', '_gpu_round_tz(x)'],
    'toward-positive-infinity': ['_gpu_round_up(x)', '_gpu_round_up(x)'],
    'toward-negative-infinity': ['_gpu_round_down(x)', '_gpu_round_down(x)'],
  };

  test.each(RULES)('%s', (rule) => {
    const ce = engine(rule);
    const g = glsl.compile(ce.box(['Round', 'x']), {});
    const w = wgsl.compile(ce.box(['Round', 'x']), {});
    expect([g.code, w.code]).toEqual(code[rule]);
    // The preamble holds only the helper that the code calls.
    const helper = /_gpu_round\w*/.exec(code[rule][0])?.[0];
    const declared = (p: string | undefined) =>
      [...(p ?? '').matchAll(/(?:float|fn) (_gpu_round\w*)\(/g)].map(
        (m) => m[1]
      );
    expect(declared(g.preamble)).toEqual(helper ? [helper] : []);
    expect(declared(w.preamble)).toEqual(helper ? [helper] : []);
  });

  test('an infix vector operand is put in parentheses', () => {
    const ce = engine('toward-negative-infinity');
    ce.declare('v', 'vector<3>');
    ce.declare('w', 'vector<3>');
    expect(glsl.compile(ce.box(['Round', ['Add', 'v', 'w']]), {}).code).toBe(
      '(ceil(v + w) - ceil(0.5 + 0.5 * sign(ceil(v + w) - (v + w) - 0.5)))'
    );
  });

  test('a vector operand', () => {
    const ce = engine('toward-positive-infinity');
    ce.declare('v', 'vector<3>');
    expect(glsl.compile(ce.box(['Round', 'v']), {}).code).toBe(
      '(floor(v) + ceil(0.5 + 0.5 * sign(v - floor(v) - 0.5)))'
    );
    ce.roundingTies = 'to-even';
    expect(wgsl.compile(ce.box(['Round', 'v']), {}).code).toBe('round(v)');
  });
});

describe('the Python code of each rule', () => {
  const python = new PythonTarget();
  const lastLine = (code: string) => code.split('\n').at(-1);

  test.each(RULES)('%s', (rule) => {
    const ce = engine(rule);
    const code = python.compile(ce.box(['Round', 'x'])).code;
    if (rule === 'to-even') expect(code).toBe('np.round(x)');
    else {
      expect(code).toContain('def _ce_round(');
      expect(lastLine(code)).toBe(`_ce_round(x, '${rule}')`);
    }
  });
});

describe('a Python lambda writes the rounding inline', () => {
  // A bare lambda has no place for the `_ce_round` helper.
  const python = new PythonTarget();

  test.each(RULES)('%s', (rule) => {
    const ce = engine(rule);
    const code = python.compileLambda(ce.box(['Round', 'x']), ['x']);
    expect(code).not.toContain('_ce_round(');
    expect(code.startsWith('lambda x: ')).toBe(true);
  });

  test('Remainder', () => {
    const ce = engine('away-from-zero');
    const code = python.compileLambda(ce.box(['Remainder', 'x', 2]), ['x']);
    // The lambda has no helper definitions, so the rounding and the
    // safe-integer-range check of each `Remainder` operand are both inline.
    expect(code.startsWith('lambda x: ')).toBe(true);
    expect(code).not.toContain('_ce_round(');
    expect(code).toContain(
      '(lambda _x: (lambda _a: (lambda _m: ' +
        'np.sign(_x) * (_m + np.logical_or(_a - _m > 0.5, ' +
        'np.logical_and(_a - _m == 0.5, np.greater(_x, 0)))))' +
        '(np.floor(_a)))(np.abs(_x)))('
    );
    expect(code).toContain('is beyond the safe integer range of compiled code');
  });
});

describe('Remainder does not use the tie rule of Round', () => {
  // `Remainder(a, b)` is `a − b·round(a/b)`, with the quotient rounded as
  // JavaScript `Math.round` does: a tie goes toward +∞. So
  // `Remainder(5, 2)` is `5 − 2·3 = −1` and `Remainder(−5, 2)` is
  // `−5 − 2·(−2) = −1`.
  test.each(RULES)('the interpreter, with the rule %s', (rule) => {
    const ce = engine(rule);
    expect(re(ce.box(['Remainder', 5, 2]).evaluate())).toBe(-1);
    expect(re(ce.box(['Remainder', -5, 2]).evaluate())).toBe(-1);
  });

  test('the interval target agrees with the interpreter at a tie', () => {
    // The interval `remainder` rounded the quotient away from zero, and
    // `Remainder(−5, 2)` was `1`.
    const ce = engine('away-from-zero');
    const f = compile(ce.box(['Remainder', 'x', 2]), { to: 'interval-js' });
    for (const x of [-5, 5, -3, 3, -1, 1])
      expect([x, f.run!({ x: { lo: x, hi: x } })]).toEqual([
        x,
        { kind: 'interval', value: { lo: -1, hi: -1 } },
      ]);
  });

  test('the shader and Python code round the quotient toward +∞', () => {
    // `round()` (shader) and `np.round` (Python) round a tie to even, and
    // `Remainder(5, 2)` was `1`.
    const ce = engine('to-even');
    const remainder = ce.box(['Remainder', 'x', 2]);
    expect(new GLSLTarget().compile(remainder, {}).code).toBe(
      '((x) - (2.0) * _gpu_round_up((x) / (2.0)))'
    );
    // The Python `_ce_remainder` helper checks the safe integer range of
    // each operand and rounds the quotient with a tie toward +∞, whatever
    // the tie rule of the engine.
    const python = new PythonTarget().compile(remainder).code;
    expect(python.split('\n').at(-1)).toBe('_ce_remainder(x, 2)');
    expect(python).toContain('np.logical_and(_d == 0.5, np.greater(_q, 0))');
  });
});
