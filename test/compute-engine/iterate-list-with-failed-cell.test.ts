import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// A `List` or `Set` literal that holds a failed cell (an element that is, or
// holds, an `Error`) is a collection that can be iterated
// (`docs/ERROR-MODEL.md` §3). Its count is known, and a walk of its elements
// gives the failed cell as the value of that element. An operator that reads
// the cells gives the failed cell to its body or callback, and the ordinary
// error rules apply to what that body computes: an operation on the error
// gives the error, which a collection result keeps as a failed cell, and an
// aggregate that demands every cell answers the error. The tree is still
// invalid: `isValid` is `false` and `.errors` lists the error.
//
// Before, `isCollection` was `false` for any invalid tree, so a loop over
// such a list ran no turn, `Map` returned the list unchanged, a
// comprehension stayed unevaluated, and `Length` stayed inert.
//

const ce = new ComputeEngine();
ce.declare('h', {
  signature: '(number) -> number',
  evaluate: ([x]) => (x.is(2) ? ce.error('oops') : x),
});

/** `[1, 1/"a", 3]`: the second cell fails when it is boxed. */
const BOXED_FAILURE = ['List', 1, ['Divide', 1, { str: 'a' }], 3];
/** `[1, h(2), 3]`: the second cell fails when it is evaluated. */
const EVALUATED_FAILURE = ['List', 1, ['h', 2], 3];

const TYPE_ERROR =
  'Error(ErrorCode("incompatible-type", "number", "string"), "a")';
const OOPS = 'Error("oops")';

function box(json: unknown): Expression {
  return ce.box(json as never);
}

function evaluate(json: unknown): string {
  return box(json).evaluate().toString();
}

const INC = ['Function', ['Add', 'u', 1], 'u'];
const GREATER_THAN_ONE = ['Function', ['Greater', 'u', 1], 'u'];

describe('A LIST LITERAL WITH A FAILED CELL IS A COLLECTION', () => {
  test('the collection facets read the cells', () => {
    const xs = box(BOXED_FAILURE);
    expect(xs.isCollection).toBe(true);
    expect(xs.isFiniteCollection).toBe(true);
    expect(xs.isIndexedCollection).toBe(true);
    expect(xs.count).toBe(3);
    expect([...xs.each()].map((x) => x.toString())).toEqual([
      '1',
      `1 / ${TYPE_ERROR}`,
      '3',
    ]);
    expect(xs.at(3)?.toString()).toBe('3');
  });

  test('the list still carries its error', () => {
    const xs = box(BOXED_FAILURE);
    expect(xs.isValid).toBe(false);
    expect(xs.errors.map((x) => x.toString())).toEqual([TYPE_ERROR]);
    expect(xs.type.toString()).toBe('list<unknown>');
  });

  test('a set literal with a failed cell is a collection too', () => {
    const xs = box(['Set', 1, ['Divide', 1, { str: 'a' }], 3]);
    expect(xs.isValid).toBe(false);
    expect(xs.isCollection).toBe(true);
    expect(xs.count).toBe(3);
    expect(evaluate(['Length', xs.json])).toBe('3');
  });

  test('a tuple with a failed coordinate is not iterated', () => {
    // A tuple is one value (a point), not a sequence of elements.
    const t = box(['Tuple', 1, ['Divide', 1, { str: 'a' }], 3]);
    expect(t.isCollection).toBe(false);
    expect(box(['Length', t.json]).evaluate().operator).toBe('Length');
  });
});

describe('THE POSITIONAL OPERATORS KEEP THE FAILED CELL', () => {
  test.each([
    [['Length', BOXED_FAILURE], '3'],
    [['Count', BOXED_FAILURE], '3'],
    [['First', BOXED_FAILURE], '1'],
    [['Last', BOXED_FAILURE], '3'],
    [['At', BOXED_FAILURE, 3], '3'],
    [['At', BOXED_FAILURE, 2], TYPE_ERROR],
    [['Reverse', BOXED_FAILURE], `[3,${TYPE_ERROR},1]`],
    [['Take', BOXED_FAILURE, 2], `[1,${TYPE_ERROR}]`],
    [['Append', BOXED_FAILURE, 4], `[1,${TYPE_ERROR},3,4]`],
    [['Length', EVALUATED_FAILURE], '3'],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });
});

describe('A CALLBACK OR A BROADCAST RECEIVES THE FAILED CELL', () => {
  test.each([
    [['Map', INC, BOXED_FAILURE], `[2,${TYPE_ERROR},4]`],
    [['Map', INC, EVALUATED_FAILURE], `[2,${OOPS},4]`],
    [
      ['Comprehension', ['Add', 'x', 1], ['Element', 'x', BOXED_FAILURE]],
      `[2,${TYPE_ERROR},4]`,
    ],
    // The predicate answers the error for the failed cell: the error is kept
    // in place, as for any predicate that fails on an element.
    [['Filter', BOXED_FAILURE, GREATER_THAN_ONE], `[${TYPE_ERROR},3]`],
    [['Sin', BOXED_FAILURE], `[sin(1),${TYPE_ERROR},sin(3)]`],
    [['Add', BOXED_FAILURE, 1], `[2,${TYPE_ERROR},4]`],
    [['Add', BOXED_FAILURE, ['List', 1, 2, 3]], `[2,${TYPE_ERROR},6]`],
    [['Multiply', BOXED_FAILURE, 2], `[2,${TYPE_ERROR},6]`],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('a loop runs one turn for each cell', () => {
    const r = evaluate([
      'Block',
      ['Declare', 'n', 'integer'],
      ['Assign', 'n', 0],
      [
        'Loop',
        ['Assign', 'n', ['Add', 'n', 1]],
        ['Element', 'x', BOXED_FAILURE],
      ],
      'n',
    ]);
    expect(r).toBe('3');
  });

  test('a point accessor reads the coordinate of each point', () => {
    // The first cell fails at evaluation: it does not decide the reading,
    // and its coordinate is its error.
    const points = [
      'List',
      ['Add', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]],
      ['Tuple', 4, 5],
      ['Tuple', 6, 7],
    ];
    const r = box(['PointX', points]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops![0].operator).toBe('Error');
    expect(r.ops!.slice(1).map((x) => x.toString())).toEqual(['4', '6']);
  });
});

describe('AN OPERATOR THAT DEMANDS EVERY CELL ANSWERS THE ERROR', () => {
  test.each([
    [['Sum', BOXED_FAILURE]],
    [['Product', BOXED_FAILURE]],
    [['Max', BOXED_FAILURE]],
    [['Min', BOXED_FAILURE]],
    [['Mean', BOXED_FAILURE]],
    [['Median', BOXED_FAILURE]],
    [['Variance', BOXED_FAILURE]],
    [['Sort', BOXED_FAILURE]],
    [['Sort', ['List', 3, ['Divide', 1, { str: 'a' }], 1]]],
    [['ArgMax', BOXED_FAILURE]],
    [['MaxBy', BOXED_FAILURE, ['Function', ['Negate', 'u'], 'u']]],
    [['Count', BOXED_FAILURE, GREATER_THAN_ONE]],
    [['CountIf', BOXED_FAILURE, GREATER_THAN_ONE]],
    [['Reduce', BOXED_FAILURE, 'Add', 0]],
    [['Sum', 'x', ['Element', 'x', BOXED_FAILURE]]],
  ])('%j', (json) => {
    expect(evaluate(json)).toBe(TYPE_ERROR);
  });

  test('the error of a cell that fails at evaluation', () => {
    expect(evaluate(['Sum', EVALUATED_FAILURE])).toBe(OOPS);
    expect(evaluate(['Sort', EVALUATED_FAILURE])).toBe(OOPS);
  });

  test('a count with a predicate that fails on an element answers the error', () => {
    // The list is valid; the predicate fails on its second element. `Filter`
    // keeps that error in place, and `Count` used to count it as a selected
    // element (`3`).
    const p = ['Function', ['Greater', ['h', 'u'], 0], 'u'];
    expect(evaluate(['Count', ['List', 1, 2, 3], p])).toBe(OOPS);
    expect(evaluate(['CountIf', ['List', 1, 2, 3], p])).toBe(OOPS);
    expect(evaluate(['Count', ['List', 1, 2, 3], GREATER_THAN_ONE])).toBe('2');
  });
});

describe('A VARIABLE THAT HOLDS THE LIST', () => {
  const engine = new ComputeEngine();
  engine.assign('L', BOXED_FAILURE as never);

  test.each([
    [['Length', 'L'], '3'],
    [['Map', INC, 'L'], `[2,${TYPE_ERROR},4]`],
    [['Add', 'L', 1], `[2,${TYPE_ERROR},4]`],
    [['Add', 'L', ['List', 1, 2, 3]], `[2,${TYPE_ERROR},6]`],
    [['Sum', 'L'], TYPE_ERROR],
    [['Sort', 'L'], TYPE_ERROR],
  ])('%j', (json, expected) => {
    expect(
      engine
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });
});

describe('PARSE ROUTE', () => {
  const cell = '[1, \\frac{1}{\\text{a}}, 3]';
  test.each([
    [`\\operatorname{Length}(${cell})`, '3'],
    [`\\operatorname{First}(${cell})`, '1'],
    [`${cell}_3`, '3'],
    [`${cell}_2`, TYPE_ERROR],
    [`\\max(${cell})`, TYPE_ERROR],
    [`\\operatorname{Sort}(${cell})`, TYPE_ERROR],
    [`\\sum_{x \\in ${cell}} x`, TYPE_ERROR],
    [`[x+1 \\operatorname{for} x=${cell}]`, `[2,${TYPE_ERROR},4]`],
  ])('%s', (latex, expected) => {
    expect(ce.parse(latex).evaluate().toString()).toBe(expected);
  });
});

describe('COMPILATION', () => {
  test('a list literal with a failed cell does not compile', () => {
    for (const json of [
      BOXED_FAILURE,
      ['Map', INC, BOXED_FAILURE],
      ['Sum', BOXED_FAILURE],
      ['Length', BOXED_FAILURE],
    ])
      expect(() => compile(box(json), { fallback: false })).toThrow(
        /invalid expression/
      );
  });
});

//
// A cell that is itself a list holding an error (`[[1, 1/"a"], 2]`) is a
// failed cell too. An operator that demands its value answers the error
// inside it, never the inner list.
//

/** `[[2, 1/"a"], [1]]`: the first cell is a list that holds an error. */
const NESTED_FAILURE = [
  'List',
  ['List', 2, ['Divide', 1, { str: 'a' }]],
  ['List', 1],
];
/** `[1, Error("oops"), 3]`: the second cell is a bare `Error`. */
const BARE_ERROR_CELL = ['List', 1, ['Error', "'oops'"], 3];
const TRUE_PREDICATE = ['Function', 'True', 'u'];

describe('A NESTED FAILED CELL GIVES ITS ERROR', () => {
  test.each([
    [['Mean', ['List', ['List', 1, ['Divide', 1, { str: 'a' }]], 2]]],
    [['Sort', NESTED_FAILURE]],
    [['ArgMax', NESTED_FAILURE]],
    [['Max', NESTED_FAILURE]],
  ])('%j', (json) => {
    expect(evaluate(json)).toBe(TYPE_ERROR);
  });
});

describe('SORT READS THE ELEMENTS OF A LAZY SOURCE', () => {
  test.each([
    [['Sort', ['Map', 'h', ['List', 2]]], OOPS],
    [['Sort', ['Map', 'h', ['List', 3, 2, 1]]], OOPS],
    [['Ordering', ['Map', 'h', ['List', 3, 2, 1]]], OOPS],
    [['Ordering', ['List', 3, ['Divide', 1, { str: 'a' }], 1]], TYPE_ERROR],
    [['Sort', ['Map', 'h', ['List', 3, 1]]], '[1,3]'],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });
});

describe('A LAZY OPERATOR READS A BOXED LIST WITH A BARE ERROR CELL', () => {
  // A lazy operator holds its operand as written. The list was not bound,
  // so it was not a collection, and `Sum` took its big-operator route:
  // `Sum([1, Error("oops"), 3])` was the list itself.
  test.each([
    [['Sum', BARE_ERROR_CELL], OOPS],
    [['Product', BARE_ERROR_CELL], OOPS],
    [['ArgMax', BARE_ERROR_CELL], OOPS],
    [['Max', BARE_ERROR_CELL], OOPS],
    [['Mean', BARE_ERROR_CELL], OOPS],
    [['Sort', BARE_ERROR_CELL], OOPS],
    [['Length', BARE_ERROR_CELL], '3'],
    [['Map', INC, BARE_ERROR_CELL], `[2,${OOPS},4]`],
    [['Filter', BARE_ERROR_CELL, GREATER_THAN_ONE], `[${OOPS},3]`],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('the held list is bound', () => {
    const sum = box(['Sum', BARE_ERROR_CELL]);
    expect(sum.op1.isCanonical).toBe(true);
    expect(sum.op1.isCollection).toBe(true);
  });

  const cell = '[1, \\frac{1}{\\text{a}}, 3]';
  test.each([
    [`\\operatorname{Sum}(${cell})`, TYPE_ERROR],
    [`\\operatorname{Product}(${cell})`, TYPE_ERROR],
    [`\\operatorname{ArgMax}(${cell})`, TYPE_ERROR],
    [`\\operatorname{Mean}(${cell})`, TYPE_ERROR],
    [`\\operatorname{Map}(x \\mapsto x+1, ${cell})`, `[2,${TYPE_ERROR},4]`],
    [`\\operatorname{Filter}(${cell}, x \\mapsto x > 1)`, `[${TYPE_ERROR},3]`],
  ])('parse route: %s', (latex, expected) => {
    expect(ce.parse(latex).evaluate().toString()).toBe(expected);
  });
});

describe('A CALLBACK RECEIVES A NESTED FAILED CELL', () => {
  test.each([
    // The inner list is a value: the body runs with it.
    [['Map', ['Function', 1, 'u'], NESTED_FAILURE], '[1,1]'],
    [['Count', NESTED_FAILURE, TRUE_PREDICATE], '2'],
    [['Filter', NESTED_FAILURE, TRUE_PREDICATE], `[[2,1 / ${TYPE_ERROR}],[1]]`],
    // A bare failed cell is the error of the application (the body does not
    // run for it).
    [['Map', ['Function', 1, 'u'], BOXED_FAILURE], `[1,${TYPE_ERROR},1]`],
    // A tuple with a failed coordinate freezes the application: the cell is
    // its error, not the absence marker `NaN`.
    [
      [
        'Map',
        ['Function', 1, 'u'],
        ['List', ['Tuple', 2, ['Divide', 1, { str: 'a' }]], ['List', 1]],
      ],
      `[${TYPE_ERROR},1]`,
    ],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('nothing throws to the host', () => {
    expect(() =>
      box(['Count', NESTED_FAILURE, TRUE_PREDICATE]).evaluate()
    ).not.toThrow();
  });
});

describe('MEMBERSHIP AND EQUALITY OVER A FAILED CELL', () => {
  // The answer is decided by the valid cells when they decide it; otherwise
  // it depends on the value of the failed cell, and it is that cell's error.
  const L = ['List', 1, ['Divide', 1, { str: 'a' }]];
  const L3 = ['List', 1, ['Divide', 1, { str: 'a' }], 3];
  const S = ['Set', 1, ['Divide', 1, { str: 'a' }]];
  test.each([
    [['Element', 1, L], '"True"'],
    [['Element', 2, L], TYPE_ERROR],
    [['Element', 1, S], '"True"'],
    [['Element', 2, S], TYPE_ERROR],
    [['NotElement', 1, L], '"False"'],
    [['NotElement', 2, L], TYPE_ERROR],
    [['Contains', L, 1], '"True"'],
    [['Contains', L, 2], TYPE_ERROR],
    [['Equal', L, L], TYPE_ERROR],
    [['NotEqual', L, L], TYPE_ERROR],
    [['Equal', L, ['List', 1, 2]], TYPE_ERROR],
    // A valid cell that differs decides, before or after the failed cell.
    [['Equal', L, ['List', 2, ['Divide', 1, { str: 'a' }]]], '"False"'],
    [['Equal', L3, ['List', 1, ['Divide', 1, { str: 'a' }], 4]], '"False"'],
    [['NotEqual', L, ['List', 2, ['Divide', 1, { str: 'a' }]]], '"True"'],
    // A different count decides.
    [['Equal', L, L3], '"False"'],
    [['Equal', S, S], TYPE_ERROR],
    [['IndexOf', L3, 1], '1'],
    [['IndexOf', L3, 3], TYPE_ERROR],
    [['IndexOf', L3, 7], TYPE_ERROR],
    [['Count', ['List', 1, ['Divide', 1, { str: 'a' }], 1], 1], TYPE_ERROR],
    [['Unique', ['List', 1, ['Divide', 1, { str: 'a' }], 1]], TYPE_ERROR],
    [['Tally', ['List', 1, ['Divide', 1, { str: 'a' }], 1]], TYPE_ERROR],
    [['Union', S, ['Set', 2]], TYPE_ERROR],
    [['Intersection', S, ['Set', 1]], TYPE_ERROR],
    [['SetMinus', S, ['Set', 1]], TYPE_ERROR],
    [['SymmetricDifference', S, ['Set', 1]], TYPE_ERROR],
    // A quantifier combines the answers in order, as `Or` and `And` do.
    [['Any', L, ['Function', ['Greater', 'u', 0], 'u']], '"True"'],
    [['All', L, ['Function', ['Greater', 'u', 5], 'u']], '"False"'],
    [['All', L, ['Function', ['Greater', 'u', 0], 'u']], TYPE_ERROR],
    // Whether an element of `Dedup` is a duplicate of the one before it
    // depends on the value of the failed cell. Before: `[1, <error>, 1]`.
    [['Dedup', ['List', 1, ['Divide', 1, { str: 'a' }], 1]], TYPE_ERROR],
    [
      ['Length', ['Dedup', ['List', 1, ['Divide', 1, { str: 'a' }], 1]]],
      TYPE_ERROR,
    ],
    // One element: no comparison reaches the failed cell.
    [['Dedup', ['List', ['Divide', 1, { str: 'a' }]]], `[${TYPE_ERROR}]`],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('isSame stays syntactic', () => {
    expect(box(L).isSame(box(L))).toBe(true);
  });

  const cell = '[1, \\frac{1}{\\text{a}}, 3]';
  test.each([
    [`1 \\in ${cell}`, '"True"'],
    [`2 \\in ${cell}`, TYPE_ERROR],
    [`${cell} = ${cell}`, TYPE_ERROR],
    [`${cell} = [2, 2, 3]`, '"False"'],
  ])('parse route: %s', (latex, expected) => {
    expect(ce.parse(latex).evaluate().toString()).toBe(expected);
  });
});

describe('COUNT WITH A PREDICATE COUNTS A SELECTED FAILED CELL', () => {
  test.each([
    // The predicate selects the failed cell: it is counted.
    [['Count', BOXED_FAILURE, 'IsError'], '1'],
    [['Count', NESTED_FAILURE, TRUE_PREDICATE], '2'],
    // A user function applied to a bare failed cell is that error (its body
    // does not run), so the verdict for that cell is the error.
    [['Count', BOXED_FAILURE, TRUE_PREDICATE], TYPE_ERROR],
    [['Count', BOXED_FAILURE, GREATER_THAN_ONE], TYPE_ERROR],
    // The limit is on an unbroken run of rejections, as for `Filter`.
    [
      ['Count', ['Range', 1, 2000], ['Function', ['Greater', 'u', 1000], 'u']],
      '1000',
    ],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });
});

describe('A BROADCAST OVER A NESTED LIST WITH A BARE ERROR CELL', () => {
  test.each([
    [
      ['Add', ['List', ['List', 1, ['Error', "'oops'"]], 2], 1],
      `[[2,${OOPS}],3]`,
    ],
    [
      ['Multiply', ['List', ['List', 1, ['Error', "'oops'"]], 2], 2],
      `[[2,${OOPS}],4]`,
    ],
    [
      ['Add', ['List', ['List', 1, ['Divide', 1, { str: 'a' }]], 2], 1],
      `[[2,${TYPE_ERROR}],3]`,
    ],
  ])('%j', (json, expected) => {
    const spy = jest.spyOn(console, 'assert');
    try {
      expect(evaluate(json)).toBe(expected);
      expect(spy.mock.calls.filter(([cond]) => !cond)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test('parse route', () => {
    expect(
      ce.parse('[[1, \\frac{1}{\\text{a}}], 2] + 1').evaluate().toString()
    ).toBe(`[[2,${TYPE_ERROR}],3]`);
  });
});

describe('A VALID LAZY SOURCE THAT COMPUTES A FAILED ELEMENT', () => {
  // With `h(2)` an error, `Map(h, [1, 2])` is a valid expression whose
  // second element is the error. A membership test that finds no match has
  // read that element, so the answer is its error. Before: `False`.
  const M = ['Map', 'h', ['List', 1, 2]];
  const M3 = ['Map', 'h', ['List', 1, 2, 3]];
  const INFINITE = ['Map', 'h', ['Range', 1, { num: '+Infinity' }]];
  test.each([
    [['Element', 5, M], OOPS],
    [['Element', 1, M], '"True"'],
    [['NotElement', 5, M], OOPS],
    [['NotElement', 1, M], '"False"'],
    [['Contains', M, 5], OOPS],
    [['Contains', M, 1], '"True"'],
    [['Element', 5, ['Take', M, 2]], OOPS],
    [['IndexOf', M3, 1], '1'],
    [['IndexOf', M3, 3], OOPS],
    [['Count', M3, 1], OOPS],
    [['Dedup', M3], OOPS],
    // A held list literal whose cell fails only when it is evaluated.
    [['Dedup', ['List', 1, ['h', 2], 1]], OOPS],
    [['Dedup', ['Map', 'h', ['List', 1, 1, 3]]], '[1,3]'],
    // A source that cannot hold a failed element is not walked.
    [['Element', 0.5, ['Range', 1, 1000000]], '"False"'],
    [['Element', 5, ['Range', 1, 10]], '"True"'],
    [['Dedup', ['Range', 1, 5]], '[1,2,3,4,5]'],
    // An infinite source: membership stays unevaluated, a search stops at
    // the failed element, and no walk goes past the iteration limit.
    [['Element', 0, INFINITE], 'Element(0, Map(h, Range(1, +oo)))'],
    [['Contains', INFINITE, 0], 'Contains(Map(h, Range(1, +oo)), 0)'],
    [['Count', INFINITE, 0], 'Count(Map(h, Range(1, +oo)), 0)'],
    [['IndexOf', INFINITE, 0], OOPS],
    [
      ['Take', ['Dedup', ['Map', 'h', ['Range', 3, { num: '+Infinity' }]]], 2],
      '[3,4]',
    ],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('a symbol that holds the list', () => {
    const engine = new ComputeEngine();
    engine.assign('L', ['List', 1, ['Divide', 1, { str: 'a' }], 1] as never);
    expect(
      engine
        .box(['Dedup', 'L'] as never)
        .evaluate()
        .toString()
    ).toBe(TYPE_ERROR);
  });

  test('the check does not apply the function again', () => {
    const engine = new ComputeEngine();
    let calls = 0;
    engine.declare('k', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    });
    for (const json of [
      ['Element', 9, ['Map', 'k', ['List', 1, 2, 3]]],
      ['Contains', ['Map', 'k', ['List', 1, 2, 3]], 9],
      ['Dedup', ['Map', 'k', ['List', 1, 2, 3]]],
    ]) {
      calls = 0;
      engine.box(json as never).evaluate();
      expect(calls).toBe(3);
    }
  });
});

describe('EQUALITY OVER A FAILED CELL READS NO MORE THAN IT NEEDS', () => {
  const BOOM = ['Error', "'boom'"];
  const BOOM_ERROR = 'Error("boom")';
  test.each([
    // The counts differ: no walk. Before, both collections were copied
    // (539 ms for three million elements; `Range(1, 10^12)` ran out of
    // memory).
    [['Equal', ['List', 1, BOOM], ['Range', 1, 3000000]], '"False"'],
    [['Equal', ['List', 1, BOOM], ['Range', 1, 1e12]], '"False"'],
    [['NotEqual', ['List', 1, BOOM], ['Range', 1, 1e12]], '"True"'],
    // Same count: the walk stops at the first pair that is different.
    [['Equal', ['List', 2, BOOM], ['Range', 1, 2]], '"False"'],
    [['Equal', ['List', 1, BOOM], ['Range', 1, 2]], BOOM_ERROR],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('a walk past maxCollectionSize stays undecided', () => {
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 2;
    const r = engine
      .box(['Equal', ['List', 1, 2, 3, BOOM], ['Range', 1, 4]] as never)
      .evaluate();
    expect(r.operator).toBe('Equal');
  });

  test.each([
    // A chain combines the verdicts of its pairs: an equal pair refutes
    // `NotEqual`, a different pair refutes `Equal`, wherever it is.
    [['NotEqual', ['List', 1], ['List', 1], ['List', 2, BOOM]], '"False"'],
    [['NotEqual', ['List', 1, BOOM], ['List', 2], ['List', 2]], '"False"'],
    [['NotEqual', ['List', 2], ['List', 2], ['List', 1, BOOM]], '"False"'],
    [['NotEqual', ['List', 1], ['List', 3], ['List', 2, BOOM]], '"True"'],
    [['NotEqual', ['List', 1, BOOM], ['List', 2, BOOM]], '"True"'],
    [['NotEqual', ['List', 1, BOOM], ['List', 1, BOOM]], BOOM_ERROR],
    [['Equal', ['List', 1, BOOM], ['List', 1, BOOM], ['List', 2]], '"False"'],
    [['Equal', ['List', 1], ['List', 2], ['List', 1, BOOM]], '"False"'],
    [
      ['Equal', ['List', 1, BOOM], ['List', 1, BOOM], ['List', 1, BOOM]],
      BOOM_ERROR,
    ],
  ])('chain %j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });
});

describe('A MEMBERSHIP SCAN THAT STOPS EARLY DECIDES NOTHING', () => {
  test('a list literal is read in full', () => {
    // Before: with `maxCollectionSize` 2 the scan stopped before the failed
    // cell, and the answer was `False`.
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 2;
    for (const json of [
      ['Contains', ['List', 1, 1, ['Error', "'boom'"]], 2],
      ['Element', 2, ['List', 1, 1, ['Error', "'boom'"]]],
    ])
      expect(
        engine
          .box(json as never)
          .evaluate()
          .toString()
      ).toBe('Error("boom")');
  });

  test('a bounded walk of a lazy view stays undecided', () => {
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 1;
    engine.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x]) => (x.is(2) ? engine.error('oops') : x),
    });
    const contains = engine
      .box(['Contains', ['Map', 'h', ['List', 1, 2, 3]], 9] as never)
      .evaluate();
    expect(contains.operator).toBe('Contains');
    const element = engine
      .box(['Element', 9, ['Map', 'h', ['List', 1, 2, 3]]] as never)
      .evaluate();
    expect(element.operator).toBe('Element');
  });
});

describe('DEDUP, UNIQUE AND TALLY COMPARE ONLY WHAT DIFFERS', () => {
  test.each([
    // One distinct element: nothing to compare. Before, `Unique` and
    // `Tally` gave the error.
    [['Unique', ['List', ['Divide', 1, { str: 'a' }]]], `[1 / ${TYPE_ERROR}]`],
    [
      ['Tally', ['List', ['Divide', 1, { str: 'a' }]]],
      `([1 / ${TYPE_ERROR}], [1])`,
    ],
    // Two cells that are the same expression have the same value.
    [
      [
        'Unique',
        ['List', ['Divide', 1, { str: 'a' }], ['Divide', 1, { str: 'a' }]],
      ],
      `[1 / ${TYPE_ERROR}]`,
    ],
    [
      [
        'Dedup',
        ['List', ['Divide', 1, { str: 'a' }], ['Divide', 1, { str: 'a' }]],
      ],
      `[${TYPE_ERROR}]`,
    ],
    // A failed cell next to another value: the error.
    [['Unique', ['List', 1, ['Divide', 1, { str: 'a' }]]], TYPE_ERROR],
    [['Dedup', ['List', 1, ['Divide', 1, { str: 'a' }]]], TYPE_ERROR],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('Dedup evaluates its source once', async () => {
    const engine = new ComputeEngine();
    let calls = 0;
    engine.declare('H', {
      signature: '(number) -> number',
      pure: false,
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    } as never);
    const json = ['Dedup', ['List', 1, ['H', 1], 2]] as never;
    // Before: 3 calls (2 before the failed-cell check was added).
    expect(engine.box(json).evaluate().toString()).toBe('[1,2]');
    expect(calls).toBe(1);
    calls = 0;
    expect((await engine.box(json).evaluateAsync()).toString()).toBe('[1,2]');
    expect(calls).toBe(1);
  });
});

describe('THE FINAL REVIEW OF THE FAILED-CELL RULES', () => {
  const BOOM = ['Error', "'boom'"];
  const BOOM_ERROR = 'Error("boom")';

  test('Dedup under N evaluates its source with the numeric request', () => {
    const engine = new ComputeEngine();
    // Before: `[1/2,sqrt(2)]` and `[1/2]` (the source was evaluated exactly).
    expect(
      engine
        .box(['Dedup', ['List', ['Rational', 1, 2], ['Sqrt', 2]]] as never)
        .N()
        .toString()
    ).toBe('[0.5,1.4142135623730950488]');
    expect(
      engine
        .box(['Dedup', ['List', ['Rational', 1, 2], 0.5]] as never)
        .N()
        .toString()
    ).toBe('[0.5]');
    engine.assign('L', ['List', ['Rational', 1, 2], ['Sqrt', 2]] as never);
    expect(
      engine
        .box(['Dedup', 'L'] as never)
        .N()
        .toString()
    ).toBe('[0.5,1.4142135623730950488]');
    expect(
      engine
        .box(['Dedup', 'L'] as never)
        .evaluate()
        .toString()
    ).toBe('[1/2,sqrt(2)]');
  });

  test('a used-up walk budget wins over an earlier error', () => {
    // Before, with `maxCollectionSize` 2, both were `Error("boom")`; with the
    // default size both are `False`.
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 2;
    for (const json of [
      [
        'Equal',
        ['List', BOOM, ['List', BOOM, 2]],
        ['List', BOOM, ['List', BOOM, 3]],
      ],
      ['Equal', ['List', BOOM, 5], ['List', BOOM, 5], ['List', BOOM, 6]],
    ])
      expect(engine.box(json as never).evaluate().operator).toBe('Equal');
    // A pair that differs within the budget still decides.
    expect(
      engine
        .box([
          'Equal',
          ['List', BOOM, 6],
          ['List', BOOM, 5],
          ['List', BOOM, 5],
        ] as never)
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      evaluate([
        'Equal',
        ['List', BOOM, ['List', BOOM, 2]],
        ['List', BOOM, ['List', BOOM, 3]],
      ])
    ).toBe('"False"');
  });

  test('an unresolved collection operand keeps the comparison inert', () => {
    // Before: `Error("boom")`. A later value of `X` with another count
    // makes the comparison `False`.
    const engine = new ComputeEngine();
    engine.declare('X', 'list<number>');
    expect(
      engine.box(['Equal', ['List', 1, BOOM], 'X'] as never).evaluate().operator
    ).toBe('Equal');
    expect(
      engine.box(['NotEqual', ['List', 1, BOOM], 'X'] as never).evaluate()
        .operator
    ).toBe('NotEqual');
  });

  test.each([
    // Before: the error. The kinds or the counts prove a difference.
    [
      ['Equal', ['List', 1, BOOM], ['Range', 1, { num: '+Infinity' }]],
      '"False"',
    ],
    [['Equal', ['Set', 1, BOOM], ['List', 1, 2]], '"False"'],
    [['NotEqual', ['Set', 1, BOOM], ['List', 1, 2]], '"True"'],
    [['Equal', ['List', 1, BOOM], ['Tuple', 1, 2]], '"False"'],
    // Two sets with a failed cell: the error.
    [['Equal', ['Set', 1, BOOM], ['Set', 1, 2]], BOOM_ERROR],
  ])('%j', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('an incomplete walk of one operand does not hide an error in another', () => {
    // Before: the first order stayed unevaluated, the second gave the error.
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 2;
    engine.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x]) => (x.is(2) ? engine.error('oops') : x),
    });
    const lazy = ['Map', 'h', ['List', 1, 3, 2]];
    for (const json of [
      ['Union', lazy, ['Set', 1, BOOM]],
      ['Union', ['Set', 1, BOOM], lazy],
    ])
      expect(
        engine
          .box(json as never)
          .evaluate()
          .toString()
      ).toBe(BOOM_ERROR);
    // An incomplete walk and no error: unevaluated.
    expect(
      engine.box(['Union', lazy, ['Set', 5]] as never).evaluate().operator
    ).toBe('Union');
  });

  test('a predicate that fails on the searched value leaves membership undecided', () => {
    // The `contains` handler of `Filter` declines when its predicate gives an
    // error for the searched value, as for a typed parameter that refuses
    // it (`filter-predicate-errors.test.ts`).
    const engine = new ComputeEngine();
    engine.declare('p', {
      signature: '(number) -> boolean',
      evaluate: ([x]) => (x.is(2) ? engine.error('oops') : engine.True),
    });
    expect(
      engine
        .box(['Contains', ['Filter', ['List', 2], 'p'], 2] as never)
        .evaluate().operator
    ).toBe('Contains');
    expect(
      engine
        .box(['Element', 2, ['Filter', ['List', 2], 'p']] as never)
        .evaluate().operator
    ).toBe('Element');
  });
});
