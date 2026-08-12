import { ComputeEngine } from '../../src/compute-engine';
import { functionLiteralReturnType } from '../../src/compute-engine/boxed-expression/function-literal';
import { hasFreeTypeVariables } from '../../src/common/type/instantiate';
import { defineFunctionClause } from '../../src/compute-engine/multi-clause';
import { stripArrowEffects } from '../../src/compute-engine/boxed-expression/effects-inference';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Generic function literals (M1, PHASE 1 — the literal standing alone).
//
// `docs/plans/2026-08-04-generic-function-literals-design.md`: a whole-signature
// `where` clause on a function literal is accepted, the literal's quantified
// parameters are ERASED before the body canonicalizes (G1), and the literal's
// `.type` becomes the polytype. Two spellings introduce the clause here:
//
//   E1  `["Function", body, "'(x: T) -> T where T'"]`      (signature-string)
//   E2  `["Function", ["Typed", body, "'… where …'"], …params]` (full marker)
//
// The DECLARATION BOUNDARY (`ce.assign` / the `Assign` operator / Epsil
// annotated `const`) is phase 2 — the second half of this file. Its sibling
// pins live in `type-variables.test.ts` ("THE DECLARATION BOUNDARY") and
// `test/epsil/type-variables-epsil.test.ts`.
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
    const f = e1(ce, ['Add', 'x', 'x'], '(x: T) -> T where T: number');
    expect(f.isValid).toBe(true);
    expect(f.isCanonical).toBe(true);
    expect(f.type.toString()).toBe('(x: T) -> T where T: number');
    expect(f.type.isPolymorphic).toBe(true);
  });

  test('E2 boxes to the same literal — E1 lowers to E2', () => {
    const ce = fresh();
    const a = e1(ce, ['Add', 'x', 'x'], '(x: T) -> T where T: number');
    const b = e2(ce, ['Add', 'x', 'x'], '(x: T) -> T where T: number', 'x');
    expect(JSON.stringify(b.json)).toBe(JSON.stringify(a.json));
    // The clause survives canonicalization as the body-slot marker.
    expect(JSON.stringify(a.json)).toBe(
      JSON.stringify([
        'Function',
        [
          'Block',
          ['Typed', ['Add', 'x', 'x'], "'(x: T) -> T where T: number'"],
        ],
        'x',
      ])
    );
  });

  // ROUTE PARITY: `ce.function(...)` with pre-boxed operands must agree with the
  // raw-MathJSON `ce.box(...)` route (the lazy-operator lesson).
  test('route parity — `ce.function` agrees with `ce.box`', () => {
    const ce = fresh();
    const viaBox = e2(ce, 'x', '(x: T) -> T where T', 'x');
    const viaFunction = ce.function('Function', [
      ce.function('Typed', [ce.box('x'), ce.string('(x: T) -> T where T')]),
      ce.symbol('x'),
    ]);
    expect(viaFunction.isValid).toBe(true);
    expect(viaFunction.type.toString()).toBe('(x: T) -> T where T');
    expect(JSON.stringify(viaFunction.json)).toBe(JSON.stringify(viaBox.json));
  });

  test('a ground result under a clause is still an ordinary return type', () => {
    const ce = fresh();
    const f = e1(ce, ['Equal', 'x', 'x'], '(x: T) -> boolean where T');
    expect(f.type.toString()).toBe('(x: T) -> boolean where T');
    expect(functionLiteralReturnType(f)).toBe('boolean');
  });

  test('an OPEN declared result yields no return type (never an open type)', () => {
    // `functionLiteralReturnType` joins the wide-result convention when the
    // declared result mentions a quantified variable: nothing ground to
    // ascribe, so the return stays inferred. An open type must never leave
    // this accessor — it would reach the ground-invariant tripwires.
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T');
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
      { str: '(x: T) -> T where T: number' },
    ] as any);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(x: T) -> T where T: number');
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
    const f = e1(ce, ['Add', 'x', 'n'], '(x: T, n: integer) -> T where T');
    expect(f.isValid).toBe(true);
    // `x` is a BARE symbol; `n` keeps its `Typed` annotation.
    expect(f.ops[1].toString()).toBe('x');
    expect(f.ops[2].json).toEqual(['Typed', 'n', "'integer'"]);
    expect(f.type.toString()).toBe('(x: T, n: integer) -> T where T');
  });

  test('a hand-authored E2 whose parameter annotation NAMES the variable', () => {
    // The pre-pass runs BEFORE parameter normalization, so `["Typed", x, "'T'"]`
    // never reaches type resolution (where `T` is not a declared type name).
    const ce = fresh();
    const f = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'x'], { str: '(x: T) -> T where T: number' }],
      ['Typed', 'x', { str: 'T' }],
    ] as any);
    expect(f.isValid).toBe(true);
    expect(f.ops[1].toString()).toBe('x');
    expect(f.type.toString()).toBe('(x: T) -> T where T: number');
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
    const f = e1(ce, 'x', '(x: T) -> T where T');
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
    expect(f.type.toString()).toBe('(x: T) -> T where T');
  });

  test('a BOUND violation is rejected at apply time (the widened gate)', () => {
    // Erasure leaves the literal with no annotated parameter, so the apply-time
    // validation gate had to widen to the polytype marker — otherwise an
    // anonymous application (which never passes a symbol's definition seam)
    // would skip bound enforcement entirely.
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T: number');
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
    const f = e1(ce, ['Add', 'x', 'n'], '(x: T, n: integer) -> T where T');
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
      '(x: T, y: U) -> tuple<U, T> where T, U'
    );
    expect(g.type.toString()).toBe('(x: T, y: U) -> tuple<U, T> where T, U');
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
    const f = e2(ce, 'x', '(x: T, y: T) -> T where T', 'x');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('a VARIADIC marker', () => {
    const ce = fresh();
    const f = e2(ce, 'x', '(x: T, y: T*) -> T where T', 'x', 'y');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('an OPTIONAL-argument marker', () => {
    const ce = fresh();
    const f = e2(ce, 'x', '(x: T, y: T?) -> T where T', 'x', 'y');
    expect(f.isValid).toBe(false);
    expect(f.toString()).toMatch(INVALID);
  });

  test('marker argument NAMES are cosmetic; positional mapping is authoritative', () => {
    const ce = fresh();
    const f = e2(
      ce,
      ['Add', 'a', 'k'],
      '(x: T, n: integer) -> T where T',
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
    expect(f.type.toString()).toBe('(x: T, n: integer) -> T where T');
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

    test('`(x: real)` under `where T: integer` is accepted (and dropped)', () => {
      const ce = fresh();
      const f = e2(ce, 'x', '(x: T) -> T where T: integer', [
        'Typed',
        'x',
        { str: 'real' },
      ]);
      expect(f.isValid).toBe(true);
      expect(f.ops[1].toString()).toBe('x'); // erased
      expect(f.type.toString()).toBe('(x: T) -> T where T: integer');
    });

    test('`(x: integer)` under `where T: number` is a diagnostic', () => {
      const ce = fresh();
      const f = e2(ce, 'x', '(x: T) -> T where T: number', [
        'Typed',
        'x',
        { str: 'integer' },
      ]);
      expect(f.isValid).toBe(false);
      expect(f.toString()).toMatch(COVERAGE);
    });

    test('an UNBOUNDED variable is bounded by `any`: `(x: integer)` fails', () => {
      const ce = fresh();
      const f = e2(ce, 'x', '(x: T) -> T where T', [
        'Typed',
        'x',
        { str: 'integer' },
      ]);
      expect(f.isValid).toBe(false);
      expect(f.toString()).toMatch(COVERAGE);
    });

    test('…and a wide `(x: any)` annotation passes', () => {
      const ce = fresh();
      const f = e2(ce, 'x', '(x: T) -> T where T', [
        'Typed',
        'x',
        { str: 'any' },
      ]);
      expect(f.isValid).toBe(true);
      expect(f.ops[1].toString()).toBe('x');
      expect(f.type.toString()).toBe('(x: T) -> T where T');
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
    // `(_1) |-> Error("A function-literal signature marker must be …")`, an
    // error buried in the residual body rather than a diagnostic on the call.
    const ce = fresh();
    const g = e1(
      ce,
      ['Tuple', 'y', 'x'],
      '(x: T, y: U) -> tuple<U, T> where T, U'
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
    ce.declare('g', '(T, U) -> U where T, U');
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
    const f = e1(ce, ['Random'], '(x: T) pure -> T where T');
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('(x: T) random -> T where T');
  });

  test('a declared effect with a pure body keeps the declared effect', () => {
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) random -> T where T');
    expect(f.type.toString()).toBe('(x: T) random -> T where T');
  });

  test('no effects slot, pure body — the arrow stays effect-free', () => {
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T');
    expect(f.type.toString()).toBe('(x: T) -> T where T');
  });
});

describe('The §4.2 GROUND INVARIANT holds throughout', () => {
  test('no parameter binding, and no application result, carries a variable', () => {
    const ce = fresh();
    const f = e1(ce, ['Add', 'x', 'x'], '(x: T) -> T where T: number');
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
    const ce = declareAssign('(x: T) -> T where T', ['Function', 'x', 'x']);
    expect(ce.box('f').type.toString()).toBe('(x: T) -> T where T');
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
    expect(ce.box('f').type.toString()).toBe('(x: T) -> T where T');
  });

  test('the OPERATOR-slot declaration (`{ signature: … }`) agrees', () => {
    const ce = fresh();
    ce.declare('f', { signature: '(x: T) -> T where T' } as any);
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
    ce.declare('f', '(x: T) -> T where T');
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
      ['Function', 'x', { str: '(x: T) -> T where T' }],
    ] as any).evaluate();
    expect(ce.box('f').type.toString()).toBe('(x: T) -> T where T');
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
    // `(unknown) -> ((x: T) -> T where T)`.
    for (const literal of [
      e1(fresh(), 'x', '(x: T) -> T where T'),
      e2(fresh(), 'x', '(x: T) -> T where T', 'x'),
    ]) {
      const ce = fresh();
      ce.assign('f', ce.box(literal.json));
      expect(ce.box('f').type.toString()).toBe('(x: T) -> T where T');
      expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
      expect(ce.box(['f', { str: 'a' }] as any).type.toString()).toBe('string');
    }
  });

  test('swap — two variables, instantiated per call', () => {
    const ce = declareAssign('(x: T, y: U) -> tuple<U, T> where T, U', [
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

  // R2. The ANONYMOUS application crosses no symbol/definition seam, so neither
  // the operator-def nor the value-def arm of `boxed-function.ts`'s `type()`
  // runs — the instantiation happens in `Apply`'s own type handler instead
  // (`library/core.ts`). Both spellings are the same node: the
  // application-head form canonicalizes to `Apply`.
  test('the ANONYMOUS `Apply` route instantiates its callee', () => {
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T');
    expect(ce.box(['Apply', f.json, 5] as any).type.toString()).toBe(
      'finite_integer'
    );
    expect(
      ce
        .box(['Apply', f.json, 5] as any)
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      ce.box(['Apply', f.json, { str: 'a' }] as any).type.toString()
    ).toBe('string');
  });

  test('…and the application-HEAD spelling is the same node', () => {
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T');
    const head = ce.box([f.json, 5] as any);
    expect(head.operator).toBe('Apply');
    expect(head.type.toString()).toBe('finite_integer');
    expect(head.evaluate().toString()).toBe('5');
    expect(ce.box([f.json, { str: 'a' }] as any).type.toString()).toBe(
      'string'
    );
  });

  test('a lift-admitted collection operand binds WHOLE, as on the named route', () => {
    // `Apply` does not broadcast — `apply()` binds the argument whole — so the
    // D10 echo answer (the operand's own type) is the honest one here too.
    const ce = fresh();
    const f = e1(ce, 'x', '(x: T) -> T where T');
    const call = ce.box(['Apply', f.json, ['List', 1, 2]] as any);
    expect(call.type.toString()).toBe('vector<finite_integer^2>');
    expect(call.evaluate().toString()).toBe('[1,2]');
  });

  test('a GROUND callee is unchanged (no polytype, no instantiation)', () => {
    const ce = fresh();
    const g = e2(ce, 'x', '(x: integer) -> integer', 'x');
    expect(ce.box(['Apply', g.json, 5] as any).type.toString()).toBe('integer');
    expect(ce.box([g.json, 5] as any).type.toString()).toBe('integer');
  });
});

describe('§5.3 — bounds and broadcast (no double-lift)', () => {
  test('a bounded literal broadcasts over a list, at its own rank', () => {
    const ce = declareAssign('(x: T) -> T where T: number', [
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
    ce.assign('f', e1(ce, 'x', '(x: T) -> T where T'));
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
    const ce = declareAssign('(x: T) -> T where T', ['Function', 'x', 'x']);
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
    ce.assign('f', e1(ce, 'x', '(x: T, n: number) -> T where T'));
    const call = ce.box(['f', ['List', 1, 2], 5] as any);
    expect(call.type.toString()).toBe('vector<finite_integer^2>');
    expect(call.evaluate().toString()).toBe('[1,2]');
  });

  test('a HIGHER-RANK non-echo operand defeats it (operator-def arm)', () => {
    // `n` is quantified by a SECOND variable, so it is not an echo position
    // and a collection is admitted there. The body broadcasts, so the runtime
    // result is a matrix — the echo's `vector` would be a lie.
    const ce = fresh();
    ce.assign('f', e1(ce, ['Add', 'x', 'n'], '(x: T, n: U) -> T where T, U'));
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    const call = ce.box(['f', ['List', 1, 2], m] as any);
    expect(call.type.toString()).not.toBe('vector<finite_integer^2>');
    const evaluated = call.evaluate();
    expect(evaluated.toString()).toBe('[[2,3],[5,6]]');
    expect(evaluated.type.matches(call.type)).toBe(true);
  });

  test('…and the same on the VALUE-DEF arm', () => {
    const ce = declareAssign('(x: T, n: number) -> T where T', [
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

// D10 RE-RULED, 2026-08-04. The measurement that forced it: at a
// lift-admitted position the runtime MAPS, so `T` denotes ONE ELEMENT. Under
// the old whole-actual bind a result that MENTIONS `T` (rather than being the
// bare `T` the retired echo short-circuit recognized) came out one rank too
// high — `(T) -> tuple<T, T> where T` over `[1, 2]` typed
// `list<tuple<vector<…^2>, vector<…^2>>>` while the value is
// `[(1,1), (2,2)]`. Every case below asserts evaluated ⊆ declared, which is
// what the old answers failed.
describe('§5.3 — D10: a lift-admitted operand binds its ELEMENT', () => {
  const pin = (ce: ComputeEngine, arg: any, type: string, value: string) => {
    const call = ce.box(['f', arg] as any);
    expect(call.type.toString()).toBe(type);
    const evaluated = call.evaluate();
    expect(evaluated.toString()).toBe(value);
    expect(evaluated.type.matches(call.type)).toBe(true);
  };

  test('a MENTION result: the wrap is around the per-element tuple', () => {
    const ce = fresh();
    ce.assign(
      'f',
      e1(ce, ['Tuple', 'x', 'x'], '(x: T) -> tuple<T, T> where T')
    );
    // The scalar call is the per-element answer the wrap is built from.
    pin(ce, 5, 'tuple<finite_integer, finite_integer>', '(5, 5)');
    pin(
      ce,
      ['List', 1, 2],
      'list<tuple<finite_integer, finite_integer>>',
      '[(1, 1),(2, 2)]'
    );
    // Rank 2 — the depth the peel has to reach (the broadcast maps to the
    // scalar LEAVES, so `T` is `finite_integer`, not a matrix row).
    pin(
      ce,
      ['List', ['List', 1, 2], ['List', 3, 4]],
      'list<tuple<finite_integer, finite_integer>>',
      '[[(1, 1),(2, 2)],[(3, 3),(4, 4)]]'
    );
  });

  test('…and the VALUE-DEF arm agrees, at rank 1 AND rank 2', () => {
    const ce = declareAssign('(x: T) -> tuple<T, T> where T', [
      'Function',
      ['Tuple', 'x', 'x'],
      'x',
    ]);
    pin(ce, 5, 'tuple<finite_integer, finite_integer>', '(5, 5)');
    pin(
      ce,
      ['List', 1, 2],
      'list<tuple<finite_integer, finite_integer>>',
      '[(1, 1),(2, 2)]'
    );
    // The value route maps to the scalar LEAVES too: its zip re-dispatches
    // through the operator name when a zipped row is itself a broadcast
    // collection, exactly as the operator-def routes do. Without that the
    // literal would be applied to the whole ROW (`[([1,2],[1,2]), …]`) and
    // disagree with the leaf-rank typing above.
    pin(
      ce,
      ['List', ['List', 1, 2], ['List', 3, 4]],
      'list<tuple<finite_integer, finite_integer>>',
      '[[(1, 1),(2, 2)],[(3, 3),(4, 4)]]'
    );
  });

  test('a BOUNDED scalar variable behaves identically', () => {
    // The bound is checked at the scalar base by the lift gate; the element
    // bind is what the result is built from.
    const ce = fresh();
    ce.assign(
      'f',
      e1(ce, ['Tuple', 'x', 'x'], '(x: T) -> tuple<T, T> where T: number')
    );
    pin(ce, 5, 'tuple<finite_integer, finite_integer>', '(5, 5)');
    pin(
      ce,
      ['List', 1, 2],
      'list<tuple<finite_integer, finite_integer>>',
      '[(1, 1),(2, 2)]'
    );
  });

  test('a COLLECTION-bounded variable is NOT lift-admitted and echoes whole', () => {
    // `T: indexed_collection` makes the parameter collection-typed, so
    // `paramsAreScalar` is false, nothing is lifted, and the operand binds
    // whole — unchanged by the re-ruling.
    const ce = fresh();
    ce.declare('vecho', '(T) -> T where T: indexed_collection');
    expect(ce.box(['vecho', ['List', 1, 2]] as any).type.toString()).toBe(
      'vector<finite_integer^2>'
    );
    expect(
      ce
        .box(['vecho', ['List', ['List', 1, 2], ['List', 3, 4]]] as any)
        .type.toString()
    ).toBe('matrix<finite_integer^(2x2)>');
    expect(ce.box(['vecho', 5] as any).isValid).toBe(false);
  });

  test('an ATOMIC or NEVER-MAPPED operand still binds whole', () => {
    // The lift ADMISSION gate is looser than the map: a tuple is atomic under
    // broadcast and a `set` is admitted but never mapped, so neither is
    // peeled (this is what keeps `Conjugate(Set(1, 2))` typed `set<…>`).
    const ce = fresh();
    ce.assign('f', e1(ce, 'x', '(x: T) -> T where T'));
    expect(ce.box(['f', ['Tuple', 1, 2]] as any).type.toString()).toBe(
      'tuple<finite_integer, finite_integer>'
    );
    expect(ce.box(['Conjugate', ['Set', 1, 2]] as any).type.toString()).toBe(
      'set<finite_integer>'
    );
  });

  test('a UNION actual distributes the peel only when EVERY member maps', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> tuple<T, T> where T');
    // All members mapped: the peel distributes (the `Add` widen artifact).
    ce.declare('v', 'list<integer> | matrix<integer>');
    expect(ce.box(['f', 'v'] as any).type.toString()).toBe(
      'list<tuple<integer, integer>>'
    );
    // One member the broadcast never maps (a `set` is lift-ADMITTED but
    // inert): distributing would claim `integer | set<integer>` while the
    // runtime may echo the set whole. The union contributes ITSELF.
    ce.declare('u', 'list<integer> | set<integer>');
    expect(ce.box(['f', 'u'] as any).type.toString()).toBe(
      'list<tuple<list<integer> | set<integer>, list<integer> | set<integer>>>'
    );
  });

  test('the peel depth follows the OUTER kind, not the element', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> tuple<T, T> where T');
    // A `list` outer has a static rank, so the peel descends to the LEAF and
    // `broadcastShapedResultType` re-adds every level.
    ce.declare('h', 'list<list<integer^2>>');
    expect(ce.box(['f', 'h'] as any).type.toString()).toBe(
      'list<tuple<integer, integer>>'
    );
    // An `indexed_collection`/`broadcastable` outer has NO static rank
    // (`staticCollectionDims` answers `null`), so the wrapper re-adds exactly
    // ONE level — the peel must take exactly one too, or the type comes out
    // flat while the runtime stays nested.
    ce.declare('g', 'indexed_collection<list<integer^2>>');
    expect(ce.box(['f', 'g'] as any).type.toString()).toBe(
      'list<tuple<vector<integer^2>, vector<integer^2>>>'
    );
    ce.declare('b', 'broadcastable<list<integer^2>>');
    expect(ce.box(['f', 'b'] as any).type.toString()).toBe(
      'broadcastable<tuple<vector<integer^2>, vector<integer^2>>>'
    );
  });

  test('`Apply` is NOT a map: it binds the argument whole', () => {
    // `apply()` binds each argument whole — a broadcasting BODY broadcasts on
    // its own, inside the binding. So no position is lift-admitted on this
    // route and the element bind must not fire (there is no wrap here to put
    // a rank back).
    const ce = fresh();
    const f = e1(ce, ['Tuple', 'x', 'x'], '(x: T) -> tuple<T, T> where T');
    const call = ce.box(['Apply', f.json, ['List', 1, 2]] as any);
    expect(call.type.toString()).toBe(
      'tuple<vector<finite_integer^2>, vector<finite_integer^2>>'
    );
    const evaluated = call.evaluate();
    expect(evaluated.toString()).toBe('([1,2], [1,2])');
    expect(evaluated.type.matches(call.type)).toBe(true);
  });
});

describe('§5.4 — generic recursion (declare-then-assign)', () => {
  test('a self-calling body, at two instantiations', () => {
    const ce = fresh();
    ce.declare('nest', '(x: T, n: integer) -> T where T');
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
      '(x: T, n: integer) -> T where T'
    );
  });
});

describe('§5.5 — mixed parameters', () => {
  test('the ground parameter is enforced at apply, the erased one is not', () => {
    const ce = declareAssign('(x: T, n: integer) -> T where T', [
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
    const t = parseType('(x: T) random -> T where T');
    const stripped = stripArrowEffects(t);
    expect(typeToString(stripped)).toBe('(x: T) -> T where T');
    expect((stripped as any).typeParams).toHaveLength(1);
  });

  // Rule 3 (G9) — α-equivalence on the TYPE axes only.
  test('G9 — a pure RENAMING of the clause is accepted', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T');
    expect(() =>
      ce.assign('f', e1(ce, 'q', '(u: U) -> U where U'))
    ).not.toThrow();
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
  });

  test('G9 — argument NAMES are cosmetic, so an unnamed declaration matches', () => {
    // The E1 sugar REQUIRES named arguments, so a declaration written
    // `(T) -> T where T` must still accept its own E1 implementation.
    const ce = fresh();
    ce.declare('f', '(T) -> T where T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', '(x: T) -> T where T'))
    ).not.toThrow();
  });

  test('G9 — a genuine mismatch on a type axis is rejected', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', '(x: T) -> integer where T'))
    ).toThrow(MISMATCH);
  });

  test('G9 — differing declared BOUNDS are a mismatch', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T: number');
    expect(() =>
      ce.assign('f', e1(ce, 'x', '(y: U) -> U where U: integer'))
    ).toThrow(MISMATCH);
  });

  test('G9 — a NARROWER explicit effect set is accepted (effects axis excluded)', () => {
    // Explicitness must not be penalized where silence passes: the effects axis
    // is governed by rule 2's `inferred ⊆ declared` subset alone.
    const ce = fresh();
    ce.declare('f', '(x: T) random -> T where T');
    expect(() =>
      ce.assign('f', e1(ce, 'x', '(x: T) pure -> T where T'))
    ).not.toThrow();
  });

  // Rule 2 — effects.
  test('a `random` body under a `pure` declaration is rejected', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) pure -> T where T');
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', ['Random']], 'x'] as any))
    ).toThrow(/random/);
  });

  // Rule 4 — ground annotations cover the domain (CONTRAVARIANT).
  test('rule 4 — `(x: real)` under `where T: integer` is accepted', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T: integer');
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', 'x', ['Typed', 'x', { str: 'real' }]] as any)
      )
    ).not.toThrow();
  });

  test('rule 4 — `(x: integer)` under `where T: number` is rejected', () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T: number');
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', 'x', ['Typed', 'x', { str: 'integer' }]] as any)
      )
    ).toThrow(MISMATCH);
  });

  test('rule 4 — an UNBOUNDED variable admits only `any`/`unknown`', () => {
    const ok = fresh();
    ok.declare('f', '(x: T) -> T where T');
    expect(() =>
      ok.assign(
        'f',
        ok.box(['Function', 'x', ['Typed', 'x', { str: 'any' }]] as any)
      )
    ).not.toThrow();

    const bad = fresh();
    bad.declare('f', '(x: T) -> T where T');
    expect(() =>
      bad.assign(
        'f',
        bad.box(['Function', 'x', ['Typed', 'x', { str: 'real' }]] as any)
      )
    ).toThrow(MISMATCH);
  });

  test('rule 4 — a ground annotation at a GROUND position reconciles as today', () => {
    const ce = fresh();
    ce.declare('f', '(x: T, n: integer) -> T where T');
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
    ce.declare('f', '(x: T, y: T) -> T where T');
    expect(() => ce.assign('f', ce.box(['Function', 'x', 'x'] as any))).toThrow(
      /takes 1 parameter\(s\)/
    );
  });

  // Rule 0 — G11.
  test('G11 — a polymorphic overload INTERSECTION is rejected, ahead of arity', () => {
    const ce = fresh();
    ce.declare('m', '((T) -> T where T) & ((string) -> string)');
    // A 2-ary literal would fail the arity rule too; G11 must win.
    expect(() =>
      ce.assign('m', ce.box(['Function', 'x', 'x', 'y'] as any))
    ).toThrow(/generic OVERLOAD SET cannot take a function-literal body/);
  });

  test('G11 — on the `Assign` OPERATOR route, as an error VALUE', () => {
    const ce = fresh();
    ce.declare('m', '((T) -> T where T) & ((string) -> string)');
    const v = ce.box(['Assign', 'm', ['Function', 'x', 'x']] as any).evaluate();
    expect(v.toString()).toContain('incompatible-type');
    expect(v.toString()).toMatch(
      /generic OVERLOAD SET cannot take a function-literal body/
    );
  });
});

describe('§5.7 — G10, the variable-correlated return is a TRUSTED ascription', () => {
  test('`x |-> 0` installs at `(T) -> T where T`; `f("a")` types `string`', () => {
    // RULED (G10, 2026-08-04): under erasure nothing verifies that the body
    // returns its argument's type, and the typed-function-literals precedent
    // (ruled 2026-07-12) makes return ascriptions TRUSTED, TypeScript-style —
    // not covariant runtime checks. Disclosed and pinned here; a strict-mode
    // per-call instantiated-result check is recorded as future work.
    const ce = declareAssign('(x: T) -> T where T', ['Function', 0, 'x']);
    expect(ce.box(['f', { str: 'a' }] as any).type.toString()).toBe('string');
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('G4 — a GROUND result under a `where` clause reconciles as today', () => {
    const ce = declareAssign('(x: T) -> boolean where T', [
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
    const ce = declareAssign('(x: T) -> T where T', ['Function', 'x', 'x']);
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
        e1(ce, 'x', '(x: T) -> T where T').json,
      ] as any)
      .evaluate();
    expect(v.toString()).toMatch(G2);
  });

  test('the HOST route THROWS instead of yielding an error value', () => {
    const ce = declareAssign('(x: T) -> T where T', ['Function', 'x', 'x']);
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
        literalParamGeneric('(x: T, y: 0) -> integer where T'),
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
        ce.box(literalParamGeneric('(x: T, y: 0) -> integer where T'))
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
        literalParamGeneric('(x: T, y: T) -> integer where T'),
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
        e1(ce, 'x', '(x: T) -> T where T').json,
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
    ce.declare('k', '(x: T) -> T where T');
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
      ['(x: T) -> T where T', ['Function', 'x', 'x'], [5]],
      ['(x: T) -> T where T', ['Function', 'x', 'x'], [['List', 1, 2, 3]]],
      ['(x: T) -> T where T: number', ['Function', 'x', 'x'], [1.5]],
      [
        '(x: T, y: U) -> tuple<U, T> where T, U',
        ['Function', ['Tuple', 'y', 'x'], 'x', 'y'],
        [1, { str: 'a' }],
      ],
      [
        '(x: T, n: integer) -> T where T',
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
    ce.declare('gd', '(x: T) -> T where T: number');
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
      e2(ce, ['Add', 'x', 'x'], '(x: T) -> T where T: number', 'x')
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

describe('§follow-up — operator-route broadcastability derives from `paramsAreScalar`', () => {
  // A bare `ce.assign('f', ⟨annotated literal⟩)` — no prior declaration —
  // installs an OPERATOR definition carrying the literal's derived signature
  // (`assignValueAsOperatorDef`). That signature makes `inferredSignature =
  // false`, so calls run through `validateArguments`, whose collection-at-a-
  // scalar-parameter admission is gated on the definition's `broadcastable`
  // flag. Left at its `false` default the flag REJECTED `f([1,2,3])` with
  // `incompatible-type` while the very same literal broadcast on the
  // declare-then-assign VALUE route (gated on `paramsAreScalar`, `box.ts`) and
  // on the COMPILED path (`userFunctionParamsAreScalar`, `base-compiler.ts`).
  // The flag is now derived the same way, so the three routes read one gate —
  // which is what the design's §2 sketch already promised ("f: (T) -> T
  // where T: number; f([1,2,3]) → broadcasts, types vector").
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');

  test('a BOUNDED generic bare-assign broadcasts, at its own rank', () => {
    const ce = fresh();
    ce.assign(
      'f',
      e2(ce, ['Multiply', 2, 'x'], '(x: T) -> T where T: number', 'x')
    );
    const call = ce.box(['f', ['List', 1, 2, 3]] as any);
    expect(call.evaluate().toString()).toBe('[2,4,6]');
    // No double-lift (the §2.5 twin arm): the map's type, not a list of vectors.
    expect(call.type.toString()).toBe('vector<finite_integer^3>');
    // …and the VALUE route answers the same thing, literally.
    const value = declareAssign('(x: T) -> T where T: number', [
      'Function',
      ['Multiply', 2, 'x'],
      'x',
    ]);
    const vcall = value.box(['f', ['List', 1, 2, 3]] as any);
    expect(call.type.toString()).toBe(vcall.type.toString());
    expect(call.evaluate().toString()).toBe(vcall.evaluate().toString());
    // The bound is still enforced at the scalar base.
    expect(
      ce
        .box(['f', { str: 'a' }] as any)
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });

  test('an UNBOUNDED generic bare-assign identity ECHOES the whole list', () => {
    // D10: the lift binds the FULL actual at a bare-variable pattern, so the
    // identity returns the list itself — it does not map over it.
    // `paramsAreScalar` answers `true` for an unbounded variable (the scalar
    // default), so the derived flag must not turn that echo into a per-element
    // map.
    const ce = fresh();
    ce.assign('f', e1(ce, 'x', '(x: T) -> T where T'));
    const call = ce.box(['f', ['List', 1, 2, 3]] as any);
    expect(call.evaluate().toString()).toBe('[1,2,3]');
    expect(call.type.toString()).toBe('vector<finite_integer^3>');
  });

  test('a GROUND annotated bare-assign broadcasts, and compiles to the same', () => {
    const ce = fresh();
    ce.assign('k', e1(ce, ['Multiply', 2, 'x'], '(x: number) -> number'));
    const call = ce.box(['k', ['List', 1, 2, 3]] as any);
    expect(call.evaluate().toString()).toBe('[2,4,6]');
    expect(call.type.toString()).toBe('vector<3>');
    // Compile parity (the §5.13 sibling): the compiled path reads the same
    // `paramsAreScalar` gate, so it must agree with the interpreter — before
    // this fix the interpreted call was an `incompatible-type` error and
    // compilation declined on it.
    expect(compile(call)?.run?.({})).toEqual([2, 4, 6]);
    // …and the VALUE route agrees too.
    const value = fresh();
    value.declare('k', '(x: number) -> number');
    value.assign('k', value.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const vcall = value.box(['k', ['List', 1, 2, 3]] as any);
    expect(call.type.toString()).toBe(vcall.type.toString());
    expect(call.evaluate().toString()).toBe(vcall.evaluate().toString());
  });

  test('an EMPTY source answers `[]`, as the VALUE route does', () => {
    // The lambda broadcast arm answers `[]`; the BUILTIN one answers `Nothing`.
    // A `broadcastable` lambda must keep taking its own arm.
    const ce = fresh();
    ce.assign('k', e1(ce, ['Multiply', 2, 'x'], '(x: number) -> number'));
    expect(
      ce
        .box(['k', ['List']] as any)
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('a COLLECTION-VALUED result types NESTED, not flat', () => {
    // The TYPING twin of the two evaluation guards. `type()`'s generic
    // `broadcastable` wrapper unwraps the signature result
    // (`broadcastElementType`) before lifting it; the dedicated lambda arm
    // deliberately does NOT, because the per-element result IS the signature
    // result. Now that a bare-assigned annotated literal carries
    // `broadcastable`, the generic wrapper captured it first and typed the
    // nested value `[[1,1],[2,2]]` as `vector<2>`.
    const ce = fresh();
    ce.assign(
      'f',
      e2(ce, ['List', 'x', 'x'], '(x: number) -> list<number>', 'x')
    );
    const call = ce.box(['f', ['List', 1, 2]] as any);
    expect(call.type.toString()).toBe('list<list<number>>');
    expect(call.evaluate().toString()).toBe('[[1,1],[2,2]]');
    // …and the scalar call is unchanged.
    expect(ce.box(['f', 3] as any).type.toString()).toBe('list<number>');
    expect(ce.box(['f', 3] as any).evaluate().toString()).toBe('[3,3]');
  });

  test('a COLLECTION-typed parameter keeps binding its argument WHOLE', () => {
    // The negative arm of the same gate: `paramsAreScalar` is false, so the
    // list is the argument, not a source to map over.
    const ce = fresh();
    ce.assign('n', e1(ce, ['Length', 'x'], '(x: list<number>) -> number'));
    const call = ce.box(['n', ['List', 1, 2, 3]] as any);
    expect(call.evaluate().toString()).toBe('3');
    expect(call.type.toString()).toBe('number');
  });

  test('a QUANTIFIED parameter read at a COLLECTION bound binds whole too', () => {
    // §4.5: a quantified parameter is read at its declared bound, so
    // `T: indexed_collection` is not scalar and the flag stays false.
    const ce = fresh();
    ce.assign(
      'n',
      e2(
        ce,
        ['Length', 'x'],
        '(x: T) -> integer where T: indexed_collection',
        'x'
      )
    );
    expect(
      ce
        .box(['n', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('re-assignment RE-DERIVES the flag', () => {
    // An untyped literal sets no signature (`inferredSignature`) and never
    // touches the flag; assigning an annotated literal over it must set it
    // (`_BoxedOperatorDefinition.update` merges `def.broadcastable ?? …`).
    const ce = fresh();
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
    ce.assign('f', e1(ce, ['Multiply', 3, 'x'], '(x: number) -> number'));
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[3,6,9]');
  });

  test('the EPSIL sugared route inherits it (same operator definition)', () => {
    // `function f<T: number>(x: T) -> T { 2x }` lowers to `DefineFunction`,
    // which delegates to `ce.assign` — the very route fixed here.
    const ce = fresh();
    const r = executeEpsil(
      ce,
      'function f<T: number>(x: T) -> T { 2x }\nf([1, 2, 3])'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value?.toString()).toBe('[2,4,6]');
  });

  test('RE-ASSIGNING the same signature keeps the OPERATOR definition', () => {
    // Notebook re-run semantics: assign twice ≡ assign once. The second assign
    // took the declared-signature reconciliation branch and installed a VALUE
    // definition, dropping the operator half — and with it the derived
    // `broadcastable` flag and the `_isLambda`/`lambda` view.
    const ce = fresh();
    const lit = () => e2(ce, ['Multiply', 2, 'x'], '(x: number) -> number', 'x');

    ce.assign('f', lit());
    const first = ce.lookupDefinition('f') as any;
    expect(first.operator).toBeDefined();
    expect(first.operator.broadcastable).toBe(true);
    expect(first.operator.lambda).toBeDefined();
    expect(first.operator.signature.toString()).toBe('(unknown) -> number');

    ce.assign('f', lit());
    const second = ce.lookupDefinition('f') as any;
    expect(second.operator).toBeDefined();
    expect(second.value).toBeUndefined();
    expect(second.operator.broadcastable).toBe(first.operator.broadcastable);
    expect(second.operator.lambda).toBeDefined();
    expect(second.operator.signature.toString()).toBe(
      first.operator.signature.toString()
    );

    // …and the BEHAVIOR is unchanged across the re-run.
    expect(ce.box(['f', 3] as any).evaluate().toString()).toBe('6');
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a DIFFERENTLY-shaped annotated re-assign is still rejected', () => {
    // The declared-type compatibility check is not relaxed by the above: the
    // previous signature remains a contract the new literal has to satisfy.
    const ce = fresh();
    ce.assign('f', e2(ce, ['Multiply', 2, 'x'], '(x: number) -> number', 'x'));
    expect(() =>
      ce.assign('f', e2(ce, 'x', '(x: string) -> string', 'x'))
    ).toThrow();
  });
});

describe('§follow-up — an UNGROUPED ground marker is the literal’s own signature', () => {
  // Ruled 2026-08-04: the decomposition predicate is "ungrouped signature",
  // effects or `where` clause optional. Before, a ground arrow in the return
  // slot read as a RETURN type, so the literal typed
  // `(unknown) -> (x: number) -> number` and a broadcast call typed
  // `list<(x: number) -> number^3>` while evaluating `[2,4,6]`.
  test('the literal types by the marker’s RESULT, and broadcast typing follows', () => {
    const ce = fresh();
    const f = e2(ce, ['Multiply', 2, 'x'], '(x: number) -> number', 'x');
    expect(f.type.toString()).toBe('(unknown) -> number');
    ce.assign('f', f);
    const call = ce.box(['f', ['List', 1, 2, 3]] as any);
    expect(call.evaluate().toString()).toBe('[2,4,6]');
    expect(call.type.toString()).toBe('vector<3>');
  });

  test('the GROUPED spelling keeps the returns-a-function reading', () => {
    const ce = fresh();
    const f = e2(ce, ['Multiply', 2, 'x'], '((x: number) -> number)', 'x');
    expect(f.type.toString()).toBe('(unknown) -> (x: number) -> number');
  });

  test('a plain arrow states NO effects (not a stated-pure contract)', () => {
    const ce = fresh();
    const f = e2(ce, ['Multiply', 2, 'x'], '(x: number) -> number', 'x');
    // No specifier in the marker ⇒ nothing DECLARED, and inference found
    // nothing either, so the arrow carries no effect set at all — not the
    // stated-empty `[]` that a `pure` keyword writes (which would put the
    // literal on the checked track and print ` pure`).
    expect(f.type.effects).toBe(undefined);
    expect(f.type.toString()).not.toContain('pure');
  });

  test('the E2 well-formedness rules now cover ground markers', () => {
    const ce = fresh();
    // Arity mismatch…
    expect(
      e2(ce, ['Multiply', 2, 'x'], '(a: number, b: number) -> number', 'x')
        .toString()
    ).toContain('A function-literal signature marker must be');
    // …optional arguments…
    expect(
      e2(ce, ['Multiply', 2, 'x'], '(a: number, b: number?) -> number', 'x')
        .toString()
    ).toContain('A function-literal signature marker must be');
    // …and a well-formed one is accepted.
    expect(
      e2(ce, ['Multiply', 2, 'x'], '(a: number) -> number', 'x').isValid
    ).toBe(true);
  });

  describe('the marker is recognized in its CANONICAL, Block-embedded shape', () => {
    // `["Function", ["Block", …, ["Typed", last, sig]], …params]` is the shape
    // canonicalization produces, and `functionLiteralDeclaredSignature` reads
    // it as the contract. A hand-authored one on the box route must therefore
    // take the same E2 pre-pass — before, it slipped past the well-formedness
    // check AND past quantified-parameter erasure.
    /** The E2 spelling, written in the canonical (Block-embedded) shape. */
    const e2Block = (
      ce: ComputeEngine,
      body: any,
      signature: string,
      ...params: any[]
    ) =>
      ce.box([
        'Function',
        ['Block', ['Typed', body, { str: signature }]],
        ...params,
      ] as any);

    test('an arity mismatch is a diagnostic, as in the authoring shape', () => {
      const ce = fresh();
      expect(
        e2Block(
          ce,
          ['Add', 'x', 1],
          '(a: integer, b: integer) -> integer',
          'x'
        ).toString()
      ).toContain('A function-literal signature marker must be');
      // …and a well-formed one still boxes.
      expect(
        e2Block(ce, ['Add', 'x', 1], '(a: integer) -> integer', 'x').type
          .toString()
      ).toBe('(unknown) -> integer');
    });

    test('a POLYTYPE marker erases its quantified parameters', () => {
      const ce = fresh();
      const f = e2Block(
        ce,
        ['Add', 'x', 'x'],
        '(x: T) -> T where T: number',
        ['Typed', 'x', { str: 'T' }]
      );
      // The quantified parameter is a BARE symbol — `T` never becomes the type
      // of a symbol (the §4.2 ground invariant).
      expect(f.ops[1].json).toBe('x');
      expect(f.type.toString()).toBe('(x: T) -> T where T: number');
    });
  });
});

//
// R1 — the STORED literal carries the declared polytype.
//
// A marker-less literal accepted under a polymorphic declaration is rebuilt
// with the full-signature marker, so the VALUE describes itself: `f`'s value
// types as the polytype rather than as the `(unknown) -> unknown` its erased
// bare parameters would infer. Display only — the ascription is restricted to
// clauses whose every argument is quantified, so it can never introduce a
// ground parameter constraint on the literal's own arrow.
//
describe('R1 — a declared polytype is ascribed onto the stored literal', () => {
  test('declare-then-assign: the value carries the clause', () => {
    const ce = declareAssign('(x: T) -> T where T', ['Function', 'x', 'x']);
    const value = ce.box('f').evaluate();
    expect(value.toString()).toBe('(x) |-> x');
    expect(value.type.toString()).toBe('(x: T) -> T where T');
    // The definition's own type is unchanged, and so is every call.
    expect(ce.box('f').type.toString()).toBe('(x: T) -> T where T');
    expect(ce.box(['f', 5] as any).type.toString()).toBe('finite_integer');
  });

  test('declare-WITH-value: the same', () => {
    const ce = fresh();
    ce.declare('f', {
      type: '(x: T) -> T where T',
      value: ce.box(['Function', 'x', 'x']),
    } as any);
    const value = ce.box('f').evaluate();
    expect(value.type.toString()).toBe('(x: T) -> T where T');
    expect(value.json).toMatchObject([
      'Function',
      ['Block', ['Typed', 'x', "'(x: T) -> T where T'"]],
      'x',
    ]);
  });

  test('a GROUND argument in the clause is NOT ascribed', () => {
    // `n: number` would become a real constraint on the literal's own arrow,
    // enforced at the per-element `apply()` inside a broadcast — where `n`
    // legitimately receives a whole row. The clause is left off instead.
    const ce = declareAssign('(x: T, n: number) -> T where T', [
      'Function',
      ['Add', 'x', 'n'],
      'x',
      'n',
    ]);
    expect(ce.box('f').evaluate().type.toString()).toBe(
      '(unknown, unknown) -> number'
    );
  });

  test("a literal with its OWN marker keeps it", () => {
    const ce = fresh();
    ce.declare('f', '(x: T) -> T where T');
    ce.assign('f', e2(ce, 'x', '(y: U) -> U where U', 'x'));
    expect(ce.box('f').evaluate().type.toString()).toBe(
      '(y: U) -> U where U'
    );
  });

  test('a GROUND declaration is untouched (pre-existing asymmetry)', () => {
    const ce = fresh();
    ce.declare('g', '(x: integer) -> integer');
    ce.assign('g', ce.box(['Function', 'x', 'x']));
    expect(ce.box('g').type.toString()).toBe('(x: integer) -> integer');
    // The stored literal still loses the PARAMETER type — out of R1's scope.
    expect(ce.box('g').evaluate().type.toString()).toBe('(unknown) -> integer');
  });
});

//
// R4 — an untyped re-assign full-replaces an assign-DERIVED signature
// (D6, "Assign always full-replaces"). The boundary is PROVENANCE: a signature
// written by `ce.declare()` is a declaration and stays sticky.
//
describe('R4 — untyped re-assign replaces a derived signature', () => {
  const annotated = (ce: ComputeEngine) =>
    ce.box(['Function', ['Typed', ['Add', 'x', 1], "'integer'"], 'x'] as any);
  const untyped = (ce: ComputeEngine) =>
    ce.box(['Function', ['Multiply', 'x', 2], 'x'] as any);

  test('annotated then untyped: the derived signature is discarded', () => {
    const ce = fresh();
    ce.assign('g', annotated(ce));
    expect(ce.box('g').type.toString()).toBe('(unknown) -> integer');
    ce.assign('g', untyped(ce));
    // Re-inferred from the NEW body — the old return annotation is gone.
    expect(ce.box('g').type.toString()).toBe('(unknown) -> finite_number');
    expect(ce.box(['g', 1.5] as any).evaluate().toString()).toBe('3');
    // …and the representation stays an operator definition with a lambda.
    const def = ce.lookupDefinition('g');
    expect(def?.operator?.inferredSignature).toBe(true);
    expect(def?.operator?.lambda).toBeDefined();
  });

  test('a PARAMETER annotation is derived the same way', () => {
    const ce = fresh();
    ce.assign(
      'g',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]] as any)
    );
    expect(ce.box(['g', 1.5] as any).isValid).toBe(false);
    ce.assign('g', untyped(ce));
    expect(ce.box(['g', 1.5] as any).isValid).toBe(true);
    expect(ce.box('g').type.toString()).toBe('(unknown) -> finite_number');
  });

  test('a GENERIC annotation is derived the same way', () => {
    const ce = fresh();
    ce.assign('g', e2(ce, 'x', '(x: T) -> T where T', 'x'));
    expect(ce.box('g').type.toString()).toBe('(x: T) -> T where T');
    ce.assign('g', untyped(ce));
    expect(ce.box('g').type.isPolymorphic).toBe(false);
    expect(ce.box('g').type.toString()).toBe('(unknown) -> finite_number');
  });

  test('a DECLARED signature stays sticky (string form)', () => {
    const ce = fresh();
    ce.declare('g', '(x: integer) -> integer');
    ce.assign('g', untyped(ce));
    expect(ce.box('g').type.toString()).toBe('(x: integer) -> integer');
    expect(ce.box(['g', 1.5] as any).isValid).toBe(false);
  });

  test('a DECLARED signature stays sticky (object form, with a body)', () => {
    const ce = fresh();
    ce.declare('g', {
      signature: '(x: integer) -> integer',
      evaluate: ['Function', ['Add', 'x', 1], 'x'],
    } as any);
    ce.assign('g', untyped(ce));
    expect(ce.box('g').type.toString()).toBe('(x: integer) -> integer');
    expect(ce.box(['g', 1.5] as any).isValid).toBe(false);
  });

  test('an ANNOTATED re-assign is unchanged: same rebuilds, different errors', () => {
    const ce = fresh();
    ce.assign('g', annotated(ce));
    ce.assign('g', annotated(ce));
    expect(ce.box('g').type.toString()).toBe('(unknown) -> integer');

    expect(() =>
      ce.assign(
        'g',
        ce.box(['Function', ['Typed', ['Add', 'x', 1], "'string'"], 'x'] as any)
      )
    ).toThrow();
  });
});
