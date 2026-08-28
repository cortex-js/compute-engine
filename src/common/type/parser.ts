import { Lexer, Token, TokenType } from './lexer.js';
import {
  ASTNode,
  TypeNode,
  FunctionSignatureNode,
  UnionTypeNode,
  IntersectionTypeNode,
  NegationTypeNode,
  GroupTypeNode,
  ListTypeNode,
  VectorTypeNode,
  MatrixTypeNode,
  TensorTypeNode,
  TupleTypeNode,
  RecordTypeNode,
  RecordEntryNode,
  ObjectTypeNode,
  DictionaryTypeNode,
  SetTypeNode,
  BroadcastableTypeNode,
  CollectionTypeNode,
  ExpressionTypeNode,
  SymbolTypeNode,
  NumericTypeNode,
  PrimitiveTypeNode,
  TypeReferenceNode,
  ValueNode,
  NamedElementNode,
  ArgumentNode,
  DimensionNode,
  ConstrainedTypeNode,
  TypeParamNode,
  TypeVariableNode,
} from './ast-nodes.js';
import {
  COMPLEX_INFINITY_VALUE,
  EffectLabel,
  EffectSet,
  TypeParameter,
  TypeResolver,
} from './types.js';
import {
  PRIMITIVE_TYPES_SET,
  VARIADIC_WITH_OPTIONAL_MESSAGE,
} from './primitive.js';
import { EFFECT_LABELS, isEffectLabel } from './effects.js';

/**
 * BNF grammar for the type parser:
 *
<type> ::= <constrained_type>

(* --- Type variables (parametric polymorphism) --- *)

(* A TRAILING `where` clause quantifying the type it follows. The clause is
   only MEANINGFUL on a function signature (and, per arm, on the members of an
   overload set: `((list<T>) -> T where T) & ((set<T>) -> boolean where T)`);
   the grammar admits it in any type position and the declaration-time
   validation rejects every other placement with
   `unsupported-variable-position`. Because <constrained_type> sits ABOVE the
   union/intersection levels, an unparenthesized `A & B where T` attaches the
   clause to the WHOLE intersection — which is then rejected (a clause may only
   quantify a signature), with a diagnostic that names the per-arm
   parenthesized fix.
   `where` is a RESERVED word in type strings.

   Because the clause TRAILS the body, identifier classification cannot wait
   for it: the parser LEXICALLY PRE-SCANS for a depth-0 `where` (resolving no
   names — see `scanWhereClauseNames`), seeds the clause's names as type
   variables, then parses the body. All names are seeded before any bound is
   parsed, so the clause is order-independent. *)
<constrained_type> ::= <union_type> ( <where_clause> )?

<where_clause> ::= "where" <var_decl> ( "," <var_decl> )*

(* The bound must be GROUND. The `is` protocol slot parses and is stored; it
   is checked at each call site against the engine's conformance registry
   (protocols design P19). A route with no registry to consult — a
   resolver-less parse — rejects it with `protocol-conformance-unsupported`
   rather than dropping it. *)
<var_decl> ::= <identifier> ( ":" <union_type> )?
               ( "is" <identifier> ( "&" <identifier> )* )?

(* Within its arm, a quantified name SHADOWS every other reading of that
   identifier (primitive, nominal or resolver-provided) and parses as a type
   variable. A parse may also be PRE-SEEDED with variables that no clause in
   the text declares (the `typeVars` option — the body of a generic type alias,
   whose parameters are quantified by the declaration, not by the body). Such a
   parse is UNCACHEABLE: the same text means different things under different
   seeds. *)

<union_type> ::= <intersection_type> ( " | " <intersection_type> )*

<intersection_type> ::= <primary_type_with_negation> ( " & " <primary_type_with_negation> )*

<primary_type_with_negation> ::= ( "!" )? <primary_type>

<primary_type> ::= <group>
                 | <list_type>
                 | <tuple_type>
                 | <record_type>
                 | <object_type>
                 | <dictionary_type>
                 | <set_type>
                 | <broadcastable_type>
                 | <callback_type>
                 | <collection_type>
                 | <expression_type>
                 | <symbol_type>
                 | <numeric_type>
                 | <primitive_type>
                 | <value>
                 | <type_reference>

<group> ::= "(" <type> ")"

(* --- Function Signatures --- *)

<function_signature> ::= <arguments> ( " " <effects> )? " -> " <type>

(* The effect specifier slot. It exists ONLY between the closing paren of the
   (mandatorily parenthesized) argument list and its arrow, so it is
   positionally isolated: an identifier there can only be an effect label.
   An empty slot means "pure" — absent and empty are the same set, and the
   empty specifier LIST is unwritable. Labels may be written in any order;
   the canonical (serialized) order is alphabetical. `any` is exclusive, a
   repeated label is an error, and `!` is reserved for the future complement
   form (a parse error today).
   `pure` is the keyword for the explicitly STATED empty set — exclusive with
   every label and with `any`, not repeatable. It builds `effects: []`, the
   same set as the bare arrow but a distinct spelling: it serializes back as
   ` pure`, so an explicit purity contract survives a round trip (ruled
   2026-08-01). See `docs/EFFECTS-MODEL.md`. *)
<effects> ::= "pure" | "any" | <effect_label> ( " " <effect_label> )*

<effect_label> ::= "console" | "entropy" | "environment" | "fs_read"
                 | "fs_write" | "network" | "random" | "scope" | "state"
                 | "time"

<arguments> ::= "()"
              | "(" <argument_list>? ")"

(* Note: The parser enforces a semantic rule: required arguments must come before optional and variadic arguments. *)
<argument_list> ::= <argument_specifier> ( "," <argument_specifier> )*

<argument_specifier> ::= <named_element> ( "?" | "*" | "+" )?

<named_element> ::= ( <name> ":" )? <type>

<name> ::= <identifier> | <verbatim_string>


(* --- Collection-like Types --- *)

<list_type> ::= "list" ( "<" <type> ( "^" <dimensions> )? ">" )?
              | "vector" ( "<" ( <type> ("^" <dimension_specifier>)? | <dimensions> ) ">" )?
              | "matrix" ( "<" ( <type> ("^" <dimensions>)? | <dimensions> ) ">" )?
              | "tensor" ( "<" <type> ">" )?

<dimensions> ::= <dimension_specifier> ( "x" <dimension_specifier> )*
               | "(" <dimension_specifier> ( "x" <dimension_specifier> )* ")"

<dimension_specifier> ::= <positive_integer_literal> | "?"

<tuple_type> ::= "tuple<" ( <named_element> ( "," <named_element> )* )? ">"

(* A record's (and an object's) field list is written with BRACES — the same
   delimiter as the `{…}` value literal it describes — because it is an
   UNORDERED, KEYED set of fields. Angle brackets are reserved for type
   arguments and ordered element lists (`list<…>`, `tuple<…>`, `Pair<…>`).
   The former angle-bracket spelling (`record<…>`, `object<…>`) is a parse
   error carrying a migration hint. *)
<record_type> ::= "record"
                | "record" "{" ( <record_element> ( "," <record_element> )* )? "}"

<object_type> ::= "object"
                | "object" "{" ( <record_element> ( "," <record_element> )* )? "}"

<record_element> ::= <key> ":" <type>

<key> ::= <identifier> | <verbatim_string>

<dictionary_type> ::= "dictionary"
                    | "dictionary<" <type> ">"

<set_type> ::= "set"
             | "set<" <type> ">"

<broadcastable_type> ::= "broadcastable" ( "<" <type> ">" )?

<callback_type> ::= "callback" "<" <signature> ">"

<collection_type> ::= ( "collection" | "indexed_collection" ) ( "<" <type> ">" )?


(* --- Other Constructed Types --- *)

<expression_type> ::= "expression<" <identifier> ">"

<symbol_type> ::= "symbol<" <identifier> ">"

<numeric_type> ::= <numeric_primitive> "<" <bound> ".." <bound> ">"

<bound> ::= <number_literal> | "-oo" | "oo" | ""


(* --- Atomic and Primitive Types --- *)

(* An APPLIED reference carries a type-argument list: `Pair<integer>`, the use
   site of a generic type alias (`docs/TYPE-SYSTEM.md`). The list is EAGERLY
   EXPANDED into the substituted alias body
   when the type is built, so no applied-reference node ever reaches the `Type`
   representation. An empty list (`Pair<>`), a wrong count, or arguments on a
   non-generic name are arity errors raised there — the grammar admits them.
   Writing the slot is also what closes the silent-truncation hazard: without
   it `p: Pair<integer>` parsed as the bare `Pair` and leaked `<integer>` to the
   surrounding (Epsil) grammar. *)
<type_reference> ::= ( "type" )? <identifier> ( "<" <type> ( "," <type> )* ">" | "<" ">" )?

(* The lowercase words `infinity` and `nan` are NOT here: they name the two
   numeric primitive types below. The value spellings are the capitalized
   words and the symbols. *)
<value> ::= <string_literal>
          | <number_literal>
          | "true" | "false"
          | "NaN" | "Infinity" | "+infinity" | "+Infinity" | "oo" | "∞" | "+oo" | "+∞"
          | "-infinity" | "-Infinity" | "-oo" | "-∞"
          | "~oo" | "~∞"

<primitive_type> ::= <numeric_primitive>
                   | "any" | "unknown" | "nothing" | "missing" | "never" | "error"
                   | "expression" | "symbol" | "function" | "value"
                   | "scalar" | "boolean" | "string"
                   | "collection" | "indexed_collection" | "list" | "tuple"
                   | "set" | "record" | "dictionary"

<numeric_primitive> ::= "number" | "finite_number" | "complex" | "finite_complex"
                      | "imaginary" | "real" | "finite_real" | "rational"
                      | "finite_rational" | "integer" | "finite_integer"
                      | "non_finite_number" | "infinity" | "nan"


(* --- Terminals (Lexical Tokens) --- *)

<identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*

<verbatim_string> ::= "`" ( [^`] | "\`" | "\\" )* "`"

<positive_integer_literal> ::= [1-9][0-9]*

<number_literal> ::= (* As parsed by the valueParser, including integers, decimals, and scientific notation *)

<string_literal> ::= '"' ( [^"] | '\"' )* '"'
 *
 */

export class Parser {
  private lexer: Lexer;
  private typeResolver: TypeResolver;
  private current: Token;

  /**
   * Prefix mode: parse a type from the *start* of the input and stop at the
   * first token that cannot continue the type, without requiring EOF. Used by
   * `parseTypePrefix()` (the Epsil type-annotation boundary). In this mode the
   * lexer is tolerant (unexpected trailing characters become EOF) and the
   * `this.lexer.input`-scanning error heuristics are scoped to the consumed
   * range so trailing (non-type) source never leaks into a type suggestion.
   */
  private allowTrailing: boolean;

  /** End offset (in `input`) just past the last token consumed as part of the
   * type. Exposed via `endOffset` for prefix mode. */
  private _end = 0;

  /** The clause-quantified names in scope, innermost last. An identifier
   * found here parses as a type VARIABLE, shadowing every other reading. */
  private _typeVarScopes: Set<string>[] = [];

  /**
   * Whether a trailing `where` clause may be attached to the type being
   * parsed. `true` for whole-string parses and standalone annotations, `false`
   * for embedded prefix parses (a return type after `->`, a comma-delimited
   * parameter annotation, a clause bound) where the clause belongs to an
   * enclosing construct — or where the clause's own `,`-separated list would
   * swallow the following list element. A PARENTHESIZED clause
   * (`((list<T>) -> T where T) & …`) is always admitted, independent of this
   * flag: the parens delimit it unambiguously.
   */
  private allowWhere: boolean;

  /**
   * Whether the `object{name: T, …}` layout form may be parsed at all.
   *
   * `false` everywhere except the routes that declare a NAMED type, which is
   * what enforces "an object type is legal only as the definition of a named
   * type" without every annotation site having to check for one. See
   * {@link parseObjectType}. The bare `object` primitive is unaffected.
   */
  private allowObjectType: boolean;

  /**
   * Whether the CALLER will parse a `{ … }` block immediately after this type
   * (with at most a `where` clause in between): the return type of an Epsil
   * `function` declaration, and nothing else. It makes the `{` of a bare
   * `record`/`object` return type unambiguous — see {@link startsFieldList}.
   */
  private blockFollows: boolean;

  /** True once a `where` clause has been seen (pre-scanned or parsed). The
   * declaration-time validation (`validateDeclaredType`) is gated on it, so a
   * type string without a clause pays nothing. */
  private _sawWhere = false;

  /** True once a `type X` forward-reference spelling has been parsed. Unlike a
   * BARE unknown name — which throws without a resolver — the `type X` form
   * parses resolver-less into an UNRESOLVED placeholder, and resolver-aware
   * with a side effect (`typeResolver.forward()` registration). So a
   * resolver-less parse of a string containing one is NOT equivalent to the
   * resolver-aware parse, and `parseType()` must neither reuse nor cache it. */
  private _sawForwardRef = false;

  constructor(
    input: string,
    options?: {
      typeResolver?: TypeResolver;
      allowTrailing?: boolean;
      allowWhere?: boolean;
      allowObjectType?: boolean;
      blockFollows?: boolean;
      typeVars?: readonly TypeParameter[];
    }
  ) {
    this.allowTrailing = options?.allowTrailing ?? false;
    this.allowWhere = options?.allowWhere ?? true;
    this.allowObjectType = options?.allowObjectType ?? false;
    this.blockFollows = options?.blockFollows ?? false;
    // A PRE-SEEDED parse (the body of a generic type alias): the alias's own
    // parameters are in scope from the first token, exactly as if an enclosing
    // `where` clause had quantified them, so `tuple<T, T>` reads `T` as a VARIABLE
    // rather than as an unknown type name.
    if (options?.typeVars !== undefined && options.typeVars.length > 0)
      this._typeVarScopes.push(new Set(options.typeVars.map((p) => p.name)));
    this.lexer = new Lexer(input, { tolerant: this.allowTrailing });
    this.typeResolver = options?.typeResolver ?? {
      forward: () => undefined,
      resolve: () => undefined,
      get names() {
        return [];
      },
    };
    this.current = this.lexer.consumeToken();
  }

  /** Offset just past the last token consumed as part of the parsed type
   * prefix (the delimiter/whitespace that ended the type is *not* included). */
  get endOffset(): number {
    return this._end;
  }

  /** True when the parsed type carried a `where` clause — the gate for the
   * declaration-time polytype validation. */
  get sawWhereClause(): boolean {
    return this._sawWhere;
  }

  /** True when the parsed type carried a `type X` forward-reference spelling —
   * the gate that keeps such parses out of the resolver-less memo cache. */
  get sawForwardRef(): boolean {
    return this._sawForwardRef;
  }

  error(message: string, suggestion?: string): never {
    this.errorAtToken(this.current, message, suggestion);
  }

  errorAtToken(
    token: Token,
    message: string,
    suggestion?: string,
    /** A machine-readable code for the failure, copied onto the thrown error
     * so a caller that reports diagnostics can name the rule that was broken
     * instead of matching on the message text. */
    code?: string
  ): never {
    let input = this.lexer.input;
    // In prefix mode, scope the displayed source (and the `set(`/`list(` … "did
    // you mean" heuristics that scan `input`) to the range consumed so far, so
    // trailing Epsil source after the type does not leak into the message.
    if (this.allowTrailing)
      input = input.slice(0, token.position + token.value.length);
    const lines = input.split('\n');
    const currentLine = lines[token.line - 1] || input;
    const column = token.column;

    // Create pointer showing error position
    const pointer = ' '.repeat(Math.max(0, column - 1)) + '^';

    // Format error message like the old parser
    const formattedMessage = [
      '',
      'Invalid type',
      `|   ${currentLine}`,
      `|   ${pointer}`,
      '|',
      `|   ${message}`,
    ];

    // Add suggestion if provided
    if (suggestion) formattedMessage.push(`|   ${suggestion}`);

    formattedMessage.push('');

    // Attach structured location so the prefix-parse boundary (Epsil) can
    // offset-shift the error to an absolute source position. These extra
    // properties are additive and ignored by the existing `parseType()`
    // callers, which only read `.message`.
    const err = new Error(formattedMessage.join('\n')) as Error & {
      position?: number;
      rawMessage?: string;
      code?: string;
    };
    err.position = token.position;
    err.rawMessage = message;
    if (code !== undefined) err.code = code;
    throw err;
  }

  private advance(): Token {
    const prev = this.current;
    this._end = prev.position + prev.value.length;
    this.current = this.lexer.consumeToken();
    return prev;
  }

  private match(type: TokenType): boolean {
    if (this.current.type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType): Token {
    if (this.current.type !== type) {
      this.error(`Expected ${type}, got ${this.current.type}`);
    }
    return this.advance();
  }

  private createNode<T extends ASTNode>(
    kind: string,
    additional: Partial<T> = {}
  ): T {
    return {
      kind,
      position: this.current.position,
      line: this.current.line,
      column: this.current.column,
      ...additional,
    } as T;
  }

  parseType(): TypeNode {
    // Check for naked function signature pattern at the start
    this.checkForNakedFunctionSignature();

    const type = this.allowWhere
      ? this.parseConstrainedType()
      : this.parseUnionType();
    if (!type) {
      this.error('Expected a type');
    }

    if (this.current.type !== 'EOF') {
      // Check if this looks like a function signature without parentheses
      if (
        this.current.type === '->' ||
        this.current.type === '+' ||
        this.current.type === '*' ||
        this.current.type === '?'
      ) {
        this.error(
          'Function signatures must be enclosed in parentheses',
          'For example `(x: number) -> number`'
        );
      } else if (
        this.current.type === 'IDENTIFIER' &&
        isEffectLabel(this.current.value)
      ) {
        // An effect specifier slot only exists after a *parenthesized*
        // argument list, so `real random -> real` is a naked signature.
        this.error(
          'Function signatures must be enclosed in parentheses',
          'For example `(real) random -> real`'
        );
      } else if (this.current.type === '(') {
        // Check if this looks like invalid syntax like set(integer) or collection(integer)
        const input = this.lexer.input;
        if (
          input.includes('set(') ||
          input.includes('collection(') ||
          input.includes('list(') ||
          input.includes('tuple(')
        ) {
          if (input.includes('set(')) {
            this.error('Use `set<integer>` instead of `set(integer)`.');
          } else if (input.includes('collection(')) {
            this.error(
              'Use `collection<type>` instead of `collection(type)`.',
              'For example `collection<number>`'
            );
          } else if (input.includes('list(')) {
            this.error(
              'Use `list<type>` instead of `list(type)`.',
              'For example `list<number>`'
            );
          } else if (input.includes('tuple(')) {
            this.error(
              'Use `tuple<type1, type2>` instead of `tuple(type1, type2)`.',
              'For example `tuple<string, number>`'
            );
          }
        } else {
          this.error('Unexpected token after type');
        }
      } else {
        this.error('Unexpected token after type');
      }
    }

    return type;
  }

  /**
   * Parse a type from the *start* of the input, stopping at the first token
   * that cannot continue the type (no EOF is required). Requires the parser to
   * have been constructed with `{ allowTrailing: true }`. After a successful
   * parse, `endOffset` is the offset just past the type.
   */
  parseTypePrefix(): TypeNode {
    // Check for naked function signature pattern at the start (a genuine error
    // even in prefix mode, e.g. `real -> real` without parentheses).
    this.checkForNakedFunctionSignature();

    const type = this.allowWhere
      ? this.parseConstrainedType()
      : this.parseUnionType();
    if (!type) this.error('Expected a type');

    // No EOF check: trailing tokens belong to the surrounding (Epsil) grammar.
    return type;
  }

  private checkForNakedFunctionSignature(): void {
    // Look for patterns like "identifier:" or "identifier modifier ->" that suggest
    // an attempt at a naked function signature
    if (this.current.type === 'IDENTIFIER') {
      // Save current state to restore after lookahead
      const savedState = this.lexer.saveState();
      const savedCurrent = this.current;

      try {
        // Look ahead to see if this matches a naked function signature pattern
        const identifierToken = this.current;
        this.advance(); // consume identifier

        // Check for colon (named argument pattern)
        if ((this.current as Token).type === ':') {
          this.advance(); // consume colon

          // Try to find arrow or modifier tokens that suggest function signature
          let foundSignatureTokens = false;
          let tokenCount = 0;
          const maxLookahead = 10; // Prevent infinite lookahead

          while (
            (this.current as Token).type !== 'EOF' &&
            tokenCount < maxLookahead
          ) {
            if ((this.current as Token).type === '->') {
              foundSignatureTokens = true;
              break;
            }
            if (
              (this.current as Token).type === '+' ||
              (this.current as Token).type === '*' ||
              (this.current as Token).type === '?'
            ) {
              // Look ahead one more token to see if arrow follows
              this.advance();
              if ((this.current as Token).type === '->') {
                foundSignatureTokens = true;
                break;
              }
              tokenCount++;
            }
            this.advance();
            tokenCount++;
          }

          if (foundSignatureTokens) {
            // Restore state and throw error at the identifier position
            this.lexer.restoreState(savedState);
            this.current = savedCurrent;
            this.errorAtToken(
              identifierToken,
              'Function signatures must be enclosed in parentheses',
              'For example `(z: string*) -> boolean`'
            );
          }
        }

        // Restore state for normal parsing
        this.lexer.restoreState(savedState);
        this.current = savedCurrent;
      } catch (error) {
        // Restore state if any error occurs during lookahead
        this.lexer.restoreState(savedState);
        this.current = savedCurrent;
        // Re-throw only if it's our intended error
        if (
          error instanceof Error &&
          error.message.includes('Function signatures must be enclosed')
        ) {
          throw error;
        }
      }
    }
  }

  private parseUnionType(): TypeNode | undefined {
    const firstType = this.parseIntersectionType();
    if (!firstType) return undefined;

    const types: TypeNode[] = [firstType];

    while (this.match('|')) {
      const type = this.parseIntersectionType();
      if (!type) {
        this.error('Expected type after |');
      }
      types.push(type);
    }

    if (types.length === 1) return types[0];
    return this.createNode<UnionTypeNode>('union', { types });
  }

  private parseIntersectionType(): TypeNode | undefined {
    const firstType = this.parsePrimaryType();
    if (!firstType) return undefined;

    const types: TypeNode[] = [firstType];

    while (this.match('&')) {
      const type = this.parsePrimaryType();
      if (!type) {
        this.error('Expected type after &');
      }
      types.push(type);
    }

    if (types.length === 1) return types[0];
    return this.createNode<IntersectionTypeNode>('intersection', { types });
  }

  /** True when `name` is quantified by an enclosing `where` clause. */
  private isTypeVariable(name: string): boolean {
    for (let i = this._typeVarScopes.length - 1; i >= 0; i--)
      if (this._typeVarScopes[i].has(name)) return true;
    return false;
  }

  /**
   * `<union_type> ( <where_clause> )?` — a type optionally carrying a
   * trailing `where` clause.
   *
   * Because the clause TRAILS the body, the parse is in three phases (the
   * binding strategy of `docs/TYPE-SYSTEM.md`):
   *
   * 1. **Pre-scan** ({@link scanWhereClauseNames}): a purely lexical scan for
   *    a depth-0 `where`, collecting the clause's names. Resolves nothing, so
   *    no resolver side effects fire.
   * 2. **Seed**: the names are pushed as a type-variable scope, exactly as an
   *    enclosing quantifier would have, so a quantified name shadows a nominal
   *    of the same name throughout the body (the D13 shadowing contract).
   * 3. **Parse**: the body, then the clause itself ({@link parseWhereClause}),
   *    whose bounds are parsed with ALL names already in scope (the
   *    seed-all-names-then-parse-all-bounds rule — a bound referencing a
   *    clause variable parses, and fails validation, not parsing).
   *
   * A clause on anything other than a signature — and any nested clause —
   * parses, and is rejected when the declared type is validated
   * (`unsupported-variable-position`).
   */
  private parseConstrainedType(): TypeNode | undefined {
    const names = this.scanWhereClauseNames();
    if (names !== null) {
      // Even if the clause parse below never runs (a divergent body parse),
      // the seeded names may have produced variable nodes: keep the
      // declaration-time validation gate ON.
      this._sawWhere = true;
      this._typeVarScopes.push(new Set(names));
    }
    try {
      const body = this.parseUnionType();
      if (!body) return undefined;

      if (
        this.current.type === 'IDENTIFIER' &&
        this.current.value === 'where'
      ) {
        const typeParams = this.parseWhereClause();
        return this.createNode<ConstrainedTypeNode>('constrained', {
          typeParams,
          body,
        });
      }
      return body;
    } finally {
      if (names !== null) this._typeVarScopes.pop();
    }
  }

  /**
   * Phase 0: locate a depth-0 `where` clause ahead of the cursor and collect
   * its variable NAMES, purely lexically — nothing is resolved, so no
   * side effects (`typeResolver.forward()` registration) can fire for a name
   * that the clause later reclassifies as a variable.
   *
   * The scan runs on a fresh, TOLERANT lexer over the remaining input: the
   * first character that cannot begin a type token ends the scan (the same
   * rule that ends a prefix parse), so `= 5` and other trailing (non-type)
   * source bound the search for free. The scan additionally stops at a depth-0
   * `,` (inside a single type, commas only occur bracketed — a depth-0 comma
   * means the type already ended) and when the bracket depth goes negative
   * (the closing delimiter of the surrounding construct).
   *
   * Braces nest like the other brackets, so a `where` clause after a record
   * field list (`record{a: T} where T`) is still found, while a `where`
   * INSIDE braces is not at depth 0 and is ignored — which is what an Epsil
   * block body following a bare `record` return type would be.
   *
   * Returns the clause names, or `null` when no clause is in range.
   */
  private scanWhereClauseNames(): string[] | null {
    const input = this.lexer.input;
    const start = this.current.position;
    // Fast path: no `where` anywhere ahead — skip the token scan entirely.
    if (!input.includes('where', start)) return null;

    const lexer = new Lexer(input.slice(start), { tolerant: true });
    let depth = 0;
    let token = lexer.consumeToken();
    while (token.type !== 'EOF') {
      switch (token.type) {
        case '(':
        case '<':
        case '[':
        case '{':
          depth += 1;
          break;
        case ')':
        case '>':
        case ']':
        case '}':
          depth -= 1;
          if (depth < 0) return null;
          break;
        case ',':
          if (depth === 0) return null;
          break;
        case 'IDENTIFIER':
          if (depth === 0 && token.value === 'where') {
            // Found the clause: collect the first identifier of each
            // depth-0 comma-separated entry.
            const names: string[] = [];
            token = lexer.consumeToken();
            for (;;) {
              if (token.type !== 'IDENTIFIER') return names;
              names.push(token.value);
              // Skip the rest of this entry (bound, `is` protocols) to the
              // next depth-0 `,` — bounds are types and may contain
              // bracketed commas of their own.
              let entryDepth = 0;
              token = lexer.consumeToken();
              while (token.type !== 'EOF') {
                if (
                  token.type === '(' ||
                  token.type === '<' ||
                  token.type === '[' ||
                  token.type === '{'
                )
                  entryDepth += 1;
                else if (
                  token.type === ')' ||
                  token.type === '>' ||
                  token.type === ']' ||
                  token.type === '}'
                ) {
                  entryDepth -= 1;
                  if (entryDepth < 0) return names;
                } else if (token.type === ',' && entryDepth === 0) break;
                token = lexer.consumeToken();
              }
              if (token.type === 'EOF') return names;
              token = lexer.consumeToken(); // past the ','
            }
          }
          break;
      }
      token = lexer.consumeToken();
    }
    return null;
  }

  /**
   * The trailing clause itself:
   * `where <var_decl> ("," <var_decl>)*`, where
   * `<var_decl> ::= <name> (":" <bound>)? ("is" <protocol> ("&" <protocol>)*)?`.
   *
   * The cursor is on the `where` identifier. The clause's names are already
   * in scope (seeded by {@link parseConstrainedType}), so a bound referencing
   * a clause variable — its own name or a later one — PARSES here and is
   * rejected by the declaration-time validation instead (the
   * order-independence rule, W2).
   */
  private parseWhereClause(): TypeParamNode[] {
    this._sawWhere = true;
    this.advance(); // consume 'where'

    const seen = new Set<string>();
    const typeParams: TypeParamNode[] = [];
    do {
      if (this.current.type !== 'IDENTIFIER')
        this.error(
          'Expected a type variable name after `where`',
          'For example `(T) -> T where T`'
        );
      const nameToken = this.current;
      const name = this.advance().value;
      if (name === 'where')
        this.errorAtToken(nameToken, 'The type name `where` is reserved');
      if (seen.has(name))
        this.errorAtToken(
          nameToken,
          `The type variable \`${name}\` is declared more than once`
        );
      seen.add(name);

      let bound: TypeNode | undefined;
      if (this.match(':')) {
        bound = this.parseUnionType();
        if (!bound)
          this.error(
            `Expected a type after the bound of \`${name}\``,
            'For example `(T) -> T where T: number`'
          );
      }

      // The `is` protocol-conformance slot: parsed and stored here, checked
      // at each call site by the solver against the resolver's conformance
      // oracle (protocols design P19).
      let protocols: string[] | undefined;
      if (this.current.type === 'IDENTIFIER' && this.current.value === 'is') {
        this.advance(); // consume 'is'
        protocols = [];
        do {
          if (this.current.type !== 'IDENTIFIER')
            this.error(
              `Expected a protocol name after \`is\``,
              'For example `(T) -> T where T: collection is Hashable`'
            );
          protocols.push(this.advance().value);
        } while (this.match('&'));
      }

      typeParams.push(
        this.createNode<TypeParamNode>('type_param', { name, bound, protocols })
      );
    } while (this.match(','));

    return typeParams;
  }

  /**
   * The migration diagnostic for the removed prefix `forall` syntax: an
   * identifier `forall` followed by an identifier and one of `:` `,` `.` can
   * only be a leftover `forall T. …` clause — two adjacent identifiers are
   * never a valid type — so fail with a message that names the replacement
   * rather than a generic unknown-type error.
   */
  private checkForLegacyForall(): void {
    const savedState = this.lexer.saveState();
    const savedCurrent = this.current;
    const forallToken = this.current;
    let isLegacy = false;
    try {
      this.advance(); // consume 'forall'
      if ((this.current as Token).type === 'IDENTIFIER') {
        this.advance();
        const t = (this.current as Token).type;
        isLegacy = t === ':' || t === ',' || t === '.';
      }
    } finally {
      this.lexer.restoreState(savedState);
      this.current = savedCurrent;
    }
    if (isLegacy)
      this.errorAtToken(
        forallToken,
        'The `forall T. …` prefix syntax was replaced by a trailing `where` clause',
        'For example `(T) -> T where T: number`'
      );
  }

  private parsePrimaryType(): TypeNode | undefined {
    // Occurrences of clause-quantified names. The variable check comes first:
    // within its arm a quantified name shadows every other reading of the
    // identifier (primitive, nominal, or resolver-provided).
    if (this.current.type === 'IDENTIFIER') {
      if (this.isTypeVariable(this.current.value)) {
        const name = this.advance().value;
        return this.createNode<TypeVariableNode>('type_variable', { name });
      }
      // A leftover of the REMOVED prefix `forall` syntax gets a targeted
      // migration diagnostic instead of a generic unknown-type error.
      if (this.current.value === 'forall') this.checkForLegacyForall();
    }

    // Try negation
    if (this.match('!')) {
      const type = this.parsePrimaryType();
      if (!type) {
        this.error('Expected type after !');
      }
      return this.createNode<NegationTypeNode>('negation', { type });
    }

    // Try grouped type or function signature
    if (this.current.type === '(') {
      // Try function signature first with lookahead
      const signature = this.parseFunctionSignature();
      if (signature) return signature;

      // Fall back to grouped type or parenthesized tuple. A parenthesized
      // type may carry its own trailing `where` clause — the per-arm
      // overload-set spelling `((list<T>) -> T where T) & …` — so the group
      // parses a CONSTRAINED type, regardless of `allowWhere` (the
      // parentheses delimit the clause unambiguously).
      if (this.match('(')) {
        const firstType = this.parseConstrainedType();
        if (!firstType) {
          this.error('Expected type after (');
        }

        // If comma follows, this is a parenthesized tuple: (type1, type2, ...)
        if ((this.current as Token).type === ',') {
          const elements: NamedElementNode[] = [
            this.createNode<NamedElementNode>('named_element', {
              name: undefined,
              type: firstType,
            }),
          ];
          while (this.match(',')) {
            const type = this.parseUnionType();
            if (!type) {
              this.error('Expected type after ,');
            }
            elements.push(
              this.createNode<NamedElementNode>('named_element', {
                name: undefined,
                type,
              })
            );
          }
          this.expect(')');
          return this.createNode<TupleTypeNode>('tuple', { elements });
        }

        this.expect(')');
        return this.createNode<GroupTypeNode>('group', { type: firstType });
      }
    }

    // Try various type constructs
    return (
      this.parseListType() ||
      this.parseTupleType() ||
      this.parseRecordType() ||
      this.parseObjectType() ||
      this.parseDictionaryType() ||
      this.parseSetType() ||
      this.parseBroadcastableType() ||
      this.parseCallbackType() ||
      this.parseCollectionType() ||
      this.parseExpressionType() ||
      this.parseSymbolType() ||
      this.parseNumericType() ||
      this.parsePrimitiveType() ||
      this.parseValue() ||
      this.parseTypeReference()
    );
  }

  /**
   * Scan forward from the current '(' to determine if this is a function
   * signature (i.e. `(...)  ->`) without consuming any tokens. Tracks
   * parenthesis depth so nested parens like `((string|number), expr?)` are
   * handled correctly.
   */
  private isFunctionSignature(): boolean {
    const savedLexerState = this.lexer.saveState();
    const savedCurrent = this.current;

    // We expect current token to be '('
    this.advance(); // consume '('
    let depth = 1;

    while (depth > 0 && (this.current as Token).type !== 'EOF') {
      if ((this.current as Token).type === '(') depth++;
      else if ((this.current as Token).type === ')') depth--;
      this.advance();
    }

    // After exiting, we've consumed the matching ')'. Skip over an effect
    // specifier slot (bare identifiers, or a reserved `!`) before checking for
    // '->'. The slot's contents are validated in `parseEffectSpecifiers()`;
    // here we only need to know whether an arrow follows. If it does not, the
    // fall-through (group/tuple) parse produces the same diagnostic it always
    // has for a stray token after `)`.
    while (
      (this.current as Token).type === 'IDENTIFIER' ||
      (this.current as Token).type === '!'
    )
      this.advance();

    const isSignature = (this.current as Token).type === '->';

    this.lexer.restoreState(savedLexerState);
    this.current = savedCurrent;
    return isSignature;
  }

  /**
   * Parse the effect specifier slot: bare, space-separated labels between the
   * closing paren of the argument list and the `->` (the Swift specifier-slot
   * placement).
   *
   * Returns the effect set the slot denotes: `undefined` for an EMPTY slot
   * (effects unstated), `[]` for the `pure` keyword — the same (empty) set,
   * explicitly stated, and the only spelling that serializes back as ` pure`.
   *
   * The slot is positionally isolated, so an identifier here can only be an
   * effect label (or `any`/`pure`): every rule below fails closed.
   */
  private parseEffectSpecifiers(): EffectSet | undefined {
    // Fast path: the overwhelmingly common (unannotated) case allocates
    // nothing.
    if (this.current.type !== 'IDENTIFIER' && this.current.type !== '!')
      return undefined;

    let sawAny = false;
    let sawPure = false;
    const labels: EffectLabel[] = [];

    while (this.current.type === 'IDENTIFIER' || this.current.type === '!') {
      if (this.current.type === '!') {
        this.error(
          'The `!` effect complement form is reserved and not yet supported',
          'Enumerate the effect labels instead, for example `(real) console scope -> real`'
        );
      }

      const token = this.current;
      const name = token.value;
      this.advance();

      // `pure` is the explicitly-stated EMPTY set: exclusive with every label
      // and with `any`, exactly as `any` is, and not repeatable.
      if (name === 'pure') {
        if (labels.length > 0 || sawAny || sawPure)
          this.errorAtToken(
            token,
            '`pure` cannot be combined with other effect labels',
            'Use `pure` alone to mean "no effects", or omit it entirely'
          );
        sawPure = true;
        continue;
      }

      if (sawPure)
        this.errorAtToken(
          token,
          '`pure` cannot be combined with other effect labels',
          'Use `pure` alone to mean "no effects", or omit it entirely'
        );

      if (name === 'any') {
        if (labels.length > 0 || sawAny)
          this.errorAtToken(
            token,
            '`any` cannot be combined with other effect labels',
            'Use `any` alone to mean "unknown effects"'
          );
        sawAny = true;
        continue;
      }

      if (sawAny)
        this.errorAtToken(
          token,
          '`any` cannot be combined with other effect labels',
          'Use `any` alone to mean "unknown effects"'
        );

      if (!isEffectLabel(name))
        this.errorAtToken(
          token,
          `Unknown effect label \`${name}\``,
          `The effect labels are ${EFFECT_LABELS.join(', ')}`
        );

      if (labels.includes(name))
        this.errorAtToken(token, `Duplicate effect label \`${name}\``);

      labels.push(name);
    }

    // `pure` is the STATED empty set: representable, and serialization-
    // distinct from the empty slot (`undefined`).
    if (sawPure) return [];
    if (sawAny) return 'any';
    // The slot only exists when a label was read, so `labels` is non-empty
    // here.
    return labels.sort();
  }

  private parseFunctionSignature(): FunctionSignatureNode | undefined {
    if (this.current.type !== '(' || !this.isFunctionSignature()) {
      return undefined;
    }

    const args: ArgumentNode[] = [];
    // The first token of each argument, so an ordering error can point at the
    // offending argument rather than at the end of the signature.
    const argTokens: Token[] = [];

    this.advance(); // consume '('

    // Parse arguments
    if (!this.match(')')) {
      do {
        const argToken = this.current;
        const arg = this.parseArgument();
        if (!arg) {
          this.error('Expected argument');
        }
        args.push(arg);
        argTokens.push(argToken);
      } while (this.match(','));

      this.expect(')');
    }

    // The effect specifier slot, between the argument list and the arrow
    const effects = this.parseEffectSpecifiers();

    // We know '->' is present from the lookahead
    this.expect('->');

    const returnType = this.parseUnionType();
    if (!returnType) {
      this.error('Expected return type after ->');
    }

    // Validate argument combinations
    const hasOptional = args.some((arg) => arg.modifier === 'optional');
    const hasVariadic = args.some(
      (arg) =>
        arg.modifier === 'variadic_zero' || arg.modifier === 'variadic_one'
    );
    const variadicCount = args.filter(
      (arg) =>
        arg.modifier === 'variadic_zero' || arg.modifier === 'variadic_one'
    ).length;

    if (hasOptional && hasVariadic) {
      this.error(VARIADIC_WITH_OPTIONAL_MESSAGE);
    }

    if (variadicCount > 1) {
      this.error('There can be only one variadic argument');
    }

    // The consumption model is positional and bins arguments by MODIFIER, not
    // by source order: required arguments, then optional ones, then the
    // variadic. Any other order would be silently re-ordered into that model —
    // `(collection+, mapping: function)` would mean `(mapping, ...collection)`
    // — so it is a parse error rather than a reinterpretation.
    let sawOptional = false;
    let sawVariadic = false;
    for (let i = 0; i < args.length; i++) {
      const modifier = args[i].modifier;
      if (sawVariadic) {
        this.errorAtToken(
          argTokens[i],
          'A variadic argument must be the last argument'
        );
      }
      if (modifier === 'variadic_zero' || modifier === 'variadic_one') {
        sawVariadic = true;
      } else if (modifier === 'optional') {
        sawOptional = true;
      } else if (sawOptional) {
        this.errorAtToken(
          argTokens[i],
          'A required argument cannot follow an optional argument'
        );
      }
    }

    return this.createNode<FunctionSignatureNode>('function_signature', {
      arguments: args,
      effects,
      returnType,
    });
  }

  private parseArgument(): ArgumentNode | undefined {
    const element = this.parseNamedElement();
    if (!element) return undefined;

    let modifier: 'optional' | 'variadic_zero' | 'variadic_one' | undefined;

    if (this.match('?')) {
      modifier = 'optional';
    } else if (this.match('*')) {
      modifier = 'variadic_zero';
    } else if (this.match('+')) {
      modifier = 'variadic_one';
    }

    return this.createNode<ArgumentNode>('argument', { element, modifier });
  }

  private parseNamedElement(): NamedElementNode | undefined {
    let name: string | undefined;

    // Look ahead to see if this is a named element pattern: "identifier :"
    if (
      this.current.type === 'IDENTIFIER' ||
      this.current.type === 'VERBATIM_STRING'
    ) {
      // Use peekToken to look ahead without consuming tokens
      const nameToken = this.current;
      const nextToken = this.lexer.peekToken();

      // Check if next token is colon
      if (nextToken.type === ':') {
        // This is a named element
        name = nameToken.value;
        this.advance(); // consume identifier
        this.advance(); // consume colon

        // Parse the type after the colon
        const type = this.parseUnionType();
        if (!type) return undefined;
        return this.createNode<NamedElementNode>('named_element', {
          name,
          type,
        });
      }
      // If not a named element, fall through to parse as type without advancing
    }

    // Parse a type without a name
    const type = this.parseUnionType();
    if (!type) return undefined;

    return this.createNode<NamedElementNode>('named_element', {
      name: undefined,
      type,
    });
  }

  private parseListType(): TypeNode | undefined {
    if (this.current.type === 'IDENTIFIER') {
      const typeToken = this.current;

      // Look ahead to see if this is a generic type (followed by <)
      const nextToken = this.lexer.peekToken();
      const isGeneric = nextToken.type === '<';

      switch (typeToken.value) {
        case 'list':
          if (isGeneric) {
            this.advance();
            return this.parseListTypeImpl();
          }
          return undefined; // Let primitive parser handle bare 'list'
        case 'vector':
          if (isGeneric) {
            this.advance();
            return this.parseVectorType();
          }
          // Bare `vector` is a rank-1 list of numbers with an open length.
          // Build it as a VECTOR node rather than a plain list so it picks up
          // the open-length dimension `[-1]` that `visitVectorType` supplies:
          // a list node with no dimensions is rank-UNCONSTRAINED, which is a
          // different (weaker) type, and bare `matrix` already defaults to
          // `[-1, -1]` the same way.
          this.advance();
          return this.createNode<VectorTypeNode>('vector', {
            elementType: this.createNode<PrimitiveTypeNode>('primitive', {
              name: 'number',
            }),
            size: undefined,
          });
        case 'matrix':
          if (isGeneric) {
            this.advance();
            return this.parseMatrixType();
          }
          // Handle bare 'matrix' as default 2D matrix of numbers
          this.advance();
          return this.createNode<MatrixTypeNode>('matrix', {
            elementType: this.createNode<PrimitiveTypeNode>('primitive', {
              name: 'number',
            }),
            dimensions: [
              this.createNode<DimensionNode>('dimension', { size: -1 }),
              this.createNode<DimensionNode>('dimension', { size: -1 }),
            ],
          });
        case 'tensor':
          if (isGeneric) {
            this.advance();
            return this.parseTensorType();
          }
          // Handle bare 'tensor' as default list of numbers
          this.advance();
          return this.createNode<ListTypeNode>('list', {
            elementType: this.createNode<PrimitiveTypeNode>('primitive', {
              name: 'number',
            }),
            dimensions: undefined,
          });
        default:
          return undefined;
      }
    }
    return undefined;
  }

  private parseListTypeImpl(): ListTypeNode {
    // A `list` spelling with no explicit element type (e.g. a dimensioned
    // `list<2x3>`) defaults to `unknown` — bare `list` is the `list<unknown>`
    // synonym (user ruling 2026-08-17). Not `any`: that is the wider,
    // absence-admitting contract and must stay explicit.
    let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
      'primitive',
      { name: 'unknown' }
    );
    let dimensions: DimensionNode[] | undefined;

    if (this.match('<')) {
      // Try leading dimensions first (e.g. `list<2x3>`)
      dimensions = this.parseDimensions();

      if (!dimensions) {
        // Parse element type
        const type = this.parseUnionType();
        if (type) {
          elementType = type;

          // Dimensions after the element type (e.g. `list<integer^2x3>`)
          if (this.match('^')) {
            dimensions = this.parseCaretDimensions();
          }
        }
      }

      this.expect('>');
    }

    return this.createNode<ListTypeNode>('list', { elementType, dimensions });
  }

  private parseVectorType(): VectorTypeNode {
    let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
      'primitive',
      { name: 'number' }
    );
    let size: number | undefined;

    if (this.match('<')) {
      // Try to parse size first (for vector<3>)
      if (this.current.type === 'NUMBER_LITERAL') {
        size = parseInt(this.advance().value);
      } else {
        // Try to parse a type
        const type = this.parseUnionType();
        if (type) {
          elementType = type;

          if (this.match('^')) {
            // After match(), current token has advanced
            if ((this.current as Token).type === 'NUMBER_LITERAL') {
              size = parseInt(this.advance().value);
            } else {
              this.error('Expected number after ^');
            }
          }
        }
      }

      this.expect('>');
    }

    return this.createNode<VectorTypeNode>('vector', { elementType, size });
  }

  private parseMatrixType(): MatrixTypeNode {
    let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
      'primitive',
      { name: 'number' }
    );
    let dimensions: DimensionNode[] | undefined;

    if (this.match('<')) {
      // Try to parse leading dimensions first (e.g. `matrix<2x3>`)
      dimensions = this.parseDimensions();

      if (!dimensions) {
        // If no dimensions, try to parse a type
        const type = this.parseUnionType();
        if (type) {
          elementType = type;

          // Dimensions after the element type (e.g. `matrix<integer^(2x3)>`)
          if (this.match('^')) {
            dimensions = this.parseCaretDimensions();
          }
        }
      }

      this.expect('>');
    } else {
      // Default matrix dimensions
      dimensions = [
        this.createNode<DimensionNode>('dimension', { size: null }),
        this.createNode<DimensionNode>('dimension', { size: null }),
      ];
    }

    return this.createNode<MatrixTypeNode>('matrix', {
      elementType,
      dimensions,
    });
  }

  private parseTensorType(): TensorTypeNode {
    let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
      'primitive',
      { name: 'number' }
    );

    if (this.match('<')) {
      const type = this.parseUnionType();
      if (type) {
        elementType = type;
      }
      this.expect('>');
    }

    return this.createNode<TensorTypeNode>('tensor', { elementType });
  }

  private parseDimensions(): DimensionNode[] | undefined {
    const firstDim = this.parseDimension();
    if (!firstDim) return undefined;

    const dimensions: DimensionNode[] = [firstDim];

    // Subsequent dimensions are `x`-separated. The lexer folds `x` into
    // identifiers, so the separator surfaces in two shapes:
    //   - fused with the following sizes:  IDENTIFIER `x3`, `x3x4`
    //   - standalone:                      IDENTIFIER `x`  (e.g. `2x?`, `2 x 3`)
    for (;;) {
      const tok = this.current;
      if (tok.type === 'IDENTIFIER' && /^(x\d+)+$/.test(tok.value)) {
        this.advance();
        for (const m of tok.value.match(/x(\d+)/g)!)
          dimensions.push(
            this.createNode<DimensionNode>('dimension', {
              size: parseInt(m.slice(1)),
            })
          );
      } else if (tok.type === 'IDENTIFIER' && tok.value === 'x') {
        // Standalone separator: a positive integer or `?` must follow.
        const next = this.lexer.peekToken();
        if (next.type !== 'NUMBER_LITERAL' && next.type !== '?')
          this.error(
            'Expected a positive integer literal or `?` after x. For example: `2x3` or `2x?`'
          );
        this.advance(); // consume the `x` separator
        dimensions.push(this.parseDimension()!);
      } else {
        break;
      }
    }

    return dimensions;
  }

  private parseDimension(): DimensionNode | undefined {
    if (this.match('?')) {
      return this.createNode<DimensionNode>('dimension', { size: null });
    }

    if (this.current.type === 'NUMBER_LITERAL') {
      const size = parseInt(this.advance().value);
      return this.createNode<DimensionNode>('dimension', { size });
    }

    return undefined;
  }

  private parseCaretDimensions(): DimensionNode[] | undefined {
    // Dimensions following `^`. The serializer parenthesizes multi-dimensional
    // element types, e.g. `matrix<integer^(2x3)>` and `list<integer^(2x3)>`,
    // so accept an optional surrounding `( … )`.
    const paren = this.match('(');
    const dimensions = this.parseDimensions();
    if (paren) this.expect(')');
    return dimensions;
  }

  private parseTupleType(): TupleTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER' && this.current.value === 'tuple') {
      // Look ahead to see if this is a generic tuple type
      const nextToken = this.lexer.peekToken();
      if (nextToken.type !== '<') {
        return undefined; // Not a tuple<...> type, let primitive parser handle it
      }

      this.advance(); // consume 'tuple'
      this.expect('<');

      const elements: NamedElementNode[] = [];

      if ((this.current as Token).type !== '>') {
        // Parse first element and determine naming expectation
        const firstElement = this.parseNamedElement();
        if (!firstElement) {
          this.error('Expected tuple element');
        }
        elements.push(firstElement);

        const expectNamedElements = firstElement.name !== undefined;

        // Parse remaining elements and validate naming consistency
        while (this.match(',')) {
          const element = this.parseNamedElement();
          if (!element) {
            this.error('Expected tuple element');
          }

          // Validate naming consistency
          if (expectNamedElements && !element.name) {
            this.error(
              'All tuple elements should be named, or none. ' +
                "Previous elements were named, but this one isn't."
            );
          }
          if (!expectNamedElements && element.name) {
            this.error(
              'All tuple elements should be named, or none. ' +
                'Previous elements were not named, but this one is.'
            );
          }

          elements.push(element);
        }
      }

      this.expect('>');
      return this.createNode<TupleTypeNode>('tuple', { elements });
    }

    return undefined;
  }

  /**
   * Is the current `{` the start of a field list (`record{…}` / `object{…}`),
   * rather than a brace that belongs to the SURROUNDING grammar?
   *
   * The question exists because a type is often parsed as a PREFIX of a larger
   * source text whose next character is a brace: Epsil writes a return-type
   * annotation immediately before the function's block body, so
   * `function f() -> record { let r = …; r }` has a `{` right after a bare
   * `record` type. The rule: the `{` opens a field list only when, after
   * whitespace, it is followed by `}` (the empty field list `record{}`) or by
   * a key — an identifier or a backticked verbatim string — and then a `:`,
   * the head of a field entry. Otherwise the `{` is left unconsumed,
   * `record`/`object` is the bare primitive type, and the brace ends the
   * prefix parse.
   *
   * That head test is enough everywhere the type is NOT followed by a block:
   * an Epsil block body opens with a STATEMENT, and the one statement that can
   * begin with `name :` is a bare type annotation (`x: integer`, see
   * `Parser.tryParseAnnotation` in `src/epsil/parser.ts`) — Epsil's dictionary
   * literal is `{key -> value}`, not `{key: value}`, so nothing else in the
   * brace grammar begins that way. Two shapes would still be misread as field
   * lists though: an EMPTY body (`-> record { }`) and a body whose first
   * statement is a bare annotation (`-> record { x: integer }`).
   *
   * So in the one position where a block MUST follow the type — the return
   * type of a `function` declaration — the caller sets `blockFollows` and a
   * SECOND test applies: the `{` opens a field list only if its depth-matched
   * closing `}` is followed (after whitespace) by the body — another `{`, or a
   * `where` clause and then the body. A field list in that position is always
   * followed by the block, and a block body is not, which decides every case:
   *
   * ```
   * -> record { }                    bare record, empty body
   * -> record { x: integer }         bare record, body = a bare annotation
   * -> record{a: integer} { {a -> 1} }   field list, then the body
   * -> record{a: T} where T { … }        field list, clause, then the body
   * ```
   *
   * The second test is a textual depth-matched brace scan over the lexer
   * input (braces nest; `"…"` and `` `…` `` spans are opaque, so a brace
   * inside a string is not counted).
   *
   * Nothing is consumed: the lexer state, the current token and the
   * prefix-parse end offset are all restored before returning (the end offset
   * matters — on a `false` answer no further token is consumed, so a
   * lookahead that moved it would report the brace as part of the type).
   */
  private startsFieldList(): boolean {
    if (this.current.type !== '{') return false;

    const braceOffset = this.current.position;
    const savedState = this.lexer.saveState();
    const savedCurrent = this.current;
    const savedEnd = this._end;
    let headMatches: boolean;
    try {
      this.advance(); // consume '{'
      const head = this.current as Token;
      if (head.type === '}') headMatches = true;
      else if (head.type !== 'IDENTIFIER' && head.type !== 'VERBATIM_STRING')
        headMatches = false;
      else {
        this.advance(); // consume the candidate key
        headMatches = (this.current as Token).type === ':';
      }
    } finally {
      this.lexer.restoreState(savedState);
      this.current = savedCurrent;
      this._end = savedEnd;
    }

    if (!headMatches) return false;
    return !this.blockFollows || this.blockFollowsFieldList(braceOffset);
  }

  /**
   * The `blockFollows` half of {@link startsFieldList}: starting at the `{` at
   * `braceOffset`, is the depth-matched closing `}` followed by the block the
   * caller is about to parse — either the block's `{`, or a `where` clause
   * (which sits between a return type and the body) and then the block?
   *
   * A `"…"` or `` `…` `` span is skipped whole, so a brace written inside a
   * string literal does not throw the depth count off. An unterminated span,
   * or a `{` with no match, answers `false` — the brace then reads as the
   * caller's, which is the recoverable reading (the caller reports the
   * malformed body).
   */
  private blockFollowsFieldList(braceOffset: number): boolean {
    const src = this.lexer.input;
    let depth = 0;
    let i = braceOffset;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === '`') {
        i += 1;
        while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
        if (i >= src.length) return false; // unterminated string
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (i >= src.length) return false; // no matching '}'

    let j = i + 1;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (j >= src.length) return false;
    return src[j] === '{' || /^where\b/.test(src.slice(j));
  }

  /**
   * Parse the `{ key: type, … }` field list shared by `record` and `object`.
   * The cursor is on the `{`, which {@link startsFieldList} has already
   * confirmed opens a field list.
   */
  private parseFieldList(what: 'record' | 'object'): RecordEntryNode[] {
    const entries: RecordEntryNode[] = [];
    this.expect('{');
    if ((this.current as Token).type !== '}') {
      do {
        const entry = this.parseRecordEntry();
        if (!entry) this.error(`Expected ${what} field`);
        entries.push(entry);
      } while (this.match(','));
    }
    this.expect('}');
    return entries;
  }

  /**
   * `record` — bare, meaning "any record" — and `record{key: T, …}`, a record
   * with a known field set.
   *
   * The field list is written with BRACES, matching the `{…}` value literal a
   * record is built from: braces mean an unordered, keyed field set. Angle
   * brackets, which every other constructor uses (`list<…>`, `tuple<…>`,
   * `Pair<…>`), mean type arguments or an ordered element list. The former
   * angle-bracket spelling (`record<x: integer>`) is therefore refused with a
   * migration hint rather than silently accepted.
   */
  private parseRecordType(): RecordTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER' && this.current.value === 'record') {
      const recordToken = this.current;
      this.advance(); // consume 'record'

      let entries: RecordEntryNode[] = [];

      if (this.startsFieldList()) entries = this.parseFieldList('record');
      else if ((this.current as Token).type === '<')
        this.errorAtToken(
          recordToken,
          'A record type is written with braces: `record{key: type, …}`',
          'For example `record{x: integer, y: integer}`',
          'record-type-angle-brackets'
        );

      return this.createNode<RecordTypeNode>('record', { entries });
    }

    return undefined;
  }

  /**
   * `object` — bare, meaning "any object" — and `object{name: T, …}`, the
   * stored-field layout of an object type.
   *
   * The layout form is admitted only when the parse was started with
   * `allowObjectType`, which the routes that declare a NOMINAL type set and
   * nothing else does. `object{…}` is legal only as the definition of a named
   * type (`type Person = object{…}`): objects are nominal, so an inline
   * occurrence in an annotation (`let x: object{id: string}`) would name a
   * type nothing can ever construct or conform to, and a structural ALIAS to
   * a layout would make two aliases of one shape interchangeable — the
   * subtyping between object types the appendix rules out. Refusing the form
   * here makes every other route fail closed. (The declaring route then
   * additionally rejects an occurrence NESTED inside the body, such as
   * `type T = list<object{…}>`, which is inline by the same rule.) The EMPTY
   * list `object{}` is exempt: it names no layout and builds the bare
   * primitive, so it is admitted on every route.
   *
   * The BARE spelling is unrestricted: it is an ordinary primitive type. The
   * field list uses braces for the same reason a record's does — see
   * {@link parseRecordType} — and the brace/body ambiguity is resolved by
   * {@link startsFieldList}.
   *
   * Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an object
   * type" (the `object-type-not-inline` paragraph).
   */
  private parseObjectType(): ObjectTypeNode | undefined {
    if (this.current.type !== 'IDENTIFIER' || this.current.value !== 'object')
      return undefined;

    const objectToken = this.current;
    this.advance(); // consume 'object'

    let entries: RecordEntryNode[] = [];

    if (this.startsFieldList()) {
      entries = this.parseFieldList('object');

      // The inline restriction is about a nominal LAYOUT, so it applies only
      // once there is at least one field. An empty list declares no layout —
      // the type builder collapses zero entries to the bare `object` primitive
      // (`visitObjectType` in `type-builder.ts`) — so `object{}` is admitted
      // everywhere the bare spelling is.
      if (entries.length > 0 && !this.allowObjectType)
        this.errorAtToken(
          objectToken,
          'An `object{…}` type may only be the definition of a named type',
          'Object types are nominal: declare one with `type Person = object{…}` (not `type alias`), then refer to `Person` here',
          'object-type-not-inline'
        );
    } else if ((this.current as Token).type === '<')
      this.errorAtToken(
        objectToken,
        'An object type is written with braces: `object{field: type, …}`',
        'For example `type Person = object{name: string, age: integer}`',
        'object-type-angle-brackets'
      );

    return this.createNode<ObjectTypeNode>('object', { entries });
  }

  private parseRecordEntry(): RecordEntryNode | undefined {
    let key: string;

    if (this.current.type === 'IDENTIFIER') {
      key = this.advance().value;
    } else if (this.current.type === 'VERBATIM_STRING') {
      key = this.advance().value;
    } else {
      return undefined;
    }

    this.expect(':');

    const valueType = this.parseUnionType();
    if (!valueType) {
      this.error('Expected value type');
    }

    return this.createNode<RecordEntryNode>('record_entry', { key, valueType });
  }

  private parseDictionaryType(): DictionaryTypeNode | undefined {
    if (
      this.current.type === 'IDENTIFIER' &&
      this.current.value === 'dictionary'
    ) {
      this.advance();

      // A bare `dictionary` defaults its value type to `unknown`, which the
      // type builder collapses back to the bare primitive (they are synonyms
      // — user ruling 2026-08-17). It must not default to `any`: that is the
      // wider, absence-admitting contract, and the old `any` default made
      // the bare spelling in a union (`indexed_collection | dictionary`)
      // surface as `dictionary<any>`.
      let valueType: TypeNode = this.createNode<PrimitiveTypeNode>(
        'primitive',
        { name: 'unknown' }
      );

      if (this.match('<')) {
        const type = this.parseUnionType();
        if (type) {
          valueType = type;
        }
        this.expect('>');
      }

      return this.createNode<DictionaryTypeNode>('dictionary', { valueType });
    }

    return undefined;
  }

  private parseSetType(): SetTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER' && this.current.value === 'set') {
      // As with `list`, leave a bare constructor to the primitive parser. This
      // preserves the distinction between omitted and explicit element types:
      // `set` is bare, while `set<any>` retains the stated `any` contract.
      if (this.lexer.peekToken().type !== '<') return undefined;

      this.advance();

      // Defensive default only — the bare-constructor check above routes
      // `set` without `<` to the primitive parser. `unknown` (not `any`) for
      // the same reason as `parseDictionaryType` above.
      let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
        'primitive',
        { name: 'unknown' }
      );

      if (this.match('<')) {
        const type = this.parseUnionType();
        if (type) {
          elementType = type;
        }
        this.expect('>');
      }

      return this.createNode<SetTypeNode>('set', { elementType });
    }

    return undefined;
  }

  private parseBroadcastableType(): BroadcastableTypeNode | undefined {
    if (
      this.current.type === 'IDENTIFIER' &&
      this.current.value === 'broadcastable'
    ) {
      this.advance();

      let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
        'primitive',
        { name: 'any' }
      );

      if (this.match('<')) {
        const type = this.parseUnionType();
        if (type) {
          elementType = type;
        }
        this.expect('>');
      }

      return this.createNode<BroadcastableTypeNode>('broadcastable', {
        elementType,
      });
    }

    return undefined;
  }

  /**
   * The RETIRED `callback<…>` constructor (Design E,
   * `docs/TYPE-SYSTEM.md`): callback
   * slots are ordinary arrow types now, admitted by compatibility rather than
   * subtyping, so the constructor no longer exists. A signature that still
   * spells it fails LOUDLY with a migration hint instead of silently resolving
   * to a same-named user type — the bare spelling (`type alias callback = …`,
   * used without `<`) remains an ordinary type reference.
   */
  private parseCallbackType(): TypeNode | undefined {
    if (this.current.type !== 'IDENTIFIER' || this.current.value !== 'callback')
      return undefined;
    if (this.lexer.peekToken().type !== '<') return undefined;
    this.error(
      'The `callback<…>` constructor was retired: write the arrow directly (e.g. `(T) any -> boolean`) — callback operands are admitted by compatibility, not subtyping'
    );
    return undefined;
  }

  private parseCollectionType(): CollectionTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER') {
      const isIndexed = this.current.value === 'indexed_collection';
      const isGeneric = this.current.value === 'collection';

      if (isIndexed || isGeneric) {
        this.advance();

        // The default element of a BARE `collection`/`indexed_collection` is
        // `unknown`, which the type builder collapses back to the bare
        // primitive (they are synonyms — user ruling 2026-08-17). It must
        // not be `any`: that is the strictly wider, absence-admitting
        // contract, and defaulting to it silently widened the bare spelling.
        let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
          'primitive',
          { name: 'unknown' }
        );

        if (this.match('<')) {
          const type = this.parseUnionType();
          if (type) {
            elementType = type;
          }
          this.expect('>');
        }

        return this.createNode<CollectionTypeNode>('collection', {
          elementType,
          indexed: isIndexed,
        });
      }
    }

    return undefined;
  }

  private parseExpressionType(): ExpressionTypeNode | undefined {
    if (
      this.current.type === 'IDENTIFIER' &&
      this.current.value === 'expression'
    ) {
      // Look ahead to see if this is a generic expression type
      const nextToken = this.lexer.peekToken();
      if (nextToken.type !== '<') {
        return undefined; // Not an expression<...> type, let primitive parser handle it
      }

      this.advance(); // consume 'expression'
      this.expect('<');

      const operatorToken = this.expect('IDENTIFIER');
      const operator = operatorToken.value;

      this.expect('>');

      return this.createNode<ExpressionTypeNode>('expression', { operator });
    }

    return undefined;
  }

  private parseSymbolType(): SymbolTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER' && this.current.value === 'symbol') {
      // Look ahead to see if this is a generic symbol type
      const nextToken = this.lexer.peekToken();
      if (nextToken.type !== '<') {
        return undefined; // Not a symbol<...> type, let primitive parser handle it
      }

      this.advance(); // consume 'symbol'
      this.expect('<');

      const nameToken = this.expect('IDENTIFIER');
      const name = nameToken.value;

      this.expect('>');

      return this.createNode<SymbolTypeNode>('symbol', { name });
    }

    return undefined;
  }

  private parseNumericType(): NumericTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER') {
      const numericTypes = [
        'real',
        'finite_real',
        'rational',
        'finite_rational',
        'integer',
        'finite_integer',
      ];

      if (numericTypes.includes(this.current.value)) {
        const baseType = this.advance().value;

        if (this.match('<')) {
          const lowerBound = this.parseValue();
          // `0<..` — the lower bound is excluded ("0 < x"); `..<3` — the
          // upper bound is excluded ("x < 3"). Both markers are compound
          // lexer tokens, so adjacency is mandatory. A marker without a
          // bound (`<<..`, `..<>`) is an error: openness needs an endpoint.
          // Token shapes: `0..3` → `..`; `0<..3` → `<..`; `0..<3` → `..<`;
          // `0<..<3` → `<..` then a bare `<` (the lexer's `<..` took the
          // shared `..`, leaving the upper marker as its own `<` token —
          // adjacency is already guaranteed by the lexer, see `<..` there).
          let lowerOpen = false;
          let upperOpen = false;
          if (this.match('<..')) {
            lowerOpen = true;
            // The doubly-open form lexes the upper marker as a bare `<`;
            // enforce the adjacency the compound `..<` token enforces
            // (`0<..< 3` is rejected like `0..< 3`).
            const marker: Token = this.current;
            if (marker.type === '<') {
              this.advance();
              // The bound token must start exactly where the `<` ended,
              // with no whitespace between.
              if (this.current.position !== marker.position + 1)
                this.error(
                  'Invalid numeric type',
                  'The `<` marker must touch its bound'
                );
              upperOpen = true;
            }
          } else if (this.match('..<')) {
            upperOpen = true;
          } else {
            this.expect('..');
          }
          const upperBound = this.parseValue();
          this.expect('>');
          if (lowerOpen && lowerBound === undefined)
            this.error(
              'Invalid numeric type',
              'An open lower bound needs a bound value'
            );
          if (upperOpen && upperBound === undefined)
            this.error(
              'Invalid numeric type',
              'An open upper bound needs a bound value'
            );

          // Validate the bounds (the old parser did; the new one silently
          // accepted `integer<10..0>` and `integer<nan..10>`).
          const lower = (lowerBound?.value as number) ?? -Infinity;
          const upper = (upperBound?.value as number) ?? Infinity;
          if (Number.isNaN(lower) || Number.isNaN(upper))
            this.error(
              'Invalid numeric type',
              'Lower and upper bounds must be valid numbers'
            );
          // A bound must denote a point on the real line: a number, or a
          // signed infinity. Anything else the value grammar accepts —
          // unsigned infinity `~oo` (which carries an object sentinel, not a
          // JavaScript number), a boolean, a string — has no numeric value.
          // Such a bound compares as neither less nor greater than any number,
          // so the range check below would pass it, and the type builder would
          // store it in the `number`-typed `lower`/`upper` fields, where it
          // drops silently on serialization.
          for (const bound of [lowerBound, upperBound])
            if (
              bound !== undefined &&
              bound.valueType !== 'number' &&
              bound.valueType !== 'infinity'
            )
              this.error(
                'Invalid numeric type',
                'Lower and upper bounds must be valid numbers'
              );
          if (lower > upper)
            this.error(
              `Invalid range: ${lower}..${upper}`,
              'The lower bound must be less than the upper bound'
            );
          // An open bound at an infinity is meaningless (the infinity is
          // already excluded from a finite-only tier and "unbounded" carries
          // no endpoint to exclude).
          if (
            (lowerOpen && !Number.isFinite(lower)) ||
            (upperOpen && !Number.isFinite(upper))
          )
            this.error(
              'Invalid numeric type',
              'An open bound must be a finite number'
            );

          return this.createNode<NumericTypeNode>('numeric', {
            baseType,
            lowerBound,
            upperBound,
            ...(lowerOpen ? { lowerOpen: true } : {}),
            ...(upperOpen ? { upperOpen: true } : {}),
          });
        }

        return this.createNode<NumericTypeNode>('numeric', { baseType });
      }
    }

    return undefined;
  }

  private parsePrimitiveType(): PrimitiveTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER') {
      const name = this.current.value;
      if (PRIMITIVE_TYPES_SET.has(name as any)) {
        // `type` is both a primitive (the type of a reified type value) and,
        // before an identifier, the forward-reference marker of the reference
        // grammar (`<type_reference> ::= ("type")? <identifier>`). Primitives
        // are tried before references, so without lookahead `type node` would
        // parse as the primitive and strand `node`. One token decides it:
        // `type` followed by an identifier is a forward reference — decline
        // here so `parseTypeReference` consumes both tokens; bare `type`
        // (before `|`, `>`, `,`, `->`, end of input, …) is the primitive.
        if (name === 'type') {
          const savedLexerState = this.lexer.saveState();
          const savedCurrent = this.current;
          this.advance();
          const isForwardRef = (this.current as Token).type === 'IDENTIFIER';
          this.lexer.restoreState(savedLexerState);
          this.current = savedCurrent;
          if (isForwardRef) return undefined;
        }
        this.advance();
        return this.createNode<PrimitiveTypeNode>('primitive', { name });
      }
    }

    return undefined;
  }

  private parseValue(): ValueNode | undefined {
    let value: any;
    let valueType: ValueNode['valueType'];

    switch (this.current.type) {
      case 'STRING_LITERAL':
        value = this.advance().value;
        valueType = 'string';
        break;
      case 'NUMBER_LITERAL':
        value = parseFloat(this.advance().value);
        valueType = 'number';
        break;
      case 'TRUE':
        this.advance();
        value = true;
        valueType = 'boolean';
        break;
      case 'FALSE':
        this.advance();
        value = false;
        valueType = 'boolean';
        break;
      case 'NAN':
        this.advance();
        value = NaN;
        valueType = 'nan';
        break;
      case 'INFINITY':
      case 'PLUS_INFINITY':
        this.advance();
        value = Infinity;
        valueType = 'infinity';
        break;
      case 'MINUS_INFINITY':
        this.advance();
        value = -Infinity;
        valueType = 'infinity';
        break;
      case 'COMPLEX_INFINITY':
        // The unsigned `~oo` has no JavaScript number to stand for it, so it
        // carries the `COMPLEX_INFINITY_VALUE` sentinel instead. Every consumer
        // recognizes it with `isComplexInfinityValue()`.
        this.advance();
        value = COMPLEX_INFINITY_VALUE;
        valueType = 'complex_infinity';
        break;
      default:
        return undefined;
    }

    return this.createNode<ValueNode>('value', { value, valueType });
  }

  private parseTypeReference(): TypeReferenceNode | undefined {
    const isForward =
      this.current.type === 'IDENTIFIER' && this.current.value === 'type';
    if (isForward) {
      this._sawForwardRef = true;
      this.advance();
    }

    if (this.current.type === 'IDENTIFIER') {
      const nameToken = this.current; // Capture token position before advancing
      const name = this.advance().value;

      // The optional type-ARGUMENT list of an applied reference. Parsed for
      // every reference, resolved or not: the arity/expansion verdict belongs
      // to the type builder, which is the only place that can see the record.
      const args = this.parseTypeArguments();

      // Try to resolve the type
      const result = this.typeResolver.resolve(name);
      if (result) {
        // This is a resolved type, but we still return a reference node
        return this.createNode<TypeReferenceNode>('type_reference', {
          name,
          isForward,
          args,
        });
      }

      // If it was a forward reference, let the resolver know
      if (isForward) {
        // `type Later<integer>` is legal: an applied forward reference records
        // its argument count on the placeholder, and the declaration that
        // fulfills it is checked against every recorded use (design §4.2).
        const forwardResult = this.typeResolver.forward(name);
        if (forwardResult) {
          return this.createNode<TypeReferenceNode>('type_reference', {
            name,
            isForward: true,
            args,
          });
        }
      }

      // For unresolved type references that are not forward references,
      // we should be strict and not accept unknown types
      if (!isForward) {
        this.errorAtToken(
          nameToken,
          `Unknown type "${name}"`,
          'Syntax error. The type was not recognized.'
        );
      }

      return this.createNode<TypeReferenceNode>('type_reference', {
        name,
        isForward,
        args,
      });
    }

    return undefined;
  }

  /** The `<…>` argument list of an applied type reference, or `undefined` when
   * the slot is absent. An EMPTY list (`Pair<>`) returns `[]` — a distinct
   * (and always erroneous) shape the builder reports as an arity error. */
  private parseTypeArguments(): TypeNode[] | undefined {
    if (this.current.type !== '<') return undefined;
    this.advance(); // '<'

    if ((this.current as Token).type === '>') {
      this.advance();
      return [];
    }

    const args: TypeNode[] = [];
    do {
      const arg = this.parseUnionType();
      if (!arg) this.error('Expected a type argument');
      args.push(arg);
    } while (this.match(','));

    if ((this.current as Token).type !== '>')
      this.error(
        'Expected `>` to close the type arguments',
        'For example `Pair<integer>`'
      );
    this.advance(); // '>'

    return args;
  }
}
