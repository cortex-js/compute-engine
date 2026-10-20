import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * The index of a binder (`Comprehension`, `Sum`, `Product`, `Loop`) can hold
 * a function: `[q(1) for q in [a ↦ a + 1]]`.
 *
 * - The index holds the function as its VALUE, so a comprehension puts the
 *   function in each element it makes, also where the element is lazy and
 *   is read after the comprehension has left its scope: the callback of a
 *   `Map` (`[Map(q, [1]) for q in …]` is `[[2]]`, not `[[q(1)]]`), and a
 *   call of the index in an inner comprehension
 *   (`[[f(x) for x in …] for f in …]`).
 * - Reading the type of a call of the index after the binder has left its
 *   scope does not declare the index in the global scope.
 */

const F: MathJsonExpression = ['Function', ['Add', 'a', 1], 'a'];
const G: MathJsonExpression = ['Function', ['Multiply', 2, 'a'], 'a'];

function box(ce: ComputeEngine, expr: MathJsonExpression): string {
  return ce.box(expr).evaluate().toString();
}

function epsil(ce: ComputeEngine, source: string): string {
  const result = executeEpsil(ce, source, {
    parseLatex: (latex: string) => ce.parse(latex).json,
  });
  expect(result.diagnostics.map((d) => d.message)).toEqual([]);
  return result.value?.toString() ?? 'Nothing';
}

describe('A comprehension index that holds a function, as a callback', () => {
  test('Map, box route', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Comprehension',
        ['Map', 'q', ['List', 1]],
        ['Element', 'q', ['List', F]],
      ])
    ).toBe('[[2]]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('Map with two functions, box route', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Comprehension',
        ['Map', 'q', ['List', 1, 2]],
        ['Element', 'q', ['List', F, G]],
      ])
    ).toBe('[[2,3],[2,4]]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('Filter, Reduce and Apply, box route', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Comprehension',
        ['Filter', ['List', 1, 2], 'q'],
        ['Element', 'q', ['List', ['Function', ['Greater', 'a', 1], 'a']]],
      ])
    ).toBe('[[2]]');
    expect(
      box(ce, [
        'Comprehension',
        ['Reduce', ['List', 1, 2, 3], 'q'],
        ['Element', 'q', ['List', ['Function', ['Add', 'a', 'b'], 'a', 'b']]],
      ])
    ).toBe('[6]');
    expect(
      box(ce, [
        'Comprehension',
        ['Apply', 'q', 1],
        ['Element', 'q', ['List', F]],
      ])
    ).toBe('[2]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('Map, parse route', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\left[\\mathrm{Map}(q, [1]) \\operatorname{for} q = [a\\mapsto a+1]\\right]'
    );
    expect(expr.json).toEqual([
      'Comprehension',
      ['Map', 'q', ['List', 1]],
      ['Element', 'q', ['List', ['Function', ['Block', ['Add', 'a', 1]], 'a']]],
    ]);
    expect(expr.evaluate().toString()).toBe('[[2]]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('map, filter and reduce, Epsil', () => {
    const ce = new ComputeEngine();
    expect(epsil(ce, '[map(q, [1]) for q in [(a) => a + 1]]')).toBe('[[2]]');
    expect(epsil(ce, '[filter([1, 2], q) for q in [(a) => a > 1]]')).toBe(
      '[[2]]'
    );
    expect(epsil(ce, '[reduce([1, 2, 3], q) for q in [(a, b) => a + b]]')).toBe(
      '[6]'
    );
    expect(
      epsil(ce, '[map(f, [1, 2]) for f in [(a) => a + 1, (a) => 2 * a]]')
    ).toBe('[[2,3],[2,4]]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('Sum over a Map with the index as its callback', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Sum',
        ['Sum', ['Map', 'q', ['List', 1, 2]]],
        ['Element', 'q', ['List', F, G]],
      ])
    ).toBe('11');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });
});

describe('A call of an index that holds a function, in an inner comprehension', () => {
  test('box route', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'Comprehension',
        ['Comprehension', ['f', 'x'], ['Element', 'x', ['List', 1, 2]]],
        ['Element', 'f', ['List', F, G]],
      ])
      .evaluate();
    expect(result.toString()).toBe('[[2,3],[2,4]]');
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('an element read after the whole walk has its own function, Epsil', () => {
    const ce = new ComputeEngine();
    // The second element is read first, so the first element is read after
    // the walk has gone past it.
    expect(
      epsil(
        ce,
        'let c = [[f(x) for x in [1, 2]] for f in [(a) => a + 1, (a) => 2 * a]]\nlet d = c[2]\nc[1][2]'
      )
    ).toBe('3');
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });

  test('an inner index of the same name shadows the outer one, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(ce, '[[f(2) for f in [(a) => 10 * a]] for f in [(a) => a + 1]]')
    ).toBe('[[20]]');
  });
});

describe('A call of an index does not declare the index in the global scope', () => {
  test('Comprehension, box route', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Comprehension',
        ['k2', 1],
        ['Element', 'k2', ['List', ['Function', 0, 'a'], ['Function', 1, 'a']]],
      ])
    ).toBe('[0,1]');
    expect(ce.lookupDefinition('k2')).toBeUndefined();
  });

  test('Comprehension with a guard that calls the index, box route', () => {
    const ce = new ComputeEngine();
    expect(
      box(ce, [
        'Comprehension',
        ['k', 1],
        [
          'Element',
          'k',
          ['List', F, ['Function', 0, 'a']],
          ['Greater', ['k', 1], 0],
        ],
      ])
    ).toBe('[2]');
    expect(ce.lookupDefinition('k')).toBeUndefined();
  });

  test('Comprehension, parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse(
          '\\left[q(1) \\operatorname{for} q = [a\\mapsto 0, a\\mapsto 1]\\right]'
        )
        .evaluate()
        .toString()
    ).toBe('[0,1]');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('Comprehension, Epsil', () => {
    const ce = new ComputeEngine();
    expect(epsil(ce, '[k2(1) for k2 in [(a) => 0, (a) => 1]]')).toBe('[0,1]');
    expect(ce.lookupDefinition('k2')).toBeUndefined();
  });

  test('Sum, Product and Loop, box route', () => {
    const ce = new ComputeEngine();
    expect(box(ce, ['Sum', ['k', 1], ['Element', 'k', ['List', F, G]]])).toBe(
      '4'
    );
    expect(
      box(ce, ['Product', ['k', 3], ['Element', 'k', ['List', F, G]]])
    ).toBe('24');
    expect(
      box(ce, [
        'Block',
        ['Declare', 'n', "'integer'"],
        ['Assign', 'n', 0],
        [
          'Loop',
          ['Assign', 'n', ['Add', 'n', ['k', 1]]],
          ['Element', 'k', ['List', F, G]],
        ],
        'n',
      ])
    ).toBe('4');
    expect(ce.lookupDefinition('k')).toBeUndefined();
  });

  test('Sum, parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\sum_{q\\in [a\\mapsto a+1]}q(1)').evaluate().toString()
    ).toBe('2');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('for loop, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(
        ce,
        'let n = 0\nfor q in [(a) => a + 1, (a) => 2 * a] { n = n + q(1) }\nn'
      )
    ).toBe('4');
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });
});

describe('A lazy value that calls a local function leaves its scope', () => {
  // A comprehension (or a `Map` callback) that leaves a function call or a
  // block is read after the scope is gone. A call of a parameter or of a
  // local in it is replaced by the function the name holds.

  test('the comprehension is the value of a function, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(ce, 'function g(f) { [f(x) for x in [1, 2]] }\ng((a) => a + 1)')
    ).toBe('[2,3]');
    expect(
      epsil(ce, 'let h = (f) => [f(x) for x in [1, 2]]\nh((a) => a + 1)')
    ).toBe('[2,3]');
    expect(
      epsil(ce, 'function m(f) { map((x) => f(x), [1, 2]) }\nm((a) => a + 1)')
    ).toBe('[2,3]');
    expect(
      epsil(
        ce,
        'function p(f) { filter([1, 2, 3], (x) => f(x) > 2) }\np((a) => a + 1)'
      )
    ).toBe('[2,3]');
  });

  test('the comprehension is the value of a block, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(ce, 'do { let f = (a) => a + 1; [f(x) for x in [1, 2]] }')
    ).toBe('[2,3]');
  });

  test('a binder that binds the same name keeps its own function, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(
        ce,
        'function g(f) { [[f(x) for x in [1, 2]] for f in [(a) => 10 * a]] }\ng((a) => a + 1)'
      )
    ).toBe('[[10,20]]');
    expect(
      epsil(
        ce,
        'function g(f) { f(1) + sum([f(2) for f in [(a) => 10 * a]]) }\ng((a) => a + 1)'
      )
    ).toBe('22');
  });

  test('the comprehension is an argument of a function with a parameter of the same name, Epsil', () => {
    const ce = new ComputeEngine();
    expect(
      epsil(
        ce,
        'function h(f, c) { c[2] }\nfunction g(f) { h((a) => 100 * a, [f(x) for x in [1, 2]]) }\ng((a) => a + 1)'
      )
    ).toBe('3');
    expect(
      epsil(
        ce,
        'function h(f, c) { c[2] }\nfunction g(f) { h((a) => 100 * a, map((x) => f(x), [1, 2])) }\ng((a) => a + 1)'
      )
    ).toBe('3');
  });

  test('a call of a parameter in a Sum, a Product, a Comprehension and a Map, box route', () => {
    const ce = new ComputeEngine();
    const lambda = (body: MathJsonExpression): MathJsonExpression => [
      'Apply',
      ['Function', body, 'g'],
      F,
    ];
    expect(box(ce, lambda(['Sum', ['g', 'k'], ['Limits', 'k', 1, 3]]))).toBe(
      '9'
    );
    expect(
      box(ce, lambda(['Product', ['g', 'k'], ['Limits', 'k', 1, 3]]))
    ).toBe('24');
    expect(
      box(
        ce,
        lambda(['Comprehension', ['g', 'x'], ['Element', 'x', ['List', 1, 2]]])
      )
    ).toBe('[2,3]');
    expect(
      box(ce, lambda(['Map', ['Function', ['g', 'x'], 'x'], ['List', 1, 2]]))
    ).toBe('[2,3]');
    expect(ce.lookupDefinition('g')).toBeUndefined();
  });

  test('a function assigned later is called by a Sum that called it before', () => {
    // A call of an undeclared function in the body of a `Sum` declares the
    // name outside the scope of the `Sum`, as a symbol would be.
    const ce = new ComputeEngine();
    const sum = ce.box(['Sum', ['h', 'k'], ['Limits', 'k', 1, 3]]);
    ce.assign('h', ce.box(['Function', ['Power', 'k', 2], 'k']));
    expect(sum.evaluate().toString()).toBe('14');
  });
});

describe('A list of function literals after an element sign', () => {
  test('is a list, not an interval', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\prod_{q\\in [a\\mapsto a+1, a\\mapsto 2a]}q(3)');
    expect(expr.json).toEqual([
      'Product',
      ['q', 3],
      [
        'Element',
        'q',
        [
          'List',
          ['Function', ['Block', ['Add', 'a', 1]], 'a'],
          ['Function', ['Block', ['Multiply', 2, 'a']], 'a'],
        ],
      ],
    ]);
    expect(expr.evaluate().toString()).toBe('24');
    // A pair of numbers is still a closed interval.
    expect(ce.parse('x \\in [1, 2]').json).toEqual([
      'Element',
      'x',
      ['Interval', 1, 2],
    ]);
  });
});
