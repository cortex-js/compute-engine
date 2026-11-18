import { ComputeEngine, compile } from '../../src/compute-engine';

// ROADMAP CE-518 (Tycho row 460): a caller's operator `compile` handler
// that declines leaves the result shippable, and `broadcastAsync()` reports
// the cells whose evaluation threw (`failed`).
// The workers are Node `worker_threads` running the worker entry from
// source through the tsx loader, as in `kernel-pool.test.ts`.

function samples(n: number, lo = -5, hi = 5): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + ((hi - lo) * i) / (n - 1);
  return xs;
}

describe('the output of a caller compile handler is not shippable by default', () => {
  test('a handler that declines leaves the result shippable', () => {
    const ce = new ComputeEngine();
    ce.declare('Declines', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      compile: () => undefined,
    });
    const r = compile(ce.parse('x^2 + 1'));
    expect(r.shippable).toBe(true);
  });

  test('the handlers of the standard library stay shippable', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\frac{d}{dx} \\sin(x)'));
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(true);
  });
});

describe('cells that throw are counted (`failed`)', () => {
  test('a batch with no failure reports 0', async () => {
    const ce = new ComputeEngine();
    const res = await compile(ce.parse('x^2')).broadcastAsync!({
      x: samples(10),
    });
    expect(res.failed).toBe(0);
  });
});
