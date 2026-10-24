import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/**
 * The structural hash of a function expression must keep telling nested
 * shapes apart at any depth (CE-318). It used to shift the running hash left
 * by one bit per operand, so the contribution of the innermost operand left
 * the 32-bit word after 32 levels and the shapes repeated their hashes.
 */
describe('function expression hash at deep nesting', () => {
  const ce = new ComputeEngine();

  test('a Sin/Cos chain has a different hash at each of 300 levels', () => {
    let e: Expression = ce.symbol('x');
    const hashes = new Set<number>();
    for (let i = 0; i < 300; i++) {
      e = ce.function(i % 2 ? 'Sin' : 'Cos', [e], { form: 'structural' });
      hashes.add(e.hash);
    }
    expect(hashes.size).toBe(300);
  });

  test('a doubling Add(e, e) has a different hash at each of 300 levels', () => {
    let e: Expression = ce.symbol('x');
    const hashes = new Set<number>();
    for (let i = 0; i < 300; i++) {
      e = ce.function('Add', [e, e], { form: 'structural' });
      hashes.add(e.hash);
    }
    expect(hashes.size).toBe(300);
  });

  test('nested dictionaries have a different hash at each of 100 levels', () => {
    let e: Expression = ce.box({ dict: { a: 1 } } as any);
    const hashes = new Set<number>();
    for (let i = 0; i < 100; i++) {
      e = ce.box({ dict: { a: e.json } } as any);
      hashes.add(e.hash);
    }
    expect(hashes.size).toBe(100);
  });

  test('equal expressions still have equal hashes', () => {
    const a = ce.parse('\\sin(\\cos(x+1))+y');
    const b = ce.parse('\\sin(\\cos(x+1))+y');
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    expect(ce.parse('[1,2,3]').hash).toBe(ce.parse('[1,2,3]').hash);
  });
});
