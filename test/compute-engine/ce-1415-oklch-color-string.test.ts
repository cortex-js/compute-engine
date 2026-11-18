import { ComputeEngine, compile } from '../../src/compute-engine';
import { parseOkColorString } from '../../src/compute-engine/numerics/color-conversion';

/**
 * CE-1415. A color written as an `oklch(…)` or `oklab(…)` string has the
 * channels it spells, with no clip to the sRGB gamut: `Color("oklch(50% 0.3
 * 240)")` is `Oklch(0.5, 0.3, 240)`, as the head is. The string was read to
 * an 8-bit sRGB value and back, and gave chroma 0.131 and hue 246.
 */

const ce = new ComputeEngine();

function evaluate(json: any): any {
  return ce.expr(json).evaluate().json;
}

function run(json: any): any {
  const r = compile(ce.expr(json));
  expect(r.success).toBe(true);
  return r.run!({});
}

describe('CE-1415 oklch and oklab color strings', () => {
  test('Color of an oklch string keeps its chroma and hue', () => {
    expect(evaluate(['Color', { str: 'oklch(50% 0.3 240)' }])).toEqual([
      'Oklch',
      0.5,
      0.3,
      240,
    ]);
    expect(run(['Color', { str: 'oklch(50% 0.3 240)' }])).toEqual({
      space: 'oklch',
      c0: 0.5,
      c1: 0.3,
      c2: 240,
      alpha: undefined,
    });
  });

  test('Color of an oklch string with an alpha', () => {
    expect(evaluate(['Color', { str: 'oklch(0.5 0.3 240 / 50%)' }])).toEqual(
      ['Oklch', 0.5, 0.3, 240, 0.5]
    );
    expect(run(['Color', { str: 'oklch(0.5 0.3 240 / 0.5)' }]).alpha).toBe(
      0.5
    );
  });

  test('Color of an oklab string is its OKLCh color', () => {
    const [, L, C, H] = evaluate(['Color', { str: 'oklab(0.5 0.1 -0.2)' }]);
    expect(L).toBe(0.5);
    expect(C).toBeCloseTo(Math.hypot(0.1, 0.2), 14);
    expect(H).toBeCloseTo(360 + (Math.atan2(-0.2, 0.1) * 180) / Math.PI, 10);
    const c = run(['Color', { str: 'oklab(0.5 0.1 -0.2)' }]);
    expect([c.c0, c.c1, c.c2]).toEqual([L, C, H]);
  });

  test('the string is the head on the other color operators', () => {
    const s = { str: 'oklch(50% 0.3 240)' };
    const head = ['Oklch', 0.5, 0.3, 240];
    for (const op of ['AsRgb', 'AsOklab', 'AsOklch', 'AsHsl']) {
      expect(evaluate([op, s])).toEqual(evaluate([op, head]));
      expect(run([op, s])).toEqual(run([op, head]));
    }
    for (const fmt of ['hex', 'oklch', 'display-p3']) {
      expect(evaluate(['ColorToString', s, { str: fmt }])).toEqual(
        evaluate(['ColorToString', head, { str: fmt }])
      );
      expect(run(['ColorToString', s, { str: fmt }])).toEqual(
        run(['ColorToString', head, { str: fmt }])
      );
    }
    expect(evaluate(['ColorToString', s, { str: 'oklch' }])).toBe(
      "'oklch(0.5 0.3 240)'"
    );
    expect(evaluate(['GamutMap', s])).toEqual(evaluate(['GamutMap', head]));
    expect(run(['GamutMap', s])).toEqual(run(['GamutMap', head]));
  });

  test('a GLSL Color of an oklch string literal keeps its chroma', () => {
    const r = compile(ce.expr(['Color', { str: 'oklch(50% 0.3 240)' }]), {
      to: 'glsl',
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('vec3(0.5, 0.3, 240.0)');
  });

  test('a GLSL Color of an oklch string with an alpha declines', () => {
    const r = compile(
      ce.expr(['Color', { str: 'oklch(0.5 0.3 240 / 0.5)' }]),
      { to: 'glsl' }
    );
    expect(r.success).toBe(false);
  });

  test('a malformed oklch string is not a color', () => {
    for (const s of [
      'oklch(foo 0.3 240)',
      'oklch(0.5 0.3)',
      'oklch(0.5 0.3 240 1 2)',
      'oklch(0.5 0.3deg 240)',
      'oklab(0.5 0.1 0.2deg)',
      'oklch()',
      'oklch(50 % 0.3 240)',
    ]) {
      expect(evaluate(['Color', { str: s }])).toEqual([
        'Error',
        ['ErrorCode', "'incompatible-type'", "'color'", `'"${s}"'`],
      ]);
      expect(() => run(['Color', { str: s }])).toThrow(/Unknown color/);
    }
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
