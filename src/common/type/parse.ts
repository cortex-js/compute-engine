import type { Type, NamedElement, FunctionSignature, TupleType } from './types';

import { PRIMITIVE_TYPES } from './primitive';
import { typeToString } from './serialize';

class TypeParser {
  buffer: string;
  pos: number;

  constructor(buffer: string) {
    this.buffer = buffer;
    this.pos = 0;
  }

  error(...messages: string[]): never {
    throw new Error(
      `Invalid type\n|   ${this.buffer}\n|   ${' '.repeat(this.pos)}^\n|   \n|   ${messages.join('\n|   ')}\n`
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
    while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos])) {
      this.pos++;
    }
  }

  isEOF(): boolean {
    return this.pos >= this.buffer.length;
  }

  parsePrimitiveType(): Type | null {
    this.skipWhitespace();
    if (this.isEOF()) this.error('Unexpected end of input');

    for (const type of PRIMITIVE_TYPES) {
      if (this.match(type)) return type;
    }

    return null;
  }

  parseArguments(): [required: NamedElement[], optional: NamedElement[]] {
    const optArgs: NamedElement[] = [];
    const reqArgs: NamedElement[] = [];
    while (true) {
      let arg = this.parseNamedElement();
      if (arg === null) break;

      // No whitespace before '?', i.e. `x: number?`
      if (this.match('?')) {
        optArgs.push(arg);
      } else {
        if (optArgs.length > 0)
          this.error('Optional arguments must come after required arguments');

        reqArgs.push(arg);
      }
      this.skipWhitespace();
      if (!this.match(',')) break;
    }
    return [reqArgs, optArgs];
  }

  parseRestArgument(): NamedElement | null {
    const pos = this.pos;
    const name = this.parseName();

    this.skipWhitespace();
    if (!this.match('...')) {
      this.pos = pos;
      return null;
    }

    // `rest:...` is valid equivalent to `rest:...any`
    const type =
      this.parsePrimitiveType() ?? this.parseWrappedPrimary() ?? 'any';

    this.skipWhitespace();
    if (this.match(':')) {
      this.error('Unexpected ":" after rest argument. Use "x: ...number"');
    }

    return name ? { name, type } : { type };
  }

  parseFunctionSignature(): FunctionSignature | null {
    let hold: boolean | undefined = undefined;
    let args: NamedElement[] | undefined = [];
    let optArgs: NamedElement[] | undefined = [];
    let restArg: NamedElement | undefined = undefined;

    this.skipWhitespace();
    let pos = this.pos;
    if (this.match('()')) {
    } else {
      // Is it a deferred evaluation?
      if (this.match('???')) hold = true;

      // No whitespace allowed with `???(`
      if (this.match('(')) {
        // We have a list of arguments in parentheses

        [args, optArgs] = this.parseArguments();

        // Rest argument?
        const restPost = this.pos;
        restArg = this.parseRestArgument() ?? undefined;

        if (restArg && optArgs.length > 0) {
          this.pos = restPost;
          this.error(
            'Optional arguments cannot be followed by a rest argument'
          );
        }

        this.skipWhitespace();
        if (!this.match(')')) {
          if (restArg) {
            this.error('The rest argument must be the last argument');
          }
          if (optArgs.length > 0) {
            this.error(
              'Optional arguments cannot be followed by required arguments'
            );
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
          this.error('Named arguments must be in parentheses');
        }
        if (!restArg) {
          this.pos = pos;
          return null;
        }
      }
    }

    // A function signature must be followed by '->'
    // If it wasn't, it may have been a tuple
    // i.e. `(number, number)` is a tuple, `(number, number) -> number` is a function signature
    this.skipWhitespace();
    if (!this.match('->')) {
      this.pos = pos;
      return null;
    }

    const result = this.parseType();
    if (result === null)
      this.error(
        'Expected return type.',
        'Use "any" for any type or "nothing" for no return value'
      );

    if (args.length === 0) args = undefined;
    if (optArgs.length === 0) optArgs = undefined;

    return { kind: 'signature', hold, args, optArgs, restArg, result };
  }

  parsePositiveIntegerLiteral(): number | null {
    let value = 0;

    this.skipWhitespace();
    while (/[1-9]/.test(this.peek()))
      value = value * 10 + parseInt(this.consume());

    if (value === 0) return null;
    return value;
  }

  parseDimensions(): number[] | undefined {
    // No whitespace before optional "(", i.e. `[number^(2x3)]`
    const hasParen = this.match('(');
    const dimensions: number[] = [];

    let dim = this.parsePositiveIntegerLiteral();
    if (this.match('?')) dim = -1;
    if (dim === null)
      this.error(
        'Expected a positive integer literal.',
        'For example : "[number^2]"'
      );
    do {
      dimensions.push(dim);
      this.skipWhitespace();
      if (!this.match('x')) break;
      this.skipWhitespace();
      dim = this.parsePositiveIntegerLiteral();
      if (this.match('?')) dim = -1;
      if (dim === null)
        this.error(
          'Expected a positive integer literal.',
          'For example : "[number^2x3]"'
        );
    } while (dim !== null);

    this.skipWhitespace();
    if (hasParen && !this.match(')'))
      this.error('Expected ")".', 'For example "[number^(2x3)]"');
    return dimensions;
  }

  parseList(): Type | null {
    this.skipWhitespace();

    // A list has some shorthand syntaxes:
    // - `vector(3)` is equivalent to `[number^3]`
    // - `matrix(2x3)` is equivalent to `[number^2x3]`
    // - `list()` is equivalent to `[any]`
    // - `list(string)` is equivalent to `[string]`
    // - `list(number^2x3)` is equivalent to `[number^2x3]`

    // `list<<type>>` and `list<<type>^<dimensions>>` and `list(<dimensions>)`
    if (this.match('list<')) {
      const type = this.parseType() ?? 'any';

      let dimensions: number[] | undefined = undefined;
      if (this.match('^')) {
        dimensions = this.parseDimensions();
        if (dimensions === undefined)
          this.error('Expected dimensions.', 'For example "list<number^2x3>"');
      }

      this.skipWhitespace();
      if (!this.match('>'))
        this.error('Expected ">".', 'For example "list<number>"');
      return { kind: 'list', elements: type, dimensions };
    }

    // `vector<<size>>` and `vector<<type>^<size>>`
    if (this.match('vector<')) {
      const type = this.parseType() ?? 'number';

      let dimensions: number[] | undefined = undefined;
      if (this.match('^')) {
        const size = this.parsePositiveIntegerLiteral();
        if (size === null)
          this.error(
            'Expected a positive integer literal.',
            'For example "vector<3>"',
            'Use "vector" for a vector of unknown size'
          );
        dimensions = [size];
      }

      this.skipWhitespace();
      if (!this.match('>'))
        this.error('Expected ">"', 'For example "vector<integer>"');
      return { kind: 'list', elements: type, dimensions };
    }

    if (this.match('vector')) return { kind: 'list', elements: 'number' };

    // `matrix(<rows>x<columns>)` and `matrix(<type>^<rows>x<columns>)`

    if (this.match('matrix<')) {
      const type = this.parseType() ?? 'number';

      let dimensions: number[] | undefined = undefined;
      if (this.match('^')) {
        dimensions = this.parseDimensions();
        if (dimensions === undefined)
          this.error(
            'Expected dimensions',
            'For example "matrix<number^2x3>"',
            'Use "matrix" for a matrix of unknown size'
          );
      }

      if (!this.match('>'))
        this.error('Expected ">".', 'For example "matrix<integer>"');

      return { kind: 'list', elements: type, dimensions };
    }

    if (this.match('matrix')) return { kind: 'list', elements: 'number' };

    // Regular list syntax: `[number^2x3]`
    if (!this.match('[')) return null;

    const type = this.parseType();
    if (type === null)
      this.error('Expected a type. Use "[any]" for a collection of any type');

    const dimensions = this.match('^') ? this.parseDimensions() : undefined;

    this.skipWhitespace();
    if (!this.match(']'))
      this.error('Expected "]".', 'For example "[number^2x3]"');

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
      this.pos = pos;
      return null;
    }

    return name;
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
        this.pos = pos;
        return null;
      }

      this.skipWhitespace();
      if (this.match('->')) {
        // Avoid ambiguity in, e.g.
        // `x: number -> number`
        // `(x:number) -> number`
        // `x:(number -> number)`

        this.pos = pos;
        this.error('Single named argument must be in parentheses');
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
    return elements;
  }

  parseTuple(): Type | null {
    this.skipWhitespace();

    if (this.match('tuple(')) {
      const elements = this.parseTupleElements();
      this.skipWhitespace();
      if (!this.match(')'))
        this.error(
          'Expected ")".',
          'For example "tuple(number, boolean)" or "tuple(x: integer, y: integer)"'
        );
      return { kind: 'tuple', elements };
    }

    if (!this.match('(')) return null;
    const elements = this.parseTupleElements();
    this.skipWhitespace();
    if (!this.match(')'))
      this.error(
        'Expected ")".',
        'For example "(number, boolean)" or "(x: integer, y: integer)"'
      );

    // If we have a singleton tuple, return the type directly
    // i.e. `(number)` is a number. For singleton tuples, use the
    // function syntax, i.e. `tuple(number)`
    if (elements.length === 1 && !elements[0].name) return elements[0].type;

    return { kind: 'tuple', elements };
  }

  parseWrappedPrimary(): Type | null {
    const pos = this.pos;
    // A primary can be enclosed in parens, i.e. "(number)".
    // However, two other constructs can start with a paren:
    // - a tuple, i.e. "(number, boolean)"
    // - a function signature, i.e. "(number) -> number"

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

    // Backtrack. This could be a tuple or a function signature
    if (this.match(')')) {
      this.skipWhitespace();
      if (!this.match('->')) return type;
    }
    // This was not a primary type, backtracks
    this.pos = pos;

    return null;
  }

  parseSet(): Type | null {
    this.skipWhitespace();
    if (!this.match('set<')) {
      if (this.match('set(')) {
        this.error(
          'Use "set<type>" instead of "set(type)".',
          'For example "set<number>"'
        );
      }
      if (this.match('set')) return 'set';
      return null;
    }

    const type = this.parseType();
    if (type === null)
      this.error('Expected a type. Use "set<number>" for a set of numbers');

    this.skipWhitespace();
    if (!this.match('>'))
      this.error('Expected ">".', 'For example "set<number>"');

    return { kind: 'set', elements: type };
  }

  parseMapElements(): [string, Type][] {
    const entries: [string, Type][] = [];

    while (true) {
      this.skipWhitespace();
      const key = this.parseName();
      if (key === null)
        this.error(
          'Expected a name for the key.',
          'For example "map(key: string)"'
        );

      const value = this.parseType();
      if (value === null)
        this.error(
          'Expected a type for the value.',
          'For example "map(key: string)"'
        );

      entries.push([key, value]);

      this.skipWhitespace();
      if (!this.match(',')) break;
    }
    return entries;
  }

  parseMap(): Type | null {
    this.skipWhitespace();

    if (this.match('{')) {
      const entries = this.parseMapElements();

      this.skipWhitespace();
      if (!this.match('}'))
        this.error('Expected "}".', 'For example "{key: string}"');

      return { kind: 'map', elements: Object.fromEntries(entries) };
    }

    if (!this.match('map(')) {
      if (this.match('map<')) {
        this.error(
          'Use "map(key: type)" instead of "map<key: type>".',
          'For example "map<key: string>"'
        );
      }
      if (this.match('map{')) {
        this.error(
          'Use "map(key: type)" or "{key: type}" instead of "map{key: type}".',
          'For example "map{key: string}" or "{key: string}"'
        );
      }
      // Generic map type
      if (this.match('map')) return 'map';
      return null;
    }

    const entries = this.parseMapElements();

    this.skipWhitespace();
    if (!this.match(')'))
      this.error('Expected ")".', 'For example "map(key: string)"');

    return { kind: 'map', elements: Object.fromEntries(entries) };
  }

  // A generic collection type, e.g. `collection<number>`
  parseCollection(): Type | null {
    this.skipWhitespace();
    if (!this.match('collection<')) {
      if (this.match('collection(')) {
        this.error(
          'Use "collection<type>" instead of "collection(type)".',
          'For example "collection<number>"'
        );
      }
      if (this.match('collection')) return 'collection';
      return null;
    }

    const type = this.parseType();
    if (type === null)
      this.error(
        'Expected a type. Use "collection<number>" for a collection of numbers'
      );

    this.skipWhitespace();
    if (!this.match('>'))
      this.error('Expected ">".', 'For example "collection<number>"');

    return { kind: 'collection', elements: type };
  }

  parsePrimary(): Type | null {
    let result =
      this.parseList() ??
      this.parseSet() ??
      this.parseMap() ??
      this.parseCollection() ??
      this.parseFunctionSignature() ??
      this.parseTuple() ??
      this.parsePrimitiveType() ??
      this.parseWrappedPrimary();

    // If we're followed by a '->', this is a function signature without parens
    // e.g. "number -> number"
    if (result === null) return null;
    this.skipWhitespace();
    if (this.match('->')) {
      const returnType = this.parseType();
      if (returnType === null)
        this.error(
          'Expected return type',
          'Use "any" for any type or "nothing" for no return value'
        );
      result = {
        kind: 'signature',
        args: [{ type: result }],
        result: returnType,
      };
    }

    return result;
  }

  // <intersection_type> ::= <primary_type> (" & " <primary_type>)*

  parseIntersectionType(): Type | null {
    let type = this.parsePrimary();
    if (type === null) return null;
    const types: Type[] = [type];

    this.skipWhitespace();
    while (this.match('&')) {
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

  // <type> ::= "(" <type> ")"
  //       | <union_type>
  parseType(): Type | null {
    this.skipWhitespace();
    if (this.isEOF()) return null;

    return this.parseUnionType();
  }

  parse(): Type {
    const type = this.parseType();

    const pos = this.pos;
    if (this.parseNamedElement() !== null) {
      this.pos = pos;
      this.error('Named elements must be enclosed in parentheses');
    }

    if (type === null) this.error('Syntax error');

    this.skipWhitespace();

    if (!this.isEOF()) this.error('Unexpected characters');

    // Add a toString method to the type
    if (typeof type === 'object') type.toString = () => typeToString(type);

    return type;
  }
}

export function parseType(s: string): Type {
  // Parse the type string
  const parser = new TypeParser(s);
  return parser.parse();
}
