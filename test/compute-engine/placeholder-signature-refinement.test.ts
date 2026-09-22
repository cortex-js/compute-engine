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
// result tier may refine (`broadcastable<number>` still passes).
// The body indexes its parameter and adds 1 to the element, so the
// parameter's element refines to `number` (use-driven element inference).
const PARAMS = '(indexed_collection<number>)';
const CONCRETE = `${PARAMS} -> broadcastable<number>`;
function expectRefinedSignature(expr: { readonly type: BoxedType }): void {
  expect(expr.type.toString().slice(0, PARAMS.length + 4)).toBe(
    `${PARAMS} -> `
  );
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
    expectTypeBetween(ce.box(['w', ['Tuple', 3, 4]]), {
      atMost: 'tuple<number, number>',
    });
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

describe('the refined signature follows the body', () => {
  // The refined signature is DERIVED from the stored function value on every
  // read, and each assignment refines the declaration as written. Before,
  // the first assignment stored the body's type of that moment, so the
  // result of `phi` below stayed `broadcastable<number>` (a `c_1` call with
  // no body yet could be a list) after `c_1` was bound. The same
  // definitions then typed differently depending on their order, and the
  // JavaScript compile of `2 cos(phi(x))` failed.
  const PHI =
    '(x) \\mapsto 2\\pi\\operatorname{mod}(\\sin(10^4x)10^4,1)+c_1(x)';
  const C1 = '(i) \\mapsto v i t';

  function definePhi(
    ce: ComputeEngine,
    spelling: 'string' | 'object' | 'declare-with-value',
    c1First: boolean
  ): void {
    ce.declare('c_1', 'function');
    if (c1First) ce.assign('c_1', ce.parse(C1));
    if (spelling === 'declare-with-value')
      ce.declare('phi', { type: '(unknown) -> unknown', value: ce.parse(PHI) });
    else {
      if (spelling === 'string') ce.declare('phi', '(unknown) -> unknown');
      else ce.declare('phi', { signature: '(unknown) -> unknown' });
      ce.assign('phi', ce.parse(PHI));
    }
    if (!c1First) ce.assign('c_1', ce.parse(C1));
  }

  test.each(['string', 'object', 'declare-with-value'] as const)(
    '%s declaration: a head bound AFTER the assignment refines the result',
    (spelling) => {
      const ce = freshEngine();
      definePhi(ce, spelling, false);
      expect(ce.box('phi').type.toString()).toBe('(unknown) -> number');
      expect(ce.box(['phi', 'x']).type.toString()).toBe('number');
      expect(ce.parse('\\phi(x)').type.toString()).toBe('number');
    }
  );

  test('the order of the two definitions does not change the types', () => {
    const early = freshEngine();
    definePhi(early, 'object', true);
    const late = freshEngine();
    definePhi(late, 'object', false);
    expect(late.box('phi').type.toString()).toBe(
      early.box('phi').type.toString()
    );
  });

  test('before the head is bound, the result is still the wide one', () => {
    const ce = freshEngine();
    ce.declare('c_1', 'function');
    ce.declare('phi', '(unknown) -> unknown');
    ce.assign('phi', ce.parse(PHI));
    expect(ce.box('phi').type.toString()).toBe(
      '(unknown) -> broadcastable<number>'
    );
  });

  test('a re-assignment refines the declaration, not the earlier refinement', () => {
    const ce = freshEngine();
    ce.declare('f', '(unknown) -> unknown');
    ce.assign('f', ce.parse('(x) \\mapsto x + 1'));
    expect(ce.box('f').type.toString()).toBe('(unknown) -> number');
    ce.assign('f', ce.parse('(x) \\mapsto [x, x]'));
    expect(ce.box('f').type.toString()).toBe('(unknown) -> vector<2>');
    expect(ce.box(['f', 2]).evaluate().toString()).toBe('[2,2]');
  });

  test('a value assigned later to a free symbol of the body refines the result', () => {
    // Before, `f` kept `-> number` while `f(2)` evaluated to a list.
    const ce = freshEngine();
    ce.declare('f', '(unknown) -> unknown');
    ce.assign('f', ce.parse('(x) \\mapsto 1 + a x'));
    ce.assign('a', ce.parse('[1,2,3]'));
    expect(ce.box('f').type.toString()).toBe('(unknown) -> list<number>');
    expect(ce.box(['f', 2]).evaluate().toString()).toBe('[3,5,7]');
  });

  test('a concrete declared slot stays the contract', () => {
    const ce = freshEngine();
    ce.declare('c', 'function');
    ce.declare('g', '(number) -> unknown');
    ce.assign('g', ce.parse('(x) \\mapsto 1 + c(x)'));
    ce.assign('c', ce.parse('(i) \\mapsto 2i'));
    expect(ce.box('g').type.toString()).toBe('(number) -> number');
  });

  test('a named function assigned under the declaration refines it', () => {
    const ce = freshEngine();
    ce.declare('sq', '(number) -> number');
    ce.assign('sq', ce.parse('(x) \\mapsto x^2'));
    ce.declare('f', '(unknown) -> unknown');
    ce.assign('f', ce.symbol('sq'));
    expect(ce.box('f').type.toString()).toBe('(number) -> number');
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('9');
  });

  test('a recursive body types and evaluates on both definition kinds', () => {
    const ce = freshEngine();
    ce.declare('fact', '(unknown) -> unknown');
    ce.assign(
      'fact',
      ce.parse(
        '(n) \\mapsto \\operatorname{If}(n \\le 1, 1, n \\cdot \\operatorname{fact}(n-1))'
      )
    );
    expect(ce.box('fact').type.toString().startsWith('(unknown) -> ')).toBe(
      true
    );
    expect(ce.box(['fact', 5]).evaluate().toString()).toBe('120');
    ce.declare('k', {
      signature: '(unknown) -> unknown',
      evaluate: ce.parse('(x) \\mapsto x'),
    });
    ce.assign(
      'k',
      ce.parse('(n) \\mapsto \\operatorname{If}(n \\le 1, 1, n \\cdot k(n-1))')
    );
    expect(ce.box(['k', 5]).evaluate().toString()).toBe('120');
  });

  test('an explicit retype replaces the skeleton of an operator definition', () => {
    const ce = freshEngine();
    ce.declare('k', {
      signature: '(unknown) -> unknown',
      evaluate: ce.parse('(x) \\mapsto x'),
    });
    ce.assign('k', ce.parse('(x) \\mapsto 2x'));
    ce.box('k').type = ce.type('(integer) -> integer');
    expect(ce.box('k').type.toString()).toBe('(integer) -> integer');
  });

  test('a lambda-backed operator definition follows its body too', () => {
    // `declare(…, { signature, evaluate })` installs an operator definition
    // that holds the lambda; an assignment keeps that representation.
    const ce = freshEngine();
    ce.declare('c', 'function');
    ce.declare('k', {
      signature: '(unknown) -> unknown',
      evaluate: ce.parse('(x) \\mapsto x + 1'),
    });
    ce.assign('k', ce.parse('(x) \\mapsto 1 + c(x)'));
    expect(ce.box(['k', 'x']).type.toString()).toBe('broadcastable<number>');
    ce.assign('c', ce.parse('(i) \\mapsto 2i'));
    expect(ce.box(['k', 'x']).type.toString()).toBe('number');
    ce.assign('k', ce.parse('(x) \\mapsto [x, x]'));
    expect(ce.box(['k', 'x']).type.toString()).toBe('vector<2>');
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
    const def = ce.parse(`h\\coloneq ${BODY}`, { strict: false }).evaluate();
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
