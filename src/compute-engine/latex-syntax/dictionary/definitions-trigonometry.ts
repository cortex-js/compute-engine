import { Expression } from '../../../math-json/types';
import {
  ExpressionParseHandler,
  LatexDictionary,
  MULTIPLICATION_PRECEDENCE,
  Parser,
  Terminator,
} from '../types';

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
      '\\arcctg': 'Arccot',
      '\\arcsec': 'Arcsec', // Non-standard
      '\\arccsc': 'Arccsc', // Non-standard
      '\\arsinh': 'Arsinh', // Non-standard
      '\\arcosh': 'Arccosh', // Non-standard
      '\\arccosh': 'Arccosh',
      '\\artanh': 'Arctanh',
      '\\arctanh': 'Arctanh',
      '\\arsech': 'Arcsech',
      '\\arcsech': 'Arcsech',
      '\\arcsch': 'Arccsch',
      '\\arccsch': 'Arccsch',

      '\\ch': 'Cosh', // Non-standard

      '\\cos': 'Cos',

      '\\cosh': 'Csch',

      '\\cosec': 'Csc', // Non-standard

      '\\cot': 'Cot',
      '\\cotg': 'Cot', // Non-standard
      '\\ctg': 'Cot', // Non-standard

      '\\csc': 'Csc',

      '\\csch': 'Csch', // Non-standard

      '\\coth': 'Coth',
      '\\cth': 'Coth', // Non-standard

      '\\sec': 'Sec',

      '\\sech': 'Sech', // Non-standard

      '\\sin': 'Sin',

      '\\sinh': 'Sinh',
      '\\sh': 'Sinh', // Non-standard

      '\\tan': 'Tan',
      '\\tg': 'Tan', // Non-standard

      '\\tanh': 'Tanh',
      '\\th': 'Tanh', // Non-standard
    };
    const operator: Expression = trigCommands[op ?? ''] ?? op ?? '';

    if (parser.atTerminator(until)) return operator;

    // Check for \sin' x, \sin^{-1} x, etc.
    let fn: Expression | null = operator;
    do {
      const pf = parser.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    parser.skipSpace();

    // Check for \sin^2 x
    let sup: Expression | null = null;
    if (parser.match('^')) sup = parser.parseGroup() ?? parser.parseToken();

    parser.skipSpace();

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
    // Variant, non-standard command
    latexTrigger: ['\\arctg'],
    parse: parseTrig('Arctan'),
  },
  {
    // Variant, symbol
    symbolTrigger: 'arctg',
    parse: parseTrig('Arctan'),
  },
  {
    name: 'Arccot',
    symbolTrigger: 'arcctg',
    parse: parseTrig('Arccot'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arcctg'],
    parse: parseTrig('Arccot'),
  },
  {
    name: 'Arccoth',
    symbolTrigger: 'arccoth',

    parse: parseTrig('Arccoth'),
  },
  {
    // Accept variant with `ar-` prefix
    symbolTrigger: 'arcoth',
    parse: parseTrig('Arccoth'),
  },
  {
    // Accept as symbol
    symbolTrigger: 'arccoth',
    parse: parseTrig('Arccoth'),
  },
  {
    // Accept variant with LaTeX command, even though it's not in ams-math
    latexTrigger: ['\\arccoth'],
    parse: parseTrig('Arccoth'),
  },
  {
    name: 'Arcsec',
    symbolTrigger: 'arcsec',

    parse: parseTrig('Arcsec'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arcsec'],

    parse: parseTrig('Arcsec'),
  },
  {
    name: 'Arccsc',
    symbolTrigger: 'arccsc',

    parse: parseTrig('Arccsc'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arccsc'],

    parse: parseTrig('Arccsc'),
  },
  {
    name: 'Arcsinh',
    symbolTrigger: 'arcsinh',

    parse: parseTrig('Arcsinh'),
  },
  {
    // Variant with `ar-` prefix, non-standard command
    latexTrigger: ['\\arsinh'],

    parse: parseTrig('Arcsinh'),
  },
  {
    // Variant with `arc-` prefix, non-standard command
    latexTrigger: ['\\arcsinh'],

    parse: parseTrig('Arcsinh'),
  },
  {
    name: 'Arccosh',
    symbolTrigger: 'arccosh',

    parse: parseTrig('Arccosh'),
  },
  {
    // Variant, non-standard command
    latexTrigger: '\\arccosh',
    parse: parseTrig('Arccosh'),
  },
  {
    // Variant, non-standard command, with `ar-` prefix
    latexTrigger: '\\arcosh',
    parse: parseTrig('Arccosh'),
  },
  {
    // Variant, with `ar-` prefix
    symbolTrigger: 'arcosh',
    parse: parseTrig('Arccosh'),
  },
  {
    name: 'Arctanh',
    symbolTrigger: 'arctanh',

    parse: parseTrig('Arctanh'),
  },
  {
    // Variant with `ar-` prefix
    symbolTrigger: 'artanh',

    parse: parseTrig('Arctanh'),
  },
  {
    // Variant
    latexTrigger: '\\artanh',
    parse: parseTrig('Arctanh'),
  },
  {
    // Variant
    latexTrigger: ['\\arctanh'],
    parse: parseTrig('Arctanh'),
  },
  {
    // Variant, with `ar-` prefix
    symbolTrigger: 'artanh',
    parse: parseTrig('Arctanh'),
  },
  {
    name: 'Arcsech',
    symbolTrigger: 'arcsech',
    parse: parseTrig('Arcsech'),
  },
  {
    // Variant with `arc-` prefix
    latexTrigger: ['\\arcsech'],
    parse: parseTrig('Arcsech'),
  },
  {
    // Variant with `ar-` prefix
    latexTrigger: ['\\arsech'],
    parse: parseTrig('Arcsech'),
  },
  {
    name: 'Arccsch',
    symbolTrigger: 'arccsch',
    parse: parseTrig('Arccsch'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\arccsch'],
    parse: parseTrig('Arccsch'),
  },
  {
    // Variant, non-standard command, with `ar-` prefix
    latexTrigger: ['\\arcsch'],
    parse: parseTrig('Arccsch'),
  },
  {
    name: 'Cosec',
    symbolTrigger: 'cosec',

    parse: parseTrig('Cosec'),
  },
  {
    // Variant with non-standard command
    latexTrigger: ['\\cosec'],

    parse: parseTrig('Cosec'),
  },
  {
    name: 'Cosh',
    latexTrigger: ['\\cosh'],

    parse: parseTrig('Cosh'),
  },
  {
    // Rusian hyperbolic cosine
    latexTrigger: ['\\ch'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cot',
    latexTrigger: ['\\cot'],

    parse: parseTrig('Cot'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\cotg'],
    parse: parseTrig('Cot'),
  },
  {
    // Rusian cotangent
    latexTrigger: ['\\ctg'],

    parse: parseTrig('Cot'),
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
    name: 'Coth',
    latexTrigger: ['\\coth'],
    parse: parseTrig('Coth'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\cth'],
    parse: parseTrig('Coth'),
  },
  {
    // Variant
    symbolTrigger: 'cth',
    parse: parseTrig('Coth'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\coth'],
    parse: parseTrig('Coth'),
  },
  {
    name: 'Sec',
    latexTrigger: ['\\sec'],

    parse: parseTrig('Sec'),
  },
  {
    name: 'Sech',
    symbolTrigger: 'sech',
    parse: parseTrig('Sech'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\sech'],
    parse: parseTrig('Sech'),
  },
  {
    name: 'Sinh',
    latexTrigger: ['\\sinh'],

    parse: parseTrig('Sinh'),
  },
  {
    // Russian variant
    latexTrigger: ['\\sh'],

    parse: parseTrig('Sinh'),
  },
  {
    name: 'Tan',
    latexTrigger: ['\\tan'],

    parse: parseTrig('Tan'),
  },
  {
    // Variant, non-standard command
    latexTrigger: ['\\tg'],

    parse: parseTrig('Tan'),
  },
  {
    name: 'Tanh',
    latexTrigger: ['\\tanh'],

    parse: parseTrig('Tanh'),
  },
  {
    // Variant, non-standard command
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
