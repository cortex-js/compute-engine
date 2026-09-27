/**
 * A function literal applied to a collection maps element by element, like a
 * named user function with the same body, on every route (user decision
 * 2026-09-26, Tycho item 327). It used to bind each argument whole, so
 * `Apply(i ↦ Sum(Cos(n), Limits(n, 1, i)), [1, 2, 3])` was an
 * `incompatible-type` error while the named call and the compiled code
 * mapped.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const SUM_BODY = ['Sum', ['Cos', 'n'], ['Limits', 'n', 1, 'i']];

describe('A FUNCTION LITERAL APPLIED TO A COLLECTION', () => {
  test.each([
    ['a list', ['List', 1, 2, 3], 3],
    ['a range', ['Range', 1, 5], 5],
  ])('the literal and the named call agree over %s', (_, arg, n) => {
    const ce = new ComputeEngine();
    const f = ['Function', SUM_BODY, 'i'];
    ce.declare('X', 'function');
    ce.assign('X', ce.box(f as never));
    const literal = ce.box(['Apply', f, arg] as never);
    const named = ce.box(['X', arg] as never);
    expect(literal.type.toString()).toBe(named.type.toString());
    expect(literal.evaluate().toString()).toBe(named.evaluate().toString());
    const run = compile(literal, { fallback: false } as never)!.run!;
    expect((run({}) as number[]).length).toBe(n);
  });

  test('a scalar argument is unchanged', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Apply', ['Function', SUM_BODY, 'i'], 3] as never);
    // The upper bound `i` is not known to be finite, so the sum may also
    // diverge or have no limit (`bigOpOverDomainType`).
    expect(call.type.toString()).toBe('nan | real | signed_infinity');
    expect(call.evaluate().toString()).toBe('cos(1) + cos(2) + cos(3)');
  });

  test('a body that builds a tuple maps too', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Tuple', 'x', 'x'], 'x'],
      ['List', 1, 2],
    ] as never);
    expect(call.evaluate().toString()).toBe('[(1, 1),(2, 2)]');
    // The body is typed with its parameter bound to the element type.
    expect(call.type.toString()).toBe('list<tuple<integer, integer>>');
  });

  test('a nested list is mapped at its leaves, and typed so', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], 'x'];
    ce.declare('D', 'function');
    ce.assign('D', ce.box(f as never));
    const arg = ['List', ['List', 1, 2], ['List', 3, 4]];
    for (const e of [['Apply', f, arg], ['D', arg]]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.toString()).toBe('[[(1, 1),(2, 2)],[(3, 3),(4, 4)]]');
      expect(value.type.matches(call.type)).toBe(true);
    }
  });

  test('a tuple beside a list is repeated whole, on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'y'], 'x', 'y'];
    ce.declare('P', 'function');
    ce.assign('P', ce.box(f as never));
    const args = [['List', 1, 2, 3], ['Tuple', 10, 20]];
    const expected = '[(1, (10, 20)),(2, (10, 20)),(3, (10, 20))]';
    expect(
      ce.box(['Apply', f, ...args] as never).evaluate().toString()
    ).toBe(expected);
    expect(ce.box(['P', ...args] as never).evaluate().toString()).toBe(
      expected
    );
  });

  test('collections of different lengths are an error on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    ce.declare('Y', 'function');
    ce.assign('Y', ce.box(f as never));
    const args = [['List', 1, 2], ['List', 1, 2, 3]];
    expect(
      ce.box(['Apply', f, ...args] as never).evaluate().toString()
    ).toContain('incompatible-dimensions');
    expect(ce.box(['Y', ...args] as never).evaluate().toString()).toContain(
      'incompatible-dimensions'
    );
  });

  test('a parenthesized pipe stage maps', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('[1,2,3] |> (x \\mapsto (x,x))').evaluate().toString()
    ).toBe('[(1, 1),(2, 2),(3, 3)]');
  });

  test('a collection parameter binds the argument whole', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Length', 'x'], 'x'],
      ['List', 1, 2],
    ] as never);
    expect(call.evaluate().toString()).toBe('2');
  });

  test('several arguments zip, and a scalar argument repeats', () => {
    const ce = new ComputeEngine();
    const add = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    expect(
      ce.box(['Apply', add, ['List', 1, 2], 10] as never).evaluate().toString()
    ).toBe('[11,12]');
    expect(
      ce
        .box(['Apply', add, ['List', 1, 2], ['List', 1, 2, 3]] as never)
        .evaluate()
        .toString()
    ).toContain('incompatible-dimensions');
  });

  test.each(['value', 'unknown'])(
    'a large declared broadcastable<%s> map still maps one rank only',
    (t) => {
      const ce = new ComputeEngine();
      ce.declare('vf', `(broadcastable<${t}>) -> unknown` as never);
      ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
      const rows = Array.from({ length: 150 }, (_, i) => ['List', i, i + 1]);
      const value = ce.box(['vf', ['List', ...rows]] as never).evaluate();
      expect(value.at(3)?.toString()).toBe('([2,3], [2,3])');
    }
  );

  test('a declared broadcastable slot still maps one rank only', () => {
    const ce = new ComputeEngine();
    ce.declare('vf', '(broadcastable<value>) -> unknown');
    ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    expect(
      ce
        .box(['vf', ['List', ['List', 1, 2], ['List', 3, 4, 5]]] as never)
        .evaluate()
        .toString()
    ).toBe('[([1,2], [1,2]),([3,4,5], [3,4,5])]');
  });

  test('a collection argument with no value holds the call, like the named route', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'list<number>');
    const f = ['Function', ['Tuple', 'x', 'y'], 'x', 'y'];
    expect(
      ce.box(['Apply', f, ['List', 1, 2], 's'] as never).evaluate().operator
    ).toBe('Apply');
  });

  test('an error argument bubbles before the map', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', 'x', 'x', 'y'],
      ['List'],
      ['Error', "'boom'"],
    ] as never);
    expect(call.evaluate().toString()).toBe('Error("boom")');
  });

  test('an annotated `value` parameter maps, as on the named route', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], ['Typed', 'x', "'value'"]];
    expect(
      ce.box(['Apply', f, ['List', 1, 2]] as never).evaluate().toString()
    ).toBe('[(1, 1),(2, 2)]');
  });

  test('a ragged list is typed so that its value is a member', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Tuple', 'x', 'x'], 'x'],
      ['List', ['List', 1, 2], 3],
    ] as never);
    expect(call.evaluate().type.matches(call.type)).toBe(true);
  });

  test('a large declared broadcastable map compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('S', '(broadcastable<real>) -> real' as never);
    ce.assign('S', ce.parse('x \\mapsto \\sin x'));
    const value = ce.box(['S', ['Range', 1, 300]] as never).evaluate();
    const r = compile(value, { fallback: false } as never)!;
    expect(r.success).toBe(true);
    expect((r.run!({}) as number[]).length).toBe(300);
  });

  // A known-infinite source maps lazily on both routes, so the value is the
  // infinite list its `list<tuple<…>>` type describes. `Apply`, and a
  // function declared `function` then assigned, used to bind it whole:
  // `(Range(1, +oo), Range(1, +oo))`.
  test.each([
    ['an infinite range', ['Range', 1, { num: '+Infinity' }], '(3, 3)'],
    ['a cycle', ['Cycle', ['List', 1, 2]], '(1, 1)'],
  ])('a known-infinite source maps lazily: %s', (_, arg, third) => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Tuple', 'x', 'x'], 'x'];
    ce.declare('H', 'function');
    ce.assign('H', ce.box(f as never));
    for (const e of [['Apply', f, arg], ['H', arg]]) {
      const call = ce.box(e as never);
      const value = call.evaluate();
      expect(value.isFiniteCollection).toBe(false);
      expect(value.at(3)?.toString()).toBe(third);
      expect(call.type.toString()).toMatch(/^list<tuple</);
    }
  });

  test('a finite list beside an infinite source is an error on both routes', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    ce.declare('G', 'function');
    ce.assign('G', ce.box(f as never));
    const args = [['List', 1, 2, 3], ['Range', 1, { num: '+Infinity' }]];
    for (const e of [['Apply', f, ...args], ['G', ...args]])
      expect(ce.box(e as never).evaluate().toString()).toBe(
        'Error("incompatible-dimensions", "3 vs Infinity")'
      );
  });
});
