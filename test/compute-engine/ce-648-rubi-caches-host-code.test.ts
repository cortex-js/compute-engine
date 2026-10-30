import { ComputeEngine } from '../../src/compute-engine';
import { installCaches, zeroQ } from '../../src/compute-engine/rubi/rubi-utils';

// The zero-test and simplification caches of the Rubi integrator
// (`zeroQ()`, `safeSimplify()`, `rubi/rubi-utils.ts`) live for one
// integration call. They must not keep a value that was computed while host
// code that does not state its purity ran: that code reads state that the
// key (the text of the expression) does not record.

describe('CE-648: RUBI CACHES AND HOST CODE', () => {
  afterEach(() => installCaches(undefined as any));

  test('zeroQ sees the new value of a host operator', () => {
    const ce = new ComputeEngine();
    const state = { k: 1, calls: 0 };
    ce.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => {
        state.calls += 1;
        return engine.number(x.re + state.k);
      },
    });
    installCaches({ zeroQ: new Map(), simplify: new Map() });
    const d = ce.box(['Subtract', ['h', 1], 2]);
    expect(zeroQ(d)).toBe(true);
    const callsAfterFirst = state.calls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    state.k = 5;
    expect(zeroQ(ce.box(['Subtract', ['h', 1], 2]))).toBe(false);
    expect(state.calls).toBeGreaterThan(callsAfterFirst);
  });

  test('a value with no host code is still cached', () => {
    const ce = new ComputeEngine();
    const caches = { zeroQ: new Map(), simplify: new Map() };
    installCaches(caches);
    const d = ce.parse('\\sin^2 x + \\cos^2 x - 1');
    expect(d.isSame(0)).toBe(false);
    expect(zeroQ(d)).toBe(true);
    expect(caches.zeroQ.size).toBe(1);
  });
});
