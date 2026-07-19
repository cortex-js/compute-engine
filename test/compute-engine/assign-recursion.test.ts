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

  // Regression pin for the 2026-07-19 symbolic-argument recursion blowup.
  // Two compounding causes (contrary to this comment's original `addN`
  // attribution):
  // (1) the D2 numericize tail of `Add`/`Multiply`'s evaluate gated on the
  //     *dynamic-scope* `unknowns`, so inside the application the bound
  //     parameter `z` counted as known and every nested `Add` fired a
  //     full-subtree `N()` walk that could make no progress — ~×7.5 work per
  //     level (depth 5 ≈ 300 ms, depth 8+ ≫ 60 s). Gate is now the lexical
  //     `isConstant` (arithmetic.ts, D2 comments).
  // (2) non-lazy handlers (`Power`, `Sqrt`, `Divide`, …) re-evaluated
  //     operands the driver had already evaluated — a ×2-per-level re-walk.
  //     They now trust their pre-evaluated operands (only `lazy` operators'
  //     handlers own operand evaluation).
  // Unwinding is now linear: depth 40 ≈ 30 ms (was: timeout at depth 8).
  test('literal-depth recursion over a symbolic argument unwinds in linear time', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 5000; // depth 40 needs ~30 ms; generous margin for CI
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
    const r = ce.box(['Q', 40, 'z']).evaluate();
    expect(r.has('Q')).toBe(false); // fully unrolled, recursion-free closed form
  });
});
