// A single-branch `If(c, e)` (the parse of the restriction `e\{c\}`) is typed
// as its arm `e`, with no `nan` or `missing` member, but its value is absent
// where `c` fails. These tests check that the discharges (`Coalesce`,
// `AssertPresent`, `IsMissing`) do not read its type as a proof of presence,
// that compiled code masks a list as the interpreter does, that an untyped
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

  test('compiled Coalesce(If(c, 3), 7) at c false and true', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const json = ['Coalesce', ['If', 'c', 3], 7];
    expect(run(ce, json, { c: false })).toBe(7);
    expect(run(ce, json, { c: true })).toBe(3);
  });

  test('compiled AssertPresent(If(c, 3)) checks for absence', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const json = ['AssertPresent', ['If', 'c', 3]];
    expect(run(ce, json, { c: true })).toBe(3);
    expect(() => run(ce, json, { c: false })).toThrow(/expected-present/);
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

  test('compiled Coalesce and AssertPresent check for absence', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.declare('d', 'boolean');
    expect(run(ce, ['Coalesce', NESTED, 7], { c: true, d: false })).toBe(7);
    expect(run(ce, ['Coalesce', NESTED, 7], { c: true, d: true })).toBe(3);
    expect(() =>
      run(ce, ['AssertPresent', NESTED], { c: true, d: false })
    ).toThrow(/expected-present/);
    expect(run(ce, ['AssertPresent', NESTED], { c: false, d: false })).toBe(
      4
    );
  });

  test('compiled AssertPresent checks a sum with a restricted point', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.declare('P', 'tuple<real, real>');
    ce.declare('Q', 'tuple<real, real>');
    const json = ['AssertPresent', ['Add', ['If', 'c', 'P'], 'Q']];
    expect(run(ce, json, { c: true, P: [1, 2], Q: [3, 4] })).toEqual([4, 6]);
    // The sum is typed `tuple<real, real>`; the check must still be emitted.
    // (At c = False the compiled `Add` reads an absent tuple, whose value
    // the caveats of compiled code leave unspecified.)
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect((r as { code: string }).code).toMatch(/expected-present/);
  });

  test('a nested boolean restriction is False, not absent, in a compiled call', () => {
    // `If(d, True)` with `d` false is `False`: a restriction of a boolean
    // by a false scalar condition is `False` (user decision of 2026-11-02,
    // two-valued comparisons). So the argument is present and the default
    // of `s` is not used. Before, the argument was absent and `f` gave 1.
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.declare('d', 'boolean');
    ce.box([
      'Assign',
      'f',
      ['Function', ['If', 's', 1, 2], ['Optional', 's', 'True']],
    ]).evaluate();
    const json = ['f', ['If', 'c', ['If', 'd', 'True'], 'False']];
    expect(run(ce, json, { c: true, d: false })).toBe(2);
    expect(run(ce, json, { c: true, d: true })).toBe(1);
    expect(run(ce, json, { c: false, d: true })).toBe(2);
    ce.assign('c', true);
    ce.assign('d', false);
    expect(ce.box(json).evaluate().json).toBe(2);
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

  test('an accessor over a list literal can give its absent element', () => {
    // `First` gives the element `If(c, "a")`, which is absent where `c` is
    // false, so compiled `AssertPresent` keeps its check. (A boolean element
    // would be `False` there, not absent.)
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const json = [
      'AssertPresent',
      ['First', ['List', ['If', 'c', { str: 'a' }], { str: 'b' }]],
    ];
    expect(run(ce, json, { c: true })).toBe('a');
    expect(() => run(ce, json, { c: false })).toThrow(/expected-present/);
  });
});

describe('a single-branch If over a mask compiles as the restriction', () => {
  test('If(C, L) aligns the list with the mask and truncates', () => {
    const ce = new ComputeEngine();
    ce.declare('C', 'list<boolean>');
    ce.declare('L', 'list<number>');
    const compiled = run(ce, ['If', 'C', 'L'], {
      C: [true, true],
      L: [10, 20, 30],
    });
    // The declared types do not give the lengths, so the interpreter
    // aligns the values at run time, as the compiled code does. When the
    // types give two lengths, the expression is a static error (selection
    // rule of 2026-11-02).
    ce.assign('C', ce.box(['List', 'True', 'True']));
    ce.assign('L', ce.box(['List', 10, 20, 30]));
    const interpreted = ce.box(['If', 'C', 'L']).evaluate();
    expect(interpreted.json).toEqual(['List', 10, 20]);
    expect(compiled).toEqual([10, 20]);
    const ce2 = new ComputeEngine();
    ce2.assign('C', ce2.box(['List', 'True', 'True']));
    ce2.assign('L', ce2.box(['List', 10, 20, 30]));
    expect(ce2.box(['If', 'C', 'L']).evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "2 vs 3")'
    );
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
