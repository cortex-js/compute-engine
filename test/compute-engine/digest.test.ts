/**
 * `expr.digest` — a 128-bit digest of the expression's SERIALIZED structure,
 * usable as a cache key without a compare on hit. It keys the way
 * `JSON.stringify(expr.json)` keys (up to a dictionary's entry order, and
 * with a character digesting like the one-cluster string of the same
 * content), at a cost linear in the distinct nodes. It is NOT an `isSame`
 * key — `hash` is — and the divergences are pinned below, not only
 * documented.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('digest: shape', () => {
  test('32 lowercase hexadecimal characters', () => {
    for (const e of [
      ce.parse('x + 1'),
      ce.number(42),
      ce.symbol('x'),
      ce.string('abc'),
      ce.box({ dict: { a: 1 } }),
    ])
      expect(e.digest).toMatch(/^[0-9a-f]{32}$/);
  });

  test('memoized: the same object answers the same string', () => {
    const e = ce.parse('\\sin(x) + \\cos(y)');
    expect(e.digest).toBe(e.digest);
  });
});

describe('digest: a key of the serialized structure', () => {
  test('separately parsed equal expressions', () => {
    const a = ce.parse('2x + \\sqrt{3}');
    const b = ce.parse('2x + \\sqrt{3}');
    expect(a.isSame(b)).toBe(true);
    expect(a.digest).toBe(b.digest);
  });

  test('a character and the one-cluster string with the same content', () => {
    const c = ce.character('a');
    const s = ce.string('a');
    expect(c.isSame(s)).toBe(true);
    expect(c.digest).toBe(s.digest);
  });

  test('dictionaries with the same entries in another order', () => {
    const a = ce.box({ dict: { p: 1, q: ['Add', 'x', 1] } });
    const b = ce.box({ dict: { q: ['Add', 'x', 1], p: 1 } });
    expect(a.isSame(b)).toBe(true);
    expect(a.digest).toBe(b.digest);
  });

  test("a dictionary key that spells another dictionary's entries is not that dictionary", () => {
    const one = ce.box(1);
    const two = ce.box({ dict: { a: 1, b: 2 } });
    // Without a length prefix on keys, this one-entry dictionary's digest
    // input would read as the two-entry one's.
    const forged = ce.box({
      dict: { [`a\u001e${one.digest}\u001fb`]: 2 },
    });
    expect(forged.digest).not.toBe(two.digest);
  });

  test("a symbol's assigned value does not enter its digest", () => {
    const local = new ComputeEngine();
    const before = local.symbol('v').digest;
    local.assign('v', 7);
    expect(local.symbol('v').digest).toBe(before);
    expect(local.box(7).digest).not.toBe(before);
  });

  test('a symbol bound in two scopes digests alike, as it serializes alike', () => {
    const s1 = ce.createScope({ w: 'real' });
    const s2 = ce.createScope({ w: 'integer' });
    const a = ce.box(['Add', 'w', 1], { scope: s1 });
    const b = ce.box(['Add', 'w', 1], { scope: s2 });
    expect(a.isSame(b)).toBe(false); // binding identity
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
    expect(a.digest).toBe(b.digest);
  });

  test('1/2 and 0.5 are isSame yet digest apart, as they serialize apart', () => {
    const r = ce.box(['Rational', 1, 2]);
    const f = ce.box(0.5);
    expect(r.isSame(f)).toBe(true);
    expect(r.hash).toBe(f.hash); // the isSame companion agrees
    expect(r.digest).not.toBe(f.digest);
  });

  test('two big decimals differing past the working precision digest apart', () => {
    const big = new ComputeEngine({ precision: 40 });
    const p = big.box({ num: '0.12345678901234567890123456789012345678901' });
    const q = big.box({ num: '0.12345678901234567890123456789012345678902' });
    expect(p.isSame(q)).toBe(false);
    expect(p.digest).not.toBe(q.digest);
  });

  test('a store-backed list and an operand-boxed list of the same numbers', () => {
    const boxed = ce.box(['List', 1, 2.5, 3]);
    const stored = ce.box(['List', 1, 2.5, 3]).evaluate();
    expect(stored.isSame(boxed)).toBe(true);
    expect(stored.digest).toBe(boxed.digest);
  });

  test('a node above a mutable object reads the digest fresh after a store', () => {
    const object = ce._object('Box', { n: ce.number(1) });
    const wrapper = ce.function('List', [object, ce.number(2)]);
    const before = wrapper.digest;
    expect(wrapper.digest).toBe(before);
    object._store('n', ce.number(99));
    expect(object.digest).not.toBe(before);
    expect(wrapper.digest).not.toBe(before);
  });

  test('two objects with the same record snapshot digest alike; a changed record does not', () => {
    const a = ce.box([
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 1]],
      "'Box'",
    ]);
    const b = ce.box([
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 1]],
      "'Box'",
    ]);
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
    expect(a.digest).toBe(b.digest);
    const c = ce.box([
      'Object',
      ['Dictionary', ['KeyValuePair', { str: 'n' }, 2]],
      "'Box'",
    ]);
    expect(c.digest).not.toBe(a.digest);
  });

  test('deterministic across engine instances', () => {
    const other = new ComputeEngine();
    expect(other.parse('x^2 + y').digest).toBe(ce.parse('x^2 + y').digest);
  });
});

describe('digest: distinct expressions differ', () => {
  test('kinds, operators, operands, order, and bound-variable names', () => {
    const digests = [
      ce.symbol('x'),
      ce.string('x'),
      ce.number(1),
      ce.string('1'),
      ce.parse('x + 1'),
      ce.parse('x - 1'),
      ce.parse('x + 2'),
      ce.box(['Subtract', 'x', 1], { form: 'raw' }),
      ce.box(['Subtract', 1, 'x'], { form: 'raw' }),
      ce.parse('\\sum_{i=1}^{n} i'),
      ce.parse('\\sum_{j=1}^{n} j'),
      ce.box({ dict: { a: 1 } }),
      ce.box({ dict: { b: 1 } }),
      ce.box(['List', 1, 2, 3]),
      ce.box(['List', 1, 2]),
    ].map((e: Expression) => e.digest);
    expect(new Set(digests).size).toBe(digests.length);
  });
});

describe('digest: cost', () => {
  test('linear in the distinct nodes of a DAG-shared expression', () => {
    // 16 levels, four reads per level, every level's four operands the SAME
    // object: 18 distinct nodes, 4^15 leaves as a tree — a tree walk of any
    // kind would not finish; `JSON.stringify(expr.json)` is such a walk.
    // `Tuple`, because a canonical `Add` of sums FLATTENS into the tree-sized
    // term list.
    let level: Expression = ce.box(['Add', 'q', 1]);
    for (let i = 1; i < 16; i++)
      level = ce.function('Tuple', new Array<Expression>(4).fill(level));
    const t = performance.now();
    const d = level.digest;
    expect(performance.now() - t).toBeLessThan(200);
    expect(d).toMatch(/^[0-9a-f]{32}$/);
  });
});
