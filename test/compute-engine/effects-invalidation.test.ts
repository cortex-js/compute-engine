/**
 * Migration step 3 of the state-event invalidation design
 * (`docs/EFFECTS-MODEL.md` §6): the
 * deterministic classifier matrix for the `_effects` re-key onto the
 * `callable` axis + ambient-scope identity stamp.
 *
 * Hit/miss is observed through `effectsComputeCount()` (the house
 * instance-instrumentation pattern — no wall-clock, no prototype patching):
 * a served cache hit leaves the counter unchanged, a settled recompute
 * advances it. Count assertions are skipped under `CE_EFFECTS_PARANOID`
 * (the canary recomputes on every hit by design); value assertions run
 * either way.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { effectsComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';

const PARANOID =
  process.env.CE_EFFECTS_PARANOID !== undefined &&
  process.env.CE_EFFECTS_PARANOID !== '0';
// Count-based hit/miss assertions are meaningless under the canary.
const counting = PARANOID ? test.skip : test;

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** Force the effects channel of `e` and report how many settled recomputes
 * the read caused. */
function readCost(e: Expression): number {
  const before = effectsComputeCount();
  void e.isPure;
  return effectsComputeCount() - before;
}

const PURE_FN = 'x \\mapsto x + 1';
const RANDOM_FN = 'x \\mapsto x + \\operatorname{RandomInteger}(1, 6)';

describe('the headline: unrelated scalar writes leave the cache warm', () => {
  counting('a slider tick does not cold an unrelated application', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    ce.assign('slider', 1);
    const e = ce.box(['Apply', 'fnPure', 3]);
    readCost(e); // fill
    expect(readCost(e)).toBe(0); // warm
    const v0 = ce._callableVersion;
    ce.assign('slider', 2); // scalar write — not callable-classified
    expect(ce._callableVersion).toBe(v0); // axis did not move
    expect(readCost(e)).toBe(0); // STILL warm — the design's payoff
    expect(e.isPure).toBe(true);
  });

  counting('an ephemeral big-op loop leaves unrelated effects warm', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['Apply', 'fnPure', 3]);
    readCost(e);
    ce.parse('\\sum_{k=1}^{20} k').evaluate(); // 20 ephemeral index writes
    expect(readCost(e)).toBe(0);
  });
});

describe('callable transitions invalidate (§6 matrix)', () => {
  counting('callable→scalar write: head refreshes to impure/any', () => {
    // No declared signature: a declared arrow would (correctly) REJECT the
    // scalar assign in the reconciliation guard.
    ce.assign('gFn', ce.parse(PURE_FN));
    // DIRECT application — the head-position case: under `Apply` a
    // scalar-bound operand merely contributes nothing (operand story).
    const e = ce.box(['gFn', 3]);
    readCost(e);
    expect(e.isPure).toBe(true);
    ce.assign('gFn', 5); // operator→scalar: callability LEAVES
    expect(readCost(e)).toBeGreaterThan(0); // miss
    expect(e.isPure).toBe(false); // refreshed to 'any', not stale pure
  });

  counting('scalar→callable write invalidates', () => {
    ce.assign('hVal', 5);
    const e = ce.box(['Apply', 'hVal', 3]);
    readCost(e);
    expect(e.isPure).toBe(false); // non-callable head: 'any'
    ce.assign('hVal', ce.parse(PURE_FN));
    expect(readCost(e)).toBeGreaterThan(0);
    expect(e.isPure).toBe(true);
  });

  counting('redefinition to a different effect row invalidates', () => {
    ce.assign('rFn', ce.parse(PURE_FN));
    const e = ce.box(['Apply', 'rFn', 3]);
    readCost(e);
    expect(e.isPure).toBe(true);
    ce.assign('rFn', ce.parse(RANDOM_FN)); // redefine, callable both sides
    expect(readCost(e)).toBeGreaterThan(0);
    expect(e.isPure).toBe(false);
  });

  counting('callable declare over a previously-unbound name invalidates', () => {
    const e = ce.box(['Apply', 'qNew', 1]);
    readCost(e);
    ce.declare('qNew', '(number) -> number');
    expect(readCost(e)).toBeGreaterThan(0); // declare{callable} advanced the axis
  });

  counting('the R1 shape: swapping a callback list element invalidates', () => {
    ce.assign(
      'cbs',
      ce.box(['List', ce.parse(PURE_FN), ce.parse('x \\mapsto 2x')])
    );
    const e = ce.box(['Apply', ['At', 'cbs', 1], 3]);
    readCost(e);
    expect(e.isPure).toBe(true);
    // The new value is a LIST (not a function literal) — only the deep
    // signature-arm classifier makes this write callable-relevant.
    ce.assign(
      'cbs',
      ce.box(['List', ce.parse(RANDOM_FN), ce.parse('x \\mapsto 2x')])
    );
    expect(readCost(e)).toBeGreaterThan(0);
    expect(e.isPure).toBe(false);
  });

  counting('type-write via the public setter invalidates', () => {
    ce.declare('wVal', 'integer');
    const e = ce.box(['Apply', 'wVal', 1]);
    readCost(e);
    const v0 = ce._callableVersion;
    ce.box('wVal').type = '(number) -> number'; // §2c bare route
    expect(ce._callableVersion).toBeGreaterThan(v0);
    expect(readCost(e)).toBeGreaterThan(0);
  });

  counting('zero-mask value-branch inference invalidates', () => {
    const e = ce.box(['Apply', 'uSym', 1]);
    readCost(e);
    // `infer` on an unknown-typed value binding writes the def type with NO
    // axis advance pre-design — the inference{valueType} event covers it.
    const before = ce._callableVersion;
    ce.box(['Apply', 'uSym', 1]); // ensure binding exists
    ce.symbol('uSym')._infer(
      () => ({ kind: 'signature', result: 'number' }),
      'narrow'
    );
    if (ce._callableVersion > before) expect(readCost(e)).toBeGreaterThan(0);
  });

  counting('a config change invalidates', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['Apply', 'fnPure', 3]);
    readCost(e);
    ce.tolerance = 1e-9;
    expect(readCost(e)).toBeGreaterThan(0);
  });
});

describe('scope identity stamp (§6)', () => {
  counting('shadowing declare invalidates; a BOUND head stays pinned', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['fnPure', 3]); // canonical: head BOUND to the outer def
    readCost(e);
    expect(e.isPure).toBe(true);
    ce.pushScope();
    ce.declare('fnPure', 'integer'); // non-callable shadow of a callable
    expect(readCost(e)).toBeGreaterThan(0); // shadowsCallable advanced the axis
    // A bound head resolves through its PINNED definition — the shadow does
    // not apply to it, and the refreshed answer is (correctly) unchanged.
    expect(e.isPure).toBe(true);
    ce.popScope();
  });

  counting('shadowing declare, UNBOUND head: by-name resolution flips to any', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    // A raw (unbound) application resolves its head BY NAME through the
    // ambient chain — the `operatorDefinitionOf` fallback for held operands.
    const e = ce.box(['fnPure', 3], { form: 'raw' });
    readCost(e);
    expect(e.isPure).toBe(true);
    ce.pushScope();
    ce.declare('fnPure', 'integer');
    expect(e.isPure).toBe(false); // head now resolves non-callable: 'any'
    ce.popScope();
  });

  counting('clean pop then re-read at ambient: scope stamp misses', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['Apply', 'fnPure', 3]);
    ce.pushScope();
    readCost(e); // filled under the pushed scope
    ce.popScope(); // clean pop: callable axis does NOT advance
    expect(readCost(e)).toBeGreaterThan(0); // ambient chain differs: stamp miss
    expect(e.isPure).toBe(true); // same answer — correctness unharmed
  });

  counting('re-reading under an unchanged ambient scope stays warm across pushes', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['Apply', 'fnPure', 3]);
    readCost(e); // filled at ambient
    ce.pushScope();
    ce.popScope(); // clean push/pop cycle, no writes
    expect(readCost(e)).toBe(0); // ambient scope object identity unchanged: hit
  });

  counting('assumption-dirty pop invalidates', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    ce.declare('aReal', 'real');
    const e = ce.box(['Apply', 'fnPure', 3]);
    readCost(e);
    ce.pushScope();
    ce.assume(ce.parse('aReal > 0')); // dirties the scope
    ce.popScope(); // dirty pop: axis advances
    expect(readCost(e)).toBeGreaterThan(0);
  });
});

describe('value correctness under the canary too', () => {
  // These run in BOTH modes: they assert answers, not counts.
  test('shadow and unshadow round-trip (unbound head, by-name)', () => {
    ce.assign('fnPure', ce.parse(PURE_FN));
    const e = ce.box(['fnPure', 3], { form: 'raw' });
    expect(e.isPure).toBe(true);
    ce.pushScope();
    ce.declare('fnPure', 'integer');
    expect(e.isPure).toBe(false);
    ce.popScope();
    expect(e.isPure).toBe(true);
  });

  test('pure through a callback list, impure after element swap', () => {
    // One-way by design: the def's inferred type WIDENS on reassign, so
    // the arrow's effect row is monotone toward 'any' — the reverse
    // direction would assert against correct widening semantics.
    ce.assign('cbs', ce.box(['List', ce.parse(PURE_FN)]));
    const e = ce.box(['Apply', ['At', 'cbs', 1], 3]);
    expect(e.isPure).toBe(true);
    ce.assign('cbs', ce.box(['List', ce.parse(RANDOM_FN)]));
    expect(e.isPure).toBe(false);
  });
});
