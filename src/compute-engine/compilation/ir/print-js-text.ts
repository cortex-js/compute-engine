/**
 * The JavaScript spellings of the operations of the string lane (README,
 * "The string lane"; CE-1530): the helpers of `text-runtime.ts`, spread
 * into the `JS` syntax of `print-js.ts`.
 */

export const TEXT = {
  'text.in': '_SYS.ct($0)',
  'text.length': '_SYS.tlength($0)',
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
};
