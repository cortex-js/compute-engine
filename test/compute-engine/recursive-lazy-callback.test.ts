import { ComputeEngine } from '../../src/compute-engine';

// A user function that calls itself from the callback of a lazy operator
// (`Map`, `Filter`) gets back, from the inner call, a held expression that
// holds the SAME callback literal. When the outer callback application ends,
// its parameter values are substituted into its result by binding identity.
// The parameter and body occurrences of the held literal carry the same
// binding as the outer callback, so they must be excluded because a binder of
// the same name (the held literal itself) sits between the result root and
// them. Without that exclusion, `m(1)` gave
// `[Error("expected-a-symbol", "Typed(1, \"number\")")]`: the value of `x`
// replaced the parameter of the held literal.

function evaluated(ce: ComputeEngine, call: unknown): string {
  return ce
    .box(call as any)
    .evaluate()
    .toString();
}

describe('A USER FUNCTION THAT CALLS ITSELF FROM A LAZY CALLBACK', () => {
  test('Map callback, box route, recursion depths 0 to 3', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'm',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            ['If', ['Less', 'x', 1], 0, ['m', ['Subtract', 'x', 1]]],
            'x',
          ],
          ['List', 'n'],
        ],
        'n',
      ],
    ]).evaluate();
    expect(evaluated(ce, ['m', 0])).toBe('[0]');
    expect(evaluated(ce, ['m', 1])).toBe('[[0]]');
    expect(evaluated(ce, ['m', 2])).toBe('[[[0]]]');
    expect(evaluated(ce, ['m', 3])).toBe('[[[[0]]]]');
    expect(ce.box(['m', 3]).N().toString()).toBe('[[[[0]]]]');
  });

  test('Map callback, parse route', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'm(n) := \\operatorname{Map}(x \\mapsto \\operatorname{If}(x < 1, 0, m(x-1)), [n])'
    ).evaluate();
    expect(ce.parse('m(1)').evaluate().toString()).toBe('[[0]]');
    expect(ce.parse('m(3)').evaluate().toString()).toBe('[[[[0]]]]');
  });

  test('Map over several elements', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'h',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            ['If', ['Less', 'x', 1], 0, ['h', ['Subtract', 'x', 1]]],
            'x',
          ],
          ['List', 'n', 'n'],
        ],
        'n',
      ],
    ]).evaluate();
    expect(evaluated(ce, ['h', 2])).toBe('[[[0,0],[0,0]],[[0,0],[0,0]]]');
  });

  test('the callback parameter has the same name as the outer parameter', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'm2',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            ['If', ['Less', 'x', 1], 0, ['m2', ['Subtract', 'x', 1]]],
            'x',
          ],
          ['List', 'x'],
        ],
        'x',
      ],
    ]).evaluate();
    expect(evaluated(ce, ['m2', 1])).toBe('[[0]]');
    expect(evaluated(ce, ['m2', 3])).toBe('[[[[0]]]]');
  });

  test('the callback reads a second parameter of the outer function', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'm3',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            [
              'If',
              ['Less', 'x', 1],
              'y',
              ['m3', ['Subtract', 'x', 1], ['Add', 'y', 'x']],
            ],
            'x',
          ],
          ['List', 'n'],
        ],
        'n',
        'y',
      ],
    ]).evaluate();
    // m3(3, 10) → m3(2, 13) → m3(1, 15) → m3(0, 16) = [16]
    expect(evaluated(ce, ['m3', 1, 10])).toBe('[[11]]');
    expect(evaluated(ce, ['m3', 3, 10])).toBe('[[[[16]]]]');
  });

  test('Filter over the recursive result, inside the Map callback', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'q',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            [
              'If',
              ['Less', 'x', 1],
              0,
              [
                'Filter',
                ['q', ['Subtract', 'x', 1]],
                ['Function', 'True', 'y'],
              ],
            ],
            'x',
          ],
          ['List', 'n'],
        ],
        'n',
      ],
    ]).evaluate();
    expect(evaluated(ce, ['q', 1])).toBe('[[0]]');
    expect(evaluated(ce, ['q', 3])).toBe('[[[[0]]]]');
  });

  test('Filter predicate that calls the function', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'f',
      [
        'Function',
        [
          'Filter',
          ['List', 'n'],
          [
            'Function',
            [
              'Or',
              ['Less', 'x', 1],
              ['Greater', ['Length', ['f', ['Subtract', 'x', 1]]], 0],
            ],
            'x',
          ],
        ],
        'n',
      ],
    ]).evaluate();
    expect(evaluated(ce, ['f', 0])).toBe('[0]');
    expect(evaluated(ce, ['f', 3])).toBe('[3]');
  });

  test('Reduce over the recursive result, inside the Map callback', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'r',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            [
              'If',
              ['Less', 'x', 1],
              1,
              [
                'Reduce',
                ['r', ['Subtract', 'x', 1]],
                ['Function', ['Add', 'a', 'b'], 'a', 'b'],
                0,
              ],
            ],
            'x',
          ],
          ['List', 'n', 'n'],
        ],
        'n',
      ],
    ]).evaluate();
    // r(0) = [1, 1]; r(k) = [s, s] where s is the sum of r(k − 1).
    expect(evaluated(ce, ['r', 1])).toBe('[2,2]');
    expect(evaluated(ce, ['r', 3])).toBe('[8,8]');
  });

  test('a returned lambda that re-binds the parameter keeps its binder', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Apply', ['Function', ['Function', 'x', 'x'], 'x'], 1])
        .evaluate()
        .toString()
    ).toBe('(x) => x');
  });
});
