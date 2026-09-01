/**
 * Behavior and contract pins for operator `type` handlers that take
 * operand DESCRIPTORS (`typeHandlerKind: 'types'`) and for the engine
 * invariant behind that shape: deriving an application's type never
 * modifies engine state. Everything in this file is durable regression
 * coverage. What each block guards:
 *
 * - `Coalesce`/`Hold`/`ReleaseHold` derive these exact types, byte for
 *   byte. `Hold`/`ReleaseHold` are lazy with no `canonical` handler, so
 *   through `ce.box` their operands arrive RAW and unbound — these rows
 *   pin that raw-operand typing route.
 * - A `Coalesce` result never promises presence its last operand does not
 *   (§3.D of the missing-value typing design): the last operand's
 *   `missing` arm survives into the result type. Guards against a
 *   once-shipped bug where the type-derivation call site pre-stripped it.
 * - `GammaRegularized`/`BetaRegularized` claim `real` only on
 *   their proven domain and `number` otherwise (the non-finite typing
 *   convention: claim wide whenever NaN is possible).
 * - `Sinc`/`FresnelS`/`FresnelC`, `LogIntegral` and the
 *   paired statistics `Covariance`/`PopulationCovariance`/`Correlation`
 *   follow the same rule: each once claimed an unconditional type that its
 *   own values contradict off the operator's real domain (`Sinc(NaN).N()`,
 *   `LogIntegral(NaN).N()` and `Covariance([1, NaN], [2, 3]).N()` are all
 *   `NaN`), and each now narrows only on a proven-real operand.
 *   `Heaviside` and `Sign` were in this list until their Phase F Contract B
 *   flips (2026-08-31): each now has NO `'types'` handler — the claim is
 *   derived from the declared domain signature.
 * - `Heaviside`'s SIGN claim is gated on that same proven realness: its
 *   values 0, 1/2 and 1 are non-negative only where it has a value, so the
 *   once-unconditional `non-negative` (which answered for `Heaviside(NaN)`
 *   too) is withheld off the real line.
 * - A broadcastable operator's gate reads the operand type unwrapped to its
 *   SCALAR element — every collection rank, `broadcastable<T>` included —
 *   because the call site re-adds the whole lifted shape around what the
 *   handler returns.
 * - `Sinh`/`Cosh`/`Tanh`/`Sech` do not mistake a NaN operand for a real
 *   infinity: a deliberate soundness correction, made when the value
 *   predicate (then spelled `isReal`) still answered `true` for NaN.
 * - Deriving a type is state-pure: repeated and forced re-derivations
 *   move no cache axis, a `'types'`-shape handler receives descriptors
 *   (never expressions), and the runtime guard — always on under test —
 *   throws on a handler that writes state, including one declared through
 *   the public `ce.declare` route.
 *
 * Provenance: the descriptor handler shape and these pins were introduced
 * by the staged handler-signature change recorded in
 * `docs/plans/2026-08-22-type-handlers-on-types.md`; the operator type
 * pins were first captured from the pre-descriptor handlers at commit
 * bca1105e and are unchanged since. The migration's own disposable
 * apparatus — the differential shadow — lives separately in
 * `type-handler-shadow-parity.test.ts` and its fixture.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type {
  IComputeEngine,
  OperandDescriptor,
} from '../../src/compute-engine/global-types';

describe('Coalesce, Hold and ReleaseHold type derivation (raw-operand route)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
    ce.declare('x', 'integer');
  });

  const CORPUS: [name: string, json: unknown, expected: string][] = [
    ['Coalesce of two literals', ['Coalesce', 1, 2.5], 'real'],
    ['Coalesce symbol/literal', ['Coalesce', 'x', 2.5], 'real'],
    ['Coalesce single operand', ['Coalesce', 'x'], 'integer'],
    [
      'Coalesce with exact rational',
      ['Coalesce', ['Rational', 1, 3], 2.5],
      'real',
    ],
    ['Hold of a symbol', ['Hold', 'q'], 'symbol'],
    ['Hold of a string', ['Hold', { str: 'abc' }], 'string'],
    ['Hold of a number', ['Hold', 3.14], 'real'],
    ['Hold of a raw application', ['Hold', ['Add', 'x', 1]], 'unknown'],
    ['Hold of a raw list', ['Hold', ['List', 1, 2]], 'unknown'],
    [
      'Hold of a function literal',
      ['Hold', ['Function', ['Add', 'n', 1], 'n']],
      'unknown',
    ],
    [
      'ReleaseHold of a held literal',
      ['ReleaseHold', ['Hold', 2]],
      'integer',
    ],
    ['ReleaseHold of a symbol', ['ReleaseHold', 'q'], 'unknown'],
    [
      'ReleaseHold of a held application',
      ['ReleaseHold', ['Hold', ['Add', 1, 2]]],
      'unknown',
    ],
  ];

  for (const [name, json, expected] of CORPUS)
    test(name, () => {
      expect(ce.box(json as any).type.toString()).toBe(expected);
    });

  test("Coalesce's LAST operand keeps its full type, `missing` arm included", () => {
    // Every arm but the last contributes its stripped type, the last its
    // FULL type — a Coalesce result never promises presence its last
    // operand does not (§3.D of the missing-value typing design). The
    // type-derivation call site folds the missing-strip override into
    // descriptors only for `propagate` operators for exactly this reason:
    // a `handle` operator's handler owns the absence semantics.
    ce.declare('m', 'integer | missing');
    expect(ce.box(['Coalesce', 1, 'm'] as any).type.toString()).toBe(
      'integer | missing'
    );
    // At a NON-last position the arm is stripped by the handler itself.
    expect(ce.box(['Coalesce', 'm', 1] as any).type.toString()).toBe('integer');
  });

  test('the regularized gamma/beta claim real only on their proven domain', () => {
    // `GammaRegularized(-1, 2)` evaluates to NaN, so an unconditional
    // `real` claim would be unsound (and once was shipped): these
    // handlers narrow the claim only when positivity/range is proven, and
    // an unproven fact answers the wide `number` — the non-finite typing
    // convention.
    ce.declare('s', 'real');
    expect(ce.box(['GammaRegularized', 2, 3] as any).type.toString()).toBe(
      'real'
    );
    expect(ce.box(['GammaRegularized', -1, 2] as any).type.toString()).toBe(
      'number'
    );
    expect(ce.box(['GammaRegularized', 's', 3] as any).type.toString()).toBe(
      'number'
    );
    expect(ce.box(['BetaRegularized', 0.5, 2, 3] as any).type.toString()).toBe(
      'real'
    );
    expect(ce.box(['BetaRegularized', 2, 2, 3] as any).type.toString()).toBe(
      'number'
    );
  });

  test('Sinc/FresnelS/FresnelC claim real only on the real line', () => {
    // All three are entire, bounded on the reals and have finite limits at
    // ±∞, so a real argument gives a finite real. Off the real line they are
    // complex-valued, and `Sinc(NaN).N()` is `NaN` — which no finite type
    // admits — so the unconditional `real` these three used to claim
    // was unsound. A finite (possibly complex) argument claims the top
    // numeric type `number` too — with the `finite_number` spelling retired,
    // the only name for "finite, real or complex" is `complex`, and claiming
    // it would read as PROVABLY non-real — and anything the type cannot
    // decide keeps `number` as well.
    const NAN = { num: 'NaN' };
    ce.declare('s', 'real');
    ce.declare('u', 'number');
    for (const op of ['Sinc', 'FresnelS', 'FresnelC']) {
      expect(`${op}(2)=${ce.box([op, 2] as any).type.toString()}`).toBe(
        `${op}(2)=real`
      );
      // ±∞ is real, and all three have a finite value there.
      expect(
        `${op}(oo)=${ce.box([op, { num: '+Infinity' }] as any).type.toString()}`
      ).toBe(`${op}(oo)=real`);
      expect(`${op}(s)=${ce.box([op, 's'] as any).type.toString()}`).toBe(
        `${op}(s)=real`
      );
      expect(`${op}(NaN)=${ce.box([op, NAN] as any).type.toString()}`).toBe(
        `${op}(NaN)=number`
      );
      expect(
        `${op}(i)=${ce.box([op, ['Complex', 1, 2]] as any).type.toString()}`
      ).toBe(`${op}(i)=number`);
      expect(`${op}(u)=${ce.box([op, 'u'] as any).type.toString()}`).toBe(
        `${op}(u)=number`
      );
      // Broadcast: the per-element claim is wrapped in the operand's shape.
      expect(
        `${op}(list)=${ce.box([op, ['List', 1, 2]] as any).type.toString()}`
      ).toBe(`${op}(list)=vector<real^2>`);
    }
    // A finite argument of undecided realness reaches the second gate: an
    // entire function maps a finite point to a finite value, real or complex.
    ce.declare('fn', 'complex');
    expect(ce.box(['Sinc', 'fn'] as any).type.toString()).toBe('number');
    // `~oo` types `number` — the same descriptor a NaN produces — so neither
    // gate fires and the wide claim stands.
    expect(ce.box(['Sinc', 'ComplexInfinity'] as any).type.toString()).toBe(
      'number'
    );
  });

  test('a broadcastable gate reads through EVERY collection rank', () => {
    // The handler describes one SCALAR element and the call site re-adds the
    // operand's whole lifted shape, so the gate has to unwrap the operand
    // type all the way down. Unwrapping a single rank left every rank-2
    // operand undecided — one unwrap of `matrix<real^(2x2)>` is the ROW type
    // `list<real^2>`, which proves nothing about a scalar — and a
    // `broadcastable<T>` operand was not unwrapped at all, because its
    // `collection` fact is `undefined` rather than `true`.
    ce.declare('M', 'matrix<real^(2x2)>');
    ce.declare('br', 'broadcastable<real>');
    expect(
      ce
        .box(['Sinc', ['List', ['List', 1, 2], ['List', 3, 4]]] as any)
        .type.toString()
    ).toBe('matrix<real^(2x2)>');
    expect(ce.box(['Sinc', 'M'] as any).type.toString()).toBe(
      'matrix<real^(2x2)>'
    );
    expect(ce.box(['Sinc', 'br'] as any).type.toString()).toBe(
      'broadcastable<real>'
    );
  });

  test('Heaviside and Sign claim their exact ranged tier for a proven real', () => {
    // Both are defined on the REAL line only, where their values are a
    // finite set: H(x) ∈ {0, 1/2, 1} (H(0) = 1/2 is this engine's
    // convention) and Sign(x) ∈ {−1, 0, 1}, at ±∞ included. The claims
    // carry the RANGE, so the type channel alone proves the bounds and
    // the sign (`Sqrt(Heaviside(s))` stays `real` with no sgn-handler
    // consultation). Heaviside is the Phase F Contract B pilot: its claim
    // is DERIVED from the declared domain signature
    // `(real | signed_infinity) -> rational<0..1>` — a proven-NaN
    // argument types exactly `nan` (the propagated value), a maybe-NaN
    // one `rational<0..1> | nan`, and an off-carrier argument (`~oo`, a
    // complex value) is a boxing error rather than staying inert.
    const NAN = { num: 'NaN' };
    ce.declare('s', 'real');
    ce.declare('u', 'number');
    expect(ce.box(['Heaviside', 2] as any).type.toString()).toBe(
      'rational<0..1>'
    );
    expect(ce.box(['Heaviside', 's'] as any).type.toString()).toBe(
      'rational<0..1>'
    );
    expect(
      ce.box(['Heaviside', { num: '-Infinity' }] as any).type.toString()
    ).toBe('rational<0..1>');
    expect(ce.box(['Heaviside', NAN] as any).type.toString()).toBe('nan');
    expect(ce.box(['Heaviside', ['Complex', 1, 2]] as any).isValid).toBe(
      false
    );
    expect(ce.box(['Heaviside', 'u'] as any).type.toString()).toBe(
      '(rational<0..1>) | nan'
    );
    // `Sign` is the second Phase F flip (after the Heaviside pilot above):
    // same declared domain signature shape,
    // `(real | signed_infinity) -> integer<-1..1>`, same consequences.
    expect(ce.box(['Sign', -2] as any).type.toString()).toBe(
      'integer<-1..1>'
    );
    expect(ce.box(['Sign', 's'] as any).type.toString()).toBe(
      'integer<-1..1>'
    );
    expect(ce.box(['Sign', NAN] as any).type.toString()).toBe('nan');
    expect(ce.box(['Sign', 'ComplexInfinity'] as any).isValid).toBe(false);
    expect(ce.box(['Sign', ['Complex', 1, 2]] as any).isValid).toBe(false);
    expect(ce.box(['Sign', 'u'] as any).type.toString()).toBe(
      '(integer<-1..1>) | nan'
    );
    // Broadcast: the per-element claim is wrapped in the operand's shape.
    expect(ce.box(['Sign', ['List', 1, -2]] as any).type.toString()).toBe(
      'list<integer<-1..1>^2>'
    );
    // The ranged claim reaches type-channel consumers: non-negativity is in
    // the type, so a square root of it stays real.
    expect(
      ce.box(['Sqrt', ['Heaviside', 's']] as any).type.toString()
    ).toBe('real');
    // A collection whose ELEMENT type may carry a NaN gains the propagated
    // arm per CELL, exactly as the scalar operand `u: number` does — the
    // NaN evidence is read off the element type under a broadcast.
    ce.declare('L', 'list<number>');
    expect(ce.box(['Sign', 'L'] as any).type.toString()).toBe(
      'list<(integer<-1..1>) | nan>'
    );
  });

  test("Heaviside's SIGN is claimed only where it has a value", () => {
    // Correction paired with the type gate above: H's values 0, 1/2 and 1 are
    // non-negative, but only on the real line, where H has a value at all.
    // The `sgn` handler claimed `non-negative` unconditionally, so
    // `Heaviside(NaN).isNonNegative` answered `true` — a sign asserted for an
    // input the operator has no value for. Sign is a live channel
    // (comparisons, simplification), so the claim is now gated on the same
    // proven realness the type is.
    const NAN = { num: 'NaN' };
    ce.declare('s', 'real');
    ce.declare('u', 'number');
    for (const [label, operand] of [
      ['NaN', NAN],
      ['1+2i', ['Complex', 1, 2]],
      ['~oo', 'ComplexInfinity'],
      ['u', 'u'],
    ] as const) {
      const x = ce.box(['Heaviside', operand] as any);
      expect(`H(${label}).sgn=${x.sgn}`).toBe(`H(${label}).sgn=undefined`);
      expect(`H(${label}).isNonNegative=${x.isNonNegative}`).toBe(
        `H(${label}).isNonNegative=undefined`
      );
    }
    // A proven real operand — ±∞ included, where H(−∞) = 0 and H(+∞) = 1 —
    // keeps the non-negative claim.
    for (const [label, operand] of [
      ['2', 2],
      ['s', 's'],
      ['-oo', { num: '-Infinity' }],
    ] as const) {
      const x = ce.box(['Heaviside', operand] as any);
      expect(`H(${label}).sgn=${x.sgn}`).toBe(`H(${label}).sgn=non-negative`);
      expect(x.isNonNegative).toBe(true);
    }
    // `Sign`'s own sgn handler forwards its operand's sign and is unchanged.
    expect(ce.box(['Sign', 2] as any).sgn).toBe('positive');
    expect(ce.box(['Sign', NAN] as any).sgn).toBe('unsigned');
  });

  test('LogIntegral claims the extended reals only on the non-negative axis', () => {
    // li(x) = Ei(ln x) is real-valued only for x ≥ 0, and infinite there at
    // both ends of its domain (li(1) = −∞, li(+∞) = +∞) — so the EXTENDED
    // real line, `real | signed_infinity`, is the narrowest sound claim.
    // The bare name `real` denotes the finite reals and would exclude both
    // ends. For x < 0, ln x is complex and so is the value; and
    // `LogIntegral(NaN).N()` is `NaN`. The flat `real` result this definition
    // used to declare admitted neither, so the result was widened to `number`
    // and a domain-gated handler re-narrows on a proven non-negative real.
    const XR = 'real | signed_infinity';
    const NAN = { num: 'NaN' };
    ce.declare('nn', 'real<0..>');
    ce.declare('s', 'real');
    expect(ce.box(['LogIntegral', 2] as any).type.toString()).toBe(XR);
    expect(ce.box(['LogIntegral', 0] as any).type.toString()).toBe(XR);
    expect(ce.box(['LogIntegral', 1] as any).type.toString()).toBe(XR);
    expect(
      ce.box(['LogIntegral', { num: '+Infinity' }] as any).type.toString()
    ).toBe(XR);
    expect(ce.box(['LogIntegral', 'nn'] as any).type.toString()).toBe(XR);
    expect(ce.box(['LogIntegral', -2] as any).type.toString()).toBe('number');
    expect(
      ce.box(['LogIntegral', { num: '-Infinity' }] as any).type.toString()
    ).toBe('number');
    expect(ce.box(['LogIntegral', NAN] as any).type.toString()).toBe('number');
    expect(
      ce.box(['LogIntegral', 'ComplexInfinity'] as any).type.toString()
    ).toBe('number');
    expect(
      ce.box(['LogIntegral', ['Complex', 1, 2]] as any).type.toString()
    ).toBe('number');
    // A real of unproven sign stays wide: the negative half is complex.
    expect(ce.box(['LogIntegral', 's'] as any).type.toString()).toBe('number');
    expect(
      ce
        .box(['LogIntegral', NAN] as any)
        .N()
        .toString()
    ).toBe('NaN');
    // Broadcast: the sign fact describes the operand, so for a collection the
    // sign has to come from the ELEMENT type. A list of literals widens its
    // elements to a bare tier, which carries no sign — hence `number` per
    // element there, and `real` for a list declared with a signed element
    // type.
    ce.declare('LR', 'list<real<0..>>');
    expect(ce.box(['LogIntegral', ['List', 2, 3]] as any).type.toString()).toBe(
      'vector<2>'
    );
    expect(ce.box(['LogIntegral', 'LR'] as any).type.toString()).toBe(
      `list<${XR}>`
    );
    // A `broadcastable<T>` operand takes the element-type arm too: its
    // `collection` fact is `undefined` — whether it is a collection is
    // exactly what is unknown — so reading the operand's own sign there
    // answered `undefined` and widened the claim to `broadcastable<number>`.
    ce.declare('BR', 'broadcastable<real<0..>>');
    ce.declare('BN', 'broadcastable<real>');
    expect(ce.box(['LogIntegral', 'BR'] as any).type.toString()).toBe(
      `broadcastable<${XR}>`
    );
    // An element type of unproven sign still keeps the wide claim.
    expect(ce.box(['LogIntegral', 'BN'] as any).type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('the pole-free hyperbolics do not mistake NaN for a real infinity', () => {
    // Deliberate soundness CORRECTION, not a migration side effect: the
    // Sinh/Cosh/Tanh/Sech arms tested the value predicate (then spelled
    // `isReal`), which a NaN literal answered `true` while also being
    // non-finite — so they claimed `signed_infinity` (resp. `real`)
    // for calls that produce NaN, and neither type admits it. Realness is now
    // read from the TYPE, which NaN does not satisfy and a real ±∞ (typed
    // `signed_infinity`) does. The predicate itself was later renamed to
    // `isExtendedReal` and now excludes NaN as well, so both channels agree.
    const NAN = { num: 'NaN' };
    const INF = { num: '+Infinity' };
    for (const op of ['Sinh', 'Cosh', 'Tanh', 'Sech'])
      expect(`${op}(NaN)=${ce.box([op, NAN] as any).type.toString()}`).toBe(
        `${op}(NaN)=number`
      );
    expect(
      ce
        .box(['Sinh', NAN] as any)
        .N()
        .toString()
    ).toBe('NaN');
    // The real-±∞ claims the arms exist for are unchanged.
    for (const op of ['Sinh', 'Cosh'])
      expect(`${op}(oo)=${ce.box([op, INF] as any).type.toString()}`).toBe(
        `${op}(oo)=signed_infinity`
      );
    for (const op of ['Tanh', 'Sech'])
      expect(`${op}(oo)=${ce.box([op, INF] as any).type.toString()}`).toBe(
        `${op}(oo)=real`
      );
  });

  test('the paired statistics claim real only for finite real data', () => {
    // `Covariance`, `PopulationCovariance` and `Correlation` are sums of
    // products of deviations divided by a count, so one non-finite data value
    // poisons the result: `Covariance([1, NaN], [2, 3])` evaluates to `NaN`,
    // which the unconditional `real` these three used to claim does
    // not admit. Both accepted input forms — two equal-length collections, or
    // one collection of (x, y) pairs — narrow when the data types prove
    // finite reals.
    const NAN = { num: 'NaN' };
    for (const op of ['Covariance', 'PopulationCovariance', 'Correlation']) {
      expect(
        `${op}=${ce
          .box([op, ['List', 1, 2, 3], ['List', 2, 4, 7]] as any)
          .type.toString()}`
      ).toBe(`${op}=real`);
      expect(
        `${op}(pairs)=${ce
          .box([
            op,
            ['List', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 7]],
          ] as any)
          .type.toString()}`
      ).toBe(`${op}(pairs)=real`);
      expect(
        `${op}(NaN)=${ce
          .box([op, ['List', 1, NAN], ['List', 2, 3]] as any)
          .type.toString()}`
      ).toBe(`${op}(NaN)=number`);
    }
    expect(
      ce
        .box(['Covariance', ['List', 1, NAN], ['List', 2, 3]] as any)
        .N()
        .toString()
    ).toBe('NaN');
  });

  test('ReleaseHold and Coalesce evaluate their operands correctly', () => {
    expect(
      ce
        .box(['ReleaseHold', ['Hold', ['Add', 1, 2]]] as any)
        .evaluate()
        .toString()
    ).toBe('3');
    expect(
      ce
        .box(['Coalesce', 5, 7] as any)
        .evaluate()
        .toString()
    ).toBe('5');
  });
});

describe("purity: deriving an application's type moves no cache axis", () => {
  test('repeated reads and forced re-derivations both drift zero', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    const exprs = [
      ce.box(['Coalesce', 'x', 2.5] as any),
      ce.box(['Hold', ['Add', 'x', 1]] as any),
      ce.box(['ReleaseHold', ['Hold', 2]] as any),
    ];
    for (const e of exprs) expect(e.type).toBeDefined(); // Warm: the first read may bind.

    let drift = 0;
    for (let i = 0; i < 5; i++) {
      // An unrelated declaration retires the type memo, so each round
      // re-derives through the handler rather than answering from cache.
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      for (const e of exprs) expect(e.type).toBeDefined();
      drift += ce._anyVersion - before;
    }
    expect(drift).toBe(0);
  });
});

describe("user-declared 'types'-shape handlers", () => {
  test('ce.declare accepts the flag and the handler sees descriptors', () => {
    const ce = new ComputeEngine();
    const seen: OperandDescriptor[][] = [];
    ce.declare('EchoT', {
      signature: '(any) -> unknown',
      typeHandlerKind: 'types',
      type: (operands) => {
        seen.push([...operands]);
        return operands[0]?.type;
      },
    });
    const t = ce.box(['EchoT', 3] as any).type.toString();
    // The handler saw the literal's value-carrying type; the stored result
    // is widened back to its tier — the same widening every handler result
    // gets.
    expect(t).toBe('integer');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0][0].facts.finite).toBe(true);
    expect(seen[0][0].facts.sgn).toBe('positive');
  });

  test('a handler that writes engine state trips the purity guard', () => {
    const ce = new ComputeEngine();
    let counter = 0;
    ce.declare('LeakyT', {
      signature: '(any) -> unknown',
      typeHandlerKind: 'types',
      type: (_operands, { engine }) => {
        // Deliberate violation: the compile-time PureEngineView hides the
        // mutating surface, so the leak needs a cast — exactly the misuse
        // the runtime guard exists to catch.
        (engine as unknown as IComputeEngine).declare(
          `leak${counter++}`,
          'number'
        );
        return 'unknown';
      },
    });
    expect(() => ce.box(['LeakyT', 1] as any).type).toThrow(
      /LeakyT.*modified engine state/s
    );
  });
});

// The bounded inverse trig heads (`Arcsin`, `Arccos`, `Arcsec`, `Arccsc`,
// `Artanh`, `Arcoth`, `Arsech`, `Arcsch`, `Arcosh`) derive their in-domain
// proof from the operand's RANGED TYPE — a declaration's range, or a ranged
// result type — where the retired expressions shape asked the assumptions
// system. The tighter claims this proves were adopted by ruling
// (2026-08-25; the full changed-row record is the `elementaryFunctionType`
// divergence tables in `type-handler-twins.test.ts`). These rows pin the
// adopted behavior on the live derivation route.
describe('bounded inverse trig heads read ranged types', () => {
  const ce = new ComputeEngine();
  ce.declare('bigd', 'real<2..>');
  ce.declare('smd', 'real<-0.5..0.5>');
  ce.declare('r', 'real');
  ce.declare('s', 'real');
  ce.assume(ce.parse('s \\geq 2'));

  it('a DECLARED range proves domain membership', () => {
    // real<2..> is inside Arcosh's real domain [1, ∞) and outside
    // Artanh's (−1, 1) and Arcsin's [−1, 1].
    expect(ce.box(['Arcosh', 'bigd']).type.toString()).toBe('real');
    expect(ce.box(['Artanh', 'bigd']).type.toString()).toBe('complex');
    expect(ce.box(['Arcsin', 'bigd']).type.toString()).toBe('complex');
    expect(ce.box(['Arcsec', 'bigd']).type.toString()).toBe('real');
    // real<-0.5..0.5> is inside Artanh's open (−1, 1) and Arcsin's [−1, 1].
    expect(ce.box(['Artanh', 'smd']).type.toString()).toBe('real');
    expect(ce.box(['Arcsin', 'smd']).type.toString()).toBe('real');
  });

  it('a ranged RESULT type proves domain membership', () => {
    // Sign(r) types integer<-1..1>, inside Arcsin/Arccos's closed
    // real domain [−1, 1].
    expect(ce.box(['Arcsin', ['Sign', 'r']]).type.toString()).toBe(
      'real'
    );
    expect(ce.box(['Arccos', ['Sign', 'r']]).type.toString()).toBe(
      'real'
    );
  });

  it('an assumed range still proves membership (both channels agree)', () => {
    expect(ce.box(['Arcosh', 's']).type.toString()).toBe('real');
  });

  it('a STRICT assumed bound proves membership in an OPEN domain', () => {
    // The assumption refinement emits the open-endpoint spelling
    // (`& !k`) only for zero, so `0 < v < 1` refines the type to
    // `(real<0..1>) & !0` and the range alone cannot prove `v < 1`
    // strictly; the strictness travels on the descriptor's
    // assumption-bounds fact (`facts.bounds`), which is what proves
    // membership in Artanh's open (−1, 1) and non-membership at Arcoth's
    // ±1 poles.
    // The assumption is built as MathJSON: a multi-character name in a
    // LaTeX string (`0 < v01 < 1`) parses as a PRODUCT of one-letter
    // symbols, and the assumption then never mentions the declared symbol.
    ce.declare('v01', 'real');
    ce.assume(ce.box(['Less', 0, 'v01', 1]));
    expect(ce.box(['Artanh', 'v01']).type.toString()).toBe('real');
    expect(ce.box(['Arcoth', 'v01']).type.toString()).toBe('complex');
  });

  it('a DECLARED open-endpoint spelling proves the strict comparison', () => {
    // The lattice's open endpoint is a closed bound plus an exclusion of
    // it (`& !1` — the same convention as `& !0` for "positive"). The
    // comparison helpers combine the two (`typeExcludesValue`), so a
    // direct declaration of the open unit interval proves membership in
    // Artanh's open (−1, 1) exactly as the assumed spelling does.
    ce.declare('w01', '(real<0..1>) & !0 & !1');
    expect(ce.box(['Artanh', 'w01']).type.toString()).toBe('real');
    expect(ce.box(['Arcoth', 'w01']).type.toString()).toBe('complex');
    // The exclusion is read by MEMBERSHIP in the negated type, not by node
    // shape: the reducer folds sibling exclusions by De Morgan, and the
    // folded spelling proves the same strict bounds.
    ce.declare('w01b', '(real<0..1>) & !(0 | 1)');
    expect(ce.box(['Artanh', 'w01b']).type.toString()).toBe('real');
    // And an exclusion at a log base's forbidden point: `(real<1..2>) & !1`
    // is a usable base (positive, finite, provably ≠ 1).
    ce.declare('base1', '(real<1..2>) & !1');
    expect(ce.box(['Log', 4, 'base1']).type.toString()).toBe('real');
  });

  it('an exact literal with no machine value proves its domain through its enclosure', () => {
    // The literal channel still carries machine singletons only (accepted
    // rational-literal residue, ruling O4) — no handler reads `1/3` as a
    // value. But the literal's TYPE now encloses it
    // (`rational<0.33..0.34>`), and `[0.33, 0.34] ⊆ [−1, 1]` is a
    // bounds fact, so the domain claim no longer widens to the complex
    // join.
    expect(ce.box(['Arcsin', ['Rational', 1, 3]]).type.toString()).toBe(
      'real'
    );
    // A machine-representable literal still classifies exactly.
    expect(ce.box(['Arcsin', 0.5]).type.toString()).toBe('real');
    expect(ce.box(['Arcsin', 2]).type.toString()).toBe('complex');
    expect(ce.box(['Artanh', 1]).type.toString()).toBe('signed_infinity');
  });

  it('an unknown-magnitude real keeps the sound join', () => {
    expect(ce.box(['Arcsin', 'r']).type.toString()).toBe('complex');
    // `Artanh`'s poles at ±1 are `±∞`, which the bare (finite) name `complex`
    // does not admit, so the join names the signed pair explicitly.
    expect(ce.box(['Artanh', 'r']).type.toString()).toBe(
      'complex | signed_infinity'
    );
  });
});
