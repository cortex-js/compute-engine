/**
 * Non-finite typing convention (SYM P2-23, option b — convention, not
 * lattice extension). See ARCHITECTURE.md § "Non-finite typing convention
 * for type handlers".
 *
 * - `non_finite_number` is claimed ONLY when the value is provably ±∞.
 * - When ±∞/`~oo`/NaN is merely possible — or the value is provably `~oo` —
 *   the claim is `number` (never a finite type, never `complex`, and never a
 *   speculative `non_finite_number`).
 * - Unknown finiteness is a generic point (finite); zero-ness must be proven.
 */
import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

describe('NON-FINITE TYPING CONVENTION', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('x_r', 'real'); // generic real: finiteness unknown, sign unknown
    ce.declare('z_f', 'finite_real'); // provably finite, sign unknown
    ce.declare('nf_sym', 'non_finite_number'); // provably ±∞, no value
    ce.declare('f_sym', 'finite_number'); // provably finite, no value
    ce.declare('inf_val', 'number');
    ce.assign('inf_val', ce.PositiveInfinity); // decided by its VALUE
    ce.declare('three_val', 'number');
    ce.assign('three_val', 3); // decided by its VALUE
    ce.assume(ce.box(['Greater', 'p_r', 0])); // provably positive real
  });
  afterAll(() => ce.popScope());

  describe('provably ±∞ → non_finite_number', () => {
    test('Ln(0) = −∞', () =>
      expect(typeOf(['Ln', 0])).toBe('non_finite_number'));

    test('Log(0, 3) = −∞', () =>
      expect(typeOf(['Log', 0, 3])).toBe('non_finite_number'));

    test('EllipticK(1) = +∞', () =>
      expect(typeOf(['EllipticK', 1])).toBe('non_finite_number'));

    test('Round/Floor of a real ±∞', () => {
      expect(typeOf(['Round', 'PositiveInfinity'])).toBe('non_finite_number');
      expect(typeOf(['Floor', 'NegativeInfinity'])).toBe('non_finite_number');
    });

    test('±∞ · provably non-zero real', () =>
      expect(typeOf(['Multiply', 'p_r', 'PositiveInfinity'])).toBe(
        'non_finite_number'
      ));

    test('±∞ + real terms (generic-point finiteness)', () =>
      expect(typeOf(['Add', 'x_r', 'PositiveInfinity'])).toBe(
        'non_finite_number'
      ));

    // A provably non-finite TERM may be visible only in its static type:
    // `Ln(0)` types `non_finite_number` while its structural `isFinite` stays
    // `undefined`. The Add/Multiply/Divide handlers must consult the type —
    // without it, `1 + Ln(0)` widened to `integer` and `2·Ln(0)` claimed
    // `finite_integer` (unsound; the value is −∞). Fixed 2026-07-31.
    test('a type-only-provable −∞ term: 1 + Ln(0)', () => {
      expect(typeOf(['Add', 1, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Add', 1, ['Artanh', 1]])).toBe('non_finite_number');
    });

    // Ruling 2026-08-03: a provably non-finite REAL factor is implicitly
    // non-zero (`±∞ ≠ 0` is a theorem), so a proven sign is required only of
    // the FINITE factors. `Ln(0)` has sgn `non-positive` — not a proven
    // non-zero sign — yet `2·Ln(0) = −∞`. Before the ruling both of these
    // widened to `number`.
    test('a provably non-finite real factor is implicitly nonzero (ruling 2026-08-03)', () => {
      expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Multiply', 2, ['Artanh', 1]])).toBe('non_finite_number');
      // `Ln(0)/2` canonicalizes to `Multiply(1/2, Ln(0))`, so this is the
      // Multiply handler too.
      expect(typeOf(['Divide', ['Ln', 0], 2])).toBe('non_finite_number');
    });

    test('non-finite real numerator over a finite non-zero real denominator', () => {
      // Canonically, `Ln(0)/π` no longer survives as a Divide: `canonicalDivide`
      // folds `±∞/finite-nonzero` to the numerator (`Ln(0)`), which types
      // `non_finite_number` on its own. The observable claim is unchanged.
      const canonical = ce.box(['Divide', ['Ln', 0], 'Pi']);
      expect(canonical.operator).toBe('Ln');
      expect(canonical.type.toString()).toBe('non_finite_number');
      // The structural route keeps the Divide head and exercises the Divide
      // type handler's tight branch directly.
      const structural = ce.function('Divide', [ce.box(['Ln', 0]), ce.Pi], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('non_finite_number');
    });

    test('negative controls: the non-finite factor must be REAL, finite factors keep their sign obligation', () => {
      // `∞·i = ~oo`, not a signed infinity — `isFinite === false` does not
      // imply real.
      expect(typeOf(['Multiply', 'ImaginaryUnit', 'PositiveInfinity'])).toBe(
        'number'
      );
      expect(typeOf(['Multiply', 'ImaginaryUnit', ['Ln', 0]])).toBe('number');
      expect(typeOf(['Multiply', 2, 'ComplexInfinity'])).toBe('number');
      // A possibly-zero FINITE factor still blocks the claim (0 · −∞ = NaN).
      expect(typeOf(['Multiply', 'x_r', ['Ln', 0]])).toBe('number');
      // Divide: an unknown-finiteness denominator admits ∞/∞ = NaN.
      expect(typeOf(['Divide', ['Ln', 0], 'x_r'])).toBe('number');
      // Divide: a provably finite denominator with no proven sign may be 0.
      expect(typeOf(['Divide', ['Ln', 0], 'z_f'])).toBe('number');
      // Divide: a non-real denominator (∞/i = ~oo).
      expect(
        ce
          .function('Divide', [ce.PositiveInfinity, ce.I], { structural: true })
          .type.toString()
      ).toBe('number');
      // Divide: a non-real NUMERATOR (~oo/5 = ~oo). Canonically this folds to
      // the ~oo value, which types `number` like every other ~oo; the
      // structural route below exercises the handler's `isReal` guard and
      // must agree.
      expect(typeOf(['Divide', 'ComplexInfinity', 5])).toBe('number');
      expect(
        ce
          .function('Divide', [ce.ComplexInfinity, ce.box(5)], {
            structural: true,
          })
          .type.toString()
      ).toBe('number');
    });

    // Ruling 2026-08-03, symmetric case: `finite real / ±∞ = 0`.
    test('a provably finite real numerator over a real ±∞ is exactly 0', () => {
      // The canonical route folds `2/Ln(0)` to the literal `0`; the structural
      // route keeps the Divide head and exercises the type handler.
      expect(typeOf(['Divide', 2, ['Ln', 0]])).toBe('finite_integer');
      const structural = ce.function('Divide', [ce.box(2), ce.box(['Ln', 0])], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('finite_integer');
      // A provably finite (possibly zero) real numerator is still exactly 0.
      expect(
        ce
          .function('Divide', [ce.box('z_f'), ce.box(['Ln', 0])], {
            structural: true,
          })
          .type.toString()
      ).toBe('finite_integer');
    });

    test('negative controls for `finite/±∞`: numerator finiteness and realness are obligations', () => {
      const divide = (num: any, den: any) =>
        ce
          .function('Divide', [ce.box(num), ce.box(den)], { structural: true })
          .type.toString();
      // Unknown-finiteness numerator admits `∞/∞` = NaN.
      expect(divide('x_r', ['Ln', 0])).toBe('number');
      // Non-real numerator: `i/∞` is not claimed.
      expect(divide('ImaginaryUnit', ['Ln', 0])).toBe('number');
      // Non-real denominator: `2/~oo` is not claimed.
      expect(divide(2, 'ComplexInfinity')).toBe('number');
    });
  });

  describe('valueOf() projects only a proven direction', () => {
    // `valueOf()` used to project ANY direction-unproven infinity to `'~oo'`.
    // `Ln(0)` has sgn `non-positive` — not a proven `negative` — yet it is −∞.
    // For an infinity, `non-negative` implies `+∞` and `non-positive` implies
    // `-∞` (an infinity cannot be zero).
    test('a type-only-provable ±∞ projects to ±Infinity', () => {
      expect(ce.box(['Ln', 0]).valueOf()).toBe(-Infinity);
      expect(ce.box(['Negate', ['Ln', 0]]).valueOf()).toBe(Infinity);
    });

    test('signed-infinity symbols are unchanged', () => {
      expect(ce.symbol('PositiveInfinity').valueOf()).toBe(Infinity);
      expect(ce.symbol('NegativeInfinity').valueOf()).toBe(-Infinity);
    });

    test('`~oo` is projected only when the value is provably non-real', () => {
      expect(ce.symbol('ComplexInfinity').valueOf()).toBe('~oo');
      expect(ce.box(['Divide', 1, 0]).valueOf()).toBe('~oo');
    });

    test('a direction-unproven REAL infinity does not guess `~oo`', () => {
      ce.declare('nf_u', 'non_finite_number');
      // `nf_u + 1` is provably infinite and real, but its direction is
      // unproven: the projection falls through to the AsciiMath form instead
      // of guessing complex infinity (it used to return `'~oo'`).
      const e = ce.box(['Add', 'nf_u', 1]);
      expect(e.isInfinity).toBe(true);
      expect(e.isReal).toBe(true);
      expect(e.valueOf()).not.toBe('~oo');
      // A proven direction still projects: `|nf_u|` is non-negative, hence +∞.
      expect(ce.box(['Abs', 'nf_u']).valueOf()).toBe(Infinity);
    });
  });

  describe('possible (or provable) ~oo / NaN → number', () => {
    test('x · ∞ with possibly-zero x (0·∞ = NaN)', () => {
      expect(typeOf(['Multiply', 'x_r', 'PositiveInfinity'])).toBe('number');
      // Provably finite but possibly zero: still speculative.
      expect(typeOf(['Multiply', 'z_f', 'PositiveInfinity'])).toBe('number');
    });

    test('ElementMax/ElementMin/Clamp with a non-finite operand widen to number', () => {
      // Element-wise extrema use `numericTypeHandler`, which conservatively
      // widens to `number` when any operand may be non-finite (matching `Max`).
      expect(typeOf(['ElementMax', 'PositiveInfinity', 5])).toBe('number');
      expect(typeOf(['ElementMin', 'NegativeInfinity', 5])).toBe('number');
      expect(typeOf(['Clamp', 'x_r', 0, 'PositiveInfinity'])).toBe('number');
    });

    test('poles that evaluate to ~oo claim number, not complex/finite', () => {
      expect(typeOf(['Csc', 0])).toBe('number'); // was `complex`
      expect(typeOf(['Tan', ['Divide', 'Pi', 2]])).toBe('number'); // was `finite_real`
      expect(typeOf(['Sec', ['Divide', 'Pi', 2]])).toBe('number'); // was `finite_real`
      expect(typeOf(['Gamma', 0])).toBe('number'); // was `finite_real`
      expect(typeOf(['Gamma', -2])).toBe('number');
      expect(typeOf(['Zeta', 1])).toBe('number'); // was `finite_real`
      expect(typeOf(['Factorial', -2])).toBe('number'); // was `finite_real`
    });

    test('√(−∞) = i·∞ = ~oo claims number, not complex', () =>
      expect(typeOf(['Sqrt', 'NegativeInfinity'])).toBe('number'));

    test('Round of ~oo claims number, not non_finite_number', () =>
      expect(typeOf(['Round', 'ComplexInfinity'])).toBe('number'));

    test('∞/∞ (= NaN) stays number', () =>
      expect(typeOf(['Divide', 'PositiveInfinity', 'PositiveInfinity'])).toBe(
        'number'
      ));
  });

  describe('the ~oo VALUE types number, like every derived ~oo', () => {
    // The lattice cannot represent `~oo` (non_finite_number = ±∞ only), and
    // the convention resolves that by admitting it at the top type `number`
    // only — never at `complex`. The VALUE and the symbol obey it too: they
    // used to type `complex`, which made two expressions with the same `~oo`
    // value type differently depending on whether the constant survived
    // canonicalization, and put a `{re, im}` object into compiled output that
    // a real-emitting parent read as a number.
    test('ComplexInfinity value/symbol', () => {
      expect(ce.ComplexInfinity.type.toString()).toBe('number');
      // `1/0` canonicalizes directly to the ~oo value (`x/0 → ~∞` fold),
      // so this reports the value's type, not a Divide handler claim.
      expect(typeOf(['Divide', 1, 0])).toBe('number');
    });

    test('~oo takes no sign from a factor', () => {
      // The VALUE side of the same convention, and the reason it needs its own
      // pins: every assertion in this file is a TYPE assertion, and `~oo` and
      // `±oo` both type `number`, so a wrong VALUE here is invisible to them.
      // `Multiply` used to read `~oo` as if it were `+oo` and hand it the
      // coefficient's sign, which contradicted `Negate` — `-2·~oo` answered
      // `-oo` while `-(2·~oo)` answered `~oo`.
      const v = (expr: any) => ce.box(expr).evaluate().toString();
      expect(v(['Negate', 'ComplexInfinity'])).toBe('~oo');
      expect(v(['Multiply', 2, 'ComplexInfinity'])).toBe('~oo');
      expect(v(['Multiply', -2, 'ComplexInfinity'])).toBe('~oo');
      expect(v(['Multiply', 'ImaginaryUnit', 'ComplexInfinity'])).toBe('~oo');
      // A real ±∞ turned in a non-real direction (`∞·i`) is NOT covered here:
      // the comment on the negative-control test above reads it as `~oo`,
      // while `imaginary-unit-spelling.test.ts` pins its `evaluate()` to
      // `NaN` and calls that long-standing and deliberate. The two disagree,
      // and settling it is a separate question from the undirected-factor
      // rule pinned here.
      // The indeterminate form is untouched, and so are the SIGNED infinities:
      // only an undirected factor skips the sign rule.
      expect(v(['Multiply', 0, 'ComplexInfinity'])).toBe('NaN');
      // NaN poisons the product in BOTH operand orders — `~oo` absorbs
      // factors, but not this one. Both orders are asserted because the two
      // numeric-value lanes differ in where they test the receiver's own NaN.
      expect(v(['Multiply', 'NaN', 'ComplexInfinity'])).toBe('NaN');
      expect(v(['Multiply', 'ComplexInfinity', 'NaN'])).toBe('NaN');
      expect(v(['Multiply', 2, 'PositiveInfinity'])).toBe('+oo');
      expect(v(['Multiply', -2, 'PositiveInfinity'])).toBe('-oo');
      expect(v(['Multiply', -2, 'NegativeInfinity'])).toBe('+oo');
    });

    test('every spelling of ~oo agrees', () => {
      // The point of the convention: same value, same type, whichever route
      // produced it.
      for (const expr of [
        'ComplexInfinity',
        ['Divide', 1, 0],
        ['Divide', 'ComplexInfinity', 5],
        ['Add', 1, 'ComplexInfinity'],
        ['Factorial', -1],
        ['Gamma', -2],
        ['Zeta', 1],
      ] as any[])
        expect(typeOf(expr)).toBe('number');
    });
  });

  describe('a non-finite component: ~oo if the IMAGINARY part is infinite', () => {
    // A finite complex number requires BOTH components finite, so a value
    // with a non-finite component is never `finite_complex`. Which type it
    // does get follows the engine's own `~oo` test, `isComplexInfinity` in
    // the numeric-value type getters, which asks whether the IMAGINARY part
    // is infinite — and that is exactly the set of values the engine prints
    // as `~oo` (`1 + ∞i` and `0 + ∞i` both render `~oo`, while `∞ + i`
    // renders `(Infinity + i)`). So an infinite imaginary part types
    // `number`, with the undirected infinities, and an infinite real part
    // paired with a FINITE imaginary part stays `complex`. `imaginary` is
    // reserved for a finite non-zero imaginary part paired with a zero real
    // part.
    //
    // Both numeric-value lanes are exercised: the default engine (precision
    // 21) uses BigNumericValue; a machine-precision engine uses
    // MachineNumericValue.
    let savedPrecision: number;
    let ceMachine: ComputeEngine;
    beforeAll(() => {
      savedPrecision = BigDecimal.precision;
      ceMachine = new ComputeEngine();
      ceMachine.precision = 'machine';
    });
    afterAll(() => {
      BigDecimal.precision = savedPrecision;
    });

    const inf = { num: '+Infinity' };
    // A high-precision imaginary literal forces the BigNumericValue lane even
    // for the default engine.
    const hiPrec = { num: '1.00000000000000000000000001' };

    test('bignum lane (default engine, precision 21)', () => {
      expect(typeOf(['Complex', inf, 1])).toBe('complex'); // ∞ + i
      expect(typeOf(['Complex', 1, inf])).toBe('number'); // 1 + ∞i, prints ~oo
      expect(typeOf(['Complex', 0, inf])).toBe('number'); // 0 + ∞i, prints ~oo
      // ∞ real part with a high-precision (bignum) imaginary part
      expect(typeOf(['Complex', inf, hiPrec])).toBe('complex');
    });

    test('machine lane (precision = machine)', () => {
      const t = (expr: any) => ceMachine.box(expr).type.toString();
      expect(t(['Complex', inf, 1])).toBe('complex'); // ∞ + i
      expect(t(['Complex', 1, inf])).toBe('number'); // 1 + ∞i, prints ~oo
      expect(t(['Complex', 0, inf])).toBe('number'); // 0 + ∞i, prints ~oo
    });

    test('the type follows the printed form', () => {
      // The tell that the split above is principled rather than incidental:
      // a value types `number` exactly when the engine renders it `~oo`.
      const render = (expr: any) => ce.box(expr).toString();
      expect(render(['Complex', 1, inf])).toBe('~oo');
      expect(render(['Complex', 0, inf])).toBe('~oo');
      expect(render(['Complex', inf, 1])).not.toBe('~oo');
    });

    test('finite complex values keep their finite types', () => {
      expect(typeOf(['Complex', 2, 3])).toBe('finite_complex');
      expect(typeOf(['Complex', 0, 3])).toBe('imaginary');
    });
  });

  describe('generic-point convention and finite claims are preserved', () => {
    test('generic real symbol stays a generic (finite) point', () => {
      expect(typeOf(['Sin', 'x_r'])).toBe('finite_real');
      expect(typeOf(['Ceil', 'x_r'])).toBe('finite_integer');
      expect(typeOf(['Gamma', 'x_r'])).toBe('finite_real');
    });

    test('rounding a finite complex is finite_complex (was mistyped non_finite_number)', () => {
      expect(typeOf(['Round', 'ImaginaryUnit'])).toBe('finite_complex');
      expect(typeOf(['Truncate', ['Complex', 2.5, 1]])).toBe('finite_complex');
    });

    test('non-pole exact special values keep their finite types', () => {
      expect(typeOf(['Zeta', 2])).toBe('finite_real');
      expect(typeOf(['Gamma', ['Rational', 1, 2]])).toBe('finite_real');
      expect(typeOf(['EllipticK', ['Rational', 1, 2]])).toBe('finite_real');
    });
  });

  describe('a symbol’s declared type decides its finiteness predicates', () => {
    // A symbol with no value has only its type to go on. `non_finite_number`
    // is exactly the signed infinities, so it proves BOTH predicates —
    // mirroring the type consult in `BoxedFunction.isInfinity` that decides
    // `Ln(0)`. The three arithmetic type handlers below rely on it: they test
    // `isFinite === false` alone, with no type disjunct of their own.
    test('a `non_finite_number` symbol is decided by its type', () => {
      const s = ce.box('nf_sym');
      expect(s.isInfinity).toBe(true);
      expect(s.isFinite).toBe(false);
    });

    test('a `finite_number` symbol stays finite (unchanged fallback)', () => {
      const s = ce.box('f_sym');
      expect(s.isFinite).toBe(true);
      expect(s.isInfinity).toBe(undefined);
    });

    test('a generic `real` symbol decides neither (control)', () => {
      const s = ce.box('x_r');
      expect(s.isFinite).toBe(undefined);
      expect(s.isInfinity).toBe(undefined);
    });

    test('an assigned value still decides, ahead of the type', () => {
      // The type consult fires only where the value does not decide.
      expect(ce.box('inf_val').isInfinity).toBe(true);
      expect(ce.box('inf_val').isFinite).toBe(false);
      expect(ce.box('three_val').isInfinity).toBe(false);
      expect(ce.box('three_val').isFinite).toBe(true);
    });

    // Regression pins for the three arithmetic type handlers (Add, Multiply,
    // Divide) that used to carry a `|| x.type.matches('non_finite_number')`
    // disjunct purely because symbol operands were type-blind.
    test('arithmetic over a `non_finite_number` symbol types soundly', () => {
      // Without a decided `isFinite`, this fell through to the "every operand
      // is finite" tail and claimed `finite_integer` — unsound.
      expect(typeOf(['Multiply', 2, 'nf_sym'])).toBe('non_finite_number');
      expect(typeOf(['Add', 1, 'nf_sym'])).toBe('non_finite_number');
      expect(typeOf(['Divide', 'nf_sym', 2])).toBe('non_finite_number');
      expect(typeOf(['Divide', 1, 'nf_sym'])).toBe('finite_integer');
      // ∞/∞ is indeterminate.
      expect(typeOf(['Divide', 'nf_sym', 'nf_sym'])).toBe('number');
    });

    test('arithmetic over a type-only-provable ±∞ function types soundly', () => {
      expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Add', 1, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Divide', ['Ln', 0], 2])).toBe('non_finite_number');
      expect(typeOf(['Divide', 1, ['Ln', 0]])).toBe('finite_integer');
    });
  });

  describe('a NON-NUMBER operand does not prove its result non-finite', () => {
    // `isFinite` answers `false` for anything that is not a number at all —
    // a tuple, a list, a string. That `false` means "not a finite NUMBER",
    // and the heads that propagate an operand's finiteness structurally
    // (`Abs`, `Sqrt`) must not read it as "infinite". `Abs` is where this
    // bites, because over a tuple it is the Euclidean norm: the result is a
    // number whose OPERAND is not.
    //
    // Consequence when it was read as "infinite": `|(1, 2)|` claimed to be
    // non-finite, so `3·|(1, 2)|` typed `non_finite_number`, and `Divide`
    // applied the sound `1/±∞ = 0` fold to it. `1/(3·|(1, 2)|)` canonicalized
    // to a literal `0` — not an error and not a NaN, a silently wrong value
    // where the answer is √5/15. Reported from a consumer's field use, where
    // it turned a unit-tangent field into the zero vector.
    //
    // Each shape gets a FRESH engine: this collapse was originally mapped on
    // one shared engine and the accumulated declarations changed which shapes
    // reproduced, yielding a precondition that was wrong in both directions.
    const freshType = (expr: any): string =>
      new ComputeEngine().box(expr).type.toString();
    const freshJson = (expr: any): any => new ComputeEngine().box(expr).json;

    test('the norm of a tuple is not claimed non-finite', () => {
      const engine = new ComputeEngine();
      const norm = engine.box(['Abs', ['Tuple', 1, 2]]);
      expect(norm.type.toString()).toBe('finite_real');
      // Undecided, not `false`. Deciding it `true` would mean walking the
      // components; `Norm(Tuple(1, 2))`, the sibling that never had the bug,
      // reports `undefined` here as well.
      expect(norm.isFinite).toBe(undefined);
      expect(engine.box(['Norm', ['Tuple', 1, 2]]).isFinite).toBe(undefined);
    });

    test('a scaled tuple norm keeps a finite type', () => {
      expect(freshType(['Multiply', 3, ['Abs', ['Tuple', 1, 2]]])).toBe(
        'finite_real'
      );
    });

    test('dividing by a scaled tuple norm does not fold to zero', () => {
      // The reported witness, plus the three neighbours that separate the
      // precondition: any numeric coefficient triggers it, the numerator is
      // irrelevant, and a non-literal member does not protect it.
      for (const expr of [
        ['Divide', 1, ['Multiply', 3, ['Abs', ['Tuple', 1, 2]]]],
        ['Divide', 1, ['Multiply', ['Rational', 1, 2], ['Abs', ['Tuple', 1, 2]]]],
        ['Divide', 'x', ['Multiply', 3, ['Abs', ['Tuple', 1, 2]]]],
        ['Divide', 1, ['Multiply', 3, ['Abs', ['Tuple', ['Cos', 't'], 2]]]],
      ])
        expect(freshJson(expr)).not.toEqual(0);

      const engine = new ComputeEngine();
      const witness = engine.box([
        'Divide',
        1,
        ['Multiply', 3, ['Abs', ['Tuple', 1, 2]]],
      ]);
      expect(witness.evaluate().toString()).toBe('sqrt(5)/15');
      expect(witness.N().re).toBeCloseTo(Math.sqrt(5) / 15, 12);
    });

    test('the LaTeX route agrees', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('\\frac{1}{3\\vert(1,2)\\vert}').N().re).toBeCloseTo(
        Math.sqrt(5) / 15,
        12
      );
    });

    test('a genuinely infinite operand still folds (control)', () => {
      // The `1/±∞ = 0` fold is correct and must survive: the fix removes an
      // unsound CLAIM of non-finiteness, not the fold that acts on a sound
      // one. `Abs(∞)` proves non-finite through its type, not through this
      // structural propagation.
      const engine = new ComputeEngine();
      expect(engine.box(['Abs', 'PositiveInfinity']).isFinite).toBe(false);
      expect(
        engine.box(['Divide', 1, ['Multiply', 3, ['Abs', 'PositiveInfinity']]])
          .json
      ).toEqual(0);
      expect(freshJson(['Divide', 1, ['Multiply', 3, ['Ln', 0]]])).toEqual(0);
    });

    test('Sqrt of a non-number is undecided, not non-finite', () => {
      // `Sqrt(Tuple(1, 2))` is admitted with type `number` rather than
      // rejected, so the same propagation applies. It folds nothing today —
      // the product type also requires every factor to be provably real —
      // so this pins the claim itself rather than a downstream value.
      const engine = new ComputeEngine();
      expect(engine.box(['Sqrt', ['Tuple', 1, 2]]).isFinite).toBe(undefined);
      expect(engine.box(['Sqrt', ['Tuple', 1, 2]]).isNumber).toBe(true);
      // Numeric operands are untouched.
      expect(engine.box(['Sqrt', 5]).isFinite).toBe(true);
      expect(engine.box(['Abs', -5]).isFinite).toBe(true);
    });
  });
});
