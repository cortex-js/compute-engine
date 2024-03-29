export function stringToCodepoints(string: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < string.length; i++) {
    let code = string.charCodeAt(i);
    // if (code === 0x0d && string.charCodeAt(i + 1) === 0x0a) {
    //   code = 0x0a;
    //   i++;
    // }

    // if (code === 0x0d || code === 0x0c) code = 0x0a;
    // if (code === 0x00) code = 0xfffd;

    // Decode a surrogate pair into an astral codepoint.
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = string.charCodeAt(i + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        const lead = code - 0xd800;
        const trail = nextCode - 0xdc00;
        code = 2 ** 16 + lead * 2 ** 10 + trail;
        // N = ((H - 0xD800) * 0x400) + (L - 0xDC00) + 0x10000;
        i++;
      }
    }

    result.push(code);
  }

  return result;
}

const ZWJ = 0x200d; // Zero-width joiner

// const ZWSP = 0x200b; // Zero-width space

// Regional indicator: a pair of codepoints indicating some flags
const REGIONAL_INDICATOR = [0x1f1e6, 0x1f1ff];

function isEmojiCombinator(code: number): boolean {
  // Zero-width joiner
  if (code === ZWJ) return true;

  // VS-15: text presentation, VS-16: Emoji presentation
  if (code === 0xfe0e || code === 0xfe0f) return true;

  // EMOJI_MODIFIER_FITZPATRICK_TYPE 1-6
  if (code >= 0x1f3fb && code <= 0x1f3fb + 5) return true;
  // Red hair..white hair
  if (code >= 0x1f9b0 && code <= 0x1f9b0 + 4) return true;
  // EMOJI_TAG
  if (code >= 0xe0020 && code <= 0xe0020 + 96) return true;
  return false;
}

function isRegionalIndicator(code: number): boolean {
  return code >= REGIONAL_INDICATOR[0] && code <= REGIONAL_INDICATOR[1];
}

/**
 * Return a string or an array of graphemes.
 *
 * This includes:
 * - emoji with skin and hair modifiers
 * - emoji combination (for example "female pilot")
 * - text emoji with an emoji presentation style modifier
 *      - U+1F512 U+FE0E 🔒︎
 *      - U+1F512 U+FE0F 🔒️
 * - flags represented as two regional indicator codepoints
 * - flags represented as a flag emoji + zwj + an emoji tag
 * - other combinations (for example, rainbow flag)
 */

export function splitGraphemes(string: string): string | string[] {
  // If it's all ASCII, short-circuit the grapheme splitting...
  if (/^[\u0020-\u00FF]*$/.test(string)) return string;

  const result: string[] = [];

  const codePoints = stringToCodepoints(string);
  let index = 0;
  while (index < codePoints.length) {
    const code = codePoints[index++];

    const next = codePoints[index];
    // Combine sequences
    if (next === ZWJ) {
      // Zero-width joiner sequences are:
      // ZWJ_SEQUENCE := (CHAR + ZWJ)+
      const baseIndex = index - 1;
      index += 2;
      while (codePoints[index] === ZWJ) {
        index += 2;
      }

      result.push(
        String.fromCodePoint(
          ...codePoints.slice(baseIndex, 2 * index - baseIndex + 1)
        )
      );
    } else if (isEmojiCombinator(next)) {
      // Combine emoji sequences
      // See http://unicode.org/reports/tr51/#def_emoji_tag_sequence
      const baseIndex = index - 1; // The previous character is the 'base'
      while (isEmojiCombinator(codePoints[index])) {
        index += codePoints[index] === ZWJ ? 2 : 1;
      }

      result.push(
        String.fromCodePoint(
          ...codePoints.slice(baseIndex, 2 * index - baseIndex - 1)
        )
      );
    } else if (isRegionalIndicator(code)) {
      // Some (but not all) flags are represented by a sequence of two
      // "regional indicators" codepoints.
      index += 1;
      result.push(String.fromCodePoint(...codePoints.slice(index - 2, 2)));
    } else {
      result.push(String.fromCodePoint(code));
    }
  }

  return result;
}
