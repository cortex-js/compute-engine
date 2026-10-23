/**
 * An index into the scalar arm of a `broadcastable<T>` whose `T` is a tuple
 * or a string.
 *
 * A `broadcastable<T>` is a `T` or a tensor of `T`. A tuple or a string
 * cannot hold a list, so it is one cell for broadcasting: the collection arm
 * of `broadcastable<tuple<number, number>>` is
 * `tensor<tuple<number, number>>`, and `collectionElementType` reads the
 * elements of that arm only. That rule stays
 * (`test/common/type/list-element-tensor-cell.test.ts`).
 *
 * But an index into a value of the `T` arm reads that value. With
 * `p: broadcastable<tuple<number, number>>` holding `(1, 2)`, `At(p, 1)` is
 * `1` and `Take(p, 1)` is the list `[1]`. With `p: broadcastable<string>`
 * holding `"abc"`, `At(p, 1)` is the character `"a"`. The static types were
 * `missing | tensor<tuple<number, number>> | tuple<number, number>`,
 * `list<tuple<number, number>>` and `missing | string | tensor<string>`,
 * which do not hold these values.
 *
 * The fix: `indexElementType` (`src/common/type/utils.ts`), which only the
 * element readers (`At`, `First`, `Second`, `Third`, `Last`) and the
 * selectors (`Take`, `Drop`, `Rest`, `Most`, `Slice`) use, also joins what
 * one index into a value of `T` returns when `T` cannot hold a list but can
 * be indexed: the slots of a tuple, `character` for a string, the field
 * types of a record, the value type of a dictionary. A union `T` is read arm
 * by arm, so a tuple arm beside a `vector<2>` arm adds its slots too.
 *
 * A second fix is in the compiled JavaScript: an operand typed
 * `broadcastable<string>` may be one string at run time, which the generic
 * lowerings read as an array of UTF-16 code units (`At(S, 1)` of `"abc"`
 * was `undefined`). Such an operand now fails closed, and the interpreter
 * evaluates it.
 *
 * Each test reads the static type BEFORE `p` is assigned.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  collectionElementType,
  indexElementType,
} from '../../src/common/type/utils';

type Reading = { value: string; type: string; holds: boolean };

/** The static type of `make(ce)` with `p` declared `decl` and not yet
 * assigned, then the value of the same expression once `p` holds `value`. */
function read(
  decl: string,
  value: unknown,
  make: (ce: ComputeEngine) => Expression
): Reading {
  const ce = new ComputeEngine();
  ce.declare('p', decl);
  const e = make(ce);
  const type = e.type.toString();
  ce.assign('p', ce.box(value as any));
  const v = e.evaluate();
  return { value: v.toString(), type, holds: v.type.matches(e.type) };
}

const boxed = (decl: string, value: unknown, json: unknown): Reading =>
  read(decl, value, (ce) => ce.box(json as any));

const parsed = (decl: string, value: unknown, latex: string): Reading =>
  read(decl, value, (ce) => ce.parse(latex));

const POINT = 'broadcastable<tuple<number, number>>';
const POINT_ELEMENT =
  'missing | number | tensor<tuple<number, number>> | tuple<number, number>';
const POINT_SELECTION =
  'list<number | tensor<tuple<number, number>> | tuple<number, number>>';
const ONE_POINT = ['Tuple', 1, 2];
const TWO_POINTS = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

const TEXT = 'broadcastable<string>';
const TEXT_ELEMENT = 'character | missing | string | tensor<string>';
// A selector of one string is a string; a selector of a tensor of strings
// is a list of its elements, which are strings or tensors of strings.
const TEXT_SELECTION = 'list<string | tensor<string>> | string';
const ONE_STRING = { str: 'abc' };
const TWO_STRINGS = ['List', { str: 'ab' }, { str: 'cd' }];
const RANK_2_STRINGS = ['List', ['List', { str: 'ab' }], ['List', { str: 'cd' }]];

describe('an index into broadcastable<tuple<number, number>>', () => {
  test.each([
    [['At', 'p', 1], '1', POINT_ELEMENT],
    [['At', 'p', -1], '2', POINT_ELEMENT],
    [['At', 'p', 3], 'NaN', POINT_ELEMENT],
    [['At', 'p', ['List', 1, 2]], '[1,2]', `list<${POINT_ELEMENT}>`],
    [['First', 'p'], '1', POINT_ELEMENT],
    [['Second', 'p'], '2', POINT_ELEMENT],
    [['Last', 'p'], '2', POINT_ELEMENT],
    [['Rest', 'p'], '[2]', POINT_SELECTION],
    [['Most', 'p'], '[1]', POINT_SELECTION],
    [['Take', 'p', 1], '[1]', POINT_SELECTION],
    [['Drop', 'p', 1], '[2]', POINT_SELECTION],
    [['Slice', 'p', 1, 2], '[1,2]', POINT_SELECTION],
  ])('%j over one point', (json, value, type) => {
    expect(boxed(POINT, ONE_POINT, json)).toEqual({ value, type, holds: true });
  });

  test.each([
    [['At', 'p', 1], '(1, 2)', POINT_ELEMENT],
    [['At', 'p', -1], '(3, 4)', POINT_ELEMENT],
    [['At', 'p', ['List', 1, 2]], '[(1, 2),(3, 4)]', `list<${POINT_ELEMENT}>`],
    [['First', 'p'], '(1, 2)', POINT_ELEMENT],
    [['Second', 'p'], '(3, 4)', POINT_ELEMENT],
    [['Last', 'p'], '(3, 4)', POINT_ELEMENT],
    [['Rest', 'p'], '[(3, 4)]', POINT_SELECTION],
    [['Most', 'p'], '[(1, 2)]', POINT_SELECTION],
    [['Take', 'p', 1], '[(1, 2)]', POINT_SELECTION],
    [['Drop', 'p', 1], '[(3, 4)]', POINT_SELECTION],
    [['Slice', 'p', 1, 2], '[(1, 2),(3, 4)]', POINT_SELECTION],
    [['At', ['At', 'p', 1], 2], '2', POINT_ELEMENT],
  ])('%j over a list of points', (json, value, type) => {
    expect(boxed(POINT, TWO_POINTS, json)).toEqual({
      value,
      type,
      holds: true,
    });
  });

  test('an index past the end of a list of points is Missing', () => {
    expect(boxed(POINT, TWO_POINTS, ['At', 'p', 3])).toEqual({
      value: '"Missing"',
      type: POINT_ELEMENT,
      holds: true,
    });
  });

  test('a selector of a tensor of points of rank 2 holds its rows', () => {
    // The elements of `tensor<tuple<number, number>>` are points or
    // tensors of points. `Take(p, 1)` was typed `list<tuple<number,
    // number>>`, which does not hold `[[(1, 2)]]`.
    const rank2 = ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 3, 4]]];
    expect(boxed(POINT, rank2, ['Take', 'p', 1])).toEqual({
      value: '[[(1, 2)]]',
      type: POINT_SELECTION,
      holds: true,
    });
  });

  test.each([
    ['p[1]', '1'],
    ['p_1', '1'],
    ['\\mathrm{First}(p)', '1'],
    ['\\mathrm{Last}(p)', '2'],
  ])('the parse route: %s', (latex, value) => {
    expect(parsed(POINT, ONE_POINT, latex)).toEqual({
      value,
      type: POINT_ELEMENT,
      holds: true,
    });
  });

  test.each([
    ['\\mathrm{Take}(p, 1)', '[1]'],
    ['\\mathrm{Rest}(p)', '[2]'],
  ])('the parse route: %s', (latex, value) => {
    expect(parsed(POINT, ONE_POINT, latex)).toEqual({
      value,
      type: POINT_SELECTION,
      holds: true,
    });
  });

  test('a tuple with slots of two types', () => {
    const decl = 'broadcastable<tuple<integer, string>>';
    const element =
      'integer | missing | nan | string | tensor<tuple<integer, string>> | tuple<integer, string>';
    const value = ['Tuple', 1, { str: 'x' }];
    expect(boxed(decl, value, ['At', 'p', 1])).toEqual({
      value: '1',
      type: element,
      holds: true,
    });
    expect(boxed(decl, value, ['At', 'p', 2])).toEqual({
      value: '"x"',
      type: element,
      holds: true,
    });
    expect(boxed(decl, value, ['Rest', 'p'])).toEqual({
      value: '["x"]',
      type: 'list<integer | string | tensor<tuple<integer, string>> | tuple<integer, string>>',
      holds: true,
    });
  });

  test('a tuple arm beside a vector arm adds its slots', () => {
    // The `vector<2>` arm adds `number`; the tuple arm was skipped, so the
    // string slot was not in the type.
    const decl = 'broadcastable<tuple<integer, string> | vector<2>>';
    const value = ['Tuple', 1, { str: 'x' }];
    expect(boxed(decl, value, ['At', 'p', 2])).toEqual({
      value: '"x"',
      type: 'missing | number | string | tuple<integer, string> | vector<2>',
      holds: true,
    });
    for (const json of [
      ['Last', 'p'],
      ['Take', 'p', 2],
    ])
      expect(boxed(decl, value, json).holds).toBe(true);
  });

  test('a tuple whose slots are Nothing', () => {
    // A slot of a tuple holds `Nothing` (`docs/COLLECTIONS-MODEL.md`,
    // "Tuple slots and aligned rows"). The join of the slots with the
    // elements of the collection arm dropped the `nothing` arm.
    const decl = 'broadcastable<tuple<nothing, nothing>>';
    expect(boxed(decl, ['Tuple', 'Nothing', 'Nothing'], ['At', 'p', 1])).toEqual({
      value: '"Nothing"',
      type: 'missing | nothing | tensor<tuple<nothing, nothing>> | tuple<nothing, nothing>',
      holds: true,
    });
  });
});

describe('an index into broadcastable<string>', () => {
  test.each([
    [['At', 'p', 1], '"a"', TEXT_ELEMENT],
    [['At', 'p', -1], '"c"', TEXT_ELEMENT],
    [['At', 'p', ['List', 1, 2]], '["a","b"]', `list<${TEXT_ELEMENT}>`],
    [['First', 'p'], '"a"', TEXT_ELEMENT],
    [['Second', 'p'], '"b"', TEXT_ELEMENT],
    [['Last', 'p'], '"c"', TEXT_ELEMENT],
    // A selector of a string is a string.
    [['Rest', 'p'], '"bc"', TEXT_SELECTION],
    [['Most', 'p'], '"ab"', TEXT_SELECTION],
    [['Take', 'p', 1], '"a"', TEXT_SELECTION],
    [['Drop', 'p', 1], '"bc"', TEXT_SELECTION],
    [['Slice', 'p', 1, 2], '"ab"', TEXT_SELECTION],
  ])('%j over one string', (json, value, type) => {
    expect(boxed(TEXT, ONE_STRING, json)).toEqual({
      value,
      type,
      holds: true,
    });
  });

  test('an index past the end of one string is Missing', () => {
    expect(boxed(TEXT, ONE_STRING, ['At', 'p', 5])).toEqual({
      value: '"Missing"',
      type: TEXT_ELEMENT,
      holds: true,
    });
  });

  test.each([
    [['At', 'p', 1], '"ab"', TEXT_ELEMENT],
    [['At', 'p', -1], '"cd"', TEXT_ELEMENT],
    [['First', 'p'], '"ab"', TEXT_ELEMENT],
    [['Last', 'p'], '"cd"', TEXT_ELEMENT],
    [['Rest', 'p'], '["cd"]', TEXT_SELECTION],
    [['Take', 'p', 1], '["ab"]', TEXT_SELECTION],
    // A `character` arm of the inner read is skipped, as a number arm is:
    // an index into a character is an error.
    [['At', ['At', 'p', 1], 1], '"a"', TEXT_ELEMENT],
  ])('%j over a list of strings', (json, value, type) => {
    expect(boxed(TEXT, TWO_STRINGS, json)).toEqual({
      value,
      type,
      holds: true,
    });
  });

  test.each([
    // The selectors were typed `list<string> | string`, which does not
    // hold a list of tensors of strings.
    [['Take', 'p', 1], '[["ab"]]'],
    [['Drop', 'p', 1], '[["cd"]]'],
    [['Rest', 'p'], '[["cd"]]'],
    [['Most', 'p'], '[["ab"]]'],
    [['Slice', 'p', 1, 2], '[["ab"],["cd"]]'],
  ])('%j over a tensor of strings of rank 2', (json, value) => {
    expect(boxed(TEXT, RANK_2_STRINGS, json)).toEqual({
      value,
      type: TEXT_SELECTION,
      holds: true,
    });
  });

  test.each([
    ['p[1]', '"a"'],
    ['\\mathrm{First}(p)', '"a"'],
    ['\\mathrm{Last}(p)', '"c"'],
  ])('the parse route: %s', (latex, value) => {
    expect(parsed(TEXT, ONE_STRING, latex)).toEqual({
      value,
      type: TEXT_ELEMENT,
      holds: true,
    });
  });

  test('a string arm beside a number arm adds its characters', () => {
    const r = boxed('broadcastable<integer | string>', ONE_STRING, [
      'At',
      'p',
      1,
    ]);
    expect(r).toEqual({
      value: '"a"',
      type: 'character | integer | missing | nan | string | tensor<integer | string>',
      holds: true,
    });
  });
});

describe('an index by key into broadcastable<record> and broadcastable<dictionary>', () => {
  test('a record', () => {
    expect(
      boxed(
        'broadcastable<record{a: integer, b: integer}>',
        ['Dictionary', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]],
        ['At', 'p', { str: 'a' }]
      )
    ).toEqual({
      value: '1',
      type: 'integer | missing | nan | record{a: integer, b: integer} | tensor<record{a: integer, b: integer}>',
      holds: true,
    });
  });

  test('a record with an unknown field', () => {
    // The field types were joined with `widen`, which drops `unknown`
    // beside `integer`: the type excluded the string that field `a` holds.
    // The `unknown` arm absorbs the value arms when the union is reduced.
    expect(
      boxed(
        'broadcastable<record{a: unknown, b: integer}>',
        [
          'Dictionary',
          ['Tuple', { str: 'a' }, { str: 'hello' }],
          ['Tuple', { str: 'b' }, 2],
        ],
        ['At', 'p', { str: 'a' }]
      )
    ).toEqual({ value: '"hello"', type: 'missing | unknown', holds: true });
  });

  test('a dictionary', () => {
    expect(
      boxed(
        'broadcastable<dictionary<integer>>',
        ['Dictionary', ['Tuple', { str: 'a' }, 1]],
        ['At', 'p', { str: 'a' }]
      )
    ).toEqual({
      value: '1',
      type: 'dictionary<integer> | integer | missing | nan | tensor<dictionary<integer>>',
      holds: true,
    });
  });
});

describe('the element type readers', () => {
  const show = (t: ReturnType<typeof indexElementType>) =>
    t === undefined ? 'undefined' : typeToString(t);

  test.each([
    [POINT, 'number | tensor<tuple<number, number>> | tuple<number, number>'],
    [TEXT, 'character | string | tensor<string>'],
  ])('indexElementType(%s) adds the elements of the cell', (decl, expected) => {
    expect(show(indexElementType(parseType(decl)))).toBe(expected);
  });

  test.each([
    [POINT, 'tensor<tuple<number, number>> | tuple<number, number>'],
    [TEXT, 'string | tensor<string>'],
  ])(
    'collectionElementType(%s) still reads a tuple or a string as one cell',
    (decl, expected) => {
      expect(show(collectionElementType(parseType(decl)))).toBe(expected);
    }
  );

  test('a cell that cannot be indexed adds nothing', () => {
    const t = parseType('broadcastable<number>');
    expect(show(indexElementType(t))).toBe(show(collectionElementType(t)));
  });
});

describe('compiled JavaScript', () => {
  test('an index past the end of one point is NaN, as interpreted', () => {
    const ce = new ComputeEngine();
    ce.declare('p', POINT);
    const e = ce.box(['At', 'p', 3]);
    const r = compile(e, { fallback: false });
    expect(r.success).toBe(true);
    // The marker is read from the value: it was `undefined` (`Missing`).
    expect(r.run!({ p: [3, 4] } as any)).toBeNaN();
    expect(r.run!({ p: [[3, 4], [6, 8]] } as any)).toBeUndefined();
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('an index into one point or a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('p', POINT);
    const r = compile(ce.box(['At', 'p', 1]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 4] } as any)).toBe(3);
    expect(r.run!({ p: [[3, 4], [6, 8]] } as any)).toEqual([3, 4]);
  });

  test.each([[['At', 'p', 1]], [['First', 'p']], [['Last', 'p']]])(
    '%j of an operand that may be one string fails closed',
    (json) => {
      // `At(p, 1)` of `"abc"` compiled to `undefined`, and `First(p)` of
      // `"😀b"` to half of a surrogate pair.
      const ce = new ComputeEngine();
      ce.declare('p', TEXT);
      const e = ce.box(json as any);
      expect(compile(e).success).toBe(false);
      ce.assign('p', ce.box({ str: '😀b' }));
      expect(e.evaluate().toString()).toBe(
        json[0] === 'Last' ? '"b"' : '"😀"'
      );
    }
  );
});
