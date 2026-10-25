/**
 * ROADMAP CE-450: an operator over a list with a failed cell was typed
 * `error` but gave a value.
 *
 * A `List` literal that holds a failed cell is a collection, and an operator
 * that reads only the number of its cells keeps the failed cell and answers
 * (`docs/ERROR-MODEL.md` §3): `Length([1, Error("x")])` is `2`. The static
 * type was `error`, which does not hold `2`. An operator that reads the
 * value of the cells (`Sum`) still answers the error and stays typed
 * `error`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

const ce = new ComputeEngine();
const E = ['Error', "'x'"];

function typeAndValue(json: any): [string, string] {
  const expr = ce.box(json);
  return [expr.type.toString(), expr.evaluate().toString()];
}

describe('A CELL COUNT OVER A LIST WITH A FAILED CELL (CE-450)', () => {
  it('types Length of a list with a failed cell as an integer', () => {
    expect(typeAndValue(['Length', ['List', 1, E]])).toEqual(['integer', '2']);
  });

  it('types Length of a list whose cell is a tuple holding a failed cell', () => {
    expect(
      typeAndValue(['Length', ['List', ['Tuple', ['List', 1, E], 2]]])
    ).toEqual(['integer', '1']);
  });

  it('types Count and a sum over Length as integers', () => {
    expect(typeAndValue(['Count', ['List', 1, E, 3]])).toEqual([
      'integer',
      '3',
    ]);
    expect(typeAndValue(['Add', ['Length', ['List', 1, E, 3]], 1])).toEqual([
      'integer',
      '4',
    ]);
  });

  it('types an operator that reads the cells as unknown', () => {
    // The value can be the error of the failed cell (`Sum`) or a valid
    // cell (`First`): `unknown` holds both.
    expect(typeAndValue(['Sum', ['List', 1, E, 3]])).toEqual([
      'unknown',
      'Error("x")',
    ]);
    expect(
      typeAndValue(['Count', ['List', 1, E, 3], ['Function', 'True', 'u']])
    ).toEqual(['unknown', 'Error("x")']);
  });

  test.each([
    ['Dedup', ['Length', ['Dedup', ['List', 1, ['Sqrt', "'a'"], 3]]]],
    [
      'Union',
      [
        'Length',
        ['Union', ['Set', 1, ['Sqrt', "'a'"]], ['Set', 2]],
      ],
    ],
  ])(
    'a count over a view that compares the cells (%s) has a value of its static type',
    (_name, json) => {
      // `Dedup` and `Union` compare the cells to get their cells, so the
      // count of the view can be the error of the failed cell.
      const expr = ce.box(json as any);
      const v = expr.evaluate();
      expect(isSubtype(v.type.type, expr.type.type)).toBe(true);
    }
  );

  test.each([
    [['First', ['List', 1, E, 3]], '1'],
    [['Last', ['List', 1, E, 3]], '3'],
    [['At', ['List', 1, E, 3], 1], '1'],
    [['IsError', ['List', 1, E, 3]], '"False"'],
    [['Element', 1, ['List', 1, E, 3]], '"True"'],
    [['Contains', ['List', 1, E, 3], 1], '"True"'],
    [['IndexOf', ['List', 1, E, 3], 1], '1'],
  ])('a reader of the cells %j is not typed error', (json, value) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).not.toBe('error');
    const v = expr.evaluate();
    expect(v.toString()).toBe(value);
    expect(isSubtype(v.type.type, expr.type.type)).toBe(true);
  });
});

describe('A BROADCAST OVER A LIST WITH A FAILED CELL (CE-450)', () => {
  test.each([
    [['Sin', ['List', 1, E, 3]], 'vector<3>'],
    [['Add', ['List', 1, E, 3], 1], 'vector<integer^3>'],
  ])('%j is typed as a list', (json, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    expect(expr.evaluate().operator).toBe('List');
  });
});
