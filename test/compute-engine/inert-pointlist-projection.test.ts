import { ComputeEngine } from '../../src/compute-engine';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// A `PointList` whose column is collection-typed but has no value yet stays an
// inert head (the fail-closed case of Tycho item 221). A coordinate accessor
// over that head answers the column itself when no other column can shorten
// the zip, and stays unevaluated otherwise (Tycho ledger row 380, ask (a)).

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('s', 'list<number>');
  ce.declare('u', 'list<number>');
  ce.declare('q', 'unknown');
  ce.declare('x0', 'real');
  ce.declare('str', 'string');
  return ce;
}

describe('a coordinate accessor over an inert PointList head', () => {
  test('the head is inert: no collection capability', () => {
    const ce = engine();
    const head = ce.box(['PointList', 1, 's']).evaluate();
    expect(head.operator).toBe('PointList');
    expect(head.isCollection).toBe(false);
  });

  test('projects the valueless column when every other column is a scalar slot', () => {
    const ce = engine();
    const cases: [string, unknown[]][] = [
      ['a number literal', ['PointList', 1, 's']],
      ['a symbol declared real', ['PointList', 'x0', 's']],
      ['a tuple', ['PointList', ['Tuple', 1, 2], 's']],
      ['a string', ['PointList', 'str', 's']],
      ['two scalar slots', ['PointList', 1, 's', 2]],
    ];
    for (const [label, pts] of cases) {
      const position = (pts as unknown[]).indexOf('s');
      const accessor = ['PointX', 'PointY', 'PointZ'][position - 1];
      const v = ce.box([accessor, pts] as never).evaluate();
      expect([label, v.toString()]).toEqual([label, 's']);
      expect(isSymbol(v, 's')).toBe(true);
    }
  });

  test('the numeric approximation of the projection is the column', () => {
    const ce = engine();
    const v = ce.box(['PointY', ['PointList', 1, 's']]).N();
    expect(isSymbol(v, 's')).toBe(true);
  });

  test('stays unevaluated when the chosen column is a scalar slot', () => {
    const ce = engine();
    const v = ce.box(['PointX', ['PointList', 1, 's']]).evaluate();
    expect(v.operator).toBe('PointX');
    expect(isFunction(v) && v.op1.operator).toBe('PointList');
  });

  test('stays unevaluated when another column may be shorter', () => {
    const ce = engine();
    // A second valueless collection column, and a column typed `unknown`,
    // may each resolve to a shorter list than the chosen column.
    for (const other of ['u', 'q']) {
      const v = ce.box(['PointY', ['PointList', other, 's']]).evaluate();
      expect([other, v.operator]).toEqual([other, 'PointY']);
      const w = ce.box(['PointY', ['PointList', 1, 's', other]]).evaluate();
      expect([other, w.operator]).toEqual([other, 'PointY']);
    }
  });

  test('stays unevaluated when another column is a scalar by inference only', () => {
    const ce = engine();
    // `y` is undeclared: its first use as a number infers `number` for it,
    // and an inferred type is not proof (the symbol may still receive a
    // list, and the projection would then answer a list of the wrong
    // length). `x0`, declared `real`, is proof.
    ce.box(['Add', 'y', 1]).evaluate();
    expect(ce.box('y').type.toString()).toBe('number');
    const v = ce.box(['PointY', ['PointList', 'y', 's']]).evaluate();
    expect(v.operator).toBe('PointY');
  });

  test('stays unevaluated over a provably infinite column', () => {
    const ce = engine();
    // `PointList` fails closed on an infinite column, in step with the
    // compile route, so the accessor does not answer that column.
    const v = ce
      .box(['PointY', ['PointList', 1, ['Range', 1, 'PositiveInfinity']]])
      .evaluate();
    expect(v.operator).toBe('PointY');
  });

  test('the projection and the kept form agree once the column resolves', () => {
    const ce = engine();
    const projected = ce.box(['PointY', ['PointList', 1, 's']]).evaluate();
    const kept = ce.box(['PointX', ['PointList', 1, 's']]).evaluate();
    ce.assign('s', ['List', 10, 20]);
    expect(projected.evaluate().json).toEqual(['List', 10, 20]);
    expect(ce.box(['PointY', ['PointList', 1, 's']]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    expect(kept.evaluate().json).toEqual(['List', 1, 1]);
  });

  test('a user function that reads a point list parameter does not embed the head for a projected coordinate', () => {
    const ce = engine();
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', ['PointY', 'v'], 'v']));
    const v = ce.box(['g', ['PointList', 1, 's']]).evaluate();
    expect(isSymbol(v, 's')).toBe(true);
  });
});
