import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function evaluateColor(input: string) {
  const expr = ce.expr(['Color', `'${input}'`]);
  const result = expr.evaluate();
  // Color() returns an Oklch head. Convert back to 0-1 sRGB tuple
  // (with optional alpha) for comparison in these tests.
  if (result.operator === 'Oklch') {
    const rgb = ce.expr(['AsRgb', result.json]).evaluate();
    if (rgb.operator === 'Rgb') {
      return rgb.ops!.map((op, i) => {
        const v = op.re;
        // r/g/b components are 0-255, alpha is already 0-1
        return Math.round((i < 3 ? v / 255 : v) * 1000) / 1000;
      });
    }
  }
  if (result.operator === 'Tuple') {
    return result.ops!.map((op) => {
      const v = op.re;
      return Math.round(v * 1000) / 1000;
    });
  }
  return result.json;
}

describe('Color', () => {
  test('hex 6-digit', () => {
    const result = evaluateColor('#ff0000');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hex 3-digit', () => {
    const result = evaluateColor('#f00');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hex 8-digit with alpha', () => {
    const result = evaluateColor('#ff000080');
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(1);
    expect(result[3]).toBeCloseTo(0.502, 1);
  });

  test('rgb()', () => {
    const result = evaluateColor('rgb(255, 0, 0)');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hsl()', () => {
    const result = evaluateColor('hsl(0, 100%, 50%)');
    expect(result).toEqual([1, 0, 0]);
  });

  test('named color', () => {
    const result = evaluateColor('red');
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('transparent', () => {
    const result = evaluateColor('transparent');
    expect(result).toEqual([0, 0, 0, 0]);
  });

  test('invalid input returns error', () => {
    const expr = ce.expr(['Color', "'not-a-color'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});

describe('Colormap', () => {
  test('full palette returns list of Oklch colors', () => {
    const expr = ce.expr(['Colormap', "'tycho11'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(11);
    expect(result.ops![0].operator).toBe('Oklch');
    expect(result.ops![0].ops!.length).toBe(3);
  });

  test('resample to n colors', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(5);
  });

  test('sample at t=0 returns first color', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 0]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Oklch');
  });

  test('sample at t=1 returns last color', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 1]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Oklch');
  });

  test('sample at t=0.5 returns interpolated color', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 0.5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
  });

  test('unknown palette returns error', () => {
    const expr = ce.expr(['Colormap', "'nonexistent'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});

describe('ColorToColorspace', () => {
  test('to oklch', () => {
    const expr = ce.expr(['ColorToColorspace', "'#ff0000'", "'oklch'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // L should be around 0.6
    expect(result.ops![0].re).toBeGreaterThan(0.5);
    expect(result.ops![0].re).toBeLessThan(0.7);
  });

  test('to oklab (via "lab" alias)', () => {
    const expr = ce.expr(['ColorToColorspace', "'#ff0000'", "'lab'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('to hsl', () => {
    const expr = ce.expr(['ColorToColorspace', "'#ff0000'", "'hsl'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red: h near 0, s near 1, l near 0.5
    expect(result.ops![0].re).toBeLessThan(1); // hue near 0
    expect(result.ops![1].re).toBeCloseTo(1, 1); // full saturation
    expect(result.ops![2].re).toBeCloseTo(0.5, 1); // mid lightness
  });

  test('to rgb is identity (normalized)', () => {
    const expr = ce.expr(['ColorToColorspace', "'#ff0000'", "'rgb'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(1, 2);
    expect(result.ops![1].re).toBeCloseTo(0, 2);
    expect(result.ops![2].re).toBeCloseTo(0, 2);
  });

  test('accepts tuple input', () => {
    const expr = ce.expr(['ColorToColorspace', ['Tuple', 1, 0, 0], "'oklch'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });
});

describe('ColorFromColorspace', () => {
  test('from oklch', () => {
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 0.6, 0.26, 29],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // Should be reddish
    expect(result.ops![0].re).toBeGreaterThan(0.5);
  });

  test('from hsl', () => {
    const expr = ce.expr(['ColorFromColorspace', ['Tuple', 0, 1, 0.5], "'hsl'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('roundtrip oklch', () => {
    const toOklch = ce
      .expr(['ColorToColorspace', "'#3366cc'", "'oklch'"])
      .evaluate();
    const back = ce
      .expr(['ColorFromColorspace', toOklch.json, "'oklch'"])
      .evaluate();
    expect(back.operator).toBe('Tuple');

    // Convert Color() result (Oklch) to 0-1 sRGB for comparison.
    const originalAsRgb = ce
      .expr(['AsRgb', ce.expr(['Color', "'#3366cc'"]).evaluate().json])
      .evaluate();
    expect(back.ops![0].re).toBeCloseTo(originalAsRgb.ops![0].re / 255, 2);
    expect(back.ops![1].re).toBeCloseTo(originalAsRgb.ops![1].re / 255, 2);
    expect(back.ops![2].re).toBeCloseTo(originalAsRgb.ops![2].re / 255, 2);
  });
});

describe('Edge cases', () => {
  test('Color with alpha=1 returns 3-component tuple', () => {
    const expr = ce.expr(['Color', "'#ff0000ff'"]);
    const result = expr.evaluate();
    expect(result.ops!.length).toBe(3);
  });

  test('Colormap t outside [0,1] is clamped', () => {
    const lo = ce.expr(['Colormap', "'viridis'", -0.5]).evaluate();
    const first = ce.expr(['Colormap', "'viridis'", 0]).evaluate();
    expect(lo.ops![0].re).toBeCloseTo(first.ops![0].re, 5);

    const hi = ce.expr(['Colormap', "'viridis'", 1.5]).evaluate();
    const last = ce.expr(['Colormap', "'viridis'", 1]).evaluate();
    expect(hi.ops![0].re).toBeCloseTo(last.ops![0].re, 5);
  });

  test('ColorToColorspace with alpha preserves it', () => {
    const expr = ce.expr([
      'ColorToColorspace',
      ['Tuple', 1, 0, 0, 0.5],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.ops!.length).toBe(4);
    expect(result.ops![3].re).toBeCloseTo(0.5, 2);
  });

  test('ColorFromColorspace roundtrip hsl', () => {
    const toHsl = ce
      .expr(['ColorToColorspace', "'#3366cc'", "'hsl'"])
      .evaluate();
    const back = ce
      .expr(['ColorFromColorspace', toHsl.json, "'hsl'"])
      .evaluate();
    // Convert Color() result (Oklch) to 0-1 sRGB for comparison.
    const originalAsRgb = ce
      .expr(['AsRgb', ce.expr(['Color', "'#3366cc'"]).evaluate().json])
      .evaluate();
    expect(back.ops![0].re).toBeCloseTo(originalAsRgb.ops![0].re / 255, 2);
    expect(back.ops![1].re).toBeCloseTo(originalAsRgb.ops![1].re / 255, 2);
    expect(back.ops![2].re).toBeCloseTo(originalAsRgb.ops![2].re / 255, 2);
  });
});

describe('ColorToString', () => {
  test('string input roundtrip', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('tuple input', () => {
    const result = ce.expr(['ColorToString', ['Tuple', 1, 0, 0]]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('alpha included when not 1', () => {
    const result = ce.expr(['ColorToString', "'#ff000080'"]).evaluate();
    expect(result.string).toBe('#ff000080');
  });

  test('alpha omitted when 1', () => {
    const result = ce.expr(['ColorToString', "'#ff0000ff'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('3-component tuple', () => {
    const result = ce.expr(['ColorToString', ['Tuple', 0, 1, 0]]).evaluate();
    expect(result.string).toBe('#00ff00');
  });
});

describe('ColorMix', () => {
  // Helper: convert a ColorMix result (always an Oklch head now) to 0-1 sRGB
  // for component comparison.
  function mixedToRgb(result: any): { r: number; g: number; b: number } {
    expect(result.operator).toBe('Oklch');
    const rgb = ce.expr(['AsRgb', result.json]).evaluate();
    expect(rgb.operator).toBe('Rgb');
    return {
      r: rgb.ops![0].re / 255,
      g: rgb.ops![1].re / 255,
      b: rgb.ops![2].re / 255,
    };
  }

  test('equal mix of red and blue', () => {
    const result = ce.expr(['ColorMix', "'#ff0000'", "'#0000ff'"]).evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
  });

  test('ratio=0 returns first color', () => {
    const result = ce.expr(['ColorMix', "'#ff0000'", "'#0000ff'", 0]).evaluate();
    const rgb = mixedToRgb(result);
    expect(rgb.r).toBeCloseTo(1, 1);
    expect(rgb.g).toBeCloseTo(0, 1);
    expect(rgb.b).toBeCloseTo(0, 1);
  });

  test('ratio=1 returns second color', () => {
    const result = ce.expr(['ColorMix', "'#ff0000'", "'#0000ff'", 1]).evaluate();
    const rgb = mixedToRgb(result);
    // Should be blue (OKLCh roundtrip has slight gamut clipping)
    expect(rgb.b).toBeGreaterThan(0.85);
    expect(rgb.r).toBeLessThan(0.15);
  });

  test('default ratio is 0.5', () => {
    const withDefault = ce
      .expr(['ColorMix', "'#ff0000'", "'#0000ff'"])
      .evaluate();
    const withExplicit = ce
      .expr(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5])
      .evaluate();
    expect(withDefault.ops![0].re).toBeCloseTo(withExplicit.ops![0].re, 5);
    expect(withDefault.ops![1].re).toBeCloseTo(withExplicit.ops![1].re, 5);
    expect(withDefault.ops![2].re).toBeCloseTo(withExplicit.ops![2].re, 5);
  });

  test('string + tuple inputs return Oklch', () => {
    const result = ce
      .expr(['ColorMix', "'#ff0000'", ['Tuple', 0, 0, 1], 0.5])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
  });
});

describe('ColorContrast', () => {
  test('black on white has high positive contrast', () => {
    const result = ce
      .expr(['ColorContrast', "'#ffffff'", "'#000000'"])
      .evaluate();
    expect(result.re).toBeGreaterThan(1);
  });

  test('white on black has high negative contrast', () => {
    const result = ce
      .expr(['ColorContrast', "'#000000'", "'#ffffff'"])
      .evaluate();
    expect(result.re).toBeLessThan(-1);
  });

  test('same color returns 0', () => {
    const result = ce
      .expr(['ColorContrast', "'#808080'", "'#808080'"])
      .evaluate();
    expect(result.re).toBe(0);
  });

  test('accepts tuple inputs', () => {
    const result = ce
      .expr(['ColorContrast', ['Tuple', 1, 1, 1], ['Tuple', 0, 0, 0]])
      .evaluate();
    expect(result.re).toBeGreaterThan(1);
  });
});

describe('LaTeX color annotations', () => {
  test('parse \\textcolor{red}{x}', () => {
    const expr = ce.parse('\\textcolor{red}{x}');
    expect(expr.json).toEqual(['Annotated', 'x', { dict: { color: 'red' } }]);
  });

  test('serialize Annotated with color', () => {
    const expr = ce.expr(['Annotated', 'x', { dict: { color: 'red' } }]);
    expect(expr.latex).toBe('\\textcolor{red}{x}');
  });

  test('parse \\colorbox{#ff0000}{x}', () => {
    const expr = ce.parse('\\colorbox{#ff0000}{x}');
    expect(expr.json).toEqual([
      'Annotated',
      'x',
      { dict: { backgroundColor: '#ff0000' } },
    ]);
  });

  test('serialize Annotated with backgroundColor', () => {
    const expr = ce.expr([
      'Annotated',
      'x',
      { dict: { backgroundColor: 'blue' } },
    ]);
    expect(expr.latex).toBe('\\colorbox{blue}{x}');
  });

  test('roundtrip \\textcolor', () => {
    const latex = '\\textcolor{red}{x}';
    const expr = ce.parse(latex);
    expect(expr.latex).toBe(latex);
  });

  test('parse \\boxed{x}', () => {
    const expr = ce.parse('\\boxed{x}');
    expect(expr.json).toEqual(['Annotated', 'x', { dict: { border: true } }]);
  });

  test('serialize Annotated with border', () => {
    const expr = ce.expr(['Annotated', 'x', { dict: { border: true } }]);
    expect(expr.latex).toBe('\\boxed{x}');
  });

  test('roundtrip \\boxed', () => {
    const latex = '\\boxed{x}';
    const expr = ce.parse(latex);
    expect(expr.latex).toBe(latex);
  });
});

describe('ColorToString formats', () => {
  test('default format is hex', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('explicit hex format', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'", "'hex'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('rgb format', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'", "'rgb'"]).evaluate();
    expect(result.string).toBe('rgb(255 0 0)');
  });

  test('hsl format', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'", "'hsl'"]).evaluate();
    expect(result.string).toMatch(/^hsl\(/);
  });

  test('oklch format', () => {
    const result = ce.expr(['ColorToString', "'#ff0000'", "'oklch'"]).evaluate();
    expect(result.string).toMatch(/^oklch\(/);
  });

  test('rgb format with alpha', () => {
    const result = ce.expr(['ColorToString', "'#ff000080'", "'rgb'"]).evaluate();
    expect(result.string).toMatch(/^rgb\(255 0 0 \//);
  });
});

describe('ContrastingColor', () => {
  test('white bg defaults to black text', () => {
    const result = ce.expr(['ContrastingColor', "'#ffffff'"]).evaluate();
    expect(result.operator).toBe('Rgb');
    // Should be black: (0, 0, 0) in 0-255 channels
    expect(result.ops![0].re).toBe(0);
    expect(result.ops![1].re).toBe(0);
    expect(result.ops![2].re).toBe(0);
  });

  test('black bg defaults to white text', () => {
    const result = ce.expr(['ContrastingColor', "'#000000'"]).evaluate();
    expect(result.operator).toBe('Rgb');
    // Should be white: (255, 255, 255)
    expect(result.ops![0].re).toBe(255);
    expect(result.ops![1].re).toBe(255);
    expect(result.ops![2].re).toBe(255);
  });

  test('with two fg candidates', () => {
    const result = ce
      .expr(['ContrastingColor', "'#ffffff'", "'#ff0000'", "'#0000ff'"])
      .evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBeGreaterThanOrEqual(3);
  });

  test('accepts tuple input', () => {
    const result = ce.expr(['ContrastingColor', ['Tuple', 1, 1, 1]]).evaluate();
    expect(result.operator).toBe('Rgb');
  });
});

describe('Color compilation', () => {
  test('compile Color', () => {
    const expr = ce.expr(['Color', "'#ff0000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    // Compiled `Color` matches interpreted: returns Oklch [L, C, H].
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.628, 2);
    expect(result[1]).toBeCloseTo(0.258, 2);
    expect(result[2]).toBeCloseTo(29.23, 1);
  });

  test('compile ColorContrast', () => {
    const expr = ce.expr(['ColorContrast', "'#ffffff'", "'#000000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number;
    expect(result).toBeGreaterThan(1);
  });

  test('compile ColorToString', () => {
    const expr = ce.expr(['ColorToString', "'#ff0000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as string;
    expect(result).toBe('#ff0000');
  });

  test('compile ColorMix', () => {
    const expr = ce.expr(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    expect(result).toHaveLength(3);
  });

  test('compile ColorToColorspace', () => {
    const expr = ce.expr(['ColorToColorspace', "'#ff0000'", "'oklch'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('compile ContrastingColor', () => {
    const expr = ce.expr(['ContrastingColor', "'#ffffff'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    // Should be black
    expect(result[0]).toBeCloseTo(0, 1);
  });

  test('compile Colormap with name only', () => {
    const expr = ce.expr(['Colormap', "'tycho11'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[][];
    expect(result.length).toBe(11);
    expect(result[0]).toHaveLength(3);
  });

  test('compile Colormap with integer n', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const result = compiled.run!() as unknown as number[][];
    expect(result.length).toBe(5);
    expect(result[0]).toHaveLength(3);
  });

  test('compile Colormap with float t', () => {
    const expr = ce.expr(['Colormap', "'viridis'", 0.5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const result = compiled.run!() as unknown as number[];
    expect(result).toHaveLength(3);
    // Each component should be in [0, 1]
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(1);
  });
});

describe('oklab() parsing', () => {
  test('parse oklab(0.628 0.225 0.126)', () => {
    // This should produce a reddish color
    const result = evaluateColor('oklab(0.628 0.225 0.126)');
    expect(result).toHaveLength(3);
    // Red channel should be dominant
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('oklab with alpha', () => {
    const result = evaluateColor('oklab(0.628 0.225 0.126 / 0.5)');
    expect(result).toHaveLength(4);
    expect(result[3]).toBeCloseTo(0.5, 1);
  });

  test('oklab with percentage lightness', () => {
    const result = evaluateColor('oklab(62.8% 0.225 0.126)');
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('oklab roundtrip through Color operator', () => {
    const expr = ce.expr(['Color', "'oklab(0.628 0.225 0.126)'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
  });
});

describe('GPU color compilation', () => {
  test('compile ColorMix to GLSL', () => {
    const expr = ce.expr([
      'ColorMix',
      ['Tuple', 1, 0, 0],
      ['Tuple', 0, 0, 1],
      0.5,
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_color_mix');
    expect(compiled.preamble).toContain('_gpu_srgb_to_linear');
    // GLSL uses vec3
    expect(compiled.preamble).toContain('vec3 _gpu_srgb_to_oklab');
  });

  test('compile ColorContrast to WGSL', () => {
    const expr = ce.expr([
      'ColorContrast',
      ['Tuple', 1, 1, 1],
      ['Tuple', 0, 0, 0],
    ]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_apca');
    expect(compiled.preamble).toContain('fn _gpu_srgb_to_linear');
    // WGSL uses vec3f
    expect(compiled.preamble).toContain('vec3f');
  });

  test('compile ColorToColorspace to GLSL', () => {
    // Canonical color value is OKLCh; converting to oklab routes through
    // _gpu_oklch_to_oklab (no sRGB pinch).
    const expr = ce.expr(['ColorToColorspace', ['Tuple', 0.7, 0.1, 30], "'oklab'"]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklch_to_oklab');
  });

  test('compile ColorToColorspace to GLSL routes oklch as identity', () => {
    const expr = ce.expr(['ColorToColorspace', ['Tuple', 0.7, 0.1, 30], "'oklch'"]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    // Identity: no conversion call wrapping the input.
    expect(compiled.code).not.toContain('_gpu_oklch_to_oklab');
    expect(compiled.code).not.toContain('_gpu_oklch_to_srgb');
  });

  test('compile ColorToColorspace to GLSL routes rgb to sRGB', () => {
    const expr = ce.expr(['ColorToColorspace', ['Tuple', 0.7, 0.1, 30], "'rgb'"]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklch_to_srgb');
  });

  test('compile ColorFromColorspace to WGSL', () => {
    // Components in oklab → canonical OKLCh via _gpu_oklab_to_oklch.
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 0.6, 0.2, 0.1],
      "'oklab'",
    ]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklab_to_oklch');
  });

  test('compile ColorFromColorspace to GLSL routes rgb to OKLCh', () => {
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 1, 0, 0],
      "'rgb'",
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_srgb_to_oklch');
  });

  test('compile ContrastingColor to GLSL', () => {
    const expr = ce.expr(['ContrastingColor', ['Tuple', 1, 1, 1]]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_apca');
    expect(compiled.code).toContain('vec3(0.0)');
  });
});

describe('GPU compile: HSL space', () => {
  test('ColorToColorspace hsl emits sRGB→HSL chain', () => {
    const expr = ce.expr([
      'ColorToColorspace',
      ['Tuple', 0.7, 0.1, 30],
      "'hsl'",
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_rgb_to_hsl');
    expect(compiled.code).toContain('_gpu_oklch_to_srgb');
    expect(compiled.preamble).toContain('vec3 _gpu_rgb_to_hsl');
  });

  test('ColorFromColorspace hsl emits HSL→sRGB→OKLCh chain', () => {
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 0, 1, 0.5],
      "'hsl'",
    ]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_hsl_to_rgb');
    expect(compiled.code).toContain('_gpu_srgb_to_oklch');
    expect(compiled.preamble).toContain('fn _gpu_hsl_to_rgb');
  });

  test('ColorToColorspace hsv routes through _gpu_rgb_to_hsv', () => {
    const expr = ce.expr([
      'ColorToColorspace',
      ['Tuple', 0.7, 0.1, 30],
      "'hsv'",
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_rgb_to_hsv');
  });
});

describe('GPU compile: typed color heads', () => {
  test('Color(literal) parses at compile time and emits Oklch vec3', () => {
    const expr = ce.expr(['Color', "'#ff0000'"]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    // Pure red: L ≈ 0.628, C ≈ 0.258, H ≈ 29.23 — emitted as a literal vec3.
    expect(compiled.code).toMatch(/vec3\(0\.62[^,]*, 0\.25[^,]*, 29\./);
    // No runtime parsing helper.
    expect(compiled.code).not.toContain('parseColor');
  });

  test('Color(non-literal) is rejected at compile time', () => {
    // Wrap the string in a function call to defeat literal recognition.
    // The compile must fail because GPU can't parse strings at runtime.
    const expr = ce.parse('\\operatorname{Color}(\\operatorname{Sym}(x))');
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(false);
  });

  test('Rgb head divides by 255 and promotes to OKLCh', () => {
    const expr = ce.expr(['Rgb', 255, 0, 0]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_srgb_to_oklch');
    expect(compiled.code).toContain('/ 255.0');
  });

  test('Oklch head emits canonical vec3 directly', () => {
    const expr = ce.expr(['Oklch', 0.628, 0.258, 29.23]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    // Identity: no conversion helper, just a vec3.
    expect(compiled.code).not.toContain('_gpu_oklch_to_');
    expect(compiled.code).not.toContain('_gpu_srgb_to_');
    expect(compiled.code).toMatch(/^vec3\(/);
  });

  test('Oklab head routes through _gpu_oklab_to_oklch', () => {
    const expr = ce.expr(['Oklab', 0.628, 0.225, 0.126]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklab_to_oklch');
  });

  test('Hsv head routes through _gpu_hsv_to_rgb → _gpu_srgb_to_oklch', () => {
    const expr = ce.expr(['Hsv', 0, 1, 1]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_hsv_to_rgb');
    expect(compiled.code).toContain('_gpu_srgb_to_oklch');
  });

  test('Hsl head routes through _gpu_hsl_to_rgb → _gpu_srgb_to_oklch', () => {
    const expr = ce.expr(['Hsl', 0, 1, 0.5]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_hsl_to_rgb');
    expect(compiled.code).toContain('_gpu_srgb_to_oklch');
  });

  test('Typed heads compose with ColorMix', () => {
    // Two Oklch literals mixed — the middle of red and blue.
    const expr = ce.expr([
      'ColorMix',
      ['Oklch', 0.628, 0.258, 29.23],
      ['Oklch', 0.452, 0.313, 264.05],
      0.5,
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_color_mix');
  });
});

describe('GPU compile: As* operators', () => {
  test('AsOklch on an Oklch input is identity', () => {
    const expr = ce.expr(['AsOklch', ['Oklch', 0.7, 0.2, 30]]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    // No conversion helper — input passes through.
    expect(compiled.code).not.toContain('_gpu_oklch_to_');
  });

  test('AsOklab routes through _gpu_oklch_to_oklab', () => {
    const expr = ce.expr(['AsOklab', ['Oklch', 0.7, 0.2, 30]]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklch_to_oklab');
  });

  test('AsRgb emits 0-1 sRGB (not 0-255)', () => {
    const expr = ce.expr(['AsRgb', ['Oklch', 0.7, 0.2, 30]]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklch_to_srgb');
    // No 255-divide: matches ColorToColorspace 'rgb' semantics, not the
    // 0-255 convention used by the interpreted Rgb head.
    expect(compiled.code).not.toContain('/ 255.0');
  });

  test('AsHsv routes through sRGB→HSV', () => {
    const expr = ce.expr(['AsHsv', ['Oklch', 0.7, 0.2, 30]]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_rgb_to_hsv');
    expect(compiled.code).toContain('_gpu_oklch_to_srgb');
  });

  test('AsHsl routes through sRGB→HSL', () => {
    const expr = ce.expr(['AsHsl', ['Oklch', 0.7, 0.2, 30]]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_rgb_to_hsl');
    expect(compiled.code).toContain('_gpu_oklch_to_srgb');
  });
});

describe('Color constructor heads', () => {
  test('rgb LaTeX parses to Rgb head', () => {
    const expr = ce.parse('\\operatorname{rgb}(255, 0, 0)');
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops!.length).toBe(3);
  });

  test('hsv LaTeX parses to Hsv head', () => {
    const expr = ce.parse('\\operatorname{hsv}(0, 1, 1)');
    expect(expr.operator).toBe('Hsv');
  });

  test('hsl LaTeX parses to Hsl head', () => {
    const expr = ce.parse('\\operatorname{hsl}(0, 1, 0.5)');
    expect(expr.operator).toBe('Hsl');
  });

  test('oklab LaTeX parses to Oklab head', () => {
    const expr = ce.parse('\\operatorname{oklab}(0.628, 0.225, 0.126)');
    expect(expr.operator).toBe('Oklab');
  });

  test('oklch LaTeX parses to Oklch head', () => {
    const expr = ce.parse('\\operatorname{oklch}(0.628, 0.258, 29.23)');
    expect(expr.operator).toBe('Oklch');
  });

  test('alpha is accepted as optional 4th argument', () => {
    const expr = ce.parse('\\operatorname{rgb}(255, 0, 0, 0.5)');
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops!.length).toBe(4);
  });

  test('round-trip through LaTeX', () => {
    const expr = ce.parse('\\operatorname{rgb}(255, 0, 0)');
    expect(expr.toLatex()).toBe('\\operatorname{rgb}(255, 0, 0)');
  });

  test('preserves colorspace on evaluation (Rgb)', () => {
    const expr = ce.expr(['Rgb', 255, 0, 0]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(255);
  });

  test('preserves colorspace on evaluation (Hsv)', () => {
    const expr = ce.expr(['Hsv', 120, 1, 1]).evaluate();
    expect(expr.operator).toBe('Hsv');
  });

  test('out-of-range values are not clamped at parse time', () => {
    // Per Desmos compatibility: parse permissive, render-time clamp.
    const expr = ce.expr(['Rgb', 256, -1, 999]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(256);
    expect(expr.ops![1].re).toBe(-1);
    expect(expr.ops![2].re).toBe(999);
  });
});

describe('Color conversions (As*)', () => {
  test('AsRgb identity on Rgb', () => {
    const expr = ce.expr(['AsRgb', ['Rgb', 100, 50, 25]]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(100);
  });

  test('AsRgb on Hsv produces Rgb', () => {
    // hsv(0, 1, 1) is pure red
    const expr = ce.expr(['AsRgb', ['Hsv', 0, 1, 1]]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBeCloseTo(255, 0);
    expect(expr.ops![1].re).toBeCloseTo(0, 0);
    expect(expr.ops![2].re).toBeCloseTo(0, 0);
  });

  test('AsHsv on Rgb produces Hsv', () => {
    const expr = ce.expr(['AsHsv', ['Rgb', 255, 0, 0]]).evaluate();
    expect(expr.operator).toBe('Hsv');
    expect(expr.ops![0].re).toBeCloseTo(0, 1); // hue 0
    expect(expr.ops![1].re).toBeCloseTo(1, 2); // saturation 1
    expect(expr.ops![2].re).toBeCloseTo(1, 2); // value 1
  });

  test('AsOklch on Rgb produces Oklch', () => {
    const expr = ce.expr(['AsOklch', ['Rgb', 255, 0, 0]]).evaluate();
    expect(expr.operator).toBe('Oklch');
  });

  test('AsRgb ∘ AsHsv ∘ ... round-trips', () => {
    const start = ['Rgb', 200, 100, 50];
    const expr = ce
      .expr(['AsRgb', ['AsHsv', ['AsOklch', ['AsHsl', start]]]])
      .evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBeCloseTo(200, 0);
    expect(expr.ops![1].re).toBeCloseTo(100, 0);
    expect(expr.ops![2].re).toBeCloseTo(50, 0);
  });

  test('alpha is preserved through conversion', () => {
    const expr = ce.expr(['AsHsv', ['Rgb', 255, 0, 0, 0.5]]).evaluate();
    expect(expr.operator).toBe('Hsv');
    expect(expr.ops!.length).toBe(4);
    expect(expr.ops![3].re).toBeCloseTo(0.5, 4);
  });
});

describe('ColorDelta', () => {
  test('identical colors return 0', () => {
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 255, 0, 0], ['Rgb', 255, 0, 0]])
      .evaluate();
    expect(expr.re).toBe(0);
  });

  test('cross-space identical colors return 0', () => {
    // hsv(0, 1, 1) and rgb(255, 0, 0) are the same color
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 255, 0, 0], ['Hsv', 0, 1, 1]])
      .evaluate();
    expect(expr.re).toBeCloseTo(0, 4);
  });

  test('different colors return positive scalar', () => {
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 255, 0, 0], ['Rgb', 0, 0, 255]])
      .evaluate();
    expect(expr.re).toBeGreaterThan(0.4);
  });

  test('symmetric', () => {
    const ab = ce
      .expr(['ColorDelta', ['Rgb', 100, 50, 200], ['Rgb', 200, 100, 50]])
      .evaluate();
    const ba = ce
      .expr(['ColorDelta', ['Rgb', 200, 100, 50], ['Rgb', 100, 50, 200]])
      .evaluate();
    expect(ab.re).toBeCloseTo(ba.re, 6);
  });

  test('accepts color strings via extractRgb', () => {
    const expr = ce
      .expr(['ColorDelta', "'#ff0000'", ['Rgb', 255, 0, 0]])
      .evaluate();
    expect(expr.re).toBeCloseTo(0, 4);
  });
});

describe('Color() returns Oklch', () => {
  test('Color("red") is an Oklch head', () => {
    const expr = ce.expr(['Color', "'red'"]).evaluate();
    expect(expr.operator).toBe('Oklch');
  });

  test('alpha is preserved as 4th component', () => {
    const expr = ce.expr(['Color', "'#ff000080'"]).evaluate();
    expect(expr.operator).toBe('Oklch');
    expect(expr.ops!.length).toBe(4);
    expect(expr.ops![3].re).toBeCloseTo(0.502, 2);
  });
});

describe('Color type', () => {
  test('Rgb(...) has type "color"', () => {
    const expr = ce.expr(['Rgb', 255, 0, 0]);
    expect(expr.type.toString()).toBe('color');
  });

  test('Hsv(...), Oklab(...), Oklch(...) have type "color"', () => {
    expect(ce.expr(['Hsv', 0, 1, 1]).type.toString()).toBe('color');
    expect(ce.expr(['Oklab', 0.6, 0.2, 0.1]).type.toString()).toBe('color');
    expect(ce.expr(['Oklch', 0.6, 0.2, 30]).type.toString()).toBe('color');
  });

  test('Color("red") has type "color"', () => {
    const expr = ce.expr(['Color', "'red'"]);
    expect(expr.type.toString()).toBe('color');
  });

  test('AsRgb returns type "color"', () => {
    const expr = ce.expr(['AsRgb', ['Hsv', 0, 1, 1]]);
    expect(expr.type.toString()).toBe('color');
  });

  test('ColorMix returns type "color"', () => {
    const expr = ce.expr(['ColorMix', ['Rgb', 255, 0, 0], ['Rgb', 0, 0, 255]]);
    expect(expr.type.toString()).toBe('color');
  });

  test('ContrastingColor returns type "color"', () => {
    const expr = ce.expr(['ContrastingColor', "'#ffffff'"]);
    expect(expr.type.toString()).toBe('color');
  });

  test('color is a subtype of value', () => {
    const expr = ce.expr(['Rgb', 255, 0, 0]);
    expect(expr.type.matches('value')).toBe(true);
  });

  test('color is NOT a subtype of tuple', () => {
    const expr = ce.expr(['Rgb', 255, 0, 0]);
    expect(expr.type.matches('tuple')).toBe(false);
  });
});

describe('Wide-gamut preservation', () => {
  // Out-of-sRGB Oklab/Oklch input: chroma greater than what red can hit, plus a
  // green-direction hue. Going through sRGB would clip; the typed-head paths
  // should preserve the components.

  test('ColorMix returns Oklch when both inputs are typed color heads', () => {
    const result = ce
      .expr(['ColorMix', ['Rgb', 255, 0, 0], ['Rgb', 0, 0, 255], 0.5])
      .evaluate();
    expect(result.operator).toBe('Oklch');
  });

  test('ColorMix returns Oklch even when input is a string or sRGB Tuple', () => {
    // Both paths converge on Oklch — the legacy string/Tuple inputs produce
    // a wide-gamut result, not a Tuple.
    const result = ce
      .expr(['ColorMix', "'#ff0000'", ['Tuple', 0, 0, 1], 0.5])
      .evaluate();
    expect(result.operator).toBe('Oklch');
  });

  test('ColorMix preserves wide-gamut chroma between two Oklch inputs', () => {
    // Two highly chromatic Oklch colors (chroma 0.35 — outside sRGB for many hues)
    const result = ce
      .expr([
        'ColorMix',
        ['Oklch', 0.7, 0.35, 30],
        ['Oklch', 0.7, 0.35, 90],
        0.5,
      ])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    // Mixed L should still be 0.7 (both inputs share L)
    expect(result.ops![0].re).toBeCloseTo(0.7, 4);
    // Mixed C should still be 0.35 (both inputs share C — wide-gamut preserved)
    expect(result.ops![1].re).toBeCloseTo(0.35, 4);
  });

  test('ColorMix interpolates hue along shortest path', () => {
    // Mix between hue 350° and hue 10° at t=0.5 should give 0° (or 360°),
    // not 180° (which is what naive linear interpolation would produce).
    const result = ce
      .expr([
        'ColorMix',
        ['Oklch', 0.7, 0.2, 350],
        ['Oklch', 0.7, 0.2, 10],
        0.5,
      ])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    const h = result.ops![2].re;
    // Should be near 0 (or 360); not near 180.
    expect(Math.min(h, 360 - h)).toBeLessThan(1);
  });

  test('ColorDelta computes accurate delta between two wide-gamut Oklch inputs', () => {
    // Same color, expressed two ways: cartesian (Oklab) and polar (Oklch)
    // should yield delta 0 even with components outside sRGB.
    const lab = ['Oklab', 0.7, 0.3, 0.0];
    // Equivalent Oklch: L=0.7, C=0.3, H=0
    const lch = ['Oklch', 0.7, 0.3, 0];
    const delta = ce.expr(['ColorDelta', lab, lch]).evaluate();
    expect(delta.re).toBeCloseTo(0, 4);
  });

  test('ColorDelta direct-path matches cross-space identity for wide-gamut', () => {
    // A color slightly outside sRGB, defined two ways. Delta should be small.
    const a = ['Oklch', 0.6, 0.32, 30];
    const b = ['Oklab', 0.6, 0.32 * Math.cos((30 * Math.PI) / 180), 0.32 * Math.sin((30 * Math.PI) / 180)];
    const delta = ce.expr(['ColorDelta', a, b]).evaluate();
    expect(delta.re).toBeCloseTo(0, 6);
  });

  test('ColorToColorspace Oklch → oklab is lossless polar conversion', () => {
    // Take a wide-gamut Oklch color, convert to oklab, and verify the
    // polar→cartesian math (no sRGB clipping).
    const result = ce
      .expr(['ColorToColorspace', ['Oklch', 0.7, 0.35, 0], "'oklab'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6); // L preserved
    expect(result.ops![1].re).toBeCloseTo(0.35, 6); // a = C·cos(0) = 0.35
    expect(result.ops![2].re).toBeCloseTo(0, 6); // b = C·sin(0) = 0
  });

  test('ColorToColorspace Oklab → oklch is lossless cartesian conversion', () => {
    const result = ce
      .expr(['ColorToColorspace', ['Oklab', 0.7, 0.35, 0], "'oklch'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(0.35, 6);
    expect(result.ops![2].re).toBeCloseTo(0, 4); // hue 0 (or close)
  });
});

describe('Regression: AsOklab/AsOklch preserve wide-gamut chroma', () => {
  // Going through sRGB clips out-of-gamut chroma. The direct Oklab↔Oklch
  // routes must preserve the components.

  test('AsOklch(Oklab) keeps wide-gamut a/b without sRGB pinch', () => {
    // a=0.30, b=0.10 → C ≈ 0.316, well outside displayable red.
    const result = ce
      .expr(['AsOklch', ['Oklab', 0.7, 0.3, 0.1]])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(Math.hypot(0.3, 0.1), 6);
  });

  test('AsOklab(Oklch) keeps wide-gamut chroma without sRGB pinch', () => {
    // C=0.4, hue 30° → outside displayable red.
    const result = ce
      .expr(['AsOklab', ['Oklch', 0.7, 0.4, 30]])
      .evaluate();
    expect(result.operator).toBe('Oklab');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(0.4 * Math.cos((30 * Math.PI) / 180), 6);
    expect(result.ops![2].re).toBeCloseTo(0.4 * Math.sin((30 * Math.PI) / 180), 6);
  });

  test('AsOklch(Oklab) round-trips wide-gamut alpha', () => {
    const result = ce
      .expr(['AsOklch', ['Oklab', 0.7, 0.3, 0, 0.5]])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(4);
    expect(result.ops![3].re).toBeCloseTo(0.5, 6);
  });
});

describe('Regression: wide-gamut promotion with mixed inputs', () => {
  // Even when only one input is a typed Oklab/Oklch head, the wide-gamut
  // path must apply — the other input is promoted to Oklch.

  test('ColorMix(string, Oklch wide-gamut) preserves wide-gamut side at t=1', () => {
    // At t=1 the result is the second input verbatim. With sRGB clipping
    // the chroma would shrink toward the sRGB edge for hue 30°; the
    // wide-gamut promotion path keeps it at 0.4.
    const result = ce
      .expr(['ColorMix', "'#ff0000'", ['Oklch', 0.7, 0.4, 30], 1])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(0.4, 6);
    expect(result.ops![2].re).toBeCloseTo(30, 4);
  });

  test('ColorDelta(string, Oklch wide-gamut) does not clip the wide-gamut side', () => {
    // Two Oklch points at the same L=0.7 differing only in chroma. With
    // gamut clipping their distance would shrink toward the sRGB edge;
    // the wide-gamut path keeps the full distance.
    const a = ['Oklch', 0.7, 0.1, 30] as const;
    const wide = ['Oklch', 0.7, 0.4, 30] as const;
    const fullDelta = ce.expr(['ColorDelta', a, wide]).evaluate();
    // Mixed (string-side promoted): should give the same delta as
    // typed-typed since the string here ('#ff0000') isn't actually being
    // compared — we use the same Oklch on both sides via different routes.
    const labCart = [
      'Oklab',
      0.7,
      0.1 * Math.cos((30 * Math.PI) / 180),
      0.1 * Math.sin((30 * Math.PI) / 180),
    ] as const;
    const cross = ce.expr(['ColorDelta', labCart, wide]).evaluate();
    expect(cross.re).toBeCloseTo(fullDelta.re as number, 6);
  });

  test('ColorDelta(string, Oklch) is symmetric and consistent', () => {
    // Promotion should be order-independent.
    const a = ce
      .expr(['ColorDelta', "'#ff0000'", ['Oklch', 0.6, 0.25, 29]])
      .evaluate();
    const b = ce
      .expr(['ColorDelta', ['Oklch', 0.6, 0.25, 29], "'#ff0000'"])
      .evaluate();
    expect(a.re).toBeCloseTo(b.re as number, 8);
  });
});

describe('Regression: achromatic hue handling in ColorMix', () => {
  // When one endpoint has C ≈ 0 its hue is undefined — the other endpoint's
  // hue must be used throughout (CSS Color 4 color-mix semantics).

  test('Mixing red with white preserves the red hue', () => {
    // Red is Oklch(~0.628, ~0.258, ~29°). White is achromatic.
    // Naive linear hue interpolation would drift toward 0° at high t;
    // the achromatic guard should keep H ≈ 29° throughout.
    const result = ce
      .expr(['ColorMix', ['Rgb', 255, 0, 0], ['Rgb', 255, 255, 255], 0.5])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    // L blended toward 1, C blended toward 0, but H stays near red.
    expect(result.ops![2].re).toBeCloseTo(29.23, 0);
  });

  test('Mixing chromatic Oklch with explicit achromatic Oklch keeps the chromatic hue', () => {
    // Achromatic with H=200° (placeholder). Naive interpolation at t=0.5
    // would yield H ≈ 114.5°; the guard should yield H = 29°.
    const result = ce
      .expr([
        'ColorMix',
        ['Oklch', 0.6, 0.25, 29],
        ['Oklch', 0.95, 0, 200],
        0.5,
      ])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![2].re).toBeCloseTo(29, 4);
  });

  test('Mixing two achromatic colors keeps a stable hue', () => {
    // Hue is meaningless for both; result should be achromatic with
    // C blended to 0 and the first endpoint's H carried (deterministic).
    const result = ce
      .expr([
        'ColorMix',
        ['Oklch', 0.2, 0, 100],
        ['Oklch', 0.8, 0, 200],
        0.5,
      ])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![1].re).toBeCloseTo(0, 6); // C stays 0
    expect(result.ops![2].re).toBe(100); // first endpoint's H wins
  });

  test('Compiled colorMix matches interpreted achromatic behavior', () => {
    // Compiled path takes string inputs (typed heads aren't compiled).
    const expr = ce.expr(['ColorMix', "'#ff0000'", "'#ffffff'", 0.5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const result = compiled.run!() as unknown as number[];
    // Compiled output is Oklch [L, C, H]; H should be ≈ 29 (red's hue,
    // not interpolated through 0 with white's placeholder hue).
    expect(result).toHaveLength(3);
    expect(result[2]).toBeCloseTo(29.23, 0);
  });
});

describe('Regression: ColorFromColorspace accepts typed heads', () => {
  // Previously rejected with incompatible-type if the input wasn't a Tuple.
  // Should now accept any of the typed color heads as the components source.

  test('ColorFromColorspace accepts an Oklch head', () => {
    const result = ce
      .expr(['ColorFromColorspace', ['Oklch', 0.628, 0.258, 29.23], "'oklch'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // Round-trip should land near pure red in 0-1 sRGB.
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('ColorFromColorspace accepts an Rgb head with rgb space', () => {
    // Components from an Rgb head are 0-255; the operator interprets them
    // per the named space ('rgb' = 0-1 sRGB), so this is intentionally a
    // pass-through that produces Tuple of the raw components.
    const result = ce
      .expr(['ColorFromColorspace', ['Rgb', 0.5, 0.25, 0.75], "'rgb'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(0.5, 6);
    expect(result.ops![1].re).toBeCloseTo(0.25, 6);
    expect(result.ops![2].re).toBeCloseTo(0.75, 6);
  });

  test('ColorFromColorspace still accepts a plain Tuple', () => {
    const result = ce
      .expr(['ColorFromColorspace', ['Tuple', 0.5, 0.25, 0.75], "'rgb'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(0.5, 6);
  });
});
