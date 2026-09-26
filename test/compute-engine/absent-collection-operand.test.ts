import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

describe('Insert, ReplaceAt and Append over an absent collection', () => {
  // They answer `Missing` on every route (user decision 2026-09-26). Before,
  // a boxed `Insert(Missing, 1, 2)` was an `incompatible-type` error, and
  // only a restricted collection whose condition failed gave `Missing`.
  const RL = ['When', ['List', 1, 2], ['Less', 0, 't']];
  test.each([
    ['Insert', ['Insert', 'Missing', 1, 2], 'list<integer> | missing'],
    ['ReplaceAt', ['ReplaceAt', 'Missing', 1, 2], 'list<integer> | missing'],
    ['Append', ['Append', 'Missing', 1], 'list | missing'],
    ['Append (Undefined)', ['Append', 'Undefined', 1], 'list | missing'],
  ])('%s answers Missing', (_op, json, type) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    const ce = engine();
    for (const src of [
      '\\operatorname{Insert}(\\operatorname{Missing}, 1, 2)',
      '\\operatorname{ReplaceAt}(\\operatorname{Missing}, 1, 2)',
      '\\operatorname{Append}(\\operatorname{Missing}, 1)',
    ])
      expect(ce.parse(src).evaluate().toString()).toBe('"Missing"');
  });

  test.each([
    ['Insert', ['Insert', RL, 1, 5], '[5,1,2] {0 < t}'],
    ['ReplaceAt', ['ReplaceAt', RL, 1, 5], '[5,2] {0 < t}'],
    ['Append', ['Append', RL, 5], '[1,2,5] {0 < t}'],
  ])('%s over a restricted collection', (_op, json, free) => {
    const ce = engine();
    const e = ce.box(json as never);
    expect(e.type.toString()).toBe('list<integer> | missing');
    const held = e.evaluate();
    expect(held.toString()).toBe(free);
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('an absent index or value is not an absent collection', () => {
    const ce = engine();
    // The stored value is kept as one element of the result.
    expect(
      ce
        .box(['Insert', ['List', 1, 2], 1, 'Missing'])
        .evaluate()
        .toString()
    ).toBe('["Missing",1,2]');
    // An absent index and an absent appended value are still refused.
    expect(ce.box(['Insert', ['List', 1], 'Missing', 2]).isValid).toBe(false);
    expect(ce.box(['Append', ['List', 1], 'Missing']).isValid).toBe(false);
  });
});

describe('a search for an absent value finds nothing', () => {
  // `Contains`, `IndexOf` and `Count` give their "not found" answer for an
  // absent searched value (user decision 2026-09-26). Before, the answer was
  // `Missing` for `Contains` and `NaN` for `IndexOf` and `Count`.
  test.each([
    [['Contains', ['List', 1, 2], 'Missing'], '"False"', 'boolean'],
    [['Contains', ['List', 1, 2], 'Undefined'], '"False"', 'boolean'],
    // A collection that holds an absent element: the absent value is not
    // found in it either.
    [['Contains', ['List', 1, 'Missing'], 'Missing'], '"False"', 'boolean'],
    [['IndexOf', ['List', 1, 2], 'Missing'], '0', 'integer'],
    [['IndexOf', ['List', 1, 'Missing'], 'Missing'], '0', 'integer'],
    [['Count', ['List', 1, 2], 'Missing'], '0', 'integer'],
    [['Count', ['List', 'Missing', 'Missing'], 'Missing'], '0', 'integer'],
  ])('%j', (json, expected, type) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe(expected);
  });

  test.each([
    // An absent element of the collection does not make the answer absent,
    // so it does not widen the type. Before, these were typed `number`
    // (`IndexOf`, `Count`) and `list<number>` (`Insert`, `ReplaceAt`).
    [['Contains', ['List', 1, 'Missing'], 2], 'boolean', '"False"'],
    [['IndexOf', ['List', 1, 'Missing'], 2], 'integer', '0'],
    [['Count', ['List', 1, 'Missing']], 'integer', '2'],
    [['Count', ['List', 1, 'Missing'], 2], 'integer', '0'],
    [
      ['Insert', ['List', 1, 'Missing'], 1, 2],
      'list<integer | missing>',
      '[2,1,"Missing"]',
    ],
    [
      ['ReplaceAt', ['List', 1, 'Missing'], 1, 2],
      'list<integer | missing>',
      '[2,"Missing"]',
    ],
    [
      ['Append', ['List', 1, 'Missing'], 2],
      'list<integer | missing>',
      '[1,"Missing",2]',
    ],
  ])('an absent element: %j', (json, type, expected) => {
    const e = engine().box(json as never);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe(expected);
  });

  test('the parse route', () => {
    expect(
      engine()
        .parse('\\operatorname{Contains}([1, 2], \\operatorname{Missing})')
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('an absent collection still makes the answer absent', () => {
    const ce = engine();
    expect(ce.box(['Contains', 'Missing', 2]).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['IndexOf', 'Missing', 2]).evaluate().toString()).toBe(
      'NaN'
    );
    expect(ce.box(['Count', 'Missing', 2]).evaluate().toString()).toBe('NaN');
  });

  test('compiled to JavaScript', () => {
    const ce = engine();
    const run = (json: unknown): unknown => {
      const r = compile(ce.box(json as never), { to: 'javascript' } as never);
      expect(r.success).toBe(true);
      return r.run!({} as never);
    };
    // `Missing` compiles to `undefined`, which the element test found in a
    // list that holds an absent element: the answer was 2.
    expect(run(['IndexOf', ['List', 1, 'Missing'], 'Missing'])).toBe(0);
    expect(run(['IndexOf', ['List', 1, 2], 'Missing'])).toBe(0);
    expect(run(['Contains', ['List', 1, 2], 'Missing'])).toBe(false);
  });
});

describe('Join and the set operators over an absent collection', () => {
  // A collection operator over an absent collection answers `Missing` (user
  // decision 2026-09-25). Before, `Join(Missing, [1])` was `[Missing, 1]`
  // (the absent operand was wrapped as one element), and `Union`,
  // `Intersection` and `SetMinus` refused an absent set with an
  // `incompatible-type` error, also when it was a restricted set whose
  // condition failed.
  const S = ['Set', 1, 2];
  const T = ['Set', 2, 3];
  const c = ['Less', 0, 't'];
  test.each([
    [['Join', 'Missing', ['List', 1]]],
    [['Join', ['List', 1], 'Missing']],
    [['Join', ['List', 1], 'Undefined']],
    [['Union', 'Missing', T]],
    [['Union', S, 'Missing']],
    [['Intersection', 'Missing', T]],
    [['SetMinus', 'Missing', 1]],
  ])('%j answers Missing', (json) => {
    const ce = engine();
    const e = ce.box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toMatch(/missing/);
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    expect(
      engine()
        .parse('\\operatorname{Join}(\\operatorname{Missing}, [1])')
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test.each([
    [['Join', ['When', ['List', 1], c], ['List', 2]], '[1,2] {0 < t}'],
    [['Union', ['When', S, c], T], 'Set(1, 2, 3) {0 < t}'],
    [['Intersection', ['When', S, c], T], 'Set(2) {0 < t}'],
    [['SetMinus', ['When', S, c], 1], 'Set(2) {0 < t}'],
  ])('%j over a restricted collection', (json, free) => {
    const ce = engine();
    const e = ce.box(json as never);
    const held = e.evaluate();
    expect(held.toString()).toBe(free);
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an absent element or value is not an absent collection', () => {
    const ce = engine();
    expect(
      ce
        .box(['Join', ['List', 1, 'Missing'], ['List', 2]])
        .evaluate()
        .toString()
    ).toBe('[1,"Missing",2]');
    expect(
      ce
        .box(['Union', ['Set', 1, 'Missing'], T])
        .evaluate()
        .toString()
    ).toBe('Set(1, "Missing", 2, 3)');
    // A removed value that is absent is still refused.
    expect(ce.box(['SetMinus', S, 'Missing']).isValid).toBe(false);
  });
});

describe('A set relation over an absent set', () => {
  // A set relation computes on the whole collection, so an absent set makes
  // the answer absent: the marker of a boolean codomain is `Missing`. Before,
  // `Subset(Missing, {2,3})` was `False` and `NotSubset(Missing, {2,3})` was
  // `True`, while `Contains(Missing, 2)` was already `Missing`.
  const relations = [
    'Subset',
    'SubsetEqual',
    'Superset',
    'SupersetEqual',
    'NotSubset',
    'NotSuperset',
    'NotSupersetEqual',
  ];
  test.each(relations)('%s over an absent set is Missing', (op) => {
    const ce = engine();
    for (const args of [
      ['Missing', ['Set', 2, 3]],
      [['Set', 2], 'Undefined'],
    ]) {
      const e = ce.box([op, ...args] as never);
      expect(e.type.toString()).toBe('boolean | missing');
      expect(e.evaluate().toString()).toBe('"Missing"');
    }
  });
  test.each(relations)('%s over present sets is unchanged', (op) => {
    const ce = engine();
    const e = ce.box([op, ['Set', 2], ['Set', 2, 3]] as never);
    expect(e.type.toString()).toBe('boolean');
    expect(['"True"', '"False"']).toContain(e.evaluate().toString());
  });
});
