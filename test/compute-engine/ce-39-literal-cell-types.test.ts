/**
 * The type of a literal list reads a free symbol, and an arithmetic cell
 * over free symbols, as a number: `[u, v]` is typed `vector<2>`.
 *
 * - A free symbol that is an element is NOT inferred as a number: the list
 *   does not require a number, and `[p, q]` can be a list of propositions.
 *   Boxing `[p, q]` made a later `p ∧ q` an `incompatible-type` error.
 *   ROADMAP CE-663 (user decision 2026-10-30, GitHub issue #485), which
 *   reversed option (a) of CE-39.4. With `L := [u, v]`, `At(L, 1)` is typed
 *   `number` and its value `u` is typed `unknown`.
 * - A matrix operator applied to the literal requires numbers, and it infers
 *   the free symbols of the literal as numbers (the `inferOperandTypes`
 *   handler of `List`). The value of `PseudoInverse([[x, y], [z, w]])` is a
 *   matrix.
 * - The free symbols of an arithmetic cell (built with `.neg()` or `.add()`,
 *   which do not infer their operands) are inferred as numbers: the
 *   operator requires a number. ROADMAP CE-39.6 (user decision 2026-10-25,
 *   option (a)).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

function check(expr: Expression): { type: string; valueType: string } {
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return { type: expr.type.toString(), valueType: value.type.toString() };
}

describe('CE-663: A LITERAL LIST DOES NOT INFER ITS FREE SYMBOLS', () => {
  test('At of a list of free symbols', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 'u', 'v']));
    expect(ce.box('u').type.toString()).toBe('unknown');
    const at = ce.box(['At', 'L', 1]);
    expect(at.type.toString()).toBe('number');
    expect(at.evaluate().type.toString()).toBe('unknown');
  });

  test('the parse route does not infer the free symbols either', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('[a, b]').type.toString()).toBe('vector<2>');
    expect(ce.box('a').type.toString()).toBe('unknown');
  });

  test('a boxed list does not make a later boolean use an error', () => {
    // GitHub issue #485.
    const ce = new ComputeEngine();
    ce.box(['List', 'p', 'q']);
    expect(ce.box('p').type.toString()).toBe('unknown');
    expect(ce.box(['And', 'p', 'q']).evaluate().json).toEqual([
      'And',
      'p',
      'q',
    ]);
    expect(ce.box('p').type.toString()).toBe('boolean');
  });

  test('a use that requires a number still infers the symbol', () => {
    const ce = new ComputeEngine();
    ce.box(['List', 'p', 'q']);
    ce.box(['Add', 'p', 1]);
    expect(ce.box('p').type.toString()).toBe('number');
    expect(ce.box('q').type.toString()).toBe('unknown');
  });

  test('a symbol with a type keeps it', () => {
    const ce = new ComputeEngine();
    const list = ce.box(['List', 'A', ['And', 'A', 'B']]);
    expect(list.type.toString()).toBe('list<boolean^2>');
    expect(ce.box('A').type.toString()).toBe('boolean');
  });

  test('a cell that blocks the number reading leaves the symbols unknown', () => {
    const ce = new ComputeEngine();
    const list = ce.box(['List', 'w', ['f', 'z']]);
    expect(list.type.toString()).toBe('list<unknown>');
    expect(ce.box('w').type.toString()).toBe('unknown');
  });
});

describe('CE-39.6: ARITHMETIC CELLS OVER FREE SYMBOLS', () => {
  test('cells built with .neg() and .add() are numbers', () => {
    const ce = new ComputeEngine();
    const n = ce.box('t').neg();
    const s = ce.box('h').add(ce.box('g'));
    expect(n.type.toString()).toBe('unknown');
    const list = ce.function('List', [n, s]);
    expect(list.type.toString()).toBe('vector<2>');
    expect(n.type.toString()).toBe('number');
    expect(s.type.toString()).toBe('number');
    expect(check(ce.box(['At', list, 1]))).toEqual({
      type: 'number',
      valueType: 'number',
    });
  });

  test('AdjugateMatrix of a matrix of free symbols', () => {
    const ce = new ComputeEngine();
    const m = ce.box(['List', ['List', 'x', 'y'], ['List', 'z', 'w']]);
    expect(m.type.toString()).toBe('matrix<2x2>');
    expect(check(ce.box(['AdjugateMatrix', m]))).toEqual({
      type: 'matrix',
      valueType: 'matrix<2x2>',
    });
  });

  test('PseudoInverse of a matrix of free symbols', () => {
    const ce = new ComputeEngine();
    const m = ce.box(['List', ['List', 'x', 'y'], ['List', 'z', 'w']]);
    expect(check(ce.box(['PseudoInverse', m]))).toEqual({
      type: 'matrix',
      valueType: 'matrix<2x2>',
    });
  });
});

describe('CE-663: A MATRIX OPERATOR INFERS THE CELLS OF A LITERAL', () => {
  test('Determinant infers the cells as numbers', () => {
    const ce = new ComputeEngine();
    ce.box(['Determinant', ['List', ['List', 'a', 'b'], ['List', 'c', 'd']]]);
    for (const s of ['a', 'b', 'c', 'd'])
      expect(ce.box(s).type.toString()).toBe('number');
  });

  test('a declared symbol keeps its type', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'integer');
    ce.box(['Determinant', ['List', ['List', 'a', 'b'], ['List', 'c', 'd']]]);
    expect(ce.box('a').type.toString()).toBe('integer');
    expect(ce.box('b').type.toString()).toBe('number');
  });

  test('a vector-or-matrix parameter does not infer the cells', () => {
    // For `matrix | vector`, an element of the literal is a vector or a
    // number, so it gets no single type.
    const ce = new ComputeEngine();
    ce.box([
      'MatrixMultiply',
      ['List', ['List', 'a', 'b']],
      ['List', 'c', 'd'],
    ]);
    expect(ce.box('a').type.toString()).toBe('unknown');
    expect(ce.box('c').type.toString()).toBe('unknown');
  });

  test('an operator that does not require numbers does not infer', () => {
    const ce = new ComputeEngine();
    ce.box(['Length', ['List', 'p', 'q']]);
    expect(ce.box('p').type.toString()).toBe('unknown');
  });
});

describe('CE-39.4: WHICH SYMBOLS A LITERAL LIST READS AS NUMBERS', () => {
  test('a free symbol of a pushed scope is read as a global one is', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const list = ce.box(['List', ['Negate', 'u2'], 'v2']);
    expect(list.type.toString()).toBe('vector<2>');
    expect(ce.box('u2').type.toString()).toBe('number');
    expect(ce.box('v2').type.toString()).toBe('unknown');
    ce.popScope();
  });

  test('a function-literal parameter is not inferred', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['List', 'x'], 'x']);
    expect(f.type.toString()).toBe('(x: unknown) -> list<unknown>');
    // The type of the body reads the parameter as the inference does: not
    // as a number cell.
    expect(f.op1.type.toString()).toBe('list<unknown>');
    expect(ce.box('x').type.toString()).toBe('unknown');
  });

  test('a pattern wildcard is not inferred', () => {
    const ce = new ComputeEngine();
    const list = ce.box(['List', '_a', '_d']);
    expect(list.type.toString()).toBe('list<unknown>');
    expect(ce.box('_a').type.toString()).toBe('unknown');
    expect(ce.box('_d').type.toString()).toBe('unknown');
    // An arithmetic cell built without operand inference (`.neg()`).
    const cell = ce.function('List', [ce.box('_e').neg(), ce.box('_g')]);
    expect(cell.type.toString()).toBe('list<unknown>');
    expect(ce.box('_e').type.toString()).toBe('unknown');
    expect(ce.box('_g').type.toString()).toBe('unknown');
  });
});
