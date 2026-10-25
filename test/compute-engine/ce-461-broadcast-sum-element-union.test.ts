import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { broadcastShapedResultType } from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

// ROADMAP CE-461: the broadcast type of a list whose elements are lists of
// different ranks (a ragged list) mirrors each arm of the element type. When
// the result for one cell is itself a union that holds a list (the `Add`
// handler answers `list<integer> | number` for `M + C` below), the mirror
// nested that union in the element union and kept an arm that another arm
// holds: `M + C` was typed
// `list<list<list<integer> | number> | list<integer> | number>`, where
// `list<list<integer> | number>` holds `list<integer>`. The element union is
// now flattened and an arm that another arm holds is dropped
// (`raggedBroadcastResultType`, `src/common/type/utils.ts`).

describe('CE-461: the element union of a ragged broadcast is reduced', () => {
  const setUp = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('M', 'list<list<integer> | number>');
    ce.declare('C', 'broadcastable<number>');
    return ce;
  };

  test.each(['Add', 'Subtract'])('the type of %s(M, C) is reduced', (op) => {
    const ce = setUp();
    expect(ce.box([op, 'M', 'C']).type.toString()).toBe(
      'list<list<list<integer> | number> | number>'
    );
    expect(ce.box([op, 'C', 'M']).type.toString()).toBe(
      'list<list<list<integer> | number> | number>'
    );
  });

  // The reduced type still holds every value of the application, ragged
  // and nested lists included.
  const lists: MathJsonExpression[] = [
    ['List', ['List', 1, 2], 3],
    ['List', ['List', 1, 2], ['List', 3, 4]],
    ['List', 5, 6],
  ];
  const others: MathJsonExpression[] = [
    0.5,
    2,
    ['List', 0.5, 1],
    ['List', ['List', 0.5, 1], ['List', 2, 3]],
  ];
  for (const op of ['Add', 'Subtract'])
    for (const m of lists)
      for (const c of others)
        test(`${op}(${JSON.stringify(m)}, ${JSON.stringify(c)}) has the static type`, () => {
          const ce = setUp();
          const staticType = ce.box([op, 'M', 'C']).type;
          ce.assign('M', ce.box(m));
          ce.assign('C', ce.box(c));
          const value = ce.box([op, 'M', 'C']).evaluate();
          expect(value.operator).not.toBe('Error');
          expect(value.type.matches(staticType)).toBe(true);
        });
});

// An arm that states no shape does not absorb a shaped arm. A bare
// collection name such as `list` or `collection` states no shape, as `any`
// does: with a per-element result `list | number`, the arm `list` held the
// mirrored list arm `list<list | number>`, which was dropped, and the
// mirrored rank structure was lost (`list<list | number>`).
describe('CE-461: a bare collection arm keeps the mirrored list arm', () => {
  test.each([
    ['list | number', 'list<list | list<list | number> | number>'],
    [
      'collection | number',
      'list<collection | list<collection | number> | number>',
    ],
  ])('a per-element result %s', (element, expected) => {
    const result = broadcastShapedResultType(
      [parseType('list<list<integer> | integer>')],
      parseType(element)
    );
    expect(typeToString(result)).toBe(expected);
  });
});
