/**
 * Printing an unevaluated lazy view that is not pure runs no side effect.
 *
 * The display preview (`toString()`, the `latex` getter and `toLatex()`
 * without a `materialization` option) materializes the first and the last
 * elements of a lazy view. The walk evaluates each element it gives, and
 * the handler of the view (`Dedup` compares its elements) evaluates the
 * cells. For a view over a list literal with a call of a function declared
 * `pure: false` (`Reverse([1, H(1), 2])`), printing called `H`, and a preview
 * over `Random()` gave a different list at each print.
 *
 * The rule: a view whose evaluation can have an effect (a call of a function
 * declared `pure: false`, a draw of `Random`, a write to a variable that the
 * view does not declare itself) prints as written. Its value is printed
 * after an evaluation. A write to a local variable that a `Block` of the
 * view declares has no effect outside the view, and the preview is kept. The
 * rule is `previewHoldsEagerOperand()` and `previewRunsEffect()` in
 * `src/compute-engine/boxed-expression/boxed-function.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

function engine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('H', {
    signature: '(integer) -> integer',
    pure: false,
    evaluate: ([x]) => {
      calls += 1;
      return x;
    },
  });
  ce.declare('P', {
    signature: '(integer) -> integer',
    pure: true,
    evaluate: ([x]) => {
      calls += 1;
      return x;
    },
  });
  return { ce, calls: () => calls };
}

const json = (x: Expression) => JSON.stringify(x.json);

const IMPURE_LIST = ['List', 1, ['H', 1], 2];

// Each case: the view, its `toString()` and its LaTeX (`latex` and
// `toLatex()`), all as written.
const CASES: [string, unknown, string, string][] = [
  [
    'Dedup',
    ['Dedup', IMPURE_LIST],
    'Dedup([1,H(1),2])',
    '\\mathrm{Dedup}(\\bigl\\lbrack1, H(1), 2\\bigr\\rbrack)',
  ],
  [
    'Reverse',
    ['Reverse', IMPURE_LIST],
    'Reverse([1,H(1),2])',
    '\\mathrm{Reverse}(\\bigl\\lbrack1, H(1), 2\\bigr\\rbrack)',
  ],
  [
    'Take',
    ['Take', IMPURE_LIST, 2],
    'Take([1,H(1),2], 2)',
    '\\mathrm{Take}(\\bigl\\lbrack1, H(1), 2\\bigr\\rbrack, 2)',
  ],
  [
    'nested view',
    ['Reverse', ['Dedup', IMPURE_LIST]],
    'Reverse(Dedup([1,H(1),2]))',
    '\\mathrm{Reverse}(\\mathrm{Dedup}(\\bigl\\lbrack1, H(1), 2\\bigr\\rbrack))',
  ],
  [
    'nested list cell',
    ['Reverse', ['List', 1, ['List', ['H', 1]], 2]],
    'Reverse([1,[H(1)],2])',
    '\\mathrm{Reverse}(\\bigl\\lbrack1, \\bigl\\lbrack H(1)\\bigr\\rbrack, 2\\bigr\\rbrack)',
  ],
  [
    'Filter',
    ['Filter', IMPURE_LIST, ['Function', ['Greater', 'x', 0], 'x']],
    'Filter([1,H(1),2], (x) => 0 < x)',
    '\\mathrm{Filter}(\\bigl\\lbrack1, H(1), 2\\bigr\\rbrack, x\\mapsto0\\lt x)',
  ],
  [
    'Map with an impure callback',
    ['Map', ['Function', ['H', 'x'], 'x'], ['List', 1, 2]],
    'Map((x) => H(x), [1,2])',
    '\\mathrm{Map}(x\\mapsto H(x), \\bigl\\lbrack1, 2\\bigr\\rbrack)',
  ],
];

describe('PRINTING A VIEW THAT IS NOT PURE CALLS NO FUNCTION', () => {
  test.each(CASES)('%s, box route', (_name, input, ascii, latex) => {
    const { ce, calls } = engine();
    const view = ce.box(input as never);
    expect(view.isPure).toBe(false);
    expect(view.toString()).toBe(ascii);
    expect(calls()).toBe(0);
    // The MathJSON keeps the call, unevaluated.
    expect(json(view)).toContain('["H",');
    expect(calls()).toBe(0);
    expect(view.latex).toBe(latex);
    expect(calls()).toBe(0);
    expect(view.toLatex()).toBe(latex);
    expect(calls()).toBe(0);
  });

  test.each([
    [
      '\\operatorname{Reverse}([1, H(1), 2])',
      'Reverse([1,H(1),2])',
      '["Reverse",["List",1,["H",1],2]]',
    ],
    [
      '\\operatorname{Dedup}([1, H(1), 2])',
      'Dedup([1,H(1),2])',
      '["Dedup",["List",1,["H",1],2]]',
    ],
  ])('parse route: %s', (src, ascii, mathJson) => {
    const { ce, calls } = engine();
    const view = ce.parse(src);
    expect(json(view)).toBe(mathJson);
    expect(view.toString()).toBe(ascii);
    void view.latex;
    view.toLatex();
    expect(calls()).toBe(0);
  });

  test('a cell that calls Random prints the same at each print', () => {
    const { ce } = engine();
    const view = ce.box(['Reverse', ['List', 1, ['Random'], 2]]);
    expect(view.toString()).toBe('Reverse([1,Random(),2])');
    expect(view.toString()).toBe('Reverse([1,Random(),2])');
    expect(view.latex).toBe(
      '\\mathrm{Reverse}(\\bigl\\lbrack1, \\mathrm{Random}(), 2\\bigr\\rbrack)'
    );
    expect(json(view)).toBe('["Reverse",["List",1,["Random"],2]]');
  });

  test('the value of the view is computed by an evaluation', () => {
    const { ce, calls } = engine();
    const view = ce.box(['Reverse', IMPURE_LIST]);
    view.toString();
    expect(calls()).toBe(0);
    // The value is the view over the evaluated list: the call is evaluated
    // once.
    const value = view.evaluate();
    expect(json(value)).toBe('["Reverse",["List",1,1,2]]');
    expect(calls()).toBe(1);
    // The value prints its preview with no further call.
    expect(value.toString()).toBe('[2,1,1]');
    expect(value.latex).toBe('\\bigl\\lbrack2, 1, 1\\bigr\\rbrack');
    expect(calls()).toBe(1);
    // An explicit materialization evaluates the view.
    const dedup = ce.box(['Dedup', IMPURE_LIST]);
    expect(json(dedup.evaluate({ materialization: true }))).toBe(
      '["List",1,2]'
    );
    expect(calls()).toBe(2);
  });

  test('a view over a pure call still prints its preview', () => {
    // A function declared `pure: true` has no side effect, so the preview of
    // a view over a call of it evaluates the call and prints the elements.
    const { ce } = engine();
    const view = ce.box(['Reverse', ['List', 1, ['P', 1], 2]]);
    expect(view.isPure).toBe(true);
    expect(view.toString()).toBe('[2,1,1]');
    expect(view.latex).toBe('\\bigl\\lbrack2, 1, 1\\bigr\\rbrack');
  });
});

describe('PRINTING A VIEW THAT WRITES A VARIABLE', () => {
  test('a write to a variable outside the view is not run', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'integer');
    ce.assign('s', 0);
    const views = [
      ce.box([
        'Comprehension',
        ['Block', ['Assign', 's', 'n'], 's'],
        ['Element', 'n', ['Range', 1, 3]],
      ]),
      ce.box([
        'Map',
        ['Function', ['Block', ['Assign', 's', 'x'], 'x'], 'x'],
        ['List', 1, 2],
      ]),
    ];
    for (const view of views) {
      view.toString();
      void view.latex;
      view.toLatex();
      expect(ce.box('s').evaluate().json).toBe(0);
    }
    // The view prints as written.
    expect(views[0].toString()).toMatch(/^Comprehension\(/);
    expect(views[1].toString()).toMatch(/^Map\(/);
  });

  test('a write to a local variable of the view is previewed', () => {
    // The runtime effects report `scope` for any `Assign`, but `s` is
    // declared by the `Block`: the write has no effect outside the view.
    const ce = new ComputeEngine();
    const view = ce.box([
      'Comprehension',
      ['Block', ['Declare', 's', "'integer'"], ['Assign', 's', 2], 's'],
      ['Element', 'n', ['Range', 1, 3]],
    ]);
    expect(view.isPure).toBe(false);
    expect(view.toString()).toBe('[2,2,2]');
  });
});

describe('A CALL OF THE INDEX OF A COMPREHENSION', () => {
  const FNS = [
    'List',
    ['Function', 0, 'a'],
    ['Function', ['Add', 'a', 5], 'a'],
  ];

  test('a call of the index is previewed', () => {
    // The index `q` has no definition, so the runtime effects of `q(1)` are
    // unknown. The index holds an element of the list, and the preview
    // applies it.
    const { ce } = engine();
    const view = ce.box(['Comprehension', ['q', 1], ['Element', 'q', FNS]]);
    expect(view.toString()).toBe('[0,6]');
  });

  test('a call of an impure function next to it is not run', () => {
    const { ce, calls } = engine();
    const view = ce.box([
      'Comprehension',
      ['Add', ['q', 1], ['H', 1]],
      ['Element', 'q', FNS],
    ]);
    view.toString();
    void view.latex;
    expect(calls()).toBe(0);
    expect(view.toString()).toMatch(/^Comprehension\(/);
  });

  // With `H` declared `pure: false`, the call of the index runs `H` unless
  // each function that the source of the index can supply is proven pure.
  const IMPURE_FN = ['Function', ['H', 'a'], 'a'];
  test.each([
    ['a list of one impure lambda', ['q', 1], ['List', IMPURE_FN]],
    [
      'a list of a pure and an impure lambda',
      ['q', 1],
      ['List', ['Function', 0, 'a'], IMPURE_FN],
    ],
    ['a set literal', ['q', 1], ['Set', IMPURE_FN]],
    ['a view', ['q', 1], ['Reverse', ['List', IMPURE_FN]]],
    ['an Apply of the index', ['Apply', 'q', 1], ['List', IMPURE_FN]],
    [
      'a call of the index in a callback',
      ['Map', ['Function', ['q', 'r'], 'r'], ['List', 1]],
      ['List', IMPURE_FN],
    ],
  ])('the source is %s', (_name, body, source) => {
    const { ce, calls } = engine();
    const view = ce.box(['Comprehension', body, ['Element', 'q', source]]);
    expect(view.toString()).toMatch(/^Comprehension\(/);
    void view.latex;
    view.toLatex();
    expect(calls()).toBe(0);
    // The evaluation applies `H`.
    view.evaluate({ materialization: true });
    expect(calls()).toBeGreaterThan(0);
  });

  test('the index is the callback of a Map', () => {
    const { ce, calls } = engine();
    const view = ce.box([
      'Comprehension',
      ['Map', 'q', ['List', 1]],
      ['Element', 'q', ['List', IMPURE_FN]],
    ]);
    expect(view.toString()).toMatch(/^Comprehension\(/);
    void view.latex;
    expect(calls()).toBe(0);
  });

  test('the source is a symbol', () => {
    // The functions of a symbol are not read for an index: the call of the
    // index is not proven pure, also when the symbol holds pure lambdas.
    const { ce, calls } = engine();
    ce.declare('fs', 'unknown');
    ce.assign('fs', ce.box(['List', IMPURE_FN]));
    ce.declare('gs', 'unknown');
    ce.assign('gs', ce.box(FNS as never));
    for (const name of ['fs', 'gs']) {
      const view = ce.box(['Comprehension', ['q', 1], ['Element', 'q', name]]);
      expect(view.toString()).toMatch(/^Comprehension\(/);
    }
    expect(calls()).toBe(0);
  });
});

describe('A CALLBACK THAT CALLS ITS PARAMETER', () => {
  const IMPURE_LIST = ['List', ['Function', ['H', 'a'], 'a']];
  const CALL_W = ['Function', ['w', 1], 'w'];

  test('over a list literal of impure lambdas', () => {
    const { ce, calls } = engine();
    const view = ce.box(['Map', CALL_W, IMPURE_LIST]);
    expect(view.toString()).toMatch(/^Map\(/);
    void view.latex;
    expect(calls()).toBe(0);
  });

  test('over a symbol that holds impure lambdas', () => {
    const { ce, calls } = engine();
    ce.declare('fs', 'unknown');
    ce.assign('fs', ce.box(IMPURE_LIST as never));
    const view = ce.box(['Map', CALL_W, 'fs']);
    expect(view.toString()).toMatch(/^Map\(/);
    expect(calls()).toBe(0);
  });

  test('over a list literal of pure lambdas', () => {
    const { ce } = engine();
    const view = ce.box([
      'Map',
      CALL_W,
      ['List', ['Function', 0, 'a'], ['Function', ['Add', 'a', 5], 'a']],
    ]);
    expect(view.toString()).toBe('[0,6]');
  });
});

describe('A CALLBACK THAT WRITES A LOCAL OF ITS BLOCK', () => {
  // An assignment in a `Block` to a name that no outer scope declares makes a
  // local of the block, with a new binding at each call of the body, so the
  // write and the call of `h` have no effect outside the call. The same
  // shape as `batch9-evaluation.test.ts`, "a Table of a block".
  const H = ['Assign', 'h', ['Function', ['Multiply', 2, 'z'], 'z']];
  const BODY = ['Block', ['If', ['Equal', 'k', 2], H], ['h', 'k']];

  test('a local of the block is previewed', () => {
    const ce = new ComputeEngine();
    const value = ce.box(['Table', BODY, ['Tuple', 'k', 1, 3]]).evaluate();
    expect(value.toString()).toBe('[h(1),4,h(3)]');
    expect(value.toString()).toBe('[h(1),4,h(3)]');
    expect(ce.lookupDefinition('h')).toBeUndefined();
  });

  test('a write to a declared outer name is not run', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'unknown');
    const value = ce.box(['Table', BODY, ['Tuple', 'k', 1, 3]]).evaluate();
    expect(value.toString()).toMatch(/^Tabulate\(/);
    expect(ce.box('h').evaluate().json).toBe('h');
  });

  test('a write to an assigned outer name is not run', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Multiply', 3, 'z'], 'z']));
    const value = ce.box(['Table', BODY, ['Tuple', 'k', 1, 3]]).evaluate();
    expect(value.toString()).toMatch(/^Tabulate\(/);
    // The outer `h` still triples.
    expect(ce.box(['h', 5]).evaluate().json).toBe(15);
  });

  test('a local that holds an impure function is not called', () => {
    const { ce, calls } = engine();
    for (const value of ['H', ['Function', ['H', 'z'], 'z']]) {
      const view = ce
        .box([
          'Table',
          ['Block', ['Assign', 'g', value], ['g', 'k']],
          ['Tuple', 'k', 1, 2],
        ])
        .evaluate();
      const before = calls();
      expect(view.toString()).toMatch(/^Tabulate\(/);
      expect(calls()).toBe(before);
    }
  });
});
