/**
 * A node that owns a local scope — a comprehension, a sum — evaluated in a
 * CHILD scope that shadows one of its free symbols.
 *
 * The node pushes its own scope again on every evaluation, and that scope's
 * parent link is the scope the node was canonicalized in. An expression reads
 * each name from the scope it was boxed in, so a declaration made in a child
 * scope pushed later is not read, by the node as by a plain symbol beside it.
 * The node bound again in the child scope (`ce.rebind()`) reads the child's
 * declaration. A stored function value is a closure and evaluates in its own
 * environment.
 */
import { ComputeEngine } from '../../src/compute-engine';

const COMP = String.raw`\left[\frac{k}{n}\operatorname{for}k=\left[1...n\right]\right]`;
const SUM = String.raw`\sum_{k=1}^{n} k`;

function values(e: ReturnType<ComputeEngine['parse']>): string[] {
  return [...e.evaluate().each()].map((x) => x.toString());
}

describe('a binder evaluated in a child scope that shadows its free symbol', () => {
  test('a comprehension and a sum read their home scope, like a plain symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const comp = ce.parse(COMP);
    const sum = ce.parse(SUM);
    const plain = ce.parse('90n');
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 4);
    expect(plain.N().isSame(plain)).toBe(true);
    expect(comp.evaluate().count).toBeUndefined();
    expect(sum.evaluate().isSame(sum)).toBe(true);
    // Bound again in the child scope, they read its `n`.
    expect(ce.rebind(plain).N().re).toBe(360);
    const c = ce.rebind(comp);
    expect(c.evaluate().count).toBe(4);
    expect(values(c)).toEqual(['1/4', '1/2', '3/4', '1']);
    expect(ce.rebind(sum).evaluate().re).toBe(10);
    ce.popScope();
    // Back in the root scope, `n` is unassigned again: the binder is symbolic.
    expect(comp.evaluate().count).toBeUndefined();
    expect(sum.evaluate().isSame(sum)).toBe(true);
  });

  test('the ordinary assignment in the root scope still works', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const comp = ce.parse(COMP);
    ce.assign('n', 3);
    expect(values(comp)).toEqual(['1/3', '2/3', '1']);
  });

  test('a stored function value stays a closure over its own environment', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    ce.declare('f', '(number) -> number');
    ce.assign('f', ce.parse('x \\mapsto x n'));
    const call = ce.parse('f(2)');
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 4);
    // The body's `n` is the root's `n`, not the child's shadow.
    expect(call.evaluate().toString()).toBe('2n');
    ce.popScope();
  });

  test("a scope that does not descend from the binder's own scope is not read", () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    // Canonicalized inside child scope A …
    ce.pushScope();
    const comp = ce.parse(COMP);
    ce.popScope();
    // … and evaluated inside sibling scope B, which shadows `n`. B does not
    // descend from A, so the binder keeps its own chain (A → root) and the
    // root's `n` — unassigned — is what it reads.
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 4);
    expect(comp.evaluate().count).toBeUndefined();
    ce.popScope();
  });

  test('nested binders keep reaching the outer index', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const nested = ce.parse(String.raw`\sum_{i=1}^{n}\sum_{j=1}^{n} i j`);
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 2);
    expect(nested.evaluate().isSame(nested)).toBe(true);
    // (1 + 2)² = 9
    expect(ce.rebind(nested).evaluate().re).toBe(9);
    ce.popScope();
  });

  test('a write to the shadow binding invalidates the element memo of the node bound again', () => {
    // The node boxed at the top reads the top `ks`, also in the child scope.
    // The node bound again in the child scope reads the shadow binding: its
    // write version and its stored value are tracked.
    const ce = new ComputeEngine();
    ce.assign('ks', 2);
    const comp = ce.box([
      'Comprehension',
      ['Multiply', 'ks', 'n'],
      ['Element', 'n', ['Range', 1, 4]],
    ]);
    const total = (): number =>
      [...comp.each()].reduce((a, x) => a + (x.re as number), 0);
    expect(total()).toBe(20);
    ce.pushScope();
    ce.declare('ks', { value: 99 });
    expect(total()).toBe(20);
    const inner = ce.rebind(comp);
    const innerTotal = (): number =>
      [...inner.each()].reduce((a, x) => a + (x.re as number), 0);
    expect(innerTotal()).toBe(990);
    ce.assign('ks', 100);
    expect(innerTotal()).toBe(1000);
    ce.popScope();
    expect(total()).toBe(20);
  });

  test('a walk suspended across a scope change reads one environment', () => {
    // One element pulled under the child scope, the rest under the root:
    // the node reads its home scope in both.
    const ce = new ComputeEngine();
    ce.assign('n', 2);
    const comp = ce.box([
      'Comprehension',
      ['Multiply', 'n', 'k'],
      ['Element', 'k', ['Range', 1, 2]],
    ]);
    ce.pushScope();
    ce.declare('n', { value: 99 });
    const it = comp.each()[Symbol.iterator]();
    expect(it.next().value?.toString()).toBe('2');
    ce.popScope();
    const rest: string[] = [];
    for (let r = it.next(); !r.done; r = it.next())
      rest.push(r.value.toString());
    expect(rest).toEqual(['4']);
    expect([...comp.each()].map(String)).toEqual(['2', '4']);
    expect(comp.at(1)?.toString()).toBe('2');
  });

  test('the lazy-collection memo distinguishes the two environments', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const comp = ce.parse(COMP);
    // Root first (symbolic), then the child (four elements), then root again.
    expect(comp.evaluate().count).toBeUndefined();
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 4);
    expect(comp.evaluate().count).toBeUndefined();
    expect(ce.rebind(comp).evaluate().count).toBe(4);
    ce.popScope();
    expect(comp.evaluate().count).toBeUndefined();
    // And a second child with a different value.
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 2);
    expect(values(ce.rebind(comp))).toEqual(['1/2', '1']);
    ce.popScope();
  });
});
