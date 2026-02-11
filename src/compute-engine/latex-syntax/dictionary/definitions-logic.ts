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
import type { MathJsonExpression } from '../../../math-json';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators';

// See https://en.wikipedia.org/wiki/List_of_logic_symbols
//
// ## Operator Precedence (higher number = binds tighter)
//
// The precedence hierarchy ensures expressions parse naturally:
//
// | Precedence | Operators                          | Example                           |
// |------------|------------------------------------|------------------------------------|
// | 880        | Not (¬, \lnot, \neg)               | ¬p binds only to p                |
// | 270        | To (→ for function mapping)        | f: A → B                          |
// | 245        | Comparisons (=, <, >, ≤, ≥, ≠)     | x = 1                             |
// | 240        | Set relations (⊂, ⊆, ∈, etc.)      | x ∈ S                             |
// | 235        | And (∧, \land, \wedge)             | p ∧ q                             |
// | 232        | Xor, Nand, Nor                     | p ⊕ q                             |
// | 230        | Or (∨, \lor, \vee)                 | p ∨ q                             |
// | 220        | Implies (→, ⇒, \implies)           | p → q                             |
// | 219        | Equivalent (↔, ⇔, \iff)            | p ↔ q                             |
// | 200        | Quantifiers (∀, ∃)                 | ∀x, P(x)                          |
//
// This means:
// - `x = 1 ∨ y = 2` parses as `(x = 1) ∨ (y = 2)` (comparisons bind tighter than Or)
// - `p ∧ q ∨ r` parses as `(p ∧ q) ∨ r` (And binds tighter than Or)
// - `p ∨ q → r` parses as `(p ∨ q) → r` (Or binds tighter than Implies)
// - `¬p ∧ q` parses as `(¬p) ∧ q` (Not only applies to immediately following atom)
//
// To negate a compound expression, use parentheses: `¬(p ∧ q)`
//

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
    latexTrigger: ['\\rightarrow'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: 'Implies',
  },
  {
    latexTrigger: ['\\Longrightarrow'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: 'Implies',
  },
  {
    latexTrigger: ['\\longrightarrow'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: 'Implies',
  },
  {
    // Non-strict mode: => for implies
    latexTrigger: ['=', '>'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: (parser, lhs, until) => {
      if (parser.options.strict !== false) return null;
      const rhs = parser.parseExpression({ ...until, minPrec: 220 });
      if (rhs === null) return null;
      return ['Implies', lhs, rhs];
    },
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
    latexTrigger: ['\\leftrightarrow'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },
  {
    latexTrigger: ['\\Longleftrightarrow'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },
  {
    latexTrigger: ['\\longleftrightarrow'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },
  {
    // Non-strict mode: <=> for equivalence
    latexTrigger: ['<', '=', '>'],
    kind: 'infix',
    precedence: 219,
    associativity: 'right',
    parse: (parser, lhs, until) => {
      if (parser.options.strict !== false) return null;
      const rhs = parser.parseExpression({ ...until, minPrec: 219 });
      if (rhs === null) return null;
      return ['Equivalent', lhs, rhs];
    },
  },
  {
    latexTrigger: ['\\equiv'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: (
      parser: Parser,
      lhs: MathJsonExpression,
      terminator: Readonly<Terminator>
    ) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 219 });

      const index = parser.index;

      const modulus = parser.parseExpression({ ...terminator, minPrec: 219 });
      if (modulus !== null && operator(modulus) === 'Mod')
        return ['Congruent', lhs, rhs, missingIfEmpty(operand(modulus, 1))];

      parser.index = index;
      return ['Equivalent', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
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
    serialize: (serializer: Serializer, expr: MathJsonExpression) => {
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
    // serialize: (serializer: Serializer, expr: MathJsonExpression) => {
    //   const args = ops(expr);
    //   return `[${serializer.serialize(arg)}]`;
    // },
    parse: (_parser, body) => {
      const h = operator(body);
      if (!h) return null;
      if (!DEFINITIONS_INEQUALITIES.some((x) => x.name === h)) return null;
      return ['Boole', body] as MathJsonExpression;
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
      return ['Boole', body] as MathJsonExpression;
    },
  },

  // Predicate application in First-Order Logic.
  // ["Predicate", "P", "x", "y"] serializes to "P(x, y)"
  {
    name: 'Predicate',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (args.length === 0) return '';
      const pred = args[0];
      const predStr =
        typeof pred === 'string' ? pred : serializer.serialize(pred);
      if (args.length === 1) return predStr;
      const argStrs = args.slice(1).map((arg) => serializer.serialize(arg));
      return `${predStr}(${argStrs.join(', ')})`;
    },
  },
];

function serializeQuantifier(
  quantifierSymbol: string
): (serializer: Serializer, expr: MathJsonExpression) => string {
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
): (
  parser: Parser,
  terminator: Readonly<Terminator>
) => MathJsonExpression | null {
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
          ? {
              ...terminator,
              condition: (p: Parser) => tightBindingCondition(p, terminator),
            }
          : terminator;
        // Enter quantifier scope so predicates are recognized
        parser.enterQuantifierScope();
        const body = parser.parseExpression(bodyTerminator);
        parser.exitQuantifierScope();
        return [kind, symbol, missingIfEmpty(body)] as MathJsonExpression;
      }
      // Enter quantifier scope so predicates are recognized
      parser.enterQuantifierScope();
      const body = parser.parseEnclosure();
      parser.exitQuantifierScope();
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
        ? {
            ...terminator,
            condition: (p: Parser) => tightBindingCondition(p, terminator),
          }
        : terminator;
      // Enter quantifier scope so predicates are recognized
      parser.enterQuantifierScope();
      const body = parser.parseExpression(bodyTerminator);
      parser.exitQuantifierScope();
      return [kind, condition, missingIfEmpty(body)] as MathJsonExpression;
    }
    if (parser.match('(')) {
      // Parenthesized body - parse normally within the parens
      // Enter quantifier scope so predicates are recognized
      parser.enterQuantifierScope();
      const body = parser.parseExpression(terminator);
      parser.exitQuantifierScope();
      if (!parser.match(')')) return null;
      return [kind, condition, missingIfEmpty(body)] as MathJsonExpression;
    }

    return null;
  };
}
