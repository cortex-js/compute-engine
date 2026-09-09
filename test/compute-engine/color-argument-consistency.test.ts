import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

/**
 * Every color operator takes the same argument spellings — a typed color head
 * (`Rgb`/`Hsv`/`Hsl`/`Oklab`/`Oklch`), a CSS-style color string, or a 0-1 sRGB
 * tuple — and the interpreter, the JavaScript target and the GPU targets must
 * answer the same color for the same input. This file checks that agreement
 * route by route.
 *
 * A bare tuple at a color position denotes 0-1 sRGB on EVERY route. A color
 * VALUE on the compiled targets is the canonical OKLCh triple, so a tuple
 * written at the call site is converted there with the same conversion
 * `Rgb(r, g, b)` takes. Only a tuple written literally can be recognized: one
 * that arrives through a variable has no shape at compile time and keeps the
 * canonical reading.
 */

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

/**
 * Compile-time constant folding is off for every compiled probe here. Each
 * probe is a fully literal color expression, which the compiler would
 * otherwise evaluate through the INTERPRETER and emit as one literal —
 * erasing the very lowering under test and making the route comparison
 * vacuous.
 */
const NO_FOLD = { constantFold: false } as const;

/** Evaluate an expression through the interpreter. */
const interp = (expr: any) => ce.expr(expr).evaluate();

/** Run an expression through the JavaScript target. `null` when it declines. */
function runJS(expr: any): any {
  const compiled: any = compile(ce.expr(expr), NO_FOLD as any);
  return compiled?.run === undefined ? null : compiled.run();
}

// ---------------------------------------------------------------------------
// A miniature GLSL evaluator for the color preamble.
//
// The emitted shader source is EVALUATED, not merely inspected: a lowering
// that emits plausible-looking code while computing a different color than the
// interpreter is exactly the failure this file is about. The translation
// covers the subset the color preamble uses — `float`/`vec3` declarations,
// component swizzles, `if`/`else`, the ternary, and the builtins listed in
// `GLSL_BUILTINS`. It is not a GLSL implementation and is not meant to grow
// into one.
// ---------------------------------------------------------------------------

type Vec = { x: number; y: number; z?: number };

// GLSL's vector constructors broadcast a single argument to every component,
// so `vec3(0.0)` is black and not a triple with two missing components.
const V3 = (x: number, y?: number, z?: number) =>
  y === undefined ? { x, y: x, z: x } : { x, y, z: z as number };
const V2 = (x: number, y?: number) =>
  y === undefined ? { x, y: x } : { x, y };

const isVec = (v: unknown): v is Vec =>
  typeof v === 'object' && v !== null && 'x' in v;

const GLSL_BUILTINS = {
  V3,
  V2,
  pow: Math.pow,
  abs: Math.abs,
  cos: Math.cos,
  sin: Math.sin,
  sqrt: Math.sqrt,
  floor: Math.floor,
  sign: Math.sign,
  atan: (y: number, x?: number) =>
    x === undefined ? Math.atan(y) : Math.atan2(y, x),
  max: (a: number, b: number) => Math.max(a, b),
  min: (a: number, b: number) => Math.min(a, b),
  // GLSL `mod` is the floored remainder, unlike JavaScript's `%`.
  mod: (a: number, b: number) => a - b * Math.floor(a / b),
  mix: (a: number, b: number, t: number) => a + (b - a) * t,
  length: (v: Vec) => Math.hypot(v.x, v.y, ...(v.z === undefined ? [] : [v.z])),
  /** The `.yz` swizzle of a triple. */
  __yz: (v: Vec) => V2(v.y, v.z as number),
  clamp: (v: Vec | number, lo: number, hi: number) =>
    isVec(v)
      ? V3(
          Math.min(Math.max(v.x, lo), hi),
          Math.min(Math.max(v.y, lo), hi),
          Math.min(Math.max(v.z!, lo), hi)
        )
      : Math.min(Math.max(v, lo), hi),
};

/** Translate the GLSL subset used by the color preamble to JavaScript. */
function glslToJS(src: string): string {
  return (
    src
      // Function declarations: drop the return type and the parameter types.
      .replace(
        /^(?:float|vec2|vec3|bool|int)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
        (_m, name: string, params: string) =>
          `function ${name}(${params
            .split(',')
            .map((p) => p.trim().split(/\s+/).pop() ?? '')
            .filter((p) => p.length > 0)
            .join(', ')}) {`
      )
      // Local declarations, with and without an initializer (`_gpu_color_mix`
      // declares `float H;` and assigns it in the branches below).
      .replace(/\b(?:float|vec2|vec3|bool|int)\s+(\w+)\s*=/g, 'let $1 =')
      .replace(/\b(?:float|vec2|vec3|bool|int)\s+(\w+)\s*;/g, 'let $1;')
      // Constructors.
      .replace(/\bvec3\s*\(/g, 'V3(')
      .replace(/\bvec2\s*\(/g, 'V2(')
      // The `.yz` swizzle is the only multi-component one the preamble uses,
      // and it is always taken of a plain identifier.
      .replace(/\b(\w+)\.yz\b/g, '__yz($1)')
  );
}

/**
 * Compile `expr` to GLSL and evaluate the emitted source. Returns a number for
 * a scalar-valued expression and a `{x, y, z}` triple for a color.
 */
function evalGLSL(expr: any): any {
  const r = glsl.compile(ce.expr(expr), NO_FOLD as any);
  const body = `${glslToJS(r.preamble ?? '')}\nreturn (${glslToJS(r.code!)});`;
  const names = Object.keys(GLSL_BUILTINS);
  // eslint-disable-next-line no-new-func
  const f = new Function(...names, body);
  return f(...names.map((n) => GLSL_BUILTINS[n as keyof typeof GLSL_BUILTINS]));
}

/**
 * Whether the JavaScript target DECLINED to lower `expr`.
 *
 * A codegen handler that throws is caught by the shared compiler, which falls
 * back to the interpreter and emits no code of its own — an empty `code` is
 * how that decline shows up to a caller.
 */
function jsDeclines(expr: any): boolean {
  const compiled: any = compile(ce.expr(expr), NO_FOLD as any);
  return compiled?.code === '';
}

/** The `[L, C, H]` components of an interpreted color, in OKLCh. */
function interpOklch(expr: any): number[] {
  const r = interp(['AsOklch', expr]);
  return r.ops!.slice(0, 3).map((op) => op.re);
}

describe('color strings are refused the same way by every operator', () => {
  // `parseColor()` answers 0 both for an unrecognized string and for
  // transparent black. Only `Color` told the two apart, so every other
  // operator read a misspelled color as transparent black and answered a
  // plausible-looking color instead of an error.
  test.each([
    ['Color', ['Color', "'bogus'"]],
    ['ColorMix', ['ColorMix', "'bogus'", "'#ffffff'", 0.5]],
    ['ColorToString', ['ColorToString', "'bogus'"]],
    ['ColorContrast', ['ColorContrast', "'bogus'", "'#ffffff'"]],
    ['ColorDelta', ['ColorDelta', "'bogus'", "'#ffffff'"]],
    ['ColorToColorspace', ['ColorToColorspace', "'bogus'", "'rgb'"]],
    ['ContrastingColor', ['ContrastingColor', "'bogus'"]],
    ['AsRgb', ['AsRgb', "'bogus'"]],
    ['AsOklch', ['AsOklch', "'bogus'"]],
  ])('%s refuses a string that names no color', (_name, expr) => {
    expect(interp(expr).operator).toBe('Error');
  });

  test('the compiled JavaScript runtime refuses it too', () => {
    // Before the fix `_SYS.color('bogus')` answered transparent black, so a
    // misspelled color compiled to a silent value.
    const compiled: any = compile(ce.expr(['Color', "'x'"]), NO_FOLD as any);
    expect(() => compiled.run()).toThrow(/Unknown color/);
  });

  test('`transparent` stays a color on both routes', () => {
    const r = interp(['Color', "'transparent'"]);
    expect(r.operator).toBe('Oklch');
    expect(r.ops!.map((op) => op.re)).toEqual([0, 0, 0, 0]);
    expect(runJS(['Color', "'transparent'"])).toEqual([0, 0, 0, 0]);
  });
});

describe('a bare tuple is 0-1 sRGB on every route', () => {
  test('ColorMix of two tuples mixes red with blue everywhere', () => {
    const expr = ['ColorMix', ['Tuple', 1, 0, 0], ['Tuple', 0, 0, 1], 0.5];
    // The same mix written with typed heads, which never had a route split.
    const expected = interp([
      'ColorMix',
      ['Rgb', 1, 0, 0],
      ['Rgb', 0, 0, 1],
      0.5,
    ]);
    expect(interp(expr).toString()).toBe(expected.toString());
    const components = expected.ops!.slice(0, 3).map((op) => op.re);
    expect(components[0]).toBeCloseTo(0.54, 2);
    expect(components[1]).toBeCloseTo(0.285, 2);
    expect(components[2]).toBeCloseTo(326.6, 1);

    // Before the ruling the compiled routes read the same two tuples as OKLCh
    // triples and answered [0.5, 0, 0] — a dark red, not the red/blue mix.
    const js = runJS(expr);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(components[i], 12);

    const code = glsl.compile(ce.expr(expr), NO_FOLD as any).code!;
    expect(code).toBe(
      '_gpu_color_mix(_gpu_srgb_to_oklch(vec3(1.0, 0.0, 0.0)), ' +
        '_gpu_srgb_to_oklch(vec3(0.0, 0.0, 1.0)), 0.5)'
    );
    const shader = evalGLSL(expr);
    expect(shader.x).toBeCloseTo(components[0], 6);
    expect(shader.y).toBeCloseTo(components[1], 6);
    expect(shader.z).toBeCloseTo(components[2], 4);
  });

  test('ColorToString of a tuple is the sRGB color', () => {
    const expr = ['ColorToString', ['Tuple', 1, 0, 0]];
    expect(interp(expr).string).toBe('#ff0000');
    // Read as OKLCh this tuple is L = 1, which printed as `#ffffff`.
    expect(runJS(expr)).toBe('#ff0000');
  });

  test('ColorDelta and ColorToColorspace of tuples agree with the interpreter', () => {
    const delta = ['ColorDelta', ['Tuple', 1, 0, 0], ['Tuple', 0, 0, 1]];
    expect(runJS(delta)).toBeCloseTo(interp(delta).re, 12);

    const space = ['ColorToColorspace', ['Tuple', 1, 0, 0], "'hsl'"];
    const expected = interp(space).ops!.map((op) => op.re);
    expect(expected).toEqual([0, 1, 0.5]);
    expect(runJS(space)).toEqual(expected);
  });

  test('ContrastingColor of a tuple background agrees with the interpreter', () => {
    const expr = ['ContrastingColor', ['Tuple', 1, 0, 0]];
    // Red is a dark background, so white wins. Read as OKLCh the same tuple
    // is L = 1 — a white background — and the compiled routes chose black.
    const picked = interp(expr);
    expect(picked.ops![0].re).toBe(1);
    const js = runJS(expr);
    // The compiled form of white is L = 1, achromatic.
    expect(js[0]).toBeCloseTo(1, 6);
    expect(js[1]).toBeCloseTo(0, 6);

    const shader = evalGLSL(expr);
    expect(shader.x).toBeCloseTo(1, 6);
  });

  test('the As* conversions read a tuple as sRGB on the shader too', () => {
    // `AsOklch` is the identity on a color VALUE, so a tuple passed through
    // unconverted was answered verbatim as though it were already OKLCh.
    expect(
      glsl.compile(
        ce.expr(['AsOklch', ['Tuple', 0.5, 0.2, 0.1]]),
        NO_FOLD as any
      ).code
    ).toBe('_gpu_srgb_to_oklch(vec3(0.5, 0.2, 0.1))');
    const shader = evalGLSL(['AsOklch', ['Tuple', 0.5, 0.2, 0.1]]);
    const expected = interpOklch(['Tuple', 0.5, 0.2, 0.1]);
    expect(shader.x).toBeCloseTo(expected[0], 6);
    expect(shader.y).toBeCloseTo(expected[1], 6);
    expect(shader.z).toBeCloseTo(expected[2], 4);
  });

  test('a tuple that arrives through a VARIABLE keeps the canonical reading', () => {
    // Documented behaviour, not an oversight: a variable has no shape at
    // compile time, so the compiled targets cannot tell a tuple of sRGB
    // components from the color value they already hold as three numbers.
    // The value a variable carries at run time IS the canonical color, so it
    // is passed through unconverted.
    const cev = new ComputeEngine();
    cev.declare('v', 'tuple<number, number, number>');
    const expr = cev.expr(['ColorMix', 'v', ['Rgb', 0, 0, 1], 0.5]);
    expect((compile(expr, NO_FOLD as any) as any).code).toBe(
      '_SYS.colorMix(_.v, _SYS.rgb(0, 0, 1), 0.5)'
    );
    expect(new GLSLTarget().compile(expr, NO_FOLD as any).code).toBe(
      '_gpu_color_mix(v, _gpu_srgb_to_oklch(vec3(0.0, 0.0, 1.0)), 0.5)'
    );
  });
});

describe('a well-formed color spelling that packs to zero is transparent black', () => {
  // `parseColor()` answers 0 both for transparent black and for a string that
  // is not a color, so the two are told apart by the spelling.
  test.each(['#00000000', 'rgba(0,0,0,0)', 'rgb(0 0 0 / 0)', 'transparent'])(
    '%s is a color',
    (spelling) => {
      const r = interp(['Color', `'${spelling}'`]);
      expect(r.operator).toBe('Oklch');
      expect(r.ops!.map((op) => op.re)).toEqual([0, 0, 0, 0]);
      expect(runJS(['Color', `'${spelling}'`])).toEqual([0, 0, 0, 0]);
    }
  );

  test('a transparent-black string mixes like any other color', () => {
    const expr = ['ColorMix', "'#00000000'", "'#ffffff'", 0.5];
    const r = interp(expr);
    expect(r.operator).toBe('Oklch');
    const js = runJS(expr);
    expect(js).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(js[i]).toBeCloseTo(r.ops![i].re, 12);
  });

  test.each([
    'bogus',
    '#gg0000',
    '#00000',
    'hsla(0,0%,0%,0)',
    // An unterminated or empty functional spelling packs to zero as well, so
    // testing only the opening prefix read a typing mistake as transparent
    // black. The whole form is anchored.
    'rgb(255,0,0',
    'oklch(',
    'rgba()',
  ])('%s is not a color', (spelling) => {
    // `parseColor()` does not check the digits of a `#` form — it reads
    // `#gg0000` as opaque black — so the shape is checked before parsing.
    expect(interp(['Color', `'${spelling}'`]).operator).toBe('Error');
    expect(() => runJS(['Color', `'${spelling}'`])).toThrow(/Unknown color/);
    // The shader route parses the literal at compile time through the same
    // predicate. It used to read the zero packing as "not a color", so
    // `Color("#gg0000")` compiled to opaque black — a wrong value behind a
    // reported success.
    expect(() =>
      glsl.compile(ce.expr(['Color', `'${spelling}'`]), NO_FOLD as any)
    ).toThrow(/invalid color string/);
  });

  test('a transparent spelling reaches the shader as an alpha decline', () => {
    // On the shader a color value is a `vec3` with no alpha channel, so a
    // transparent color is declined — but for carrying alpha, not for being
    // an unknown name.
    for (const spelling of ['#00000000', 'rgba(0,0,0,0)', 'transparent'])
      expect(() =>
        glsl.compile(ce.expr(['Color', `'${spelling}'`]), NO_FOLD as any)
      ).toThrow(/carries an alpha channel/);
  });
});

describe('a four-digit hex color is #rgba', () => {
  // `parseColor()` reads a `#` form of 3, 6 or 8 digits only and answers its
  // zero packing for any other length, so `#f00f` — opaque red in CSS — was
  // read as transparent black. Each digit is doubled before the parse.
  test('#f00f is opaque red on every route', () => {
    const red = interp(['Color', "'#ff0000'"]);
    const r = interp(['Color', "'#f00f'"]);
    expect(r.operator).toBe('Oklch');
    expect(r.toString()).toBe(red.toString());
    expect(runJS(['Color', "'#f00f'"])).toEqual(runJS(['Color', "'#ff0000'"]));
    expect(
      glsl.compile(ce.expr(['Color', "'#f00f'"]), NO_FOLD as any).code
    ).toBe(glsl.compile(ce.expr(['Color', "'#ff0000'"]), NO_FOLD as any).code);
  });

  test('#0000 is transparent black', () => {
    const r = interp(['Color', "'#0000'"]);
    expect(r.operator).toBe('Oklch');
    expect(r.ops!.map((op) => op.re)).toEqual([0, 0, 0, 0]);
    expect(runJS(['Color', "'#0000'"])).toEqual([0, 0, 0, 0]);
  });

  test('#f00 still expands to opaque red', () => {
    expect(interp(['Color', "'#f00'"]).toString()).toBe(
      interp(['Color', "'#ff0000'"]).toString()
    );
    expect(runJS(['Color', "'#f00'"])).toEqual(runJS(['Color', "'#ff0000'"]));
  });

  test('#f008 is red at half alpha', () => {
    // The 4th digit is the alpha digit, doubled like the others: `8` → `0x88`.
    expect(interp(['Color', "'#f008'"]).toString()).toBe(
      interp(['Color', "'#ff000088'"]).toString()
    );
  });
});

describe('the As* conversions take the same argument spellings as ColorMix', () => {
  test('a color string converts', () => {
    expect(interp(['AsRgb', "'#ff0000'"]).toString()).toBe('Rgb(1, 0, 0)');
    expect(interp(['AsHsl', "'#ff0000'"]).toString()).toBe('Hsl(0, 1, 0.5)');
    expect(interpOklch("'#ff0000'")).toEqual(interpOklch(['Rgb', 1, 0, 0]));
  });

  test('an sRGB tuple converts to ONE color, not a tuple of errors', () => {
    // `broadcastable` fanned the tuple into three one-number applications, so
    // `AsRgb((1, 0, 0))` answered a tuple of three `incompatible-type` errors.
    const r = interp(['AsRgb', ['Tuple', 1, 0, 0]]);
    expect(r.operator).toBe('Rgb');
    expect(r.toString()).toBe('Rgb(1, 0, 0)');
    expect(interp(['AsHsl', ['Tuple', 1, 0, 0]]).toString()).toBe(
      'Hsl(0, 1, 0.5)'
    );
  });

  test('a list of colors still broadcasts', () => {
    const r = interp([
      'AsRgb',
      ['List', ['Hsl', 0, 1, 0.5], ['Hsl', 120, 1, 0.5]],
    ]);
    expect(r.operator).toBe('List');
    expect(r.ops!.map((op) => op.operator)).toEqual(['Rgb', 'Rgb']);
  });
});

describe('the HSV color space is available on every route', () => {
  // The GPU target lowered `'hsv'` while the interpreter and the JavaScript
  // runtime answered `expected-value` for it, so a shader accepted a space the
  // engine called an error.
  test('ColorToColorspace', () => {
    expect(
      interp(['ColorToColorspace', ['Rgb', 1, 0, 0], "'hsv'"]).ops!.map(
        (op) => op.re
      )
    ).toEqual([0, 1, 1]);
    expect(runJS(['ColorToColorspace', ['Rgb', 1, 0, 0], "'hsv'"])).toEqual([
      0, 1, 1,
    ]);
    expect(
      glsl.compile(
        ce.expr(['ColorToColorspace', ['Rgb', 1, 0, 0], "'hsv'"]),
        NO_FOLD as any
      ).code
    ).toContain('_gpu_rgb_to_hsv');
  });

  test('ColorFromColorspace', () => {
    const t = interp(['ColorFromColorspace', ['Tuple', 0, 1, 1], "'hsv'"]);
    expect(t.ops!.map((op) => Math.round(op.re * 1000) / 1000)).toEqual([
      1, 0, 0,
    ]);
    // The compiled routes answer the same color in their own OKLCh form.
    const red = interpOklch(['Rgb', 1, 0, 0]);
    const js = runJS(['ColorFromColorspace', ['Tuple', 0, 1, 1], "'hsv'"]);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(red[i], 9);
  });
});

describe('ColorContrast answers the same number on every route', () => {
  // The shader helper used a simplified formula on a 100x scale, so
  // `ColorContrast(Rgb(0,0,0), Rgb(1,1,1))` was about -114 on GLSL where the
  // interpreter and the JavaScript target both answer about -1.079.
  test.each([
    ['black on white', ['ColorContrast', ['Rgb', 0, 0, 0], ['Rgb', 1, 1, 1]]],
    ['white on black', ['ColorContrast', ['Rgb', 1, 1, 1], ['Rgb', 0, 0, 0]]],
    ['red on white', ['ColorContrast', ['Rgb', 1, 0, 0], ['Rgb', 1, 1, 1]]],
    [
      'a mid grey pair',
      ['ColorContrast', ['Rgb', 0.2, 0.4, 0.6], ['Rgb', 0.9, 0.9, 0.1]],
    ],
  ])('%s', (_name, expr) => {
    const expected = interp(expr).re;
    // The compiled targets hold a color as OKLCh and convert back to sRGB
    // through a routine that quantizes to 8 bits per channel, so a channel
    // that is not a whole number of 1/255 comes back very slightly moved.
    // Two decimal places is well inside that rounding and far outside the
    // 100x scale error this test was written for.
    expect(runJS(expr)).toBeCloseTo(expected, 2);
    expect(evalGLSL(expr)).toBeCloseTo(expected, 2);
  });

  test('the shader value is on the interpreter scale, not 100x it', () => {
    const expr = ['ColorContrast', ['Rgb', 0, 0, 0], ['Rgb', 1, 1, 1]];
    expect(interp(expr).re).toBeCloseTo(-1.0788473318, 8);
    expect(Math.abs(evalGLSL(expr))).toBeLessThan(2);
  });
});

describe('ContrastingColor picks the same color on the interpreter and GLSL', () => {
  // The shader compared APCA against a fixed 50 threshold on the old scale.
  // A 0.6 grey background got black there while the interpreter chose white.
  test.each([0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 1])(
    'a grey background of %p',
    (v) => {
      const bg = ['Rgb', v, v, v];
      const picked = interp(['ContrastingColor', bg]);
      // The interpreter answers an `Rgb` head; white is (1,1,1).
      const interpWhite = picked.ops![0].re > 0.5;
      const shader = evalGLSL(['ContrastingColor', bg]);
      // The shader answers OKLCh; white is L = 1.
      const shaderWhite = shader.x > 0.5;
      expect(shaderWhite).toBe(interpWhite);
    }
  );
});

describe('ContrastingColor answers the candidate the caller passed', () => {
  test('an Oklch candidate keeps its exact components on both routes', () => {
    const expr = [
      'ContrastingColor',
      ['Oklch', 0.98, 0.02, 90],
      ['Oklch', 0.2, 0.1, 29],
      ['Oklch', 0.95, 0.2, 264],
    ];
    // Verbatim in the interpreter: the head, the space and the components.
    const picked = interp(expr);
    expect(picked.operator).toBe('Oklch');
    expect(picked.ops!.map((op) => op.re)).toEqual([0.2, 0.1, 29]);
    // The same color in the compiled target's canonical form. Both routes
    // used to hand the chosen candidate back through an 8-bit sRGB packing,
    // which moved its components.
    expect(runJS(expr)).toEqual([0.2, 0.1, 29]);
  });

  test('the one-argument form still answers white or black', () => {
    const white = interp(['ContrastingColor', ['Rgb', 0, 0, 0]]);
    expect(white.operator).toBe('Rgb');
    expect(white.ops!.map((op) => op.re)).toEqual([1, 1, 1]);
  });
});

describe('ColorFromColorspace does not convert a typed color head twice', () => {
  // A typed head at this position is read as raw components in the named
  // space. Its own lowering already converts to OKLCh, so the compiled routes
  // converted a second time and answered a color that was not red.
  test('Rgb components in the rgb space stay red', () => {
    const t = interp(['ColorFromColorspace', ['Rgb', 1, 0, 0], "'rgb'"]);
    expect(t.ops!.map((op) => op.re)).toEqual([1, 0, 0]);

    const red = interpOklch(['Rgb', 1, 0, 0]);
    const js = runJS(['ColorFromColorspace', ['Rgb', 1, 0, 0], "'rgb'"]);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(red[i], 9);

    const shader = evalGLSL(['ColorFromColorspace', ['Rgb', 1, 0, 0], "'rgb'"]);
    expect(shader.x).toBeCloseTo(red[0], 6);
    expect(shader.y).toBeCloseTo(red[1], 6);
    expect(shader.z).toBeCloseTo(red[2], 6);
  });
});

describe('Colormap samples agree between the interpreter and the compiled runtime', () => {
  // The interpreter interpolated palette stops through a gamut-clipped sRGB
  // routine while the compiled runtime interpolates the OKLCh stops directly,
  // so the two answered slightly different colors for the same position.
  test.each([0.25, 0.5, 0.75])('viridis at %p', (t) => {
    const expr = ['Colormap', "'viridis'", t];
    const expected = interp(expr).ops!.map((op) => op.re);
    const js = runJS(expr);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(expected[i], 12);
  });

  test('a sampled position agrees with ColorMix on the two stops it lies between', () => {
    // The palette's own stops, so the check does not hard-code its length.
    const stops = interp(['Colormap', "'viridis'"]).ops!;
    const n = stops.length;
    const i = Math.floor(n / 3);
    // Exactly halfway between stop `i` and stop `i + 1`.
    const sample = interp([
      'Colormap',
      "'viridis'",
      (i + 0.5) / (n - 1),
    ]).ops!.map((op) => op.re);
    const mixed = interp([
      'ColorMix',
      stops[i].json,
      stops[i + 1].json,
      0.5,
    ]).ops!.map((op) => op.re);
    for (let i = 0; i < 3; i++) expect(sample[i]).toBeCloseTo(mixed[i], 9);
  });
});

describe('ColorToString keeps wide-gamut chroma in the oklch format', () => {
  // The compiled runtime read the color back through sRGB for this format, so
  // a chroma outside that gamut was clipped: `Oklch(0.6, 0.25, 29)` printed as
  // `oklch(0.6 0.246 29)` there and `oklch(0.6 0.25 29)` in the interpreter.
  test('an out-of-sRGB chroma survives on both routes', () => {
    const expr = ['ColorToString', ['Oklch', 0.6, 0.25, 29], "'oklch'"];
    expect(interp(expr).string).toBe('oklch(0.6 0.25 29)');
    expect(runJS(expr)).toBe('oklch(0.6 0.25 29)');
  });
});

describe('a color string reaches the same color through every operator', () => {
  test('ColorMix of two hex strings equals the mix of the same typed heads', () => {
    const fromStrings = interp(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5]);
    const fromHeads = interp([
      'ColorMix',
      ['Rgb', 1, 0, 0],
      ['Rgb', 0, 0, 1],
      0.5,
    ]);
    expect(fromStrings.toString()).toBe(fromHeads.toString());
    const js = runJS(['ColorMix', "'#ff0000'", "'#0000ff'", 0.5]);
    const expected = fromHeads.ops!.slice(0, 3).map((op) => op.re);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(expected[i], 12);
  });

  test('a named color and its hex agree', () => {
    // `red` in this palette is #d7170b, not #ff0000.
    expect(interpOklch("'red'")).toEqual(interpOklch("'#d7170b'"));
  });
});

describe('a color tuple has exactly 3 or 4 components on every route', () => {
  // The interpreter read the first three components of a wider tuple and
  // dropped the rest, so `(1, 0, 0, 0.5, 0.2)` was red at half alpha there
  // while the compiled routes passed the same tuple on as a color value.
  test.each([
    ['two', ['Tuple', 1, 0]],
    ['five', ['Tuple', 1, 0, 0, 0.5, 0.2]],
  ])('a tuple of %s components is not a color', (_n, tuple) => {
    const expr = ['ColorMix', tuple, "'red'"];
    expect(interp(expr).operator).toBe('Error');
    // The compiled routes fail closed: a literal tuple's width is known at
    // compile time, so neither may re-read it as a canonical color value.
    expect(jsDeclines(expr)).toBe(true);
    expect(() => glsl.compile(ce.expr(expr), NO_FOLD as any)).toThrow(
      /is not a color/
    );
  });

  test('3 and 4 components are still colors', () => {
    expect(interp(['ColorMix', ['Tuple', 1, 0, 0], "'red'"]).operator).toBe(
      'Oklch'
    );
    expect(
      interp(['ColorMix', ['Tuple', 1, 0, 0, 0.5], "'red'"]).operator
    ).toBe('Oklch');
  });
});

describe('a tuple with a component that is not a finite number is not a color', () => {
  // The typed-head rule is the one rule. `Rgb(~oo, 0, 0)` at a color position
  // is `incompatible-type`, but the same components written as a bare tuple
  // multiplied `~oo` by 255 and answered a NaN color.
  test('the tuple spelling is refused exactly as the Rgb spelling is', () => {
    const tuple = ['ColorMix', ['Tuple', 'ComplexInfinity', 0, 0], "'red'"];
    const head = ['ColorMix', ['Rgb', 'ComplexInfinity', 0, 0], "'red'"];
    expect(interp(head).operator).toBe('Error');
    expect(interp(tuple).operator).toBe('Error');
  });

  test('ColorToString and AsRgb agree with ColorMix', () => {
    expect(
      interp(['ColorToString', ['Tuple', 'ComplexInfinity', 0, 0]]).operator
    ).toBe('Error');
    expect(interp(['AsRgb', ['Tuple', 'ComplexInfinity', 0, 0]]).operator).toBe(
      'Error'
    );
  });
});

describe('a color channel must be a scalar on the compiled routes', () => {
  // The `vec3` constructor is built by the color lowering itself, so the
  // shape gate the `Tuple` lowering applies has to be applied there too:
  // `vec3(1.0, vec2(0.0, 1.0), 0.0)` is source no driver accepts, and the
  // JavaScript route answered a NaN color where the interpreter errors.
  const nested = ['Tuple', ['Tuple', 1, 2], 0, 0];

  test('a nested tuple component fails closed', () => {
    expect(interp(['ColorMix', nested, "'red'"]).operator).toBe('Error');
    expect(jsDeclines(['ColorMix', nested, "'red'"])).toBe(true);
    expect(() =>
      glsl.compile(ce.expr(['ColorMix', nested, "'red'"]), NO_FOLD as any)
    ).toThrow(/scalar components/);
  });

  test('ColorFromColorspace of a typed head with a nested component too', () => {
    expect(() =>
      glsl.compile(
        ce.expr([
          'ColorFromColorspace',
          ['Rgb', 1, ['Tuple', 1, 2], 0],
          "'rgb'",
        ]),
        NO_FOLD as any
      )
    ).toThrow(/scalar components/);
  });

  test('a complex component fails closed', () => {
    expect(() =>
      glsl.compile(
        ce.expr([
          'ColorMix',
          ['Tuple', 1, 'ImaginaryUnit', 0],
          ['Rgb', 0, 0, 1],
        ]),
        NO_FOLD as any
      )
    ).toThrow(/Fail closed/);
  });
});
