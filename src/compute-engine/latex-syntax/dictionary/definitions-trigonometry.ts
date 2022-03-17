import { Expression } from '../../../math-json/math-json-format';
import { LatexDictionary, Parser } from '../public';

/**
 * Trigonometric functions have some special conventions that require a
 * custom parser: they can be followed by a "-1" superscript indicating
 * that the inversion function should be used, i.e. "\sin^{-1}" for "arcsin".
 *
 */
function parseTrig(op: string) {
  return (parser: Parser): Expression | null => {
    let isInverse = false;

    let primeLevel = 0;

    parser.skipSpace();
    if (parser.match('^')) {
      parser.skipSpace();
      // @todo: could also be a regular exponent, i.e. ^2, ^3...
      if (parser.match('<{>')) {
        parser.skipSpace();
        // There's a superscript..., parse it.
        if (parser.match('-') && parser.match('1')) {
          isInverse = true;
        }
        do {
          if (parser.match('\\doubleprime')) {
            primeLevel += 2;
          }
          if (parser.match('\\prime')) {
            primeLevel += 1;
          }
          if (parser.match("'")) {
            primeLevel += 1;
          }
        } while (!parser.match('<}>') && !parser.atEnd);
      }
      let done = false;
      while (!done) {
        parser.skipSpace();
        if (parser.match('\\doubleprime')) {
          primeLevel += 2;
        } else if (parser.match('\\prime')) {
          primeLevel += 1;
        } else if (parser.match("'")) {
          primeLevel += 1;
        } else {
          done = true;
        }
      }
    }

    // Note: names as per NIST-DLMF
    let head: Expression =
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

    if (isInverse) {
      head = ['InverseFunction', head];
    }
    if (primeLevel >= 1) {
      head = ['Derivative', primeLevel, head];
    }

    const args = parser.matchArguments('implicit');
    if (args === null) return [head, 'Nothing'];

    return [head, ...args];
  };
}
export const DEFINITIONS_TRIGONOMETRY: LatexDictionary = [
  {
    name: 'Arcsin',
    trigger: ['\\arcsin'],
    arguments: 'implicit',
    parse: parseTrig('Arcsin'),
  },
  {
    name: 'Arccos',
    trigger: ['\\arccos'],
    arguments: 'implicit',
    parse: parseTrig('Arccos'),
  },
  {
    name: 'Arctan',
    trigger: ['\\arctan'],
    arguments: 'implicit',
    parse: parseTrig('Arctan'),
  },
  {
    trigger: ['\\arctg'],
    arguments: 'implicit',
    parse: parseTrig('Arctan'),
  },
  {
    name: 'Arccot',
    trigger: ['\\arcctg'],
    arguments: 'implicit',
    parse: parseTrig('Arccot'),
  },
  {
    name: 'Arcsec',
    trigger: ['\\arcsec'],
    arguments: 'implicit',
    parse: parseTrig('Arcsec'),
  },
  {
    name: 'Arccsc',
    trigger: ['\\arccsc'],
    arguments: 'implicit',
    parse: parseTrig('Arccsc'),
  },
  {
    name: 'Arsinh',
    trigger: ['\\arsinh'],
    arguments: 'implicit',
    parse: parseTrig('Arsinh'),
  },
  {
    name: 'Arcosh',
    trigger: ['\\arcosh'],
    arguments: 'implicit',
    parse: parseTrig('Arcosh'),
  },
  {
    name: 'Artanh',
    trigger: ['\\artanh'],
    arguments: 'implicit',
    parse: parseTrig('Artanh'),
  },
  {
    name: 'Arsech',
    trigger: ['\\arsech'],
    arguments: 'implicit',
    parse: parseTrig('Arsech'),
  },
  {
    name: 'Arcsch',
    trigger: ['\\arcsch'],
    arguments: 'implicit',
    parse: parseTrig('Arcsch'),
  },
  {
    // Rusian hyperbolic cosine
    trigger: ['\\ch'],
    arguments: 'implicit',
    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cosec',
    trigger: ['\\cosec'],
    arguments: 'implicit',
    parse: parseTrig('Cosec'),
  },
  {
    name: 'Cosh',
    trigger: ['\\cosh'],
    arguments: 'implicit',
    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cot',
    trigger: ['\\cot'],
    arguments: 'implicit',
    parse: parseTrig('Cot'),
  },
  {
    trigger: ['\\cotg'],
    arguments: 'implicit',
    parse: parseTrig('Cot'),
  },
  {
    name: 'Coth',
    trigger: ['\\coth'],
    arguments: 'implicit',
    parse: parseTrig('Coth'),
  },
  {
    name: 'Csc',
    trigger: ['\\csc'],
    arguments: 'implicit',
    parse: parseTrig('Csc'),
  },
  {
    // Rusian cotangent
    trigger: ['\\ctg'],
    arguments: 'implicit',
    parse: parseTrig('Cot'),
  },
  {
    trigger: ['\\cth'],
    arguments: 'implicit',
    parse: parseTrig('Cotanh'),
  },
  {
    name: 'Sec',
    trigger: ['\\sec'],
    arguments: 'implicit',
    parse: parseTrig('Sec'),
  },
  {
    name: 'Sinh',
    trigger: ['\\sinh'],
    arguments: 'implicit',
    parse: parseTrig('Sinh'),
  },
  {
    trigger: ['\\sh'],
    arguments: 'implicit',
    parse: parseTrig('Sinh'),
  },
  {
    name: 'Tan',
    trigger: ['\\tan'],
    arguments: 'implicit',
    parse: parseTrig('Tan'),
  },
  {
    trigger: ['\\tg'],
    arguments: 'implicit',
    parse: parseTrig('Tan'),
  },
  {
    name: 'Tanh',
    trigger: ['\\tanh'],
    arguments: 'implicit',
    parse: parseTrig('Tanh'),
  },
  {
    trigger: ['\\th'],
    arguments: 'implicit',
    parse: parseTrig('Tanh'),
  },

  {
    name: 'Cos',
    trigger: ['\\cos'],
    arguments: 'implicit',
    parse: parseTrig('Cos'),
  },
  {
    name: 'Sin',
    trigger: ['\\sin'],
    arguments: 'implicit',
    parse: parseTrig('Sin'),
  },
];
