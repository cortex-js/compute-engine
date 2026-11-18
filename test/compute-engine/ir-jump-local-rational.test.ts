/**
 * CE-1191: a jump function (`Floor`, `Ceil`, `Round`, `Fract`, `Mod`,
 * `Sign`, a comparison) of a product by a local that holds an exact
 * rational which no double holds. A local that no `Assign` of its block
 * writes is read as its literal, so the product is written as a division by
 * the denominator, as `Floor(k/49)` is: `Floor(q·k)` at `k = 49` is 1, where
 * the product by the double of `1/49` is `0.9999999999999999`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('k', 'integer');

const IR = { profile: 'ir', fallback: false } as const;

const qk = ['Multiply', 'q', 'k'];
const JUMPS: [string, unknown][] = [
  ['Floor', ['Floor', qk]],
  ['Ceil', ['Ceil', qk]],
  ['Round', ['Round', qk]],
  ['Fract', ['Fract', qk]],
  ['Mod', ['Mod', qk, 1]],
  ['GreaterEqual', ['If', ['GreaterEqual', qk, 1], 1, 0]],
  ['Sign', ['Sign', ['Subtract', qk, 1]]],
];

/** `k ↦ Block(Declare(q, real, value), …statements)`. */
function fn(value: unknown, ...statements: unknown[]) {
  return ce.box([
    'Function',
    ['Block', ['Declare', 'q', "'real'", value], ...statements],
    'k',
  ] as never);
}

const interpret = (f: ReturnType<typeof fn>, k: number): number =>
  ce
    .box(['Apply', f, k] as never)
    .evaluate()
    .N().re;

const KS = [-98, -49, -1, 0, 1, 48, 49, 98, 147, 245, 490, 4900];

describe('JavaScript', () => {
  test.each(JUMPS)('%s(q·k) gives the interpreter value', (_, jump) => {
    const f = fn(['Rational', 1, 49], jump);
    const r = compile(f, IR);
    expect(r.success).toBe(true);
    expect(r.code).toContain('/ 49');
    const run = r.run as unknown as (k: number) => number;
    for (const k of KS) expect(run(k) + 0).toBe(interpret(f, k) + 0);
  });

  test('the witness: Floor(q·k) at 49 is 1', () => {
    const r = compile(fn(['Rational', 1, 49], ['Floor', qk]), IR);
    expect((r.run as unknown as (k: number) => number)(49)).toBe(1);
  });

  test('two locals that hold rationals are one constant', () => {
    const f = fn(
      ['Rational', 1, 49],
      ['Declare', 'p', "'real'", ['Rational', 1, 3]],
      ['Floor', ['Multiply', 'p', 'q', 'k']]
    );
    const r = compile(f, IR);
    expect(r.code).toContain('/ 147');
    const run = r.run as unknown as (k: number) => number;
    for (const k of [...KS, 147, 294]) expect(run(k)).toBe(interpret(f, k));
  });

  test('a local that an Assign writes is read as its value', () => {
    // The literal of the declaration is not the value at the product.
    const f = fn(
      ['Rational', 1, 49],
      ['Assign', 'q', ['Rational', 1, 7]],
      ['Floor', qk]
    );
    const r = compile(f, IR);
    expect(r.success).toBe(true);
    const run = r.run as unknown as (k: number) => number;
    for (const k of KS) expect(run(k)).toBe(interpret(f, k));
  });

  test('a jump of an exact double keeps its product', () => {
    const r = compile(fn(['Rational', 1, 2], ['Floor', qk]), IR);
    expect(r.code).toContain('* 0.5');
    expect((r.run as unknown as (k: number) => number)(49)).toBe(24);
    const h = compile(
      ce.box(['Function', ['Floor', ['Divide', 'x', 2]], 'x'] as never),
      IR
    );
    expect(h.success).toBe(true);
    expect((h.run as unknown as (x: number) => number)(5)).toBe(2);
  });
});

describe('GLSL', () => {
  test.each(JUMPS)('%s(q·k) is written as the quotient', (_, jump) => {
    // GLSL compiles no Function literal: the body, `k` an integer input.
    const body = fn(['Rational', 1, 49], jump).ops![0];
    const r = compile(body, { ...IR, to: 'glsl' });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_gpu_ir_quot(k, 49.0)');
    expect(r.code).not.toContain('0.0204');
  });
});

describe('interval-js', () => {
  test.each(JUMPS)(
    '%s(q·k) at 49 encloses the interpreter value',
    (_, jump) => {
      const f = fn(['Rational', 1, 49], jump);
      const r = compile(f, { ...IR, to: 'interval-js' } as never);
      expect(r.success).toBe(true);
      const v = (r.run as unknown as (k: number) => unknown)(49) as {
        value: { lo: number; hi: number };
      };
      const x = interpret(f, 49);
      expect(v.value.lo).toBeLessThanOrEqual(x);
      expect(v.value.hi).toBeGreaterThanOrEqual(x);
    }
  );
});
