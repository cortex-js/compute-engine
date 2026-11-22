/**
 * CE-1319: a point plus an operand whose number type is not stated is typed
 * as a point. A number beside a point has no sum (the evaluation is an
 * `incompatible-type` error), so such an operand adds no `number` arm: the
 * value is a point when the operand holds one. The type was
 * `number | tuple<number, number>`.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('a point plus an operand of unknown type', () => {
  const ce = new ComputeEngine();
  const typeOf = (expr: unknown) => ce.box(expr as never).type.toString();

  test('a free name, a sum and a difference', () => {
    expect(typeOf(['Add', ['Tuple', 1, 2], 'y'])).toBe('tuple<number, number>');
    expect(typeOf(['Subtract', ['Tuple', 1, 2], 'y'])).toBe(
      'tuple<number, number>'
    );
  });

  test('the signature of a function whose parameter is untyped', () => {
    ce.assign('m', ['Function', ['Add', 'q', ['Tuple', 1, 2]], 'q'] as never);
    expect(typeOf('m')).toBe('(q: unknown) -> tuple<number, number>');
  });

  test('a stated number or list of points keeps its answer', () => {
    ce.declare('r', 'real');
    ce.declare('Lp', 'list<tuple<number, number>>');
    expect(typeOf(['Add', ['Tuple', 1, 2], 'r'])).toBe('error');
    expect(typeOf(['Add', ['Tuple', 1, 2], 'Lp'])).toBe(
      'list<tuple<number, number>>'
    );
  });

  test('the value of a point at the operand fits the type', () => {
    const local = new ComputeEngine();
    local.declare('q', 'unknown');
    const sum = local.box(['Add', ['Tuple', 1, 2], 'q']);
    local.assign('q', local.box(['Tuple', 0.5, 0.5]));
    expect(sum.evaluate().type.matches(sum.type)).toBe(true);
  });
});
