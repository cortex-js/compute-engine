// An `Assign` whose target is a subscripted name stores a lazy view out of
// the loop iteration or the block that made it, as an assignment to a
// variable of an enclosing scope does. Two routes did not apply the rule of
// such assignments (`bindOutlivedLocalsOfLazyValue`, `function-utils.ts`):
//
// - a subscripted name whose joined name is declared (`h_1` declared, then
//   `h_1 := v`), which stores the value in `h_1`;
// - a base case of a sequence (`L_0 := v`, `P_{0,0} := v`), which stores the
//   value in the definition of the sequence, in the scope where the sequence
//   is declared (`sequenceDefinitionScope`, `sequence.ts`).
//
// With `for d in [3, 6] { if d == 3 { L_0 := Map(x => x + d, R) } }`, the
// view read after the loop read the `d` of the last iteration (`7, 8`, and
// with the debug check of dead bindings, a read of a discarded scope). Now it
// reads the `d` of the assignment: `4, 5`.

import { ComputeEngine } from '../../src/compute-engine';

type Json = any;

const VIEW: Json = [
  'Map',
  ['Function', ['Add', 'x', 'd'], 'x'],
  ['Range', 1, 'PositiveInfinity'],
];

/** `for d in [3, 6] { if d == 3 { target := VIEW } }`. */
function assignInLoop(target: Json): Json {
  return [
    'Loop',
    ['Block', ['If', ['Equal', 'd', 3], ['Block', ['Assign', target, VIEW]]]],
    ['Element', 'd', ['List', 3, 6]],
  ];
}

function firstTwo(ce: ComputeEngine, view: Json | string): Json {
  const v = typeof view === 'string' ? ce.parse(view) : ce.box(view);
  return ce
    .function('ListFrom', [ce.function('Take', [v.evaluate(), ce.number(2)])])
    .evaluate().json;
}

describe('A LAZY VIEW ASSIGNED TO A SUBSCRIPTED NAME OUT OF A LOOP ITERATION', () => {
  for (const debug of [false, true]) {
    const suffix = debug ? ', with the debug check' : '';

    test(`a declared joined name${suffix}`, () => {
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      ce.declare('h_1', 'any');
      ce.box(assignInLoop(['Subscript', 'h', 1])).evaluate();
      expect(firstTwo(ce, 'h_1')).toEqual(['List', 4, 5]);
    });

    test(`a base case of a sequence${suffix}`, () => {
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      ce.parse('L_n := L_{n-1}').evaluate();
      ce.box(assignInLoop(['Subscript', 'L', 0])).evaluate();
      expect(firstTwo(ce, 'L_{0}')).toEqual(['List', 4, 5]);
    });

    test(`a base case of a sequence that has only a pending definition${suffix}`, () => {
      // `L_0 := 1` makes a pending definition of `L` in the global scope,
      // and no binding of `L`: the base case of the loop goes there too.
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      ce.parse('L_0 := 1').evaluate();
      ce.box(assignInLoop(['Subscript', 'L', 1])).evaluate();
      ce.parse('L_n := L_{n-1}').evaluate();
      expect(firstTwo(ce, 'L_{1}')).toEqual(['List', 4, 5]);
    });

    test(`a base case of a multi-index sequence${suffix}`, () => {
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      ce.parse('P_{n,k} := P_{n-1,k-1} + P_{n-1,k}').evaluate();
      ce.box(assignInLoop(['Subscript', 'P', ['Sequence', 0, 0]])).evaluate();
      expect(firstTwo(ce, 'P_{0,0}')).toEqual(['List', 4, 5]);
    });
  }

  test('a base case assigned in the scope of the sequence reads the current values', () => {
    // The base case is assigned in the global scope, where `L` is defined:
    // the view outlives no scope, and reads `d` when it is read.
    const ce = new ComputeEngine();
    ce.parse('L_n := L_{n-1}').evaluate();
    ce.declare('d', 'integer');
    ce.assign('d', 3);
    ce.box(['Assign', ['Subscript', 'L', 0], VIEW]).evaluate();
    ce.assign('d', 10);
    expect(firstTwo(ce, 'L_{0}')).toEqual(['List', 11, 12]);
  });
});
