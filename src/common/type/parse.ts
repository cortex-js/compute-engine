import type { Type, NamedElement, PrimitiveType } from './types';

import { PRIMITIVE_TYPES } from './primitive';
import { typeToString } from './serialize';
import { isValidType } from './utils';
import { fuzzyStringMatch } from '../fuzzy-string-match';

class TypeParser {
  buffer: string;
  pos: number;

  _valueParser: (parser: TypeParser) => any;
  _typeParser: (parser: TypeParser) => string | null;

  constructor(
    buffer: string,
    options?: {
      value?: (parser: TypeParser) => any;
      type?: (parser: TypeParser) => string | null;
    }
  ) {
    this.buffer = buffer;
    this.pos = 0;

    this._valueParser = options?.value ?? (() => null);
    this._typeParser = options?.type ?? (() => null);
  }

  error(...messages: string[]): never {
    throw new Error(
      `\nInvalid type\n|   ${this.buffer}\n|   ${' '.repeat(this.pos)}^\n|   \n|   ${messages.join('\n|   ')}\n`
    );
  }

  peek(): string {
    return this.buffer[this.pos];
  }

  consume(): string {
    return this.buffer[this.pos++];
  }

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

  /** If a white space is allowed, call before `consume()` or `match()` */
  skipWhitespace(): void {
    while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos]))
      this.pos++;
  }

  isEOF(): boolean {
    return this.pos >= this.buffer.length;
  }

  parseValue(): Type | null {
    this.skipWhitespace();
    const value = this._valueParser(this);
    if (value === null) return null;
    return { kind: 'value', value };
  }

  parseTypeReference(): Type | null {
    this.skipWhitespace();
    const ref = this._typeParser(this);
    if (ref === null) return null;
    return { kind: 'reference', ref };
  }

  parsePrimitiveType(): Type | null {
    this.skipWhitespace();
    if (this.isEOF()) this.error('Unexpected end of input');

    for (const type of PRIMITIVE_TYPES) if (this.match(type)) return type;

    return null;
  }

  // Arguments are `name: type` or `type` separated by commas
  parseArguments(): [
    required: NamedElement[],
    optional: NamedElement[],
    restArg: NamedElement | undefined,
  ] {
    const reqArgs: NamedElement[] = [];
    const optArgs: NamedElement[] = [];
    while (true) {
      const arg = this.parseNamedElement();
      if (arg === null) break;

      // No whitespace before '?', i.e. `x: number?`
      if (this.match('?')) optArgs.push(arg);
      else {
        if (optArgs.length > 0)
          this.error('Optional arguments must come after required arguments');

        reqArgs.push(arg);
      }
      this.skipWhitespace();
      if (!this.match(',')) break;
    }

    // Rest argument?
    const restPos = this.pos;
    const restArg = this.parseRestArgument() ?? undefined;

    if (restArg && optArgs.length > 0) {
      this.pos = restPos;
      this.error('Optional arguments cannot be followed by a rest argument');
    }

    const duplicate = checkDuplicateNames([
      ...reqArgs,
      ...optArgs,
      ...(restArg ? [restArg] : []),
    ]);
    if (duplicate) this.error(`Duplicate argument name "${duplicate}"`);

    return [reqArgs, optArgs, restArg];
  }

  // Rest argument is `name: ...type` or `...type`
  parseRestArgument(): NamedElement | null {
    const pos = this.pos;
    const name = this.parseName();

    this.skipWhitespace();
    if (!this.match('...')) {
      this.pos = pos;
      return null;
    }

    // We don't want to parse a type, because it could be a function signature.
    // i.e.   `...number -> number` should be parsed
    // as     `...(number) -> number`
    // not as `...(number -> number)`
    let type = this.parsePrimitiveType() ?? this.parseGroup();

    if (!type) {
      // We didn't get a type. Check if we had "...name:type" instead...
      if (!name) {
        this.pos = pos;
        if (this.match('...') && this.parseName()) {
          const type = this.parsePrimitiveType() ?? this.parseGroup();
          this.pos = pos;
          this.error(
            'The rest argument indicator is placed before the type, not the name',
            `Use "${name}: ...${type ? typeToString(type) : 'number'}"`
          );
        }
      }
    }

    this.skipWhitespace();
    if (this.match(':'))
      this.error('Unexpected ":" after rest argument. Use "x: ...number"');

    // `rest:...` is valid equivalent to `rest:...any`
    type ??= 'any';

    return name ? { name, type } : { type };
  }

  parseFunctionSignature(): Type | null {
    let args: NamedElement[] | undefined = [];
    let optArgs: NamedElement[] | undefined = [];
    let restArg: NamedElement | undefined = undefined;

    this.skipWhitespace();
    let pos = this.pos;
    if (this.match('()')) {
      // Empty argument list is valid
    } else if (this.match('(')) {
      // We have a list of arguments in parentheses
      [args, optArgs, restArg] = this.parseArguments();

      this.skipWhitespace();
      if (!this.match(')')) {
        if (restArg) {
          const el = this.parseNamedElement();
          if (el) {
            this.pos = pos;
            this.error('The rest argument must be the last argument');
          }
          this.error('The rest argument must have a valid type');
        }
        if (optArgs.length > 0) {
          const el = this.parseNamedElement();
          if (el)
            this.error(
              'Optional arguments cannot be followed by required arguments'
            );
          this.skipWhitespace();
          pos = this.pos;
          if (this.match('->')) {
            this.pos = pos;
            this.error('Expected ")" to close the argument list');
          }

          this.error('Expected an argument');
        }
        this.pos = pos;
        return null;
      }
    } else {
      // We could have a single rest argument without parentheses
      // e.g. `...number -> number`
      // We could also have a single argument without parentheses
      // but this case is handled by `parseNamedElement`
      restArg = this.parseRestArgument() ?? undefined;
      if (restArg?.name) {
        // To avoid ambiguity in, e.g.
        // `(x:...number -> number) -> number`
        // `(x:(...number -> number)) -> number`
        // `((x:...number -> number)) -> number`
        this.pos = pos;
        this.error('Named arguments must be enclosed in parentheses');
      }
      if (!restArg) {
        this.pos = pos;
        return null;
      }
    }

    // A function signature must be followed by '->'
    this.skipWhitespace();
    if (!this.match('->')) {
      // It wasn't a signature, backtrack
      this.pos = pos;
      return null;
    }

    const returnType = this.parseType();
    if (returnType === null)
      this.error(
        'Expected a return type.',
        'Use `any` for any type, `nothing` for no return value, or `never` for a function that never returns'
      );

    if (args.length === 0) args = undefined;
    if (optArgs.length === 0) optArgs = undefined;

    return {
      kind: 'signature',
      args,
      optArgs,
      restArg,
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
      // interpreted as a list of `3` since `3` is a valid value type.
      let dimensions = this.parseDimensions();

      // `list<2x3>` is equivalent to `list<any^2x3>`
      if (dimensions !== undefined) {
        this.skipWhitespace();
        if (!this.match('>'))
          this.error('Expected ">".', 'For example `list<2x3>`');
        return { kind: 'list', elements: 'any', dimensions };
      }

      // `list<>` is equivalent to `list<any>`

      const type = this.parseType();
      if (type && this.match('^')) {
        // We got both a type and dimensions
        dimensions = this.parseDimensions();
        if (dimensions === undefined)
          this.error(
            'Expected dimensions after `^`.',
            'For example `list<number^2x3>`'
          );
      }

      this.skipWhitespace();
      if (!this.match('>'))
        this.error('Expected ">".', 'For example `list<number>`');

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

      this.skipWhitespace();
      if (!this.match('>'))
        this.error('Expected ">"', 'For example `vector<integer>`');
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

      if (!this.match('>'))
        this.error('Expected ">".', 'For example `matrix<integer>`');

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

      if (!this.match('>'))
        this.error('Expected ">".', 'For example `tensor<number>`');

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

    const type = this.parseType();
    if (type === null)
      this.error('Expected a type. Use "[any]" for a collection of any type');

    const dimensions = this.match('^') ? this.parseDimensions() : undefined;

    this.skipWhitespace();
    if (!this.match('>'))
      this.error('Expected ">".', 'For example `list<number^2x3>`');

    return { kind: 'list', elements: type, dimensions };
  }

  parseName(): string | null {
    const pos = this.pos;
    this.skipWhitespace();
    if (this.isEOF()) return null;

    if (!/[a-zA-Z_]/.test(this.peek())) return null;

    let name = '';
    while (!this.isEOF() && /[a-zA-Z0-9_]/.test(this.peek()))
      name += this.consume();

    this.skipWhitespace();

    if (!this.match(':')) {
      if (this.match('?:')) {
        const type = this.parseType();
        if (type)
          this.error(
            'Optional qualifier must come after the type',
            `Use "${name}: ${typeToString(type)}?"`
          );
        this.error(
          'Optional qualifier must come after the type',
          `Use "${name}: number?"`
        );
      }

      this.pos = pos;
      return null;
    }

    return name;
  }

  parseKey(): string | null {
    this.skipWhitespace();
    if (this.isEOF()) return null;

    let key = '';

    // Is this a verbatim key (i.e. surrounded by backticks)?
    if (this.match('`')) {
      // @todo incorporate escape sequences from Epsil
      while (this.peek() !== '`') {
        if (this.isEOF()) this.error('Expected closing backtick');
        // Escaped backtick?
        if (this.match('\\`')) key += '`';
        else key += this.consume();
      }

      return key;
    }

    // If not a verbatim key, scan until whitespace or ':'
    while (!this.isEOF() && !/[:\s]/.test(this.peek())) key += this.consume();
    return key;
  }

  /** Parse:
   * - "<identifier>: <type>"
   * - "<type>"
   */
  parseNamedElement(): NamedElement | null {
    const pos = this.pos;
    const name = this.parseName();
    if (name !== null) {
      const type = this.parseType();
      if (type === null) {
        // We had a valid name, i.e. "x:", but an invalid type
        // i.e. "x: foo". But, "x: ...number" is valid
        this.skipWhitespace();
        if (this.match('...')) {
          this.pos = pos;
          return null;
        }

        this.pos = pos;
        this.error(`Expected a valid type after "${name}:"`);
      }

      this.skipWhitespace();
      if (this.match('->')) {
        // Avoid ambiguity in, e.g.
        // `x: number -> number`
        // `(x:number) -> number`
        // `x:(number -> number)`

        this.pos = pos;
        this.error('Single named argument must be enclosed in parentheses');
      }

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
    }

    const duplicate = checkDuplicateNames(elements);
    if (duplicate) this.error(`Duplicate tuple named element "${duplicate}"`);

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

    this.skipWhitespace();
    if (!this.match('>'))
      this.error(
        'Expected ">".',
        'For example `tuple<number, boolean>` or `tuple<x: integer, y: integer>`'
      );
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
        this.error(
          'Use `set<type>` instead of `set(type)`.',
          'For example `set<number>`'
        );
      }
      if (this.match('set')) return 'set';
      return null;
    }

    const type = this.parseType();
    if (type === null)
      this.error('Expected a type.', 'Use `set<number>` for a set of numbers');

    this.skipWhitespace();
    if (!this.match('>'))
      this.error('Expected `>`.', 'For example `set<number>`');

    return { kind: 'set', elements: type };
  }

  parseMapElements(): [string, Type][] {
    const entries: [string, Type][] = [];

    while (true) {
      const key = this.parseKey();
      if (key === null)
        this.error(
          'Expected a name for the key.',
          'For example `map<key: string>`.',
          'Use backticks for special characters.',
          'For example `map<`key with space`: string>`'
        );

      this.skipWhitespace();
      if (!this.match(':'))
        this.error(
          'Expected a type separated by a `:` after the key.',
          `For example \`map<${key}: string>\``,
          'Use backticks for special characters.',
          'For example `map<`key with space`: string>`'
        );

      const value = this.parseType();
      if (value === null)
        this.error(
          'Expected a type for the value. Use `any` for any type.',
          `For example \`map<${key}: any>.\``
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
        `Duplicate map key "${duplicate}"`,
        'Keys in a map must be unique.'
      );
    }

    return entries;
  }

  parseMap(): Type | null {
    this.skipWhitespace();

    if (this.match('map(')) {
      this.error(
        'Use `map<key: type>` instead of `map(key: type)".',
        'For example `map<key: string>`'
      );
    }

    if (this.match('map<')) {
      const entries = this.parseMapElements();

      this.skipWhitespace();
      if (!this.match('>'))
        this.error('Expected a closing `>`.', 'For example `map<key: string>`');

      return { kind: 'map', elements: Object.fromEntries(entries) };
    }

    // Generic map type
    if (this.match('map')) return 'map';
    return null;
  }

  // A generic collection type, e.g. `collection<number>`
  parseCollection(): Type | null {
    this.skipWhitespace();
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

    this.skipWhitespace();
    if (!this.match('>'))
      this.error('Expected ">".', 'For example `collection<number>`');

    return { kind: 'collection', elements: type };
  }

  parsePrimary(): Type | null {
    let result =
      this.parseGroup() ??
      this.parseNegationType() ??
      this.parseList() ??
      this.parseSet() ??
      this.parseMap() ??
      this.parseCollection() ??
      this.parseTuple() ??
      this.parsePrimitiveType() ??
      this.parseValue() ??
      this.parseTypeReference();

    if (result === null) {
      // If we've reached this point, we've run into a syntax error
      // Is it a keyword...?
      let keyword = '';
      while (!this.isEOF() && /[a-zA-Z_]/.test(this.peek()))
        keyword += this.consume();
      if (!keyword) return null;
      const suggest = fuzzyStringMatch(keyword, [
        ...PRIMITIVE_TYPES,
        'vector',
        'matrix',
      ]);
      if (suggest)
        this.error(
          `Unknown keyword "${keyword}"`,
          `Did you mean "${suggest}"?`
        );
      return null;
    }
    this.skipWhitespace();

    // If we're followed by a '->', this is a function signature without parens
    // e.g. "number -> number"
    if (this.match('->')) {
      const returnType = this.parseType();
      if (returnType === null)
        this.error(
          'Expected return type',
          'Use `any` for any type, `nothing` for no return value or `never` for a function that never returns'
        );
      result = {
        kind: 'signature',
        args: [{ type: result }],
        result: returnType,
      };
    }

    return result;
  }

  parseNegationType(): Type | null {
    if (!this.match('!')) return null;
    const type = this.parsePrimary();
    if (type === null) this.error('Expected type');
    return { kind: 'negation', type };
  }

  // <intersection_type> ::= <primary_type> (" & " <primary_type>)*

  parseIntersectionType(): Type | null {
    let type = this.parseFunctionSignature() ?? this.parsePrimary();
    if (type === null) return null;
    const types: Type[] = [type];

    this.skipWhitespace();
    while (this.match('&')) {
      this.skipWhitespace();
      type = this.parsePrimary();
      if (type === null) this.error('Expected type');
      types.push(type);
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

  parse(): Readonly<Type> {
    const pos = this.pos;
    if (this.parseName() !== null) {
      this.pos = pos;
      // Named elements are potentially ambiguous with function signatures
      // i.e. `x: number -> number` could be interpreted as `x: (number -> number)`
      // or `(x: number) -> number`
      // To avoid this ambiguity, we require named elements to be enclosed in parentheses
      this.error('Named elements must be enclosed in parentheses');
    }

    const type = this.parseType();
    if (type === null) this.error('Syntax error. The type was not recognized.');

    this.skipWhitespace();

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

    if (!/[0-9]/.test(parser.peek())) {
      parser.pos = pos;
      return null;
    }

    while (/[0-9]/.test(parser.peek()))
      value = value * 10 + parseInt(parser.consume());

    if (parser.match('.')) {
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

  if (parser.match('infinity')) return Infinity;

  if (parser.match('-infinity')) return -Infinity;

  parser.pos = pos;

  return null;
}

export function parseType(s: undefined): undefined;
export function parseType(s: string | Type): Type;
export function parseType(s: string | Type | undefined): Type | undefined;
export function parseType(s: string | Type | undefined): Type | undefined {
  if (s === undefined) return undefined;
  if (isValidType(s)) return s;
  if (typeof s !== 'string') return undefined;

  // Check if it's a primitive type
  if (PRIMITIVE_TYPES.includes(s as PrimitiveType)) return s as PrimitiveType;

  // Parse the type string
  const parser = new TypeParser(s, { value: valueParser });
  return parser.parse();
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
