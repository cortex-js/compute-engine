/**
 * Contract B pins for the data-consuming statistics heads
 * (`library/statistics.ts`): `Mean`, `Median`, the variance and
 * standard-deviation pairs, `Kurtosis`, `Skewness`, `Mode`, `Quartiles`,
 * `InterquartileRange`, `Covariance`, `PopulationCovariance` and
 * `Correlation`.
 *
 * What each describe pins, in the same order:
 *
 * 1. The DECLARATION — the signature, and the resolved `nanBehavior` /
 *    `missingBehavior`. Every one of these heads answers `NaN` for absent data
 *    by §3.C of `docs/ERROR-MODEL.md`, so every one declares `handle`
 *    explicitly: the policies the framework would DERIVE say something else
 *    (`inert` for a carrier that already admits `nan`, `reject` for a
 *    `collection` slot, `pass-through` for the missing channel), and none of
 *    those describes a head that answers in its own codomain.
 * 2. The VALUES the declared result claims, at the points that populate each
 *    of its arms. A declared type no value witnesses is not worth declaring,
 *    and one a value contradicts is worse than the bare `number` these heads
 *    used to claim.
 *
 * The operand carrier of all fourteen stays `collection<any>` — the
 * absence-admitting top — because §3.C requires `[1, Missing, 3]` to REACH
 * the handler: the bare spelling `collection` is the values-only
 * `collection<unknown>`, which `list<integer | missing>` does not match.
 *
 * Each describe builds its own engine: symbol inference leaks across a shared
 * one, and several of these pins declare symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';

/** The declared signature of `name`, as the definition reports it. */
function signatureOf(ce: ComputeEngine, name: string): string {
  return ce.lookupDefinition(name)!.operator!.signature.toString();
}

/** The resolved Contract B policies of `name`, as one comparable string. */
function policiesOf(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name)!.operator!;
  return `nan=${def.resolvedNanBehaviorAt(0)} missing=${def.resolvedMissingBehavior}`;
}

/** `[op, …ops]` evaluated, as a string. */
function evaluated(ce: ComputeEngine, expr: any): string {
  return ce.box(expr).evaluate().toString();
}

/** The type of an UNEVALUATED application — the declared claim in action. */
function appliedType(ce: ComputeEngine, expr: any): string {
  return ce.box(expr).type.toString();
}

const NON_NUMERIC = /incompatible-type", "number"/;
const NON_REAL = /incompatible-type", "real"/;

describe('Mean', () => {
  const ce = new ComputeEngine();

  test('declaration', () => {
    expect(signatureOf(ce, 'Mean')).toBe(
      '((distribution) | collection<any> | number+) -> number'
    );
    expect(policiesOf(ce, 'Mean')).toBe('nan=handle missing=handle');
  });

  test('the bare `number` result is the narrowest claim: every arm is reached', () => {
    // A complex mean, an infinite one, and `NaN` — no two-arm union covers
    // all three, so the base type says it in one token.
    expect(evaluated(ce, ['Mean', ['List', 1, ['Complex', 1, 2]]])).toBe(
      '(1 + i)'
    );
    expect(evaluated(ce, ['Mean', ['List', 1, 'PositiveInfinity', 3]])).toBe(
      '+oo'
    );
    expect(evaluated(ce, ['Mean', ['List', 1, 'NaN', 3]])).toBe('NaN');
  });

  test('absent data and empty input are NaN (§3.C)', () => {
    expect(evaluated(ce, ['Mean', ['List', 1, 'Missing', 3]])).toBe('NaN');
    expect(evaluated(ce, ['Mean', ['List']])).toBe('NaN');
    expect(evaluated(ce, ['Mean', 'NaN'])).toBe('NaN');
  });

  test('a non-numeric datum is an incompatible-type error, not inertness', () => {
    // Both of these used to report themselves back with no diagnosis. A
    // string OPERAND is refused whole: a string is an indexed collection of
    // its characters, so blaming `"a"` for input spelled `"abc"` would name
    // something the caller did not write.
    expect(evaluated(ce, ['Mean', ['List', 1, { str: 'a' }, 3]])).toMatch(
      NON_NUMERIC
    );
    expect(evaluated(ce, ['Mean', { str: 'abc' }])).toMatch(NON_NUMERIC);
    expect(evaluated(ce, ['Mean', ['List', 1, 'True', 3]])).toMatch(
      NON_NUMERIC
    );
  });

  test('symbolic data stays inert — a later assignment must still answer', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    expect(e.box(['Mean', 'L']).evaluate().operator).toBe('Mean');
    e.assign('L', e.box(['List', 1, 2, 3]));
    expect(e.box(['Mean', 'L']).evaluate().toString()).toBe('2');
  });

  test('a distribution operand keeps its closed form', () => {
    expect(evaluated(ce, ['Mean', ['NormalDistribution', 0, 1]])).toBe('0');
  });
});

describe('Median', () => {
  const ce = new ComputeEngine();

  test('declaration', () => {
    expect(signatureOf(ce, 'Median')).toBe(
      '(collection<any> | number+) -> nan | real | signed_infinity'
    );
    expect(policiesOf(ce, 'Median')).toBe('nan=handle missing=handle');
  });

  test('all three arms are reached', () => {
    expect(evaluated(ce, ['Median', ['List', 1, 2, 3, 4]])).toBe('5/2');
    // An order statistic reads an infinite datum as an ordinary extreme
    // value, so a sample of two infinities has an infinite median.
    expect(
      evaluated(ce, [
        'Median',
        ['List', 'PositiveInfinity', 'PositiveInfinity'],
      ])
    ).toBe('+oo');
    expect(evaluated(ce, ['Median', ['List', 1, 'Missing', 3]])).toBe('NaN');
    expect(evaluated(ce, ['Median', ['List']])).toBe('NaN');
  });

  test('a real infinity is an ordinary rank, `~oo` is not', () => {
    // `+oo` orders; `~oo` has no real value at all, and a comparator that
    // answers `NaN` leaves the sample in its original order, so the median
    // would be whatever element the rank happened to land on.
    expect(evaluated(ce, ['Median', ['List', 1, 'PositiveInfinity', 3]])).toBe(
      '3'
    );
    expect(evaluated(ce, ['Median', ['List', 1, 'ComplexInfinity', 3]])).toBe(
      'NaN'
    );
  });

  test('complex data is refused, non-numeric data with its own constraint', () => {
    expect(
      evaluated(ce, ['Median', ['List', 1, ['Complex', 1, 2], 3]])
    ).toMatch(NON_REAL);
    expect(evaluated(ce, ['Median', ['List', 1, { str: 'a' }, 3]])).toMatch(
      NON_NUMERIC
    );
  });
});

describe('the variance family', () => {
  const HEADS = [
    'Variance',
    'PopulationVariance',
    'StandardDeviation',
    'PopulationStandardDeviation',
  ];

  test('declaration', () => {
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      const distribution = h.startsWith('Population')
        ? ''
        : '(distribution) | ';
      expect(`${h}: ${signatureOf(ce, h)}`).toBe(
        `${h}: (${distribution}collection<any> | number+) -> (real<0..>) | nan`
      );
      expect(`${h}: ${policiesOf(ce, h)}`).toBe(
        `${h}: nan=handle missing=handle`
      );
    }
  });

  test('the result is REAL and non-negative even for complex data', () => {
    // The variance is a mean of squared MAGNITUDES, `E[|X − μ|²]` — the
    // squared deviation `(x − μ)²` would be complex and is not the variance.
    const ce = new ComputeEngine();
    expect(evaluated(ce, ['Variance', ['List', 1, ['Complex', 1, 2], 3]])).toBe(
      '8/3'
    );
    expect(
      evaluated(ce, ['StandardDeviation', ['List', 1, ['Complex', 1, 2], 3]])
    ).toBe('2/3sqrt(6)');
  });

  test('infinite data has no variance — the `nan` arm, not an infinite one', () => {
    // Every deviation from an infinite mean is `∞ − ∞`. This is why the
    // declared result has no infinite arm where `Median` and `Mode` do.
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(
        `${h}: ${evaluated(ce, [h, ['List', 1, 'PositiveInfinity', 3]])}`
      ).toBe(`${h}: NaN`);
      expect(
        `${h}: ${evaluated(ce, [
          h,
          ['List', 'PositiveInfinity', 'PositiveInfinity'],
        ])}`
      ).toBe(`${h}: NaN`);
    }
  });

  test('absent data, empty input and a non-numeric datum', () => {
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(`${h}: ${evaluated(ce, [h, ['List', 1, 'Missing', 3]])}`).toBe(
        `${h}: NaN`
      );
      expect(`${h}: ${evaluated(ce, [h, ['List']])}`).toBe(`${h}: NaN`);
      expect(evaluated(ce, [h, ['List', 1, { str: 'a' }, 3]])).toMatch(
        NON_NUMERIC
      );
    }
  });

  test('the sample forms are NaN for one datum, the population forms 0', () => {
    // `n − 1` is zero for a single datum: the sample variance genuinely has
    // no value, which the `nan` arm covers. The population divisor is `n`.
    const ce = new ComputeEngine();
    expect(evaluated(ce, ['Variance', 5])).toBe('NaN');
    expect(evaluated(ce, ['StandardDeviation', 5])).toBe('NaN');
    expect(evaluated(ce, ['PopulationVariance', 5])).toBe('0');
    expect(evaluated(ce, ['PopulationStandardDeviation', 5])).toBe('0');
  });

  test('a distribution operand keeps its closed form', () => {
    const ce = new ComputeEngine();
    expect(evaluated(ce, ['Variance', ['NormalDistribution', 0, 2]])).toBe('4');
    expect(
      evaluated(ce, ['StandardDeviation', ['NormalDistribution', 0, 2]])
    ).toBe('2');
  });
});

describe('Kurtosis and Skewness', () => {
  const ce = new ComputeEngine();

  test('declaration', () => {
    for (const h of ['Kurtosis', 'Skewness']) {
      expect(`${h}: ${signatureOf(ce, h)}`).toBe(
        `${h}: (collection<any> | number+) -> nan | real`
      );
      expect(`${h}: ${policiesOf(ce, h)}`).toBe(
        `${h}: nan=handle missing=handle`
      );
    }
  });

  test('a standardized moment has no infinite arm', () => {
    // The numerator and the denominator are both non-finite for infinite
    // data, so the quotient is `NaN` rather than an infinity.
    for (const h of ['Kurtosis', 'Skewness'])
      expect(
        `${h}: ${evaluated(ce, [h, ['List', 1, 'PositiveInfinity', 3]])}`
      ).toBe(`${h}: NaN`);
  });

  test('skewness is signed, so the real arm carries no range', () => {
    // A right-tailed sample is positively skewed, a left-tailed one
    // negatively — the exact path answers a radical, so the SIGN is what is
    // read here.
    expect(ce.box(['Skewness', ['List', 1, 2, 10]]).evaluate().isPositive).toBe(
      true
    );
    expect(ce.box(['Skewness', ['List', 1, 9, 10]]).evaluate().isNegative).toBe(
      true
    );
  });

  test('absent data, empty input and a non-numeric datum', () => {
    for (const h of ['Kurtosis', 'Skewness']) {
      expect(`${h}: ${evaluated(ce, [h, ['List', 1, 'Missing', 3]])}`).toBe(
        `${h}: NaN`
      );
      expect(`${h}: ${evaluated(ce, [h, ['List']])}`).toBe(`${h}: NaN`);
      expect(evaluated(ce, [h, ['List', 1, { str: 'a' }, 3]])).toMatch(
        NON_NUMERIC
      );
      expect(evaluated(ce, [h, ['List', 1, ['Complex', 1, 2], 3]])).toMatch(
        NON_REAL
      );
    }
  });
});

describe('Mode', () => {
  const ce = new ComputeEngine();

  test('declaration', () => {
    expect(signatureOf(ce, 'Mode')).toBe(
      '(collection<any> | number+) -> nan | real | signed_infinity'
    );
    expect(policiesOf(ce, 'Mode')).toBe('nan=handle missing=handle');
  });

  test('all three arms are reached', () => {
    expect(evaluated(ce, ['Mode', ['List', 1, 2, 2, 3]])).toBe('2');
    expect(
      evaluated(ce, ['Mode', ['List', 'PositiveInfinity', 'PositiveInfinity']])
    ).toBe('+oo');
    expect(evaluated(ce, ['Mode', ['List', 1, 'Missing', 3]])).toBe('NaN');
    expect(evaluated(ce, ['Mode', ['List']])).toBe('NaN');
  });

  test('a non-numeric datum is refused', () => {
    expect(evaluated(ce, ['Mode', ['List', 1, { str: 'a' }, 3]])).toMatch(
      NON_NUMERIC
    );
  });
});

describe('Quartiles', () => {
  const ce = new ComputeEngine();

  test('declaration — the component names run in the tuple order', () => {
    // They used to read `mid, lower, upper` against a handler that built
    // `(Q1, Q2, Q3)`, so every name was attached to the wrong component.
    expect(signatureOf(ce, 'Quartiles')).toBe(
      '(collection<any> | number+) -> ' +
        'tuple<lower: nan | real | signed_infinity, ' +
        'mid: nan | real | signed_infinity, ' +
        'upper: nan | real | signed_infinity>'
    );
    expect(policiesOf(ce, 'Quartiles')).toBe('nan=handle missing=handle');
  });

  test('each component carries the Median claim, and all three arms show', () => {
    expect(evaluated(ce, ['Quartiles', ['List', 1, 2, 3, 4]])).toBe(
      '(3/2, 5/2, 7/2)'
    );
    expect(
      evaluated(ce, ['Quartiles', ['List', 1, 'PositiveInfinity', 3]])
    ).toBe('(1, 3, +oo)');
    expect(evaluated(ce, ['Quartiles', ['List', 1, 'Missing', 3]])).toBe(
      '(NaN, NaN, NaN)'
    );
    expect(evaluated(ce, ['Quartiles', ['List']])).toBe('(NaN, NaN, NaN)');
  });

  test('a single datum is its own lower quartile, median and upper quartile', () => {
    // Was `(Error("missing"), 5, Error("missing"))`: the Moore–McCabe split
    // excludes the overall median from both halves, which for one datum
    // leaves both halves empty and took the median of nothing. NumPy's
    // `percentile([x], [25, 50, 75])` reports the same triple this does.
    expect(evaluated(ce, ['Quartiles', 5])).toBe('(5, 5, 5)');
    expect(evaluated(ce, ['Quartiles', ['List', 5]])).toBe('(5, 5, 5)');
    expect(evaluated(ce, ['Quartiles', ['List', 2.5]])).toBe('(2.5, 2.5, 2.5)');
  });

  test('complex and non-numeric data are refused', () => {
    expect(
      evaluated(ce, ['Quartiles', ['List', 1, ['Complex', 1, 2], 3]])
    ).toMatch(NON_REAL);
    expect(evaluated(ce, ['Quartiles', ['List', 1, { str: 'a' }, 3]])).toMatch(
      NON_NUMERIC
    );
  });
});

describe('InterquartileRange', () => {
  const ce = new ComputeEngine();

  test('declaration', () => {
    expect(signatureOf(ce, 'InterquartileRange')).toBe(
      '(collection<any> | number+) -> (real<0..>) | +oo | nan'
    );
    expect(policiesOf(ce, 'InterquartileRange')).toBe(
      'nan=handle missing=handle'
    );
  });

  test('Q3 − Q1 is never negative, and the only infinity it reaches is +oo', () => {
    expect(evaluated(ce, ['InterquartileRange', ['List', 1, 2, 3, 4]])).toBe(
      '2'
    );
    // A quartile pair that straddles an infinite datum has an infinite
    // spread, whichever sign the datum carries.
    expect(
      evaluated(ce, ['InterquartileRange', ['List', 1, 'PositiveInfinity', 3]])
    ).toBe('+oo');
    expect(
      evaluated(ce, ['InterquartileRange', ['List', 1, 'NegativeInfinity', 3]])
    ).toBe('+oo');
    // Two infinities of the SAME sign cancel instead.
    expect(
      evaluated(ce, [
        'InterquartileRange',
        ['List', 'PositiveInfinity', 'PositiveInfinity'],
      ])
    ).toBe('NaN');
  });

  test('a single datum has zero spread', () => {
    // Was `Error("missing")`, from the same empty-half split `Quartiles` had.
    expect(evaluated(ce, ['InterquartileRange', 5])).toBe('0');
    expect(evaluated(ce, ['InterquartileRange', ['List', 5]])).toBe('0');
  });

  test('absent data, empty input and a non-numeric datum', () => {
    expect(
      evaluated(ce, ['InterquartileRange', ['List', 1, 'Missing', 3]])
    ).toBe('NaN');
    expect(evaluated(ce, ['InterquartileRange', ['List']])).toBe('NaN');
    expect(
      evaluated(ce, ['InterquartileRange', ['List', 1, { str: 'a' }, 3]])
    ).toMatch(NON_NUMERIC);
  });
});

describe('a refused datum outranks an absent one', () => {
  // The absent-datum rule (§3.C) and the non-numeric-datum refusal look at the
  // same data, and an input can trip both. The Error channel wins: a datum
  // whose TYPE is statically wrong must be diagnosed, while `NaN` says only
  // that the answer is unavailable and hides the reason.
  //
  // The two checks used to run in that order — the absence gate first, the
  // data walk after — so `Mean([Missing, "a"])` answered `NaN` and the string
  // was never reported. One walk now decides both (`collectData`), which also
  // keeps the enumeration count at one per datum (ruling B8).
  const ce = new ComputeEngine();

  test('Mean of a Missing beside a string', () => {
    expect(evaluated(ce, ['Mean', ['List', 'Missing', { str: 'a' }]])).toMatch(
      NON_NUMERIC
    );
  });

  test('Median of a NaN beside a string', () => {
    expect(evaluated(ce, ['Median', ['List', 'NaN', { str: 'a' }]])).toMatch(
      NON_NUMERIC
    );
  });

  test('Variance of a Missing beside a boolean', () => {
    expect(evaluated(ce, ['Variance', ['List', 'Missing', 'True']])).toMatch(
      NON_NUMERIC
    );
  });

  test('an absent datum with no refused datum is still NaN', () => {
    // The ranking only fires when both are present: absence keeps its own
    // answer otherwise.
    expect(evaluated(ce, ['Mean', ['List', 'Missing', 3]])).toBe('NaN');
    expect(evaluated(ce, ['Median', ['List', 'NaN', 3]])).toBe('NaN');
    expect(evaluated(ce, ['Variance', ['List', 'Missing', 3]])).toBe('NaN');
  });
});

describe('the bivariate statistics', () => {
  const HEADS = ['Covariance', 'PopulationCovariance', 'Correlation'];

  test('declaration', () => {
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(`${h}: ${signatureOf(ce, h)}`).toBe(
        `${h}: (collection<any>, collection<any>?) -> nan | real`
      );
      // The DERIVED policies here are `reject` (a `collection` slot) and
      // `pass-through`; neither describes a head that answers `NaN` for a
      // `NaN` or absent CELL of its data.
      expect(`${h}: ${policiesOf(ce, h)}`).toBe(
        `${h}: nan=handle missing=handle`
      );
    }
  });

  test('the type handler declines where the data types prove nothing', () => {
    // It used to answer the wide `number` there, which HID the declared
    // `real | nan`: a type-handler answer is never widened.
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(
        `${h}: ${appliedType(ce, [h, ['List', 1, 2, 3], ['List', 2, 4, 7]])}`
      ).toBe(`${h}: real`);
      expect(
        `${h}: ${appliedType(ce, [
          h,
          ['List', 1, { num: 'NaN' }],
          ['List', 2, 3],
        ])}`
      ).toBe(`${h}: nan | real`);
    }
  });

  test('an ABSENT datum is NaN, the same as a NaN datum (§3.C)', () => {
    // `Missing` used to be refused as MIS-SHAPED data while the identical
    // input spelled with a `NaN` answered `NaN`.
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(
        `${h}: ${evaluated(ce, [
          h,
          ['List', 1, 2, 3],
          ['List', 1, 'Missing', 3],
        ])}`
      ).toBe(`${h}: NaN`);
      expect(
        `${h}: ${evaluated(ce, [h, ['List', 1, 2, 3], ['List', 1, 'NaN', 3]])}`
      ).toBe(`${h}: NaN`);
    }
  });

  test('an Error still beats a NaN across the operands', () => {
    // A length mismatch is the Error channel and wins, which is why the
    // absent datum is admitted as DATA and judged after the shape checks
    // rather than short-circuiting the walk.
    const ce = new ComputeEngine();
    expect(
      evaluated(ce, [
        'Covariance',
        ['List', 1, 2, 3, 4],
        ['List', 1, 'Missing', 3],
      ])
    ).toMatch(/incompatible-dimensions/);
  });

  test('a non-numeric datum names the number constraint, not the shape', () => {
    const ce = new ComputeEngine();
    for (const h of HEADS) {
      expect(
        evaluated(ce, [h, ['List', 1, 2, 3], ['List', 1, { str: 'a' }, 3]])
      ).toMatch(NON_NUMERIC);
      // A string operand is refused whole rather than character by
      // character: a string is an indexed collection of its characters.
      expect(evaluated(ce, [h, { str: 'ab' }, { str: 'cd' }])).toMatch(
        NON_NUMERIC
      );
    }
  });

  test('the shape diagnosis survives for input that really is mis-shaped', () => {
    const ce = new ComputeEngine();
    expect(evaluated(ce, ['Covariance', ['List', 1, 2, 3]])).toMatch(
      /expects two equal-length collections/
    );
  });

  test('Correlation declares no [-1, 1] range, because its kernel breaks it', () => {
    // Pearson's r lies in [−1, 1] mathematically, and a two-point sample has
    // r = ±1 exactly. At machine precision the kernel's cancellation
    // overshoots that bound on such a sample, so a declared `real<-1..1>`
    // would be a bound the head's own values contradict. The exact path is
    // unaffected.
    const ce = new ComputeEngine();
    expect(evaluated(ce, ['Correlation', ['List', 1, 2], ['List', 2, 4]])).toBe(
      '1'
    );
    // A FIXED counterexample, not a random search: floating point is
    // deterministic, so one sample that overshoots always overshoots. These
    // two points give r = −1.000000000000704, about 7e-13 past the bound.
    //
    // This assertion FAILS the day the kernel becomes accurate enough to keep
    // |r| ≤ 1 here, and that is the intent: it is the evidence for the missing
    // range in the declaration, so it must be revisited — together with the
    // declaration — rather than survive a fix it no longer describes.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const r = machine
      .box([
        'Correlation',
        ['List', 419268.9657211304, 428655.5051803589],
        ['List', 819708.2281112671, 172726.51195526123],
      ] as any)
      .N();
    expect(typeof r.re === 'number' && Math.abs(r.re) > 1).toBe(true);
  });

  test('constant data reports zero variance, which is outside every numeric arm', () => {
    // An `Error(...)` has a type outside the numeric lattice, so it neither
    // confirms nor contradicts the declared `real | nan`.
    const ce = new ComputeEngine();
    expect(
      evaluated(ce, ['Correlation', ['List', 2, 2, 2], ['List', 1, 5, 9]])
    ).toMatch(/zero variance/);
  });
});
