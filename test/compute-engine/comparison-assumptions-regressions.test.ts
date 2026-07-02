import { ComputeEngine } from '../../src/compute-engine';
import { order } from '../../src/compute-engine/boxed-expression/order';

/**
 * Regression tests for the comparison / assumptions-plumbing P0 cluster
 * (WP-2.4; findings P0-28, P0-29, P0-30, P0-31, and the isEqual face of
 * SYMBOLIC P0-8).
 */

describe('WP-2.4 P0-28: NaN does not corrupt canonical ordering', () => {
  const ce = new ComputeEngine();

  function permutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permutations(rest)) res.push([arr[i], ...p]);
    }
    return res;
  }

  test('Add with NaN is permutation-invariant', () => {
    const ops = [NaN, 0.5, 'x', 3.7];
    const forms = permutations(ops).map((p) => ce.box(['Add', ...p] as any));
    expect(forms.every((f) => f.isSame(forms[0]))).toBe(true);
  });

  test('Multiply with NaN is permutation-invariant', () => {
    const ops = [NaN, 0.5, 'x', 3.7];
    const forms = permutations(ops).map(
      (p) => ce.box(['Multiply', ...p] as any)
    );
    expect(forms.every((f) => f.isSame(forms[0]))).toBe(true);
  });

  test('order() is a total order (never NaN) over a NaN-containing pool', () => {
    // Normalize to -1/0/1 (avoids the `-0` vs `0` Object.is pitfall)
    const sgn = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
    const pool = [
      ce.box(NaN),
      ce.box(0.5),
      ce.box(3.7),
      ce.box(-2),
      ce.box(0),
      ce.box(Infinity),
      ce.box(-Infinity),
      ce.box(['Complex', 1, 2]),
      ce.box(['Rational', 1, 3]),
      ce.symbol('x'),
      ce.box(['Sqrt', 2]),
    ];
    for (const a of pool) {
      expect(order(a, a)).toBe(0); // reflexive
      for (const b of pool) {
        const ab = order(a, b);
        const ba = order(b, a);
        expect(Number.isNaN(ab)).toBe(false); // total
        expect(sgn(ab)).toBe(sgn(-ba)); // antisymmetric
      }
    }
  });

  test('shuffle+sort of a NaN-containing operand list is deterministic', () => {
    function shuffle<T>(a: T[], seed: number): T[] {
      const arr = [...a];
      let s = seed;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    const baseOps = [NaN, 0.5, 3.7, -2, 0, 1, 'x', 'y'];
    let reference: string | undefined;
    for (let seed = 1; seed <= 200; seed++) {
      const form = ce.box(['Add', ...shuffle(baseOps, seed)] as any);
      const j = JSON.stringify(form.json);
      if (reference === undefined) reference = j;
      else expect(j).toBe(reference);
    }
  });
});

describe('WP-2.4 P0-29: assume(a = b) between two free symbols is recorded', () => {
  test('value binding survives and the fact is discoverable', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('a = b'))).toBe('ok');
    expect(ce.symbol('a').value?.symbol).toBe('b');
    expect(ce.ask(ce.box(['Equal', 'a', 'b'])).length).toBeGreaterThan(0);
    expect(ce.symbol('a').isEqual(ce.symbol('b'))).toBe(true);
  });

  test('parent-scope path (m = n) still works', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('m = n'))).toBe('ok');
    expect(ce.symbol('m').value?.symbol).toBe('n');
    expect(ce.symbol('m').isEqual(ce.symbol('n'))).toBe(true);
  });

  test('concrete assignment (x = 2) still infers the type', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('x = 2'))).toBe('ok');
    expect(ce.symbol('x').value?.re).toBe(2);
    expect(ce.symbol('x').isEqual(2)).toBe(true);
  });
});

describe('WP-2.4 P0-30: eq() consults the assumptions DB for symbol pairs', () => {
  test('two free symbols are indeterminate, not definitively unequal', () => {
    const ce = new ComputeEngine();
    expect(ce.symbol('x').isEqual(ce.symbol('y'))).toBe(undefined);
  });

  test('a symbol equals itself', () => {
    const ce = new ComputeEngine();
    expect(ce.symbol('x').isEqual(ce.symbol('x'))).toBe(true);
  });

  test('a free symbol vs a literal is indeterminate', () => {
    const ce = new ComputeEngine();
    expect(ce.symbol('x').isEqual(2)).toBe(undefined);
  });

  test('an asserted equality is honored', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('a = b'));
    expect(ce.symbol('a').isEqual(ce.symbol('b'))).toBe(true);
  });

  test('an asserted disequality is honored', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['NotEqual', 'p', 'q']));
    expect(ce.symbol('p').isEqual(ce.symbol('q'))).toBe(false);
  });
});

describe('WP-2.4 P0-31: .is() is symmetric for expression-valued bindings', () => {
  test('g := x^2 + 1', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x^2+1'));
    const forward = ce.symbol('g').is(ce.parse('x^2+1'));
    const backward = ce.parse('x^2+1').is(ce.symbol('g'));
    expect(forward).toBe(true);
    expect(backward).toBe(true);
    expect(forward).toBe(backward);
  });

  test('.is() is symmetric across a binding matrix', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x^2+1')); // expression-valued
    ce.assign('n2', ce.number(2)); // number-valued
    const exprs = [
      ce.parse('x^2+1'),
      ce.symbol('g'),
      ce.number(2),
      ce.symbol('n2'),
      ce.symbol('x'), // unbound
      ce.symbol('unbound'), // unbound
      ce.number(3),
    ];
    for (const a of exprs)
      for (const b of exprs) expect(a.is(b)).toBe(b.is(a));
  });
});
