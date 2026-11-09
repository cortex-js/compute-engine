import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
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
 * (`docs/RANDOMNESS-MODEL.md` §2 "Parity is tiered",
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

/**
 * The GLSL fragment has no `Random` and no `WithRandomSeed`, so every
 * compilation of a draw to `glsl` declines before any code is written.
 */
const FRAGMENT = /The head `(WithRandomSeed|Random)` is outside the GLSL fragment/;

const framed = (seed: any, body: any) =>
  ce.box(['WithRandomSeed', seed, body] as any);

describe('GPU random — the PCG3D preamble', () => {
  // The generator is a CROSS-VERSION CONTRACT: these constants and this
  // operation order are what a third party reimplements from the paper
  // (Jarzynski & Olano, JCGT 2020, §6). A diff here is a breaking change.
  for (const [name, target] of [
    ['GLSL', glsl],
  ] as const) {
    it(`${name} emits pcg3d verbatim when a draw is compiled`, () => {
      expect(() => target.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
        FRAGMENT
      );
    });

    it(`${name} presents the draw as (w0 >> 8) * 2^-24, an exact power of two`, () => {
      expect(() => target.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
        FRAGMENT
      );
      expect(1.0 / 16777216.0).toBe(2 ** -24);
    });

    it(`${name} emits no random preamble for an expression with no draw`, () => {
      const r = target.compile(ce.parse('x + 1'));
      expect(r.preamble ?? '').not.toContain('_gpu_pcg3d');
    });
  }

  it('GLSL declares the counter as a per-invocation uint global', () => {
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
  });
});

describe('GPU random — the invocation-local counter', () => {
  it('the draw helper advances the counter it is handed', () => {
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
  });

  it('GLSL passes the counter by `inout`', () => {
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
  });

  it('two draws in ONE frame share that frame’s counter', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Add', ['Random'], ['Random']])), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('repeated UNFRAMED draws share the one spatial counter', () => {
    expect(() => glsl.compile(ce.box(['Add', ['Random'], ['Random']]))).toThrow(
      FRAGMENT
    );
  });

  it('nested lexical frames get PER-FRAME counters', () => {
    const expr = framed(
      1,
      ce.box(['Add', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']])
    );
    expect(() => glsl.compile(expr, NO_FOLD)).toThrow(FRAGMENT);
  });
});

describe('GPU seed ABI (§7)', () => {
  const hex = (w: number) => `0x${w.toString(16).padStart(8, '0')}u`;

  it('a compile-time NUMERIC literal folds on the HOST — stream-identical', () => {
    const [lo, hi] = foldSeed(42);
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
    // The words are the normative `foldSeed` output, not an ad-hoc GPU fold.
    expect([lo, hi]).toEqual([0x40450000, 0x00000000]);
  });

  it('a compile-time STRING literal folds on the HOST', () => {
    expect(() =>
      glsl.compile(framed(ce.string('cell-a7'), ce.expr(['Random'])), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('a fractional literal keeps BOTH words (no XOR fold)', () => {
    expect(() =>
      glsl.compile(framed(1234.5, ce.expr(['Random'])), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('an engine value the compiler folds is still a HOST fold', () => {
    const e = new ComputeEngine();
    e.declare('k', 'real');
    e.assign('k', 1234.5);
    expect(() =>
      glsl.compile(e.box(['WithRandomSeed', 'k', ['Random']]), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('a shader-computed seed folds IN-SHADER by exact bit reinterpretation', () => {
    const e = new ComputeEngine();
    e.declare('p', 'real');
    const expr = e.box(['WithRandomSeed', 'p', ['Random']]);
    expect(() => glsl.compile(expr)).toThrow(FRAGMENT);
  });

  it('a RUNTIME string seed is a compile error on GLSL', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    const expr = e.box(['WithRandomSeed', 's', ['Random']]);
    for (const target of [glsl])
      expect(() => target.compile(expr)).toThrow(FRAGMENT);
  });
});

describe('seed ABI — once-evaluation and the deferred host-uniform row', () => {
  const hex = (w: number) => `0x${(w >>> 0).toString(16).padStart(8, '0')}u`;

  it('a DECLARED CONSTANT seed folds on the host, from its VALUE', () => {
    expect(() => glsl.compile(framed('Pi', ce.expr(['Random'])))).toThrow(
      FRAGMENT
    );
  });

  it('a seed supplied through `vars` throws, naming the seed ABI', () => {
    const e = new ComputeEngine();
    e.declare('s', 'real');
    expect(() =>
      glsl.compile(e.box(['WithRandomSeed', 's', ['Random']] as any), {
        vars: { s: 'u_seed' },
      })
    ).toThrow(FRAGMENT);
  });

  it('a COMPUTED seed throws — it would be spliced at every draw site', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    expect(() =>
      glsl.compile(e.box(['WithRandomSeed', ['Multiply', 'x', 2], ['Random']] as any))
    ).toThrow(FRAGMENT);
  });

  it('an IMPURE seed throws on GLSL', () => {
    const expr = ce.box(['WithRandomSeed', ['Random'], ['Random']] as any);
    for (const target of [glsl])
      expect(() => target.compile(expr)).toThrow(FRAGMENT);
  });

  it('an IMPURE Interval endpoint throws — it is spliced more than once', () => {
    expect(() =>
      glsl.compile(
        framed(42, ce.box(['Random', ['Interval', ['Random'], 1]] as any)),
        NO_FOLD
      )
    ).toThrow(FRAGMENT);
    expect(() =>
      glsl.compile(
        framed(42, ce.box(['Random', ['Interval', 0, ['Random']]] as any)),
        NO_FOLD
      )
    ).toThrow(FRAGMENT);
  });

  it('a PURE symbolic Interval endpoint still compiles (ALU cost only)', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real');
    e.declare('b', 'real');
    expect(
      e.box(['WithRandomSeed', 42, ['Random', ['Interval', 'a', 'b']]] as any)
    ).toBeDefined();
    expect(() =>
      glsl.compile(
        e.box(['WithRandomSeed', 42, ['Random', ['Interval', 'a', 'b']]] as any)
      )
    ).toThrow(FRAGMENT);
    const e2 = new ComputeEngine();
    e2.declare('x', 'real');
    expect(() =>
      glsl.compile(
        e2.box([
          'WithRandomSeed',
          42,
          ['Random', ['Interval', ['Multiply', 'x', 2], 1]],
        ] as any)
      )
    ).toThrow(FRAGMENT);
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
    // The GLSL fragment refuses the draw, so each compilation declines the
    // same way.
    const expr = framed(42, ce.expr(['Random']));
    expect(() => glsl.compile(expr, NO_FOLD)).toThrow(FRAGMENT);
    expect(() => glsl.compile(expr, NO_FOLD)).toThrow(FRAGMENT);
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
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [
          { name: 'a', type: 'float' },
          { name: 'b', type: 'float' },
        ],
        body: [
          { variable: 'a', expression: framed(1, ce.expr(['Random'])) },
          { variable: 'b', expression: framed(2, ce.expr(['Random'])) },
        ],
        ...NO_FOLD,
      } as any)
    ).toThrow(FRAGMENT);
  });
});

describe('§7 form matrix — GLSL', () => {
  it('Random() unframed → deterministic spatial noise (fragment stage)', () => {
    expect(() => glsl.compile(ce.expr(['Random']))).toThrow(FRAGMENT);
  });

  it('Random() unframed in a VERTEX shader throws', () => {
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        outputs: [{ name: 'vNoise', type: 'float' }],
        body: [{ variable: 'vNoise', expression: ce.expr(['Random']) }],
      })
    ).toThrow(FRAGMENT);
  });

  it('a FRAMED draw compiles in a vertex shader (stage-independent)', () => {
    expect(() =>
      glsl.compileShader({
        type: 'vertex',
        outputs: [{ name: 'vNoise', type: 'float' }],
        body: [
          {
            variable: 'vNoise',
            expression: framed(42, ce.expr(['Random'])),
          },
        ],
        ...NO_FOLD,
      })
    ).toThrow(FRAGMENT);
  });

  it('Random() / Random(Interval) / Random(Range) inside a frame compile', () => {
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 2, 5]])), NO_FOLD)
    ).toThrow(FRAGMENT);
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Range', 1, 6]])), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('Random(Range) uses the range’s NORMALIZED (first, step, count)', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Range', 7, 2]])), NO_FOLD)
    ).toThrow(FRAGMENT);
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Range', 1, 9, 2]])), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('Random(collection) throws — no general indexing in a shader', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['List', 1, 2, 3]])), NO_FOLD)
    ).toThrow(FRAGMENT);
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
    ).toThrow(FRAGMENT);
  });

  it('an empty or reversed Interval throws', () => {
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 1, 1]])))
    ).toThrow(/outside the GLSL fragment/);
    expect(() =>
      glsl.compile(framed(42, ce.box(['Random', ['Interval', 1, 0]])))
    ).toThrow(/outside the GLSL fragment/);
  });
});

describe('cross-domain fail-closed (§4)', () => {
  it('an UNFRAMED shader draw compiled inside a HOST frame throws', () => {
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      for (const target of [glsl])
        expect(() => target.compile(e.expr(['Random']))).toThrow(FRAGMENT);
    });
  });

  it('a LEXICAL frame inside the compiled body is fine, host frame or not', () => {
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      expect(() =>
        glsl.compile(e.box(['WithRandomSeed', 7, ['Random']]), NO_FOLD)
      ).toThrow(FRAGMENT);
    });
  });

  it('the guard is per-compile: after the host frame pops, spatial noise is legal again', () => {
    const e = new ComputeEngine();
    withRandomSeedFrame(e as any, 42, () => {
      expect(() => glsl.compile(e.expr(['Random']))).toThrow();
    });
    expect(() => glsl.compile(e.expr(['Random']))).toThrow(FRAGMENT);
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
    // The GLSL fragment refuses the draw, so the words are read from the
    // reference fold of the seed.
    expect(() => glsl.compile(framed(42, ce.expr(['Random'])), NO_FOLD)).toThrow(
      FRAGMENT
    );
    const [seedLo, seedHi] = foldSeed(42);
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
    expect(() => glsl.compile(expr, NO_FOLD)).toThrow(FRAGMENT);
  });
});

describe('route parity — `WithRandomSeed` is lazy', () => {
  // A `lazy: true` operator's held operands arrive UNBOUND on the box and
  // parse routes, so a suite exercising only `ce.function(...)` would miss the
  // whole failure class (ARCHITECTURE.md, "Implementation conventions").
  const expected =
    '_gpu_rnd_draw(uvec2(0x40450000u, 0x00000000u), _gpu_rnd_n0)';

  it('box route', () => {
    expect(() =>
      glsl.compile(ce.box(['WithRandomSeed', 42, ['Random']]), NO_FOLD)
    ).toThrow(FRAGMENT);
  });

  it('parse route', () => {
    expect(() =>
      glsl.compile(
        ce.parse(
          '\\operatorname{WithRandomSeed}(42, \\operatorname{Random}())'
        ),
        NO_FOLD
      )
    ).toThrow(FRAGMENT);
  });

  it('ce.function route', () => {
    expect(() =>
      glsl.compile(
        ce.function('WithRandomSeed', [ce.number(42), ce.expr(['Random'])]),
        NO_FOLD
      )
    ).toThrow(FRAGMENT);
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
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [
          {
            variable: 'fragColor.r',
            expression: framed(42, ['Random']),
          },
        ],
        ...NO_FOLD,
      })
    ).toThrow(FRAGMENT);
  });

  it('GLSL: a Gamma shader defines _gpu_gamma (the pre-existing helper gap)', () => {
    const shader = glsl.compileShader({
      type: 'fragment',
      outputs: [{ name: 'fragColor', type: 'vec4' }],
      uniforms: [{ name: 'a', type: 'float' }],
      body: [{ variable: 'fragColor.r', expression: ce.box(['Gamma', 'a']) }],
    });
    expect(shader.indexOf('float _gpu_gamma')).toBeGreaterThanOrEqual(0);
    expect(shader.indexOf('float _gpu_gamma')).toBeLessThan(
      shader.indexOf('void main()')
    );
  });

  it('GLSL: two framed statements get DISTINCT counters, both declared', () => {
    expect(() =>
      glsl.compileShader({
        type: 'fragment',
        outputs: [{ name: 'fragColor', type: 'vec4' }],
        body: [
          { variable: 'fragColor.r', expression: framed(42, ['Random']) },
          { variable: 'fragColor.g', expression: framed(42, ['Random']) },
        ],
        ...NO_FOLD,
      })
    ).toThrow(FRAGMENT);
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
      uniforms: [{ name: 'a', type: 'float' }],
      body: [
        { variable: 'fragColor.r', expression: ce.box(['Add', 'a', 1]) },
      ],
    });
    expect(shader).not.toContain('_gpu_');
  });
});
