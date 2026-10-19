import { ComputeEngine } from '../../src/compute-engine';

//
// `ListJoin` (the canonical form of a list literal with a spread) is
// associative: `ListJoin(ListJoin(a, b), c)` is `ListJoin(a, b, c)`. The
// canonical form splices a `ListJoin` operand at any position, also when an
// operand holds a failed cell (`docs/ERROR-MODEL.md` §3: a collection keeps a
// failed cell), and folds a join of list literals to one list. A join that
// stays a lazy view merges adjacent list literals. The Epsil route (a list
// grown in a loop) is checked in
// `test/epsil/list-join-nesting-and-if-frame.test.ts`.
//

const ce = new ComputeEngine();

const E = [
  'Error',
  ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
  "'a'",
];
const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

describe('LISTJOIN FLATTEN', () => {
  test('a join of list literals with a failed cell folds to a list', () => {
    const e = ce.box(['ListJoin', ['List'], ['List', E]]);
    expect(e.toString()).toBe(`[${ERR}]`);
    expect(e.isValid).toBe(false);
    expect(e.errors.length).toBe(1);
  });

  test('a nested join with a failed cell is one list', () => {
    const e = ce.box([
      'ListJoin',
      ['ListJoin', ['ListJoin', ['List'], ['List', E]], ['List', 2]],
      ['List', 3],
    ]);
    expect(e.toString()).toBe(`[${ERR},2,3]`);
    expect(e.evaluate().toString()).toBe(`[${ERR},2,3]`);
  });

  test('a nested join with a failed cell and a lazy operand is flat', () => {
    const e = ce.box([
      'ListJoin',
      ['ListJoin', 'xs_1', ['List', E]],
      ['List', 2],
    ]);
    expect(e.json).toEqual(['ListJoin', 'xs_1', ['List', E, 2]]);
  });

  test('a join operand at any position is spliced', () => {
    const e = ce.box([
      'ListJoin',
      'xs_1',
      ['ListJoin', 'ys_1', ['List', 1]],
      ['List', 2],
      'zs_1',
      ['List', 3],
      ['List', 4],
    ]);
    expect(e.json).toEqual([
      'ListJoin',
      'xs_1',
      'ys_1',
      ['List', 1, 2],
      'zs_1',
      ['List', 3, 4],
    ]);
  });

  test('the values of valid joins are unchanged', () => {
    expect(ce.box(['ListJoin', ['List', 1], ['List', 2]]).toString()).toBe(
      '[1,2]'
    );
    const local = new ComputeEngine();
    local.assign('xs', local.box(['List', 5, 6]));
    local.assign('ys', local.box(['Range', 7, 8]));
    const e = local.box([
      'ListJoin',
      'xs',
      ['ListJoin', 'ys', ['List', 1]],
      ['List', 2],
    ]);
    expect(e.evaluate().toString()).toBe('[5,6,7,8,1,2]');
  });

  test('an infinite spread keeps a lazy view with one literal operand', () => {
    const e = ce.box([
      'ListJoin',
      ['ListJoin', ['Range', 1, 'PositiveInfinity'], ['List', 1]],
      ['List', 2],
    ]);
    expect(e.json).toEqual([
      'ListJoin',
      ['Range', 1, 'PositiveInfinity'],
      ['List', 1, 2],
    ]);
    expect(e.evaluate().at(3)?.toString()).toBe('3');
  });

  test('a nested Join with a failed cell folds too', () => {
    const e = ce.box(['Join', ['Join', ['List'], ['List', E]], ['List', 2]]);
    expect(e.toString()).toBe(`[${ERR},2]`);
  });
});
