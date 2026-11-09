/**
 * The shader targets decline a constant collection above the element limit
 * of a shader array constructor (`GPU_MAX_INLINE_ELEMENTS`, 256).
 *
 * A literal `List`, `Tuple` or `PointList` of any length was written into
 * the shader as a constant array constructor (`float[9540](…)`), while a
 * `Range` above the limit was already declined; whether such a shader
 * compiled, and how long the driver took, was left to the GPU driver. The
 * decline is a `capability` diagnostic with the code
 * `inline-collection-too-large`, whose message names the element count and
 * the limit, so a host can ship the collection as a texture (a
 * `storage: sampler2D` input read with `At`) instead. Row 368 of the Tycho
 * ledger.
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

describe('a constant collection above the shader element limit', () => {
  test.each(['glsl'] as const)(
    '%s declines a 300-element literal list indexed at run time',
    (to) => {
      const d = decline(['At', list(300), ['Floor', 'x']], to);
      expect(d?.code).toBe('outside-fragment');
      expect(d?.message).toContain('`list<real, 300>`');
      expect(d?.message).toContain('array limit');
    }
  );

  test('a 256-element list still compiles into the shader', () => {
    expect(decline(['At', list(256), ['Floor', 'x']], 'glsl')).toBeUndefined();
  });

  test('a list of points above the limit is declined on the same code', () => {
    const points = [
      'List',
      ...Array.from({ length: 300 }, (_, i) => ['Tuple', i, i + 1]),
    ];
    const d = decline(points, 'glsl');
    expect(d?.code).toBe('outside-fragment');
  });

  test('a column-vector Matrix above the limit is declined on the same code', () => {
    const matrix = [
      'Matrix',
      ['List', ...Array.from({ length: 300 }, (_, i) => ['List', i])],
    ];
    const d = decline(matrix, 'glsl');
    expect(d?.code).toBe('outside-fragment');
    expect(d?.message).toContain('`Matrix`');
  });

  test('the decline names the operator the literal was written with', () => {
    const tuple = ['Tuple', ...Array.from({ length: 300 }, (_, i) => i)];
    // The fragment names the literal as a point, not by its head.
    expect(decline(tuple, 'glsl')?.message).toContain('The point `(0, 1, 2');
  });

  test('a Range above the limit is declined on the same code', () => {
    const d = decline(['Range', 1, 300], 'glsl');
    expect(d?.code).toBe('outside-fragment');
    expect(d?.message).toContain('`Range`');
    expect(d?.message).toContain('only as the index set');
  });

  test('the default compile reports the decline as a result, not a throw', () => {
    const r = compile(ce.box(['At', list(300), ['Floor', 'x']]), {
      to: 'glsl',
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-fragment');
    expect(r.diagnostic?.kind).toBe('capability');
  });

  test('the javascript and interval-js targets keep compiling any length', () => {
    const body = ce.box(['At', list(300), ['Floor', 'x']]);
    expect(compile(body, { to: 'javascript' }).success).toBe(true);
    expect(compile(body, { to: 'interval-js' }).success).toBe(true);
  });
});
