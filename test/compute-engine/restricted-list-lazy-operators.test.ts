import { ComputeEngine } from '../../src/compute-engine';

// A restricted collection, `[1,3,5]{0<t}`, is ONE held restriction over the list
// (user decision 2026-09-25). A collection operator threads it whole: the
// result is computed on the present list and restricted by the condition, so
// it is absent as a whole (`Missing`, also for a number: an operator over
// `Missing` gives `Missing`, `docs/ERROR-MODEL.md`, "`Missing` is a result
// only") once the condition fails. Before, the lazy operators with a source slot (`TakeWhile`,
// `DropWhile`, `Scan`, `ArgMax`, `ArgMin`, `Differences`) refused the held
// restriction before the condition was threaded (step 2c'' of the evaluation,
// `heldEagerSources()` in `boxed-expression/boxed-function.ts`), and the
// operators with no `threadsConditionals` flag read the held restriction cell by
// cell: `DeleteAt` was refused at boxing, `IndexWhere` stayed unevaluated,
// `CountIf` threw, `RotateLeft` gave a `Set`, `StartsWith` gave `False`,
// `ListFrom` gave a list of restricted cells.

const LIST = ['List', 1, 3, 5];
const RL = ['If', ['Less', 0, 't'], LIST];
const RL_TEX = '[1,3,5]\\{0<t\\}';
const lt4 = ['Function', ['Less', 'x', 4], 'x'];
const gt2 = ['Function', ['Greater', 'x', 2], 'x'];

/** [name, MathJSON with `L` for the list, LaTeX with `L` for the list,
 * value with `t` free, value with `t = 1`, value with `t = -1`] */
const CASES: [string, unknown, string, string, string, string][] = [
  [
    'TakeWhile',
    ['TakeWhile', 'L', lt4],
    '\\operatorname{TakeWhile}(L, x\\mapsto x<4)',
    'If(0 < t, TakeWhile([1,3,5], (x) => x < 4))',
    '[1,3]',
    '"Missing"',
  ],
  [
    'DropWhile',
    ['DropWhile', 'L', lt4],
    '\\operatorname{DropWhile}(L, x\\mapsto x<4)',
    'If(0 < t, DropWhile([1,3,5], (x) => x < 4))',
    '[5]',
    '"Missing"',
  ],
  [
    'Scan',
    ['Scan', 'L', 'Add'],
    '\\operatorname{Scan}(L, \\operatorname{Add})',
    'If(0 < t, Scan([1,3,5], "Add"))',
    '[1,4,9]',
    '"Missing"',
  ],
  [
    'ArgMax',
    ['ArgMax', 'L'],
    '\\operatorname{ArgMax}(L)',
    'If(0 < t, 3, "Missing")',
    '3',
    '"Missing"',
  ],
  [
    'ArgMin',
    ['ArgMin', 'L'],
    '\\operatorname{ArgMin}(L)',
    'If(0 < t, 1, "Missing")',
    '1',
    '"Missing"',
  ],
  [
    'Differences',
    ['Differences', 'L'],
    '\\operatorname{Differences}(L)',
    'If(0 < t, Differences([1,3,5]))',
    '[2,2]',
    '"Missing"',
  ],
  [
    'DeleteAt',
    ['DeleteAt', 'L', 1],
    '\\operatorname{DeleteAt}(L, 1)',
    'If(0 < t, [3,5])',
    '[3,5]',
    '"Missing"',
  ],
  [
    'IndexWhere',
    ['IndexWhere', 'L', gt2],
    '\\operatorname{IndexWhere}(L, x\\mapsto x>2)',
    'If(0 < t, 2, "Missing")',
    '2',
    '"Missing"',
  ],
  [
    'CountIf',
    ['CountIf', 'L', gt2],
    '\\operatorname{CountIf}(L, x\\mapsto x>2)',
    'If(0 < t, 2, "Missing")',
    '2',
    '"Missing"',
  ],
  [
    'RotateLeft',
    ['RotateLeft', 'L', 1],
    '\\operatorname{RotateLeft}(L, 1)',
    'If(0 < t, RotateLeft([1,3,5], 1))',
    '[3,5,1]',
    '"Missing"',
  ],
  [
    'RotateRight',
    ['RotateRight', 'L', 1],
    '\\operatorname{RotateRight}(L, 1)',
    'If(0 < t, RotateRight([1,3,5], 1))',
    '[5,1,3]',
    '"Missing"',
  ],
  [
    'RangeOf',
    ['RangeOf', 'L', ['List', 3]],
    '\\operatorname{RangeOf}(L, [3])',
    'If(0 < t, Range(2, 2))',
    '[2]',
    '"Missing"',
  ],
  [
    'ContainsSequence',
    ['ContainsSequence', 'L', ['List', 3, 5]],
    '\\operatorname{ContainsSequence}(L, [3,5])',
    'If(0 < t, "True")',
    '"True"',
    '"False"',
  ],
  [
    'StartsWith',
    ['StartsWith', 'L', ['List', 1]],
    '\\operatorname{StartsWith}(L, [1])',
    'If(0 < t, "True")',
    '"True"',
    '"False"',
  ],
  [
    'EndsWith',
    ['EndsWith', 'L', ['List', 5]],
    '\\operatorname{EndsWith}(L, [5])',
    'If(0 < t, "True")',
    '"True"',
    '"False"',
  ],
  [
    'ListFrom',
    ['ListFrom', 'L'],
    '\\operatorname{ListFrom}(L)',
    'If(0 < t, [1,3,5])',
    '[1,3,5]',
    '"Missing"',
  ],
  [
    'SetFrom',
    ['SetFrom', 'L'],
    '\\operatorname{SetFrom}(L)',
    'If(0 < t, Set(1, 3, 5))',
    'Set(1, 3, 5)',
    '"Missing"',
  ],
  [
    'TupleFrom',
    ['TupleFrom', 'L'],
    '\\operatorname{TupleFrom}(L)',
    // A tuple of numbers is a point, and a false restriction of a point is
    // the point of `NaN` coordinates; the list here is absent as a whole,
    // so the held form keeps `Missing` as its else branch.
    'If(0 < t, (1, 3, 5), "Missing")',
    '(1, 3, 5)',
    '"Missing"',
  ],
  [
    'Partition',
    ['Partition', 'L', 2],
    '\\operatorname{Partition}(L, 2)',
    'If(0 < t, [[1,3],[5]])',
    '[[1,3],[5]]',
    '"Missing"',
  ],
];

function withList(json: unknown, list: unknown): unknown {
  if (json === 'L') return list;
  if (Array.isArray(json)) return json.map((x) => withList(x, list));
  return json;
}

function engine(t?: number): ComputeEngine {
  const ce = new ComputeEngine();
  if (t !== undefined) ce.assign('t', t);
  return ce;
}

describe('a collection operator over a restricted list', () => {
  describe.each([
    [
      'box',
      (ce: ComputeEngine, json: unknown, _tex: string) =>
        ce.box(withList(json, RL) as never),
    ],
    [
      'parse',
      (ce: ComputeEngine, _json: unknown, tex: string) =>
        ce.parse(tex.replace('(L', '(' + RL_TEX)),
    ],
  ])('the %s route', (_route, make) => {
    test.each(CASES)(
      '%s threads the condition',
      (_op, json, tex, free, tPositive, tNegative) => {
        const free_ = make(engine(), json, tex);
        expect(free_.isValid).toBe(true);
        expect(free_.evaluate().toString()).toBe(free);

        expect(make(engine(1), json, tex).evaluate().toString()).toBe(
          tPositive
        );
        expect(make(engine(-1), json, tex).evaluate().toString()).toBe(
          tNegative
        );
      }
    );

    test.each(CASES)(
      '%s: the held result agrees with a fresh evaluation',
      (_op, json, tex, _free, tPositive, tNegative) => {
        const ce = engine();
        const e = make(ce, json, tex);
        const held = e.evaluate();
        ce.assign('t', 1);
        expect(held.evaluate().toString()).toBe(tPositive);
        ce.assign('t', -1);
        expect(held.evaluate().toString()).toBe(tNegative);
        expect(e.evaluate().toString()).toBe(tNegative);
        expect(e.N().toString()).toBe(tNegative);
      }
    );
  });

  test('the result is the operation on the list, without a condition', () => {
    // The value once the condition holds is the value over the plain list.
    for (const [, json, , , tPositive] of CASES)
      expect(
        engine()
          .box(withList(json, LIST) as never)
          .evaluate()
          .toString()
      ).toBe(tPositive);
  });

  test('the held result of a lazy operator is a collection of the present elements', () => {
    const r = engine()
      .box(['TakeWhile', RL, lt4] as never)
      .evaluate();
    expect(r.operator).toBe('If');
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(2);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      'If(0 < t, 1)',
      'If(0 < t, 3)',
    ]);
    expect(r.evaluate({ materialization: true }).toString()).toBe(
      'If(0 < t, [1,3])'
    );
  });

  test('a Which over lists distributes', () => {
    const W = ['Which', ['Less', 0, 't'], LIST, 'True', ['List', 9, 2]];
    expect(
      engine()
        .box(['ArgMax', W] as never)
        .evaluate()
        .toString()
    ).toBe('Which(0 < t, 3, "True", 1)');
    expect(
      engine()
        .box(['DeleteAt', W, 1] as never)
        .evaluate()
        .toString()
    ).toBe('Which(0 < t, [3,5], "True", [2])');
    expect(
      engine(-1)
        .box(['Scan', W, 'Add'] as never)
        .evaluate()
        .toString()
    ).toBe('[9,11]');
  });
});

describe('Partition over an absent collection', () => {
  // A collection operator answers `Missing` for an absent collection (user
  // decision 2026-09-25). `Partition` declared no `missingBehavior`, and its
  // `integer | function` parameter kept the default policy from reading it as
  // a collection operator: the absent operand was an `incompatible-type`
  // error.
  test.each([
    ['size', ['Partition', 'Missing', 2]],
    ['predicate', ['Partition', 'Missing', gt2]],
  ])('the %s form answers Missing', (_form, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('missing');
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    expect(
      engine()
        .parse('\\operatorname{Partition}(\\operatorname{Missing}, 2)')
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });
});
