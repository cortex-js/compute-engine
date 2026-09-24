import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

/**
 * The color operators and their SIGNATURES, checked route by route.
 *
 * Two rules are pinned here.
 *
 * `ColorFromColorspace(components, space)` builds a COLOR from channel values
 * in a named space, and answers one on every route: the interpreter answers
 * the color head of that space (`"oklch"` gives `Oklch(...)`, `"rgb"` gives
 * `Rgb(...)`), the JavaScript target answers a color value carrying those
 * channels and that space, and a shader answers the channels themselves, with
 * `colorSpaceOf` carrying the space. It used to answer an sRGB COMPONENTS
 * tuple in the interpreter and a color object when compiled, so
 * `At(result, 1)` read a channel on one route and `undefined` on the other.
 * The components are read back out with `ColorToColorspace`.
 *
 * A TUPLE at a color position is components, not a color. A tuple written
 * literally is read as 0-1 sRGB on every route — the signatures of the color
 * operators admit `tuple` and the interpreter reads one. A tuple that arrives
 * any other way, through a variable or from a head that answers components,
 * cannot be read at compile time; the compiled targets used to pass it
 * through as though it were a color value, which threw at run time on the
 * JavaScript target and answered a color the interpreter refuses on a shader.
 *
 * How such a tuple is handled now depends on the head. The five `As*`
 * conversions and `ColorToColorspace` TAKE components, so they read it as 0-1
 * sRGB at run time, as the interpreter does. Every other color head consumes
 * a color and declines it.
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
function runJS(expr: any, engine: ComputeEngine = ce, vars?: any): any {
  const compiled: any = compile(engine.expr(expr), NO_FOLD as any);
  return compiled?.run === undefined ? null : compiled.run(vars);
}

/** The code the JavaScript target emits — `''` when it declines. */
function jsCode(expr: any, engine: ComputeEngine = ce): string {
  return (compile(engine.expr(expr), NO_FOLD as any) as any).code;
}

/** The channels of a compiled color, alpha appended when it carries one. */
function runJSChannels(expr: any): number[] {
  const c = runJS(expr) as {
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
function runJSSpace(expr: any): string {
  return (runJS(expr) as { space: string }).space;
}

/** The `[L, C, H]` components of an interpreted color, in OKLCh. */
function interpOklch(expr: any): number[] {
  const r = interp(['AsOklch', expr]);
  return r.ops!.slice(0, 3).map((op) => op.re);
}

// ---------------------------------------------------------------------------
// A miniature GLSL evaluator for the color preamble, so that a shader lowering
// is checked by the color it COMPUTES and not only by the helpers it names.
// Copied from `color-argument-consistency.test.ts`, which explains the
// translation and its limits; the two copies cover the same GLSL subset and
// must keep agreeing with the preamble the color lowerings emit.
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
  // GLSL's component-wise comparisons answer a `bvec3`, which `all` reduces
  // to one boolean. `_gpu_srgb_roundtrip` is the only preamble helper that
  // uses them, to test whether an sRGB triple is already in gamut.
  lessThanEqual: (a: Vec, b: Vec) => ({
    x: a.x <= b.x,
    y: a.y <= b.y,
    z: (a.z as number) <= (b.z as number),
  }),
  greaterThanEqual: (a: Vec, b: Vec) => ({
    x: a.x >= b.x,
    y: a.y >= b.y,
    z: (a.z as number) >= (b.z as number),
  }),
  all: (v: { x: boolean; y: boolean; z: boolean }) => v.x && v.y && v.z,
  // `_gpu_inf()` reads the bit pattern of `+inf` (`GPU_INF_PREAMBLE_GLSL`).
  intBitsToFloat: (bits: number) => {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, bits);
    return view.getFloat32(0);
  },
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
function evalGLSL(
  expr: any,
  builtins: typeof GLSL_BUILTINS = GLSL_BUILTINS
): any {
  const r = glsl.compile(ce.expr(expr), NO_FOLD as any);
  const body = `${glslToJS(r.preamble ?? '')}\nreturn (${glslToJS(r.code!)});`;
  const names = Object.keys(builtins);
  // eslint-disable-next-line no-new-func
  const f = new Function(...names, body);
  return f(...names.map((n) => builtins[n as keyof typeof GLSL_BUILTINS]));
}

/** Compare a shader `vec3` against three interpreter channels. The shader
 *  preamble has its own, shorter conversion constants and computes in 32-bit
 *  floats, so the comparison carries a tolerance of about the third
 *  significant digit of a channel and a degree of a hue. */
function expectShaderChannels(shader: any, expected: number[]): void {
  expect(Math.abs(shader.x - expected[0])).toBeLessThanOrEqual(
    0.005 + 0.02 * Math.abs(expected[0])
  );
  expect(Math.abs(shader.y - expected[1])).toBeLessThanOrEqual(
    0.005 + 0.02 * Math.abs(expected[1])
  );
  expect(Math.abs(shader.z - expected[2])).toBeLessThanOrEqual(
    0.05 + 0.02 * Math.abs(expected[2])
  );
}

// ---------------------------------------------------------------------------
// ColorFromColorspace answers a COLOR
// ---------------------------------------------------------------------------

describe('ColorFromColorspace builds a color in the space it names', () => {
  // Each triple is IN RANGE for the space it is written in — a hue in
  // degrees for `hsv`/`hsl`/`oklch`, 0-1 elsewhere. An out-of-range HSV or
  // HSL channel is clamped by every route, so the channels the operator
  // answers would not be the ones written.
  test.each([
    ['rgb', 'Rgb', [0.5, 0.1, 0.2]],
    ['hsv', 'Hsv', [20, 0.5, 0.6]],
    ['hsl', 'Hsl', [20, 0.5, 0.6]],
    ['oklab', 'Oklab', [0.6, 0.1, 0.05]],
    ['oklch', 'Oklch', [0.6, 0.1, 20]],
  ])(
    '%s answers the %s head with the given channels',
    (space, head, channels) => {
      const expr = [
        'ColorFromColorspace',
        ['Tuple', ...channels],
        `'${space}'`,
      ];

      // The interpreter answers the color head of the named space.
      const r = interp(expr);
      expect(r.operator).toBe(head);
      expect(r.ops!.map((op) => op.re)).toEqual(channels);
      expect(ce.expr(expr).type.matches('color')).toBe(true);

      // The JavaScript value carries the same channels and names the space.
      expect(runJSSpace(expr)).toBe(space);
      expect(runJSChannels(expr)).toEqual(channels);

      // A shader color is a bare `vec3` with no run-time tag, so the value is
      // the channels and the space is the compile-time fact `colorSpaceOf`
      // carries. `AsOklch` is how a caller asks for the canonical space, and
      // there the shader must answer the interpreter's color.
      expectShaderChannels(evalGLSL(['AsOklch', expr]), interpOklch(expr));
    }
  );

  test('the alternate `lab` spelling answers an Oklab color', () => {
    const expr = ['ColorFromColorspace', ['Tuple', 0.5, 0.1, 0.2], "'lab'"];
    expect(interp(expr).operator).toBe('Oklab');
    expect(runJSSpace(expr)).toBe('oklab');
  });

  test('a 4th component is alpha, and an opaque alpha is dropped', () => {
    const half = [
      'ColorFromColorspace',
      ['Tuple', 0.5, 0.1, 20, 0.5],
      "'oklch'",
    ];
    expect(interp(half).ops!.map((op) => op.re)).toEqual([0.5, 0.1, 20, 0.5]);
    expect(runJSChannels(half)).toEqual([0.5, 0.1, 20, 0.5]);

    // An alpha of 1 is what "no alpha" means, on every emit site.
    const opaque = [
      'ColorFromColorspace',
      ['Tuple', 0.5, 0.1, 20, 1],
      "'oklch'",
    ];
    expect(interp(opaque).ops!).toHaveLength(3);
    expect(runJSChannels(opaque)).toEqual([0.5, 0.1, 20]);
  });

  test('a color head at the components position gives its RAW channels', () => {
    // The head's own space is ignored here: its operands are read as
    // components in the space the second operand names.
    const expr = ['ColorFromColorspace', ['Rgb', 0.5, 0.1, 20], "'oklch'"];
    const r = interp(expr);
    expect(r.operator).toBe('Oklch');
    expect(r.ops!.map((op) => op.re)).toEqual([0.5, 0.1, 20]);
    expect(runJSSpace(expr)).toBe('oklch');
    expect(runJSChannels(expr)).toEqual([0.5, 0.1, 20]);
  });

  // `constructor` and `__proto__` are names every JavaScript object answers
  // an inherited value for, so a space table written as a plain object read
  // one of them as a known space. They are unknown spaces, exactly as `srgb`
  // is.
  test.each([['srgb'], ['constructor'], ['__proto__']])(
    'the space "%s" names no color space and is an error',
    (space) => {
      expect(
        interp(['ColorFromColorspace', ['Tuple', 1, 0, 0], `'${space}'`])
          .operator
      ).toBe('Error');
    }
  );

  test.each([['srgb'], ['constructor'], ['__proto__']])(
    'the space "%s" is refused at run time too',
    (space) => {
      // A space that is not a string literal is read at run time, so the
      // compiled helper checks the name itself.
      const e = new ComputeEngine();
      e.declare('s', 'string');
      const compiled: any = compile(
        e.expr(['ColorFromColorspace', ['Tuple', 1, 0, 0], 's']),
        NO_FOLD as any
      );
      expect(() => compiled.run({ s: space })).toThrow(/Unknown color space/);
    }
  );

  test('a channel is read by the rule of the space it names', () => {
    // The typed-head rule is the one rule (`readColorChannels`). A `NaN`
    // channel, or an infinite channel without a bound such as a hue, is
    // `incompatible-type`, as it is in a color head at a color position.
    expect(
      interp(['ColorFromColorspace', ['Tuple', 'NaN', 0, 0], "'rgb'"]).operator
    ).toBe('Error');
    expect(
      interp([
        'ColorFromColorspace',
        ['Tuple', 'PositiveInfinity', 1, 1],
        "'hsv'",
      ]).operator
    ).toBe('Error');
    // An sRGB channel is extended sRGB: a finite channel outside [0, 1] is
    // kept, and an infinite one is `incompatible-type`.
    expect(
      interp([
        'ColorFromColorspace',
        ['Tuple', 'PositiveInfinity', 0, 'NegativeInfinity'],
        "'rgb'",
      ]).operator
    ).toBe('Error');
    expect(
      String(interp(['ColorFromColorspace', ['Tuple', 2, 0, -0.5], "'rgb'"]))
    ).toBe('Rgb(2, 0, -0.5)');
    // An OKLCh lightness has no bound: an infinite one is refused.
    expect(
      interp([
        'ColorFromColorspace',
        ['Tuple', 'PositiveInfinity', 0.1, 30],
        "'oklch'",
      ]).operator
    ).toBe('Error');
    // HSV saturation and value are clamped into [0, 1], an infinite one
    // included: `+oo` reads as 1 and `-oo` as 0.
    expect(
      String(
        interp([
          'ColorFromColorspace',
          ['Tuple', 30, 'PositiveInfinity', 1],
          "'hsv'",
        ])
      )
    ).toBe('Hsv(30, 1, 1)');
  });
});

describe('the color ColorFromColorspace builds is consumed as a color', () => {
  const RED_HSV = ['ColorFromColorspace', ['Tuple', 0, 1, 1], "'hsv'"];

  test('ColorMix takes it, and every route mixes the same color', () => {
    const expr = ['ColorMix', RED_HSV, ['Rgb', 0, 0, 1], 0.5];
    const expected = interp(expr);
    expect(expected.operator).toBe('Oklch');

    const js = runJSChannels(expr);
    const channels = expected.ops!.slice(0, 3).map((op) => op.re);
    for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(channels[i], 9);

    expectShaderChannels(evalGLSL(expr), channels);
  });

  test('ColorToColorspace reads the components back out', () => {
    // `ColorFromColorspace` itself used to answer these numbers, when it
    // converted to 0-1 sRGB and answered a components tuple. They are now
    // one `ColorToColorspace` away, which is the migration for a caller that
    // wants them. The conversion from OKLCh no longer rounds each channel to
    // an 8-bit integer, so they are no longer multiples of 1/255 (they were
    // 148/255, 74/255 and 75/255).
    const expr = [
      'ColorToColorspace',
      ['ColorFromColorspace', ['Tuple', 0.5, 0.1, 20], "'oklch'"],
      "'rgb'",
    ];
    const expected = [
      0.5794652253705687, 0.2883838518001147, 0.29455531221211584,
    ];
    expect(interp(expr).ops!.map((op) => op.re)).toEqual(expected);
    // On this target components are a plain array, the same one the
    // interpreter's `Tuple` holds.
    expect(runJS(expr)).toEqual(expected);
  });

  test('At refuses it on every route, because a color is not indexed', () => {
    // A color is not an indexed collection, so `At(Rgb(1, 0, 0), 1)` is an
    // error — and the head that answers a color inherits that. It used to
    // answer a tuple, whose first component `At` read.
    const expr = [
      'At',
      ['ColorFromColorspace', ['Tuple', 0.5, 0.1, 20], "'oklch'"],
      1,
    ];
    expect(interp(expr).operator).toBe('Error');
    expect(interp(['At', ['Rgb', 1, 0, 0], 1]).operator).toBe('Error');
    // The compiled routes decline an expression the engine calls an error.
    expect(jsCode(expr)).toBe('');
    expect(() => glsl.compile(ce.expr(expr), NO_FOLD as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// A tuple at a color position
// ---------------------------------------------------------------------------

describe('a tuple that is not visible at compile time is declined', () => {
  /** An engine whose `v` is declared a tuple of three numbers and has no
   *  value, which is how a caller passes components in through `vars`. */
  function tupleEngine(): ComputeEngine {
    const e = new ComputeEngine();
    e.declare('v', 'tuple<number, number, number>');
    return e;
  }

  test.each([
    ['ColorMix', ['ColorMix', 'v', ['Rgb', 0, 0, 1], 0.5]],
    ['ColorDelta', ['ColorDelta', 'v', ['Rgb', 0, 0, 1]]],
    ['ColorContrast', ['ColorContrast', 'v', ['Rgb', 0, 0, 1]]],
    ['ContrastingColor', ['ContrastingColor', 'v']],
    ['ColorToString', ['ColorToString', 'v']],
  ])('%s declines a tuple-typed variable', (_name, expr) => {
    const e = tupleEngine();
    // The interpreter cannot read channels off a valueless symbol.
    expect(e.expr(expr).evaluate().operator).toBe('Error');
    // The compiled code used to be `_SYS.colorMix(_.v, …)`, which threw
    // `Not a color` at run time on every input — a failure the compiler could
    // have proved, reported as a success.
    expect(jsCode(expr, e)).toBe('');
  });

  test.each([
    ['ColorMix', ['ColorMix', 'v', ['Rgb', 0, 0, 1], 0.5]],
    ['ColorContrast', ['ColorContrast', 'v', ['Rgb', 0, 0, 1]]],
    ['ContrastingColor', ['ContrastingColor', 'v']],
  ])('%s declines it on a shader too', (_name, expr) => {
    const e = tupleEngine();
    expect(() =>
      new GLSLTarget().compile(e.expr(expr), NO_FOLD as any)
    ).toThrow(/a tuple is color COMPONENTS/);
  });

  test('a head that answers COMPONENTS is declined at a color position', () => {
    // `ColorToColorspace` is declared `-> tuple` and its compiled value is a
    // bare array of channels, which no color helper reads as a color.
    const expr = [
      'ColorMix',
      ['ColorToColorspace', ['Rgb', 1, 0, 0], "'rgb'"],
      ['Rgb', 0, 0, 1],
      0.5,
    ];
    expect(jsCode(expr)).toBe('');
  });

  test('the decline names the two spellings that build a color', () => {
    const e = tupleEngine();
    expect(() =>
      new GLSLTarget().compile(
        e.expr(['ColorMix', 'v', ['Rgb', 0, 0, 1], 0.5]),
        NO_FOLD as any
      )
    ).toThrow(/AsRgb\(\(r, g, b\)\)[\s\S]*ColorFromColorspace/);
  });
});

describe('a tuple written LITERALLY is still 0-1 sRGB at every color head', () => {
  // The signatures say so — `ColorMix` is `(color | string | tuple, color |
  // string | tuple, number?) -> color` — and the interpreter reads such a
  // tuple. A literal tuple's channels are visible at compile time, so the
  // compiled routes convert it with the same conversion `Rgb(r, g, b)` takes.
  test.each([
    ['ColorMix', ['ColorMix', ['Tuple', 1, 0, 0], ['Rgb', 0, 0, 1], 0.5]],
    ['ColorDelta', ['ColorDelta', ['Tuple', 1, 0, 0], ['Rgb', 0, 0, 1]]],
    ['ColorContrast', ['ColorContrast', ['Tuple', 1, 0, 0], ['Rgb', 0, 0, 1]]],
    ['ContrastingColor', ['ContrastingColor', ['Tuple', 1, 0, 0]]],
    ['ColorToString', ['ColorToString', ['Tuple', 1, 0, 0]]],
  ])('%s reads it and agrees with the interpreter', (_name, expr) => {
    expect(interp(expr).operator).not.toBe('Error');
    expect(jsCode(expr)).toContain('_SYS.rgb(1, 0, 0)');
  });

  test('the entry functions read a literal tuple unchanged', () => {
    // A symbolic channel is what makes this tuple invisible to a fold, so the
    // emitted code is the lowering itself.
    const e = new ComputeEngine();
    e.declare('u', 'real');
    expect(jsCode(['AsRgb', ['Tuple', 'u', 0, 0]], e)).toBe(
      '_SYS.asRgb(_SYS.rgb(_.u, 0, 0))'
    );
    expect(
      jsCode(['ColorToColorspace', ['Tuple', 'u', 0, 0], "'hsv'"], e)
    ).toBe('_SYS.colorToColorspace(_SYS.rgb(_.u, 0, 0), "hsv")');

    // And the value agrees with the interpreter reading the same components.
    const bound = new ComputeEngine();
    bound.assign('u', 0.5);
    const expected = bound
      .expr(['ColorToColorspace', ['Tuple', 'u', 0, 0], "'hsv'"])
      .evaluate()
      .ops!.map((op) => op.re);
    const got = runJS(['ColorToColorspace', ['Tuple', 'u', 0, 0], "'hsv'"], e, {
      u: 0.5,
    }) as number[];
    // The compiled converter reads a color back through an 8-bit-per-channel
    // sRGB packing, so a channel that is not a whole number of 1/255 comes
    // back very slightly moved — 0.5 becomes 127/255. Two decimal places is
    // well inside that rounding.
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(expected[i], 2);
  });
});

// ---------------------------------------------------------------------------
// The entry functions read components
// ---------------------------------------------------------------------------

describe('an entry function reads a tuple-typed operand as components', () => {
  // The five `As*` conversions and `ColorToColorspace` are how a caller turns
  // components into a color, so a tuple at their operand is legitimate input
  // whichever way it arrives: the interpreter reads one as 0-1 sRGB, and both
  // compiled targets read the same channels the same way. Every other color
  // head consumes a color and declines the operand (the describe above).

  /** The components the compiled routes are run with, and the value the
   *  interpreter's `v` holds. */
  const COMPONENTS = [0.5, 0.1, 0.2];

  /** An engine whose `v` is declared a tuple of three numbers and has no
   *  value, which is how a caller passes components in through `vars`. */
  function componentsEngine(): ComputeEngine {
    const e = new ComputeEngine();
    e.declare('v', 'tuple<number, number, number>');
    return e;
  }

  /** The interpreter's answer for the same expression, with `v` BOUND to the
   *  components the compiled route is run with. */
  function interpWithComponents(expr: any): any {
    const e = new ComputeEngine();
    e.assign('v', e.tuple(...COMPONENTS));
    return e.expr(expr).evaluate();
  }

  test('AsRgb answers the color of the components', () => {
    const e = componentsEngine();
    expect(jsCode(['AsRgb', 'v'], e)).toBe(
      '_SYS.asRgb(_SYS.colorFromSrgbComponents(_.v))'
    );
    const got = runJS(['AsRgb', 'v'], e, { v: COMPONENTS }) as {
      space: string;
      c0: number;
      c1: number;
      c2: number;
    };
    expect(got.space).toBe('rgb');
    const expected = interpWithComponents(['AsRgb', 'v']).ops!.map(
      (op) => op.re
    );
    // The compiled converter reads a color back through an 8-bit-per-channel
    // sRGB packing, so a channel that is not a whole number of 1/255 comes
    // back very slightly moved.
    const channels = [got.c0, got.c1, got.c2];
    for (let i = 0; i < 3; i++) expect(channels[i]).toBeCloseTo(expected[i], 2);
  });

  test('ColorToColorspace converts the components it reads', () => {
    const e = componentsEngine();
    expect(jsCode(['ColorToColorspace', 'v', "'hsv'"], e)).toBe(
      '_SYS.colorToColorspace(_SYS.colorFromSrgbComponents(_.v), "hsv")'
    );
    const got = runJS(['ColorToColorspace', 'v', "'hsv'"], e, {
      v: COMPONENTS,
    }) as number[];
    const expected = interpWithComponents([
      'ColorToColorspace',
      'v',
      "'hsv'",
    ]).ops!.map((op) => op.re);
    // The first channel is a HUE in degrees, where the same 8-bit packing
    // moves a fraction of a degree; the other two are 0-1.
    expect(got[0]).toBeCloseTo(expected[0], 0);
    expect(got[1]).toBeCloseTo(expected[1], 2);
    expect(got[2]).toBeCloseTo(expected[2], 2);
  });

  test('a shader reads the same components as 0-1 sRGB', () => {
    // A shader color is a bare `vec3`, so the components ARE the value and
    // `_gpu_srgb_to_oklch` is the whole reading. The operand is a uniform
    // here, which the miniature evaluator above cannot supply a value for, so
    // the pin is the code.
    const e = componentsEngine();
    const glslCode = (expr: any) =>
      new GLSLTarget().compile(e.expr(expr), NO_FOLD as any).code;
    expect(glslCode(['AsRgb', 'v'])).toBe(
      '_gpu_oklch_to_srgb(_gpu_srgb_to_oklch(v))'
    );
    expect(glslCode(['ColorToColorspace', 'v', "'hsv'"])).toBe(
      '_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(_gpu_srgb_to_oklch(v)))'
    );
  });

  test('a shader declines components that carry an alpha', () => {
    // A shader color is `vec3` end to end and has nowhere to keep alpha, so a
    // 4-wide components tuple gets the same decline a 4-operand color
    // constructor gets. The JavaScript target keeps the alpha.
    const e = new ComputeEngine();
    e.declare('w', 'tuple<number, number, number, number>');
    expect(() =>
      new GLSLTarget().compile(e.expr(['AsRgb', 'w']), NO_FOLD as any)
    ).toThrow(/alpha \(4th\) operand is not representable/);
    expect(jsCode(['AsRgb', 'w'], e)).toBe(
      '_SYS.asRgb(_SYS.colorFromSrgbComponents(_.w))'
    );
  });

  test('a components head at an entry function round-trips the color', () => {
    // `ColorToColorspace(c, "rgb")` answers the 0-1 sRGB channels of `c`, and
    // reading them back as sRGB components answers `c` again.
    const c = ['Rgb', 1, 0.5, 0.25];
    const expr = ['AsRgb', ['ColorToColorspace', c, "'rgb'"]];
    expect(jsCode(expr)).toBe(
      '_SYS.asRgb(_SYS.colorFromSrgbComponents(_SYS.colorToColorspace(_SYS.rgb(1, 0.5, 0.25), "rgb")))'
    );
    // The components go through OKLCh twice on this route and once on the
    // other, so they agree to the rounding error of that conversion.
    const roundTrip = runJS(expr);
    const direct = runJS(['AsRgb', c]);
    expect(roundTrip.space).toBe(direct.space);
    for (const k of ['c0', 'c1', 'c2'])
      expect(roundTrip[k]).toBeCloseTo(direct[k], 12);
    expectShaderChannels(
      evalGLSL(expr),
      interp(['AsRgb', c]).ops!.map((op) => op.re)
    );
  });
});

// ---------------------------------------------------------------------------
// A selection between two ColorFromColorspace arms on a shader
// ---------------------------------------------------------------------------

describe('a shader selection between colors in named spaces', () => {
  // A shader color is a bare `vec3` with no run-time tag, so the space of a
  // selection has to be one compile-time fact. `ColorFromColorspace` keeps
  // its channels in the space it names, so two arms naming different spaces
  // have no common space to read the selected vector in.
  const CONDITION = ['Less', ['Sin', 0.3], 1];
  const RGB_ARM = ['ColorFromColorspace', ['Tuple', 0.5, 0.1, 0.2], "'rgb'"];
  const HSV_ARM = ['ColorFromColorspace', ['Tuple', 20, 0.5, 0.6], "'hsv'"];
  const OTHER_RGB_ARM = [
    'ColorFromColorspace',
    ['Tuple', 0.2, 0.4, 0.6],
    "'rgb'",
  ];

  test('arms that name different spaces decline', () => {
    const expr = ['AsOklch', ['Which', CONDITION, RGB_ARM, 'True', HSV_ARM]];
    expect(() => glsl.compile(ce.expr(expr), NO_FOLD as any)).toThrow(
      /cannot settle the color space/
    );
    // At a consuming head too, which reads the same fact.
    expect(() =>
      glsl.compile(
        ce.expr([
          'ColorMix',
          ['Which', CONDITION, RGB_ARM, 'True', HSV_ARM],
          ['Rgb', 0, 0, 1],
          0.5,
        ]),
        NO_FOLD as any
      )
    ).toThrow(/cannot settle the color space/);
  });

  test('arms that name the same space compile and agree with JavaScript', () => {
    const expr = [
      'AsOklch',
      ['Which', CONDITION, RGB_ARM, 'True', OTHER_RGB_ARM],
    ];
    expect(runJSSpace(expr)).toBe('oklch');
    expectShaderChannels(evalGLSL(expr), runJSChannels(expr));
  });
});

// ---------------------------------------------------------------------------
// The sRGB conversions do not round to 8-bit channels
// ---------------------------------------------------------------------------

describe('a compiled sRGB conversion agrees with the interpreter to 1e-9', () => {
  // The compiled constructors convert to OKLCh at once, and the conversions
  // back to sRGB rounded each channel to an integer from 0 to 255, so
  // `AsRgb(Hsv(30, 1, 1))` had a green channel of 127/255 on this target and
  // 0.5 in the interpreter. The interpreter's HSL and OKLCh conversions also
  // rounded. Neither route rounds now (`numerics/color-conversion.ts`).
  const INPUTS = [
    ['Hsv', 30, 1, 1],
    ['Hsv', 200, 0.3, 0.7],
    ['Hsv', 390, 0.5, 0.2],
    ['Hsv', 0, 0, 0.4],
    ['Hsl', 30, 1, 0.5],
    ['Hsl', 200, 0.3, 0.7],
    ['Hsl', -30, 0.8, 0.6],
    ['Hsl', 120, 1, 0.25],
    ['Rgb', 1, 0.5, 0],
    ['Rgb', 0.2, 0.4, 0.6],
    ['Rgb', 0.5, 0.5, 0.5],
    ['Rgb', 1, 0.3, 0.3],
    ['Rgb', 0, 0, 1],
  ];
  const HEADS: [string, string][] = [
    ['AsRgb', 'Rgb'],
    ['AsHsv', 'Hsv'],
    ['AsHsl', 'Hsl'],
  ];

  test.each(
    HEADS.flatMap(([head, target]) =>
      INPUTS.filter((input) => input[0] !== target).map(
        (input) => [head, JSON.stringify(input)] as [string, string]
      )
    )
  )('%s(%s)', (head, input) => {
    const expr = [head, JSON.parse(input)];
    const expected = interp(expr);
    expect(expected.operator).toBe(head.slice(2));
    const channels = expected.ops!.slice(0, 3).map((op) => op.re);
    const js = runJSChannels(expr);
    for (let i = 0; i < 3; i++)
      expect(Math.abs(js[i] - channels[i])).toBeLessThan(1e-9);
  });

  test('the green channel of AsRgb(Hsv(30, 1, 1)) is 0.5', () => {
    const expr = ['AsRgb', ['Hsv', 30, 1, 1]];
    expect(String(interp(expr))).toBe('Rgb(1, 0.5, 0)');
    const [r, g, b] = runJSChannels(expr);
    expect(r).toBe(1);
    expect(Math.abs(g - 0.5)).toBeLessThan(1e-12);
    expect(b).toBe(0);
  });

  test('the interpreter converts HSL without rounding, and clamps it', () => {
    expect(String(interp(['AsRgb', ['Hsl', 30, 1, 0.5]]))).toBe(
      'Rgb(1, 0.5, 0)'
    );
    // Saturation and lightness are clamped into [0, 1], as HSV saturation
    // and value are: `Hsl(30, 1, 2)` converted to the sRGB channels (1, 2, 3).
    expect(String(interp(['AsRgb', ['Hsl', 30, 1, 2]]))).toBe('Rgb(1, 1, 1)');
    expect(String(interp(['AsRgb', ['Hsl', 30, 2, 0.5]]))).toBe(
      'Rgb(1, 0.5, 0)'
    );
  });
});

// ---------------------------------------------------------------------------
// An infinite bounded channel on a shader
// ---------------------------------------------------------------------------

describe('a shader reads an infinite HSV or HSL channel as its bound', () => {
  // The rule of the interpreter and the JavaScript runtime
  // (`readColorChannels`): HSV/HSL saturation, value and lightness are
  // clamped into [0, 1], so `+oo` is 1 and `-oo` is 0. The shader helpers
  // `_gpu_hsv_to_rgb` and `_gpu_hsl_to_rgb` clamp them the same way.
  test.each([
    [
      ['Hsv', 30, 'PositiveInfinity', 1],
      ['Hsv', 30, 1, 1],
    ],
    [
      ['Hsv', 30, 1, 'PositiveInfinity'],
      ['Hsv', 30, 1, 1],
    ],
    [
      ['Hsv', 30, 1, 'NegativeInfinity'],
      ['Hsv', 30, 1, 0],
    ],
    [
      ['Hsl', 30, 'PositiveInfinity', 0.5],
      ['Hsl', 30, 1, 0.5],
    ],
    [
      ['Hsl', 30, 1, 'PositiveInfinity'],
      ['Hsl', 30, 1, 1],
    ],
  ])('%j', (color, bound) => {
    const shader = evalGLSL(['AsRgb', color]);
    const expected = interp(['AsRgb', bound]).ops!.map((op) => op.re);
    expect(interp(['AsRgb', color]).ops!.map((op) => op.re)).toEqual(expected);
    for (const [k, i] of [
      ['x', 0],
      ['y', 1],
      ['z', 2],
    ] as const)
      expect(shader[k]).toBeCloseTo(expected[i], 6);
  });

  test('an out-of-range hue is reduced modulo 360', () => {
    for (const color of [
      ['Hsv', 390, 1, 1],
      ['Hsv', -30, 1, 1],
      ['Hsl', 390, 1, 0.5],
      ['Hsl', -30, 1, 0.5],
    ]) {
      const shader = evalGLSL(['AsRgb', color]);
      const expected = interp(['AsRgb', color]).ops!.map((op) => op.re);
      expect(shader.x).toBeCloseTo(expected[0], 6);
      expect(shader.y).toBeCloseTo(expected[1], 6);
      expect(shader.z).toBeCloseTo(expected[2], 6);
    }
  });

  test('an infinite hue is NaN', () => {
    const shader = evalGLSL(['AsRgb', ['Hsv', 'PositiveInfinity', 1, 1]]);
    expect(Number.isNaN(shader.x)).toBe(true);
  });

  test('an infinite sRGB channel or OKLab lightness is NaN', () => {
    // These channels are not clamped, so an infinite one is not a color:
    // `incompatible-type` on the interpreter and NaN channels on a shader.
    for (const color of [
      ['Rgb', 'PositiveInfinity', 0.5, 0],
      ['Rgb', 1, 'NegativeInfinity', 0],
      ['Oklch', 'PositiveInfinity', 0, 30],
      ['Oklab', 'NegativeInfinity', 0, 0],
    ]) {
      expect(interp(['AsRgb', color]).operator).toBe('Error');
      const shader = evalGLSL(['AsRgb', color]);
      expect(Number.isNaN(shader.x)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// A NaN channel on a shader
// ---------------------------------------------------------------------------

describe('a shader keeps a NaN channel NaN through a clamp or a sign', () => {
  // GLSL and WGSL do not specify `min`, `max` or `clamp` of NaN, nor
  // `sign(NaN)`. These builtins give one answer the specifications allow and
  // that GPUs give: `min` and `max` return the operand that is not NaN (the
  // IEEE 754 `minNum` and `maxNum`), so `clamp(NaN, 0, 1)` is 0, and
  // `sign(NaN)` is 0. JavaScript's `Math.min` and `Math.sign` propagate NaN,
  // so the default builtins cannot show a helper that loses a NaN channel.
  const notNaN = (
    a: number,
    b: number,
    pick: (a: number, b: number) => number
  ) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : pick(a, b));
  const max = (a: number, b: number) => notNaN(a, b, Math.max);
  const min = (a: number, b: number) => notNaN(a, b, Math.min);
  const clampOne = (v: number, lo: number, hi: number) => min(max(v, lo), hi);
  const GPU_NAN_BUILTINS: typeof GLSL_BUILTINS = {
    ...GLSL_BUILTINS,
    max,
    min,
    sign: (x: number) => (Number.isNaN(x) ? 0 : Math.sign(x)),
    clamp: (v: Vec | number, lo: number, hi: number) =>
      isVec(v)
        ? V3(
            clampOne(v.x, lo, hi),
            clampOne(v.y, lo, hi),
            clampOne(v.z!, lo, hi)
          )
        : clampOne(v, lo, hi),
  };

  test.each([
    [['AsHsv', ['Hsv', 30, 'NaN', 1]]],
    [['AsHsv', ['Rgb', 'NaN', 0.5, 0]]],
    [['AsHsl', ['Rgb', 0.5, 'NaN', 0]]],
    [['AsRgb', ['Hsl', 30, 1, 'NaN']]],
  ])('%j gives NaN channels', (expr) => {
    // The interpreter refuses a NaN channel.
    expect(interp(expr).operator).toBe('Error');
    const shader = evalGLSL(expr, GPU_NAN_BUILTINS);
    expect([shader.x, shader.y, shader.z].every(Number.isNaN)).toBe(true);
  });

  test('the APCA contrast of a NaN channel is NaN', () => {
    const expr = ['ColorContrast', ['Rgb', 'NaN', 0, 0], ['Rgb', 0, 0, 0]];
    expect(interp(expr).operator).toBe('Error');
    expect(Number.isNaN(evalGLSL(expr, GPU_NAN_BUILTINS))).toBe(true);
  });

  test('the WGSL helpers test for NaN before they clamp', () => {
    const r = new WGSLTarget().compile(
      ce.expr(['AsHsv', ['Hsv', 30, 'NaN', 1]]),
      NO_FOLD as any
    ) as any;
    expect(r.preamble).toContain(
      'if (h != h || hsv.y != hsv.y || hsv.z != hsv.z) { return vec3f(h + hsv.y + hsv.z); }'
    );
    expect(r.preamble).toContain(
      'if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z) {'
    );
    expect(r.preamble).toContain(
      'if (lc != lc || mc != mc || sc != sc) { return vec3f(lc + mc + sc); }'
    );
    expect(r.preamble).toContain('if (c != c) { return c; }');
  });
});

// ---------------------------------------------------------------------------
// Out-of-range channels, route by route
// ---------------------------------------------------------------------------

/**
 * The numbers of an interpreted result: the channels of a color head, the
 * components of a tuple, or a scalar. `null` for an `Error`.
 */
function interpNumbers(expr: any): number[] | null {
  const r = interp(expr);
  if (r.operator === 'Error') return null;
  if (r.ops === undefined || r.ops === null) return [r.re];
  return r.ops.slice(0, 3).map((op) => op.re);
}

/** The numbers of a compiled result, in the same shape as `interpNumbers`. */
function jsNumbers(expr: any): number[] {
  const r = runJS(expr);
  if (typeof r === 'number') return [r];
  if (Array.isArray(r)) return r.slice(0, 3);
  return [r.c0, r.c1, r.c2];
}

describe('an out-of-range channel on the interpreter and the javascript target', () => {
  // The user decision on out-of-range color channels:
  // - `Rgb` is extended sRGB. A finite channel outside [0, 1] is kept on
  //   every route, and no conversion among `Rgb`, `Oklab` and `Oklch` does
  //   gamut mapping. An infinite or `NaN` `Rgb` channel is an error.
  // - HSV/HSL saturation, value and lightness are clamped into [0, 1], an
  //   infinite one included, also by a same-space conversion.
  // - A conversion of an extended `Rgb` color to HSV/HSL clips each channel
  //   into [0, 1].
  // - OKLab/OKLCh channels have no bound: a large finite lightness is kept,
  //   and an infinite one is an error.
  // Each row: the expression, and the numbers both routes must answer
  // (`null` when the interpreter answers an error and the compiled route the
  // NaN color). A row without expected numbers checks only that the two
  // routes agree.
  const I = 'PositiveInfinity';
  const ROWS: [string, any, number[] | null | undefined][] = [
    ['AsRgb(Rgb(2, 0, 0))', ['AsRgb', ['Rgb', 2, 0, 0]], [2, 0, 0]],
    [
      'AsRgb(Rgb(-0.5, 0.5, 0))',
      ['AsRgb', ['Rgb', -0.5, 0.5, 0]],
      [-0.5, 0.5, 0],
    ],
    ['AsOklch(Rgb(2, 0, 0))', ['AsOklch', ['Rgb', 2, 0, 0]], undefined],
    [
      'AsRgb(AsOklch(Rgb(2, 0, 0)))',
      ['AsRgb', ['AsOklch', ['Rgb', 2, 0, 0]]],
      [2, 0, 0],
    ],
    [
      'AsRgb(AsOklab(Rgb(-0.5, 0.5, 0)))',
      ['AsRgb', ['AsOklab', ['Rgb', -0.5, 0.5, 0]]],
      [-0.5, 0.5, 0],
    ],
    // HSV and HSL describe only the sRGB gamut, so an extended color is
    // mapped into it with the CSS Color 4 gamut mapping (the OKLCh chroma is
    // reduced at constant lightness and hue). `Rgb(2, 0, 0)` and
    // `Rgb(2, 0.5, -1)` have an OKLCh lightness above 1, which maps to white.
    ['AsHsv(Rgb(2, 0, 0))', ['AsHsv', ['Rgb', 2, 0, 0]], [0, 0, 1]],
    ['AsHsl(Rgb(2, 0.5, -1))', ['AsHsl', ['Rgb', 2, 0.5, -1]], [0, 0, 1]],
    // `Rgb(1.2, 0, 0)` maps to `Rgb(1, 0.410225, 0.339121)` (the value
    // colorjs.io answers with its "css" gamut-mapping method), not to the
    // clipped `Rgb(1, 0, 0)`.
    [
      'AsHsv(Rgb(1.2, 0, 0))',
      ['AsHsv', ['Rgb', 1.2, 0, 0]],
      [6.455435134724467, 0.6608788920453945, 1],
    ],
    [
      'AsHsl(Rgb(1.2, 0, 0))',
      ['AsHsl', ['Rgb', 1.2, 0, 0]],
      [6.455435134724467, 1, 0.6695605539773027],
    ],
    ['AsRgb(Hsv(30, 2, 1))', ['AsRgb', ['Hsv', 30, 2, 1]], [1, 0.5, 0]],
    ['AsHsv(Hsv(30, 2, 1))', ['AsHsv', ['Hsv', 30, 2, 1]], [30, 1, 1]],
    ['AsHsv(Hsv(390, 1, 1))', ['AsHsv', ['Hsv', 390, 1, 1]], [30, 1, 1]],
    ['AsRgb(Hsv(30, +oo, 3.14))', ['AsRgb', ['Hsv', 30, I, 3.14]], [1, 0.5, 0]],
    ['AsRgb(Rgb(+oo, 0, 0))', ['AsRgb', ['Rgb', I, 0, 0]], null],
    ['AsRgb(Oklch(+oo, 0.1, 30))', ['AsRgb', ['Oklch', I, 0.1, 30]], null],
    ['AsOklch(Oklch(+oo, 0.1, 30))', ['AsOklch', ['Oklch', I, 0.1, 30]], null],
    ['AsRgb(Oklch(3, 0.1, 30))', ['AsRgb', ['Oklch', 3, 0.1, 30]], undefined],
    [
      'ColorMix(Rgb(2, 0, 0), Rgb(0, 0, 1), 0.5)',
      ['ColorMix', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 1], 0.5],
      undefined,
    ],
    [
      'AsRgb(ColorMix(Rgb(2, 0, 0), Rgb(0, 0, 1), 0.5))',
      ['AsRgb', ['ColorMix', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 1], 0.5]],
      undefined,
    ],
    [
      'ColorToColorspace(Rgb(2, 0, 0), "oklab")',
      ['ColorToColorspace', ['Rgb', 2, 0, 0], "'oklab'"],
      undefined,
    ],
    [
      'ColorContrast(Rgb(2, 0, 0), Rgb(0, 0, 0))',
      ['ColorContrast', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 0]],
      undefined,
    ],
    [
      'ColorFromColorspace((2, 0, 0), "rgb")',
      ['ColorFromColorspace', ['Tuple', 2, 0, 0], "'rgb'"],
      [2, 0, 0],
    ],
  ];

  test.each(ROWS)('%s', (_label, expr, expected) => {
    const fromInterp = interpNumbers(expr);
    const fromJS = jsNumbers(expr);
    if (expected === null) {
      expect(fromInterp).toBeNull();
      expect(fromJS.every((x) => Number.isNaN(x))).toBe(true);
      return;
    }
    expect(fromInterp).not.toBeNull();
    expect(fromJS).toHaveLength(fromInterp!.length);
    for (let i = 0; i < fromJS.length; i++)
      expect(Math.abs(fromJS[i] - fromInterp![i])).toBeLessThan(1e-9);
    if (expected !== undefined)
      for (let i = 0; i < expected.length; i++)
        expect(Math.abs(fromInterp![i] - expected[i])).toBeLessThan(1e-9);
  });

  test('a mix with an extended color is itself outside the sRGB gamut', () => {
    // No gamut mapping: the mix of an extended red and a blue has a green
    // channel below 0 on both routes.
    const expr = [
      'AsRgb',
      ['ColorMix', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 1], 0.5],
    ];
    expect(interpNumbers(expr)![1]).toBeLessThan(0);
    expect(jsNumbers(expr)[1]).toBeLessThan(0);
  });

  test('a large OKLCh lightness is kept', () => {
    const [r, g, b] = interpNumbers(['AsRgb', ['Oklch', 3, 0.1, 30]])!;
    expect(r).toBeGreaterThan(1);
    expect(g).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(1);
  });

  test('a bare constructor with an infinite channel is the NaN color', () => {
    for (const color of [
      ['Rgb', I, 0, 0],
      ['Oklch', I, 0.1, 30],
    ])
      expect(jsNumbers(color).every((x) => Number.isNaN(x))).toBe(true);
  });
});

describe('a shader passes an extended sRGB channel through', () => {
  // The shader conversion helpers do not clamp an sRGB channel and do no
  // gamut mapping: only the output (and the conversion to HSV or HSL) maps a
  // color into a gamut. Their sRGB transfer functions and cube
  // roots are sign-extended, so a negative channel survives a conversion to
  // OKLab and back. The shader computes in 32-bit floats with shorter
  // constants, hence the looser tolerance of a conversion.
  test.each([
    [['Rgb', 2, 0, 0]],
    [['Rgb', -0.5, 0.5, 0]],
    [['Rgb', 1.5, -0.25, 3]],
  ])('AsRgb(%j) is the same channels', (color) => {
    const shader = evalGLSL(['AsRgb', color]);
    expect([shader.x, shader.y, shader.z]).toEqual(color.slice(1));
  });

  test.each([
    [['AsRgb', ['AsOklch', ['Rgb', 2, 0, 0]]]],
    [['AsRgb', ['AsOklab', ['Rgb', -0.5, 0.5, 0]]]],
    [['AsRgb', ['ColorMix', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 1], 0.5]]],
    [['AsOklch', ['Rgb', 2, 0, 0]]],
  ])('%j agrees with the interpreter', (expr) => {
    const shader = evalGLSL(expr);
    const expected = interpNumbers(expr)!;
    expect(Math.abs(shader.x - expected[0])).toBeLessThan(1e-4);
    expect(Math.abs(shader.y - expected[1])).toBeLessThan(1e-4);
    expect(Math.abs(shader.z - expected[2])).toBeLessThan(1e-3);
  });

  test('a conversion to HSV or HSL maps the color into the sRGB gamut', () => {
    for (const expr of [
      ['AsHsv', ['Rgb', 2, 0, 0]],
      ['AsHsl', ['Rgb', 2, 0.5, -1]],
      ['AsHsv', ['Rgb', 1.2, 0, 0]],
    ]) {
      const shader = evalGLSL(expr);
      const expected = interpNumbers(expr)!;
      expect(shader.x).toBeCloseTo(expected[0], 3);
      expect(shader.y).toBeCloseTo(expected[1], 5);
      expect(shader.z).toBeCloseTo(expected[2], 5);
    }
  });

  test('the APCA contrast of an extended color agrees with the interpreter', () => {
    const expr = ['ColorContrast', ['Rgb', 2, 0, 0], ['Rgb', 0, 0, 0]];
    expect(evalGLSL(expr)).toBeCloseTo(interpNumbers(expr)![0], 5);
  });
});

describe('a shader maps a color into the gamut as the interpreter does', () => {
  // `GamutMap` answers the mapped color in sRGB channels on every route. The
  // shader helpers compute in 32-bit floats with shorter constants, so the
  // binary search on the chroma can stop one step apart: the tolerance is
  // about one chroma step (0.0001) in a channel.
  test.each([
    [['GamutMap', ['Oklch', 0.7, 0.4, 30]]],
    [['GamutMap', ['Oklch', 0.9, 0.3, 140]]],
    [['GamutMap', ['Oklch', 0.3, 0.3, 264]]],
    [['GamutMap', ['Oklch', 0.6, -0.3, 30]]],
    [['GamutMap', ['Rgb', 1.2, 0, 0]]],
    [['GamutMap', ['Rgb', 2, 0, 0]]],
    [['GamutMap', ['Rgb', 0.3, 0.55, 0.8]]],
    [['GamutMap', ['Oklch', 0.7, 0.4, 30], "'display-p3'"]],
    [['GamutMap', ['Oklch', 0.5, 0.25, 250], "'display-p3'"]],
    [['GamutMap', ['Rgb', 1.05, 0, 0], "'display-p3'"]],
    [['AsOklch', ['GamutMap', ['Oklch', 0.7, 0.4, 30]]]],
  ])('%j agrees with the interpreter', (expr) => {
    const shader = evalGLSL(expr);
    const expected = interpNumbers(expr)!;
    expect(Math.abs(shader.x - expected[0])).toBeLessThan(1e-3);
    expect(Math.abs(shader.y - expected[1])).toBeLessThan(1e-3);
    expect(Math.abs(shader.z - expected[2])).toBeLessThan(1e-2);
  });

  test('a NaN channel stays NaN', () => {
    const shader = evalGLSL(['GamutMap', ['Oklch', 0.7, 'NaN', 30]]);
    expect([shader.x, shader.y, shader.z].every(Number.isNaN)).toBe(true);
  });

  test('an unknown gamut fails closed', () => {
    expect(() =>
      glsl.compile(
        ce.expr(['GamutMap', ['Rgb', 1, 0, 0], "'rec2020'"]),
        NO_FOLD as any
      )
    ).toThrow(/rec2020/);
  });

  test('the WGSL preamble has the mapping helpers', () => {
    const r = new WGSLTarget().compile(
      ce.expr(['GamutMap', ['Oklch', 0.7, 0.4, 30], "'display-p3'"]),
      NO_FOLD as any
    ) as any;
    expect(r.code).toContain('_gpu_gamut_map_oklch_p3(');
    expect(r.preamble).toContain(
      'fn _gpu_gamut_map_oklch_in(lch: vec3f, p3: bool) -> vec3f {'
    );
    expect(r.preamble).toContain(
      'return all(rgb >= vec3f(-1e-6)) && all(rgb <= vec3f(1.000001));'
    );
  });
});
