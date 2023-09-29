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

    let fn: Expression | null = head;
    do {
      const pf = parser.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    let sup: Expression | null = null;
    if (parser.match('^')) sup = parser.parseGroup() ?? parser.parseToken();

    const args = parser.parseArguments('implicit', until);

    if (sup !== null) {
      if (args === null) return ['Power', head, sup];
      return ['Power', [head, ...args], sup];
    }

    return args === null ? head : [head, ...args];
  };
}

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
