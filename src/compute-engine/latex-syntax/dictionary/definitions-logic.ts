import type {
  InfixEntry,
  LatexDictionary,
  Parser,
  Serializer,
  Terminator,
} from '../types.js';
import { COMPARISON_PRECEDENCE, POSTFIX_PRECEDENCE } from '../types.js';
import {
  getSequence,
  operator,
  missingIfEmpty,
  nops,
  operand,
  operands,
  symbol,
} from '../../../math-json/utils.js';
import type { MathJsonExpression } from '../../../math-json.js';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators.js';

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

/**
 * Return `true` if the parser is positioned at a *parenthesized* modulus
 * annotation — `(\bmod …)`, `(\pmod …)`, `(\mod …)`, or `(mod …)` — possibly
 * behind visual spacing (`\quad`, `\;`, …). Non-destructive: the parser index
 * is restored before returning.
 *
 * Used as a terminator `condition` for the right-hand side of a congruence so
 * juxtaposition (invisible multiplication) does not swallow the `(mod n)`
 * annotation as a factor (e.g. `n ≡ 1 (mod 3)` must not parse `1·(m·o·d·3)`).
 */
function atParenthesizedModulus(p: Parser): boolean {
  const start = p.index;
  p.skipVisualSpace();
  let result = false;
  if (p.match('(')) {
    p.skipVisualSpace();
    result =
      p.peek === '\\bmod' ||
      p.peek === '\\pmod' ||
      p.peek === '\\mod' ||
      p.matchAll(['m', 'o', 'd']);
  }
  p.index = start;
  return result;
}

/**
 * After a congruence relation (`a \equiv b`), try to parse an optional modulus
 * annotation and return the modulus expression, or `null` if none is present.
 *
 * Recognized spellings (all optionally preceded by spacing such as `\quad`):
 *   - `\pmod{n}` / `\pmod n`  (parses to `Mod(n)`)
 *   - `\bmod n`               (parses to `Mod(…, n)` — the last operand is used)
 *   - `(\bmod n)` / `(\pmod n)` / `(\mod n)`
 *   - `(mod n)`               (ASCII `mod` keyword, e.g. `n ≡ 1 (mod 3)`)
 *
 * On no-match the parser index is restored to where it was on entry.
 */
function parseModulusAnnotation(
  parser: Parser,
  terminator: Readonly<Terminator>
): MathJsonExpression | null {
  const start = parser.index;
  parser.skipVisualSpace();

  // Parenthesized form: `(\bmod n)`, `(\pmod n)`, `(\mod n)`, `(mod n)`.
  if (parser.match('(')) {
    parser.skipVisualSpace();
    const hasMod =
      parser.match('\\bmod') ||
      parser.match('\\pmod') ||
      parser.match('\\mod') ||
      parser.matchAll(['m', 'o', 'd']);
    if (hasMod) {
      parser.skipVisualSpace();
      const n =
        parser.parseExpression({ ...terminator, minPrec: 0 }) ??
        parser.parseGroup();
      parser.skipVisualSpace();
      if (n !== null && parser.match(')')) return n;
    }
    parser.index = start;
    return null;
  }

  // Unparenthesized form: `\pmod{n}` (prefix → `Mod(n)`) or `\bmod n`
  // (infix → `Mod(lhs, n)`); in both cases the modulus is the last operand.
  //
  // Parse the modulus at a very high `minPrec` so a trailing operator does not
  // get folded into it. The modulus is a self-contained atom (the `\pmod`
  // prefix reads a group/token), so nothing after it belongs to the modulus.
  // Notably, when a chained relation follows without spacing — e.g.
  // `a \equiv b \pmod 7\implies …` — a low `minPrec` would let `\implies`
  // (prec 220) attach to `Mod(7)`, yielding an `Implies(...)` whose operator is
  // no longer `Mod`; the check below then fails and the whole annotation (plus
  // the rest of the chain) is rolled back, derailing the congruence parse.
  const modExpr = parser.parseExpression({
    ...terminator,
    minPrec: POSTFIX_PRECEDENCE,
  });
  if (modExpr !== null && operator(modExpr) === 'Mod') {
    // `\pmod{n}` → `Mod(n)` (1 operand); `\bmod n` → `Mod(lhs, n)` (2 operands).
    const n = nops(modExpr) >= 2 ? operand(modExpr, 2) : operand(modExpr, 1);
    if (n !== null) return n;
  }

  parser.index = start;
  return null;
}

/**
 * Shared parse handler for the congruence/equivalence infix operators
 * (`\equiv` and the Unicode `≡`). Produces `Congruent(a, b, n)` when a modulus
 * annotation follows, otherwise `Equivalent(a, b)`.
 */
function parseEquivalent(
  parser: Parser,
  lhs: MathJsonExpression,
  terminator: Readonly<Terminator>
): MathJsonExpression {
  // Stop the rhs before a parenthesized `(mod n)` annotation so juxtaposition
  // does not absorb it as an invisible-multiplication factor. A congruence
  // whose rhs already ends in a real `(...)` group (`a ≡ (b+c)`) is unaffected
  // because the condition only fires when `mod`/`\bmod`/`\pmod` follows the `(`.
  const rhs = parser.parseExpression({
    ...terminator,
    // Congruence is a comparison-level relation (see the precedence note on the
    // `\equiv` entry). Parse the rhs at `COMPARISON_PRECEDENCE` (matching the
    // operator's own right-associative precedence) so a following implication
    // (`\implies`, prec 220) or another comparison is NOT folded into the rhs —
    // it stays for the outer parser, letting `a ≡ b ⟹ c ≡ d` group as
    // `Implies(Congruent(…), Congruent(…))`.
    minPrec: COMPARISON_PRECEDENCE,
    condition: (p) =>
      atParenthesizedModulus(p) || (terminator.condition?.(p) ?? false),
  });
  const modulus = parseModulusAnnotation(parser, terminator);
  if (modulus !== null) return ['Congruent', lhs, missingIfEmpty(rhs), modulus];
  return ['Equivalent', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
}

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
  // Note: `\parallel` is NOT logical-Or here — it is the geometry `Parallel`
  // relation (`AB \parallel CD`), declared in `definitions-other.ts`. Use
  // `\lor` / `\vee` for disjunction.
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
  // Note: `\rightarrow` used to parse to `Implies` (issue #156) but is now
  // the function/mapping arrow `To`, like `\to` (see definitions-algebra.ts):
  // `f: A \rightarrow B` is overwhelmingly more common in mathematical text
  // than `\rightarrow`-as-implication. Use `\Rightarrow`/`\implies` for
  // implication.
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
    // `\equiv` is overwhelmingly used as congruence / "identical to" (`a ≡ b
    // (mod n)`), a comparison-level relation, not as the logical biconditional
    // (that is `\iff` / `\Leftrightarrow`, which stay at 219). It therefore
    // binds at `COMPARISON_PRECEDENCE` (245), tighter than implication
    // (`\implies`, 220), so `a ≡ b ⟹ c ≡ d` groups as
    // `Implies(Congruent(…), Congruent(…))` rather than mis-associating the
    // implication into one of the congruences.
    latexTrigger: ['\\equiv'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseEquivalent,
  } as InfixEntry,
  {
    // Unicode ≡ (U+2261 IDENTICAL TO): copy/paste and keyboard input frequently
    // carry the literal glyph rather than `\equiv`. Same behavior in every mode.
    latexTrigger: ['≡'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseEquivalent,
  } as InfixEntry,
  {
    // `\not\equiv` (and `\not≡`) negates the congruence/equivalence: it reuses
    // `parseEquivalent` (so a trailing `\pmod n` still folds into a
    // `Congruent(a, b, n)`) and wraps the result in `Not`. There is no
    // `NotCongruent` head, so the `Not`-wrap is the canonical form:
    // `2019^8 \not\equiv -1 \pmod{17}` → `Not(Congruent(2019^8, -1, 17))`.
    latexTrigger: ['\\not', '\\equiv'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: (parser, lhs, terminator) =>
      ['Not', parseEquivalent(parser, lhs, terminator)] as MathJsonExpression,
  } as InfixEntry,
  {
    // Unicode ≢ (U+2262 NOT IDENTICAL TO): literal-glyph spelling of
    // `\not\equiv`.
    latexTrigger: ['≢'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: (parser, lhs, terminator) =>
      ['Not', parseEquivalent(parser, lhs, terminator)] as MathJsonExpression,
  } as InfixEntry,

  // Bare `\pmod` following an expression (no `\equiv`) is a residue
  // annotation: `x \pmod n` → `Mod(x, n)` (e.g. solution prose like
  // `-811 \pmod{24}` meaning "the residue of −811 mod 24"). Unlike `\bmod`
  // (which binds tightly, at `DIVISION_PRECEDENCE`), `\pmod` attaches to the
  // whole preceding expression at a low precedence, so `1 + 6n \pmod 7` is
  // `Mod(1 + 6n, 7)` and `0, 1 \pmod 4` is `Tuple(0, Mod(1, 4))`.
  //
  // The precedence is kept below the `\equiv` right-hand-side parse precedence
  // (`COMPARISON_PRECEDENCE`, see `parseEquivalent`) so this infix does NOT
  // fire inside the right-hand side of a congruence — there, `\pmod` is
  // consumed as a modulus annotation by `parseEquivalent`/
  // `parseModulusAnnotation` (via the `\pmod` *prefix* form), producing
  // `Congruent(a, b, n)`.
  {
    latexTrigger: ['\\pmod'],
    kind: 'infix',
    precedence: COMPARISON_PRECEDENCE - 1,
    parse: (parser, lhs) => {
      const rhs = parser.parseGroup() ?? parser.parseToken();
      return ['Mod', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
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
        return `\\delta_{${args
          .map((arg) => serializer.serialize(arg))
          .join('')}}`;

      // Otherwise, use commas
      return `\\delta_{${args
        .map((arg) => serializer.serialize(arg))
        .join(', ')}}`;
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
    parse: (_parser: Parser, body: MathJsonExpression) => {
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
    parse: (_parser: Parser, body: MathJsonExpression) => {
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
  terminator?: Readonly<Terminator>
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
    (terminator?.condition?.(p) ?? false)
  );
}

export function parseQuantifier(
  kind: 'NotForAll' | 'NotExists' | 'ForAll' | 'Exists' | 'ExistsUnique'
): (
  parser: Parser,
  terminator?: Readonly<Terminator>
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
    // Stop at colon separators so the quantifier can consume them
    const condTerminator = {
      ...terminator,
      condition: (p: Parser) =>
        p.peek === ':' ||
        p.peek === '\\colon' ||
        (terminator?.condition?.(p) ?? false),
    };
    const condition = parser.parseExpression(condTerminator);
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

    // No body separator or parenthesis followed. A standalone quantified
    // *condition* — e.g. `\forall n \ge 1` ("for all n ≥ 1") — is transcribed
    // structurally with a `True` body: `ForAll(n ≥ 1, True)`. (The 2-argument
    // form is required — the canonical quantifier fills a missing body with an
    // Error otherwise.) This is gated to a compound condition (a relation): a
    // bare `\forall x`, with no condition and no body, remains incomplete and
    // still errors, as before. This path previously returned an Error, so no
    // valid parse changes meaning.
    if (operator(condition) !== '')
      return [kind, condition, 'True'] as MathJsonExpression;

    return null;
  };
}
