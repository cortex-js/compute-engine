import { ComputeEngine } from '../../src/compute-engine';

// A DECLARED collection type pins the size even when there is no value to
// walk: `ce.declare('M', 'vector<2>')` promises 2 elements. The size facets
// (`count`, `isEmptyCollection`, `isFiniteCollection`) answer from the type,
// while the CAPABILITY facets (`isCollection`, `isEnumerableCollection`) stay
// false — nothing can be produced.
//
// The split is deliberate and pre-existing: `isCollection`'s contract promises
// that `each()` yields the collection's elements, and `isEnumerableCollection`
// is documented as independent of `count`, with `Linspace(a, 1, 3)` (a count of
// 3 and no computable elements) as the standing example. Flipping the
// capability bits instead would be actively wrong: `M.each()` yields nothing,
// so the ~14 call sites that gate on `isCollection` and immediately spread
// `[...x.each()]` would read an unresolved operand as an EMPTY collection.

describe('collection facets derived from a declared type', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a sized list type answers count', () => {
    ce.declare('M', 'vector<2>');
    const M = ce.box('M');
    expect(M.count).toBe(2);
    // The two walk-gate facets stay undecided — see "a size known from the
    // type does not license a WALK" below for why they must.
    expect(M.isEmptyCollection).toBe(undefined);
    expect(M.isFiniteCollection).toBe(undefined);
  });

  test('a matrix counts its ROWS, matching each() and at()', () => {
    // `count` is documented as the number of TOP-LEVEL elements: a
    // `matrix<3x4>` has 3 rows, not 12 scalar entries.
    ce.declare('X', 'matrix<3x4>');
    expect(ce.box('X').count).toBe(3);
  });

  test('a tuple counts its declared members', () => {
    ce.declare('T', 'tuple<number,string>');
    expect(ce.box('T').count).toBe(2);
  });

  test('an UNSIZED collection type stays undecided', () => {
    // `list<T>` and `set<T>` carry no length, so nothing is known — in
    // particular they must not read as empty.
    ce.declare('E', 'list<number>');
    ce.declare('S', 'set<number>');
    for (const name of ['E', 'S']) {
      const x = ce.box(name);
      expect(x.count).toBe(undefined);
      expect(x.isEmptyCollection).toBe(undefined);
      expect(x.isFiniteCollection).toBe(undefined);
    }
  });

  test('a NON-collection stays undecided, not false', () => {
    // A `number` is not an empty collection; it is not a collection at all.
    ce.declare('n', 'number');
    const n = ce.box('n');
    expect(n.count).toBe(undefined);
    expect(n.isEmptyCollection).toBe(undefined);
    expect(n.isFiniteCollection).toBe(undefined);
  });

  test('the CAPABILITY facets stay false — nothing can be walked', () => {
    ce.declare('M', 'vector<2>');
    const M = ce.box('M');
    expect(M.isCollection).toBe(false);
    expect(M.isEnumerableCollection).toBe(false);
    expect(M.each().next().done).toBe(true);
  });

  test('an assigned value answers, and cannot contradict the declaration', () => {
    ce.declare('M', 'vector<2>');
    ce.assign('M', ce.box(['List', 7, 8]));
    const M = ce.box('M');
    expect(M.isCollection).toBe(true);
    expect(M.count).toBe(2);
    expect(M.isEmptyCollection).toBe(false);
    // Asserting `count === 2` above proves nothing about precedence on its
    // own — the type says 2 as well. What licenses `count` to fall through to
    // the declared size WITHOUT ranking the two answers is that they can
    // never disagree: a value of the wrong size is refused at assignment.
    expect(() => ce.assign('M', ce.box(['List', 1, 2, 3]))).toThrow();
  });

  test('an UNSIZED declaration takes its size from the value', () => {
    // The one case where type and value differ in what they KNOW: the
    // declaration pins nothing, the value pins 3. This is the test that would
    // fail if the fallback were consulted BEFORE the value.
    ce.declare('K', 'list<number>');
    expect(ce.box('K').count).toBe(undefined);
    ce.assign('K', ce.box(['List', 1, 2, 3]));
    expect(ce.box('K').count).toBe(3);
  });

  test('a size known from the type does not license a WALK', () => {
    // The library gates on `isFiniteCollection === true` in ~20 places and
    // then indexes by `count` (`Sort` builds 0..count-1 and dereferences
    // `at(i)!`). A valueless symbol's `each()` yields nothing, so if a
    // declared size were allowed to decide that facet, those operators would
    // bake an empty walk into a definite answer — `Unique` returning `[]`,
    // `Quartiles` returning `(NaN, NaN, NaN)` — or crash on `at(i)`.
    ce.declare('M', 'vector<2>');
    expect(ce.box('M').isFiniteCollection).toBe(undefined);
    expect(ce.box('M').isEmptyCollection).toBe(undefined);
    for (const op of ['Sort', 'Unique', 'Tally', 'RandomShuffle']) {
      expect(() => ce.box([op, 'M']).evaluate()).not.toThrow();
      expect(ce.box([op, 'M']).evaluate().toString()).toBe(`${op}(M)`);
    }
  });

  test('an unsized dimension is not a count', () => {
    // `matrix` parses as `dimensions: [-1, -1]` and `list<number^?>` as
    // `[-1]` — the sentinel for "any length", never a length of -1. The
    // `dims[0] >= 0` guard is the only thing standing between that sentinel
    // and a negative count.
    ce.declare('anyMatrix', 'matrix');
    ce.declare('anyVector', 'vector');
    expect(ce.box('anyMatrix').count).toBe(undefined);
    expect(ce.box('anyVector').count).toBe(undefined);
  });

  test('a self-referential union type terminates', () => {
    // `resolveTypeForCompilation` guards its own reference chain, but that
    // guard is local to one call and never descends into a union's members.
    // Recursing into arms therefore has to carry its own guard, or an alias
    // whose recursive occurrence is a bare arm unfolds back to the same union
    // forever and overflows the stack.
    (ce as unknown as { declareType(n: string, t: string): void }).declareType(
      'selfu',
      'selfu | integer'
    );
    ce.declare('sv', 'selfu');
    expect(() => ce.box('sv').count).not.toThrow();
    expect(ce.box('sv').count).toBe(undefined);
  });

  test('a DIAMOND through one alias still answers', () => {
    // The cycle guard is depth-first (marks are removed on the way out), so
    // visiting the same declaration in two sibling arms is not mistaken for a
    // cycle.
    (ce as unknown as { declareType(n: string, t: string): void }).declareType(
      'pr',
      'tuple<number,number>'
    );
    ce.declare('dia', 'pr | pr');
    expect(ce.box('dia').count).toBe(2);
  });

  test('a genuinely empty collection is unchanged', () => {
    ce.assign('F', ce.box(['List']));
    const F = ce.box('F');
    expect(F.isCollection).toBe(true);
    expect(F.count).toBe(0);
    expect(F.isEmptyCollection).toBe(true);
  });

  test('a named type answers as its expansion does', () => {
    // An alias must not behave differently from the type it stands for: a
    // symbol declared `pair` has to report what one declared
    // `tuple<number, number>` reports, or the same declaration written two
    // ways gives two answers.
    (ce as unknown as { declareType(n: string, t: string): void }).declareType(
      'pair',
      'tuple<number,number>'
    );
    ce.declare('p', 'pair');
    ce.declare('q', 'tuple<number,number>');
    expect(ce.box('p').count).toBe(2);
    expect(ce.box('p').count).toBe(ce.box('q').count);
  });

  test('a union answers only when every arm agrees on the size', () => {
    // Every value of `vector<2> | tuple<number, number>` has two top-level
    // elements whichever arm it came from, so the size is known. One
    // disagreeing arm, or one unsized arm, makes it unknown again.
    ce.declare('u', 'vector<2> | tuple<number,number>');
    ce.declare('mixed', 'vector<2> | tuple<number,number,number>');
    ce.declare('half', 'vector<2> | list<number>');
    expect(ce.box('u').count).toBe(2);
    expect(ce.box('mixed').count).toBe(undefined);
    expect(ce.box('half').count).toBe(undefined);
  });

  test('an APPLICATION does not take the type shortcut (item 169)', () => {
    // An application's collection type can be an artifact of the vacuous lift
    // rather than a promise — `Total([1,2])` with `Total` undeclared types
    // `list<unknown^2>` yet walks nothing — and a bound head with a genuinely
    // sized return is not distinguishable from it here. `count` must not
    // outrun the walk, so both stay undecided.
    const total = ce.parse('\\operatorname{Total}\\left(\\left[1,2\\right]\\right)');
    expect(total.count).toBe(undefined);
    ce.declare('L', '(number) -> vector<2>');
    expect(ce.box(['L', 1]).count).toBe(undefined);
  });
});
