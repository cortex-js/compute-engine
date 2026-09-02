/**
 * @fixme TEMPORARY MIGRATION SUITE — this whole file MUST be deleted when
 * the expressions-shape `type` handler is retired; the shadow registry's
 * doc comment (`_legacyTypeHandlerShadow`,
 * `boxed-expression/operand-descriptor.ts`) lists every piece that goes
 * with it. (The durable behavior pins live in
 * `type-handler-parity.test.ts`, which stays.)
 *
 * Differential parity for converted `type` handlers: with the legacy
 * expressions-shape handlers installed in the shadow registry, every type
 * derivation for a converted operator runs BOTH shapes and throws on
 * divergence (`checkShadowTypeParity`,
 * `boxed-expression/operand-descriptor.ts`). This suite drives a broad
 * operand mix through the converted operators; any divergence surfaces as a
 * throw from the `.type` read itself, so the assertions here only need to
 * force the derivations — plus one guard that the mechanism actually ran,
 * so an empty corpus or a broken install fails loudly instead of passing
 * vacuously.
 *
 * A conversion batch is proven by (a) this suite and (b) a full-suite run
 * with the shadow installed; the corpus is then every type derivation the
 * whole test suite performs.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { _shadowParityStats } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import {
  LEGACY_TYPE_HANDLERS,
  RETIRED_CONSTANT_TYPE_HANDLERS,
  installLegacyTypeHandlerShadow,
  uninstallLegacyTypeHandlerShadow,
} from './type-handler-shadow-legacy';

beforeAll(() => installLegacyTypeHandlerShadow());
afterAll(() => uninstallLegacyTypeHandlerShadow());

describe('shadow parity over the converted handlers', () => {
  test('a broad operand mix derives identically under both shapes', () => {
    const before = _shadowParityStats.checks;
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('p', 'real<0..> & !0');
    ce.declare('L', 'list<integer>');
    ce.declare('m', 'integer | missing');
    ce.assign('v', ce.box(5));
    // The channel-splitting operand classes the twins battery established.
    // Each one feeds a different subset of the channels a type handler can
    // read, and they part company in ways a corpus of literals never shows:
    ce.declare('r', 'real'); // a bare real: unknown finiteness, unknown sign
    // `ce.assume` refines the TYPE and records an assumption, so both the
    // type channel and the assumptions channel carry the bound…
    ce.declare('s', 'real');
    ce.assume(ce.parse('s > 0'));
    // …while a range that came from the DECLARATION is in the type alone,
    // with nothing in the assumptions system.
    ce.declare('bigd', 'real<2..>');
    // Held values behind a wider declaration: the value channel knows the
    // operand is non-finite (resp. NaN) where the type channel says only
    // `number`.
    ce.declare('w', 'number');
    ce.assign('w', ce.number(Infinity));
    ce.declare('hnan', 'number');
    ce.assign('hnan', ce.NaN);
    // Non-finiteness carried by the TYPE, with no value at all.
    ce.declare('nf', 'signed_infinity');

    const corpus: unknown[] = [
      // Coalesce: literals, symbols, exact rationals, missing-typed mixes
      ['Coalesce', 1, 2.5],
      ['Coalesce', 'x', 2.5],
      ['Coalesce', 'x'],
      ['Coalesce', ['Rational', 1, 3], 2.5],
      ['Coalesce', 'p', 'x'],
      ['Coalesce', 'L', 'x'],
      ['Coalesce', 'v', 1],
      ['Coalesce', { str: 'a' }, { str: 'b' }],
      ['Coalesce', ['Sqrt', 2], 'x'],
      ['Coalesce', ['Divide', 'x', 0], NaN],
      // A `missing`-carrying type at the LAST position is the §3.D contract
      // case: the last arm keeps its FULL type, absence included. The call
      // site once pre-stripped it for the 'types' shape (a `handle`
      // operator's handler owns absence semantics — the strip fold is now
      // gated to `propagate` operators), and this row is what catches any
      // relapse.
      ['Coalesce', 1, 'm'],
      ['Coalesce', 'm', 1],
      ['Coalesce', 'm', 'm'],
      // Hold: every structural kind, raw through the box route
      ['Hold', 'q'],
      ['Hold', 'x'],
      ['Hold', { str: 'abc' }],
      ['Hold', 0],
      ['Hold', 1],
      ['Hold', 3.14],
      ['Hold', NaN],
      ['Hold', ['Add', 'x', 1]],
      ['Hold', ['List', 1, 2]],
      ['Hold', ['Tuple', 1, 2, 3]],
      ['Hold', ['Function', ['Add', 'n', 1], 'n']],
      // ReleaseHold: held literals, held applications, non-Hold operands
      ['ReleaseHold', ['Hold', 2]],
      ['ReleaseHold', ['Hold', ['Add', 1, 2]]],
      ['ReleaseHold', ['Hold', 'q']],
      ['ReleaseHold', 'q'],
      ['ReleaseHold', ['List', 1, 2]],
      // DigitCount (batch 1): the 2-operand and 3-operand forms
      ['DigitCount', 122, 10],
      ['DigitCount', 122, 10, 2],
      // Block/When (batch 1)
      ['Block', 1, 2.5],
      ['Block', 'x'],
      ['When', 'x', ['List', 'True', 'False']],
      ['When', 'x', 'True'],

      // --- batch 2: library/arithmetic.ts ---
      // The rounding family (`Ceil`/`Floor`/`Truncate`/`Round`) left this
      // mix with its Phase F Contract B flip (2026-08-31): the handlers
      // now deliberately diverge from the frozen legacy shape (see the
      // note at their retired `LEGACY_TYPE_HANDLERS` entries), and the
      // adopted behavior is pinned directly in
      // `type-handler-parity.test.ts`. `Fract` left with its own flip
      // (2026-09-02): it has no type handler any more, and its claims are
      // pinned in `error-model.test.ts` and `type-inference.test.ts`.

      ['LambertW', 1],
      ['LambertW', 'r'],
      ['LambertW', NaN],
      ['LambertW', ['Sqrt', 2]],
      ['LambertW', 'nf'],

      // The Bessel family is binary (order, argument), so it also exercises
      // the multi-operand folds of `numericTypeHandler`: one non-finite
      // operand takes the whole claim to `number`, and the `real`
      // claim needs EVERY operand real.
      ['BesselJ', 0, 1],
      ['BesselJ', 'x', 'r'],
      ['BesselJ', 1, NaN],
      ['BesselJ', 0, { num: '+Infinity' }],
      ['BesselY', 0, 1],
      ['BesselY', 'x', 'ImaginaryUnit'],
      ['BesselY', 1, ['Rational', 1, 3]],
      ['BesselY', 0, 'nf'],
      ['BesselI', 0, 1],
      ['BesselI', 'x', 'r'],
      ['BesselI', 1, 'ComplexInfinity'],
      ['BesselI', 0, ['Sqrt', 2]],
      ['BesselK', 0, 1],
      ['BesselK', 'x', 'w'],
      ['BesselK', 1, 'hnan'],
      ['BesselK', 0, 'bigd'],

      ['AiryAi', 1],
      ['AiryAi', 'r'],
      ['AiryAi', NaN],
      ['AiryAi', 'ImaginaryUnit'],
      ['AiryBi', 2.5],
      ['AiryBi', 'x'],
      ['AiryBi', { num: '+Infinity' }],
      ['AiryBi', ['Sqrt', 2]],
      ['AiryAiPrime', 1],
      ['AiryAiPrime', 's'],
      ['AiryAiPrime', 'ComplexInfinity'],
      ['AiryAiPrime', ['Rational', 1, 3]],
      ['AiryBiPrime', 1],
      ['AiryBiPrime', 'nf'],
      ['AiryBiPrime', 'w'],
      ['AiryBiPrime', 'hnan'],

      ['ElementMax', 1, 2],
      ['ElementMax', 'x', 'r'],
      ['ElementMax', 1, NaN],
      ['ElementMax', ['List', 1, 2], 3],
      ['ElementMin', 1, 2.5],
      ['ElementMin', 'x', { num: '+Infinity' }],
      ['ElementMin', 'ImaginaryUnit', 1],
      ['ElementMin', ['Sqrt', 2], 'bigd'],

      // `Clamp` is the 3-operand arity of `numericTypeHandler`.
      ['Clamp', 5, 0, 1],
      ['Clamp', 'r', 0, 1],
      ['Clamp', NaN, 0, 1],
      ['Clamp', 'x', 'r', 'bigd'],
      ['Clamp', { num: '+Infinity' }, 0, 1],

      // ζ(1) is the pole (the harmonic series diverges): the literal-1 gate
      // in front of the generic numeric claim.
      ['Zeta', 1],
      ['Zeta', 2],
      ['Zeta', 'x'],
      ['Zeta', NaN],
      ['Zeta', ['Rational', 1, 2]],
      ['Zeta', 'ComplexInfinity'],

      // `Negate` echoes the operand type with ranges REFLECTED about zero,
      // so the rows that matter are the ones whose type carries a bound or a
      // value: a ranged declaration, a ranged result type (`Abs`), and a
      // structural type whose elements must be descended into.
      ['Negate', 'r'],
      ['Negate', ['Abs', 'r']],
      ['Negate', 'bigd'],
      ['Negate', 's'],
      ['Negate', 'L'],
      ['Negate', 'nf'],

      // `Measurement(value, error)` echoes the NOMINAL's type and ignores
      // the error bar entirely. The rows vary the nominal across integer,
      // float and symbol while the error stays a float, so a handler that
      // joined the two operand types — or read the second one at all —
      // diverges here.
      ['Measurement', 1, 0.1],
      ['Measurement', 0, 0.5],
      ['Measurement', 9.81, 0.02],
      ['Measurement', 'r', 0.1],
      ['Measurement', 'x', 1],

      // The extremum family narrows to the join tier only when every operand
      // is a scalar number; a collection operand (possibly empty, possibly
      // carrying `Missing`) keeps `number`.
      ['Max', 1, 2],
      ['Max', 'x', 'r'],
      ['Max', ['List', 1, 2, 3]],
      ['Max', 1, NaN],
      ['Min', 1, 2.5],
      ['Min', 'x', { num: '+Infinity' }],
      ['Min', ['List', 1.5, 2.5]],
      ['Min', 'nf', 1],
      ['Supremum', 1, 2],
      ['Supremum', ['List', 1, 2]],
      ['Supremum', 'r', 'bigd'],
      ['Supremum', 'ImaginaryUnit', 1],
      ['Infimum', 1, 2],
      ['Infimum', ['List', 1, 2]],
      ['Infimum', 'x', ['Rational', 1, 3]],
      ['Infimum', 'w', 1],

      // The big ops. Three branches: the arity-1 reducer form (scalar
      // `number`), the `(body, limits)` form with a SCALAR body (also
      // `number`), and the same form with a COLLECTION-valued body, which
      // accumulates elementwise and carries the body's indexed-collection
      // type through.
      ['Sum', ['Square', 'i'], ['Limits', 'i', 1, 5]],
      ['Sum', ['Add', 'k', 1], ['Limits', 'k', 1, 5]],
      ['Sum', 'L'],
      ['Sum', ['List', 'k', ['Square', 'k']], ['Limits', 'k', 1, 3]],
      ['Sum', ['Tuple', 'k', 1], ['Limits', 'k', 1, 3]],
      ['Product', ['Square', 'k'], ['Limits', 'k', 1, 5]],
      ['Product', 'L'],
      ['Product', ['List', 'k', 2], ['Limits', 'k', 1, 3]],
      ['Product', ['Tuple', 'k', 1], ['Limits', 'k', 1, 3]],

      // --- batch 2: library/trigonometry.ts ---
      // `Degrees` and `DMS` supply their own `canonical` handlers, which FOLD
      // an all-numeric argument list away — `Degrees(90)` canonicalizes to
      // `Multiply(90, Pi, 1/180)` and `DMS(30, 15, 20)` to a single
      // `Multiply`, so neither head survives to be typed. Only a symbolic
      // component keeps the operator in place, which is why every row here
      // carries one.
      ['Degrees', 'r'],
      ['Degrees', 'x'],
      ['Degrees', 's'],
      ['Degrees', 'nf'],
      ['Degrees', 'w'],
      ['Degrees', 'hnan'],
      ['DMS', 'x', 1, 2],
      ['DMS', 'r', 'x', 1],
      ['DMS', 'r'],
      ['DMS', 'nf', 1, 1],
      ['DMS', 'hnan', 1, 1],
      ['Arctan2', 1, 2],
      ['Arctan2', 'r', 'x'],
      ['Arctan2', NaN, 1],
      ['Arctan2', { num: '+Infinity' }, 1],
      // `Haversine` declares `(real) -> number`, so NaN and the imaginary
      // unit are rejected by signature validation and never reach the
      // handler at all; `nf` and a real +∞ are the operands that do reach it
      // and still take the non-finite branch.
      ['Haversine', 1],
      ['Haversine', 'r'],
      ['Haversine', 'nf'],
      ['Haversine', { num: '+Infinity' }],

      // --- batch 2: library/special-functions.ts ---
      // `EllipticF` gates on a provably non-finite operand and otherwise
      // hedges at `number` — it never claims `real`, because
      // F(φ|m) is complex whenever m·sin²φ > 1.
      ['EllipticF', 1.5, 2],
      ['EllipticF', 'r', 'x'],
      ['EllipticF', { num: '+Infinity' }, 1],
      ['EllipticF', 1, NaN],
      ['EllipticF', 'nf', 1],
      ['Hypergeometric2F1', 1, 2, 3, 0.5],
      ['Hypergeometric2F1', 'x', 'r', 1, 0.5],
      ['Hypergeometric2F1', 1, 2, 3, NaN],
      ['Hypergeometric2F1', 1, 2, 3, { num: '+Infinity' }],
      ['AppellF1', 1, 2, 3, 4, 0.2, 0.3],
      ['AppellF1', 'x', 1, 1, 1, 'r', 0.5],
      ['AppellF1', 1, 2, 3, 4, NaN, 0.3],
      ['Hypergeometric1F1', 1, 2, 0.5],
      ['Hypergeometric1F1', 'x', 'r', 1],
      ['Hypergeometric1F1', 1, 2, NaN],
      ['Hypergeometric1F1', 1, 2, { num: '+Infinity' }],
      // The three nullary constant claims: their handlers read nothing, so
      // one row per operand shape is enough to prove the dispatch happens.
      ['JacobiTheta', 1, 0.5, 0.3],
      ['JacobiTheta', 'x', 'r', 0.5],
      ['DedekindEta', 'ImaginaryUnit'],
      ['DedekindEta', 'r'],
      ['EisensteinE', 4, 'ImaginaryUnit'],
      ['EisensteinE', 'x', 'r'],

      // --- batch 2: library/sets.ts ---
      // The element type of an adjunction is the JOIN of the base ring's
      // elements and the adjuncts' types, with an untyped adjunct (a bare
      // indeterminate) taking the whole claim to `unknown`.
      ['Adjoin', 'Integers', ['Sqrt', 2]],
      ['Adjoin', 'Integers', 'ImaginaryUnit'],
      ['Adjoin', 'Integers', 'zz'],
      ['Adjoin', 'RealNumbers', 1, 2],
      ['Adjoin', 'Integers', ['Sqrt', 2], 'ImaginaryUnit'],
      ['QuotientRing', 'Integers', 5],
      ['QuotientRing', 'Integers', 'x'],
      ['QuotientRing', 'RealNumbers', 2],
      ['QuotientRing', 'ComplexNumbers', 2],

      // --- batch 2: library/statistics.ts ---
      // Ten unconditional `number` claims that read nothing from their
      // operands; one row each proves the dispatch, and the symbol-operand
      // row proves it does not depend on the argument being a literal list.
      ['Mean', ['List', 1, 2, 3]],
      ['Mean', 'L'],
      ['Median', ['List', 1, 2, 3]],
      ['Median', 'L'],
      ['Variance', ['List', 1, 2, 3]],
      ['Variance', 'L'],
      ['PopulationVariance', ['List', 1, 2, 3]],
      ['PopulationVariance', 'L'],
      ['StandardDeviation', ['List', 1, 2, 3]],
      ['StandardDeviation', 'L'],
      ['PopulationStandardDeviation', ['List', 1, 2, 3]],
      ['PopulationStandardDeviation', 'L'],
      ['Kurtosis', ['List', 1, 2, 3, 4]],
      ['Kurtosis', 'L'],
      ['Skewness', ['List', 1, 2, 3, 4]],
      ['Skewness', 'L'],
      ['Mode', ['List', 1, 2, 2, 3]],
      ['Mode', 'L'],
      ['InterquartileRange', ['List', 1, 2, 3, 4]],
      ['InterquartileRange', 'L'],

      // --- the descriptor's application-level FINITENESS channel ---
      // A COMPOUND operand whose non-finiteness lives only in a held value:
      // `Abs(w)` with `w := +∞` and `Abs(hnan)` with `hnan := NaN` keep a
      // wide result type, so the type channel cannot refute finiteness and
      // only `describe()`'s `isFinite` read on an application does. Each row
      // drives a different consumer of that fact: the rounding family, the
      // elementary dispatcher's non-finite arm, the `Fract` gate, the
      // literal-pole `Zeta` claim, and `EllipticF`, whose whole handler is
      // the non-finiteness gate.
      ['Ceil', ['Abs', 'w']],
      ['Sin', ['Abs', 'hnan']],
      ['Fract', ['Abs', 'w']],
      ['Zeta', ['Abs', 'w']],
      ['EllipticF', ['Abs', 'w'], 1],
    ];

    // --- the once-O7-held heads: sign-channel pole and domain gates ---
    // Their gates read an operand's SIGN, which for a compound operand only
    // an operator `sgn` handler proves — the channel the O7 audit opened to
    // descriptors. Two compound witnesses drive that channel: a provably
    // NON-POSITIVE integer application (`-⌊|r|⌋` — fires the Γ-pole and
    // log-non-positive gates) and a provably NEGATIVE one (`-(⌊|r|⌋+1)` —
    // fires the factorial/binomial pole gates, which need strict
    // negativity). The scalar classes mirror the twins battery: literals on
    // and off the poles, assumed and range-declared symbols, held ±∞/NaN,
    // `~oo`-adjacent operands, and a non-real literal.
    const NONPOS_INT = ['Negate', ['Floor', ['Abs', 'r']]];
    const NEG_INT = ['Negate', ['Add', ['Floor', ['Abs', 'r']], 1]];
    corpus.push(
      ['Factorial', 5],
      ['Factorial', -3],
      ['Factorial', ['Rational', -1, 2]],
      ['Factorial', 'x'],
      ['Factorial', 's'],
      ['Factorial', NEG_INT],
      ['Factorial', NONPOS_INT],
      ['Factorial', 'hnan'],
      ['Factorial', 'w'],
      ['Factorial', 'ImaginaryUnit'],
      ['Factorial2', 5],
      ['Factorial2', -3],
      ['Factorial2', NEG_INT],
      ['Factorial2', 'r'],
      ['Gamma', 2.5],
      ['Gamma', -3],
      ['Gamma', 'x'],
      ['Gamma', 's'],
      ['Gamma', NONPOS_INT],
      ['Gamma', 'nf'],
      ['Gamma', 2, 3],
      ['Gamma', 's', 'r'],
      ['GammaLn', 2],
      ['GammaLn', -2],
      ['GammaLn', NONPOS_INT],
      ['GammaLn', 'r'],
      ['Digamma', 'x'],
      ['Digamma', NONPOS_INT],
      ['Digamma', 2.5],
      ['Trigamma', 'x'],
      ['Trigamma', NONPOS_INT],
      ['Trigamma', NaN],
      ['PolyGamma', 1, 'x'],
      ['PolyGamma', 1, NONPOS_INT],
      ['PolyGamma', 2, 0.5],
      ['Ln', 2],
      ['Ln', 0],
      ['Ln', -2],
      ['Ln', 's'],
      ['Ln', 'r'],
      ['Ln', NONPOS_INT],
      ['Ln', 'hnan'],
      ['Ln', 'nf'],
      ['Ln', 'ImaginaryUnit'],
      ['Log', 8, 2],
      ['Log', 's', 2],
      ['Log', 8, 1],
      ['Log', 8, 0.5],
      ['Log', 8, -2],
      ['Log', NONPOS_INT, 2],
      ['Log', 8, 'r'],
      ['Log', 0, 2],
      ['Binomial', 5, 2],
      ['Binomial', -3, 2],
      ['Binomial', -3, 0.5],
      ['Binomial', NEG_INT, 0.5],
      ['Binomial', NONPOS_INT, 0.5],
      ['Binomial', 'x', 'x'],
      ['Binomial', 'r', 'r'],
      ['Binomial', { num: '+Infinity' }, 2],
      ['Binomial', 'hnan', 2],
      ['Choose', 5, 2],
      ['Choose', NEG_INT, 0.5],
      ['Pochhammer', 2, 3],
      ['Pochhammer', 'r', 'x'],
      ['Pochhammer', 'r', ['Abs', 'x']],
      ['Pochhammer', ['Rational', 1, 2], 3],
      ['Pochhammer', 'r', -2],
      ['Pochhammer', 'w', 2],
      // A `missing`-union operand at a `propagate` operator: the strip
      // replaces the descriptor's type (`integer | missing` → `integer`)
      // while the legacy expressions shape reads the raw operand, so the
      // two shapes legitimately differ BEFORE the absence absorption and
      // the parity check skips the derivation (`missingStripApplied` at
      // the call site). These rows prove the skip: with the shadow
      // installed, a valid missing-union call must not throw.
      ['Factorial', 'm'],
      ['Binomial', 'm', 'm'],
      ['Ln', 'm'],
      ['Coth', 'm']
    );

    // The `elementaryFunctionType` heads. They share one dispatcher and
    // differ only in which arm it takes, so the same operand classes are
    // driven through every head rather than being spelled out per head: a
    // literal at the zero pole, a generic float, a bare real symbol, NaN, a
    // provably real ±∞, the imaginary unit, a non-literal constant that can
    // sit exactly on a circular pole, and a symbol whose non-finiteness is
    // carried by the type alone.
    //
    // All fifteen heads have converted — `Cot`, `Csc`, `Coth` and `Csch`
    // last, once the descriptor's sign fact began carrying an application's
    // operator-`sgn` proof (open item O7 of the plan doc) — so every row
    // below runs a parity check.
    const ELEMENTARY_HEADS = [
      'Arctan',
      'Sin',
      'Cos',
      'Tan',
      'Arsinh',
      'Cosh',
      'Cot',
      'Csc',
      'Sec',
      'Sinh',
      'Csch',
      'Sech',
      'Tanh',
      'Arccot',
      'Coth',
    ];
    const ELEMENTARY_OPERANDS: unknown[] = [
      0,
      2.5,
      'r',
      NaN,
      { num: '+Infinity' },
      'ImaginaryUnit',
      'Pi',
      'nf',
    ];
    for (const head of ELEMENTARY_HEADS)
      for (const operand of ELEMENTARY_OPERANDS) corpus.push([head, operand]);

    // A divergence throws from the `.type` read; reaching the end with the
    // counter advanced is the pass condition.
    for (const json of corpus) expect(ce.box(json as any).type).toBeDefined();

    expect(_shadowParityStats.checks).toBeGreaterThan(before);
    // Anti-vacuity, per operator: every installed legacy handler must have
    // been exercised at least once — a corpus that silently misses one
    // converted operator is not a parity proof for it.
    for (const operator of Object.keys(LEGACY_TYPE_HANDLERS))
      expect(
        _shadowParityStats.checksByOperator.get(operator) ?? 0
      ).toBeGreaterThan(0);
  });

  test('a malformed arity-0 `When` types `unknown` instead of crashing', () => {
    // The converted handler guards `expr === undefined` — a hardening the
    // expressions shape lacked. The `unknown` answer is the guard's own
    // return, so this pins that the branch is genuinely reachable through
    // the box route, and the direct handler invocation covers it without
    // any call-site machinery in between.
    const ce = new ComputeEngine();
    expect(ce.box(['When'] as any).type.toString()).toBe('unknown');
    const def = ce.lookupDefinition('When');
    const opDef = def && 'operator' in def ? def.operator : undefined;
    expect(
      typeof opDef?.type === 'function'
        ? (opDef.type as (ops: [], ctx: { engine: ComputeEngine }) => unknown)(
            [],
            { engine: ce }
          )
        : undefined
    ).toBe('unknown');
  });

  test('every retired constant handler is gone and its signature claims the result', () => {
    // The nullary `type: () => '…'` handlers were retired outright: the
    // constant result lives in the declared signature and no handler
    // remains. This pins both halves — a reintroduced handler or a widened
    // signature result fails here. (The regex is anchored at the END of the
    // signature rather than matched exactly, so an effect label still
    // passes: `(integer, integer?) random -> integer`. A trailing
    // `where` clause — the type-variable binder of a signature such as
    // `(collection<T>, …) -> boolean where T` — is allowed after the result
    // for the same reason, restricted to a comma-separated list of type
    // variable names so the tail cannot absorb arbitrary text. The ledger
    // value is escaped before it goes into the pattern: a result spelling
    // containing regex metacharacters, such as `integer | nothing` or
    // `list<T>`, must match literally rather than as alternation or a
    // repetition.)
    const ce = new ComputeEngine();
    for (const [operator, declaredResult] of RETIRED_CONSTANT_TYPE_HANDLERS) {
      const def = ce.lookupDefinition(operator);
      const opDef = def && 'operator' in def ? def.operator : undefined;
      expect(`${operator}:${typeof opDef?.type}`).toBe(`${operator}:undefined`);
      const literalResult = declaredResult.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );
      expect(`${operator}:${opDef?.signature.toString()}`).toMatch(
        new RegExp(`-> ${literalResult}( where [A-Za-z0-9_, ]+)?$`)
      );
    }
  });

  test('the parse route derives identically too', () => {
    // Lazy operators without a canonical handler receive RAW operands on
    // parse as well as box; the shadow must agree there too.
    const before = _shadowParityStats.checks;
    const ce = new ComputeEngine();
    expect(ce.parse('\\operatorname{Hold}(z+1)').type).toBeDefined();
    expect(
      ce.parse('\\operatorname{ReleaseHold}(\\operatorname{Hold}(7))').type
    ).toBeDefined();
    expect(_shadowParityStats.checks).toBeGreaterThan(before);
  });
});
