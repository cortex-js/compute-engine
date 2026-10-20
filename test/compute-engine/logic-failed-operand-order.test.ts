import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

//
// The connectives `Or`, `And`, `Nand`, `Nor`, `Implies` and the quantifiers
// `Any`, `All` use three-valued (Kleene) logic for an operand that evaluates
// to an error, so the answer does not depend on the order of the operands
// (`docs/ERROR-MODEL.md` §3, "The connectives with a failed operand"):
//
// - an operand that decides the answer decides it wherever it is, also after
//   a failed operand (`Or(err, True)` is `True`, as `Or(True, err)` is);
// - when no operand decides, the answer is the error of the first failed
//   operand, also beside an unknown or an absent operand.
//
// Before, the operands were read in order and the first failed operand was
// the answer: `Or(err, True)` was the error while `Or(True, err)` was `True`,
// and `Any([1, 1/"a", 3], u ↦ u > 2)` was the error.
//
// Each case is checked on the box route and, when it has a LaTeX spelling, on
// the parse route, with `evaluate()` and with `evaluateAsync()`. Boolean
// symbols are uppercase (`A`), because a boolean use retypes a symbol for the
// lifetime of the engine.
//

const ce = new ComputeEngine();

/** A symbol answer as its name (`True`, `A`), any other answer as text. */
const show = (x: BoxedExpression): string => x.symbol ?? x.toString();

const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';
const ERR_B = 'Error(ErrorCode("incompatible-type", "number", "string"), "b")';

// A comparison whose left side fails: `1/"a" > 0`.
const err: MathJsonExpression = ['Greater', ['Divide', 1, "'a'"], 0];
const errB: MathJsonExpression = ['Greater', ['Divide', 1, "'b'"], 0];
const ERR_TEX = '\\frac{1}{\\text{a}}>0';
const failedCell: MathJsonExpression = ['Divide', 1, "'a'"];
const lambda = (body: MathJsonExpression): MathJsonExpression => [
  'Function',
  body,
  'u',
];

type Case = [
  label: string,
  json: MathJsonExpression,
  latex: string | undefined,
  expected: string,
];

const CASES: Case[] = [
  // Or: a `True` operand decides wherever it is.
  [
    'Or(err, True)',
    ['Or', err, 'True'],
    `${ERR_TEX}\\lor\\mathrm{True}`,
    'True',
  ],
  [
    'Or(True, err)',
    ['Or', 'True', err],
    `\\mathrm{True}\\lor ${ERR_TEX}`,
    'True',
  ],
  [
    'Or(err, False)',
    ['Or', err, 'False'],
    `${ERR_TEX}\\lor\\mathrm{False}`,
    ERR,
  ],
  [
    'Or(False, err)',
    ['Or', 'False', err],
    `\\mathrm{False}\\lor ${ERR_TEX}`,
    ERR,
  ],
  ['Or(err, A)', ['Or', err, 'A'], `${ERR_TEX}\\lor A`, ERR],
  ['Or(A, err)', ['Or', 'A', err], `A\\lor ${ERR_TEX}`, ERR],
  ['Or(err, Missing)', ['Or', err, 'Missing'], undefined, ERR],
  ['Or(Missing, err)', ['Or', 'Missing', err], undefined, ERR],
  ['Or(err, errB, True)', ['Or', err, errB, 'True'], undefined, 'True'],
  // The error of the FIRST failed operand.
  ['Or(err, errB)', ['Or', err, errB], undefined, ERR],
  ['Or(errB, err)', ['Or', errB, err], undefined, ERR_B],

  // And: a `False` operand decides wherever it is.
  [
    'And(err, False)',
    ['And', err, 'False'],
    `${ERR_TEX}\\land\\mathrm{False}`,
    'False',
  ],
  [
    'And(False, err)',
    ['And', 'False', err],
    `\\mathrm{False}\\land ${ERR_TEX}`,
    'False',
  ],
  [
    'And(err, True)',
    ['And', err, 'True'],
    `${ERR_TEX}\\land\\mathrm{True}`,
    ERR,
  ],
  [
    'And(True, err)',
    ['And', 'True', err],
    `\\mathrm{True}\\land ${ERR_TEX}`,
    ERR,
  ],
  ['And(err, A)', ['And', err, 'A'], `${ERR_TEX}\\land A`, ERR],
  ['And(A, err)', ['And', 'A', err], `A\\land ${ERR_TEX}`, ERR],
  // A non-boolean operand is replaced with an error at canonicalization.
  ['And(1, False)', ['And', 1, 'False'], undefined, 'False'],
  ['And(False, 1)', ['And', 'False', 1], undefined, 'False'],
  [
    'And(1, True)',
    ['And', 1, 'True'],
    undefined,
    'Error(ErrorCode("incompatible-type", "boolean", "1"), 1)',
  ],

  // Nand = Not(And), Nor = Not(Or).
  [
    'Nand(err, False)',
    ['Nand', err, 'False'],
    `${ERR_TEX}\\barwedge\\mathrm{False}`,
    'True',
  ],
  [
    'Nand(False, err)',
    ['Nand', 'False', err],
    `\\mathrm{False}\\barwedge ${ERR_TEX}`,
    'True',
  ],
  ['Nand(err, True)', ['Nand', err, 'True'], undefined, ERR],
  ['Nand(True, err)', ['Nand', 'True', err], undefined, ERR],
  ['Nor(err, True)', ['Nor', err, 'True'], undefined, 'False'],
  ['Nor(True, err)', ['Nor', 'True', err], undefined, 'False'],
  ['Nor(err, False)', ['Nor', err, 'False'], undefined, ERR],
  ['Nor(False, err)', ['Nor', 'False', err], undefined, ERR],

  // Implies(p, q): a `False` antecedent or a `True` consequent decides.
  [
    'Implies(err, True)',
    ['Implies', err, 'True'],
    `${ERR_TEX}\\implies\\mathrm{True}`,
    'True',
  ],
  [
    'Implies(False, err)',
    ['Implies', 'False', err],
    `\\mathrm{False}\\implies ${ERR_TEX}`,
    'True',
  ],
  [
    'Implies(err, False)',
    ['Implies', err, 'False'],
    `${ERR_TEX}\\implies\\mathrm{False}`,
    ERR,
  ],
  [
    'Implies(True, err)',
    ['Implies', 'True', err],
    `\\mathrm{True}\\implies ${ERR_TEX}`,
    ERR,
  ],

  // Xor and Equivalent have no operand that decides: the error stays.
  ['Xor(err, True)', ['Xor', err, 'True'], undefined, ERR],
  ['Xor(True, err)', ['Xor', 'True', err], undefined, ERR],
  ['Equivalent(err, True)', ['Equivalent', err, 'True'], undefined, ERR],
  ['Equivalent(True, err)', ['Equivalent', 'True', err], undefined, ERR],

  // A selecting subexpression gives its answer to the enclosing operator.
  ['Not(Or(err, True))', ['Not', ['Or', err, 'True']], undefined, 'False'],

  // Any: an element whose answer is `True` decides wherever it is.
  [
    'Any([1, err, 3], u > 2)',
    ['Any', ['List', 1, failedCell, 3], lambda(['Greater', 'u', 2])],
    '\\operatorname{Any}([1, \\frac{1}{\\text{a}}, 3], u\\mapsto u>2)',
    'True',
  ],
  [
    'Any([3, err, 1], u > 2)',
    ['Any', ['List', 3, failedCell, 1], lambda(['Greater', 'u', 2])],
    '\\operatorname{Any}([3, \\frac{1}{\\text{a}}, 1], u\\mapsto u>2)',
    'True',
  ],
  [
    'Any([1, err], u > 2)',
    ['Any', ['List', 1, failedCell], lambda(['Greater', 'u', 2])],
    '\\operatorname{Any}([1, \\frac{1}{\\text{a}}], u\\mapsto u>2)',
    ERR,
  ],
  [
    'Any([err, 1], u > 2)',
    ['Any', ['List', failedCell, 1], lambda(['Greater', 'u', 2])],
    undefined,
    ERR,
  ],
  [
    'Any([1, err, Missing], u > 2)',
    ['Any', ['List', 1, failedCell, 'Missing'], lambda(['Greater', 'u', 2])],
    undefined,
    ERR,
  ],
  [
    'Any([Missing, err], u > 2)',
    ['Any', ['List', 'Missing', failedCell], lambda(['Greater', 'u', 2])],
    undefined,
    ERR,
  ],
  // Without a predicate, the elements are the answers.
  ['Any([err, True])', ['Any', ['List', err, 'True']], undefined, 'True'],
  ['Any([True, err])', ['Any', ['List', 'True', err]], undefined, 'True'],
  ['Any([err, False])', ['Any', ['List', err, 'False']], undefined, ERR],

  // All: an element whose answer is `False` decides wherever it is.
  [
    'All([1, err, -3], u > 0)',
    ['All', ['List', 1, failedCell, -3], lambda(['Greater', 'u', 0])],
    '\\operatorname{All}([1, \\frac{1}{\\text{a}}, -3], u\\mapsto u>0)',
    'False',
  ],
  [
    'All([-3, err, 1], u > 0)',
    ['All', ['List', -3, failedCell, 1], lambda(['Greater', 'u', 0])],
    '\\operatorname{All}([-3, \\frac{1}{\\text{a}}, 1], u\\mapsto u>0)',
    'False',
  ],
  [
    'All([1, err, 3], u > 0)',
    ['All', ['List', 1, failedCell, 3], lambda(['Greater', 'u', 0])],
    '\\operatorname{All}([1, \\frac{1}{\\text{a}}, 3], u\\mapsto u>0)',
    ERR,
  ],
  ['All([err, False])', ['All', ['List', err, 'False']], undefined, 'False'],
  ['All([err, True])', ['All', ['List', err, 'True']], undefined, ERR],

  // A lazy source: the element at 2 fails, a later element decides. The
  // failure inside `Map` is a run-time error (`RuntimeError`), since a
  // callback whose body holds a written error is an invalid tree.
  [
    'Any(Range(1, +oo), u > 5) with a failure at 2',
    [
      'Any',
      ['Range', 1, 'PositiveInfinity'],
      lambda([
        'Greater',
        ['If', ['Equal', 'u', 2], ['Divide', 1, "'a'"], 'u'],
        5,
      ]),
    ],
    undefined,
    'True',
  ],
  [
    'All(Map(Range(1, 5)), u < 4) with a failure at 2',
    [
      'All',
      [
        'Map',
        lambda(['If', ['Equal', 'u', 2], ['RuntimeError', "'neg'"], 'u']),
        ['Range', 1, 5],
      ],
      lambda(['Less', 'u', 4]),
    ],
    undefined,
    'False',
  ],
  [
    'All(Map(Range(1, 5)), u < 9) with a failure at 2',
    [
      'All',
      [
        'Map',
        lambda(['If', ['Equal', 'u', 2], ['RuntimeError', "'neg'"], 'u']),
        ['Range', 1, 5],
      ],
      lambda(['Less', 'u', 9]),
    ],
    undefined,
    'Error("neg")',
  ],
];

const BOX_CASES = CASES.map(([label, json, , expected]) => [
  label,
  json,
  expected,
]) as [string, MathJsonExpression, string][];

const PARSE_CASES = CASES.filter(([, , latex]) => latex !== undefined).map(
  ([label, , latex, expected]) => [label, latex, expected]
) as [string, string, string][];

describe('A FAILED OPERAND OF A CONNECTIVE OR A QUANTIFIER', () => {
  describe('box route, evaluate()', () => {
    test.each(BOX_CASES)('%s', (_label, json, expected) => {
      expect(show(ce.box(json).evaluate())).toBe(expected);
    });
  });

  describe('box route, evaluateAsync()', () => {
    test.each(BOX_CASES)('%s', async (_label, json, expected) => {
      expect(show(await ce.box(json).evaluateAsync())).toBe(expected);
    });
  });

  describe('parse route, evaluate()', () => {
    test.each(PARSE_CASES)('%s', (_label, latex, expected) => {
      expect(show(ce.parse(latex).evaluate())).toBe(expected);
    });
  });

  describe('parse route, evaluateAsync()', () => {
    test.each(PARSE_CASES)('%s', async (_label, latex, expected) => {
      expect(show(await ce.parse(latex).evaluateAsync())).toBe(expected);
    });
  });

  describe('symbolic operands keep their rules', () => {
    test.each([
      [['Or', 'A', 'True'], 'True'],
      [['Or', 'True', 'A'], 'True'],
      [['Or', 'A', 'False'], 'A'],
      [['And', 'A', 'False'], 'False'],
      [['And', 'A', 'True'], 'A'],
      [['Implies', 'A', 'True'], 'True'],
      [['Implies', 'False', 'A'], 'True'],
    ] as [MathJsonExpression, string][])('%j', async (json, expected) => {
      expect(show(ce.box(json).evaluate())).toBe(expected);
      expect(show(await ce.box(json).evaluateAsync())).toBe(expected);
    });
  });

  // A source that is not known to be finite is read for at most
  // `ce.iterationLimit` elements, with or without a failed element. When no
  // element decides before that, the quantifier stays unevaluated: a
  // decisive element can come later, so neither the error nor the answer of
  // a complete walk is known. Before, a walk with no decision did not end.
  describe('an infinite source with no decisive element stays unevaluated', () => {
    test.each([
      [
        'Any(Range(1, +oo), u < 0) with a failure at 2',
        [
          'Any',
          ['Range', 1, 'PositiveInfinity'],
          lambda([
            'Less',
            ['If', ['Equal', 'u', 2], ['Divide', 1, "'a'"], 'u'],
            0,
          ]),
        ],
        'Any',
      ],
      [
        'Any(Range(1, +oo), u < 0)',
        ['Any', ['Range', 1, 'PositiveInfinity'], lambda(['Less', 'u', 0])],
        'Any',
      ],
      [
        'All(Range(1, +oo), u > 0)',
        ['All', ['Range', 1, 'PositiveInfinity'], lambda(['Greater', 'u', 0])],
        'All',
      ],
      [
        'Any(Repeat(5), u < 0)',
        ['Any', ['Repeat', 5], lambda(['Less', 'u', 0])],
        'Any',
      ],
    ] as [string, MathJsonExpression, string][])(
      '%s',
      async (_label, json, head) => {
        expect(ce.box(json).evaluate().operator).toBe(head);
        expect((await ce.box(json).evaluateAsync()).operator).toBe(head);
      }
    );

    test('the walk makes at most `iterationLimit` elements', async () => {
      // Each element of `Map(H, Repeat(1))` is made by a call of `H`, which
      // is declared impure. The walk stops at the cap before it asks for
      // another element.
      for (const limit of [1, 3]) {
        for (const kind of ['Any', 'All']) {
          const engine = new ComputeEngine();
          let calls = 0;
          engine.declare('H', {
            signature: '(integer) -> integer',
            pure: false,
            evaluate: ([x]) => {
              calls += 1;
              return x;
            },
          });
          engine.iterationLimit = limit;
          const json: MathJsonExpression = [
            kind,
            ['Map', 'H', ['Repeat', 1]],
            lambda(kind === 'Any' ? ['Less', 'u', 0] : ['Greater', 'u', 0]),
          ];
          expect(engine.box(json).evaluate().operator).toBe(kind);
          expect(calls).toBe(limit);
          calls = 0;
          expect((await engine.box(json).evaluateAsync()).operator).toBe(kind);
          expect(calls).toBe(limit);
        }
      }
    });

    test('a decisive element before the cap still decides', async () => {
      const json: MathJsonExpression = [
        'Any',
        ['Range', 1, 'PositiveInfinity'],
        lambda(['Greater', 'u', 500]),
      ];
      expect(show(ce.box(json).evaluate())).toBe('True');
      expect(show(await ce.box(json).evaluateAsync())).toBe('True');
    });

    test('a source known to be finite is read to its end, however large', () => {
      expect(
        show(
          ce
            .box(['Any', ['Range', 1, 5000], lambda(['Equal', 'u', 4999])])
            .evaluate()
        )
      ).toBe('True');
      expect(
        show(
          ce
            .box([
              'All',
              ['Filter', ['Range', 1, 5000], lambda(['Greater', 'u', 2])],
              lambda(['Greater', 'u', 0]),
            ])
            .evaluate()
        )
      ).toBe('True');
    });
  });
});

//
// `ForAll`, `Exists`, `ExistsUnique` (and their negations) over a finite
// domain follow the same rule as `All` and `Any`: an answer that decides wins
// wherever it is; otherwise the error of the first failed answer; otherwise,
// when an answer has a free symbol, the quantifier stays unevaluated. Before,
// `Exists` read every answer that was not `True` as `False`, and `ForAll`
// stopped at the first answer that was not `True`, so its result depended on
// the order of the domain.
//
describe('A FAILED ANSWER OF A FINITE QUANTIFIER', () => {
  const NEG = 'Error("neg")';
  // `x = 2 ? RuntimeError("neg") : x`, compared with `k`.
  const body = (cmp: string, k: number): MathJsonExpression => [
    cmp,
    ['If', ['Equal', 'x', 2], ['RuntimeError', "'neg'"], 'x'],
    k,
  ];
  const inList = (...xs: number[]): MathJsonExpression => [
    'Element',
    'x',
    ['List', ...xs],
  ];

  test.each([
    ['Exists, no witness', ['Exists', inList(1, 2), body('Greater', 5)], NEG],
    [
      'Exists, a witness after the failure',
      ['Exists', inList(1, 2, 3), body('Greater', 2)],
      'True',
    ],
    [
      'Exists, a witness before the failure',
      ['Exists', inList(3, 2, 1), body('Greater', 2)],
      'True',
    ],
    [
      'ForAll, a counterexample first',
      ['ForAll', inList(3, 2, 1), body('Less', 3)],
      'False',
    ],
    [
      'ForAll, a counterexample last',
      ['ForAll', inList(1, 2, 3), body('Less', 3)],
      'False',
    ],
    [
      'ForAll over a set, a counterexample last',
      ['ForAll', ['Element', 'x', ['Set', 1, 2, 3]], body('Less', 3)],
      'False',
    ],
    [
      'ForAll, no counterexample',
      ['ForAll', inList(1, 2, 3), body('Less', 9)],
      NEG,
    ],
    [
      'NotExists, no witness',
      ['NotExists', inList(1, 2), body('Greater', 5)],
      NEG,
    ],
    [
      'NotForAll, no counterexample',
      ['NotForAll', inList(1, 2, 3), body('Less', 9)],
      NEG,
    ],
    [
      'ExistsUnique, two witnesses after the failure',
      ['ExistsUnique', inList(1, 2, 3, 4), body('Greater', 2)],
      'False',
    ],
    [
      'ExistsUnique, one witness and a failure',
      ['ExistsUnique', inList(1, 2, 3), body('Greater', 2)],
      NEG,
    ],
    [
      'nested Exists, a witness after the failure',
      [
        'Exists',
        inList(1, 2),
        [
          'Exists',
          ['Element', 'y', ['List', 1, 2]],
          [
            'Greater',
            ['If', ['Equal', 'y', 1], ['RuntimeError', "'neg'"], 'y'],
            1,
          ],
        ],
      ],
      'True',
    ],
    // Unchanged answers.
    [
      'Exists over valid answers',
      ['Exists', inList(1, 2, 3), ['Greater', 'x', 5]],
      'False',
    ],
    [
      'ForAll over valid answers',
      ['ForAll', inList(1, 2, 3), ['Greater', 'x', 0]],
      'True',
    ],
  ] as [string, MathJsonExpression, string][])(
    '%s',
    async (_label, json, expected) => {
      expect(show(ce.box(json).evaluate())).toBe(expected);
      expect(show(await ce.box(json).evaluateAsync())).toBe(expected);
    }
  );

  test.each([
    ['Exists', 'Exists'],
    ['ForAll', 'ForAll'],
    ['ExistsUnique', 'ExistsUnique'],
  ])('%s with a free symbol in the answers stays unevaluated', (op, head) => {
    // `x > n` with `n` free: a value of `n` could still decide. `Exists`
    // answered `False` before.
    const json: MathJsonExpression = [op, inList(1, 2), ['Greater', 'x', 'n']];
    expect(ce.box(json).evaluate().operator).toBe(head);
  });

  test('an infinite domain keeps the quantifier unevaluated', () => {
    for (const op of ['Exists', 'ForAll']) {
      const json: MathJsonExpression = [
        op,
        ['Element', 'x', ['Range', 1, 'PositiveInfinity']],
        ['Greater', 'x', 0],
      ];
      expect(ce.box(json).evaluate().operator).toBe(op);
    }
  });
});
