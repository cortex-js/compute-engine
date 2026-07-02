import { ComputeEngine } from '../../../src/compute-engine';

/**
 * NIGHTLY — assume→verify identity matrix.
 *
 * The identity property (Wave-4 P1-2…P1-6): a proposition accepted by `assume`
 * must be verifiable afterward — `assume(P) ∈ {ok, tautology}` ⇒
 * `verify(P) === true`. The committed `test/compute-engine/verify.test.ts` holds
 * an 11-case core of this; this nightly suite is the BROAD battery (inequalities,
 * chained bounds, equalities, opaque sum/product facts, set memberships,
 * NotEqual) over many fresh engines. Each proposition is rebuilt from source for
 * the verify call so the identity is tested structurally, not by object reuse.
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

// Each case: a builder that, given a fresh engine, returns the proposition to
// both assume and verify. A separate `assumeSrc` may be given when the fact must
// be introduced through a different surface form (e.g. chained inequality).
type Case = {
  label: string;
  prop: (ce: ComputeEngine) => any;
  assumeSrc?: (ce: ComputeEngine) => any;
};

const CASES: Case[] = [
  // Simple inequalities
  { label: 'x > 0', prop: (ce) => ce.parse('x > 0') },
  { label: 'x < 0', prop: (ce) => ce.parse('x < 0') },
  { label: 'x >= 3', prop: (ce) => ce.parse('x \\ge 3') },
  { label: 'x <= 5', prop: (ce) => ce.parse('x \\le 5') },
  { label: 'x > -2', prop: (ce) => ce.parse('x > -2') },
  { label: 'y < 10', prop: (ce) => ce.parse('y < 10') },
  { label: 'w >= -4', prop: (ce) => ce.parse('w \\ge -4') },
  { label: 't <= 100', prop: (ce) => ce.parse('t \\le 100') },
  // Chained bounds — introduced via the chained form, each side verified
  {
    label: '0 < x < 1 (lower)',
    prop: (ce) => ce.expr(['Greater', 'x', 0]),
    assumeSrc: (ce) => ce.parse('0 < x < 1'),
  },
  {
    label: '0 < x < 1 (upper)',
    prop: (ce) => ce.expr(['Less', 'x', 1]),
    assumeSrc: (ce) => ce.parse('0 < x < 1'),
  },
  {
    label: '-5 < y < 5 (lower)',
    prop: (ce) => ce.expr(['Greater', 'y', -5]),
    assumeSrc: (ce) => ce.parse('-5 < y < 5'),
  },
  {
    label: '2 <= z <= 8 (upper)',
    prop: (ce) => ce.expr(['LessEqual', 'z', 8]),
    assumeSrc: (ce) => ce.parse('2 \\le z \\le 8'),
  },
  // Equalities
  { label: 'x + y = 5', prop: (ce) => ce.parse('x + y = 5') },
  { label: 'a + b + c = 12', prop: (ce) => ce.parse('a + b + c = 12') },
  { label: 'x^2 = 4', prop: (ce) => ce.parse('x^2 = 4') },
  { label: 'p - q = 3', prop: (ce) => ce.parse('p - q = 3') },
  // Opaque product / sum facts the evaluator cannot decide directly
  { label: 'x*y > 0', prop: (ce) => ce.expr(['Greater', ['Multiply', 'x', 'y'], 0]) },
  { label: 'a*b < 0', prop: (ce) => ce.expr(['Less', ['Multiply', 'a', 'b'], 0]) },
  { label: 'x + y > 0', prop: (ce) => ce.expr(['Greater', ['Add', 'x', 'y'], 0]) },
  { label: 'u + v + w >= 1', prop: (ce) => ce.expr(['GreaterEqual', ['Add', 'u', 'v', 'w'], 1]) },
  // Set memberships (symbol-set and type-style RHS)
  { label: 'n in Integers', prop: (ce) => ce.expr(['Element', 'n', 'Integers']) },
  { label: 'k in RealNumbers', prop: (ce) => ce.expr(['Element', 'k', 'RealNumbers']) },
  { label: 'm in integer (type)', prop: (ce) => ce.expr(['Element', 'm', 'integer']) },
  { label: 'r in RationalNumbers', prop: (ce) => ce.expr(['Element', 'r', 'RationalNumbers']) },
  // NotEqual
  { label: 'x != 2', prop: (ce) => ce.expr(['NotEqual', 'x', 2]) },
  { label: 'y != 0', prop: (ce) => ce.expr(['NotEqual', 'y', 0]) },
  { label: 's != t', prop: (ce) => ce.expr(['NotEqual', 's', 't']) },
];

describeNightly('NIGHTLY assume→verify identity — assume(P)∈{ok,tautology} ⇒ verify(P)=true', () => {
  for (const c of CASES) {
    it(`assume(${c.label}) ⇒ verify(${c.label})`, () => {
      const ce = new ComputeEngine();
      const asserted = (c.assumeSrc ?? c.prop)(ce);
      const status = ce.assume(asserted);
      // The proposition must be accepted (not a contradiction/invalid).
      expect(['ok', 'tautology']).toContain(status);
      // …and then verifiable.
      expect(ce.verify(c.prop(ce))).toBe(true);
    });
  }
});
