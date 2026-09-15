/**
 * A node that owns a local scope — a comprehension, a sum — evaluated in a
 * CHILD scope that shadows one of its free symbols.
 *
 * The node pushes its own scope again on every evaluation. That scope's
 * parent link is the scope the node was canonicalized in, so a declaration
 * made later in a child scope pushed on top of it was not on the chain: with
 * `n` declared but unassigned in the root scope, `[k/n for k in 1..n]`
 * evaluated in a child scope where `n = 4` stayed unevaluated (`count`
 * undefined, `each()` empty) while the plain symbol `90n` beside it answered
 * 360. Ruled 2026-09-15 (Tycho item 295): a directly evaluated expression
 * reads the environment it is evaluated in, so the re-pushed scope is chained
 * onto the ambient scope when the ambient chain descends from the scope's own
 * parent. A stored function value stays a closure and evaluates in its own
 * environment.
 */
import { ComputeEngine } from '../../src/compute-engine';

const COMP = String.raw`\left[\frac{k}{n}\operatorname{for}k=\left[1...n\right]\right]`;
const SUM = String.raw`\sum_{k=1}^{n} k`;

function values(e: ReturnType<ComputeEngine['parse']>): string[] {
  return [...e.evaluate().each()].map((x) => x.toString());
}

describe('a binder evaluated in a child scope that shadows its free symbol', () => {
  test('a comprehension and a sum read the child scope, like a plain symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const comp = ce.parse(COMP);
    const sum = ce.parse(SUM);
    const plain = ce.parse('90n');
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 4);
    expect(plain.N().re).toBe(360);
    const c = comp.evaluate();
    expect(c.count).toBe(4);
    expect(values(comp)).toEqual(['1/4', '1/2', '3/4', '1']);
    expect(sum.evaluate().re).toBe(10);
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
    // (1 + 2)² = 9
    expect(nested.evaluate().re).toBe(9);
    ce.popScope();
  });

  test('a write to the shadow binding invalidates the element memo', () => {
    // The memo's dependencies are resolved through the same chain the walk
    // reads, so the shadow binding — not only the occurrence's own — is
    // tracked: its write version and its stored value.
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
    expect(total()).toBe(990);
    ce.assign('ks', 100);
    expect(total()).toBe(1000);
    ce.popScope();
    expect(total()).toBe(20);
  });

  test('a walk suspended across a scope change is not committed as the memo', () => {
    // One element pulled under the child scope, the rest under the root:
    // the buffer mixes two environments and must not be served afterwards.
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
    expect(it.next().value?.toString()).toBe('99');
    ce.popScope();
    const rest: string[] = [];
    for (let r = it.next(); !r.done; r = it.next())
      rest.push(r.value.toString());
    expect(rest).toEqual(['4']);
    expect([...comp.each()].map(String)).toEqual(['2', '4']);
    expect(comp.at(1)?.toString()).toBe('2');
  });

  test('an interleaved frame of the same scope keeps the chain until the last frame is discarded', () => {
    // Two frames of ONE scope object can be live at once on the async path,
    // and a suspended frame is discarded by identity, not from the top. The
    // first discard must not restore the parent link out from under the
    // other frame; the last one restores the original.
    const ce = new ComputeEngine() as any;
    ce.declare('n', 'real');
    const root = ce.context.lexicalScope;
    const local = { parent: root, bindings: new Map() };
    ce.pushScope(); // the child scope the node is evaluated in
    const child = ce.context.lexicalScope;
    ce._pushEvalContext(local, undefined, { ambient: true });
    const first = ce.context;
    expect(local.parent).toBe(child);
    // An unrelated scope on top whose chain does not reach `local`.
    ce._pushEvalContext({ parent: child, bindings: new Map() });
    const z = ce.context.lexicalScope;
    ce._pushEvalContext(local, undefined, { ambient: true });
    expect(local.parent).toBe(z);
    // The first frame goes away first (by identity): the chain stays.
    ce._removeEvalContext(first);
    expect(local.parent).toBe(z);
    // The last frame restores the ORIGINAL link, not the one it found.
    ce.popScope();
    expect(local.parent).toBe(root);
    ce.popScope();
    ce.popScope();
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
    expect(comp.evaluate().count).toBe(4);
    ce.popScope();
    expect(comp.evaluate().count).toBeUndefined();
    // And a second child with a different value.
    ce.pushScope();
    ce.declare('n', 'real');
    ce.assign('n', 2);
    expect(values(comp)).toEqual(['1/2', '1']);
    ce.popScope();
  });
});
