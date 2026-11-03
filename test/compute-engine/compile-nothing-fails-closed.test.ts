/**
 * A bare `Nothing` fails closed on EVERY compile target.
 *
 * `Nothing` is the value of a statement with no value, not a number. A
 * `Nothing` operand of an arithmetic head is an `incompatible-type` error at
 * canonicalization (`Add(Nothing, x)`), and the bare symbol can still reach
 * a compiler. The JavaScript target refused it in its own `var` hook; the shader targets
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

  test('an empty Sequence stays an empty Sequence, not Nothing', () => {
    expect(ce.box(['Sequence'] as never).json).toEqual(['Sequence']);
  });

  test('a Nothing arithmetic operand is an error at canonicalization, and the compilation declines', () => {
    expect(ce.box(['Add', 'Nothing', 'x']).toString()).toMatch(
      /incompatible-type/
    );
    const r = compileOn('glsl', ['Add', 'Nothing', 'x']);
    expect(r.success).toBe(false);
  });
});
