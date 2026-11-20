/**
 * The JavaScript spellings of the operations of the string lane (README,
 * "The string lane"; CE-1530): the helpers of `text-runtime.ts`, spread
 * into the `JS` syntax of `print-js.ts`.
 */

import {
  COLOR_CHANNEL_SPACES,
  COLOR_STRING_FORMATS,
} from '../../numerics/color-conversion.js';
import type { RegionSpelling } from './print.js';

export const TEXT = {
  'text.in': '_SYS.ct($0)',
  'text.length': '_SYS.tlength($0)',
  'text.isundef': '($0 === undefined)',
  'text.upper': '_SYS.tupper($0)',
  'text.lower': '_SYS.tlower($0)',
  'text.fold': '_SYS.cfold($0)',
  'text.trim': '_SYS.trimText($0, undefined, true, true)',
  'text.trim.set': '_SYS.trimText($0, $1, true, true)',
  'text.trimstart': '_SYS.trimText($0, undefined, true, false)',
  'text.trimstart.set': '_SYS.trimText($0, $1, true, false)',
  'text.trimend': '_SYS.trimText($0, undefined, false, true)',
  'text.trimend.set': '_SYS.trimText($0, $1, false, true)',
  'text.repeat': '_SYS.trepeat($0, $1)',
  'text.padstart': `_SYS.padText($0, $1, ' ', true, 'PadStart')`,
  'text.padstart.with': `_SYS.padText($0, $1, $2, true, 'PadStart')`,
  'text.padend': `_SYS.padText($0, $1, ' ', false, 'PadEnd')`,
  'text.padend.with': `_SYS.padText($0, $1, $2, false, 'PadEnd')`,
  'text.replace': '_SYS.srep($0, $1, $2)',
  'text.replace.count': '_SYS.srep($0, $1, $2, $3)',
  'text.rerep': '_SYS.rerep($0, $1, $2)',
  'text.rerep.count': '_SYS.rerep($0, $1, $2, $3)',
  'text.startswith': '_SYS.seqat($0, $1, false)',
  'text.endswith': '_SYS.seqat($0, $1, true)',
  'text.compare': '_SYS.cmpc($0, $1)',
  'text.concat': '_SYS.tconcat($0, $1)',
  'text.empty': "''",
  'text.string': '$0',
  'text.join': '_SYS.tjoin($0, $1)',
  // A list of strings (CE-1548): its elements, each conditioned, joined.
  'text.joinl': "_SYS.tjoinl($0, '')",
  'text.joinl.sep': '_SYS.tjoinl($0, $1)',
  // An element (CE-1556): from 0 in range, or `At`'s index; conditioned.
  'text.elem': '_SYS.tel($0, $1)',
  'text.at': '_SYS.tat($0, $1)',
  'text.eq': '($0 === $1)',
  'text.ne': '($0 !== $1)',
  // `ColorToString` of the channels of a constructor (`javascript-runtime.ts`).
  ...Object.fromEntries(
    COLOR_CHANNEL_SPACES.flatMap((space) =>
      COLOR_STRING_FORMATS.map((f) => [
        `colortostring.${space}.${f}`,
        `_SYS.colorToString('${space}', $0, $1, $2, '${f}')`,
      ])
    )
  ),
};

/** The region rows of the string lane: `Characters(s)`, its grapheme
 *  clusters, each conditioned, and their count. */
export const TEXT_REGIONS: Record<string, RegionSpelling> = {
  'text.chars': ({ outs: [c, out], args: [s] }) => ({
    open: [`const ${out} = _SYS.tchars(${s});`, `const ${c} = ${out}.length;`],
    close: () => [],
  }),
};
