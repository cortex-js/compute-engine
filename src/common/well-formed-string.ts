/**
 * The well-formedness repair of a string, shared by the boxed strings and
 * characters of the engine and by the runtime of compiled code
 * (`compilation/text-runtime.ts`). This module imports nothing.
 */

/**
 * Return `s` with every unpaired UTF-16 surrogate replaced by U+FFFD
 * REPLACEMENT CHARACTER, leaving a string that is already well-formed
 * unchanged.
 *
 * This is the SINGLE well-formedness repair in the engine: both `BoxedString`
 * and `BoxedCharacter` route their content through it, so a string and a
 * character built from the same lone-surrogate source hold the same text (and
 * therefore compare equal, as `isSame` bridges the two kinds). See the
 * `BoxedString` constructor for why segmentation, UTF-8 encoding, equality and
 * serialization all require well-formed content.
 */
export function toWellFormedString(s: string): string {
  // `String.prototype.toWellFormed` (Node ≥ 20) does exactly this replacement;
  // the manual scan below covers older hosts.
  return (
    (s as unknown as { toWellFormed?: () => string }).toWellFormed?.() ??
    replaceLoneSurrogates(s)
  );
}

/**
 * Replace every unpaired UTF-16 surrogate with U+FFFD.
 *
 * The manual fallback for hosts without `String.prototype.toWellFormed`
 * (Node < 20); see `toWellFormedString`, its only caller.
 */
function replaceLoneSurrogates(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += s[i] + s[i + 1];
        i++;
      } else result += '�';
    } else if (code >= 0xdc00 && code <= 0xdfff) result += '�';
    else result += s[i];
  }
  return result;
}
