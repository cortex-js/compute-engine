/**
 * ROADMAP CE-39.4 and CE-39.6 (user decisions 2026-10-25, option (a) of
 * each): the type of a literal list reads a free symbol, and an arithmetic
 * cell over free symbols, as a number. The canonical form of the literal
 * now infers each such free symbol as a `number`, as the use `u + 1` does,
 * so the value of an expression is a member of its static type.
 *
 * - With `L := [u, v]`, `At(L, 1)` is typed `number`. Its value `u` was
 *   typed `unknown`; it is now typed `number`.
 * - The value of `AdjugateMatrix([[x, y], [z, w]])` was typed
 *   `list<list<unknown>>`, and the value of `PseudoInverse` of the same
 *   matrix `list<list<broadcastable<number>>>`. Both are now matrices.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

function check(expr: Expression): { type: string; valueType: string } {
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return { type: expr.type.toString(), valueType: value.type.toString() };
}

describe('CE-39.4: A LITERAL LIST INFERS ITS FREE SYMBOLS AS NUMBERS', () => {
  test('At of a list of free symbols', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 'u', 'v']));
    expect(ce.box('u').type.toString()).toBe('number');
    expect(check(ce.box(['At', 'L', 1]))).toEqual({
      type: 'number',
      valueType: 'number',
    });
  });

  test('the parse route infers the free symbols too', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('[a, b]').type.toString()).toBe('vector<2>');
    expect(ce.box('a').type.toString()).toBe('number');
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

describe('CE-39.4: WHICH SYMBOLS A LITERAL LIST INFERS', () => {
  test('a free symbol of a pushed scope is inferred as a global one is', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const list = ce.box(['List', ['Negate', 'u2'], 'v2']);
    expect(list.type.toString()).toBe('vector<2>');
    expect(ce.box('v2').type.toString()).toBe('number');
    ce.assign('L', list);
    expect(check(ce.box(['At', 'L', 2]))).toEqual({
      type: 'number',
      valueType: 'number',
    });
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
