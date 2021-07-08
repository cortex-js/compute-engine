import { Numeric } from './compute-engine-interface';
import {
  LatexToken,
  NumberFormattingOptions,
  ParseLatexOptions,
  Scanner,
  SerializeLatexOptions,
} from './public';
import {
  getApplyFunctionStyle,
  getGroupStyle,
  getRootStyle,
  getFractionStyle,
  getLogicStyle,
  getPowerStyle,
  getNumericSetStyle,
} from './serializer-style';

export const DEFAULT_LATEX_NUMBER_OPTIONS: Required<NumberFormattingOptions> = {
  precision: 15, // assume 2^53 bits floating points
  positiveInfinity: '\\infty',
  negativeInfinity: '-\\infty',
  notANumber: '\\operatorname{NaN}',
  decimalMarker: '.',
  groupSeparator: '\\,', // for thousands, etc...
  exponentProduct: '\\cdot',
  beginExponentMarker: '10^{', // could be 'e'
  endExponentMarker: '}',
  notation: 'auto',
  truncationMarker: '\\ldots',
  beginRepeatingDigits: '\\overline{',
  endRepeatingDigits: '}',
  imaginaryNumber: '\\imaginaryI',
};

export const DEFAULT_PARSE_LATEX_OPTIONS: Required<ParseLatexOptions<Numeric>> =
  {
    applyInvisibleOperator: 'auto',
    skipSpace: true,

    parseArgumentsOfUnknownLatexCommands: true,
    parseNumbers: true,
    parseUnknownToken: (token: LatexToken, _scanner: Scanner) => {
      if (
        [
          '\\displaystyle',
          '\\!',
          '\\:',
          '\\enskip',
          '\\quad',
          '\\,',
          '\\;',
          '\\enspace',
          '\\qquad',
          '\\selectfont',
          '\\tiny',
          '\\scriptsize',
          '\\footnotesize',
          '\\small',
          '\\normalsize',
          '\\large',
          '\\Large',
          '\\LARGE',
          '\\huge',
          '\\Huge',
        ].includes(token)
      ) {
        return 'skip';
      }
      if (/^[fg]$/.test(token)) return 'function';
      if (/^[a-zA-Z]$/.test(token)) return 'symbol';
      return 'error';
    },

    preserveLatex: false,
  };

export const DEFAULT_SERIALIZE_LATEX_OPTIONS: Required<SerializeLatexOptions> =
  {
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
    applyFunctionStyle: getApplyFunctionStyle,
    groupStyle: getGroupStyle,
    rootStyle: getRootStyle,
    fractionStyle: getFractionStyle,
    logicStyle: getLogicStyle,
    powerStyle: getPowerStyle,
    numericSetStyle: getNumericSetStyle,
  };

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a LaTeX command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z*]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/**
 * Replace '#1', '#2' in the LaTeX template stings with the corresponding
 * values from `replacement`, in a LaTeX syntax safe manner (i.e. inserting spaces when needed)
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
