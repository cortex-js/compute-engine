/**
 * The GPU (GLSL and WGSL) lowerings of `Digamma`, `Trigamma` and
 * `PolyGamma` (`GPU_POLYGAMMA_PREAMBLE_GLSL`, `compilation/gpu-target.ts`,
 * cortex-js/compute-engine#340, ROADMAP CE-239).
 *
 * Shader text cannot run under jest. This file pins what the emitted text
 * must contain, and pins the algorithm's values through a statement-by-
 * statement f32 model of the GLSL helpers below: every arithmetic result is
 * rounded with `Math.fround`, and every built-in (exp, log, sin, tan) is the
 * double result rounded once to f32. When the shader text changes, the
 * model must change with it. The references are mpmath's `psi` at 40
 * digits, at the f32-rounded operands, and the double kernels of
 * `numerics/special-functions.ts` for the grid.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import {
  digamma,
  polygamma,
  trigamma,
} from '../../src/compute-engine/numerics/special-functions';

const ce = new ComputeEngine();
ce.declare('pg_n', 'integer');
ce.declare('pg_x', 'real');
ce.declare('pg_z', 'complex');

const targets = [
  ['GLSL', new GLSLTarget(), (name: string) => `float ${name}(`],
  ['WGSL', new WGSLTarget(), (name: string) => `fn ${name}(`],
] as const;

/** The source of the top-level function `name` in `preamble`. */
function definition(preamble: string, name: string): string {
  const start = preamble.search(
    new RegExp(`^(?:fn |[A-Za-z_]\\w* )${name}\\(`, 'm')
  );
  if (start < 0) return '';
  const end = preamble.indexOf('\n}\n', start);
  return preamble.slice(start, end + 2);
}

describe('GPU Digamma / Trigamma / PolyGamma: emitted text', () => {
  test.each(targets)('%s: the three heads lower to the helpers', (_n, target) => {
    expect(target.compile(ce.box(['Digamma', 'pg_x'])).code).toBe(
      '_gpu_digamma(pg_x)'
    );
    expect(target.compile(ce.box(['Trigamma', 'pg_x'])).code).toBe(
      '_gpu_trigamma(pg_x)'
    );
    expect(target.compile(ce.box(['PolyGamma', 'pg_n', 'pg_x'])).code).toBe(
      '_gpu_polygamma(pg_n, pg_x)'
    );
  });

  test.each(targets)(
    '%s: the NaN and Infinity helpers are declared before the three helpers',
    (_n, target, head) => {
      const preamble =
        target.compile(ce.box(['PolyGamma', 'pg_n', 'pg_x'])).preamble ?? '';
      const at = (name: string) => preamble.indexOf(head(name));
      for (const name of [
        '_gpu_nan',
        '_gpu_inf',
        '_gpu_digamma',
        '_gpu_trigamma',
        '_gpu_polygamma',
      ])
        expect(at(name)).toBeGreaterThanOrEqual(0);
      expect(at('_gpu_nan')).toBeLessThan(at('_gpu_digamma'));
      expect(at('_gpu_inf')).toBeLessThan(at('_gpu_digamma'));
      expect(at('_gpu_digamma')).toBeLessThan(at('_gpu_trigamma'));
      expect(at('_gpu_trigamma')).toBeLessThan(at('_gpu_polygamma'));
      // `Digamma` alone does not carry the other two.
      const digammaOnly =
        target.compile(ce.box(['Digamma', 'pg_x'])).preamble ?? '';
      expect(digammaOnly).toContain(head('_gpu_digamma'));
      expect(digammaOnly).not.toContain(head('_gpu_trigamma'));
      expect(digammaOnly).not.toContain(head('_gpu_polygamma'));
    }
  );

  test.each(targets)(
    '%s: the limits the f32 model mirrors',
    (_n, target) => {
      const preamble =
        target.compile(ce.box(['PolyGamma', 'pg_n', 'pg_x'])).preamble ?? '';
      for (const name of ['_gpu_digamma', '_gpu_trigamma']) {
        const d = definition(preamble, name);
        expect(d).toMatch(/k < 6;/);
        expect(d).toContain('z >= 6.0');
        expect(d).toContain('x - floor(x + 0.5)');
      }
      const p = definition(preamble, '_gpu_polygamma');
      expect(p).toContain('n > 24.0');
      expect(p).toContain('x < -4096.0');
      expect(p).toContain('z >= n + 10.0');
      expect(p).toMatch(/k < 4132;/);
      expect(p).toContain('500.0 / (6.0 + xmax)');
      for (const name of ['_gpu_digamma', '_gpu_trigamma', '_gpu_polygamma'])
        expect(definition(preamble, name)).toContain('-3.4028234663852886e38');
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s: a complex argument fails closed',
    (to) => {
      for (const expr of [
        ['Digamma', 'pg_z'],
        ['Trigamma', 'pg_z'],
        ['PolyGamma', 2, 'pg_z'],
      ]) {
        const r = compile(ce.box(expr), { to });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/real-only/);
      }
    }
  );

  test('a pole folded at compile time is +Infinity, as the helpers answer at run time', () => {
    // The interpreter answers the undirected infinity at a pole; its float
    // projection is +Infinity (`docs/COMPILATION-MODEL.md`).
    for (const to of ['glsl', 'wgsl'] as const)
      expect(compile(ce.box(['Digamma', -2]), { to }).code).toBe('_gpu_inf()');
    expect(polygammaModel(0, -2)).toBe(Infinity);
  });
});

// ---- The f32 model of GPU_POLYGAMMA_PREAMBLE_GLSL, statement by statement ----

const fr = Math.fround;
const add = (x: number, y: number) => fr(x + y);
const sub = (x: number, y: number) => fr(x - y);
const mul = (x: number, y: number) => fr(x * y);
const div = (x: number, y: number) => fr(x / y);
const exp = (x: number) => fr(Math.exp(fr(x)));
const log = (x: number) => fr(Math.log(fr(x)));
const sin = (x: number) => fr(Math.sin(fr(x)));
const tan = (x: number) => fr(Math.tan(fr(x)));
const { abs, floor, max } = Math;
const PI = fr(3.14159265358979);
const F32_MIN = -3.4028234663852886e38;

function _gpu_digamma(x: number): number {
  if (x <= 0 && x === floor(x)) return x >= F32_MIN ? Infinity : NaN;
  let result = 0;
  let z = x;
  if (x < 0) {
    const r = sub(x, floor(add(x, 0.5)));
    result = div(-PI, tan(mul(PI, r)));
    z = sub(1, x);
  }
  for (let k = 0; k < 6; k++) {
    if (z >= 6) break;
    result = sub(result, div(1, z));
    z = add(z, 1);
  }
  const z2 = div(1, mul(z, z));
  const series = mul(
    z2,
    sub(
      fr(1 / 12),
      mul(z2, sub(fr(1 / 120), mul(z2, sub(fr(1 / 252), div(z2, 240)))))
    )
  );
  return add(result, sub(sub(log(z), div(0.5, z)), series));
}

function _gpu_trigamma(x: number): number {
  if (x <= 0 && x === floor(x)) return x >= F32_MIN ? Infinity : NaN;
  let result = 0;
  let sgn = 1;
  let z = x;
  if (x < 0) {
    const sr = sin(mul(PI, sub(x, floor(add(x, 0.5)))));
    result = div(mul(PI, PI), mul(sr, sr));
    sgn = -1;
    z = sub(1, x);
  }
  let t = 0;
  for (let k = 0; k < 6; k++) {
    if (z >= 6) break;
    t = add(t, div(1, mul(z, z)));
    z = add(z, 1);
  }
  const z2 = div(1, mul(z, z));
  t = add(
    t,
    add(
      add(div(1, z), mul(0.5, z2)),
      mul(
        div(z2, z),
        sub(fr(1 / 6), mul(z2, sub(fr(1 / 30), mul(z2, sub(fr(1 / 42), div(z2, 30))))))
      )
    )
  );
  return add(result, mul(sgn, t));
}

const B = [
  1 / 6,
  -1 / 30,
  1 / 42,
  -1 / 30,
  5 / 66,
  -691 / 2730,
  7 / 6,
  -3617 / 510,
  43867 / 798,
  -174611 / 330,
].map(fr);

function _gpu_polygamma(n: number, x: number): number {
  if (n === 0) return _gpu_digamma(x);
  if (n === 1) return _gpu_trigamma(x);
  if (n !== floor(n) || n < 0 || n > 24) return NaN;
  if (x <= 0 && x === floor(x)) return x >= F32_MIN ? Infinity : NaN;
  if (x < -4096) return NaN;
  if (x > 3.4e38) return 0;
  let fact = 1;
  for (let j = 2; j <= 24; j++) {
    if (j > n) break;
    fact = mul(fact, j);
  }
  const lf = log(fact);
  const n1 = add(n, 1);
  const oddPower = n1 % 2 === 1;
  let sum = 0;
  let mag = 0;
  let xmax = 0;
  let z = x;
  for (let k = 0; k < 4132; k++) {
    if (z >= add(n, 10)) break;
    const e = sub(lf, mul(n1, log(abs(z))));
    const t = exp(e);
    sum = add(sum, z < 0 && oddPower ? -t : t);
    mag = add(mag, t);
    xmax = max(xmax, abs(e));
    z = add(z, 1);
  }
  const a = exp(sub(lf, mul(n1, log(z))));
  let tail = add(div(mul(a, z), n), mul(0.5, a));
  let f = div(mul(a, n1), mul(2, z));
  let prev = fr(3e38);
  for (let k = 1; k <= 10; k++) {
    const term = mul(B[k - 1], f);
    if (abs(term) >= prev) break;
    tail = add(tail, term);
    prev = abs(term);
    const m = 2 * k;
    f = div(
      mul(mul(f, add(m, n)), add(add(m, n), 1)),
      mul(mul(mul(m + 1, m + 2), z), z)
    );
  }
  const res = add(sum, tail);
  if (
    x < 0 &&
    oddPower &&
    !(div(add(mag, abs(tail)), abs(res)) <= div(500, add(6, xmax)))
  )
    return NaN;
  return n % 2 === 0 ? -res : res;
}

/** The model of `_gpu_polygamma(n, x)` at the f32-rounded operands. */
function polygammaModel(n: number, x: number): number {
  return _gpu_polygamma(fr(n), fr(x));
}

describe('GPU Digamma / Trigamma / PolyGamma: f32 model of the GLSL helpers', () => {
  const close = (v: number, ref: number, tol: number) =>
    expect(Math.abs(v - ref) / Math.abs(ref)).toBeLessThan(tol);

  test('values against mpmath at the f32 operands', () => {
    // psi(0.37) = -2.7953013710247186, psi(-2.5) = 1.1031566406452432
    close(polygammaModel(0, 0.37), -2.7953013710247186, 1e-6);
    close(polygammaModel(0, -2.5), 1.1031566406452432, 1e-6);
    close(polygammaModel(0, 1e6), 13.815510057964191, 1e-6);
    // psi_1(-0.43) = 9.3662494806592959
    close(polygammaModel(1, -0.43), 9.3662494806592959, 1e-6);
    // psi_3(1.5) = 1.4090910340024372, psi_2(-2.3) = 68.713829194962345
    close(polygammaModel(3, 1.5), 1.4090910340024372, 1e-5);
    close(polygammaModel(2, -2.3), 68.713829194962345, 1e-5);
    // psi_5(0.01) = 1.2000001609337042e14, psi_24(56.22) = -3.1969768860413931e-20
    close(polygammaModel(5, 0.01), 120000016093370.42, 1e-5);
    close(polygammaModel(24, 56.22), -3.1969768860413931e-20, 1e-5);
    // psi_4(-29.06) = 30865556.153807148: terms of both signs, not cancelling
    close(polygammaModel(4, -29.06), 30865556.153807148, 1e-5);
  });

  test('the poles, the infinities and the orders outside 0..24', () => {
    for (const [n, x] of [
      [0, -2],
      [0, 0],
      [1, -7],
      [2, -3],
      [24, 0],
    ])
      expect(polygammaModel(n, x)).toBe(Infinity);
    for (const n of [0, 1, 2]) expect(polygammaModel(n, -Infinity)).toBeNaN();
    expect(polygammaModel(0, Infinity)).toBe(Infinity);
    expect(polygammaModel(1, Infinity)).toBe(0);
    expect(polygammaModel(3, Infinity)).toBe(0);
    expect(polygammaModel(25, 1)).toBeNaN();
    expect(polygammaModel(2.5, 1)).toBeNaN();
    expect(polygammaModel(-1, 1)).toBeNaN();
    // The recurrence costs one term per unit of |x|.
    expect(polygammaModel(3, -5000.5)).toBeNaN();
    // The reflections of psi and psi_1 have no such limit.
    close(polygammaModel(0, -5000.5), digamma(-5000.5), 1e-6);
    close(polygammaModel(1, -5000.5), trigamma(-5000.5), 1e-6);
  });

  test('next to a half-integer, an even order declines where its terms cancel', () => {
    // psi_6(-29.5) = psi_6(30.5): the terms at z = -0.5 and 0.5 cancel, and
    // what is left is about 1e-6 of them. The double kernel answers it.
    expect(polygammaModel(6, -29.5)).toBeNaN();
    expect(polygammaModel(2, -29.5)).toBeNaN();
    expect(Number.isFinite(polygamma(6, -29.5))).toBe(true);
    // An odd order has terms of one sign at a negative x.
    close(polygammaModel(5, -29.5), polygamma(5, fr(-29.5)), 1e-5);
  });

  test('a grid against the double kernels', () => {
    const xs: number[] = [];
    for (let i = -600; i <= 1200; i++) xs.push(fr(i * 0.05 + 0.013));
    for (let e = -8; e <= 8; e += 0.25) xs.push(fr(10 ** e));
    // psi: relative where |psi(x)| is 1/10 of the size of its parts or more,
    // absolute against that size next to a zero.
    let psiWorst = 0;
    for (const x of xs) {
      const ref = digamma(x);
      let parts = 0;
      let z = x;
      if (x < 0) {
        parts += Math.abs(Math.PI / Math.tan(Math.PI * (x - Math.round(x))));
        z = 1 - x;
      }
      for (; z < 6; z += 1) parts += 1 / z;
      parts += Math.abs(Math.log(z));
      const v = polygammaModel(0, x);
      psiWorst = max(
        psiWorst,
        Math.abs(v - ref) / max(Math.abs(ref), 0.1 * parts)
      );
    }
    expect(psiWorst).toBeLessThan(3e-6);
    for (const n of [1, 2, 3, 4, 7, 12, 24]) {
      let worst = 0;
      let answered = 0;
      let count = 0;
      for (const x of xs) {
        const ref = n === 1 ? trigamma(x) : polygamma(n, x);
        if (!Number.isFinite(ref) || Math.abs(ref) > 3.4e38) continue;
        if (Math.abs(ref) < 1e-30) continue;
        count += 1;
        const v = polygammaModel(n, x);
        if (Number.isNaN(v)) continue;
        answered += 1;
        worst = max(worst, Math.abs(v - ref) / Math.abs(ref));
      }
      expect(worst).toBeLessThan(n === 1 ? 5e-7 : 1.2e-5);
      // NaN only where the terms of an even order cancel.
      expect(answered).toBeGreaterThan(0.97 * count);
    }
  });
});
