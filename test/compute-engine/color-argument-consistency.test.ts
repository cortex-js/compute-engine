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
 * Note on the tuple spelling: the interpreter reads a bare tuple at a color
 * position as 0-1 sRGB, while the compiled targets read the same tuple as the
 * canonical OKLCh triple that IS a color value on those targets. That
 * disagreement is a design question, not something this file pins; the cases
 * below therefore use a typed color head or a string wherever a value has to
 * cross routes.
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
      // Local declarations.
      .replace(/\b(?:float|vec2|vec3|bool|int)\s+(\w+)\s*=/g, 'let $1 =')
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
