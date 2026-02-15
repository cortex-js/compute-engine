import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function evaluateColor(input: string) {
  const expr = ce.box(['Color', `'${input}'`]);
  const result = expr.evaluate();
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
    const expr = ce.box(['Color', "'not-a-color'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});

describe('Colormap', () => {
  test('full palette returns list of tuples', () => {
    const expr = ce.box(['Colormap', "'graph6'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(6);
    expect(result.ops![0].operator).toBe('Tuple');
    expect(result.ops![0].ops!.length).toBe(3);
  });

  test('resample to n colors', () => {
    const expr = ce.box(['Colormap', "'viridis'", 5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(5);
  });

  test('sample at t=0 returns first color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 0]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
  });

  test('sample at t=1 returns last color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 1]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
  });

  test('sample at t=0.5 returns interpolated color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 0.5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('unknown palette returns error', () => {
    const expr = ce.box(['Colormap', "'nonexistent'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});

describe('ColorToColorspace', () => {
  test('to oklch', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'oklch'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // L should be around 0.6
    expect(result.ops![0].re).toBeGreaterThan(0.5);
    expect(result.ops![0].re).toBeLessThan(0.7);
  });

  test('to oklab (via "lab" alias)', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'lab'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('to hsl', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'hsl'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red: h near 0, s near 1, l near 0.5
    expect(result.ops![0].re).toBeLessThan(1); // hue near 0
    expect(result.ops![1].re).toBeCloseTo(1, 1); // full saturation
    expect(result.ops![2].re).toBeCloseTo(0.5, 1); // mid lightness
  });

  test('to rgb is identity (normalized)', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'rgb'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(1, 2);
    expect(result.ops![1].re).toBeCloseTo(0, 2);
    expect(result.ops![2].re).toBeCloseTo(0, 2);
  });

  test('accepts tuple input', () => {
    const expr = ce.box([
      'ColorToColorspace',
      ['Tuple', 1, 0, 0],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });
});

describe('ColorFromColorspace', () => {
  test('from oklch', () => {
    const expr = ce.box([
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
    const expr = ce.box([
      'ColorFromColorspace',
      ['Tuple', 0, 1, 0.5],
      "'hsl'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('roundtrip oklch', () => {
    const toOklch = ce
      .box(['ColorToColorspace', "'#3366cc'", "'oklch'"])
      .evaluate();
    const back = ce
      .box(['ColorFromColorspace', toOklch.json, "'oklch'"])
      .evaluate();
    expect(back.operator).toBe('Tuple');

    const original = ce.box(['Color', "'#3366cc'"]).evaluate();
    expect(back.ops![0].re).toBeCloseTo(original.ops![0].re, 2);
    expect(back.ops![1].re).toBeCloseTo(original.ops![1].re, 2);
    expect(back.ops![2].re).toBeCloseTo(original.ops![2].re, 2);
  });
});

describe('Edge cases', () => {
  test('Color with alpha=1 returns 3-component tuple', () => {
    const expr = ce.box(['Color', "'#ff0000ff'"]);
    const result = expr.evaluate();
    expect(result.ops!.length).toBe(3);
  });

  test('Colormap t outside [0,1] is clamped', () => {
    const lo = ce.box(['Colormap', "'viridis'", -0.5]).evaluate();
    const first = ce.box(['Colormap', "'viridis'", 0]).evaluate();
    expect(lo.ops![0].re).toBeCloseTo(first.ops![0].re, 5);

    const hi = ce.box(['Colormap', "'viridis'", 1.5]).evaluate();
    const last = ce.box(['Colormap', "'viridis'", 1]).evaluate();
    expect(hi.ops![0].re).toBeCloseTo(last.ops![0].re, 5);
  });

  test('ColorToColorspace with alpha preserves it', () => {
    const expr = ce.box([
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
      .box(['ColorToColorspace', "'#3366cc'", "'hsl'"])
      .evaluate();
    const back = ce
      .box(['ColorFromColorspace', toHsl.json, "'hsl'"])
      .evaluate();
    const original = ce.box(['Color', "'#3366cc'"]).evaluate();
    expect(back.ops![0].re).toBeCloseTo(original.ops![0].re, 2);
    expect(back.ops![1].re).toBeCloseTo(original.ops![1].re, 2);
    expect(back.ops![2].re).toBeCloseTo(original.ops![2].re, 2);
  });
});

describe('ColorToString', () => {
  test('string input roundtrip', () => {
    const result = ce.box(['ColorToString', "'#ff0000'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('tuple input', () => {
    const result = ce
      .box(['ColorToString', ['Tuple', 1, 0, 0]])
      .evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('alpha included when not 1', () => {
    const result = ce
      .box(['ColorToString', "'#ff000080'"])
      .evaluate();
    expect(result.string).toBe('#ff000080');
  });

  test('alpha omitted when 1', () => {
    const result = ce
      .box(['ColorToString', "'#ff0000ff'"])
      .evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('3-component tuple', () => {
    const result = ce
      .box(['ColorToString', ['Tuple', 0, 1, 0]])
      .evaluate();
    expect(result.string).toBe('#00ff00');
  });
});

describe('ColorMix', () => {
  test('equal mix of red and blue', () => {
    const result = ce
      .box(['ColorMix', "'#ff0000'", "'#0000ff'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('ratio=0 returns first color', () => {
    const result = ce
      .box(['ColorMix', "'#ff0000'", "'#0000ff'", 0])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    // Should be red
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('ratio=1 returns second color', () => {
    const result = ce
      .box(['ColorMix', "'#ff0000'", "'#0000ff'", 1])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    // Should be blue (OKLCh roundtrip has slight gamut clipping)
    expect(result.ops![2].re).toBeGreaterThan(0.85);
    expect(result.ops![0].re).toBeLessThan(0.15);
  });

  test('default ratio is 0.5', () => {
    const withDefault = ce
      .box(['ColorMix', "'#ff0000'", "'#0000ff'"])
      .evaluate();
    const withExplicit = ce
      .box(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5])
      .evaluate();
    expect(withDefault.ops![0].re).toBeCloseTo(withExplicit.ops![0].re, 5);
    expect(withDefault.ops![1].re).toBeCloseTo(withExplicit.ops![1].re, 5);
    expect(withDefault.ops![2].re).toBeCloseTo(withExplicit.ops![2].re, 5);
  });

  test('string + tuple inputs', () => {
    const result = ce
      .box(['ColorMix', "'#ff0000'", ['Tuple', 0, 0, 1], 0.5])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });
});

describe('ColorContrast', () => {
  test('black on white has high positive contrast', () => {
    const result = ce
      .box(['ColorContrast', "'#ffffff'", "'#000000'"])
      .evaluate();
    expect(result.re).toBeGreaterThan(1);
  });

  test('white on black has high negative contrast', () => {
    const result = ce
      .box(['ColorContrast', "'#000000'", "'#ffffff'"])
      .evaluate();
    expect(result.re).toBeLessThan(-1);
  });

  test('same color returns 0', () => {
    const result = ce
      .box(['ColorContrast', "'#808080'", "'#808080'"])
      .evaluate();
    expect(result.re).toBe(0);
  });

  test('accepts tuple inputs', () => {
    const result = ce
      .box(['ColorContrast', ['Tuple', 1, 1, 1], ['Tuple', 0, 0, 0]])
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
    const expr = ce.box(['Annotated', 'x', { dict: { color: 'red' } }]);
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
    const expr = ce.box([
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
    const expr = ce.box(['Annotated', 'x', { dict: { border: true } }]);
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
    const result = ce.box(['ColorToString', "'#ff0000'"]).evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('explicit hex format', () => {
    const result = ce
      .box(['ColorToString', "'#ff0000'", "'hex'"])
      .evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('rgb format', () => {
    const result = ce
      .box(['ColorToString', "'#ff0000'", "'rgb'"])
      .evaluate();
    expect(result.string).toBe('rgb(255 0 0)');
  });

  test('hsl format', () => {
    const result = ce
      .box(['ColorToString', "'#ff0000'", "'hsl'"])
      .evaluate();
    expect(result.string).toMatch(/^hsl\(/);
  });

  test('oklch format', () => {
    const result = ce
      .box(['ColorToString', "'#ff0000'", "'oklch'"])
      .evaluate();
    expect(result.string).toMatch(/^oklch\(/);
  });

  test('rgb format with alpha', () => {
    const result = ce
      .box(['ColorToString', "'#ff000080'", "'rgb'"])
      .evaluate();
    expect(result.string).toMatch(/^rgb\(255 0 0 \//);
  });
});

describe('ContrastingColor', () => {
  test('white bg defaults to black text', () => {
    const result = ce
      .box(['ContrastingColor', "'#ffffff'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    // Should be black (0, 0, 0)
    expect(result.ops![0].re).toBeCloseTo(0, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('black bg defaults to white text', () => {
    const result = ce
      .box(['ContrastingColor', "'#000000'"])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    // Should be white (1, 1, 1)
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(1, 1);
    expect(result.ops![2].re).toBeCloseTo(1, 1);
  });

  test('with two fg candidates', () => {
    const result = ce
      .box([
        'ContrastingColor',
        "'#ffffff'",
        "'#ff0000'",
        "'#0000ff'",
      ])
      .evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBeGreaterThanOrEqual(3);
  });

  test('accepts tuple input', () => {
    const result = ce
      .box(['ContrastingColor', ['Tuple', 1, 1, 1]])
      .evaluate();
    expect(result.operator).toBe('Tuple');
  });
});

describe('Color compilation', () => {
  test('compile Color', () => {
    const expr = ce.box(['Color', "'#ff0000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    expect(result).toEqual([1, 0, 0]);
  });

  test('compile ColorContrast', () => {
    const expr = ce.box(['ColorContrast', "'#ffffff'", "'#000000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number;
    expect(result).toBeGreaterThan(1);
  });

  test('compile ColorToString', () => {
    const expr = ce.box(['ColorToString', "'#ff0000'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as string;
    expect(result).toBe('#ff0000');
  });

  test('compile ColorMix', () => {
    const expr = ce.box(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    expect(result).toHaveLength(3);
  });

  test('compile ColorToColorspace', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'oklch'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('compile ContrastingColor', () => {
    const expr = ce.box(['ContrastingColor', "'#ffffff'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[];
    // Should be black
    expect(result[0]).toBeCloseTo(0, 1);
  });

  test('compile Colormap with name only', () => {
    const expr = ce.box(['Colormap', "'graph6'"]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run).toBeDefined();
    const result = compiled.run!() as unknown as number[][];
    expect(result.length).toBe(6);
    expect(result[0]).toHaveLength(3);
  });

  test('compile Colormap with integer n', () => {
    const expr = ce.box(['Colormap', "'viridis'", 5]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const result = compiled.run!() as unknown as number[][];
    expect(result.length).toBe(5);
    expect(result[0]).toHaveLength(3);
  });

  test('compile Colormap with float t', () => {
    const expr = ce.box(['Colormap', "'viridis'", 0.5]);
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
    const expr = ce.box(['Color', "'oklab(0.628 0.225 0.126)'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });
});

describe('GPU color compilation', () => {
  test('compile ColorMix to GLSL', () => {
    const expr = ce.box([
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
    const expr = ce.box([
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
    const expr = ce.box([
      'ColorToColorspace',
      ['Tuple', 1, 0, 0],
      "'oklab'",
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_srgb_to_oklab');
  });

  test('compile ColorFromColorspace to WGSL', () => {
    const expr = ce.box([
      'ColorFromColorspace',
      ['Tuple', 0.6, 0.2, 0.1],
      "'oklab'",
    ]);
    const compiled = compile(expr, { to: 'wgsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_oklab_to_srgb');
  });

  test('compile ContrastingColor to GLSL', () => {
    const expr = ce.box([
      'ContrastingColor',
      ['Tuple', 1, 1, 1],
    ]);
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_gpu_apca');
    expect(compiled.code).toContain('vec3(0.0)');
  });
});
