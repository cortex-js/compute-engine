import { ComputeEngine } from '../../src/compute-engine';

// A lazy `Filter` over a list literal with an impure element
// (`[If(c, Random(), Nothing), 2]`): the literal's handlers serve the
// operands as written (an impure literal is not evaluated by a count), so
// the filter emitted the operand `If(…)`, drawn again by every consumer. It
// now walks the literal's value, evaluated once per walk (`Filter` iterator,
// `library/collections.ts`).
describe('a lazy Filter over an impure literal', () => {
  const list = ['List', ['If', 'c', ['Random'], 'Nothing'], 2];
  const keep = ['Function', 'True', 'x'];

  test('a kept element is its value, drawn once per walk', () => {
    const ce = new ComputeEngine();
    ce.assign('c', ce.True);
    const filtered = ce.box(['Filter', list, keep]).evaluate();
    const items = [...(filtered as any).each()];
    expect(items).toHaveLength(2);
    expect(items[0].re).toBeGreaterThanOrEqual(0);
    expect(items[0].re).toBeLessThan(1);
    expect(items[1].json).toBe(2);
    // The predicate saw the value that was emitted: it adds each element
    // to `seen`, so `seen − 2` is the random element the walk emitted.
    ce.assign('seen', 0);
    const adding = [
      'Function',
      ['Block', ['Assign', 'seen', ['Add', 'seen', 'x']], 'True'],
      'x',
    ];
    const walked = [
      ...(ce.box(['Filter', list, adding]).evaluate() as any).each(),
    ];
    expect(ce.box('seen').evaluate().re - 2).toBeCloseTo(walked[0].re, 12);
  });

  test('an impure literal with no condition: the predicate judged the emitted value', () => {
    const ce = new ComputeEngine();
    const above = ['Function', ['Greater', 'x', 0.5], 'x'];
    for (let walk = 0; walk < 50; walk++) {
      const items = [
        ...(
          ce.box(['Filter', ['List', ['Random'], 2], above]).evaluate() as any
        ).each(),
      ];
      for (const x of items) expect(x.re).toBeGreaterThan(0.5);
    }
  });

  test('a lazy Map over the impure literal maps the value', () => {
    const ce = new ComputeEngine();
    const plusOne = ['Function', ['Add', 'x', 1], 'x'];
    ce.assign('c', ce.True);
    const mapped = [
      ...(ce.box(['Map', plusOne, list]).evaluate() as any).each(),
    ];
    expect(mapped).toHaveLength(2);
    expect(mapped[0].re).toBeGreaterThanOrEqual(1);
    expect(mapped[0].re).toBeLessThan(2);
    expect(mapped[1].json).toBe(3);
  });
});
