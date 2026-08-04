import { ComputeEngine } from '../../src/compute-engine';
import { functionLiteralReturnType } from '../../src/compute-engine/boxed-expression/function-literal';
import { hasFreeTypeVariables } from '../../src/common/type/instantiate';
import { defineFunctionClause } from '../../src/compute-engine/multi-clause';
import { stripArrowEffects } from '../../src/compute-engine/boxed-expression/effects-inference';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// Generic function literals (M1, PHASE 1 — the literal standing alone).
//
// `docs/plans/2026-08-04-generic-function-literals-design.md`: a whole-signature
// `forall` clause on a function literal is accepted, the literal's quantified
// parameters are ERASED before the body canonicalizes (G1), and the literal's
// `.type` becomes the polytype. Two spellings introduce the clause here:
//
//   E1  `["Function", body, "'forall T. (x: T) -> T'"]`      (signature-string)
//   E2  `["Function", ["Typed", body, "'forall …'"], …params]` (full marker)
//
// The DECLARATION BOUNDARY (`ce.assign` / the `Assign` operator / Cortex
// annotated `const`) is phase 2 — the second half of this file. Its sibling
// pins live in `type-variables.test.ts` ("THE DECLARATION BOUNDARY") and
// `test/cortex/type-variables-cortex.test.ts`.
//

function fresh(): ComputeEngine {
  return new ComputeEngine();
}

/** The E1 spelling. */
function e1(ce: ComputeEngine, body: any, signature: string) {
  return ce.box(['Function', body, { str: signature }] as any);
}

/** The E2 spelling: the full-signature marker in the body slot. */
function e2(ce: ComputeEngine, body: any, signature: string, ...params: any[]) {
  return ce.box([
    'Function',
    ['Typed', body, { str: signature }],
    ...params,
  ] as any);
}

describe('E1/E2 — a generic literal is a canonical value with a polytype', () => {
  test('E1 boxes, and its `.type` is the polytype', () => {
    const ce = fresh();
    const f = e1(ce, ['Add', 'x', 'x'], 'forall T: number. (x: T) -> T');
    expect(f.isValid).toBe(true);
    expect(f.isCanonical).toBe(true);
    expect(f.type.toString()).toBe('forall T: number. (x: T) -> T');
    expect(f.type.isPolymorphic).toBe(true);
  });

  test('E2 boxes to the same literal — E1 lowers to E2', () => {
    const ce = fresh();
    const a = e1(ce, ['Add', 'x', 'x'], 'forall T: number. (x: T) -> T');
    const b = e2(ce, ['Add', 'x', 'x'], 'forall T: number. (x: T) -> T', 'x');
    expect(JSON.stringify(b.json)).toBe(JSON.stringify(a.json));
    // The clause survives canonicalization as the body-slot marker.
    expect(JSON.stringify(a.json)).toBe(
      JSON.stringify([
        'Function',
        [
          'Block',
          ['Typed', ['Add', 'x', 'x'], "'forall T: number. (x: T) -> T'"],
        ],
        'x',
      ])
    );
  });

  // ROUTE PARITY: `ce.function(...)` with pre-boxed operands must agree with the
  // raw-MathJSON `ce.box(...)` route (the lazy-operator lesson).
  test('route parity — `ce.function` agrees with `ce.box`', () => {
    const ce = fresh();
    const viaBox = e2(ce, 'x', 'forall T. (x: T) -> T', 'x');
    const viaFunction = ce.function('Function', [
      ce.function('Typed', [ce.box('x'), ce.string('forall T. (x: T) -> T')]),
      ce.symbol('x'),
    ]);
    expect(viaFunction.isValid).toBe(true);
    expect(viaFunction.type.toString()).toBe('forall T. (x: T) -> T');
    expect(JSON.stringify(viaFunction.json)).toBe(JSON.stringify(viaBox.json));
  });

  test('a ground result under a clause is still an ordinary return type', () => {
    const ce = fresh();
    const f = e1(ce, ['Equal', 'x', 'x'], 'forall T. (x: T) -> boolean');
    expect(f.type.toString()).toBe('forall T. (x: T) -> boolean');
    expect(functionLiteralReturnType(f)).toBe('boolean');
  });

  test('an OPEN declared result yields no return type (never an open type)', () => {
    // `functionLiteralReturnType` joins the wide-result convention when the
    // declared result mentions a quantified variable: nothing ground to
    // ascribe, so the return stays inferred. An open type must never leave
    // this accessor — it would reach the ground-invariant tripwires.
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T. (x: T) -> T');
    expect(functionLiteralReturnType(f)).toBeUndefined();
  });

  test('E1 keeps the clause even when the body carries its own ascription', () => {
    // The non-generic E1 rule is "the body's own ascription wins over the
    // signature string's result". For a clause that rule would silently DROP
    // the only record the literal keeps of its type variables, so the full
    // signature is ascribed unconditionally; the body's ascription survives as
    // an inner statement ascription.
    const ce = fresh();
    const f = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'x'], { str: 'integer' }],
      { str: 'forall T: number. (x: T) -> T' },
    ] as any);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('forall T: number. (x: T) -> T');
    expect(
      ce
        .box(['Apply', f.json, 21] as any)
        .evaluate()
        .toString()
    ).toBe('42');
  });
});

describe('ERASURE (G1) — quantified parameters lose their annotation', () => {
  test('mixed parameters: the quantified one is erased, the ground one is not', () => {
    const ce = fresh();
    const f = e1(ce, ['Add', 'x', 'n'], 'forall T. (x: T, n: integer) -> T');
    expect(f.isValid).toBe(true);
    // `x` is a BARE symbol; `n` keeps its `Typed` annotation.
    expect(f.ops[1].toString()).toBe('x');
    expect(f.ops[2].json).toEqual(['Typed', 'n', "'integer'"]);
    expect(f.type.toString()).toBe('forall T. (x: T, n: integer) -> T');
  });

  test('a hand-authored E2 whose parameter annotation NAMES the variable', () => {
    // The pre-pass runs BEFORE parameter normalization, so `["Typed", x, "'T'"]`
    // never reaches type resolution (where `T` is not a declared type name).
    const ce = fresh();
    const f = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'x'], { str: 'forall T: number. (x: T) -> T' }],
      ['Typed', 'x', { str: 'T' }],
    ] as any);
    expect(f.isValid).toBe(true);
    expect(f.ops[1].toString()).toBe('x');
    expect(f.type.toString()).toBe('forall T: number. (x: T) -> T');
  });

  test('a bare `T` annotation with NO clause is still an unknown type (G6)', () => {
    const ce = fresh();
    const f = ce.box(['Function', 'x', ['Typed', 'x', { str: 'T' }]] as any);
    // No clause is in scope, so `T` never becomes a variable; the annotation
    // simply does not resolve.
    expect(f.type.isPolymorphic).toBe(false);
  });
});

describe('ANONYMOUS APPLICATION — the polytype is enforced without a declaration', () => {
  test('identity applies at two instantiations, on ONE engine', () => {
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T. (x: T) -> T');
    expect(
      ce
        .box(['Apply', f.json, 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      ce
        .box(['Apply', f.json, { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
    // No cross-call pollution: the literal's own type is unchanged.
    expect(
      ce
        .box(['Apply', f.json, 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(f.type.toString()).toBe('forall T. (x: T) -> T');
  });

  test('a BOUND violation is rejected at apply time (the widened gate)', () => {
    // Erasure leaves the literal with no annotated parameter, so the apply-time
    // validation gate had to widen to the polytype marker — otherwise an
    // anonymous application (which never passes a symbol's definition seam)
    // would skip bound enforcement entirely.
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T: number. (x: T) -> T');
    const ok = ce.box(['Apply', f.json, 5] as any).evaluate();
    expect(ok.toString()).toBe('5');
    const bad = ce.box(['Apply', f.json, { str: 'a' }] as any).evaluate();
    // The §13-decision-6 shape: the inert application carrying the error-marked
    // argument, exactly as an annotated literal produces.
    expect(bad.operator).toBe('Apply');
    expect(bad.toString()).toContain('incompatible-type');
    expect(bad.isValid).toBe(false);
  });

  test('a GROUND parameter under a clause is enforced too', () => {
    const ce = fresh();
    const f = e1(ce, ['Add', 'x', 'n'], 'forall T. (x: T, n: integer) -> T');
    expect(
      ce
        .box(['Apply', f.json, 5, 2] as any)
        .evaluate()
        .toString()
    ).toBe('7');
    const bad = ce.box(['Apply', f.json, 5, { str: 'z' }] as any).evaluate();
    expect(bad.toString()).toContain('incompatible-type');
  });

  test('swap — two variables, both instantiated per call', () => {
    const ce = fresh();
    const g = e1(
      ce,
      ['Tuple', 'y', 'x'],
      'forall T, U. (x: T, y: U) -> tuple<U, T>'
    );
    expect(g.type.toString()).toBe('forall T, U. (x: T, y: U) -> tuple<U, T>');
    expect(
      ce
        .box(['Apply', g.json, 1, { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('("a", 1)');
  });
});

describe('E2 WELL-FORMEDNESS (§2.3) — the marker is the contract of record', () => {
  const INVALID = /must be a plain signature/;

  test('marker arity ≠ parameter count', () => {
    const ce = fresh();
    const f = e2(ce, 'x', 'forall T. (x: T, y: T) -> T', 'x');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('a VARIADIC marker', () => {
    const ce = fresh();
    const f = e2(ce, 'x', 'forall T. (x: T, y: T*) -> T', 'x', 'y');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('an OPTIONAL-argument marker', () => {
    const ce = fresh();
    const f = e2(ce, 'x', 'forall T. (x: T, y: T?) -> T', 'x', 'y');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('marker argument NAMES are cosmetic; positional mapping is authoritative', () => {
    const ce = fresh();
    const f = e2(
      ce,
      ['Add', 'a', 'k'],
      'forall T. (x: T, n: integer) -> T',
      // A WIDE annotation at the quantified position: an unbounded variable is
      // bounded by `any`, so a narrower one (`integer`) would fail the §2.4
      // rule-4 coverage check the pre-pass now runs before erasing (below).
      ['Typed', 'a', { str: 'any' }],
      ['Typed', 'k', { str: 'integer' }]
    );
    expect(f.isValid).toBe(true);
    // The literal's operand names stay the names of record…
    expect(f.ops[1].toString()).toBe('a');
    expect(f.ops[2].json).toEqual(['Typed', 'k', "'integer'"]);
    // …and position 1 (quantified in the marker) was erased despite carrying a
    // ground annotation, position 2 (ground) kept it — from the marker's ORDER,
    // not from the names, which disagree with the literal's throughout.
    expect(f.type.toString()).toBe('forall T. (x: T, n: integer) -> T');
    expect(
      ce
        .box(['Apply', f.json, 5, 2] as any)
        .evaluate()
        .toString()
    ).toBe('7');
  });

  // §2.4 rule 4, enforced by the pre-pass. Erasure drops a quantified
  // position's own annotation, so the declaration boundary
  // (`acceptsGenericFunctionLiteral`) never sees it on this route — the
  // coverage question has to be answered BEFORE the drop, or a ground
  // annotation contradicting the bound vanishes silently.
  describe('a ground annotation at a QUANTIFIED position must cover the bound', () => {
    const COVERAGE = /must accept every admitted instantiation/;

    test('`(x: real)` under `forall T: integer` is accepted (and dropped)', () => {
      const ce = fresh();
      const f = e2(ce, 'x', 'forall T: integer. (x: T) -> T', [
        'Typed',
        'x',
        { str: 'real' },
      ]);
      expect(f.isValid).toBe(true);
      expect(f.ops[1].toString()).toBe('x'); // erased
      expect(f.type.toString()).toBe('forall T: integer. (x: T) -> T');
    });

    test('`(x: integer)` under `forall T: number` is a diagnostic', () => {
      const ce = fresh();
      const f = e2(ce, 'x', 'forall T: number. (x: T) -> T', [
        'Typed',
        'x',
        { str: 'integer' },
      ]);
      expect(f.isValid).toBe(false);
      expect(f.toString()).toMatch(COVERAGE);
    });

    test('an UNBOUNDED variable is bounded by `any`: `(x: integer)` fails', () => {
      const ce = fresh();
      const f = e2(ce, 'x', 'forall T. (x: T) -> T', [
        'Typed',
        'x',
        { str: 'integer' },
      ]);
      expect(f.isValid).toBe(false);
      expect(f.toString()).toMatch(COVERAGE);
    });

    test('…and a wide `(x: any)` annotation passes', () => {
      const ce = fresh();
      const f = e2(ce, 'x', 'forall T. (x: T) -> T', [
        'Typed',
        'x',
        { str: 'any' },
      ]);
      expect(f.isValid).toBe(true);
      expect(f.ops[1].toString()).toBe('x');
      expect(f.type.toString()).toBe('forall T. (x: T) -> T');
    });
  });
});

describe('G5 — partial application of a generic literal is rejected', () => {
  test('a 2-ary generic applied to 1 argument gets the dedicated diagnostic', () => {
    // PHASE-1 PROBE (measured before the guard landed): currying did NOT throw
    // `unsolvable-type-variable`. The `prefixSig` rebuild sits behind the
    // `hasAnnotatedParam` gate, which erasure makes `false`, so it never fired.
    // Instead the residual literal was built by re-attaching the FULL 2-ary
    // marker onto the 1-ary curried literal, whose §2.3 arity check then
    // rejected it — the result was
    // `(_1) |-> Error("A generic function-literal signature must be …")`, an
    // error buried in the residual body rather than a diagnostic on the call.
    const ce = fresh();
    const g = e1(
      ce,
      ['Tuple', 'y', 'x'],
      'forall T, U. (x: T, y: U) -> tuple<U, T>'
    );
    const curried = ce.box(['Apply', g.json, 1] as any).evaluate();
    expect(curried.toString()).toMatch(
      /Partial application of a generic function is not supported/
    );
    expect(curried.toString()).not.toMatch(/unsolvable-type-variable/);
    expect(curried.toString()).not.toMatch(/must be a plain signature/);
    // Saturated application is unaffected.
    expect(
      ce
        .box(['Apply', g.json, 1, { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('("a", 1)');
  });

  test('a NON-generic literal still curries', () => {
    const ce = fresh();
    const h = ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y'] as any);
    const curried = ce.box(['Apply', h.json, 1] as any).evaluate();
    expect(curried.operator).toBe('Function');
    expect(curried.toString()).not.toMatch(/Partial application/);
  });

  test('a NAMED under-arity call gets the ordinary missing-argument error', () => {
    // The two routes split, by design:
    //  - ANONYMOUS (`Apply(Function(…), …)`) reaches `makeLambda`'s currying
    //    branch, where the G5 guard fires with
    //    `GENERIC_PARTIAL_APPLICATION_MESSAGE` (the test above).
    //  - NAMED (the SYMBOL route) never reaches it: argument validation pads
    //    the missing operand with an `Error('missing')` first, so the call is
    //    already invalid by the time a lambda would be made. The user gets the
    //    standard missing-argument error — exactly what a GROUND function of
    //    the same arity gives. That parity is the point; a generic function is
    //    not silently curried, and no `unsolvable-type-variable` escapes.
    const ce = fresh();
    ce.declare('g', 'forall T, U. (T, U) -> U');
    ce.assign('g', ce.box(['Function', 'y', 'x', 'y'] as any));
    const call = ce.box(['g', 1] as any);
    expect(call.isValid).toBe(false);
    expect(call.evaluate().toString()).toMatch(/missing/);
    expect(call.evaluate().toString()).not.toMatch(/unsolvable-type-variable/);
    expect(call.evaluate().operator).not.toBe('Function');
    // A ground function of the same arity behaves identically.
    ce.declare('h', '(number, number) -> number');
    ce.assign('h', ce.box(['Function', 'y', 'x', 'y'] as any));
    expect(
      ce
        .box(['h', 1] as any)
        .evaluate()
        .toString()
    ).toMatch(/missing/);
  });
});

describe('EFFECTS — the literal arrow stays `declared ∪ inferred`', () => {
  test('a `pure` marker over a random body reports `random` on the arrow', () => {
    // The EFFECTS-MODEL invariant: the marker becomes authoritative for the
    // TYPE axes, but the literal's own arrow must remain a sound
    // over-approximation of what the body does. The declared/inferred conflict
    // is the declaration boundary's business (phase 2), not the arrow's.
    const ce = fresh();
    const f = e1(ce, ['Random'], 'forall T. (x: T) pure -> T');
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('forall T. (x: T) random -> T');
  });

  test('a declared effect with a pure body keeps the declared effect', () => {
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T. (x: T) random -> T');
    expect(f.type.toString()).toBe('forall T. (x: T) random -> T');
  });

  test('no effects slot, pure body — the arrow stays effect-free', () => {
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T. (x: T) -> T');
    expect(f.type.toString()).toBe('forall T. (x: T) -> T');
  });
});

describe('The §4.2 GROUND INVARIANT holds throughout', () => {
  test('no parameter binding, and no application result, carries a variable', () => {
    const ce = fresh();
    const f = e1(ce, ['Add', 'x', 'x'], 'forall T: number. (x: T) -> T');
    // The body Block's binding for the erased parameter is an ORDINARY inferred
    // parameter — whatever the body's uses narrowed it to (`Add` ⇒ `number`),
    // exactly as for an untyped literal. A type variable never becomes the type
    // of a symbol, and the bound does NOT inform the body either (G8: `number`
    // here comes from `Add`, not from `T: number`).
    const binding = (f.ops[0] as any).localScope.bindings.get('x');
    expect(hasFreeTypeVariables(binding.value.type.type)).toBe(false);
    expect(binding.value.type.isPolymorphic).toBe(false);
    const applied = ce.box(['Apply', f.json, 21] as any).evaluate();
    expect(applied.toString()).toBe('42');
    expect(hasFreeTypeVariables(applied.type.type)).toBe(false);
  });
});

//
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — the DECLARATION BOUNDARY (§2.4/§2.5/§2.6 of the design).
//
// The D7 gates are replaced by an install path: a generic literal assigned to
// a generic declaration becomes the symbol's definition, and every call
// instantiates the clause. Route parity is the organizing principle (the
// lazy-operator lesson), so each behavior is probed on the host API
// (`ce.assign` / `ce.declare`), the `Assign` OPERATOR route, and the raw
// MathJSON box route.
// ═══════════════════════════════════════════════════════════════════════════
//

/** Declare-then-assign — the E3 host route, and the mandatory recursion
 * idiom. Returns the engine. */
function declareAssign(signature: string, literal: any): ComputeEngine {
  const ce = fresh();
  ce.declare('f', signature);
  ce.assign('f', ce.box(literal));
  return ce;
}

describe('§5.1 — identity and swap, end to end, on every route', () => {
  test('E3 host route — one engine, two instantiations, no pollution', () => {
    const ce = declareAssign('forall T. (x: T) -> T', ['Function', 'x', 'x']);
    expect(ce.box('f').type.toString()).toBe('forall T. (x: T) -> T');
    expect(ce.box('f').type.isPolymorphic).toBe(true);

    expect(
      ce
        .box(['f', 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
    expect(ce.box(['f', { str: 'a' }] as any).type.toString()).toBe('string');
    // …and back, on the SAME engine: the declaration is unchanged.
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
    expect(ce.box('f').type.toString()).toBe('forall T. (x: T) -> T');
  });

  test('the OPERATOR-slot declaration (`{ signature: … }`) agrees', () => {
    const ce = fresh();
    ce.declare('f', { signature: 'forall T. (x: T) -> T' } as any);
    ce.assign('f', ce.box(['Function', 'x', 'x'] as any));
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  test('the `Assign` OPERATOR route — a plain literal onto a declaration', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T) -> T');
    const r = ce.box(['Assign', 'f', ['Function', 'x', 'x']] as any).evaluate();
    expect(r.toString()).not.toContain('incompatible-type');
    expect(
      ce
        .box(['f', 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
  });

  test('the `Assign` OPERATOR route — an E1 literal, no declaration at all', () => {
    // The literal carries its own contract, so no `ce.declare` is needed: the
    // polytype rides onto the operator definition it installs.
    const ce = fresh();
    ce.box([
      'Assign',
      'f',
      ['Function', 'x', { str: 'forall T. (x: T) -> T' }],
    ] as any).evaluate();
    expect(ce.box('f').type.toString()).toBe('forall T. (x: T) -> T');
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  test('`ce.assign` of an E1/E2 literal keeps the polytype as the signature', () => {
    // Before phase 2 this fell to the inferred-signature path, which reads the
    // ASCRIBED BODY type and produced the nonsense
    // `(unknown) -> forall T. (x: T) -> T`.
    for (const literal of [
      e1(fresh(), 'x', 'forall T. (x: T) -> T'),
      e2(fresh(), 'x', 'forall T. (x: T) -> T', 'x'),
    ]) {
      const ce = fresh();
      ce.assign('f', ce.box(literal.json));
      expect(ce.box('f').type.toString()).toBe('forall T. (x: T) -> T');
      expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
      expect(ce.box(['f', { str: 'a' }] as any).type.toString()).toBe('string');
    }
  });

  test('swap — two variables, instantiated per call', () => {
    const ce = declareAssign('forall T, U. (x: T, y: U) -> tuple<U, T>', [
      'Function',
      ['Tuple', 'y', 'x'],
      'x',
      'y',
    ]);
    expect(
      ce
        .box(['f', 1, { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('("a", 1)');
    expect(ce.box(['f', 1, { str: 'a' }] as any).type.toString()).toBe(
      'tuple<string, finite_integer>'
    );
  });

  test('the ANONYMOUS `Apply` route evaluates but does NOT type (pinned)', () => {
    // `Apply(literal, …)` never passes a symbol's boxed-definition seam, so no
    // arm is resolved and no result instantiation happens: the honest static
    // answer stays `unknown`. Only the SYMBOL-call route instantiates. (Phase 1
    // measured the same `unknown`; phase 2 does not change it.)
    const ce = fresh();
    const f = e1(ce, 'x', 'forall T. (x: T) -> T');
    expect(ce.box(['Apply', f.json, 5] as any).type.toString()).toBe('unknown');
    expect(
      ce
        .box(['Apply', f.json, 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
  });
});

describe('§5.3 — bounds and broadcast (no double-lift)', () => {
  test('a bounded literal broadcasts over a list, at its own rank', () => {
    const ce = declareAssign('forall T: number. (x: T) -> T', [
      'Function',
      ['Multiply', 2, 'x'],
      'x',
    ]);
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
    expect(ce.box(['f', ['List', 1, 2, 3]] as any).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    // The bound is enforced at the scalar base.
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });

  test('the OPERATOR-DEF twin arm does not double-lift (§2.5 regression)', () => {
    // `ce.assign` of an E1 literal with no declaration installs an OPERATOR
    // definition (`_isLambda`) carrying the polytype — the arm that, before
    // this milestone, had neither `instantiatedResultType` nor the D10 echo
    // guard and typed `f([1,2,3])` as `list<vector<…^3>>`.
    const ce = fresh();
    ce.assign('f', e1(ce, 'x', 'forall T. (x: T) -> T'));
    expect(ce.box(['f', ['List', 1, 2, 3]] as any).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    // Rank 2 — where the mixed encoding always showed.
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['f', m] as any).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
  });

  test('…and the VALUE-DEF arm agrees (the pre-existing half)', () => {
    const ce = declareAssign('forall T. (x: T) -> T', ['Function', 'x', 'x']);
    expect(ce.box(['f', ['List', 1, 2, 3]] as any).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
  });

  // RANK DOMINANCE. The D10 echo short-circuit answers "the result IS the
  // echoed operand" — true only while that operand DOMINATES the broadcast.
  // With a non-echoed broadcasting operand of higher rank the runtime maps
  // over ALL of them and the wrapper's lifted answer stands. The builtin arm
  // has carried this test since D10; both lambda arms now mirror it.
  test('the echoed operand DOMINATES: the short-circuit applies', () => {
    const ce = fresh();
    ce.assign('f', e1(ce, 'x', 'forall T. (x: T, n: number) -> T'));
    const call = ce.box(['f', ['List', 1, 2], 5] as any);
    expect(call.type.toString()).toBe('vector<finite_integer^2>');
    expect(call.evaluate().toString()).toBe('[1,2]');
  });

  test('a HIGHER-RANK non-echo operand defeats it (operator-def arm)', () => {
    // `n` is quantified by a SECOND variable, so it is not an echo position
    // and a collection is admitted there. The body broadcasts, so the runtime
    // result is a matrix — the echo's `vector` would be a lie.
    const ce = fresh();
    ce.assign('f', e1(ce, ['Add', 'x', 'n'], 'forall T, U. (x: T, n: U) -> T'));
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    const call = ce.box(['f', ['List', 1, 2], m] as any);
    expect(call.type.toString()).not.toBe('vector<finite_integer^2>');
    const evaluated = call.evaluate();
    expect(evaluated.toString()).toBe('[[2,3],[5,6]]');
    expect(evaluated.type.matches(call.type)).toBe(true);
  });

  test('…and the same on the VALUE-DEF arm', () => {
    const ce = declareAssign('forall T. (x: T, n: number) -> T', [
      'Function',
      ['Add', 'x', 'n'],
      'x',
      'n',
    ]);
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    const call = ce.box(['f', ['List', 1, 2], m] as any);
    expect(call.type.toString()).not.toBe('vector<finite_integer^2>');
    const evaluated = call.evaluate();
    expect(evaluated.toString()).toBe('[[2,3],[5,6]]');
    expect(evaluated.type.matches(call.type)).toBe(true);
  });
});

describe('§5.4 — generic recursion (declare-then-assign)', () => {
  test('a self-calling body, at two instantiations', () => {
    const ce = fresh();
    ce.declare('nest', 'forall T. (x: T, n: integer) -> T');
    ce.assign(
      'nest',
      ce.box([
        'Function',
        ['If', ['LessEqual', 'n', 0], 'x', ['nest', 'x', ['Subtract', 'n', 1]]],
        'x',
        'n',
      ] as any)
    );
    expect(
      ce
        .box(['nest', 5, 3] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(ce.box(['nest', 5, 3] as any).type.toString()).toBe(
      'finite_integer'
    );
    expect(
      ce
        .box(['nest', { str: 'a' }, 2] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
    expect(ce.box(['nest', { str: 'a' }, 2] as any).type.toString()).toBe(
      'string'
    );
    // The declaration survived the self-call: no narrowing write happened
    // during body canonicalization (the S3 fallback, §2.5).
    expect(ce.box('nest').type.toString()).toBe(
      'forall T. (x: T, n: integer) -> T'
    );
  });
});

describe('§5.5 — mixed parameters', () => {
  test('the ground parameter is enforced at apply, the erased one is not', () => {
    const ce = declareAssign('forall T. (x: T, n: integer) -> T', [
      'Function',
      ['Add', 'x', 'n'],
      'x',
      'n',
    ]);
    expect(
      ce
        .box(['f', 5, 2] as any)
        .evaluate()
        .toString()
    ).toBe('7');
    expect(
      ce
        .box(['f', 5, { str: 'z' }] as any)
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });
});

describe('§5.6 — the boundary acceptance rule (§2.4)', () => {
  const MISMATCH = /is not compatible with the type/;

  test('the adjunct REBUILD invariant: `stripArrowEffects` keeps `typeParams`', () => {
    // Rule 3 strips the effects axis off BOTH arrows and then compares them
    // with `isSubtype`, which is α-equivalence only BETWEEN POLYTYPES. Were
    // the clause dropped by the strip, the comparison would silently degrade
    // to ordinary function subtyping.
    const t = parseType('forall T. (x: T) random -> T');
    const stripped = stripArrowEffects(t);
    expect(typeToString(stripped)).toBe('forall T. (x: T) -> T');
    expect((stripped as any).typeParams).toHaveLength(1);
  });

  // Rule 3 (G9) — α-equivalence on the TYPE axes only.
  test('G9 — a pure RENAMING of the clause is accepted', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T) -> T');
    expect(() =>
      ce.assign('f', e1(ce, 'q', 'forall U. (u: U) -> U'))
    ).not.toThrow();
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
  });

  test('G9 — argument NAMES are cosmetic, so an unnamed declaration matches', () => {
    // The E1 sugar REQUIRES named arguments, so a declaration written
    // `forall T. (T) -> T` must still accept its own E1 implementation.
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', 'forall T. (x: T) -> T'))
    ).not.toThrow();
  });

  test('G9 — a genuine mismatch on a type axis is rejected', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T) -> T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', 'forall T. (x: T) -> integer'))
    ).toThrow(MISMATCH);
  });

  test('G9 — differing declared BOUNDS are a mismatch', () => {
    const ce = fresh();
    ce.declare('f', 'forall T: number. (x: T) -> T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', 'forall U: integer. (y: U) -> U'))
    ).toThrow(MISMATCH);
  });

  test('G9 — a NARROWER explicit effect set is accepted (effects axis excluded)', () => {
    // Explicitness must not be penalized where silence passes: the effects axis
    // is governed by rule 2's `inferred ⊆ declared` subset alone.
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T) random -> T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', 'forall T. (x: T) pure -> T'))
    ).not.toThrow();
  });

  // Rule 2 — effects.
  test('a `random` body under a `pure` declaration is rejected', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T) pure -> T');
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', ['Random']], 'x'] as any))
    ).toThrow(/random/);
  });

  // Rule 4 — ground annotations cover the domain (CONTRAVARIANT).
  test('rule 4 — `(x: real)` under `forall T: integer` is accepted', () => {
    const ce = fresh();
    ce.declare('f', 'forall T: integer. (x: T) -> T');
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', 'x', ['Typed', 'x', { str: 'real' }]] as any)
      )
    ).not.toThrow();
  });

  test('rule 4 — `(x: integer)` under `forall T: number` is rejected', () => {
    const ce = fresh();
    ce.declare('f', 'forall T: number. (x: T) -> T');
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', 'x', ['Typed', 'x', { str: 'integer' }]] as any)
      )
    ).toThrow(MISMATCH);
  });

  test('rule 4 — an UNBOUNDED variable admits only `any`/`unknown`', () => {
    const ok = fresh();
    ok.declare('f', 'forall T. (x: T) -> T');
    expect(() =>
      ok.assign(
        'f',
        ok.box(['Function', 'x', ['Typed', 'x', { str: 'any' }]] as any)
      )
    ).not.toThrow();

    const bad = fresh();
    bad.declare('f', 'forall T. (x: T) -> T');
    expect(() =>
      bad.assign(
        'f',
        bad.box(['Function', 'x', ['Typed', 'x', { str: 'real' }]] as any)
      )
    ).toThrow(MISMATCH);
  });

  test('rule 4 — a ground annotation at a GROUND position reconciles as today', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T, n: integer) -> T');
    expect(() =>
      ce.assign(
        'f',
        ce.box([
          'Function',
          ['Add', 'x', 'n'],
          'x',
          ['Typed', 'n', { str: 'integer' }],
        ] as any)
      )
    ).not.toThrow();
    expect(
      ce
        .box(['f', 5, 2] as any)
        .evaluate()
        .toString()
    ).toBe('7');
  });

  // Rule 1 — arity.
  test('an arity mismatch keeps its own diagnostic', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (x: T, y: T) -> T');
    expect(() => ce.assign('f', ce.box(['Function', 'x', 'x'] as any))).toThrow(
      /takes 1 parameter\(s\)/
    );
  });

  // Rule 0 — G11.
  test('G11 — a polymorphic overload INTERSECTION is rejected, ahead of arity', () => {
    const ce = fresh();
    ce.declare('m', '(forall T. (T) -> T) & ((string) -> string)');
    // A 2-ary literal would fail the arity rule too; G11 must win.
    expect(() =>
      ce.assign('m', ce.box(['Function', 'x', 'x', 'y'] as any))
    ).toThrow(/generic OVERLOAD SET cannot take a function-literal body/);
  });

  test('G11 — on the `Assign` OPERATOR route, as an error VALUE', () => {
    const ce = fresh();
    ce.declare('m', '(forall T. (T) -> T) & ((string) -> string)');
    const v = ce.box(['Assign', 'm', ['Function', 'x', 'x']] as any).evaluate();
    expect(v.toString()).toContain('incompatible-type');
    expect(v.toString()).toMatch(
      /generic OVERLOAD SET cannot take a function-literal body/
    );
  });
});

describe('§5.7 — G10, the variable-correlated return is a TRUSTED ascription', () => {
  test('`x |-> 0` installs at `forall T. (T) -> T`; `f("a")` types `string`', () => {
    // RULED (G10, 2026-08-04): under erasure nothing verifies that the body
    // returns its argument's type, and the typed-function-literals precedent
    // (ruled 2026-07-12) makes return ascriptions TRUSTED, TypeScript-style —
    // not covariant runtime checks. Disclosed and pinned here; a strict-mode
    // per-call instantiated-result check is recorded as future work.
    const ce = declareAssign('forall T. (x: T) -> T', ['Function', 0, 'x']);
    expect(ce.box(['f', { str: 'a' }] as any).type.toString()).toBe('string');
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('G4 — a GROUND result under a `forall` reconciles as today', () => {
    const ce = declareAssign('forall T. (x: T) -> boolean', [
      'Function',
      ['Equal', 'x', 'x'],
      'x',
    ]);
    expect(ce.box(['f', 5] as any).type.toString()).toBe('boolean');
    expect(
      ce
        .box(['f', 5] as any)
        .evaluate()
        .toString()
    ).toBe('"True"');
  });
});

describe('§2.6 — G2, generic × multi-clause is rejected in BOTH directions', () => {
  const G2 = /generic-clause-unsupported/;

  test('a later clause onto a GENERIC definition (operator route)', () => {
    const ce = declareAssign('forall T. (x: T) -> T', ['Function', 'x', 'x']);
    const v = ce
      .box([
        'DefineFunction',
        'f',
        ['Function', 'x', ['Typed', 'x', { str: 'string' }]],
      ] as any)
      .evaluate();
    expect(v.toString()).toMatch(G2);
  });

  test('a GENERIC clause onto an existing ground definition', () => {
    const ce = fresh();
    ce.box([
      'DefineFunction',
      'g',
      ['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'integer' }]],
    ] as any).evaluate();
    const v = ce
      .box([
        'DefineFunction',
        'g',
        e1(ce, 'x', 'forall T. (x: T) -> T').json,
      ] as any)
      .evaluate();
    expect(v.toString()).toMatch(G2);
  });

  test('the HOST route THROWS instead of yielding an error value', () => {
    const ce = declareAssign('forall T. (x: T) -> T', ['Function', 'x', 'x']);
    expect(() =>
      defineFunctionClause(
        ce as any,
        'f',
        ce.box(['Function', 'x', ['Typed', 'x', { str: 'string' }]] as any)
      )
    ).toThrow(/cannot be extended with clauses/);
  });

  // §2.6 rule 1 — clause slot + LITERAL parameter, rejected at the FIRST
  // definition (no `existing` to gate on). Without this gate the §4.2
  // single-clause shortcut hands the literal to `ce.assign` unchecked, and
  // erasure has already dropped the literal parameter's value annotation:
  // `f(3, 9)` would silently run the `y = 0` clause body.
  const literalParamGeneric = (marker: string) =>
    [
      'Function',
      ['Typed', 1, { str: marker }],
      'x',
      ['Typed', 'literalParam_2', { str: '0' }],
    ] as any;

  test('clause + literal parameter, FIRST definition (operator route)', () => {
    const ce = fresh();
    const v = ce
      .box([
        'DefineFunction',
        'f',
        literalParamGeneric('forall T. (x: T, y: 0) -> integer'),
      ] as any)
      .evaluate();
    expect(v.toString()).toMatch(G2);
    // Nothing was installed.
    expect(
      ce
        .box(['f', 3, 0] as any)
        .evaluate()
        .toString()
    ).not.toBe('1');
  });

  test('…and the HOST route THROWS', () => {
    const ce = fresh();
    expect(() =>
      defineFunctionClause(
        ce as any,
        'f',
        ce.box(literalParamGeneric('forall T. (x: T, y: 0) -> integer'))
      )
    ).toThrow(/cannot combine a generic clause with a literal parameter/);
  });

  test('…even when erasure would have dropped the value guard', () => {
    // Marker position 2 is QUANTIFIED here, so the `0` annotation used to be
    // erased and `f` installed with NO value guard at all — `f(3, 9)` ran the
    // clause body. Two gates now stop it, and the §2.4 rule-4 coverage check
    // gets there first (canonicalization precedes clause accumulation): an
    // unbounded `T` is bounded by `any`, which does not cover `0`.
    const ce = fresh();
    const v = ce
      .box([
        'DefineFunction',
        'f',
        literalParamGeneric('forall T. (x: T, y: T) -> integer'),
      ] as any)
      .evaluate();
    expect(v.toString()).toMatch(/must accept every admitted instantiation/);
    expect(
      ce
        .box(['f', 3, 9] as any)
        .evaluate()
        .toString()
    ).not.toBe('1');
  });

  test('a PLAIN single-clause generic definition is NOT rejected (§2.6 rule 4)', () => {
    // It delegates to `ce.assign`, i.e. the install path above.
    const ce = fresh();
    const v = ce
      .box([
        'DefineFunction',
        'h',
        e1(ce, 'x', 'forall T. (x: T) -> T').json,
      ] as any)
      .evaluate();
    expect(v.toString()).not.toMatch(G2);
    expect(ce.box(['h', 5] as any).type.toString()).toBe('finite_integer');
    expect(ce.box(['h', { str: 'a' }] as any).type.toString()).toBe('string');
  });

  test('…and so is a plain literal onto a generic DECLARATION', () => {
    // A bare declaration is not a definition: the §4.2 single-clause rule
    // applies and `declaredSignatureOf` deliberately reports "no declaration"
    // for a polytype, so no polytype ever enters clause storage.
    const ce = fresh();
    ce.declare('k', 'forall T. (x: T) -> T');
    const v = ce
      .box(['DefineFunction', 'k', ['Function', 'x', 'x']] as any)
      .evaluate();
    expect(v.toString()).not.toMatch(G2);
    expect(ce.box(['k', 5] as any).type.toString()).toBe('finite_integer');
    expect(ce.box(['k', { str: 'a' }] as any).type.toString()).toBe('string');
  });
});

describe('§5.12 — the ground invariant holds at every installed application', () => {
  test('no result type of a generic call contains a free variable', () => {
    const cases: [string, any, any[]][] = [
      ['forall T. (x: T) -> T', ['Function', 'x', 'x'], [5]],
      ['forall T. (x: T) -> T', ['Function', 'x', 'x'], [['List', 1, 2, 3]]],
      ['forall T: number. (x: T) -> T', ['Function', 'x', 'x'], [1.5]],
      [
        'forall T, U. (x: T, y: U) -> tuple<U, T>',
        ['Function', ['Tuple', 'y', 'x'], 'x', 'y'],
        [1, { str: 'a' }],
      ],
      [
        'forall T. (x: T, n: integer) -> T',
        ['Function', ['Add', 'x', 'n'], 'x', 'n'],
        [5, 2],
      ],
    ];
    for (const [signature, literal, args] of cases) {
      const ce = declareAssign(signature, literal);
      const call = ce.box(['f', ...args] as any);
      expect(hasFreeTypeVariables(call.type.type)).toBe(false);
      expect(hasFreeTypeVariables(call.evaluate().type.type)).toBe(false);
      // The DECLARATION itself stays a closed polytype.
      expect(hasFreeTypeVariables(ce.box('f').type.type)).toBe(false);
    }
  });
});

describe('§5.13 — G3, compile() declines a generic user function whole-fn', () => {
  // §2.7: the emitted code can neither coerce nor broadcast open parameters —
  // a lifted call would run the scalar body on the collection and silently
  // compute a wrong value. `ensureUserFunctionEmitted` returns undefined
  // (the decline convention), so compile() serves the interpreted fallback.
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');

  it('declared route (E3): declines, fallback agrees with the interpreter', () => {
    const ce = fresh();
    ce.declare('gd', 'forall T: number. (x: T) -> T');
    ce.assign('gd', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = compile(ce.box(['gd', 'y'] as any));
    // No lowering emitted for the generic fn: the whole expression declined.
    expect(r?.code ?? '').not.toContain('_fn_gd');
    // The fallback runner is the honest party.
    expect(r?.run?.({ y: 21 })).toBe(42);
    expect(ce.box(['gd', 21] as any).evaluate().re).toBe(42);
  });

  it('bare-assign route (own polytype marker): declines too', () => {
    const ce = fresh();
    ce.assign(
      'hd',
      e2(ce, ['Add', 'x', 'x'], 'forall T: number. (x: T) -> T', 'x')
    );
    const r = compile(ce.box(['hd', 'y'] as any));
    expect(r?.code ?? '').not.toContain('_fn_hd');
    expect(r?.run?.({ y: 21 })).toBe(42);
  });

  it('a GROUND annotated literal still compiles (the guard is generic-only)', () => {
    const ce = fresh();
    ce.assign(
      'kd',
      ce.box([
        'Function',
        ['Add', 'x', 'x'],
        ['Typed', 'x', { str: 'number' }],
      ] as any)
    );
    const r = compile(ce.box(['kd', 'y'] as any));
    expect(r?.code ?? '').toContain('_fn_kd');
    expect(r?.run?.({ y: 21 })).toBe(42);
  });
});
