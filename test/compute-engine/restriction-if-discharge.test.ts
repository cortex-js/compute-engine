// A single-branch `If(c, e)` (the parse of the restriction `e\{c\}`) is typed
// as its arm `e`, with no `nan` or `missing` member, but its value is absent
// where `c` fails. These tests check that the discharges (`Coalesce`,
// `AssertPresent`, `IsMissing`) do not read its type as a proof of presence,
// that an untyped
// `Declare(k, "unknown", v)` records the type of `v`, and that a false guard
// statement gives `Missing`.
// Decision of 2026-11-02, `docs/plans/2026-11-02-restriction-binding.md`.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function run(ce: ComputeEngine, json: unknown, vars: Record<string, unknown>) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return (r as { run: (v: Record<string, unknown>) => unknown }).run(vars);
}

describe('a single-branch If is not proved present by its type', () => {
  test('Coalesce(If(c, 3), 7) keeps the fallback while c is undecided', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const expr = ce.box(['Coalesce', ['If', 'c', 3], 7]);
    const held = expr.evaluate();
    expect(held.json).toEqual(['Coalesce', ['If', 'c', 3], 7]);
    ce.assign('c', false);
    expect(held.evaluate().json).toBe(7);
    ce.assign('c', true);
    expect(held.evaluate().json).toBe(3);
  });

  test('AssertPresent(If(c, 3)) and IsMissing(If(c, 3)) stay undecided', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    expect(ce.box(['AssertPresent', ['If', 'c', 3]]).evaluate().json).toEqual(
      ['AssertPresent', ['If', 'c', 3]]
    );
    expect(ce.box(['IsMissing', ['If', 'c', 3]]).evaluate().json).toEqual([
      'IsMissing',
      ['If', 'c', 3],
    ]);
    ce.assign('c', false);
    expect(ce.box(['IsMissing', ['If', 'c', 3]]).evaluate().json).toBe(
      'True'
    );
  });
});

describe('a restriction nested in an operand is not proved present', () => {
  // `If(c, If(d, 3), 4)` is typed `integer`, with no absent member, but it
  // is absent at c = True, d = False.
  const NESTED = ['If', 'c', ['If', 'd', 3], 4];

  test('the interpreter holds the discharges while c is undecided', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.declare('d', 'boolean');
    expect(ce.box(['IsMissing', NESTED]).evaluate().json).toEqual([
      'IsMissing',
      NESTED,
    ]);
    expect(ce.box(['Coalesce', NESTED, 7]).evaluate().json).toEqual([
      'Coalesce',
      NESTED,
      7,
    ]);
    expect(ce.box(['AssertPresent', NESTED]).evaluate().json).toEqual([
      'AssertPresent',
      NESTED,
    ]);
  });

  test('a Coalesce is absent when its last operand is absent', () => {
    // An absent first operand falls through to the second; the value of the
    // `Coalesce` is absent when the second one is absent too. The arms are
    // numbers: a restriction of a boolean is `False` where its condition is
    // false, not absent (user decision of 2026-11-02, two-valued
    // comparisons).
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.declare('d', 'boolean');
    const json = ['IsMissing', ['Coalesce', ['If', 'c', 1], ['If', 'd', 0]]];
    expect(ce.box(json).evaluate().json).toEqual(json);
    ce.assign('c', false);
    ce.assign('d', false);
    expect(ce.box(json).evaluate().json).toBe('True');
    ce.assign('d', true);
    expect(ce.box(json).evaluate().json).toBe('False');
  });

  test('a list literal is present when an element is a restriction', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const list = ['List', ['If', 'c', 1], 2];
    expect(
      ce.box(['IsMissing', ['List', ['If', 'c', 3], 1]]).evaluate().json
    ).toBe('False');
    expect(ce.box(['Coalesce', list, 0]).evaluate().json).toEqual(list);
    expect(ce.box(['AssertPresent', list]).evaluate().json).toEqual(list);
  });

  test('a Coalesce whose fallback is absent stays undecided', () => {
    // The last operand `Missing` is absent, so the value of the `Coalesce`
    // depends on the restriction in its first operand (a number: see above).
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const json = ['IsMissing', ['Coalesce', ['If', 'c', 1], 'Missing']];
    expect(ce.box(json).evaluate().json).not.toBe('False');
    ce.assign('c', false);
    expect(ce.box(json).evaluate().json).toBe('True');
  });
});

describe('Declare(k, "unknown", v) records the type of v', () => {
  test('a non-literal initializer types the local on the compile route', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'pair', ['Function', ['List', 'a', 'b'], 'a', 'b']])
      .evaluate();
    const json = [
      'Block',
      ['Declare', 'p', "'unknown'", ['pair', 1, 2]],
      ['Filter', 'p', ['Function', ['Greater', 'e', 1], 'e']],
    ];
    expect(run(ce, json, {})).toEqual([2]);
  });
});

describe('a false single-branch If with a statement arm', () => {
  test('is Missing, synchronously and asynchronously', async () => {
    const ce = new ComputeEngine();
    ce.assign('k', 3);
    ce.assign('a', 1);
    const expr = ce.box(['If', ['Equal', 'k', 2], ['Assign', 'a', 5]]);
    expect(expr.evaluate().json).toBe('Missing');
    expect((await expr.evaluateAsync()).json).toBe('Missing');
    expect(ce.box('a').evaluate().json).toBe(1);
  });
});
