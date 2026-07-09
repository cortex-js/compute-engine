import { MathJsonSymbol } from '../math-json/types.js';

//
// The single, shared Cortex operator table.
//
// This module is the **one source of truth** for operator spelling,
// precedence, associativity, and serializer spacing class. Both the parser
// (`parser.ts`) and the serializer (`serialize-cortex.ts`) consume it, so the
// two can never diverge (they historically did — `Element` vs `ElementOf`,
// `Multiply` at 390 vs `Divide` at 660 — because there were two tables).
//
// ─── Precedence ─────────────────────────────────────────────────────────────
//
// Loosest → tightest, in gaps of 10, **higher number binds tighter**. This
// direction keeps the serializer's existing parenthesization test
// (`argOp.precedence < op.precedence` ⇒ wrap the operand) working unchanged.
//
//   Assign            10   (infix, right, relational spacing)
//   Pipe  |>  ~>      20   (infix, left)
//   KeyValuePair ->   30   (infix)
//   Or  ||            40   (infix, left)
//   And &&            50   (infix, left)
//   relational        60   (infix, n-ary chainable — see parser)
//     == === != < > <= >= in !in
//   Add + / Subtract -  70 (infix, left, same precedence)
//   Multiply * / Divide / 80 (infix, left, same precedence)
//   Negate - / Not !  90   (prefix)
//   Power ^  **       100  (infix, right)
//   (postfix call/index ~110 — Stage B)
//
// Deviations from the old serializer table are deliberate (see the phase
// plan): And/Or below relational (standard); Multiply == Divide; Power
// right-assoc and above unary minus (`-x^2` = `-(x^2)`).
//
// The `fancySymbol` values are carried over verbatim from the old serializer
// table so serializer output is byte-for-byte unchanged. Parsing of the wider
// set of Unicode aliases (`∧`, `∨`, `≤`, …) is handled by the parser through
// the `FANCY_UNICODE` codepoint table in `characters.ts`, not through this
// field.
//

export interface OperatorDef {
  /** The MathJSON operator this spelling maps to, e.g. `'Add'`. */
  name: MathJsonSymbol;
  /** The canonical (ASCII) spelling, e.g. `'+'`. */
  symbol: string;
  /** An optional fancy Unicode spelling used by the serializer. */
  fancySymbol?: string;
  /** Higher binds tighter. */
  precedence: number;
  kind: 'infix' | 'prefix' | 'postfix';
  /** Associativity — infix only. Defaults to `'left'`. */
  assoc?: 'left' | 'right';
  /** Serializer spacing class (also used by the parser for n-ary chaining). */
  relational?: boolean;
}

/**
 * The operator table, loosest → tightest.
 *
 * Alias rows (`~>` for `Pipe`, `**` for `Power`) appear immediately after
 * their canonical row so the `byName` map (first-wins) resolves to the
 * canonical spelling.
 */
export const OPERATORS: OperatorDef[] = [
  {
    name: 'Assign',
    symbol: '=',
    precedence: 10,
    kind: 'infix',
    assoc: 'right',
    relational: true,
  },
  // Anonymous-function (mapsto) arrow `x |-> expr`. Maximal-munches as one
  // OPERATOR token, distinct from `|>` (Pipe) and `->` (KeyValuePair). It binds
  // very loosely (just above `Assign`, so `f = x |-> x + 1` captures the whole
  // mapsto as the RHS) and right-associates for currying (`x |-> y |-> …`). Its
  // MathJSON `name` is a parser-internal marker: the parser rewrites the node in
  // `combineInfix` into the engine `Function` shape (`["Function", body,
  // …params]`), so a raw `MapsTo` head never reaches the serializer.
  {
    name: 'MapsTo',
    symbol: '|->',
    fancySymbol: '↦',
    precedence: 15,
    kind: 'infix',
    assoc: 'right',
  },
  { name: 'Pipe', symbol: '|>', precedence: 20, kind: 'infix', assoc: 'left' },
  { name: 'Pipe', symbol: '~>', precedence: 20, kind: 'infix', assoc: 'left' },
  {
    name: 'KeyValuePair',
    symbol: '->',
    fancySymbol: '→',
    precedence: 30,
    kind: 'infix',
  },
  {
    name: 'Or',
    symbol: '||',
    fancySymbol: '⋁',
    precedence: 40,
    kind: 'infix',
    assoc: 'left',
  },
  {
    name: 'And',
    symbol: '&&',
    fancySymbol: '⋀',
    precedence: 50,
    kind: 'infix',
    assoc: 'left',
  },

  // Relational — all precedence 60, chained n-ary in the parser.
  {
    name: 'Equal',
    symbol: '==',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'Same',
    symbol: '===',
    fancySymbol: '≣',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'NotEqual',
    symbol: '!=',
    fancySymbol: '≠',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'Less',
    symbol: '<',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'Greater',
    symbol: '>',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'LessEqual',
    symbol: '<=',
    fancySymbol: '⩽',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'GreaterEqual',
    symbol: '>=',
    fancySymbol: '⩾',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'Element',
    symbol: 'in',
    fancySymbol: '∈',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },
  {
    name: 'NotElement',
    symbol: '!in',
    fancySymbol: '∉',
    precedence: 60,
    kind: 'infix',
    relational: true,
  },

  {
    name: 'Add',
    symbol: '+',
    precedence: 70,
    kind: 'infix',
    assoc: 'left',
  },
  {
    name: 'Subtract',
    symbol: '-',
    fancySymbol: '−',
    precedence: 70,
    kind: 'infix',
    assoc: 'left',
  },
  {
    name: 'Multiply',
    symbol: '*',
    fancySymbol: '×',
    precedence: 80,
    kind: 'infix',
    assoc: 'left',
  },
  {
    name: 'Divide',
    symbol: '/',
    fancySymbol: '÷',
    precedence: 80,
    kind: 'infix',
    assoc: 'left',
  },

  {
    name: 'Negate',
    symbol: '-',
    fancySymbol: '−',
    precedence: 90,
    kind: 'prefix',
  },
  {
    name: 'Not',
    symbol: '!',
    fancySymbol: '¬',
    precedence: 90,
    kind: 'prefix',
  },

  {
    name: 'Power',
    symbol: '^',
    precedence: 100,
    kind: 'infix',
    assoc: 'right',
  },
  {
    name: 'Power',
    symbol: '**',
    precedence: 100,
    kind: 'infix',
    assoc: 'right',
  },
];

const INFIX_BY_SYMBOL = new Map<string, OperatorDef>();
const PREFIX_BY_SYMBOL = new Map<string, OperatorDef>();
const BY_NAME = new Map<MathJsonSymbol, OperatorDef>();

for (const def of OPERATORS) {
  if (def.kind === 'infix' && !INFIX_BY_SYMBOL.has(def.symbol))
    INFIX_BY_SYMBOL.set(def.symbol, def);
  if (def.kind === 'prefix' && !PREFIX_BY_SYMBOL.has(def.symbol))
    PREFIX_BY_SYMBOL.set(def.symbol, def);
  // First (canonical) row wins for the serializer view.
  if (!BY_NAME.has(def.name)) BY_NAME.set(def.name, def);
}

/** The infix operator for a (canonical, ASCII) spelling, if any. */
export function infixOperatorForSymbol(
  symbol: string
): OperatorDef | undefined {
  return INFIX_BY_SYMBOL.get(symbol);
}

/** The prefix operator for a (canonical, ASCII) spelling, if any. */
export function prefixOperatorForSymbol(
  symbol: string
): OperatorDef | undefined {
  return PREFIX_BY_SYMBOL.get(symbol);
}

/** The canonical operator definition for a MathJSON operator name (serializer). */
export function operatorDefByName(name: string): OperatorDef | undefined {
  return BY_NAME.get(name);
}
