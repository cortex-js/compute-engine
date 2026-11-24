/**
 * The elements of a string are its grapheme clusters. `Reverse`, `Sort`,
 * `RandomShuffle` and `Unique` of a string return a string whose clusters
 * are formed again: a combining mark (U+0301) moved after a letter joins it.
 * So `Reverse(mark + "a")` is `"a" + mark`, one character where its source
 * has two.
 *
 * `Count`, `Length`, `IsEmpty` and `Contains` look through these wrappers
 * when the call is boxed (`peekWrappers`, `library/collections.ts`). They
 * keep a wrapper whose source can be a string, and count or search the
 * string that the wrapper returns.
 *
 * A lazy string view over a source that is not evaluated yet
 * (`Reverse(Sort("cab"))`) is joined over the value of its source
 * (`evaluateStringPreservingCollection`, `boxed-expression/boxed-function.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();
const value = (json: unknown) => ce.box(json as never).evaluate().json;
const str = (s: string) => ({ str: s });
/** The combining acute accent, U+0301. */
const mark = String.fromCharCode(0x301);

describe('a size or membership query of a wrapper over a string', () => {
  test('the count of the string that the wrapper returns', () => {
    expect(value(['Length', ['Reverse', str(`${mark}a`)]])).toBe(1);
    expect(value(['Count', ['Reverse', str(`${mark}a`)]])).toBe(1);
    // `Sort(mark + "ba")` is `"ab" + mark`, two characters.
    expect(value(['Length', ['Sort', str(`${mark}ba`)]])).toBe(2);
    expect(value(['Length', ['Reverse', ['Sort', str(`${mark}ba`)]]])).toBe(2);
    expect(value(['IsEmpty', ['Reverse', str(`${mark}a`)]])).toBe('False');
  });

  test('the membership of the string that the wrapper returns', () => {
    // `"a" + mark` is one character: it holds neither `"a"` nor the mark
    // alone.
    expect(value(['Contains', ['Reverse', str(`${mark}a`)], str('a')])).toBe(
      'False'
    );
    expect(value(['Contains', ['Reverse', str(`${mark}a`)], str(mark)])).toBe(
      'False'
    );
    expect(value(['Contains', ['Unique', str('aab')], str('a')])).toBe('True');
  });

  test('the wrapper over a string is kept in the canonical form', () => {
    expect(ce.box(['Length', ['Reverse', str('abc')]]).json).toEqual([
      'Length',
      ['Reverse', "'abc'"],
    ]);
    // The count of a shuffled string depends on the draw, so only the form
    // is tested.
    expect(ce.box(['Length', ['RandomShuffle', str('abc')]]).json).toEqual([
      'Length',
      ['RandomShuffle', "'abc'"],
    ]);
    ce.declare('s1403', 'string');
    expect(ce.box(['Count', ['Sort', 's1403']]).json).toEqual([
      'Count',
      ['Sort', 's1403'],
    ]);
  });

  test('a list source is still read without the wrapper', () => {
    expect(ce.box(['Length', ['Reverse', ['List', 3, 1, 2]]]).json).toEqual([
      'Length',
      ['List', 3, 1, 2],
    ]);
  });

  test('the Epsil route', () => {
    const run = (source: string) =>
      executeEpsil(new ComputeEngine(), source).value.json;
    expect(run('length(reverse("\\u{301}a"))')).toBe(1);
    expect(run('length(sort("\\u{301}ba"))')).toBe(2);
  });
});

describe('a string view over a source that is not evaluated yet', () => {
  test('Reverse of a sorted string', () => {
    expect(value(['Reverse', ['Sort', str('cab')]])).toBe("'cba'");
    expect(value(['Reverse', ['Sort', str(`${mark}ba`)]])).toBe(`'b${mark}a'`);
  });

  test('Reverse of a string without duplicates', () => {
    expect(value(['Reverse', ['Unique', str('cab')]])).toBe("'bac'");
  });

  test('the other views of a sorted string', () => {
    const sorted = ['Sort', str('cab')];
    expect(value(['Take', sorted, 2])).toBe("'ab'");
    expect(value(['Take', ['Unique', str('cab')], 2])).toBe("'ca'");
    expect(value(['Drop', sorted, 1])).toBe("'bc'");
    expect(value(['Rest', sorted])).toBe("'bc'");
    expect(value(['RotateLeft', sorted, 1])).toBe("'bca'");
    expect(value(['Slice', sorted, 1, 2])).toBe("'ab'");
    expect(value(['Join', ['Take', sorted, 2], str('z')])).toBe("'abz'");
    expect(value(['Reverse', ['Take', sorted, 2]])).toBe("'ba'");
  });
});
