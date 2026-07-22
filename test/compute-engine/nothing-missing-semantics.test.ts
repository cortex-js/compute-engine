/**
 * `Nothing` (erasure) vs `Missing` (absent-but-positioned) — the ratified
 * semantics (2026-07-22, BREAKING).
 *
 *  1. `Nothing` is an ERASURE marker (an empty-sequence splice). It is elided
 *     from operator argument lists AND from collections.
 *  2. Out-of-band access is POSITION-PRESERVING and yields a marker chosen by
 *     the collection's element type: `NaN` when numeric, `Missing` otherwise.
 *  3. `Missing` means "a position exists, its value is absent" (Julia
 *     `missing`, R `NA`). It is never erased, and it propagates.
 *  4. Statistics SKIP `Nothing` and PROPAGATE `Missing`/`NaN`.
 *  5. Boolean-mask indexing still DROPS — a mask is a filter, so compaction is
 *     correct there.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

const ev = (x: any): Expression => ce.box(x).evaluate();

describe('Nothing ERASES in collections', () => {
  test('a Nothing element is spliced out of a list literal', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    expect(l.toString()).toBe('[12,34]');
    expect(ev(['Length', l]).re).toBe(2);
    expect(l.type.toString()).toBe('vector<finite_integer^2>');
  });

  test('At sees the compacted positions', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    expect(ev(['At', l, 2]).re).toBe(34);
  });

  test('Map over a list with an erased element maps the survivors only', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    const mapped = ev(['Map', l, ['Function', ['Add', 'x', 1], 'x']]);
    expect(mapped.toString()).toBe('[13,35]');
  });

  test('a mapping function returning Nothing erases its element (mapMaybe)', () => {
    const m = ce.box(['Map', ['List', 1, 2, 3], ['Function', 'Nothing', 'x']]);
    // Iteration splices the erased elements out...
    expect(Array.from(m.each())).toEqual([]);
    // ...and materializing the lazy `Map` yields the empty list.
    const mapped = m.evaluate({ materialization: true });
    expect(mapped.operator).toBe('List');
    expect(mapped.nops).toBe(0);
  });

  test('a mapping function returning Nothing for SOME elements erases only those', () => {
    const m = ce.box([
      'Map',
      ['List', 1, 2, 3],
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
    ]);
    expect(m.evaluate({ materialization: true }).toString()).toBe('[1,3]');
  });

  test('Nothing is still elided from an operand list (unchanged)', () => {
    expect(ce.box(['Add', 'Nothing', 1]).toString()).toBe('1');
    expect(ev(['Add', 'Nothing', 1]).re).toBe(1);
  });

  test('a Nothing element is spliced out of a Set literal', () => {
    for (const s of [
      ce.box(['Set', 1, 'Nothing', 3]),
      ce.expr(['Set', 1, 'Nothing', 3]),
      ce.function('Set', [ce.box(1), ce.Nothing, ce.box(3)]),
    ]) {
      expect(s.toString()).toBe('Set(1, 3)');
      expect(s.count).toBe(2);
      expect(s.type.toString()).toBe('set<finite_integer>');
    }
  });

  test('a Nothing element is spliced out of a Set literal (parse route)', () => {
    const s = ce.parse('\\{1, \\mathrm{Nothing}\\}');
    expect(s.toString()).toBe('Set(1)');
    expect(s.count).toBe(1);
  });

  test('a Nothing element is spliced out of a Tuple literal (arity changes)', () => {
    for (const t of [
      ce.box(['Tuple', 1, 'Nothing', 3]),
      ce.expr(['Tuple', 1, 'Nothing', 3]),
      ce.function('Tuple', [ce.box(1), ce.Nothing, ce.box(3)]),
    ]) {
      expect(t.toString()).toBe('(1, 3)');
      expect(t.count).toBe(2);
      // The type follows the SPLICED arity — a 3-point that loses a
      // coordinate is an honest 2-tuple, not an error.
      expect(t.type.toString()).toBe('tuple<finite_integer, finite_integer>');
    }
  });

  test('a Nothing element is spliced out of a Tuple literal (parse route)', () => {
    // The `Delimiter`-to-`Tuple` route builds the tuple directly and would
    // otherwise bypass the `Tuple` canonical handler.
    const t = ce.parse('(1, 3, \\mathrm{Nothing})');
    expect(t.toString()).toBe('(1, 3)');
    expect(t.count).toBe(2);
    expect(t.type.toString()).toBe('tuple<finite_integer, finite_integer>');
  });

  test('ce.tuple() splices Nothing like the other tuple routes', () => {
    const t = ce.tuple(ce.box(1), ce.Nothing, ce.box(3));
    expect(t.operator).toBe('Tuple');
    expect(t.toString()).toBe('(1, 3)');
    expect(t.nops).toBe(2);
    expect(t.type.toString()).toBe('tuple<finite_integer, finite_integer>');
    expect(ce.tuple(ce.Nothing, ce.Nothing).nops).toBe(0);
    // The numeric overload is unaffected.
    expect(ce.tuple(1, 2).nops).toBe(2);
  });

  test('a POSITIONAL (key, value) pair is NOT spliced', () => {
    // A dictionary value may legitimately be `Nothing`; splicing it would
    // unpair the entry. `BoxedDictionary.each()` and `KeyValuePair` build the
    // pair with `_fn`, not `tuple()`.
    // (A bare `'Nothing'` in a `{dict: …}` literal is a STRING; the symbol has
    // to come in as MathJSON or a boxed expression.)
    const d = ce.box([
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
      ['Tuple', { str: 'b' }, 'Nothing'],
    ] as any);
    const entries = Array.from(d.each());
    expect(entries.length).toBe(2);
    expect(entries.map((x) => x.nops)).toEqual([2, 2]);
    expect(entries[1].op2.symbol).toBe('Nothing');
    // …and `ce.tuple()` WOULD have spliced it.
    expect(ce.tuple(ce.string('b'), ce.Nothing).nops).toBe(1);

    const kv = ce.box(['KeyValuePair', { str: 'a' }, 'Nothing']);
    expect(kv.nops).toBe(2);
    expect(kv.op2.symbol).toBe('Nothing');
  });

  test('an all-Nothing collection literal is empty', () => {
    expect(ce.box(['Tuple', 'Nothing', 'Nothing']).nops).toBe(0);
    expect(ce.box(['Set', 'Nothing']).nops).toBe(0);
    expect(ce.box(['List', 'Nothing']).nops).toBe(0);
  });
});

describe('Missing is NOT erased and propagates', () => {
  test('a Missing element keeps its position in a list', () => {
    const l = ce.box(['List', 1, 'Missing', 3]);
    expect(ev(['Length', l]).re).toBe(3);
    expect(l.type.toString()).toBe('list<finite_integer | missing>');
    expect(ev(['At', l, 2]).symbol).toBe('Missing');
  });

  test('Missing has the `missing` unit type', () => {
    expect(ce.Missing.symbol).toBe('Missing');
    expect(ce.Missing.type.toString()).toBe('missing');
  });

  test('Missing propagates through arithmetic', () => {
    expect(ce.box(['Add', 'Missing', 1]).symbol).toBe('Missing');
    expect(ev(['Add', 'Missing', 1]).symbol).toBe('Missing');
    expect(ev(['Multiply', 'Missing', 3]).symbol).toBe('Missing');
    expect(ev(['Divide', 1, 'Missing']).symbol).toBe('Missing');
    expect(ev(['Sqrt', 'Missing']).symbol).toBe('Missing');
  });

  test('Missing propagates through a numeric function', () => {
    expect(ev(['Sin', 'Missing']).symbol).toBe('Missing');
  });

  // The propagation rule lives at the EVALUATE layer, so it does not depend
  // on how the expression was constructed. The big-op reduction kernels build
  // their accumulator with `ce._fn('Add', …)`, which bypasses the
  // canonicalization-time gate in `box.ts`.
  test('Missing propagates regardless of the construction route', () => {
    expect(ce._fn('Add', [ce.Missing, ce.box(4)]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce._fn('Multiply', [ce.Missing, ce.box(4)]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(ce._fn('Sin', [ce.Missing]).evaluate().symbol).toBe('Missing');
  });

  test('Missing propagates through a big-op reduction', () => {
    expect(ev(['Sum', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ev(['Product', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
  });

  test('a Missing-free big-op is unchanged', () => {
    expect(ev(['Sum', ['List', 1, 2, 3]]).re).toBe(6);
    expect(ev(['Product', ['List', 1, 2, 3]]).re).toBe(6);
    expect(ce.parse('\\sum_{i=1}^{3} i').evaluate().re).toBe(6);
    expect(ev(['Add', 1, 2]).re).toBe(3);
  });

  test('a structural operator keeps Missing as an ordinary operand', () => {
    // This is what makes `[1, Missing, 3]` a 3-element list.
    const l = ce.box(['List', 1, 'Missing', 3]);
    expect(l.nops).toBe(3);
    expect(l.evaluate().nops).toBe(3);
    expect(ce.box(['Tuple', 1, 'Missing', 3]).nops).toBe(3);
    expect(ce.box(['Set', 1, 'Missing', 3]).nops).toBe(3);
    expect(ev(['Equal', 'Missing', 1]).symbol).not.toBe('Missing');
  });
});

describe('out-of-band access is position-preserving', () => {
  const nums = ['List', 10, 20, 30];
  const strs = ['List', { str: 'a' }, { str: 'b' }];

  test('a scalar out-of-range index on a numeric list yields NaN', () => {
    expect(ev(['At', nums, 9]).isNaN).toBe(true);
    expect(ev(['At', nums, 0]).isNaN).toBe(true);
  });

  test('a gather keeps the index list length, marking out-of-range slots', () => {
    const g = ev(['At', nums, ['List', 0, 1, 2]]);
    expect(g.operator).toBe('List');
    expect(g.nops).toBe(3);
    expect(g.op1.isNaN).toBe(true);
    expect(g.op2.re).toBe(10);
    expect(g.op3.re).toBe(20);
  });

  test('a non-numeric collection yields Missing instead of NaN', () => {
    expect(ev(['At', strs, 5]).symbol).toBe('Missing');
    const g = ev(['At', strs, ['List', 1, 5]]);
    expect(g.nops).toBe(2);
    expect(g.op1.string).toBe('a');
    expect(g.op2.symbol).toBe('Missing');
  });

  test('a boolean mask still DROPS (a mask is a filter)', () => {
    const m = ev(['At', nums, ['List', 'True', 'False', 'True', 'True']]);
    expect(m.operator).toBe('List');
    expect(m.nops).toBe(2);
    expect(m.op1.re).toBe(10);
    expect(m.op2.re).toBe(30);
  });

  test('a missing dictionary key yields the marker', () => {
    const numeric = { dict: { a: 1, b: 2 } };
    expect(ce.box(['At', numeric, { str: 'z' }] as any).evaluate().isNaN).toBe(
      true
    );
    const strings = { dict: { a: { str: 'x' } } };
    expect(ce.box(['At', strings, { str: 'z' }] as any).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('the marker is never Nothing (it would erase the position)', () => {
    expect(ev(['At', nums, 9]).symbol).not.toBe('Nothing');
    expect(ev(['At', strs, 9]).symbol).not.toBe('Nothing');
  });
});

describe('statistics: Nothing skips, Missing and NaN propagate', () => {
  test('Nothing is skipped', () => {
    // (The list literal already splices it out; the statistic is over [1, 3].)
    expect(ev(['Mean', ['List', 1, 'Nothing', 3]]).re).toBe(2);
    expect(ev(['Median', ['List', 1, 'Nothing', 3]]).re).toBe(2);
  });

  test('Missing propagates', () => {
    expect(ev(['Mean', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ev(['Median', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ev(['Variance', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ce.box(['Mean', ['List', 1, 'Missing', 3]]).N().symbol).toBe(
      'Missing'
    );
  });

  test('NaN propagates', () => {
    expect(ev(['Mean', ['List', 1, 'NaN', 3]]).isNaN).toBe(true);
    expect(ce.box(['Mean', ['List', 1, 'NaN', 3]]).N().isNaN).toBe(true);
  });
});

describe('Max/Min: Nothing skips, Missing and NaN propagate', () => {
  // Same rule as the statistics. Both call shapes must work: the variadic
  // scalars (gated at canonicalization, since `missing` is not a subtype of
  // the `(value*)` signature) and a collection operand (gated at evaluate, by
  // `missingDatum` inside `evaluateMinMax`).
  test('Nothing is skipped (variadic scalars)', () => {
    expect(ev(['Max', 1, 'Nothing', 3]).re).toBe(3);
    expect(ev(['Min', 1, 'Nothing', 3]).re).toBe(1);
  });

  test('Nothing is skipped (collection operand)', () => {
    expect(ev(['Max', ['List', 1, 'Nothing', 3]]).re).toBe(3);
    expect(ev(['Min', ['List', 1, 'Nothing', 3]]).re).toBe(1);
  });

  test('Missing propagates (variadic scalars)', () => {
    for (const op of ['Max', 'Min', 'Supremum', 'Infimum']) {
      expect(ce.box([op, 1, 'Missing', 3]).symbol).toBe('Missing');
      expect(ev([op, 1, 'Missing', 3]).symbol).toBe('Missing');
      expect(ce.box([op, 1, 'Missing', 3]).N().symbol).toBe('Missing');
    }
    // …whatever route built the expression.
    expect(
      ce.function('Max', [ce.box(1), ce.Missing, ce.box(3)]).symbol
    ).toBe('Missing');
    expect(
      ce._fn('Min', [ce.box(1), ce.Missing, ce.box(3)]).evaluate().symbol
    ).toBe('Missing');
  });

  test('Missing propagates (collection operand)', () => {
    for (const op of ['Max', 'Min', 'Supremum', 'Infimum']) {
      expect(ev([op, ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
      expect(ce.box([op, ['List', 1, 'Missing', 3]]).N().symbol).toBe(
        'Missing'
      );
    }
  });

  test('NaN propagates (unchanged)', () => {
    expect(ev(['Max', 1, 'NaN', 3]).isNaN).toBe(true);
    expect(ev(['Min', 1, 'NaN', 3]).isNaN).toBe(true);
    expect(ev(['Max', ['List', 1, 'NaN', 3]]).isNaN).toBe(true);
    expect(ev(['Min', ['List', 1, 'NaN', 3]]).isNaN).toBe(true);
  });

  test('a Missing-free Max/Min is unchanged', () => {
    expect(ev(['Max', 1, 2, 3]).re).toBe(3);
    expect(ev(['Min', ['List', 4, 2, 9]]).re).toBe(2);
    expect(ev(['Max', 'x', 3]).operator).toBe('Max');
  });

  test('the element-wise siblings already propagate Missing', () => {
    // `ElementMax`/`ElementMin`/`Clamp` have `number`-typed signatures, so the
    // generic numeric gate already covers them. Pinned as a regression guard.
    expect(ce.box(['ElementMax', 1, 'Missing']).symbol).toBe('Missing');
    expect(ce.box(['ElementMin', 1, 'Missing']).symbol).toBe('Missing');
    expect(ce.box(['Clamp', 'Missing', 0, 1]).symbol).toBe('Missing');
  });
});
