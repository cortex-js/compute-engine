import { splitGraphemes } from '../../src/common/grapheme-splitter';

describe('splitGraphemes', () => {
  it('returns the string itself on the all-Latin-1 fast path', () => {
    expect(splitGraphemes('hello')).toBe('hello');
  });

  it('keeps a ZWJ emoji sequence whole without swallowing the next character', () => {
    // Regression: the ZWJ slice used to extend past the sequence, so the
    // following character was both absorbed into the emoji and duplicated
    // ('a👨‍👩‍👧b' → ["a", "👨‍👩‍👧b", "b"]).
    expect(splitGraphemes('a\u{1F468}‍\u{1F469}‍\u{1F467}b')).toEqual(
      ['a', '\u{1F468}‍\u{1F469}‍\u{1F467}', 'b']
    );
  });

  it('keeps an emoji + skin-tone modifier whole mid-string', () => {
    expect(splitGraphemes('a\u{1F44D}\u{1F3FD}b')).toEqual([
      'a',
      '\u{1F44D}\u{1F3FD}',
      'b',
    ]);
  });

  it('keeps a regional-indicator flag pair whole away from the string start', () => {
    // Regression: the slice end was the literal `2`, so flags only survived
    // at position 0.
    expect(splitGraphemes('→\u{1F1EB}\u{1F1F7}x')).toEqual([
      '→',
      '\u{1F1EB}\u{1F1F7}',
      'x',
    ]);
    expect(splitGraphemes('\u{1F1EB}\u{1F1F7}')).toEqual([
      '\u{1F1EB}\u{1F1F7}',
    ]);
  });

  it('keeps a text emoji + presentation selector whole', () => {
    expect(splitGraphemes('\u{1F512}️a')).toEqual(['\u{1F512}️', 'a']);
  });
});
