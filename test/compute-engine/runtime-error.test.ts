import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

//
// `RuntimeError(code)` — the runtime counterpart of a written `Error(…)`
// (`library/core.ts`). A written `Error` node is a static diagnostic that
// invalidates every tree above it; `RuntimeError("neg")` is a VALID
// application whose evaluation produces the `Error("neg")` value. Its result
// type is `never`: a signature describes the successes (docs/ERROR-MODEL.md
// §4), and this operator has none. User ruling 2026-09-03: the code only —
// no `where` operand, which names the offending sub-expression of a static
// diagnostic and has no runtime meaning.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('RuntimeError — the boxed application', () => {
  test('is a valid application typed `never`', () => {
    const e = ce.box(['RuntimeError', "'neg'"]);
    expect(e.operator).toBe('RuntimeError');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('never');
  });

  test('evaluates to the `Error(code)` value, for a string or an ErrorCode', () => {
    const v = ce.box(['RuntimeError', "'neg'"]).evaluate();
    expect(v.toString()).toBe('Error("neg")');
    expect(v.type.toString()).toBe('error');
    expect(v.isValid).toBe(false);
    expect(
      ce
        .box(['RuntimeError', ['ErrorCode', "'bad-arg'", 3]])
        .evaluate()
        .toString()
    ).toBe('Error(ErrorCode("bad-arg", 3))');
    // `.N()` is the same value: there is nothing numeric to approximate.
    expect(ce.box(['RuntimeError', "'neg'"]).N().toString()).toBe(
      'Error("neg")'
    );
  });

  test('a symbolic code stays inert', () => {
    const v = ce.box(['RuntimeError', 'c']).evaluate();
    expect(v.operator).toBe('RuntimeError');
  });

  test('a failing arm does not reach the result type of a literal', () => {
    const g = ce.box([
      'Function',
      ['If', ['Greater', 'x', 0], 'x', ['RuntimeError', "'neg'"]],
      'x',
    ]);
    expect(g.isValid).toBe(true);
    expect(g.type.toString()).toBe('(unknown) -> number');
  });

  test('a user function returns the error value on the failing branch', () => {
    ce.declare('g', {
      value: ce.box([
        'Function',
        ['If', ['Greater', 'x', 0], 'x', ['RuntimeError', "'neg'"]],
        'x',
      ]),
    });
    expect(ce.box(['g', 1]).evaluate().toString()).toBe('1');
    const bad = ce.box(['g', -1]).evaluate();
    expect(isFunction(bad, 'Error')).toBe(true);
    expect(bad.toString()).toBe('Error("neg")');
    // A selecting operator that never demands the failing arm is unaffected.
    expect(
      ce
        .box(['If', 'True', 5, ['RuntimeError', "'x'"]])
        .evaluate()
        .toString()
    ).toBe('5');
  });

  test('arity and operand kind are checked statically, like any operator', () => {
    // These are STATIC diagnostics on the application itself, not runtime
    // error values: the boxed tree is invalid.
    expect(ce.box(['RuntimeError']).isValid).toBe(false);
    expect(ce.box(['RuntimeError', 5]).isValid).toBe(false);
    expect(ce.box(['RuntimeError', "'a'", 'x']).toString()).toContain(
      'unexpected-argument'
    );
  });

  test('as a non-final statement it short-circuits the block', () => {
    expect(
      ce
        .box(['Block', ['RuntimeError', "'stop'"], 42])
        .evaluate()
        .toString()
    ).toBe('Error("stop")');
  });

  test('LaTeX round-trips through the generic function spelling', () => {
    const e = ce.box(['RuntimeError', "'neg'"]);
    expect(e.latex).toBe('\\mathrm{RuntimeError}(\\text{neg})');
    expect(ce.parse(e.latex).json).toEqual(['RuntimeError', "'neg'"]);
  });

  test('the javascript target fails closed on it, naming the operator', () => {
    ce.declare('g', {
      value: ce.box([
        'Function',
        ['If', ['Greater', 'x', 0], 'x', ['RuntimeError', "'neg'"]],
        'x',
      ]),
    });
    const r = compile(ce.box(['g', 'y']), { constantFold: false });
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/RuntimeError/);
    expect(r?.error).toMatch(/Fail closed/);
  });
});
