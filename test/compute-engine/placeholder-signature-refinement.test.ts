import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { expectTypeBetween } from '../utils';
import type { BoxedType } from '../../src/common/type/boxed-type';

/**
 * A declared `unknown` slot in a function signature is a PLACEHOLDER the
 * definition refines, never a contract (ruled 2026-08-15;
 * `refineDeclaredPlaceholders` in `boxed-expression/effects-inference.ts`,
 * consumed by the three install routes in `engine-declarations.ts`).
 *
 * Before the ruling, declaring `(unknown) -> unknown` and then defining the
 * function was REFUSED (`incompatible-type`) while declaring nothing at all —
 * or a concrete signature — both worked: checking the body-inferred lambda
 * against the declaration required, by parameter contravariance,
 * `unknown <: ⟨inferred param⟩`, which is false in the lattice. A placeholder
 * declaration was strictly more restrictive than no declaration.
 *
 * `any` is deliberately different: it is a CONTRACT — `(any) -> any` (the
 * identity function's signature) promises a function accepting every value —
 * so a body that cannot honor it is still refused. Same ruling.
 *
 * Refinement is PER-POSITION: a concrete declared parameter is kept (it is
 * real information) while an `unknown` result of the same arrow refines.
 * (Tycho reported the result-position half: their derived `-> unknown`
 * declarations erased every call's type and their compiled indexed access
 * failed closed.)
 */

const BODY = 'P \\mapsto \\sqrt{P[1]^2+P[2]^2}';
// The refined PARAMETER list is the contract and is pinned exactly: function
// parameters are contravariant, so an UNREFINED `(unknown) -> …` signature is
// a subtype of this one and would pass a bare `.matches(CONCRETE)`. Only the
// result tier may refine (`broadcastable<finite_number>` still passes).
const PARAMS = '(dictionary<any> | indexed_collection<any>)';
const CONCRETE = `${PARAMS} -> broadcastable<number>`;
function expectRefinedSignature(expr: { readonly type: BoxedType }): void {
  expect(expr.type.toString().slice(0, PARAMS.length + 4)).toBe(`${PARAMS} -> `);
  expectTypeBetween(expr, { atMost: CONCRETE });
}

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

describe('declared (unknown) -> unknown is refined by the definition', () => {
  test('parse route, head-call spelling: defines and evaluates', () => {
    const ce = freshEngine();
    ce.declare('l_P', { signature: '(unknown) -> unknown' });
    const def = ce
      .parse('l_{P}(P)\\coloneq \\sqrt{P[1]^2+P[2]^2}', { strict: false })
      .evaluate();
    expect(def.operator).not.toEqual('Error');
    expect(
      ce.parse('l_{P}([3,4])', { strict: false }).evaluate().toString()
    ).toEqual('5');
  });

  test('parse route, lambda spelling (plain name): defines and evaluates', () => {
    const ce = freshEngine();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.parse(`g\\coloneq ${BODY}`, { strict: false }).evaluate();
    expect(
      ce.parse('g([3,4])', { strict: false }).evaluate().toString()
    ).toEqual('5');
  });

  test('API route, ce.assign: defines, and the stored type is the refined one', () => {
    const ce = freshEngine();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.assign('g', ce.parse(BODY, { strict: false }));
    expectRefinedSignature(ce.box('g'));
    expect(
      ce.parse('g([3,4])', { strict: false }).evaluate().toString()
    ).toEqual('5');
  });

  test('API route, declare-with-value: defines under the refined type', () => {
    const ce = freshEngine();
    ce.declare('k', {
      type: '(unknown) -> unknown',
      value: ce.parse(BODY, { strict: false }),
    });
    expectRefinedSignature(ce.box('k'));
    expect(
      ce.parse('k([3,4])', { strict: false }).evaluate().toString()
    ).toEqual('5');
  });

  test('the argument is passed WHOLE, not broadcast elementwise', () => {
    // The regression the check-time-only fix left behind: the definition
    // installed but the stored `(unknown) -> …` signature made the call site
    // treat the parameter as scalar and broadcast `[3,4]` into two
    // applications. The refined signature must drive the broadcast decision.
    const ce = freshEngine();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.assign('g', ce.parse(BODY, { strict: false }));
    const r = ce.parse('g([3,4])', { strict: false }).evaluate();
    expect(r.isNumberLiteral).toBe(true);
  });
});

describe('refinement is per-position', () => {
  test('concrete param is KEPT, unknown result refines', () => {
    const ce = freshEngine();
    ce.declare('w', { signature: '(tuple<number, number>) -> unknown' });
    ce.assign('w', ce.parse('P \\mapsto P[1]+P[2]', { strict: false }));
    const t = ce.box('w').type.toString();
    expect(t).toMatch(/^\(tuple<number, ?number>\)/);
    expect(t).not.toMatch(/unknown/);
    expect(
      ce.parse('w((3,4))', { strict: false }).evaluate().toString()
    ).toEqual('7');
  });

  test('unknown param with concrete result refines the param', () => {
    const ce = freshEngine();
    ce.declare('v', { signature: '(unknown) -> number' });
    ce.assign('v', ce.parse(BODY, { strict: false }));
    expect(
      ce.parse('v([3,4])', { strict: false }).evaluate().toString()
    ).toEqual('5');
  });

  test('a PASS-THROUGH body refines the result on the second pass', () => {
    // The literal's own type is read BEFORE parameter ascription, so `P ↦ P`
    // shows an `unknown` result at that point; only the post-ascription
    // reconciled literal carries the sharpened `tuple<…>` result. A
    // single-pass refinement persisted `-> unknown` here and calls typed
    // `unknown` — re-creating the placeholder-stuck call sites.
    const ce = freshEngine();
    ce.declare('w', { signature: '(tuple<number, number>) -> unknown' });
    ce.assign('w', ce.parse('P \\mapsto P', { strict: false }));
    expect(ce.box('w').type.toString()).toEqual(
      '(tuple<number, number>) -> tuple<number, number>'
    );
    expect(ce.box(['w', ['Tuple', 3, 4]]).type.toString()).toEqual(
      'tuple<number, number>'
    );
  });

  test('declare-with-value resolves engine-local type names', () => {
    // The declare-with-value route parsed the declared type WITHOUT the
    // engine's type resolver, so a local alias (`type meters = number`) threw
    // before the value-definition constructor (which does pass the resolver)
    // was reached.
    const ce = freshEngine();
    executeEpsil(ce, 'type meters = number');
    expect(() =>
      ce.declare('d', {
        type: '(meters) -> unknown',
        value: ce.parse('x \\mapsto x', { strict: false }),
      })
    ).not.toThrow();
    expect(ce.box('d').type.toString()).toMatch(/^\(meters\)/);
  });
});

describe('`any` stays a contract', () => {
  test('a body that cannot accept every value is refused', () => {
    const ce = freshEngine();
    ce.declare('h', { signature: '(any) -> any' });
    expect(() => ce.assign('h', ce.parse(BODY, { strict: false }))).toThrow(
      /not compatible/
    );
  });

  test('parse route surfaces the refusal as an error value, not silence', () => {
    const ce = freshEngine();
    ce.declare('h', { signature: '(any) -> any' });
    const def = ce
      .parse(`h\\coloneq ${BODY}`, { strict: false })
      .evaluate();
    expect(def.toString()).toMatch(/Error|incompatible/);
    // and nothing was installed — the symbol still evaluates to itself
    expect(ce.box('h').evaluate().toString()).toEqual('h');
  });
});

describe('lattice invariants preserved', () => {
  test('unknown stays one-directional in the raw subtype relation', () => {
    // Dispatch gates need POSITIVE evidence: making `unknown <: T` true in
    // the lattice broke canonicalization (`P[1]^2` became `MatrixPower`
    // because the element access typed `unknown`, which then "matched"
    // `matrix`). The placeholder ruling is implemented at the declaration
    // boundary instead — the raw relation must stay strict.
    const ce = freshEngine();
    expect(ce.type('number').matches('unknown')).toBe(true);
    expect(ce.type('unknown').matches('number')).toBe(false);
  });

  test('absence is opt-in: nothing/missing do not match unknown', () => {
    const ce = freshEngine();
    expect(ce.type('nothing').matches('unknown')).toBe(false);
    expect(ce.type('missing').matches('unknown')).toBe(false);
    expect(ce.type('nothing').matches('any')).toBe(true);
    expect(ce.type('missing').matches('any')).toBe(true);
  });
});
