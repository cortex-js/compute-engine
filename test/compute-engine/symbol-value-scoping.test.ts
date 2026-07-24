/**
 * EXECUTABLE SPEC — symbol-value dereference scoping.
 *
 * Design doc: docs/plans/2026-07-24-defining-scope-dereference-design.md
 *
 * Two symptoms, sharing a theme but NOT a mechanism:
 *
 *  1. STALENESS ("one-evaluate-late"): a stored symbolic value does not
 *     re-resolve free symbols assigned after it was stored — `evaluate()`
 *     disagrees with `N()`, with the constant path, and with `compile()`.
 *     Mechanism: `BoxedSymbol.evaluate()` returns the stored value verbatim.
 *  2. NAME CAPTURE: when a stored value's free symbols end up inside a call
 *     frame, they are captured BY NAME by parameters of the frame — even when
 *     a lexically-correct global binding exists. TWO mechanisms:
 *       - Channel A (non-constant values): the post-evaluation parameter
 *         substitution in `function-utils.ts` (Tycho item 26) rewrites any
 *         parameter name surviving in the RESULT — including one that arrived
 *         inside a dereferenced value. It fires even when no dereference
 *         happened in that frame (see the nested-frame test).
 *       - Channel B (constants): the constant branch of
 *         `BoxedSymbol.evaluate()` re-evaluates its stored value in the
 *         CURRENT context, so a frame binding intercepts directly.
 *
 * Every test marked `@fixme` asserts the CURRENT (wrong) behavior so the
 * suite stays green; the intended behavior under defining-scope dereference
 * is stated in the comment above each assertion, along with which design step
 * flips it. Tests NOT marked `@fixme` assert behavior that is correct today
 * and must be preserved by the fix.
 *
 * NOTE: these are characterization tests — they pass against the buggy
 * implementation by construction. The design pass flips the `@fixme`
 * assertions to their intended values.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeCortex } from '../../src/cortex/execute-cortex';

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function cortex(src: string): string {
  return executeCortex(new ComputeEngine(), src).value.toString();
}

/** `let d = 3x^2 + 1` via the raw-MathJSON route. */
function assignD(ce: ComputeEngine): void {
  ce.box([
    'Assign',
    'd',
    ['Add', ['Multiply', 3, ['Square', 'x']], 1],
  ]).evaluate();
}

describe('SPEC: staleness (one-evaluate-late)', () => {
  test('@fixme evaluate() does not re-resolve a later-assigned free symbol', () => {
    const ce = engine();
    assignD(ce);
    ce.box(['Assign', 'x', 2]).evaluate();
    // INTENDED (step 2): '13' — x is assigned in d's own (global) scope, so
    // the dereference should resolve it. Must agree with N().
    expect(ce.box('d').evaluate().toString()).toEqual('3x^2 + 1');
    // N() already resolves — evaluate() and N() disagree today.
    expect(ce.box('d').N().toString()).toEqual('13');
    // A second evaluate() resolves one more level ("one-evaluate-late").
    expect(ce.box('d').evaluate().evaluate().toString()).toEqual('13');
  });

  test('@fixme Cortex route: bare deref is stale, N is not', () => {
    // INTENDED (step 2): both '13'.
    expect(cortex('let d = 3x^2 + 1\nlet x = 2\nd')).toEqual('3x^2 + 1');
    expect(cortex('let d = 3x^2 + 1\nlet x = 2\nN(d)')).toEqual('13');
  });

  test('@fixme the compiled route already resolves deeply', () => {
    // `BaseCompiler.tryFoldKnownSymbol` folds the value AND its nested free
    // symbols, so compile() reports 13 while evaluate() reports 3x^2 + 1.
    // Among interpret / N / compile, plain evaluate() is the outlier.
    // INTENDED (step 2): the two agree.
    const ce = engine();
    assignD(ce);
    ce.box(['Assign', 'x', 2]).evaluate();
    expect(compile(ce.box('d'))?.code).toEqual('(3 * (2 * 2) + 1)');
    expect(ce.box('d').evaluate().toString()).toEqual('3x^2 + 1');
  });

  test('the constant path already re-evaluates on dereference', () => {
    // Correct today and must stay correct: a CONSTANT declared with a
    // symbolic value resolves its free symbols at dereference. This is the
    // shape the non-constant path is being brought in line with.
    const ce = engine();
    ce.declare('kk', { value: ce.parse('3x^2 + 1'), isConstant: true });
    ce.box(['Assign', 'x', 2]).evaluate();
    expect(ce.box('kk').evaluate().toString()).toEqual('13');
    expect(ce.box('kk').N().toString()).toEqual('13');
  });
});

describe('SPEC: the late-bound/early-bound ruling', () => {
  test('a symbol already bound at assignment time is snapshotted', () => {
    // ACCEPTED RULING (not a defect): assignment stays eager, so a stored
    // value snapshots what was already bound and stays live only for what was
    // free. The same three statements give different answers by declaration
    // order. Must hold before AND after the fix.
    expect(cortex('let x = 2\nlet d = 3x^2 + 1\nx = 3\nN(d)')).toEqual('13');
    expect(cortex('let d = 3x^2 + 1\nlet x = 2\nx = 3\nN(d)')).toEqual('28');
  });
});

describe('SPEC: name capture through call frames', () => {
  test('@fixme a parameter captures a stored value’s free symbol by name', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // INTENDED (step 3): 'x + 1' — a's free x lexically means the (unbound)
    // global x; the call frame's parameter must not intercept it.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('6');
    // ... and the same under N().
    expect(ce.box(['g', 5]).N().toString()).toEqual('6');
  });

  test('@fixme the frame wins even over an existing global binding', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // INTENDED (steps 2 AND 3): '101' — the global x = 100 is the lexically
    // correct binding. Today the call frame's x = 5 shadows it: pure dynamic
    // capture. Step 3 alone yields 'x + 1'; step 2 supplies the 100.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('6');
    expect(ce.box(['g', 5]).N().toString()).toEqual('6');
  });

  test('@fixme an enclosing frame captures a result it never dereferenced', () => {
    // THE DECISIVE CASE for the mechanism: g's frame (parameter z) does the
    // dereference cleanly and returns `x + 1`; h's frame then rewrites that
    // x by name, without any dereference of its own. Channel A — the item 26
    // substitution in function-utils — not the dereference path. A fix
    // confined to BoxedSymbol.evaluate() cannot flip this.
    // INTENDED (step 3): 'x + 1'.
    expect(cortex('let a = x + 1\ng(z) = a\nh(x) = g(1)\nh(5)')).toEqual('6');
    expect(cortex('let a = x + 1\ng(z) = a\nh(x) = g(1)\nN(h(5))')).toEqual(
      '6'
    );
  });

  test('@fixme constants are captured too (a separate channel)', () => {
    // Channel B: the constant branch re-evaluates its stored value in the
    // CURRENT context, so the frame intercepts at the dereference itself
    // (verified independent of the item 26 substitution).
    // INTENDED (step 2): 'x + 1'.
    const ce = engine();
    ce.declare('kk', { value: ce.parse('x + 1'), isConstant: true });
    ce.box(['Assign', 'g', ['Function', 'kk', 'x']]).evaluate();
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
    // INTENDED (step 3): 'x + 1' on all three routes.
    expect(cortex('let a = x + 1\nlet h = x |-> a\nh(5)')).toEqual('6');
    expect(cortex('let a = x + 1\nlet h = x |-> a\nN(h(5))')).toEqual('6');
    // Box route: same shape, no Cortex parsing involved.
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    expect(
      ce
        .box(['Apply', ['Function', 'a', 'x'], 5])
        .evaluate()
        .toString()
    ).toEqual('6');
  });

  test('block-local lets do NOT capture (must stay clean)', () => {
    // Correct today and must stay correct: a do-block-local x does not leak
    // into a's stored value. (The 2026-07-24 naive re-evaluate-on-deref
    // experiment broke exactly this — it returned 105.)
    expect(
      cortex('let a = x + 1\nf(y) = do { let x = 99; a + y }\nf(5)')
    ).toEqual('x + 6');
    expect(cortex('let a = x + 1\ng(y) = do { let x = 99; a }\ng(5)')).toEqual(
      'x + 1'
    );
  });

  test('a pre-evaluated argument keeps the caller’s meaning', () => {
    // The invariant defining-scope dereference rests on: a call frame's
    // parameter bindings hold values ALREADY evaluated in the caller, so
    // "the def's scope is the frame" is safe for them. Here the argument `y`
    // means the caller's y = 7, not the frame's y = 2.
    expect(cortex('f(x, y) = x\nlet y = 7\nf(y, 2)')).toEqual('7');
  });
});

describe('SPEC: cycle behavior (must not regress)', () => {
  test('self-referential and mutual references terminate', () => {
    // The write-time self-reference guard and one-step dereference keep these
    // finite today. The cycle guard in step 2 must ABORT the whole
    // dereference and fall back to the stored value (returning at the
    // re-entry point instead yields 'b + 3'; returning the bare symbol yields
    // 'a + 2' — both regressions of the residual pinned here).
    expect(cortex('let s\ns = s + 1\ns')).toEqual('s + 1');
    expect(cortex('a = b + 1\nb = a + 1\na')).toEqual('b + 1');
  });

  test('a self-referential ARGUMENT substitutes once (Tycho item 46)', () => {
    // The self-reference guard is explicitly unchanged by this design: the
    // frame binds t to an argument that mentions t, and the value is
    // substituted once rather than re-resolved forever.
    expect(cortex('f(t) = t + 1\nf(t + 1)')).toEqual('t + 2');
  });

  test('recursion still terminates', () => {
    const ce = engine();
    ce.box([
      'Assign',
      'fac',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          ['Multiply', 'n', ['fac', ['Subtract', 'n', 1]]],
        ],
        'n',
      ],
    ]).evaluate();
    expect(ce.box(['fac', 6]).evaluate().toString()).toEqual('720');
  });

  test('loop-carried numeric state is exact and fast-path eligible', () => {
    expect(cortex('let t = 0\nfor k in 1..100 { t = t + k }\nt')).toEqual(
      '5050'
    );
  });
});
