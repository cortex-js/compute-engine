/**
 * A `broadcastExemptions: ['tuples']` declaration is honored by the COMPILED
 * lanes, not only by the interpreter.
 *
 * A `broadcastable` head maps over a collection operand, and a tuple is an
 * indexed collection, so the compiled lanes used to fan a tuple out the same
 * way a list is fanned out. A definition that declares the `'tuples'`
 * exemption says the opposite for that shape: the head's own handler consumes
 * the tuple whole. The five color-space conversions declare it, so
 * `AsRgb((1, 0, 0))` is one color in 0-1 sRGB — not three one-number
 * applications.
 *
 * Before the base compiler consulted the declaration, the JavaScript target
 * declined that expression (it has no `broadcastUnary` hook, so the fan-out
 * dispatch failed closed) and the shader targets needed a color-specific
 * carve-out inside their fan-out lane. The gate is now generic: it reads the
 * operator definition, so a tuple operand of any head that declares the
 * exemption reaches that head's own lowering.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

// `constantFold: false` throughout: every probe below is an all-literal
// subtree, which the compiler would otherwise evaluate at compile time and
// emit as one constant, short-circuiting the operand gate under test.
const NO_FOLD = { constantFold: false } as const;

const js = (expr: any): any => compile(ce.box(expr), NO_FOLD as any) as any;
const g = (expr: any): string =>
  glsl.compile(ce.box(expr), NO_FOLD as any).code!;

/** The numeric components of an evaluated color head, e.g. `Rgb(1, 0, 0)`. */
const interpComponents = (expr: any): number[] =>
  ce
    .box(expr)
    .evaluate()
    .ops!.map((op) => op.re);

describe('BROADCAST EXEMPTION — a tuple operand of an exempt head is ATOMIC', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('AsRgb of a tuple compiles on the JavaScript target and agrees with the interpreter', () => {
    const r = js(['AsRgb', ['Tuple', 1, 0, 0]]);
    expect(r.success).toBe(true);
    // The tuple is converted once, as one color — not mapped over.
    expect(r.code).toBe('_SYS.asRgb(_SYS.rgb(1, 0, 0))');
    expect(r.run({})).toEqual(interpComponents(['AsRgb', ['Tuple', 1, 0, 0]]));
  });

  test('AsOklch of a tuple compiles on the JavaScript target and agrees with the interpreter', () => {
    const expr = ['AsOklch', ['Tuple', 0.5, 0.2, 0.1]];
    const r = js(expr);
    expect(r.success).toBe(true);
    const expected = interpComponents(expr);
    const actual = r.run({}) as number[];
    expect(actual).toHaveLength(3);
    for (let i = 0; i < expected.length; i++)
      expect(actual[i]).toBeCloseTo(expected[i], 10);
  });

  test('the shader lane converts the same tuple as one sRGB color', () => {
    expect(g(['AsOklch', ['Tuple', 0.5, 0.2, 0.1]])).toBe(
      '_gpu_srgb_to_oklch(vec3(0.5, 0.2, 0.1))'
    );
    // `AsRgb` converts back, which the target folds into one round trip.
    expect(g(['AsRgb', ['Tuple', 1, 0, 0]])).toBe(
      '_gpu_srgb_roundtrip(vec3(1.0, 0.0, 0.0))'
    );
  });

  test('a tuple width that is not a color still fails closed', () => {
    // Standing the fan-out down is not acceptance: the head's own lowering
    // decides, and it refuses a tuple that is not 3 or 4 components, which is
    // what the interpreter answers `incompatible-type` for.
    expect(
      ce
        .box(['AsRgb', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-type")');
    expect(js(['AsRgb', ['Tuple', 1, 2]]).success).toBe(false);
    expect(() => g(['AsRgb', ['Tuple', 1, 2]])).toThrow(/is not a color/);
  });
});

describe('BROADCAST EXEMPTION — the shapes it does NOT cover', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('a head WITHOUT the exemption still broadcasts over a tuple', () => {
    expect(
      ce
        .box(['Sin', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(sin(1), sin(2))');
    const r = js(['Sin', ['Tuple', 1, 2]]);
    expect(r.success).toBe(true);
    expect(r.code).toBe('_SYS.bcast((_tv1) => Math.sin(_tv1), [1, 2])');
    expect(g(['Sin', ['Tuple', 1, 2]])).toBe('sin(vec2(1.0, 2.0))');
  });

  test('a LIST operand of an exempt head is still a collection', () => {
    // The exemption names the TUPLE shape only, so a list of colors is mapped
    // over on both routes: the interpreter broadcasts, and the JavaScript
    // target emits its color-aware map (`_SYS.bcastColor` — the generic
    // broadcast cannot serve, because one color is itself an array of
    // channels). See `compile-color-broadcast.test.ts`.
    const expr = ['AsRgb', ['List', ['Rgb', 1, 0, 0], ['Rgb', 0, 1, 0]]];
    expect(ce.box(expr).evaluate().toString()).toBe(
      '[Rgb(1, 0, 0),Rgb(0, 1, 0)]'
    );
    const r = js(expr);
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_SYS.bcastColor((_tv1) => _SYS.asRgb(_tv1), ' +
        '[_SYS.rgb(1, 0, 0), _SYS.rgb(0, 1, 0)])'
    );
    expect(r.run()).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  test('the arithmetic heads keep their element-wise compiled lanes', () => {
    // `Add`, `Multiply`, `Negate`, `Subtract` and `Divide` declare the same
    // exemption, but their exempted shape is value-equivalent under an
    // element-wise lowering — tuple arithmetic IS component-wise — so the
    // compiled lanes reproduce it and must not stand aside.
    const r = js(['Multiply', 2, ['Tuple', 1, 2]]);
    expect(r.success).toBe(true);
    expect(r.code).toBe('_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), 2, [1, 2])');
    expect(r.run({})).toEqual([2, 4]);
  });
});
