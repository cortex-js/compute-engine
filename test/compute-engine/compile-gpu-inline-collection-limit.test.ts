/**
 * A constant collection of a few hundred elements compiles on every target.
 * (The existing GLSL compiler declined a collection above 256 elements,
 * `GPU_MAX_INLINE_ELEMENTS`, row 368 of the Tycho ledger; the profile `ir`
 * has no such limit.)
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
const list = (n: number) => ['List', ...Array.from({ length: n }, (_, i) => i)];

/** The decline of a shader compile under `fallback: false`, which declines
 * by throwing; `undefined` when the compile succeeds. */
function decline(
  expr: unknown,
  to: 'glsl'
): { code?: string; message: string } | undefined {
  try {
    const r = compile(ce.box(expr as never), { to, fallback: false });
    if (r.success) return undefined;
    return { code: r.diagnostic?.code, message: r.error ?? '' };
  } catch (e) {
    const err = e as { diagnostic?: { code?: string }; message: string };
    return { code: err.diagnostic?.code, message: err.message };
  }
}

describe('a constant collection of a few hundred elements', () => {
  test('a 256-element list still compiles into the shader', () => {
    expect(decline(['At', list(256), ['Floor', 'x']], 'glsl')).toBeUndefined();
  });

  test('the javascript and interval-js targets keep compiling any length', () => {
    const body = ce.box(['At', list(300), ['Floor', 'x']]);
    expect(compile(body, { to: 'javascript' }).success).toBe(true);
    expect(compile(body, { to: 'interval-js' }).success).toBe(true);
  });
});
