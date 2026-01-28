import type {
  InfixEntry,
  LatexDictionary,
  Parser,
  Serializer,
  Terminator,
} from '../types';
import {
  getSequence,
  operator,
  missingIfEmpty,
  operand,
  operands,
  symbol,
} from '../../../math-json/utils';
import { Expression } from '../../../math-json';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators';

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
    latexTrigger: '\\operatorname{True}',
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
    latexTrigger: '\\operatorname{False}',
    parse: 'False',
  },
  {
    kind: 'symbol',
    latexTrigger: '\\mathsf{F}',
    parse: 'False',
  },

  // Operators
  // Logic operators have lower precedence than comparisons (245)
  // so that `x = 1 \lor x = 2` parses as `(x = 1) \lor (x = 2)`
  // See https://github.com/cortex-js/compute-engine/issues/243
  {
    name: 'And',
    kind: 'infix',
    latexTrigger: ['\\land'],
    precedence: 235,
    // serialize: '\\land',
  },
  { kind: 'infix', latexTrigger: ['\\wedge'], parse: 'And', precedence: 235 },
  { kind: 'infix', latexTrigger: '\\&', parse: 'And', precedence: 235 },
  {
    kind: 'infix',
    latexTrigger: '\\operatorname{and}',
    parse: 'And',
    precedence: 235,
  },

  {
    name: 'Or',
    kind: 'infix',
    latexTrigger: ['\\lor'],
    precedence: 230,
  },
  { kind: 'infix', latexTrigger: ['\\vee'], parse: 'Or', precedence: 230 },
  { kind: 'infix', latexTrigger: '\\parallel', parse: 'Or', precedence: 230 },
  {
    kind: 'infix',
    latexTrigger: '\\operatorname{or}',
    parse: 'Or',
    precedence: 230,
  },

  {
    name: 'Xor',
    kind: 'infix',
    latexTrigger: ['\\veebar'],
    precedence: 232,
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
    precedence: 232,
    // serialize: '\\mid',
  },
  {
    name: 'Nor',
    kind: 'infix',
    latexTrigger: ['\u22BD'], // bar vee
    precedence: 232,
    // serialize: '\\downarrow',
  },
  // Functions
  {
    kind: 'function',
    symbolTrigger: 'and',
    parse: 'And',
  },
  {
    kind: 'function',
    symbolTrigger: 'or',
    parse: 'Or',
  },
  {
    kind: 'function',
    symbolTrigger: 'not',
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
      if (modulus !== null && operator(modulus) === 'Mod')
        return ['Congruent', lhs, rhs, missingIfEmpty(operand(modulus, 1))];

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
    serialize: serializeQuantifier('\\forall'),
    parse: parseQuantifier('ForAll'),
  },
  {
    name: 'Exists',
    kind: 'prefix',
    latexTrigger: ['\\exists'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE,
    serialize: serializeQuantifier('\\exists'),
    parse: parseQuantifier('Exists'),
  },
  {
    name: 'ExistsUnique',
    kind: 'prefix',
    latexTrigger: ['\\exists', '!'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE,
    serialize: serializeQuantifier('\\exists!'),
    parse: parseQuantifier('ExistsUnique'),
  },
  {
    name: 'NotForAll',
    kind: 'prefix',
    latexTrigger: ['\\lnot', '\\forall'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE
    serialize: serializeQuantifier('\\lnot\\forall'),
    parse: parseQuantifier('NotForAll'),
  },
  {
    name: 'NotExists',
    kind: 'prefix',
    latexTrigger: ['\\lnot', '\\exists'],
    precedence: 200, // Has to be lower than COMPARISON_PRECEDENCE,
    serialize: serializeQuantifier('\\lnot\\exists'),
    parse: parseQuantifier('NotExists'),
  },

  {
    name: 'KroneckerDelta',
    kind: 'prefix',
    latexTrigger: ['\\delta', '_'],
    precedence: 200,
    serialize: (serializer: Serializer, expr: Expression) => {
      const args = operands(expr);
      if (args.length === 0) return '\\delta';

      // If only symbol arguments, just concatenate them
      // ['KroneckerDelta', 'n', 'm'] -> \delta_{nm}
      if (args.every((x) => symbol(x)))
        return `\\delta_{${args.map((arg) => serializer.serialize(arg)).join('')}}`;

      // Otherwise, use commas
      return `\\delta_{${args.map((arg) => serializer.serialize(arg)).join(', ')}}`;
    },
    parse: (parser) => {
      const group = parser.parseGroup();
      if (group === null) {
        const token = parser.parseToken();
        if (!token) return null;
        // \\delta_n
        return ['KroneckerDelta', token];
      }

      const seq = getSequence(group);

      // \\delta_{n, m}
      if (seq && seq.length <= 2) return ['KroneckerDelta', ...seq];

      // \\delta_{nm}
      if (operator(group) === 'InvisibleOperator')
        return ['KroneckerDelta', ...operands(group)];

      // \\delta_{n}
      if (group !== null) return ['KroneckerDelta', group];

      return null;
    },
  },

  // Iverson brackets. Also called the "indicator function"
  // Must have a single argument, a relational expression, i.e.
  // `[ a = b ]` or `[ x \leq 0 ]`
  // Otherwise, it gets rejected, it could be something else, like a list or
  // tuple.
  {
    name: 'Boole',
    kind: 'matchfix',
    openTrigger: '[',
    closeTrigger: ']',
    // serialize: (serializer: Serializer, expr: Expression) => {
    //   const args = ops(expr);
    //   return `[${serializer.serialize(arg)}]`;
    // },
    parse: (_parser, body) => {
      const h = operator(body);
      if (!h) return null;
      if (!DEFINITIONS_INEQUALITIES.some((x) => x.name === h)) return null;
      return ['Boole', body] as Expression;
    },
  },

  {
    kind: 'matchfix',
    openTrigger: '\\llbracket',
    closeTrigger: '\\rrbracket',
    parse: (_parser, body) => {
      const h = operator(body);
      if (!h) return null;
      if (!DEFINITIONS_INEQUALITIES.some((x) => x.name === h)) return null;
      return ['Boole', body] as Expression;
    },
  },
];

function serializeQuantifier(
  quantifierSymbol: string
): (serializer: Serializer, expr: Expression) => string {
  return (serializer, expr) => {
    const args = operands(expr);
    if (args.length === 0) return quantifierSymbol;
    if (args.length === 1)
      return `${quantifierSymbol} ${serializer.serialize(args[0])}`;

    // args[0] is the bound variable/condition, args[1] is the body
    const boundVar = serializer.serialize(args[0]);
    const body = serializer.serialize(args[1]);
    return `${quantifierSymbol} ${boundVar}, ${body}`;
  };
}

// Condition function for tight quantifier binding - stops at logical connectives
function tightBindingCondition(
  p: Parser,
  terminator: Readonly<Terminator>
): boolean {
  return (
    p.peek === '\\to' ||
    p.peek === '\\rightarrow' ||
    p.peek === '\\implies' ||
    p.peek === '\\Rightarrow' ||
    p.peek === '\\iff' ||
    p.peek === '\\Leftrightarrow' ||
    p.peek === '\\land' ||
    p.peek === '\\wedge' ||
    p.peek === '\\lor' ||
    p.peek === '\\vee' ||
    (terminator.condition?.(p) ?? false)
  );
}

function parseQuantifier(
  kind: 'NotForAll' | 'NotExists' | 'ForAll' | 'Exists' | 'ExistsUnique'
): (parser: Parser, terminator: Readonly<Terminator>) => Expression | null {
  return (parser, terminator) => {
    const index = parser.index;
    const useTightBinding = parser.options.quantifierScope !== 'loose';

    // There are several acceptable forms:
    // - \forall x, x>0
    // - \forall x (x>0)
    // - \forall x \in S, x>0
    // - \forall x \in S (x>0)
    // - \forall x  \mid x>0
    // - \forall x.(P(x))
    // - \forall x: P(x)
    // - \forall \colon P(x)

    // As a BNF:
    // - <quantifier> ::= '\forall' | '\exists' | '\forall!' | '\exists!'
    // - <quantifier-expression> ::= <quantifier> <condition> [',' | '\mid' | '.'] <condition>
    // - <quantifier-expression> ::=  <quantifier> <condition> '(' <condition> ')'

    //
    // 1. First, we check for a standalone symbol, that is a symbol
    //    followed by a comma, a vertical bar or a parenthesis
    //

    const symbol = parser.parseSymbol(terminator);
    if (symbol) {
      parser.skipSpace();
      if (
        parser.match(',') ||
        parser.match('\\mid') ||
        parser.match('.') ||
        parser.match(':') ||
        parser.match('\\colon')
      ) {
        // Parse body with optional tight binding (stops at logical connectives)
        // Tight binding follows standard FOL convention where quantifier scope
        // extends only to the immediately following well-formed formula.
        const bodyTerminator = useTightBinding
          ? { ...terminator, condition: (p: Parser) => tightBindingCondition(p, terminator) }
          : terminator;
        const body = parser.parseExpression(bodyTerminator);
        return [kind, symbol, missingIfEmpty(body)] as Expression;
      }
      const body = parser.parseEnclosure();
      if (body) return [kind, symbol, missingIfEmpty(body)];
    }

    //
    // 2. If we didn't find a standalone symbol, we look for a condition
    //
    parser.index = index;
    const condition = parser.parseExpression(terminator);
    if (condition === null) return null;

    // Either a separator or a parenthesis
    parser.skipSpace();
    if (parser.matchAny([',', '\\mid', ':', '\\colon'])) {
      // Parse body with optional tight binding
      const bodyTerminator = useTightBinding
        ? { ...terminator, condition: (p: Parser) => tightBindingCondition(p, terminator) }
        : terminator;
      const body = parser.parseExpression(bodyTerminator);
      return [kind, condition, missingIfEmpty(body)] as Expression;
    }
    if (parser.match('(')) {
      // Parenthesized body - parse normally within the parens
      const body = parser.parseExpression(terminator);
      if (!parser.match(')')) return null;
      return [kind, condition, missingIfEmpty(body)] as Expression;
    }

    return null;
  };
}
