import { ComputeEngine } from '../../src/compute-engine';

/**
 * The type cache of a LITERAL LIST TREE — a `List` whose elements are number
 * or string literals or such lists — is keyed on the world version alone,
 * not on the engine generation (`BoxedFunction.type`). Every other node keys
 * on the generation, which a value write, a declaration or a type write
 * advances. The accumulator loop `xs = Join(xs, [k])` assigns every turn, and
 * without the constant key each turn re-typed the whole list four times.
 */

describe('a literal list tree keeps its type across generation bumps', () => {
  test('a value write does not invalidate the entry', () => {
    const ce = new ComputeEngine();
    const xs = ce.box(['List', 1, 2, 3]);
    const before = xs.type;
    ce.assign('unrelated', ce.number(1));
    expect(xs.type).toBe(before);
    ce.declare('later', 'integer');
    expect(xs.type).toBe(before);
  });

  test('a nested literal list is a literal list tree too', () => {
    const ce = new ComputeEngine();
    const m = ce.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    const before = m.type;
    ce.assign('unrelated', ce.number(1));
    expect(m.type).toBe(before);
  });

  test('a world-level change recomputes the entry', () => {
    const ce = new ComputeEngine();
    const xs = ce.box(['List', 1, 2, 3]);
    const before = xs.type;
    // An assumption advances the world version.
    ce.assume(ce.parse('n > 0'));
    const after = xs.type;
    expect(after).not.toBe(before);
    expect(after.toString()).toBe(before.toString());
  });

  test('a list holding a symbol keeps the generation key', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.number(2));
    const xs = ce.box(['List', 1, 'y']);
    const before = xs.type.toString();
    expect(before).not.toContain('string');
    ce.assign('y', ce.string('a'));
    expect(xs.type.toString()).toContain('string');
  });

  test('a list holding an application keeps the generation key', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.number(2));
    const xs = ce.box(['List', ['Add', 'y', 1]]);
    expect(xs.type.toString()).not.toContain('string');
    ce.assign('y', ce.string('a'));
    expect(xs.type.toString()).not.toBe('list<integer>');
  });
});
