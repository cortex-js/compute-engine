/**
 * A user function with scalar parameters applied to a collection-TYPED symbol
 * that has no value yet is HELD, on every definition route: the argument maps
 * element-wise as soon as it has a value, so an `incompatible-type` or
 * `no-matching-clause` answer at that point would commit too early. A fresh
 * call after the assignment and the held call re-evaluated then agree.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/compute-engine';

function typed(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

describe('user function over a valueless collection-typed symbol', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
  });

  test('a typed scalar parameter holds the call, then maps', () => {
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    const call = ce.box(['h', 'xs']);
    expect(call.evaluate().json).toEqual(['h', 'xs']);
    ce.assign('xs', ce.box(['List', 1, 2]));
    expect(call.evaluate().json).toEqual(['List', 2, 3]);
    expect(ce.box(['h', 'xs']).evaluate().json).toEqual(['List', 2, 3]);
  });

  test('the parse route holds too', () => {
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    expect(ce.parse('h(\\mathrm{xs})').evaluate().json).toEqual(['h', 'xs']);
  });

  test('an untyped parameter holds the call instead of inlining the body', () => {
    // Inlining `(n, n)` as `(xs, xs)` re-evaluates to a tuple of lists, where
    // the held call zips to a list of tuples.
    ce.box([
      'Assign',
      'pair',
      ['Function', ['Tuple', 'n', 'n'], 'n'],
    ]).evaluate();
    const call = ce.box(['pair', 'xs']);
    expect(call.evaluate().json).toEqual(['pair', 'xs']);
    ce.assign('xs', ce.box(['List', 1, 2]));
    expect(call.evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 1],
      ['Tuple', 2, 2],
    ]);
  });

  test('a multi-clause definition holds instead of answering no-matching-clause', () => {
    ce.box([
      'DefineFunction',
      'k',
      ['Function', 0, typed('z', '0')],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'k',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    const call = ce.box(['k', 'xs']);
    expect(call.evaluate().json).toEqual(['k', 'xs']);
    ce.assign('xs', ce.box(['List', 0, 1, 2]));
    expect(call.evaluate().json).toEqual(['List', 0, 2, 3]);
  });

  test('a tuple-typed or string-typed symbol is atomic and applies at once', () => {
    ce.declare('p', 'tuple<number, number>');
    ce.declare('s', 'string');
    ce.box(['Assign', 'seven', ['Function', 7, 'x']]).evaluate();
    expect(ce.box(['seven', 'p']).evaluate().json).toBe(7);
    expect(ce.box(['seven', 's']).evaluate().json).toBe(7);
  });

  test('a set-typed symbol is never mapped over, so it is refused now', () => {
    ce.declare('st', 'set<integer>');
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    expect(ce.box(['h', 'st']).evaluate().toString()).toContain(
      'incompatible-type'
    );
  });

  test('a fixed-shape list symbol is held like a plain list', () => {
    ce.declare('vs', 'vector<3>');
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    const call = ce.box(['h', 'vs']);
    expect(call.evaluate().json).toEqual(['h', 'vs']);
    ce.assign('vs', ce.box(['List', 1, 2, 3]));
    expect(call.evaluate().json).toEqual(['List', 2, 3, 4]);
  });

  test('a symbol aliased to another valueless collection symbol is held', () => {
    ce.declare('ys', 'list<integer>');
    ce.assign('xs', ce.symbol('ys'));
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    const call = ce.box(['h', 'xs']);
    // The held call carries its evaluated operand, the alias target.
    expect(call.evaluate().json).toEqual(['h', 'ys']);
    ce.assign('ys', ce.box(['List', 1, 2]));
    expect(call.evaluate().json).toEqual(['List', 2, 3]);
  });

  test('a collection parameter binds the symbol whole and is not held', () => {
    ce.box([
      'Assign',
      'len',
      ['Function', ['Length', 'v'], typed('v', 'list<integer>')],
    ]).evaluate();
    // `Length` of a valueless list-typed symbol stays symbolic on its own.
    expect(ce.box(['len', 'xs']).evaluate().json).toEqual(['Length', 'xs']);
  });

  test('elements outside the parameter type are still refused once the list has a value', () => {
    ce.declare('ss', 'list<string>');
    ce.box([
      'Assign',
      'h',
      ['Function', ['Add', 'n', 1], typed('n', 'integer')],
    ]).evaluate();
    const call = ce.box(['h', 'ss']);
    expect(call.evaluate().json).toEqual(['h', 'ss']);
    ce.assign('ss', ce.box(['List', { str: 'a' }]));
    expect(call.evaluate().toString()).toContain('incompatible-type');
  });
});
