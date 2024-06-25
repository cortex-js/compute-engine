import { Expression } from '../../../math-json/math-json-format';
import {
  ExpressionParseHandler,
  LatexDictionary,
  MULTIPLICATION_PRECEDENCE,
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
    const trigCommands = {
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
      '\\csch': 'Csch',
      '\\ctg': 'Cot',
      '\\cth': 'Coth',
      '\\sec': 'Sec',
      '\\sech': 'Sech',
      '\\sin': 'Sin',
      '\\sinh': 'Sinh',
      '\\sh': 'Sinh',
      '\\tan': 'Tan',
      '\\tanh': 'Tanh',
      '\\tg': 'Tan',
      '\\th': 'Tanh',
    };
    const head: Expression = trigCommands[op ?? ''] ?? op ?? '';

    if (parser.atTerminator(until)) return head;

    let fn: Expression | null = head;
    do {
      const pf = parser.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    let sup: Expression | null = null;
    if (parser.match('^')) sup = parser.parseGroup() ?? parser.parseToken();

    // Look for an implicit argument (a product of terms) but stop if another
    // trig function is encountered, i.e. ensure that
    // "\cos a \sin b" is parsed as "(\cos a)(\sin b)" and not "\cos (a \sin b)"
    const args = parser.parseArguments('implicit', {
      minPrec: MULTIPLICATION_PRECEDENCE,
      condition: (parser) =>
        trigCommands[parser.peek] || (until?.condition?.(parser) ?? false),
    });

    const appliedFn: Expression =
      args === null
        ? fn
        : typeof fn === 'string'
          ? [fn, ...args]
          : ['Apply', fn, ...args];

    return sup === null ? appliedFn : ['Power', appliedFn, sup];
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
    name: 'Csch',
    latexTrigger: ['\\csch'],

    parse: parseTrig('Csch'),
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
    name: 'Sech',
    latexTrigger: ['\\sech'],

    parse: parseTrig('Sech'),
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
