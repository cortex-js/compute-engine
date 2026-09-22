/**
 * `Map` broadcasts a scalar-parameter callback over a COLLECTION element, the
 * same way a direct application of that callback does (user ruling of
 * 2026-09-22).
 *
 * With `f` declared `(number) -> number`, the direct call `f([1, 2])` answers
 * `[2, 4]`: a callback whose parameters are all scalar is applied element-wise
 * to a collection argument. A callback POSITION is an application too, so
 * `Map(f, [[1, 2], [3, 4]])` applies `f` to each row, which broadcasts, and
 * answers `[[2, 4], [6, 8]]`. Until this ruling the element check at
 * canonicalization compared the row type against the parameter type and
 * reported `incompatible-type`, while the same map over an untyped lambda
 * already broadcast — the two spellings now agree.
 *
 * The admission is narrow. It descends a supply position only as far as the
 * run-time broadcast descends (never into a tuple, a string, or a set), and it
 * lifts the callback's own result by the ranks descended, so a slot that needs
 * a SCALAR answer still refuses: `Filter`'s predicate slot wants `boolean` and
 * a broadcast predicate answers `list<boolean>`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const NESTED = ['List', ['List', 1, 2], ['List', 3, 4]];
const DOUBLE = ['Function', ['Multiply', 2, 'x'], 'x'];

/** An engine holding `f: (number) -> number`, assigned `x ↦ 2x`. */
function engineWithScalarF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', '(number) -> number');
  ce.assign('f', ce.box(DOUBLE));
  return ce;
}

describe('a declared-scalar callback broadcasts over a nested source', () => {
  test('the direct application is the behavior being matched', () => {
    const ce = engineWithScalarF();
    expect(ce.box(['f', ['List', 1, 2]]).evaluate().toString()).toBe('[2,4]');
  });

  test('the box route answers the per-row broadcast', () => {
    const ce = engineWithScalarF();
    expect(ce.box(['Map', 'f', NESTED]).evaluate().toString()).toBe(
      '[[2,4],[6,8]]'
    );
  });

  // `Map` is `lazy`, so its operands arrive unbound on the box and parse
  // routes but pre-boxed through `ce.function`. All three must agree.
  test('the ce.function route answers the per-row broadcast', () => {
    const ce = engineWithScalarF();
    expect(
      ce
        .function('Map', [ce.symbol('f'), ce.box(NESTED)])
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
  });

  test('the parse route answers the per-row broadcast', () => {
    const ce = engineWithScalarF();
    expect(
      ce.parse('\\operatorname{Map}(f, [[1, 2], [3, 4]])').evaluate().toString()
    ).toBe('[[2,4],[6,8]]');
  });

  test('.N() answers the per-row broadcast', () => {
    const ce = engineWithScalarF();
    expect(ce.box(['Map', 'f', NESTED]).N().toString()).toBe('[[2,4],[6,8]]');
  });

  test('the broadcast descends to the leaves of a rank-3 source', () => {
    const ce = engineWithScalarF();
    expect(
      ce
        .box([
          'Map',
          'f',
          ['List', ['List', ['List', 1, 2]], ['List', ['List', 3, 4]]],
        ])
        .evaluate()
        .toString()
    ).toBe('[[[2,4]],[[6,8]]]');
  });

  test('a source only some of whose elements are collections still works', () => {
    const ce = engineWithScalarF();
    expect(
      ce
        .box(['Map', 'f', ['List', ['List', 1, 2], 3]])
        .evaluate()
        .toString()
    ).toBe('[[2,4],6]');
  });

  test('the zip form broadcasts each pair of rows', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number, number) -> number');
    ce.assign('g', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    expect(
      ce.box(['Map', 'g', NESTED, NESTED]).evaluate().toString()
    ).toBe('[[2,4],[6,8]]');
  });
});

describe('an untyped lambda callback is unchanged', () => {
  // An untyped parameter is `broadcastable<T>` by contract, so this spelling
  // already broadcast before the ruling. It is pinned because it is the
  // behavior the declared-scalar spelling is now made to match.
  test('the lambda map answers the per-row broadcast', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Map', DOUBLE, NESTED]).evaluate().toString()).toBe(
      '[[2,4],[6,8]]'
    );
  });
});

describe('a declared-symbol source broadcasts too', () => {
  test('a valueless source stays symbolic and valid', () => {
    const ce = engineWithScalarF();
    ce.declare('xs', 'list<list<number>>');
    const expr = ce.box(['Map', 'f', 'xs']);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toBe('Map(f, "xs")');
  });

  test('it broadcasts once the source has a value', () => {
    const ce = engineWithScalarF();
    ce.declare('xs', 'list<list<number>>');
    ce.assign('xs', ce.box(NESTED));
    expect(ce.box(['Map', 'f', 'xs']).evaluate().toString()).toBe(
      '[[2,4],[6,8]]'
    );
  });
});

describe('a callback whose parameter cannot broadcast keeps the error', () => {
  // The leaf of `[[1, 2], [3, 4]]` is `integer`, which is disjoint from
  // `string`: no descent makes the element reach this parameter.
  test('a string parameter over a list of numbers', () => {
    const ce = new ComputeEngine();
    ce.declare('s', '(string) -> string');
    const result = ce.box(['Map', 's', NESTED]).evaluate().toString();
    expect(result).toContain('incompatible-type');
    expect(result).toContain('(string) -> string');
  });

  // A tuple parameter binds its argument WHOLE — the direct call `h([1, 2])`
  // does not broadcast either — so the admission never applies to it.
  test('a tuple parameter over a list of numbers', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(tuple<number, number>) -> number');
    const result = ce.box(['Map', 'h', NESTED]).evaluate().toString();
    expect(result).toContain('incompatible-type');
    expect(result).toContain('tuple<number, number>');
  });

  // A string is a text atom, not a list of characters, at every broadcast
  // site, so a `character` element is never descended into.
  test('a scalar-number callback over a string source', () => {
    const ce = engineWithScalarF();
    const result = ce.box(['Map', 'f', { str: 'abc' }]).evaluate().toString();
    expect(result).toContain('incompatible-type');
  });
});

describe('a slot that needs a scalar answer keeps the error', () => {
  // The element check is shared by the whole lazy callback family. `Filter`
  // declares a `boolean` result, and a broadcast predicate answers
  // `list<boolean>`, so the admission's lifted result is refused — the same
  // verdict an untyped lambda already got there.
  const predicate = ['Function', ['Greater', 'x', 0], 'x'];

  test('Filter with a declared-scalar predicate', () => {
    const ce = new ComputeEngine();
    ce.declare('p', '(number) -> boolean');
    ce.assign('p', ce.box(predicate));
    expect(ce.box(['Filter', NESTED, 'p']).evaluate().toString()).toContain(
      'incompatible-type'
    );
  });

  test('Filter with an untyped lambda predicate reports the same', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Filter', NESTED, predicate]).evaluate().toString()
    ).toContain('incompatible-type');
  });
});

describe('the compiled JavaScript route agrees with the interpreter', () => {
  test('a caller-supplied nested source broadcasts per row', () => {
    const ce = engineWithScalarF();
    ce.declare('xs', 'list<list<number>>');
    const result = compile(ce.box(['Map', 'f', 'xs']), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({ xs: [[1, 2], [3, 4]] } as any)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  test('a literal nested source broadcasts per row', () => {
    const ce = engineWithScalarF();
    const result = compile(ce.box(['Map', 'f', NESTED]), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({} as any)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  test('an untyped named callback already broadcast', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(DOUBLE));
    ce.declare('ys', 'list<list<number>>');
    const result = compile(ce.box(['Map', 'g', 'ys']), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({ ys: [[1, 2], [3, 4]] } as any)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });
});

describe('the eager validation route admits the same callback', () => {
  // `Sort`, `Ordering`, `GroupBy` and `ChunkBy` check their callback through
  // signature validation (`arrowSlotAdmission`, `boxed-expression/validate.ts`)
  // instead of the lazy operators' own canonical gate. Both routes now take the
  // broadcast admission, so a declared-scalar callback answers there exactly
  // what the equivalent untyped lambda answers.
  const answers = (operator: string, callback: any): string => {
    const ce = new ComputeEngine();
    return ce.box([operator, NESTED, callback]).evaluate().toString();
  };

  test.each(['Sort', 'Ordering', 'GroupBy', 'ChunkBy'])(
    '%s answers what the untyped lambda answers',
    (operator) => {
      const ce = engineWithScalarF();
      const declared = ce.box([operator, NESTED, 'f']);
      expect(declared.isValid).toBe(true);
      expect(declared.evaluate().toString()).toBe(answers(operator, DOUBLE));
    }
  );

  // The values themselves, for the two operators that have one. `Sort` and
  // `Ordering` are left out on purpose. A list is not an ordered value, so
  // `Sort` DECLINES over a list-valued sort key and stays unevaluated, which
  // is also what it does with no callback at all. `Ordering` answers the empty
  // list today, which is a separate defect and NOT the intended answer: with
  // no callback the same source answers the identity permutation, and a
  // permutation of an n-element source must have n entries. The test above
  // compares the declared callback against the untyped lambda, so it keeps
  // passing once that is fixed.
  test('GroupBy groups the rows under their doubled keys', () => {
    const ce = engineWithScalarF();
    expect(ce.box(['GroupBy', NESTED, 'f']).evaluate().toString()).toBe(
      '{"[2,4]" -> [[1,2]], "[6,8]" -> [[3,4]]}'
    );
  });

  test('ChunkBy chunks on the doubled keys', () => {
    const ce = engineWithScalarF();
    expect(ce.box(['ChunkBy', NESTED, 'f']).evaluate().toString()).toBe(
      '[[[1,2]],[[3,4]]]'
    );
  });

  // The control: the leaf of `[[1, 2], [3, 4]]` is `integer`, disjoint from
  // `string`, so no descent makes the element reach this parameter and the
  // error stays.
  test.each(['Sort', 'Ordering', 'GroupBy', 'ChunkBy'])(
    '%s keeps the error for a string parameter',
    (operator) => {
      const ce = new ComputeEngine();
      ce.declare('s', '(string) -> string');
      const result = ce.box([operator, NESTED, 's']).evaluate().toString();
      expect(result).toContain('incompatible-type');
      expect(result).toContain('(string) -> string');
    }
  );
});
