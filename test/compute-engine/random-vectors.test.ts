import { ComputeEngine } from '../../src/compute-engine';
import {
  foldSeed,
  frameDraw,
  pcg3d,
  pcg3dWords,
} from '../../src/compute-engine/numerics/random';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STABILITY VECTORS — BREAKING-CHANGE CONTRACT. DO NOT REGENERATE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These vectors pin the seed→stream mapping of the random family
 * (`docs/plans/2026-07-25-random-signature-redesign.md` §2, §4, §8):
 * `foldSeed`, the PCG3D words, and both presentations.
 *
 * A DIFF IN THIS TABLE IS A BREAKING CHANGE, not a test update. The mapping is
 * a persistence surface: changing it re-randomizes every stored document that
 * carries a `WithRandomSeed` frame and churns every render ground-truth
 * corpus. If a change here is genuinely intended, it ships as a breaking
 * release with a migration note — never by running the suite with `-u` or by
 * pasting fresh numbers.
 *
 * The generator is PCG3D — Jarzynski & Olano, *Hash Functions for GPU
 * Rendering*, JCGT 2020, §6 (https://jcgt.org/published/0009/03/02/paper.pdf).
 * It is pure u32 arithmetic so that a third party (or a shader) can
 * reimplement it from the paper and check it against the raw words below.
 *
 * ── Hand-verification of one vector, step by step ──────────────────────────
 *
 * Seed `0`, draw index `n = 0`.
 *
 *   foldSeed(0):  the f64 bit pattern of +0 is all zeros, so
 *                 seedLo = 0x00000000, seedHi = 0x00000000.
 *   inputs:       v = (0x00000000, 0x00000000, 0x00000000)
 *
 *   v = v*1664525 + 1013904223  (mod 2³²)
 *                 → (0x3c6ef35f, 0x3c6ef35f, 0x3c6ef35f)
 *   v.x += v.y*v.z → 0x3c6ef35f + 0x3c6ef35f*0x3c6ef35f = 0xd17070a0
 *   v.y += v.z*v.x → 0x3c6ef35f + 0x3c6ef35f*0xd17070a0 = 0x94d09ebf
 *   v.z += v.x*v.y → 0x3c6ef35f + 0xd17070a0*0x94d09ebf = 0xe6d5babf
 *                 (each add reads the word just updated — the ops are
 *                  sequential, not parallel)
 *   v ^= v >> 16  → (0xd170a1d0, 0x94d00a6f, 0xe6d55c6a)
 *   v.x += v.y*v.z → 0x9bafd7c6   ← w0
 *   v.y += v.z*v.x → 0xa8e88a6b   ← w1
 *   v.z += v.x*v.y → 0x3f15482c   ← w2 (unused)
 *
 *   f64 tier = (w0 * 2²¹ + (w1 >>> 11)) * 2⁻⁵³
 *            = (0x9bafd7c6 * 2097152 + 1383697) * 2⁻⁵³
 *            = (5477745333108736 + 1383697) / 9007199254740992
 *            = 0.6081518993386529
 *   f32 tier = (w0 >>> 8) * 2⁻²⁴ = 0x9bafd7 / 16777216 = 0.6081518530845642
 *
 * The whole 32-bit-modular pipeline was additionally cross-checked against an
 * independent `BigInt`-mod-2³² implementation (no `Math.imul`) at five input
 * triples, including `0xffffffff` operands.
 */

type Vector = {
  seed: number | string;
  seedLo: number;
  seedHi: number;
  draws: { n: number; w0: number; w1: number; f64: number; f32: number }[];
};

const VECTORS: Vector[] = [
  {
    seed: 0,
    seedLo: 0x00000000,
    seedHi: 0x00000000,
    draws: [
      {
        n: 0,
        w0: 0x9bafd7c6,
        w1: 0xa8e88a6b,
        f64: 0.6081518993386529,
        f32: 0.6081518530845642,
      },
      {
        n: 1,
        w0: 0x7f5db8d2,
        w1: 0x68e0a5ac,
        f64: 0.4975238336272718,
        f32: 0.49752378463745117,
      },
      {
        n: 2,
        w0: 0xe1267f56,
        w1: 0x5451f9b8,
        f64: 0.8794936738743856,
        f32: 0.8794936537742615,
      },
    ],
  },
  {
    seed: 0.5,
    seedLo: 0x3fe00000,
    seedHi: 0x00000000,
    draws: [
      {
        n: 0,
        w0: 0xcc461cc6,
        w1: 0x05050d0b,
        f64: 0.7979448302694615,
        f32: 0.7979447841644287,
      },
      {
        n: 1,
        w0: 0x07bf88f2,
        w1: 0xe7018d6c,
        f64: 0.030266341497741434,
        f32: 0.030266284942626953,
      },
      {
        n: 2,
        w0: 0xaea1e916,
        w1: 0xc4ec0058,
        f64: 0.6821580582226687,
        f32: 0.6821580529212952,
      },
    ],
  },
  {
    seed: 42,
    seedLo: 0x40450000,
    seedHi: 0x00000000,
    draws: [
      {
        n: 0,
        w0: 0xbc9a5701,
        w1: 0xbf196adb,
        f64: 0.7367300395263549,
        f32: 0.7367300391197205,
      },
      {
        n: 1,
        w0: 0x73298ec1,
        w1: 0x58edb0a5,
        f64: 0.4498528692283148,
        f32: 0.4498528242111206,
      },
      {
        n: 2,
        w0: 0xd3042923,
        w1: 0x878903a7,
        f64: 0.8242822372190268,
        f32: 0.8242822289466858,
      },
    ],
  },
  {
    seed: 1234.5,
    seedLo: 0x40934a00,
    seedHi: 0x00000000,
    draws: [
      {
        n: 0,
        w0: 0x6db9670f,
        w1: 0x20f959bf,
        f64: 0.4286102687774237,
        f32: 0.42861026525497437,
      },
      {
        n: 1,
        w0: 0x2373473b,
        w1: 0x548ba081,
        f64: 0.13847775648586813,
        f32: 0.13847774267196655,
      },
      {
        n: 2,
        w0: 0xfa3eaa2f,
        w1: 0x0ea46603,
        f64: 0.977518688667844,
        f32: 0.9775186777114868,
      },
    ],
  },
  {
    seed: 'cell-a7',
    seedLo: 0x1163a2f4,
    seedHi: 0x96eac847,
    draws: [
      {
        n: 0,
        w0: 0x976699ec,
        w1: 0x993bb275,
        f64: 0.5914093210824223,
        f32: 0.5914092659950256,
      },
      {
        n: 1,
        w0: 0x543e372c,
        w1: 0x68901c8f,
        f64: 0.32907433351698534,
        f32: 0.32907432317733765,
      },
      {
        n: 2,
        w0: 0xb0187238,
        w1: 0x140ca216,
        f64: 0.6878730189237552,
        f32: 0.6878730058670044,
      },
    ],
  },
  {
    // Non-ASCII: 'é' is U+00E9, a single UTF-16 code unit, and the FNV-1a runs
    // fold whole code units (not UTF-8 bytes).
    seed: 'café',
    seedLo: 0x3308be7c,
    seedHi: 0xba803b75,
    draws: [
      {
        n: 0,
        w0: 0xd821d533,
        w1: 0x3076fd16,
        f64: 0.8442662477468409,
        f32: 0.8442662358283997,
      },
      {
        n: 1,
        w0: 0x9aa872c7,
        w1: 0x0d13fc2e,
        f64: 0.6041328178371969,
        f32: 0.6041327714920044,
      },
      {
        n: 2,
        w0: 0xb10dcddc,
        w1: 0x44518657,
        f64: 0.6916168844948682,
        f32: 0.6916168332099915,
      },
    ],
  },
];

const label = (seed: number | string) =>
  typeof seed === 'string' ? `"${seed}"` : String(seed);

describe('foldSeed — pinned words', () => {
  for (const v of VECTORS) {
    it(`foldSeed(${label(v.seed)})`, () => {
      expect(foldSeed(v.seed)).toEqual([v.seedLo, v.seedHi]);
    });
  }

  it('a numeric seed keeps BOTH f64 words (no XOR fold)', () => {
    // 0.5 → 0x3FE0000000000000: the high word carries everything, the low word
    // is zero. XORing them together (what the retired `hashSeed` did) would
    // discard half the information and collide seeds differing only in low
    // mantissa bits.
    expect(foldSeed(0.5)).toEqual([0x3fe00000, 0x00000000]);
    const a = foldSeed(1 + Number.EPSILON);
    const b = foldSeed(1 + 2 * Number.EPSILON);
    expect(a).not.toEqual(b);
    expect(a[0]).toEqual(b[0]); // they differ only in the LOW word
  });

  it('-0 folds identically to 0', () => {
    expect(foldSeed(-0)).toEqual(foldSeed(0));
    expect(foldSeed(-0)).toEqual([0, 0]);
  });

  it('a non-finite seed throws', () => {
    expect(() => foldSeed(NaN)).toThrow();
    expect(() => foldSeed(Infinity)).toThrow();
    expect(() => foldSeed(-Infinity)).toThrow();
  });

  it('a string seed uses two FNV-1a runs with different offset bases', () => {
    // The empty string is exactly the two offset bases.
    expect(foldSeed('')).toEqual([0x811c9dc5, 0xcbf29ce4]);
  });
});

describe('PCG3D — pinned raw words', () => {
  for (const v of VECTORS) {
    for (const d of v.draws) {
      it(`pcg3d(${label(v.seed)}, n=${d.n}) → (w0, w1)`, () => {
        const [w0, w1] = pcg3dWords(v.seedLo, v.seedHi, d.n);
        expect(w0).toBe(d.w0);
        expect(w1).toBe(d.w1);
      });
    }
  }

  it('pcg3dWords is pcg3d over the (seedLo, seedHi, n) triple', () => {
    expect(pcg3dWords(0x1163a2f4, 0x96eac847, 3)).toEqual(
      pcg3d(0x1163a2f4, 0x96eac847, 3)
    );
  });
});

describe('frameDraw — pinned f64 presentation', () => {
  for (const v of VECTORS) {
    for (const d of v.draws) {
      it(`frameDraw(${label(v.seed)}, n=${d.n})`, () => {
        expect(frameDraw(v.seedLo, v.seedHi, d.n)).toBe(d.f64);
      });
    }
  }

  it('all draws lie in [0, 1)', () => {
    for (let n = 0; n < 500; n++) {
      const u = frameDraw(0x40450000, 0, n);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe('GPU tier — f32 presentation', () => {
  for (const v of VECTORS) {
    for (const d of v.draws) {
      it(`(w0 >>> 8) * 2^-24 for ${label(v.seed)}, n=${d.n}`, () => {
        const [w0] = pcg3dWords(v.seedLo, v.seedHi, d.n);
        const f32 = (w0 >>> 8) * 2 ** -24;
        expect(f32).toBe(d.f32);
        // The two tiers are built from the SAME w0, so they agree to within
        // 2^-24 by construction (strictly less, not "approximately").
        expect(Math.abs(f32 - d.f64)).toBeLessThan(2 ** -24);
      });
    }
  }
});

describe('draws are IEEE float64 regardless of precision mode', () => {
  // `BigDecimal.precision` is process-global: an engine created with a
  // non-default precision mutates it for the whole process, so it is restored
  // afterwards (CLAUDE.md, "Common API Traps").
  const engines: ComputeEngine[] = [];
  afterAll(() => {
    for (const ce of engines) ce.precision = 'auto';
  });

  for (const precision of ['machine', 100] as const) {
    it(`the same vectors hold at precision = ${precision}`, () => {
      const ce = new ComputeEngine();
      engines.push(ce);
      ce.precision = precision as never;
      for (const v of VECTORS) {
        const seed = typeof v.seed === 'string' ? { str: v.seed } : v.seed;
        const result = ce
          .box(['WithRandomSeed', seed, ['List', ['Random'], ['Random']]])
          .evaluate();
        expect(result.ops!.map((x) => x.re)).toEqual([
          v.draws[0].f64,
          v.draws[1].f64,
        ]);
      }
    });
  }
});
