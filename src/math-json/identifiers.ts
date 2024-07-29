let recommendedScriptsRegex: RegExp;

function isRecommendedScripts(text: string): boolean {
  if (!recommendedScriptsRegex) {
    // Define the recommended script property notation from UAX#31Table 5
    // https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts
    const recommendedScripts = [
      'Zyyy',
      'Zinh',
      'Arab',
      'Armn',
      'Beng',
      'Bopo',
      'Cyrl',
      'Deva',
      'Ethi',
      'Geor',
      'Grek',
      'Gujr',
      'Guru',
      'Hang',
      'Hani',
      'Hebr',
      'Hira',
      'Kana',
      'Knda',
      'Khmr',
      'Laoo',
      'Latn',
      'Mlym',
      'Mymr',
      'Orya',
      'Sinh',
      'Taml',
      'Telu',
      'Thaa',
      'Thai',
      'Tibt',
    ];

    // Combine the recommended script properties into a single regex pattern
    const regexPattern = `^[${recommendedScripts
      .map((x) => `\\p{Script=${x}}`)
      .join('')}]*$`;

    recommendedScriptsRegex = new RegExp(regexPattern, 'u');
  }
  // Test if the input text contains only characters from the
  // recommended scripts
  return recommendedScriptsRegex.test(text);
}

/**
 * Return true if the string is a valid identifier.
 *
 * Check for identifiers matching a profile of [Unicode UAX31](https://unicode.org/reports/tr31/)
 *
 * See https://cortexjs.io/math-json/#identifiers for a full definition of the
 * profile.
 */

export function isValidIdentifier(s: string): boolean {
  // Quick check for simple identifiers
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) return true;

  // Is it an emoji, with possibly a ZWJ sequence, as in 👨🏻‍🎤,
  // or flags, or characters that are legacy non-presentation emoji
  // (like the sunglass emoji)?
  if (EMOJIS.test(s)) return true;

  // Only consider recommended scripts
  if (!isRecommendedScripts(s)) return false;

  // Non-ASCII identifiers
  return /^[\p{XIDS}_]\p{XIDC}*$/u.test(s);
}

const VS16 = '\\u{FE0F}'; // Variation Selector-16, forces emoji presentation
const KEYCAP = '\\u{20E3}'; // Combining Enclosing Keycap
const ZWJ = '\\u{200D}'; // Zero Width Joiner

const FLAG_SEQUENCE = '\\p{RI}\\p{RI}';

const TAG_MOD = `(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})`;
const EMOJI_MOD = `(?:\\p{EMod}|${VS16}${KEYCAP}?|${TAG_MOD})`;
const EMOJI_NOT_IDENTIFIER = `(?:(?=\\P{XIDC})\\p{Emoji})`;
const ZWJ_ELEMENT = `(?:${EMOJI_NOT_IDENTIFIER}${EMOJI_MOD}*|\\p{Emoji}${EMOJI_MOD}+|${FLAG_SEQUENCE})`;
const POSSIBLE_EMOJI = `(?:${ZWJ_ELEMENT})(${ZWJ}${ZWJ_ELEMENT})*`;
const SOME_EMOJI = new RegExp(`(?:${POSSIBLE_EMOJI})+`, 'u');
export const EMOJIS = new RegExp(`^(?:${POSSIBLE_EMOJI})+$`, 'u');

// Examine the string and return a string indicating if it's a valid identifier,
// and if not, why not.
// Useful for debugging. In production, use `isValidIdentifier()` instead.
export function validateIdentifier(
  s: unknown
):
  | 'valid'
  | 'not-a-string'
  | 'empty-string'
  | 'expected-nfc'
  | 'unexpected-mixed-emoji'
  | 'unexpected-bidi-marker'
  | 'unexpected-script'
  | 'invalid-first-char'
  | 'invalid-char' {
  if (typeof s !== 'string') return 'not-a-string';

  // console.log([...s].map((x) => x.codePointAt(0)!.toString(16)).join(' '));

  if (s === '') return 'empty-string';

  // MathJSON symbols are always stored in Unicode NFC canonical order.
  // See https://unicode.org/reports/tr15/
  if (s.normalize() !== s) return 'expected-nfc';

  // Does the string contain any bidi marker?
  // See https://www.unicode.org/L2/L2022/22028-bidi-prog.pdf
  // > For identifiers, there should be no need to allow
  // > [bidi control characters] at all, even if formally allowed.
  if (/[\u200E\u200F\u2066-\u2069\u202A-\u202E]/.test(s))
    return 'unexpected-bidi-marker';

  if (EMOJIS.test(s)) return 'valid';

  // Does the string contains some emojis (or flags) mixed with other characters?
  if (/\p{XIDC}/u.test(s) && SOME_EMOJI.test(s))
    return 'unexpected-mixed-emoji';

  // Does the string contain scripts that are not recommended?
  if (!isRecommendedScripts(s)) return 'unexpected-script';

  // It's a supported script, but is it a valid identifier?
  if (!isValidIdentifier(s)) {
    if (!isValidIdentifier(s[0])) return 'invalid-first-char';
    return 'invalid-char';
  }

  return 'valid';
}
