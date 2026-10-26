import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-364: arithmetic over a cell whose type is not known claimed the
// tier of the other operand. `2 · u` with `u: broadcastable<unknown>` was
// typed `broadcastable<integer>`, and `2 · [y]` with `y` free narrowed `y`
// to `real` and was typed `vector<real^1>`, although the cell may be any
// number (the scalar `2 · y` narrows `y` to `number`). Each type below must
// hold the value it can take.

const fresh = () => new ComputeEngine();

describe('ARITHMETIC OVER A CELL OF UNKNOWN TYPE', () => {
  test('a broadcastable of unknown cells does not take the tier of a literal', () => {
    const ce = fresh();
    ce.declare('u', 'broadcastable<unknown>');
    // Before: broadcastable<integer> for the first two, broadcastable<real>
    // for the third.
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'list<list<any> | number | tuple> | number | tuple'
    );
    expect(ce.box(['Add', 2, 'u']).type.toString()).toBe(
      'list<list<any> | number | tuple> | number | tuple'
    );
    expect(ce.box(['Multiply', 0.9, 'u']).type.toString()).toBe(
      'list<list<any> | number | tuple> | number | tuple'
    );
  });

  test('a list beside a broadcastable of unknown cells is typed by the broadcastable route', () => {
    const ce = fresh();
    ce.declare('u', 'broadcastable<unknown>');
    // Before: vector<integer^2> for each. `u` may hold a matrix or a ragged
    // list, and its cells may be any number, so each element of the result
    // is a number, a list of any depth or a point (ROADMAP CE-502).
    for (const op of ['Multiply', 'Add', 'Subtract'])
      expect(ce.box([op, ['List', 1, 2], 'u']).type.toString()).toBe(
        'list<list<list<any> | number | tuple> | number | tuple>'
      );
  });

  test('a broadcastable of known cells keeps its tier', () => {
    const ce = fresh();
    ce.declare('b', 'broadcastable<integer>');
    expect(ce.box(['Multiply', 2, 'b']).type.toString()).toBe(
      'broadcastable<integer>'
    );
    expect(ce.box(['Add', 1, 'b']).type.toString()).toBe(
      'broadcastable<integer>'
    );
  });

  test('a free symbol in a list literal is narrowed to number, as a scalar is', () => {
    const ce = fresh();
    // Before: vector<real^1>, and `y` narrowed to `real`.
    expect(ce.box(['Multiply', 2, ['List', 'y']]).type.toString()).toBe(
      'vector<1>'
    );
    expect(ce.box('y').type.toString()).toBe('number');

    const ce2 = fresh();
    ce2.box(['Multiply', 2, 'y']);
    expect(ce2.box('y').type.toString()).toBe('number');
  });

  test('the cells of a list literal decide the tier', () => {
    const ce = fresh();
    expect(ce.box(['Multiply', 2, ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
    ce.declare('r', 'real');
    expect(ce.box(['Multiply', 2, ['List', 'r']]).type.toString()).toBe(
      'vector<real^1>'
    );
  });

  test('the type of a call holds a complex value', () => {
    const ce = fresh();
    ce.assign('w', ce.box(['Function', ['Multiply', 2, ['List', 'x']], 'x']));
    const call = ce.box(['w', 'ImaginaryUnit']);
    const value = call.evaluate();
    // Before: typed vector<real^1>, with the value [2i].
    expect(value.toString()).toBe('[2i]');
    expect(value.type.matches(call.type)).toBe(true);
  });
});
