import { Expression } from '../../../math-json/math-json-format';
import {
  ExpressionParseHandler,
  LatexDictionary,
  Parser,
  Terminator,
} from '../public';

/**
 * Trigonometric functions have some special conventions that require a
 * custom parser: they can be followed by a "-1" superscript indicating
 * that the inversion function should be used, i.e. "\sin^{-1}" for "arcsin".
 *
 */
function parseTrig(op: string): ExpressionParseHandler {
  return (parser: Parser, until?: Terminator): Expression | null => {
    // Note: names as per NIST-DLMF
    const head: Expression =
      {
        '\\arcsin': 'Arcsin',
        '\\arccos': 'Arccos',
        '\\arctan': 'Arctan',
        '\\arctg': 'Arctan',
        '\\arcctg': 'Arctan',
        '\\arcsec': 'Arcsec',
        '\\arccsc': ' Arccsc',
        '\\arsinh': 'Arsinh',
        '\\arcosh': 'Arcosh',
        '\\artanh': 'Artanh',
        '\\arcsech': 'Arcsech',
        '\\arccsch': 'Arcsch',
        // '\\arg',
        '\\ch': 'Cosh',
        '\\cos': 'Cos',
        '\\cosec': 'Csc',
        '\\cosh': 'Csch',
        '\\cot': 'Cot',
        '\\cotg': 'Cot',
        '\\coth': 'Coth',
        '\\csc': 'Csc',
        '\\ctg': 'Cot',
        '\\cth': 'Coth',
        '\\sec': 'Sec',
        '\\sin': 'Sin',
        '\\sinh': 'Sinh',
        '\\sh': 'Sinh',
        '\\tan': 'Tan',
        '\\tanh': 'Tanh',
        '\\tg': 'Tan',
        '\\th': 'Tanh',
      }[op ?? ''] ??
      op ??
      '';

    if (parser.atTerminator(until)) return head;
    // let isInverse = false;
    // let primeLevel = 0;
    // let sup: Expression | null = null;

    // parser.skipSpace();
    // const start = parser.index;
    // if (parser.match('^')) {
    //   parser.skipSpace();

    //   const superscriptIndex = parser.index;

    //   if (parser.matchAll(['<{>', '-', '1', '<}>'])) isInverse = true;
    //   else {
    //     parser.index = start;

    //     // Count a prime symbol suffix
    //     parser.index = start;
    //     primeLevel = parser.matchPrimeSuffix();

    //     if (primeLevel === 0) {
    //       parser.index = superscriptIndex;
    //       sup = parser.parseGroup() ?? parser.parseToken();
    //     }
    //   }
    // }
    // // Additional primes, after a superscript
    // primeLevel += parser.matchPrimeSuffix();

    // if (isInverse) head = ['InverseFunction', head];

    // if (primeLevel === 1) head = ['Derivative', head];
    // else if (primeLevel > 1) head = ['Derivative', head, primeLevel];

    // If a postfix was applied (inverse, prime...),
    // let the function parser handle the rest
    const fn = parser.parsePostfixOperator(head, until);
    if (fn !== null) return fn;

    const args = parser.parseArguments('implicit', until);

    return args === null ? head : [head, ...args];
  };
}

// function parsePrimeGroup(parser: Parser): number {
//   const start = parser.index;

//   parser.skipSpace();

//   if (!parser.match('<{>')) return 0;

//   let primeLevel = 0;
//   do {
//     parser.skipSpace();
//     if (parser.match('<}>')) return primeLevel;

//     const n = countPrimeLevel(parser);
//     if (n === 0) {
//       parser.index = start;
//       return 0;
//     }
//     primeLevel += n;
//   } while (true);
// }

// function countPrimeLevel(parser: Parser): number {
//   if (parser.match('\\tripleprime')) return 3;
//   if (parser.match('\\doubleprime')) return 2;
//   if (parser.match('\\prime')) return 1;
//   if (parser.match("'")) return 1;
//   return 0;
// }

export const DEFINITIONS_TRIGONOMETRY: LatexDictionary = [
  {
    name: 'Arcsin',
    latexTrigger: ['\\arcsin'],

    parse: parseTrig('Arcsin'),
  },
  {
    name: 'Arccos',
    latexTrigger: ['\\arccos'],

    parse: parseTrig('Arccos'),
  },
  {
    name: 'Arctan',
    latexTrigger: ['\\arctan'],

    parse: parseTrig('Arctan'),
  },
  {
    latexTrigger: ['\\arctg'],

    parse: parseTrig('Arctan'),
  },
  {
    name: 'Arccot',
    latexTrigger: ['\\arcctg'],

    parse: parseTrig('Arccot'),
  },
  {
    name: 'Arcsec',
    latexTrigger: 'arcsec',

    parse: parseTrig('Arcsec'),
  },
  {
    name: 'Arccsc',
    latexTrigger: ['\\arccsc'],

    parse: parseTrig('Arccsc'),
  },
  {
    name: 'Arsinh',
    latexTrigger: ['\\arsinh'],

    parse: parseTrig('Arsinh'),
  },
  {
    name: 'Arcosh',
    latexTrigger: ['\\arcosh'],

    parse: parseTrig('Arcosh'),
  },
  {
    name: 'Artanh',
    latexTrigger: ['\\artanh'],

    parse: parseTrig('Artanh'),
  },
  {
    name: 'Arsech',
    latexTrigger: ['\\arsech'],

    parse: parseTrig('Arsech'),
  },
  {
    name: 'Arcsch',
    latexTrigger: ['\\arcsch'],

    parse: parseTrig('Arcsch'),
  },
  {
    // Rusian hyperbolic cosine
    latexTrigger: ['\\ch'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cosec',
    latexTrigger: ['\\cosec'],

    parse: parseTrig('Cosec'),
  },
  {
    name: 'Cosh',
    latexTrigger: ['\\cosh'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cot',
    latexTrigger: ['\\cot'],

    parse: parseTrig('Cot'),
  },
  {
    latexTrigger: ['\\cotg'],

    parse: parseTrig('Cot'),
  },
  {
    name: 'Coth',
    latexTrigger: ['\\coth'],

    parse: parseTrig('Coth'),
  },
  {
    name: 'Csc',
    latexTrigger: ['\\csc'],

    parse: parseTrig('Csc'),
  },
  {
    // Rusian cotangent
    latexTrigger: ['\\ctg'],

    parse: parseTrig('Cot'),
  },
  {
    latexTrigger: ['\\cth'],

    parse: parseTrig('Cotanh'),
  },
  {
    name: 'Sec',
    latexTrigger: ['\\sec'],

    parse: parseTrig('Sec'),
  },
  {
    name: 'Sinh',
    latexTrigger: ['\\sinh'],

    parse: parseTrig('Sinh'),
  },
  {
    latexTrigger: ['\\sh'],

    parse: parseTrig('Sinh'),
  },
  {
    name: 'Tan',
    latexTrigger: ['\\tan'],

    parse: parseTrig('Tan'),
  },
  {
    latexTrigger: ['\\tg'],

    parse: parseTrig('Tan'),
  },
  {
    name: 'Tanh',
    latexTrigger: ['\\tanh'],

    parse: parseTrig('Tanh'),
  },
  {
    latexTrigger: ['\\th'],

    parse: parseTrig('Tanh'),
  },

  {
    name: 'Cos',
    latexTrigger: ['\\cos'],

    parse: parseTrig('Cos'),
  },
  {
    name: 'Sin',
    latexTrigger: ['\\sin'],

    parse: parseTrig('Sin'),
  },
];
