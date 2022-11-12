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
    if (args === null) return head;

    return [head, ...args];
  };
}
export const DEFINITIONS_TRIGONOMETRY: LatexDictionary = [
  {
    name: 'Arcsin',
    trigger: ['\\arcsin'],

    parse: parseTrig('Arcsin'),
  },
  {
    name: 'Arccos',
    trigger: ['\\arccos'],

    parse: parseTrig('Arccos'),
  },
  {
    name: 'Arctan',
    trigger: ['\\arctan'],

    parse: parseTrig('Arctan'),
  },
  {
    trigger: ['\\arctg'],

    parse: parseTrig('Arctan'),
  },
  {
    name: 'Arccot',
    trigger: ['\\arcctg'],

    parse: parseTrig('Arccot'),
  },
  {
    name: 'Arcsec',
    trigger: 'arcsec',

    parse: parseTrig('Arcsec'),
  },
  {
    name: 'Arccsc',
    trigger: ['\\arccsc'],

    parse: parseTrig('Arccsc'),
  },
  {
    name: 'Arsinh',
    trigger: ['\\arsinh'],

    parse: parseTrig('Arsinh'),
  },
  {
    name: 'Arcosh',
    trigger: ['\\arcosh'],

    parse: parseTrig('Arcosh'),
  },
  {
    name: 'Artanh',
    trigger: ['\\artanh'],

    parse: parseTrig('Artanh'),
  },
  {
    name: 'Arsech',
    trigger: ['\\arsech'],

    parse: parseTrig('Arsech'),
  },
  {
    name: 'Arcsch',
    trigger: ['\\arcsch'],

    parse: parseTrig('Arcsch'),
  },
  {
    // Rusian hyperbolic cosine
    trigger: ['\\ch'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cosec',
    trigger: ['\\cosec'],

    parse: parseTrig('Cosec'),
  },
  {
    name: 'Cosh',
    trigger: ['\\cosh'],

    parse: parseTrig('Cosh'),
  },
  {
    name: 'Cot',
    trigger: ['\\cot'],

    parse: parseTrig('Cot'),
  },
  {
    trigger: ['\\cotg'],

    parse: parseTrig('Cot'),
  },
  {
    name: 'Coth',
    trigger: ['\\coth'],

    parse: parseTrig('Coth'),
  },
  {
    name: 'Csc',
    trigger: ['\\csc'],

    parse: parseTrig('Csc'),
  },
  {
    // Rusian cotangent
    trigger: ['\\ctg'],

    parse: parseTrig('Cot'),
  },
  {
    trigger: ['\\cth'],

    parse: parseTrig('Cotanh'),
  },
  {
    name: 'Sec',
    trigger: ['\\sec'],

    parse: parseTrig('Sec'),
  },
  {
    name: 'Sinh',
    trigger: ['\\sinh'],

    parse: parseTrig('Sinh'),
  },
  {
    trigger: ['\\sh'],

    parse: parseTrig('Sinh'),
  },
  {
    name: 'Tan',
    trigger: ['\\tan'],

    parse: parseTrig('Tan'),
  },
  {
    trigger: ['\\tg'],

    parse: parseTrig('Tan'),
  },
  {
    name: 'Tanh',
    trigger: ['\\tanh'],

    parse: parseTrig('Tanh'),
  },
  {
    trigger: ['\\th'],

    parse: parseTrig('Tanh'),
  },

  {
    name: 'Cos',
    trigger: ['\\cos'],

    parse: parseTrig('Cos'),
  },
  {
    name: 'Sin',
    trigger: ['\\sin'],

    parse: parseTrig('Sin'),
  },
];
