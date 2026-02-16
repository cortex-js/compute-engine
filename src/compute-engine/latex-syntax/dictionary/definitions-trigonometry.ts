import { MathJsonExpression } from '../../../math-json/types';
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
  return (parser: Parser, until?: Terminator): MathJsonExpression | null => {
    // Note: names as per NIST-DLMF
    const trigCommands = {
      '\\arcsin': 'Arcsin',
      '\\arccos': 'Arccos',
      '\\arctan': 'Arctan',
      '\\arctg': 'Arctan',
      '\\arcctg': 'Arccot',
      '\\arcsec': 'Arcsec', // Non-standard
      '\\arccsc': 'Arccsc', // Non-standard
      // Inverse hyperbolic functions use ISO 80000-2 standard names (ar- prefix)
      // We accept both ar- (standard) and arc- (common) spellings
      '\\arsinh': 'Arsinh',
      '\\arcsinh': 'Arsinh',
      '\\arcosh': 'Arcosh',
      '\\arccosh': 'Arcosh',
      '\\artanh': 'Artanh',
      '\\arctanh': 'Artanh',
      '\\arsech': 'Arsech',
      '\\arcsech': 'Arsech',
      '\\arcsch': 'Arcsch',
      '\\arccsch': 'Arcsch',
      '\\arcoth': 'Arcoth',
      '\\arccoth': 'Arcoth',

      '\\ch': 'Cosh', // Non-standard

      '\\cos': 'Cos',

      '\\cosh': 'Cosh',

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
    const operator: MathJsonExpression = trigCommands[op ?? ''] ?? op ?? '';

    if (parser.atTerminator(until)) return operator;

    // Check for \sin' x, \sin^{-1} x, etc.
    let fn: MathJsonExpression | null = operator;
    do {
      const pf = parser.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    parser.skipSpace();

    // Check for \sin^2 x
    let sup: MathJsonExpression | null = null;
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

    const appliedFn: MathJsonExpression =
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
    name: 'Arcoth',
    symbolTrigger: 'arcoth',
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccoth',
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with LaTeX command
    latexTrigger: ['\\arcoth'],
    parse: parseTrig('Arcoth'),
  },
  {
    // Accept variant with `arc-` prefix LaTeX command
    latexTrigger: ['\\arccoth'],
    parse: parseTrig('Arcoth'),
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
    name: 'Arsinh',
    symbolTrigger: 'arsinh',
    parse: parseTrig('Arsinh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arcsinh',
    parse: parseTrig('Arsinh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arsinh'],
    parse: parseTrig('Arsinh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arcsinh'],
    parse: parseTrig('Arsinh'),
  },
  {
    name: 'Arcosh',
    symbolTrigger: 'arcosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: '\\arcosh',
    parse: parseTrig('Arcosh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: '\\arccosh',
    parse: parseTrig('Arcosh'),
  },
  {
    name: 'Artanh',
    symbolTrigger: 'artanh',
    parse: parseTrig('Artanh'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arctanh',
    parse: parseTrig('Artanh'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: '\\artanh',
    parse: parseTrig('Artanh'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arctanh'],
    parse: parseTrig('Artanh'),
  },
  {
    name: 'Arsech',
    symbolTrigger: 'arsech',
    parse: parseTrig('Arsech'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arcsech',
    parse: parseTrig('Arsech'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arsech'],
    parse: parseTrig('Arsech'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arcsech'],
    parse: parseTrig('Arsech'),
  },
  {
    name: 'Arcsch',
    symbolTrigger: 'arcsch',
    parse: parseTrig('Arcsch'),
  },
  {
    // Accept variant with `arc-` prefix
    symbolTrigger: 'arccsch',
    parse: parseTrig('Arcsch'),
  },
  {
    // LaTeX command with `ar-` prefix (ISO standard)
    latexTrigger: ['\\arcsch'],
    parse: parseTrig('Arcsch'),
  },
  {
    // LaTeX command with `arc-` prefix (common variant)
    latexTrigger: ['\\arccsch'],
    parse: parseTrig('Arcsch'),
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
  {
    name: 'Sinc',
    symbolTrigger: 'sinc',
    kind: 'function',
  },
  {
    name: 'FresnelS',
    symbolTrigger: 'FresnelS',
    kind: 'function',
  },
  {
    name: 'FresnelC',
    symbolTrigger: 'FresnelC',
    kind: 'function',
  },
];
