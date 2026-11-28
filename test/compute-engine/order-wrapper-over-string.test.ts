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

describe('the count of a reordering of a string that is not evaluated yet', () => {
  const count = (json: unknown) => ce.box(json as never).count;

  test('a reordering whose characters are grouped again has no count', () => {
    // `Reverse(mark + "a")` is `"a" + mark`, one character.
    expect(count(['Reverse', str(`${mark}a`)])).toBeUndefined();
    expect(count(['RotateLeft', str(`${mark}a`), 1])).toBeUndefined();
    expect(count(['RotateRight', str(`${mark}a`), 1])).toBeUndefined();
    // The order of `Sort` and `RandomShuffle` is not known before the
    // evaluation.
    expect(count(['Sort', str(`${mark}a`)])).toBeUndefined();
    expect(count(['RandomShuffle', str(`${mark}a`)])).toBeUndefined();
    expect(count(['Sort', str('cab')])).toBeUndefined();
  });

  test('the count agrees with the evaluated string', () => {
    for (const json of [
      ['Reverse', str(`${mark}a`)],
      ['RotateLeft', str(`${mark}a`), 1],
      ['RotateRight', str(`${mark}a`), 1],
      ['RotateLeft', ['Reverse', str(`${mark}ab`)], 1],
      ['Take', ['Reverse', str(`${mark}a`)], 2],
      ['Reverse', str('héllo')],
      ['RotateLeft', str('abc'), 1],
    ]) {
      const c = count(json);
      const v = ce.box(json as never).evaluate();
      expect(typeof v.string).toBe('string');
      if (c !== undefined) expect(c).toBe(v.count);
    }
  });

  test('a reordering that keeps the characters keeps the count', () => {
    expect(count(['Reverse', str('héllo')])).toBe(5);
    expect(count(['RotateLeft', str('abc'), 1])).toBe(3);
    expect(count(['RotateRight', str('abc'), 2])).toBe(3);
    expect(count(['Reverse', ['List', 1, 2, 3]])).toBe(3);
    expect(count(['Sort', ['List', 3, 1, 2]])).toBe(3);
  });

  test('a rotation whose characters are grouped again evaluates to a string', () => {
    const text = (json: unknown) =>
      ce.box(json as never).evaluate().string?.normalize('NFD');
    expect(text(['RotateLeft', str(`${mark}a`), 1])).toBe(`a${mark}`);
    expect(text(['RotateRight', str(`${mark}a`), 1])).toBe(`a${mark}`);
    expect(text(['RotateLeft', str(`${mark}ab`), 1])).toBe(`ab${mark}`);
    ce.assign('s1770', ce.string(`${mark}a`));
    expect(ce.box(['Reverse', 's1770']).count).toBeUndefined();
    expect(text(['RotateLeft', 's1770', 1])).toBe(`a${mark}`);
  });

  test('a count is read without an evaluation of the source', () => {
    // The source is an application: it is not evaluated (a shuffle would
    // draw), so the count is not known.
    expect(count(['Reverse', ['Unique', str('cab')]])).toBeUndefined();
    expect(value(['Reverse', ['Unique', str('cab')]])).toBe("'bac'");
  });

  test('Rest of a string that is not evaluated yet', () => {
    expect(value(['Rest', ['Unique', str('cab')]])).toBe("'ab'");
    expect(value(['Rest', ['Sort', str('cab')]])).toBe("'bc'");
  });

  test('Join of a view over a string that is not evaluated yet', () => {
    // The view has no count, and its walk reads nothing of the source by
    // position: the join evaluates the view first.
    for (const source of [
      ['Sort', str('cab')],
      ['Unique', str('abc')],
    ]) {
      expect(value(['Join', ['Take', source, 2], str('z')])).toBe("'abz'");
      expect(value(['Join', str('z'), ['Drop', source, 1]])).toBe("'zbc'");
      expect(value(['Join', ['Slice', source, 1, 2], str('z')])).toBe("'abz'");
      expect(value(['Join', ['RotateLeft', source, 1], str('z')])).toBe(
        "'bcaz'"
      );
    }
  });

  test('Join of a view gives the join of the value of the view', () => {
    const text = (json: unknown) =>
      ce.box(json as never).evaluate().string?.normalize('NFD');
    const view = ['Take', ['Reverse', str(`${mark}ab`)], 2];
    // `Reverse(mark + "ab")` is `"b" + "a" + mark`, two characters.
    expect(text(view)).toBe(`ba${mark}`);
    expect(text(['Join', view, str('z')])).toBe(`ba${mark}z`);
    expect(text(['Join', str('z'), view])).toBe(`zba${mark}`);
  });

  test('Rest of an empty lazy source with no count', () => {
    expect(
      value([
        'Sum',
        ['Rest', ['FlatMap', ['List', 1], ['Function', ['List'], 'x']]],
      ])
    ).toBe(0);
  });
});
