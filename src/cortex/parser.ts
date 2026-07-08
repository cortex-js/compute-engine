import { MathJsonExpression, MathJsonSymbol } from '../math-json/types';
import { Origin } from '../common/debug';
import { parseTypePrefix } from '../common/type/parse';
import {
  isStringObject,
  mapArgs,
  operand,
  operator,
  stringValue,
} from '../math-json/utils';
import { escapeJsonString } from '../common/json';

import { DIGITS, FANCY_UNICODE, HEX_DIGITS } from './characters';
import {
  DiagnosticMessage,
  FatalParsingError,
  ParsingDiagnostic,
} from './diagnostics';
import { tokenize } from './lexer';
import {
  OperatorDef,
  infixOperatorForSymbol,
  prefixOperatorForSymbol,
} from './operators';
import { RESERVED_WORDS } from './reserved-words';
import { SourceSpan, Token, TokenType } from './tokens';

/** Precedence of the prefix operators (`-`, `!`, and fancy aliases). Read from
 * the shared table so it can never drift. */
const PREFIX_PRECEDENCE = prefixOperatorForSymbol('!')!.precedence;

/** Precedence of `Multiply`, used for invisible multiplication (`2x`). Read
 * from the shared table so it stays in sync. */
const MULTIPLY_PRECEDENCE = infixOperatorForSymbol('*')!.precedence;

/** The characters that can head a prefix operator run (`-x`, `!a`, `+3`). */
const PREFIX_SIGILS = new Set(['!', '-', '+']);

//
// The Cortex parser turns a `Token[]` (from the Cortex `Lexer`) into a MathJSON
// expression plus a list of `ParsingDiagnostic`.
//
// It is modeled structurally on `src/common/type/parser.ts` (a `current`
// token, `advance`/`match`/`expect`) with two deliberate differences:
//
//   • It **never throws** (except the `#error` pragma, which throws a
//     `FatalParsingError` caught in `parseCortex`). `error()` appends a
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
//   postfix    = primary ( call-clause | index-clause )*   // tightest
//   unary      = prefix-op unary | postfix
//   expression = unary (infix-op expression | invisible-multiply)*
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
// `- x`).
//
// ─── Statement sequencing ───────────────────────────────────────────────────
//
// Top-level (and block-level) statements are separated by a linebreak
// (`precededByLinebreak`) or `;`. Two full expressions on one line with no
// separator are a diagnostic (no silent `Do`-juxtaposition — now that calls
// land, `f(x)` is a call, not `Do(f, x)`).
//
// The top-level shape: 0 statements → `Nothing`, 1 statement → that expression
// (not wrapped), N statements → `["Do", …]`.
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
   * `ILatexSyntax` injection so `src/cortex` never statically imports
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

  constructor(
    source: string,
    options?: {
      url?: string;
      offset?: number;
      parseLatex?: (latex: string) => MathJsonExpression;
      allowHostPragmas?: boolean;
    }
  ) {
    this.source = source;
    this.url = options?.url;
    this.baseOffset = options?.offset ?? 0;
    this.parseLatex = options?.parseLatex;
    this.allowHostPragmas = options?.allowHostPragmas ?? false;
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
      for (const m of token.diagnostics)
        this.error(m, token.start, token.end);
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
      const expr = this.parseStatement();
      if (expr !== null) {
        exprs.push(expr);
        this.expectStatementSeparator();
      } else {
        // If the failed parse already emitted a diagnostic, don't double-report.
        if (this.diagnostics.length === diagBefore) this.reportUnexpected(token);
        this.recoverAtTopLevel();
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
      fn: ['Do', ...exprs] as [MathJsonSymbol, ...MathJsonExpression[]],
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
      }
    }

    if (this.isMathFunctionDef()) return this.parseMathFunctionDef();

    const annotation = this.tryParseAnnotation();
    if (annotation !== undefined) return annotation;
    return this.parseExpression(0);
  }

  //
  // ─── Statement blocks (keyword-introduced `{ … }`) ────────────────────────
  //
  // A block is a brace-delimited sequence of statements (separated by a
  // linebreak or `;`), parsed only in keyword position (after
  // `function`/`if`/`else`/`while`/`for`). It is distinct from the Phase 2
  // `{…}` collection grammar (`Set`/`Dictionary`), which is a *primary*. The
  // block's value is its last expression (`Do`/`Block` semantics). An empty
  // block is `["Block"]`.
  //

  private parseBlock(): MathJsonExpression {
    const open = this.advance(); // '{'
    this.brackets.push(open);

    const stmts: MathJsonExpression[] = [];
    for (;;) {
      if (this.check('CLOSE_BRACE') || this.check('EOF')) break;
      const startPos = this.pos;
      const diagBefore = this.diagnostics.length;
      const stmt = this.parseStatement();
      if (stmt === null) {
        if (this.diagnostics.length === diagBefore)
          this.reportUnexpected(this.current);
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

    return this.wrap(['Block', ...stmts] as MathJsonExpression[], open.start, end);
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
  // a type; the engine enforces immutability (reassigning a `const` yields an
  // error value). A bare annotation `name: Type = value` (no keyword) also
  // declares — see `tryParseAnnotation` — emitting the same `Declare` shape
  // (never `constant`).
  //

  private parseDeclaration(isConst: boolean): MathJsonExpression | null {
    const kw = this.advance(); // 'let' | 'const'
    const nameTok = this.current;
    if (nameTok.type !== 'SYMBOL' && nameTok.type !== 'VERBATIM_SYMBOL') {
      this.error(['symbol-expected'], nameTok.start, nameTok.end);
      return null;
    }
    this.advance();
    this.harvest(nameTok);
    const name =
      nameTok.type === 'VERBATIM_SYMBOL' ? nameTok.value ?? '' : nameTok.text;
    const nameNode = this.wrap({ sym: name }, nameTok.start, nameTok.end);
    return this.finishDeclaration(isConst, kw.start, nameNode);
  }

  /** Parse the optional `: Type` and `= value` tail of a declaration and build
   * the engine `Declare` node (type positional; `value`/`constant` in a
   * trailing attributes `Dictionary`). On a malformed type, returns `null` (the
   * type subparse has already recovered). The current token is the one right
   * after the declared name (`:`, `=`, or a separator). */
  private finishDeclaration(
    isConst: boolean,
    start: number,
    nameNode: MathJsonExpression
  ): MathJsonExpression | null {
    let typeNode: MathJsonExpression | undefined;
    let end = this.localEnd(nameNode) ?? this.previousEnd();

    if (this.check('OPERATOR') && this.current.text === ':') {
      const t = this.parseTypeAnnotation();
      if (t === null) return null;
      typeNode = t.node;
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
        this.kvPair('constant', this.wrap({ sym: 'True' }, start, end), start, end)
      );
    if (entries.length > 0)
      parts.push(
        this.wrap(['Dictionary', ...entries] as MathJsonExpression[], start, end)
      );

    return this.wrap(parts, start, end);
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
    if (!this.check('OPEN_BRACE')) {
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
    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const body = this.parseBlock();
    const end = this.localEnd(body) ?? this.previousEnd();
    const loopBody = [
      'Block',
      ['If', ['Not', cond], ['Break']],
      body,
    ] as MathJsonExpression[];
    return this.wrap(
      ['Loop', loopBody] as MathJsonExpression[],
      kw.start,
      end
    );
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
      varTok.type === 'VERBATIM_SYMBOL' ? varTok.value ?? '' : varTok.text;
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
    const body = this.parseBlock();
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
  // ─── Function definitions ─────────────────────────────────────────────────
  //

  /** Block form `function f(x) { … }` →
   * `["Assign", "f", ["Function", ["Block", …], …params]]`. Typed params
   * (`function f(x: real) { … }`) and a return type (`… -> real { … }`) are
   * accepted syntactically; both are held-and-dropped for v0 (the engine
   * `Function` takes bare symbol params). */
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
      nameTok.type === 'VERBATIM_SYMBOL' ? nameTok.value ?? '' : nameTok.text;
    const nameNode = this.wrap({ sym: name }, nameTok.start, nameTok.end);

    if (!this.check('OPEN_PAREN')) {
      this.error(
        ['opening-bracket-expected', '('],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const params = this.parseParameterList();

    // Optional return type `-> Type` (parsed and dropped for v0).
    if (this.check('OPERATOR') && this.current.text === '->') {
      this.advance(); // '->'
      this.parseHeldType();
    }

    if (!this.check('OPEN_BRACE')) {
      this.error(
        ['opening-bracket-expected', '{'],
        this.current.start,
        this.current.end
      );
      return null;
    }
    const body = this.parseBlock();
    const end = this.localEnd(body) ?? this.previousEnd();

    const fnNode = this.wrap(
      ['Function', body, ...params] as MathJsonExpression[],
      nameTok.start,
      end
    );
    return this.wrap(
      ['Assign', nameNode, fnNode] as MathJsonExpression[],
      kw.start,
      end
    );
  }

  /** Whether the statement at the cursor is a math-style function definition
   * `f( … ) = …`: a bare symbol, an abutting `(`, its matching `)`, then `=`.
   * A lookahead only — it consumes nothing. */
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
    const after = this.tokens[i + 1];
    return (
      after !== undefined && after.type === 'OPERATOR' && after.text === '='
    );
  }

  /** Math-style `f(x) = expr` (typed params supported) →
   * `["Assign", "f", ["Function", expr, …params]]`. */
  private parseMathFunctionDef(): MathJsonExpression | null {
    const nameTok = this.advance(); // SYMBOL
    this.harvest(nameTok);
    const nameNode = this.wrap(
      { sym: nameTok.text },
      nameTok.start,
      nameTok.end
    );
    const params = this.parseParameterList();

    if (!(this.check('OPERATOR') && this.current.text === '=')) {
      this.error(
        ['unexpected-symbol', this.current.text],
        this.current.start,
        this.current.end
      );
      return null;
    }
    this.advance(); // '='
    const rhs = this.parseExpression(0);
    if (rhs === null) {
      this.error(['expression-expected'], this.current.start, this.current.end);
      return null;
    }
    const end = this.localEnd(rhs) ?? this.previousEnd();

    const fnNode = this.wrap(
      ['Function', rhs, ...params] as MathJsonExpression[],
      nameTok.start,
      end
    );
    return this.wrap(
      ['Assign', nameNode, fnNode] as MathJsonExpression[],
      nameTok.start,
      end
    );
  }

  /** Parse a `( param, … )` parameter list. Each param is a symbol with an
   * optional `: Type` annotation (parsed and dropped for v0). Returns the bare
   * param symbol nodes. */
  private parseParameterList(): MathJsonExpression[] {
    const open = this.advance(); // '('
    this.brackets.push(open);

    const params: MathJsonExpression[] = [];
    if (!this.check('CLOSE_PAREN')) {
      for (;;) {
        const tok = this.current;
        if (tok.type !== 'SYMBOL' && tok.type !== 'VERBATIM_SYMBOL') {
          this.error(['symbol-expected'], tok.start, tok.end);
          this.recoverInBracket();
          break;
        }
        this.advance();
        this.harvest(tok);
        const pname =
          tok.type === 'VERBATIM_SYMBOL' ? tok.value ?? '' : tok.text;
        params.push(this.wrap({ sym: pname }, tok.start, tok.end));

        // Optional `: Type` — consumed and dropped for v0.
        if (this.check('OPERATOR') && this.current.text === ':')
          this.parseTypeAnnotation();

        if (!this.match('COMMA')) break;
        if (this.check('CLOSE_PAREN')) break; // trailing comma
      }
    }

    this.brackets.pop();

    if (this.check('CLOSE_PAREN')) this.advance();
    else this.error(['closing-bracket-expected', ')'], open.start, open.end);

    return params;
  }

  /** Consume a `Type` starting at the current token (a return type after
   * `->`). Parsed and dropped for v0. */
  private parseHeldType(): void {
    const start = this.current.start;
    try {
      const { end } = parseTypePrefix(this.source.slice(start));
      this.advanceToOffset(start + end);
    } catch {
      // A malformed return type: leave the cursor; the following
      // `{`-expectation reports the problem.
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
      target.type === 'VERBATIM_SYMBOL' ? target.value ?? '' : target.text;
    const nameNode = this.wrap({ sym: name }, target.start, target.end);

    // The cursor is now on the `:`; `finishDeclaration` parses the type and an
    // optional initializer, building the (non-const) `Declare` node.
    return this.finishDeclaration(false, target.start, nameNode);
  }

  /**
   * Parse a `: Type` annotation starting at the current `:` OPERATOR token. The
   * type is parsed by the engine's `common/type` prefix subparser, then parsing
   * resumes in Cortex just past the type. Returns the held `{str}` type node and
   * its end offset, or `null` on a malformed type (after emitting a
   * `type-annotation-error` diagnostic and recovering at top level).
   */
  private parseTypeAnnotation():
    | { node: MathJsonExpression; end: number }
    | null {
    const colonTok = this.advance(); // ':'

    // Parse the type from the remaining source (local offsets).
    const typeSourceStart = colonTok.end;
    let typeEnd: number;
    let typeString: string;
    try {
      const { end } = parseTypePrefix(this.source.slice(typeSourceStart));
      typeEnd = typeSourceStart + end;
      typeString = this.source.slice(typeSourceStart, typeEnd).trim();
      this.advanceToOffset(typeEnd);
    } catch (e) {
      const err = e as { position?: number; rawMessage?: string };
      const rel = typeof err.position === 'number' ? err.position : 0;
      const message =
        err.rawMessage ?? (e instanceof Error ? e.message : String(e));
      const errStart = typeSourceStart + rel;
      // Offset-shift the type error to the absolute Cortex position. Use the
      // token at that offset (if any) for the diagnostic's end.
      let errEnd = errStart + 1;
      for (const tok of this.tokens) {
        if (tok.start >= errStart) {
          errEnd = Math.max(tok.end, errStart + 1);
          break;
        }
      }
      this.error(['type-annotation-error', message], errStart, errEnd);
      this.recoverAtTopLevel();
      return null;
    }

    const node = this.wrap({ str: typeString }, typeSourceStart, typeEnd);
    return { node, end: typeEnd };
  }

  /** Advance the token cursor until the current token starts at or past the
   * (local) `offset`. Used to resume Cortex parsing after a type subparse
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

  /**
   * Consume a statement separator after a statement, or diagnose its absence.
   *
   * Statements are separated by an explicit `;` or by a linebreak
   * (`precededByLinebreak`). Two full expressions on one line with no separator
   * are a diagnostic (language-review §2.5) — there is no silent
   * `Do`-juxtaposition. The offending region is skipped by the top-level
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
    let left = this.parseUnary();
    if (left === null) return null;

    for (;;) {
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
      if (op.def.precedence < minPrecedence) break;

      if (op.asymmetric)
        this.emitAsymmetric(this.current, op.def.symbol);

      // Consume the operator token(s).
      for (let i = 0; i < op.tokenCount; i++) this.advance();

      const rightMin =
        op.def.assoc === 'right' ? op.def.precedence : op.def.precedence + 1;
      const right = this.parseExpression(rightMin);
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
        // `+` on a non-literal: identity, `result` unchanged.
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
      fixits: [[this.baseOffset + token.start, this.baseOffset + token.end, ` ${symbol} `]],
    });
  }

  /** Combine an infix operator with its operands, flattening a run of the same
   * relational operator into an n-ary node (`a < b < c` → `Less(a,b,c)`). */
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

    return this.wrap([def.name, left, right] as MathJsonExpression[], start, end);
  }

  /** Extract the parameter symbols from a mapsto LHS: a bare symbol (one
   * parameter), or a `Tuple` of symbols (`(x, y) |-> …`). A parenthesized
   * single symbol arrives here already unwrapped. A non-symbol parameter is a
   * diagnostic and is dropped. */
  private mapstoParams(left: MathJsonExpression): MathJsonExpression[] {
    const emit = (bad: MathJsonExpression) => {
      const o = nodeOffsets(bad);
      this.error(
        ['symbol-expected'],
        o ? o[0] - this.baseOffset : 0,
        o ? o[1] - this.baseOffset : 0
      );
    };

    const ops = fnOps(left);
    if (ops !== null && ops[0] === 'Tuple') {
      const params: MathJsonExpression[] = [];
      for (const p of ops.slice(1)) {
        if (symbolNameOf(p) === null) emit(p);
        else params.push(p);
      }
      return params;
    }

    if (symbolNameOf(left) !== null) return [left];

    emit(left);
    return [];
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
      } else break;
    }
    return expr;
  }

  /** A call clause `( args )` applied to `callee`. A bare-symbol callee becomes
   * the operator head (`f(x)` → `["f", x]`); any other callee is wrapped in
   * `Apply` (`(g)(x)` → `["Apply", g, x]`). */
  private parseCall(callee: MathJsonExpression): MathJsonExpression {
    const start = this.localStart(callee) ?? this.current.start;
    const { values, end } = this.parseBracketedList('CLOSE_PAREN', ')');
    const head = symbolNameOf(callee);
    if (head !== null)
      return this.wrap([head, ...values] as MathJsonExpression[], start, end);
    return this.wrap(
      ['Apply', callee, ...values] as MathJsonExpression[],
      start,
      end
    );
  }

  /** An index clause `[ i ]` applied to `base` → `["At", base, i]` (1-based). */
  private parseIndex(base: MathJsonExpression): MathJsonExpression {
    const start = this.localStart(base) ?? this.current.start;
    const { values, end } = this.parseBracketedList('CLOSE_BRACKET', ']');
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

    // `NaN` and `Infinity` are numeric constants, not plain symbols.
    if (token.text === 'NaN')
      return this.wrap({ num: 'NaN' }, token.start, token.end);
    if (token.text === 'Infinity')
      return this.wrap({ num: '+Infinity' }, token.start, token.end);

    // A reserved word is rejected in expression position (the verbatim
    // `` `word` `` form, handled by `parseVerbatimSymbol`, still works). Word
    // operators such as `in` never reach here — they are consumed by the Pratt
    // loop before a primary is attempted.
    if (RESERVED_WORDS.has(token.text))
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
  // injection — `src/cortex` never statically imports `latex-syntax`). The
  // returned MathJSON is spliced in raw (Cortex owns canonicalization) with its
  // `sourceOffsets` set to the island's Cortex-source range. Without an injected
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
    // Cortex-source range. Diagnostics *inside* the LaTeX (engine `["Error", …]`
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
      return this.wrap(
        { str: escapeJsonString(values[0]) },
        token.start,
        token.end
      );

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
    const diagBefore = this.diagnostics.length;
    const { values, open, end } = this.parseBracketedList('CLOSE_PAREN', ')');

    if (values.length === 0) {
      if (this.diagnostics.length === diagBefore)
        this.error(['expression-expected'], open.start, end);
      return null;
    }
    // A single value is a parenthesized expression, not a 1-tuple.
    if (values.length === 1) return values[0];
    return this.wrap(['Tuple', ...values] as MathJsonExpression[], open.start, end);
  }

  //
  // ─── Collections and dictionaries ─────────────────────────────────────────
  //

  /** `[a, b]` → `["List", a, b]`; `[]` → `["List"]`. */
  private parseList(): MathJsonExpression {
    const { values, open, end } = this.parseBracketedList('CLOSE_BRACKET', ']');
    return this.wrap(['List', ...values] as MathJsonExpression[], open.start, end);
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

    const { values, open, end } = this.parseBracketedList('CLOSE_BRACE', '}');

    // Disambiguate Set vs Dictionary on the first element: a top-level `->`
    // (a `KeyValuePair`) marks a dictionary.
    if (values.length > 0 && operator(values[0]) === 'KeyValuePair')
      return this.buildDictionary(values, open.start, end);

    return this.wrap(['Set', ...values] as MathJsonExpression[], open.start, end);
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

  /**
   * Parse a comma-separated list of expressions delimited by the current
   * opening bracket and `closeType`. Trailing commas are allowed. On a missing
   * or mismatched closer, a `closing-bracket-expected` diagnostic is emitted
   * and (for a mismatched closer) the stray bracket is consumed for recovery.
   */
  private parseBracketedList(
    closeType: TokenType,
    closeText: string
  ): { values: MathJsonExpression[]; open: Token; end: number } {
    const open = this.advance(); // the opening bracket
    this.brackets.push(open);

    const values: MathJsonExpression[] = [];
    if (!this.check(closeType)) {
      for (;;) {
        const expr = this.parseExpression(0);
        if (expr === null) {
          this.reportUnexpected(this.current);
          this.recoverInBracket();
          break;
        }
        values.push(expr);
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

    return { values, open, end };
  }

  /** Within a bracketed construct, skip to (but do not consume) the matching
   * closer, tracking nesting. */
  private recoverInBracket(): void {
    let depth = 0;
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
      }
      this.advance();
    }
  }

  //
  // ─── Pragmas ──────────────────────────────────────────────────────────────
  //
  // Ported from the old `parse-cortex.ts` pragma handlers, preserving the
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
    type === 'CLOSE_PAREN' ||
    type === 'CLOSE_BRACKET' ||
    type === 'CLOSE_BRACE'
  );
}

/** The absolute `sourceOffsets` of a node, if it carries them. */
function nodeOffsets(
  expr: MathJsonExpression
): [number, number] | undefined {
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
