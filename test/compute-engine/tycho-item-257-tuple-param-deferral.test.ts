/**
 * A tuple-shaped PARAMETER took part in neither admission, so a union operand
 * with a tuple member was refused at a library operator while a user function
 * of the identical signature admitted it.
 *
 * The engine's rule is to reject only what is PROVABLY incompatible: a
 * symbolic operand is admitted when its type overlaps the parameter, and the
 * decision is deferred to the run-time conformance check
 * (`overlapAdmission`). That admission is switched off for collection- and
 * tuple-shaped parameters on purpose — `typesOverlap` is unsound for them,
 * reading `list<number> ∧ matrix` as inhabited because the empty list inhabits
 * both — and for those kinds `overlapsForDeferredValidation` is the authority
 * instead, refuting rank and leaf mismatches properly.
 *
 * But that authority recognized only `list`, `collection` and
 * `indexed_collection`. A `tuple` parameter fell through both, so nothing
 * admitted it. `PointX`, declared `(xs: collection<any> | tuple) -> any`,
 * refused an indexed point carrier typed
 * `missing | number | tuple<number, number>` — whose `tuple` member satisfies
 * the parameter exactly — and Tycho's indexed computed points drew nothing
 * (item 257).
 *
 * The fix gives the deferral authority a tuple arm, with the tuple
 * counterparts of the refutations it already performs: arity (a 2-tuple can
 * never be a 3-tuple) and per-slot disjointness. Only the tuple/tuple pairing
 * defers; a tuple operand at a collection parameter keeps its refusal.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { overlapsForDeferredValidation } from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';

/** The three-arm carrier every computed point carrier is declared with. */
const CARRIER =
  'indexed_collection<tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>';

const defer = (operand: string, param: string): boolean =>
  overlapsForDeferredValidation(parseType(operand), parseType(param));

describe('the deferral authority covers tuple parameters', () => {
  test('a tuple operand defers at a tuple parameter', () => {
    expect(defer('tuple<number, number>', 'tuple')).toBe(true);
    expect(defer('tuple<number, number>', 'tuple<number, number>')).toBe(true);
  });

  test('one admitting member is enough for a union', () => {
    expect(
      defer('number | tuple<number, number>', 'collection<any> | tuple')
    ).toBe(true);
  });

  // The tuple counterparts of the rank and leaf refutations the list arm has.
  test('arity is refuted', () => {
    expect(defer('tuple<number, number, number>', 'tuple<number, number>')).toBe(
      false
    );
  });

  test('a disjoint slot is refuted', () => {
    expect(defer('tuple<string, string>', 'tuple<number, number>')).toBe(false);
  });

  // Only the tuple/tuple pairing defers; the union distribution means one
  // admitting pair is enough, so nothing is lost by keeping these strict.
  test('a tuple does not defer at a collection parameter, nor the reverse', () => {
    expect(defer('tuple<number, number>', 'collection<any>')).toBe(false);
    expect(defer('list<number>', 'tuple')).toBe(false);
  });

  // Design decision D8: the top-type waiver is for a top arriving as the WHOLE
  // operand's type. A top under a constructor has no ground counterpart to
  // preserve — `(tuple<number>) -> number` refuses a `tuple<any>` operand — so
  // the deferring reading must not be looser. This needs its own test because
  // the either-direction slot check would otherwise waive it: `any` is a
  // supertype of `number`, so a top slot reads exactly like the ordinary
  // deferral case (a `number` slot that may hold an integer at run time).
  test('a NESTED top slot in the operand is refuted', () => {
    expect(defer('tuple<any>', 'tuple<number>')).toBe(false);
    expect(defer('tuple<unknown>', 'tuple<number>')).toBe(false);
    // Narrower-than-the-parameter slots still defer, which is the control the
    // clause above must not break.
    expect(defer('tuple<integer>', 'tuple<number>')).toBe(true);
    // A top on the PARAMETER side is the parameter's own permissiveness and is
    // unaffected.
    expect(defer('tuple<number>', 'tuple<any>')).toBe(true);
  });

  // A slot NAME is part of the contract — `isSubtype` refuses
  // `tuple<x: number>` at `tuple<y: number>` — so dropping names while
  // comparing slots admitted a provably incompatible pair. Only two EXPLICIT
  // and different names refute; a named slot still pairs with an unnamed one,
  // which is the name erasure the lattice already permits.
  test('conflicting explicit slot names are refuted', () => {
    expect(defer('tuple<x: number>', 'tuple<y: number>')).toBe(false);
    expect(defer('tuple<x: number>', 'tuple<x: number>')).toBe(true);
    expect(defer('tuple<number>', 'tuple<x: number>')).toBe(true);
  });

  // The bare `tuple` states no arity, but it is not unconstrained: its slots
  // hold VALUES. An absence marker or an empty type shares no inhabitant with
  // it, so the unknown-arity arm must not wave those through.
  test('the bare tuple still constrains its slots to values', () => {
    expect(defer('tuple<missing>', 'tuple')).toBe(false);
    expect(defer('tuple', 'tuple<missing>')).toBe(false);
    expect(defer('tuple<nothing>', 'tuple')).toBe(false);
    expect(defer('tuple<number>', 'tuple')).toBe(true);
  });

  // A transparent alias names the tuple it stands for, so it has to unfold
  // before the tuple test — otherwise the reference node reads as "not a
  // tuple" and the deferral declines for exactly the shape it exists to admit.
  // A NOMINAL reference stays folded: it does not subtype its definition.
  test('a transparent alias to a tuple reaches the accessors', () => {
    const ce = new ComputeEngine();
    ce.declareType('Point', 'tuple<number, number>', { alias: true });
    ce.declare('w', 'number | Point');
    expect(ce.box(['PointX', 'w']).isValid).toBe(true);
  });

  test('a non-collection operand is still refuted at a tuple parameter', () => {
    expect(defer('number', 'tuple')).toBe(false);
    expect(defer('string', 'tuple')).toBe(false);
  });

  // The refutations that motivated the exemption in the first place.
  test('the collection refutations are unchanged', () => {
    expect(defer('list<number>', 'collection<any>')).toBe(true);
    expect(defer('number | list<number>', 'collection<any>')).toBe(true);
    expect(defer('string', 'matrix')).toBe(false);
    expect(defer('list<number>', 'matrix')).toBe(false);
  });
});

describe('Tycho 257 — an indexed point carrier reaches the accessors', () => {
  function withCarrier(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('P', CARRIER);
    return ce;
  }

  test('the carrier really does index to a three-member union', () => {
    expect(withCarrier().box(['At', 'P', 2]).type.toString()).toBe(
      'missing | number | tuple<number, number>'
    );
  });

  test('all three accessors admit it, on the box route', () => {
    const ce = withCarrier();
    const at = ce.box(['At', 'P', 2]);
    expect(ce.box(['PointX', at]).isValid).toBe(true);
    expect(ce.box(['PointY', at]).isValid).toBe(true);
    expect(ce.box(['PointZ', at]).isValid).toBe(true);
  });

  test('and on the parse route', () => {
    expect(withCarrier().parse('\\operatorname{PointX}(P_2)').isValid).toBe(
      true
    );
  });

  test('and with the carrier assigned a point list, it evaluates', () => {
    const ce = withCarrier();
    ce.box([
      'Assign',
      'P',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ]).evaluate();
    const px = ce.box(['PointX', ['At', 'P', 2]]);
    expect(px.isValid).toBe(true);
    expect(px.evaluate().toString()).toBe('3');
  });

  // The divergence this fix closes: the same signature must give the same
  // answer whether it is a library operator's or a user function's.
  test('a library operator and a user function now agree', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | tuple<number, number>');
    ce.declare('g', '(collection<any> | tuple) -> any');
    expect(ce.box(['PointX', 'w']).isValid).toBe(true);
    expect(ce.box(['g', 'w']).isValid).toBe(true);
  });

  // Deferral is not permission: an operand with NO admitting member is still
  // refused at boxing.
  test('a provably incompatible operand is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('bad', 'number | string');
    ce.declare('u', 'integer | string');
    expect(ce.box(['PointX', 5]).isValid).toBe(false);
    expect(ce.box(['PointX', 'bad']).isValid).toBe(false);
    expect(ce.box(['First', 'u']).isValid).toBe(false);
  });
});
