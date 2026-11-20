/**
 * The lowering of the text operators that is their own (README, "The
 * string lane"; CE-1530): the operands out of their domain, which decline,
 * `String` of an operand that is not text, which declines, `StringReplace`
 * of a literal pattern, `Characters` and `ColorToString` (CE-1548). The
 * other text operators are rows of `operators.ts`, applied by the walk of
 * `lower.ts`.
 */

import type { Expression } from '../../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
} from '../../boxed-expression/type-guards.js';
import { SMALL_INTEGER } from '../../numerics/numeric.js';
import { isSubtype } from '../../../common/type/subtype.js';
import { isLibraryOperator } from '../../library-shadowing.js';
import { COLOR_STRING_FORMATS } from '../../numerics/color-conversion.js';
import { decline, type Fn, type Lowering } from './lower-context.js';
import type { V } from './ir.js';
import type { OperatorRow } from './operators.js';

/** The operations that read a list of strings: its uses that compiled
 *  code admits besides the result (`stringListRefusal()` of `index.ts`).
 *  Each reads the list as its first operand and conditions each element
 *  that it reads: `StringJoin`, an element from 0 in range (`text.elem`,
 *  the reads of `Map`, `Filter`, `Count`, …) and `At` (`text.at`, from 1,
 *  `undefined` out of range, read only by a discharge or as the result;
 *  CE-1556). */
export const TEXT_LIST_READS: readonly string[] = Object.freeze([
  'text.joinl',
  'text.joinl.sep',
  'text.elem',
  'text.at',
]);

/** The regions that make a list of strings besides a `list` instruction:
 *  `Characters` and the builds and filters of the list operators, whose
 *  elements are reads of `TEXT_LIST_READS` or present strings (CE-1556). */
export const TEXT_LIST_MAKERS: readonly string[] = Object.freeze([
  'text.chars',
  'build',
  'filter',
]);

/** A static type of text: a string or a character. */
const isText = (x: Expression): boolean =>
  isSubtype(x.type.type, 'string') || isSubtype(x.type.type, 'character');

/** A row of a string result, or of a string operand when an operand of
 *  `e` is text (`Equal` of two numbers is not text). A node of one is never
 *  evaluated at compile time (`closedValue()` of `lower.ts`): `N()` gives
 *  the decimal text of a number (`String(1/3)`), where the interpreter
 *  gives its exact text. */
export const isTextRow = (r: OperatorRow | undefined, e: Fn): boolean =>
  r?.signatures.some(
    ([a, out]) =>
      out === 'string' || (a.includes('string') && e.ops.some(isText))
  ) === true;

/** The operands of a text operator whose value out of a domain is an error
 *  value of the interpreter: a count of at least that many (and at most
 *  `SMALL_INTEGER`), or a string that is not empty. A literal out of it,
 *  or an operand that the engine proves out of it, declines (a known-bad
 *  call does not compile, user ruling 2026-08-16); the helper throws for
 *  another (`text-runtime.ts`). */
// prettier-ignore
const TEXT_DOMAINS: Readonly<Record<string, [number, number | 'text'][]>> = {
  StringRepeat: [[1, 0]],
  PadStart: [[1, 0], [2, 'text']],
  PadEnd: [[1, 0], [2, 'text']],
  StringReplace: [[1, 'text'], [3, 1]],
};

/** Decline `e` when an operand of its text operator is out of its domain
 *  (`TEXT_DOMAINS`). */
export function checkTextDomains(e: Fn): void {
  // The text of a number follows the formatting options of the engine.
  if (e.operator === 'String' && !e.ops.every(isText))
    decline(e, 'String of an operand that is not a string');
  // Of another collection, the interpreter's `StringJoin` is unevaluated.
  if (
    e.operator === 'StringJoin' &&
    e.nops > 0 &&
    !isText(e.ops[0]) &&
    !isSubtype(e.ops[0].type.type, 'list<string | character>')
  )
    decline(e, 'StringJoin of an operand that is not a list of strings');
  for (const [i, d] of TEXT_DOMAINS[e.operator] ?? []) {
    const x = e.ops[i];
    if (
      x !== undefined &&
      (d === 'text'
        ? x.isEmptyCollection === true
        : isNumber(x)
          ? !(Number.isInteger(x.re) && x.im === 0) ||
            x.re < d ||
            x.re > SMALL_INTEGER
          : (d > 0 ? x.isPositive : x.isNonNegative) === false)
    )
      decline(e, `${e.operator} of an operand out of its domain`);
  }
}

/** `StringReplace(s, RegExp(source, flags), r, count?)` of a literal
 *  pattern: the row `text.rerep` of one string constant, its host flags
 *  (`u` added, as `hostFlags()` of `library/regexp.ts`), `/`, its source;
 *  `undefined` for a target that is not a `RegExp`. */
export function patternReplace(
  e: Fn,
  cx: {
    text: (s: string) => V;
    scalar: (x: Expression) => V;
    apply: (op: string, args: V[]) => V;
  }
): V | undefined {
  const re = e.ops[1];
  if (!isFunction(re, 'RegExp') || e.nops < 3) return undefined;
  if (!isLibraryOperator(re as never, 'RegExp'))
    decline(e, 'StringReplace of a RegExp that is not the library operator');
  const [src, flags] = re.ops;
  const f =
    flags === undefined ? '' : isString(flags) ? flags.string : undefined;
  if (!isString(src) || f === undefined || re.nops > 2)
    decline(e, 'StringReplace of a pattern that is not a literal');
  const pattern = cx.text(`${/[uv]/.test(f) ? f : `${f}u`}/${src.string}`);
  return cx.apply(
    `text.rerep${e.nops === 4 ? '.count' : ''}`,
    e.ops.map((x, i) => (i === 1 ? pattern : cx.scalar(x)))
  );
}

/** `Characters(s)` and `GraphemeClusters(s)` of a string `s`: the region
 *  `text.chars`, whose list result has the count of the clusters as its
 *  length. */
export function characters(e: Fn, cx: Lowering): V {
  if (e.nops !== 1 || !isText(e.ops[0]))
    decline(e, `${e.operator} of an operand that is not a string`);
  const s = cx.scalar(e.ops[0]);
  if (cx.type(s).lane !== 'string')
    decline(e, `${e.operator} of an operand that is not a string`);
  return cx.region('text.chars', [s], [], () => [], e)[1];
}

/** `ColorToString(c, f)` of a format `f` that is absent (`hex`) or a
 *  string literal of `COLOR_STRING_FORMATS`, read without case, and a
 *  colour `c` of which `channels()` gives the space and the three channels
 *  that the interpreter formats: the row `colortostring.<space>.<f>`. A
 *  string operand, another format and another colour decline. */
export function colorToString(
  e: Fn,
  cx: {
    channels: (x: Expression) => [string, V[]] | undefined;
    apply: (op: string, args: V[]) => V;
  }
): V {
  const [c, f] = e.ops;
  const format =
    f === undefined ? 'hex' : isString(f) ? f.string.toLowerCase() : undefined;
  if (e.nops < 1 || e.nops > 2 || format === undefined)
    decline(e, 'ColorToString of a format that is not a string literal');
  if (!COLOR_STRING_FORMATS.includes(format))
    decline(e, `ColorToString of "${format}", which is not a format`);
  if (isText(c)) decline(e, 'ColorToString of a string');
  const read = cx.channels(c);
  if (read === undefined)
    decline(
      e,
      'ColorToString of a colour whose channels are not those of a constructor or of a conversion of one to its own space'
    );
  return cx.apply(`colortostring.${read[0]}.${format}`, read[1]);
}
