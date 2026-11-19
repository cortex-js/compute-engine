import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A compiled color VALUE on the JavaScript target is a flat object that
 * carries its own color space:
 *
 *     { space: 'oklch' | 'rgb' | 'hsv' | 'hsl' | 'oklab',
 *       c0, c1, c2, alpha }
 *
 * The five keys are always created in that order, and `alpha` is present and
 * `undefined` when the color carries none.
 *
 * Before this representation a color was a bare numeric array, and nothing at
 * run time told an OKLCh triple from an sRGB one. A conversion result reaching
 * a second color operator was read as OKLCh and answered a different color
 * from the interpreter, so the compiler declined the nesting statically; a
 * color could not be told from a list of three numbers; and a color expression
 * that declined ran to a scalar `NaN` because the interpreter fallback could
 * not serialize a color.
 *
 * The rules this file pins:
 *
 * - the object shape and key order of every constructor and every conversion,
 *   with and without alpha, and for a non-finite color;
 * - the round trips through `toOklch`, the one reader every color-consuming
 *   helper goes through;
 * - the nested conversions, which are now CORRECT rather than declined;
 * - a list of colors is a JavaScript array of these objects;
 * - a bare numeric array at a color position throws a named `TypeError`;
 * - the interpreter fallback answers the same object;
 * - the shader targets, where a color is a `vec3` in OKLCh with no run-time
 *   tag and the space is a compile-time fact instead.
 *
 * See "Color values" in `docs/COMPILATION-MODEL.md`.
 */

/**
 * Compile-time constant folding is off for every probe here. Most probes are
 * fully literal, and folding would otherwise evaluate them through the
 * INTERPRETER and emit one literal, erasing the lowering under test.
 */
const NO_FOLD = { constantFold: false } as const;

type Color = {
  space: string;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
};

/** Compile for the JavaScript target and run. */
function run(ce: ComputeEngine, expr: any, vars: any = {}): any {
  const compiled: any = compile(ce.box(expr), NO_FOLD as any);
  expect(compiled.success).toBe(true);
  return compiled.run(vars);
}

/** Compile for the JavaScript target and run, asserting a COLOR result. */
function runColor(ce: ComputeEngine, expr: any, vars: any = {}): Color {
  const v = run(ce, expr, vars);
  expect(Array.isArray(v)).toBe(false);
  expect(typeof v).toBe('object');
  return v as Color;
}

/** The channels of a color value, alpha appended when it carries one. */
function channels(c: Color): number[] {
  const out = [c.c0, c.c1, c.c2];
  if (c.alpha !== undefined) out.push(c.alpha);
  return out;
}

/**
 * Compare two channel arrays within the tolerance the color tests use.
 *
 * The two routes differ in the third significant digit of a channel that goes
 * through sRGB: the compiled converters round to 8-bit integer channels inside
 * `toRgb255` where the interpreter keeps the fractional 0-255 value. The
 * tolerance is an absolute part for a 0-1 channel plus a relative part for a
 * hue, which runs to 360 and moves by about a degree for the same reason.
 */
function expectChannelsClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(
      0.005 + 0.02 * Math.abs(expected[i])
    );
}

/**
 * The color space each of the interpreter's five typed color heads names.
 * `Rgb(r, g, b)` is `rgb`, `Hsv(h, s, v)` is `hsv`, and so on — the operand
 * order of the head is the channel order of the space.
 */
const HEAD_SPACE: Record<string, string> = {
  Rgb: 'rgb',
  Hsv: 'hsv',
  Hsl: 'hsl',
  Oklab: 'oklab',
  Oklch: 'oklch',
};

/**
 * Assert that a compiled color value is the color the interpreter answers for
 * the same expression: the same space, read off the head, and the same
 * channels.
 *
 * The two routes differ in the third significant digit of a channel that
 * passes through sRGB: the compiled converters round to 8-bit integer channels
 * inside `toRgb255` where the interpreter keeps the fractional 0-255 value.
 * That predates this work. The comparison therefore allows one 8-bit step and
 * what it grows to in a derived channel — an absolute part, and a relative
 * part for a hue, which runs to 360.
 */
function expectMatchesInterpreter(ce: ComputeEngine, expr: any): void {
  const compiled = runColor(ce, expr);
  const interpreted = ce.box(expr).evaluate();
  const space = HEAD_SPACE[interpreted.operator];
  expect(space).toBeDefined();
  expect(compiled.space).toBe(space);
  expectChannelsClose(
    channels(compiled),
    interpreted.ops!.map((op: any) => op.re)
  );
}

describe('the shape of a compiled color value', () => {
  test.each([
    ['Rgb', ['Rgb', 1, 0, 0]],
    ['Hsv', ['Hsv', 200, 0.5, 0.5]],
    ['Hsl', ['Hsl', 200, 0.5, 0.5]],
    ['Oklab', ['Oklab', 0.5, 0.1, 0.1]],
    ['Oklch', ['Oklch', 0.7, 0.2, 30]],
  ])('%s answers an OKLCh color value', (_name, expr) => {
    const ce = new ComputeEngine();
    const c = runColor(ce, expr);
    expect(c.space).toBe('oklch');
    // The five keys, always in this order: one hidden class for every color.
    expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    expect(c.alpha).toBeUndefined();
    for (const v of [c.c0, c.c1, c.c2]) expect(typeof v).toBe('number');
  });

  test.each([
    ['AsRgb', 'rgb'],
    ['AsHsv', 'hsv'],
    ['AsHsl', 'hsl'],
    ['AsOklab', 'oklab'],
    ['AsOklch', 'oklch'],
  ])('%s answers a color tagged with the space it names', (head, space) => {
    const ce = new ComputeEngine();
    const c = runColor(ce, [head, ['Hsv', 200, 0.5, 0.5]]);
    expect(c.space).toBe(space);
    expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
  });

  test('a compiled color matches the interpreter, head for space', () => {
    const ce = new ComputeEngine();
    for (const expr of [
      ['AsRgb', ['Hsv', 200, 0.5, 0.5]],
      ['AsHsv', ['Rgb', 1, 0, 0]],
      ['AsHsl', ['Rgb', 1, 0, 0]],
      ['AsOklab', ['Rgb', 1, 0, 0]],
      ['AsOklch', ['Hsv', 200, 0.5, 0.5]],
      ['AsRgb', ['Hsl', 200, 0.5, 0.5]],
    ])
      expectMatchesInterpreter(ce, expr);
  });
});

describe('every color-consuming helper reads the space tag', () => {
  // `toOklch` is the one reader. A color in any space converts to the same
  // OKLCh color it started from.
  const A = ['Hsv', 200, 0.5, 0.5];

  test.each(['AsRgb', 'AsHsv', 'AsHsl', 'AsOklab', 'AsOklch'])(
    'AsOklch of %s round trips',
    (head) => {
      const ce = new ComputeEngine();
      const direct = runColor(ce, ['AsOklch', A]);
      const round = runColor(ce, ['AsOklch', [head, A]]);
      expect(round.space).toBe('oklch');
      // The sRGB-based spaces take the 8-bit rounding of `toRgb255` on the way
      // through, which moves the third significant digit and, in a hue that
      // runs to 360, about a degree; `oklab` and `oklch` do not go through
      // sRGB at all and come back exactly. The tolerance is the one the other
      // color tests use: an absolute part plus a relative part.
      expectChannelsClose(channels(round), channels(direct));
    }
  );
});

describe('a nested conversion is CORRECT, not declined', () => {
  // These were compile-time DECLINE pins: with no space on the value, the
  // outer conversion read sRGB channels as `[L, C, H]` and answered a
  // different color from the interpreter, so the compiler failed closed.
  const A = ['Hsv', 0.3, 0.5, 0.5];

  test('AsRgb(AsRgb(c)) equals AsRgb(c) channel for channel', () => {
    const ce = new ComputeEngine();
    // `toRgb255` scales an sRGB color directly rather than routing it back
    // through OKLCh, so the second conversion is exactly the identity.
    expect(runColor(ce, ['AsRgb', ['AsRgb', A]])).toEqual(
      runColor(ce, ['AsRgb', A])
    );
  });

  test('AsHsv(AsRgb(c)) recovers the HSV color', () => {
    const ce = new ComputeEngine();
    const nested = runColor(ce, ['AsHsv', ['AsRgb', A]]);
    expect(nested.space).toBe('hsv');
    // The direct conversion is the constructor's own channels (CE-1535); the
    // nested one goes through sRGB and agrees within its rounding.
    const direct = runColor(ce, ['AsHsv', A]);
    for (const k of ['c0', 'c1', 'c2'] as const)
      expect(nested[k]).toBeCloseTo(direct[k], 9);
    expectMatchesInterpreter(ce, ['AsHsv', ['AsRgb', ['Hsv', 200, 0.5, 0.5]]]);
  });
});

describe('the interpreter fallback answers the same color object', () => {
  // `Totient` evaluates in the interpreter and has no JavaScript lowering, so
  // a color built from it declines and runs through the fallback. Before the
  // fallback could serialize a color it answered a scalar `NaN` for every such
  // expression, because `.re` of a color head is `NaN`.
  const DECLINING = ['Rgb', ['Divide', ['Totient', 10], 100], 0, 0];

  test('a declined color expression runs to the interpreter color', () => {
    const ce = new ComputeEngine();
    const compiled: any = compile(ce.box(DECLINING), NO_FOLD as any);
    expect(compiled.success).toBe(false);
    expect(compiled.run()).toEqual({
      space: 'rgb',
      c0: 0.04,
      c1: 0,
      c2: 0,
      alpha: undefined,
    });
  });

  test('a declined LIST of colors runs to an array of color objects', () => {
    const ce = new ComputeEngine();
    const compiled: any = compile(
      ce.box(['List', DECLINING, ['Hsv', 200, 0.5, 0.5]]),
      NO_FOLD as any
    );
    expect(compiled.success).toBe(false);
    const actual = compiled.run();
    expect(Array.isArray(actual)).toBe(true);
    expect(actual).toHaveLength(2);
    expect(actual[0].space).toBe('rgb');
    expect(actual[1].space).toBe('hsv');
  });

  test('the fallback normalizes alpha the way the compiled route does', () => {
    const ce = new ComputeEngine();
    const withAlpha: any = compile(
      ce.box(['Rgb', ['Divide', ['Totient', 10], 100], 0, 0, 0.5]),
      NO_FOLD as any
    );
    expect(withAlpha.success).toBe(false);
    expect(withAlpha.run().alpha).toBeCloseTo(0.5, 9);
    const opaque: any = compile(
      ce.box(['Rgb', ['Divide', ['Totient', 10], 100], 0, 0, 1]),
      NO_FOLD as any
    );
    expect(opaque.run().alpha).toBeUndefined();
  });
});

describe('the interpreter fallback CONSUMES a color object', () => {
  // `Totient` evaluates in the interpreter and has no JavaScript lowering, so
  // an expression using it declines and runs through the fallback.
  const DECLINING_CHANNEL = ['Divide', ['Totient', 10], 100];

  test('a color from one runner is a `vars` value for a declining one', () => {
    const ce = new ComputeEngine();
    const produced = runColor(ce, ['AsRgb', ['Hsv', 200, 0.5, 0.5]]);
    expect(produced.space).toBe('rgb');

    const ce2 = new ComputeEngine();
    ce2.declare('c', 'color');
    const expr = ['ColorMix', 'c', ['Rgb', DECLINING_CHANNEL, 0, 0], 0.5];
    const compiled: any = compile(ce2.box(expr), NO_FOLD as any);
    expect(compiled.success).toBe(false);
    // The interpreter's value for the same mix, with the color written out.
    const interpreted = ce2
      .box([
        'ColorMix',
        ['Hsv', 200, 0.5, 0.5],
        ['Rgb', DECLINING_CHANNEL, 0, 0],
        0.5,
      ])
      .evaluate();
    const actual = compiled.run({ c: produced });
    expect(actual.space).toBe('oklch');
    expectChannelsClose(
      channels(actual),
      interpreted.ops!.map((op: any) => op.re)
    );
  });

  test('an ARRAY of colors reaches the fallback element by element', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'list<color>');
    const one = runColor(ce, ['Hsv', 200, 0.5, 0.5]);
    const expr = [
      'ColorDelta',
      ['At', 'w', 1],
      ['Rgb', DECLINING_CHANNEL, 0, 0],
    ];
    const compiled: any = compile(ce.box(expr), NO_FOLD as any);
    expect(compiled.success).toBe(false);
    expect(compiled.run({ w: [one, one] })).toBeCloseTo(
      ce
        .box([
          'ColorDelta',
          ['Hsv', 200, 0.5, 0.5],
          ['Rgb', DECLINING_CHANNEL, 0, 0],
        ])
        .evaluate().re,
      6
    );
  });
});
