import { ComputeEngine } from '../../src/compute-engine';

// 1. The asynchronous evaluation threads a conditional value (`When`/`Which`)
//    out of an application, as the synchronous evaluation does (step 4c of
//    `_computeValue` in `boxed-expression/boxed-function.ts`, and its twin
//    after step 3b of the asynchronous route). Before, `evaluateAsync()` had
//    no such step: `sin(3{0<t})` stayed `sin(3 {0 < t})`, and a collection
//    operator over a restricted list stayed unevaluated, gave an
//    `incompatible-type` error, or threw.
//
// 2. A big operator (`Sum`, `Product`) that reads again a term made by a run
//    of a block does not declare the operator of the term in its own scope.
//    Before, `h(1)` (with `h` assigned later in the block) declared `h` in
//    the scope of the `Sum`, and the assignment of the next evaluation wrote
//    that binding: the second evaluation gave `12`, not `10 + h(1)`.
//
// 3. A juxtaposition with an operand typed `number | nothing` (`Numerator`,
//    `Denominator`) is a product, not a `Tuple`.

const RL = ['When', ['List', 1, 3, 5], ['Less', 0, 't']];
const RL_TEX = '[1,3,5]\\{0<t\\}';
const lt4 = ['Function', ['Less', 'x', 4], 'x'];
const gt2 = ['Function', ['Greater', 'x', 2], 'x'];

function engine(t?: number): ComputeEngine {
  const ce = new ComputeEngine();
  if (t !== undefined) ce.assign('t', t);
  return ce;
}

function withList(json: unknown, list: unknown): unknown {
  if (json === 'L') return list;
  if (Array.isArray(json)) return json.map((x) => withList(x, list));
  return json;
}

/** [name, MathJSON with `L` for the restricted list, LaTeX with `L`, value
 * with `t` free, value with `t = 1`, value with `t = -1`] */
const LIST_CASES: [string, unknown, string, string, string, string][] = [
  [
    'TakeWhile',
    ['TakeWhile', 'L', lt4],
    '\\operatorname{TakeWhile}(L, x\\mapsto x<4)',
    'TakeWhile([1,3,5], (x) => x < 4) {0 < t}',
    '[1,3]',
    '"Missing"',
  ],
  [
    'Scan',
    ['Scan', 'L', 'Add'],
    '\\operatorname{Scan}(L, \\operatorname{Add})',
    'Scan([1,3,5], "Add") {0 < t}',
    '[1,4,9]',
    '"Missing"',
  ],
  [
    'ArgMax',
    ['ArgMax', 'L'],
    '\\operatorname{ArgMax}(L)',
    '3 {0 < t}',
    '3',
    'NaN',
  ],
  [
    'DeleteAt',
    ['DeleteAt', 'L', 1],
    '\\operatorname{DeleteAt}(L, 1)',
    '[3,5] {0 < t}',
    '[3,5]',
    '"Missing"',
  ],
  [
    'IndexWhere',
    ['IndexWhere', 'L', gt2],
    '\\operatorname{IndexWhere}(L, x\\mapsto x>2)',
    '2 {0 < t}',
    '2',
    'NaN',
  ],
  [
    'CountIf',
    ['CountIf', 'L', gt2],
    '\\operatorname{CountIf}(L, x\\mapsto x>2)',
    '2 {0 < t}',
    '2',
    'NaN',
  ],
  [
    'RotateLeft',
    ['RotateLeft', 'L', 1],
    '\\operatorname{RotateLeft}(L, 1)',
    'RotateLeft([1,3,5], 1) {0 < t}',
    '[3,5,1]',
    '"Missing"',
  ],
  [
    'RangeOf',
    ['RangeOf', 'L', ['List', 3]],
    '\\operatorname{RangeOf}(L, [3])',
    'Range(2, 2) {0 < t}',
    '[2]',
    '"Missing"',
  ],
  [
    'StartsWith',
    ['StartsWith', 'L', ['List', 1]],
    '\\operatorname{StartsWith}(L, [1])',
    '"True" {0 < t}',
    '"True"',
    '"Missing"',
  ],
  [
    'ListFrom',
    ['ListFrom', 'L'],
    '\\operatorname{ListFrom}(L)',
    '[1,3,5] {0 < t}',
    '[1,3,5]',
    '"Missing"',
  ],
  [
    'Partition',
    ['Partition', 'L', 2],
    '\\operatorname{Partition}(L, 2)',
    '[[1,3],[5]] {0 < t}',
    '[[1,3],[5]]',
    '"Missing"',
  ],
];

describe('evaluateAsync threads a conditional value', () => {
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
  ])('a collection operator over a restricted list, %s route', (_r, make) => {
    test.each(LIST_CASES)(
      '%s',
      async (_op, json, tex, free, tPositive, tNegative) => {
        for (const [t, expected] of [
          [undefined, free],
          [1, tPositive],
          [-1, tNegative],
        ] as const) {
          const sync = make(engine(t), json, tex).evaluate().toString();
          const async_ = (
            await make(engine(t), json, tex).evaluateAsync()
          ).toString();
          expect([t, sync]).toEqual([t, expected]);
          expect([t, async_]).toEqual([t, expected]);
        }
      }
    );

    test.each(LIST_CASES)(
      '%s: the held result agrees with a fresh evaluation',
      async (_op, json, tex, _free, tPositive, tNegative) => {
        const ce = engine();
        const e = make(ce, json, tex);
        const held = await e.evaluateAsync();
        ce.assign('t', 1);
        expect((await held.evaluateAsync()).toString()).toBe(tPositive);
        ce.assign('t', -1);
        expect((await held.evaluateAsync()).toString()).toBe(tNegative);
        expect((await e.evaluateAsync()).toString()).toBe(tNegative);
        expect(
          (await e.evaluateAsync({ numericApproximation: true })).toString()
        ).toBe(tNegative);
      }
    );
  });

  test('a Which over lists distributes', async () => {
    const W = [
      'Which',
      ['Less', 0, 't'],
      ['List', 1, 3, 5],
      'True',
      ['List', 9, 2],
    ];
    for (const [json, t, expected] of [
      [['ArgMax', W], undefined, 'Which(0 < t, 3, "True", 1)'],
      [['DeleteAt', W, 1], undefined, 'Which(0 < t, [3,5], "True", [2])'],
      [['Scan', W, 'Add'], -1, '[9,11]'],
      [['ArgMax', W], 1, '3'],
    ] as const) {
      const box = () => engine(t).box(json as never);
      expect(box().evaluate().toString()).toBe(expected);
      expect((await box().evaluateAsync()).toString()).toBe(expected);
    }
  });

  // Scalar threading: the same value on both routes, box and parse.
  const SCALAR: [string, unknown, string][] = [
    ['sin(3{0<t})', ['Sin', ['When', 3, ['Less', 0, 't']]], 'sin(3) {0 < t}'],
    ['3{0<t} + 1', ['Add', ['When', 3, ['Less', 0, 't']], 1], '4 {0 < t}'],
    ['0·x{0<t}', ['Multiply', 0, ['When', 'x', ['Less', 0, 't']]], '0 {0 < t}'],
    [
      'x{0<t} − x{0<t}',
      [
        'Subtract',
        ['When', 'x', ['Less', 0, 't']],
        ['When', 'x', ['Less', 0, 't']],
      ],
      '0 {0 < t}',
    ],
    [
      'Which + 5',
      ['Add', ['Which', ['Less', 0, 't'], 1, 'True', 2], 5],
      'Which(0 < t, 6, "True", 7)',
    ],
    [
      'sin(Which)',
      ['Sin', ['Which', ['Less', 0, 't'], 1, 'True', 2]],
      'Which(0 < t, sin(1), "True", sin(2))',
    ],
    [
      '[1,2,3] + 2{0<t}',
      ['Add', ['List', 1, 2, 3], ['When', 2, ['Less', 0, 't']]],
      '[3 {0 < t},4 {0 < t},5 {0 < t}]',
    ],
    [
      'Dot((1,2){0<t}, (3,4))',
      ['Dot', ['When', ['Tuple', 1, 2], ['Less', 0, 't']], ['Tuple', 3, 4]],
      '11 {0 < t}',
    ],
  ];

  test.each(SCALAR)('%s, box route', async (_name, json, expected) => {
    expect(
      engine()
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe(expected);
    expect(
      (
        await engine()
          .box(json as never)
          .evaluateAsync()
      ).toString()
    ).toBe(expected);
  });

  test.each([
    ['\\sin(3\\{0<t\\})', 'sin(3) {0 < t}'],
    ['3\\{0<t\\}+1', '4 {0 < t}'],
    ['[1,2,3]+2\\{0<t\\}', '[3 {0 < t},4 {0 < t},5 {0 < t}]'],
  ])('%s, parse route', async (tex, expected) => {
    expect(engine().parse(tex).evaluate().toString()).toBe(expected);
    expect((await engine().parse(tex).evaluateAsync()).toString()).toBe(
      expected
    );
  });

  test('the condition decides the value on both routes', async () => {
    for (const [t, expected] of [
      [1, '0.141120008059867222101'],
      [-1, 'NaN'],
    ] as const) {
      const json = ['Sin', ['When', 3.0, ['Less', 0, 't']]];
      expect(
        engine(t)
          .box(json as never)
          .N()
          .toString()
      ).toBe(expected);
      expect(
        (
          await engine(t)
            .box(json as never)
            .evaluateAsync({ numericApproximation: true })
        ).toString()
      ).toBe(expected);
    }
  });
});

describe('a big operator does not keep a function assigned by its term', () => {
  // An implicit local of a block starts with no value at each top-level
  // evaluation and at each function call, and keeps its value from one loop
  // iteration to the next (user decision 2026-10-18). Each index of a `Sum` or
  // a `Product` is an iteration, so the `h` assigned at `k = 2` is still set at
  // `k = 3` (`h(3) = 6`), and `Sum` gives `10 + h(1)`. `Table` applies a
  // function literal at each index, which is a call, so there `h` starts with
  // no value again and the result is `[h(1), 4, h(3)]` (test below).
  const H = ['Assign', 'h', ['Function', ['Multiply', 2, 'z'], 'z']];
  const body = ['Block', ['If', ['Equal', 'k', 2], H], ['h', 'k']];

  test.each([
    ['Sum', '10 + h(1)'],
    ['Product', '24h(1)'],
  ])('%s gives the same value on every evaluation', async (op, expected) => {
    const ce = new ComputeEngine();
    const e = ce.box([op, body, 'k', 1, 3] as never);
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.evaluate().toString()).toBe(expected);
    expect((await e.evaluateAsync()).toString()).toBe(expected);
    expect(e.evaluate().toString()).toBe(expected);
    // A new expression on the same engine gives the same value too.
    expect(
      ce
        .box([op, body, 'k', 1, 3] as never)
        .evaluate()
        .toString()
    ).toBe(expected);
    // The name is not declared outside the block.
    expect(ce.lookupDefinition('h')).toBeUndefined();
  });

  test('a term whose argument changes when it is read again', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Sum',
      ['Block', ['If', ['Equal', 'k', 2], H], ['h', ['Add', 'k', 'a']]],
      'k',
      1,
      3,
    ] as never);
    const first = e.evaluate().toString();
    expect(first).toBe('4a + h(a + 1) + 10');
    expect(e.evaluate().toString()).toBe(first);
    expect(ce.lookupDefinition('h')).toBeUndefined();
  });

  test('a Table of a block: each cell is a new call of the body', () => {
    // `Table` applies a function literal to each index, and a local that an
    // assignment makes in a block starts with no value in each new call
    // (as `Table(Block(If(k = 2, a ≔ 5); a), (k, 1, 3))` gives `[a,5,a]`).
    // Before, `h(1)` declared `h` in the global scope: the first evaluation
    // gave `[h(1),4,6]` and the second `[2,4,6]`.
    const ce = new ComputeEngine();
    const e = ce.box(['Table', body, ['Tuple', 'k', 1, 3]] as never);
    expect(e.evaluate().toString()).toBe('[h(1),4,h(3)]');
    expect(e.evaluate().toString()).toBe('[h(1),4,h(3)]');
    expect(ce.lookupDefinition('h')).toBeUndefined();
  });
});

describe('a juxtaposition with a number | nothing operand is a product', () => {
  const ce = new ComputeEngine();
  test.each([
    ['2\\operatorname{Numerator}(x)', '["Multiply",2,["Numerator","x"]]', '2x'],
    [
      '2\\operatorname{Denominator}(x)',
      '["Multiply",2,["Denominator","x"]]',
      '2',
    ],
    [
      'x\\operatorname{Numerator}(x)',
      '["Multiply","x",["Numerator","x"]]',
      'x^2',
    ],
    [
      '\\operatorname{Numerator}(x)\\operatorname{Denominator}(x)',
      '["Multiply",["Numerator","x"],["Denominator","x"]]',
      'x',
    ],
    [
      '2\\operatorname{NumeratorDenominator}(x)',
      '["Multiply",2,["NumeratorDenominator","x"]]',
      '(2x, 2)',
    ],
    // The same product as with the explicit operator, and as `Abs`.
    [
      '2\\times\\operatorname{Numerator}(x)',
      '["Multiply",2,["Numerator","x"]]',
      '2x',
    ],
    ['2\\operatorname{Abs}(x)', '["Multiply",2,["Abs","x"]]', '2 * |x|'],
  ])('%s', (tex, json, value) => {
    const e = ce.parse(tex);
    expect(JSON.stringify(e.json)).toBe(json);
    expect(e.evaluate().toString()).toBe(value);
  });

  test('a string | nothing operand is still a Tuple', () => {
    expect(ce.parse('2\\operatorname{Signature}(x)').operator).toBe('Tuple');
  });
});

describe('an If with no else branch round-trips through LaTeX', () => {
  // The serializer gave an empty string for an `If` with two operands, so
  // `Block(If(k = 2, a ≔ 5); a)` lost the statement.
  const engine = new ComputeEngine();
  test('alone and in a block', () => {
    const lone = engine.box(['If', ['Equal', 'k', 2], ['Assign', 'a', 5]], {
      form: 'raw',
    } as any);
    expect(lone.latex).toBe('\\mathrm{If}(k=2, a\\coloneq5)');
    expect(engine.parse(lone.latex, { form: 'raw' } as any).json).toEqual([
      'If',
      ['Equal', 'k', 2],
      ['Assign', 'a', 5],
    ]);
    const block = engine.box([
      'Block',
      ['If', ['Equal', 'k', 2], ['Assign', 'a', 5]],
      'a',
    ]);
    expect(engine.parse(block.latex).json).toEqual(block.json);
  });
});
