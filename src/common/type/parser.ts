import { Lexer, Token, TokenType } from './lexer';
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
} from './ast-nodes';
import { TypeResolver } from './types';
import { PRIMITIVE_TYPES } from './primitive';

export class Parser {
  private lexer: Lexer;
  private typeResolver: TypeResolver;
  private current: Token;

  constructor(input: string, options?: { typeResolver?: TypeResolver }) {
    this.lexer = new Lexer(input);
    this.typeResolver = options?.typeResolver ?? {
      forward: () => undefined,
      resolve: () => undefined,
      get names() {
        return [];
      },
    };
    this.current = this.lexer.consumeToken();
  }

  error(message: string, suggestion?: string): never {
    this.errorAtToken(this.current, message, suggestion);
  }

  errorAtToken(token: Token, message: string, suggestion?: string): never {
    const input = this.lexer.input;
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

    throw new Error(formattedMessage.join('\n'));
  }

  private advance(): Token {
    const prev = this.current;
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

  private parsePrimaryType(): TypeNode | undefined {
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

    // After exiting, we've consumed the matching ')'. Check for '->'
    const isSignature = (this.current as Token).type === '->';

    this.lexer.restoreState(savedLexerState);
    this.current = savedCurrent;
    return isSignature;
  }

  private parseFunctionSignature(): FunctionSignatureNode | undefined {
    if (this.current.type !== '(' || !this.isFunctionSignature()) {
      return undefined;
    }

    const args: ArgumentNode[] = [];

    this.advance(); // consume '('

    // Parse arguments
    if (!this.match(')')) {
      do {
        const arg = this.parseArgument();
        if (!arg) {
          this.error('Expected argument');
        }
        args.push(arg);
      } while (this.match(','));

      this.expect(')');
    }

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

    return this.createNode<FunctionSignatureNode>('function_signature', {
      arguments: args,
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
      // Try dimensions first (including "x" pattern like "2x3")
      dimensions = this.parseDimensionWithX();

      if (!dimensions) {
        dimensions = this.parseDimensions();
      }

      if (!dimensions) {
        // Parse element type
        const type = this.parseUnionType();
        if (type) {
          elementType = type;

          // Check for dimensions after type
          if (this.match('^')) {
            dimensions = this.parseDimensionWithX();

            if (!dimensions) {
              dimensions = this.parseDimensions();
            }
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
      // Try to parse dimensions first (for matrix<2x3>)
      dimensions = this.parseDimensionWithX();

      if (!dimensions) {
        dimensions = this.parseDimensions();
      }

      if (!dimensions) {
        // If no dimensions, try to parse a type
        const type = this.parseUnionType();
        if (type) {
          elementType = type;

          if (this.match('^')) {
            dimensions = this.parseDimensionWithX();

            if (!dimensions) {
              dimensions = this.parseDimensions();
            }
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
    const dimensions: DimensionNode[] = [];

    const firstDim = this.parseDimension();
    if (!firstDim) return undefined;

    dimensions.push(firstDim);

    while (this.match('x')) {
      const dim = this.parseDimension();
      if (!dim) {
        this.error('Expected dimension after x');
      }
      dimensions.push(dim);
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

  private parseDimensionWithX(): DimensionNode[] | undefined {
    // Handle patterns like "2x3", "2x3x4", etc. where "x3x4" is tokenized as one identifier
    if (this.current.type === 'NUMBER_LITERAL') {
      const dimensions: DimensionNode[] = [];
      const firstDim = parseInt(this.advance().value);
      dimensions.push(
        this.createNode<DimensionNode>('dimension', { size: firstDim })
      );

      // Check if next token is an identifier with 'x' pattern like "x3", "x3x4", etc.
      // After advance(), current token type has changed
      if (
        (this.current as Token).type === 'IDENTIFIER' &&
        this.current.value.startsWith('x')
      ) {
        const dimString = this.current.value; // don't consume yet

        // Parse all dimensions from the string like "x3", "x3x4", "x3x4x5", etc.
        const matches = dimString.match(/x(\d+)/g);
        if (matches && matches.join('') === dimString) {
          // Only accept if the entire string consists of valid xN patterns
          this.advance(); // consume the valid "xN" token
          for (const match of matches) {
            const dimValue = parseInt(match.substring(1)); // remove 'x' prefix
            dimensions.push(
              this.createNode<DimensionNode>('dimension', { size: dimValue })
            );
          }
        } else if (dimString === 'x' || dimString.startsWith('x')) {
          // Invalid dimension pattern like "x" without number
          this.error(
            'Expected a positive integer literal or `?` after x. For example: `2x3` or `2x?`'
          );
        }
      }

      // Only return if we found at least one x dimension
      if (dimensions.length > 1) {
        return dimensions;
      }
    }

    return undefined;
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
      if (PRIMITIVE_TYPES.includes(name as any)) {
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
      this.advance();
    }

    if (this.current.type === 'IDENTIFIER') {
      const nameToken = this.current; // Capture token position before advancing
      const name = this.advance().value;

      // Try to resolve the type
      const result = this.typeResolver.resolve(name);
      if (result) {
        // This is a resolved type, but we still return a reference node
        return this.createNode<TypeReferenceNode>('type_reference', {
          name,
          isForward,
        });
      }

      // If it was a forward reference, let the resolver know
      if (isForward) {
        const forwardResult = this.typeResolver.forward(name);
        if (forwardResult) {
          return this.createNode<TypeReferenceNode>('type_reference', {
            name,
            isForward: true,
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
      });
    }

    return undefined;
  }
}
