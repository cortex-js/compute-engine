import { ComputeEngine } from '../../src/compute-engine';

describe('A4.1 — Block is sequential (regression)', () => {
  test('Assign sees prior Assign\'s value within the same Block', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Block', ['Assign', 'a', 1], ['Assign', 'b', ['Add', 'a', 1]], 'b'])
      .evaluate();
    expect(r.re).toEqual(2);
  });

  test('Reassignment cascades sequentially (a=1; a=a+1; a=a+1 → 3)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['Assign', 'a', 1],
        ['Assign', 'a', ['Add', 'a', 1]],
        ['Assign', 'a', ['Add', 'a', 1]],
        'a',
      ])
      .evaluate();
    expect(r.re).toEqual(3);
  });

  test('Snapshot-then-commit rewrite preserves simultaneous semantics', () => {
    // Outer state: a=10, b=20. Want a swap (a, b) → (20, 10) with parallel
    // semantics, expressed via the snapshot-then-commit rewrite.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', '_t_a', 'b'],
      ['Assign', '_t_b', 'a'],
      ['Assign', 'a', '_t_a'],
      ['Assign', 'b', '_t_b'],
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(10);
  });

  test('Naive sequential rewrite of a swap does NOT preserve simultaneous semantics', () => {
    // Documents the trap: pasting a Desmos action tuple as Block directly
    // is wrong. With sequential semantics, both end up equal to b.
    const ce = new ComputeEngine();
    ce.assign('a', 10);
    ce.assign('b', 20);
    ce.box([
      'Block',
      ['Assign', 'a', 'b'], // a := b → a=20
      ['Assign', 'b', 'a'], // b := a → b=20 (NOT 10)
    ]).evaluate();
    expect(ce.box('a').evaluate().re).toEqual(20);
    expect(ce.box('b').evaluate().re).toEqual(20);
  });
});
