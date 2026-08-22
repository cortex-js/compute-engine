import { engine } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';

describe('TRIGONOMETRY constructible values', () => {
  for (const h of ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot']) {
    for (const [n, d] of [
      [0, 1],
      [1, 12],
      [1, 10],
      [1, 8],
      [1, 6],
      [1, 5],
      [1, 4],
      [1, 3],
      [3, 8],
      [2, 5],
      [5, 12],
      [1, 2],
    ]) {
      for (const p of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
        const theta = (Math.PI * n) / d + (Math.PI / 2) * p;
        let jsValue =
          h === 'Cos'
            ? Math.cos(theta)
            : h === 'Sin'
              ? Math.sin(theta)
              : h === 'Tan'
                ? Math.tan(theta)
                : h === 'Sec'
                  ? 1 / Math.cos(theta)
                  : h === 'Csc'
                    ? 1 / Math.sin(theta)
                    : h === 'Cot'
                      ? 1 / Math.tan(theta)
                      : NaN;

        // const arg = engine
        //   .expr([
        //     'Add',
        //     ['Multiply', p, 'Half', 'Pi'],
        //     ['Multiply', 'Pi', ['Rational', n, d]],
        //   ])
        //   .simplify();
        const arg = engine
          .expr([
            'Multiply',
            'Pi',
            ['Add', ['Rational', p, 2], ['Rational', n, d]],
          ])
          .simplify();

        // Use evaluate to get the exact value (using N() directly could bypass
        // the constructible value logic)
        const fExact = engine.expr([h, arg]).evaluate();

        // Reduce the exact value to a number
        const fNumeric = fExact.N();

        // The numeric and exact values should be the same

        test(`${h}(${arg.toString()}) exact = numeric`, () =>
          expect(fNumeric.isEqual(fExact)).toBeTruthy());

        if (
          fNumeric.symbol === 'ComplexInfinity' ||
          (typeof fNumeric.numericValue !== 'number' &&
            fNumeric.numericValue?.isComplexInfinity)
        ) {
          test(`${h}(${arg.toString()})`, () =>
            expect(Math.abs(jsValue) > 1e6).toBeTruthy());
        } else {
          let f = fNumeric.re ?? NaN;

          if (Math.abs(f) > 1000000) f = +Infinity;
          if (Math.abs(jsValue) > 1000000) jsValue = +Infinity;

          test(`${h}(${arg.toString()})`, () => {
            if (!Number.isFinite(Math.abs(f - jsValue))) {
              let expr = engine.expr([h, arg]);
              expr = expr.evaluate();
              const again = fExact.N();
              console.error('Invalid trig result', fNumeric.toString());
            }
            expect(Math.abs(f - jsValue)).toBeCloseTo(0, 10);
          });
        }
      }
    }
  }
});

describe('TRIGONOMETRY other values', () => {
  test(`arccos`, () =>
    expect(engine.parse('\\cos^{-1}(0.1)').N()).toMatchInlineSnapshot(
      `1.470628905633336822885798512187058123529908727457923369096448441117505529492241947660079548311554079`
    ));
});

describe('Arctan2 quadrant correction (REVIEW.md B1)', () => {
  // Before the fix, the exact (non-numericApproximation) evaluate path
  // returned Arctan(y/x) with no ±π quadrant correction, so evaluate()
  // disagreed with .N() for x < 0 — e.g. Arctan2(1, -1) evaluated to −π/4
  // instead of 3π/4.
  for (const [y, x] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 0],
    [3, -4],
    [-3, -4],
  ] as [number, number][]) {
    test(`Arctan2(${y}, ${x}) matches Math.atan2`, () => {
      const evaluated = engine.expr(['Arctan2', y, x]).evaluate();
      expect(evaluated.N().re).toBeCloseTo(Math.atan2(y, x), 12);
    });
  }

  test('indeterminate-sign arguments stay unevaluated', () => {
    // Symbols of unknown sign cannot be assigned a quadrant.
    expect(engine.expr(['Arctan2', 'a', 'b']).evaluate().operator).toBe(
      'Arctan2'
    );
  });
});

describe('Arctan2 three-valued sign discipline (P0-9 / SYMBOLIC P0-6)', () => {
  // The evaluate handler (library/trigonometry.ts) and the simplify rule
  // (symbolic/simplify-rules.ts) both had fail-open sign guards: a NaN operand
  // slipped through the `isFinite === false` checks into a definite ±π/2/π
  // branch, and the simplify rule fired the `Arctan(y/x)` fallback (only valid
  // for x > 0) unconditionally. Both faces must now agree with Math.atan2.

  // Full quadrant table: evaluate(), simplify().N(), and N() must all agree.
  for (const [y, x] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 0],
  ] as [number, number][]) {
    const truth = Math.atan2(y, x);
    test(`Arctan2(${y}, ${x}): evaluate / simplify().N() / N() agree with Math.atan2`, () => {
      expect(engine.expr(['Arctan2', y, x]).evaluate().N().re).toBeCloseTo(
        truth,
        12
      );
      expect(engine.expr(['Arctan2', y, x]).simplify().N().re).toBeCloseTo(
        truth,
        12
      );
      expect(engine.expr(['Arctan2', y, x]).N().re).toBeCloseTo(truth, 12);
    });
  }

  test('headline repro: Arctan2(1, -1).simplify() = 3π/4 (was −π/4)', () => {
    // Fail-open fallback previously returned arctan(-1) = −π/4; the correct
    // quadrant-II angle is 3π/4.
    expect(engine.expr(['Arctan2', 1, -1]).simplify().N().re).toBeCloseTo(
      (3 * Math.PI) / 4,
      12
    );
  });

  test('unknown-sign second argument stays symbolic under simplify', () => {
    // Arctan2(0, x) with x of unknown sign must NOT collapse to π.
    expect(engine.expr(['Arctan2', 0, 'x']).simplify().operator).toBe(
      'Arctan2'
    );
    // Fully symbolic operands stay symbolic too.
    expect(engine.expr(['Arctan2', 'x', 'y']).simplify().operator).toBe(
      'Arctan2'
    );
  });

  test('Arctan2(0, x) simplifies under a positive assumption', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', 'x', 0]));
    expect(ce.box(['Arctan2', 0, 'x']).simplify().N().re).toBeCloseTo(0, 12);
  });

  test('Arctan2(0, x) simplifies under a negative assumption', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Less', 'x', 0]));
    expect(ce.box(['Arctan2', 0, 'x']).simplify().N().re).toBeCloseTo(
      Math.PI,
      12
    );
  });

  // NaN in → NaN out, in evaluate, simplify, AND N (they previously disagreed:
  // evaluate → −π/2 / π, N → symbolic).
  for (const [y, x] of [
    [NaN, 2],
    [2, NaN],
    [NaN, NaN],
  ] as [number, number][]) {
    test(`Arctan2(${y}, ${x}) → NaN in evaluate, simplify and N`, () => {
      expect(engine.expr(['Arctan2', y, x]).evaluate().isNaN).toBe(true);
      expect(engine.expr(['Arctan2', y, x]).simplify().isNaN).toBe(true);
      expect(engine.expr(['Arctan2', y, x]).N().isNaN).toBe(true);
    });
  }

  test('complex operand: evaluate and N behave identically (stay symbolic)', () => {
    // atan2 is a real-plane function; a non-real operand has no well-defined
    // quadrant. evaluate() previously continued analytically (0.549i) while
    // N() silently dropped the imaginary part (0). Both must now stay symbolic.
    const ev = engine.expr(['Arctan2', 'i', 2]).evaluate();
    const n = engine.expr(['Arctan2', 'i', 2]).N();
    expect(ev.operator).toBe('Arctan2');
    expect(n.operator).toBe('Arctan2');
    expect(engine.expr(['Arctan2', 'i', 2]).simplify().operator).toBe(
      'Arctan2'
    );
  });
});

// ROADMAP B3: arctan's horizontal asymptotes, needed so improper integrals
// of the 1/(a²+x²) family evaluate (∫₀^∞ 1/(1+x²) = arctan(∞) = π/2).
describe('Arctan at ±∞', () => {
  test('arctan(+∞) = π/2 (exact under evaluate)', () =>
    expect(
      engine.expr(['Arctan', engine.PositiveInfinity]).evaluate().json
    ).toEqual(['Multiply', ['Rational', 1, 2], 'Pi']));
  test('arctan(−∞) = −π/2', () =>
    expect(
      engine.expr(['Arctan', engine.NegativeInfinity]).evaluate().json
    ).toEqual(['Multiply', ['Rational', -1, 2], 'Pi']));
  test('arctan(+∞).N() = 1.5707…', () =>
    expect(engine.expr(['Arctan', engine.PositiveInfinity]).N().re).toBeCloseTo(
      Math.PI / 2,
      10
    ));
});

// Regression: literal poles of the inverse hyperbolic functions used to stay
// symbolic with a bogus `finite_real` type. They are non-finite: artanh(±1) =
// ±∞, arcoth(±1) = ±∞, arsech(0) = +∞, arcsch(0) = ~oo. `evaluate()` must fold
// them (not just `.N()`) and the declared type must admit the non-finite value.
describe('Inverse hyperbolic literal poles', () => {
  const cases: [string, number, string][] = [
    ['Artanh', 1, '+oo'],
    ['Artanh', -1, '-oo'],
    ['Arcoth', 1, '+oo'],
    ['Arcoth', -1, '-oo'],
    ['Arsech', 0, '+oo'],
    ['Arcsch', 0, '~oo'],
  ];
  for (const [op, arg, expected] of cases) {
    test(`${op}(${arg}) = ${expected} (exact, non-finite)`, () => {
      const e = engine.expr([op, arg]);
      expect(e.evaluate().toString()).toBe(expected);
      // Type must not claim finite_real for a pole.
      expect(e.type.matches('finite_real')).toBe(false);
    });
  }

  test('non-pole arguments keep finite_real', () => {
    expect(engine.expr(['Artanh', 0.5]).type.matches('finite_real')).toBe(true);
    expect(engine.expr(['Arcoth', 2]).type.matches('finite_real')).toBe(true);
    expect(engine.expr(['Arsech', 0.5]).type.matches('finite_real')).toBe(true);
    expect(engine.expr(['Arcsch', 3]).type.matches('finite_real')).toBe(true);
  });
});

// REVIEW.md B20: the Degrees canonical handler reduced literals mod 360 while
// the evaluate handler did not, so the same operator denoted different values.
// Degrees is now a faithful linear conversion (no reduction) in both paths;
// range normalization is a serialization concern (`angleNormalization`).
describe('Degrees is a faithful conversion (REVIEW.md B20)', () => {
  it('literal and symbolic args agree (no mod-360 reduction)', () => {
    const ce = new ComputeEngine();
    ce.assign('b20', 390);
    const symbolic = ce.expr(['Degrees', 'b20']).evaluate().N().re;
    const literal = ce.expr(['Degrees', 390]).N().re;
    const faithful = (390 * Math.PI) / 180; // 13π/6 ≈ 6.807, NOT π/6
    expect(literal).toBeCloseTo(faithful, 10);
    expect(symbolic).toBeCloseTo(literal, 10);
  });

  // Regression (nightly exactness grid): the canonical handler fell back to
  // `ce.number(arg.re)` for a non-rational argument, and `.re` is a machine
  // float — so an exact radical was numericized (`Degrees(√2)` → 0.0246826…)
  // instead of staying `√2·π/180`. Rationals took an earlier branch, and `Pi`
  // / `Ln(2)` are not number literals, so only an exact radical hit it.
  it('an exact radical argument stays exact', () => {
    const ce = new ComputeEngine();
    const r = ce.expr(['Degrees', ['Sqrt', 2]]).evaluate();
    expect((r as unknown as { isExact?: boolean }).isExact).not.toBe(false);
    expect(r.N().re).toBeCloseTo((Math.SQRT2 * Math.PI) / 180, 12);
    // DMS delegates a lone exact degrees argument to Degrees unchanged.
    const d = ce.expr(['DMS', ['Sqrt', 2]]).evaluate();
    expect((d as unknown as { isExact?: boolean }).isExact).not.toBe(false);
    expect(d.N().re).toBeCloseTo((Math.SQRT2 * Math.PI) / 180, 12);
  });

  it('a float argument still numericizes', () => {
    const ce = new ComputeEngine();
    const r = ce.expr(['Degrees', 0.5]).evaluate();
    expect((r as unknown as { isExact?: boolean }).isExact).toBe(false);
    expect(r.re).toBeCloseTo((0.5 * Math.PI) / 180, 12);
  });
});

// R28b: inverse trig/hyperbolic functions evaluate to their complex principal
// value when the argument is off the real domain (previously `Arcsin(2).N()`
// was NaN and `Artanh(2).N()` stayed symbolic), and for complex arguments.
// The real-kernel NaN now cascades to the complex kernel in `apply()`.
// Reference values from mpmath.
describe('Complex-branch numericization of inverse trig/hyperbolic (R28b)', () => {
  // Use the shared engine: creating a `new ComputeEngine()` at collection
  // time would reset the process-global `BigDecimal.precision` and degrade
  // the 100-digit snapshots earlier in this file.
  const n = (e: unknown) => engine.box(e as any).N();

  it('Artanh off-domain reals take the principal branch', () => {
    let v = n(['Artanh', 2]);
    expect(v.re).toBeCloseTo(0.5493061443340549, 12);
    expect(v.im).toBeCloseTo(-1.5707963267948966, 12);
    v = n(['Artanh', -3]);
    expect(v.re).toBeCloseTo(-0.34657359027997264, 12);
    expect(v.im).toBeCloseTo(1.5707963267948966, 12);
  });

  it('Arcoth inside (−1, 1), including the (−1, 0) cut side', () => {
    let v = n(['Arcoth', 0.5]);
    expect(v.re).toBeCloseTo(0.5493061443340549, 12);
    expect(v.im).toBeCloseTo(-1.5707963267948966, 12);
    // Cut-side regression: the previous hand-rolled complex kernel
    // `ln((1+x)/(x−1))/2` flipped the imaginary sign on (−1, 0).
    v = n(['Arcoth', -0.5]);
    expect(v.re).toBeCloseTo(-0.5493061443340549, 12);
    expect(v.im).toBeCloseTo(1.5707963267948966, 12);
  });

  it('Arcsin/Arcosh off-domain reals', () => {
    let v = n(['Arcsin', 2]);
    expect(v.re).toBeCloseTo(1.5707963267948966, 12);
    expect(v.im).toBeCloseTo(-1.3169578969248166, 12);
    v = n(['Arcosh', 0.5]);
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(1.0471975511965979, 12);
  });

  it('Arsech: off-domain is complex; in-domain real value is correct', () => {
    const v = n(['Arsech', 2]);
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(1.0471975511965979, 12);
    // Regression: the previous complex kernel dropped the sqrt (computed
    // ln((2 − x²)/x)), wrong even for in-domain reals reached via a complex
    // intermediate. The real path pins the true value.
    expect(n(['Arsech', 0.5]).re).toBeCloseTo(1.3169578969248166, 12);
    expect(n(['Arsech', 0.5]).im).toBe(0);
  });

  it('complex arguments numericize', () => {
    let v = n(['Artanh', ['Complex', 1.5, 0.2]]);
    expect(v.re).toBeCloseTo(0.7692088566784916, 12);
    expect(v.im).toBeCloseTo(1.4204581310948328, 12);
    v = n(['Arsinh', ['Complex', 1, 1]]);
    expect(v.re).toBeCloseTo(1.0612750619050357, 12);
    expect(v.im).toBeCloseTo(0.6662394324925153, 12);
  });

  it('exactness contract: exact off-domain args stay symbolic under evaluate()', () => {
    expect(engine.box(['Artanh', 2]).evaluate().operator).toBe('Artanh');
    expect(engine.box(['Arcsin', 2]).evaluate().operator).toBe('Arcsin');
  });
});

describe('Tycho item 90 — constructible-value lookup skips symbolic arguments', () => {
  // `constructibleValues` used to call `.N()` on EVERY argument, including one
  // with free symbols that can never numericize. Over nested applications of a
  // user function the wasted `.N()` re-walked shared sub-chains, growing
  // exponentially with the nesting depth (a 17-element list of such chains
  // took 44 s under `sin`, versus milliseconds under division).
  const nested = (ce: ComputeEngine, depth: number) => {
    ce.assign('f', ce.parse('x \\mapsto \\operatorname{mod}(x\\cdot5+c,16)'));
    let body = 's';
    for (let k = 0; k < depth; k++) body = `f(${body})`;
    return body;
  };

  it('a deeply nested symbolic argument evaluates in bounded time', () => {
    const ce = new ComputeEngine();
    // Depth 26 is chosen so the guard is a TERMINATION property rather than a
    // stopwatch reading: the discarded walk this fix removed costs ~2× per
    // level, so at this depth it would need on the order of 2²⁶ traversals and
    // never finish, while the gated path stays under a tenth of a second.
    // Returning `Sin` at all is therefore the assertion, and the jest per-test
    // timeout below is the backstop for the non-terminating case.
    const e = ce.parse(`\\sin(${nested(ce, 26)})`);
    expect(e.evaluate().operator).toBe('Sin');
  }, 60_000);

  it('the reduction itself is unaffected: bound and constant arguments still fold', () => {
    const ce = new ComputeEngine();
    // A symbol with an ASSIGNED value is not an unknown, so it still reduces.
    ce.assign('y', ce.parse('\\frac{\\pi}{4}'));
    expect(ce.parse('\\sin(y)').evaluate().toString()).toBe('sqrt(2)/2');
    expect(ce.parse('\\sin(\\frac{\\pi}{4})').evaluate().toString()).toBe(
      'sqrt(2)/2'
    );
    expect(ce.parse('\\arctan(1)').evaluate().toString()).toBe('1/4 * pi');
  });
});

describe('numericization is skipped for arguments that cannot numericize', () => {
  // The sibling of the item-90 fix on the `.N()` path: `eq`, `compare`,
  // `approxEq`, `Rationalize` and `applyAngle`/`canonicalAngle` all called
  // `.N()` on an argument they then rejected for not being a number literal.
  // An argument with unknowns can never become one, and over nested
  // applications of a user function that discarded walk is exponential in the
  // nesting depth.
  const chain = (ce: ComputeEngine, depth: number) => {
    ce.assign('f', ce.parse('x \\mapsto \\operatorname{mod}(x\\cdot5+c,16)'));
    let body = 's';
    for (let k = 0; k < depth; k++) body = `f(${body})`;
    return body;
  };

  // Depth 24 makes each of these a TERMINATION test rather than a stopwatch
  // reading: the discarded `.N()` walk costs ~2× per level of nesting, so
  // un-gated it would need on the order of 2²⁴ traversals and never finish,
  // while every gated path below stays in the low hundreds of milliseconds.
  // Running to completion is therefore the assertion, and the generous jest
  // per-test timeouts are the backstop — a millisecond budget in this helper
  // reported machine load instead, and went red under parallel test runs.
  const onDeepChain = (
    build: (body: string) => (ce: ComputeEngine) => void
  ) => {
    const ce = new ComputeEngine();
    const body = chain(ce, 24);
    build(body)(ce);
  };

  it(
    'isEqual against a symbolic chain',
    () =>
      onDeepChain((body) => (ce) => {
        expect(ce.parse(body).isEqual(0)).not.toBe(true);
      }),
    60_000
  );

  it('Equal / Sort / ApproxEqual / Rationalize over symbolic chains', () => {
    onDeepChain((body) => (ce) => {
      ce.parse(`\\mathrm{Equal}(${body},0)`).evaluate();
    });
    onDeepChain((body) => (ce) => {
      ce.parse(`\\mathrm{Sort}([${body},${body},${body}])`).evaluate();
    });
    onDeepChain((body) => (ce) => {
      ce.parse(`\\mathrm{ApproxEqual}(${body},0)`).evaluate();
    });
    onDeepChain((body) => (ce) => {
      ce.parse(`\\mathrm{Rationalize}(${body})`).evaluate();
    });
  }, 60_000);

  it('the gated paths still answer for arguments that DO numericize', () => {
    const ce = new ComputeEngine();
    // Partial numericization of a symbolic operand still compares equal. A
    // free variable makes these identity questions, so they are asked of the
    // PROVER tier (`.isIdenticallyEqual()`); arithmetic `.isEqual()` is inert.
    expect(
      ce
        .parse('\\sin(2)+x')
        .isIdenticallyEqual(ce.parse('0.9092974268256817+x'))
    ).toBe(true);
    expect(
      ce.parse('\\sqrt{2}x').isIdenticallyEqual(ce.parse('1.4142135623730951x'))
    ).toBe(true);
    expect(ce.parse('(x+1)^2').isIdenticallyEqual(ce.parse('x^2+2x+1'))).toBe(
      true
    );
    expect(
      ce.parse('\\sin(2)+x').isEqual(ce.parse('0.9092974268256817+x'))
    ).toBe(undefined);
    // Ordering, approximate equality and rationalization of closed forms.
    expect(ce.parse('\\mathrm{Rationalize}(0.5)').evaluate().toString()).toBe(
      '1/2'
    );
    expect(
      ce.parse('\\mathrm{ApproxEqual}(\\pi, 3.14159265358979)').evaluate()
        .symbol
    ).toBe('True');
    // The `.N()` trig path is unchanged for numericizable angles.
    expect(ce.parse('\\sin(\\frac{\\pi}{4})').N().toString()).toBe(
      '0.707106781186547524401'
    );
    expect(ce.parse('\\sin(2+x)').N().toString()).toBe('sin(x + 2)');
  });
});

// A numeric operator whose `canonical` handler replaces the default
// signature-based argument validation loses that validation entirely. The
// trig/hyperbolic family (built by the shared `trigFunction` factory),
// `Degrees` and `DMS` all supply one, so a non-numeric operand used to reach
// evaluation unreported: `sin("a")` stayed inert and `Degrees("a")` answered a
// bare `NaN`. Their evaluate handlers now run `nonNumericOperandError`
// (`boxed-expression/validate.ts`), the same guard the arithmetic operators
// use.
//
// `Arctan` is the CONTROL in the loop below, not a fixed operator: it declares
// the same signature but has no `canonical` handler, so it keeps the default
// validation and already rejected this operand. It is asked the same question
// to pin that the two routes agree on the answer — if it ever gains a
// `canonical` handler it will need the guard too, and this test is where that
// shows up.
//
// The witness reaches evaluation through `At` on a heterogeneous list, because
// only that shape is invisible to a boxing-time check: the operand's static
// type is the union `finite_integer | missing | number | string`, which COULD
// be numeric, so admitting it at canonicalization is correct and only
// evaluation can settle it. A literal `Sin("a")` is already rejected earlier.
describe('non-numeric operands are reported, not absorbed', () => {
  // `At(["a", 2], 1)` — statically a union that could be a number, actually a
  // string once evaluated.
  const stringElement = ['At', ['List', "'a'", 2], 1];

  for (const operator of [
    'Sin',
    'Cos',
    'Tan',
    'Cot',
    'Sec',
    'Csc',
    'Arcsin',
    'Arccos',
    'Arctan',
    'Sinh',
    'Cosh',
    'Tanh',
    'Coth',
    'Arsinh',
    'Arcosh',
    'Artanh',
    'Arcoth',
    'Arsech',
    'Arcsch',
    'Degrees',
  ]) {
    it(`${operator} of a string element is an error`, () => {
      const ce = new ComputeEngine();
      const result = ce.expr([operator, stringElement]).evaluate();
      expect(result.isValid).toBe(false);
      expect(result.toString()).toContain('incompatible-type');
    });
  }

  it('DMS reports a string in any component', () => {
    const ce = new ComputeEngine();
    for (const ops of [
      [stringElement],
      [stringElement, 30],
      [1, stringElement],
      [1, 2, stringElement],
    ]) {
      const result = ce.expr(['DMS', ...ops]).evaluate();
      expect(result.isValid).toBe(false);
      expect(result.toString()).toContain('incompatible-type');
    }
  });

  // Found while adding the guard above: `DMS` folds its components by reading
  // `.re`, which is NaN for anything that is not a number LITERAL yet. Only
  // the degrees slot bailed out on that read, so a minutes or seconds operand
  // that merely needed evaluating first — an `At` over an all-numeric list —
  // was folded into `Degrees(NaN)` and the correct answer became unreachable.
  it('DMS resolves a component that is numeric but not yet a literal', () => {
    const ce = new ComputeEngine();
    const thirty = ['At', ['List', 30, 2], 1];
    expect(ce.expr(['DMS', 1, thirty]).evaluate().toString()).toBe(
      ce.expr(['DMS', 1, 30]).evaluate().toString()
    );
    expect(ce.expr(['DMS', 1, 2, thirty]).evaluate().toString()).toBe(
      ce.expr(['DMS', 1, 2, 30]).evaluate().toString()
    );
  });

  // The same `.re` read drops the imaginary part of a complex component, so
  // `DMS(1, i)` used to answer exactly what `DMS(1, 0)` does. `DMS` cannot
  // fold a complex component (the constructor does no symbolic arithmetic),
  // so it must leave the call unevaluated rather than silently truncate.
  it('DMS does not truncate a complex component', () => {
    const ce = new ComputeEngine();
    for (const ops of [['i'], [1, 'i'], [1, 2, 'i']]) {
      const result = ce.expr(['DMS', ...ops]).evaluate();
      expect(result.operator).toBe('DMS');
      expect(result.isValid).toBe(true);
    }
    expect(ce.expr(['DMS', 1, 'i']).evaluate().toString()).not.toBe(
      ce.expr(['DMS', 1, 0]).evaluate().toString()
    );
  });

  // The guard must not fire on the operands that are legitimately admitted:
  // symbols, exact constants, collections consumed by broadcast, and the
  // absence markers.
  it('leaves valid operands alone', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sin x').evaluate().toString()).toBe('sin(x)');
    expect(ce.parse('\\sin(\\frac{\\pi}{6})').evaluate().toString()).toBe(
      '1/2'
    );
    expect(ce.parse('\\sin(2.5)').evaluate().re).toBeCloseTo(Math.sin(2.5), 12);
    expect(
      ce
        .expr(['Sin', ['List', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('[0,sin(1)]');
    expect(ce.expr(['DMS', 'x', 30]).evaluate().toString()).toBe('DMS(x, 30)');
    expect(ce.expr(['Degrees', 'x']).evaluate().isValid).toBe(true);
  });
});

describe('SIGN of a circular function of an exact argument', () => {
  // `trigSign` reads a 0..3 sign table with the 1..4 quadrant number; the
  // off-by-one shifted every sign one quadrant along (`cos 1` reported
  // `negative`, and `|sec 1|` evaluated to `-sec(1)`). Every function is
  // checked in every quadrant against the sign of its numeric value.
  //
  // The file's shared engine, deliberately: constructing a `ComputeEngine`
  // at describe scope runs at collection time and re-precisions the
  // module-global `BigDecimal.precision`, which the earlier snapshot tests
  // of this file (`arccos` at 100 digits) depend on.
  const ce = engine;
  const numeric: Record<string, (t: number) => number> = {
    Sin: Math.sin,
    Cos: Math.cos,
    Tan: Math.tan,
    Sec: (t) => 1 / Math.cos(t),
    Csc: (t) => 1 / Math.sin(t),
    Cot: (t) => 1 / Math.tan(t),
  };
  // One angle per quadrant, plus negative and wrapped angles.
  const angles = [0.5, 2, 4, 5.5, -1, -2.5, 7];

  for (const [op, f] of Object.entries(numeric)) {
    it(`${op} reports the sign of its value in every quadrant`, () => {
      for (const t of angles) {
        const expected = f(t) > 0 ? 'positive' : 'negative';
        expect([op, t, ce.box([op, t]).sgn]).toEqual([op, t, expected]);
      }
    });
  }

  it('|sec 1| is sec(1), not -sec(1)', () => {
    expect(ce.parse('|\\sec 1|').evaluate().toString()).toBe('sec(1)');
    expect(ce.parse('|\\cos 1|').evaluate().toString()).toBe('cos(1)');
    expect(ce.parse('|\\cos 2|').evaluate().toString()).toBe('-cos(2)');
  });
});
