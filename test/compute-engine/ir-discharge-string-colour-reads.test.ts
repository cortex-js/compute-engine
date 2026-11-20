/**
 * The discharges `IsMissing`, `Coalesce` and `AssertPresent` of a read
 * that can be out of range, on each lane of the IR (`absent()` of
 * `src/compute-engine/compilation/ir/lower.ts`).
 *
 * The producer of a string or a colour that can be absent (an `At` whose
 * index can be out of range) refuses only after the passes. A test that
 * is the constant `false` let `dce` remove that producer once `IsMissing`
 * folded, so `IsMissing(At(["a", "b"], i))` compiled to `false` where the
 * interpreter gives `True` at `i = 9`. Now the test of a string is
 * `=== undefined`, which keeps the read, and `IsMissing` of a colour
 * declines. A discharge either gives the interpreter's value or declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

type Json = unknown;

/** The engine of the compilation: its symbols are unassigned, so each is
 *  an input of the compiled program. */
const ce = new ComputeEngine();
/** The engine of the interpreter, where the symbols hold `inputs`. */
const ie = new ComputeEngine();
for (const e of [ce, ie]) {
  e.declare('i', 'integer');
  e.declare('x', 'real');
  e.declare('s', 'string');
  e.declare('L', 'list<string>');
  e.declare('M', 'matrix<2x2>');
  e.declare('J', 'list<integer>');
}

const inputs = {
  i: 9,
  x: 0.5,
  s: 'ab',
  L: ['a'],
  M: [
    [1, 2],
    [3, 4],
  ],
  J: [1, 2, 3],
};
ie.assign('i', inputs.i);
ie.assign('x', inputs.x);
ie.assign('s', ie.box("'ab'"));
ie.assign('L', ie.box(['List', "'a'"]));
ie.assign('J', ie.box(['List', 1, 2, 3]));

/** The value of the interpreter at `inputs`, as a string. */
function interpret(json: Json): string {
  return ie
    .box(json as never)
    .evaluate()
    .toString();
}

/** The compiled value at `inputs`, or `'declined'`. */
function compiled(
  json: Json,
  to = 'javascript',
  at: Partial<typeof inputs> = {}
): unknown {
  let r: ReturnType<typeof compile>;
  try {
    r = compile(ce.box(json as never), { to, fallback: false } as never);
  } catch {
    return 'declined';
  }
  if (!r.success) return 'declined';
  if (to !== 'javascript') return 'compiled';
  try {
    return r.run!({ ...inputs, ...at } as never);
  } catch (e) {
    return `throws ${(e as Error).message.split(':')[0]}`;
  }
}

const strings: [string, Json][] = [
  ['a literal list', ['At', ['List', "'a'", "'b'"], 'i']],
  ['Characters', ['At', ['Characters', "'ab'"], 'i']],
  ['an input', ['At', 'L', 'i']],
];
const colours: [string, Json][] = [
  [
    'a list of colours',
    ['At', ['List', ['Rgb', 'x', 0, 0], ['Rgb', 0, 'x', 0]], 'i'],
  ],
];

describe('A string read out of range', () => {
  // CE-1556: the read is `text.at`, `undefined` out of range, which the
  // discharges read.
  test.each(strings)('IsMissing of %s is True', (_, read) => {
    expect(interpret(['IsMissing', read])).toBe('"True"');
    expect(compiled(['IsMissing', read])).toBe(true);
  });
  test.each(strings)('Coalesce of %s is the next operand', (_, read) => {
    expect(interpret(['Coalesce', read, "'z'"])).toBe('"z"');
    expect(compiled(['Coalesce', read, "'z'"])).toBe('z');
  });
  test.each(strings)(
    'AssertPresent of %s throws expected-present',
    (_, read) => {
      expect(interpret(['AssertPresent', read])).toContain('expected-present');
      expect(compiled(['AssertPresent', read])).toBe('throws expected-present');
    }
  );
  test.each(strings)('on GLSL, IsMissing of %s declines', (_, read) => {
    expect(compiled(['IsMissing', read], 'glsl')).toBe('declined');
  });
});

describe('A present string', () => {
  const present: [string, Json, string][] = [
    ['an input', 's', 'ab'],
    ['ToUpperCase', ['ToUpperCase', 's'], 'AB'],
    ['a read in range', ['At', ['List', "'a'", "'b'"], 1], 'a'],
  ];
  test.each(present)('the discharges of %s', (_, v, value) => {
    expect(compiled(['IsMissing', v])).toBe(false);
    expect(interpret(['IsMissing', v])).toBe('"False"');
    expect(compiled(['Coalesce', v, "'z'"])).toBe(value);
    expect(compiled(['AssertPresent', v])).toBe(value);
  });
});

describe('A colour read out of range', () => {
  test.each(colours)('IsMissing of %s declines', (_, read) => {
    expect(interpret(['IsMissing', read])).toBe('"True"');
    expect(compiled(['IsMissing', read])).toBe('declined');
    expect(compiled(['IsMissing', read], 'glsl')).toBe('declined');
  });
  test.each(colours)('Coalesce of %s declines', (_, read) => {
    const json = ['Coalesce', read, ['Rgb', 0, 0, 'x']];
    expect(interpret(json)).toBe('Rgb(0, 0, 0.5)');
    expect(compiled(json)).toBe('declined');
    expect(compiled(json, 'glsl')).toBe('declined');
  });
  test.each(colours)('AssertPresent of %s declines', (_, read) => {
    expect(interpret(['AssertPresent', read])).toContain('expected-present');
    expect(compiled(['AssertPresent', read])).toBe('declined');
    expect(compiled(['AssertPresent', read], 'glsl')).toBe('declined');
  });
});

describe('A present colour', () => {
  const rgb = ['Rgb', 'x', 0, 0];
  test('IsMissing declines: a colour has no absent value to test', () => {
    expect(compiled(['IsMissing', rgb])).toBe('declined');
    expect(compiled(['IsMissing', rgb], 'glsl')).toBe('declined');
  });
  test('Coalesce and AssertPresent give the colour', () => {
    const value = compiled(rgb);
    expect(value).not.toBe('declined');
    expect(compiled(['Coalesce', rgb, ['Rgb', 0, 0, 'x']])).toEqual(value);
    expect(compiled(['AssertPresent', rgb])).toEqual(value);
    expect(compiled(['AssertPresent', rgb], 'glsl')).toBe('compiled');
  });
});

describe('The symbols are inputs of the compiled program', () => {
  test('a read in range, and another string', () => {
    const num = ['IsMissing', ['At', ['List', 1, 2], 'i']];
    expect(compiled(num, 'javascript', { i: 1 })).toBe(false);
    expect(compiled(['Coalesce', 's', "'z'"], 'javascript', { s: 'xy' })).toBe(
      'xy'
    );
  });
});

describe('The other lanes, out of range', () => {
  // prettier-ignore
  // The value on JavaScript, and the outcome on GLSL (its value is checked
  // in WebGL by `ir-discharges.test.ts`).
  const reads: [string, Json, unknown, string][] = [
    ['a number', ['At', ['List', 1, 2], 'i'], true, 'compiled'],
    ['a boolean', ['At', ['List', 'True', 'False'], 'i'], true, 'declined'],
    ['a point', ['At', ['List', ['Tuple', 'x', 1], ['Tuple', 1, 'x']], 'i'], true, 'declined'],
    ['a complex number', ['At', ['List', ['Complex', 'x', 1], ['Complex', 1, 'x']], 'i'], 'declined', 'declined'],
    ['a row of a matrix', ['At', ['List', ['List', 1, 2], ['List', 3, 'x']], 'i'], 'declined', 'declined'],
    ['a list of strings', ['At', ['List', ['List', "'a'"], ['List', "'b'"]], 'i'], 'declined', 'declined'],
  ];
  test.each(reads)('IsMissing of %s', (_, read, value, glsl) => {
    expect(interpret(['IsMissing', read])).toBe('"True"');
    expect(compiled(['IsMissing', read])).toBe(value);
    expect(compiled(['IsMissing', read], 'glsl')).toBe(glsl);
  });
  test.each(reads)('AssertPresent of %s', (_, read, value) => {
    expect(compiled(['AssertPresent', read])).toBe(
      value === true ? 'throws expected-present' : 'declined'
    );
  });
  test('the rows of Chunk are never absent', () => {
    expect(interpret(['IsMissing', ['Chunk', 'J', 2]])).toBe('"False"');
    expect(compiled(['IsMissing', ['Chunk', 'J', 2]])).toBe(false);
    expect(compiled(['AssertPresent', ['Chunk', 'J', 2]])).toEqual([
      [1, 2],
      [3],
    ]);
  });
});
