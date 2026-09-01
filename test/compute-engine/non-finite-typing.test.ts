/**
 * Non-finite typing under the finite-by-default numeric lattice.
 *
 * The bare numeric names contain only finite values, and the values of
 * infinite magnitude have their own names: the singletons `+oo`, `-oo` and
 * `~oo`, the signed pair `signed_infinity` — the union of the first two — and the
 * tier `infinity` above all three. `nan` names the NaN marker. The rules the
 * type handlers follow:
 *
 * - `signed_infinity` is claimed ONLY when the value is provably a SIGNED
 *   real infinity — it is the guarantee the sign-aware folds (`1/±∞ = 0`)
 *   consume.
 * - When ±∞/`~oo`/NaN is merely POSSIBLE, the claim is the top type `number`
 *   — never a finite type, and never a speculative `signed_infinity`.
 * - A VALUE that is provably infinite carries its own singleton type: `~oo`
 *   for the unsigned infinity, `+oo`/`-oo` for the signed pair.
 *   A mixed directed value such as `∞ + i` has no singleton spelling and
 *   carries the tier `infinity` (ruling L2(a)).
 * - Unknown finiteness is a generic point (finite); zero-ness must be proven.
 *
 * The last block pins the ADMISSION side of the same change: a parameter
 * declared with a bare numeric name now rejects an infinite argument at the
 * signature, before the operator's handler runs.
 */
import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { getExpressionDatatype } from '../../src/compute-engine/tensor/tensor-fields';
import { packTensor } from '../../src/compute-engine/boxed-expression/tensor-view';

function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

describe('NON-FINITE TYPING CONVENTION', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('x_r', 'real'); // real: FINITE by the bare name, sign unknown
    // Generic point of the EXTENDED real line: real-ness proven, finiteness
    // unknown. The bare name `real` no longer spells this — it denotes the
    // finite reals — so a control for "unknown finiteness" must name the
    // union.
    ce.declare('xr_u', 'real | signed_infinity');
    ce.declare('z_f', 'real'); // provably finite, sign unknown
    ce.declare('nf_sym', 'signed_infinity'); // provably ±∞, no value
    ce.declare('f_sym', 'complex'); // provably finite, no value
    ce.declare('inf_val', 'number');
    ce.assign('inf_val', ce.PositiveInfinity); // decided by its VALUE
    ce.declare('three_val', 'number');
    ce.assign('three_val', 3); // decided by its VALUE
    ce.assume(ce.box(['Greater', 'p_r', 0])); // provably positive real
  });
  afterAll(() => ce.popScope());

  describe('provably ±∞ → signed_infinity', () => {
    test('Ln(0) = −∞', () =>
      expect(typeOf(['Ln', 0])).toBe('signed_infinity'));

    test('Log(0, 3) = −∞', () =>
      expect(typeOf(['Log', 0, 3])).toBe('signed_infinity'));

    test('EllipticK(1) = +∞', () =>
      expect(typeOf(['EllipticK', 1])).toBe('signed_infinity'));

    test('Round/Floor of a real ±∞', () => {
      // Rounding a signed infinity gives that same infinity back. The
      // rounding type handler proves realness against the EXTENDED real line
      // (`roundingFunctionType`, `library/type-handlers-types.ts`), which is
      // what makes this arm reachable: a signed infinity does not match the
      // bare name `real`, which denotes the finite reals.
      expect(typeOf(['Round', 'PositiveInfinity'])).toBe('signed_infinity');
      expect(typeOf(['Floor', 'NegativeInfinity'])).toBe('signed_infinity');
    });

    test('±∞ · provably non-zero real', () =>
      expect(typeOf(['Multiply', 'p_r', 'PositiveInfinity'])).toBe(
        'signed_infinity'
      ));

    test('±∞ + real terms (generic-point finiteness)', () =>
      expect(typeOf(['Add', 'x_r', 'PositiveInfinity'])).toBe(
        'signed_infinity'
      ));

    // A provably non-finite TERM may be visible only in its static type:
    // `Ln(0)` types `signed_infinity` while its structural `isFinite` stays
    // `undefined`. The Add/Multiply/Divide handlers must consult the type —
    // without it, `1 + Ln(0)` widened to `integer` and `2·Ln(0)` claimed
    // `integer` (unsound; the value is −∞). Fixed 2026-07-31.
    test('a type-only-provable −∞ term: 1 + Ln(0)', () => {
      expect(typeOf(['Add', 1, ['Ln', 0]])).toBe('signed_infinity');
      expect(typeOf(['Add', 1, ['Artanh', 1]])).toBe('signed_infinity');
    });

    // Ruling 2026-08-03: a provably non-finite REAL factor is implicitly
    // non-zero (`±∞ ≠ 0` is a theorem), so a proven sign is required only of
    // the FINITE factors. `Ln(0)` has sgn `non-positive` — not a proven
    // non-zero sign — yet `2·Ln(0) = −∞`. Before the ruling both of these
    // widened to `number`.
    test('a provably non-finite real factor is implicitly nonzero (ruling 2026-08-03)', () => {
      expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('signed_infinity');
      expect(typeOf(['Multiply', 2, ['Artanh', 1]])).toBe('signed_infinity');
      // `Ln(0)/2` canonicalizes to `Multiply(1/2, Ln(0))`, so this is the
      // Multiply handler too.
      expect(typeOf(['Divide', ['Ln', 0], 2])).toBe('signed_infinity');
    });

    test('non-finite real numerator over a finite non-zero real denominator', () => {
      // Canonically, `Ln(0)/π` no longer survives as a Divide: `canonicalDivide`
      // folds `±∞/finite-nonzero` to the numerator (`Ln(0)`), which types
      // `signed_infinity` on its own. The observable claim is unchanged.
      const canonical = ce.box(['Divide', ['Ln', 0], 'Pi']);
      expect(canonical.operator).toBe('Ln');
      expect(canonical.type.toString()).toBe('signed_infinity');
      // The structural route keeps the Divide head and exercises the Divide
      // type handler's tight branch directly.
      const structural = ce.function('Divide', [ce.box(['Ln', 0]), ce.Pi], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('signed_infinity');
    });

    test('negative controls: the non-finite factor must be REAL, finite factors keep their sign obligation', () => {
      // `∞·i = ~oo`, not a signed infinity — `isFinite === false` does not
      // imply real. The VALUE is pinned separately below ("~oo takes no sign
      // from a factor"); here the claim is only that the TYPE cannot be
      // `signed_infinity`, which admits ±∞ alone.
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
      // the ~oo VALUE, which carries the `~oo` singleton type; the structural
      // route below keeps the Divide head, so it reports the handler's claim
      // (`number`) instead.
      expect(typeOf(['Divide', 'ComplexInfinity', 5])).toBe('~oo');
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
      expect(typeOf(['Divide', 2, ['Ln', 0]])).toBe('0');
      const structural = ce.function('Divide', [ce.box(2), ce.box(['Ln', 0])], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('integer');
      // A provably finite (possibly zero) real numerator is still exactly 0.
      expect(
        ce
          .function('Divide', [ce.box('z_f'), ce.box(['Ln', 0])], {
            structural: true,
          })
          .type.toString()
      ).toBe('integer');
    });

    test('negative controls for `finite/±∞`: numerator finiteness and realness are obligations', () => {
      const divide = (num: any, den: any) =>
        ce
          .function('Divide', [ce.box(num), ce.box(den)], { structural: true })
          .type.toString();
      // Unknown-finiteness numerator admits `∞/∞` = NaN. The numerator must
      // be an extended real whose finiteness is genuinely open: a `real`
      // numerator is FINITE by the bare name, so it takes the `finite/±∞ = 0`
      // arm above instead (asserted below).
      expect(divide('xr_u', ['Ln', 0])).toBe('number');
      expect(divide('x_r', ['Ln', 0])).toBe('integer');
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
      ce.declare('nf_u', 'signed_infinity');
      // `nf_u + 1` is provably infinite and real, but its direction is
      // unproven: the projection falls through to the AsciiMath form instead
      // of guessing complex infinity (it used to return `'~oo'`).
      const e = ce.box(['Add', 'nf_u', 1]);
      expect(e.isInfinity).toBe(true);
      expect(e.isExtendedReal).toBe(true);
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
      expect(typeOf(['Tan', ['Divide', 'Pi', 2]])).toBe('number'); // was `real`
      expect(typeOf(['Sec', ['Divide', 'Pi', 2]])).toBe('number'); // was `real`
      expect(typeOf(['Gamma', 0])).toBe('number'); // was `real`
      expect(typeOf(['Gamma', -2])).toBe('number');
      expect(typeOf(['Zeta', 1])).toBe('number'); // was `real`
      expect(typeOf(['Factorial', -2])).toBe('number'); // was `real`
    });

    test('√(−∞) = i·∞ = ~oo claims number, not complex', () =>
      expect(typeOf(['Sqrt', 'NegativeInfinity'])).toBe('number'));

    test('Round of ~oo is a boxing error (Phase F extended-real carrier)', () =>
      expect(ce.box(['Round', 'ComplexInfinity'] as any).isValid).toBe(false));

    test('∞/∞ folds to the NaN value, which carries the NaN singleton', () => {
      // The canonical route folds this to the NaN VALUE, so the type read is
      // the literal's, not a handler claim: a NaN literal types as the `NaN`
      // singleton and widens to the `nan` tier.
      const e = ce.box(['Divide', 'PositiveInfinity', 'PositiveInfinity']);
      expect(e.type.toString()).toBe('NaN');
      expect(e.type.matches('nan')).toBe(true);
      expect(e.type.matches('real')).toBe(false);
    });
  });

  describe('the ~oo VALUE carries the ~oo singleton', () => {
    // The lattice names `~oo` directly now: it is a value-literal type under
    // the `infinity` tier, disjoint from the signed pair (it has no sign) and
    // from `complex` (it is not finite). Every route that produces the value
    // reports the same type, which is what the convention was always after —
    // two expressions holding the same `~oo` used to type differently
    // depending on whether the constant survived canonicalization.
    test('ComplexInfinity value/symbol', () => {
      expect(ce.ComplexInfinity.type.toString()).toBe('~oo');
      expect(ce.ComplexInfinity.type.matches('infinity')).toBe(true);
      expect(ce.ComplexInfinity.type.matches('signed_infinity')).toBe(false);
      expect(ce.ComplexInfinity.type.matches('complex')).toBe(false);
      // `1/0` canonicalizes directly to the ~oo value (`x/0 → ~∞` fold),
      // so this reports the value's type, not a Divide handler claim.
      expect(typeOf(['Divide', 1, 0])).toBe('~oo');
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
      // A real ±∞ turned in a non-real direction lands on the same single
      // point at infinity: the product is infinite and has no real direction
      // left, which is what `~oo` represents. Any non-real factor does it,
      // not just `i`.
      expect(v(['Multiply', 'PositiveInfinity', 'ImaginaryUnit'])).toBe('~oo');
      expect(v(['Multiply', 'NegativeInfinity', 'ImaginaryUnit'])).toBe('~oo');
      expect(v(['Multiply', 'PositiveInfinity', ['Complex', 2, 3]])).toBe(
        '~oo'
      );
      expect(v(['Multiply', 'NegativeInfinity', ['Complex', 2, -3]])).toBe(
        '~oo'
      );
      // The infinity does not have to be a literal, and the non-real factor
      // does not have to come second: a non-real COEFFICIENT turns an
      // evaluated real infinity off the real line just as squarely, and the
      // sign rule cannot express that (`sgn()` of a non-real coefficient is
      // undefined, which reads as positive).
      expect(v(['Multiply', 'ImaginaryUnit', ['Ln', 0]])).toBe('~oo');
      expect(v(['Multiply', ['Ln', 0], 'ImaginaryUnit'])).toBe('~oo');
      expect(v(['Multiply', ['Complex', 2, 3], ['Ln', 0]])).toBe('~oo');
      // The control: the same `ln(0)` keeps its sign against a REAL factor.
      expect(v(['Ln', 0])).toBe('-oo');
      expect(v(['Multiply', 2, ['Ln', 0]])).toBe('-oo');
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

    test('~oo absorbs a sum, including one holding a real infinity', () => {
      // `Add` recognizes `~oo` by VALUE. It used to select it by asking
      // whether the term typed `complex`, which stopped selecting anything
      // once `~oo` moved to `number` — and the signed-infinity counters that
      // then took over track only real ±∞, so `∞ + ~oo` dropped the `~oo`
      // term and answered `+oo`.
      const v = (expr: any) => ce.box(expr).evaluate().toString();
      expect(v(['Add', 2, 'ComplexInfinity'])).toBe('~oo');
      expect(v(['Add', 'PositiveInfinity', 'ComplexInfinity'])).toBe('~oo');
      expect(v(['Add', 'NegativeInfinity', 'ComplexInfinity'])).toBe('~oo');
      // The route that made this reachable from ordinary input: the inner
      // product is `~oo` now, where it used to be NaN.
      expect(
        v([
          'Add',
          'PositiveInfinity',
          ['Multiply', 'ImaginaryUnit', 'PositiveInfinity'],
        ])
      ).toBe('~oo');
      // Controls: two REAL infinities keep their own rules.
      expect(v(['Add', 'PositiveInfinity', 'NegativeInfinity'])).toBe('NaN');
      expect(v(['Add', 'PositiveInfinity', 2])).toBe('+oo');
    });

    test('the numeric-value scalar overloads agree with the boxed route', () => {
      // `i.mul(Infinity)` goes through the SCALAR overload of `mul`, which
      // does its own component arithmetic and never reaches the general
      // complex path — so it needs its own rule and its own pin, or it
      // computes `0 · ∞` for the real part and answers NaN while the boxed
      // `Multiply` answers `~oo`.
      const i = ce.I as unknown as { _value: { mul(x: number): unknown } };
      expect(String(i._value.mul(Infinity))).toBe('~oo');
      expect(String(i._value.mul(-Infinity))).toBe('~oo');
      // A finite scalar is untouched.
      expect(String(i._value.mul(2))).toBe('2i');
    });

    test('every spelling of ~oo agrees', () => {
      // The point of the convention: same value, same type, whichever route
      // produced it. These four routes all fold to the `~oo` VALUE at
      // canonicalization, so they report the singleton.
      for (const expr of [
        'ComplexInfinity',
        ['Divide', 1, 0],
        ['Divide', 'ComplexInfinity', 5],
      ] as any[])
        expect(typeOf(expr)).toBe('~oo');
      // The poles below do NOT fold at canonicalization: they are unevaluated
      // applications, so what is read is the type HANDLER's claim, and a
      // handler that cannot prove which infinity it will produce claims the
      // top type. Evaluating them reaches the same `~oo` value as the routes
      // above.
      for (const expr of [
        ['Add', 1, 'ComplexInfinity'],
        ['Factorial', -1],
        ['Gamma', -2],
        ['Zeta', 1],
      ] as any[]) {
        expect(typeOf(expr)).toBe('number');
        expect(ce.box(expr).evaluate().type.toString()).toBe('~oo');
      }
    });
  });

  describe('a non-finite component: ~oo if the IMAGINARY part is infinite', () => {
    // A finite complex number requires BOTH components finite, so a value
    // with a non-finite component is never `complex` at all — `complex` is
    // finite now. Which type it does get follows the engine's own `~oo` test,
    // `isComplexInfinity` in the numeric-value type getters, which asks
    // whether the IMAGINARY part is infinite — and that is exactly the set of
    // values the engine prints as `~oo` (`1 + ∞i` and `0 + ∞i` both render
    // `~oo`, while `∞ + i` renders `(Infinity + i)`). So an infinite imaginary
    // part carries the `~oo` singleton, and an infinite REAL part paired with
    // a finite imaginary part carries the tier `infinity`: it has a direction,
    // so it is not `~oo`, and it has no singleton spelling of its own (ruling
    // L2(a)). `imaginary` is reserved for a finite non-zero imaginary part
    // paired with a zero real part.
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
      expect(typeOf(['Complex', inf, 1])).toBe('infinity'); // ∞ + i
      expect(typeOf(['Complex', 1, inf])).toBe('~oo'); // 1 + ∞i, prints ~oo
      expect(typeOf(['Complex', 0, inf])).toBe('~oo'); // 0 + ∞i, prints ~oo
      // ∞ real part with a high-precision (bignum) imaginary part
      expect(typeOf(['Complex', inf, hiPrec])).toBe('infinity');
    });

    test('machine lane (precision = machine)', () => {
      const t = (expr: any) => ceMachine.box(expr).type.toString();
      expect(t(['Complex', inf, 1])).toBe('infinity'); // ∞ + i
      expect(t(['Complex', 1, inf])).toBe('~oo'); // 1 + ∞i, prints ~oo
      expect(t(['Complex', 0, inf])).toBe('~oo'); // 0 + ∞i, prints ~oo
    });

    test('every non-finite component lands under `infinity`', () => {
      // Whatever the direction, the value has infinite magnitude and is
      // outside the finite `complex` subtree.
      for (const expr of [
        ['Complex', inf, 1],
        ['Complex', 1, inf],
        ['Complex', 0, inf],
      ] as any[]) {
        expect(ce.box(expr).type.matches('infinity')).toBe(true);
        expect(ce.box(expr).type.matches('complex')).toBe(false);
      }
    });

    test('the type follows the printed form', () => {
      // The tell that the split above is principled rather than incidental:
      // a value types `~oo` exactly when the engine renders it `~oo`.
      const render = (expr: any) => ce.box(expr).toString();
      expect(render(['Complex', 1, inf])).toBe('~oo');
      expect(render(['Complex', 0, inf])).toBe('~oo');
      expect(render(['Complex', inf, 1])).not.toBe('~oo');
    });

    test('finite complex values keep their finite types', () => {
      expect(typeOf(['Complex', 2, 3])).toBe('complex');
      expect(typeOf(['Complex', 0, 3])).toBe('imaginary');
    });
  });

  describe('generic-point convention and finite claims are preserved', () => {
    test('generic real symbol stays a generic (finite) point', () => {
      expect(typeOf(['Sin', 'x_r'])).toBe('real');
      expect(typeOf(['Ceil', 'x_r'])).toBe('integer');
      expect(typeOf(['Gamma', 'x_r'])).toBe('real');
    });

    test('rounding a finite complex is a boxing error (Phase F extended-real carrier)', () => {
      expect(ce.box(['Round', 'ImaginaryUnit'] as any).isValid).toBe(false);
      expect(ce.box(['Truncate', ['Complex', 2.5, 1]] as any).isValid).toBe(
        false
      );
    });

    test('non-pole exact special values keep their finite types', () => {
      expect(typeOf(['Zeta', 2])).toBe('real');
      expect(typeOf(['Gamma', ['Rational', 1, 2]])).toBe('real');
      expect(typeOf(['EllipticK', ['Rational', 1, 2]])).toBe('real');
    });
  });

  describe('a symbol’s declared type decides its finiteness predicates', () => {
    // A symbol with no value has only its type to go on. `signed_infinity`
    // is exactly the signed infinities, so it proves BOTH predicates —
    // mirroring the type consult in `BoxedFunction.isInfinity` that decides
    // `Ln(0)`. The three arithmetic type handlers below rely on it: they test
    // `isFinite === false` alone, with no type disjunct of their own.
    test('a `signed_infinity` symbol is decided by its type', () => {
      const s = ce.box('nf_sym');
      expect(s.isInfinity).toBe(true);
      expect(s.isFinite).toBe(false);
    });

    test('a `complex` symbol is decided by its type too', () => {
      // Both predicates are decided: a finite number is finite, and it has no
      // value in common with `infinity`, so it is provably not an infinity.
      const s = ce.box('f_sym');
      expect(s.isFinite).toBe(true);
      expect(s.isInfinity).toBe(false);
    });

    test('a `real` symbol is decided by its type: the bare name is finite', () => {
      const s = ce.box('x_r');
      expect(s.isFinite).toBe(true);
      expect(s.isInfinity).toBe(false);
    });

    test('an extended-real symbol decides neither (control)', () => {
      // `real | signed_infinity` is the generic point of the extended real
      // line: it is below neither `complex` nor `infinity`, so nothing
      // is proven either way.
      const s = ce.box('xr_u');
      expect(s.isFinite).toBe(undefined);
      expect(s.isInfinity).toBe(undefined);
      // …but real-ness IS proven, and the union must be recognized as a
      // whole: a member-wise `<: real` / `<: signed_infinity` test would
      // leave it undecided.
      expect(s.isExtendedReal).toBe(true);
    });

    test('a NaN-valued symbol is not on the extended real line', () => {
      // NaN is neither a finite real nor a signed infinity, so the predicate
      // is refuted, not left open. The type (`nan`) is what proves it: it
      // shares no value with either disjunct.
      const eng = new ComputeEngine();
      eng.assign('nan_val', eng.box(NaN));
      expect(eng.box('nan_val').isExtendedReal).toBe(false);
      expect(eng.box('nan_val').isInfinity).toBe(false);
    });

    test('an assigned value still decides, ahead of the type', () => {
      // The type consult fires only where the value does not decide.
      expect(ce.box('inf_val').isInfinity).toBe(true);
      expect(ce.box('inf_val').isFinite).toBe(false);
      expect(ce.box('three_val').isInfinity).toBe(false);
      expect(ce.box('three_val').isFinite).toBe(true);
    });

    // Regression pins for the three arithmetic type handlers (Add, Multiply,
    // Divide) that used to carry a `|| x.type.matches('signed_infinity')`
    // disjunct purely because symbol operands were type-blind.
    test('arithmetic over a `signed_infinity` symbol types soundly', () => {
      // Without a decided `isFinite`, this fell through to the "every operand
      // is finite" tail and claimed `integer` — unsound.
      expect(typeOf(['Multiply', 2, 'nf_sym'])).toBe('signed_infinity');
      expect(typeOf(['Add', 1, 'nf_sym'])).toBe('signed_infinity');
      expect(typeOf(['Divide', 'nf_sym', 2])).toBe('signed_infinity');
      expect(typeOf(['Divide', 1, 'nf_sym'])).toBe('0');
      // ∞/∞ is indeterminate.
      // ∞/∞ is indeterminate: `canonicalDivide` folds it to the NaN VALUE,
      // whose type is the `NaN` singleton (widening to the `nan` tier).
      expect(typeOf(['Divide', 'nf_sym', 'nf_sym'])).toBe('NaN');
    });

    test('arithmetic over a type-only-provable ±∞ function types soundly', () => {
      expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('signed_infinity');
      expect(typeOf(['Add', 1, ['Ln', 0]])).toBe('signed_infinity');
      expect(typeOf(['Divide', ['Ln', 0], 2])).toBe('signed_infinity');
      expect(typeOf(['Divide', 1, ['Ln', 0]])).toBe('0');
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
    // non-finite, so `3·|(1, 2)|` typed `signed_infinity`, and `Divide`
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
      expect(norm.type.toString()).toBe('real');
      // Undecided, not `false`. Deciding it `true` would mean walking the
      // components; `Norm(Tuple(1, 2))`, the sibling that never had the bug,
      // reports `undefined` here as well.
      expect(norm.isFinite).toBe(undefined);
      expect(engine.box(['Norm', ['Tuple', 1, 2]]).isFinite).toBe(undefined);
    });

    test('a scaled tuple norm keeps a finite type', () => {
      expect(freshType(['Multiply', 3, ['Abs', ['Tuple', 1, 2]]])).toBe(
        'real'
      );
    });

    test('dividing by a scaled tuple norm does not fold to zero', () => {
      // The reported witness, plus the three neighbours that separate the
      // precondition: any numeric coefficient triggers it, the numerator is
      // irrelevant, and a non-literal member does not protect it.
      for (const expr of [
        ['Divide', 1, ['Multiply', 3, ['Abs', ['Tuple', 1, 2]]]],
        [
          'Divide',
          1,
          ['Multiply', ['Rational', 1, 2], ['Abs', ['Tuple', 1, 2]]],
        ],
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
      // `Sqrt(Set(1, 2))` is admitted with type `number` rather than
      // rejected, so the same propagation applies. It folds nothing today —
      // the product type also requires every factor to be provably real —
      // so this pins the claim itself rather than a downstream value.
      // A SET is the witness rather than a tuple: `Sqrt` maps over a tuple's
      // components, so `Sqrt((1, 2))` is a tuple of numbers and not a
      // non-number operand at all.
      const engine = new ComputeEngine();
      expect(engine.box(['Sqrt', ['Set', 1, 2]]).isFinite).toBe(undefined);
      expect(engine.box(['Sqrt', ['Set', 1, 2]]).isNumber).toBe(true);
      // Numeric operands are untouched.
      expect(engine.box(['Sqrt', 5]).isFinite).toBe(true);
      expect(engine.box(['Abs', -5]).isFinite).toBe(true);
    });
  });

  describe('a bare-name parameter rejects an infinite argument', () => {
    // The admission half of the finite-by-default flip. A parameter written
    // `integer` used to admit `±∞`, so a call such as `NthPrime(∞)` reached
    // the operator and stayed symbolic. The bare name now means a FINITE
    // integer, so the same call is rejected at the signature with
    // `incompatible-type` — an infinity is outside these operators'
    // mathematical domain, and signature-level rejection is the declared
    // contract doing its job.
    //
    // The rejection is pinned on BOTH routes (box and parse) because the
    // check runs during canonicalization, which both routes perform.
    const REJECTED: [name: string, expr: any, latex: string][] = [
      // library/number-theory.ts — `(integer) -> integer`
      ['NthPrime', ['NthPrime', { num: '+Infinity' }], '\\operatorname{NthPrime}(\\infty)'],
      ['IntegerSqrt', ['IntegerSqrt', { num: '+Infinity' }], '\\operatorname{IntegerSqrt}(\\infty)'],
      // library/combinatorics.ts — same shape
      ['Fibonacci', ['Fibonacci', { num: '+Infinity' }], '\\operatorname{Fibonacci}(\\infty)'],
      // library/collections.ts — the `count` parameter of `Repeat`
      ['Repeat', ['Repeat', 7, { num: '+Infinity' }], '\\operatorname{Repeat}(7, \\infty)'],
      // `Totient` and `Divides` used to declare `(number)` parameters, on the
      // stated grounds that an `integer` carrier would reject symbolic
      // operands at rule-boxing time. That is no longer how validation works:
      // it rejects only what the types PROVE disjoint, so every symbolic
      // operand is still admitted (see the test below) and only a provably
      // non-integer literal is refused. Both now take the same carrier as the
      // other number-theory heads.
      ['Totient', ['Totient', { num: '+Infinity' }], '\\operatorname{Totient}(\\infty)'],
      // `Divides` is binary, so BOTH slots are pinned.
      ['Divides (1st slot)', ['Divides', { num: '+Infinity' }, 2], '\\operatorname{Divides}(\\infty, 2)'],
      ['Divides (2nd slot)', ['Divides', 2, { num: '+Infinity' }], '\\operatorname{Divides}(2, \\infty)'],
    ];

    test.each(REJECTED)('%s rejects an infinite argument (box route)', (
      _name,
      expr
    ) => {
      const engine = new ComputeEngine();
      const x = engine.box(expr);
      expect(x.type.toString()).toBe('error');
      expect(x.toString()).toContain('incompatible-type');
      // Evaluation does not rescue it: the error operand is carried through.
      expect(x.evaluate().toString()).toContain('incompatible-type');
    });

    test.each(REJECTED)('%s rejects an infinite argument (parse route)', (
      _name,
      _expr,
      latex
    ) => {
      const engine = new ComputeEngine();
      expect(engine.parse(latex).toString()).toContain('incompatible-type');
    });

    test('a FINITE argument of the same head is untouched', () => {
      const engine = new ComputeEngine();
      expect(engine.box(['NthPrime', 5]).evaluate().toString()).toBe('11');
      expect(engine.box(['Fibonacci', 10]).evaluate().toString()).toBe('55');
      expect(engine.box(['Repeat', 7, 3]).evaluate().toString()).toBe(
        '[7,7,7]'
      );
      expect(engine.box(['Totient', 12]).evaluate().toString()).toBe('4');
      expect(engine.box(['Divides', 3, 12]).evaluate().toString()).toBe(
        '"True"'
      );
      expect(engine.box(['Divides', 4, 10]).evaluate().toString()).toBe(
        '"False"'
      );
      // `NotDivides` canonicalizes to `Not(Divides(…))`, so it inherits the
      // carrier and must agree.
      expect(engine.box(['NotDivides', 4, 10]).evaluate().toString()).toBe(
        '"True"'
      );
    });

    test('an `integer` carrier still admits every SYMBOLIC operand', () => {
      // The reason the `(number)` spellings on `Totient`/`Divides` were not
      // needed: validation rejects an argument only when its type is PROVABLY
      // disjoint from the parameter's. A symbol declared `real` and a compound
      // typed `number` both overlap `integer`, so they are admitted and the
      // application stays symbolic — which is what the Fungrim rules that
      // apply these heads to a compound (`Totient(2^n)`) depend on.
      const engine = new ComputeEngine();
      engine.declare('r', 'real');
      for (const expr of [
        ['Totient', 'r'],
        ['Totient', ['Power', 2, 'n']],
        ['Divides', 'a', 'b'],
        ['Divides', 2, ['Power', 2, 'n']],
      ] as any[]) {
        const x = engine.box(expr);
        expect(x.type.toString()).not.toBe('error');
        expect(x.evaluate().toString()).not.toContain('incompatible-type');
      }
    });

    test('a provably NON-INTEGER argument is refused by the same carrier', () => {
      // The infinities are not the only thing a bare `integer` excludes: the
      // carrier is finite integers, so a fractional literal is refused too.
      // `Divides(2.5, 3)` used to stay symbolic, which answered neither the
      // question nor the type error.
      const engine = new ComputeEngine();
      for (const expr of [
        ['Totient', 2.5],
        ['Divides', 2.5, 3],
        ['Divides', 3, 2.5],
      ] as any[])
        expect(engine.box(expr).toString()).toContain('incompatible-type');
    });

    test('a WIDE-parameter head still admits the infinity', () => {
      // Not every number-theory head tightened: `GCD`/`LCM` declare `any*`
      // and `Binomial` declares `number`, so nothing about their admission
      // changed. They stay symbolic, exactly as before.
      const engine = new ComputeEngine();
      for (const head of ['GCD', 'LCM'])
        expect(
          engine.box([head, { num: '+Infinity' }, 2] as any).type.toString()
        ).not.toBe('error');
      expect(
        engine.box(['Binomial', { num: '+Infinity' }, 2] as any).type.toString()
      ).not.toBe('error');
    });
  });

  describe('the extended real line is recognized as a whole', () => {
    // `real | signed_infinity` is the honest result claim of a head whose
    // value can be infinite at an interior point (`li(1) = −∞`). It is below
    // NEITHER disjunct, so a predicate that tested `<: real` and
    // `<: signed_infinity` separately answered "not an extended real" for a
    // value that always is one.
    test('a union-typed function result IS an extended real', () => {
      const e = ce.parse('\\operatorname{li}(1)');
      expect(e.type.toString()).toBe('real | signed_infinity');
      expect(e.isExtendedReal).toBe(true);
    });

    test('a type that overlaps the reals leaves the predicate open', () => {
      // `number` admits a real value, a genuinely complex one and a
      // non-finite one alike: neither entailed nor refuted.
      expect(ce.parse('\\sin(x_u)').isExtendedReal).toBe(undefined);
    });
  });

  describe('tensor storage class of the non-finite literals', () => {
    // `getExpressionDatatype` reads the literal's type, projected to its tier.
    // The projection sends BOTH signed infinities to the `infinity` tier,
    // which also admits the unsigned `~oo` — classifying that tier as complex
    // promoted a real tensor such as `[1, +oo]` to the complex field. The
    // signed pair and NaN are held exactly by a float64; only `~oo`, whose
    // type keeps its own value node, needs the boxed `expression` field.
    test('a signed ±∞ and NaN are float64; `~oo` is an expression', () => {
      const eng = new ComputeEngine();
      expect(getExpressionDatatype(eng.box(Infinity))).toBe('float64');
      expect(getExpressionDatatype(eng.box(-Infinity))).toBe('float64');
      expect(getExpressionDatatype(eng.box(NaN))).toBe('float64');
      expect(getExpressionDatatype(eng.parse('\\tilde\\infty'))).toBe(
        'expression'
      );
    });

    test('a vector with a ±∞ cell stays in the real field', () => {
      const eng = new ComputeEngine();
      const vec = eng.function('List', [eng.box(1), eng.box(Infinity)]);
      expect(packTensor(eng, vec)?.dtype).toBe('float64');
      // The unsigned infinity has no numeric storage class, so its vector
      // falls back to the boxed field.
      const cvec = eng.function('List', [
        eng.box(1),
        eng.parse('\\tilde\\infty'),
      ]);
      expect(packTensor(eng, cvec)?.dtype).toBe('expression');
    });

    // The FINITE integers are classified by value, alongside the non-finite
    // literals above. Two `case 'integer'` labels used to sit in the same
    // switch, so the first one won and every integer, of every magnitude,
    // was classified `float64`.
    test('a finite integer is classified by its magnitude', () => {
      const eng = new ComputeEngine();
      // The unsigned-byte window is `0..255` inclusive.
      expect(getExpressionDatatype(eng.box(5))).toBe('uint8');
      expect(getExpressionDatatype(eng.box(255))).toBe('uint8');
      expect(getExpressionDatatype(eng.box(300))).toBe('int32');
      expect(getExpressionDatatype(eng.box(-1))).toBe('int32');
      // An integer past 2^53 would be truncated in a float64-backed buffer,
      // so it takes the exact boxed field instead.
      expect(getExpressionDatatype(eng.number(10n ** 20n))).toBe('expression');
    });

    test('a small-integer tensor packs EXACT, and floats under `.N()`', () => {
      // `packTensor` remaps an integer-classified cell: the exact route takes
      // the boxed field (the int kernels do JS-number arithmetic, whose
      // intermediates can exceed 2^53), and the numeric route takes float64.
      const eng = new ComputeEngine();
      const m = eng.box(['List', ['List', 1, 2], ['List', 3, 4]]);
      expect(packTensor(eng, m)?.dtype).toBe('expression');
      expect(packTensor(eng, m, { numeric: true })?.dtype).toBe('float64');
      // The exact route is what keeps the inverse rational.
      expect(eng.box(['Inverse', m]).evaluate().toString()).toBe(
        '[[-2,1],[3/2,-1/2]]'
      );
    });
  });
});
