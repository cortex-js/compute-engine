import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

// CE-1767: the norm type of a point reads its components from a point written
// out: a `Tuple` literal, or a call of the library `PointList`, whose
// arguments are the components (`pointLiteralComponents`,
// src/compute-engine/library/utils.ts). The CE-1215 change read them from a
// `Tuple` only, so the norm of `PointList(3, 4)` was typed
// `+oo | nan | real` and its `Abs` `number`.

describe('CE-1767: the length of a point written with PointList', () => {
  test.each([
    [['Norm', ['PointList', 3, 4]]],
    [['Abs', ['PointList', 3, 4]]],
    [['Norm', ['Tuple', 3, 4]]],
  ])('%j is typed real and gives 5', (json) => {
    const ce = new ComputeEngine();
    const e = ce.box(json as never);
    expectTypeBetween(e, { atMost: 'real' });
    expect(e.evaluate().re).toBe(5);
  });

  test.each([['Norm'], ['Abs']])(
    '%s of a PointList with a real and a complex coordinate is typed real',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('r', 'real');
      ce.declare('z', 'complex');
      expectTypeBetween(ce.box([op, ['PointList', 'r', 4]]), {
        atMost: 'real',
      });
      expectTypeBetween(ce.box([op, ['PointList', 'z', 4]]), {
        atMost: 'real',
      });
    }
  );

  test('a function of the user named PointList is not read as a point', () => {
    // Its argument is not the coordinate of the point it returns: the point
    // has a list coordinate, and its norm is a list.
    const ce = new ComputeEngine();
    ce.declare('PointList', {
      signature: '(real) -> tuple<list<real>, real>',
      evaluate: ([x]) => ce.box(['Tuple', ['List', x, x], x]),
    });
    const e = ce.box(['Norm', ['PointList', 3]]);
    expectTypeBetween(e, { atMost: 'list<number>' });
    expect(e.evaluate().operator).toBe('List');
  });
});
