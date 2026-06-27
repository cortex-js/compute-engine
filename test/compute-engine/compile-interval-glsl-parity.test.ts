/**
 * interval-glsl ↔ interval-js parity harness, driven by the Tycho corpus
 * (`interval-glsl-parity-corpus.json`, INTERVAL_GLSL_PLAN.md §6/§9/§10).
 *
 * For each corpus curve `f(x,y)`, compile to both `interval-glsl` (executed via
 * the faithful JS port of the preamble) and `interval-js`, and over a grid of
 * boxes assert the soundness contract:
 *
 *   - **containment**: when interval-js returns a finite interval, the GLSL
 *     interval must enclose it (over-approximation OK; under-approximation is a
 *     missed crossing).
 *   - **GPU-empty ⟹ CPU-empty** (§10, load-bearing): because `lo > hi` encodes
 *     `empty` → exclude, a GPU `empty` where interval-js is non-empty is a false
 *     exclude. The one unsound direction.
 *   - **singular → not-excludable**: interval-js returns `singular` at a pole;
 *     the GPU contract returns `entire`, so the cell must not be excluded.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { runIntervalGLSL, isEmptyIV, IV_INF, type IV } from './interval-glsl-eval';

type Entry = {
  id: string;
  title: string;
  latex: string;
  phase: number;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  kindsObserved: string[];
};

const corpus = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/interval-glsl-parity-corpus.json'), 'utf-8')
) as { entries: Entry[] };

const ce = new ComputeEngine();
ce.strict = false;

type Cpu =
  | { kind: 'interval'; lo: number; hi: number }
  | { kind: 'empty' }
  | { kind: 'singular' }
  | { kind: 'entire' }
  | { kind: 'other'; raw: unknown };

function cpuEval(
  run: (v: Record<string, { lo: number; hi: number }>) => unknown,
  xb: IV,
  yb: IV
): Cpu {
  const r = run({
    x: { lo: xb[0], hi: xb[1] },
    y: { lo: yb[0], hi: yb[1] },
  }) as Record<string, unknown>;
  if (r && typeof r === 'object') {
    if ('kind' in r) {
      const k = r.kind;
      if (k === 'empty') return { kind: 'empty' };
      if (k === 'entire') return { kind: 'entire' };
      if (k === 'singular') return { kind: 'singular' };
      if (k === 'interval' || k === 'partial') {
        const v = r.value as { lo: number; hi: number };
        return { kind: 'interval', lo: v.lo, hi: v.hi };
      }
    }
    if ('lo' in r && 'hi' in r)
      return { kind: 'interval', lo: r.lo as number, hi: r.hi as number };
  }
  return { kind: 'other', raw: r };
}

const clampB = (v: number) => Math.max(-IV_INF, Math.min(IV_INF, v));
const TOL = 1e-6;
// Odd grid: for a viewport symmetric about 0, the middle cell's *interior*
// straddles the origin, so a pole at 0 yields a strictly-zero-spanning
// denominator (interval-js `singular`) rather than one merely touching zero at a
// cell boundary (`partial`). Needed to exercise the pole path.
const GRID = 7;

describe('interval-glsl ↔ interval-js parity (full corpus, phases 1–3)', () => {
  for (const entry of corpus.entries) {
    it(`${entry.id}: GLSL ⊇ interval-js over the viewport grid`, () => {
      const expr = ce.parse(entry.latex);
      const code = ce.getCompilationTarget('interval-glsl')!.compile(expr).code;
      const ijs = compile(expr, { to: 'interval-js' });
      expect(ijs.success).toBe(true);
      const run = ijs.run! as unknown as (
        v: Record<string, { lo: number; hi: number }>
      ) => unknown;

      const { xMin, xMax, yMin, yMax } = entry.viewport;
      const dx = (xMax - xMin) / GRID;
      const dy = (yMax - yMin) / GRID;
      let emptyMatches = 0;
      let notExcludable = 0;

      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          const xb: IV = [xMin + i * dx, xMin + (i + 1) * dx];
          const yb: IV = [yMin + j * dy, yMin + (j + 1) * dy];
          const glsl = runIntervalGLSL(code, { x: xb, y: yb });
          const cpu = cpuEval(run, xb, yb);

          // (1) GPU-empty ⟹ CPU-empty — the only unsound direction.
          if (isEmptyIV(glsl)) {
            expect(cpu.kind).toBe('empty');
            emptyMatches++;
          }

          // (2) finite interval-js result ⟹ GLSL encloses it (and is non-empty).
          if (cpu.kind === 'interval') {
            expect(isEmptyIV(glsl)).toBe(false);
            expect(glsl[0]).toBeLessThanOrEqual(clampB(cpu.lo) + TOL);
            expect(glsl[1]).toBeGreaterThanOrEqual(clampB(cpu.hi) - TOL);
          }

          // (3) pole (interval-js singular / entire) ⟹ GLSL cannot exclude.
          if (cpu.kind === 'singular' || cpu.kind === 'entire') {
            expect(isEmptyIV(glsl)).toBe(false);
            expect(glsl[0]).toBeLessThanOrEqual(TOL); // lo ≤ 0
            expect(glsl[1]).toBeGreaterThanOrEqual(-TOL); // hi ≥ 0
            notExcludable++;
          }
        }
      }

      // The machinery is actually exercised: domain fixtures must hit `empty`,
      // pole fixtures must hit the not-excludable (entire) path.
      if (entry.kindsObserved.includes('empty'))
        expect(emptyMatches).toBeGreaterThan(0);
      if (entry.kindsObserved.includes('singular'))
        expect(notExcludable).toBeGreaterThan(0);
    });
  }
});

describe('interval-glsl — entire corpus compiles (no head left unsupported)', () => {
  it('every corpus entry lowers to interval-glsl with no fallback', () => {
    for (const entry of corpus.entries) {
      const r = compile(ce.parse(entry.latex), { to: 'interval-glsl' });
      expect(r.success).toBe(true);
      expect(r.unsupported).toEqual([]);
    }
  });
});
