import { engine as ce } from '../utils';

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 1 of the Epsil `match` design
 * (docs/plans/2026-07-12-cortex-match-design.md §6 item 1): the engine-level
 * `Match`/`MatchCase`/`Pin`/`Alternatives` heads with tier-3 reference
 * semantics via the generic matcher. Selection logic lives in
 * `src/compute-engine/boxed-expression/match-dispatch.ts`.
 *
 * These tests exercise the MathJSON heads directly (the Epsil surface syntax
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

describe('MATCH — dictionary patterns (open match, §2 pattern rule 7)', () => {
  // A `Dictionary(...)` VALUE collapses to the engine's native dictionary at
  // canonicalization, so the generic matcher cannot align a function-form
  // `Dictionary(...)` pattern with it. `match-dispatch` uses a dedicated
  // dict-aware matcher on both paths (tier-2 shape + tier-3 reference).
  const dict = (
    ...kv: [string, MathJsonExpression][]
  ): MathJsonExpression => [
    'Dictionary',
    ...kv.map(([k, v]) => ['KeyValuePair', { str: k }, v] as MathJsonExpression),
  ];

  it('matches an exact single-key dictionary and binds the value', () => {
    expect(
      m([
        'Match',
        dict(['x', 1], ['y', 2]),
        ['MatchCase', dict(['x', '_px']), 'px'],
        ['MatchCase', '_', { str: 'nope' }],
      ])
    ).toBe('1');
  });

  it('is open: extra subject keys are ignored', () => {
    expect(
      m([
        'Match',
        dict(['x', 1], ['y', 2], ['z', 3]),
        ['MatchCase', dict(['x', '_px'], ['y', '_py']), ['Add', 'px', 'py']],
        ['MatchCase', '_', { str: 'nope' }],
      ])
    ).toBe('3');
  });

  it('falls through when a pattern key is missing from the subject', () => {
    expect(
      m([
        'Match',
        dict(['y', 2]),
        ['MatchCase', dict(['x', '_px']), 'px'],
        ['MatchCase', '_', { str: 'nope' }],
      ])
    ).toBe('"nope"');
  });

  it('binds a captured value used in the body', () => {
    expect(
      m([
        'Match',
        dict(['a', ['Add', 3, 4]]),
        ['MatchCase', dict(['a', '_v']), ['Multiply', 'v', 2]],
      ])
    ).toBe('14');
  });

  it('matches a nested dictionary inside a list pattern', () => {
    expect(
      m([
        'Match',
        ['List', 1, dict(['k', 9])],
        [
          'MatchCase',
          ['List', '_a', dict(['k', '_v'])],
          ['Add', 'a', 'v'],
        ],
        ['MatchCase', '_', { str: 'nope' }],
      ])
    ).toBe('10');
  });

  it('a literal dictionary value must match structurally', () => {
    expect(
      m([
        'Match',
        dict(['k', 5]),
        ['MatchCase', dict(['k', 5]), { str: 'five' }],
        ['MatchCase', dict(['k', 6]), { str: 'six' }],
        ['MatchCase', '_', { str: 'nope' }],
      ])
    ).toBe('"five"');
  });

  it('a pin resolves as a dictionary value', () => {
    expect(
      m([
        'Match',
        dict(['k', 5]),
        [
          'MatchCase',
          dict(['k', ['Pin', ['Add', 2, 3]]]),
          { str: 'hit' },
        ],
        ['MatchCase', '_', { str: 'miss' }],
      ])
    ).toBe('"hit"');
  });

  it('a non-dictionary subject falls through a dictionary pattern', () => {
    expect(
      m([
        'Match',
        5,
        ['MatchCase', dict(['k', '_v']), 'v'],
        ['MatchCase', '_', { str: 'no' }],
      ])
    ).toBe('"no"');
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

/**
 * Range patterns (§8 of the design, 2026-07-31 addendum). A two-operand
 * `["Range", lo, hi]` in **pattern position** is an inclusive numeric
 * membership test, not a structural match.
 */
describe('MATCH — range patterns (membership)', () => {
  const inOut = (subj: MathJsonExpression): MathJsonExpression => [
    'Match',
    subj,
    ['MatchCase', ['Range', 1, 10], { str: 'in' }],
    ['MatchCase', '_', { str: 'out' }],
  ];

  it('selects on an interior subject and on both endpoints (inclusive)', () => {
    expect(m(inOut(5))).toBe('"in"');
    expect(m(inOut(1))).toBe('"in"');
    expect(m(inOut(10))).toBe('"in"');
  });

  it('falls through just outside either endpoint', () => {
    expect(m(inOut(0))).toBe('"out"');
    expect(m(inOut(11))).toBe('"out"');
    expect(m(inOut(0.5))).toBe('"out"');
    expect(m(inOut(10.5))).toBe('"out"');
  });

  it('endpoints compare with the matcher tolerance (leafEquals semantics)', () => {
    // Just outside an endpoint but within `ce.tolerance` (1e-10) → selected.
    expect(m(inOut({ num: '0.9999999999999' }))).toBe('"in"');
    expect(m(inOut({ num: '10.0000000000001' }))).toBe('"in"');
    // Comfortably outside → not selected.
    expect(m(inOut({ num: '0.99' }))).toBe('"out"');
  });

  it('accepts float, rational and radical number-literal subjects', () => {
    expect(m(inOut(2.5))).toBe('"in"');
    expect(m(inOut(['Rational', 3, 2]))).toBe('"in"');
    expect(m(inOut(['Rational', 1, 3]))).toBe('"out"'); // 0.333 < 1
    expect(m(inOut(['Sqrt', 2]))).toBe('"in"'); // √2 ≈ 1.414
  });

  it('handles negative and infinite bounds', () => {
    const neg: MathJsonExpression = [
      'Match',
      -2,
      ['MatchCase', ['Range', -3, -1], { str: 'neg' }],
      ['MatchCase', '_', { str: 'out' }],
    ];
    expect(m(neg)).toBe('"neg"');

    const nonNegative = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', ['Range', 0, { num: '+Infinity' }], { str: 'nonneg' }],
      ['MatchCase', '_', { str: 'out' }],
    ];
    expect(m(nonNegative(0))).toBe('"nonneg"');
    expect(m(nonNegative(1e12))).toBe('"nonneg"');
    expect(m(nonNegative({ num: '+Infinity' }))).toBe('"nonneg"');
    expect(m(nonNegative(-1))).toBe('"out"');
  });

  it('does NOT match a non-number subject (the documented carve-out)', () => {
    expect(m(inOut('x'))).toBe('"out"'); // symbolic
    expect(m(inOut('Pi'))).toBe('"out"'); // a constant symbol is not a literal
    expect(m(inOut(['List', 1, 2]))).toBe('"out"'); // collection
    expect(m(inOut(['Range', 1, 10]))).toBe('"out"'); // an actual Range value
    expect(m(inOut({ str: 'a' }))).toBe('"out"'); // string
    expect(m(inOut(['Complex', 1, 2]))).toBe('"out"'); // complex
    expect(m(inOut(NaN))).toBe('"out"'); // NaN
  });

  it('keeps a `Range` with non-literal bounds structural', () => {
    // Not a membership test: the pattern still matches the Range *expression*
    // structurally (here binding `n` to the subject's lower bound).
    expect(
      m([
        'Match',
        ['Range', 'a', 10],
        ['MatchCase', ['Range', '_n', 10], 'n'],
        ['MatchCase', '_', { str: 'out' }],
      ])
    ).toBe('a');
    // A three-operand Range is not a range pattern either.
    expect(
      m([
        'Match',
        5,
        ['MatchCase', ['Range', 1, 10, 2], { str: 'stepped' }],
        ['MatchCase', '_', { str: 'out' }],
      ])
    ).toBe('"out"');
  });

  it('a pin of a Range value still compares values, not membership', () => {
    expect(
      m([
        'Match',
        ['Range', 1, 10],
        ['MatchCase', ['Pin', ['Range', 1, 10]], { str: 'pinned' }],
        ['MatchCase', '_', { str: 'out' }],
      ])
    ).toBe('"pinned"');
    // …and a number inside the pinned range does NOT select it.
    expect(
      m([
        'Match',
        5,
        ['MatchCase', ['Pin', ['Range', 1, 10]], { str: 'pinned' }],
        ['MatchCase', '_', { str: 'out' }],
      ])
    ).toBe('"out"');
  });

  it('is binding-free, so it is legal inside or-alternatives', () => {
    const alt = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      [
        'MatchCase',
        ['Alternatives', ['Range', 0, 9], ['Range', 100, 109]],
        { str: 'in' },
      ],
      ['MatchCase', '_', { str: 'out' }],
    ];
    expect(m(alt(5))).toBe('"in"');
    expect(m(alt(105))).toBe('"in"');
    expect(m(alt(50))).toBe('"out"');
  });

  it('supports a guard after a range (over outer-scope names only)', () => {
    // A range pattern binds nothing, so its guard can only reference
    // outer-scope names — the binding-free-alternative machinery still applies.
    ce.assign('matchRangeOn', 3);
    ce.assign('matchRangeOff', -1);
    const guarded = (limit: string): MathJsonExpression => [
      'Match',
      5,
      ['MatchCase', ['Range', 0, 100], ['Greater', limit, 0], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ];
    expect(m(guarded('matchRangeOn'))).toBe('"in"');
    expect(m(guarded('matchRangeOff'))).toBe('"out"'); // guard fails
  });

  it('first-match-wins across overlapping ranges', () => {
    expect(
      m([
        'Match',
        5,
        ['MatchCase', ['Range', 0, 10], { str: 'wide' }],
        ['MatchCase', ['Range', 5, 6], { str: 'narrow' }],
        ['MatchCase', '_', { str: 'out' }],
      ])
    ).toBe('"wide"');
  });

  it('N() selects the same case as evaluate() (subject evaluates exactly)', () => {
    const expr = ce.box([
      'Match',
      ['Divide', 22, 7],
      ['MatchCase', ['Range', 3, 4], ['Ln', 2]],
      ['MatchCase', '_', { str: 'out' }],
    ]);
    expect(expr.evaluate().toString()).toBe('ln(2)');
    expect(expr.N().re).toBeCloseTo(Math.LN2, 12);
  });

  it('route parity: box, parse-free function route, and raw MathJSON agree', () => {
    const cases = (): MathJsonExpression[] => [
      ['MatchCase', ['Range', 1, 10], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ];
    // Box route (held raw operands).
    expect(m(['Match', 5, ...cases()])).toBe('"in"');
    // `ce.function()` route (pre-boxed, canonical, operands).
    const fn = ce.function('Match', [
      ce.box(5),
      ce.function('MatchCase', [ce.box(['Range', 1, 10]), ce.string('in')]),
      ce.function('MatchCase', [
        ce.symbol('_', { canonical: false }),
        ce.string('out'),
      ]),
    ]);
    expect(fn.evaluate().toString()).toBe('"in"');
    const fnOut = ce.function('Match', [
      ce.box(50),
      ce.function('MatchCase', [ce.box(['Range', 1, 10]), ce.string('in')]),
      ce.function('MatchCase', [
        ce.symbol('_', { canonical: false }),
        ce.string('out'),
      ]),
    ]);
    expect(fnOut.evaluate().toString()).toBe('"out"');
  });
});

/**
 * Rung 1 of the error-propagation design
 * (`docs/plans/2026-07-31-error-propagation-design.md` §2/§6): `Match` is the
 * RESCUE construct, so it must decide on an error subject instead of freezing
 * with it — restoring the "always decides" totality pinned in §1 of the match
 * design. Wider coverage (bubbling, `IsError`) lives in
 * `error-propagation.test.ts`.
 */
describe('MATCH — error subjects (rung 1)', () => {
  /** An `Error`-headed subject. */
  const ERR: MathJsonExpression = ['Error', { str: 'oops' }];
  /** A subject whose canonical form merely EMBEDS an error (`"a" + 1`). */
  const BAD: MathJsonExpression = ['Add', { str: 'a' }, 1];

  it('an error subject falls through literal cases to `_`', () => {
    expect(m(zeroOrOther(BAD))).toBe('"other"');
    expect(m(zeroOrOther(ERR))).toBe('"other"');
  });

  it('a bare binding binds the error value', () => {
    expect(
      m(['Match', BAD, ['MatchCase', '_v', ['Type', 'v']]])
    ).toBe('TypeFrom("error")');
  });

  it('a sequence wildcard catches it too', () => {
    expect(m(['Match', ERR, ['MatchCase', '___r', { str: 'rest' }]])).toBe(
      '"rest"'
    );
  });

  it('a guard may call `IsError`', () => {
    expect(
      m([
        'Match',
        BAD,
        ['MatchCase', '_v', ['IsError', 'v'], { str: 'caught' }],
        ['MatchCase', '_', { str: 'fell' }],
      ])
    ).toBe('"caught"');
  });

  it('a typed pattern does NOT bind an error subject', () => {
    // Typed patterns lower to a wildcard plus an `Element(name, type)` guard.
    // `number` is a simple named type and resolves; the design's `x: !error`
    // spelling does NOT — a negation type is not among the annotations the
    // typed-pattern path resolves today (§3 Phase-3 note: "Only simple named
    // types resolve"), so such a case falls through rather than binding.
    const typed = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', '_v', ['Element', 'v', 'number'], { str: 'num' }],
      ['MatchCase', '_', { str: 'fell' }],
    ];
    expect(m(typed(5))).toBe('"num"');
    expect(m(typed(BAD))).toBe('"fell"');
    expect(m(typed(ERR))).toBe('"fell"');
  });

  it('`match-no-case` is unchanged for an error subject', () => {
    expect(m(['Match', ERR, ['MatchCase', 0, 1]])).toBe(
      'Error("match-no-case", Error("oops"))'
    );
  });

  it('N() selects the same case as evaluate() for an error subject', () => {
    const expr = ce.box([
      'Match',
      BAD,
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', '_', ['Ln', 2]],
    ]);
    expect(expr.evaluate().toString()).toBe('ln(2)');
    expect(expr.N().re).toBeCloseTo(Math.LN2, 12);
  });

  it('route parity: box and `ce.function()` agree on an error subject', () => {
    expect(m(zeroOrOther(BAD))).toBe('"other"');
    const fn = ce.function('Match', [
      ce.box(BAD),
      ce.function('MatchCase', [ce.box(0), ce.string('zero')]),
      ce.function('MatchCase', [
        ce.symbol('_', { canonical: false }),
        ce.string('other'),
      ]),
    ]);
    expect(fn.evaluate().toString()).toBe('"other"');
  });
});

//
// Phase 3 of the parameterized-nominal design
// (`docs/plans/2026-08-06-parameterized-nominal-types-design.md` §6): `match`
// at an instantiated body. No `match` machinery changes for this — a case
// binds the VALUES the tagged application carries, and a capture's type is
// the bound expression's own type — so these are pins that the
// non-parameterized nominal path already covers the parameterized one.
//
describe('MATCH — a parameterized nominal subject (§6)', () => {
  /** A fresh engine: `declareType` must not leak into the shared one. */
  function treeEngine(): ComputeEngine {
    const e = new ComputeEngine();
    e.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    return e;
  }

  /** A 3-deep `tree<finite_integer>`. */
  const tree3: MathJsonExpression = [
    'tree',
    1,
    ['List', ['tree', 2, ['List', ['tree', 3, ['List']]]]],
  ];

  it('binds the payload and the children of an applied nominal', () => {
    const e = treeEngine();
    const v = e
      .box(['Match', tree3, ['MatchCase', ['tree', '_v', '_cs'], 'v']])
      .evaluate();
    expect(v.toString()).toBe('1');
    const cs = e
      .box(['Match', tree3, ['MatchCase', ['tree', '_v', '_cs'], 'cs']])
      .evaluate();
    expect(cs.toString()).toBe('[tree(2, [tree(3, [])])]');
  });

  it('reads at every level of a 3-deep tree', () => {
    const e = treeEngine();
    const inner: MathJsonExpression = [
      'Match',
      ['At', 'cs', 1],
      ['MatchCase', ['tree', '_w', '_ds'], 'w'],
    ];
    expect(
      e
        .box(['Match', tree3, ['MatchCase', ['tree', '_v', '_cs'], inner]])
        .evaluate()
        .toString()
    ).toBe('2');
    const innermost: MathJsonExpression = [
      'Match',
      ['At', 'cs', 1],
      [
        'MatchCase',
        ['tree', '_w', '_ds'],
        ['Match', ['At', 'ds', 1], ['MatchCase', ['tree', '_z', '_es'], 'z']],
      ],
    ];
    expect(
      e
        .box(['Match', tree3, ['MatchCase', ['tree', '_v', '_cs'], innermost]])
        .evaluate()
        .toString()
    ).toBe('3');
  });

  it('a different nominal name does not match (opacity)', () => {
    const e = treeEngine();
    e.declareType('leaf', 'tuple<value: T>', { typeParams: ['T'] });
    const r = e
      .box([
        'Match',
        tree3,
        ['MatchCase', ['leaf', '_v'], 'v'],
        ['MatchCase', '_', { str: 'other' }],
      ])
      .evaluate();
    expect(r.toString()).toBe('"other"');
  });
});
