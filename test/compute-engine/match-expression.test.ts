import { engine as ce } from '../utils';

import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 1 of the Cortex `match` design
 * (docs/plans/2026-07-12-cortex-match-design.md §6 item 1): the engine-level
 * `Match`/`MatchCase`/`Pin`/`Alternatives` heads with tier-3 reference
 * semantics via the generic matcher. Selection logic lives in
 * `src/compute-engine/boxed-expression/match-dispatch.ts`.
 *
 * These tests exercise the MathJSON heads directly (the Cortex surface syntax
 * is Phase 3).
 */

/** Evaluate a `Match` MathJSON expression and return the string form. */
function m(expr: MathJsonExpression): string {
  return ce.box(expr).evaluate().toString();
}

const zeroOrOther = (subj: MathJsonExpression): MathJsonExpression => [
  'Match',
  subj,
  ['MatchCase', 0, { str: 'zero' }],
  ['MatchCase', '_', { str: 'other' }],
];

describe('MATCH — literal cases and fallback', () => {
  it('selects a matching literal case', () => {
    expect(m(zeroOrOther(0))).toBe('"zero"');
  });

  it('falls back to the anonymous wildcard `_`', () => {
    expect(m(zeroOrOther(5))).toBe('"other"');
  });

  it('first-match-wins with overlapping patterns (literal before `_`)', () => {
    expect(
      m([
        'Match',
        1,
        ['MatchCase', 1, { str: 'one' }],
        ['MatchCase', '_', { str: 'other' }],
      ])
    ).toBe('"one"');
  });

  it('first-match-wins: an earlier irrefutable case shadows later cases', () => {
    expect(
      m([
        'Match',
        1,
        ['MatchCase', '_', { str: 'first' }],
        ['MatchCase', 1, { str: 'second' }],
      ])
    ).toBe('"first"');
  });
});

describe('MATCH — structural totality', () => {
  it('a symbolic subject that is not structurally 0 picks `_`', () => {
    // `x` *could* be 0 semantically, but structurally it is not — match always
    // decides (unlike `Which`, which would stay inert).
    expect(m(zeroOrOther('x'))).toBe('"other"');
  });
});

describe('MATCH — bindings', () => {
  it('binds a single wildcard `_n` and uses `n` in the body', () => {
    expect(m(['Match', 7, ['MatchCase', '_n', ['Multiply', 2, 'n']]])).toBe(
      '14'
    );
  });

  it('captures list elements via [_a, _b]', () => {
    expect(
      m([
        'Match',
        ['List', 3, 4],
        ['MatchCase', ['List', '_a', '_b'], ['Add', 'a', 'b']],
      ])
    ).toBe('7');
  });

  it('captures a sequence rest via ___rest (head bound separately)', () => {
    expect(
      m([
        'Match',
        ['List', 1, 2, 3],
        ['MatchCase', ['List', '_a', '___rest'], 'a'],
      ])
    ).toBe('1');
  });
});

describe('MATCH — constant-name shadowing', () => {
  it('a body binding `e` uses the bound value, not ExponentialE', () => {
    expect(m(['Match', 5, ['MatchCase', '_e', ['Multiply', 2, 'e']]])).toBe(
      '10'
    );
  });

  it('a body binding `i` uses the bound value, not the imaginary unit', () => {
    expect(m(['Match', 5, ['MatchCase', '_i', ['Add', 'i', 1]]])).toBe('6');
  });
});

describe('MATCH — non-linear patterns', () => {
  const eqOrDiff = (subj: MathJsonExpression): MathJsonExpression => [
    'Match',
    subj,
    ['MatchCase', ['List', '_a', '_a'], { str: 'equal' }],
    ['MatchCase', '_', { str: 'diff' }],
  ];

  it('[_a, _a] matches (1, 1)', () => {
    expect(m(eqOrDiff(['List', 1, 1]))).toBe('"equal"');
  });

  it('[_a, _a] does not match (1, 2)', () => {
    expect(m(eqOrDiff(['List', 1, 2]))).toBe('"diff"');
  });
});

describe('MATCH — pins', () => {
  it('a plain constant symbol `Pi` matches the constant, not a variable', () => {
    const pat: MathJsonExpression = [
      'Match',
      'Pi',
      ['MatchCase', 'Pi', { str: 'is-pi' }],
      ['MatchCase', '_', { str: 'no' }],
    ];
    expect(m(pat)).toBe('"is-pi"');
  });

  it('a plain constant symbol `Pi` does not match a different symbol', () => {
    const pat: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', 'Pi', { str: 'is-pi' }],
      ['MatchCase', '_', { str: 'no' }],
    ];
    expect(m(pat)).toBe('"no"');
  });

  it('Pin(expr) matches the value of a computed expression', () => {
    const pat = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', ['Pin', ['Add', 2, 4]], { str: 'hit' }],
      ['MatchCase', '_', { str: 'miss' }],
    ];
    expect(m(pat(6))).toBe('"hit"');
    expect(m(pat(7))).toBe('"miss"');
  });

  it('Pin(symbol) matches the assigned value of a runtime variable', () => {
    ce.assign('matchPinVar', 42);
    const pat = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', ['Pin', 'matchPinVar'], { str: 'hit' }],
      ['MatchCase', '_', { str: 'miss' }],
    ];
    expect(m(pat(42))).toBe('"hit"');
    expect(m(pat(7))).toBe('"miss"');
  });
});

describe('MATCH — alternatives', () => {
  const smallOrBig = (subj: MathJsonExpression): MathJsonExpression => [
    'Match',
    subj,
    ['MatchCase', ['Alternatives', 1, 2, 3], { str: 'small' }],
    ['MatchCase', '_', { str: 'big' }],
  ];

  it('a shared body matches any alternative', () => {
    expect(m(smallOrBig(2))).toBe('"small"');
    expect(m(smallOrBig(3))).toBe('"small"');
  });

  it('falls through when no alternative matches', () => {
    expect(m(smallOrBig(9))).toBe('"big"');
  });

  it('applies the guard after an alternative matches', () => {
    const pat = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      [
        'MatchCase',
        ['Alternatives', 2, 4, 6],
        ['Greater', 'matchGuardK', 0],
        { str: 'even-pos' },
      ],
      ['MatchCase', '_', { str: 'no' }],
    ];
    ce.assign('matchGuardK', 1);
    expect(m(pat(4))).toBe('"even-pos"');
    ce.assign('matchGuardK', -1);
    expect(m(pat(4))).toBe('"no"');
  });

  it('a named wildcard inside an alternative is an error value', () => {
    const err = ce
      .box(['Match', 2, ['MatchCase', ['Alternatives', '_x', 2], { str: 'x' }]])
      .evaluate();
    expect(err.operator).toBe('Error');
    expect(err.op1?.string).toBe('match-alternative-binding');
  });

  it('anonymous wildcards inside an alternative are allowed', () => {
    expect(
      m([
        'Match',
        ['List', 0, 9],
        [
          'MatchCase',
          ['Alternatives', ['List', 0, '_'], ['List', '_', 0]],
          { str: 'has-zero-edge' },
        ],
        ['MatchCase', '_', { str: 'no' }],
      ])
    ).toBe('"has-zero-edge"');
  });
});

describe('MATCH — guards', () => {
  const posOrOther = (subj: MathJsonExpression): MathJsonExpression => [
    'Match',
    subj,
    ['MatchCase', '_n', ['Greater', 'n', 0], { str: 'pos' }],
    ['MatchCase', '_', { str: 'other' }],
  ];

  it('a True guard selects the case', () => {
    expect(m(posOrOther(5))).toBe('"pos"');
  });

  it('a False guard falls through', () => {
    expect(m(posOrOther(-5))).toBe('"other"');
  });

  it('an undecidable (symbolic) guard falls through', () => {
    // `y > 0` is undecidable for a free `y`: totality requires falling through,
    // not staying inert.
    expect(m(posOrOther('y'))).toBe('"other"');
  });
});

describe('MATCH — no matching case', () => {
  it('yields Error("match-no-case", subject)', () => {
    const err = ce
      .box(['Match', 3, ['MatchCase', 0, { str: 'zero' }]])
      .evaluate();
    expect(err.operator).toBe('Error');
    expect(err.op1?.string).toBe('match-no-case');
    expect(err.op2?.toString()).toBe('3');
  });
});

describe('MATCH — algebraic / operator dispatch', () => {
  it('[Add, _a, 1] captures the remaining term (commutative match)', () => {
    expect(
      m(['Match', ['Add', 'x', 1], ['MatchCase', ['Add', '_a', 1], 'a']])
    ).toBe('x');
  });

  it('dispatches on the operator of an expression via [Add, __terms]', () => {
    expect(
      m([
        'Match',
        ['Add', ['Multiply', 2, 'x'], 1],
        ['MatchCase', ['Add', '__terms'], { str: 'is-add' }],
        ['MatchCase', '_', { str: 'other' }],
      ])
    ).toBe('"is-add"');
  });
});

describe('MATCH — exactness contract', () => {
  it('evaluate keeps an exact transcendental body symbolic; N numericizes', () => {
    const expr = ce.box(['Match', 3, ['MatchCase', '_x', ['Ln', 'x']]]);
    expect(expr.evaluate().toString()).toBe('ln(3)');
    expect(expr.N().re).toBeCloseTo(Math.log(3), 12);
  });

  it('N() selects the same case as evaluate(): subject matches exactly', () => {
    // The subject must not be numericized before matching — only the selected
    // body is. Regression: Match(Pi, MatchCase(Pi, …)).N() picked the fallback.
    const expr = ce.box([
      'Match',
      'Pi',
      ['MatchCase', 'Pi', { str: 'is pi' }],
      ['MatchCase', '_', { str: 'other' }],
    ]);
    expect(expr.evaluate().toString()).toBe('"is pi"');
    expect(expr.N().toString()).toBe('"is pi"');
  });

  it('N() numericizes the selected body of an exactly-matched case', () => {
    const expr = ce.box([
      'Match',
      'Pi',
      ['MatchCase', '_x', ['Divide', 'x', 2]],
    ]);
    expect(expr.evaluate().toString()).toBe('1/2 * pi');
    expect(expr.N().re).toBeCloseTo(Math.PI / 2, 12);
  });
});
