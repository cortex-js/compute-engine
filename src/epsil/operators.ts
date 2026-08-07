import { MathJsonSymbol } from '../math-json/types.js';

//
// The single, shared Epsil operator table.
//
// This module is the **one source of truth** for operator spelling,
// precedence, associativity, and serializer spacing class. Both the parser
// (`parser.ts`) and the serializer (`serialize-epsil.ts`) consume it, so the
// two can never diverge (they historically did — `Element` vs `ElementOf`,
// `Multiply` at 390 vs `Divide` at 660 — because there were two tables).
//
// ─── Precedence ─────────────────────────────────────────────────────────────
//
// Loosest → tightest, in gaps of 10, **higher number binds tighter**. This
// direction keeps the serializer's existing parenthesization test
// (`argOp.precedence < op.precedence` ⇒ wrap the operand) working unchanged.
//
//   Assign :=         10   (infix, right, relational spacing)
//   (bare `=` is positional — it resolves to `:=` or `==`; see its row)
//   MapsTo |->        15   (infix, right)
//   Coalesce ??       18   (infix, right)
//   Pipe  |>  ~>      20   (infix, left)
//   KeyValuePair ->   30   (infix)
//   conditional `a if c else b`  35  (ternary — see CONDITIONAL_PRECEDENCE)
//   Or  ||            40   (infix, left)
//   And &&            50   (infix, left)
//   relational        60   (infix, n-ary chainable — see parser)
//     == === != < > <= >= in !in
//   Add + / Subtract -  70 (infix, left, same precedence)
//   Multiply * / Divide / / Mod %  80 (infix, left, same precedence)
//   Negate - / Not !  90   (prefix)
//   Power ^  **       100  (infix, right)
//   Factorial !       110  (postfix — binds tighter than Power's operands, so
//                           `2^3!` = `2^(3!)`, `-3!` = `-(3!)`, `3!^2` = `(3!)^2`)
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

/**
 * Precedence of the conditional expression `a if c else b` (→ `["If", c, a,
 * b]`).
 *
 * It is deliberately NOT a row in `OPERATORS`: the form is a word-spelled
 * *ternary*, so the parser recognizes it directly (`parseConditionalTail`)
 * rather than through `peekInfix` — a row here would make `peekInfix` claim
 * `if` as an ordinary binary infix and build the wrong shape. The serializer
 * registers it by name for the same reason. This constant is the one place
 * the two sides agree on its precedence.
 *
 * It sits between `KeyValuePair` (30) and `Or` (40) — looser than every
 * ordinary operator, exactly as in Python, where the conditional binds looser
 * than `or`:
 *
 *     a + b if c else d   →  (a + b) if c else d
 *     a || b if c else d  →  (a || b) if c else d
 *
 * but tighter than the four loosest forms, which are the ones that *bind* or
 * *pair* rather than compute. Each would otherwise capture the conditional's
 * consequent alone and leave a shape nobody can mean:
 *
 *     x = a if c else b     →  x = (a if c else b)      not (x = a) if …
 *     x |-> a if c else b   →  x |-> (a if c else b)    not (x |-> a) if …
 *     xs |> f if c else g   →  xs |> (f if c else g)    not (xs |> f) if …
 *     k -> v if c else w    →  k -> (v if c else w)     not (k -> v) if …
 *
 * The `->` case is the load-bearing one: below `KeyValuePair` the conditional
 * swallows the pair, and a dictionary entry whose value is conditional is not
 * merely misparsed but silently DROPPED (the element is no longer a
 * `KeyValuePair`, so the dictionary reader skips it).
 */
export const CONDITIONAL_PRECEDENCE = 35;

/**
 * Precedence of the dynamic type test `x is integer` (→ `["Element", x,
 * integer]`, the same shape a `match` type pattern lowers to).
 *
 * Like `CONDITIONAL_PRECEDENCE` this is deliberately NOT a row in `OPERATORS`:
 * the right operand of `is` is a **type**, not an expression, so the parser
 * recognizes the form directly (`parseTypeTestTail`) and hands the right side
 * to the type subparser. A row here would let `peekInfix` claim `is` as an
 * ordinary binary infix and parse `integer` as a symbol reference — losing the
 * parse-time typo diagnostic an annotation gets.
 *
 * It shares the relational precedence (60) with `in`, which it reads as: the
 * two spell the same `Element` test, and `x is integer && y is string` must
 * group as `(x is integer) && (y is string)`.
 *
 * The serializer has no `is` spelling to emit — `Element` serializes as `in`,
 * so `x is integer` reads back as `x in integer`. That is the same expression;
 * `is` is an input spelling that says "type test" at the point of writing.
 */
export const TYPE_TEST_PRECEDENCE = 60;

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
  // `:=` ALWAYS assigns, in every position. It is listed before the `=` row so
  // `operatorDefByName('Assign')` resolves here: the serializer therefore
  // always emits `:=`, never a bare `=`, which is what makes the round-trip
  // exact (see the `=` row below).
  {
    name: 'Assign',
    symbol: ':=',
    precedence: 10,
    kind: 'infix',
    assoc: 'right',
    relational: true,
  },
  // A bare `=` is POSITIONAL — it is `Assign` only as the top-level operator of
  // a statement whose left side is a binding target, and `Equal` everywhere
  // else. `if a = true { … }`, `Solve(x^2 = 4, x)` and `[a = 1]` are therefore
  // comparisons, while `x = 5` as a statement still assigns.
  //
  // Its `name` is a parser-internal marker that never reaches MathJSON: the
  // Pratt loop resolves it to the `:=` row or the `==` row before building a
  // node, so the resulting expression is indistinguishable from one written
  // with the explicit spelling — including the relational n-ary chaining that
  // makes `a = b = c` in expression position `Equal(a, b, c)`.
  //
  // The precedence here is only what `peekInfix` reports; the resolved row's
  // precedence is what actually binds (10 when assigning, 60 when comparing),
  // so `if x = 5 && y` groups as `(x = 5) && y` exactly like `==`.
  {
    name: 'AssignOrEqual',
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
  // Absence coalescing `a ?? b` → `Coalesce(a, b)`. It discharges Epsil
  // ABSENCE (`Missing`/`NaN`); it does NOT rescue an `Error`.
  //
  // Precedence 18 is pinned from both sides:
  //
  //   - LOOSER than `Pipe` (20), so `xs |> f ?? 0` is `(xs |> f) ?? 0` — the
  //     default is for the pipeline's result, never for the stage function.
  //   - TIGHTER than `MapsTo` (15), so `x |-> x.a ?? 0` puts the default
  //     inside the body rather than coalescing the whole lambda.
  //
  // That also places it below `Or` (40), below `KeyValuePair` (30) — exactly
  // where `Pipe` already sits, so `{k -> v ?? d}` needs the same parentheses
  // `{k -> (xs |> f)}` needs, and gets the same `dictionary-key-value-expected`
  // diagnostic without them — and above `Assign` (10). This is the C#
  // position: loosest of the computing operators. `a ?? b || c` is therefore
  // `a ?? (b || c)`; write parentheses when the other grouping is meant.
  //
  // Right-associative, so `a ?? b ?? c` is `Coalesce(a, Coalesce(b, c))`. The
  // parser does not flatten it into the variadic `Coalesce(a, b, c)`, and the
  // serializer spells both as the same chain: the two forms are
  // observationally equal, which is precisely what the `Coalesce` lazy-tail
  // rule in `library/core.ts` guarantees (an undecided operand leaves the tail
  // unevaluated, so no effect or error can distinguish them).
  {
    name: 'Coalesce',
    symbol: '??',
    precedence: 18,
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

  // Range `a..b` → `Range(a, b)`. Also spelled with the Unicode two-dot leader
  // `‥` (U+2025), which the parser normalizes to `..` via `FANCY_UNICODE`.
  // Precedence 65: tighter than the relational operators (60, so `k in 1..5`
  // parses as `k in (1..5)`) yet looser than Add/Subtract (70, so `1..n-1`
  // parses as `1..(n-1)`). The serializer keeps the function-call spelling
  // `Range(a, b)` (it also serves 3-argument `Range(a, b, step)`, which has no
  // infix form), so this row is parser-only — see `serialize-epsil.ts`.
  {
    name: 'Range',
    symbol: '..',
    fancySymbol: '‥',
    precedence: 65,
    kind: 'infix',
    assoc: 'left',
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
    name: 'Mod',
    symbol: '%',
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

  // Postfix factorial `n!`. Precedence 110 (above Power's 100) so it binds
  // tighter than Power's operands: `2^3!` = `2^(3!)`, `3!^2` = `(3!)^2`,
  // `-3!` = `-(3!)`. Shares the `!` spelling with prefix `Not` and the `!=`/
  // `!in` operators; the lexer's longest-match keeps `!=`/`!in` whole, and
  // prefix-vs-postfix is disambiguated by position (Swift-style).
  {
    name: 'Factorial',
    symbol: '!',
    precedence: 110,
    kind: 'postfix',
  },
];

const INFIX_BY_SYMBOL = new Map<string, OperatorDef>();
const PREFIX_BY_SYMBOL = new Map<string, OperatorDef>();
const POSTFIX_BY_SYMBOL = new Map<string, OperatorDef>();
const BY_NAME = new Map<MathJsonSymbol, OperatorDef>();

for (const def of OPERATORS) {
  if (def.kind === 'infix' && !INFIX_BY_SYMBOL.has(def.symbol))
    INFIX_BY_SYMBOL.set(def.symbol, def);
  if (def.kind === 'prefix' && !PREFIX_BY_SYMBOL.has(def.symbol))
    PREFIX_BY_SYMBOL.set(def.symbol, def);
  if (def.kind === 'postfix' && !POSTFIX_BY_SYMBOL.has(def.symbol))
    POSTFIX_BY_SYMBOL.set(def.symbol, def);
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

/** The postfix operator for a (canonical, ASCII) spelling, if any. */
export function postfixOperatorForSymbol(
  symbol: string
): OperatorDef | undefined {
  return POSTFIX_BY_SYMBOL.get(symbol);
}

/** The canonical operator definition for a MathJSON operator name (serializer). */
export function operatorDefByName(name: string): OperatorDef | undefined {
  return BY_NAME.get(name);
}
