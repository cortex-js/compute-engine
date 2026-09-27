import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * `Map` over a TUPLE source yields an ordered `list` of the lambda's results —
 * value and type — matching `Reverse`/`Take`/`Drop`/`Filter`, which all demote
 * a tuple to a list (ruled 2026-09-14).
 *
 * Before the ruling, `Map` over a tuple was inconsistent three ways:
 *   - the type depended on whether the lambda's result type was derivable: an
 *     assigned-symbol lambda ECHOED the source type (`tuple<integer, …>`, and
 *     worse, the SOURCE's element types — a mapped predicate was typed
 *     `tuple<integer, …>` while holding booleans), while an inline lambda fell
 *     to the abstract `collection` top;
 *   - the materialized container depended on the type: an indexed (tuple) type
 *     rebuilt a `List`, a `collection` type rebuilt a `Set`;
 *   - the `Set` rebuild DEDUPLICATED, so `Map(x ↦ 0, (1, 2))` collapsed to one
 *     element — a wrong count, not just a wrong container.
 *
 * The type is the single driver of both the dedup and the rebuilt head, so
 * typing the result `list<R>` fixes the value too: an indexed type rebuilds a
 * `List` and does not deduplicate.
 */

describe('Map over a tuple yields an ordered list', () => {
  test('type is list<R> whether the lambda is inline or an assigned symbol', () => {
    // Inline lambda: the result element type is derivable.
    const ce1 = new ComputeEngine();
    const inline = ce1.function('Map', [
      ce1.parse('x \\mapsto x + 10'),
      ce1.function('Tuple', [1, 2, 3]),
    ]);
    expect(inline.evaluate().type.toString()).toBe('list<integer>');

    // Assigned-symbol lambda: a bare-symbol callback with a known signature
    // types the elements from that signature's result type. `ce.assign`
    // infers `(unknown) -> number` for `x ↦ x + 10`, so the elements are
    // `number`, and the shape is an ordered `list`, never the tuple type.
    // The source type is copied only when the callback is unknown (user
    // decision 2026-09-27).
    const ce2 = new ComputeEngine();
    ce2.assign('g', ce2.parse('x \\mapsto x + 10'));
    expect(
      ce2.parse('\\mathrm{Map}(g, (1, 2, 3))').evaluate().type.toString()
    ).toBe('list<number>');
  });

  test('value is an ordered list, whichever route builds it', () => {
    // Parse route (lazy, held operands).
    const ce1 = new ComputeEngine();
    ce1.assign('g', ce1.parse('x \\mapsto x + 10'));
    expect(
      ce1.parse('\\mathrm{Map}(g, (1, 2, 3))').evaluate().toString()
    ).toBe('[11,12,13]');

    // Pre-boxed route (`ce.function` with bound operands).
    const ce2 = new ComputeEngine();
    ce2.assign('g', ce2.parse('x \\mapsto x + 10'));
    expect(
      ce2
        .function('Map', [ce2.symbol('g'), ce2.function('Tuple', [1, 2, 3])])
        .evaluate()
        .toString()
    ).toBe('[11,12,13]');
  });

  test('the result keeps every element — no set deduplication', () => {
    const ce = new ComputeEngine();
    // A constant callback maps two distinct elements onto one value. A set
    // rebuild would collapse them to `Set(0)`; a list keeps both.
    const r = ce
      .function('Map', [
        ce.parse('x \\mapsto 0'),
        ce.function('Tuple', [1, 2]),
      ])
      .evaluate();
    expect(r.toString()).toBe('[0,0]');
    expect(r.type.toString()).toBe('list<number>');
  });

  test('a predicate over a tuple is honestly typed, not the source element type', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.parse('x \\mapsto x > 0'));
    const r = ce.parse('\\mathrm{Map}(p, (1, 2, 3))').evaluate();
    // The value is booleans. The callback `p` has the inferred signature
    // `(unknown) -> boolean`, so the elements are typed from its result
    // type: `list<boolean>`, never the source's
    // `tuple<integer, integer, integer>`.
    expect(r.toString()).toBe('["True","True","True"]');
    expect(r.type.toString()).toBe('list<boolean>');
  });

  test('arithmetic on a tuple mapped through a symbol compiles on the JavaScript target', () => {
    // The point of the list-out contract: the result is provably array-shaped,
    // so arithmetic on it compiles where the abstract `collection` top failed
    // closed. The source is a DECLARED tuple symbol, not a literal — a literal
    // tuple would constant-fold before the compiler sees the shape.
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple<number, number, number>');
    ce.assign('g', ce.parse('x \\mapsto x + 10'));
    const r = compile(ce.box(['Add', ['Map', 'g', 'T'], 1]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({ T: [1, 2, 3] })).toEqual([12, 13, 14]);
  });

  test('a bare `tuple`-typed source is demoted to a list too, both lambda forms', () => {
    // The bare `tuple` spelling (`ce.declare('t', 'tuple')`) reaches the type
    // handler as the primitive string `'tuple'`, not a structured tuple type.
    // It must get the same list-out contract, or the result would depend on
    // how the tuple was declared.

    // Inline callback — the known-result path (through `mapResultType`).
    const ce1 = new ComputeEngine();
    ce1.declare('t', 'tuple');
    expect(
      ce1.box(['Map', ['Function', ['Add', 'x', 10], 'x'], 't']).type.toString()
    ).toBe('list<number>');

    // Assigned-symbol callback: its inferred signature `(unknown) -> number`
    // gives the element type, and the bare `tuple` source is demoted to a
    // `list` as well.
    const ce2 = new ComputeEngine();
    ce2.declare('t', 'tuple');
    ce2.assign('g', ce2.parse('x \\mapsto x + 10'));
    expect(ce2.box(['Map', 'g', 't']).type.toString()).toBe('list<number>');
  });

  test('a list source is unchanged — still a vector/list, both lambda forms', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto x + 10'));
    // A list source keeps its kind and dimensions (`vector` of 3). The
    // elements are typed from the callback's inferred signature
    // `(unknown) -> number`, so `vector<3>` (`vector<number^3>`), not the
    // source's `integer`: the source type is copied only when the callback
    // is unknown (user decision 2026-09-27).
    expect(
      ce.parse('\\mathrm{Map}(g, \\lbrack 1, 2, 3 \\rbrack)').evaluate().type.toString()
    ).toBe('vector<3>');
  });
});
