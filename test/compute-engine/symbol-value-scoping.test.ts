/**
 * EXECUTABLE SPEC — symbol-value dereference scoping.
 *
 * Design doc: docs/plans/2026-07-24-defining-scope-dereference-design.md
 *
 * Two symptoms of one root cause (symbol-value dereference has no notion of
 * the value's defining scope):
 *
 *  1. STALENESS ("one-evaluate-late"): a stored symbolic value does not
 *     re-resolve free symbols assigned after it was stored — `evaluate()`
 *     and `N()` disagree.
 *  2. NAME CAPTURE: when a stored value is dereferenced inside a call frame,
 *     its free symbols are captured BY NAME by parameters of the frame —
 *     even when a lexically-correct global binding exists.
 *
 * Every test marked `@fixme` asserts the CURRENT (wrong) behavior so the
 * suite stays green; the intended behavior under defining-scope dereference
 * is stated in the comment above each assertion. Tests NOT marked `@fixme`
 * assert behavior that is correct today and must be preserved by the fix.
 *
 * NOTE: these are characterization tests — they pass against the buggy
 * implementation by construction. The design pass flips the `@fixme`
 * assertions to their intended values.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function cortex(src: string): string {
  return executeCortex(new ComputeEngine(), src).value.toString();
}

describe('SPEC: staleness (one-evaluate-late)', () => {
  test('@fixme evaluate() does not re-resolve a later-assigned free symbol', () => {
    const ce = engine();
    ce.box(['Assign', 'd', ['Add', ['Multiply', 3, ['Square', 'x']], 1]]).evaluate();
    ce.box(['Assign', 'x', 2]).evaluate();
    // INTENDED: '13' — x is assigned in d's own (global) scope, so the
    // dereference should resolve it. Must agree with N().
    expect(ce.box('d').evaluate().toString()).toEqual('3x^2 + 1');
    // N() already resolves — evaluate() and N() disagree today.
    expect(ce.box('d').N().toString()).toEqual('13');
    // A second evaluate() resolves one more level ("one-evaluate-late").
    expect(ce.box('d').evaluate().evaluate().toString()).toEqual('13');
  });

  test('@fixme Cortex route: bare deref is stale, N is not', () => {
    // INTENDED: both '13'.
    expect(cortex('let d = 3x^2 + 1\nlet x = 2\nd')).toEqual('3x^2 + 1');
    expect(cortex('let d = 3x^2 + 1\nlet x = 2\nN(d)')).toEqual('13');
  });
});

describe('SPEC: name capture through call frames', () => {
  test('@fixme a parameter captures a stored value’s free symbol by name', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // INTENDED: 'x + 1' — a's free x lexically means the (unbound) global x;
    // the call frame's parameter must not intercept it.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('6');
  });

  test('@fixme the frame wins even over an existing global binding', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // INTENDED: '101' — the global x = 100 is the lexically correct binding.
    // Today the call frame's x = 5 shadows it: pure dynamic capture.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('6');
  });

  test('the capture is purely name-based: renaming the parameter avoids it', () => {
    // Correct today and must stay correct: with a parameter named z, a's
    // free x is untouched.
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'z']]).evaluate();
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('x + 1');
  });

  test('@fixme lambda frames capture the same way', () => {
    // INTENDED: 'x + 1'.
    expect(cortex('let a = x + 1\nlet h = x |-> a\nh(5)')).toEqual('6');
  });

  test('block-local lets do NOT capture (must stay clean)', () => {
    // Correct today and must stay correct: a do-block-local x does not leak
    // into a's stored value. (The 2026-07-24 naive re-evaluate-on-deref
    // experiment broke exactly this — it returned 105.)
    expect(cortex('let a = x + 1\nf(y) = do { let x = 99; a + y }\nf(5)')).toEqual(
      'x + 6'
    );
    expect(cortex('let a = x + 1\ng(y) = do { let x = 99; a }\ng(5)')).toEqual(
      'x + 1'
    );
  });
});

describe('SPEC: cycle behavior (must not regress)', () => {
  test('self-referential and mutual references terminate', () => {
    // The write-time self-reference guard and one-step dereference keep
    // these finite today. Any fix must keep them terminating; the exact
    // residual form is less important than termination.
    expect(cortex('let s\ns = s + 1\ns')).toEqual('s + 1');
    expect(cortex('a = b + 1\nb = a + 1\na')).toEqual('b + 1');
  });

  test('loop-carried numeric state is exact and fast-path eligible', () => {
    expect(cortex('let t = 0\nfor k in 1..100 { t = t + k }\nt')).toEqual('5050');
  });
});
