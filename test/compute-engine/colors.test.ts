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
      return rgb.ops!.map((op) => {
        // Rgb head channels are 0-1 sRGB (matches alpha range).
        return Math.round(op.re * 1000) / 1000;
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

  // CE-1416: a categorical palette is indexed, not interpolated.
  describe('a categorical palette', () => {
    const stops = () =>
      ce.expr(['Colormap', "'tycho11'"]).evaluate().ops!.map((c) => c.json);

    test('a position gives the nearest category', () => {
      const s = stops();
      const at = (t: number) =>
        ce.expr(['Colormap', "'tycho11'", t]).evaluate().json;
      expect(at(0.04)).toEqual(s[0]);
      expect(at(0.06)).toEqual(s[1]);
      expect(at(0.5)).toEqual(s[5]);
      expect(at(1)).toEqual(s[10]);
      expect(at(-1)).toEqual(s[0]);
      expect(at(1.5)).toEqual(s[10]);
    });

    test('a count gives the first colors, repeated past the length', () => {
      const s = stops();
      const three = ce.expr(['Colormap', "'tycho11'", 3]).evaluate();
      expect(three.ops!.map((c) => c.json)).toEqual(s.slice(0, 3));
      const thirteen = ce.expr(['Colormap', "'tycho11'", 13]).evaluate();
      expect(thirteen.ops!.map((c) => c.json)).toEqual([...s, s[0], s[1]]);
    });
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
  // The operator BUILDS a color from channels in the named space, so it
  // answers the color head of that space, with those channels. The sRGB
  // components it used to answer are read back with `ColorToColorspace`.
  const srgbOf = (color: any) =>
    ce
      .expr(['ColorToColorspace', color.json, "'rgb'"])
      .evaluate()
      .ops!.map((op) => op.re);

  test('from oklch', () => {
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 0.6, 0.26, 29],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.map((op) => op.re)).toEqual([0.6, 0.26, 29]);
    // Should be reddish
    expect(srgbOf(result)[0]).toBeGreaterThan(0.5);
  });

  test('from hsl', () => {
    const expr = ce.expr([
      'ColorFromColorspace',
      ['Tuple', 0, 1, 0.5],
      "'hsl'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Hsl');
    expect(result.ops!.map((op) => op.re)).toEqual([0, 1, 0.5]);
    // Pure red
    const rgb = srgbOf(result);
    expect(rgb[0]).toBeCloseTo(1, 1);
    expect(rgb[1]).toBeCloseTo(0, 1);
    expect(rgb[2]).toBeCloseTo(0, 1);
  });

  test('roundtrip oklch', () => {
    const toOklch = ce
      .expr(['ColorToColorspace', "'#3366cc'", "'oklch'"])
      .evaluate();
    const back = ce
      .expr(['ColorFromColorspace', toOklch.json, "'oklch'"])
      .evaluate();
    expect(back.operator).toBe('Oklch');

    // Convert Color() result (Oklch) to 0-1 sRGB for comparison.
    const originalAsRgb = ce
      .expr(['AsRgb', ce.expr(['Color', "'#3366cc'"]).evaluate().json])
      .evaluate();
    const rgb = srgbOf(back);
    expect(rgb[0]).toBeCloseTo(originalAsRgb.ops![0].re, 2);
    expect(rgb[1]).toBeCloseTo(originalAsRgb.ops![1].re, 2);
    expect(rgb[2]).toBeCloseTo(originalAsRgb.ops![2].re, 2);
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
    // The round trip answers an `Hsl` COLOR, so the sRGB components are read
    // back out with `ColorToColorspace`.
    const back = ce
      .expr(['ColorFromColorspace', toHsl.json, "'hsl'"])
      .evaluate();
    expect(back.operator).toBe('Hsl');
    const rgb = ce
      .expr(['ColorToColorspace', back.json, "'rgb'"])
      .evaluate()
      .ops!.map((op) => op.re);
    // Convert Color() result (Oklch) to 0-1 sRGB for comparison.
    const originalAsRgb = ce
      .expr(['AsRgb', ce.expr(['Color', "'#3366cc'"]).evaluate().json])
      .evaluate();
    expect(rgb[0]).toBeCloseTo(originalAsRgb.ops![0].re, 2);
    expect(rgb[1]).toBeCloseTo(originalAsRgb.ops![1].re, 2);
    expect(rgb[2]).toBeCloseTo(originalAsRgb.ops![2].re, 2);
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
  // for component comparison. AsRgb returns 0-1 channels directly.
  function mixedToRgb(result: any): { r: number; g: number; b: number } {
    expect(result.operator).toBe('Oklch');
    const rgb = ce.expr(['AsRgb', result.json]).evaluate();
    expect(rgb.operator).toBe('Rgb');
    return {
      r: rgb.ops![0].re,
      g: rgb.ops![1].re,
      b: rgb.ops![2].re,
    };
  }

  test('equal mix of red and blue', () => {
    const result = ce.expr(['ColorMix', "'#ff0000'", "'#0000ff'"]).evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
  });

  test('ratio=0 returns first color', () => {
    const result = ce
      .expr(['ColorMix', "'#ff0000'", "'#0000ff'", 0])
      .evaluate();
    const rgb = mixedToRgb(result);
    expect(rgb.r).toBeCloseTo(1, 1);
    expect(rgb.g).toBeCloseTo(0, 1);
    expect(rgb.b).toBeCloseTo(0, 1);
  });

  test('ratio=1 returns second color', () => {
    const result = ce
      .expr(['ColorMix', "'#ff0000'", "'#0000ff'", 1])
      .evaluate();
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
    const result = ce
      .expr(['ColorToString', "'#ff0000'", "'oklch'"])
      .evaluate();
    expect(result.string).toMatch(/^oklch\(/);
  });

  test('rgb format with alpha', () => {
    const result = ce
      .expr(['ColorToString', "'#ff000080'", "'rgb'"])
      .evaluate();
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
    // Should be white: (1, 1, 1)
    expect(result.ops![0].re).toBe(1);
    expect(result.ops![1].re).toBe(1);
    expect(result.ops![2].re).toBe(1);
  });

  test('with two fg candidates', () => {
    // A string candidate has no color head of its own and denotes 0-1 sRGB,
    // so it comes back as an `Rgb` head.
    const result = ce
      .expr(['ContrastingColor', "'#ffffff'", "'#ff0000'", "'#0000ff'"])
      .evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBeGreaterThanOrEqual(3);
  });

  test('the chosen candidate keeps the color space it was given in', () => {
    // The chosen operand is answered VERBATIM. Re-encoding it as an `Rgb`
    // head pinched an OKLCh candidate through the sRGB gamut and threw its
    // color space away.
    const result = ce
      .expr([
        'ContrastingColor',
        ['Oklch', 0.98, 0.02, 90],
        ['Oklch', 0.2, 0.1, 29],
        ['Oklch', 0.95, 0.2, 264],
      ])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    // The dark candidate against a near-white background.
    expect(result.ops!.map((op) => op.re)).toEqual([0.2, 0.1, 29]);
  });

  test('an Hsl candidate comes back as Hsl', () => {
    const result = ce
      .expr([
        'ContrastingColor',
        ['Hsl', 0, 1, 0.5],
        ['Hsl', 120, 1, 0.9],
        ['Hsl', 240, 1, 0.1],
      ])
      .evaluate();
    expect(result.operator).toBe('Hsl');
    expect(result.ops!.map((op) => op.re)).toEqual([120, 1, 0.9]);
  });

  test('the one-argument form still answers an Rgb head', () => {
    // Its two candidates are the built-in white and black, which have no
    // caller-supplied color space to preserve.
    expect(
      ce.expr(['ContrastingColor', ['Oklch', 0.98, 0.02, 90]]).evaluate()
        .operator
    ).toBe('Rgb');
  });

  test('accepts tuple input', () => {
    const result = ce.expr(['ContrastingColor', ['Tuple', 1, 1, 1]]).evaluate();
    expect(result.operator).toBe('Rgb');
  });
});

/**
 * The channels of a compiled color value, as the flat array the pins in this
 * file read before a compiled color carried its space. A compiled color is now
 * the object `{ space, c0, c1, c2, alpha }`, so the pins about a color's VALUE
 * read through this helper, and the pins about the REPRESENTATION assert on
 * `space` and the channel keys directly.
 */
function channelsOf(v: unknown): number[] {
  const c = v as {
    space: string;
    c0: number;
    c1: number;
    c2: number;
    alpha?: number;
  };
  expect(typeof c).toBe('object');
  const channels = [c.c0, c.c1, c.c2];
  if (c.alpha !== undefined) channels.push(c.alpha);
  return channels;
}

/** The `space` a compiled color value carries. */
function spaceOf(v: unknown): string {
  return (v as { space: string }).space;
}

describe('Color compilation', () => {

  // ---------------------------------------------------------------------
  // Compile-target support for the new color heads (Rgb/Hsv/Hsl/Oklab/
  // Oklch constructors, As* converters, ColorDelta, Distance). Every
  // constructor answers a color value in the canonical OKLCh space; each
  // `As*` conversion answers a color tagged with the space it names.
  // ---------------------------------------------------------------------

  test('compile Rgb to JS produces an OKLCh color value', () => {
    const compiled = compile(ce.expr(['Rgb', 1, 0, 0]));
    expect(compiled.success).toBe(true);
    const raw = compiled.run!();
    expect(spaceOf(raw)).toBe('oklch');
    const result = channelsOf(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.628, 2); // L
    expect(result[1]).toBeCloseTo(0.258, 2); // C
    expect(result[2]).toBeCloseTo(29.23, 0); // H
  });

  test('compile Hsv to JS produces an OKLCh color value', () => {
    const compiled = compile(ce.expr(['Hsv', 0, 1, 1]));
    expect(compiled.success).toBe(true);
    const raw = compiled.run!();
    expect(spaceOf(raw)).toBe('oklch');
    const result = channelsOf(raw);
    expect(result).toHaveLength(3);
    // hsv(0,1,1) is red — same OKLCh as Rgb(255,0,0)
    expect(result[0]).toBeCloseTo(0.628, 2);
  });

  test('compile Oklch to JS is identity', () => {
    const compiled = compile(ce.expr(['Oklch', 0.7, 0.2, 30]));
    expect(compiled.success).toBe(true);
    expect(compiled.run!()).toEqual({
      space: 'oklch',
      c0: 0.7,
      c1: 0.2,
      c2: 30,
      alpha: undefined,
    });
  });

  test('compile AsRgb to JS produces 0-1 sRGB array', () => {
    // Note: 0-1 sRGB (matching GPU target convention), NOT 0-255 like the
    // interpreted-layer Rgb head.
    const compiled = compile(ce.expr(['AsRgb', ['Hsv', 0, 1, 1]]));
    expect(compiled.success).toBe(true);
    const raw = compiled.run!();
    expect(spaceOf(raw)).toBe('rgb');
    const result = channelsOf(raw);
    expect(result[0]).toBeCloseTo(1, 2); // r=1 in 0-1 sRGB
    expect(result[1]).toBeCloseTo(0, 2);
    expect(result[2]).toBeCloseTo(0, 2);
  });

  test('compile AsHsv to JS produces hue/sat/val', () => {
    const compiled = compile(ce.expr(['AsHsv', ['Rgb', 1, 0, 0]]));
    expect(compiled.success).toBe(true);
    const raw = compiled.run!();
    expect(spaceOf(raw)).toBe('hsv');
    const result = channelsOf(raw);
    expect(result[0]).toBeCloseTo(0, 1);
    expect(result[1]).toBeCloseTo(1, 2);
    expect(result[2]).toBeCloseTo(1, 2);
  });

  test('compile AsOklch to JS is pass-through', () => {
    // AsOklch on canonical OKLCh input is identity.
    const compiled = compile(ce.expr(['AsOklch', ['Oklch', 0.7, 0.2, 30]]));
    expect(compiled.success).toBe(true);
    expect(compiled.run!()).toEqual({
      space: 'oklch',
      c0: 0.7,
      c1: 0.2,
      c2: 30,
      alpha: undefined,
    });
  });

  test('compile Distance to JS — 2D Euclidean', () => {
    const compiled = compile(
      ce.expr(['Distance', ['Tuple', 0, 0], ['Tuple', 3, 4]])
    );
    expect(compiled.success).toBe(true);
    expect(compiled.run!() as unknown as number).toBe(5);
  });

  test('compile Distance to JS — 3D Euclidean', () => {
    const compiled = compile(
      ce.expr(['Distance', ['Tuple', 1, 2, 3], ['Tuple', 4, 6, 3]])
    );
    expect(compiled.success).toBe(true);
    expect(compiled.run!() as unknown as number).toBe(5);
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

describe('GPU compile: typed color heads', () => {

  test('Color(non-literal) is rejected at compile time', () => {
    // Wrap the string in a function call to defeat literal recognition.
    // The compile must fail because GPU can't parse strings at runtime.
    const expr = ce.parse('\\operatorname{Color}(\\operatorname{Sym}(x))');
    const compiled = compile(expr, { to: 'glsl' });
    expect(compiled.success).toBe(false);
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

  // Alpha is orthogonal to color-space conversion and the whole `_gpu_*`
  // chain is vec3 end to end, so a 4th operand has nowhere to go. Emitting
  // the 3-component form would SILENTLY drop the alpha the JS target
  // preserves ('compile Rgb with alpha to JS' above), so decline instead.
  test.each([
    ['Rgb', ['Rgb', 1, 0, 0, 0.5]],
    ['Hsv', ['Hsv', 0, 1, 1, 0.5]],
    ['Hsl', ['Hsl', 0, 1, 0.5, 0.25]],
    ['Oklab', ['Oklab', 0.628, 0.225, 0.126, 0.5]],
    ['Oklch', ['Oklch', 0.628, 0.258, 29.23, 0.5]],
  ] as const)('%s with alpha fails closed on GLSL', (head, json) => {
    for (const to of ['glsl'] as const) {
      const compiled = compile(ce.expr(json as any), { to });
      expect(compiled.success).toBe(false);
      // The profile has no row of the head with a 4th operand.
      expect(compiled.diagnostic?.code).toBe('outside-profile');
      expect(compiled.error).toMatch(new RegExp(`${head} with 4 operands`));
    }
  });

  // Same fail-closed policy through the two routes that used to bypass it:
  // a 4-component `ColorFromColorspace` tuple (compiled into a vec4 that then
  // flowed into vec3 helpers), and a CSS literal whose alpha byte was parsed
  // and then silently dropped by the RGB-only lowering.
  test('ColorFromColorspace with a 4-component tuple fails closed', () => {
    for (const to of ['glsl'] as const) {
      // `constantFold: false`: the tuple is all literals, so the compiler
      // would otherwise evaluate the subtree and emit a `vec4` literal,
      // never reaching the alpha check this test pins.
      const compiled = compile(
        ce.expr(['ColorFromColorspace', ['Tuple', 1, 0, 0, 0.5], "'rgb'"]),
        { to, constantFold: false }
      );
      expect(compiled.success).toBe(false);
      expect(compiled.diagnostic?.code).toBe('outside-profile');
      expect(compiled.error).toMatch(
        /the operator ColorFromColorspace is not supported by the compiler/
      );
    }
  });

  test('Color(literal) with a non-opaque alpha fails closed', () => {
    for (const to of ['glsl'] as const) {
      const compiled = compile(ce.expr(['Color', "'#ff000080'"]), { to });
      expect(compiled.success).toBe(false);
      expect(compiled.diagnostic?.code).toBe('outside-profile');
      expect(compiled.error).toMatch(
        /Color of a colour string with an alpha/
      );
    }
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
    const expr = ce.expr(['Rgb', 1, 0, 0]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(1);
  });

  test('preserves colorspace on evaluation (Hsv)', () => {
    const expr = ce.expr(['Hsv', 120, 1, 1]).evaluate();
    expect(expr.operator).toBe('Hsv');
  });

  test('out-of-range values are not clamped at parse time', () => {
    // Parse permissive; downstream consumers decide whether to clamp.
    const expr = ce.expr(['Rgb', 2, -0.5, 5]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(2);
    expect(expr.ops![1].re).toBe(-0.5);
    expect(expr.ops![2].re).toBe(5);
  });

  test('Hsv broadcasts over a List argument', () => {
    const expr = ce.parse('\\operatorname{hsv}(0,1,[0,1])').evaluate();
    expect(expr.operator).toBe('List');
    expect(expr.ops!.length).toBe(2);
    expect(expr.ops![0].operator).toBe('Hsv');
    expect(expr.ops![0].toString()).toBe('Hsv(0, 1, 0)');
    expect(expr.ops![1].operator).toBe('Hsv');
    expect(expr.ops![1].toString()).toBe('Hsv(0, 1, 1)');
  });

  test('Rgb broadcasts over a List argument', () => {
    const expr = ce.expr(['Rgb', ['List', 0, 1], 0, 0]).evaluate();
    expect(expr.operator).toBe('List');
    expect(expr.ops!.length).toBe(2);
    expect(expr.ops![0].operator).toBe('Rgb');
    expect(expr.ops![1].operator).toBe('Rgb');
  });

  test('Hsv with scalar arguments is unchanged', () => {
    const expr = ce.parse('\\operatorname{hsv}(0,1,1)').evaluate();
    expect(expr.operator).toBe('Hsv');
    expect(expr.toString()).toBe('Hsv(0, 1, 1)');
  });
});

describe('Color conversions (As*)', () => {
  test('AsRgb identity on Rgb', () => {
    const expr = ce.expr(['AsRgb', ['Rgb', 0.4, 0.2, 0.1]]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBe(0.4);
  });

  test('AsRgb on Hsv produces Rgb', () => {
    // hsv(0, 1, 1) is pure red
    const expr = ce.expr(['AsRgb', ['Hsv', 0, 1, 1]]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBeCloseTo(1, 4);
    expect(expr.ops![1].re).toBeCloseTo(0, 4);
    expect(expr.ops![2].re).toBeCloseTo(0, 4);
  });

  test('AsHsv on Rgb produces Hsv', () => {
    const expr = ce.expr(['AsHsv', ['Rgb', 1, 0, 0]]).evaluate();
    expect(expr.operator).toBe('Hsv');
    expect(expr.ops![0].re).toBeCloseTo(0, 1); // hue 0
    expect(expr.ops![1].re).toBeCloseTo(1, 2); // saturation 1
    expect(expr.ops![2].re).toBeCloseTo(1, 2); // value 1
  });

  test('AsOklch on Rgb produces Oklch', () => {
    const expr = ce.expr(['AsOklch', ['Rgb', 1, 0, 0]]).evaluate();
    expect(expr.operator).toBe('Oklch');
  });

  test('AsRgb ∘ AsHsv ∘ ... round-trips', () => {
    const start = ['Rgb', 200 / 255, 100 / 255, 50 / 255];
    const expr = ce
      .expr(['AsRgb', ['AsHsv', ['AsOklch', ['AsHsl', start]]]])
      .evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBeCloseTo(200 / 255, 3);
    expect(expr.ops![1].re).toBeCloseTo(100 / 255, 3);
    expect(expr.ops![2].re).toBeCloseTo(50 / 255, 3);
  });

  test('alpha is preserved through conversion', () => {
    const expr = ce.expr(['AsHsv', ['Rgb', 1, 0, 0, 0.5]]).evaluate();
    expect(expr.operator).toBe('Hsv');
    expect(expr.ops!.length).toBe(4);
    expect(expr.ops![3].re).toBeCloseTo(0.5, 4);
  });

  test('AsRgb broadcasts over a List of colors (Tycho item 69)', () => {
    // hsv(120,1,1) is pure green; hsv(0,1,1) is pure red.
    const expr = ce
      .expr(['AsRgb', ['List', ['Hsv', 120, 1, 1], ['Hsv', 0, 1, 1]]])
      .evaluate();
    expect(expr.operator).toBe('List');
    expect(expr.ops!.length).toBe(2);
    expect(expr.ops![0].operator).toBe('Rgb');
    expect(expr.ops![0].ops![0].re).toBeCloseTo(0, 4);
    expect(expr.ops![0].ops![1].re).toBeCloseTo(1, 4);
    expect(expr.ops![0].ops![2].re).toBeCloseTo(0, 4);
    expect(expr.ops![1].operator).toBe('Rgb');
    expect(expr.ops![1].ops![0].re).toBeCloseTo(1, 4);
    expect(expr.ops![1].ops![1].re).toBeCloseTo(0, 4);
    expect(expr.ops![1].ops![2].re).toBeCloseTo(0, 4);
  });

  test('AsRgb on a scalar color is unchanged by the broadcast lift', () => {
    const expr = ce.expr(['AsRgb', ['Hsv', 120, 1, 1]]).evaluate();
    expect(expr.operator).toBe('Rgb');
    expect(expr.ops![0].re).toBeCloseTo(0, 4);
    expect(expr.ops![1].re).toBeCloseTo(1, 4);
    expect(expr.ops![2].re).toBeCloseTo(0, 4);
  });

  test('AsHsv broadcasts over a List of colors', () => {
    const expr = ce
      .expr(['AsHsv', ['List', ['Rgb', 0, 1, 0], ['Rgb', 1, 0, 0]]])
      .evaluate();
    expect(expr.operator).toBe('List');
    expect(expr.ops!.length).toBe(2);
    expect(expr.ops![0].operator).toBe('Hsv');
    expect(expr.ops![0].ops![0].re).toBeCloseTo(120, 1);
    expect(expr.ops![1].operator).toBe('Hsv');
    expect(expr.ops![1].ops![0].re).toBeCloseTo(0, 1);
  });

  test('broadcast over a mixed List yields a per-element error', () => {
    const expr = ce
      .expr(['AsRgb', ['List', ['Hsv', 120, 1, 1], 42]])
      .evaluate();
    expect(expr.operator).toBe('List');
    expect(expr.ops!.length).toBe(2);
    expect(expr.ops![0].operator).toBe('Rgb');
    expect(expr.ops![1].operator).toBe('Error');
  });
});

describe('ColorDelta', () => {
  test('identical colors return 0', () => {
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 1, 0, 0], ['Rgb', 1, 0, 0]])
      .evaluate();
    expect(expr.re).toBe(0);
  });

  test('cross-space identical colors return 0', () => {
    // hsv(0, 1, 1) and rgb(255, 0, 0) are the same color
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 1, 0, 0], ['Hsv', 0, 1, 1]])
      .evaluate();
    expect(expr.re).toBeCloseTo(0, 4);
  });

  test('different colors return positive scalar', () => {
    const expr = ce
      .expr(['ColorDelta', ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1]])
      .evaluate();
    expect(expr.re).toBeGreaterThan(0.4);
  });

  test('symmetric', () => {
    const ab = ce
      .expr(['ColorDelta', ['Rgb', 0.4, 0.2, 0.8], ['Rgb', 0.8, 0.4, 0.2]])
      .evaluate();
    const ba = ce
      .expr(['ColorDelta', ['Rgb', 0.8, 0.4, 0.2], ['Rgb', 0.4, 0.2, 0.8]])
      .evaluate();
    expect(ab.re).toBeCloseTo(ba.re, 6);
  });

  test('accepts color strings via extractRgb', () => {
    const expr = ce
      .expr(['ColorDelta', "'#ff0000'", ['Rgb', 1, 0, 0]])
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
    const expr = ce.expr(['Rgb', 1, 0, 0]);
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
    const expr = ce.expr(['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1]]);
    expect(expr.type.toString()).toBe('color');
  });

  test('ContrastingColor returns type "color"', () => {
    const expr = ce.expr(['ContrastingColor', "'#ffffff'"]);
    expect(expr.type.toString()).toBe('color');
  });

  test('color is a subtype of value', () => {
    const expr = ce.expr(['Rgb', 1, 0, 0]);
    expect(expr.type.matches('value')).toBe(true);
  });

  test('color is NOT a subtype of tuple', () => {
    const expr = ce.expr(['Rgb', 1, 0, 0]);
    expect(expr.type.matches('tuple')).toBe(false);
  });
});

describe('Wide-gamut preservation', () => {
  // Out-of-sRGB Oklab/Oklch input: chroma greater than what red can hit, plus a
  // green-direction hue. Going through sRGB would clip; the typed-head paths
  // should preserve the components.

  test('ColorMix returns Oklch when both inputs are typed color heads', () => {
    const result = ce
      .expr(['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1], 0.5])
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
    const b = [
      'Oklab',
      0.6,
      0.32 * Math.cos((30 * Math.PI) / 180),
      0.32 * Math.sin((30 * Math.PI) / 180),
    ];
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
    const result = ce.expr(['AsOklch', ['Oklab', 0.7, 0.3, 0.1]]).evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(Math.hypot(0.3, 0.1), 6);
  });

  test('AsOklab(Oklch) keeps wide-gamut chroma without sRGB pinch', () => {
    // C=0.4, hue 30° → outside displayable red.
    const result = ce.expr(['AsOklab', ['Oklch', 0.7, 0.4, 30]]).evaluate();
    expect(result.operator).toBe('Oklab');
    expect(result.ops![0].re).toBeCloseTo(0.7, 6);
    expect(result.ops![1].re).toBeCloseTo(
      0.4 * Math.cos((30 * Math.PI) / 180),
      6
    );
    expect(result.ops![2].re).toBeCloseTo(
      0.4 * Math.sin((30 * Math.PI) / 180),
      6
    );
  });

  test('AsOklch(Oklab) round-trips wide-gamut alpha', () => {
    const result = ce.expr(['AsOklch', ['Oklab', 0.7, 0.3, 0, 0.5]]).evaluate();
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
      .expr(['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 1, 1, 1], 0.5])
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
      .expr(['ColorMix', ['Oklch', 0.2, 0, 100], ['Oklch', 0.8, 0, 200], 0.5])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops![1].re).toBeCloseTo(0, 6); // C stays 0
    expect(result.ops![2].re).toBe(100); // first endpoint's H wins
  });

});

describe('Regression: ColorFromColorspace accepts typed heads', () => {
  // Previously rejected with incompatible-type if the input wasn't a Tuple.
  // Should now accept any of the typed color heads as the components source.

  test('ColorFromColorspace accepts an Oklch head', () => {
    const result = ce
      .expr(['ColorFromColorspace', ['Oklch', 0.628, 0.258, 29.23], "'oklch'"])
      .evaluate();
    expect(result.operator).toBe('Oklch');
    expect(result.ops!.length).toBe(3);
    // Round-trip should land near pure red in 0-1 sRGB.
    const rgb = ce
      .expr(['ColorToColorspace', result.json, "'rgb'"])
      .evaluate()
      .ops!.map((op) => op.re);
    expect(rgb[0]).toBeCloseTo(1, 1);
    expect(rgb[1]).toBeCloseTo(0, 1);
    expect(rgb[2]).toBeCloseTo(0, 1);
  });

  test('ColorFromColorspace accepts an Rgb head with rgb space', () => {
    // A typed head at this position is read as RAW components in the named
    // space, whatever its own space is. Here the two agree, so the result is
    // the same color the head names.
    const result = ce
      .expr(['ColorFromColorspace', ['Rgb', 0.5, 0.25, 0.75], "'rgb'"])
      .evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops![0].re).toBeCloseTo(0.5, 6);
    expect(result.ops![1].re).toBeCloseTo(0.25, 6);
    expect(result.ops![2].re).toBeCloseTo(0.75, 6);
  });

  test('ColorFromColorspace still accepts a plain Tuple', () => {
    const result = ce
      .expr(['ColorFromColorspace', ['Tuple', 0.5, 0.25, 0.75], "'rgb'"])
      .evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops![0].re).toBeCloseTo(0.5, 6);
  });
});

describe('Regression: alpha normalization', () => {
  // Single rule: alpha is omitted from emitted expressions iff it is
  // undefined, non-finite, or within float-noise tolerance of 1.

  test('Rgb head with explicit alpha=1 emits 3-component output', () => {
    // The user wrote alpha=1 explicitly; semantically opaque, so the
    // round-trip should drop it (matches the "no explicit alpha" path).
    const result = ce.expr(['AsRgb', ['Rgb', 1, 0, 0, 1]]).evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBe(3);
  });

  test('user-supplied near-1 alpha (0.9999) is preserved', () => {
    // Tighter than the old 1e-4 threshold which would have silently dropped
    // this value. Now only float-noise (< 1e-9) is collapsed.
    const result = ce.expr(['AsRgb', ['Rgb', 1, 0, 0, 0.9999]]).evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBe(4);
    expect(result.ops![3].re).toBeCloseTo(0.9999, 6);
  });

  test('non-finite alpha is treated as opaque', () => {
    const result = ce.expr(['AsRgb', ['Rgb', 1, 0, 0, NaN]]).evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBe(3);
  });

  test('Tuple with non-finite alpha drops it', () => {
    const result = ce
      .expr(['ColorToString', ['Tuple', 1, 0, 0, NaN]])
      .evaluate();
    expect(result.string).toBe('#ff0000');
  });

  test('opaque hex string round-trips without alpha component', () => {
    // Color() parses the string; AsOklch is identity on the resulting Oklch.
    const expr = ce.expr(['AsOklch', ['Color', "'#ff0000'"]]).evaluate();
    expect(expr.operator).toBe('Oklch');
    expect(expr.ops!.length).toBe(3);
  });

  test('alpha=0 (fully transparent) is preserved', () => {
    const result = ce.expr(['AsRgb', ['Rgb', 1, 0, 0, 0]]).evaluate();
    expect(result.operator).toBe('Rgb');
    expect(result.ops!.length).toBe(4);
    expect(result.ops![3].re).toBe(0);
  });

});
