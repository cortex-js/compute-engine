import { ComputeEngine, compile } from '../../src/compute-engine';
import { parseOkColorString } from '../../src/compute-engine/numerics/color-conversion';

/**
 * CE-1415. A color written as an `oklch(…)` or `oklab(…)` string has the
 * channels it spells, with no clip to the sRGB gamut: `Color("oklch(50% 0.3
 * 240)")` is `Oklch(0.5, 0.3, 240)`, as the head is. The string was read to
 * an 8-bit sRGB value and back, and gave chroma 0.131 and hue 246.
 */

const ce = new ComputeEngine();

describe('CE-1415 oklch and oklab color strings', () => {

  test('a GLSL Color of an oklch string with an alpha declines', () => {
    const r = compile(
      ce.expr(['Color', { str: 'oklch(0.5 0.3 240 / 0.5)' }]),
      { to: 'glsl' }
    );
    expect(r.success).toBe(false);
  });
});

describe('parseOkColorString', () => {
  test('another notation is not read', () => {
    expect(parseOkColorString('#ff0000')).toBeUndefined();
    expect(parseOkColorString('rgb(1 0 0)')).toBeUndefined();
  });

  test('the CSS Color 4 units', () => {
    expect(parseOkColorString('oklch(40% 50% 0.25turn)')).toEqual({
      space: 'oklch',
      c0: 0.4,
      c1: 0.2,
      c2: 90,
    });
    expect(parseOkColorString('oklch(0.4 0.2 200grad)')!.c2).toBeCloseTo(180);
    expect(parseOkColorString('oklch(0.4 0.2 3.14159265358979rad)')!.c2)
      .toBeCloseTo(180, 10);
    expect(parseOkColorString('OKLCH(0.4, 0.2, -90deg)')).toEqual({
      space: 'oklch',
      c0: 0.4,
      c1: 0.2,
      c2: 270,
    });
    expect(parseOkColorString('oklab(50% -25% 0.1 / 25%)')).toEqual({
      space: 'oklab',
      c0: 0.5,
      c1: -0.1,
      c2: 0.1,
      alpha: 0.25,
    });
  });

  test('none, clamps and the conventions of parseColor()', () => {
    expect(parseOkColorString('oklch(none none none)')).toEqual({
      space: 'oklch',
      c0: 0,
      c1: 0,
      c2: 0,
    });
    // A lightness above 1 is a percentage; a negative chroma is 0.
    expect(parseOkColorString('oklch(50 -0.1 30)')).toEqual({
      space: 'oklch',
      c0: 0.5,
      c1: 0,
      c2: 30,
    });
    // An opaque alpha is absent.
    expect(parseOkColorString('oklch(0.5 0.1 30 / 1)')!.alpha).toBeUndefined();
    expect(parseOkColorString('oklch(0.5 0.1 30 / 1e999)')).toBeNull();
  });
});
