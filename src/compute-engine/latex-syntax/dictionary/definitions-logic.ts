import { InfixEntry, LatexDictionary, Parser, Terminator } from '../public';
import { head, missingIfEmpty, op } from '../../../math-json/utils';
import { Expression } from '../../../math-json.js';

// See https://en.wikipedia.org/wiki/List_of_logic_symbols

export const DEFINITIONS_LOGIC: LatexDictionary = [
  // Constants
  {
    name: 'True',
    kind: 'symbol',
    latexTrigger: ['\\top'], // ⊤ U+22A4
  },
  {
    kind: 'symbol',
    latexTrigger: '\\mathrm{True}',
    parse: 'True',
  },
  {
    kind: 'symbol',
    latexTrigger: '\\operator{True}',
    parse: 'True',
  },
  {
    kind: 'symbol',
    latexTrigger: '\\mathsf{T}',
    parse: 'True',
  },

  {
    name: 'False',
    kind: 'symbol',
    latexTrigger: ['\\bot'], // ⊥ U+22A5
  },
  {
    kind: 'symbol',
    latexTrigger: '\\operator{False}',
    parse: 'False',
  },
  {
    kind: 'symbol',
    latexTrigger: '\\mathsf{F}',
    parse: 'False',
  },

  // Operators
  {
    name: 'And',
    kind: 'infix',
    latexTrigger: ['\\land'],
    precedence: 317,
    // serialize: '\\land',
  },
  { kind: 'infix', latexTrigger: ['\\wedge'], parse: 'And', precedence: 317 },
  { kind: 'infix', latexTrigger: '\\&', parse: 'And', precedence: 317 },
  {
    kind: 'infix',
    latexTrigger: '\\operatorname{and}',
    parse: 'And',
    precedence: 317,
  },

  {
    name: 'Or',
    kind: 'infix',
    latexTrigger: ['\\lor'],
    precedence: 310,
  },
  { kind: 'infix', latexTrigger: ['\\vee'], parse: 'Or', precedence: 310 },
  { kind: 'infix', latexTrigger: '\\parallel', parse: 'Or', precedence: 310 },
  {
    kind: 'infix',
    latexTrigger: '\\operatorname{or}',
    parse: 'Or',
    precedence: 310,
  },

  {
    name: 'Xor',
    kind: 'infix',
    latexTrigger: ['\\veebar'],
    precedence: 315,
  },
  // Possible alt: \oplus ⊕ U+2295

  {
    name: 'Not',
    kind: 'prefix',
    latexTrigger: ['\\lnot'],
    precedence: 880,
  },
  {
    kind: 'prefix',
    latexTrigger: ['\\neg'],
    parse: 'Not',
    precedence: 880,
  },

  {
    name: 'Nand',
    kind: 'infix',
    latexTrigger: ['\\barwedge'],
    precedence: 315,
    // serialize: '\\mid',
  },
  {
    name: 'Nor',
    kind: 'infix',
    latexTrigger: ['\u22BD'], // bar vee
    precedence: 315,
    // serialize: '\\downarrow',
  },
  // Functions
  {
    kind: 'function',
    identifierTrigger: 'and',
    parse: 'And',
  },
  {
    kind: 'function',
    identifierTrigger: 'or',
    parse: 'Or',
  },
  {
    kind: 'function',
    identifierTrigger: 'not',
    parse: 'Not',
  },
  // Relations
  {
    name: 'Implies',
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    latexTrigger: ['\\implies'],
    serialize: '\\implies',
  },
  {
    latexTrigger: ['\\Rightarrow'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: 'Implies',
  },

  {
    name: 'Equivalent', // MathML: identical to, Mathematica: Congruent
    latexTrigger: ['\\iff'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
  },
  {
    latexTrigger: ['\\Leftrightarrow'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },
  {
    latexTrigger: ['\\equiv'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: (
      parser: Parser,
      lhs: Expression,
      terminator: Readonly<Terminator>
    ) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 219 });

      const index = parser.index;

      const modulus = parser.parseExpression({ ...terminator, minPrec: 219 });
      if (modulus && head(modulus) === 'Mod')
        return ['Congruent', lhs, rhs, missingIfEmpty(op(modulus, 1))];

      parser.index = index;
      return ['Equivalent', lhs, missingIfEmpty(rhs)] as Expression;
    },
  } as InfixEntry,

  {
    name: 'Proves',
    kind: 'infix',
    latexTrigger: ['\\vdash'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\vdash',
  },
  {
    name: 'Entails',
    kind: 'infix',
    latexTrigger: ['\\vDash'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\vDash',
  },
  {
    name: 'Satisfies',
    kind: 'infix',
    latexTrigger: ['\\models'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\models',
  },
  // Quantifiers: for all, exists
  {
    name: 'ForAll',
    kind: 'prefix',
    latexTrigger: ['\\forall'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE
    serialize: '\\forall',
    parse: parseQuantifier('ForAll'),
  },
  {
    name: 'Exists',
    kind: 'prefix',
    latexTrigger: ['\\exists'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE,
    serialize: '\\exists',
    parse: parseQuantifier('Exists'),
  },
  {
    name: 'ExistsUnique',
    kind: 'prefix',
    latexTrigger: ['\\exists', '!'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE,
    serialize: '\\exists!',
    parse: parseQuantifier('ExistsUnique'),
  },
];

function parseQuantifier(
  kind: 'ForAll' | 'Exists' | 'ExistsUnique'
): (parser: Parser, terminator: Readonly<Terminator>) => Expression | null {
  return (parser, terminator) => {
    const index = parser.index;

    // There are several acceptable forms:
    // - \forall x, x>0
    // - \forall x (x>0)
    // - \forall x \in S, x>0
    // - \forall x \in S (x>0)
    // - \forall x  \mid x>0

    // As a BNF:
    // - <quantifier> ::= '\forall' | '\exists' | '\forall!' | '\exists!'
    // - <quantifier-expression> ::= <quantifier> <condition> [',' | '\mid'] <condition>
    // - <quantifier-expression> ::=  <quantifier> <condition> '(' <condition> ')'

    //
    // 1. First, we check for a standalone identifier, that is an identifier
    //    followed by a comma, a vertical bar or a parenthesis
    //

    const id = parser.parseSymbol(terminator);
    if (id) {
      parser.skipSpace();
      if (parser.match(',') || parser.match('\\mid')) {
        const body = parser.parseExpression(terminator);
        return [kind, id, missingIfEmpty(body)] as Expression;
      }
      if (parser.match('(')) {
        const body = parser.parseExpression(terminator);
        if (!parser.match(')')) {
          parser.index = index;
          return null;
        }
        return [kind, id, missingIfEmpty(body)];
      }
    }

    //
    // 2. If we didn't find a standalone identifier, we look for a condition
    //
    parser.index = index;
    const condition = parser.parseExpression(terminator);
    if (!condition) {
      parser.index = index;
      return null;
    }
    // Either a separator or a parenthesis
    parser.skipSpace();
    if (parser.matchAny([',', '\\mid', ':', '\\colon'])) {
      const body = parser.parseExpression(terminator);
      return [kind, condition, missingIfEmpty(body)] as Expression;
    }
    if (parser.match('(')) {
      const body = parser.parseExpression(terminator);
      if (!parser.match(')')) {
        parser.index = index;
        return null;
      }
      return [kind, condition, missingIfEmpty(body)] as Expression;
    }

    parser.index = index;
    return null;
  };
}
