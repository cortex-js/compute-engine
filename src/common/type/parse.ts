import type {
  Type,
  NamedElement,
  TypeReference,
  TypeResolver,
  TypeString,
  NumericPrimitiveType,
} from './types';

import { PRIMITIVE_TYPES, isValidType } from './primitive';
import { typeToString } from './serialize';
import { fuzzyStringMatch } from '../fuzzy-string-match';
import { Parser } from './parser';
import { buildTypeFromAST } from './type-builder';

/**
 * BNF grammar for the type parser:
 * 
<type> ::= <union_type>
         | <function_signature>

<union_type> ::= <intersection_type> ( " | " <intersection_type> )*

<intersection_type> ::= <primary_type_with_negation> ( " & " <primary_type_with_negation> )*

<primary_type_with_negation> ::= ( "!" )? <primary_type>

<primary_type> ::= <group>
                 | <list_type>
                 | <tuple_type>
                 | <record_type>
                 | <dictionary_type>
                 | <set_type>
                 | <collection_type>
                 | <expression_type>
                 | <symbol_type>
                 | <numeric_type>
                 | <primitive_type>
                 | <value>
                 | <type_reference>

<group> ::= "(" <type> ")"

(* --- Function Signatures --- *)

<function_signature> ::= <arguments> " -> " <type>

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

<collection_type> ::= ( "collection" | "indexed_collection" ) ( "<" <type> ">" )?


(* --- Other Constructed Types --- *)

<expression_type> ::= "expression<" <identifier> ">"

<symbol_type> ::= "symbol<" <identifier> ">"

<numeric_type> ::= <numeric_primitive> "<" <bound> ".." <bound> ">"

<bound> ::= <number_literal> | "-oo" | "oo" | ""


(* --- Atomic and Primitive Types --- *)

<type_reference> ::= ( "type" )? <identifier>

<value> ::= <string_literal>
          | <number_literal>
          | "true" | "false"
          | "nan" | "infinity" | "+infinity" | "oo" | "∞" | "+oo" | "+∞"
          | "-infinity" | "-oo" | "-∞"

<primitive_type> ::= <numeric_primitive>
                   | "any" | "unknown" | "nothing" | "never" | "error"
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
class TypeParser {
  buffer: string;
  pos: number;

  _valueParser: (parser: TypeParser) => any;
  _typeResolver: TypeResolver;

  constructor(
    buffer: string,
    options?: {
      valueParser?: (parser: TypeParser) => any;
      typeResolver?: TypeResolver;
    }
  ) {
    this.buffer = buffer;
    this.pos = 0;

    this._valueParser = options?.valueParser ?? (() => null);
    this._typeResolver = options?.typeResolver ?? {
      forward: () => undefined,
      resolve: () => undefined,
      get names() {
        return [];
      },
    };
  }

  error(...messages: (string | undefined)[]): never {
    throw new Error(
      `\nInvalid type\n|   ${this.buffer}\n|   ${' '.repeat(
        this.pos
      )}^\n|   \n|   ${messages
        .filter((x) => x !== undefined)
        .join('\n|   ')}\n`
    );
  }

  peek(): string {
    return this.buffer[this.pos];
  }

  consume(): string {
    return this.buffer[this.pos++];
  }

  /** Check if the upcoming tokens match s, return false if not, consume otherwise */
  match(s: string): boolean {
    if (s.length === 1 && this.buffer[this.pos] === s) {
      this.pos++;
      return true;
    }

    // Check that the next characters match the string
    const pos = this.pos;
    if (this.buffer.slice(pos, pos + s.length) === s) {
      this.pos += s.length;
      return true;
    }
    return false;
  }

  /** If the next token don't match `>`, error */
  expectClosingBracket(): void {
    this.skipWhitespace();
    if (!this.match('>')) {
      this.error('Expected ">".');
    }
  }

  /** If a white space is allowed, call before `consume()` or `match()` */
  skipWhitespace(): void {
    while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos]))
      this.pos++;
  }

  isEOF(): boolean {
    return this.pos >= this.buffer.length;
  }

  parseValue(): Type | null {
    const start = this.pos;
    this.skipWhitespace();
    const value = this._valueParser(this);
    if (value !== null) return { kind: 'value', value };
    this.pos = start;
    return null;
  }

  parseTypeReference(): TypeReference | null {
    const start = this.pos;
    this.skipWhitespace();

    // If we have `type json_array`, the `json_array` type is a forward
    // reference that may not have a placeholder declaration yet.
    const forwardType = this.match('type');
    this.skipWhitespace();

    const name = this.parseIdentifier();
    if (name !== null) {
      const result = this._typeResolver.resolve(name);
      if (result) return result;

      // If we had a forward reference, let the type resolver know about it
      if (forwardType) {
        const result = this._typeResolver.forward(name);
        if (result) return result;
      }
    }
    this.pos = start;
    return null;
  }

  parsePrimitiveType(): Type | null {
    this.skipWhitespace();
    if (this.isEOF()) this.error('Unexpected end of input');

    for (const type of PRIMITIVE_TYPES) if (this.match(type)) return type;

    return null;
  }

  /**
   * Arguments are `name: type` or `type` separated by commas.
   * Arguments can be optional, i.e. `name: type?` or `type?`.
   * Variadic arguments are `name: type+`, `type+`, `name: type*` or `type*`.
   */
  parseArguments(): [
    required: NamedElement[],
    optional: NamedElement[],
    variadic: NamedElement | undefined,
    variadicMin: 0 | 1 | undefined,
  ] {
    const reqArgs: NamedElement[] = [];
    const optArgs: NamedElement[] = [];
    let variadicMin: 0 | 1 | undefined = undefined;
    let varArg: NamedElement | undefined = undefined;

    let pos = this.pos;

    while (true) {
      const arg = this.parseNamedElement();
      if (arg === null) {
        // We've encountered something that is not a valid argument
        // It should be a closing parenthesis
        this.skipWhitespace();
        if (this.peek() === ')') break;

        this.pos = pos;
        this.skipWhitespace();
        if (this.match(',')) {
          // We have a comma, but we couldn't figure out the next argument
          this.error('Expected a valid argument after ","');
        }

        break;
      }

      // No whitespace before '?', i.e. `x: number?`
      if (this.match('?')) {
        if (variadicMin !== undefined)
          this.error(
            'Optional arguments cannot be used with variadic arguments'
          );
        optArgs.push(arg);
      } else if (this.match('*')) {
        if (optArgs.length > 0)
          this.error(
            'Variadic arguments cannot be used with optional arguments'
          );
        if (variadicMin !== undefined)
          this.error('There can be only one variadic argument');
        variadicMin = 0;
        varArg = arg;
      } else if (this.match('+')) {
        if (optArgs.length > 0)
          this.error(
            'Variadic arguments cannot be used with optional arguments'
          );
        if (variadicMin !== undefined)
          this.error('There can be only one variadic argument');
        variadicMin = 1;
        varArg = arg;
      } else {
        // This is a non-optional argument, check that we don't have any optional or variadic arguments
        if (optArgs.length > 0)
          this.error('Optional arguments must come after required arguments');
        if (variadicMin !== undefined)
          this.error('Variadic arguments must come last');

        reqArgs.push(arg);
      }
      this.skipWhitespace();
      pos = this.pos;
      if (!this.match(',')) break;
    }

    const duplicate = checkDuplicateNames([
      ...reqArgs,
      ...optArgs,
      ...(varArg ? [varArg] : []),
    ]);
    if (duplicate) this.error(`Duplicate argument name "${duplicate}"`);

    return [reqArgs, optArgs, varArg, variadicMin];
  }

  parseFunctionSignature(): Type | null {
    let args: NamedElement[] | undefined = [];
    let optArgs: NamedElement[] | undefined = [];
    let variadicArg: NamedElement | undefined = undefined;
    let variadicMin: 0 | 1 | undefined = undefined;

    this.skipWhitespace();
    const pos = this.pos;
    if (this.match('()')) {
      // Empty argument list is valid
    } else if (this.match('(')) {
      // We have a list of arguments in parentheses
      [args, optArgs, variadicArg, variadicMin] = this.parseArguments();

      this.skipWhitespace();
      if (!this.match(')'))
        this.error('Expected a closing parenthesis `)` after arguments.');
    }

    // A function signature must be followed by '->'
    this.skipWhitespace();
    if (!this.match('->')) {
      // It wasn't a signature, backtrack
      this.pos = pos;
      return null;
    }

    this.skipWhitespace();

    if (this.isEOF())
      this.error(
        'Expected a return type after `->`.',
        'Use `any` for any type or `nothing` for no return value, or `never` for a function that never returns'
      );

    const returnType = this.parseType();
    if (returnType === null)
      this.error(
        'Expected a return type after `->`.',
        'Use `any` for any type or `nothing` for no return value, or `never` for a function that never returns',
        this.parseUnexpectedToken()
      );

    if (args.length === 0) args = undefined;
    if (optArgs.length === 0) optArgs = undefined;

    if (!optArgs && !variadicArg)
      return { kind: 'signature', args, result: returnType };

    if (!optArgs && variadicArg) {
      return {
        kind: 'signature',
        args,
        variadicArg,
        variadicMin,
        result: returnType,
      };
    }

    // Variadic args, no optional args
    return {
      kind: 'signature',
      args,
      optArgs,
      variadicArg,
      variadicMin,
      result: returnType,
    };
  }

  parsePositiveIntegerLiteral(): number | null {
    let value = 0;

    this.skipWhitespace();
    while (/[0-9]/.test(this.peek()))
      value = value * 10 + parseInt(this.consume());

    if (value === 0) return null;
    return value;
  }

  parseOptionalDimension(): number | null {
    let dim = this.parsePositiveIntegerLiteral();
    if (dim === null && this.match('?')) dim = -1;
    return dim;
  }

  parseDimensions(): number[] | undefined {
    // No whitespace before optional "(", i.e. `matrix<integer^(2x3)>]`
    const pos = this.pos;
    const hasParen = this.match('(');
    const dimensions: number[] = [];

    let dim = this.parseOptionalDimension();
    if (dim === null) {
      this.pos = pos;
      return undefined;
    }
    do {
      dimensions.push(dim);
      this.skipWhitespace();
      if (!this.match('x')) break;
      this.skipWhitespace();
      dim = this.parseOptionalDimension();
      if (dim === null)
        this.error(
          'Expected a positive integer literal or `?`.',
          'For example : `matrix<integer^2x3>` or `matrix<integer^?x?>`'
        );
    } while (true);

    this.skipWhitespace();
    if (hasParen && !this.match(')'))
      this.error('Expected ")".', 'For example `matrix<integer^(2x3)>`');

    return dimensions;
  }

  parseList(): Type | null {
    this.skipWhitespace();

    // A list has some syntactic shorthands:
    // - `vector<3>` is equivalent to `list<number^3>`
    // - `matrix<2x3>` is equivalent to `list<number^2x3>`
    // - `list` is equivalent to `list<any>`

    // `list<<type>>` or `list<<type>^<dimensions>>` or `list<<dimensions>>`
    if (this.match('list<')) {
      // We want to parse dimensions first, otherwise `list<3>` would be
      // interpreted as a list of `3` since `3` is a valid literal type.
      let dimensions = this.parseDimensions();

      // `list<2x3>` is equivalent to `list<any^2x3>`
      if (dimensions !== undefined) {
        this.expectClosingBracket();
        return { kind: 'list', elements: 'any', dimensions };
      }

      // `list<>` is equivalent to `list<any>`

      const type = this.parseTypeMaybe();
      if (type && this.match('^')) {
        // We got both a type and dimensions
        dimensions = this.parseDimensions();
        if (dimensions === undefined)
          this.error(
            'Expected dimensions after `^`.',
            'For example `list<number^2x3>`'
          );
      }

      if (!type) {
        this.error(
          'Expected a type after `list<`.',
          'Use `list<any>` for a list of any type',
          'For example `list<number>` or `list<string>`'
        );
      }

      this.expectClosingBracket();

      return { kind: 'list', elements: type ?? 'any', dimensions };
    }

    if (this.match('list(')) {
      this.error(
        'Use `list<type>` instead of `list(type)`.',
        'For example `list<number>`'
      );
    }

    // `vector<<size>>` and `vector<<type>^<size>>`
    if (this.match('vector<')) {
      let type = this.parseType();

      let dimensions: number[] | undefined = undefined;
      if (type && this.match('^')) {
        const size = this.parsePositiveIntegerLiteral();
        if (size === null)
          this.error(
            'Expected a positive integer literal.',
            'For example `vector<3>`',
            'Use `vector` for a vector of unknown size'
          );
        dimensions = [size];
      } else if (!type) {
        type = 'number';
        dimensions = this.parseDimensions();
      }

      this.expectClosingBracket();

      return { kind: 'list', elements: type, dimensions };
    }

    if (this.match('vector(')) {
      this.error(
        'Use `vector<...>` instead of `vector(...)`.',
        'For example `vector<3>` or `vector<integer^3>`'
      );
    }

    // `vector` is equivalent to `list<number>`
    if (this.match('vector')) return { kind: 'list', elements: 'number' };

    // `matrix(<rows>x<columns>)` and `matrix(<type>^(<rows>x<columns>))`
    if (this.match('matrix<')) {
      let type = this.parseType();

      let dimensions: number[] | undefined = undefined;
      if (type && this.match('^')) {
        dimensions = this.parseDimensions();
        if (dimensions === undefined)
          this.error(
            'Expected dimensions',
            'For example `matrix<number^2x3>`',
            'Use `matrix` for a matrix of unknown size'
          );
      } else if (!type) {
        type = 'number';
        dimensions = this.parseDimensions();
      }

      this.expectClosingBracket();

      return { kind: 'list', elements: type, dimensions };
    }

    if (this.match('matrix(')) {
      this.error(
        'Use `matrix<...>` instead of `matrix(...)`.',
        'For example `matrix<3x2>` or `matrix<integer^3x2>`'
      );
    }

    // `matrix` is equivalent to `list<number^?x?>` (two dimensional tensor)
    if (this.match('matrix'))
      return {
        kind: 'list',
        elements: 'number',
        dimensions: [-1, -1],
      };

    // `tensor<T>`
    if (this.match('tensor<')) {
      const type = this.parseType() ?? 'number';

      this.expectClosingBracket();

      return { kind: 'list', elements: type, dimensions: undefined };
    }

    // `tensor` is equivalent to a list of numbers with any dimensions
    if (this.match('tensor'))
      return {
        kind: 'list',
        elements: 'number',
        dimensions: undefined,
      };

    // Regular list syntax: `list<number^2x3>`
    if (!this.match('list<')) return null;

    const type = this.parseTypeMaybe();
    if (type === null)
      this.error('Expected a type. Use "[any]" for a collection of any type');

    const dimensions = this.match('^') ? this.parseDimensions() : undefined;

    this.expectClosingBracket();

    return { kind: 'list', elements: type, dimensions };
  }

  /**
   * Parse the name of a named element, i.e. an identifier followed by a colon.
   * Does special error handling for optional qualifiers.
   * */
  parseName(): string | null {
    const pos = this.pos;
    this.skipWhitespace();
    if (this.isEOF()) return null;

    let name = this.parseVerbatimString();

    if (name === null) {
      if (!/[a-zA-Z_]/.test(this.peek())) return null;

      name = '';
      while (!this.isEOF() && /[a-zA-Z0-9_]/.test(this.peek()))
        name += this.consume();
    }

    this.skipWhitespace();

    if (!this.match(':')) {
      if (this.match('?:')) {
        // The input is `name?:`, which is invalid
        const type = this.parseTypeMaybe();
        this.error(
          'Optional qualifier must come after the type',
          `Use "${name}: ${type ? typeToString(type) : 'number'}?"`
        );
      }

      this.pos = pos;
      return null;
    }

    return name;
  }

  parseVerbatimString(): string | null {
    this.skipWhitespace();
    if (this.isEOF()) return null;

    let str = '';

    // Is this a verbatim string (i.e. surrounded by backticks)?
    if (this.match('`')) {
      while (!this.match('`')) {
        if (this.isEOF()) this.error('Expected closing backtick');
        // Escaped backtick?
        // @todo incorporate escape sequences from Epsil (see parseEscapeSequence() in string-parser.ts)
        if (this.match('\\`')) str += '`';
        else if (this.match('\\\\')) str += '\\';
        else str += this.consume();
      }

      return str;
    }

    return null;
  }

  /**
   * A general purpose identifier, used for expresion<>, symbol<>, type references, record keys, etc.
   *
   * Not used for arguments (they have special error handling with `parseName()`).
   */
  parseIdentifier(): string | null {
    let name = this.parseVerbatimString();
    if (name !== null) return name;

    if (/[0-9_]/.test(this.peek())) return null;

    name = '';

    // If not a verbatim key, scan while alpha-numeric, '_'
    while (!this.isEOF() && /[a-zA-Z0-9_]/.test(this.peek()))
      name += this.consume();
    return name.length === 0 ? null : name;
  }

  /** Parse:
   * - "<identifier>: <type>"
   * - "<type>"
   *
   * Does not parse variadic arguments, i.e. `type+` or `name: type+`.
   */
  parseNamedElement(): NamedElement | null {
    const pos = this.pos;
    const name = this.parseName();
    if (name !== null) {
      const type = this.parseType();
      if (type === null) {
        this.error(
          `Expected a valid type after "${name}:"`,
          this.parseUnexpectedToken()
        );
      }

      this.skipWhitespace();

      return { name, type };
    }

    const type = this.parseType();
    if (type === null) {
      this.pos = pos;
      return null;
    }

    return { type };
  }

  parseTupleElements(): NamedElement[] {
    const elements: NamedElement[] = [];
    let pos = this.pos;
    let type = this.parseNamedElement();
    if (type === null) return [];

    const expectNamedElements = type.name !== undefined;

    while (true) {
      elements.push(type);
      this.skipWhitespace();
      if (!this.match(',')) break;
      pos = this.pos;
      type = this.parseNamedElement();
      if (type === null) {
        this.pos = pos;
        this.error('Expected a type or unexpected comma');
      }
      if (expectNamedElements && !type.name) {
        this.pos = pos;
        this.error(
          'All tuple elements should be named, or none.',
          "Previous elements were named, but this one isn't."
        );
      }
      if (!expectNamedElements && type.name) {
        this.pos = pos;
        this.error(
          'All tuple elements should be named, or none.',
          'Previous elements were not named, but this one is.'
        );
      }
    }

    return elements;
  }

  parseTuple(): Type | null {
    this.skipWhitespace();

    if (!this.match('tuple<')) {
      if (this.match('tuple(')) {
        this.error(
          'Use `tuple<type>` instead of `tuple(type)`.',
          'For example `tuple<number, boolean>` or `tuple<x: integer, y: integer>`'
        );
      }
      return null;
    }

    const elements = this.parseTupleElements();

    this.expectClosingBracket();

    return { kind: 'tuple', elements };
  }

  /** Parse a non-optional group, i.e. "(" <type> ")" */
  parseGroup(): Type | null {
    // A primary can be enclosed in parens, i.e. "(number)".
    // However, a function signature can also be grouped with parens
    // i.e. "(number) -> number"
    // If we don't find the closing paren followed by '->', we backtrack

    const pos = this.pos;

    this.skipWhitespace();
    if (!this.match('(')) return null;

    const type = this.parseType();
    if (type === null) {
      this.pos = pos;
      return null;
    }

    // We've parsed a type enclosed in parens. If this was a primary we
    // now should have a closing paren not followed by "->".
    this.skipWhitespace();
    if (this.match(')')) {
      this.skipWhitespace();
      if (!this.match('->')) return type;
    }

    // This was not a primary type enclosed in parens: backtrack
    this.pos = pos;
    return null;
  }

  parseSet(): Type | null {
    this.skipWhitespace();
    if (!this.match('set<')) {
      if (this.match('set(')) {
        const type = this.parseTypeMaybe() ?? 'number';
        this.error(`Use \`set<${type}>\` instead of \`set(${type})\`.`);
      }
      if (this.match('set')) return 'set';
      return null;
    }

    const type = this.parseTypeMaybe();
    if (type === null)
      this.error('Expected a type.', 'Use `set<number>` for a set of numbers');

    this.expectClosingBracket();

    return { kind: 'set', elements: type };
  }

  parseRecordKeyValue(): [string, Type][] {
    const entries: [string, Type][] = [];

    while (true) {
      const key = this.parseIdentifier();
      if (key === null)
        this.error(
          'Expected a name for the key.',
          'For example `record<key: string>`.',
          'Use backticks for special characters.',
          'For example `record<`duración`: number>`'
        );

      this.skipWhitespace();
      if (!this.match(':')) {
        this.error(
          'Expected a type separated by a `:` after the key.',
          `For example \`record<${formatKey(key)}: string>\``,
          'Use backticks for special characters.',
          'For example `record<`duración`: string>`'
        );
      }

      const value = this.parseTypeMaybe();
      if (value === null)
        this.error(
          'Expected a type for the value. Use `any` for any type.',
          `For example \`record<${formatKey(key)}: any>.\``
        );

      entries.push([key, value]);

      this.skipWhitespace();
      if (!this.match(',')) break;
    }

    // Validate there are no duplicate keys
    const keySet = new Set(entries.map(([key]) => key));
    if (keySet.size !== entries.length) {
      // Find the duplicate key
      const duplicate = entries.find(([key], index) =>
        entries.slice(index + 1).some(([k]) => k === key)
      )?.[0];
      this.error(
        `Duplicate record key "${duplicate}"`,
        'Keys in a record must be unique.'
      );
    }

    return entries;
  }

  parseRecord(): Type | null {
    this.skipWhitespace();

    if (this.match('record<')) {
      // Assume we have a `record<key: type, ...>`
      const entries = this.parseRecordKeyValue();

      this.skipWhitespace();
      if (!this.match('>')) {
        const lastEntry = entries[entries.length - 1] ?? ['key', 'number'];
        if (this.match('?'))
          this.error(
            'Unexpected token "?".',
            `To indicate an optional key, use a specific type, for example \`record<${formatKey(
              lastEntry[0]
            )}: ${lastEntry[1]} | nothing>\``
          );

        this.error(
          'Expected a closing `>`.',
          `For example \`record<${formatKey(lastEntry[0])}: ${lastEntry[1]}>\``
        );
      }

      return { kind: 'record', elements: Object.fromEntries(entries) };
    }

    // Generic record type
    if (this.match('record')) return 'record';

    return null;
  }

  // A dictionary type, e.g. `dictionary<T>` where T is the type of the values
  parseDictionary(): Type | null {
    if (this.match('dictionary<')) {
      this.skipWhitespace();

      const values = this.parseType();
      if (values === null) this.error('Expected a type.');

      this.skipWhitespace();
      if (this.match(',')) {
        this.error(
          'Dictionary types cannot have keys, only values.',
          'For example `dictionary<string>`'
        );
      }

      this.expectClosingBracket();

      return { kind: 'dictionary', values };
    }

    // Generic dictionary type
    if (this.match('dictionary')) return 'dictionary';

    return null;
  }

  // A generic collection type, e.g. `collection<number>`
  parseCollection(): Type | null {
    this.skipWhitespace();

    if (this.match('indexed_collection<')) {
      const type = this.parseType();
      if (type === null)
        this.error(
          'Expected a type.',
          'Use `indexed_collection<number>` for an indexed collection of numbers'
        );
      this.expectClosingBracket();

      return { kind: 'indexed_collection', elements: type };
    }

    if (this.match('indexed_collection')) return 'indexed_collection';

    if (!this.match('collection<')) {
      if (this.match('collection(')) {
        this.error(
          'Use `collection<type>` instead of `collection(type)`.',
          'For example `collection<number>`'
        );
      }
      if (this.match('collection')) return 'collection';
      return null;
    }

    const type = this.parseType();
    if (type === null)
      this.error(
        'Expected a type.',
        'Use `collection<number>` for a collection of numbers'
      );

    this.expectClosingBracket();

    return { kind: 'collection', elements: type };
  }

  parseExpression(): Type | null {
    if (!this.match('expression<')) return null;
    const operator = this.parseIdentifier();

    if (operator === null)
      this.error(
        'Expected the name of the operator for the expression.',
        'For example `expression<Multiply>`.',
        'Use backticks for special characters.',
        'For example `expression<`半径`>`'
      );

    this.expectClosingBracket();

    return { kind: 'expression', operator };
  }

  parseSymbol(): Type | null {
    if (!this.match('symbol<')) return null;

    const name = this.parseIdentifier();

    if (name === null)
      this.error(
        'Expected a name for the symbol.',
        'For example `symbol<True>`.',
        'Use backticks for special characters.',
        'For example `symbol<`半径`>`'
      );

    this.expectClosingBracket();

    return { kind: 'symbol', name };
  }

  /** Parse a constructed numeric type with a range */
  parseNumericType(): Type | null {
    const parseLowerBound = (parser: TypeParser): number | undefined => {
      parser.skipWhitespace();
      if (parser.match('..')) return -Infinity;

      const v = valueParser(parser);
      if (typeof v !== 'number') parser.error('Expected a number');
      parser.skipWhitespace();
      if (parser.match('..')) return v;
      parser.error(
        'Expected ".." after lower bound',
        'For example `integer<-oo..10>` or `integer<0..10>`'
      );
    };

    const parseUpperBound = (parser: TypeParser): number | undefined => {
      parser.skipWhitespace();
      if (parser.match('>')) return undefined;
      const v = valueParser(parser);
      if (typeof v !== 'number') parser.error('Expected a number');
      parser.expectClosingBracket();
      return v;
    };

    for (const t of [
      'real',
      'finite_real',
      'rational',
      'finite_rational',
      'integer',
      'finite_integer',
    ] as NumericPrimitiveType[]) {
      if (!this.match(t + '<')) continue;

      const lower = parseLowerBound(this) ?? -Infinity;
      const upper = parseUpperBound(this) ?? Infinity;

      if (Number.isNaN(lower) || Number.isNaN(upper))
        this.error(
          'Invalid numeric type',
          'Lower and upper bounds must be valid numbers'
        );

      if (lower === -Infinity && upper === Infinity) return t;

      if (lower > upper)
        this.error(
          `Invalid range: ${lower}..${upper}`,
          'The lower bound must be less than the upper bound'
        );

      return { kind: 'numeric', type: t, lower, upper };
    }
    return null;
  }

  parseStringType(): Type | null {
    if (this.match('string')) return 'string';
    return null;
  }

  parsePrimary(): Type {
    const result = this.parseMaybePrimary();
    if (result === null) {
      // If we've reached this point, we've run into a syntax error
      // Try to guess what the problem might be...
      const pos = this.pos;
      // Was it some missing parens with a function signature?
      const name = this.parseNamedElement();
      if (name !== null) {
        // Skip potential optional qualifiers
        this.match('?');
        this.match('*');
        this.match('+');

        this.skipWhitespace();
        if (this.match('->') || this.match(',')) {
          this.error(
            'Function arguments must be enclosed in parentheses',
            'For example `(x: number) -> number`'
          );
        }
        if (this.match(')')) {
          this.error('An opening parenthesis seems to be missing');
        }
      }

      this.pos = pos;
      // Is it a value?
      const value = valueParser(this);
      if (value !== null) this.error('Unexpected value');

      this.pos = pos;
      this.error(`Unexpected token"`, this.parseUnexpectedToken());
    }

    return result;
  }

  parseUnexpectedToken(): string | undefined {
    const pos = this.pos;
    let result: string | undefined = undefined;
    let token = '';
    while (!this.isEOF() && /[a-zA-Z0-9_]/.test(this.peek()))
      token += this.consume();
    if (!token) return undefined;

    let suggest: string | null = null;

    if (token === 'map') suggest = 'dictionary';

    suggest ??= fuzzyStringMatch(token, [
      ...this._typeResolver.names,
      ...PRIMITIVE_TYPES,
      'vector',
      'matrix',
    ]);
    if (suggest) result = `Did you mean "${suggest}"?`;
    this.pos = pos;
    return result;
  }

  parseMaybePrimary(): Type | null {
    return (
      this.parseGroup() ??
      this.parseNegationType() ??
      this.parseCollection() ??
      this.parseList() ??
      this.parseSet() ??
      this.parseDictionary() ??
      this.parseRecord() ??
      this.parseTuple() ??
      this.parseExpression() ??
      this.parseSymbol() ??
      this.parseNumericType() ??
      this.parseStringType() ??
      this.parsePrimitiveType() ??
      this.parseValue() ??
      this.parseTypeReference()
    );
  }

  parseNegationType(): Type | null {
    if (!this.match('!')) return null;
    return { kind: 'negation', type: this.parsePrimary() };
  }

  // <intersection_type> ::= <primary_type> (" & " <primary_type>)*

  parseIntersectionType(): Type | null {
    const type = this.parseFunctionSignature() ?? this.parseMaybePrimary();
    if (type === null) return null;
    const types: Type[] = [type];

    this.skipWhitespace();
    while (this.match('&')) {
      this.skipWhitespace();
      types.push(this.parsePrimary());
    }
    if (types.length === 1) return types[0];
    return { kind: 'intersection', types };
  }

  // <union_type> ::= <intersection_type> <union_type> " | "
  // | <intersection_type>

  parseUnionType(): Type | null {
    let type = this.parseIntersectionType();
    if (type === null) return null;

    const types: Type[] = [type];

    this.skipWhitespace();
    while (this.match('|')) {
      type = this.parseIntersectionType();
      if (type === null) this.error('Expected type');
      types.push(type);
    }

    if (types.length === 1) return types[0];
    return { kind: 'union', types };
  }

  // <type> ::=  "(" <type> ")" | <union_type>
  parseType(): Readonly<Type> | null {
    this.skipWhitespace();
    if (this.isEOF()) return null;

    if (this.peek() === '(') {
      // We're either in a grouped type, or a function signature
      const signature = this.parseFunctionSignature();
      if (signature) return signature;
    }

    return this.parseUnionType();
  }

  /** Parse a type, but return null if there's a problem instead
   * of throwing.
   */
  parseTypeMaybe(): Readonly<Type> | null {
    try {
      return this.parseType();
    } catch (e) {
      console.log(e);
    }
    return null;
  }

  parse(): Readonly<Type> {
    const type = this.parseType();
    if (type === null) {
      // Is it an identifier followed by a colon?
      const name = this.parseIdentifier();
      if (name !== null) {
        this.skipWhitespace();
        if (this.match(':')) {
          this.error(
            'Function signatures must be enclosed in parentheses',
            'For example `(x: number) -> number`'
          );
        }
      }
      this.error('Syntax error. The type was not recognized.');
    }

    this.skipWhitespace();

    if (
      this.match('->') ||
      this.match('?') ||
      this.match('*') ||
      this.match('+')
    ) {
      // This might be a single argument function signature
      // string+ -> string
      this.error(
        'Function signatures must be enclosed in parentheses',
        'For example `(x: number) -> number`'
      );
    }

    if (!this.isEOF())
      this.error('Unexpected character. Could be some mismatched parentheses.');

    return type;
  }
}

function valueParser(parser: TypeParser): any {
  const pos = parser.pos;

  parser.skipWhitespace();

  // String value
  if (/["]/.test(parser.peek())) {
    const quote = parser.consume();
    let value = '';
    while (parser.peek() !== quote) {
      if (parser.isEOF()) parser.error('Expected closing quote');
      if (parser.match('\\' + quote)) value += quote;
      else value += parser.consume();
    }
    parser.consume();
    return value;
  }

  // Hex value
  if (parser.match('0x')) {
    let value = 0;
    while (/[0-9a-fA-F]/.test(parser.peek()))
      value = value * 16 + parseInt(parser.consume(), 16);
    return value;
  }

  // Binary value
  if (parser.match('0b')) {
    let value = 0;
    while (/[01]/.test(parser.peek()))
      value = value * 2 + parseInt(parser.consume());
    return value;
  }

  // Decimal numeric value
  if (/[-0-9\.]/.test(parser.peek())) {
    let value = 0;
    let sign = 1;
    if (parser.match('-')) sign = -1;
    if (parser.match('+')) sign = 1;

    if (!/[0-9]/.test(parser.peek())) {
      parser.pos = pos;
      return null;
    }

    while (/[0-9]/.test(parser.peek()))
      value = value * 10 + parseInt(parser.consume());

    // We want to match a digit after '.', but not '..'
    if (parser.peek() === '.') {
      const pos = parser.pos;
      parser.consume();

      if (!/[0-9]/.test(parser.peek())) {
        parser.pos = pos;
        return sign * value;
      }

      let fraction = 0;
      let scale = 1;
      while (/[0-9]/.test(parser.peek())) {
        fraction = fraction * 10 + parseInt(parser.consume());
        scale *= 10;
      }
      value += fraction / scale;
    }

    if (parser.match('e') || parser.match('E')) {
      let exponent = 0;
      let expSign = 1;
      if (parser.match('+')) expSign = 1;
      if (parser.match('-')) expSign = -1;

      while (/[0-9]/.test(parser.peek()))
        exponent = exponent * 10 + parseInt(parser.consume());

      value *= Math.pow(10, expSign * exponent);
    }

    return sign * value;
  }

  if (parser.match('true')) return true;
  if (parser.match('false')) return false;

  if (parser.match('nan')) return NaN;

  if (
    parser.match('infinity') ||
    parser.match('+infinity') ||
    parser.match('oo') ||
    parser.match('∞') ||
    parser.match('+oo') ||
    parser.match('+∞')
  )
    return Infinity;

  if (parser.match('-infinity') || parser.match('-oo') || parser.match('-∞'))
    return -Infinity;

  if (parser.match('nan')) return NaN;

  parser.pos = pos;

  return null;
}

export function parseType(s: undefined, typeResolver?: TypeResolver): undefined;
export function parseType(
  s: TypeString | Type,
  typeResolver?: TypeResolver
): Type;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver
): Type | undefined;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver
): Type | undefined {
  if (s === undefined) return undefined;
  // Check if it's a primitive type or already a Type object
  if (isValidType(s)) return s;

  // Parse the type string
  if (typeof s !== 'string') return undefined;

  // For now, use the original parser for compatibility
  // The new modular architecture is available but not used by default
  // const parser = new TypeParser(s, { valueParser, typeResolver });
  // return parser.parse();

  // Use the new modular parser
  try {
    const parser = new Parser(s, { typeResolver });
    const ast = parser.parseType();
    const type = buildTypeFromAST(ast, typeResolver);
    return type;
  } catch (error) {
    throw new Error(
      `Failed to parse type "${s}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function checkDuplicateNames(elements: NamedElement[]): string {
  const names = new Set<string>();

  for (const { name } of elements) {
    if (name) {
      if (names.has(name)) return name;
      names.add(name);
    }
  }

  return '';
}

// Temporarily export TypeParser for benchmarking
export { TypeParser };

function formatKey(key: string): string {
  // If the key includes non-alphanumeric characters, we need to use backticks
  if (/[^a-zA-Z0-9_]/.test(key)) {
    return '`' + key.replace(/`/g, '\\`') + '`';
  }
  return key;
}
