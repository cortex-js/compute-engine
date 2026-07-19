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

  // @fixme: evaluating literal-depth recursion over a SYMBOLIC argument is
  // exponential in depth (depth 5 ≈ 300 ms, depth 10 ≫ 60 s): each level
  // re-walks the growing nested operand through both `evaluate` and `N`
  // (`Add.evaluate → addN → ops.map(op => op.N())`, arithmetic-add.ts). With
  // numeric arguments each level collapses to a number and evaluation is
  // linear. Surfaced 2026-07-19 during the compiled-recursive-lambdas design
  // round; tracked in ROADMAP.md ("Interpreter perf" follow-up). Unskip when
  // fixed — the expectation below is the desired (linear-time) behavior.
  test.skip('literal-depth recursion over a symbolic argument evaluates in linear time', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 5000; // generous — linear-time unrolling needs a fraction
    ce.box([
      'Assign',
      'Q',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 0],
          'z',
          ['Add', ['Power', ['Q', ['Subtract', 'n', 1], 'z'], 2], 0.3],
        ],
        'n',
        'z',
      ],
    ]).evaluate();
    const r = ce.box(['Q', 12, 'z']).evaluate();
    expect(r.has('Q')).toBe(false); // fully unrolled, recursion-free closed form
  });
});
