/**
 * CE-1215: the norm of a point that is the result of a call (`At(LQ, -1)`,
 * `First(LQ)`) has the type of the norm of one point. The type handlers of
 * `Norm`, `Abs` and `Hypot` read the arguments of the call (`LQ`, `-1`) as
 * the components of the point, so the list `LQ` made the norm "broadcast"
 * and the type was `list<number>`, where the value is one number.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('LQ', 'list<tuple<real, real>>');
ce.declare('LB', 'list<tuple<list<real>, real>>');
ce.declare('P', 'tuple<real, real>');
ce.declare('x', 'real');

function typeOf(json: unknown): string {
  return ce.box(json as never).type.toString();
}

describe('the norm of an element of a list of points', () => {
  test.each([
    ['Norm', ['At', 'LQ', -1]],
    ['Norm', ['At', 'LQ', 1]],
    ['Norm', ['First', 'LQ']],
  ])('%s(%j) has the type of Norm(P)', (op, arg) => {
    expect(typeOf([op, arg])).toBe(typeOf(['Norm', 'P']));
  });

  test('Abs and Hypot of an element have the type of a point', () => {
    expect(typeOf(['Abs', ['At', 'LQ', -1]])).toBe(typeOf(['Abs', 'P']));
    expect(typeOf(['Hypot', ['At', 'LQ', -1], 1])).toBe(
      typeOf(['Hypot', 'P', 1])
    );
  });

  test('the value is one number', () => {
    ce.pushScope();
    try {
      ce.declare('LV', 'list<tuple<real, real>>');
      ce.assign('LV', ce.box(['List', ['Tuple', 3, 4], ['Tuple', 6, 8]]));
      expect(ce.box(['Norm', ['At', 'LV', -1]]).evaluate().toString()).toBe(
        '10'
      );
      expect(ce.box(['Abs', ['First', 'LV']]).evaluate().toString()).toBe(
        '5'
      );
    } finally {
      ce.popScope();
    }
  });

  test('an element with a list component still broadcasts', () => {
    expect(typeOf(['Norm', ['At', 'LB', 1]])).toBe('list<number>');
    expect(typeOf(['Abs', ['At', 'LB', 1]])).toBe('list<number>');
  });

  test('a written-out point with a list component still broadcasts', () => {
    expect(typeOf(['Norm', ['Tuple', 'x', ['List', 1, 2]]])).toBe(
      'list<number>'
    );
    expect(typeOf(['Norm', ['Tuple', 'x', 3]])).toBe('real');
  });
});
