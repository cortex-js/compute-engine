import { ComputeEngine } from '../../src/compute-engine';

// A collection operator over an ABSENT collection answers the marker of its
// codomain, `Missing` for a collection result and `NaN` for a number (user
// decision 2026-09-25): the default absence policy of an operator with no
// declared `missingBehavior` now covers a signature whose parameters are
// collections (and functions) as well as one whose parameters are numbers
// (`signatureParamsPropagateAbsence`, `boxed-operator-definition.ts`). Before,
// `Reverse(Missing)` and `Filter(Missing, p)` were `incompatible-type` errors
// and `Map(f, Missing)` stayed a raw, unevaluated node. A restricted
// collection, `[1,2]{c}`, is one held `When` and is threaded whole by these
// operators, so the held result and a fresh evaluation agree once the
// condition is decided.

const engine = () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('t', 'real');
  return ce;
};

const f = ['Function', ['Multiply', 2, '_'], '_'];
const p = ['Function', ['Greater', '_', 1], '_'];
const plus = ['Function', ['Add', '_1', '_2'], '_1', '_2'];

describe('a collection operator over an absent collection', () => {
  test.each([
    ['Reverse', ['Reverse', 'Missing']],
    ['Sort', ['Sort', 'Missing']],
    ['Take', ['Take', 'Missing', 1]],
    ['Unique', ['Unique', 'Missing']],
    ['Zip', ['Zip', ['List', 1], 'Missing']],
    ['Map', ['Map', f, 'Missing']],
    ['Filter', ['Filter', 'Missing', p]],
  ])('%s answers Missing', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test.each([
    ['Any', ['Any', 'Missing', p]],
    ['All', ['All', 'Missing', p]],
    ['IsEmpty', ['IsEmpty', 'Missing']],
    ['Contains', ['Contains', 'Missing', 1]],
    ['GroupBy', ['GroupBy', 'Missing', f]],
    ['Chunk', ['Chunk', 'Missing', 2]],
    ['RandomShuffle', ['RandomShuffle', 'Missing']],
  ])('%s answers Missing too (a boolean result is Kleene)', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test.each([
    ['Length', ['Length', 'Missing']],
    ['Count', ['Count', 'Missing']],
    ['Reduce', ['Reduce', 'Missing', plus, 0]],
  ])('%s answers NaN, the marker of a number', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('NaN');
  });

  test('an absent operand beside a list still lands in each cell of a broadcast', () => {
    // The stand-aside of the absence gate beside a collection is for
    // broadcastable operators only; `Zip` above is not one.
    expect(
      engine()
        .box(['Add', 'Missing', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN]');
  });
});

describe('a collection operator over a restricted collection', () => {
  /** The value with `t` free and, once `t = -1`, the held value re-evaluated
   * and the expression evaluated fresh. */
  function probe(json: unknown) {
    const ce = engine();
    const e = ce.box(json as never);
    const held = e.evaluate();
    const free = held.toString();
    ce.assign('t', -1);
    return {
      free,
      twoStep: held.evaluate().toString(),
      fresh: e.evaluate().toString(),
    };
  }
  const RL = ['When', ['List', 1, 2], ['Less', 0, 't']];

  test.each([
    ['Reverse', ['Reverse', RL], 'Reverse([1,2]) {0 < t}'],
    [
      'Sort',
      ['Sort', ['When', ['List', 2, 1], ['Less', 0, 't']]],
      '[1,2] {0 < t}',
    ],
    ['Take', ['Take', RL, 1], 'Take([1,2], 1) {0 < t}'],
    ['Join', ['Join', RL, ['List', 3]], '[1,2,3] {0 < t}'],
    ['Zip', ['Zip', RL, ['List', 3, 4]], 'Zip([1,2], [3,4]) {0 < t}'],
    ['Map', ['Map', f, RL], 'Map((_) => 2 * _, [1,2]) {0 < t}'],
    ['Filter', ['Filter', RL, p], 'Filter([1,2], (_) => 1 < _) {0 < t}'],
    // `Any` and `Chunk` are not lazy: their results are computed.
    ['Any', ['Any', RL, p], '"True" {0 < t}'],
    ['Chunk', ['Chunk', RL, 1], '[[1,2]] {0 < t}'],
  ])('%s is threaded whole and both routes agree', (_op, json, free) => {
    const r = probe(json);
    // The held result wraps the operator's lazy view of the present list.
    expect(r.free).toBe(free);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test('the held result is a collection of the present elements', () => {
    const ce = engine();
    const r = ce.box(['Reverse', RL]).evaluate();
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(2);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      '2 {0 < t}',
      '1 {0 < t}',
    ]);
  });

  test('a literal list with one restricted cell stays per cell', () => {
    expect(
      engine()
        .box(['Reverse', ['List', ['When', 1, 'c'], 2]])
        .evaluate()
        .toString()
    ).toBe('[2,1 {c}]');
  });

  test('Map over a restricted list is no longer a set', () => {
    const ce = engine();
    const r = ce.box(['Map', f, RL]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.isCollection).toBe(true);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      '2 {0 < t}',
      '4 {0 < t}',
    ]);
  });
});
