import { ComputeEngine } from '../../src/compute-engine';

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
