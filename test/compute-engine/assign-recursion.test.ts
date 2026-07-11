import { ComputeEngine } from '../../src/compute-engine';

//
// Regression: `Assign(f, Function(body-referencing-f, params…))` must tie the
// recursion knot. The Assign canonicalization pre-declares the target symbol
// as a function-typed symbol before canonicalizing the body, so a
// self-reference in the body resolves to `f` rather than to an unbound/stale
// binding (which used to make the recursion unfold exactly once and stall).
//

describe('Assign + Function recursion knot-tying', () => {
  test('self-referential Assign+Function evaluates fully (factorial)', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'fact',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ],
        'n',
      ],
    ]).evaluate();

    expect(ce.box(['fact', 10]).evaluate().json).toEqual(3628800);
  });

  test('plain (non-recursive) Assign+Function still works', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'g', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
    expect(ce.box(['g', 5]).evaluate().json).toEqual(6);
  });

  test('a function symbol can be reassigned to a different function', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'h', ['Function', ['Add', 'n', 1], 'n']]).evaluate();
    expect(ce.box(['h', 3]).evaluate().json).toEqual(4);

    ce.box(['Assign', 'h', ['Function', ['Add', 'n', 100], 'n']]).evaluate();
    expect(ce.box(['h', 3]).evaluate().json).toEqual(103);
  });

  test('a second Assign can reference an already-defined function', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'double', ['Function', ['Multiply', 2, 'x'], 'x']]).evaluate();
    ce.box([
      'Assign',
      'quad',
      ['Function', ['double', ['double', 'x']], 'x'],
    ]).evaluate();

    expect(ce.box(['quad', 3]).evaluate().json).toEqual(12);
  });
});
