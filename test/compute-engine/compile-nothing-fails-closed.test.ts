/**
 * A bare `Nothing` fails closed on EVERY compile target.
 *
 * `Nothing` is the engine's erasure marker, not a value. A `Nothing` operand
 * of an arithmetic head is dropped at canonicalization (`Add(Nothing, x)` is
 * `x`), but the bare symbol itself can still reach a compiler — an empty
 * `Sequence` canonicalizes to it, there being nothing left to splice. The
 * JavaScript target refused it in its own `var` hook; the shader targets
 * emitted the undefined identifier `Nothing` behind `success: true` (a
 * driver-side compile error), Python the undefined name `Nothing`, and the
 * interval target a `_.Nothing` vars-object read that is `undefined` at run
 * time. The refusal now lives on the symbol route all targets share
 * (`BaseCompiler.compile`), so each target declines with the same message.
 *
 * Found while fixing Tycho item 224 (2026-08-22).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
const TARGETS = ['javascript', 'glsl', 'wgsl', 'python', 'interval-js'] as const;

function compileOn(to: (typeof TARGETS)[number], json: unknown) {
  return compile(ce.box(json as never), { to } as never) as unknown as {
    success: boolean;
    code?: string;
    diagnostic?: { message?: string };
    error?: string;
  };
}

describe('a bare Nothing fails closed on every target', () => {
  test.each(TARGETS)('%s: bare `Nothing` is declined', (to) => {
    const r = compileOn(to, 'Nothing');
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message ?? r.error ?? '').toMatch(
      /erasure marker is not a value/
    );
  });

  // The original witness here was a malformed `Which` with a dangling clause,
  // which used to canonicalize to `Nothing`. It no longer does — an odd
  // operand count is now reported as an `Error` instead of quietly becoming an
  // ordinary value — so the route that still reaches a compiler with the bare
  // symbol is an empty `Sequence`: splicing nothing leaves nothing.
  test.each(TARGETS)(
    '%s: an empty Sequence canonicalizes to Nothing and is declined',
    (to) => {
      const empty = ['Sequence'];
      expect(ce.box(empty as never).symbol).toBe('Nothing');
      const r = compileOn(to, empty);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.message ?? r.error ?? '').toMatch(
        /erasure marker is not a value/
      );
    }
  );

  test('a Nothing arithmetic operand is erased at canonicalization, not by the compiler', () => {
    // The erasure convention: the operand vanishes before any target sees it.
    expect(ce.box(['Add', 'Nothing', 'x']).toString()).toBe('x');
    const r = compileOn('glsl', ['Add', 'Nothing', 'x']);
    expect(r.success).toBe(true);
    expect(r.code).toBe('x');
  });
});
