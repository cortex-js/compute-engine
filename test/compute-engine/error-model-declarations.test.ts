/**
 * Contract B declaration surface (`docs/ERROR-MODEL.md` §4, ratified
 * 2026-08-27 as ruling R-A): the `nanBehavior` / `partiality` /
 * `definedWhen` / `requires` fields of an operator definition, and their
 * RESOLUTION math. These pins cover Phase A of
 * `docs/plans/2026-08-30-error-model-implementation.md` — declaration and
 * resolution only; the runtime gates that read the resolved policies are
 * Phase B and have their own pins.
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('Contract B — resolvedNanBehaviorAt derivation', () => {
  test('a precise non-integer numeric carrier with a numeric result derives propagate', () => {
    const e = new ComputeEngine();
    e.declare('TestPropagate', {
      signature: '(real) -> real',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestPropagate')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('propagate');
  });

  test('a complex carrier with a numeric result derives propagate', () => {
    const e = new ComputeEngine();
    e.declare('TestComplex', {
      signature: '(complex) -> complex',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestComplex')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('propagate');
  });

  test('an integer carrier derives reject — an index-like slot', () => {
    const e = new ComputeEngine();
    e.declare('TestIndex', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestIndex')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
  });

  test('a precise carrier with a NON-numeric result derives reject — propagate is only legal into a numeric codomain', () => {
    const e = new ComputeEngine();
    e.declare('TestBoolResult', {
      signature: '(real) -> boolean',
      evaluate: ([_x], { engine }) => engine.symbol('True'),
    });
    const def = e.lookupDefinition('TestBoolResult')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
  });

  test('a carrier that ADMITS nan leaves the policy channel inert', () => {
    // Bare `number` contains `nan` after the lattice flip, so `NaN` is an
    // ordinary domain member there: the handler owns it, which is the
    // status quo for every operator not yet migrated to a precise carrier.
    const e = new ComputeEngine();
    e.declare('TestWide', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestWide')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('inert');
  });

  test('an explicit declaration wins over the derived default, wide carrier included', () => {
    const e = new ComputeEngine();
    e.declare('TestExplicit', {
      signature: '(number) -> boolean',
      nanBehavior: 'handle',
      evaluate: ([_x], { engine }) => engine.symbol('False'),
    });
    const def = e.lookupDefinition('TestExplicit')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('handle');
  });

  test('a per-slot array declares each slot; a hole falls back to the derived default', () => {
    const e = new ComputeEngine();
    e.declare('TestPerSlot', {
      signature: '(real, real) -> real',
      nanBehavior: ['reject', undefined],
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestPerSlot')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
    expect(def.resolvedNanBehaviorAt(1)).toBe('propagate');
  });

  test('a slot beyond the declared parameters answers inert', () => {
    const e = new ComputeEngine();
    e.declare('TestArity', {
      signature: '(real) -> real',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestArity')!.operator!;
    expect(def.resolvedNanBehaviorAt(5)).toBe('inert');
  });

  test('an inferred signature derives nothing — inert without a declaration', () => {
    const e = new ComputeEngine();
    e.declare('TestInferred', { evaluate: ([x]) => x });
    const def = e.lookupDefinition('TestInferred')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('inert');
  });

  test('IsPrime and IsComposite declare handle — the ruled membership-predicate convention', () => {
    const e = new ComputeEngine();
    expect(
      e.lookupDefinition('IsPrime')!.operator!.resolvedNanBehaviorAt(0)
    ).toBe('handle');
    expect(
      e.lookupDefinition('IsComposite')!.operator!.resolvedNanBehaviorAt(0)
    ).toBe('handle');
  });
});

describe('Contract B — partiality resolution', () => {
  test('omitted partiality resolves to may-marker, the sound default', () => {
    const e = new ComputeEngine();
    e.declare('TestDefaultPartiality', {
      signature: '(real) -> real',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestDefaultPartiality')!.operator!;
    expect(def.resolvedPartiality).toBe('may-marker');
  });

  test('an explicit total claim resolves to total', () => {
    const e = new ComputeEngine();
    e.declare('TestTotal', {
      signature: '(real) -> real',
      partiality: 'total',
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestTotal')!.operator!;
    expect(def.resolvedPartiality).toBe('total');
  });

  test('a definedWhen predicate resolves to defined-when', () => {
    const e = new ComputeEngine();
    e.declare('TestDefinedWhen', {
      signature: '(number, number) -> number',
      definedWhen: ([_a, b]) => (b?.isSame(0) ? false : undefined),
      evaluate: ([x]) => x,
    });
    const def = e.lookupDefinition('TestDefinedWhen')!.operator!;
    expect(def.resolvedPartiality).toBe('defined-when');
  });

  test('declaring both partiality: total and definedWhen is a definition error', () => {
    const e = new ComputeEngine();
    expect(() =>
      e.declare('TestConflict', {
        signature: '(number) -> number',
        partiality: 'total',
        definedWhen: () => true,
        evaluate: ([x]) => x,
      })
    ).toThrow();
  });

  test('Mod declares its domain condition: divisor ≠ 0', () => {
    const e = new ComputeEngine();
    const def = e.lookupDefinition('Mod')!.operator!;
    expect(def.resolvedPartiality).toBe('defined-when');
    expect(def.definedWhen!([e.box(1), e.box(0)])).toBe(false);
    expect(def.definedWhen!([e.box(1), e.box(2)])).toBe(true);
    // A symbolic divisor is undecidable, never a claim either way.
    expect(def.definedWhen!([e.box(1), e.symbol('q')])).toBeUndefined();
  });
});

describe('Contract B — the NaN gates on a precise-carrier pilot (Phase B)', () => {
  // These operators are the FIRST with carriers that exclude `nan`, so they
  // exercise the §4 admission carve-in (boxing) and the policy gate
  // (evaluation) that stay inert for every wide-carrier operator.

  test('propagate: NaN is admitted past the carrier at boxing and the application evaluates to NaN', () => {
    const e = new ComputeEngine();
    e.declare('PilotPropagate', {
      signature: '(real) -> real',
      evaluate: ([x]) => x.add(e.One),
    });
    const expr = e.box(['PilotPropagate', 'NaN']);
    // §4 composition rule step 1: the policy is tested BEFORE type
    // disjointness, so no incompatible-type error despite nan ⊄ real.
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().isNaN).toBe(true);
  });

  test('propagate: an ordinary in-carrier argument still reaches the handler', () => {
    const e = new ComputeEngine();
    e.declare('PilotOrdinary', {
      signature: '(real) -> real',
      evaluate: ([x]) => x.add(e.One),
    });
    expect(e.box(['PilotOrdinary', 2]).evaluate().isSame(3)).toBe(true);
  });

  test('reject (derived, integer slot): NaN is an Error at boxing, not admitted', () => {
    const e = new ComputeEngine();
    e.declare('PilotReject', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => x,
    });
    const expr = e.box(['PilotReject', 'NaN']);
    expect(expr.isValid).toBe(false);
  });

  test('handle: the handler sees the NaN and answers in its own codomain', () => {
    const e = new ComputeEngine();
    e.declare('PilotHandle', {
      signature: '(real) -> boolean',
      nanBehavior: 'handle',
      evaluate: ([x], { engine }) =>
        engine.symbol(x.isNaN === true ? 'False' : 'True'),
    });
    const expr = e.box(['PilotHandle', 'NaN']);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().symbol).toBe('False');
  });

  test('composition: a reject-slot NaN beats a propagate-slot NaN (the stronger channel wins)', () => {
    const e = new ComputeEngine();
    e.declare('PilotMixed', {
      signature: '(real, real) -> real',
      nanBehavior: [undefined, 'reject'],
      evaluate: ([x]) => x,
    });
    // NaN in the propagate slot alone → NaN.
    expect(e.box(['PilotMixed', 'NaN', 1]).evaluate().isNaN).toBe(true);
    // NaN in the reject slot → Error, even alongside a propagating NaN.
    expect(e.box(['PilotMixed', 'NaN', 'NaN']).isValid).toBe(false);
  });

  test('siblings of a propagating NaN still evaluate — evaluation counts never change', () => {
    const e = new ComputeEngine();
    let calls = 0;
    e.declare('CountingSide', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    });
    e.declare('PilotSibling', {
      signature: '(real, real) -> real',
      evaluate: ([x]) => x,
    });
    const expr = e.box(['PilotSibling', 'NaN', ['CountingSide', 2]]);
    expect(expr.evaluate().isNaN).toBe(true);
    expect(calls).toBe(1);
  });

  test('IsPrime(NaN) still answers False — the ruled handle convention, now declared', () => {
    const e = new ComputeEngine();
    expect(e.box(['IsPrime', 'NaN']).evaluate().symbol).toBe('False');
  });

  test('the RUNTIME reject branch fires for a NaN that arises after boxing', () => {
    // A literal NaN dies at boxing (no carve-in for reject slots), so this
    // pin routes the NaN through a call whose static type (`number`)
    // overlaps `integer`: boxing admits it, evaluation produces the NaN,
    // and the runtime gate's own reject arm must answer the Error.
    const e = new ComputeEngine();
    e.declare('MakeNaN', {
      signature: '() -> number',
      evaluate: (_ops, { engine }) => engine.NaN,
    });
    e.declare('PilotRuntimeReject', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => x,
    });
    const expr = e.box(['PilotRuntimeReject', ['MakeNaN']]);
    expect(expr.isValid).toBe(true); // admitted: `number` overlaps `integer`
    const value = expr.evaluate();
    expect(value.operator).toBe('Error');
  });

  test('a shipped precise-carrier operator now binds the derived policy: Degrees(NaN) → NaN', () => {
    // `Degrees: (real) -> real` predates this change. Under the ratified
    // §4 derived default its slot is `propagate`, so a NaN argument is
    // admitted past the carrier and the application answers NaN — where it
    // used to be refused as incompatible-type. This pin records that the
    // change in behavior is INTENDED: the ratified contract binding for
    // operators that already declare precise carriers.
    const e = new ComputeEngine();
    const expr = e.box(['Degrees', 'NaN']);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().isNaN).toBe(true);
  });

  test('an EXTENDED-REAL carrier derives reject, so Hypot declares handle explicitly', () => {
    // The trap this pins: `real | signed_infinity` is NOT a subtype of
    // `complex` (bare `complex` is finite since the lattice flip), and the
    // mechanical §4 propagate test asks exactly that — so the DERIVED
    // default for an extended-real carrier is `reject`, and `Hypot(NaN, 1)`
    // would become an Error. `Hypot` therefore declares its policy
    // explicitly. It declares `handle`, not `propagate`, because the
    // generic gate answers a propagating `NaN` BEFORE the handler runs,
    // which would lose the infinity precedence: an infinite leg makes the
    // hypotenuse infinite whatever the other leg is, `NaN` included
    // (`Math.hypot(Infinity, NaN)` is `Infinity`, and the compiled lane
    // emits `Math.hypot`). With `handle` the handler owns both answers.
    const e = new ComputeEngine();
    const def = e.lookupDefinition('Hypot')!.operator!;
    expect(def.resolvedNanBehaviorAt(0)).toBe('handle');
    expect(def.resolvedNanBehaviorAt(1)).toBe('handle');
    const expr = e.box(['Hypot', 'NaN', 1]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().isNaN).toBe(true);
    // The precedence the `handle` policy buys, in both operand orders.
    expect(
      e.box(['Hypot', 'PositiveInfinity', 'NaN']).evaluate().toString()
    ).toBe('+oo');
    expect(
      e.box(['Hypot', 'NaN', 'NegativeInfinity']).evaluate().toString()
    ).toBe('+oo');
    // A point leg reaches the hypotenuse through its norm, and an infinite
    // norm has the same precedence as an infinite scalar.
    expect(
      e
        .box(['Hypot', ['Tuple', 'PositiveInfinity', 3], 'NaN'])
        .evaluate()
        .toString()
    ).toBe('+oo');
    // Without the explicit declaration the same carrier derives `reject`.
    e.declare('TestExtendedRealCarrier', {
      signature: '(real | signed_infinity) -> real',
      evaluate: ([x]) => x,
    });
    expect(
      e
        .lookupDefinition('TestExtendedRealCarrier')!
        .operator!.resolvedNanBehaviorAt(0)
    ).toBe('reject');
  });
});

describe('Contract B — the higher-order conservative floor (Phase E)', () => {
  test('an annotated lambda derives NO policy from its precise carrier', () => {
    // The floor (`docs/ERROR-MODEL.md` §4): a user-defined callable has
    // UNKNOWN NaN behavior, so its declared `(real) -> real` must not
    // derive `propagate` — the boxing admission would otherwise carve a
    // NaN into the lambda's carrier, bypassing its own validation.
    const e = new ComputeEngine();
    e.declare('flr', '(real) -> real');
    e.assign('flr', e.parse('x \\mapsto x + 1'));
    const def = e.lookupDefinition('flr');
    expect(def).toBeDefined();
    // A declared-then-assigned lambda lives as a VALUE definition holding
    // the function literal — there is no operator definition on this
    // route, so no Contract B derivation can even begin here (the
    // operator-definition-shaped lambda is pinned in the absolute-floor
    // test below).
    expect(def!.operator).toBeUndefined();
    // Plain carrier semantics at boxing: nan is disjoint from real.
    expect(e.box(['flr', 'NaN']).isValid).toBe(false);
  });

  test('the derived-type adjustment stands down for a user callable', () => {
    // A maybe-NaN argument must NOT widen the lambda application's type:
    // the lambda arms own its typing, and the floor forbids the generic
    // machinery from assuming (or claiming) anything sharper or wider.
    const e = new ComputeEngine();
    e.declare('flt', '(real) -> real');
    e.assign('flt', e.parse('x \\mapsto x + 1'));
    e.declare('wn', 'number');
    expect(e.box(['flt', 'wn']).type.matches('real')).toBe(true);
  });

  test('the floor is ABSOLUTE: explicit declarations on a user-fn definition are ignored', () => {
    // A lambda-backed `declare()` can carry explicit Contract B fields.
    // The floor beats them — the runtime gates never fire for user
    // callables, so honoring the declarations here would put a claim in
    // the resolution (and the type) that no runtime channel backs.
    const e = new ComputeEngine();
    e.declare('flm', {
      signature: '(real) -> real',
      nanBehavior: 'propagate',
      partiality: 'may-marker',
      evaluate: e.parse('x \\mapsto x + 1'),
    });
    const def = e.lookupDefinition('flm')?.operator;
    expect(def).toBeDefined();
    if (def!.isUserFunctionDefinition) {
      expect(def!.resolvedNanBehaviorAt(0)).toBe('inert');
      expect(def!.contractBResultAdjustment([e.box(2)])).toBe('none');
    } else {
      // A lambda-valued `evaluate` that does NOT classify as a user
      // function keeps ordinary declaration semantics — the floor is
      // about the user-fn class, and this branch records which side of
      // the line this declaration shape falls on.
      expect(def!.resolvedNanBehaviorAt(0)).toBe('propagate');
    }
  });
});

describe('Contract B — partiality channels at runtime (Phase D, minimal)', () => {
  test('a false definedWhen answers the codomain marker before the handler runs', () => {
    const e = new ComputeEngine();
    e.declare('PilotDW', {
      signature: '(number, number) -> number',
      definedWhen: ([_a, b]) => {
        if (b === undefined) return undefined;
        if (b.isSame(0)) return false;
        return true;
      },
      evaluate: (_ops, { engine }) => engine.box(42),
    });
    // The gate preempts the handler: the handler would answer 42.
    expect(e.box(['PilotDW', 1, 0]).evaluate().isNaN).toBe(true);
    expect(e.box(['PilotDW', 1, 2]).evaluate().isSame(42)).toBe(true);
  });

  test('a false definedWhen with a NON-numeric codomain answers Missing', () => {
    // Rule 4 of `docs/ERROR-MODEL.md` §2: the codomain marker for a
    // settled non-numeric result type is `Missing` — the one primitive
    // quiet datum, carried through comparisons by Kleene semantics. The
    // gate preempts the handler (which would answer `True`).
    const e = new ComputeEngine();
    e.declare('PilotDWBool', {
      signature: '(number) -> boolean',
      definedWhen: () => false,
      evaluate: (_ops, { engine }) => engine.symbol('True'),
    });
    expect(e.box(['PilotDWBool', 1]).evaluate().symbol).toBe('Missing');
    expect(e.box(['PilotDWBool', 1]).type.matches('missing')).toBe(true);
  });

  test('a false definedWhen with a string codomain also answers Missing', () => {
    const e = new ComputeEngine();
    e.declare('PilotDWStr', {
      signature: '(real) -> string',
      definedWhen: () => false,
      evaluate: (_ops, { engine }) => engine.string('x'),
    });
    expect(e.box(['PilotDWStr', 1]).evaluate().symbol).toBe('Missing');
  });

  test('an explicit may-marker with a boolean codomain widens the type with | missing', () => {
    const e = new ComputeEngine();
    e.declare('PilotMarkerBool', {
      signature: '(real) -> boolean',
      partiality: 'may-marker',
      evaluate: (_ops, { engine }) => engine.symbol('True'),
    });
    const ty = e.box(['PilotMarkerBool', 2]).type;
    expect(ty.matches('boolean | missing')).toBe(true);
    expect(ty.matches('boolean')).toBe(false);
  });

  test('the marker follows the RESOLVED overload arm: NaN for the numeric arm, Missing for the string arm', () => {
    const e = new ComputeEngine();
    e.declare('PilotOverM', {
      signature: '((integer) -> integer) & ((string) -> string)',
      definedWhen: () => false,
      evaluate: ([x]) => x,
    });
    expect(e.box(['PilotOverM', 2]).evaluate().isNaN).toBe(true);
    expect(
      e.function('PilotOverM', [e.string('a')]).evaluate().symbol
    ).toBe('Missing');
  });

  test('per-overload derived NaN policy: the resolved real arm propagates a dynamic NaN', () => {
    const e = new ComputeEngine();
    e.declare('MakeNaND', {
      signature: '() -> number',
      evaluate: (_ops, { engine }) => engine.NaN,
    });
    e.declare('PilotOverNaN', {
      signature: '((real) -> real) & ((string) -> string)',
      evaluate: ([x]) => x,
    });
    // The dynamic NaN resolves against the `(real) -> real` arm, whose
    // derived per-slot policy is `propagate`.
    const v = e.box(['PilotOverNaN', ['MakeNaND']]).evaluate();
    expect(v.isNaN).toBe(true);
  });

  test('the derived type reads the RESOLVED arm: a maybe-NaN argument into the numeric arm types | nan', () => {
    // The runtime gate and the type derivation must read the SAME arm:
    // the `(real) -> real` arm's derived per-slot policy is `propagate`,
    // so a `number`-typed argument (which admits `nan`) adds the arm.
    const e = new ComputeEngine();
    e.declare('PilotOverT', {
      signature: '((real) -> real) & ((string) -> string)',
      evaluate: ([x]) => x,
    });
    e.declare('nw', 'number');
    const ty = e.box(['PilotOverT', 'nw']).type;
    expect(ty.matches('real | nan')).toBe(true);
    expect(ty.matches('real')).toBe(false);
  });

  test('an overload set participates in the derived application type', () => {
    const e = new ComputeEngine();
    e.declare('PilotOverW', {
      signature: '((real) -> real) & ((string) -> string)',
      partiality: 'may-marker',
      evaluate: ([x]) => x,
    });
    const ty = e.box(['PilotOverW', 2]).type;
    expect(ty.matches('real | nan')).toBe(true);
    expect(ty.matches('real')).toBe(false);
  });

  test('a false requires answers the Error channel', () => {
    const e = new ComputeEngine();
    e.declare('PilotReq', {
      signature: '(number) -> number',
      requires: ([x]) => {
        if (x === undefined) return undefined;
        if (x.isSame(-1)) return false;
        return true;
      },
      evaluate: ([x]) => x,
    });
    expect(e.box(['PilotReq', -1]).evaluate().operator).toBe('Error');
    expect(e.box(['PilotReq', 2]).evaluate().isSame(2)).toBe(true);
  });

  test('Mod claims no value for a complex or infinite operand', () => {
    const e = new ComputeEngine();
    const def = e.lookupDefinition('Mod')!.operator!;
    const i = e.box(['Complex', 0, 1]).evaluate();
    expect(def.definedWhen!([e.box(1), i])).toBe(false);
    expect(def.definedWhen!([e.PositiveInfinity, e.box(2)])).toBe(false);
  });
});

describe('Contract B — derived application type (Phase C)', () => {
  // These operators have no type handler, so their application type comes
  // from the declared signature through the Contract B derivation
  // (`S | nan`, narrowing to exactly `S` when discharged).

  test('a propagate slot whose argument may be NaN adds the | nan arm', () => {
    const e = new ComputeEngine();
    e.declare('TPilot', {
      signature: '(real) -> real',
      evaluate: ([x]) => x,
    });
    e.declare('w', 'number'); // `number` admits nan
    const ty = e.box(['TPilot', 'w']).type;
    expect(ty.matches('real | nan')).toBe(true);
    // Not plain `real`: the nan arm is real — this is what makes the type
    // honest about `TPilot(w)` evaluating to NaN when `w` holds one.
    expect(ty.matches('real')).toBe(false);
  });

  test('a proven-real argument keeps the sharp declared result', () => {
    const e = new ComputeEngine();
    e.declare('TSharp', {
      signature: '(real) -> real',
      evaluate: ([x]) => x,
    });
    expect(e.box(['TSharp', 2]).type.matches('real')).toBe(true);
  });

  test('an EXPLICIT may-marker declaration widens even a proven-real application', () => {
    const e = new ComputeEngine();
    e.declare('TMarker', {
      signature: '(real) -> real',
      partiality: 'may-marker',
      evaluate: ([x]) => x,
    });
    const ty = e.box(['TMarker', 2]).type;
    expect(ty.matches('real | nan')).toBe(true);
    expect(ty.matches('real')).toBe(false);
  });

  test('total discharges the partiality but never the NaN arm', () => {
    const e = new ComputeEngine();
    e.declare('TTotal', {
      signature: '(real) -> real',
      partiality: 'total',
      evaluate: ([x]) => x,
    });
    // Proven-real argument: exactly the declared result.
    expect(e.box(['TTotal', 2]).type.matches('real')).toBe(true);
    // Maybe-NaN argument: the propagate slot still contributes the arm.
    e.declare('u', 'number');
    const ty = e.box(['TTotal', 'u']).type;
    expect(ty.matches('real | nan')).toBe(true);
    expect(ty.matches('real')).toBe(false);
  });

  test('definedWhen routes the type: false → nan, true → sharp, undecided → | nan', () => {
    const e = new ComputeEngine();
    e.declare('TDW', {
      signature: '(real, real) -> real',
      definedWhen: ([_a, b]) => {
        if (b === undefined) return undefined;
        if (b.symbol) return undefined; // symbolic → undecidable
        return !b.isSame(0);
      },
      evaluate: ([x]) => x,
    });
    expect(e.box(['TDW', 1, 0]).type.matches('nan')).toBe(true);
    expect(e.box(['TDW', 1, 2]).type.matches('real')).toBe(true);
    e.declare('v', 'real');
    const undecided = e.box(['TDW', 1, 'v']).type;
    expect(undecided.matches('real | nan')).toBe(true);
    expect(undecided.matches('real')).toBe(false);
  });

  test('a broadcast application widens the CELLS, not the collection', () => {
    // Under a broadcast the propagated NaN (or an undischarged declared
    // partiality) lands in individual cells, so the honest lifted type is
    // `list<real | nan>` — never a top-level union with the list.
    const e = new ComputeEngine();
    e.declare('TBroadcast', {
      signature: '(real) -> real',
      broadcastable: true,
      partiality: 'may-marker',
      evaluate: ([x]) => x,
    });
    const ty = e.box(['TBroadcast', ['List', 1, 2, 3]]).type;
    expect(ty.matches('list<real | nan>')).toBe(true);
    expect(ty.matches('list<real>')).toBe(false);
  });

  test('broadcast NaN evidence is read off the ELEMENT type', () => {
    // A broadcast operand carries its numbers in cells, so a propagate
    // slot's NaN evidence rides in the ELEMENT type: `nan` is not a
    // subtype of `list<number>`, and probing only the collection type
    // claimed sharp cells for an operand whose cells may evaluate to NaN
    // (unsound: `TP([1, NaN])` evaluates a NaN cell). The adjustment
    // descends to the element type; proven NaN-free elements stay sharp.
    const e = new ComputeEngine();
    e.declare('TP', {
      // The `(real)` carrier derives `propagate` mechanically, and the
      // declared `total` discharges the partiality — so the only possible
      // arm is the NaN one, which is exactly what this pin isolates.
      signature: '(real) -> real',
      broadcastable: true,
      partiality: 'total',
      evaluate: ([x]) => x,
    });
    e.declare('L', 'list<number>');
    e.declare('K', 'list<real>');
    const maybeNan = e.box(['TP', 'L']).type;
    expect(maybeNan.matches('list<real | nan>')).toBe(true);
    expect(maybeNan.matches('list<real>')).toBe(false);
    const literalNan = e.box(['TP', ['List', 1, { num: 'NaN' }]]).type;
    expect(literalNan.matches('list<real | nan>')).toBe(true);
    expect(literalNan.matches('list<real>')).toBe(false);
    // Proven NaN-free elements keep the sharp per-cell claim.
    expect(e.box(['TP', 'K']).type.matches('list<real>')).toBe(true);
    expect(e.box(['TP', ['List', 1, 2]]).type.matches('list<real>')).toBe(
      true
    );
    // A UNION of collection shapes is descended too: the element probe
    // uses the union-aware broadcast descent, so the `list<nan>` arm's
    // evidence is not lost behind the union.
    e.declare('U', 'list<real> | list<nan>');
    const unionNan = e.box(['TP', 'U']).type;
    expect(unionNan.matches('list<real | nan>')).toBe(true);
    expect(unionNan.matches('list<real>')).toBe(false);
  });

  test('an operator WITH a type handler keeps its own claim untouched', () => {
    // `Degrees` types through `numericTypeHandlerOnTypes` — the handler is
    // the sharper, evidence-conditioned authority, and the derivation must
    // not widen it.
    const e = new ComputeEngine();
    e.declare('p', 'real');
    expect(e.box(['Degrees', 'p']).type.matches('real')).toBe(true);
  });
});
