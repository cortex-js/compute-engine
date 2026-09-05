import type { LatexToken } from './types.js';

//
// The delimiter spellings and sizing prefixes the LaTeX parser recognizes.
// They live in their own module, imported by the parser AND by dictionary
// entries that scan tokens themselves (`parseParameterTypeAnnotation`,
// `dictionary/definitions-core.ts`), so that a dictionary file never imports
// the parser module — which loads the dictionary — and no import cycle forms.
//

/** These delimiters can be used as 'shorthand' delimiters in
 * `openTrigger` and `closeTrigger` for `matchfix` operators.
 */
export const DELIMITER_SHORTHAND: { [key: string]: LatexToken[] } = {
  '(': ['\\lparen', '('],
  ')': ['\\rparen', ')'],
  '[': ['\\lbrack', '\\[', '['],
  ']': ['\\rbrack', '\\]', ']'],
  '<': ['<', '\\langle'],
  '>': ['>', '\\rangle'],
  '{': ['\\{', '\\lbrace'],
  '}': ['\\}', '\\rbrace'],
  ':': [':', '\\colon'],
  '|': ['|', '\\|', '\\lvert', '\\rvert'], //special: '\lvert` when open, `\rvert` when close
  '||': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'], // special: `\lVert` when open, `\rVert` when close; `\|` is a self-closing synonym for `\Vert`
  // '\\lfloor': ['\\lfloor'],
  // '\\rfloor': ['\\rfloor'],
  // '\\lceil': ['\\lceil'],
  // '\\rceil': ['\\rceil'],
  // '\\ulcorner': ['\\ulcorner'],
  // '\\urcorner': ['\\urcorner'],
  // '\\llcorner': ['\\llcorner'],
  // '\\lrcorner': ['\\lrcorner'],
  // '\\lgroup': ['\\lgroup'],
  // '\\rgroup': ['\\rgroup'],
  // '\\lmoustache': ['\\lmoustache'],
  // '\\rmoustache': ['\\rmoustache'],
  // '\\llbracket': ['\\llbracket'],
  // '\\rrbracket': ['\\rrbracket'],
};

// const MIDDLE_DELIMITER = {
//   ':': [':', '\\colon'],
//   '|': ['|', '\\|', '\\mid', '\\mvert'],
// };

/** Commands that can be used with an open delimiter, and their corresponding
 * closing commands.
 */

export const OPEN_DELIMITER_PREFIX: Record<string, string> = {
  '\\left': '\\right',
  '\\bigl': '\\bigr',
  '\\Bigl': '\\Bigr',
  '\\biggl': '\\biggr',
  '\\Biggl': '\\Biggr',
  '\\big': '\\big',
  '\\Big': '\\Big',
  '\\bigg': '\\bigg',
  '\\Bigg': '\\Bigg',
  '\\mathopen': '\\mathclose',
  '\\mleft': '\\mright',
};

/** The closing-delimiter commands (e.g. `\right`, `\bigr`) that pair with the
 * `\left`-style open prefixes above. After one of these, a `.` is a TeX *null
 * delimiter*: it produces no visible fence, so `\left(x\right.` is a valid,
 * one-sided enclosure. Used to accept `\right.` when matching a close boundary.
 */
export const CLOSE_DELIMITER_PREFIX = new Set<string>(
  Object.values(OPEN_DELIMITER_PREFIX)
);

