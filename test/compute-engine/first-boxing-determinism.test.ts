import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * First-boxing binding divergence (Tycho items 178(a) and 178(c) — two
 * surfaces of one defect; design record:
 * `docs/plans/2026-08-13-first-boxing-binding-divergence.md`).
 *
 * The invariant under test: boxing the same MathJSON twice on the same
 * engine produces `isSame` expressions — including the FIRST-ever boxing of
 * a shape. Before the fix, a not-yet-declared symbol occurring both inside a
 * binder's scope and outside it made the first boxing auto-declare the inner
 * occurrence into a scope local to that canonicalization while the sibling
 * declared into the enclosing scope; every later boxing found the enclosing
 * binding first and resolved BOTH occurrences to it, so the first result
 * compared `isSame` false against all later ones.
 *
 * The fix (in `EngineBoxingState`): when one construction both auto-declares
 * a name into a scope it created (a binder body) and later declares the same
 * name into a scope that outlives it, the construction is rebuilt once — the
 * rebuild starts from the state every later boxing starts from.
 *
 * Fresh engines throughout: the defect only exists while the symbol is
 * undeclared, so a shared engine would make every case after the first
 * vacuously stable.
 */

// The verbatim Tycho 178(c) witness: `y_r` occurs free in the integrand
// Function literal's body AND as a List sibling, binder operand first.
const WITNESS: MathJsonExpression = [
  'List',
  [
    'Integrate',
    ['Function', ['Block', ['n', 'x', 'y_r']], 'x'],
    ['Limits', 'x', -10, 10],
  ],
  'y_r',
];

describe('first-boxing determinism (Tycho 178(a)+(c))', () => {
  test('the witness: box×2 of a binder+sibling shape is isSame', () => {
    const ce = new ComputeEngine();
    const b1 = ce.box(WITNESS);
    const b2 = ce.box(WITNESS);
    expect(b1.isSame(b2)).toBe(true);
    // And stays stable from there on.
    expect(b2.isSame(ce.box(WITNESS))).toBe(true);
  });

  test('operand order does not matter: sibling-first is stable too', () => {
    const ce = new ComputeEngine();
    const K: MathJsonExpression = [
      'List',
      'y_r',
      [
        'Integrate',
        ['Function', ['Block', ['n', 'x', 'y_r']], 'x'],
        ['Limits', 'x', -10, 10],
      ],
    ];
    expect(ce.box(K).isSame(ce.box(K))).toBe(true);
  });

  test('minimal shape: bare Function literal + sibling, both orders', () => {
    const a = new ComputeEngine();
    const binderFirst: MathJsonExpression = [
      'List',
      ['Function', ['Add', 'q_1', 'w_1'], 'q_1'],
      'w_1',
    ];
    expect(a.box(binderFirst).isSame(a.box(binderFirst))).toBe(true);

    const b = new ComputeEngine();
    const siblingFirst: MathJsonExpression = [
      'List',
      'w_1',
      ['Function', ['Add', 'q_1', 'w_1'], 'q_1'],
    ];
    expect(b.box(siblingFirst).isSame(b.box(siblingFirst))).toBe(true);
  });

  test('Block-scope cousin: free symbol in a Block statement + sibling', () => {
    const ce = new ComputeEngine();
    const K: MathJsonExpression = ['List', ['Block', ['Add', 'm_3', 1]], 'm_3'];
    expect(ce.box(K).isSame(ce.box(K))).toBe(true);
  });

  test('box and parse of the same integral agree, and re-box to parity', () => {
    const ce = new ComputeEngine();
    // The Tycho 178(a) surface: `x` in the integrand and in the bounds names
    // `p`, `q` free — one construction via box, one via parse.
    const a = ce.box([
      'Integrate',
      ['Multiply', 'x', 'x'],
      ['Limits', 'x', 'p', 'q'],
    ]);
    const b = ce.parse('\\int_p^q x\\cdot x\\,\\mathrm{d}x');
    expect(a.isSame(b)).toBe(true);
    expect(ce.box(a.json).isSame(ce.box(b.json))).toBe(true);
  });

  // The two contracts the rejected fix attempts violated (both recorded in
  // the design doc). The repair must keep BOTH.

  test('a body-only free symbol still does not leak to the caller', () => {
    // Attempt 1 (promote the body's declaration outward) failed this: boxing
    // a Function literal must not declare the body's free symbols anywhere
    // the caller can see. The rebuild repair declares nothing new, so the
    // read stays invisible.
    const ce = new ComputeEngine();
    ce.box(['Function', ['Add', 'z_9', 1], 'u_9']);
    expect(ce.lookupDefinition('z_9')).toBeUndefined();
  });

  test('capture through an assigned value still works after the repair', () => {
    // Attempt 2 (ignore auto-declared outward candidates inside a body)
    // failed this: a free body symbol must resolve to a document variable
    // that was auto-declared and then assigned. The repair does not change
    // any resolution rule, so capture is intact.
    const ce = new ComputeEngine();
    ce.box(['Assign', 'v_c', 7]).evaluate();
    ce.box(['Assign', 'f_c', ['Function', ['Multiply', 'v_c', 'x'], 'x']]).evaluate();
    expect(ce.box(['f_c', 2]).evaluate().isSame(14)).toBe(true);
    ce.box(['Assign', 'v_c', 10]).evaluate();
    expect(ce.box(['f_c', 2]).evaluate().isSame(20)).toBe(true);
  });

  test('two binder bodies sharing a free name, no sibling: stable, no leak', () => {
    // No occurrence outside a binder → nothing may be declared, and the two
    // independently body-local bindings must still compare isSame across
    // boxings (they did before the fix too — pinned so the repair never
    // regresses it into either declaring or diverging).
    const ce = new ComputeEngine();
    const T: MathJsonExpression = [
      'List',
      ['Function', ['Add', 'r_7', 1], 's_7'],
      ['Function', ['Add', 'r_7', 2], 't_7'],
    ];
    expect(ce.box(T).isSame(ce.box(T))).toBe(true);
    expect(ce.lookupDefinition('r_7')).toBeUndefined();
  });

  test('pre-declaring the symbol remains stable', () => {
    const ce = new ComputeEngine();
    ce.declare('y_r', 'number');
    expect(ce.box(WITNESS).isSame(ce.box(WITNESS))).toBe(true);
  });
});
