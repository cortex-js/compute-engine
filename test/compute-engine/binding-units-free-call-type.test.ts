import { ComputeEngine } from '../../src/compute-engine';
import { isFreeCallHead } from '../../src/compute-engine/boxed-expression/type-guards';

// Slice 1 of binding units: a call
// whose head has no definition (a free call head, `isFreeCallHead()`) reads
// the `function` reading of its unit (rule 2 of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). Its type and its
// broadcast behavior are those of a call of a head with the inferred type
// `function`: the result is `unknown`, lifted over a collection operand.

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function withList(): ComputeEngine {
  const ce = engine();
  ce.assign('L', ce.box(['List', 1, 3, 5]));
  return ce;
}

describe('BINDING UNITS: THE TYPE OF A CALL WITH A FREE HEAD', () => {
  test('the call has a free head, and typing it declares no name', () => {
    const ce = engine();
    const call = ce.box(['foo', ['List', 1, 3, 5]]);
    expect(isFreeCallHead(call)).toBe(true);
    expect(call.type.toString()).toBe('list<unknown^3>');
    expect(ce.lookupDefinition('foo')).toBeUndefined();
  });

  test.each([
    ['a scalar operand', ['foo', 'x'], 'unknown'],
    ['no operand', ['foo'], 'unknown'],
    ['a list operand', ['foo', ['List', 1, 3, 5]], 'list<unknown^3>'],
    ['a list and a scalar', ['foo', ['List', 1, 2], 3], 'list<unknown^2>'],
    [
      'lists of different lengths',
      ['foo', ['List', 1, 2], ['List', 3, 4, 5]],
      'list<unknown>',
    ],
    [
      'a nested list',
      ['foo', ['List', ['List', 1, 2], ['List', 3, 4]]],
      'matrix<unknown^(2x2)>',
    ],
    ['a numeric tuple', ['foo', ['Tuple', 1, 2]], 'any'],
    ['a set', ['foo', ['Set', 1, 2]], 'unknown'],
    ['a range', ['foo', ['Range', 1, 5]], 'list<unknown>'],
    [
      'an operator over the call',
      ['Add', ['foo', ['List', 1, 2]], 1],
      'list<unknown^2>',
    ],
  ] as const)('%s', (_label, json, expected) => {
    const ce = engine();
    expect(ce.box(json as any).type.toString()).toBe(expected);
  });

  test('a call over a list symbol is typed as a broadcast', () => {
    const ce = withList();
    expect(ce.box(['foo', 'L']).type.toString()).toBe('list<unknown^3>');
  });

  test('the call promises no shape', () => {
    const ce = engine();
    expect(ce.box(['foo', ['List', 1, 2]]).staticShape).toBeUndefined();
    expect(
      ce.box(['AbsArg', ['foo', ['List', 1, 2]]]).staticShape
    ).toBeUndefined();
  });

  test('a selection over the call is held: no list goes in one cell', () => {
    const ce = withList();
    const value = ce
      .box(['Which', ['Less', 'L', 2], ['foo', 'L'], 'True', 0])
      .evaluate();
    expect(value.json).toEqual([
      'Which',
      ['List', 'True', 'False', 'False'],
      ['foo', ['List', 1, 3, 5]],
      'True',
      0,
    ]);
  });

  test('the call reads a definition of the head made after the boxing', () => {
    const ce = engine();
    const call = ce.box(['foo', ['List', 1, 3, 5]]);
    expect(call.type.toString()).toBe('list<unknown^3>');
    ce.assign('foo', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(call.evaluate().json).toEqual(['List', 2, 6, 10]);
  });
});

describe('BINDING UNITS: ENUMERABILITY OF A CALL WITH A FREE HEAD', () => {
  test('the call is a definite false', () => {
    const ce = engine();
    expect(ce.box(['Total', ['List', 1, 2]]).isEnumerableCollection).toBe(
      false
    );
  });

  test('a broadcast over the call is a definite false', () => {
    const ce = engine();
    const e = ce.box(['Add', 'x', ['Total', ['List', 1, 2]]]);
    expect(e.isEnumerableCollection).toBe(false);
    expect(e.evaluate().isEnumerableCollection).toBe(false);
    expect([...e.evaluate().each()]).toHaveLength(0);
  });
});
