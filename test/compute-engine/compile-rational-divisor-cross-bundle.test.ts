/**
 * The rational-divisor lowering (`x / 6`, not `x * 0.1666…`) must also apply
 * when the expression was boxed by a DIFFERENT copy of the engine than the
 * one the compile target runs in.
 *
 * The published `compile` entry is a standalone bundle with its own copy of
 * the numeric-value classes, so an `instanceof ExactNumericValue` test on an
 * expression from `compute-engine` failed, `Rational(1, 6)` read as no
 * rational, and `n(n-1)(n-2)/6` compiled to `0.16666666666666666 * …`, which
 * is `559.9999999999999` at `n = 16`. Here the two copies are two module
 * registries.
 */
import { ComputeEngine } from '../../src/compute-engine';

type Target = { compile(e: unknown): { code?: string; run?: Function } };

function otherCopyOfJavaScriptTarget(): Target {
  let target!: Target;
  jest.isolateModules(() => {
    const { JavaScriptTarget } = require('../../src/compute-engine/compilation/javascript-target');
    target = new JavaScriptTarget();
  });
  return target;
}

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('x', 'real');
const target = otherCopyOfJavaScriptTarget();
const compile = (json: unknown) => target.compile(ce.box(json as any));

describe('RATIONAL FACTOR, TARGET FROM ANOTHER ENGINE COPY', () => {
  test('n(n-1)(n-2)/6 is a division, exact for integers', () => {
    const r = compile(['Divide', ['Multiply', 'n', ['Subtract', 'n', 1], ['Subtract', 'n', 2]], 6]);
    expect(r.code).toMatch(/\) \/ 6$/);
    for (const n of [3, 9, 16, 19, 100, 1000])
      expect(r.run!({ n })).toBe(Number((BigInt(n) * BigInt(n - 1) * BigInt(n - 2)) / 6n));
  });

  test('n/49 is exact at every multiple of 49', () => {
    const r = compile(['Divide', 'n', 49]);
    expect(r.code).toBe('_.n / 49');
    for (let n = 0; n < 200000; n += 49) expect(r.run!({ n })).toBe(n / 49);
  });

  test('2x/3 keeps its numerator and agrees with the engine', () => {
    const r = compile(['Divide', ['Multiply', 2, 'x'], 3]);
    expect(r.code).toBe('_.x / 3 * 2');
    for (const x of [0.1, 1, 7.25, -3.5, 1e6]) {
      const exact = ce.box(['Divide', ['Multiply', 2, 'x'], 3]).subs({ x }).N().re;
      expect(Math.abs((r.run!({ x }) as number) - exact)).toBeLessThanOrEqual(Math.abs(exact) * 2.3e-16);
    }
  });

  test('x/3 for floats is within an ulp', () => {
    const r = compile(['Divide', 'x', 3]);
    for (const x of [0.1, 1, 7.25, -3.5, 1e6]) expect(Math.abs((r.run!({ x }) as number) - x / 3)).toBeLessThanOrEqual(Math.abs(x / 3) * 2.3e-16);
  });
});
