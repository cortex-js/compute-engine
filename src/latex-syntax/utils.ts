import { MULTIPLY, ADD } from '../common/utils';
import {
  NumberFormattingOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './public';

export const DEFAULT_LATEX_NUMBER_OPTIONS: Required<NumberFormattingOptions> = {
  precision: 15, // assume 2^53 bits floating points
  positiveInfinity: '\\infty',
  negativeInfinity: '-\\infty',
  notANumber: '\\operatorname{NaN}',
  decimalMarker: '.',
  groupSeparator: ',', // for thousands, etc...
  exponentProduct: '\\cdot',
  beginExponentMarker: '10^{', // could be 'e'
  endExponentMarker: '}',
  notation: 'auto',
  truncationMarker: '\\ldots',
  beginRepeatingDigits: '\\overline{',
  endRepeatingDigits: '}',
  imaginaryNumber: '\\imaginaryI',
};

export const DEFAULT_PARSE_LATEX_OPTIONS: Required<ParseLatexOptions> = {
  ...DEFAULT_LATEX_NUMBER_OPTIONS,

  invisibleOperator: MULTIPLY,
  skipSpace: true,

  parseArgumentsOfUnknownLatexCommands: true,
  parseNumbers: true,
  promoteUnknownSymbols: /^[a-zA-Z]$/,
  promoteUnknownFunctions: /^[fg]$/,
  invisiblePlusOperator: ADD,
  preserveLatex: false,
};

export const DEFAULT_SERIALIZE_LATEX_OPTIONS: Required<SerializeLatexOptions> =
  {
    ...DEFAULT_LATEX_NUMBER_OPTIONS,
    invisibleMultiply: '', // '\\cdot',
    invisiblePlus: '', // '+',
    // invisibleApply: '',

    multiply: '\\times',

    // openGroup: '(',
    // closeGroup: ')',
    // divide: '\\frac{#1}{#2}',
    // subtract: '#1-#2',
    // add: '#1+#2',
    // negate: '-#1',
    // squareRoot: '\\sqrt{#1}',
    // nthRoot: '\\sqrt[#2]{#1}',
  };

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a Latex command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z*]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/**
 * Replace '#1', '#2' in the latex template stings with the corresponding
 * values from `replacement`, in a Latex syntax safe manner (i.e. inserting spaces when needed)
 */
export function replaceLatex(template: string, replacement: string[]): string {
  console.assert(typeof template === 'string');
  console.assert(template.length > 0);
  let result = template;
  for (let i = 0; i < replacement.length; i++) {
    let s = replacement[i] ?? '';
    if (/[a-zA-Z*]/.test(s[0])) {
      const m = result.match(new RegExp('(.*)#' + Number(i + 1).toString()));
      if (m && /\\[a-zA-Z*]+/.test(m[1])) {
        s = ' ' + s;
      }
    }
    result = result.replace('#' + Number(i + 1).toString(), s);
  }

  return result;
}
