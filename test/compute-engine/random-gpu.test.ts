import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import {
  foldSeed,
  frameDraw,
  pcg3dWords,
} from '../../src/compute-engine/numerics/random';

/**
 * The GPU tier of the Random family redesign
 * (`docs/plans/2026-07-25-random-signature-redesign.md` §2 "Parity is tiered",
 * §4 "The GPU boundary is genuinely one-domain", §7 "GPU target", §8).
 *
 * A shader cannot run under jest, so the contract these tests enforce is the
 * EMITTED SOURCE: the PCG3D transcription, the exact power-of-two
 * presentation, the host-folded seed words, the invocation-local counters, and
 * every row of the §7 matrix that must fail closed. The numeric half of the
 * tier — that `(w0 >>> 8) * 2⁻²⁴` really is within 2⁻²⁴ of the f64 draw — is
 * checked in JS against the same `pcg3dWords` the shader transcribes.
 */

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off for the emissions this suite pins.
 * A seeded frame is PURE — `WithRandomSeed(42, Random())` is reproducible, so
 * it has no free variables and no impurity — which makes the whole frame a
 * foldable subtree that would be emitted as one f64 literal
 * (`0.7367300395263549`). That is a legitimate optimization, but it erases
 * exactly what is under test here: the PCG3D transcription, the seed-word ABI,
 * the invocation-local counters, and the fail-closed throws that only the
 * structural lowering reaches. The runtime/on-GPU behaviour of a folded draw is
 * covered by the numeric tier (`frameDraw`/`pcg3dWords`) below.
 */
const NO_FOLD = { constantFold: false } as const;

/** `code + preamble` — the two halves a caller concatenates. */
function source(target: GLSLTarget | WGSLTarget, expr: any): string {
  const r = target.compile(expr, NO_FOLD);
  expect(r.success).toBe(true);
  return `${r.preamble ?? ''}\n${r.code}`;
}

const framed = (seed: any, body: any) =>
  ce.box(['WithRandomSeed', seed, body] as any);

describe('GPU random — the PCG3D preamble', () => {
  // The generator is a CROSS-VERSION CONTRACT: these constants and this
  // operation order are what a third party reimplements from the paper
  // (Jarzynski & Olano, JCGT 2020, §6). A diff here is a breaking change.
  for (const [name, target] of [
    ['GLSL', glsl],
    ['WGSL', wgsl],
  ] as const) {
    it(`${name} emits pcg3d verbatim when a draw is compiled`, () => {
      const src = source(target, framed(42, ce.expr(['Random'])));
      expect(src).toContain('1664525u');
      expect(src).toContain('1013904223u');
      // The two cross-multiply-add rounds, sequential in both.
      expect(src).toContain('v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;');
      // The xor-shift-right-16 between them.
      expect(src).toMatch(/>>\s*(16u|vec3<u32>\(16u\))/);
    });

    it(`${name} presents the draw as (w0 >> 8) * 2^-24, an exact power of two`, () => {
      const src = source(target, framed(42, ce.expr(['Random'])));
      // The top 24 bits of w0 — the SAME w0 the f64 tier is built from.
      expect(src).toContain('w.x >> 8u');
      // An exact power-of-two scaling, never implementation-rounded float math.
      expect(src).toContain('(1.0 / 16777216.0)');
      expect(1.0 / 16777216.0).toBe(2 ** -24);
      // No trace of the retired fract-sin hash.
      expect(src).not.toContain('_gpu_random');
      expect(src).not.toContain('43758.5453');
    });

    it(`${name} emits no random preamble for an expression with no draw`, () => {
      const r = target.compile(ce.parse('x + 1'));
      expect(r.preamble ?? '').not.toContain('_gpu_pcg3d');
    });
  }

  it('GLSL declares the counter as a per-invocation uint global', () => {
    const src = source(glsl, framed(42, ce.expr(['Random'])));
    expect(src).toContain('uint _gpu_rnd_n0 = 0u;');
    expect(src).toContain('float _gpu_rnd_draw(uvec2 seed, inout uint n)');
  });

  it('WGSL declares the counter as a per-invocation private var', () => {
    const src = source(wgsl, framed(42, ce.expr(['Random'])));
    expect(src).toContain('var<private> _gpu_rnd_n0: u32 = 0u;');
    expect(src).toContain(
      'fn _gpu_rnd_draw(seed: vec2<u32>, n: ptr<private, u32>) -> f32'
    );
  });
});

describe('GPU random — the invocation-local counter', () => {
  it('the draw helper advances the counter it is handed', () => {
    // `n = 0, 1, …` in execution order: the counter is a shader-local mutable
    // incremented per draw, so repeated draws in one frame decorrelate rather
    // than returning one value.
    const src = source(glsl, framed(42, ce.expr(['Random'])));
    expect(src).toContain('n = n + 1u;');
  });

  it('GLSL passes the counter by `inout`, WGSL by pointer', () => {
    expect(source(glsl, framed(42, ce.expr(['Random'])))).toMatch(
      /_gpu_rnd_draw\(uvec2\([^)]*\), _gpu_rnd_n0\)/
    );
    expect(source(wgsl, framed(42, ce.expr(['Random'])))).toMatch(
      /_gpu_rnd_draw\(vec2<u32>\([^)]*\), &_gpu_rnd_n0\)/
    );
  });

  it('two draws in ONE frame share that frame’s counter', () => {
    const code = glsl.compile(
      framed(42, ce.box(['Add', ['Random'], ['Random']])),
      NO_FOLD
    ).code;
    expect(code.match(/_gpu_rnd_n0/g)).toHaveLength(2);
    expect(code).not.toContain('_gpu_rnd_n1');
  });

  it('repeated UNFRAMED draws share the one spatial counter', () => {
    const code = glsl.compile(ce.box(['Add', ['Random'], ['Random']])).code;
    expect(code.match(/_gpu_rnd_n0/g)).toHaveLength(2);
    expect(code).not.toContain('_gpu_rnd_n1');
  });

  it('nested lexical frames get PER-FRAME counters', () => {
    // §2: a frame's n-th draw is hash(seed, n) regardless of nested frames, so
    // an inner frame cannot perturb its parent's subsequent draws.
    const expr = framed(
      1,
      ce.box(['Add', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']])
    );
    const r = glsl.compile(expr, NO_FOLD);
    const outer = foldSeed(1);
    const inner = foldSeed(2);
    const hex = (w: number) => `0x${w.toString(16).padStart(8, '0')}u`;

    // The outer frame's two draws share counter n0; the inner frame owns n1.
    expect(r.code.match(/_gpu_rnd_n0/g)).toHaveLength(2);
    expect(r.code.match(/_gpu_rnd_n1/g)).toHaveLength(1);
    expect(r.code).toContain(
      `uvec2(${hex(outer[0])}, ${hex(outer[1])}), _gpu_rnd_n0`
    );
    expect(r.code).toContain(
      `uvec2(${hex(inner[0])}, ${hex(inner[1])}), _gpu_rnd_n1`
    );
    // Both counters are declared, each starting at 0 for every invocation.
    expect(r.preamble).toContain('uint _gpu_rnd_n0 = 0u;');
    expect(r.preamble).toContain('uint _gpu_rnd_n1 = 0u;');
  });
});

describe('GPU seed ABI (§7)', () => {
  const hex = (w: number) => `0x${w.toString(16).padStart(8, '0')}u`;

  it('a compile-time NUMERIC literal folds on the HOST — stream-identical', () => {
    const [lo, hi] = foldSeed(42);
    expect(glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).code).toContain(
      `uvec2(${hex(lo)}, ${hex(hi)})`
    );
    expect(wgsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).code).toContain(
      `vec2<u32>(${hex(lo)}, ${hex(hi)})`
    );
    // The words are the normative `foldSeed` output, not an ad-hoc GPU fold.
    expect([lo, hi]).toEqual([0x40450000, 0x00000000]);
  });

  it('a compile-time STRING literal folds on the HOST', () => {
    const [lo, hi] = foldSeed('cell-a7');
    expect(
      glsl.compile(framed(ce.string('cell-a7'), ce.expr(['Random'])), NO_FOLD)
        .code
    ).toContain(`uvec2(${hex(lo)}, ${hex(hi)})`);
  });

  it('a fractional literal keeps BOTH words (no XOR fold)', () => {
    const [lo, hi] = foldSeed(1234.5);
    expect(
      glsl.compile(framed(1234.5, ce.expr(['Random'])), NO_FOLD).code
    ).toContain(`uvec2(${hex(lo)}, ${hex(hi)})`);
  });

  it('an engine value the compiler folds is still a HOST fold', () => {
    const e = new ComputeEngine();
    e.declare('k', 'real');
    e.assign('k', 1234.5);
    const [lo, hi] = foldSeed(1234.5);
    const code = glsl.compile(
      e.box(['WithRandomSeed', 'k', ['Random']]),
      NO_FOLD
    ).code;
    expect(code).toContain(`uvec2(${hex(lo)}, ${hex(hi)})`);
  });

  it('a shader-computed seed folds IN-SHADER by exact bit reinterpretation', () => {
    // An invocation-varying seed (a per-pixel seed) has no host counterpart to
    // agree with, so it derives its OWN stream: seedLo = the seed's bits,
    // seedHi = 0.
    const e = new ComputeEngine();
    e.declare('p', 'real');
    const expr = e.box(['WithRandomSeed', 'p', ['Random']]);
    expect(glsl.compile(expr).code).toContain(
      'uvec2(floatBitsToUint(p), 0u)'
    );
    expect(wgsl.compile(expr).code).toContain(
      'vec2<u32>(bitcast<u32>(p), 0u)'
    );
  });

  it('a RUNTIME string seed is a compile error on both languages', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    const expr = e.box(['WithRandomSeed', 's', ['Random']]);
    for (const target of [glsl, wgsl])
      expect(() => target.compile(expr)).toThrow(/string/i);
  });
});

describe('seed ABI — once-evaluation and the deferred host-uniform row', () => {
  const hex = (w: number) => `0x${(w >>> 0).toString(16).padStart(8, '0')}u`;

  it('a DECLARED CONSTANT seed folds on the host, from its VALUE', () => {
    // Read off the expression, never off the emitted source: `Pi` emits the
    // truncated `3.14159265359`, which folds to a different f64 than
    // `Math.PI` — a silently different stream from the host tier.
    const [lo, hi] = foldSeed(Math.PI);
    const code = glsl.compile(framed('Pi', ce.expr(['Random']))).code;
    expect(code).toContain(`uvec2(${hex(lo)}, ${hex(hi)})`);
    expect(code).not.toContain('floatBitsToUint');
    expect(code).not.toContain('3.14159265359');
  });

  it('a seed supplied through `vars` throws, naming the seed ABI', () => {
    // The host would fold an f64 seed into TWO words; a shader can only
    // reinterpret the f32 bits it receives. Deferred, but LOUD.
    const e = new ComputeEngine();
    e.declare('s', 'real');
    expect(() =>
      glsl.compile(e.box(['WithRandomSeed', 's', ['Random']] as any), {
        vars: { s: 'u_seed' },
      })
    ).toThrow(/seed ABI/);
  });

  it('a COMPUTED seed throws — it would be spliced at every draw site', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    expect(() =>
      glsl.compile(e.box(['WithRandomSeed', ['Multiply', 'x', 2], ['Random']] as any))
    ).toThrow(/COMPUTED seed/);
  });

  it('an IMPURE seed throws on both languages', () => {
    const expr = ce.box(['WithRandomSeed', ['Random'], ['Random']] as any);
    for (const target of [glsl, wgsl])
      expect(() => target.compile(expr)).toThrow(/not pure/);
  });

  it('an IMPURE Interval endpoint throws — it is spliced more than once', () => {
    expect(() =>
      glsl.compile(
        framed(42, ce.box(['Random', ['Interval', ['Random'], 1]] as any)),
        NO_FOLD
      )
    ).toThrow(/not pure/);
    expect(() =>
      glsl.compile(
        framed(42, ce.box(['Random', ['Interval', 0, ['Random']]] as any)),
        NO_FOLD
      )
    ).toThrow(/not pure/);
  });

  it('a PURE symbolic Interval endpoint still compiles (ALU cost only)', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real');
    e.declare('b', 'real');
    expect(
      e.box(['WithRandomSeed', 42, ['Random', ['Interval', 'a', 'b']]] as any)
    ).toBeDefined();
    expect(
      glsl.compile(
        e.box(['WithRandomSeed', 42, ['Random', ['Interval', 'a', 'b']]] as any)
      ).code
    ).toBe(
      '((a) + _gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0) * ((b) - (a)))'
    );
    // Pure arithmetic on a uniform is side-effect free: duplicating it costs
    // ALU, not draws.
    const e2 = new ComputeEngine();
    e2.declare('x', 'real');
    expect(
      glsl.compile(
        e2.box([
          'WithRandomSeed',
          42,
          ['Random', ['Interval', ['Multiply', 'x', 2], 1]],
        ] as any)
      ).success
    ).toBe(true);
  });
});

describe('the random state is per-compilation, never on the caller’s target', () => {
  it('a hand-rolled target is not mutated by a compilation', () => {
    // A target that never went through `createTarget()` carries no
    // compilation identity; its state lives in a module-level WeakMap, so a
    // caller that reuses the object gets no engine bookkeeping written onto
    // it.
    const foreign: any = { ...glsl.createTarget(), ...NO_FOLD };
    delete foreign.gpuRandomRoot;
    const before = Object.keys(foreign).sort();
    const code = BaseCompiler.compile(
      framed(42, ce.expr(['Random'])) as any,
      foreign
    );
    expect(code).toContain('_gpu_rnd_draw');
    expect(Object.keys(foreign).sort()).toEqual(before);
  });

  it('each compile() call restarts the counter numbering', () => {
    // Every internal compilation creates a fresh root target, so repeated
    // compilations of one expression are byte-identical.
    const expr = framed(42, ce.expr(['Random']));
    const first = glsl.compile(expr, NO_FOLD);
    const second = glsl.compile(expr, NO_FOLD);
    expect(second.code).toBe(first.code);
    expect(second.preamble).toBe(first.preamble);
    expect(second.code).toContain('_gpu_rnd_n0');
    expect(second.code).not.toContain('_gpu_rnd_n1');
  });

  it('a REUSED external target restarts the numbering too', () => {
    // The caller builds the target once and passes it to two successive
    // `compile()` calls. Without the compilation-boundary hook the second
    // compilation continued the first one's numbering (`_gpu_rnd_n1`), so two
    // compilations of ONE expression emitted different source — recompile
    // replay was broken on the external-target path only.
    const expr = framed(42, ce.expr(['Random']));
    const target = glsl.createTarget();
    const first = compile(expr as any, { target, fallback: false, ...NO_FOLD });
    const second = compile(expr as any, { target, fallback: false, ...NO_FOLD });
    expect(second.code).toBe(first.code);
    expect(second.code).toContain('_gpu_rnd_n0');
    expect(second.code).not.toContain('_gpu_rnd_n1');
  });

  it('the reset reaches a spread copy of a target', () => {
    // `{ ...target }` copies the identity token by reference (and a
    // hand-rolled target has none at all), so the hook resets through the
    // target it is HANDED, not one captured when the target was created.
    const expr = framed(42, ce.expr(['Random']));
    const foreign: any = { ...glsl.createTarget(), ...NO_FOLD };
    delete foreign.gpuRandomRoot;
    const first = BaseCompiler.compileRoot(expr as any, foreign);
    const second = BaseCompiler.compileRoot(expr as any, foreign);
    expect(second).toBe(first);
    expect(second).toContain('_gpu_rnd_n0');
    // Still nothing written onto the caller's object.
    expect(Object.keys(foreign)).not.toContain('gpuRandomRoot');
  });

  it('a shader body keeps ONE numbering across its statements', () => {
    // The compilation boundary is the ROOT of a compilation, not every
    // `BaseCompiler.compile()` call: a shader body compiles each of its
    // statements against a single target so two independent frames cannot
    // alias one counter.
    const src = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'a', type: 'float' }],
      body: [
        { variable: 'a', expression: framed(1, ce.expr(['Random'])) },
        { variable: 'b', expression: framed(2, ce.expr(['Random'])) },
      ],
      ...NO_FOLD,
    } as any);
    expect([...new Set(src.match(/_gpu_rnd_n\d+/g) ?? [])].sort()).toEqual([
      '_gpu_rnd_n0',
      '_gpu_rnd_n1',
    ]);
  });
});

describe('§7 form matrix — GLSL', () => {
  it('Random() unframed → deterministic spatial noise (fragment stage)', () => {
    const code = glsl.compile(ce.expr(['Random'])).code;
    // A gl_FragCoord-derived seed through PCG3D — both coordinates
    // reinterpreted whole, so there is no row-aliasing bound.
    expect(code).toContain('floatBitsToUint(gl_FragCoord.x)');
    expect(code).toContain('floatBitsToUint(gl_FragCoord.y)');
    expect(code).toContain('_gpu_rnd_draw(');
  });

  it('Random() unframed in a VERTEX shader throws', () => {
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        outputs: [{ name: 'vNoise', type: 'float' }],
        body: [{ variable: 'vNoise', expression: ce.expr(['Random']) }],
      })
    ).toThrow(/fragment shader|vertex/);
  });

  it('a FRAMED draw compiles in a vertex shader (stage-independent)', () => {
    const shader = glsl.compileShader({
      type: 'vertex',
      outputs: [{ name: 'vNoise', type: 'float' }],
      body: [
        {
          variable: 'vNoise',
          expression: framed(42, ce.expr(['Random'])),
        },
      ],
      ...NO_FOLD,
    });
    expect(shader).toContain('_gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u)');
    expect(shader).not.toContain('gl_FragCoord');
  });

  it('Random() / Random(Interval) / Random(Range) inside a frame compile', () => {
    expect(glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).success).toBe(
      true
    );
    expect(
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 2, 5]])), NO_FOLD)
        .code
    ).toBe('(2.0 + _gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0) * 3.0)');
    expect(
      glsl.compile(framed(42, ce.box(['Random', ['Range', 1, 6]])), NO_FOLD).code
    ).toBe(
      '(1.0 + floor(_gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0) * 6.0))'
    );
  });

  it('Random(Range) uses the range’s NORMALIZED (first, step, count)', () => {
    // `Range(7, 2)` is descending — `range()` infers step −1, count 6 — so the
    // emission must walk DOWN from 7, matching the interpreter.
    expect(
      glsl.compile(framed(42, ce.box(['Random', ['Range', 7, 2]])), NO_FOLD).code
    ).toContain('(7.0 - floor(');
    // An explicit step.
    expect(
      glsl.compile(framed(42, ce.box(['Random', ['Range', 1, 9, 2]])), NO_FOLD)
        .code
    ).toContain('(1.0 + 2.0 * floor(');
  });

  it('Random(collection) throws — no general indexing in a shader', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['List', 1, 2, 3]])), NO_FOLD)
    ).toThrow(/indexing/i);
  });

  it('RandomChoice / RandomSample / RandomShuffle throw', () => {
    const xs = ['List', 1, 2, 3];
    expect(() =>
      glsl.compile(ce.box(['RandomChoice', xs, 2] as any))
    ).toThrow(/RandomChoice/);
    expect(() =>
      glsl.compile(ce.box(['RandomSample', xs, 2] as any))
    ).toThrow(/RandomSample/);
    expect(() => glsl.compile(ce.box(['RandomShuffle', xs] as any))).toThrow(
      /RandomShuffle/
    );
  });

  it('an unbounded / symbolic Range throws rather than guessing a count', () => {
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    expect(() =>
      glsl.compile(
        e.box(['WithRandomSeed', 42, ['Random', ['Range', 1, 'n']]] as any)
      )
    ).toThrow(/constant, finite bounds|constant numeric bounds/);
  });

  it('an empty or reversed Interval throws', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 1, 1]])))
    ).toThrow(/empty or reversed/);
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 1, 0]])))
    ).toThrow(/empty or reversed/);
  });
});

describe('§7 form matrix — WGSL', () => {
  it('Random() unframed throws — no gl_FragCoord, no live stream', () => {
    expect(() => wgsl.compile(ce.expr(['Random']))).toThrow(
      /WGSL|gl_FragCoord/
    );
  });

  it('every unframed form throws, including the closed-form domains', () => {
    expect(() =>
      wgsl.compile(ce.box(['Random', ['Interval', 0, 1]]))
    ).toThrow();
    expect(() => wgsl.compile(ce.box(['Random', ['Range', 1, 6]]))).toThrow();
  });

  it('Random() / Random(Interval) / Random(Range) inside a frame compile', () => {
    expect(wgsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).success).toBe(
      true
    );
    expect(
      wgsl.compile(framed(42, ce.box(['Random', ['Interval', 2, 5]])), NO_FOLD)
        .code
    ).toContain('vec2<u32>(0x40450000u, 0x00000000u)');
    expect(
      wgsl.compile(framed(42, ce.box(['Random', ['Range', 1, 6]])), NO_FOLD).code
    ).toContain('floor(');
  });

  it('Random(collection) and the multi-draw operators throw', () => {
    const xs = ['List', 1, 2, 3];
    expect(() =>
      wgsl.compile(framed(42, ce.box(['Random', xs])), NO_FOLD)
    ).toThrow(/indexing/i);
    expect(() =>
      wgsl.compile(ce.box(['RandomChoice', xs, 2] as any))
    ).toThrow(/RandomChoice/);
    expect(() =>
      wgsl.compile(ce.box(['RandomSample', xs, 2] as any))
    ).toThrow(/RandomSample/);
    expect(() => wgsl.compile(ce.box(['RandomShuffle', xs] as any))).toThrow(
      /RandomShuffle/
    );
  });
});

describe('cross-domain fail-closed (§4)', () => {
  it('an UNFRAMED shader draw compiled inside a HOST frame throws', () => {
    // A shader invocation cannot share the host's mutable counter, and
    // fragments run in parallel, so this must never emit a silent spatial (or
    // live) draw.
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      for (const target of [glsl, wgsl])
        expect(() => target.compile(e.expr(['Random']))).toThrow(
          /cross-domain|host `WithRandomSeed` frame|LEXICAL/
        );
    });
  });

  it('a LEXICAL frame inside the compiled body is fine, host frame or not', () => {
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      const r = glsl.compile(
        e.box(['WithRandomSeed', 7, ['Random']]),
        NO_FOLD
      );
      expect(r.success).toBe(true);
      const [lo, hi] = foldSeed(7);
      expect(r.code).toContain(
        `uvec2(0x${lo.toString(16).padStart(8, '0')}u, 0x${hi
          .toString(16)
          .padStart(8, '0')}u)`
      );
    });
  });

  it('the guard is per-compile: after the host frame pops, spatial noise is legal again', () => {
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      expect(() => glsl.compile(e.expr(['Random']))).toThrow();
    });
    expect(glsl.compile(e.expr(['Random'])).code).toContain('gl_FragCoord');
  });
});

describe('GPU tier vectors (§8)', () => {
  // The shader itself cannot run here, so this checks the FORMULA the emitted
  // source computes: the same `pcg3dWords` the shader transcribes, presented
  // as `(w0 >>> 8) * 2^-24` — the constant the preamble emits.
  const GPU_SCALE = 1.0 / 16777216.0;

  const SEEDS: Array<number | string> = [0, 0.5, 42, 1234.5, 'cell-a7', 'café'];

  it('the emitted scale factor IS 2^-24', () => {
    expect(GPU_SCALE).toBe(2 ** -24);
  });

  for (const seed of SEEDS) {
    const [seedLo, seedHi] = foldSeed(seed);
    for (const n of [0, 1, 2]) {
      it(`(w0 >>> 8) * 2^-24 is within 2^-24 of frameDraw(${
        typeof seed === 'string' ? `"${seed}"` : seed
      }, ${n})`, () => {
        const [w0] = pcg3dWords(seedLo, seedHi, n);
        const gpu = (w0 >>> 8) * GPU_SCALE;
        const f64 = frameDraw(seedLo, seedHi, n);
        expect(gpu).toBeGreaterThanOrEqual(0);
        expect(gpu).toBeLessThan(1);
        // The stated, bounded difference — the two tiers are built from the
        // SAME w0, so this is by construction, not "approximately".
        expect(Math.abs(gpu - f64)).toBeLessThan(2 ** -24);
      });
    }
  }

  it('pins two f32 presentations verbatim (breaking-change contract)', () => {
    expect((pcg3dWords(...foldSeed(0), 0)[0] >>> 8) * GPU_SCALE).toBe(
      0.6081518530845642
    );
    expect((pcg3dWords(...foldSeed(42), 0)[0] >>> 8) * GPU_SCALE).toBe(
      0.7367300391197205
    );
  });

  it('the seed words a GLSL emission carries reproduce that stream', () => {
    // Parse the folded words back OUT of the emitted source and run the
    // reference generator on them: the shader draws the pinned stream.
    const code = glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).code;
    const m = code.match(/uvec2\(0x([0-9a-f]{8})u, 0x([0-9a-f]{8})u\)/);
    expect(m).not.toBeNull();
    const seedLo = parseInt(m![1], 16);
    const seedHi = parseInt(m![2], 16);
    expect([seedLo, seedHi]).toEqual(foldSeed(42));
    const [w0] = pcg3dWords(seedLo, seedHi, 0);
    expect((w0 >>> 8) * GPU_SCALE).toBe(0.7367300391197205);
  });
});

describe('end-to-end emission (drift guard)', () => {
  it('a framed Random(Interval(0,1)) + Random() emission is pinned', () => {
    const expr = framed(
      42,
      ce.box(['Add', ['Random', ['Interval', 0, 1]], ['Random']])
    );
    const r = glsl.compile(expr, NO_FOLD);
    expect(r.code).toMatchInlineSnapshot(
      `"_gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0) + (0.0 + _gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0) * 1.0)"`
    );
    expect(r.preamble).toMatchInlineSnapshot(`
"
uint _gpu_rnd_n0 = 0u;

uvec3 _gpu_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
float _gpu_rnd_draw(uvec2 seed, inout uint n) {
  uvec3 w = _gpu_pcg3d(uvec3(seed.x, seed.y, n));
  n = n + 1u;
  return float(w.x >> 8u) * (1.0 / 16777216.0);
}
"
`);
  });

  it('the WGSL preamble is pinned', () => {
    expect(wgsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD).preamble)
      .toMatchInlineSnapshot(`
"
var<private> _gpu_rnd_n0: u32 = 0u;

fn _gpu_pcg3d(v_in: vec3<u32>) -> vec3<u32> {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
fn _gpu_rnd_draw(seed: vec2<u32>, n: ptr<private, u32>) -> f32 {
  let w = _gpu_pcg3d(vec3<u32>(seed.x, seed.y, *n));
  *n = *n + 1u;
  return f32(w.x >> 8u) * (1.0 / 16777216.0);
}
"
`);
  });
});

describe('route parity — `WithRandomSeed` is lazy', () => {
  // A `lazy: true` operator's held operands arrive UNBOUND on the box and
  // parse routes, so a suite exercising only `ce.function(...)` would miss the
  // whole failure class (CLAUDE.md, "Common API Traps").
  const expected =
    '_gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0)';

  it('box route', () => {
    expect(
      glsl.compile(ce.box(['WithRandomSeed', 42, ['Random']]), NO_FOLD).code
    ).toBe(expected);
  });

  it('parse route', () => {
    expect(
      glsl.compile(
        ce.parse(
          '\\operatorname{WithRandomSeed}(42, \\operatorname{Random}())'
        ),
        NO_FOLD
      ).code
    ).toBe(expected);
  });

  it('ce.function route', () => {
    expect(
      glsl.compile(
        ce.function('WithRandomSeed', [ce.number(42), ce.expr(['Random'])]),
        NO_FOLD
      ).code
    ).toBe(expected);
  });
});

describe('compileShader splices the helper preamble (2026-07-25 fix)', () => {
  // `compileShader` returns a COMPLETE shader — unlike `compile()`, there is
  // no separate `preamble` channel for the caller to assemble — so every
  // `_gpu_*` helper the body references must be DEFINED in the emitted
  // source, ahead of the entry point. Before the fix the emission referenced
  // undefined helpers and failed at GPU shader-compile time (pre-existing for
  // `_gpu_gcd` and the fractal helpers, load-bearing for framed draws).
  it('GLSL: a framed draw shader defines pcg3d and its counter before main()', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [
        {
          variable: 'fragColor.r',
          expression: framed(42, ['Random']),
        },
      ],
      ...NO_FOLD,
    });
    expect(shader).toContain('_gpu_pcg3d');
    expect(shader).toContain('uint _gpu_rnd_n');
    // Definitions precede use: the preamble sits before the entry point.
    expect(shader.indexOf('_gpu_pcg3d')).toBeLessThan(
      shader.indexOf('void main()')
    );
  });

  it('GLSL: a Gamma shader defines _gpu_gamma (the pre-existing helper gap)', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [{ variable: 'fragColor.r', expression: ce.box(['Gamma', 'a']) }],
    });
    expect(shader.indexOf('float _gpu_gamma')).toBeGreaterThanOrEqual(0);
    expect(shader.indexOf('float _gpu_gamma')).toBeLessThan(
      shader.indexOf('void main()')
    );
  });

  it('WGSL: a framed draw shader defines pcg3d and a private counter', () => {
    const shader = wgsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'color', type: 'vec4' }],
      body: [
        { variable: 'output.color', expression: framed(42, ['Random']) },
      ],
      ...NO_FOLD,
    });
    expect(shader).toContain('fn _gpu_pcg3d');
    expect(shader).toContain('var<private> _gpu_rnd_n');
    expect(shader.indexOf('fn _gpu_pcg3d')).toBeLessThan(
      shader.indexOf('fn main(')
    );
  });

  it('GLSL: two framed statements get DISTINCT counters, both declared', () => {
    // ONE target per shader: the counters are numbered per compilation and
    // the preamble declares each allocated name once over the JOINED
    // emission. Compiling each statement against a fresh target restarted the
    // numbering, so two independent frames ALIASED `_gpu_rnd_n0` and the
    // second frame's first draw was `hash(seed, 1)`.
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [
        { variable: 'fragColor.r', expression: framed(42, ['Random']) },
        { variable: 'fragColor.g', expression: framed(42, ['Random']) },
      ],
      ...NO_FOLD,
    });
    expect(shader).toContain(', _gpu_rnd_n0)');
    expect(shader).toContain(', _gpu_rnd_n1)');
    expect(shader).toContain('uint _gpu_rnd_n0 = 0u;');
    expect(shader).toContain('uint _gpu_rnd_n1 = 0u;');
  });

  it('WGSL: two framed statements get DISTINCT counters, both declared', () => {
    const shader = wgsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'color', type: 'vec4' }],
      body: [
        { variable: 'output.color', expression: framed(42, ['Random']) },
        { variable: 'output.color2', expression: framed(42, ['Random']) },
      ],
      ...NO_FOLD,
    });
    expect(shader).toContain(', &_gpu_rnd_n0)');
    expect(shader).toContain(', &_gpu_rnd_n1)');
    expect(shader).toContain('var<private> _gpu_rnd_n0: u32 = 0u;');
    expect(shader).toContain('var<private> _gpu_rnd_n1: u32 = 0u;');
  });

  it('a GLSL fragment shader pins highp INT as well as highp float', () => {
    // PCG3D is pure u32 arithmetic; the default integer precision of an
    // ES 3.00 fragment shader is not reliably `highp`.
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [{ variable: 'fragColor.r', expression: framed(42, ['Random']) }],
    });
    expect(shader).toContain('precision highp float;');
    expect(shader).toContain('precision highp int;');
  });

  it('a helper-free shader gains no preamble', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      body: [
        { variable: 'fragColor.r', expression: ce.box(['Add', 'a', 1]) },
      ],
    });
    expect(shader).not.toContain('_gpu_');
  });
});
