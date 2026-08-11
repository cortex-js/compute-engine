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
  DictionaryTypeNode,
  SetTypeNode,
  BroadcastableTypeNode,
  CallbackTypeNode,
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
  ForallTypeNode,
  TypeParamNode,
  TypeVariableNode,
} from './ast-nodes.js';
import {
  EffectLabel,
  EffectSet,
  TypeParameter,
  TypeResolver,
} from './types.js';
import { PRIMITIVE_TYPES_SET } from './primitive.js';
import { EFFECT_LABELS, isEffectLabel } from './effects.js';

/**
 * BNF grammar for the type parser:
 *
<type> ::= <forall_type>
         | <union_type>
         | <function_signature>

(* --- Type variables (parametric polymorphism) --- *)

(* A prefix, dot-terminated quantifier clause. The clause is only MEANINGFUL on
   a function signature (and, per arm, on the members of an overload set:
   `(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)`); the grammar
   admits it in any type position and the declaration-time validation rejects
   every other placement with `unsupported-variable-position`.
   The dot is load-bearing: a bound is a type, and types have unbounded right
   edges (`forall T: (real) -> real. (g: T) -> boolean`).
   `forall` is a RESERVED word in type strings. *)
<forall_type> ::= "forall" <var_decl> ( "," <var_decl> )* "." <type>

<var_decl> ::= <identifier> ( ":" <type> )?      (* the bound must be GROUND *)

(* Within its arm, a quantified name SHADOWS every other reading of that
   identifier (primitive, nominal or resolver-provided) and parses as a type
   variable. A parse may also be PRE-SEEDED with variables that no `forall` in
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
                 | "fs_write" | "network" | "random" | "scope" | "time"

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

<record_type> ::= "record"
                | "record<" <record_element> ( "," <record_element> )* ">"

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
   site of a generic type alias (`docs/plans/2026-08-04-generic-type-aliases-
   design.md`). The list is EAGERLY EXPANDED into the substituted alias body
   when the type is built, so no applied-reference node ever reaches the `Type`
   representation. An empty list (`Pair<>`), a wrong count, or arguments on a
   non-generic name are arity errors raised there — the grammar admits them.
   Writing the slot is also what closes the silent-truncation hazard: without
   it `p: Pair<integer>` parsed as the bare `Pair` and leaked `<integer>` to the
   surrounding (Epsil) grammar. *)
<type_reference> ::= ( "type" )? <identifier> ( "<" <type> ( "," <type> )* ">" | "<" ">" )?

<value> ::= <string_literal>
          | <number_literal>
          | "true" | "false"
          | "nan" | "infinity" | "+infinity" | "oo" | "∞" | "+oo" | "+∞"
          | "-infinity" | "-oo" | "-∞"

<primitive_type> ::= <numeric_primitive>
                   | "any" | "unknown" | "nothing" | "missing" | "never" | "error"
                   | "expression" | "symbol" | "function" | "value"
                   | "scalar" | "boolean" | "string"
                   | "collection" | "indexed_collection" | "list" | "tuple"
                   | "set" | "record" | "dictionary"

<numeric_primitive> ::= "number" | "finite_number" | "complex" | "finite_complex"
                      | "imaginary" | "real" | "finite_real" | "rational"
                      | "finite_rational" | "integer" | "finite_integer"
                      | "non_finite_number"


(* --- Terminals (Lexical Tokens) --- *)

<identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*

<verbatim_string> ::= "`" ( [^`] | "\`" | "\\" )* "`"

<positive_integer_literal> ::= [1-9][0-9]*

<number_literal> ::= (* As parsed by the valueParser, including integers, decimals, and scientific notation *)

<string_literal> ::= '"' ( [^"] | '\"' )* '"'
 *
 */

/**
 * True when `node` is an arrow signature, looking through the redundant
 * parentheses `callback<((T) -> boolean)>` produces.
 *
 * A `forall` node answers `true` as well — not because it is admissible, but
 * because it already has a *better* rejection downstream (a nested `forall` is
 * an unsupported variable position), which this check must not preempt.
 */
function isFunctionSignatureNode(node: TypeNode): boolean {
  let n: TypeNode = node;
  while (n.kind === 'group') n = (n as GroupTypeNode).type;
  return n.kind === 'function_signature' || n.kind === 'forall';
}

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

  /** The `forall`-quantified names in scope, innermost last. An identifier
   * found here parses as a type VARIABLE, shadowing every other reading. */
  private _typeVarScopes: Set<string>[] = [];

  /** True once a `forall` clause has been parsed. The declaration-time
   * validation (`validateDeclaredType`) is gated on it, so a type string
   * without a clause pays nothing. */
  private _sawForall = false;

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
      typeVars?: readonly TypeParameter[];
    }
  ) {
    this.allowTrailing = options?.allowTrailing ?? false;
    // A PRE-SEEDED parse (the body of a generic type alias): the alias's own
    // parameters are in scope from the first token, exactly as if an enclosing
    // `forall` had quantified them, so `tuple<T, T>` reads `T` as a VARIABLE
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

  /** True when the parsed type carried a `forall` clause — the gate for the
   * declaration-time polytype validation. */
  get sawForall(): boolean {
    return this._sawForall;
  }

  /** True when the parsed type carried a `type X` forward-reference spelling —
   * the gate that keeps such parses out of the resolver-less memo cache. */
  get sawForwardRef(): boolean {
    return this._sawForwardRef;
  }

  error(message: string, suggestion?: string): never {
    this.errorAtToken(this.current, message, suggestion);
  }

  errorAtToken(token: Token, message: string, suggestion?: string): never {
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
    };
    err.position = token.position;
    err.rawMessage = message;
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

    const type = this.parseUnionType();
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

    const type = this.parseUnionType();
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

  /** True when `name` is quantified by an enclosing `forall` clause. */
  private isTypeVariable(name: string): boolean {
    for (let i = this._typeVarScopes.length - 1; i >= 0; i--)
      if (this._typeVarScopes[i].has(name)) return true;
    return false;
  }

  /**
   * `forall <var_decl> ("," <var_decl>)* "." <type>`.
   *
   * Each name enters scope as soon as it is read, so it shadows every other
   * reading of that identifier for the rest of the clause (including a later
   * bound) and for the quantified type. A clause on anything other than a
   * signature — and any nested clause — parses, and is rejected when the
   * declared type is validated (`unsupported-variable-position`).
   */
  private parseForallType(): ForallTypeNode {
    this._sawForall = true;
    this.advance(); // consume 'forall'

    const scope = new Set<string>();
    this._typeVarScopes.push(scope);
    try {
      const typeParams: TypeParamNode[] = [];
      do {
        if (this.current.type !== 'IDENTIFIER')
          this.error(
            'Expected a type variable name after `forall`',
            'For example `forall T. (T) -> T`'
          );
        const nameToken = this.current;
        const name = this.advance().value;
        if (scope.has(name))
          this.errorAtToken(
            nameToken,
            `The type variable \`${name}\` is declared more than once`
          );
        scope.add(name);

        let bound: TypeNode | undefined;
        if (this.match(':')) {
          bound = this.parseUnionType();
          if (!bound)
            this.error(
              `Expected a type after the bound of \`${name}\``,
              'For example `forall T: number. (T) -> T`'
            );
        }

        typeParams.push(
          this.createNode<TypeParamNode>('type_param', { name, bound })
        );
      } while (this.match(','));

      if (!this.match('.'))
        this.error(
          'Expected `.` after the `forall` clause',
          'For example `forall T. (T) -> T`'
        );

      const body = this.parseUnionType();
      if (!body)
        this.error(
          'Expected a function signature after the `forall` clause',
          'For example `forall T. (T) -> T`'
        );

      return this.createNode<ForallTypeNode>('forall', { typeParams, body });
    } finally {
      this._typeVarScopes.pop();
    }
  }

  private parsePrimaryType(): TypeNode | undefined {
    // A `forall` clause, and the occurrences of the names it quantifies. The
    // variable check comes first: within its arm a quantified name shadows
    // every other reading of the identifier (primitive, nominal, or
    // resolver-provided).
    if (this.current.type === 'IDENTIFIER') {
      if (this.isTypeVariable(this.current.value)) {
        const name = this.advance().value;
        return this.createNode<TypeVariableNode>('type_variable', { name });
      }
      if (this.current.value === 'forall') return this.parseForallType();
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

      // Fall back to grouped type or parenthesized tuple
      if (this.match('(')) {
        const firstType = this.parseUnionType();
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
      this.error('Variadic arguments cannot be used with optional arguments');
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
          // Handle bare 'vector' as default list of numbers
          this.advance();
          return this.createNode<ListTypeNode>('list', {
            elementType: this.createNode<PrimitiveTypeNode>('primitive', {
              name: 'number',
            }),
            dimensions: undefined,
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
    let elementType: TypeNode = this.createNode<PrimitiveTypeNode>(
      'primitive',
      { name: 'any' }
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

  private parseRecordType(): RecordTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER' && this.current.value === 'record') {
      this.advance(); // consume 'record'

      const entries: RecordEntryNode[] = [];

      if (this.match('<')) {
        if ((this.current as Token).type !== '>') {
          do {
            const entry = this.parseRecordEntry();
            if (!entry) {
              this.error('Expected record entry');
            }
            entries.push(entry);
          } while (this.match(','));
        }

        this.expect('>');
      }

      return this.createNode<RecordTypeNode>('record', { entries });
    }

    return undefined;
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

      let valueType: TypeNode = this.createNode<PrimitiveTypeNode>(
        'primitive',
        { name: 'any' }
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
   * `callback<(T) -> boolean>` — the contextual-callback constructor (Design D
   * §4). The wrapped type must be a signature, which the builder checks.
   *
   * Recognized only when a `<` follows. The escape that leaves is NARROW, and
   * covers only the BARE spelling: a user type declared and referenced without
   * arguments (`type alias callback = integer`, used as `callback`) is still an
   * ordinary type reference. An APPLIED one is not reachable at all —
   * `callback<integer>` always parses here, so a user's generic `callback<T>`
   * can be declared but never used. That is the same fate every other
   * constructor keyword deals a same-named user type (`collection<T>`,
   * `list<T>`, `tuple<T>`, … are all hijacked at use on both declaration
   * routes); `callback` differs only in that its hijack REPORTS itself — the
   * application fails to parse with "expects a function signature" instead of
   * silently resolving to the builtin.
   */
  private parseCallbackType(): CallbackTypeNode | undefined {
    if (this.current.type !== 'IDENTIFIER' || this.current.value !== 'callback')
      return undefined;
    if (this.lexer.peekToken().type !== '<') return undefined;

    this.advance();
    this.expect('<');
    const payloadToken = this.current;
    const signatureType = this.parseUnionType();
    if (!signatureType) this.error('Expected a function signature');
    // Reject a non-signature payload HERE, with the parser's own caret, rather
    // than letting it reach the builder: the builder's bare `throw` carries no
    // position, and `parseTypePrefix()` callers (the Epsil annotation route)
    // surface it verbatim, unlike every other type rejection. The builder check
    // stays as the backstop for any node this one cannot judge.
    if (!isFunctionSignatureNode(signatureType!))
      this.errorAtToken(
        payloadToken,
        '`callback<…>` expects a function signature, e.g. `callback<(T) -> boolean>`'
      );
    this.expect('>');

    return this.createNode<CallbackTypeNode>('callback', {
      signatureType: signatureType!,
    });
  }

  private parseCollectionType(): CollectionTypeNode | undefined {
    if (this.current.type === 'IDENTIFIER') {
      const isIndexed = this.current.value === 'indexed_collection';
      const isGeneric = this.current.value === 'collection';

      if (isIndexed || isGeneric) {
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
          this.expect('..');
          const upperBound = this.parseValue();
          this.expect('>');

          // Validate the bounds (the old parser did; the new one silently
          // accepted `integer<10..0>` and `integer<nan..10>`).
          const lower = (lowerBound?.value as number) ?? -Infinity;
          const upper = (upperBound?.value as number) ?? Infinity;
          if (Number.isNaN(lower) || Number.isNaN(upper))
            this.error(
              'Invalid numeric type',
              'Lower and upper bounds must be valid numbers'
            );
          if (lower > upper)
            this.error(
              `Invalid range: ${lower}..${upper}`,
              'The lower bound must be less than the upper bound'
            );

          return this.createNode<NumericTypeNode>('numeric', {
            baseType,
            lowerBound,
            upperBound,
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
        this.advance();
        return this.createNode<PrimitiveTypeNode>('primitive', { name });
      }
    }

    return undefined;
  }

  private parseValue(): ValueNode | undefined {
    let value: any;
    let valueType: 'string' | 'number' | 'boolean' | 'infinity' | 'nan';

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
