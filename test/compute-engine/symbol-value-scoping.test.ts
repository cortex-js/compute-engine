/**
 * EXECUTABLE SPEC — symbol-value dereference scoping.
 *
 * Design doc: docs/SCOPING-MODEL.md
 *
 * A symbol's stored value is evaluated in the environment ITS OWN free symbols
 * denote (`evaluateInOwnBindings`, `binders.ts`), which settled two symptoms
 * that shared a theme but not a mechanism:
 *
 *  1. STALENESS ("one-evaluate-late"): a stored symbolic value did not
 *     re-resolve free symbols assigned after it was stored, so `evaluate()`
 *     disagreed with `N()`, with the constant path and with `compile()`.
 *     `BoxedSymbol.evaluate()` returned the stored value verbatim; it now
 *     dereferences it.
 *  2. NAME CAPTURE: a stored value's free symbols, once inside a call frame,
 *     were captured BY NAME by the frame's parameters — even when a
 *     lexically-correct global binding existed. Three channels, all
 *     name-keyed, all closed:
 *       - Channel A (non-constant values): the post-evaluation parameter
 *         substitution in `function-utils.ts` (Tycho item 26) rewrote any
 *         parameter name surviving in the RESULT, including one that arrived
 *         inside a dereferenced value, and fired even where no dereference had
 *         happened (the nested-frame test). Now keyed on the parameter's
 *         BINDING.
 *       - Channel B (constants): the constant branch of
 *         `BoxedSymbol.evaluate()` re-evaluated its stored value in the
 *         CURRENT context, so a frame binding intercepted at the dereference.
 *       - Channel C: the in-frame `numericApproximation` re-evaluation did the
 *         same on the `N` route, which is why `g(5)` and `N(g(5))` disagreed.
 *
 * These began as characterization tests — asserting the buggy values so the
 * suite stayed green — and were flipped to the intended values as each half
 * landed. What they now pin, and what a future change must not undo:
 *
 *  - `evaluate()`, `N()` and `compile()` agree on a dereferenced value;
 *  - a free symbol in a stored value means the binding it was canonicalized
 *    against, not whatever an inner scope calls that name;
 *  - assignment stays EAGER, so declaration order still decides what a stored
 *    value snapshots (see the late/early ruling);
 *  - the cycle residuals (`s = s + 1` → `s + 1`) are unchanged.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function epsil(src: string): string {
  return executeEpsil(new ComputeEngine(), src).value.toString();
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
  test('evaluate() re-resolves a later-assigned free symbol', () => {
    const ce = engine();
    assignD(ce);
    ce.box(['Assign', 'x', 2]).evaluate();
    // `x` is assigned in d's own (global) scope, so the dereference resolves
    // it — and agrees with N(), which always did.
    expect(ce.box('d').evaluate().toString()).toEqual('13');
    expect(ce.box('d').N().toString()).toEqual('13');
    // Idempotent: there is no second level left to resolve. (This assertion
    // used to record the "one-evaluate-late" symptom, where the first
    // evaluate() returned `3x^2 + 1` and only the second reached 13.)
    expect(ce.box('d').evaluate().evaluate().toString()).toEqual('13');
  });

  test('Epsil route: bare deref and N agree', () => {
    expect(epsil('let d = 3x^2 + 1\nlet x = 2\nd')).toEqual('13');
    expect(epsil('let d = 3x^2 + 1\nlet x = 2\nN(d)')).toEqual('13');
  });

  test('the compiled route agrees with evaluate()', () => {
    // `BaseCompiler.tryFoldKnownSymbol` folds the value AND its nested free
    // symbols. It reported 13 while evaluate() still reported `3x^2 + 1` —
    // among interpret / N / compile, plain evaluate() was the outlier. All
    // three now agree.
    const ce = engine();
    assignD(ce);
    ce.box(['Assign', 'x', 2]).evaluate();
    expect(compile(ce.box('d'))?.code).toEqual('13');
    expect(ce.box('d').evaluate().toString()).toEqual('13');
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
    expect(epsil('let x = 2\nlet d = 3x^2 + 1\nx = 3\nN(d)')).toEqual('13');
    expect(epsil('let d = 3x^2 + 1\nlet x = 2\nx = 3\nN(d)')).toEqual('28');
  });
});

/**
 * Stage 14 of the binder mechanism
 * (`docs/SCOPING-MODEL.md`, ruling 1): the
 * dereference used to defer to the ambient lookup whenever ANY valueless
 * shadow of the name existed. That blanket rule was only ever a proxy for the
 * shield idiom — `withValueShield`/`simplifyValueBlind` hide a symbol's value
 * by shadow-declaring it valueless — and it swept in ordinary declarations
 * that shield nothing. Shields now carry an explicit `_isShield` marker and
 * only they defer.
 */
describe('SPEC: only a SHIELD intercepts a stored value’s free symbol', () => {
  test('a valueless inner Declare no longer intercepts', () => {
    const ce = engine();
    // ORDER IS LOAD-BEARING: `a` must be assigned while `x` is still valueless,
    // or eager capture bakes the number in and there is no free symbol left to
    // intercept.
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    expect(ce.box(['Add', 'a', 5]).evaluate().toString()).toEqual('106');
    // The block's `x` is a DIFFERENT variable; `a` captured the global binding
    // and has no business resolving through the block's one.
    expect(
      ce
        .box(['Block', ['Declare', 'x', "'real'"], ['Add', 'a', 5]])
        .evaluate()
        .toString()
    ).toEqual('106'); // was: 'x + 6'
  });

  test('a VALUED inner shadow is unchanged — it never intercepted', () => {
    // The asymmetry that made the blanket rule indefensible: give the same
    // shadow a value and it already did not capture. Both before and after.
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'x', "'real'"],
          ['Assign', 'x', 7],
          ['Add', 'a', 5],
        ])
        .evaluate()
        .toString()
    ).toEqual('106');
  });

  test('Solve still shields its unknown', () => {
    // `Solve`'s shield (`withValueShield`, `solve-domain.ts`) is a real shield
    // and keeps deferring: the unknown stays symbolic despite its global value.
    const ce = engine();
    ce.assign('x', 100);
    expect(
      ce.box(['Solve', ['Equal', ['Add', 'x', 1], 0], 'x']).evaluate().toString()
    ).toEqual('[-1]');
  });
});

describe('SPEC: name capture through call frames', () => {
  test('a parameter does not capture a stored value’s free symbol', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // a's free x lexically means the (unbound) global x; the call frame's
    // parameter is a different variable that happens to share the spelling.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('x + 1');
    // ... and the same under N(), which used to be Channel C: the in-frame
    // numeric re-evaluation looked `x` up again and found the parameter, so
    // this returned 6 while `evaluate()` already returned `x + 1`.
    expect(ce.box(['g', 5]).N().toString()).toEqual('x + 1');
  });

  test('the lexical global binding wins over the frame', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    // The global x = 100 is the lexically correct binding, so the dereference
    // resolves it. The call frame's x = 5 used to shadow it — pure dynamic
    // capture — giving 6. Both halves of the repair are needed here: closing
    // the capture alone would yield `x + 1`, and the dereference supplies 100.
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('101');
    expect(ce.box(['g', 5]).N().toString()).toEqual('101');
  });

  test('an enclosing frame does not capture a result it never dereferenced', () => {
    // THE DECISIVE CASE for the mechanism: g's frame (parameter z) does the
    // dereference cleanly and returns `x + 1`; h's frame then used to rewrite
    // that x by name without any dereference of its own — Channel A, the item
    // 26 substitution in function-utils, not the dereference path. A fix
    // confined to `BoxedSymbol.evaluate()` could not have flipped this; keying
    // the substitution on the parameter's BINDING did.
    expect(epsil('let a = x + 1\ng(z) = a\nh(x) = g(1)\nh(5)')).toEqual(
      'x + 1'
    );
    expect(epsil('let a = x + 1\ng(z) = a\nh(x) = g(1)\nN(h(5))')).toEqual(
      'x + 1'
    );
  });

  test('constants are not captured either (a separate channel)', () => {
    // Channel B: the constant branch re-evaluated its stored value in the
    // CURRENT context, so the frame intercepted at the dereference itself
    // (verified independent of the item 26 substitution). Both branches now go
    // through the same binding-aware dereference.
    const ce = engine();
    ce.declare('kk', { value: ce.parse('x + 1'), isConstant: true });
    ce.box(['Assign', 'g', ['Function', 'kk', 'x']]).evaluate();
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('x + 1');
    expect(ce.box(['g', 5]).N().toString()).toEqual('x + 1');
  });

  test('a stored DICTIONARY’s values are not captured either', () => {
    // The dereference helper's fast path used to be "no symbols, nothing to
    // protect", and `symbols` does not descend into a dictionary — so a stored
    // dictionary skipped the protection entirely and its values were evaluated
    // in the ambient frame, giving `{k: 6}`.
    const ce = engine();
    const dict = ce.box([
      'Dictionary',
      ['Tuple', { str: 'k' }, ['Add', 'x', 1]],
    ]);
    expect(dict.symbols).toEqual([]); // why the fast path missed it
    ce.box(['Assign', 'a', dict]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'x']]).evaluate();
    expect(ce.box(['g', 5]).evaluate().toString()).toContain('x');
  });

  test('the capture is purely name-based: renaming the parameter avoids it', () => {
    // Correct today and must stay correct: with a parameter named z, a's
    // free x is untouched.
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'g', ['Function', 'a', 'z']]).evaluate();
    expect(ce.box(['g', 5]).evaluate().toString()).toEqual('x + 1');
  });

  test('lambda frames do not capture either', () => {
    // A lambda's call frame is the same mechanism as a named function's, so it
    // must answer the same way on all three routes.
    expect(epsil('let a = x + 1\nlet h = x => a\nh(5)')).toEqual('x + 1');
    expect(epsil('let a = x + 1\nlet h = x => a\nN(h(5))')).toEqual('x + 1');
    // Box route: same shape, no Epsil parsing involved.
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    expect(
      ce
        .box(['Apply', ['Function', 'a', 'x'], 5])
        .evaluate()
        .toString()
    ).toEqual('x + 1');
  });

  test('block-local lets do NOT capture (must stay clean)', () => {
    // Correct today and must stay correct: a do-block-local x does not leak
    // into a's stored value. (The 2026-07-24 naive re-evaluate-on-deref
    // experiment broke exactly this — it returned 105.)
    expect(
      epsil('let a = x + 1\nf(y) = do { let x = 99; a + y }\nf(5)')
    ).toEqual('x + 6');
    expect(epsil('let a = x + 1\ng(y) = do { let x = 99; a }\ng(5)')).toEqual(
      'x + 1'
    );
  });

  test('a pre-evaluated argument keeps the caller’s meaning', () => {
    // The invariant defining-scope dereference rests on: a call frame's
    // parameter bindings hold values ALREADY evaluated in the caller, so
    // "the def's scope is the frame" is safe for them. Here the argument `y`
    // means the caller's y = 7, not the frame's y = 2.
    expect(epsil('f(x, y) = x\nlet y = 7\nf(y, 2)')).toEqual('7');
  });
});

/** Every symbol occurrence in `expr`, in traversal order. */
function symbolOccurrences(expr: any): any[] {
  if (expr.symbol) return [expr];
  return (expr.ops ?? []).flatMap((op: any) => symbolOccurrences(op));
}

describe('SPEC: named-parameter rebind', () => {
  test('a body canonicalized before its binder rebinds its parameter', () => {
    // Canonicalizing an already-canonical body is a NO-OP, so a body built
    // before the literal existed keeps the bindings it was canonicalized
    // against — and its parameter occurrences then denote whatever the
    // enclosing scope had. `Pipe` does exactly this: it is lazy and takes
    // `.canonical` of its right operand, so `x |> Map(f, _)` binds `_1` in the
    // CALLER's scope before `Map(f, _1)` is wrapped into `(_1) ↦ Map(f, _1)`.
    // `rebindParameters` repairs it — for NAMED parameters as well as for the
    // anonymous placeholders it was originally restricted to.
    const ce = engine();
    const body = ce.box(['Add', 'y', 1]); // canonical, `y` bound in the caller
    const f = ce.function('Function', [
      body,
      ce.symbol('y', { canonical: false }),
    ]);
    const occurrence = symbolOccurrences(f.op1).find(
      (s) => s.symbol === 'y'
    )!;
    // The parameter is this literal's variable, NOT the caller's `y`.
    expect(occurrence.isSame(ce.symbol('y'))).toBe(false);
    expect(ce.box(['Apply', f, 5]).evaluate().toString()).toEqual('6');
  });

  test('an antiderivative is expressed in the caller’s symbols', () => {
    // Regression pin for `liftIntegrand` (`library/calculus.ts`). `Integrate`
    // binds its integration variable, and the integrand's free coefficients
    // are auto-declared in the literal's body Block too — but the
    // antiderivative machinery (and any integration provider) unwraps that
    // scaffolding and mints its OWN occurrences in the caller's scope. Unless
    // the lifted body is re-bound, the answer mixes two bindings of the same
    // name: the arithmetic declines to combine them, and the result compares
    // unequal to the same expression written by the caller.
    const ce = engine();
    const F = ce.box(['Integrate', ['Multiply', 'a', 'x'], 'x']).evaluate();
    expect(F.toString()).toEqual('1/2 * a * x^2');
    for (const occurrence of symbolOccurrences(F))
      expect(occurrence.isSame(ce.symbol(occurrence.symbol))).toBe(true);
    // The same, stated as the equality a caller would write.
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], 'x'])
        .evaluate()
        .isSame(ce.parse('\\frac{x^3}{3}'))
    ).toBe(true);
  });

  test('a binding site held raw by a lazy operator is not rebound', () => {
    // Regression pin for the visitor's "no binding, nothing to repair" rule.
    // `Declare` keeps its first operand un-canonicalized on purpose: it is a
    // NAME, and binding it would point it at an outer definition. Rebinding it
    // to the parameter turns it into a reference, and `Declare`'s
    // `sym(ops[0].evaluate())` then reads the argument's VALUE instead of the
    // name — so the declaration silently vanishes and the conflict with the
    // parameter goes unreported.
    const ce = engine();
    const f = ce.box([
      'Function',
      ['Block', ['Declare', 'x'], ['Multiply', 'x', 2]],
      'x',
    ]);
    expect(() => ce.box(['Apply', f, 15]).evaluate()).toThrow(
      /already declared/
    );
  });
});

describe('SPEC: cycle behavior (must not regress)', () => {
  test('self-referential and mutual references terminate', () => {
    // The write-time self-reference guard and one-step dereference keep these
    // finite today. The cycle guard in step 2 must ABORT the whole
    // dereference and fall back to the stored value (returning at the
    // re-entry point instead yields 'b + 3'; returning the bare symbol yields
    // 'a + 2' — both regressions of the residual pinned here).
    expect(epsil('let s\ns = s + 1\ns')).toEqual('s + 1');
    expect(epsil('a = b + 1\nb = a + 1\na')).toEqual('b + 1');
  });

  test('a cycle further down the chain costs only its own dereference', () => {
    // `a` is not itself cyclic, so the cycle between `p` and `q` must not cost
    // `a` its dereference. An abort that unwound the WHOLE chain returned `a`'s
    // raw stored value (`p + 5`), silently reinstating the staleness above.
    //
    // The values look one level deeper than written because assignment is EAGER
    // (see the late/early ruling): by the time `q = p + 1` runs, `p` already
    // dereferences to `q + 1`, so `q` stores `q + 2`.
    expect(epsil('p = q + 1\nq = p + 1\np')).toEqual('q + 1');
    expect(epsil('a = p + 5\np = q + 1\nq = p + 1\na')).toEqual('q + 6');
  });

  test('a self-referential ARGUMENT substitutes once (Tycho item 46)', () => {
    // The self-reference guard is explicitly unchanged by this design: the
    // frame binds t to an argument that mentions t, and the value is
    // substituted once rather than re-resolved forever.
    expect(epsil('f(t) = t + 1\nf(t + 1)')).toEqual('t + 2');
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
    expect(epsil('let t = 0\nfor k in 1..100 { t = t + k }\nt')).toEqual(
      '5050'
    );
  });
});
