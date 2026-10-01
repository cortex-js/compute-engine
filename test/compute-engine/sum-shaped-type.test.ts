/**
 * The type of `Sum(xs)` when the elements of `xs` are points or rows of
 * numbers. `Sum` adds the elements with `Add`, so a list of points sums to a
 * point, a list of rows to a row, and a matrix to the row of its column
 * sums. Before 2026-09-30 every such sum was typed `number`, and a consumer
 * that read the compiled value as a scalar was wrong.
 *
 * A list with no length may be empty, and the sum of an empty list is `0`,
 * so its sum type is a union with `integer`.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('SUM OF A COLLECTION OF POINTS OR ROWS', () => {
  const ce = new ComputeEngine();
  ce.declare('pts', 'list<tuple<real, real>>');
  ce.declare('ipts', 'list<tuple<integer, integer>>');
  ce.declare('rows', 'list<list<real>>');
  ce.declare('mm', 'matrix<real^(2x3)>');
  ce.declare('three', 'list<tuple<integer, integer>^3>');

  test.each([
    ['pts', 'integer | tuple<real, real>'],
    ['ipts', 'integer | tuple<integer, integer>'],
    ['rows', 'integer | list<real>'],
    ['mm', 'vector<real^3>'],
    ['three', 'tuple<integer, integer>'],
  ])('Sum(%s) is typed %s', (name, type) => {
    expect(ce.box(['Sum', name]).type.toString()).toBe(type);
  });

  test('a literal list of points', () => {
    const e = ce.box(['Sum', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]]);
    expect(e.type.toString()).toBe('tuple<integer, integer>');
    expect(e.evaluate().toString()).toBe('(4, 6)');
  });

  test('a NaN component keeps the point shape', () => {
    const e = ce.box(['Sum', ['List', ['Tuple', 1, 'NaN'], ['Tuple', 2, 3]]]);
    expect(e.evaluate().toString()).toBe('(3, NaN)');
    // The element types differ, so the literal's type is a list with no
    // length, and the union keeps the `integer` of an empty sum.
    expect(e.type.toString()).toBe('integer | tuple<integer, integer | nan>');
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });

  test('a literal matrix sums its columns', () => {
    const e = ce.box(['Sum', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(e.type.toString()).toBe('vector<integer^2>');
    expect(e.evaluate().toString()).toBe('[4,6]');
  });

  test('the value has the type', () => {
    const local = new ComputeEngine();
    local.declare('q', 'list<tuple<real, real>>');
    local.assign('q', local.parse('[(1,2),(3,4)]'));
    const e = local.box(['Sum', 'q']);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
    local.assign('q', local.parse('[]'));
    expect(e.evaluate().toString()).toBe('0');
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });

  test('a sum of numbers keeps its scalar type', () => {
    ce.declare('xs', 'list<integer>');
    expect(ce.box(['Sum', 'xs']).type.toString()).toBe('integer');
  });
});
