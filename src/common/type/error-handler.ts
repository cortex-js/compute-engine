import { Token } from './lexer';
// import { TypeNode } from './ast-nodes';
import { fuzzyStringMatch } from '../fuzzy-string-match';
import { PRIMITIVE_TYPES } from './primitive';

export enum ErrorType {
  LEXER_ERROR = 'LEXER_ERROR',
  PARSER_ERROR = 'PARSER_ERROR',
  TYPE_ERROR = 'TYPE_ERROR',
  SEMANTIC_ERROR = 'SEMANTIC_ERROR',
}

export interface ErrorContext {
  input: string;
  position: number;
  line: number;
  column: number;
  token?: Token;
  expected?: string[];
  actual?: string;
  suggestions?: string[];
}

export class TypeParseError extends Error {
  readonly type: ErrorType;
  readonly context: ErrorContext;

  constructor(type: ErrorType, message: string, context: ErrorContext) {
    super(message);
    this.name = 'TypeParseError';
    this.type = type;
    this.context = context;
  }
}

export class ErrorHandler {
  private typeNames: string[] = [];

  constructor(typeNames: string[] = []) {
    this.typeNames = typeNames;
  }

  setTypeNames(names: string[]): void {
    this.typeNames = names;
  }

  createLexerError(message: string, context: ErrorContext): TypeParseError {
    return new TypeParseError(ErrorType.LEXER_ERROR, message, context);
  }

  createParserError(message: string, context: ErrorContext): TypeParseError {
    return new TypeParseError(ErrorType.PARSER_ERROR, message, context);
  }

  createTypeError(message: string, context: ErrorContext): TypeParseError {
    return new TypeParseError(ErrorType.TYPE_ERROR, message, context);
  }

  createSemanticError(message: string, context: ErrorContext): TypeParseError {
    return new TypeParseError(ErrorType.SEMANTIC_ERROR, message, context);
  }

  formatError(error: TypeParseError): string {
    const { context } = error;
    const lines = context.input.split('\n');
    const currentLine = lines[context.line - 1] || '';

    const pointer = ' '.repeat(context.column - 1) + '^';

    let message = `\n${error.type} at line ${context.line}, column ${context.column}:\n`;
    message += `|   ${currentLine}\n`;
    message += `|   ${pointer}\n`;
    message += `|   \n`;
    message += `|   ${error.message}\n`;

    if (context.expected && context.expected.length > 0) {
      message += `|   Expected: ${context.expected.join(', ')}\n`;
    }

    if (context.actual) {
      message += `|   Got: ${context.actual}\n`;
    }

    if (context.suggestions && context.suggestions.length > 0) {
      message += `|   Suggestions: ${context.suggestions.join(', ')}\n`;
    }

    return message;
  }

  createUnexpectedTokenError(
    token: Token,
    expected: string[],
    input: string
  ): TypeParseError {
    const suggestions = this.generateSuggestions(token.value);

    return this.createParserError(`Unexpected token "${token.value}"`, {
      input,
      position: token.position,
      line: token.line,
      column: token.column,
      token,
      expected,
      actual: token.value,
      suggestions,
    });
  }

  createUnterminatedStringError(
    input: string,
    position: number,
    line: number,
    column: number
  ): TypeParseError {
    return this.createLexerError('Unterminated string literal', {
      input,
      position,
      line,
      column,
      suggestions: ['Add closing quote'],
    });
  }

  createInvalidCharacterError(
    char: string,
    input: string,
    position: number,
    line: number,
    column: number
  ): TypeParseError {
    return this.createLexerError(`Invalid character "${char}"`, {
      input,
      position,
      line,
      column,
      actual: char,
      suggestions: this.generateCharacterSuggestions(char),
    });
  }

  createMissingTypeError(context: ErrorContext): TypeParseError {
    return this.createParserError('Expected a type', {
      ...context,
      suggestions: [
        'Use a primitive type like "number", "string", or "boolean"',
      ],
    });
  }

  createDuplicateNameError(
    name: string,
    context: ErrorContext
  ): TypeParseError {
    return this.createSemanticError(`Duplicate name "${name}"`, {
      ...context,
      suggestions: ['Use a different name', 'Remove the duplicate'],
    });
  }

  createInvalidRangeError(
    lower: number,
    upper: number,
    context: ErrorContext
  ): TypeParseError {
    return this.createSemanticError(`Invalid range: ${lower}..${upper}`, {
      ...context,
      suggestions: ['Lower bound must be less than upper bound'],
    });
  }

  createMissingArgumentError(context: ErrorContext): TypeParseError {
    return this.createParserError('Expected argument after ","', {
      ...context,
      suggestions: ['Add a valid argument', 'Remove the comma'],
    });
  }

  createInvalidArgumentOrderError(context: ErrorContext): TypeParseError {
    return this.createSemanticError('Invalid argument order', {
      ...context,
      suggestions: [
        'Required arguments must come first',
        'Optional arguments must come after required',
        'Variadic arguments must come last',
      ],
    });
  }

  createFunctionSyntaxError(context: ErrorContext): TypeParseError {
    return this.createParserError(
      'Function signatures must be enclosed in parentheses',
      {
        ...context,
        suggestions: ['Use (arg: type) -> return_type'],
      }
    );
  }

  private generateSuggestions(token: string): string[] {
    const suggestions: string[] = [];

    // Check for common typos
    const commonSuggestions: Record<string, string> = {
      map: 'dictionary',
      array: 'list',
      int: 'integer',
      float: 'number',
      str: 'string',
      bool: 'boolean',
    };

    if (commonSuggestions[token]) {
      suggestions.push(commonSuggestions[token]);
    }

    // Fuzzy matching with type names
    const fuzzyMatch = fuzzyStringMatch(token, [
      ...this.typeNames,
      ...PRIMITIVE_TYPES,
      'vector',
      'matrix',
      'tensor',
      'collection',
      'indexed_collection',
    ]);

    if (fuzzyMatch && !suggestions.includes(fuzzyMatch)) {
      suggestions.push(fuzzyMatch);
    }

    return suggestions;
  }

  private generateCharacterSuggestions(char: string): string[] {
    const suggestions: string[] = [];

    switch (char) {
      case '{':
        suggestions.push('Use "record<key: type>" for record types');
        break;
      case '}':
        suggestions.push('Use ">" to close type parameters');
        break;
      case '[':
        suggestions.push('Use "list<type>" for list types');
        break;
      case ']':
        suggestions.push('Use ">" to close type parameters');
        break;
      case '=':
        suggestions.push('Use ":" for type annotations');
        break;
      default:
        break;
    }

    return suggestions;
  }
}

export const defaultErrorHandler = new ErrorHandler();
