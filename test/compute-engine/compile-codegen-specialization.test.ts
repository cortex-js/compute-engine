import { ComputeEngine, compile } from '../../src/compute-engine';

function engine() {
  const ce = new ComputeEngine();
  for (const x of ['x', 'y', 'u', 'v', 'z']) ce.declare(x, 'real');
  return ce;
}

describe('code generation from numeric and representation facts', () => {
  test.each(['glsl', 'wgsl'] as const)(
    '%s specializes scalar and vector powers',
    (to) => {
      const ce = engine();
      ce.declare('V', 'vector<real^3>');
      for (const base of [
        ['Add', 'x', 1],
        ['Add', 'V', 1],
      ]) {
        for (const exponent of [2, 3, 4, -2, -3, -4]) {
          const result = compile(ce.expr(['Power', base, exponent]), {
            to,
            constantFold: false,
          });
          expect(result.success).toBe(true);
          const name = `_gpu_pow${Math.abs(exponent)}${base[1] === 'V' ? '_v3' : ''}`;
          expect(result.code).toContain(`${name}(`);
          expect(
            result.code?.match(base[1] === 'V' ? /\bV\b/g : /\bx\b/g)
          ).toHaveLength(1);
          expect(result.preamble).toContain(`${name}(`);
          expect(result.preamble).not.toContain('if (');
          expect(result.preamble).not.toContain('pow(');
          if (exponent < 0) expect(result.code).toContain('1.0 /');
        }
      }
      const large = compile(ce.expr(['Power', ['Add', 'x', 1], 7]), { to });
      expect(large.code).toContain('_gpu_powi(');
      expect(() =>
        compile(ce.expr(['Power', ['List', 1], 2]), {
          to,
          constantFold: false,
          fallback: false,
        })
      ).toThrow(/_gpu_powi/);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s color fast path retains domain fallback and alpha rejection',
    (to) => {
      const ce = engine();
      for (const head of ['Rgb', 'Hsv', 'Hsl']) {
        const result = compile(ce.expr(['AsRgb', [head, 'x', 'y', 'z']]), {
          to,
        });
        expect(result.success).toBe(true);
        expect(result.code).toContain('_gpu_srgb_roundtrip(');
        expect(result.code).not.toContain('_gpu_oklch_to_srgb(');
        expect(result.preamble).toContain('return clamp(rgb,');
        expect(result.preamble).toContain(
          'return _gpu_oklch_to_srgb(_gpu_srgb_to_oklch(rgb));'
        );
        expect(() =>
          compile(ce.expr(['AsRgb', [head, 'x', 'y', 'z', 0.5]]), {
            to,
            fallback: false,
          })
        ).toThrow(/alpha/);
      }
      const oklch = compile(ce.expr(['AsRgb', ['Oklch', 'x', 'y', 'z']]), {
        to,
      });
      expect(oklch.code).toContain('_gpu_oklch_to_srgb(');
      expect(oklch.code).not.toContain('_gpu_srgb_roundtrip(');
      const mapped = compile(ce.expr(['AsRgb', ['Hsv', 'x', 'y', 'z']]), {
        to,
        functions: { Hsv: 'customHsv' },
      });
      expect(mapped.code).not.toContain('_gpu_srgb_roundtrip(');
    }
  );

  test('GLSL color guard covers the HSV witness and retains exceptional-domain fallback', () => {
    const ce = engine();
    const result = compile(
      ce.expr([
        'AsRgb',
        [
          'Hsv',
          45,
          ['Subtract', 1, ['Divide', 'z', 5]],
          ['Add', ['Divide', 'z', 8], 1],
        ],
      ]),
      { to: 'glsl' }
    );
    expect(result.success).toBe(true);

    // Execute the emitted scalar statements and vector builtins, including the
    // actual HSV and linear-sRGB helpers. Only the old round trip is mocked.
    const vec3 = (...values: number[]) =>
      values.length === 1 ? [values[0], values[0], values[0]] : values;
    const clamp = (v: number[], lo: number, hi: number) =>
      v.map((x) => Math.min(hi, Math.max(lo, x)));
    const fallback = jest.fn(() => [123, 456, 789]);
    const dependencies: Record<string, unknown> = {
      vec3,
      clamp,
      all: (v: boolean[]) => v.every(Boolean),
      lessThanEqual: (a: number[], b: number[]) => a.map((x, i) => x <= b[i]),
      greaterThanEqual: (a: number[], b: number[]) => a.map((x, i) => x >= b[i]),
      pow: Math.pow,
      abs: Math.abs,
      mod: (x: number, y: number) => x - y * Math.floor(x / y),
      _gpu_srgb_to_oklch: (rgb: number[]) => rgb,
      _gpu_oklch_to_srgb: fallback,
    };
    for (const [name, parameter] of [
      ['_gpu_srgb_to_linear', 'c'],
      ['_gpu_hsv_to_rgb', 'hsv'],
      ['_gpu_srgb_roundtrip', 'rgb'],
    ]) {
      const body = result.preamble!.match(
        new RegExp(`(?:float|vec3) ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`)
      )?.[1];
      expect(body).toBeDefined();
      const translated = body!
        .replace(/\b(?:float|vec3) (\w+)\s*=/g, 'let $1 =')
        .replace(/\.(x|y|z)\b/g, (_, axis: string) => `[${'xyz'.indexOf(axis)}]`);
      dependencies[name] = new Function(
        ...Object.keys(dependencies),
        `return function(${parameter}) {${translated}};`
      )(...Object.values(dependencies));
    }
    const evaluate = new Function(
      ...Object.keys(dependencies),
      `return function(z) { return ${result.code}; };`
    )(...Object.values(dependencies));
    const hsvToRgb = dependencies._gpu_hsv_to_rgb as (hsv: number[]) => number[];
    const roundtrip = dependencies._gpu_srgb_roundtrip as (
      rgb: number[]
    ) => number[];
    for (let z = -2; z <= 2; z += 0.125) {
      const rgb = hsvToRgb([45, 1 - z / 5, z / 8 + 1]);
      const actual = evaluate(z);
      clamp(rgb, 0, 1).forEach((channel, i) =>
        expect(actual[i]).toBeCloseTo(channel, 12)
      );
    }
    expect(roundtrip([2, 2, 2])).toEqual([1, 1, 1]);
    expect(roundtrip([-0.1, 1, 1])).toEqual([0, 1, 1]);
    expect(fallback).not.toHaveBeenCalled();

    for (const rgb of [
      [-100, 1, 1], // Negative LMS cannot pass through the original cube roots.
      [2.01, 1, 1],
      [Number.MAX_VALUE, 1, 1],
      [Infinity, 1, 1],
      [-Infinity, 1, 1],
      [NaN, 1, 1],
    ]) {
      fallback.mockClear();
      expect(roundtrip(rgb)).toEqual([123, 456, 789]);
      expect(fallback).toHaveBeenCalledWith(rgb);
    }
  });

  test('JS folds the leading degree constants without changing the product order', () => {
    const ce = engine();
    ce.angularUnit = 'deg';
    const expression = ce.parse('u\\cos(360v)');
    const folded = compile(expression);
    const original = compile(expression, { constantFold: false });
    expect(folded.code).toContain('Math.cos(6.283185307179586 * _.v)');
    expect(original.code).toContain('360 * 0.017453292519943295 * _.v');
    for (const v of [-1e200, -2, -0, 0, 0.125, 1, Infinity, NaN])
      expect(folded.run!({ u: 2, v })).toEqual(original.run!({ u: 2, v }));
  });

  test('JS trusts explicit scalar declarations while inferred and mapped inputs keep broadcasting', () => {
    const ce = engine();
    ce.declare('f', '(a: number) -> number');
    ce.assign(
      'f',
      ce.expr(['Function', ['Add', ['Multiply', 2, 'a'], 1], 'a'])
    );
    const typed = compile(ce.expr(['f', 'x']), { constantFold: false });
    expect(typed.code).toBe('_fn_f(_.x)');
    expect(typed.run!({ x: 3 })).toBe(7);
    const inferred = compile(ce.expr(['f', 't']), { constantFold: false });
    expect(inferred.code).toContain('Array.isArray(');
    expect(inferred.run!({ t: [1, 2] })).toEqual([3, 5]);
    const mapped = compile(ce.expr(['f', 'x']), {
      constantFold: false,
      vars: { x: '_.read()' },
    });
    expect(mapped.code).toContain('Array.isArray(');
    expect(mapped.run!({ read: () => [1, 2] })).toEqual([3, 5]);
  });
});
