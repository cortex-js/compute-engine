import {
  SYS_HELPERS,
  makeSysHelpers,
} from '../../src/compute-engine/compilation/javascript-runtime';

//
// `_SYS.replaceAtInPlace` writes one list element of an array that the
// compiled code owns. One update at an integer index in `1..length` of a plain
// array is written with no other work; every other case takes the general
// loop. Both cases must give the same array and the same errors.
//

const { replaceAtInPlace } = SYS_HELPERS;

describe('replaceAtInPlace gives the same result on each of its cases', () => {
  test('one update at a positive index writes the array itself', () => {
    const xs = [1, 2, 3];
    const out = replaceAtInPlace(xs, 2, 9);
    expect(out).toBe(xs);
    expect(xs).toEqual([1, 9, 3]);
  });

  test.each([
    ['the first position', 1, [9, 2, 3]],
    ['the last position', 3, [1, 2, 9]],
    ['a negative index', -1, [1, 2, 9]],
    ['the first position from the end', -3, [9, 2, 3]],
    ['a complex index with a zero imaginary part', { re: 2, im: 0 }, [1, 9, 3]],
  ])('%s', (_name, i, expected) => {
    const xs = [1, 2, 3];
    expect(replaceAtInPlace(xs, i, 9)).toBe(xs);
    expect(xs).toEqual(expected);
  });

  test.each([
    ['zero', 0],
    ['past the end', 4],
    ['before the start', -4],
    ['a fraction', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a complex index with an imaginary part', { re: 2, im: 1 }],
    ['a string', '2'],
  ])('an invalid index throws a RangeError: %s', (_name, i) => {
    const xs = [1, 2, 3];
    expect(() => replaceAtInPlace(xs, i, 9)).toThrow(RangeError);
    expect(xs).toEqual([1, 2, 3]);
  });

  test('a string becomes a new array of its characters', () => {
    expect(replaceAtInPlace('abc', 2, 'x')).toEqual(['a', 'x', 'c']);
  });

  test('a chain applies its updates innermost first', () => {
    const xs = [1, 2, 3];
    expect(replaceAtInPlace(xs, 1, 10, 1, 20, -1, 30)).toBe(xs);
    expect(xs).toEqual([20, 2, 30]);
  });

  test('a chain with an invalid index throws', () => {
    expect(() => replaceAtInPlace([1, 2, 3], 1, 10, 0, 20)).toThrow(
      RangeError
    );
  });

  test('an element of another shape is written as it is', () => {
    const xs: unknown[] = [1, 2, 3];
    replaceAtInPlace(xs, 2, [4, 5]);
    expect(xs).toEqual([1, [4, 5], 3]);
  });
});

describe('the helper bundle of a compiled function', () => {
  test('inherits the shared helpers and holds its own', () => {
    const sys = makeSysHelpers({
      random: Math.random,
      iterationLimit: () => 1000,
      frame: () => undefined,
      setFrame: () => {},
      deadline: () => undefined,
    } as never);
    expect(Object.getPrototypeOf(sys)).toBe(SYS_HELPERS);
    for (const name of [
      'drawNextRandomNumber',
      'filterIter',
      'countLoopPass',
      'resetLoopPasses',
      'integrate',
      'integrateMC',
      'atNumeric',
      'atChecked',
    ])
      expect(Object.prototype.hasOwnProperty.call(sys, name)).toBe(true);
    expect(sys.atNumeric).not.toBe(SYS_HELPERS.atNumeric);
    expect(sys.replaceAtInPlace).toBe(SYS_HELPERS.replaceAtInPlace);
  });
});
