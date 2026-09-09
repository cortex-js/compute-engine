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
    ['Color', ['Color', { str: '#ff0000' }]],
    ['ColorMix', ['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1], 0.5]],
    ['ContrastingColor', ['ContrastingColor', ['Rgb', 1, 1, 1]]],
    [
      'ColorFromColorspace',
      ['ColorFromColorspace', ['Tuple', 1, 0, 0], { str: 'rgb' }],
    ],
    ['Colormap at a position', ['Colormap', { str: 'viridis' }, 0.5]],
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

  test('ColorToColorspace answers COMPONENTS, not a color value', () => {
    // The head is declared `-> tuple` and consumers index its result
    // (`At(ColorToColorspace(c, "rgb"), 1)`), so its compiled value is the
    // plain array of channels the interpreter's `Tuple` also emits — never a
    // color object, whose `c0` an index would read as `undefined`.
    const ce = new ComputeEngine();
    for (const space of ['rgb', 'hsv', 'hsl', 'oklab', 'oklch']) {
      const expr = ['ColorToColorspace', ['Rgb', 1, 0, 0], { str: space }];
      const v = run(ce, expr);
      expect(Array.isArray(v)).toBe(true);
      expect(v).toHaveLength(3);
      expectChannelsClose(
        v as number[],
        ce
          .box(expr)
          .evaluate()
          .ops!.map((op: any) => op.re)
      );
    }
    // The index a consumer writes reads the channel, on both routes.
    const at = [
      'At',
      ['ColorToColorspace', ['Rgb', 1, 0, 0], { str: 'rgb' }],
      1,
    ];
    expect(run(ce, at)).toBeCloseTo(ce.box(at).evaluate().re, 9);
  });

  test('an alpha is carried in the `alpha` key, never as a fourth channel', () => {
    const ce = new ComputeEngine();
    const c = runColor(ce, ['Rgb', 1, 0, 0, 0.5]);
    expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    expect(c.alpha).toBeCloseTo(0.5, 9);
    // An alpha of 1 is opaque, which is what `undefined` means, so it is
    // normalized away — the same rule `normalizeAlpha` applies everywhere.
    expect(runColor(ce, ['Rgb', 1, 0, 0, 1]).alpha).toBeUndefined();
    // A non-finite alpha reads as opaque on both routes.
    expect(
      runColor(ce, ['Rgb', 1, 0, 0, ['Divide', 1, 0]]).alpha
    ).toBeUndefined();
    // A conversion keeps the alpha.
    expect(runColor(ce, ['AsHsv', ['Rgb', 1, 0, 0, 0.5]]).alpha).toBeCloseTo(
      0.5,
      9
    );
  });

  test('a non-finite color is the same object with NaN channels', () => {
    const ce = new ComputeEngine();
    const c = runColor(ce, ['Hsv', 90, 1, ['Divide', 1, 0]]);
    expect(c).toEqual({
      space: 'oklch',
      c0: NaN,
      c1: NaN,
      c2: NaN,
      alpha: undefined,
    });
    expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    // A conversion answers the non-finite color in the space IT names.
    expect(runColor(ce, ['AsHsl', ['Hsv', 90, 1, ['Divide', 1, 0]]])).toEqual({
      space: 'hsl',
      c0: NaN,
      c1: NaN,
      c2: NaN,
      alpha: undefined,
    });
    // `ColorToColorspace` answers the `NaN` COMPONENTS. Its hue conversions
    // read the hue off `max`/`min` comparisons, and every comparison with
    // `NaN` is false, so without an explicit guard it answered a hue of zero
    // — red.
    expect(
      run(ce, [
        'ColorToColorspace',
        ['Hsv', 90, 1, ['Divide', 1, 0]],
        { str: 'hsv' },
      ])
    ).toEqual([NaN, NaN, NaN]);
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

  test('ColorToColorspace of a converted color is the conversion', () => {
    // The components `ColorToColorspace` answers are the channels the color
    // `AsRgb` answers, so reading the space tag off the operand is what makes
    // the two agree.
    const ce = new ComputeEngine();
    expectChannelsClose(
      run(ce, ['ColorToColorspace', ['AsHsv', A], { str: 'rgb' }]) as number[],
      channels(runColor(ce, ['AsRgb', A]))
    );
  });
});

describe('a nested conversion is CORRECT, not declined', () => {
  // These were compile-time DECLINE pins: with no space on the value, the
  // outer conversion read sRGB channels as `[L, C, H]` and answered a
  // different color from the interpreter, so the compiler failed closed.
  const A = ['Hsv', 0.3, 0.5, 0.5];
  const B = ['Rgb', 0, 0, 1];

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
    expect(nested).toEqual(runColor(ce, ['AsHsv', A]));
    // Against the interpreter, with a hue that survives the 8-bit sRGB step.
    // A hue of 0.3 degrees does not: both compiled routes answer 0 for it,
    // which is the documented third-digit difference between the routes.
    expectMatchesInterpreter(ce, ['AsHsv', ['AsRgb', ['Hsv', 200, 0.5, 0.5]]]);
  });

  test('ColorDelta(AsRgb(a), b) equals ColorDelta(a, b)', () => {
    const ce = new ComputeEngine();
    expect(run(ce, ['ColorDelta', ['AsRgb', A], B])).toBeCloseTo(
      run(ce, ['ColorDelta', A, B]),
      2
    );
  });

  test('the compiled code is the plain nesting, with no guard left', () => {
    const ce = new ComputeEngine();
    const compiled: any = compile(
      ce.box(['AsRgb', ['AsRgb', A]]),
      NO_FOLD as any
    );
    expect(compiled.success).toBe(true);
    expect(compiled.code).toBe(
      '_SYS.asRgb(_SYS.asRgb(_SYS.hsv(0.3, 0.5, 0.5)))'
    );
  });

  test('AsOklch of a converted color is no longer the identity', () => {
    // `AsOklch` passes a color VALUE straight through, but only where the
    // compiler can see the operand is already canonical. A conversion, a
    // symbol and a `vars` input all go through `_SYS.asOklch`, which reads
    // the space tag.
    const ce = new ComputeEngine();
    expect(
      (compile(ce.box(['AsOklch', ['AsRgb', A]]), NO_FOLD as any) as any).code
    ).toBe('_SYS.asOklch(_SYS.asRgb(_SYS.hsv(0.3, 0.5, 0.5)))');
    expect(
      (
        compile(
          ce.box(['AsOklch', ['Oklch', 0.7, 0.2, 30]]),
          NO_FOLD as any
        ) as any
      ).code
    ).toBe('_SYS.oklch(0.7, 0.2, 30)');
  });
});

describe('a list of colors is an array of color objects', () => {
  test('a literal list maps through `_SYS.bcastColor`', () => {
    const ce = new ComputeEngine();
    const expr = [
      'AsRgb',
      ['List', ['Hsv', 20, 0.5, 0.5], ['Hsv', 200, 0.5, 0.5]],
    ];
    const compiled: any = compile(ce.box(expr), NO_FOLD as any);
    expect(compiled.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), ' +
        '[_SYS.hsv(20, 0.5, 0.5), _SYS.hsv(200, 0.5, 0.5)])'
    );
    const actual = compiled.run();
    expect(Array.isArray(actual)).toBe(true);
    expect(actual).toHaveLength(2);
    for (const c of actual) {
      expect(c.space).toBe('rgb');
      expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    }
    expect(actual[0]).not.toEqual(actual[1]);
  });

  test('an ARRAY is always a list, at any depth', () => {
    // The run-time discriminator is no longer the nesting: a color VALUE is an
    // object, so an array is a list whatever it holds.
    const ce = new ComputeEngine();
    ce.declare('w', 'broadcastable<color>');
    const compiled: any = compile(ce.box(['AsRgb', 'w']), NO_FOLD as any);
    const one = run(ce, ['Hsv', 200, 0.5, 0.5]);

    expect(compiled.run({ w: one }).space).toBe('rgb');
    expect(compiled.run({ w: [one, one] })).toHaveLength(2);
    expect(compiled.run({ w: [[one], [one, one]] })[1]).toHaveLength(2);
    // A color STRING is one color, and a list of them is a list.
    expect(compiled.run({ w: 'red' }).space).toBe('rgb');
    expect(compiled.run({ w: ['red', 'red'] })).toHaveLength(2);
    // An empty array is the empty list; a broadcast over an empty operand is
    // `Nothing` in the interpreter, which this target spells `NaN`.
    expect(compiled.run({ w: [] })).toBeNaN();
  });

  test('Colormap answers an array of color objects', () => {
    const ce = new ComputeEngine();
    const palette = run(ce, ['Colormap', { str: 'viridis' }, 5]);
    expect(Array.isArray(palette)).toBe(true);
    expect(palette).toHaveLength(5);
    for (const c of palette) expect(c.space).toBe('oklch');
  });
});

describe('a bare numeric array is not a color', () => {
  test('a color helper handed one throws a TypeError naming the shape', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'color');
    const compiled: any = compile(ce.box(['AsRgb', 'c']), NO_FOLD as any);
    expect(compiled.success).toBe(true);
    // The pre-2026-09 representation of a color: the OKLCh triple.
    expect(() => compiled.run({ c: [0.5, 0.1, 20] })).toThrow(TypeError);
    expect(() => compiled.run({ c: [0.5, 0.1, 20] })).toThrow(
      /Not a color.*bare numeric array is a LIST/s
    );
  });

  test('the throw names every accepted spelling', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'color');
    const compiled: any = compile(
      ce.box(['ColorDelta', 'c', ['Rgb', 0, 0, 1]]),
      NO_FOLD as any
    );
    let message = '';
    try {
      compiled.run({ c: 42 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('space');
    expect(message).toContain("'oklch'");
    expect(message).toContain('CSS color string');
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

describe('the shader targets keep the vec3 OKLCh color', () => {
  const glsl = (ce: ComputeEngine, expr: any): any =>
    compile(ce.box(expr), { ...NO_FOLD, to: 'glsl' } as any);

  test('AsRgb of a color constructor is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    // The direct sRGB constructor still folds its perceptual round trip.
    expect(glsl(ce, ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]).code).toBe(
      '_gpu_srgb_roundtrip(_gpu_hsv_to_rgb(vec3(u, 0.5, 0.5)))'
    );
    expect(glsl(ce, ['AsRgb', ['Rgb', 'u', 0, 0]]).code).toBe(
      '_gpu_srgb_roundtrip(vec3(u, 0.0, 0.0))'
    );
  });

  test('a nested conversion is converted back to OKLCh statically', () => {
    // A shader color is a bare `vec3` with no run-time tag, so the space has
    // to be known at compile time. `colorSpaceOf` reports `rgb` for the inner
    // `AsRgb`, and the operand is converted back before the outer conversion
    // reads it. Every reverse helper the four named spaces need is already in
    // the preamble, so nothing has to be declined here.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    expect(glsl(ce, ['AsHsv', ['AsRgb', ['Hsv', 'u', 0.5, 0.5]]]).code).toBe(
      '_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(_gpu_srgb_to_oklch(' +
        '_gpu_srgb_roundtrip(_gpu_hsv_to_rgb(vec3(u, 0.5, 0.5))))))'
    );
    // The HSV operand of a second conversion takes the hsv → sRGB → OKLCh
    // chain.
    expect(
      glsl(ce, ['AsOklab', ['AsHsv', ['Hsv', 'u', 0.5, 0.5]]]).code
    ).toContain('_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(');
  });

  test('an operand of unknown space keeps the OKLCh reading', () => {
    // A symbol may hold any color at run time and a shader `vec3` carries no
    // tag, so the value is read as OKLCh — the shader color contract.
    const ce = new ComputeEngine();
    ce.declare('c', 'color');
    expect(glsl(ce, ['AsRgb', 'c']).code).toBe('_gpu_oklch_to_srgb(c)');
  });

  test('a user function with a VISIBLE body answers its body fact', () => {
    // The one shape the fact could not see: a user function returning a
    // CONVERTED color into a shader color position. Where the body is visible
    // the fact follows it and the conversion back to OKLCh is emitted; where
    // it is not — a `vars`-supplied callable, a multi-clause definition — the
    // fact is unknown and the value is read as OKLCh.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.assign(
      'f',
      ce.parse(
        'x \\mapsto \\operatorname{AsRgb}(\\operatorname{Hsv}(x,0.5,0.5))'
      )
    );
    expect(glsl(ce, ['AsHsv', ['f', 'u']]).code).toBe(
      '_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(_gpu_srgb_to_oklch(_fn_f(u))))'
    );

    const ce2 = new ComputeEngine();
    ce2.declare('u', 'number');
    ce2.assign('g', ce2.parse('x \\mapsto \\operatorname{Hsv}(x,0.5,0.5)'));
    // An OKLCh body needs no conversion, so the emission is unchanged.
    expect(glsl(ce2, ['AsHsv', ['g', 'u']]).code).toBe(
      '_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(_fn_g(u)))'
    );
  });

  test('a user function with a colour RETURN ANNOTATION answers its body fact', () => {
    // The normalized spelling of a return-type ascription is `Typed`, which
    // wraps the value it ascribes. Read past it, the body's `AsRgb` is
    // invisible and the shader read the sRGB channels as OKLCh.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Typed', ['AsRgb', ['Hsv', 'x', 0.5, 0.5]], { str: 'color' }],
        ['Typed', 'x', { str: 'number' }],
      ])
    );
    expect(glsl(ce, ['AsHsv', ['h', 'u']]).code).toBe(
      '_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(_gpu_srgb_to_oklch(_fn_h(u))))'
    );
  });

  test('a selection whose arms AGREE on a space is converted', () => {
    // A shader color is a bare `vec3`, so a selection between two converted
    // colors has to be converted back to OKLCh before a color operand reads
    // it. The fact is the space the arms agree on.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('v', 'number');
    const converted = (n: string) => ['AsRgb', ['Hsv', n, 0.5, 0.5]];
    const which = [
      'Which',
      ['Greater', 'u', 0],
      converted('u'),
      'True',
      converted('v'),
    ];
    expect(glsl(ce, ['ColorMix', which, ['Rgb', 0, 0, 1], 0.5]).code).toContain(
      '_gpu_color_mix(_gpu_srgb_to_oklch('
    );
    // `If` selects the same way, between its second and third operands.
    expect(
      glsl(ce, [
        'ColorMix',
        ['If', ['Greater', 'u', 0], converted('u'), converted('v')],
        ['Rgb', 0, 0, 1],
        0.5,
      ]).code
    ).toContain('_gpu_color_mix(_gpu_srgb_to_oklch(');
  });

  test('a selection whose arms DISAGREE declines', () => {
    // Nothing at run time tells the shader which arm the `vec3` came from, so
    // reading it as OKLCh would answer a different color for at least one of
    // the selection's run-time values.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('v', 'number');
    const which = [
      'Which',
      ['Greater', 'u', 0],
      ['AsRgb', ['Hsv', 'u', 0.5, 0.5]],
      'True',
      ['AsHsv', ['Hsv', 'v', 0.5, 0.5]],
    ];
    const declined = glsl(ce, ['ColorMix', which, ['Rgb', 0, 0, 1], 0.5]);
    expect(declined.success).toBe(false);
    expect(declined.error).toContain('cannot settle the color space');
    // A selection between two colors that are already canonical is unaffected.
    expect(
      glsl(ce, [
        'ColorMix',
        [
          'Which',
          ['Greater', 'u', 0],
          ['Hsv', 'u', 0.5, 0.5],
          'True',
          ['Rgb', 'v', 0, 0],
        ],
        ['Rgb', 0, 0, 1],
        0.5,
      ]).success
    ).toBe(true);
  });

  test('a plain unknown keeps the OKLCh reading', () => {
    // The decline above is only for an operand the compiler can SEE holds a
    // converted color. A symbol or a `vars` uniform says nothing, and the
    // shader's `vec3` color contract is that such a value is canonical.
    const ce = new ComputeEngine();
    ce.declare('c', 'color');
    expect(glsl(ce, ['ColorMix', 'c', ['Rgb', 0, 0, 1], 0.5]).code).toBe(
      '_gpu_color_mix(c, _gpu_srgb_to_oklch(vec3(0.0, 0.0, 1.0)), 0.5)'
    );
  });
});

describe('a color-valued expression is not constant-folded', () => {
  // The interpreter's value for a color is a typed head, whose literal
  // emission is a bare numeric array — a LIST on this target, never a color.
  // So the fold is skipped for every color-VALUED expression, whatever head
  // built it, and the color lowering runs instead.

  test('a fully literal color keeps its lowering', () => {
    const ce = new ComputeEngine();
    // Folding is ON here: this is what the exclusion is for.
    const compiled: any = compile(ce.box(['Which', 'True', ['Rgb', 1, 0, 0]]));
    expect(compiled.success).toBe(true);
    expect(compiled.code).toContain('_SYS.rgb(1, 0, 0)');
    expect(compiled.run().space).toBe('oklch');
  });

  test('a components tuple MAY fold, and folds to the interpreter tuple', () => {
    // `ColorToColorspace` answers components, and its space operand may be a
    // symbol bound to a string — which the fact cannot read but the
    // interpreter can. Folded or not, the value is the same 3-array.
    const ce = new ComputeEngine();
    ce.assign('s', ce.string('hsl'));
    const expr = ['ColorToColorspace', ['Rgb', 1, 0, 0], 's'];
    const folded: any = compile(ce.box(expr));
    expect(folded.success).toBe(true);
    expect(folded.run()).toEqual([0, 1, 0.5]);
    expect(
      ce
        .box(expr)
        .evaluate()
        .ops!.map((op: any) => op.re)
    ).toEqual([0, 1, 0.5]);
  });
});

describe('ContrastingColor answers a CANONICAL color', () => {
  test('the chosen candidate is normalized to OKLCh', () => {
    // The head PRODUCES a color, so its value is canonical whatever space the
    // chosen candidate was written in — which is the space `colorSpaceOf`
    // reports for it. Answering the candidate in its own space made
    // `AsOklch(ContrastingColor(…))` skip a conversion it still needed, and
    // the sRGB channels of the candidate were read as `[L, C, H]`.
    const ce = new ComputeEngine();
    const bg = ['Rgb', 0, 0, 0];
    const a = ['AsRgb', ['Hsv', 200, 0.5, 0.5]];
    const b = ['AsRgb', ['Hsv', 20, 0.5, 0.5]];
    expect(runColor(ce, ['ContrastingColor', bg, a, b]).space).toBe('oklch');
    expectMatchesInterpreter(ce, ['AsOklch', ['ContrastingColor', bg, a, b]]);
  });
});

describe('an unknown color space is refused, not read as OKLCh', () => {
  test('a color value carrying an unrecognized space throws by name', () => {
    // The readers switch on the space, so an unrecognized spelling would take
    // the OKLCh arm and answer a plausible but wrong color.
    const ce = new ComputeEngine();
    ce.declare('c', 'color');
    const compiled: any = compile(ce.box(['AsRgb', 'c']), NO_FOLD as any);
    expect(compiled.success).toBe(true);
    const bad = { space: 'srgb', c0: 1, c1: 0, c2: 0, alpha: undefined };
    expect(() => compiled.run({ c: bad })).toThrow(TypeError);
    expect(() => compiled.run({ c: bad })).toThrow(
      /"srgb" is not a color space/
    );
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
