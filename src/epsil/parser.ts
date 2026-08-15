import { MathJsonExpression, MathJsonSymbol } from '../math-json/types.js';
import {
  LITERAL_PARAM_PREFIX,
  isLiteralParamName,
} from '../math-json/symbols.js';
import { Origin } from '../common/debug.js';
import {
  parseType,
  parseTypeParameterClause,
  parseTypePrefix,
} from '../common/type/parse.js';
import { EFFECT_LABELS } from '../common/type/effects.js';
import type {
  FunctionSignature,
  Type,
  TypeResolver,
} from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';
import { TypeVariableError } from '../common/type/instantiate.js';
import {
  isStringObject,
  mapArgs,
  operand,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import { DIGITS, FANCY_UNICODE, HEX_DIGITS } from './characters.js';
import {
  DiagnosticMessage,
  FatalParsingError,
  ParsingDiagnostic,
} from './diagnostics.js';
import { tokenize } from './lexer.js';
import {
  CONDITIONAL_PRECEDENCE,
  OperatorDef,
  TYPE_TEST_PRECEDENCE,
  infixOperatorForSymbol,
  operatorDefByName,
  postfixOperatorForSymbol,
  prefixOperatorForSymbol,
} from './operators.js';
import { HARD_RESERVED_WORDS, LITERAL_WORDS } from './reserved-words.js';
import { SourceSpan, Token, TokenType } from './tokens.js';

/** Precedence of the prefix operators (`-`, `!`, and fancy aliases). Read from
 * the shared table so it can never drift. */
const PREFIX_PRECEDENCE = prefixOperatorForSymbol('!')!.precedence;

/** Precedence of `Multiply`, used for invisible multiplication (`2x`). Read
 * from the shared table so it stays in sync. */
const MULTIPLY_PRECEDENCE = infixOperatorForSymbol('*')!.precedence;

/** The two rows a bare `=` resolves to. Reading them from the shared table
 * keeps the positional `=` identical to the explicit spellings — same head,
 * same precedence, same associativity, same relational chaining. */
const ASSIGN_OPERATOR = infixOperatorForSymbol(':=')!;
const EQUAL_OPERATOR = infixOperatorForSymbol('==')!;

/** The characters that can head a prefix operator run (`-x`, `!a`, `+3`). */
const PREFIX_SIGILS = new Set(['!', '-', '+']);

/** The bare words admitted in a definition's **effect specifier slot** — the
 * Swift-style position between the parameter list and `->`
 * (`function roll(n) random -> integer { … }`). The effect labels (the closed
 * `EFFECT_LABELS` roster, spread below so a label admission needs no edit
 * here) plus the two set spellings `any` (unknown effects) and `pure`
 * (stated-empty). See
 * `docs/EFFECTS-MODEL.md`, "Epsil surface". */
const EFFECT_SPECIFIER_WORDS: ReadonlySet<string> = new Set<string>([
  ...EFFECT_LABELS,
  'any',
  'pure',
]);

/** A plain identifier — the names that can be spelled in a signature's named
 * argument list (`(n: integer)`). */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The effect words of a definition's specifier slot, with their source span
 * (used to place a diagnostic on an invalid specifier). */
type EffectSpecifier = { words: string[]; start: number; end: number };

/** One declaration of a definition's **type-parameter clause** —
 * `function f<T, U: number>(…)` (the M2 sugared generic form). The bound is
 * the verbatim source slice, so it re-assembles into the trailing `where`
 * clause exactly as written. */
type TypeParamDecl = { name: string; bound: string | null };

/** A parsed type-parameter clause and its source span (the span covers
 * `<` … `>` and anchors the clause's diagnostics). */
type TypeParamClause = {
  decls: TypeParamDecl[];
  start: number;
  end: number;
};

/** A type-grammar identifier (the clause's variable names live in the type
 * namespace, not the Epsil binding namespace). */
const TYPE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;

/** The trailing `where` clause of a definition head — the names it quantifies
 * (Phase 0 of the binding strategy of
 * `docs/plans/2026-08-11-where-clause-type-constraints.md`), its VERBATIM
 * source text (which rides into the assembled signature) and its span. */
type WhereClause = {
  names: string[];
  text: string;
  start: number;
  end: number;
};

/** The trailing `where` clause of a CONDITIONAL conformance
 * (`type list<T> is Comparable where T is Comparable { … }`): its verbatim
 * source text, its span, and the names it binds — which are in scope for the
 * implementation block's member signatures. */
type ConformanceClause = {
  text: string;
  start: number;
  end: number;
  names: ReadonlySet<string>;
};

/** Reported for a `where` clause in an annotation position that cannot carry
 * one. Verbatim from the type layer's own nested-clause rejection
 * (`instantiate.ts`), so the two surfaces say the same thing. */
const NESTED_WHERE_CLAUSE_MESSAGE =
  'A `where` clause can only quantify a top-level signature (or one arm of an overload set), not a nested one. Parenthesize a nested clause: `((A) -> B where A, B)`';

/** The contextual variance marker of a type-parameter clause, followed by (the
 * start of) the parameter's name. Mirrors `parseTypeParameterClause`'s reader;
 * `inout` is listed first so it is preferred over its `in` prefix. */
const VARIANCE_MARKER = /^(inout|in|out)\s+(?=[A-Za-z_])/;

/** If a comment starts at `pos`, the offset just past it; otherwise `pos`
 * unchanged. Block comments NEST, as they do in the lexer. Used by the
 * raw-source scanners, which would otherwise read a commented-out `where` as
 * a real clause. */
function skipComment(src: string, pos: number): number {
  if (src[pos] !== '/') return pos;
  if (src[pos + 1] === '/') {
    let p = pos + 2;
    while (p < src.length && !/[\n\r\u2028\u2029]/.test(src[p])) p += 1;
    return p;
  }
  if (src[pos + 1] !== '*') return pos;
  let p = pos + 2;
  let level = 1;
  while (level > 0 && p < src.length) {
    if (src[p] === '/' && src[p + 1] === '*') {
      level += 1;
      p += 2;
    } else if (src[p] === '*' && src[p + 1] === '/') {
      level -= 1;
      p += 2;
    } else p += 1;
  }
  return p;
}

/** Skip a string literal starting at `pos` (its opening quote), honoring
 * backslash escapes; returns the offset just past the closing quote (or the
 * end of `src` for an unterminated one). Used by the raw-source scanners,
 * which must not read a quote's contents as syntax. */
function skipStringLiteral(src: string, pos: number): number {
  const quote = src[pos];
  pos += 1;
  while (pos < src.length && src[pos] !== quote) {
    if (src[pos] === '\\') pos += 1;
    pos += 1;
  }
  return Math.min(pos + 1, src.length);
}

/** Does this OPERATOR token, following `type Name`, head a `type` statement?
 * `=` opens the body; `<` opens a type-parameter clause. `<>` is listed too
 * because the lexer maximal-munches a run of operator characters, so the empty
 * clause of `type alias Pair<> = …` arrives as ONE token — and it must still be
 * recognized, diagnosed and recovered as a type statement. */
function isTypeStatementHead(text: string): boolean {
  return text === '=' || text === '<' || text === '<>';
}

/** A resolver that accepts EVERY name, used only to ask the type grammar a
 * purely syntactic question (see `denotesTypeTarget`). Whether a named type
 * actually exists is a semantic verdict the engine reports at execution — it
 * must not change how a statement is READ. */
const ANY_TYPE_NAME_RESOLVER: TypeResolver = {
  get names(): string[] {
    return [];
  },
  forward: () => undefined,
  resolve: (name: string) => name as any,
  // Same posture for the `where T is P` slot: a purely syntactic reader
  // accepts every conformance. The registry lives in the engine, which checks
  // the constraint at each call site (protocols design P19).
  conformsTo: () => true,
};

/** Does `text` denote a conformance TARGET — i.e. does it parse, in full, as a
 * type expression? This is what separates `type list<integer> is Hashable`
 * (a conformance declaration) from `type + 1 is integer` (a type test on a
 * binding named `type`, since `type` is only a contextual keyword). */
function denotesTypeTarget(text: string): boolean {
  const target = text.trim();
  if (target.length === 0) return false;
  try {
    return (
      parseTypePrefix(target, ANY_TYPE_NAME_RESOLVER).end === target.length
    );
  } catch {
    return false;
  }
}

/**
 * The name of the first head variable a conformance target BOUNDS
 * (`list<T: number>`), or `null`.
 *
 * The trailing `where` clause is the single binding site of a conditional
 * conformance, so a bound in the head has no legal reading — and the type
 * subparser would only report `Expected >, got :`. Recognized here, lexically:
 * an identifier followed by `:` inside the head's angle brackets. (A named tuple
 * element — `tuple<a: integer>` — is a legitimate `name:` inside angle
 * brackets, so the scan requires the identifier to be a bare, argument-position
 * one: it stops at the first depth-1 `,`-separated entry that is not one.)
 */
/**
 * The protocol NAME of a `protocol-in-type-position` failure raised by a type
 * resolver, or `null` for any other error.
 *
 * The name is read back out of the message: a `TypeVariableError` carries only a
 * `code` and its text through `parseType()`'s wrap, so the backticked name in
 * the message is the channel. Both resolvers that raise it (this parser's and
 * the engine's) spell the message the same way.
 */
function protocolInTypePosition(e: unknown): string | null {
  if ((e as { code?: string }).code !== 'protocol-in-type-position')
    return null;
  const text =
    (e as { rawMessage?: string }).rawMessage ??
    (e instanceof Error ? e.message : '');
  return /`([^`]+)`/.exec(text)?.[1] ?? null;
}

function boundInConformanceHead(text: string): string | null {
  const m = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*</.exec(text);
  if (m === null) return null;
  let depth = 1;
  let pos = m[0].length;
  let atEntryStart = true;
  let name: string | null = null;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '<' || ch === '(' || ch === '[') {
      depth += 1;
      atEntryStart = false;
      pos += 1;
      continue;
    }
    if (ch === '>' || ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0) return null;
      atEntryStart = false;
      pos += 1;
      continue;
    }
    if (ch === ',' && depth === 1) {
      atEntryStart = true;
      name = null;
      pos += 1;
      continue;
    }
    if (ch === ':' && depth === 1 && name !== null) return name;
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    const id = atEntryStart
      ? /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos))
      : null;
    if (id === null) {
      atEntryStart = false;
      name = null;
      pos += 1;
      continue;
    }
    name = id[0];
    atEntryStart = false;
    pos += id[0].length;
  }
  return null;
}

//
// The Epsil parser turns a `Token[]` (from the Epsil `Lexer`) into a MathJSON
// expression plus a list of `ParsingDiagnostic`.
//
// It is modeled structurally on `src/common/type/parser.ts` (a `current`
// token, `advance`/`match`/`expect`) with two deliberate differences:
//
//   • It **never throws** (except the `#error` pragma, which throws a
//     `FatalParsingError` caught in `parseEpsil`). `error()` appends a
//     diagnostic and continues; `expect()` on a mismatch emits a diagnostic
//     and does not consume.
//   • It performs **panic-mode recovery** at two levels: within a bracketed
//     construct it skips to the matching closer; at the top level it skips to
//     the next statement boundary (a token preceded by a line break, or a
//     `;`). Each recovery emits exactly one diagnostic for the skipped region.
//
// Grammar (Phase 2, Stage B — operators, calls, indexing, collections):
//
//   primary    = number | symbol | verbatim-symbol | string | pragma
//              | parenthesized | tuple | list | set | dictionary
//   postfix    = primary ( call-clause | index-clause | field-clause )*   // tightest
//   unary      = prefix-op unary | postfix
//   expression = unary (postfix-op | infix-op expression | invisible-multiply)*
//   program    = shebang? (statement separator?)* EOF
//
// A `call-clause` is `( args )` and an `index-clause` is `[ args ]`, neither
// preceded by whitespace. A symbol callee `f(x)` becomes `["f", x]`; a
// compound callee `(g)(x)` becomes `["Apply", g, x]`; a number callee is never
// a call (`2(x)` is invisible multiplication). Indexing is 1-based:
// `xs[i]` → `["At", xs, i]`.
//
// `Invisible-multiply` inserts a `Multiply` (at `Multiply` precedence) when a
// number literal is immediately followed — no whitespace — by a token that
// begins a primary (`2x`, `2i`, `2(x+1)`).
//
// Precedence, associativity, and spelling come from the shared operator table
// (`operators.ts`), consumed by both parser and serializer.
//
// ─── The whitespace rule ────────────────────────────────────────────────────
//
// An infix operator continues the current expression only if it has whitespace
// on **both** sides or **neither** (the Phase 1 `precededByWhitespace` flag):
//
//   • `a + b`, `a+b`  → infix.
//   • `a +b`          → NOT infix: `a` ends; `+b` begins a new (prefix)
//                        statement. This makes separator-free programs parse
//                        deterministically.
//   • `a+ b`          → `asymmetric-operator-whitespace` diagnostic; recovers
//                        by treating the operator as infix so parsing continues.
//
// A prefix operator must have **no** whitespace before its operand (`-x`, not
// `- x`). Symmetrically, a **postfix** operator (`!` Factorial) must have **no**
// whitespace before itself (`x!`, not `x !`). That abutment rule is also what
// disambiguates postfix `!` (Factorial) from prefix `!` (Not): a `!` that abuts
// the preceding operand is a postfix factorial (`x!`), while a `!` preceded by
// whitespace is not a postfix, so `x !y` ends the `x` expression and `!y`
// begins a new (prefix `Not`) statement — a separator diagnostic on one line,
// never a silent misparse. (`x!=y` stays `NotEqual`: the lexer munches `!=`
// into one token, so no `!` postfix is ever seen.)
//
// ─── Statement sequencing ───────────────────────────────────────────────────
//
// Top-level (and block-level) statements are separated by a linebreak
// (`precededByLinebreak`) or `;`. Two full expressions on one line with no
// separator are a diagnostic (no silent `Block`-juxtaposition — now that calls
// land, `f(x)` is a call, not `Block(f, x)`).
//
// The top-level shape: 0 statements → `Nothing`, 1 statement → that expression
// (not wrapped), N statements → `["Block", …]`.
//

export class Parser {
  readonly source: string;
  readonly url?: string;

  /** Absolute offset in the *original* source of position 0 of `source`.
   * Non-zero only for the recursive sub-parse of a string interpolation
   * (`\(…)`) span, so its diagnostics and `sourceOffsets` land at the right
   * absolute position. */
  readonly baseOffset: number;

  readonly diagnostics: ParsingDiagnostic[] = [];

  /** Injected LaTeX parser for `$…$` islands (Part 3). Absent → an island is a
   * `latex-parsing-unavailable` diagnostic. Structurally mirrors the engine's
   * `ILatexSyntax` injection so `src/epsil` never statically imports
   * `latex-syntax`. */
  private readonly parseLatex?: (latex: string) => MathJsonExpression;

  /** When false (the default), the host-state pragmas `#env`/`#navigator` do
   * NOT read the host environment — they emit a `host-pragma-disabled`
   * diagnostic instead (an embedded notebook must not leak host state into a
   * document at parse time). The benign pragmas (`#line`/`#column`/`#url`/
   * `#filename`/`#date`/`#time`) are always available. */
  private readonly allowHostPragmas: boolean;

  private tokens: Token[];
  private pos = 0;

  /** Stack of open-bracket tokens, for bracket-level panic recovery. */
  private brackets: Token[] = [];

  /** Implicit guards accumulated while patternizing a single `match` case:
   * one `Element(name, type)` per type-annotated binding (`n: integer`). Reset
   * at the start of each case's pattern parse and conjoined with the explicit
   * guard. See `parseMatch`. */
  private matchTypeGuards: MathJsonExpression[] = [];

  /** Bracket depths at which a `match` case BODY is being parsed. At the top
   * level of a case body, a linebreak followed by an infix operator must END
   * the body — the next line is a new case — rather than continue the
   * expression: without this, a case body followed by a pinned case
   * (`1 => "one"` / `== lim => …`) silently fused into `"one" == lim`, and the
   * `=>` then diagnosed. Depth-gated so parenthesized subexpressions inside
   * the body keep the ordinary continuation behavior. */
  private matchBodyStops: number[] = [];

  /** Type names this program may refer to in an annotation: the host-supplied
   * names (`typeNames`, seeded from the engine's type resolver) plus every name
   * declared by a `type` statement parsed so far. Consulted by `typeResolver`,
   * which is handed to every type subparse — without it even a host-declared
   * type name would fail at parse time with `Unknown type`. */
  private readonly knownTypeNames: Set<string>;

  /** The PROTOCOL names this program may refer to — the engine's registry,
   * seeded by `executeEpsil`, plus every name a `protocol` statement parsed so
   * far declares.
   *
   * Kept strictly SEPARATE from {@link knownTypeNames}: a protocol name is not
   * a type (ruling P8), and adding one there would make `x: Comparable` parse.
   * It is consulted on the unknown-type path ONLY, to turn a generic
   * `type-annotation-error` into the `protocol-in-type-position` guidance that
   * points at the constrained-variable spelling. */
  private readonly protocolNames: Set<string>;

  /** Resolver shim over `knownTypeNames`, handed to every `parseTypePrefix` /
   * `parseType` call. The built `Type` is discarded by this parser (parse-time
   * typing is only a syntax check), so resolving a name to the bare name is
   * enough to make the reference parse. */
  private readonly typeResolver: TypeResolver;

  /** Each known sum VARIANT name mapped to the sum that declared it — the
   * host's (`executeEpsil` reads them off the engine's type registry) plus
   * every one this program's own sum statements added.
   *
   * Consulted by the sum-sugar trigger only, and load-bearing there: a variant
   * DOES name a type once it is declared, so re-running
   * `type X = red | green` would otherwise stop reading as the sugar and
   * silently redeclare `X` as an opaque nominal whose body is a union. */
  private readonly sumVariants: Record<string, string>;

  /** Statement-block nesting depth (incremented by `parseBlock`). Types are
   * engine-global, so a `type` statement at depth > 0 is a hard error
   * (`type-declaration-not-top-level`, ruled 2026-08-10 — no hoisting).
   * Depth 0 permits redeclaration silently: a top-level redeclaration is the
   * legitimate statement-replace flow (re-running a notebook cell). */
  private blockDepth = 0;

  /**
   * Lexically enclosing loop bodies (`while`/`for`) — the `break`/`continue`
   * context. Zero means "not in a loop", and those words are then a
   * `control-outside-loop` diagnostic.
   *
   * It is SAVED AND RESET TO ZERO across every function/lambda boundary, not
   * merely incremented: a `break` inside a lambda defined in a loop body must
   * not escape to that loop. This is not a style rule — the engine's `Block`
   * short-circuits on `Break`/`Continue` structurally, so a parser-only depth
   * check without the function boundary would let a `Break` returned from a
   * lambda body reach whatever loop happened to be running.
   */
  private loopDepth = 0;

  /**
   * True only while the OUTERMOST expression of a statement is being parsed —
   * the one position where a bare `=` means `Assign` rather than `Equal`.
   *
   * `parseExpression` consumes the flag on entry (reads it, then clears it),
   * so exactly one Pratt loop ever sees it true: every nested call — a call
   * argument, a collection element, a parenthesized group, an operator's right
   * operand — sees `false` and reads `=` as a comparison. `parseStatement`
   * sets it only on its fall-through expression-statement path, never around
   * the keyword heads, so an `if`/`while` condition and a `match` subject are
   * expression position too.
   */
  private assignPosition = false;

  /**
   * The `Equal` node most recently built from a BARE `=` (never from `==`).
   * Used to catch `a = b = 5`: the outer `=` assigns and the inner compares,
   * so the statement silently means "assign a boolean" to anyone arriving from
   * C or Python. Identity comparison against the assignment's right operand is
   * exact — `wrap()` returns a fresh object per node.
   */
  private lastBareEqualNode: MathJsonExpression | null = null;

  /** Set by {@link recoverAtStatementBoundary}: the statement that just
   * returned `null` has ALREADY emitted its diagnostic and resynchronized to
   * the next statement boundary. The statement loops (`parseProgram`,
   * `parseBlock`) check and clear it: they skip their own recovery (which
   * would swallow the next statement) and carry on with the following
   * statement instead of bailing out of the block. */
  private statementRecovered = false;

  /** A second statement produced by the statement just parsed, to be appended
   * to the program right after it.
   *
   * Set ONLY by the combined declare-and-conform form
   * (`type Point = tuple<…> is Comparable`), which lowers to TWO statements:
   * a `DeclareType` followed by a `DeclareConformance` (P15). Emitting a
   * `Block` instead is not an option — a nested `Block` pushes a scope, and
   * both statements are top-level only. Drained by `parseProgram`; the form is
   * top-level only, so `parseBlock` never sees one. */
  private pendingStatement: MathJsonExpression | null = null;

  /** While a `function f<T>(…)` definition HEAD is being parsed, the names its
   * type-parameter clause quantifies (G7 — the clause scopes over the head
   * only). `null` everywhere else. */
  private typeParamNames: ReadonlySet<string> | null = null;

  /** Collector for the clause names {@link typeResolver} resolves during a
   * single type subparse. Non-`null` only around the annotation whose "does it
   * mention a quantified variable?" answer is being taken — that answer drives
   * the erased lowering (§3.1): a parameter whose annotation mentions a clause
   * name lowers to a BARE symbol. Reading it off the resolver is exact — it is
   * the type parser itself reporting which identifiers it took as type
   * references — where a text scan would have to guess about `list<T>`,
   * `(T) -> real`, clause-name shadowing, and names like `Tx`. */
  private typeParamHits: Set<string> | null = null;

  constructor(
    source: string,
    options?: {
      url?: string;
      offset?: number;
      parseLatex?: (latex: string) => MathJsonExpression;
      allowHostPragmas?: boolean;
      typeNames?: readonly string[];
      protocolNames?: readonly string[];
      sumVariants?: Readonly<Record<string, string>>;
    }
  ) {
    this.source = source;
    this.url = options?.url;
    this.baseOffset = options?.offset ?? 0;
    this.parseLatex = options?.parseLatex;
    this.allowHostPragmas = options?.allowHostPragmas ?? false;
    this.knownTypeNames = new Set(options?.typeNames ?? []);
    this.protocolNames = new Set(options?.protocolNames ?? []);
    this.sumVariants = { ...options?.sumVariants };
    const names = this.knownTypeNames;
    const protocols = this.protocolNames;
    this.typeResolver = {
      get names(): string[] {
        return [...names];
      },
      forward: () => undefined,
      // Parse-time typing is a SYNTAX check, and conformance is not a
      // syntactic property: the parser has no engine, hence no protocol
      // registry, so every `where T is P` slot is admitted here and checked at
      // the call site by the engine's own resolver (protocols design P19).
      conformsTo: () => true,
      resolve: (name: string) => {
        // A PROTOCOL in type position. The engine's own resolver makes the same
        // diagnosis on the same path (`engine-type-resolver.ts`), but the Epsil
        // parser never reaches it: it resolves annotations against its own
        // known-name set and reports `Unknown type` first. Raised as the same
        // `TypeVariableError`, so the code survives `parseType`'s wrap.
        if (!names.has(name) && protocols.has(name))
          throw new TypeVariableError(
            'protocol-in-type-position',
            `\`${name}\` is a protocol, not a type. Use a constrained variable: \`where T is ${name}\``
          );
        if (!names.has(name)) return undefined;
        // Record a reference to a name the enclosing definition's clause
        // quantifies — see `typeParamHits`.
        if (this.typeParamNames?.has(name)) this.typeParamHits?.add(name);
        return name as any;
      },
    };
    this.tokens = tokenize(source);
  }

  //
  // ─── Token cursor ─────────────────────────────────────────────────────────
  //

  private get current(): Token {
    return this.tokens[this.pos];
  }

  private peek(n = 1): Token {
    return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
  }

  private advance(): Token {
    const token = this.current;
    if (token.type !== 'EOF') this.pos += 1;
    return token;
  }

  private match(type: TokenType): boolean {
    if (this.current.type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  /** Non-consuming type test. Unlike a direct `this.current.type === …`
   * comparison, calling through a method avoids persistent control-flow
   * narrowing of the `current` accessor across later `advance()` calls. */
  private check(type: TokenType): boolean {
    return this.current.type === type;
  }

  //
  // ─── Diagnostics ──────────────────────────────────────────────────────────
  //

  /** Append a diagnostic covering the (local) `[start, end]` range. */
  private error(
    message: DiagnosticMessage,
    start: number,
    end: number,
    severity: 'warning' | 'error' = 'error'
  ): void {
    this.diagnostics.push({
      severity,
      message,
      range: [this.baseOffset + start, this.baseOffset + end],
    });
  }

  /** Collect any lexical diagnostics carried by a token. */
  private harvest(token: Token): void {
    if (token.diagnostics)
      for (const m of token.diagnostics) this.error(m, token.start, token.end);
  }

  //
  // ─── MathJSON node construction ───────────────────────────────────────────
  //
  // Mirrors the old `exprOrigin`: every produced node carries
  // `sourceOffsets: [start, end]` (absolute).
  //

  private wrap(
    value: MathJsonExpression | number | string | readonly MathJsonExpression[],
    start: number,
    end: number
  ): MathJsonExpression {
    const sourceOffsets: [number, number] = [
      this.baseOffset + start,
      this.baseOffset + end,
    ];

    if (Array.isArray(value))
      return {
        fn: value as [MathJsonSymbol, ...MathJsonExpression[]],
        sourceOffsets,
      };

    if (typeof value === 'number')
      return { num: value.toString(), sourceOffsets };

    if (typeof value === 'string') {
      if (value[0] === "'" && value[value.length - 1] === "'")
        return { str: value.slice(1, -1), sourceOffsets };
      return { sym: value, sourceOffsets };
    }

    return { ...(value as object), sourceOffsets } as MathJsonExpression;
  }

  //
  // ─── Top-level ────────────────────────────────────────────────────────────
  //

  /**
   * Parse the whole token stream.
   *
   * Returns `null` when there is no expression at all (an empty program, or an
   * empty string interpolation); the caller maps that to `Nothing` (top level)
   * or drops it (interpolation).
   */
  parseProgram(): MathJsonExpression | null {
    // An optional shebang at the very start.
    if (this.current.type === 'SHEBANG') this.advance();

    const exprs: MathJsonExpression[] = [];

    while (this.current.type !== 'EOF') {
      const startPos = this.pos;
      const token = this.current;
      const diagBefore = this.diagnostics.length;
      this.statementRecovered = false;
      const expr = this.parseStatement();
      if (expr !== null) {
        exprs.push(expr);
        // The combined `type Name = … is Protocol` form lowers to two
        // top-level statements; the second is queued rather than nested.
        if (this.pendingStatement !== null) {
          exprs.push(this.pendingStatement);
          this.pendingStatement = null;
        }
        this.expectStatementSeparator();
      } else {
        this.pendingStatement = null;
        // If the failed parse already emitted a diagnostic, don't double-report.
        if (this.diagnostics.length === diagBefore)
          this.reportUnexpected(token);
        // …and if it already resynchronized, don't recover a second time: that
        // would swallow the next statement.
        if (this.statementRecovered) this.statementRecovered = false;
        else this.recoverAtTopLevel();
      }
      // Guard against a non-advancing iteration.
      if (this.pos === startPos) this.advance();
    }

    if (exprs.length === 0) return null;
    if (exprs.length === 1) return exprs[0];

    const first = exprs[0] as { sourceOffsets?: [number, number] };
    const last = exprs[exprs.length - 1] as {
      sourceOffsets?: [number, number];
    };
    return {
      fn: ['Block', ...exprs] as [MathJsonSymbol, ...MathJsonExpression[]],
      sourceOffsets: [
        first.sourceOffsets?.[0] ?? this.baseOffset,
        last.sourceOffsets?.[1] ?? this.baseOffset,
      ],
    };
  }

  //
  // ─── Statements ───────────────────────────────────────────────────────────
  //

  /**
   * A statement is (in priority order):
   *   1. A keyword-led construct: `let`/`const` declaration, `function`
   *      definition, `if`, `while`, or `for`. These keywords stay reserved in
   *      *expression* position (a bare `if`/`while`/… value is a diagnostic);
   *      they are only heads here, in statement position.
   *   2. A math-style function definition `f(x) = expr` (typed params
   *      supported).
   *   3. A type annotation `target: Type` / `target: Type = expr`
   *      (a declaration — see `tryParseAnnotation`).
   *   4. An ordinary expression.
   *
   * Annotations and the keyword heads are only recognized here (statement
   * position), never inside the expression grammar, so their tokens (`<`, `>`,
   * `->`, `|`, `&`, and the keyword words) never enter it.
   */
  private parseStatement(): MathJsonExpression | null {
    const t = this.current;
    if (t.type === 'SYMBOL') {
      switch (t.text) {
        case 'let':
          return this.parseDeclaration(false);
        case 'const':
          return this.parseDeclaration(true);
        case 'function':
          return this.parseFunctionDefinition();
        case 'if':
          return this.parseIf();
        case 'while':
          return this.parseWhile();
        case 'for':
          return this.parseFor();
        case 'match':
          return this.parseMatch();
        case 'break':
        case 'continue':
          return this.parseLoopControl();
        case 'type':
          // `type` is a CONTEXTUAL keyword: it stays a legal identifier
          // everywhere (`type = 5`, `type: integer = 4`, `let type = 5`, a bare
          // `type`). Only the unambiguous statement shape — `type Name =` or
          // the reserved generic slot `type Name<` — claims it as a head.
          if (this.isTypeStatement()) return this.parseTypeStatement();
          break;
        case 'protocol':
          // `protocol` is an ACTIVE word (it can no longer name a binding), so
          // it claims the statement unconditionally — a malformed declaration
          // is diagnosed rather than silently read as an expression.
          return this.parseProtocolStatement();
      }
    }

    if (this.isMathFunctionDef()) return this.parseMathFunctionDef();

    const annotation = this.tryParseAnnotation();
    if (annotation !== undefined) return annotation;

    // The expression-statement path — the ONE position where a bare `=` is an
    // assignment. Set only here, never around the keyword heads above, so an
    // `if`/`while` condition and a `match` subject are expression position and
    // read `=` as a comparison.
    this.assignPosition = true;
    try {
      return this.parseExpression(0);
    } finally {
      this.assignPosition = false;
    }
  }

  //
  // ─── Statement blocks (keyword-introduced `{ … }`) ────────────────────────
  //
  // A block is a brace-delimited sequence of statements (separated by a
  // linebreak or `;`), parsed only in keyword position (after
  // `function`/`if`/`else`/`while`/`for`). It is distinct from the Phase 2
  // `{…}` collection grammar (`Set`/`Dictionary`), which is a *primary*. The
  // block's value is its last expression (`Block` semantics). An empty
  // block is `["Block"]`.
  //

  private parseBlock(): MathJsonExpression {
    const open = this.advance(); // '{'
    this.brackets.push(open);

    // No type-name snapshot here: `type` statements are top-level only (a
    // block-local one is a hard error), so `knownTypeNames` only ever grows.
    this.blockDepth += 1;

    const stmts: MathJsonExpression[] = [];
    for (;;) {
      if (this.check('CLOSE_BRACE') || this.check('EOF')) break;
      const startPos = this.pos;
      const diagBefore = this.diagnostics.length;
      this.statementRecovered = false;
      const stmt = this.parseStatement();
      if (stmt === null) {
        if (this.diagnostics.length === diagBefore)
          this.reportUnexpected(this.current);
        // A statement that already resynchronized to the next boundary only
        // costs its own statement: keep parsing the rest of the block.
        if (this.statementRecovered) {
          this.statementRecovered = false;
          if (this.pos === startPos) this.advance();
          continue;
        }
        this.recoverInBracket();
        break;
      }
      stmts.push(stmt);
      // Separator: `;`, a linebreak, or the closing brace/EOF.
      if (this.check('SEMICOLON')) {
        this.advance();
      } else if (
        this.check('CLOSE_BRACE') ||
        this.check('EOF') ||
        this.current.precededByLinebreak
      ) {
        // A valid statement boundary.
      } else {
        this.error(
          ['unexpected-symbol', this.current.text],
          this.current.start,
          this.current.end
        );
        this.recoverInBracket();
        break;
      }
      if (this.pos === startPos) this.advance();
    }

    this.brackets.pop();

    let end: number;
    if (this.check('CLOSE_BRACE')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', '}'], open.start, open.end);
      end = this.current.start;
      if (isCloseToken(this.current.type)) this.advance();
    }

    this.blockDepth -= 1;

    return this.wrap(
      ['Block', ...stmts] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** `do { … }`: a statement block in expression position. The `do` keyword
   * turns the brace-delimited block (otherwise the `{…}` collection grammar)
   * into a `Block`, so it can appear anywhere an expression can (a lambda body
   * `x |-> do { … }`, an assignment RHS, an argument). A `do` not followed by
   * `{` is a diagnostic (with a fix-it suggesting `{`). */
  private parseDoBlock(): MathJsonExpression | null {
    const kw = this.advance(); // 'do'
    if (!this.check('OPEN_BRACE')) {
      this.diagnostics.push({
        severity: 'error',
        message: ['opening-bracket-expected', '{'],
        range: [
          this.baseOffset + this.current.start,
          this.baseOffset + this.current.end,
        ],
        fixits: [[this.baseOffset + kw.end, this.baseOffset + kw.end, ' {}']],
      });
      return null;
    }
    const block = this.parseBlock();
    // Widen the block's span to include the `do` keyword.
    return this.wrap(
      fnOps(block) ?? (['Block'] as MathJsonExpression[]),
      kw.start,
      this.localEnd(block) ?? this.previousEnd()
    );
  }

  //
  // ─── Declarations (`let` / `const`) ───────────────────────────────────────
  //
  // `let name`, `let name: Type`, `let name = value`, `let name: Type = value`
  // (and the same with `const`) lower to the enhanced engine `Declare`
  // primitive (Phase 4). The uniform lowering is: *type positional when
  // present; `value` (and `constant` for `const`) in a trailing attributes
  // `Dictionary`.* A missing type/value is simply omitted:
  //
  //   let x            → ["Declare", "x"]
  //   let x: real      → ["Declare", "x", {str:"real"}]
  //   let x = 5        → ["Declare", "x", ["Dictionary", ["KeyValuePair", value, 5]]]
  //   let x: real = 5  → ["Declare", "x", {str:"real"}, ["Dictionary", ["KeyValuePair", value, 5]]]
  //   const c = 6.28   → ["Declare", "c", ["Dictionary",
  //                         ["KeyValuePair", value, 6.28],
  //                         ["KeyValuePair", constant, True]]]
  //
  // `constant` is a *binding attribute* (`constant: True` → `isConstant`), not
  // a type; the engine enforces immutability. Reassigning a `const` THROWS
  // (`ce.assign`) rather than producing an error value — unlike a declared
  // type mismatch, which the `Assign` handler converts to one: a write the
  // binding can never accept is a program bug, not a value. An Epsil program
  // degrades it at the statement boundary into a `runtime-error` diagnostic
  // and keeps going. A bare annotation `name: Type = value` (no keyword) also
  // declares — see `tryParseAnnotation` — emitting the same `Declare` shape
  // (never `constant`).
  //

  private parseDeclaration(isConst: boolean): MathJsonExpression | null {
    const kw = this.advance(); // 'let' | 'const'
    // `let (x, y) = value` — a tuple destructuring declaration. The pattern
    // is irrefutable in FORM (bare symbols, `_` to skip a position, nested
    // tuple patterns — no literals or pins); a runtime shape mismatch is an
    // ordinary Error value. Requires an initializer; no type annotation.
    if (this.current.type === 'OPEN_PAREN') {
      const pattern = this.parseDeclarationPattern(new Set());
      if (pattern === null) return null;
      return this.finishDeclaration(isConst, kw.start, pattern, {
        allowType: false,
        requireValue: true,
      });
    }
    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], nameTok.start, nameTok.end);
      return null;
    }
    this.advance();
    this.harvest(nameTok);
    const name =
      nameTok.type === 'VERBATIM_SYMBOL' ? (nameTok.value ?? '') : nameTok.text;
    // The literal words (`true`/`false`, `Infinity`/`oo`/`NaN`) are reserved:
    // they cannot name a binding (the `` `true` `` verbatim form still can).
    // Other reserved words are contextual and remain usable as identifiers
    // here.
    if (nameTok.type === 'SYMBOL' && LITERAL_WORDS.has(name))
      this.error(['reserved-word', name], nameTok.start, nameTok.end);
    const nameNode = this.wrap({ sym: name }, nameTok.start, nameTok.end);
    return this.finishDeclaration(isConst, kw.start, nameNode);
  }

  /** A tuple destructuring pattern in a declaration: `(a, b)`, `(a, _, c)`,
   * `(a, (b, c))`. Elements are bare symbols (`_` skips a position) or nested
   * tuple patterns; at least two elements are required (one element is a
   * parenthesized name, not a tuple). `names` collects the bound names across
   * nesting levels so a duplicate anywhere in the pattern is a diagnostic.
   * Returns a `Tuple` node, or `null` after reporting a diagnostic. */
  private parseDeclarationPattern(
    names: Set<string>
  ): MathJsonExpression | null {
    const open = this.advance(); // '('
    const elements: MathJsonExpression[] = [];
    let ok = true;
    if (!this.check('CLOSE_PAREN')) {
      for (;;) {
        if (this.current.type === 'OPEN_PAREN') {
          const nested = this.parseDeclarationPattern(names);
          if (nested === null) ok = false;
          else elements.push(nested);
        } else if (
          this.current.type === 'SYMBOL' ||
          this.current.type === 'VERBATIM_SYMBOL'
        ) {
          const tok = this.advance();
          this.harvest(tok);
          const name =
            tok.type === 'VERBATIM_SYMBOL' ? (tok.value ?? '') : tok.text;
          if (tok.type === 'SYMBOL' && LITERAL_WORDS.has(name)) {
            this.error(['reserved-word', name], tok.start, tok.end);
            ok = false;
          }
          if (name !== '_') {
            if (names.has(name)) {
              this.error(['unexpected-symbol', name], tok.start, tok.end);
              ok = false;
            }
            names.add(name);
          }
          elements.push(this.wrap({ sym: name }, tok.start, tok.end));
        } else {
          this.error(['symbol-expected'], this.current.start, this.current.end);
          return null;
        }
        if (!this.match('COMMA')) break;
        if (this.check('CLOSE_PAREN')) break; // trailing comma
      }
    }
    let end = this.current.end;
    if (this.check('CLOSE_PAREN')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', ')'], open.start, open.end);
      return null;
    }
    if (elements.length < 2) {
      this.error(['symbol-expected'], open.start, end);
      return null;
    }
    if (!ok) return null;
    return this.wrap(
      ['Tuple', ...elements] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** Parse the optional `: Type` and `= value` tail of a declaration and build
   * the engine `Declare` node (type positional; `value`/`constant` in a
   * trailing attributes `Dictionary`). On a malformed type, returns `null`
   * after recovering at the statement boundary. The current token is the one
   * right after the declared name (`:`, `=`, or a separator). With `allowType:
   * false` a `:` annotation is a diagnostic; with `requireValue: true` a
   * missing `= value` is one (both used by destructuring declarations). */
  private finishDeclaration(
    isConst: boolean,
    start: number,
    nameNode: MathJsonExpression,
    options?: { allowType?: boolean; requireValue?: boolean }
  ): MathJsonExpression | null {
    let typeNode: MathJsonExpression | undefined;
    let annotationType: Type | undefined;
    let end = this.localEnd(nameNode) ?? this.previousEnd();

    if (this.check('OPERATOR') && this.current.text === ':') {
      if (options?.allowType === false) {
        this.error(
          ['unexpected-symbol', ':'],
          this.current.start,
          this.current.end
        );
        return null;
      }
      // A standalone annotation IS the whole type, so it may carry a trailing
      // `where` clause (`let f: (T) -> T where T: number = …`).
      const t = this.parseTypeAnnotation({ allowWhere: true });
      if (t === null) {
        // Diagnosed, cursor still at the error: skip the rest of the
        // declaration (ONCE) so the next statement still parses.
        this.recoverAtStatementBoundary();
        return null;
      }
      typeNode = t.node;
      annotationType = t.type;
      end = t.end;
    }

    let valueNode: MathJsonExpression | undefined;
    if (this.check('OPERATOR') && this.current.text === '=') {
      this.advance(); // '='
      const init = this.parseExpression(0);
      if (init === null) {
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
      } else {
        valueNode = init;
        end = this.localEnd(init) ?? this.previousEnd();
      }
    }
    if (options?.requireValue && valueNode === undefined) {
      // A destructuring declaration without an initializer binds nothing.
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }

    // Annotation-bound parameters (the "lambda lift"): a literal named
    // function-type annotation may bind the initializer's parameters.
    if (
      typeNode !== undefined &&
      annotationType !== undefined &&
      valueNode !== undefined
    )
      valueNode = this.reconcileFunctionAnnotation(
        typeNode,
        annotationType,
        valueNode
      );

    // Assemble `["Declare", name, type?, attributes?]`. The type is positional
    // when present; `value`/`constant` go in a trailing attributes Dictionary
    // that is omitted entirely when it would be empty.
    const parts: MathJsonExpression[] = ['Declare', nameNode];
    if (typeNode !== undefined) parts.push(typeNode);

    const entries: MathJsonExpression[] = [];
    if (valueNode !== undefined)
      entries.push(this.kvPair('value', valueNode, start, end));
    if (isConst)
      entries.push(
        this.kvPair(
          'constant',
          this.wrap({ sym: 'True' }, start, end),
          start,
          end
        )
      );
    if (entries.length > 0)
      parts.push(
        this.wrap(
          ['Dictionary', ...entries] as MathJsonExpression[],
          start,
          end
        )
      );

    return this.wrap(parts, start, end);
  }

  /**
   * Annotation-bound parameters (the "lambda lift") — see
   * `docs/plans/2026-08-08-annotation-lambda-lift.md`.
   *
   * A parameter name binds wherever it appears. When a declaration's
   * annotation is a LITERAL function type whose parameters are all named and
   * the initializer is not itself a function literal, the names bind: the
   * initializer becomes the body of a lambda whose parameters come from the
   * annotation, so `const f : (x: number) -> number = x^2 + 1` means
   * `= (x) |-> x^2 + 1`. The lifted `Declare` is the exact shape the
   * explicit-lambda spelling produces; the engine's declared-type
   * reconciliation does the rest.
   *
   * When the initializer IS a function literal, the two parameter lists must
   * agree positionally; a disagreement is a `parameter-name-mismatch`
   * diagnostic. Exception: under a NESTED-arrow annotation
   * (`(x: number) -> (y: number) -> number`) a lambda whose names don't
   * match the outermost level is read as the outer lift's BODY
   * (`= (y) |-> x + y` binds `x` around the inner lambda) — only the
   * outermost level ever lifts.
   *
   * Deliberately inert (the initializer must then be an explicit lambda):
   * alias annotations (a literal signature's source text starts with `(` —
   * binders are written where they bind, and a name that merely RESOLVES to
   * a signature does not bind); zero-parameter signatures (nothing to bind,
   * and the initializer may legitimately be a thunk-valued expression);
   * generic (`where`-quantified), effectful, optional/variadic, and partially named
   * signatures.
   */
  private reconcileFunctionAnnotation(
    typeNode: MathJsonExpression,
    type: Type,
    valueNode: MathJsonExpression
  ): MathJsonExpression {
    if (typeof type === 'string' || type.kind !== 'signature') return valueNode;
    const text = stringValue(typeNode);
    if (text === null || !text.startsWith('(')) return valueNode;
    if (type.typeParams !== undefined || type.effects !== undefined)
      return valueNode;
    if (type.optArgs !== undefined || type.variadicArg !== undefined)
      return valueNode;
    const args = type.args ?? [];
    if (args.length === 0) return valueNode;
    const names: string[] = [];
    for (const a of args) {
      if (a.name === undefined) return valueNode;
      names.push(a.name);
    }

    const ops = fnOps(valueNode);
    if (ops !== null && ops[0] === 'Function') {
      const params = ops.slice(2);
      const lambdaNames = params.map(paramNameOf);
      if (
        lambdaNames.length === names.length &&
        names.every((n, i) => lambdaNames[i] === n)
      )
        return valueNode; // the lambda IS the declared function value

      if (typeof type.result !== 'string' && type.result.kind === 'signature')
        return this.liftAnnotation(typeNode, text, names, valueNode);

      if (lambdaNames.length === names.length) {
        for (let i = 0; i < names.length; i++) {
          if (lambdaNames[i] === null || lambdaNames[i] === names[i]) continue;
          this.reportParameterNameMismatch(
            typeNode,
            type,
            lambdaNames,
            params[i],
            lambdaNames[i]!,
            names[i]
          );
          break;
        }
      }
      // An arity disagreement is the declared-type check's job, not ours.
      return valueNode;
    }

    return this.liftAnnotation(typeNode, text, names, valueNode);
  }

  /** Wrap a declaration initializer as a `Function` whose parameters are the
   * annotation's named parameters. Each synthesized parameter points at its
   * name's span inside the annotation source when it can be found there
   * (best-effort; offsets feed diagnostics only). */
  private liftAnnotation(
    typeNode: MathJsonExpression,
    text: string,
    names: string[],
    valueNode: MathJsonExpression
  ): MathJsonExpression {
    const start = this.localStart(valueNode) ?? 0;
    const end = this.localEnd(valueNode) ?? this.previousEnd();
    // The node's span starts at the `:`-adjacent whitespace while `text` is
    // trimmed; anchor name lookups at the trimmed text's actual offset.
    const typeStart = this.trimmedTypeStart(typeNode, text);
    let cursor = 0;
    const params = names.map((name) => {
      if (typeStart !== undefined) {
        const at = findParamName(text, name, cursor);
        if (at >= 0) {
          cursor = at + name.length;
          return this.wrap(
            { sym: name },
            typeStart + at,
            typeStart + at + name.length
          );
        }
      }
      return this.wrap({ sym: name }, start, end);
    });
    return this.wrap(
      ['Function', valueNode, ...params] as MathJsonExpression[],
      start,
      end
    );
  }

  /** `const f : (y: number) -> number = (x) |-> …` — the annotation and the
   * lambda name the same positional parameter differently. The fixit renames
   * the ANNOTATION to the lambda's names: the lambda's names are the binders
   * the body actually uses, so that direction is the semantics-preserving
   * single edit. */
  private reportParameterNameMismatch(
    typeNode: MathJsonExpression,
    type: FunctionSignature,
    lambdaNames: (string | null)[],
    at: MathJsonExpression,
    lambdaName: string,
    annotationName: string
  ): void {
    const anchor = nodeOffsets(at) ?? nodeOffsets(typeNode);
    const diagnostic: ParsingDiagnostic = {
      severity: 'error',
      message: ['parameter-name-mismatch', lambdaName, annotationName],
      range: anchor ? [anchor[0], anchor[1]] : [0, 0],
    };
    const text = stringValue(typeNode);
    const typeStart =
      text !== null ? this.trimmedTypeStart(typeNode, text) : undefined;
    if (text !== null && typeStart !== undefined) {
      const args = type.args ?? [];
      diagnostic.fixits = [
        [
          this.baseOffset + typeStart,
          this.baseOffset + typeStart + text.length,
          typeToString({
            ...type,
            args: args.map((a, i) => ({
              ...a,
              name: lambdaNames[i] ?? a.name,
            })),
          }),
        ],
      ];
    }
    this.diagnostics.push(diagnostic);
  }

  /** Local offset where a held type node's TRIMMED source text begins (the
   * node's span starts right after the `:`, including any whitespace). */
  private trimmedTypeStart(
    typeNode: MathJsonExpression,
    text: string
  ): number | undefined {
    const start = this.localStart(typeNode);
    const end = this.localEnd(typeNode);
    if (start === undefined || end === undefined) return undefined;
    const at = this.source.slice(start, end).indexOf(text);
    return at < 0 ? start : start + at;
  }

  /** Build a `["KeyValuePair", key, value]` attributes entry with a bare-symbol
   * key (matching the engine's attributes-Dictionary accessor). */
  private kvPair(
    key: string,
    value: MathJsonExpression,
    start: number,
    end: number
  ): MathJsonExpression {
    return this.wrap(
      [
        'KeyValuePair',
        this.wrap({ sym: key }, start, end),
        value,
      ] as MathJsonExpression[],
      start,
      end
    );
  }

  //
  // ─── Type declarations (`type name = …` / `type alias name = …`) ──────────
  //
  // Two forms, mirroring the engine's `DeclareType` primitive:
  //
  //   type point = tuple<x: integer, y: integer>       // NOMINAL
  //     → ["DeclareType", "point", {str: "tuple<x: integer, y: integer>"}]
  //
  //   type alias pair = tuple<number, number>          // STRUCTURAL alias
  //     → ["DeclareType", "pair", {str: "tuple<number, number>"},
  //          ["Dictionary", ["KeyValuePair", "alias", "True"]]]
  //
  // The name is a symbol and the body is the *trimmed source text* of the type
  // (like every other Epsil type position — the parsed Type is discarded).
  // The bare form declares a new, distinct type (nominal-by-default is already
  // `DeclareType`'s contract, so it needs no attributes); the `alias` word —
  // matching the `alias -> True` attribute and `ce.declareType`'s
  // `{alias: true}` — declares a structural abbreviation.
  //
  // `alias` is NOT reserved: the disambiguation is pure lookahead. `type alias
  // point = …` is an alias statement because a NAME and `=`/`<` follow
  // `alias`; `type alias = tuple<…>` (only `=` after `alias`) declares a
  // nominal type literally named `alias` — legal, discouraged, pinned in a
  // test.
  //
  // `type alias Name<T> = …` declares a GENERIC alias: the clause rides the
  // attributes bag as its source TEXT (`typeParams -> "T, U: number"`), and
  // the body parses with those names in scope as type parameters. The BARE
  // (nominal) form with a clause keeps its `type-variables-unsupported`
  // diagnostic — parameterized nominal types are out of scope.
  //

  /** Does the current `type` SYMBOL token head a `type` statement? Only the
   * shapes `type Name =` / `type Name<` and `type alias Name =` /
   * `type alias Name<` claim it; everything else leaves `type` an ordinary
   * identifier. */
  private isTypeStatement(): boolean {
    // `type alias Name =` / `type alias Name<`: probed FIRST, and it requires
    // a NAME after `alias` — so `type alias = …` falls through to the bare
    // form below, declaring a nominal type named `alias` (D8).
    if (this.isTypeAliasAt(1)) return true;

    // CONFORMANCE (`type string is Hashable`, `type list<integer> is …`): a
    // same-line, top-level `is` claims the statement too — but ONLY when the
    // span between `type` and that `is` actually denotes a type: it must
    // start with a name and parse, in full, as a type expression. Without
    // that check any expression whose head is a binding named `type` and
    // which contains a top-level `is` (`type + 1 is integer`) would be
    // hijacked. Statement position is otherwise disjoint from the
    // expression-position `is` type test (`x is integer`), which the Pratt
    // loop reads at TYPE_TEST_PRECEDENCE — and requiring at least one token
    // between `type` and `is` keeps `type is integer` (a type test on a
    // binding NAMED `type`) an expression, as before.
    const head = this.peek(1);
    if (head.type === 'SYMBOL' || head.type === 'VERBATIM_SYMBOL') {
      const conf = this.scanConformanceIs(this.pos + 1);
      if (
        conf !== null &&
        !conf.hasAssign &&
        conf.at > this.pos + 1 &&
        denotesTypeTarget(
          this.source.slice(this.current.end, this.tokens[conf.at].start)
        )
      )
        return true;
    }

    const name = this.peek(1);
    if (name.type !== 'SYMBOL') return false;
    const next = this.peek(2);
    return next.type === 'OPERATOR' && isTypeStatementHead(next.text);
  }

  /**
   * Locate the `is` of a conformance declaration: a SYMBOL `is` at bracket
   * depth 0, on the same line as the `type` head. Returns its token INDEX and
   * whether a top-level `=` precedes it — the combined declare-and-conform
   * form (`type Point = tuple<…> is Comparable`).
   *
   * Scanned over TOKENS rather than the raw source so the angle characters of
   * a target application (`type list<integer> is …`) — which the Epsil lexer
   * maximal-munches into `OPERATOR` runs — do not need bracket tracking.
   *
   * `from` is the token index just past the `type` word.
   */
  private scanConformanceIs(from: number): {
    at: number;
    hasAssign: boolean;
  } | null {
    let depth = 0;
    let hasAssign = false;
    for (let i = from; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === 'EOF' || t.type === 'SEMICOLON') return null;
      if (t.precededByLinebreak) return null;
      switch (t.type) {
        case 'OPEN_PAREN':
        case 'OPEN_BRACKET':
        case 'OPEN_BRACE':
          depth += 1;
          break;
        case 'CLOSE_PAREN':
        case 'CLOSE_BRACKET':
        case 'CLOSE_BRACE':
          if (depth === 0) return null;
          depth -= 1;
          break;
        case 'OPERATOR':
          if (depth === 0 && t.text === '=') hasAssign = true;
          break;
        case 'SYMBOL':
          if (depth === 0 && t.text === 'is') return { at: i, hasAssign };
          break;
      }
    }
    return null;
  }

  /** Is the token `n` ahead of the current one the `alias` word of a
   * `type alias Name =` / `type alias Name<` statement? */
  private isTypeAliasAt(n: number): boolean {
    const alias = this.peek(n);
    if (alias.type !== 'SYMBOL' || alias.text !== 'alias') return false;
    if (this.peek(n + 1).type !== 'SYMBOL') return false;
    const next = this.peek(n + 2);
    return next.type === 'OPERATOR' && isTypeStatementHead(next.text);
  }

  private parseTypeStatement(): MathJsonExpression | null {
    const kw = this.advance(); // 'type'

    // CONFORMANCE (`type <target> is P₁ & P₂ [{ … }]`): the target is the
    // type-expression SOURCE up to a same-line, top-level `is`, so it may be
    // any named ground type (`string`, `list<integer>`, `Point`) — the engine
    // is the authority on what a legal target is. When a top-level `=`
    // precedes the `is`, this is the COMBINED form: the declaration is parsed
    // by the ordinary path below and the conformance is queued after it.
    const conf = this.scanConformanceIs(this.pos);
    if (conf !== null && !conf.hasAssign)
      return this.parseConformanceStatement(kw, conf.at);

    // `alias` is consumed only in the `type alias Name =`/`<` shape (checked
    // relative to the CURRENT token, now that `type` is consumed).
    const isAlias = this.isTypeAliasAt(0);
    if (isAlias) this.advance(); // 'alias'
    const nameTok = this.advance(); // the type name
    this.harvest(nameTok);
    const name = nameTok.text;
    if (HARD_RESERVED_WORDS.has(name)) {
      this.error(['reserved-word', name], nameTok.start, nameTok.end);
      return null;
    }

    // Types are ENGINE-GLOBAL (`docs/plans/2026-08-10-global-type-registry.md`):
    // a `type` statement is legal only at the top level of a program. Inside a
    // block or a function body it is a hard error — no hoisting. The name is
    // NOT seeded (a declaration that errors declares nothing), so a later
    // annotation naming it gets an accurate `Unknown type`; recovery skips
    // just this statement, keeping the rest of the block. The engine's
    // `DeclareType` handler enforces the same rule for the box route.
    if (this.blockDepth > 0) {
      this.error(
        ['type-declaration-not-top-level', name],
        kw.start,
        nameTok.end
      );
      this.recoverAtStatementBoundary();
      return null;
    }

    // Record the name BEFORE the body is parsed: a type alias may refer to
    // itself (`type json = list<json> | integer`), and later annotations in the
    // same program must see it too.
    const wasKnown = this.knownTypeNames.has(name);
    this.knownTypeNames.add(name);
    // …but undo that seeding on every failure path below: a declaration that
    // did not parse declares nothing, and leaving the name in the set makes a
    // later annotation parse cleanly only to fail at evaluation with a
    // confusing `Unknown type`. A name that was ALREADY known (host-supplied,
    // or an earlier `type` statement) is left alone.
    const unseed = (): void => {
      if (!wasKnown) this.knownTypeNames.delete(name);
    };

    // The type-parameter clause of a GENERIC alias (`type alias Pair<T> = …`)
    // or of a parameterized NOMINAL type (`type tree<out T> = …`). Only the
    // nominal form takes a VARIANCE marker: an alias is transparent, so it has
    // no relation between two applications to declare.
    let clauseText: string | undefined;
    let clauseDecls: readonly TypeParamDecl[] = [];
    if (this.check('OPERATOR') && this.current.text.startsWith('<')) {
      const clauseStart = this.current.start;
      const diagBefore = this.diagnostics.length;
      // The marker is SCANNED for both forms so an alias that writes one gets
      // the explanatory diagnostic below rather than a bare syntax error.
      const clause = this.parseTypeParamClause(name, true);
      // `undefined` is unreachable (the `<` was just checked); `null` and an
      // EMPTY clause (`<>`, already diagnosed) declare nothing.
      if (
        clause === null ||
        clause === undefined ||
        clause.decls.length === 0
      ) {
        unseed();
        this.recoverAtStatementBoundary();
        return null;
      }
      // The clause TEXT rides the lowering (A1): the engine re-parses it with
      // the shared clause parser on the `DeclareType` route. Sliced from the
      // source between the angle brackets, so the author's spelling of a bound
      // (`T: list<integer>`) survives verbatim.
      // Trimmed for the lowering, but the shared parser reports positions
      // relative to the TRIMMED text, so the leading-whitespace it dropped has
      // to be added back when a diagnostic is placed (`Pair< number, T>`).
      const rawText = this.source.slice(clauseStart + 1, clause.end - 1);
      const text = rawText.trim();
      const textOffset = rawText.length - rawText.trimStart().length;

      // The scanner above is the SOURCE-RANGE half of the clause reader; the
      // shared parser in the type layer is the authority on what a clause
      // MEANS (reserved names, duplicates, ground bounds). Run it here so the
      // statement is rejected at parse time rather than lowering text the
      // engine will refuse — and so the two readers cannot drift. A shape the
      // scanner already diagnosed (a duplicate name, which it drops) is not
      // re-reported.
      const checked = parseTypeParameterClause(text, this.typeResolver);
      if ('error' in checked) {
        if (this.diagnostics.length === diagBefore)
          this.error(
            ['type-annotation-error', checked.error.message],
            clauseStart + 1 + textOffset + checked.error.position,
            Math.min(
              clauseStart + 2 + textOffset + checked.error.position,
              this.source.length
            )
          );
        unseed();
        this.recoverAtStatementBoundary();
        return null;
      }

      // Variance on a transparent alias is meaningless (design §2). Diagnosed
      // here rather than left to the engine so the author sees it at the
      // declaration.
      const marked = isAlias
        ? checked.params.find((p) => p.variance !== undefined)
        : undefined;
      if (marked !== undefined) {
        this.error(
          [
            'type-annotation-error',
            `The type parameter \`${marked.name}\` of the alias "${name}" cannot declare a variance: an alias is transparent, so its applications are expanded rather than related`,
          ],
          clauseStart,
          clause.end
        );
        unseed();
        this.recoverAtStatementBoundary();
        return null;
      }

      clauseDecls = clause.decls;
      clauseText = text;
    }

    // The clause's names are in scope for the BODY (and only for it): `tuple<T,
    // T>` must read `T` as a type parameter, not report an unknown type. Only
    // the names this clause ADDED are removed afterwards, so a parameter
    // shadowing a user type leaves that type known.
    const seededParams = clauseDecls.filter(
      (d) => !this.knownTypeNames.has(d.name)
    );
    for (const d of clauseDecls) this.knownTypeNames.add(d.name);
    const unseedParams = (): void => {
      for (const d of seededParams) this.knownTypeNames.delete(d.name);
    };

    const eq = this.advance(); // '='

    // SUM-TYPE SUGAR (A1): a NON-alias `type` statement whose body is a
    // top-level union of constructor arms declares the variants and the sum in
    // one statement. Probed BEFORE the ordinary body parse, since call-form
    // (`plus(op1: node, op2: node)`) is not type syntax at all. A body that
    // does not trigger falls through to the existing path untouched.
    // A trailing conformance clause takes the ordinary type-body path (which
    // stops at `is` — `is` cannot begin a type token): the sum scanner reads
    // the RAW source to the end of the statement and would swallow the
    // clause. Combining sum sugar with a conformance is not supported in
    // phase 1.
    if (!isAlias && conf === null) {
      const sum = this.parseSumTypeArms(eq.end, name);
      if (sum !== undefined) {
        unseedParams();
        if (sum === null) {
          unseed();
          this.recoverAtStatementBoundary();
          return null;
        }
        return this.buildSumTypeStatement(
          kw.start,
          name,
          nameTok,
          clauseText,
          sum
        );
      }
    }

    // A `type` body IS the whole type, so it may carry a trailing clause — and
    // a NOMINAL `type` body is the ONE position where an `object<…>` layout is
    // legal (every other route refuses the form with `object-type-not-inline`).
    // A `type alias` body is not one of them: an object type is nominal, and a
    // structural alias to a layout would make two aliases of the same shape
    // interchangeable — exactly the subtyping between object types Appendix B
    // rules out.
    const body = this.parseTypeBody(eq.end, {
      allowWhere: true,
      allowObjectType: !isAlias,
    });
    unseedParams();
    if (body === null) {
      unseed();
      // The type subparse diagnosed but did not move: skip the rest of this
      // statement (ONCE — see `recoverAtStatementBoundary`) so the next one
      // still parses.
      this.recoverAtStatementBoundary();
      return null;
    }

    const start = kw.start;
    const end = body.end;
    const parts: MathJsonExpression[] = [
      'DeclareType',
      this.wrap({ sym: name }, nameTok.start, nameTok.end),
      body.node,
    ];
    // Attributes are carried only when something departs from the defaults:
    // nominal is `DeclareType`'s default, so the bare unparameterized form
    // needs none. `alias -> True` marks the structural form; a clause rides as
    // its source TEXT, bracket-free (A1 / §3.1), for BOTH forms — the variance
    // marker of a parameterized nominal type is just more clause text.
    if (isAlias || clauseText !== undefined) {
      const entries: MathJsonExpression[] = ['Dictionary'];
      if (isAlias)
        entries.push(
          this.kvPair(
            'alias',
            this.wrap({ sym: 'True' }, start, end),
            start,
            end
          )
        );
      if (clauseText !== undefined)
        entries.push(
          this.kvPair(
            'typeParams',
            this.wrap({ str: clauseText }, start, end),
            start,
            end
          )
        );
      parts.push(this.wrap(entries, start, end));
    }
    const declaration = this.wrap(parts, start, end);

    // The COMBINED form: the declaration is this statement's node, and the
    // conformance — whose target is the name just declared — is queued as the
    // NEXT top-level statement (P15; both are top-level only, so a `Block`
    // wrapper is not an option).
    if (
      conf !== null &&
      this.current.type === 'SYMBOL' &&
      this.current.text === 'is'
    ) {
      const conformance = this.parseConformanceTail(
        start,
        this.wrap({ str: name }, nameTok.start, nameTok.end)
      );
      if (conformance === null) {
        unseed();
        return null;
      }
      this.pendingStatement = conformance;
    }
    return declaration;
  }

  //
  // ─── Protocol declarations and conformance ────────────────────────────────
  //
  // `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A. Three statement forms:
  //
  //   protocol Comparable {
  //     function compare(self: Self, other: Self) -> "<" | "=" | ">"
  //     readonly key: string
  //   }
  //     → ["DeclareProtocol", "Comparable",
  //         ["Dictionary",
  //           ["KeyValuePair", "compare",
  //             ["Pair", {str: "function"},
  //                      {str: "(self: Self, other: Self) -> \"<\"|\"=\"|\">\""}]],
  //           ["KeyValuePair", "key", ["Pair", {str: "readonly"}, {str: "string"}]]]]
  //
  //   type string is Hashable & Comparable
  //     → ["DeclareConformance", {str: "string"}, ["List", "Hashable", "Comparable"]]
  //
  //   type string is Comparable { function compare(a, b) { … } }
  //     → ["DeclareConformance", {str: "string"}, ["List", "Comparable"],
  //         ["Dictionary", ["KeyValuePair", "compare", <function literal>]]]
  //
  // Like a `type` body, every member SIGNATURE is captured as trimmed source
  // TEXT and re-parsed by the engine — which is what keeps `Self` (a textual
  // substitution token, never a declarable type) engine-side.
  //
  // `readonly`/`readwrite`/`get`/`set`/`Self` are CONTEXTUAL: they mean
  // something only inside these braces and are not reserved words. Only
  // `protocol` itself is claimed.
  //

  /** The statement heads that are CONTEXTUAL rather than reserved (`let type =
   * 5` parses, so they are ordinary identifiers everywhere else). A
   * conformance tail refuses them all the same: the only way one appears
   * there is a missing protocol name. */
  private static readonly CONTEXTUAL_STATEMENT_WORDS: ReadonlySet<string> =
    new Set(['let', 'type', 'alias']);

  /** `protocol NAME { member* }` — top-level only, like `type`. */
  private parseProtocolStatement(): MathJsonExpression | null {
    const kw = this.advance(); // 'protocol'

    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['protocol-name-expected'], nameTok.start, nameTok.end);
      this.recoverAtStatementBoundary();
      return null;
    }
    this.advance();
    this.harvest(nameTok);
    const name =
      nameTok.type === 'VERBATIM_SYMBOL' ? (nameTok.value ?? '') : nameTok.text;
    if (nameTok.type === 'SYMBOL' && HARD_RESERVED_WORDS.has(name)) {
      this.error(['reserved-word', name], nameTok.start, nameTok.end);
      this.recoverAtStatementBoundary();
      return null;
    }
    // A protocol declared by THIS program is a protocol name for the rest of it,
    // so a later annotation naming it gets `protocol-in-type-position` rather
    // than `Unknown type`. NOT a type name (P8) — see `protocolNames`.
    //
    // Seeded here, for the member block, and UNSEEDED on every failure return
    // below: a declaration the parser discards must not flavor the diagnostics
    // of the rest of the program. A name that was already known — the engine's
    // registry, or an earlier statement re-declaring the protocol — stays.
    const knownProtocol = this.protocolNames.has(name);
    const discardProtocol = (): null => {
      if (!knownProtocol) this.protocolNames.delete(name);
      return null;
    };
    this.protocolNames.add(name);

    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      this.recoverAtStatementBoundary();
      return discardProtocol();
    }

    const open = this.advance(); // '{'
    this.brackets.push(open);
    const entries: MathJsonExpression[] = ['Dictionary'];
    // `Self` names the conforming type inside a protocol declaration. Seeded
    // for the member signatures only — it never reaches the engine's type
    // registry (P12), and a user type of the same name is left known.
    const unseedSelf = this.seedSelfTypeName();
    try {
      for (;;) {
        while (this.match('SEMICOLON')) {
          /* empty member */
        }
        if (this.check('CLOSE_BRACE') || this.check('EOF')) break;
        const startPos = this.pos;
        const member = this.parseProtocolMember(name);
        if (member === null) {
          this.recoverInBracket();
          break;
        }
        entries.push(member);
        if (this.pos === startPos) this.advance();
      }
    } finally {
      unseedSelf();
    }
    this.brackets.pop();

    let end: number;
    if (this.check('CLOSE_BRACE')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', '}'], open.start, open.end);
      end = this.current.start;
      if (isCloseToken(this.current.type)) this.advance();
    }

    // Protocols are engine-global, exactly like types: a declaration inside a
    // block or a function body is a hard error, with no hoisting. Checked
    // AFTER the member block is consumed — "the statement is parsed and
    // discarded", so the cursor lands past the closing brace and the rest of
    // the enclosing block still parses. The engine's `DeclareProtocol`
    // handler enforces the same rule for the box route.
    if (this.blockDepth > 0) {
      this.error(
        ['protocol-declaration-not-top-level', name],
        kw.start,
        nameTok.end
      );
      this.recoverAtStatementBoundary();
      return discardProtocol();
    }

    const parts: MathJsonExpression[] = [
      'DeclareProtocol',
      this.wrap({ sym: name }, nameTok.start, nameTok.end),
    ];
    // A SEMANTIC protocol (`protocol Copyable {}`) declares no members, so it
    // carries no dictionary at all.
    if (entries.length > 1) parts.push(this.wrap(entries, open.start, end));
    return this.wrap(parts, kw.start, end);
  }

  /** One member of a `protocol` body: `function f(…) -> T`, or
   * `readonly`/`readwrite` NAME `:` T. */
  private parseProtocolMember(protocolName: string): MathJsonExpression | null {
    const kw = this.current;
    if (kw.type !== 'SYMBOL') {
      this.error(
        ['protocol-member-signature-expected', protocolName],
        kw.start,
        kw.end
      );
      return null;
    }

    if (kw.text === 'function') {
      this.advance();
      const nameTok = this.current;
      if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
        this.error(['symbol-expected'], nameTok.start, nameTok.end);
        return null;
      }
      this.advance();
      this.harvest(nameTok);
      const member =
        nameTok.type === 'VERBATIM_SYMBOL'
          ? (nameTok.value ?? '')
          : nameTok.text;
      if (!this.check('OPEN_PAREN')) {
        this.error(
          ['opening-bracket-expected', '('],
          this.current.start,
          this.current.end
        );
        return null;
      }
      // The whole `(params) -> result` IS a signature type, so the type
      // subparser reads it in one go from the raw source (the `parseTypeBody`
      // pattern) and the cursor is re-synced afterwards.
      const signature = this.parseProtocolSignature();
      if (signature === null) return null;
      return this.kvPair(
        member,
        this.wrap(
          [
            'Pair',
            this.wrap({ str: 'function' }, kw.start, kw.end),
            signature.node,
          ] as MathJsonExpression[],
          kw.start,
          signature.end
        ),
        kw.start,
        signature.end
      );
    }

    if (kw.text === 'readonly' || kw.text === 'readwrite') {
      const kind = kw.text;
      this.advance();
      const nameTok = this.current;
      if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
        this.error(['symbol-expected'], nameTok.start, nameTok.end);
        return null;
      }
      this.advance();
      this.harvest(nameTok);
      const member =
        nameTok.type === 'VERBATIM_SYMBOL'
          ? (nameTok.value ?? '')
          : nameTok.text;
      if (!this.check('OPERATOR') || this.current.text !== ':') {
        this.error(
          ['protocol-member-signature-expected', protocolName],
          this.current.start,
          this.current.end
        );
        return null;
      }
      const colon = this.advance(); // ':'
      const type = this.parseTypeBody(colon.end);
      if (type === null) return null;
      return this.kvPair(
        member,
        this.wrap(
          [
            'Pair',
            this.wrap({ str: kind }, kw.start, kw.end),
            type.node,
          ] as MathJsonExpression[],
          kw.start,
          type.end
        ),
        kw.start,
        type.end
      );
    }

    // A bare `value: string` member: the author meant a property but left out
    // the keyword that says whether it can be written.
    if (this.peek(1).type === 'OPERATOR' && this.peek(1).text === ':') {
      this.error(
        ['protocol-member-keyword-missing', kw.text],
        kw.start,
        this.peek(1).end
      );
      return null;
    }

    this.error(
      ['protocol-member-signature-expected', protocolName],
      kw.start,
      kw.end
    );
    return null;
  }

  /** `type <target> is …` — the standalone conformance statement. `isIndex`
   * is the token index of the `is`, located by {@link scanConformanceIs}. */
  private parseConformanceStatement(
    kw: Token,
    isIndex: number
  ): MathJsonExpression | null {
    const isTok = this.tokens[isIndex];
    const target = this.source.slice(kw.end, isTok.start).trim();
    if (target.length === 0) {
      this.error(
        ['type-annotation-error', 'Expected a type'],
        kw.end,
        isTok.start
      );
      this.recoverAtStatementBoundary();
      return null;
    }

    // Top-level only, exactly like a `type` declaration: a conformance is a
    // fact about a TYPE, and types are engine-global.
    if (this.blockDepth > 0) {
      this.error(
        ['type-declaration-not-top-level', target],
        kw.start,
        isTok.end
      );
      this.recoverAtStatementBoundary();
      return null;
    }

    // The head of a CONDITIONAL conformance names its variables; the trailing
    // `where` clause is the single binding site, so it — and nothing else — may
    // bound them. A bound written in the head has no other reading, so it is
    // steered rather than left to the type subparser's `Expected >, got :`.
    // Gated on the target NOT parsing as a type: `tuple<a: integer>` is a
    // legitimate (if unconformable) type whose `name:` is a tuple element, not
    // a bound, and it keeps the engine's own target diagnostic.
    const bound = denotesTypeTarget(target)
      ? null
      : boundInConformanceHead(target);
    if (bound !== null) {
      this.error(
        [
          'type-annotation-error',
          `The head of a conformance cannot bound its variables: write \`is … where ${bound}: <bound>\` instead of \`${bound}: <bound>\` in the head`,
        ],
        kw.end,
        isTok.start
      );
      this.recoverAtStatementBoundary();
      return null;
    }

    this.advanceToOffset(isTok.start);
    return this.parseConformanceTail(
      kw.start,
      this.wrap({ str: target }, kw.end, isTok.start)
    );
  }

  /** The `is P₁ & P₂ [where …] [{ … }]` tail shared by the standalone and the
   * combined conformance forms. The cursor is at the `is` word.
   *
   * The trailing `where` clause makes the conformance CONDITIONAL (Appendix A
   * "Conditional Conformance"): the head names the target's variables and the
   * clause is their single BINDING site. Unlike a definition head — whose clause
   * trails the annotations it quantifies, forcing the lexical pre-scan of
   * {@link scanWhereClause} — a conformance clause PRECEDES everything that
   * mentions its variables (the implementation block's member signatures), so
   * the names are seeded when it is consumed and no pre-scan is needed. The
   * clause rides the lowering as its VERBATIM source text; the engine re-parses
   * it (the P11 pattern). */
  private parseConformanceTail(
    start: number,
    targetNode: MathJsonExpression
  ): MathJsonExpression | null {
    const isTok = this.advance(); // 'is'
    let end = isTok.end;

    // `P₁ & P₂ & …` — a list of protocol NAMES joined by `&`, not a type
    // intersection (protocol names are not types).
    const names: MathJsonExpression[] = ['List'];
    for (;;) {
      const tok = this.current;
      // A conformance tail does not cross a line: `type Foo = tuple<integer>
      // is` followed by `let x = 1` on the NEXT line must diagnose the missing
      // protocol name, not read `let` as one. (Recovery stops on the spot —
      // `recoverAtStatementBoundary` consumes nothing at a line start — so the
      // following statement still parses.)
      if (
        (tok.type !== 'SYMBOL' && tok.type !== 'VERBATIM_SYMBOL') ||
        tok.precededByLinebreak
      ) {
        this.error(['protocol-name-expected'], tok.start, tok.end);
        this.recoverAtStatementBoundary();
        return null;
      }
      this.advance();
      this.harvest(tok);
      const name =
        tok.type === 'VERBATIM_SYMBOL' ? (tok.value ?? '') : tok.text;
      if (
        tok.type === 'SYMBOL' &&
        (HARD_RESERVED_WORDS.has(name) ||
          Parser.CONTEXTUAL_STATEMENT_WORDS.has(name))
      ) {
        // `let`/`type`/`alias` are contextual, not reserved (`let type = 5`
        // parses), but a statement head is never what a conformance tail
        // meant — a missing name reads as one otherwise.
        if (Parser.CONTEXTUAL_STATEMENT_WORDS.has(name))
          this.error(['protocol-name-expected'], tok.start, tok.end);
        else this.error(['reserved-word', name], tok.start, tok.end);
        this.recoverAtStatementBoundary();
        return null;
      }
      names.push(this.wrap({ sym: name }, tok.start, tok.end));
      end = tok.end;
      if (this.check('OPERATOR') && this.current.text === '&') {
        this.advance();
        continue;
      }
      break;
    }

    const parts: MathJsonExpression[] = [
      'DeclareConformance',
      targetNode,
      this.wrap(names, isTok.end, end),
    ];

    // The trailing `where` clause, on the SAME line as the protocol list.
    let clause: ConformanceClause | undefined;
    let unseedClause: () => void = () => {};
    if (
      this.current.type === 'SYMBOL' &&
      this.current.text === 'where' &&
      !this.current.precededByLinebreak
    ) {
      const clauseStart = this.current.start;
      // The clause's own names are in scope for its BOUNDS (the
      // order-independence rule W2 — a non-ground bound is then rejected by the
      // type grammar with a message that names the variable) and, below, for the
      // implementation block's member signatures.
      const clauseNames = this.scanWhereClauseNames(
        clauseStart + 'where'.length
      );
      const seeded = clauseNames.filter((n) => !this.knownTypeNames.has(n));
      const outerTypeParamNames = this.typeParamNames;
      for (const n of clauseNames) this.knownTypeNames.add(n);
      this.typeParamNames = new Set(clauseNames);
      unseedClause = (): void => {
        for (const n of seeded) this.knownTypeNames.delete(n);
        this.typeParamNames = outerTypeParamNames;
      };
      const consumed = this.consumeWhereClause(clauseStart);
      if (consumed === null) {
        unseedClause();
        this.recoverAtStatementBoundary();
        return null;
      }
      clause = {
        text: consumed.text,
        start: clauseStart,
        end: consumed.end,
        names: new Set(clauseNames),
      };
      end = consumed.end;
      parts.push(this.wrap({ str: clause.text }, clause.start, clause.end));
    }

    try {
      // The optional implementation block, on the SAME line (a `{` on the next
      // line is an ordinary statement, not this statement's block).
      if (this.check('OPEN_BRACE') && !this.current.precededByLinebreak) {
        const impl = this.parseImplementationBlock(clause);
        if (impl === null) return null;
        parts.push(impl.node);
        end = impl.end;
      }
    } finally {
      unseedClause();
    }

    return this.wrap(parts, start, end);
  }

  /**
   * The implementation block of a conformance:
   * `{ (function|get|set) NAME(params) [effects] [-> T] { body } … }`.
   *
   * Members are parsed SYNTACTICALLY only — they are not checked against the
   * protocol's requirements, which is phase 2. Property handlers ride under
   * the mangled keys `__get__<name>` / `__set__<name>` (an implementation
   * detail, per Appendix A "Properties").
   */
  private parseImplementationBlock(clause?: ConformanceClause): {
    node: MathJsonExpression;
    end: number;
  } | null {
    const open = this.advance(); // '{'
    this.brackets.push(open);
    const entries: MathJsonExpression[] = ['Dictionary'];
    // In an implementation, `Self` and the conforming type's own name are
    // synonyms, so the annotations may spell either.
    const unseedSelf = this.seedSelfTypeName();
    try {
      for (;;) {
        while (this.match('SEMICOLON')) {
          /* empty member */
        }
        if (this.check('CLOSE_BRACE') || this.check('EOF')) break;
        const startPos = this.pos;
        const member = this.parseImplementationMember(clause);
        if (member === null) {
          this.recoverInBracket();
          break;
        }
        entries.push(member);
        if (this.pos === startPos) this.advance();
      }
    } finally {
      unseedSelf();
    }
    this.brackets.pop();

    let end: number;
    if (this.check('CLOSE_BRACE')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', '}'], open.start, open.end);
      end = this.current.start;
      if (isCloseToken(this.current.type)) this.advance();
    }

    return { node: this.wrap(entries, open.start, end), end };
  }

  /** One `function`/`get`/`set` member of an implementation block, lowered to
   * a `KeyValuePair` of the (possibly mangled) member name and a function
   * literal.
   *
   * Under a CONDITIONAL conformance the member's annotations may mention the
   * head's variables (`self: list<T>`). Those parameters take the ERASED
   * lowering of §3.1 — a bare symbol, with the FULL signature (clause included)
   * riding as the body's ascription — exactly as a `function f(x: T) … where T`
   * definition does: the parameter annotation alone would name a variable no
   * clause declares once the literal is boxed. A member that mentions no clause
   * variable keeps the ordinary ascription, so an unquantified one is never
   * given a clause it would leave unused. */
  private parseImplementationMember(
    clause?: ConformanceClause
  ): MathJsonExpression | null {
    const kw = this.current;
    if (
      kw.type !== 'SYMBOL' ||
      (kw.text !== 'function' && kw.text !== 'get' && kw.text !== 'set')
    ) {
      this.error(['protocol-member-signature-expected', ''], kw.start, kw.end);
      return null;
    }
    this.advance();

    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], nameTok.start, nameTok.end);
      return null;
    }
    this.advance();
    this.harvest(nameTok);
    const member =
      nameTok.type === 'VERBATIM_SYMBOL' ? (nameTok.value ?? '') : nameTok.text;
    // The `__get__` / `__set__` prefixes are RESERVED by the property-handler
    // mangling below: a `function` member spelled that way would be
    // indistinguishable from a `get`/`set` member (and would print back as
    // one). `get __get__x` is fine — it mangles to `__get____get__x`.
    if (
      kw.text === 'function' &&
      (member.startsWith('__get__') || member.startsWith('__set__'))
    ) {
      this.error(['reserved-word', member], nameTok.start, nameTok.end);
      return null;
    }
    const key = kw.text === 'function' ? member : `__${kw.text}__${member}`;

    if (!this.check('OPEN_PAREN')) {
      this.error(
        ['opening-bracket-expected', '('],
        this.current.start,
        this.current.end
      );
      return null;
    }
    // Which parameters mention a clause variable (parallel to `params`).
    const quantified: boolean[] = [];
    const params = this.parseParameterList(
      clause !== undefined ? quantified : undefined
    );
    const spec = this.parseEffectSpecifier();
    let returnType: MathJsonExpression | null = null;
    if (this.check('OPERATOR') && this.current.text === '->') {
      this.advance();
      returnType = this.parseHeldType();
    }
    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    // An implementation body is a `break`/`continue` BOUNDARY, like any
    // function body.
    const body = this.inLoopContext(0, () => this.parseBlock());
    const end = this.localEnd(body) ?? this.previousEnd();

    const quantifies = clause !== undefined && quantified.some((q) => q);
    const ascription = this.definitionAscription(
      params,
      spec,
      returnType,
      [],
      quantifies ? [clause!.start, clause!.end] : undefined,
      quantifies ? clause!.text : undefined
    );
    const loweredParams =
      quantifies && ascription !== null
        ? params.map((p, i) =>
            quantified[i] === true ? (operand(p, 1) ?? p) : p
          )
        : params;
    const ascribedBody =
      ascription !== null
        ? this.wrap(
            ['Typed', body, ascription] as MathJsonExpression[],
            this.localStart(body) ?? kw.start,
            end
          )
        : body;

    return this.kvPair(
      key,
      this.wrap(
        ['Function', ascribedBody, ...loweredParams] as MathJsonExpression[],
        nameTok.start,
        end
      ),
      kw.start,
      end
    );
  }

  /**
   * The `(params) ‹effects› -> result` signature of a protocol `function`
   * member, with the P22 sugar applied.
   *
   * **First-parameter `Self` inference.** Appendix A allows
   * `function compare(self, other: Self)`, but the type grammar rejects a
   * parameter list that mixes named and unnamed parameters, so the sugar is a
   * parser-side SOURCE REWRITE rather than a grammar change (P22): `: Self` is
   * injected after an unannotated first parameter, and the captured signature
   * text is the NORMALIZED one — `(self: Self, other: Self) -> …` — which is
   * what the registry stores and what the serializer prints back.
   *
   * A first parameter annotated with anything else is left exactly as written:
   * the engine's `protocol-self-required` check is the authority on it.
   */
  private parseProtocolSignature(): {
    node: MathJsonExpression;
    end: number;
  } | null {
    const start = this.current.start; // At the `(` of the parameter list.
    const inject = this.unannotatedFirstParameterEnd(start);
    if (inject !== null) {
      const tail = this.source.slice(start);
      const at = inject - start;
      const annotation = ': Self';
      const rewritten = `${tail.slice(0, at)}${annotation}${tail.slice(at)}`;
      try {
        const { end } = parseTypePrefix(rewritten, this.typeResolver);
        // The injection sits BEFORE the end of the signature, so the offset in
        // the real source is the rewritten end less the injected text.
        const sourceEnd = start + end - annotation.length;
        this.advanceToOffset(sourceEnd);
        return {
          node: this.wrap(
            { str: rewritten.slice(0, end).trim() },
            start,
            sourceEnd
          ),
          end: sourceEnd,
        };
      } catch {
        // Not a signature even with the annotation: fall through, so the
        // diagnostic lands on the source the author actually wrote.
      }
    }
    return this.parseTypeBody(start);
  }

  /**
   * The source offset just past the first parameter of the list starting at
   * `start`, when that parameter is a bare NAME with no `: type` annotation —
   * the injection point for {@link parseProtocolSignature}. `null` when the
   * list is empty, the first parameter is annotated, or the text is not a
   * parameter list at all.
   */
  private unannotatedFirstParameterEnd(start: number): number | null {
    const src = this.source;
    if (src[start] !== '(') return null;
    let i = start + 1;
    while (i < src.length && /\s/.test(src[i]!)) i += 1;
    if (!/[\p{L}_]/u.test(src[i] ?? '')) return null;
    const nameStart = i;
    while (i < src.length && /[\p{L}\p{N}_]/u.test(src[i]!)) i += 1;
    const nameEnd = i;
    while (i < src.length && /\s/.test(src[i]!)) i += 1;
    // A `:` means the author annotated it; anything other than a parameter
    // separator or the closing paren means this is not a plain name.
    const next = src[i];
    if (next !== ',' && next !== ')') return null;
    return nameStart === nameEnd ? null : nameEnd;
  }

  /** Seed `Self` as a known type name for the duration of a protocol or
   * implementation block; the returned thunk restores the set. `Self` is a
   * textual substitution token (P12): it is never declared, never reaches the
   * engine's type registry, and a user type of the same name survives. */
  private seedSelfTypeName(): () => void {
    if (this.knownTypeNames.has('Self')) return () => {};
    this.knownTypeNames.add('Self');
    return () => this.knownTypeNames.delete('Self');
  }

  //
  // ─── Sum-type declaration sugar ──────────────────────────────────────────
  //
  // `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §A. One
  // statement declares the N nominal variants AND the transparent union that
  // names them:
  //
  //   type node = lit(num: number) | plus(op1: node, op2: node)
  //     → ["DeclareSumType", "node",
  //          ["Tuple", {str:"lit"},  {str:"tuple<num: number>"}],
  //          ["Tuple", {str:"plus"}, {str:"tuple<op1: node, op2: node>"}]]
  //
  //   type tree<T> = leaf | node(value: T, children: list<tree<T>>)
  //     → ["DeclareSumType", "tree",
  //          ["Dictionary", ["KeyValuePair", typeParams, {str:"T"}]],
  //          ["Tuple", {str:"leaf"}, {str:"nothing"}],
  //          ["Tuple", {str:"node"}, {str:"tuple<value: T, children: list<tree<T>>>"}]]
  //
  // ONE node per statement is a parser invariant — `parseProgram` wraps a
  // multi-statement program in a `Block` that `executeEpsil` unwraps, and a
  // NESTED `Block` here would push a scope, making every inner declaration
  // fail the top-level rule (`type-declaration-not-top-level`). So the N+1
  // desugaring happens engine-side (`declareSumType`), not here; the attributes
  // dictionary rides at operand 1 (ahead of the variadic variant list) and is
  // told apart from a variant by its head.
  //
  // The variant payload is lowered to a type TEXT here, per the A2 table: no
  // payload → `"nothing"` (a nullary constructor), one POSITIONAL payload →
  // that type verbatim (`jbool(boolean)` → `"boolean"`), anything else →
  // `tuple<…>` over the payload list verbatim, so a named element stays named.
  //

  /**
   * The sum-sugar reader for a `type NAME = …` body starting at `from`.
   *
   * Returns `undefined` when the body is not the sugar — the caller then takes
   * the ordinary `parseTypeBody` path, so every `type` statement that works
   * today keeps its meaning. Returns `null` after diagnosing a body that IS
   * the sugar but is malformed, and the parsed variants otherwise.
   *
   * **Read from the RAW SOURCE**, like {@link parseTypeParamClause} and
   * {@link scanWhereClause}, for two reasons: the Epsil lexer maximal-munches
   * a run of angle characters (`list<tree<T>>`), and call-form is not type
   * syntax, so neither the token stream nor the type subparser can see this
   * shape. The cursor is re-synced ONCE at the end with `advanceToOffset`.
   */
  private parseSumTypeArms(
    from: number,
    sumName: string
  ):
    | { variants: { name: string; payload: string }[]; end: number }
    | null
    | undefined {
    const scanned = this.scanSumTypeArms(from);
    if (scanned === null) return undefined;
    const { arms, end } = scanned;

    // A1 — the trigger. Either an arm is CALL-FORM (never valid type syntax,
    // so the reading is unambiguous), or every arm is a bare identifier, there
    // are at least two of them (a union), and none currently names a type
    // (that spelling is an `Unknown type` error today, so the reading is
    // purely additive). A body mixing known and unknown bare names — or a
    // union over KNOWN types, which stays the opaque nominal-with-union-body —
    // is left alone. A single bare arm is not a union at all, so
    // `type X = typo` keeps its `Unknown type` error rather than quietly
    // declaring a variant.
    //
    // A name this sum ALREADY declared as a variant does not count as "names a
    // type": re-running the statement must read as the sugar a second time.
    const anyCall = arms.some((a) => a.payload !== null);
    const isOwnVariant = (n: string): boolean =>
      this.sumVariants[n] === sumName;
    if (
      !anyCall &&
      !(
        arms.length >= 2 &&
        arms.every((a) => !this.namesAType(a.name) || isOwnVariant(a.name))
      )
    )
      return undefined;

    // From here the statement IS the sugar: every exit reports.
    const variants: { name: string; payload: string }[] = [];
    for (const arm of arms) {
      if (arm.payload === null) {
        variants.push({ name: arm.name, payload: 'nothing' });
        continue;
      }
      const payload = this.parseSumVariantPayload(
        arm.payload[0],
        arm.payload[1]
      );
      if (payload === null) {
        this.advanceToOffset(end);
        return null;
      }
      variants.push({ name: arm.name, payload });
    }
    this.advanceToOffset(end);
    return { variants, end };
  }

  /** Does `name` already name a type? Both halves matter: the type grammar's
   * own primitives (`integer`, `list`, `nothing`) never reach the resolver, and
   * declared names do. Asking the type parser is what makes the two one
   * question. */
  private namesAType(name: string): boolean {
    try {
      return parseTypePrefix(name, this.typeResolver).end === name.length;
    } catch {
      return false;
    }
  }

  /**
   * Lexical scan of a `type NAME = …` body as a `|`-separated list of arms,
   * each `identifier` or `identifier( … )`. Returns `null` for anything else —
   * which is the fall-through to the ordinary type body.
   *
   * The union may span lines (`| plus(…)` on its own line is the natural
   * spelling), so a line break cannot END it. What ends it is a `|` that does
   * not follow, at a point that is a statement boundary: end of source, a `;`,
   * or a line break. An arm followed on the SAME line by anything else
   * (`type X = a | list<b>` — `list` then `<`) is not a clean union and is
   * rejected here, leaving the body to the type subparser.
   */
  private scanSumTypeArms(from: number): {
    arms: { name: string; payload: [number, number] | null }[];
    end: number;
  } | null {
    const src = this.source;
    let pos = from;
    const arms: { name: string; payload: [number, number] | null }[] = [];
    let end = from;

    /** Whitespace and comments; reports whether a line break was crossed. */
    const skipTrivia = (): boolean => {
      let sawBreak = false;
      for (;;) {
        if (pos < src.length && /\s/.test(src[pos])) {
          if (/[\n\r\u2028\u2029]/.test(src[pos])) sawBreak = true;
          pos += 1;
          continue;
        }
        const past = skipComment(src, pos);
        if (past === pos) return sawBreak;
        if (/[\n\r\u2028\u2029]/.test(src.slice(pos, past))) sawBreak = true;
        pos = past;
      }
    };

    for (;;) {
      skipTrivia();
      const m = TYPE_IDENTIFIER.exec(src.slice(pos));
      if (m === null) return null;
      pos += m[0].length;
      let payload: [number, number] | null = null;
      // ADJACENT `(`, like every other call clause in the grammar — and
      // load-bearing here: skipping trivia to look for one would swallow the
      // line break that ends the union (`| yellow` followed by a `function`
      // statement on the next line).
      if (src[pos] === '(') {
        const close = this.scanBalancedParen(pos);
        if (close === null) return null;
        payload = [pos + 1, close];
        pos = close + 1;
      }
      arms.push({ name: m[0], payload });
      end = pos;

      const sawBreak = skipTrivia();
      // `|>` (pipe) and `||` are other operators, not a union bar.
      if (src[pos] === '|' && src[pos + 1] !== '|' && src[pos + 1] !== '>') {
        pos += 1;
        continue;
      }
      if (pos >= src.length || src[pos] === ';' || sawBreak) break;
      return null;
    }
    return { arms, end };
  }

  /** The offset of the `)` matching the `(` at `pos`, or `null` when it is
   * unbalanced. Brackets nest; strings and comments are skipped whole. Angle
   * brackets are NOT tracked — a `<`/`>` never hides a paren. */
  private scanBalancedParen(pos: number): number | null {
    const src = this.source;
    let depth = 0;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        pos = skipStringLiteral(src, pos);
        continue;
      }
      if (ch === '/') {
        const past = skipComment(src, pos);
        if (past !== pos) {
          pos = past;
          continue;
        }
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        if (depth === 0) return ch === ')' ? pos : null;
        if (depth < 0) return null;
      }
      pos += 1;
    }
    return null;
  }

  /**
   * The payload of one call-form arm — the source between its parentheses —
   * lowered to the A2 type TEXT. Each element is `name: type` or a bare type;
   * an element's extent comes from the type subparser (with the sum's name and
   * its type parameters already seeded, so `node` / `tree<T>` parse bare),
   * which is also what validates it. Returns `null` after diagnosing.
   */
  private parseSumVariantPayload(from: number, to: number): string | null {
    const src = this.source;
    let pos = from;
    const skipSpace = (): void => {
      for (;;) {
        if (pos < to && /\s/.test(src[pos])) {
          pos += 1;
          continue;
        }
        const past = skipComment(src, pos);
        if (past === pos || past > to) return;
        pos = past;
      }
    };

    const elements: string[] = [];
    let named = false;
    skipSpace();
    if (pos >= to) return 'nothing'; // `red()` — a nullary constructor

    for (;;) {
      skipSpace();
      const elementStart = pos;
      // `name: type` — contextual, so a positional element whose type happens
      // to be an identifier (`pair(integer, string)`) is not mistaken for one.
      const m = TYPE_IDENTIFIER.exec(src.slice(pos, to));
      if (m !== null) {
        let after = pos + m[0].length;
        while (after < to && /\s/.test(src[after])) after += 1;
        if (src[after] === ':' && src[after + 1] !== ':') {
          named = true;
          pos = after + 1;
        }
      }
      skipSpace();
      try {
        // Extent AND validation. `allowWhere` stays false: a payload element
        // is a ground type, and a clause's `,`-list would swallow the next
        // element.
        const { end } = parseTypePrefix(src.slice(pos, to), this.typeResolver);
        pos += end;
      } catch (e) {
        const err = e as { position?: number; rawMessage?: string };
        const rel = typeof err.position === 'number' ? err.position : 0;
        const message =
          err.rawMessage ?? (e instanceof Error ? e.message : String(e));
        this.error(
          ['type-annotation-error', message],
          pos + rel,
          Math.min(pos + rel + 1, src.length)
        );
        return null;
      }
      elements.push(src.slice(elementStart, pos).trim());

      skipSpace();
      if (pos >= to) break;
      if (src[pos] === ',') {
        pos += 1;
        skipSpace();
        // A trailing comma closes the list.
        if (pos >= to) break;
        continue;
      }
      this.error(
        [
          'type-annotation-error',
          `Expected \`,\` or \`)\` in the payload of a sum-type variant`,
        ],
        pos,
        Math.min(pos + 1, src.length)
      );
      return null;
    }

    if (elements.length === 0) return 'nothing';
    // A2: one POSITIONAL element is the type itself (`jbool(boolean)` →
    // `boolean`); anything else — named, or two or more — is a tuple.
    if (elements.length === 1 && !named) return elements[0];
    return `tuple<${elements.join(', ')}>`;
  }

  /** Assemble the `DeclareSumType` node. The clause TEXT rides the attributes
   * dictionary exactly as it does for `DeclareType`. */
  private buildSumTypeStatement(
    start: number,
    name: string,
    nameTok: Token,
    clauseText: string | undefined,
    sum: { variants: { name: string; payload: string }[]; end: number }
  ): MathJsonExpression {
    const end = sum.end;
    // The variants are ordinary global type names once declared, so a later
    // annotation in this same program may name one (`function f(l: lit) …`).
    // Recording them as THIS sum's variants is also what keeps a second
    // declaration of the same sum reading as the sugar (see `sumVariants`).
    for (const v of sum.variants) {
      this.knownTypeNames.add(v.name);
      this.sumVariants[v.name] = name;
    }
    const parts: MathJsonExpression[] = [
      'DeclareSumType',
      this.wrap({ sym: name }, nameTok.start, nameTok.end),
    ];
    if (clauseText !== undefined)
      parts.push(
        this.wrap(
          [
            'Dictionary',
            this.kvPair(
              'typeParams',
              this.wrap({ str: clauseText }, start, end),
              start,
              end
            ),
          ],
          start,
          end
        )
      );
    for (const v of sum.variants)
      parts.push(
        this.wrap(
          [
            'Tuple',
            this.wrap({ str: v.name }, start, end),
            this.wrap({ str: v.payload }, start, end),
          ],
          start,
          end
        )
      );
    return this.wrap(parts, start, end);
  }

  //
  // ─── Control flow: if / while / for ───────────────────────────────────────
  //

  /** `if cond { … }` with optional `else { … }` / `else if …` chain →
   * `["If", cond, thenBlock, elseBlock?]`. Branches are `["Block", …]`; an
   * `else if` chains into a nested `If`. */
  private parseIf(): MathJsonExpression | null {
    const kw = this.advance(); // 'if'
    const cond = this.parseExpression(0);
    if (cond === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    this.checkConditionAssign(cond);
    if (!this.check('OPEN_BRACE')) {
      // `if cond else …` — no `{` and a dangling `else`: this is a
      // conditional-expression TAIL (`value if cond else other`) whose `if`
      // landed at the start of a line. An `if` that starts a line always
      // begins a new if-statement (a linebreak is a statement separator), so
      // the value it was meant to follow was cut off. Diagnose the actual
      // mistake instead of the misleading "opening bracket expected".
      if (this.check('SYMBOL') && this.current.text === 'else') {
        this.error(['conditional-if-line-start'], kw.start, kw.end);
        return null;
      }
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const thenBlock = this.parseBlock();
    let end = this.localEnd(thenBlock) ?? this.previousEnd();
    const parts: MathJsonExpression[] = ['If', cond, thenBlock];

    // A dangling `else` binds to this `if`, even across a linebreak.
    if (this.check('SYMBOL') && this.current.text === 'else') {
      this.advance(); // 'else'
      const next = this.current;
      if (next.type === 'SYMBOL' && next.text === 'if') {
        const nested = this.parseIf();
        if (nested !== null) {
          parts.push(nested);
          end = this.localEnd(nested) ?? end;
        }
      } else if (this.check('OPEN_BRACE')) {
        const elseBlock = this.parseBlock();
        parts.push(elseBlock);
        end = this.localEnd(elseBlock) ?? end;
      } else {
        this.error(
          ['opening-bracket-expected', '{'],
          this.current.start,
          this.current.end
        );
      }
    }

    return this.wrap(parts, kw.start, end);
  }

  /**
   * `break` / `continue` — statement-position loop control, lowering to the
   * engine's `["Break"]` / `["Continue"]`.
   *
   * The FUNCTION form is what the engine dispatches on: a bare `Break` SYMBOL
   * canonicalizes to an error (`canonicalStatement` in
   * `library/control-structures.ts`), precisely so this shape cannot be
   * confused with a variable reference.
   *
   * Only the value-less forms are surface syntax. `Break(v)` exists in the
   * engine and types the loop accordingly, but `break value` is a ruling
   * bundled with general `return` — see the language-extensions note.
   */
  private parseLoopControl(): MathJsonExpression | null {
    const kw = this.advance(); // 'break' | 'continue'
    const head = kw.text === 'break' ? 'Break' : 'Continue';
    if (this.loopDepth === 0)
      this.error(['control-outside-loop', kw.text], kw.start, kw.end);
    return this.wrap([head] as MathJsonExpression[], kw.start, kw.end);
  }

  /** Run `parse` with the `break`/`continue` context set to `depth`: one
   * deeper for a loop body, zero for a function/lambda body (the boundary
   * `break` may not cross). */
  private inLoopContext<T>(depth: number, parse: () => T): T {
    const saved = this.loopDepth;
    this.loopDepth = depth;
    try {
      return parse();
    } finally {
      this.loopDepth = saved;
    }
  }

  /** `while cond { … }` lowers to the engine's imperative `Loop`:
   * `Loop(Block(If(Not(cond), Break), body))` — an infinite loop that breaks
   * when the condition fails, then runs the body. No custom head, so it
   * canonicalizes/evaluates/compiles as engine primitives. `body` is
   * `["Block", …]`. */
  private parseWhile(): MathJsonExpression | null {
    const kw = this.advance(); // 'while'
    const cond = this.parseExpression(0);
    if (cond === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    this.checkConditionAssign(cond);
    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const body = this.inLoopContext(this.loopDepth + 1, () =>
      this.parseBlock()
    );
    const end = this.localEnd(body) ?? this.previousEnd();
    const loopBody = [
      'Block',
      ['If', ['Not', cond], ['Break']],
      body,
    ] as MathJsonExpression[];
    return this.wrap(['Loop', loopBody] as MathJsonExpression[], kw.start, end);
  }

  /** `for x in xs { … }` → `["Loop", body, ["Element", "x", "xs"]]` (engine
   * `Loop`; the iterator clause is `Element`). The loop variable and the `in`
   * keyword are consumed contextually here, so the `Element` *infix* operator
   * (also spelled `in`) never enters the collection's expression grammar. */
  private parseFor(): MathJsonExpression | null {
    const kw = this.advance(); // 'for'
    const varTok = this.current;
    if (varTok.type !== 'SYMBOL' && varTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], varTok.start, varTok.end);
      return null;
    }
    this.advance();
    this.harvest(varTok);
    const varName =
      varTok.type === 'VERBATIM_SYMBOL' ? (varTok.value ?? '') : varTok.text;
    // The loop variable is a binding: a literal word cannot name it
    // (`for oo in …`); the verbatim form still can.
    if (varTok.type === 'SYMBOL' && LITERAL_WORDS.has(varName))
      this.error(['reserved-word', varName], varTok.start, varTok.end);
    const varNode = this.wrap({ sym: varName }, varTok.start, varTok.end);

    // The contextual `in` keyword (a SYMBOL token, consumed directly — not as
    // the `Element` infix operator).
    if (!(this.check('SYMBOL') && this.current.text === 'in')) {
      this.error(
        ['unexpected-symbol', this.current.text],
        this.current.start,
        this.current.end
      );
      return null;
    }
    this.advance(); // 'in'

    const coll = this.parseExpression(0);
    if (coll === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const body = this.inLoopContext(this.loopDepth + 1, () =>
      this.parseBlock()
    );
    const end = this.localEnd(body) ?? this.previousEnd();

    const elementNode = this.wrap(
      ['Element', varNode, coll] as MathJsonExpression[],
      varTok.start,
      this.localEnd(coll) ?? this.previousEnd()
    );
    return this.wrap(
      ['Loop', body, elementNode] as MathJsonExpression[],
      kw.start,
      end
    );
  }

  //
  // ─── Match (structural pattern matching) ──────────────────────────────────
  //
  // `match subject { case… }` — a keyword-led, statement-block-style `{ }`
  // (same brace rule as `if`/`while`, NOT the collection grammar). Lowers to
  // the engine `Match` head:
  //
  //   ["Match", subject,
  //     ["MatchCase", pattern, body],
  //     ["MatchCase", pattern, guard, body]]
  //
  // Cases are separated like block statements (a linebreak or `;`). Each case
  // is `pattern [if guard] => body`. See the `parsePattern`/`patternize`
  // helpers below and `docs/plans/2026-07-12-cortex-match-design.md` §2–3.
  //

  private parseMatch(): MathJsonExpression | null {
    const kw = this.advance(); // 'match'
    const subject = this.parseExpression(0);
    if (subject === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }

    const open = this.advance(); // '{'
    this.brackets.push(open);

    // A case, plus the metadata needed for the irrefutable-non-final check.
    type CaseInfo = {
      node: MathJsonExpression;
      irrefutable: boolean; // pattern binds/matches anything, and no guard
      name: string; // the binding name (for the fix-it message)
      start: number;
      end: number;
    };
    const cases: CaseInfo[] = [];

    for (;;) {
      if (this.check('CLOSE_BRACE') || this.check('EOF')) break;
      const startPos = this.pos;
      const info = this.parseMatchCase();
      if (info === null) {
        this.recoverInBracket();
        break;
      }
      cases.push(info);
      // Separator: `;`, a linebreak, or the closing brace/EOF (as in a block).
      if (this.check('SEMICOLON')) {
        this.advance();
      } else if (
        this.check('CLOSE_BRACE') ||
        this.check('EOF') ||
        this.current.precededByLinebreak
      ) {
        // A valid case boundary.
      } else if (this.check('COMMA')) {
        // A comma between cases is a common reflex (Rust match arms, object
        // literals). Diagnose it precisely — with a fix-it to `;` — and then
        // treat it as a separator so the remaining cases still parse.
        this.diagnostics.push({
          severity: 'error',
          message: ['match-case-separator'],
          range: [this.current.start, this.current.end],
          fixits: [[this.current.start, this.current.end, ';']],
        });
        this.advance();
      } else {
        this.error(
          ['unexpected-symbol', this.current.text],
          this.current.start,
          this.current.end
        );
        this.recoverInBracket();
        break;
      }
      if (this.pos === startPos) this.advance();
    }

    this.brackets.pop();

    let end: number;
    if (this.check('CLOSE_BRACE')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', '}'], open.start, open.end);
      end = this.current.start;
      if (isCloseToken(this.current.type)) this.advance();
    }

    // Irrefutable-case diagnostic: a non-final case whose pattern is a bare
    // binding or `_` (with no guard) makes every later case dead code.
    for (let i = 0; i < cases.length - 1; i++) {
      if (cases[i].irrefutable)
        this.error(
          ['match-irrefutable-case', cases[i].name],
          cases[i].start,
          cases[i].end
        );
    }

    return this.wrap(
      ['Match', subject, ...cases.map((c) => c.node)] as MathJsonExpression[],
      kw.start,
      end
    );
  }

  /** Parse a single `pattern [if guard] => body` case. Returns the
   * `["MatchCase", …]` node plus the irrefutability metadata used by the
   * non-final-irrefutable-case diagnostic, or `null` on an unrecoverable case. */
  private parseMatchCase(): {
    node: MathJsonExpression;
    irrefutable: boolean;
    name: string;
    start: number;
    end: number;
  } | null {
    const start = this.current.start;
    this.matchTypeGuards = [];
    // `otherwise => body` — the keyword spelling of the wildcard pattern
    // `_`. Contextual, not reserved: it is recognized only when the bare
    // word IS the whole pattern (the next token is the case arrow or the
    // guard-introducing `if`), so `otherwise` remains an ordinary
    // identifier everywhere else — including inside structured patterns,
    // where the `_` spelling is the one that reads correctly. The node
    // produced is the same `_`, so the irrefutable-non-final-case
    // diagnostic and the engine's `Match` see no new pattern kind.
    let pattern: MathJsonExpression | null;
    if (
      this.check('SYMBOL') &&
      this.current.text === 'otherwise' &&
      ((this.peek().type === 'OPERATOR' && this.peek().text === '=>') ||
        (this.peek().type === 'SYMBOL' && this.peek().text === 'if'))
    ) {
      const tok = this.advance(); // 'otherwise'
      pattern = this.wrap('_', tok.start, tok.end);
    } else {
      pattern = this.parseCasePattern();
      if (pattern !== null) this.checkRangePatterns(pattern);
    }
    if (pattern === null) {
      if (!(this.current.diagnostics && this.current.diagnostics.length))
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
      return null;
    }
    const typeGuards = this.matchTypeGuards;

    // Optional guard: `if <expr>`. A case-leading `if` never starts a pattern,
    // so an `if` here unambiguously introduces the guard.
    let explicitGuard: MathJsonExpression | null = null;
    if (this.check('SYMBOL') && this.current.text === 'if') {
      this.advance(); // 'if'
      explicitGuard = this.parseExpression(0);
      if (explicitGuard === null) {
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
        return null;
      }
      // A match guard is a boolean consumer, exactly like an `if`/`while`
      // condition — an assignment here is the same trap.
      this.checkConditionAssign(explicitGuard);
    }

    // The arrow `=>` (an OPERATOR token; not an expression operator).
    if (!(this.check('OPERATOR') && this.current.text === '=>')) {
      this.error(
        ['match-case-arrow-expected'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    this.advance(); // '=>'

    this.matchBodyStops.push(this.brackets.length);
    let body: MathJsonExpression | null;
    try {
      body = this.parseExpression(0);
    } finally {
      this.matchBodyStops.pop();
    }
    if (body === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    const end = this.localEnd(body) ?? this.previousEnd();

    // Conjoin the implicit type guards with the explicit guard (implicit
    // first), building a single guard operand.
    const guard = this.combineGuards(typeGuards, explicitGuard, start, end);

    const ops: MathJsonExpression[] = ['MatchCase', pattern];
    if (guard !== null) ops.push(guard);
    ops.push(body);

    const irrefutable = guard === null && isIrrefutablePattern(pattern);
    return {
      node: this.wrap(ops, start, end),
      irrefutable,
      name: bindingName(pattern),
      start,
      end,
    };
  }

  /** Conjoin the implicit type guards with an optional explicit guard into a
   * single guard node (implicit first, per the design), or `null` when there
   * are none. */
  private combineGuards(
    typeGuards: MathJsonExpression[],
    explicit: MathJsonExpression | null,
    start: number,
    end: number
  ): MathJsonExpression | null {
    const parts = [...typeGuards];
    if (explicit !== null) parts.push(explicit);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return this.wrap(['And', ...parts] as MathJsonExpression[], start, end);
  }

  /** Parse a case pattern, including top-level or-alternatives
   * (`p₁ | p₂ | …`). Bare `|` is unclaimed by the expression grammar, so it is
   * consumed here. Alternatives lower to `["Alternatives", …]`; each must be
   * binding-free. */
  private parseCasePattern(): MathJsonExpression | null {
    const first = this.parsePattern();
    if (first === null) return null;

    const alts: MathJsonExpression[] = [first];
    while (this.isAlternativeSeparator()) {
      this.consumeAlternativeSeparator();
      const alt = this.parsePattern();
      if (alt === null) {
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
        break;
      }
      alts.push(alt);
    }

    if (alts.length === 1) return first;

    // Every alternative must be binding-free (v1 restriction).
    for (const alt of alts) {
      if (patternHasBinding(alt)) {
        const o = nodeOffsets(alt);
        this.error(
          ['match-alternative-binding'],
          o ? o[0] - this.baseOffset : this.current.start,
          o ? o[1] - this.baseOffset : this.current.end
        );
      }
    }

    const start = this.localStart(first) ?? this.current.start;
    const end = this.localEnd(alts[alts.length - 1]) ?? this.previousEnd();
    return this.wrap(
      ['Alternatives', ...alts] as MathJsonExpression[],
      start,
      end
    );
  }

  /** Whether the current token is a bare `|` (an or-alternative separator),
   * including a maximal-munched pipe such as the `|-` of `1 |-2` (only the
   * leading `|` is the separator). The real pipe operators (`||`, `|>`,
   * `|->`, `||>`) are NOT separators — they parse as infix operators. */
  private isAlternativeSeparator(): boolean {
    const t = this.current;
    if (t.type !== 'OPERATOR' || t.text[0] !== '|') return false;
    // A token that is itself a defined infix operator (`||`, `|>`, `|->`) is
    // consumed by the expression grammar, not the case parser.
    return infixOperatorForSymbol(t.text) === undefined;
  }

  /** Consume the leading `|` of an or-alternative. When maximal munch glued the
   * `|` to following operator characters (`|-` in `1 |-2`), rewrite the current
   * token in place to drop the leading `|`, leaving the remainder (`-2`) to be
   * parsed as the next alternative. */
  private consumeAlternativeSeparator(): void {
    const t = this.current;
    if (t.text === '|') {
      this.advance();
      return;
    }
    // Split the munched token: keep everything after the leading `|`.
    this.tokens[this.pos] = {
      ...t,
      text: t.text.slice(1),
      start: t.start + 1,
      precededByWhitespace: false,
      precededByLinebreak: false,
    };
  }

  /**
   * Validate every `Range` node in a case pattern (v1 range patterns — see the
   * `match` design §8). In pattern position `lo..hi` is an inclusive numeric
   * membership test, so its bounds must be **numeric literals** (negated
   * literals and `Infinity`/`-Infinity` included). A bare identifier bound
   * would otherwise patternize into a binding, which is nonsensical here; a
   * computed or pinned bound has no compile-time value. A stepped range has no
   * membership meaning at all in v1, and `lo > hi` is an always-dead case.
   *
   * `Pin` operands are ordinary value expressions (`== Range(1, 10)` pins the
   * range *value*), so they are not visited.
   */
  private checkRangePatterns(pattern: MathJsonExpression): void {
    const ops = fnOps(pattern);
    if (ops === null) return;
    if (ops[0] === 'Pin') return;

    if (ops[0] === 'Range') {
      const bounds = ops.slice(1);
      const at = (node: MathJsonExpression): [number, number] => {
        const o = nodeOffsets(node) ?? nodeOffsets(pattern);
        return o
          ? [o[0] - this.baseOffset, o[1] - this.baseOffset]
          : [this.current.start, this.current.end];
      };
      if (
        bounds.length !== 2 ||
        bounds.some((b) => operatorOf(b) === 'Range')
      ) {
        this.error(['range-pattern-step'], ...at(pattern));
        return;
      }
      const lo = rangeBoundValue(bounds[0]);
      const hi = rangeBoundValue(bounds[1]);
      if (lo === undefined)
        this.error(['range-pattern-bounds'], ...at(bounds[0]));
      if (hi === undefined)
        this.error(['range-pattern-bounds'], ...at(bounds[1]));
      if (lo !== undefined && hi !== undefined && lo > hi)
        this.error(['range-pattern-empty', lo, hi], ...at(pattern));
      return;
    }

    for (const op of ops.slice(1)) this.checkRangePatterns(op);
  }

  //
  // ─── Patternize (parse an expression, patternizing leaves) ────────────────
  //
  // A pattern is parsed by a dedicated recursive descent that mirrors the
  // ordinary expression grammar but transforms leaves as it goes (the
  // `patternize` rules of the design §2): `_` → anonymous wildcard, a bare
  // identifier → binding `_name`, literals → themselves, `...name` → sequence
  // wildcard `___name`, and operator/call/collection expressions keep their
  // operator with patternized operands. A dedicated parser (rather than
  // "parse then transform") is required because `==` (pin), `...` (rest), and
  // `n: type` are not part of the ordinary expression grammar.
  //

  /** A single pattern (no top-level `|` alternatives — the caller handles
   * those). Handles a leading `==` pin, then an operator-precedence pattern. */
  private parsePattern(): MathJsonExpression | null {
    // Pin: a leading `==` matches the *value* of the following expression.
    if (this.check('OPERATOR') && this.current.text === '==')
      return this.parsePin();
    return this.parsePatternInfix(0);
  }

  /** `== <operand>` → a pin pattern. The operand grammar is a primary/postfix
   * expression (`== Pi`, `== limit`, `== f(2)`), NOT patternized: it is an
   * ordinary expression evaluated at match time in the enclosing scope. A pin
   * of a literal lowers to the literal verbatim (it matches structurally); a
   * pin of any other expression — including a bare symbol, whose value is only
   * known at match time — lowers to `["Pin", expr]`. */
  private parsePin(): MathJsonExpression | null {
    const eqTok = this.advance(); // '=='
    const operand = this.parsePostfix();
    if (operand === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    const end = this.localEnd(operand) ?? this.previousEnd();
    // A literal pin matches structurally; drop the `Pin` head.
    if (isLiteralNode(operand)) return operand;
    return this.wrap(
      ['Pin', operand] as MathJsonExpression[],
      eqTok.start,
      end
    );
  }

  /** Operator-precedence pattern parsing: a primary pattern followed by infix
   * operator patterns (`a + b` → `["Add", _a, _b]`) and postfix (`n!`). */
  private parsePatternInfix(minPrecedence: number): MathJsonExpression | null {
    let left = this.parsePatternPostfix();
    if (left === null) return null;

    for (;;) {
      const post = this.peekPostfix();
      if (post !== null && post.precedence >= minPrecedence) {
        const start = this.localStart(left) ?? this.current.start;
        const opTok = this.advance();
        left = this.wrap(
          [post.name, left] as MathJsonExpression[],
          start,
          opTok.end
        );
        continue;
      }

      const op = this.peekInfix();
      if (op === null) break;
      if (op.def.precedence < minPrecedence) break;

      if (op.asymmetric) this.emitAsymmetric(this.current, op.def.symbol);
      for (let i = 0; i < op.tokenCount; i++) this.advance();

      const rightMin =
        op.def.assoc === 'right' ? op.def.precedence : op.def.precedence + 1;
      const right = this.parsePatternInfix(rightMin);
      if (right === null) {
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
        break;
      }
      left = this.combineInfix(op.def, left, right);
    }

    return left;
  }

  /** A primary pattern followed by call clauses (`f(p…)`). A prefix sign
   * (`-2`, `+n`) and `!` are folded first. */
  private parsePatternPostfix(): MathJsonExpression | null {
    const token = this.current;

    // Prefix sign/negation run (`-2` folds into the literal; `!p` → Not).
    const sigils = this.prefixSigils(token);
    if (sigils !== null) {
      const operandToken = this.peek();
      if (operandToken.precededByWhitespace) {
        this.error(['unexpected-symbol', token.text], token.start, token.end);
        this.advance();
        return null;
      }
      const start = token.start;
      this.advance();
      const operand = this.parsePatternPostfix();
      if (operand === null) {
        this.error(['expression-expected'], token.start, token.end);
        return null;
      }
      return this.applyPrefix(sigils, operand, start);
    }

    switch (token.type) {
      case 'NUMBER':
        return this.parseNumber();
      case 'STRING':
        return this.parseString();
      case 'SYMBOL':
      case 'VERBATIM_SYMBOL': {
        this.advance();
        this.harvest(token);
        const name =
          token.type === 'VERBATIM_SYMBOL' ? (token.value ?? '') : token.text;
        // A call clause `(…)` abutting the name: the name is an operator head
        // kept verbatim (design rule 9), with patternized operands.
        if (this.check('OPEN_PAREN') && !this.current.precededByWhitespace)
          return this.parsePatternCall(name, token.start);
        return this.finishBindingPattern(name, token.start, token.end);
      }
      case 'OPERATOR':
        // `...name` / `...` sequence wildcard (valid inside a list/tuple; the
        // collection builders enforce the single-rest rule). A bare `...` node
        // is produced and lowered to `___name`/`___`.
        if (token.text === '...') return this.parseRestPattern();
        return null;
      case 'OPEN_BRACKET':
        return this.parseListPattern();
      case 'OPEN_PAREN':
        return this.parseTuplePattern();
      case 'OPEN_BRACE':
        return this.parseBracePattern();
      default:
        return null;
    }
  }

  /** Lower a bare identifier to its pattern leaf: `_` → anonymous wildcard,
   * boolean/numeric literals → themselves, any other identifier → a binding
   * `_name` (all plain identifiers bind, including constants like `Pi`/`e`/`i`
   * — design rule 2). A trailing `: Type` annotation on a binding records an
   * implicit type guard. */
  private finishBindingPattern(
    name: string,
    start: number,
    end: number
  ): MathJsonExpression {
    if (name === '_') return this.wrap({ sym: '_' }, start, end);
    // Boolean and numeric-constant literals match structurally. `oo` is the
    // input alias for `Infinity` — without it here, `oo` in pattern position
    // fell through to the binding rule and matched ANYTHING.
    if (name === 'true') return this.wrap({ sym: 'True' }, start, end);
    if (name === 'false') return this.wrap({ sym: 'False' }, start, end);
    if (name === 'NaN') return this.wrap({ num: 'NaN' }, start, end);
    if (name === 'Infinity' || name === 'oo')
      return this.wrap({ num: '+Infinity' }, start, end);

    const binding = this.wrap({ sym: '_' + name }, start, end);

    // Optional `: Type` → an implicit `Element(name, type)` guard, conjoined
    // with any explicit guard by the caller. Comma-delimited, so `allowWhere`
    // stays false (the default): a clause's own `,`-list would swallow the
    // next pattern.
    if (this.check('OPERATOR') && this.current.text === ':') {
      const annotation = this.parseTypeAnnotation();
      if (annotation === null) {
        // Diagnosed; the cursor is still at the malformed type. A pattern
        // lives in a comma-separated list (or directly before a `=>`), so
        // resync to that element boundary and let the rest of the patterns —
        // and the arm's body — parse. The binding is kept, unguarded.
        this.recoverInBracket(true);
      } else {
        const typeText = stringValue(annotation.node) ?? '';
        // The guard below lowers to `Element(name, <type name>)`, which only
        // resolves SIMPLE NAMED types. A compound annotation (`!error`,
        // `number | string`, `list<integer>`, a signature) parses fine but
        // never resolves, so the case silently becomes unreachable for every
        // subject. Diagnose it rather than let it fail quietly; the guard is
        // still emitted, so the fallthrough behavior is unchanged.
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(typeText))
          this.error(
            ['type-pattern-unsupported', typeText],
            start,
            annotation.end
          );
        this.matchTypeGuards.push(
          this.wrap(
            [
              'Element',
              this.wrap({ sym: name }, start, end),
              this.wrap({ sym: typeText }, start, annotation.end),
            ] as MathJsonExpression[],
            start,
            annotation.end
          )
        );
      }
    }

    return binding;
  }

  /** A call pattern `head( p, … )` → `[head, …patternized]`. */
  private parsePatternCall(head: string, start: number): MathJsonExpression {
    const { values, end } = this.parsePatternElements('CLOSE_PAREN', ')');
    return this.wrap([head, ...values] as MathJsonExpression[], start, end);
  }

  /** `...name` / `...` → a sequence-wildcard leaf `___name` / `___`. */
  private parseRestPattern(): MathJsonExpression {
    const dots = this.advance(); // '...'
    if (
      (this.check('SYMBOL') || this.check('VERBATIM_SYMBOL')) &&
      !this.current.precededByLinebreak
    ) {
      const nameTok = this.advance();
      this.harvest(nameTok);
      const name =
        nameTok.type === 'VERBATIM_SYMBOL'
          ? (nameTok.value ?? '')
          : nameTok.text;
      return this.wrap({ sym: '___' + name }, dots.start, nameTok.end);
    }
    return this.wrap({ sym: '___' }, dots.start, dots.end);
  }

  /** `[p, …]` → `["List", …patternized]`, at most one `...rest`. */
  private parseListPattern(): MathJsonExpression {
    const { values, open, end } = this.parsePatternElements(
      'CLOSE_BRACKET',
      ']'
    );
    this.checkSingleRest(values, open.start, end);
    return this.wrap(
      ['List', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** `(p, …)` → `["Tuple", …]` for 2+ elements; a single element is grouping
   * (returned bare). At most one `...rest`. */
  private parseTuplePattern(): MathJsonExpression | null {
    const { values, open, end } = this.parsePatternElements('CLOSE_PAREN', ')');
    this.checkSingleRest(values, open.start, end);
    if (values.length === 0) {
      this.error(['expression-expected'], open.start, end);
      return null;
    }
    if (values.length === 1) return values[0];
    return this.wrap(
      ['Tuple', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** A brace pattern: `{k -> p, …}` → `Dictionary` (keys literal, values
   * patternized); `{p, …}` → `Set` of patterns; `{}` → empty `Set`. */
  private parseBracePattern(): MathJsonExpression {
    // `{}` → empty Set.
    if (this.peek().type === 'CLOSE_BRACE') {
      const open = this.advance();
      const close = this.advance();
      return this.wrap(['Set'], open.start, close.end);
    }
    // `{->}` → empty Dictionary.
    if (
      this.peek().type === 'OPERATOR' &&
      this.peek().text === '->' &&
      this.peek(2).type === 'CLOSE_BRACE'
    ) {
      const open = this.advance();
      this.advance(); // '->'
      const close = this.advance();
      return this.wrap(['Dictionary'], open.start, close.end);
    }

    const { values, open, end } = this.parsePatternElements('CLOSE_BRACE', '}');
    if (values.length > 0 && operator(values[0]) === 'KeyValuePair')
      return this.buildDictionary(values, open.start, end);
    return this.wrap(
      ['Set', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** Parse a comma-separated list of pattern elements delimited by the current
   * opening bracket and `closeType`. Each element is a full pattern (so pins
   * and nested alternatives-free patterns nest). A `k -> p` element is a
   * dictionary entry: the key stays literal, the value is patternized. */
  private parsePatternElements(
    closeType: TokenType,
    closeText: string
  ): { values: MathJsonExpression[]; open: Token; end: number } {
    const open = this.advance(); // the opening bracket
    this.brackets.push(open);

    const values: MathJsonExpression[] = [];
    if (!this.check(closeType)) {
      for (;;) {
        const element = this.parsePatternEntry();
        if (element === null) {
          this.reportUnexpected(this.current);
          this.recoverInBracket();
          break;
        }
        values.push(element);
        if (!this.match('COMMA')) break;
        if (this.check(closeType)) break; // trailing comma
      }
    }

    this.brackets.pop();

    let end: number;
    if (this.check(closeType)) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', closeText], open.start, open.end);
      end = this.current.start;
      if (isCloseToken(this.current.type)) this.advance();
    }

    return { values, open, end };
  }

  /** A pattern element inside a collection: either a `key -> value` dictionary
   * entry (key literal, value patternized) or a plain pattern. The `->`
   * (KeyValuePair) is an infix operator, so `parsePattern` already folds
   * `key -> value` into a `KeyValuePair` node with *both* sides patternized;
   * here the key is reverted to its literal written form. */
  private parsePatternEntry(): MathJsonExpression | null {
    const pat = this.parsePattern();
    if (pat === null) return null;
    if (operator(pat) === 'KeyValuePair') {
      const rawKey = operand(pat, 1);
      const value = operand(pat, 2) ?? 'Nothing';
      const key = rawKey === null ? { str: '' } : unpatternizeKey(rawKey);
      const o = nodeOffsets(pat);
      return this.wrap(
        ['KeyValuePair', key, value] as MathJsonExpression[],
        o ? o[0] - this.baseOffset : this.current.start,
        o ? o[1] - this.baseOffset : this.previousEnd()
      );
    }
    return pat;
  }

  /** Emit a `match-multiple-rest` diagnostic if a list/tuple pattern has more
   * than one `...rest` element (v1 allows at most one). */
  private checkSingleRest(
    values: MathJsonExpression[],
    start: number,
    end: number
  ): void {
    let rests = 0;
    for (const v of values) {
      const s = symbolNameOf(v);
      if (s !== null && s.startsWith('___')) rests += 1;
    }
    if (rests > 1) this.error(['match-multiple-rest'], start, end);
  }

  //
  // ─── Function definitions ─────────────────────────────────────────────────
  //

  /** Block form `function f(x) { … }` →
   * `["DefineFunction", "f", ["Function", ["Block", …], …params]]`. Definition
   * statements ACCUMULATE clauses (function-polymorphism design, D6): a
   * second `function f` with a different parameter domain appends a clause,
   * the same domain replaces it in place; only a plain assignment
   * (`f = …`, `Assign`) replaces the whole binding. Typed params
   * (`function f(x: real) { … }`) are carried inline as `["Typed", sym, type]`
   * parameters, and a return type (`… -> real { … }`) is ascribed onto the body
   * as `["Typed", body, type]` (the engine normalizes it into the Block). Both
   * annotations are then enforced by the engine's typed-function-literal
   * machinery; no `Declare` side-channel is needed.
   *
   * An **effect specifier** may sit between the parameter list and `->`
   * (`function roll(n) random -> integer { … }`); the ascription then carries
   * the FULL signature instead of the bare return type — see
   * {@link definitionAscription}.
   *
   * A **type-parameter clause** may sit between the name and the parameter
   * list (`function map<T, U>(…)` — the M2 sugared generic form,
   * `docs/plans/2026-08-04-generic-function-literals-design.md` §3). It turns
   * the ascription into a `where`-quantified full signature and ERASES the
   * annotations of the parameters it quantifies (they lower to bare symbols;
   * the signature is the single source of truth for their types). See
   * {@link parseTypeParamClause}. */
  private parseFunctionDefinition(): MathJsonExpression | null {
    const kw = this.advance(); // 'function'
    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], nameTok.start, nameTok.end);
      return null;
    }
    this.advance();
    this.harvest(nameTok);
    const name =
      nameTok.type === 'VERBATIM_SYMBOL' ? (nameTok.value ?? '') : nameTok.text;
    // A literal word cannot name a function (`function oo(x) { … }` would
    // shadow the Infinity literal); the verbatim form still can.
    if (nameTok.type === 'SYMBOL' && LITERAL_WORDS.has(name))
      this.error(['reserved-word', name], nameTok.start, nameTok.end);
    const nameNode = this.wrap({ sym: name }, nameTok.start, nameTok.end);

    // Optional type-parameter clause `<T, U: bound>` (M2).
    const clause = this.parseTypeParamClause(name);
    if (clause === null) return null; // Malformed; already diagnosed.
    const typeParams = clause?.decls ?? [];

    if (!this.check('OPEN_PAREN')) {
      this.error(
        ['opening-bracket-expected', '('],
        this.current.start,
        this.current.end
      );
      return null;
    }

    // Phase 0 of the trailing-`where` binding strategy: the clause sits at the
    // END of the head, but its names must already be in scope when the FIRST
    // parameter annotation is parsed, so locate it lexically first.
    const whereScan = this.scanWhereClause(this.current.start);

    // G7 — the clause's names are in scope for the HEAD only (parameter list,
    // effect specifier, return type). The body parses unseeded, so a
    // body-local `let y: T` is an ordinary unknown-type error. The set is
    // mutated in place (`typeResolver` closes over it), and only the names
    // this clause ADDED are removed on restore: a clause name that shadows a
    // user type of the same name leaves that type known afterwards. Both
    // binder spellings seed the same way — writing BOTH is an error (reported
    // once the clause's extent is known), but seeding both names keeps the
    // recovery from cascading into unknown-type reports.
    const seedNames = [
      ...new Set([
        ...typeParams.map((d) => d.name),
        ...(whereScan?.names ?? []),
      ]),
    ];
    const seeded = seedNames.filter((n) => !this.knownTypeNames.has(n));
    const outerTypeParamNames = this.typeParamNames;
    if (seedNames.length > 0) {
      for (const n of seedNames) this.knownTypeNames.add(n);
      this.typeParamNames = new Set(seedNames);
    }

    // Which parameters mention a quantified name (parallel to `params`).
    const quantified: boolean[] = [];
    const params = this.parseParameterList(
      seedNames.length > 0 ? quantified : undefined
    );

    // Optional effect specifier `random`, `scope`, `pure`, … (bare words
    // between the parameter list and `->`).
    const spec = this.parseEffectSpecifier();

    // Optional return type `-> Type` (ascribed onto the body below).
    let returnType: MathJsonExpression | null = null;
    if (this.check('OPERATOR') && this.current.text === '->') {
      this.advance(); // '->'
      returnType = this.parseHeldType();
    }

    // Phase 3 — the clause itself, always LAST (after the effects slot and
    // the return type), in every spelling.
    let where: WhereClause | undefined;
    // A clause that was WRITTEN but did not parse. Tracked explicitly because
    // the gates below cannot otherwise tell it apart from "no clause at all":
    // the annotations of the head were parsed with its names seeded, so they
    // reference variables that no clause declares.
    let clauseFailed = false;
    if (
      whereScan !== null &&
      this.current.type === 'SYMBOL' &&
      this.current.text === 'where'
    ) {
      const consumed = this.consumeWhereClause(whereScan.start);
      if (consumed !== null)
        where = { ...whereScan, text: consumed.text, end: consumed.end };
      else clauseFailed = true;
    }

    if (seedNames.length > 0) {
      for (const n of seeded) this.knownTypeNames.delete(n);
      this.typeParamNames = outerTypeParamNames;
    }

    // One binding site per declaration: `<T>` and `where T` are synonyms, so
    // writing both is an error rather than a bounded `<T: number>`. The `<T>`
    // clause wins; the `where` clause is dropped.
    if (where !== undefined && typeParams.length > 0) {
      this.error(
        ['duplicate-type-parameter-clause', name],
        where.start,
        where.end
      );
      where = undefined;
    }

    // G2 rule 1 (§2.6) — a clause plus a LITERAL parameter is a generic
    // multi-clause definition, out of scope for this milestone. Checked
    // BEFORE signature assembly so the rejection names the real problem
    // rather than reporting an unused type variable. The clause is then
    // dropped (the definition parses on as an ordinary one) — the error
    // diagnostic is the rejection.
    let clauseDecls: readonly TypeParamDecl[] = typeParams;
    const clauseSpan: [number, number] | undefined =
      clause !== undefined
        ? [clause.start, clause.end]
        : where !== undefined
          ? [where.start, where.end]
          : undefined;
    if (
      (typeParams.length > 0 || where !== undefined) &&
      params.some(isLiteralParamNode)
    ) {
      this.error(
        ['generic-clause-unsupported', name],
        clauseSpan![0],
        clauseSpan![1]
      );
      clauseDecls = [];
      where = undefined;
    }

    const hasClause = clauseDecls.length > 0 || where !== undefined;
    // A clause that failed SYNTACTICALLY gets no ascription at all: the plain
    // return type would name a variable no clause declares (the contract in
    // {@link definitionAscription}).
    const ascription = clauseFailed
      ? null
      : this.definitionAscription(
          params,
          spec,
          returnType,
          clauseDecls,
          clauseSpan,
          where?.text
        );

    // Erased lowering (§3.1): a parameter whose annotation mentions a
    // quantified name lowers to a BARE symbol — the full-signature ascription
    // carries its type, and the engine's E2 pre-pass would erase it anyway.
    // Keyed on the POST-rejection clause state: when G2 dropped the clause
    // there is no ascription to carry those types, so erasing here would
    // silently turn `function f<T>(x: T, 0) { … }` into an ordinary
    // `f(x, 0)` clause. The annotation stays, and reads as whatever `T` names
    // outside the clause — a user type when one exists, an unresolved (hence
    // `unknown`) name otherwise.
    //
    // A clause REJECTED downstream — syntactically (`clauseFailed`) or
    // semantically (the assembled signature was refused, so the ascription is
    // null) — is the same situation: there is no quantified ascription to
    // carry those types, so the annotations stay. Keeping them, rather than
    // erasing to bare symbols, is the recovery the G2 rejection above already
    // uses: a definition that did not parse must not end up MORE permissive
    // than its source.
    const loweredParams =
      hasClause && !clauseFailed && ascription !== null
        ? params.map((p, i) =>
            quantified[i] === true ? (operand(p, 1) ?? p) : p
          )
        : params;

    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    // A function body is a `break`/`continue` BOUNDARY, not just a new block.
    const body = this.inLoopContext(0, () => this.parseBlock());
    const end = this.localEnd(body) ?? this.previousEnd();

    const ascribedBody =
      ascription !== null
        ? this.wrap(
            ['Typed', body, ascription] as MathJsonExpression[],
            this.localStart(body) ?? nameTok.start,
            end
          )
        : body;

    const fnNode = this.wrap(
      ['Function', ascribedBody, ...loweredParams] as MathJsonExpression[],
      nameTok.start,
      end
    );
    return this.wrap(
      ['DefineFunction', nameNode, fnNode] as MathJsonExpression[],
      kw.start,
      end
    );
  }

  /**
   * The optional **type-parameter clause** of a `function` definition —
   * `<T>`, `<T: number, U>` — sitting between the name and the parameter list
   * (`docs/plans/2026-08-04-generic-function-literals-design.md` §3.1).
   *
   * Returns `undefined` when there is no clause (the cursor is untouched),
   * `null` on a malformed one (already diagnosed), otherwise the declarations
   * and the clause's source span.
   *
   * **Parsed from the RAW SOURCE, not from tokens.** `<` and `>` are operator
   * characters, and the Epsil lexer maximal-munches a run of them into ONE
   * token: `<T: list<integer>>(` lexes the two closing angles as a single
   * `>>`, and a signature bound puts a `>` inside `->`. So the clause is
   * scanned character by character, its bounds are handed to the type
   * subparser (`parseTypePrefix`, the `parseTypeBody` pattern), and the token
   * cursor is re-synced ONCE at the end with `advanceToOffset` — which lands
   * correctly even when the closing angle is buried in a munched token.
   *
   * ALL the clause's names are collected first, THEN the bounds are parsed
   * with every one of them in scope — the seed-all-names-then-parse-all-bounds
   * rule shared with the type layer's clause reader
   * ({@link parseTypeParameterClause}) and the trailing `where` clause. A
   * bound that mentions a clause variable therefore PARSES, and is rejected by
   * the assembled signature's ground-bound check with a message naming the
   * variable, rather than as an opaque `Unknown type`. A bound naming
   * something the clause does NOT declare (`<T: list<U>>`) is still an
   * ordinary `Unknown type "U"` error.
   */
  private parseTypeParamClause(
    fnName: string,
    allowVariance = false
  ): TypeParamClause | null | undefined {
    if (!this.check('OPERATOR') || !this.current.text.startsWith('<'))
      return undefined;

    const src = this.source;
    const start = this.current.start;
    let pos = start + 1;
    const skipSpace = (): void => {
      while (pos < src.length && /\s/.test(src[pos])) pos += 1;
    };

    skipSpace();
    if (src[pos] === '>') {
      // `function f<>(…)`: the slot is there but declares nothing.
      this.error(['empty-type-parameter-clause', fnName], start, pos + 1);
      pos += 1;
      this.advanceToOffset(pos);
      return { decls: [], start, end: pos };
    }

    // Pass 1 — the NAMES only, so every one of them is in scope before ANY
    // bound is parsed. Only the names this clause ADDS are removed on the way
    // out: a clause name shadowing a user type leaves that type known.
    const seededNames = this.scanTypeParamNames(pos, allowVariance).filter(
      (n) => !this.knownTypeNames.has(n)
    );
    for (const n of seededNames) this.knownTypeNames.add(n);
    const unseed = (): void => {
      for (const n of seededNames) this.knownTypeNames.delete(n);
    };

    const decls: TypeParamDecl[] = [];
    const seen = new Set<string>();
    for (;;) {
      skipSpace();
      // The optional VARIANCE marker of a parameterized nominal type
      // (`type tree<out T> = …`). Contextual: read as a marker only when a
      // name follows, so a parameter named `in` still parses. A `function`
      // clause never takes one — variance relates two applications of a TYPE,
      // and a function's parameters are solved per call.
      if (allowVariance) {
        const vm = VARIANCE_MARKER.exec(src.slice(pos));
        if (vm !== null) pos += vm[0].length;
      }
      const m = TYPE_IDENTIFIER.exec(src.slice(pos));
      if (m === null) {
        this.error(['symbol-expected'], pos, Math.min(pos + 1, src.length));
        this.advanceToOffset(pos);
        unseed();
        return null;
      }
      const varName = m[0];
      const nameStart = pos;
      pos += varName.length;

      skipSpace();
      let bound: string | null = null;
      if (src[pos] === ':') {
        pos += 1;
        try {
          // A bound is a GROUND type: `allowWhere` stays false (the default),
          // so a nested clause is a syntax error rather than a silent parse.
          // (Groundness itself is checked on the assembled signature — the
          // clause's own names are in scope here, see the pass-1 seeding.)
          const { end } = parseTypePrefix(src.slice(pos), this.typeResolver);
          bound = src.slice(pos, pos + end).trim();
          pos += end;
        } catch (e) {
          const err = e as { position?: number; rawMessage?: string };
          const rel = typeof err.position === 'number' ? err.position : 0;
          const message =
            err.rawMessage ?? (e instanceof Error ? e.message : String(e));
          this.error(
            ['type-annotation-error', message],
            pos + rel,
            Math.min(pos + rel + 1, src.length)
          );
          this.advanceToOffset(pos);
          unseed();
          return null;
        }
      }

      // Mirrors the type grammar's own duplicate check, reported here so the
      // clause — not the assembled signature — carries the diagnostic. The
      // duplicate is dropped so the assembly does not report it twice.
      if (seen.has(varName))
        this.error(
          ['duplicate-type-parameter', varName],
          nameStart,
          nameStart + varName.length
        );
      else {
        seen.add(varName);
        decls.push({ name: varName, bound });
      }

      skipSpace();
      if (src[pos] === ',') {
        pos += 1;
        continue;
      }
      if (src[pos] === '>') {
        pos += 1;
        break;
      }
      this.error(
        ['closing-bracket-expected', '>'],
        pos,
        Math.min(pos + 1, src.length)
      );
      this.advanceToOffset(pos);
      unseed();
      return null;
    }

    this.advanceToOffset(pos);
    unseed();
    return { decls, start, end: pos };
  }

  /** The parameter NAMES of a `<…>` clause whose first entry starts at `pos`
   * (just past the `<`), collected WITHOUT parsing any bound — a bound's
   * extent comes from {@link scanTypeParamBound}. A malformed entry simply
   * ends the scan: the parse that follows is what diagnoses it. */
  private scanTypeParamNames(pos: number, allowVariance: boolean): string[] {
    const src = this.source;
    const names: string[] = [];
    const skipSpace = (): void => {
      while (pos < src.length && /\s/.test(src[pos])) pos += 1;
    };
    for (;;) {
      skipSpace();
      if (allowVariance) {
        const vm = VARIANCE_MARKER.exec(src.slice(pos));
        if (vm !== null) pos += vm[0].length;
      }
      const m = TYPE_IDENTIFIER.exec(src.slice(pos));
      if (m === null) return names;
      names.push(m[0]);
      pos += m[0].length;

      skipSpace();
      if (src[pos] === ':') pos = this.scanTypeParamBound(pos + 1);
      skipSpace();
      if (src[pos] !== ',') return names;
      pos += 1;
    }
  }

  /** The end offset of a `<…>` clause bound starting at `pos`: the next `,` or
   * closing bracket at depth 0. Brackets nest, `->` is skipped atomically so
   * its `>` does not close one, and strings and comments are skipped whole —
   * the same scan as {@link scanWhereClauseNames}. */
  private scanTypeParamBound(pos: number): number {
    const src = this.source;
    let depth = 0;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        pos = skipStringLiteral(src, pos);
        continue;
      }
      if (ch === '/') {
        const past = skipComment(src, pos);
        if (past !== pos) {
          pos = past;
          continue;
        }
      }
      if (ch === '-' && src[pos + 1] === '>') {
        pos += 2;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '<') {
        depth += 1;
        pos += 1;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '>') {
        if (depth === 0) return pos;
        depth -= 1;
        pos += 1;
        continue;
      }
      if (depth === 0 && (ch === ',' || ch === '{' || ch === ';')) return pos;
      pos += 1;
    }
    return pos;
  }

  /**
   * **Phase 0** of the trailing-`where` binding strategy
   * (`docs/plans/2026-08-11-where-clause-type-constraints.md`): locate a
   * definition head's clause and collect the variable NAMES it declares,
   * purely lexically — nothing is resolved, so no resolver side effect can
   * fire for a name the clause later reclassifies as a variable.
   *
   * The clause TRAILS the head but its names must be in scope from the first
   * parameter annotation, so it has to be found before anything is parsed.
   * `from` is the offset of the parameter list's `(`; the scan runs to the
   * head terminator — a depth-0 `{` (block form), `=` (math form) or `;` —
   * and stops early if the bracket depth goes negative.
   *
   * **Scanned from the RAW SOURCE, not from tokens**, for the same reason
   * {@link parseTypeParamClause} is: the Epsil lexer maximal-munches a run of
   * angle characters, so `list<list<integer>>` arrives with its two closing
   * angles fused. `->` is skipped atomically so its `>` does not close a
   * bracket, and string literals are skipped whole.
   *
   * Returns `null` when the head carries no clause.
   */
  private scanWhereClause(
    from: number
  ): { start: number; names: string[] } | null {
    const src = this.source;
    let depth = 0;
    let pos = from;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        pos = skipStringLiteral(src, pos);
        continue;
      }
      if (ch === '/') {
        const past = skipComment(src, pos);
        if (past !== pos) {
          pos = past;
          continue;
        }
      }
      if (ch === '-' && src[pos + 1] === '>') {
        pos += 2;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '<') {
        depth += 1;
        pos += 1;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '>') {
        depth -= 1;
        pos += 1;
        if (depth < 0) return null;
        continue;
      }
      if (depth === 0 && (ch === '{' || ch === '=' || ch === ';')) return null;
      const m =
        /[A-Za-z_]/.test(ch) && !/[A-Za-z0-9_]/.test(src[pos - 1] ?? '')
          ? TYPE_IDENTIFIER.exec(src.slice(pos))
          : null;
      if (m !== null) {
        if (depth === 0 && m[0] === 'where')
          return {
            start: pos,
            names: this.scanWhereClauseNames(pos + m[0].length),
          };
        pos += m[0].length;
        continue;
      }
      pos += 1;
    }
    return null;
  }

  /** The variable NAMES of the clause whose body starts at `pos` (just past
   * the `where` word): the first identifier of each depth-0 comma-separated
   * entry. An entry's bound may contain bracketed commas of its own, so the
   * split tracks bracket depth — the same scan as {@link scanWhereClause}. */
  private scanWhereClauseNames(pos: number): string[] {
    const src = this.source;
    const names: string[] = [];
    let depth = 0;
    let atEntryStart = true;
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '"' || ch === "'" || ch === '`') {
        pos = skipStringLiteral(src, pos);
        continue;
      }
      if (ch === '/') {
        const past = skipComment(src, pos);
        if (past !== pos) {
          pos = past;
          continue;
        }
      }
      if (ch === '-' && src[pos + 1] === '>') {
        pos += 2;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '<') {
        depth += 1;
        pos += 1;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '>') {
        depth -= 1;
        pos += 1;
        if (depth < 0) break;
        continue;
      }
      if (depth === 0) {
        if (ch === '{' || ch === '=' || ch === ';') break;
        if (ch === ',') {
          atEntryStart = true;
          pos += 1;
          continue;
        }
      }
      const m =
        /[A-Za-z_]/.test(ch) && !/[A-Za-z0-9_]/.test(src[pos - 1] ?? '')
          ? TYPE_IDENTIFIER.exec(src.slice(pos))
          : null;
      if (m !== null) {
        if (depth === 0 && atEntryStart) {
          names.push(m[0]);
          atEntryStart = false;
        }
        pos += m[0].length;
        continue;
      }
      pos += 1;
    }
    return names;
  }

  /**
   * **Phase 3**: consume the definition head's trailing clause, whose `where`
   * word starts at `start` (found by {@link scanWhereClause}). The clause's
   * VERBATIM source text rides into the assembled signature, so the author's
   * spelling of a bound survives and the type grammar's own declaration-time
   * validation — duplicates, reserved names, unused or result-only variables,
   * non-ground bounds, and the reserved `is` slot — comes back for free.
   *
   * `where <name> (":" <bound>)? ("is" <Proto> ("&" <Proto>)*)? ("," …)*`.
   * Scanned from the raw source (see {@link parseTypeParamClause}); a bound's
   * extent comes from the type subparser, with the clause's own names already
   * seeded. Returns `null` after diagnosing a malformed clause.
   */
  private consumeWhereClause(
    start: number
  ): { text: string; end: number } | null {
    const src = this.source;
    let pos = start + 'where'.length;
    const skipSpace = (): void => {
      while (pos < src.length && /\s/.test(src[pos])) pos += 1;
    };
    const fail = (): null => {
      this.error(['symbol-expected'], pos, Math.min(pos + 1, src.length));
      this.advanceToOffset(pos);
      return null;
    };

    for (;;) {
      skipSpace();
      const m = TYPE_IDENTIFIER.exec(src.slice(pos));
      if (m === null) return fail();
      pos += m[0].length;

      skipSpace();
      if (src[pos] === ':') {
        pos += 1;
        try {
          // Extent only — the bound's MEANING is validated on the assembled
          // signature. `allowWhere` stays false (the default): a bound is a
          // ground type, and the clause's `,`-list must not be swallowed.
          const { end } = parseTypePrefix(src.slice(pos), this.typeResolver);
          pos += end;
        } catch (e) {
          const err = e as { position?: number; rawMessage?: string };
          const rel = typeof err.position === 'number' ? err.position : 0;
          const message =
            err.rawMessage ?? (e instanceof Error ? e.message : String(e));
          this.error(
            ['type-annotation-error', message],
            pos + rel,
            Math.min(pos + rel + 1, src.length)
          );
          this.advanceToOffset(pos);
          return null;
        }
      }

      // The protocol-conformance slot. Parsed so the clause's extent is
      // right; the conformance itself is checked by the engine at each call
      // site (protocols design P19), never here.
      skipSpace();
      if (/^is\b/.test(src.slice(pos))) {
        pos += 2;
        for (;;) {
          skipSpace();
          const proto = TYPE_IDENTIFIER.exec(src.slice(pos));
          if (proto === null) return fail();
          pos += proto[0].length;
          skipSpace();
          if (src[pos] !== '&') break;
          pos += 1;
        }
      }

      skipSpace();
      if (src[pos] !== ',') break;
      pos += 1;
    }

    const text = src.slice(start, pos).trimEnd();
    const end = start + text.length;
    this.advanceToOffset(end);
    return { text, end };
  }

  /** Whether the statement at the cursor is a math-style function definition
   * `f( … ) = …` or `f( … ) -> Type = …`: a bare symbol, an abutting `(`, its
   * matching `)`, then either `=` or an `-> Type =` return ascription. An
   * effect specifier may precede the arrow (`f(x) random -> integer = …`) but
   * only WITH it: `f(x) random = 5` stays an expression. A lookahead only — it
   * consumes nothing. */
  private isMathFunctionDef(): boolean {
    if (this.current.type !== 'SYMBOL') return false;
    const paren = this.peek(1);
    if (paren.type !== 'OPEN_PAREN' || paren.precededByWhitespace) return false;

    // Scan to the matching close paren (from the token after the symbol).
    let depth = 0;
    let i = this.pos + 1;
    for (; i < this.tokens.length; i++) {
      const t = this.tokens[i].type;
      if (t === 'OPEN_PAREN') depth += 1;
      else if (t === 'CLOSE_PAREN') {
        depth -= 1;
        if (depth === 0) break;
      } else if (t === 'EOF') return false;
    }
    // Skip an optional effect specifier: a run of bare effect words.
    let k = i + 1;
    while (
      this.tokens[k] !== undefined &&
      this.tokens[k].type === 'SYMBOL' &&
      EFFECT_SPECIFIER_WORDS.has(this.tokens[k].text)
    )
      k += 1;
    const after = this.tokens[k];
    if (after === undefined) return false;
    // The bare `=` form is claimed only WITHOUT a specifier: `f(x) random = 5`
    // is an expression (an invisible multiply), not a definition.
    if (k === i + 1 && after.type === 'OPERATOR' && after.text === '=')
      return true;
    // Optional return type `-> Type =`: past `->`, scan for the `=` that ends
    // the (type) prefix, stopping at a statement boundary. Type spellings never
    // contain `=`, so the first `=` on the line closes the definition head.
    if (after.type === 'OPERATOR' && after.text === '->') {
      for (let j = k + 1; j < this.tokens.length; j++) {
        const t = this.tokens[j];
        if (t.type === 'EOF' || t.type === 'SEMICOLON') return false;
        if (t.precededByLinebreak) return false;
        if (t.type === 'OPERATOR' && t.text === '=') return true;
      }
    }
    return false;
  }

  /** Math-style `f(x) = expr` →
   * `["DefineFunction", "f", ["Function", expr, …params]]` (definition
   * statements accumulate clauses — see {@link parseFunctionDefinition}).
   * Typed params
   * (`f(x: integer) = …`) are carried inline as `["Typed", sym, type]`
   * parameters, and a return type (`f(x: integer) -> real = …`) is ascribed
   * onto the body as `["Typed", body, type]` (the engine normalizes it). Both
   * annotations are enforced by the engine's typed-function-literal machinery;
   * no `Declare` side-channel is needed.
   *
   * An **effect specifier** may sit between the parameter list and `->`
   * (`f(x) random -> integer = …`); the ascription then carries the FULL
   * signature instead of the bare return type — see
   * {@link definitionAscription}. */
  private parseMathFunctionDef(): MathJsonExpression | null {
    const nameTok = this.advance(); // SYMBOL
    this.harvest(nameTok);
    // A literal word cannot name a function (`Infinity(x) = …`); the
    // verbatim form still can.
    if (LITERAL_WORDS.has(nameTok.text))
      this.error(['reserved-word', nameTok.text], nameTok.start, nameTok.end);
    const nameNode = this.wrap(
      { sym: nameTok.text },
      nameTok.start,
      nameTok.end
    );

    // Phase 0 of the trailing-`where` binding strategy — see
    // {@link scanWhereClause}. This route has no `<T>` binder site (the
    // lookahead requires the `(` to abut the name), so the clause is the only
    // way to quantify a math-form definition.
    const whereScan = this.check('OPEN_PAREN')
      ? this.scanWhereClause(this.current.start)
      : null;
    const seedNames = whereScan?.names ?? [];
    const seeded = seedNames.filter((n) => !this.knownTypeNames.has(n));
    const outerTypeParamNames = this.typeParamNames;
    if (seedNames.length > 0) {
      for (const n of seedNames) this.knownTypeNames.add(n);
      this.typeParamNames = new Set(seedNames);
    }

    // Which parameters mention a quantified name (parallel to `params`).
    const quantified: boolean[] = [];
    const params = this.parseParameterList(
      seedNames.length > 0 ? quantified : undefined
    );

    // Optional effect specifier — supported here only WITH the arrow (the
    // lookahead does not claim `f(x) random = 5`).
    const spec = this.parseEffectSpecifier();

    // Optional return type `-> Type` (ascribed onto the body below).
    let returnType: MathJsonExpression | null = null;
    if (this.check('OPERATOR') && this.current.text === '->') {
      this.advance(); // '->'
      returnType = this.parseHeldType();
    }

    // Phase 3 — the clause, always last. The bare `f(x) where T = …` spelling
    // is NOT claimed by the lookahead (as with a bare effect specifier), so
    // this only fires on the `-> Type where …` form.
    let where: WhereClause | undefined;
    // A clause that was written but did not parse — see
    // {@link parseFunctionDefinition}.
    let clauseFailed = false;
    if (
      whereScan !== null &&
      this.current.type === 'SYMBOL' &&
      this.current.text === 'where'
    ) {
      const consumed = this.consumeWhereClause(whereScan.start);
      if (consumed !== null)
        where = { ...whereScan, text: consumed.text, end: consumed.end };
      else clauseFailed = true;
    }

    if (seedNames.length > 0) {
      for (const n of seeded) this.knownTypeNames.delete(n);
      this.typeParamNames = outerTypeParamNames;
    }

    // A clause plus a LITERAL parameter is a generic multi-clause definition
    // (G2 rule 1) — out of scope; the clause is dropped after the rejection.
    if (where !== undefined && params.some(isLiteralParamNode)) {
      this.error(
        ['generic-clause-unsupported', nameTok.text],
        where.start,
        where.end
      );
      where = undefined;
    }

    const ascription = clauseFailed
      ? null
      : this.definitionAscription(
          params,
          spec,
          returnType,
          [],
          where !== undefined ? [where.start, where.end] : undefined,
          where?.text
        );

    // Erased lowering (§3.1), and the clause-rejection recovery that gates it
    // — see {@link parseFunctionDefinition}.
    const loweredParams =
      where !== undefined && !clauseFailed && ascription !== null
        ? params.map((p, i) =>
            quantified[i] === true ? (operand(p, 1) ?? p) : p
          )
        : params;

    if (!(this.check('OPERATOR') && this.current.text === '=')) {
      this.error(
        ['unexpected-symbol', this.current.text],
        this.current.start,
        this.current.end
      );
      return null;
    }
    this.advance(); // '='
    // The right-hand side is a function body: a `break`/`continue` BOUNDARY.
    const rhs = this.inLoopContext(0, () => this.parseExpression(0));
    if (rhs === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    const end = this.localEnd(rhs) ?? this.previousEnd();

    const ascribedBody =
      ascription !== null
        ? this.wrap(
            ['Typed', rhs, ascription] as MathJsonExpression[],
            this.localStart(rhs) ?? nameTok.start,
            end
          )
        : rhs;

    const fnNode = this.wrap(
      ['Function', ascribedBody, ...loweredParams] as MathJsonExpression[],
      nameTok.start,
      end
    );
    return this.wrap(
      ['DefineFunction', nameNode, fnNode] as MathJsonExpression[],
      nameTok.start,
      end
    );
  }

  /**
   * Collect a definition's **effect specifier**: the run of bare effect words
   * between the parameter list and `->` (`function roll(n) random -> integer`).
   * Returns `null` — consuming nothing — when the cursor is not on such a word,
   * which is exactly today's behavior for every existing definition.
   *
   * A word that is not in {@link EFFECT_SPECIFIER_WORDS} stops the run and is
   * left for the caller's `->` / `{` / `=` expectation to diagnose
   * (`function f(x) bogus { x }` keeps its `opening-bracket-expected` report).
   */
  private parseEffectSpecifier(): EffectSpecifier | null {
    if (
      this.current.type !== 'SYMBOL' ||
      !EFFECT_SPECIFIER_WORDS.has(this.current.text)
    )
      return null;

    const start = this.current.start;
    const words: string[] = [];
    let end = start;
    while (
      this.current.type === 'SYMBOL' &&
      EFFECT_SPECIFIER_WORDS.has(this.current.text)
    ) {
      words.push(this.current.text);
      end = this.current.end;
      this.advance();
    }
    return { words, start, end };
  }

  /**
   * The type node ascribed onto a definition's body.
   *
   * With no effect specifier this is the parsed return type — byte for byte
   * today's `["Typed", body, {str: returnType}]` ascription (or `null` for no
   * ascription at all).
   *
   * With a specifier the ascription carries the **full signature** (the
   * normative encoding of `docs/EFFECTS-MODEL.md`, "Epsil surface"):
   * parameter types from the parameter list, effects from the specifier slot,
   * and the return type — `unknown` when no `->` was given, the wide-result
   * convention that leaves the return inferred while still declaring the
   * effects (`function tick() scope { … }`).
   *
   * The full signature is ALSO assembled — with no effect run — whenever a
   * **type-parameter clause** is present (§3.2): a quantified signature has no
   * other spelling, and the trailing `where` clause the assembly appends is
   * what makes `T` a variable rather than an unknown type name. Either binder
   * spelling reaches this: the `<T>` clause as `typeParams` (rendered), the
   * trailing clause as `whereText` (the author's VERBATIM source).
   *
   * The signature is validated by the engine's type parser; a rejected
   * specifier (e.g. `pure random`, mutually exclusive in the type grammar) is
   * diagnosed on the specifier words and the definition falls back to the
   * no-specifier ascription. A rejected CLAUSE (an unused or result-only
   * variable, a duplicate, a non-ground bound, an `is` protocol slot — all of
   * them free from the type grammar's own declaration-time validation) falls
   * back to NO ascription: the plain return type would name a variable that is
   * no longer in scope.
   */
  private definitionAscription(
    params: MathJsonExpression[],
    spec: EffectSpecifier | null,
    returnType: MathJsonExpression | null,
    typeParams: readonly TypeParamDecl[] = [],
    clauseSpan?: [number, number],
    whereText?: string
  ): MathJsonExpression | null {
    const hasClause = typeParams.length > 0 || whereText !== undefined;
    if (spec === null && !hasClause) return returnType;

    const span: [number, number] =
      spec !== null ? [spec.start, spec.end] : (clauseSpan ?? [0, 0]);
    const retText =
      (returnType !== null ? stringValue(returnType) : null) ?? 'unknown';
    const sig = this.specifierSignature(
      params,
      spec,
      retText,
      typeParams,
      span,
      whereText
    );
    // Diagnosed; keep the plain ascription (but never a clause-dependent one).
    if (sig === null) return hasClause ? null : returnType;
    // The span covers every piece the signature was assembled from. Taken as
    // an extent rather than "clause start → return-type end": a TRAILING
    // `where` clause sits after the return type, so the naive pair inverts.
    const retEnd =
      (returnType !== null ? this.localEnd(returnType) : undefined) ?? span[1];
    const start = Math.min(clauseSpan?.[0] ?? span[0], span[0]);
    const end = Math.max(clauseSpan?.[1] ?? span[1], retEnd);
    return this.wrap({ str: sig }, start, end);
  }

  /**
   * Assemble and validate the full marker signature for an effect specifier,
   * or `null` after emitting a `type-annotation-error` spanning the specifier
   * words.
   *
   * Parameter names are cosmetic — the marker signature's argument list is a
   * mirror; the literal's parameter operands stay the parameters of record —
   * so a name that is not a plain identifier (or a named spelling the type
   * grammar rejects) falls back to an all-positional argument list rather than
   * failing the definition.
   *
   * The diagnostic spans `span` — the specifier tokens, or the type-parameter
   * clause when there is no specifier — rather than offset-shifting the type
   * parser's position (as `parseTypeAnnotation` does): the signature is
   * assembled, not a slice of the source, so its offsets do not map back.
   *
   * A clause is appended as a trailing `where` SUFFIX — always last, after the
   * effects slot and the return type, in every declaration spelling (the
   * clause-placement ruling of
   * `docs/plans/2026-08-11-where-clause-type-constraints.md`). Either binder
   * supplies it: a `<T>` clause is RENDERED from `typeParams` (bounds verbatim
   * from the source), a trailing clause rides as `whereText`, the author's
   * verbatim `where …` slice. The result is SELF-CONTAINED — the clause
   * introduces its own names — so the validation below needs no seeding, and
   * the type grammar's declaration-time checks (unused variable, result-only
   * variable, non-ground bound, duplicate, the reserved `is` slot) come back
   * as parse-time diagnostics for free.
   */
  private specifierSignature(
    params: MathJsonExpression[],
    spec: EffectSpecifier | null,
    retText: string,
    typeParams: readonly TypeParamDecl[],
    span: [number, number],
    whereText?: string
  ): string | null {
    const parts = params.map((p) => {
      if (operator(p) === 'Typed') {
        const t = operand(p, 2);
        return {
          name: symbol(operand(p, 1)),
          type:
            (t !== null ? (stringValue(t) ?? symbol(t)) : null) ?? 'unknown',
        };
      }
      return { name: symbol(p), type: 'unknown' };
    });

    const effects = spec !== null ? ` ${spec.words.join(' ')}` : '';
    const suffix =
      whereText !== undefined
        ? ` ${whereText}`
        : typeParams.length > 0
          ? ` where ${typeParams
              .map((d) => (d.bound !== null ? `${d.name}: ${d.bound}` : d.name))
              .join(', ')}`
          : '';
    const build = (named: boolean): string =>
      `(${parts
        .map((p) =>
          named && p.name !== null ? `${p.name}: ${p.type}` : p.type
        )
        .join(', ')})${effects} -> ${retText}${suffix}`;

    // A generated literal-parameter name must not leak into the marker
    // signature: fall back to the all-positional spelling.
    const nameable = parts.every(
      (p) =>
        p.name !== null &&
        PLAIN_IDENTIFIER.test(p.name) &&
        !isLiteralParamName(p.name)
    );
    const candidates = nameable ? [build(true), build(false)] : [build(false)];

    let message = '';
    for (const candidate of candidates) {
      try {
        parseType(candidate, this.typeResolver);
        return candidate;
      } catch (e) {
        const err = e as { rawMessage?: string };
        // Report the FIRST failure: it is the named spelling, the one that
        // mirrors what the author wrote.
        if (message === '')
          message =
            err.rawMessage ?? (e instanceof Error ? e.message : String(e));
      }
    }
    this.error(['type-annotation-error', message], span[0], span[1]);
    return null;
  }

  /** Parse a `( param, … )` parameter list. Each param is a symbol with an
   * optional `: Type` annotation. An annotated param is emitted as a typed
   * function-literal parameter `["Typed", sym, {str: type}]` (the engine's
   * native form); a bare param is the plain symbol node. The `Function` literal
   * built from these carries its parameter types inline, so no separate
   * signature side-channel is needed.
   *
   * A **literal parameter** (multi-clause definitions: `function f(0) = 1`) —
   * a number, string, or boolean literal in parameter position — lowers to an
   * anonymous value-typed parameter `["Typed", <generated>, {str: "<value>"}]`
   * where `<generated>` is a reserved-prefix name the body cannot reference
   * (see {@link parseLiteralParam}).
   *
   * When `quantified` is supplied (a `function f<T>(…)` head), one entry is
   * appended per parameter recording whether its annotation MENTIONS one of
   * the clause's type variables — the erased-lowering test of §3.1. The answer
   * comes from the type resolver itself (see {@link typeParamHits}), so
   * `list<T>` and `(T) -> real` count while a ground `tuple<Tx, real>` does
   * not. */
  private parseParameterList(quantified?: boolean[]): MathJsonExpression[] {
    const open = this.advance(); // '('
    this.brackets.push(open);

    const params: MathJsonExpression[] = [];
    if (!this.check('CLOSE_PAREN')) {
      for (;;) {
        const tok = this.current;
        if (this.startsLiteralParam()) {
          const p = this.parseLiteralParam(params.length + 1);
          if (p === null) {
            this.recoverInBracket();
            break;
          }
          params.push(p);
          quantified?.push(false);
          if (!this.match('COMMA')) break;
          if (this.check('CLOSE_PAREN')) break; // trailing comma
          continue;
        }
        if (tok.type !== 'SYMBOL' && tok.type !== 'VERBATIM_SYMBOL') {
          this.error(['symbol-expected'], tok.start, tok.end);
          this.recoverInBracket();
          break;
        }
        this.advance();
        this.harvest(tok);
        const pname =
          tok.type === 'VERBATIM_SYMBOL' ? (tok.value ?? '') : tok.text;
        // The generated literal-parameter namespace is RESERVED: a
        // user-written parameter of that shape would be indistinguishable
        // from a generated one, and serialization/diagnostics would drop
        // its name.
        if (isLiteralParamName(pname))
          this.error(['reserved-word', pname], tok.start, tok.end);
        const symNode = this.wrap({ sym: pname }, tok.start, tok.end);

        // Optional `: Type` — an annotated param is a typed function-literal
        // parameter `["Typed", sym, {str: type}]`. Comma-delimited, so
        // `allowWhere` stays false (the default): the definition's OWN clause
        // trails the whole head, and a clause here would read the next
        // parameter as one of its `<var_decl>`s.
        if (this.check('OPERATOR') && this.current.text === ':') {
          const hits = quantified !== undefined ? new Set<string>() : null;
          const outerHits = this.typeParamHits;
          this.typeParamHits = hits;
          const annotation = this.parseTypeAnnotation();
          this.typeParamHits = outerHits;
          if (annotation !== null)
            params.push(
              this.wrap(
                ['Typed', symNode, annotation.node] as MathJsonExpression[],
                tok.start,
                annotation.end
              )
            );
          else {
            // Diagnosed; the cursor is still at the malformed type. Resync to
            // the next `,` or the `)` so the remaining parameters parse; the
            // parameter itself survives untyped.
            this.recoverInBracket(true);
            params.push(symNode);
          }
          quantified?.push((hits?.size ?? 0) > 0);
        } else {
          params.push(symNode);
          quantified?.push(false);
        }

        if (!this.match('COMMA')) break;
        if (this.check('CLOSE_PAREN')) break; // trailing comma
      }
    }

    this.brackets.pop();

    if (this.check('CLOSE_PAREN')) this.advance();
    else this.error(['closing-bracket-expected', ')'], open.start, open.end);

    return params;
  }

  /** Whether the current token begins a **literal parameter**: a number
   * (optionally signed), a string, or a boolean literal in parameter
   * position. `Infinity` and `NaN` count: they are numeric LITERALS in
   * expression position (see {@link parseSymbol}), so the literal reading
   * is the consistent one — unlike an ordinary constant name (`Pi`), which
   * is a symbol everywhere and stays a parameter name. */
  private startsLiteralParam(): boolean {
    const tok = this.current;
    if (tok.type === 'NUMBER' || tok.type === 'STRING') return true;
    if (
      tok.type === 'OPERATOR' &&
      (tok.text === '-' || tok.text === '+') &&
      (this.peek(1).type === 'NUMBER' ||
        (this.peek(1).type === 'SYMBOL' &&
          (this.peek(1).text === 'Infinity' || this.peek(1).text === 'oo')))
    )
      return true;
    return (
      tok.type === 'SYMBOL' &&
      (tok.text === 'true' ||
        tok.text === 'false' ||
        tok.text === 'Infinity' ||
        tok.text === 'oo' ||
        tok.text === 'NaN')
    );
  }

  /** Parse one literal parameter (`0`, `-1.5`, `"yes"`, `true`) and lower it
   * to an anonymous value-typed parameter
   * `["Typed", "literalParam_<position>", {str: "<value-type>"}]` — the §4.5
   * pinned encoding of the function-polymorphism design. The generated name
   * (1-based parameter position, reserved prefix) never surfaces: clause
   * identity uses parameter TYPES, and serialization renders the literal
   * spelling back. Returns `null` (diagnosed) for a literal that has no
   * value-type spelling — an interpolated string. */
  private parseLiteralParam(position: number): MathJsonExpression | null {
    const start = this.current.start;
    let negative = false;
    if (this.current.type === 'OPERATOR') {
      negative = this.current.text === '-';
      this.advance(); // '-' / '+'
    }
    const tok = this.advance();
    this.harvest(tok);

    let typeText: string;
    if (tok.type === 'NUMBER') {
      typeText = numberPayload(tok.text, negative);
    } else if (
      tok.type === 'SYMBOL' &&
      (tok.text === 'Infinity' || tok.text === 'oo')
    ) {
      // The type grammar spells the infinity value types `oo` / `-oo`.
      typeText = negative ? '-oo' : 'oo';
    } else if (tok.type === 'SYMBOL' && tok.text === 'NaN') {
      // The value type `nan` admits exactly NaN (amended D1 — "match only
      // themselves", like the infinities).
      typeText = 'nan';
    } else if (tok.type === 'STRING') {
      // Only a plain string is a literal — an interpolation hole is an
      // expression, and expressions are not parameters.
      const parts = tok.parts ?? [''];
      if (parts.some((p) => typeof p !== 'string')) {
        this.error(['literal-expected'], tok.start, tok.end);
        return null;
      }
      const cooked = parts.join('');
      typeText = `"${cooked.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    } else {
      // SYMBOL `true` / `false` (guaranteed by `startsLiteralParam`).
      typeText = tok.text;
    }

    return this.wrap(
      [
        'Typed',
        this.wrap(
          { sym: `${LITERAL_PARAM_PREFIX}${position}` },
          start,
          tok.end
        ),
        this.wrap({ str: typeText }, start, tok.end),
      ] as MathJsonExpression[],
      start,
      tok.end
    );
  }

  /** Consume a `Type` starting at the current token (a return type after
   * `->`). Returns the held `{str: type}` node (to be ascribed onto the
   * function body as `["Typed", body, {str: type}]`), or `null` on a malformed
   * type (the following `{` / `=` expectation reports the problem).
   *
   * `allowWhere` stays false (the default): a trailing clause quantifies the
   * whole assembled signature, not the return type, so it is left for the
   * definition parser to consume (see {@link consumeWhereClause}). */
  private parseHeldType(): MathJsonExpression | null {
    const start = this.current.start;
    try {
      const { end } = parseTypePrefix(
        this.source.slice(start),
        this.typeResolver
      );
      const typeString = this.source.slice(start, start + end).trim();
      this.advanceToOffset(start + end);
      return this.wrap({ str: typeString }, start, start + end);
    } catch {
      // A malformed return type: leave the cursor; the following
      // `{` / `=` expectation reports the problem.
      return null;
    }
  }

  /**
   * A bare type annotation in target position (no `let`/`const` keyword): a
   * target symbol immediately followed by an `OPERATOR` token whose text is
   * `:`. A type annotation *implies a declaration* (Phase 4 reconciliation), so
   * this emits the same (non-const) `Declare` shape as a keyword declaration:
   *   - `x: T`        →  `["Declare", "x", {str: "T"}]`
   *   - `x: T = expr` →  `["Declare", "x", {str: "T"}, ["Dictionary",
   *                         ["KeyValuePair", value, expr]]]`
   *
   * where `"T"` is the (trimmed) source text of the annotation type. Returns
   * `undefined` when the current position is *not* an annotation (the caller
   * falls back to an expression), or `null` on a malformed type (already
   * recovered).
   */
  private tryParseAnnotation(): MathJsonExpression | null | undefined {
    const target = this.current;
    if (target.type !== 'SYMBOL' && target.type !== 'VERBATIM_SYMBOL')
      return undefined;
    const colon = this.peek(1);
    if (colon.type !== 'OPERATOR' || colon.text !== ':') return undefined;

    // Commit to an annotation (a declaration).
    this.advance(); // the target symbol
    this.harvest(target);
    const name =
      target.type === 'VERBATIM_SYMBOL' ? (target.value ?? '') : target.text;
    // An annotation implies a declaration: a literal word cannot be its
    // target (`oo: number = 5`); the verbatim form still can.
    if (target.type === 'SYMBOL' && LITERAL_WORDS.has(name))
      this.error(['reserved-word', name], target.start, target.end);
    const nameNode = this.wrap({ sym: name }, target.start, target.end);

    // The cursor is now on the `:`; `finishDeclaration` parses the type and an
    // optional initializer, building the (non-const) `Declare` node.
    return this.finishDeclaration(false, target.start, nameNode);
  }

  /**
   * Parse a `: Type` annotation starting at the current `:` OPERATOR token. The
   * type is parsed by the engine's `common/type` prefix subparser, then parsing
   * resumes in Epsil just past the type. Returns the held `{str}` type node and
   * its end offset, or `null` on a malformed type (after emitting a
   * `type-annotation-error` diagnostic). On `null` the cursor is left AT the
   * offending token: the caller resynchronizes, since the right resync unit
   * depends on the context (a statement boundary for a declaration, the next
   * `,`/closer for a parameter or pattern list).
   *
   * `options.allowWhere` — see {@link parseTypeBody}.
   */
  private parseTypeAnnotation(options?: { allowWhere?: boolean }): {
    node: MathJsonExpression;
    end: number;
    type: Type;
  } | null {
    const colonTok = this.advance(); // ':'
    return this.parseTypeBody(colonTok.end, options);
  }

  /** Parse a type starting at the (local) source offset `typeSourceStart` —
   * the raw text after a `:` annotation marker or a `type name =` head. The
   * type is parsed by the engine's `common/type` prefix subparser (with this
   * parser's known-type-name resolver), then parsing resumes in Epsil just
   * past the type. Returns the held `{str}` type node and its end offset, or
   * `null` on a malformed type (after emitting a `type-annotation-error`
   * diagnostic). Recovery is the CALLER's: on `null` the cursor is left at the
   * offending token, un-advanced (see {@link parseTypeAnnotation}).
   *
   * `options.allowWhere` (default `false`) admits a trailing `where` clause —
   * pass `true` only where the annotation is the WHOLE type (a standalone
   * `let f: <type> = …` declaration, a `type name = <type>` body). Everywhere
   * else the clause belongs to an enclosing construct, or — in a
   * comma-delimited list — its own `,`-separated declarations would swallow
   * the next parameter, so a clause there is diagnosed AT the `where` (see
   * {@link misplacedWhereClause}). */
  private parseTypeBody(
    typeSourceStart: number,
    options?: { allowWhere?: boolean; allowObjectType?: boolean }
  ): {
    node: MathJsonExpression;
    end: number;
    type: Type;
  } | null {
    const allowWhere = options?.allowWhere ?? false;
    let typeEnd: number;
    let typeString: string;
    let type: Type;
    try {
      const parsed = parseTypePrefix(
        this.source.slice(typeSourceStart),
        this.typeResolver,
        undefined,
        { allowWhere, allowObjectType: options?.allowObjectType }
      );
      // The type parsed, but a clause this context does not admit follows it.
      if (
        !allowWhere &&
        this.misplacedWhereClause(typeSourceStart, typeSourceStart + parsed.end)
      )
        return null;
      type = parsed.type;
      typeEnd = typeSourceStart + parsed.end;
      typeString = this.source.slice(typeSourceStart, typeEnd).trim();
      this.advanceToOffset(typeEnd);
    } catch (e) {
      // A type that parses only WITH a clause fails here on the variable the
      // clause would have bound (`(T) -> T where T` reports `Unknown type
      // "T"`). Report the misplaced clause instead — that is the real problem.
      if (!allowWhere && this.misplacedWhereClause(typeSourceStart))
        return null;
      const err = e as { position?: number; rawMessage?: string };
      const rel = typeof err.position === 'number' ? err.position : 0;
      const message =
        err.rawMessage ?? (e instanceof Error ? e.message : String(e));
      const errStart = typeSourceStart + rel;
      // Offset-shift the type error to the absolute Epsil position. Use the
      // token at that offset (if any) for the diagnostic's end.
      let errEnd = errStart + 1;
      const errTok = this.firstTokenAtOrAfter(errStart);
      if (errTok !== undefined) errEnd = Math.max(errTok.end, errStart + 1);
      // A PROTOCOL name in type position gets its own diagnostic, pointing at
      // the constrained-variable spelling rather than reporting an unknown type.
      const protocol = protocolInTypePosition(e);
      if (protocol !== null) {
        this.error(
          ['protocol-in-type-position', protocol],
          errStart,
          Math.max(errEnd, errStart + 1)
        );
        return null;
      }
      // An `object<…>` layout outside a named type's definition: the type
      // parser codes the refusal, so the author gets the rule by name rather
      // than a generic type-annotation failure.
      if ((e as { code?: string }).code === 'object-type-not-inline') {
        this.error(
          ['object-type-not-inline'],
          errStart,
          Math.max(errEnd, errStart + 1)
        );
        return null;
      }
      this.error(['type-annotation-error', message], errStart, errEnd);
      return null;
    }

    const node = this.wrap({ str: typeString }, typeSourceStart, typeEnd);
    return { node, end: typeEnd, type };
  }

  /**
   * Diagnose a `where` clause in an annotation position that cannot carry one
   * (every comma-delimited context — a parameter, a pattern, a mapsto
   * parameter — plus the `is` operator's compound operand). Returns `true`
   * when a clause was found and reported.
   *
   * Two entry points, because the clause shows up differently on each:
   *
   *  - with `consumedEnd`, the type PARSED (`(integer) -> integer where T`)
   *    and the clause is the `where` word just past it. Left unreported, the
   *    enclosing list would stop at the `where` and blame its own missing
   *    `,`/`)`, and the clause's `,`-separated declarations would read the
   *    next parameter as a `<var_decl>`.
   *  - without it, the type FAILED — `(T) -> T where T` reports `Unknown type
   *    "T"`, since `T` is only a variable once the clause is admitted. A
   *    re-parse that admits the clause tells us the clause is the real
   *    problem, and where it starts.
   */
  private misplacedWhereClause(
    typeSourceStart: number,
    consumedEnd?: number
  ): boolean {
    const src = this.source;
    let at: number | null = null;
    if (consumedEnd !== undefined) {
      let pos = consumedEnd;
      while (pos < src.length && /\s/.test(src[pos])) pos += 1;
      if (/^where\b/.test(src.slice(pos))) at = pos;
    } else {
      try {
        const { end } = parseTypePrefix(
          src.slice(typeSourceStart),
          this.typeResolver,
          undefined,
          { allowWhere: true }
        );
        // The TRAILING clause is the one that was rejected; a nested one is
        // parenthesized and already legal.
        for (const m of src
          .slice(typeSourceStart, typeSourceStart + end)
          .matchAll(/\bwhere\b/g))
          at = typeSourceStart + m.index;
      } catch {
        at = null;
      }
    }
    if (at === null) return false;
    this.error(
      ['type-annotation-error', NESTED_WHERE_CLAUSE_MESSAGE],
      at,
      Math.min(at + 'where'.length, src.length)
    );
    return true;
  }

  /** Advance the token cursor until the current token starts at or past the
   * (local) `offset`. Used to resume Epsil parsing after a type subparse
   * consumed a prefix of the raw source. */
  private advanceToOffset(offset: number): void {
    while (this.current.type !== 'EOF' && this.current.start < offset)
      this.advance();
  }

  /** Emit exactly one diagnostic for an unexpected token. */
  private reportUnexpected(token: Token): void {
    if (token.diagnostics && token.diagnostics.length > 0) {
      this.harvest(token);
    } else {
      this.error(['unexpected-symbol', token.text], token.start, token.end);
    }
  }

  /** Skip the offending token, then continue to the next statement boundary. */
  private recoverAtTopLevel(): void {
    this.advance(); // the offending token
    while (
      this.current.type !== 'EOF' &&
      this.current.type !== 'SEMICOLON' &&
      !this.current.precededByLinebreak
    ) {
      this.advance();
    }
    if (this.current.type === 'SEMICOLON') this.advance();
  }

  /** Resynchronize at the end of a malformed statement whose diagnostic has
   * already been emitted, and record that fact (see {@link
   * statementRecovered}) so the statement loop does not recover a SECOND time
   * — which would skip the statement that follows. Unlike {@link
   * recoverAtTopLevel} the current token is not consumed unconditionally (the
   * cursor may already be past the error), and a `}` stops the skip so a
   * statement inside a block never eats the block's closing brace. */
  private recoverAtStatementBoundary(): void {
    while (
      this.current.type !== 'EOF' &&
      this.current.type !== 'SEMICOLON' &&
      this.current.type !== 'CLOSE_BRACE' &&
      !this.current.precededByLinebreak
    ) {
      this.advance();
    }
    if (this.current.type === 'SEMICOLON') this.advance();
    this.statementRecovered = true;
  }

  /**
   * Consume a statement separator after a statement, or diagnose its absence.
   *
   * Statements are separated by an explicit `;` or by a linebreak
   * (`precededByLinebreak`). Two full expressions on one line with no separator
   * are a diagnostic (language-review §2.5) — there is no silent
   * `Block`-juxtaposition. The offending region is skipped by the top-level
   * recovery so exactly one diagnostic is reported.
   */
  private expectStatementSeparator(): void {
    if (this.check('SEMICOLON')) {
      this.advance();
      return;
    }
    if (this.current.type === 'EOF' || this.current.precededByLinebreak) return;

    // A second expression on the same line with no separator.
    this.error(
      ['unexpected-symbol', this.current.text],
      this.current.start,
      this.current.end
    );
    this.recoverAtTopLevel();
  }

  //
  // ─── Expression (precedence climbing) ─────────────────────────────────────
  //

  /**
   * Parse an expression whose operators all bind at least as tightly as
   * `minPrecedence`. Returns `null` if no primary can be parsed.
   */
  private parseExpression(minPrecedence: number): MathJsonExpression | null {
    // CONSUME the statement-position flag: only this call may read a bare `=`
    // as an assignment, and every nested `parseExpression` — including the one
    // that parses this expression's own right operand — sees it cleared.
    const atStatement = this.assignPosition;
    this.assignPosition = false;

    let left = this.parseUnary();
    if (left === null) return null;

    for (;;) {
      // Postfix operators (`!` Factorial). They bind tighter than any infix
      // operator and must abut their operand (see the whitespace rule above),
      // so they are consumed before `peekInfix`. `x!` → `["Factorial", x]`.
      const post = this.peekPostfix();
      if (post !== null && post.precedence >= minPrecedence) {
        const start = this.localStart(left) ?? this.current.start;
        const opTok = this.advance(); // the postfix operator token
        left = this.wrap(
          [post.name, left] as MathJsonExpression[],
          start,
          opTok.end
        );
        continue;
      }

      // Conditional expression: `a if cond else b` → `["If", cond, a, b]`.
      // A word-spelled TERNARY, so it is recognized here rather than through
      // the shared operator table (`peekInfix` never claims `if`).
      //
      // The `if` must be on the SAME LINE as `a`: a linebreak is a statement
      // separator (see "Statement sequencing" above), so an `if` that starts a
      // line is a new `if`-statement, never a conditional tail. Without this
      // guard, `let y = 3` followed by `if c { … }` on the next line would
      // glue into `3 if c …` and then fail on the `{`.
      if (
        CONDITIONAL_PRECEDENCE >= minPrecedence &&
        this.check('SYMBOL') &&
        this.current.text === 'if' &&
        !this.current.precededByLinebreak
      ) {
        const conditional = this.parseConditionalTail(left);
        if (conditional === null) break;
        left = conditional;
        continue;
      }

      // `x is integer` — the dynamic type test. Also recognized here rather
      // than through the operator table, because its right operand is a TYPE:
      // the type subparser consumes it, so `x is intger` is a parse-time
      // diagnostic instead of a comparison against an undeclared symbol.
      //
      // `is` is a CONTEXTUAL word, not a reserved one: it is claimed only in
      // infix position after an operand, so `let is = 5` and `f(is)` remain
      // legal.
      //
      // For the same reason it must be on the SAME LINE as its left operand,
      // exactly like the conditional `if` above. A linebreak is a statement
      // separator, and `is` is still spellable as an ordinary identifier, so
      // an `is` starting a line is a new statement reading that variable —
      // without this guard, `x` followed by `is + 1` on the next line is
      // swallowed as a type test and diagnosed.
      if (
        TYPE_TEST_PRECEDENCE >= minPrecedence &&
        this.check('SYMBOL') &&
        this.current.text === 'is' &&
        !this.current.precededByLinebreak
      ) {
        const test = this.parseTypeTestTail(left);
        if (test === null) break;
        left = test;
        continue;
      }

      // At the TOP LEVEL of a `match` case body, a linebreak ends the body —
      // the next line is a new case, which may well START with an operator
      // (a pinned pattern `== lim => …`, an or-alternative). Continuing the
      // expression across the break would swallow the next case's pattern
      // (`1 => "one"` then `== lim => …` fused into `"one" == lim`).
      // Parenthesized subexpressions are deeper in `this.brackets`, so they
      // keep the ordinary leading-operator continuation.
      if (
        this.current.precededByLinebreak &&
        this.matchBodyStops.length > 0 &&
        this.matchBodyStops[this.matchBodyStops.length - 1] ===
          this.brackets.length
      )
        break;

      const op = this.peekInfix();
      if (op === null) {
        // Invisible multiplication: a number literal immediately followed (no
        // whitespace) by a token that begins a primary (`2x`, `2(x+1)`). Binds
        // at `Multiply` precedence, so `^` stays tighter (`3x^3` is
        // `3·(x^3)`).
        if (
          this.startsInvisibleMultiply(left) &&
          MULTIPLY_PRECEDENCE >= minPrecedence
        ) {
          const right = this.parseExpression(MULTIPLY_PRECEDENCE + 1);
          if (right === null) break;
          const start = this.localStart(left) ?? 0;
          const end = this.localEnd(right) ?? this.previousEnd();
          left = this.wrap(
            ['Multiply', left, right] as MathJsonExpression[],
            start,
            end
          );
          continue;
        }
        break;
      }
      // Resolve a bare `=` to the spelling it actually means BEFORE the
      // precedence test, because the two readings bind differently: `Assign`
      // is the loosest operator (10) so it takes the whole right-hand side,
      // while `Equal` is relational (60) so `if x = 5 && y` groups as
      // `(x = 5) && y`. From here on `def` is the resolved row, so the node
      // built below — and its n-ary relational chaining — is identical to one
      // written with `:=` or `==`.
      const asAssign =
        op.def.name === 'AssignOrEqual' &&
        atStatement &&
        minPrecedence === 0 &&
        isBindingTarget(left) &&
        this.startsWithSymbolToken(left) &&
        !this.isLiteralWordNode(left);
      // `(a, b) = (b, a)` — a destructuring assignment written with a bare
      // `=`. A parenthesized left side is not a binding target, so this
      // resolved to a COMPARISON of two tuples whose result is discarded:
      // the swap silently does nothing. Diagnosed only for a left side
      // shaped exactly like a destructuring pattern (bare symbols, `_`,
      // nested tuples), so a genuine tuple equation — `(x, y) = f(t)` with
      // computed components — stays silent.
      if (
        op.def.name === 'AssignOrEqual' &&
        atStatement &&
        minPrecedence === 0 &&
        !asAssign &&
        isDestructuringPatternShape(left)
      )
        this.error(
          ['destructuring-bare-equal'],
          this.localStart(left) ?? 0,
          this.localEnd(left) ?? this.previousEnd()
        );

      const def =
        op.def.name === 'AssignOrEqual'
          ? asAssign
            ? ASSIGN_OPERATOR
            : EQUAL_OPERATOR
          : op.def;

      if (def.precedence < minPrecedence) break;

      if (op.asymmetric) this.emitAsymmetric(this.current, op.def.symbol);

      // Consume the operator token(s).
      for (let i = 0; i < op.tokenCount; i++) this.advance();

      const rightMin =
        def.assoc === 'right' ? def.precedence : def.precedence + 1;
      // A mapsto's right operand is a LAMBDA BODY, so it is a
      // `break`/`continue` boundary: `for x in xs { f(y |-> break) }` must not
      // let the lambda's `break` bind to the enclosing loop.
      let right =
        def.symbol === '|->'
          ? this.inLoopContext(0, () => this.parseExpression(rightMin))
          : this.parseExpression(rightMin);
      if (right === null) {
        this.error(
          ['expression-expected'],
          this.current.start,
          this.current.end
        );
        break;
      }

      // Pipe-stage sugar: a `|->` after the operand forms an unparenthesized
      // stage lambda, and an operator-written placeholder expression (`_^2`)
      // becomes an implicit lambda. See `pipeStage`.
      if (def.name === 'Pipe') right = this.pipeStage(right, rightMin);

      // `a = b = 5` reads as "assign a the boolean (b == 5)" — coherent, but
      // never what someone writing a chained assignment means. Diagnose it;
      // `a := b := 5` (genuinely chained) and `a = (b = 5)` (explicitly a
      // comparison) both stay silent.
      if (asAssign && right === this.lastBareEqualNode)
        this.error(
          ['chained-assignment'],
          this.localStart(right) ?? 0,
          this.localEnd(right) ?? this.previousEnd()
        );
      left = this.combineInfix(def, left, right);
      // Record a BARE-`=` comparison so the chained-assignment check above can
      // recognize it by identity on the next iteration / outer frame.
      if (op.def.name === 'AssignOrEqual' && !asAssign)
        this.lastBareEqualNode = left;
    }

    return left;
  }

  /**
   * The tail of a conditional expression — `if cond else alternative`, with
   * the already-parsed `consequent` to its left and the `if` current —
   * yielding `["If", cond, consequent, alternative]`.
   *
   * Unlike the block form (`parseIf`), both branches are plain **expressions**,
   * never `Block`s, so the conditional introduces no scope and no statement can
   * appear in a branch (they never reach `parseStatement`). The `else` is
   * MANDATORY: it is what terminates the condition, and a missing branch would
   * leave the false case with no spelling. No `else if` spelling is needed —
   * the alternative is parsed at the conditional's own precedence, so
   * `a if c else b if d else e` right-nests on its own.
   */
  private parseConditionalTail(
    consequent: MathJsonExpression
  ): MathJsonExpression | null {
    const kw = this.advance(); // 'if'

    const cond = this.parseExpression(CONDITIONAL_PRECEDENCE + 1);
    if (cond === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    this.checkConditionAssign(cond);

    if (!(this.check('SYMBOL') && this.current.text === 'else')) {
      this.error(
        ['conditional-else-expected'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    this.advance(); // 'else'

    const alternative = this.parseExpression(CONDITIONAL_PRECEDENCE);
    if (alternative === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }

    return this.wrap(
      ['If', cond, consequent, alternative] as MathJsonExpression[],
      this.localStart(consequent) ?? kw.start,
      this.localEnd(alternative) ?? this.previousEnd()
    );
  }

  /**
   * The tail of a dynamic type test — `is Type`, with the already-parsed
   * `subject` to its left and the `is` current — yielding `["Element",
   * subject, Type]`.
   *
   * `Element(value, <type name>)` is the engine's dynamic type test and is
   * exactly what a `match` type pattern (`n: integer => …`) lowers to, so the
   * two surfaces agree by construction. It resolves SIMPLE NAMED types only: a
   * compound type parses (the subparser accepts the whole union, negation, or
   * application) but never resolves, so it gets the same
   * `type-pattern-unsupported` diagnostic the pattern form gets. Full type
   * expressions in this position land with the typed-pattern work, in one
   * place for both surfaces.
   */
  private parseTypeTestTail(
    subject: MathJsonExpression
  ): MathJsonExpression | null {
    const kw = this.advance(); // 'is'
    const start = this.localStart(subject) ?? kw.start;
    const tok = this.current;

    // The type must be on the SAME LINE as `is`, for the same reason `is`
    // itself must be on the same line as its subject: a linebreak is a
    // statement separator, so without this the test reaches across it and
    // silently fuses two statements (`x is` / `integer + 1` became
    // `Add(Element(x, integer), 1)` with no diagnostic at all).
    if (tok.precededByLinebreak) {
      this.error(
        ['type-annotation-error', 'Expected a type on the same line as `is`'],
        kw.start,
        kw.end
      );
      return null;
    }

    // The right operand is exactly ONE identifier token. Bounding it that way
    // — instead of handing the rest of the line to the type subparser — is
    // what keeps the TYPE grammar's `|`/`&` from swallowing the EXPRESSION
    // grammar's `||`/`&&`: `x is integer && y is string` must be a conjunction
    // of two tests, not an intersection type. The lexer munches `&&`/`||` into
    // single tokens, so a compound type is recognizable by a LONE `|`, `&`,
    // `<`, or `->` after the name.
    const next = this.peek();
    const continuesType =
      next.type === 'OPERATOR' &&
      (next.text === '|' ||
        next.text === '&' ||
        next.text === '<' ||
        next.text === '->');

    if (
      tok.type === 'SYMBOL' &&
      PLAIN_IDENTIFIER.test(tok.text) &&
      !continuesType
    ) {
      this.advance();
      this.harvest(tok);
      // Validate the name against the type grammar in isolation, so a typo is
      // caught here (`x is intger`) rather than becoming a comparison against
      // an undeclared symbol. A bare name, so `allowWhere` is moot; it stays
      // false (the default).
      try {
        parseTypePrefix(tok.text, this.typeResolver);
      } catch (e) {
        const err = e as { rawMessage?: string };
        const message =
          err.rawMessage ?? (e instanceof Error ? e.message : String(e));
        this.error(['type-annotation-error', message], tok.start, tok.end);
      }
      return this.wrap(
        [
          'Element',
          subject,
          this.wrap({ sym: tok.text }, tok.start, tok.end),
        ] as MathJsonExpression[],
        start,
        tok.end
      );
    }

    // A compound type (`!error`, `integer | string`, `list<integer>`) or no
    // type at all. Hand it to the type subparser so the diagnostic is precise
    // and the cursor lands past the whole type, then report it as unsupported
    // — the same verdict the equivalent `match` pattern gets. The operand of
    // `is` is a ground type test, never a polytype, so `allowWhere` stays
    // false (the default).
    const annotation = this.parseTypeBody(kw.end);
    if (annotation === null) return null;
    this.error(
      ['type-pattern-unsupported', stringValue(annotation.node) ?? ''],
      start,
      annotation.end
    );
    return this.wrap(
      [
        'Element',
        subject,
        this.wrap(
          { sym: stringValue(annotation.node) ?? '' },
          kw.end,
          annotation.end
        ),
      ] as MathJsonExpression[],
      start,
      annotation.end
    );
  }

  /** A prefix-operator run followed by its operand, or a primary. */
  private parseUnary(): MathJsonExpression | null {
    const token = this.current;
    const sigils = this.prefixSigils(token);
    if (sigils === null) return this.parsePostfix();

    // A prefix operator must abut its operand: `-x`, never `- x`.
    const operandToken = this.peek();
    if (operandToken.precededByWhitespace) {
      this.error(['unexpected-symbol', token.text], token.start, token.end);
      this.advance(); // the offending prefix operator
      return null;
    }

    const start = token.start;
    this.advance(); // the prefix-operator token
    const operand = this.parseExpression(PREFIX_PRECEDENCE);
    if (operand === null) {
      this.error(['expression-expected'], token.start, token.end);
      return null;
    }
    return this.applyPrefix(sigils, operand, start);
  }

  /**
   * The prefix-operator sigils a token would contribute in prefix position, or
   * `null` if it is not a prefix operator. An `OPERATOR` token is a run of
   * `!`/`-`/`+` (e.g. `!!`); a single fancy-Unicode `ERROR` token is translated
   * first (`¬` → `!`, `−` → `-`).
   */
  private prefixSigils(token: Token): string[] | null {
    let text: string;
    if (token.type === 'OPERATOR') text = token.text;
    else if (token.type === 'ERROR') {
      const mapped = this.fancyOperator(token);
      if (mapped === null) return null;
      text = mapped;
    } else return null;

    const sigils = [...text];
    if (sigils.length === 0) return null;
    for (const s of sigils) if (!PREFIX_SIGILS.has(s)) return null;
    return sigils;
  }

  /** Apply a run of prefix sigils to an operand, innermost (rightmost) first. */
  private applyPrefix(
    sigils: string[],
    operand: MathJsonExpression,
    start: number
  ): MathJsonExpression {
    const end = this.localEnd(operand) ?? this.previousEnd();
    let result = operand;
    for (let i = sigils.length - 1; i >= 0; i--) {
      const s = sigils[i];
      if (s === '!') {
        result = this.wrap(['Not', result], start, end);
      } else {
        // `-` and `+`: fold the sign into a bare number literal, otherwise
        // wrap in `Negate` (`+` on a non-literal is the identity).
        const negative = s === '-';
        const folded = foldSignedNumber(result, negative);
        if (folded !== null) result = this.wrap(folded, start, end);
        else if (negative) result = this.wrap(['Negate', result], start, end);
        // `+` on a non-literal is the identity, but the node must still span
        // the sign: without it `+x` reports the span of `x` alone, and `+x = 5`
        // looked like a bare binding target (positional `=` then assigned
        // instead of comparing).
        else result = this.wrap(result, start, end);
      }
    }
    return result;
  }

  /**
   * If an infix operator continues the current expression, describe it.
   * Applies the whitespace rule; returns `null` when the expression should end
   * (no operator, or a whitespace-vetoed `a +b`).
   */
  private peekInfix(): {
    def: OperatorDef;
    tokenCount: number;
    asymmetric: boolean;
  } | null {
    const token = this.current;

    let def: OperatorDef | undefined;
    let tokenCount = 1;

    // `!in` (NotElement) is two tokens: `!` immediately followed by `in`.
    if (
      token.type === 'OPERATOR' &&
      token.text === '!' &&
      this.peek().type === 'SYMBOL' &&
      this.peek().text === 'in' &&
      !this.peek().precededByWhitespace
    ) {
      def = infixOperatorForSymbol('!in');
      tokenCount = 2;
    } else {
      const text = this.operatorText(token);
      if (text !== null) def = infixOperatorForSymbol(text);
    }

    if (!def) return null;

    // Whitespace rule. `leftWS` is the whitespace before the operator; `rightWS`
    // the whitespace before its operand (the token after the operator run).
    const leftWS = token.precededByWhitespace;
    const rightWS = this.peek(tokenCount).precededByWhitespace;
    if (leftWS === rightWS) return { def, tokenCount, asymmetric: false };
    if (leftWS && !rightWS) return null; // `a +b`: expression ends here
    return { def, tokenCount, asymmetric: true }; // `a+ b`
  }

  /**
   * If a postfix operator (`!` Factorial) abuts the current operand, return its
   * definition. A postfix operator must NOT be preceded by whitespace (`x!`,
   * never `x !`); a whitespace-preceded `!` is left for the infix/statement
   * machinery, which is how postfix `!` (Factorial) is kept distinct from prefix
   * `!` (Not). The `!=`/`!in` operators never reach here: the lexer munches
   * `!=` into a single token, and `!in` is handled by `peekInfix` first.
   */
  private peekPostfix(): OperatorDef | null {
    const token = this.current;
    if (token.type !== 'OPERATOR') return null;
    if (token.precededByWhitespace) return null;
    // NOTE: the lexer maximal-munches a run of operator characters into one
    // token, so a `!` directly abutting another operator char is not seen here
    // as a lone `!` (`3!^2` lexes `!^` as one token — write `3! ^ 2`; `x!+1`
    // lexes `!+` — write `x! + 1`). This mirrors the existing operator-adjacency
    // behavior elsewhere in the grammar. The serializer always spaces infix
    // operators, so serialized output round-trips.
    //
    // A `!` that abuts an `in` starts the `!in` (NotElement) compound; leave it
    // for `peekInfix` rather than reading it as a postfix factorial.
    if (
      token.text === '!' &&
      this.peek().type === 'SYMBOL' &&
      this.peek().text === 'in' &&
      !this.peek().precededByWhitespace
    )
      return null;
    return postfixOperatorForSymbol(token.text) ?? null;
  }

  /** The operator spelling a token would contribute in infix position (fancy
   * Unicode translated), or `null` if the token cannot be an operator. */
  private operatorText(token: Token): string | null {
    if (token.type === 'OPERATOR') return token.text;
    if (token.type === 'SYMBOL') return this.fancyOperator(token) ?? token.text;
    if (token.type === 'ERROR') return this.fancyOperator(token);
    return null;
  }

  /** Translate a single fancy-Unicode-codepoint token to its ASCII operator
   * spelling (`×` → `*`, `∈` → `in`), or `null`. */
  private fancyOperator(token: Token): string | null {
    const text = token.text;
    if ([...text].length !== 1) return null;
    return FANCY_UNICODE.get(text.codePointAt(0)!) ?? null;
  }

  private emitAsymmetric(token: Token, symbol: string): void {
    this.diagnostics.push({
      severity: 'warning',
      message: ['asymmetric-operator-whitespace', symbol],
      range: [this.baseOffset + token.start, this.baseOffset + token.end],
      fixits: [
        [
          this.baseOffset + token.start,
          this.baseOffset + token.end,
          ` ${symbol} `,
        ],
      ],
    });
  }

  /** Combine an infix operator with its operands, flattening a run of the same
   * relational operator into an n-ary node (`a < b < c` → `Less(a,b,c)`). */
  /**
   * Pipe-stage sugar on the just-parsed right operand of `|>` (or `~>`).
   *
   * 1/ Stage lambda: a `|->` directly after the operand makes the operand the
   *    lambda's parameter list and the whole mapsto the pipe stage —
   *    `xs |> x |-> x^2 |> Sum` is `xs |> (x |-> x^2) |> Sum`. Globally `|->`
   *    (15) binds LOOSER than `|>` (20), which would otherwise make an
   *    unparenthesized lambda stage unwritable: the mapsto captured the
   *    pipeline itself as its parameter list and failed with
   *    `symbol-expected`. Only in this position is the pair inverted. The
   *    body is parsed at the pipe's right binding power, so the stage ends at
   *    the next `|>` or anything looser — in particular a trailing `?? d`
   *    still applies to the PIPELINE result, exactly as the `Coalesce` row in
   *    `operators.ts` pins for `xs |> f ?? d`. Right-recursion supports a
   *    curried stage (`xs |> x |-> y |-> x + y`).
   *
   * 2/ Implicit lambda: an operand written with ORDINARY OPERATORS that
   *    mentions a shorthand placeholder — `_^2`, `_ + 1`, `-_` — is wrapped
   *    as `["Function", operand]`, the engine's canonical spelling of a
   *    wildcard lambda, so the stage behaves exactly like `x |-> x^2` (in
   *    particular it triggers the implicit `Map` over a collection topic; see
   *    the `Pipe` definition in `library/core.ts`). A function CALL is
   *    deliberately NOT wrapped: there `_` is the pipeline-topic placeholder
   *    (`Take(_, 10)`, `Map(_^2, _)`), bound to the piped value by the
   *    existing shorthand machinery. The call-vs-operator split is a SURFACE
   *    distinction — `Power(_, 2)` and `Take(_, 10)` are structurally alike
   *    in MathJSON — so it is decided here in the parser; the `ce.box()`
   *    route keeps the topic reading for both spellings.
   */
  private pipeStage(
    operand: MathJsonExpression,
    rightMin: number
  ): MathJsonExpression {
    return (
      this.pipeStageLambdaTail(operand, rightMin) ??
      this.wrapImplicitPipeLambda(operand)
    );
  }

  /** Case 1 of `pipeStage`: consume a `|->` (and, recursively, a curried
   * chain of them) following a pipe's right operand. Returns `null` when no
   * `|->` follows — the operand is an ordinary stage. */
  private pipeStageLambdaTail(
    operand: MathJsonExpression,
    rightMin: number
  ): MathJsonExpression | null {
    const op = this.peekInfix();
    if (op === null || op.def.symbol !== '|->') return null;
    if (op.asymmetric) this.emitAsymmetric(this.current, op.def.symbol);
    for (let i = 0; i < op.tokenCount; i++) this.advance();
    // A lambda body is a `break`/`continue` boundary, exactly as in the
    // ordinary mapsto branch of the precedence loop.
    const body = this.inLoopContext(0, () => this.parseExpression(rightMin));
    if (body === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return operand;
    }
    // The mapsto right-associates: in `xs |> x |-> y |-> body` the inner
    // lambda is the outer lambda's body.
    const curried = this.pipeStageLambdaTail(body, rightMin);
    return this.combineInfix(op.def, operand, curried ?? body);
  }

  /** Case 2 of `pipeStage`: wrap an operator-written placeholder expression
   * as a `Function` literal. The operand qualifies when its top-level
   * operator has a row in the shared operator table (it was written with
   * operator syntax, or is indistinguishable from it) and it mentions a
   * shorthand placeholder. */
  private wrapImplicitPipeLambda(
    operand: MathJsonExpression
  ): MathJsonExpression {
    const op = operator(operand);
    if (typeof op !== 'string' || op === '') return operand;
    if (operatorDefByName(op) === undefined) return operand;
    if (!mentionsWildcard(operand)) return operand;
    const start = this.localStart(operand) ?? 0;
    const end = this.localEnd(operand) ?? this.previousEnd();
    return this.wrap(['Function', operand] as MathJsonExpression[], start, end);
  }

  private combineInfix(
    def: OperatorDef,
    left: MathJsonExpression,
    right: MathJsonExpression
  ): MathJsonExpression {
    const start = this.localStart(left) ?? 0;
    const end = this.localEnd(right) ?? this.previousEnd();

    // The mapsto arrow `params |-> body`: `left` is a parameter list (a bare
    // symbol, or a parenthesized/tuple list of symbols), `right` is the body.
    // Rewrite into the engine `Function` shape `["Function", body, …params]`.
    if (def.symbol === '|->')
      return this.wrap(
        ['Function', right, ...this.mapstoParams(left)] as MathJsonExpression[],
        start,
        end
      );

    // `(x: number) -> x^2`, `(x, y) -> x + y`, `= x -> x + 1`: a
    // `KeyValuePair` whose left side is shaped like a parameter list is a
    // function written with the wrong arrow (`->` for `|->`). None of these
    // shapes is a valid dictionary key (keys are strings), so diagnose — with
    // a fixit on the arrow — and RECOVER as the intended function. (The right
    // operand was parsed at `->`'s precedence, which is tighter than `|->`'s,
    // so a `??`/`|>` tail still lands outside the recovered lambda: the
    // fixit, not the recovery, is the real repair.)
    if (def.name === 'KeyValuePair' && this.lambdaMistypedAsPair(left)) {
      this.reportMapstoArrowExpected(left, right);
      return this.wrap(
        ['Function', right, ...this.mapstoParams(left)] as MathJsonExpression[],
        start,
        end
      );
    }

    if (def.name === 'Assign') this.checkAssignTarget(left);

    if (
      def.relational &&
      typeof left === 'object' &&
      left !== null &&
      'fn' in left &&
      Array.isArray((left as { fn: MathJsonExpression[] }).fn) &&
      (left as { fn: MathJsonExpression[] }).fn[0] === def.name
    ) {
      const fn = (left as unknown as { fn: MathJsonExpression[] }).fn;
      return this.wrap([...fn, right] as MathJsonExpression[], start, end);
    }

    return this.wrap(
      [def.name, left, right] as MathJsonExpression[],
      start,
      end
    );
  }

  /**
   * A literal word is not an assignment target: `true = 5` would bind the
   * boolean literal, and `NaN = 1` a numeric one. This is the bare-target
   * position of the five-word rejection set — the other positions reject the
   * word at its token, but here the literal has already become its value node
   * (`true` → `{sym:"True"}`, `oo` → `{num:"+Infinity"}`), so the check reads
   * the target's source slice instead. A verbatim `` `True` `` (or a plain
   * `True`, which is not a reserved word) is unaffected.
   */
  private checkAssignTarget(target: MathJsonExpression): void {
    // The ROOT of the path, not the whole node: the span of `true.x` is
    // `true.x`, which is not a literal word, so checking it whole let a
    // literal-rooted path through.
    target = bindingTargetRoot(target) ?? target;
    const start = this.localStart(target);
    const end = this.localEnd(target);
    if (start === undefined || start === null) return;
    if (end === undefined || end === null) return;
    const text = this.source.slice(start, end);
    if (LITERAL_WORDS.has(text))
      this.error(['reserved-word', text], start, end);
  }

  /**
   * `if flag := true { … }` assigns and then uses the assigned value as the
   * test. Positional `=` closed the IMPLICIT form of this trap — a bare `=` in
   * a condition is now `Equal` — but `:=` is unconditional, so the explicit
   * spelling still reaches here.
   *
   * A WARNING, not an error: `:=` is the deliberate assignment spelling, and
   * refusing it in a position where the author typed it on purpose would
   * repeat the mistake positional `=` was adopted to fix. Epsil has no
   * `if init; cond` form, so the assigned value really is the test — which is
   * what makes it worth remarking on.
   *
   * Scoped to the two positions that consume a value AS a boolean (an
   * `if`/`while` condition, including the `a if c else b` ternary). A call
   * argument or a collection element — `f(a := 1)`, `[a := 1]` — is odd but
   * unambiguous, and the type system already handles it.
   */
  private checkConditionAssign(cond: MathJsonExpression): void {
    if (operator(cond) !== 'Assign') return;
    const start = this.localStart(cond);
    const end = this.localEnd(cond);
    if (start === undefined || start === null) return;
    if (end === undefined || end === null) return;
    this.error(['assign-in-condition'], start, end, 'warning');
  }

  /**
   * Whether a node's source begins with a bare-symbol token — the check that
   * keeps `isBindingTarget` honest about the *authored* syntax rather than the
   * reduced node.
   *
   * A `+` prefix is the identity, so `+x` reduces to the bare symbol `x` and
   * would otherwise look like a name; positional `=` must compare there.
   *
   * A parenthesized group is deliberately NOT caught: it returns its content
   * node, whose span excludes the parentheses, so `(x) = 5` still assigns.
   * That is the intended reading — redundant parentheses around a name do not
   * change what it is. (The case the design note names, `Solve((x = 4), x)`,
   * is already handled: the inner `=` is in expression position and compares.)
   */
  private startsWithSymbolToken(target: MathJsonExpression): boolean {
    const start = this.localStart(target);
    if (start === undefined || start === null) return false;
    const tok = this.firstTokenAtOrAfter(start);
    if (tok === undefined) return false;
    return tok.type === 'SYMBOL' || tok.type === 'VERBATIM_SYMBOL';
  }

  /**
   * The first token whose `start` is at or after `offset` (a local offset),
   * or `undefined` when every token begins before it.
   *
   * Binary search: `this.tokens` is the lexer's output in source order, so
   * `start` is non-decreasing along the array. This is called once per bare
   * `=` statement (see {@link startsWithSymbolToken}); a linear scan from the
   * first token made parsing a program of N assignments O(N²) — the scan
   * dominated the parse of a few-thousand-line program (measured 2026-08-15:
   * 69% of parse time on a 16 000-statement program).
   */
  private firstTokenAtOrAfter(offset: number): Token | undefined {
    const tokens = this.tokens;
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tokens[mid].start < offset) lo = mid + 1;
      else hi = mid;
    }
    return tokens[lo];
  }

  /**
   * Whether a node was spelled as a literal word. `true`/`false` become SYMBOL
   * nodes (`{sym:"True"}`), so `isBindingTarget` would otherwise accept them
   * and a bare `true = 5` would resolve to an assignment — while `NaN = 1`,
   * whose literal becomes a NUMBER node, resolved to a comparison. Excluding
   * them makes all five literal words behave alike: a bare `=` against one is
   * the equation, and only the explicit `:=` asks to bind (and is rejected by
   * {@link checkAssignTarget}).
   */
  private isLiteralWordNode(target: MathJsonExpression): boolean {
    target = bindingTargetRoot(target) ?? target;
    const start = this.localStart(target);
    const end = this.localEnd(target);
    if (start === undefined || start === null) return false;
    if (end === undefined || end === null) return false;
    return LITERAL_WORDS.has(this.source.slice(start, end));
  }

  /** Extract the parameters from a mapsto LHS: a bare symbol (one parameter),
   * or a `Tuple` of parameters (`(x, y) |-> …`). Each parameter is either a
   * bare symbol or a typed `["Typed", sym, type]` node (`(x: integer) |-> …`).
   * A parenthesized single parameter arrives here already unwrapped. A
   * non-parameter LHS element is a diagnostic and is dropped. */
  private mapstoParams(left: MathJsonExpression): MathJsonExpression[] {
    const emit = (bad: MathJsonExpression) => {
      const o = nodeOffsets(bad);
      this.error(
        ['symbol-expected'],
        o ? o[0] - this.baseOffset : 0,
        o ? o[1] - this.baseOffset : 0
      );
    };

    // A parameter is a bare symbol or a `["Typed", sym, type]` node.
    const isParam = (p: MathJsonExpression): boolean => {
      if (symbolNameOf(p) !== null) return true;
      const pops = fnOps(p);
      return pops !== null && pops[0] === 'Typed';
    };

    const ops = fnOps(left);
    if (ops !== null && ops[0] === 'Tuple') {
      const params: MathJsonExpression[] = [];
      for (const p of ops.slice(1)) {
        if (isParam(p)) params.push(p);
        else emit(p);
      }
      return params;
    }

    if (isParam(left)) return [left];

    emit(left);
    return [];
  }

  /** Is a `KeyValuePair`'s left operand shaped like a parameter list — a
   * `Typed` parameter (`(x: number) -> …`), a tuple of parameters
   * (`(x, y) -> …`), or a bare symbol right after a `(` or `=`
   * (`(x) -> …`, `f = x -> …`)? None of these is a valid dictionary key, so
   * the `->` was almost certainly meant to be `|->`. A bare symbol in any
   * other position (`{one -> 1}`, a list element) is left alone: inside a
   * brace literal an unquoted name is a legitimate string key. */
  private lambdaMistypedAsPair(left: MathJsonExpression): boolean {
    const isTypedParam = (p: MathJsonExpression): boolean => {
      const pops = fnOps(p);
      return (
        pops !== null &&
        pops[0] === 'Typed' &&
        pops[1] !== undefined &&
        symbolNameOf(pops[1]) !== null
      );
    };
    const ops = fnOps(left);
    if (ops !== null && ops[0] === 'Typed') return isTypedParam(left);
    // An empty Tuple only ever comes from a `()` parameter list, so it
    // qualifies vacuously (`() -> 42`).
    if (ops !== null && ops[0] === 'Tuple')
      return ops
        .slice(1)
        .every((p) => symbolNameOf(p) !== null || isTypedParam(p));
    if (symbolNameOf(left) !== null) {
      const start = this.localStart(left);
      if (start === undefined) return false;
      let i = start - 1;
      while (i >= 0 && /\s/.test(this.source[i])) i -= 1;
      return i >= 0 && (this.source[i] === '(' || this.source[i] === '=');
    }
    return false;
  }

  /** Report a `->` that was meant to be `|->`, with a fixit replacing the
   * arrow (found in the source gap between the two operands — the operator
   * token has already been consumed by the infix loop). */
  private reportMapstoArrowExpected(
    left: MathJsonExpression,
    right: MathJsonExpression
  ): void {
    const gapStart = this.localEnd(left);
    const gapEnd = this.localStart(right);
    let span: [number, number] | null = null;
    if (gapStart !== undefined && gapEnd !== undefined) {
      const gap = this.source.slice(gapStart, gapEnd);
      for (const arrow of ['->', '→']) {
        const at = gap.indexOf(arrow);
        if (at >= 0) {
          span = [gapStart + at, gapStart + at + arrow.length];
          break;
        }
      }
    }
    const fallback: [number, number] = [
      this.localStart(left) ?? 0,
      this.localEnd(right) ?? this.previousEnd(),
    ];
    const diagnostic: ParsingDiagnostic = {
      severity: 'error',
      message: ['mapsto-arrow-expected'],
      range: [
        this.baseOffset + (span?.[0] ?? fallback[0]),
        this.baseOffset + (span?.[1] ?? fallback[1]),
      ],
    };
    if (span !== null)
      diagnostic.fixits = [
        [this.baseOffset + span[0], this.baseOffset + span[1], '|->'],
      ];
    this.diagnostics.push(diagnostic);
  }

  /** End offset (local) of the most recently consumed token. */
  private previousEnd(): number {
    const t = this.tokens[Math.max(0, this.pos - 1)];
    return t ? t.end : 0;
  }

  /** Local start offset of a node (undoing `baseOffset`), if it has one. */
  private localStart(expr: MathJsonExpression): number | undefined {
    const o = nodeOffsets(expr);
    return o ? o[0] - this.baseOffset : undefined;
  }

  /** Local end offset of a node (undoing `baseOffset`), if it has one. */
  private localEnd(expr: MathJsonExpression): number | undefined {
    const o = nodeOffsets(expr);
    return o ? o[1] - this.baseOffset : undefined;
  }

  //
  // ─── Postfix: calls and indexing ──────────────────────────────────────────
  //

  /**
   * A primary followed by zero or more call/index clauses (the tightest-binding
   * layer). A clause abuts its operand: `f(x)`, `xs[i]`, never `f (x)`.
   */
  private parsePostfix(): MathJsonExpression | null {
    let expr = this.parsePrimary();
    if (expr === null) return null;

    for (;;) {
      const t = this.current;
      if (t.precededByWhitespace) break;
      if (t.type === 'OPEN_PAREN') {
        // A number callee is never a call: `2(x+1)` is invisible multiplication.
        if (isNumberNode(expr)) break;
        expr = this.parseCall(expr);
      } else if (t.type === 'OPEN_BRACKET') {
        expr = this.parseIndex(expr);
      } else if (
        t.type === 'OPERATOR' &&
        t.text === '.' &&
        !isNumberNode(expr)
      ) {
        // A field clause `.name` — the dot must abut the base, exactly like
        // the call and index clauses (`p .x` ends the expression). A number
        // base never takes a field: the lexer folds a first trailing dot into
        // the numeric literal (`2.x` is `2. * x`), and a second dot
        // (`1.2.3`) keeps its historical unexpected-symbol diagnostic.
        expr = this.parseField(expr);
      } else break;
    }
    return expr;
  }

  /** A call clause `( args )` applied to `callee`. A bare-symbol callee becomes
   * the operator head (`f(x)` → `["f", x]`); any other callee is wrapped in
   * `Apply` (`(g)(x)` → `["Apply", g, x]`). */
  private parseCall(callee: MathJsonExpression): MathJsonExpression {
    const start = this.localStart(callee) ?? this.current.start;
    // The explicit `Function(body, …params)` literal is a function boundary
    // for `break`/`continue`, exactly as `|->` is. Without this, a call
    // argument is parsed in the ENCLOSING loop context, so
    // `for x in xs { let f = Function(break) }` would be accepted and the
    // lambda could later emit `Break()` into an unrelated running loop — the
    // non-local control flow the boundary exists to prevent. Every other head
    // keeps the surrounding context: a `do` block or a `match` inside a loop
    // body is still inside that loop.
    const isFunctionLiteral = symbolNameOf(callee) === 'Function';
    // Spread arguments (`f(...t)`) and named arguments (`f(rate: 0.05)`) are
    // admitted in call argument lists only.
    const { values, end } = isFunctionLiteral
      ? this.inLoopContext(0, () =>
          this.parseBracketedList('CLOSE_PAREN', ')', false, true, true)
        )
      : this.parseBracketedList('CLOSE_PAREN', ')', false, true, true);
    const head = symbolNameOf(callee);
    if (head !== null)
      return this.wrap([head, ...values] as MathJsonExpression[], start, end);
    return this.wrap(
      ['Apply', callee, ...values] as MathJsonExpression[],
      start,
      end
    );
  }

  /** A field clause `.name` applied to `base` → `["Field", base, "name"]`.
   * The field name is a symbol (or verbatim symbol); whitespace after the
   * dot is tolerated (`p. x`), the dot itself must abut the base. Chains
   * left-associate: `a.b.c` → `Field(Field(a, "b"), "c")`. Positional access
   * (`t.1`) is NOT claimed — fields are names; positions are `t[1]`.
   *
   * A PARENTHESIZED qualified name — `p.(Nameable.name)` — names a protocol
   * property explicitly, and lowers to `["ProtocolProperty", "Nameable",
   * "name", base]`. This is the field-grammar amendment the protocols design
   * makes to D16 of the nominal-types design (ruling P6): exactly
   * SYMBOL `.` SYMBOL inside the parentheses, nothing else. */
  private parseField(base: MathJsonExpression): MathJsonExpression {
    const start = this.localStart(base) ?? this.current.start;
    this.advance(); // '.'
    if (this.current.type === 'OPEN_PAREN')
      return this.parseQualifiedField(base, start);
    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], nameTok.start, nameTok.end);
      return base;
    }
    this.advance();
    const name =
      nameTok.type === 'VERBATIM_SYMBOL' ? (nameTok.value ?? '') : nameTok.text;
    return this.wrap(
      ['Field', base, { str: name }] as MathJsonExpression[],
      start,
      nameTok.end
    );
  }

  /** The parenthesized qualified field name `( Protocol . name )`, positioned
   * just after the `(` (P6). Anything that is not exactly SYMBOL `.` SYMBOL
   * `)` takes the same `symbol-expected` recovery an ordinary bad field name
   * does. */
  private parseQualifiedField(
    base: MathJsonExpression,
    start: number
  ): MathJsonExpression {
    /** A SYMBOL / VERBATIM_SYMBOL at the cursor, consumed; `null` otherwise
     * (with the diagnostic already emitted). */
    const symbolName = (): string | null => {
      const tok = this.current;
      if (tok.type !== 'SYMBOL' && tok.type !== 'VERBATIM_SYMBOL') {
        this.error(['symbol-expected'], tok.start, tok.end);
        return null;
      }
      this.advance();
      return tok.type === 'VERBATIM_SYMBOL' ? (tok.value ?? '') : tok.text;
    };

    this.advance(); // '('
    const protocol = symbolName();
    if (protocol === null) return base;
    const dot = this.current;
    if (dot.type !== 'OPERATOR' || dot.text !== '.') {
      this.error(['symbol-expected'], dot.start, dot.end);
      return base;
    }
    this.advance(); // '.'
    const name = symbolName();
    if (name === null) return base;
    const close = this.current;
    if (close.type !== 'CLOSE_PAREN') {
      this.error(['symbol-expected'], close.start, close.end);
      return base;
    }
    const end = close.end;
    this.advance(); // ')'
    return this.wrap(
      [
        'ProtocolProperty',
        { str: protocol },
        { str: name },
        base,
      ] as MathJsonExpression[],
      start,
      end
    );
  }

  /** An index clause `[ i ]` applied to `base` → `["At", base, i]` (1-based). */
  private parseIndex(base: MathJsonExpression): MathJsonExpression {
    const start = this.localStart(base) ?? this.current.start;
    const { values, end } = this.parseBracketedList('CLOSE_BRACKET', ']');
    // A literal index 0 is the zero-based-indexing reflex; `At` is 1-based
    // and `xs[0]` evaluates to NaN. Advisory only — the parse is unchanged.
    for (const v of values)
      if (isNumberNode(v) && (v as { num: string }).num === '0')
        this.error(
          'zero-index',
          this.localStart(v) ?? start,
          this.localEnd(v) ?? end,
          'warning'
        );
    return this.wrap(
      ['At', base, ...values] as MathJsonExpression[],
      start,
      end
    );
  }

  /** Whether `left` can be the left operand of an invisible multiplication: a
   * bare number literal immediately followed (no whitespace) by a token that
   * begins a primary. */
  private startsInvisibleMultiply(left: MathJsonExpression): boolean {
    if (!isNumberNode(left)) return false;
    const t = this.current;
    if (t.precededByWhitespace) return false;
    return this.startsPrimary(t);
  }

  /** Whether a token can begin a primary expression (number, symbol, string,
   * `(`, `{`, `[`, pragma). Operator/word-operator tokens are handled by
   * `peekInfix` before this is consulted. */
  private startsPrimary(token: Token): boolean {
    switch (token.type) {
      case 'NUMBER':
      case 'SYMBOL':
      case 'VERBATIM_SYMBOL':
      case 'STRING':
      case 'PRAGMA':
      case 'OPEN_PAREN':
      case 'OPEN_BRACKET':
      case 'OPEN_BRACE':
        return true;
      default:
        return false;
    }
  }

  //
  // ─── Primary ──────────────────────────────────────────────────────────────
  //

  private parsePrimary(): MathJsonExpression | null {
    const token = this.current;

    switch (token.type) {
      case 'PRAGMA':
        return this.parsePragma();
      case 'NUMBER':
        return this.parseNumber();
      case 'STRING':
        return this.parseString();
      case 'SYMBOL':
        // `if … { … } else { … }` is an expression (it yields a value), so it
        // is a primary — usable as an assignment RHS, argument, or operand,
        // not only as a top-level statement. (`while`/`for` stay statement-only:
        // they evaluate for effect to `Nothing`.)
        if (token.text === 'if') return this.parseIf();
        // `match subject { … }` is an expression (it yields a value, like the
        // conditional-value heads `Which`/`When`), so it is a primary usable as
        // an assignment RHS, argument, or operand — not only a statement.
        if (token.text === 'match') return this.parseMatch();
        // `do { … }` is a block expression: a statement block whose value is
        // its final statement, usable in any expression position. It lowers to
        // the same `["Block", …]` an `if`/`function` body produces, so block
        // scoping and the final-statement value come from the engine unchanged.
        if (token.text === 'do') return this.parseDoBlock();
        // `break`/`continue` are statements, but Epsil's statement-bearing
        // forms are expressions: a `match` case body and a conditional branch
        // are expressions, not blocks. Admitting them here is what makes
        // `match x { 1 => break }` work inside a loop — and, outside one,
        // turns a confusing `reserved-word` into the precise
        // `control-outside-loop`.
        if (token.text === 'break' || token.text === 'continue')
          return this.parseLoopControl();
        return this.parseSymbol();
      case 'VERBATIM_SYMBOL':
        return this.parseVerbatimSymbol();
      case 'OPEN_PAREN':
        return this.parseParenthesized();
      case 'OPEN_BRACKET':
        return this.parseList();
      case 'OPEN_BRACE':
        return this.parseBrace();
      case 'LATEX_ISLAND':
        return this.parseLatexIsland();
      default:
        // Prefix operators are handled by `parseUnary`; anything else in
        // primary position (an infix operator, a stray bracket, …) is not a
        // primary.
        return null;
    }
  }

  //
  // ─── Numbers ──────────────────────────────────────────────────────────────
  //

  private parseNumber(): MathJsonExpression {
    const token = this.advance();
    this.harvest(token);
    return this.wrap(
      { num: numberPayload(token.text, false) },
      token.start,
      token.end
    );
  }

  //
  // ─── Symbols ──────────────────────────────────────────────────────────────
  //

  private parseSymbol(): MathJsonExpression {
    const token = this.advance();
    this.harvest(token);

    // `NaN` and `Infinity` are numeric constants, not plain symbols. `oo`
    // is an input alias for `Infinity` (the type grammar's spelling; the
    // serializer emits the canonical `Infinity`).
    if (token.text === 'NaN')
      return this.wrap({ num: 'NaN' }, token.start, token.end);
    if (token.text === 'Infinity' || token.text === 'oo')
      return this.wrap({ num: '+Infinity' }, token.start, token.end);

    // `true`/`false` are reserved-word input aliases for the boolean constants
    // `True`/`False` (the serializer emits the capitalized spelling). Handled
    // here, before the reserved-word rejection below, so they parse in
    // expression position; a `let true = …` binding is still rejected in
    // `parseDeclaration`.
    if (token.text === 'true')
      return this.wrap({ sym: 'True' }, token.start, token.end);
    if (token.text === 'false')
      return this.wrap({ sym: 'False' }, token.start, token.end);

    // A HARD-reserved word — a literal, or a head/word operator the grammar
    // claims — is rejected in expression position: `y = while` is a keyword out
    // of place, not a symbol reference. The verbatim `` `word` `` form (handled
    // by `parseVerbatimSymbol`) still works. Word operators such as `in` reach
    // here only out of position; in place they are consumed by the Pratt loop
    // before a primary is attempted.
    //
    // Merely *reserved* words (`set`, `with`, `label`, …) are ordinary symbols:
    // their constructs do not exist, so nothing claims them. See
    // `reserved-words.ts` for the two tiers.
    if (HARD_RESERVED_WORDS.has(token.text))
      this.error(['reserved-word', token.text], token.start, token.end);

    return this.wrap({ sym: token.text }, token.start, token.end);
  }

  private parseVerbatimSymbol(): MathJsonExpression {
    const token = this.advance();
    this.harvest(token);
    return this.wrap({ sym: token.value ?? '' }, token.start, token.end);
  }

  //
  // ─── LaTeX islands ────────────────────────────────────────────────────────
  //
  // A `$…$` island is a primary. Its inner LaTeX is parsed by an **injected**
  // parser (`parseLatex`, a structural mirror of the engine's `ILatexSyntax`
  // injection — `src/epsil` never statically imports `latex-syntax`). The
  // returned MathJSON is spliced in raw (Epsil owns canonicalization) with its
  // `sourceOffsets` set to the island's Epsil-source range. Without an injected
  // parser, an island is a `latex-parsing-unavailable` diagnostic. An
  // unterminated island already carries a lexer diagnostic, surfaced here.
  //

  private parseLatexIsland(): MathJsonExpression {
    const token = this.advance();
    this.harvest(token); // surface an unterminated-island lexer diagnostic
    const span = token.island!;
    const latex = this.source.slice(span.start, span.end);

    if (!this.parseLatex) {
      this.error(['latex-parsing-unavailable'], token.start, token.end);
      // "Errors are values": splice an Error node so parsing continues cleanly.
      return this.wrap(
        ['Error', { str: 'latex-parsing-unavailable' }] as MathJsonExpression[],
        token.start,
        token.end
      );
    }

    // Splice the imported MathJSON as a primary, tagging it with the island's
    // Epsil-source range. Diagnostics *inside* the LaTeX (engine `["Error", …]`
    // nodes) stay embedded in the returned expression (v0 does not translate
    // them into `ParsingDiagnostic`s).
    const value = this.parseLatex(latex);
    return this.wrap(value, token.start, token.end);
  }

  //
  // ─── Strings ──────────────────────────────────────────────────────────────
  //

  private parseString(): MathJsonExpression {
    const token = this.advance();
    this.harvest(token);

    const parts = token.parts ?? [''];

    // Extended strings (`#"…"#`) contain no escape sequences and no
    // interpolation: emit the raw cooked text verbatim (no `escapeJsonString`,
    // so embedded `"` and `\` are preserved), matching the old
    // `parseExtendedString` path.
    if (token.text[0] === '#') {
      const raw = parts.map((p) => (typeof p === 'string' ? p : '')).join('');
      return this.wrap({ str: raw }, token.start, token.end);
    }

    // Fold cooked segments and parsed interpolations into a `values` array of
    // strings and expressions (mirrors the old `string` rule).
    const values: (string | MathJsonExpression)[] = [];
    let previous: string | undefined;

    for (const part of parts) {
      if (typeof part === 'string') {
        previous = (previous ?? '') + part;
        continue;
      }
      const expr = this.parseInterpolation(part);
      if (expr === null) continue; // an empty interpolation `\()`
      if (isStringObject(expr)) {
        previous = (previous ?? '') + expr.str;
      } else {
        if (previous !== undefined) {
          values.push(previous);
          previous = undefined;
        }
        values.push(expr);
      }
    }
    if (previous !== undefined) values.push(previous);

    if (values.length === 1 && typeof values[0] === 'string')
      return this.wrap({ str: values[0] }, token.start, token.end);

    const parts2: MathJsonExpression[] = values.map((x) =>
      typeof x === 'string' ? { str: x } : x
    );
    return this.wrap(
      ['String', ...parts2] as MathJsonExpression[],
      token.start,
      token.end
    );
  }

  /** Recursively parse a `\(…)` interpolation span (offset-shifted so its
   * diagnostics and `sourceOffsets` are absolute). Returns `null` for an empty
   * interpolation. */
  private parseInterpolation(span: SourceSpan): MathJsonExpression | null {
    const sub = new Parser(this.source.slice(span.start, span.end), {
      url: this.url,
      offset: this.baseOffset + span.start,
      parseLatex: this.parseLatex,
      allowHostPragmas: this.allowHostPragmas,
    });
    const value = sub.parseProgram();
    for (const d of sub.diagnostics) this.diagnostics.push(d);
    return value;
  }

  //
  // ─── Parenthesized expression ─────────────────────────────────────────────
  //

  /**
   * A parenthesized construct: `(a)` → the inner expression `a`; `(a, b)` →
   * `["Tuple", a, b]`; `()` → diagnostic (no empty tuple in v0).
   */
  private parseParenthesized(): MathJsonExpression | null {
    // Parentheses are the EXPLICIT comparison spelling: `a = (b = 5)` says
    // "assign a the value of b == 5" on purpose, so it must not be reported as
    // an accidental chained assignment. Restoring the bare-`=` marker to what
    // it was BEFORE the group — so nothing created inside it can be matched by
    // identity afterwards — is what distinguishes it from bare `a = b = 5`.
    const outerBareEqual = this.lastBareEqualNode;
    try {
      return this.parseParenthesizedBody();
    } finally {
      this.lastBareEqualNode = outerBareEqual;
    }
  }

  private parseParenthesizedBody(): MathJsonExpression | null {
    const diagBefore = this.diagnostics.length;
    // Allow `bare-symbol : Type` elements so a typed mapsto parameter list
    // `(x: integer) |-> …` parses (a `:` has no infix parselet, so it would
    // otherwise die with `closing-bracket-expected`).
    const { values, open, end, typed } = this.parseBracketedList(
      'CLOSE_PAREN',
      ')',
      true
    );

    if (values.length === 0) {
      // An empty `()` immediately before a mapsto arrow is a zero-parameter
      // lambda parameter list: `() |-> expr` → `["Function", body]`. Emit an
      // empty `Tuple` so `mapstoParams` yields no parameters. Anywhere else,
      // an empty parenthesis is a diagnostic (no empty tuple in v0). A `->`
      // here is the wrong-arrow spelling of the same lambda — let it through
      // so `combineInfix` diagnoses (`mapsto-arrow-expected`) and recovers.
      if (
        this.check('OPERATOR') &&
        (this.current.text === '|->' || this.current.text === '->')
      )
        return this.wrap(['Tuple'] as MathJsonExpression[], open.start, end);
      if (this.diagnostics.length === diagBefore)
        this.error(['expression-expected'], open.start, end);
      return null;
    }
    // A type annotation is only meaningful in a mapsto parameter list. If the
    // annotated group is not the LHS of a `|->`, it is a type annotation in an
    // invalid position. A following `->` is exempt: that is the wrong-arrow
    // spelling of a lambda, and `combineInfix` reports the ONE real problem
    // (`mapsto-arrow-expected`) instead of a spurious `:` complaint.
    if (
      typed &&
      !(
        this.check('OPERATOR') &&
        (this.current.text === '|->' || this.current.text === '->')
      )
    ) {
      const o = nodeOffsets(values[values.length - 1]);
      this.error(
        ['unexpected-symbol', ':'],
        o ? o[0] - this.baseOffset : open.start,
        o ? o[1] - this.baseOffset : end
      );
    }
    // A single value is a parenthesized expression, not a 1-tuple.
    if (values.length === 1) return values[0];
    return this.wrap(
      ['Tuple', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  //
  // ─── Collections and dictionaries ─────────────────────────────────────────
  //

  /** `[a, b]` → `["List", a, b]`; `[]` → `["List"]`. A `...expr` element is
   * a spread (`["Spread", expr]`), spliced by `List`'s canonicalization:
   * `[...xs, c]` is `Join`/`ListFrom` sugar (`library/collections.ts`). */
  private parseList(): MathJsonExpression {
    const { values, open, end } = this.parseBracketedList(
      'CLOSE_BRACKET',
      ']',
      false,
      /* allowSpread */ true
    );
    return this.wrap(
      ['List', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /**
   * A brace construct: `{}` → `["Set"]`; `{->}` → empty `Dictionary`; a first
   * element with a top-level `->` → `Dictionary` (all elements must then be
   * `key -> value`); otherwise a `Set`.
   */
  private parseBrace(): MathJsonExpression {
    // `{}` → empty Set.
    if (this.peek().type === 'CLOSE_BRACE') {
      const open = this.advance(); // `{`
      const close = this.advance(); // `}`
      return this.wrap(['Set'], open.start, close.end);
    }
    // `{->}` → empty Dictionary.
    if (
      this.peek().type === 'OPERATOR' &&
      this.peek().text === '->' &&
      this.peek(2).type === 'CLOSE_BRACE'
    ) {
      const open = this.advance(); // `{`
      this.advance(); // `->`
      const close = this.advance(); // `}`
      return this.wrap(['Dictionary'], open.start, close.end);
    }

    const { values, open, end, dictMarker } = this.parseBracketedList(
      'CLOSE_BRACE',
      '}',
      false,
      /* allowSpread */ true,
      false,
      /* allowDictionaryMarker */ true
    );

    // Disambiguate Set vs Dictionary: ANY element with a top-level `->` (a
    // `KeyValuePair`), or the bare `->` marker, makes it a dictionary
    // (ruled 2026-08-14 — a `...spread` element carries no `->`, so a pure
    // merge is spelled `{->, ...d1, ...d2}` while `{...a, ...b}` is a
    // set-spread).
    if (dictMarker || values.some((v) => operator(v) === 'KeyValuePair'))
      return this.buildDictionary(values, open.start, end);

    return this.wrap(
      ['Set', ...values] as MathJsonExpression[],
      open.start,
      end
    );
  }

  /** Assemble a `Dictionary` from parsed brace elements. Every element must be
   * a `key -> value` pair; unquoted symbol keys become strings; duplicate keys
   * are diagnosed. */
  private buildDictionary(
    elements: MathJsonExpression[],
    start: number,
    end: number
  ): MathJsonExpression {
    const entries: MathJsonExpression[] = [];
    const seenKeys = new Set<string>();

    for (const el of elements) {
      // A `...d` merge entry passes through verbatim: the `Dictionary`
      // canonical handler owns the merge lowering (last-wins on key
      // collisions — see `library/collections.ts`). The parser's
      // duplicate-key diagnostic below deliberately covers LITERAL keys
      // only — and only literals NOT separated by a spread: a literal key
      // reappearing after a `...d` is the documented override idiom
      // (`{"a" -> 1, ...d, "a" -> 2}`), not a typo, so the seen-set resets
      // here.
      if (operator(el) === 'Spread') {
        entries.push(el);
        seenKeys.clear();
        continue;
      }
      if (operator(el) !== 'KeyValuePair') {
        const o = nodeOffsets(el);
        this.error(
          ['dictionary-key-value-expected'],
          o ? o[0] - this.baseOffset : start,
          o ? o[1] - this.baseOffset : end
        );
        continue;
      }
      const key = keyToString(operand(el, 1));
      const value = operand(el, 2) ?? 'Nothing';
      const keyName = stringValue(key);
      if (keyName !== null) {
        if (seenKeys.has(keyName)) {
          const o = nodeOffsets(el);
          this.error(
            ['duplicate-dictionary-key', keyName],
            o ? o[0] - this.baseOffset : start,
            o ? o[1] - this.baseOffset : end
          );
          continue;
        }
        seenKeys.add(keyName);
      }
      const o = nodeOffsets(el);
      entries.push(
        this.wrap(
          ['KeyValuePair', key, value] as MathJsonExpression[],
          o ? o[0] - this.baseOffset : start,
          o ? o[1] - this.baseOffset : end
        )
      );
    }

    return this.wrap(
      ['Dictionary', ...entries] as MathJsonExpression[],
      start,
      end
    );
  }

  /** Consume the `:` that introduces a named argument's value. `:` is not in
   * Epsil's operator table, so the lexer's maximal munch glues it to any
   * following operator characters (the `:-` of `f(a:-1)` is ONE token). When
   * that happened, rewrite the current token in place to drop the leading `:`,
   * leaving the remainder (`-`) to start the value expression. The rewritten
   * token's `start` advances by one so diagnostics still point at the right
   * character. Mirrors `consumeAlternativeSeparator()`, which splits a munched
   * `|` the same way. */
  private consumeNamedArgumentColon(): void {
    const t = this.current;
    if (t.text === ':') {
      this.advance();
      return;
    }
    this.tokens[this.pos] = {
      ...t,
      text: t.text.slice(1),
      start: t.start + 1,
      precededByWhitespace: false,
      precededByLinebreak: false,
    };
  }

  /**
   * Parse a comma-separated list of expressions delimited by the current
   * opening bracket and `closeType`. Trailing commas are allowed. On a missing
   * or mismatched closer, a `closing-bracket-expected` diagnostic is emitted
   * and (for a mismatched closer) the stray bracket is consumed for recovery.
   *
   * `allowNamedArgs` admits the named-argument production `name: value`, and
   * is passed only by `parseCall` — a `name: value` element means a type guard
   * in pattern position and a lambda parameter annotation in a mapsto list, so
   * the production is claimed in call argument lists and nowhere else.
   */
  private parseBracketedList(
    closeType: TokenType,
    closeText: string,
    allowTypedParams = false,
    allowSpread = false,
    allowNamedArgs = false,
    allowDictionaryMarker = false
  ): {
    values: MathJsonExpression[];
    open: Token;
    end: number;
    typed: boolean;
    dictMarker: boolean;
  } {
    const open = this.advance(); // the opening bracket
    this.brackets.push(open);

    const values: MathJsonExpression[] = [];
    let typed = false;
    let dictMarker = false;
    if (!this.check(closeType)) {
      for (;;) {
        // A bare `->` element — the DICTIONARY MARKER (brace literals
        // only). It contributes no entry; it forces the dictionary reading
        // of a brace whose other elements are all spreads
        // (`{->, ...d1, ...d2}` is a dictionary merge — cf. the empty
        // dictionary `{->}`, which never reaches this list). Recognized
        // only as the FIRST element and only once — a later or repeated
        // bare `->` (`{"x" -> 1, ->}`) is a likely typo and follows the
        // ordinary element-parse error path.
        if (
          allowDictionaryMarker &&
          values.length === 0 &&
          !dictMarker &&
          this.check('OPERATOR') &&
          this.current.text === '->' &&
          (this.peek().type === 'COMMA' || this.peek().type === closeType)
        ) {
          this.advance(); // `->`
          dictMarker = true;
          if (!this.match('COMMA')) break;
          if (this.check(closeType)) break; // trailing comma
          continue;
        }
        // `...expr` — a spread element. In a CALL argument list the elements
        // of the tuple `expr` splice into the call's arguments (arguments are
        // tuple-shaped; a list does not spread there). In a LIST literal any
        // collection spreads (`List`'s canonicalization splices it).
        if (
          allowSpread &&
          this.check('OPERATOR') &&
          this.current.text === '...'
        ) {
          const dots = this.advance();
          const arg = this.parseExpression(0);
          if (arg === null) {
            this.reportUnexpected(this.current);
            this.recoverInBracket();
            break;
          }
          values.push(
            this.wrap(
              ['Spread', arg] as MathJsonExpression[],
              dots.start,
              this.localEnd(arg) ?? this.previousEnd()
            )
          );
          if (!this.match('COMMA')) break;
          if (this.check(closeType)) break; // trailing comma
          continue;
        }
        // `name: value` — a named argument (call argument lists only), carried
        // to canonicalization as `["NamedArgument", {str: name}, value]`.
        // The name is a bare (or verbatim) symbol. `:` is not in Epsil's
        // operator table, so the lexer's maximal munch glues it to a following
        // operator character: the `:-` of `f(a:-1)` is one token. An OPERATOR
        // token merely STARTING with `:` therefore also opens a named
        // argument, and `consumeNamedArgumentColon()` splits the leading `:`
        // off it so the remainder (`-`) starts the value expression — valid
        // syntax must not depend on the space in `f(a: -1)`. A token starting
        // with `:=` is excluded so `f(a := 1)` keeps its assignment reading.
        if (
          allowNamedArgs &&
          (this.check('SYMBOL') || this.check('VERBATIM_SYMBOL')) &&
          this.peek(1).type === 'OPERATOR' &&
          this.peek(1).text.startsWith(':') &&
          !this.peek(1).text.startsWith(':=')
        ) {
          const nameTok = this.advance();
          this.consumeNamedArgumentColon();
          const name =
            nameTok.type === 'VERBATIM_SYMBOL'
              ? (nameTok.value ?? '')
              : nameTok.text;
          const value = this.parseExpression(0);
          if (value === null) {
            this.reportUnexpected(this.current);
            this.recoverInBracket();
            break;
          }
          values.push(
            this.wrap(
              [
                'NamedArgument',
                this.wrap({ str: name }, nameTok.start, nameTok.end),
                value,
              ] as MathJsonExpression[],
              nameTok.start,
              this.localEnd(value) ?? this.previousEnd()
            )
          );
          if (!this.match('COMMA')) break;
          if (this.check(closeType)) break; // trailing comma
          continue;
        }
        const expr = this.parseExpression(0);
        if (expr === null) {
          this.reportUnexpected(this.current);
          this.recoverInBracket();
          break;
        }
        // A `bare-symbol : Type` element is a typed lambda parameter
        // `["Typed", sym, {str: type}]` (only valid in a `( … ) |->` mapsto
        // parameter list; the caller checks the `|->` follows).
        // Comma-delimited, so `allowWhere` stays false (the default); an
        // anonymous literal's polytype is spelled on the DECLARATION
        // (`let f: (T) -> T where T = x |-> x`), which does admit a clause.
        let element = expr;
        if (
          allowTypedParams &&
          symbolNameOf(expr) !== null &&
          this.check('OPERATOR') &&
          this.current.text === ':'
        ) {
          const start = this.localStart(expr) ?? this.current.start;
          const annotation = this.parseTypeAnnotation();
          if (annotation !== null) {
            element = this.wrap(
              ['Typed', expr, annotation.node] as MathJsonExpression[],
              start,
              annotation.end
            );
            typed = true;
          } else {
            // Diagnosed; the cursor is still at the malformed type. Resync to
            // the next `,` or the closer so the rest of the list parses; the
            // element survives as the bare symbol.
            this.recoverInBracket(true);
          }
        }
        values.push(element);
        if (!this.match('COMMA')) break;
        if (this.check(closeType)) break; // trailing comma
      }
    }

    this.brackets.pop();

    let end: number;
    if (this.check(closeType)) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', closeText], open.start, open.end);
      end = this.current.start;
      // A mismatched closer (`{ … )`) is consumed so it does not cascade.
      if (isCloseToken(this.current.type)) this.advance();
    }

    return { values, open, end, typed, dictMarker };
  }

  /** Within a bracketed construct, skip to (but do not consume) the matching
   * closer, tracking nesting. With `stopAtElementBoundary`, a `,` or a `=>`
   * arrow at the outer nesting level also stops the skip: that is the resync
   * unit for ONE malformed element of a comma-separated list (a parameter
   * annotation, a match pattern), leaving the rest of the list to parse. */
  private recoverInBracket(stopAtElementBoundary = false): void {
    let depth = 0;
    // Both `stopAtElementBoundary` callers resync from a malformed TYPE
    // annotation, where `<`/`>` are the generic-application brackets, never
    // comparisons. Track their nesting too: without it, `Pair<integer, string`
    // resyncs at the comma INSIDE the type arguments and the caller mints a
    // bogus element (`string`) out of the type's own argument list. Only a
    // token that is a PURE RUN of `<` or `>` is a bracket (`<=`, `>=`, `=>`,
    // `->` are not); a munched `>>` closes two levels.
    let angle = 0;
    while (this.current.type !== 'EOF') {
      const t = this.current.type;
      if (t === 'OPEN_PAREN' || t === 'OPEN_BRACKET' || t === 'OPEN_BRACE') {
        depth += 1;
      } else if (
        t === 'CLOSE_PAREN' ||
        t === 'CLOSE_BRACKET' ||
        t === 'CLOSE_BRACE'
      ) {
        if (depth === 0) return;
        depth -= 1;
      } else if (
        stopAtElementBoundary &&
        depth === 0 &&
        t === 'OPERATOR' &&
        /^(<+|>+)$/.test(this.current.text)
      ) {
        const text = this.current.text;
        if (text[0] === '<') angle += text.length;
        else angle = Math.max(0, angle - text.length);
      } else if (stopAtElementBoundary && depth === 0 && angle === 0) {
        if (t === 'COMMA') return;
        if (t === 'OPERATOR' && this.current.text === '=>') return;
      }
      this.advance();
    }
  }

  //
  // ─── Pragmas ──────────────────────────────────────────────────────────────
  //
  // Ported from the old `parse-epsil.ts` pragma handlers, preserving the
  // Phase-0 fixes: `#date` uses `getDate()`; `#warning`/`#error` do not write
  // to the console; `#warning` evaluates to its message string; `#error`
  // throws a `FatalParsingError`.
  //

  private parsePragma(): MathJsonExpression {
    const token = this.advance();
    const name = token.text;

    // Symbol pragmas: no argument clause.
    if (
      name === '#line' ||
      name === '#column' ||
      name === '#filename' ||
      name === '#url' ||
      name === '#date' ||
      name === '#time'
    ) {
      return this.wrap(
        this.evalSymbolPragma(name, token.end),
        token.start,
        token.end
      );
    }

    // Function pragmas: an argument clause `( … )`.
    const { list, end } = this.parseArgumentClause();
    return this.wrap(
      this.evalFunctionPragma(name, list, token),
      token.start,
      end
    );
  }

  private evalSymbolPragma(
    name: string,
    offset: number
  ): MathJsonExpression | number | string {
    const now = new Date();
    if (name === '#date') {
      return (
        now.getFullYear() +
        '-' +
        ('00' + (1 + now.getMonth())).slice(-2) +
        '-' +
        ('00' + now.getDate()).slice(-2)
      );
    }
    if (name === '#time') {
      return (
        ('00' + now.getHours().toString()).slice(-2) +
        ':' +
        ('00' + now.getMinutes().toString()).slice(-2) +
        ':' +
        ('00' + now.getSeconds().toString()).slice(-2)
      );
    }
    if (name === '#url') return this.url ?? 'Nothing';
    if (name === '#filename') {
      if (!this.url) return 'Nothing';
      return this.url.substring(this.url.lastIndexOf('/') + 1);
    }
    if (name === '#line') {
      const origin = new Origin(this.source, this.url);
      return origin.getLinecol(offset)[0];
    }
    if (name === '#column') {
      const origin = new Origin(this.source, this.url);
      return origin.getLinecol(offset)[1];
    }
    return 'Nothing';
  }

  private evalFunctionPragma(
    name: string,
    args: MathJsonExpression,
    token: Token
  ): MathJsonExpression | string {
    if (name === '#warning') {
      const message = mapArgs<string>(args, (x) => expressionToString(x)).join(
        ' '
      );
      // `#warning` no longer writes to the console (Phase 0); it evaluates to
      // its interpolated message as a string value.
      return { str: message };
    }

    if (name === '#error') {
      const message = mapArgs<string>(args, (x) => expressionToString(x)).join(
        ' '
      );
      throw new FatalParsingError(message);
    }

    if (name === '#env') {
      // Host-state pragma: gated off by default so an embedded notebook cannot
      // leak the host environment into a document at parse time.
      if (!this.allowHostPragmas) {
        this.error(['host-pragma-disabled', name], token.start, token.end);
        return 'Nothing';
      }
      if ('process' in globalThis && process.env) {
        return {
          str: process.env[expressionToString(operand(args, 1))] ?? '',
        };
      }
    }

    if (name === '#navigator') {
      // Host-state pragma: gated off by default (see `#env`).
      if (!this.allowHostPragmas) {
        this.error(['host-pragma-disabled', name], token.start, token.end);
        return 'Nothing';
      }
      // eslint-disable-next-line no-restricted-globals
      if ('navigator' in globalThis) {
        return {
          // eslint-disable-next-line no-restricted-globals
          str: (navigator as unknown as Record<string, string>)[
            expressionToString(operand(args, 1))
          ],
        };
      }
    }

    return 'Nothing';
  }

  /** Parse a function-call argument clause `( expr, expr, … )` into a `List`.
   * Absent a `(`, returns an empty list. */
  private parseArgumentClause(): { list: MathJsonExpression; end: number } {
    const values: MathJsonExpression[] = [];
    let end = this.current.end;

    if (!this.check('OPEN_PAREN')) return { list: ['List'], end };

    const open = this.advance(); // `(`
    this.brackets.push(open);

    if (!this.check('CLOSE_PAREN')) {
      for (;;) {
        const expr = this.parseExpression(0);
        if (expr === null) {
          this.reportUnexpected(this.current);
          this.recoverInBracket();
          break;
        }
        values.push(expr);
        if (!this.match('COMMA')) break;
      }
    }

    this.brackets.pop();

    if (this.check('CLOSE_PAREN')) {
      end = this.current.end;
      this.advance();
    } else {
      this.error(['closing-bracket-expected', ')'], open.start, open.end);
      end = this.current.start;
    }

    return { list: ['List', ...values], end };
  }
}

//
// ─── Number conversion ──────────────────────────────────────────────────────
//
// The token keeps the raw digits (with `_` separators). The parser converts to
// a MathJSON `{num}` string:
//
//   • A plain decimal integer keeps every digit (no `parseFloat`), so a
//     40-digit literal survives with full precision.
//   • A decimal with a fractional part or exponent, and hex/binary literals,
//     are normalized through the (ported) numeric-conversion arithmetic — this
//     is what today's tests assert (e.g. `1.2000 → 1.2`, `0xdead.beef → …`).
//
// The conversion arithmetic is ported verbatim from the old combinator
// library's numeric parsers, so the produced values are identical.
//

/** Whether `expr` is a bare number literal node (`{num}`). */
function isNumberNode(expr: MathJsonExpression): boolean {
  return (
    typeof expr === 'object' &&
    expr !== null &&
    !Array.isArray(expr) &&
    'num' in expr
  );
}

/** The operands array of a function node (`{fn: […]}`), or `null` for any other
 * node. The first element is the operator head. */
function fnOps(expr: MathJsonExpression): MathJsonExpression[] | null {
  if (
    typeof expr === 'object' &&
    expr !== null &&
    !Array.isArray(expr) &&
    'fn' in expr
  )
    return (expr as { fn: MathJsonExpression[] }).fn;
  return null;
}

/** The bound name of a lambda parameter node: a bare symbol, or the symbol
 * inside a `["Typed", sym, type]` annotation. */
function paramNameOf(p: MathJsonExpression): string | null {
  const direct = symbolNameOf(p) ?? (typeof p === 'string' ? p : null);
  if (direct !== null) return direct;
  const ops = fnOps(p);
  if (ops !== null && ops[0] === 'Typed' && ops[1] !== undefined) {
    const inner = ops[1];
    return symbolNameOf(inner) ?? (typeof inner === 'string' ? inner : null);
  }
  return null;
}

/** Offset of a parameter name inside a literal signature's source text (a
 * name token followed by `:`), searching from `from`; `-1` when not found. */
function findParamName(text: string, name: string, from: number): number {
  let i = text.indexOf(name, from);
  while (i >= 0) {
    const before = i === 0 ? '(' : text[i - 1];
    let j = i + name.length;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (/[(,\s]/.test(before) && text[j] === ':') return i;
    i = text.indexOf(name, i + 1);
  }
  return -1;
}

/** The name of a bare-symbol node (`{sym}`), or `null` for any other node. Used
 * to decide a call head vs. an `Apply`. */
function symbolNameOf(expr: MathJsonExpression): string | null {
  if (
    typeof expr === 'object' &&
    expr !== null &&
    !Array.isArray(expr) &&
    'sym' in expr
  )
    return (expr as { sym: string }).sym;
  return null;
}

/**
 * Whether a node can be the left side of an assignment: a bare symbol, or a
 * `Field`/`At` chain rooted at one (`p.x`, `xs[1]`, `m.a[2].b`).
 *
 * This is the test that makes a bare `=` positional — with a binding target on
 * the left of a statement it assigns, otherwise it compares. `Field`/`At` are
 * included deliberately: both already reject at evaluation (Epsil collections
 * and records are immutable), so reading them as comparisons instead would
 * trade a real diagnostic for a silent `False`. When immutable-update
 * expressions land they become meaningful in the same position.
 */
function isBindingTarget(expr: MathJsonExpression): boolean {
  return bindingTargetRoot(expr) !== null;
}

/**
 * Whether a node is shaped exactly like a destructuring pattern: a `Tuple` of
 * at least two elements, each a bare symbol (`_` included) or a nested such
 * `Tuple`. This is the same grammar `parseDeclarationPattern` accepts for
 * `let (x, y) = …`, recognized here on an ORDINARY parenthesized tuple
 * expression — the pattern is not a binding target, so a bare `=` against one
 * resolves to a comparison and the intended write silently vanishes.
 *
 * Deliberately narrow: a computed component (`(x + 1, y) = …`) is a plausible
 * tuple equation, not a mistyped destructuring, and stays silent.
 */
function isDestructuringPatternShape(expr: MathJsonExpression): boolean {
  const ops = fnOps(expr);
  if (ops === null || ops[0] !== 'Tuple' || ops.length < 3) return false;
  return ops
    .slice(1)
    .every(
      (el) => symbolNameOf(el) !== null || isDestructuringPatternShape(el)
    );
}

/** The bare symbol a binding target is rooted at (`p` for `p.a[2].b`), or
 * `null` when the node is not a binding target at all. The literal-word checks
 * use the root's source span, since the whole path's span (`true.x`) is never
 * a literal word. */
function bindingTargetRoot(
  expr: MathJsonExpression
): MathJsonExpression | null {
  if (symbolNameOf(expr) !== null) return expr;
  const ops = fnOps(expr);
  if (ops === null || ops.length < 2) return null;
  // A QUALIFIED protocol property (`p.(P.name)`, protocols design P6) carries
  // its receiver third. It is a binding-target SHAPE — so a bare `=` against
  // one reads as the assignment it looks like, and the engine answers with
  // `property-assignment-target-invalid` — rather than silently becoming a
  // comparison whose result is discarded.
  if (ops[0] === 'ProtocolProperty')
    return ops.length >= 4 ? bindingTargetRoot(ops[3]) : null;
  if (ops[0] !== 'Field' && ops[0] !== 'At') return null;
  return bindingTargetRoot(ops[1]);
}

/** Whether a pattern leaf is a literal that matches structurally (a number, a
 * string, or a boolean-literal symbol `True`/`False`). Used by pin lowering to
 * decide between a bare literal and a `["Pin", …]` node. */
function isLiteralNode(expr: MathJsonExpression): boolean {
  if (isNumberNode(expr)) return true;
  if (typeof expr === 'object' && expr !== null && 'str' in expr) return true;
  if (typeof expr === 'string' && /^'[\s\S]*'$/.test(expr)) return true;
  const s = symbolNameOf(expr) ?? (typeof expr === 'string' ? expr : null);
  return s === 'True' || s === 'False';
}

/** Whether a lowered parameter node is a **literal parameter** — the
 * `["Typed", "literalParam_<n>", {str: "<value>"}]` form `parseLiteralParam`
 * builds for `function f(0) { … }`. Literal parameters are multi-clause
 * territory, so a type-parameter clause alongside one is rejected (G2). */
function isLiteralParamNode(p: MathJsonExpression): boolean {
  if (operator(p) !== 'Typed') return false;
  const name = symbol(operand(p, 1));
  return name !== null && isLiteralParamName(name);
}

/** The operator head of a function node (`{fn: [head, …]}`), or `null`. */
function operatorOf(expr: MathJsonExpression): string | null {
  const ops = fnOps(expr);
  if (ops === null) return null;
  return typeof ops[0] === 'string' ? ops[0] : (symbolNameOf(ops[0]) ?? null);
}

/**
 * The machine value of a **range-pattern bound**: a numeric literal node, with
 * `Infinity`/`-Infinity` allowed and `NaN` rejected. Returns `undefined` for
 * anything that is not a usable literal bound (a binding, a computed
 * expression, a pin, a string, `NaN`), which is what the `range-pattern-bounds`
 * diagnostic keys on. The Epsil lexer normalizes every numeric literal to a
 * plain decimal/exponent spelling, so `Number()` round-trips them all.
 */
function rangeBoundValue(expr: MathJsonExpression): number | undefined {
  if (!isNumberNode(expr)) return undefined;
  const raw = (expr as { num: string | number }).num;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isNaN(value) ? undefined : value;
}

/** Whether a pattern is irrefutable on its own: a lone binding (`_name`) or the
 * anonymous wildcard (`_`). A non-final irrefutable case (with no guard) makes
 * later cases dead. Rests and typed bindings are handled via guards, so only a
 * bare single-symbol wildcard/binding qualifies. */
function isIrrefutablePattern(pattern: MathJsonExpression): boolean {
  const s = symbolNameOf(pattern);
  if (s === null) return false;
  if (s === '_') return true; // anonymous wildcard
  if (s.startsWith('___')) return false; // a rest is only meaningful in a list
  return s.startsWith('_'); // a binding `_name`
}

/** The written binding name of an irrefutable pattern (`_Pi` → `Pi`, `_` →
 * `_`), for the irrefutable-case fix-it message. */
function bindingName(pattern: MathJsonExpression): string {
  const s = symbolNameOf(pattern);
  if (s === null) return '';
  if (s === '_') return '_';
  return s.replace(/^_+/, '');
}

/** Whether a pattern contains a *named* wildcard binding (`_name` / `___name`),
 * anywhere but inside a `Pin` (whose operand is an ordinary value expression).
 * Anonymous wildcards (`_` / `___`) do not bind. Used to reject bindings inside
 * or-alternatives. */
function patternHasBinding(pattern: MathJsonExpression): boolean {
  const s = symbolNameOf(pattern);
  if (s !== null) {
    const m = s.match(/^_+/);
    return m !== null && s.length > m[0].length;
  }
  const ops = fnOps(pattern);
  if (ops === null) return false;
  if (ops[0] === 'Pin') return false; // the pinned expr is an ordinary value
  return ops.slice(1).some(patternHasBinding);
}

/** Un-patternize a dictionary key node: a bare-binding key `_foo` reverts to
 * the written symbol `foo` (dictionary keys are literal, not bindings). */
function unpatternizeKey(key: MathJsonExpression): MathJsonExpression {
  const s = symbolNameOf(key);
  if (s !== null && s.startsWith('_') && s !== '_') {
    const name = s.replace(/^_+/, '');
    const offsets = nodeOffsets(key);
    return offsets ? { sym: name, sourceOffsets: offsets } : { sym: name };
  }
  return key;
}

/** A dictionary key: an unquoted symbol key (`one`) becomes a string
 * (`{str:'one'}`); a string key is kept; anything else is passed through. */
function keyToString(key: MathJsonExpression | null): MathJsonExpression {
  if (key === null) return { str: '' };
  const sym = symbolNameOf(key);
  if (sym !== null) {
    const offsets = nodeOffsets(key);
    return offsets ? { str: sym, sourceOffsets: offsets } : { str: sym };
  }
  return key;
}

/** Whether a token type closes a bracketed construct. */
function isCloseToken(type: TokenType): boolean {
  return (
    type === 'CLOSE_PAREN' || type === 'CLOSE_BRACKET' || type === 'CLOSE_BRACE'
  );
}

/** The absolute `sourceOffsets` of a node, if it carries them. */
function nodeOffsets(expr: MathJsonExpression): [number, number] | undefined {
  if (typeof expr === 'object' && expr !== null && 'sourceOffsets' in expr)
    return (expr as { sourceOffsets?: [number, number] }).sourceOffsets;
  return undefined;
}

/** If `expr` is a bare number literal (`{num}`), return it with `negative`/
 * positive sign folded in; otherwise `null` (the caller wraps in `Negate`). */
function foldSignedNumber(
  expr: MathJsonExpression,
  negative: boolean
): { num: string } | null {
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr))
    return null;
  if (!('num' in expr)) return null;
  return { num: applySign((expr as { num: string }).num, negative) };
}

/** Apply a leading sign to a MathJSON `num` payload string. Preserves full
 * precision (no `parseFloat`) and collapses `-0` to `0`. */
function applySign(s: string, negative: boolean): string {
  if (!negative) return s.startsWith('+') ? s.slice(1) : s;
  if (s.startsWith('-')) return s.slice(1);
  const body = s.startsWith('+') ? s.slice(1) : s;
  if (/^0+(\.0*)?$/.test(body)) return body; // -0 → 0
  return '-' + body;
}

function numberPayload(text: string, negative: boolean): string {
  const t = text.replace(/_/g, '');

  if (/^0[bB]/.test(t)) {
    let v = binaryValue(t);
    if (negative) v = -v;
    return v.toString();
  }
  if (/^0[xX]/.test(t)) {
    let v = hexValue(t);
    if (negative) v = -v;
    return v.toString();
  }

  // Decimal.
  if (/^[0-9]+$/.test(t)) {
    // A plain integer: preserve every digit.
    if (negative) return /^0+$/.test(t) ? '0' : '-' + t;
    return t;
  }

  let v = decimalValue(t);
  if (negative) v = -v;
  return v.toString();
}

function decimalValue(t: string): number {
  let i = 0;
  let value = 0;
  while (i < t.length) {
    const d = DIGITS.get(t.codePointAt(i)!);
    if (d === undefined) break;
    value = value * 10 + d;
    i += 1;
  }
  if (t.codePointAt(i) === 0x2e) {
    i += 1;
    let frac = 0.1;
    let fracPart = 0;
    while (i < t.length) {
      const d = DIGITS.get(t.codePointAt(i)!);
      if (d === undefined) break;
      fracPart += frac * d;
      frac = frac / 10;
      i += 1;
    }
    value += fracPart;
  }
  return applyExponent(value, t, i);
}

function binaryValue(t: string): number {
  let i = 2; // skip `0b`
  let value = 0;
  while (i < t.length) {
    const c = HEX_DIGITS.get(t.codePointAt(i)!);
    if (c === 0) value = value << 1;
    else if (c === 1) value = (value << 1) + 1;
    else break;
    i += 1;
  }
  if (t.codePointAt(i) === 0x2e) {
    i += 1;
    let frac = 0.5;
    let fracPart = 0;
    while (i < t.length) {
      const c = HEX_DIGITS.get(t.codePointAt(i)!);
      if (c === 0) frac = frac / 2;
      else if (c === 1) {
        fracPart += frac;
        frac = frac / 2;
      } else break;
      i += 1;
    }
    value += fracPart;
  }
  return applyExponent(value, t, i);
}

function hexValue(t: string): number {
  let i = 2; // skip `0x`
  let value = 0;
  while (i < t.length) {
    const c = HEX_DIGITS.get(t.codePointAt(i)!);
    if (c === undefined) break;
    value = value * 16 + c;
    i += 1;
  }
  if (t.codePointAt(i) === 0x2e) {
    i += 1;
    let frac = 0.0625; // 1/16
    let fracPart = 0;
    while (i < t.length) {
      const c = HEX_DIGITS.get(t.codePointAt(i)!);
      if (c === undefined) break;
      fracPart += frac * c;
      frac = frac / 16;
      i += 1;
    }
    value += fracPart;
  }
  return applyExponent(value, t, i);
}

/** Apply an optional exponent at position `i`. Decimal/binary allow `e`/`p`;
 * hex allows only `p` (its `e`/`E` are already consumed as digits). */
function applyExponent(value: number, t: string, i: number): number {
  const e = scanExponent(t, i, false);
  if (e !== null)
    return Number.parseFloat(value.toString() + 'e' + e.toString());
  const p = scanExponent(t, i, true);
  if (p !== null) return value * Math.pow(2, p);
  return value;
}

function scanExponent(t: string, i: number, isP: boolean): number | null {
  const c = t.codePointAt(i);
  if (c === undefined) return null;
  if (isP) {
    if (c !== 0x70 && c !== 0x50) return null; // p / P
  } else {
    if (c !== 0x65 && c !== 0x45) return null; // e / E
  }
  i += 1;

  let sign = 1;
  if (t.codePointAt(i) === 0x2d) {
    sign = -1;
    i += 1;
  } else if (t.codePointAt(i) === 0x2b) {
    i += 1;
  }

  let value = 0;
  let any = false;
  while (i < t.length) {
    const d = DIGITS.get(t.codePointAt(i)!);
    if (d === undefined) break;
    value = value * 10 + d;
    any = true;
    i += 1;
  }
  if (!any) return null;
  return sign * value;
}

//
// ─── Helpers ────────────────────────────────────────────────────────────────
//

/** Whether a node mentions a shorthand-lambda placeholder — the bare `_` or a
 * positional `_1`…`_9` — anywhere in its operands. Heads are not inspected. */
function mentionsWildcard(node: MathJsonExpression): boolean {
  const s = symbol(node);
  if (s !== null)
    return (
      s === '_' ||
      (s.length === 2 && s[0] === '_' && s[1] >= '1' && s[1] <= '9')
    );
  let args: MathJsonExpression[] | undefined;
  if (Array.isArray(node)) args = node as MathJsonExpression[];
  else if (typeof node === 'object' && node !== null && 'fn' in node)
    args = node.fn as MathJsonExpression[];
  if (args === undefined) return false;
  for (let i = 1; i < args.length; i++)
    if (mentionsWildcard(args[i])) return true;
  return false;
}

/** Render an argument expression as a plain string (for pragma messages).
 * Ported from the old `expressionToString`. */
function expressionToString(
  expr: MathJsonExpression | undefined | null
): string {
  if (expr === undefined || expr === null) return '';
  const s = stringValue(expr);
  if (s !== null) return s;
  if (typeof expr === 'number') return expr.toString();
  if (typeof expr === 'object' && 'num' in expr) return expr.num as string;
  return expr.toString();
}
