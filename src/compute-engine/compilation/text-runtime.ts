/**
 * The helpers of the string lane of the IR compiler (`_SYS.<name>`, spelled
 * in `ir/print-js.ts`; CE-1530). Each is the interpreter's algorithm of
 * `library/core.ts` (or `library/collections.ts`) on the same text, over
 * grapheme clusters (`splitGraphemeClusters()`, the segmentation of the
 * interpreter), and each result is conditioned as `engine.string()`
 * conditions a string: NFC, then a lone surrogate replaced with U+FFFD.
 *
 * Every string value of compiled code is conditioned: an input by `ct`
 * (`text.in`), a literal by the engine, a result here. So the helpers read
 * their operands as they are.
 *
 * An operand that the interpreter answers with an error value (a negative
 * or too large count, an empty pad or target) throws a `RangeError` that
 * names the operator and the rule (the caveats of compiled code).
 */

import { splitGraphemeClusters } from '../../common/grapheme-splitter.js';
import { toWellFormedString } from '../../common/well-formed-string.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';

/** `s` as the engine stores a string (the `BoxedString` constructor). */
function condition(s: string): string {
  return toWellFormedString(s.normalize());
}

/** The Unicode White_Space set of `Trim` (`UNICODE_WHITESPACE_CHARACTER` of
 *  `library/core.ts`), as a test of one character. */
const WHITESPACE =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/;

/** A count that the interpreter reads with `asSmallInteger()`: an integer
 *  from `min` to `SMALL_INTEGER`, else its error value (a throw here). */
function domi(n: number, min: number, message: string): number {
  if (!Number.isInteger(n) || n < min || n > SMALL_INTEGER)
    throw new RangeError(message);
  return n;
}

/** A string that must not be empty. */
function doms(s: string, message: string): string {
  if (s === '') throw new RangeError(message);
  return s;
}

/** `TrimStart`, `TrimEnd` and `Trim` (`trimClusters()`): the characters of
 *  `set` (whitespace when `undefined`) removed at the start and/or the end. */
function trimText(
  s: string,
  set: string | undefined,
  start: boolean,
  end: boolean
): string {
  const cs = splitGraphemeClusters(s);
  const members = set === undefined ? undefined : splitGraphemeClusters(set);
  const strip = (c: string) =>
    members === undefined ? WHITESPACE.test(c) : members.includes(c);
  let i = 0;
  let j = cs.length;
  if (start) while (i < j && strip(cs[i])) i += 1;
  if (end) while (j > i && strip(cs[j - 1])) j -= 1;
  return condition(cs.slice(i, j).join(''));
}

/** `PadStart` and `PadEnd` (`padClusters()`). */
function padText(
  s: string,
  n: number,
  pad: string,
  atStart: boolean,
  head: string
): string {
  domi(n, 0, `${head}: n must be a non-negative integer`);
  doms(pad, `${head}: the padding must not be empty`);
  const cs = splitGraphemeClusters(s);
  if (cs.length >= n) return s;
  const ps = splitGraphemeClusters(pad);
  const fill: string[] = [];
  for (let i = 0; i < n - cs.length; i += 1) fill.push(ps[i % ps.length]);
  return condition(atStart ? fill.join('') + s : s + fill.join(''));
}

/** `StringReplace` of a string target (its literal-target arm): at most
 *  `limit` non-overlapping occurrences, left to right, over the clusters of
 *  the subject; the replacement is never scanned again. */
function srep(s: string, target: string, by: string, limit: number): string {
  doms(target, 'StringReplace: the target must not be empty');
  const subject = splitGraphemeClusters(s);
  const needle = splitGraphemeClusters(target);
  const out: string[] = [];
  let i = 0;
  let done = 0;
  while (i < subject.length) {
    if (
      done < limit &&
      i + needle.length <= subject.length &&
      needle.every((c, k) => subject[i + k] === c)
    ) {
      out.push(by);
      i += needle.length;
      done += 1;
    } else {
      out.push(subject[i]);
      i += 1;
    }
  }
  return condition(out.join(''));
}

/** Whether the clusters of `p` are those of `s` at the start (`end` false)
 *  or at the end (`StartsWith`, `EndsWith`; an empty `p` is true). */
function seqat(s: string, p: string, end: boolean): boolean {
  const cs = splitGraphemeClusters(s);
  const ps = splitGraphemeClusters(p);
  if (ps.length > cs.length) return false;
  const off = end ? cs.length - ps.length : 0;
  return ps.every((c, k) => cs[off + k] === c);
}

export const TEXT_HELPERS = {
  /** The read of a string input: conditioned as the engine boxes it. */
  ct: (x: unknown): string => {
    if (typeof x !== 'string')
      throw new TypeError(`expected a string input, got ${typeof x}`);
    return condition(x);
  },
  /** The number of characters (`Length` of a string). */
  tlength: (s: string): number => splitGraphemeClusters(s).length,
  tupper: (s: string): string => condition(s.toUpperCase()),
  tlower: (s: string): string => condition(s.toLowerCase()),
  /** `CaseFold`: upper then lower case, the final sigma made medial. */
  cfold: (s: string): string =>
    condition(s.toUpperCase().toLowerCase().replace(/ς/g, 'σ')),
  trimText,
  padText,
  /** `StringRepeat(s, n)`. */
  trepeat: (s: string, n: number): string =>
    condition(
      s.repeat(domi(n, 0, 'StringRepeat: n must be a non-negative integer'))
    ),
  srep: (s: string, target: string, by: string, n?: number): string =>
    srep(
      s,
      target,
      by,
      n === undefined
        ? Infinity
        : domi(n, 1, 'StringReplace: count must be a positive integer')
    ),
  /** `StringReplace` of a literal pattern (`replaceByPattern()` of
   *  `library/regexp.ts`): `pattern` is the host flags, `/`, the source. */
  rerep: (s: string, pattern: string, by: string, n?: number): string => {
    const limit =
      n === undefined
        ? Infinity
        : domi(n, 1, 'StringReplace: count must be a positive integer');
    const k = pattern.indexOf('/');
    const flags = pattern.slice(0, k);
    const re = new RegExp(
      pattern.slice(k + 1),
      flags.includes('g') ? flags : `${flags}g`
    );
    const out: string[] = [];
    let from = 0;
    let done = 0;
    for (;;) {
      if (done >= limit) break;
      const m = re.exec(s);
      if (m === null) break;
      out.push(s.slice(from, m.index), by);
      from = m.index + m[0].length;
      done += 1;
      if (m[0].length === 0) {
        // Past the code point at the match (`codePointWidthAt()`).
        const step = (s.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
        out.push(s.slice(from, from + step));
        from += step;
        re.lastIndex += step;
        if (re.lastIndex > s.length) break;
      }
    }
    out.push(s.slice(from));
    return condition(out.join(''));
  },
  seqat,
  /** `StringCompare`: the Unicode scalar sequences of `a` and `b`, code
   *  point by code point (`compareScalarSequences()`). */
  cmpc: (a: string, b: string): number => {
    const sa = Array.from(a, (c) => c.codePointAt(0)!);
    const sb = Array.from(b, (c) => c.codePointAt(0)!);
    const n = Math.min(sa.length, sb.length);
    for (let i = 0; i < n; i++)
      if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
    return sa.length === sb.length ? 0 : sa.length < sb.length ? -1 : 1;
  },
  /** `String(a, b)`: the two texts joined. */
  tconcat: (a: string, b: string): string => condition(a + b),
  /** `StringJoin(s, sep)` of a string `s`: its characters, `sep` between. */
  tjoin: (s: string, sep: string): string =>
    condition(splitGraphemeClusters(s).join(sep)),
};
