import { Buffer } from './buffer';
import { StyledBlock, StyledSpan } from './styled-text';

export type CodeTag =
  /** Plain text in default foreground/background color */
  | 'default'
  /** A literal such as a number, string or regex */
  | 'literal'
  /** A comment */
  | 'comment'
  /** A language keyword: if, while, export */
  | 'keyword'
  /** An operator such as =, >=, +, etc... */
  | 'operator'
  /** A punctuation such as `;`, `,`, `:` */
  | 'punctuation'
  /** An identifier such as "foo" or "bar" */
  | 'identifier'
  /** A type such as `boolean` or `number` */
  | 'type';

export type CodeSpan = {
  tag: CodeTag;
  content: string;
};

// VIM Ron color scheme (for dark background)
// - comment = green
// - constant = cyan bold
// - identifier = cyan
// - statement lightblue
// - type = seagreen bold
// - operator = orange

// Proposed color scheme:
// - comment = light blue or grey
// - keyword = orange
// - literal = green or dark green
// - constants (true, null, etc...) = bold green
// - operator = yellow
// - identifier = white

// https://yorickpeterse.com/articles/how-to-write-a-code-formatter/
// https://www.benjamin.pizza/posts/2024-08-15-prettier-happier-more-imperative.html

const DEFAULT_THEME: Record<string, Partial<StyledSpan>> = {
  comment: { fg: 'bright-blue', italic: true },
  keyword: { fg: 'bright-red', weight: 'bold' },
  literal: { fg: 'green' },
  constant: { fg: 'green', weight: 'bold' },
  operator: { fg: 'magenta' },
  punctuation: { fg: 'cyan' },
  identifier: { fg: 'default' },
  type: { fg: 'yellow' },
  default: { fg: 'default', bg: 'default' },
  mark: { bg: 'bright-blue', fg: 'yellow' },
  mark_indicator: { fg: 'bright-blue' },
};

const DEFAULT_KEYWORDS: Record<string, CodeTag> = {
  'const': 'keyword',
  'let': 'keyword',
  'var': 'keyword',

  'if': 'keyword',
  'else': 'keyword',
  'for': 'keyword',
  'while': 'keyword',
  'do': 'keyword',
  'switch': 'keyword',
  'case': 'keyword',
  'break': 'keyword',
  'continue': 'keyword',
  'return': 'keyword',
  'default': 'keyword',

  'function': 'keyword',
  'class': 'keyword',
  'interface': 'keyword',
  'type': 'keyword',

  'enum': 'keyword',
  'export': 'keyword',
  'import': 'keyword',
  'from': 'keyword',

  'as': 'keyword',

  'null': 'literal',
  'undefined': 'literal',
  'true': 'literal',
  'false': 'literal',
  'this': 'literal',
  'self': 'literal',
  'super': 'literal',

  'new': 'keyword',
  'delete': 'keyword',
  'typeof': 'keyword',
  'instanceof': 'keyword',
  'in': 'keyword',
  'await': 'keyword',
  'async': 'literal',

  'void': 'type',
  'any': 'type',
  'number': 'type',
  'string': 'type',
  'boolean': 'type',
  'object': 'type',
  'symbol': 'type',
  'bigint': 'type',
  'never': 'type',
  'unknown': 'type',
  'Array': 'type',
  'Record': 'type',

  'public': 'keyword',
  'private': 'keyword',
  'protected': 'keyword',
  'readonly': 'keyword',
  'static': 'keyword',
  'abstract': 'keyword',
  'implements': 'keyword',
  'extends': 'keyword',
  'declare': 'keyword',
  'namespace': 'keyword',
  'module': 'keyword',
  'require': 'keyword',

  '<=': 'operator',
  '>=': 'operator',
  '==': 'operator',
  '!=': 'operator',
  '===': 'operator',
  '!==': 'operator',
  '&&': 'operator',
  '||': 'operator',
  '+': 'operator',
  '-': 'operator',
  '*': 'operator',
  '/': 'operator',
  '%': 'operator',
  '++': 'operator',
  '--': 'operator',
  '=': 'operator',
  '+=': 'operator',
  '-=': 'operator',
  '*=': 'operator',
  '/=': 'operator',
  '%=': 'operator',
  '=>': 'operator',
  '->': 'operator',
  '?': 'operator',
  '!': 'operator',
  '~': 'operator',
  '&': 'operator',
  '|': 'operator',
  '^': 'operator',
  '<<': 'operator',
  '>>': 'operator',
  '>>>': 'operator',

  '.': 'punctuation',
  ',': 'punctuation',
  ':': 'punctuation',
  ';': 'punctuation',
  '(': 'punctuation',
  ')': 'punctuation',
  '{': 'punctuation',
  '}': 'punctuation',
  '[': 'punctuation',
  ']': 'punctuation',
  '<': 'punctuation',
  '>': 'punctuation',
};

export type SyntaxGrammar = {
  comment?: (buf: Buffer) => undefined | CodeSpan;
  number?: (buf: Buffer) => undefined | CodeSpan;
  string?: (buf: Buffer) => undefined | CodeSpan;
  regex?: (buf: Buffer) => undefined | CodeSpan;
  identifier?: (buf: Buffer) => undefined | CodeSpan;
  keyword?: (buf: Buffer) => undefined | CodeSpan;
};

const defaultGrammar: SyntaxGrammar = {
  comment: (buf: Buffer) => {
    let pos = buf.pos;
    if (buf.match('//')) {
      while (!buf.atEnd() && buf.peek() !== '\n') buf.consume();
      return { content: buf.s.slice(pos, buf.pos), tag: 'comment' };
    }

    if (buf.match('/*')) {
      while (!buf.atEnd() && !buf.match('*/')) {
        // Skip escape sequences, i.e. /* ... \*/ */
        if (buf.peek() === '\\') buf.consume();
        buf.consume();
      }
      return { content: buf.s.slice(pos, buf.pos), tag: 'comment' };
    }

    return undefined;
  },

  number: (buf: Buffer) => {
    let pos = buf.pos;
    if (buf.match('0x')) {
      while (!buf.atEnd() && /[0-9a-fA-F]/.test(buf.peek())) buf.consume();
      return { content: buf.s.slice(buf.pos), tag: 'literal' };
    }

    if (!/[0-9]/.test(buf.peek())) return undefined;

    while (!buf.atEnd() && /[0-9]/.test(buf.peek())) buf.consume();

    // Fractional part
    if (buf.match('.'))
      while (!buf.atEnd() && /[0-9]/.test(buf.peek())) buf.consume();

    // Exponent
    if (buf.match('e') || buf.match('E')) {
      buf.match('+') || buf.match('-');
      while (!buf.atEnd() && /[0-9]/.test(buf.peek())) buf.consume();
    }

    return { content: buf.s.slice(pos, buf.pos), tag: 'literal' };
  },

  string: (buf: Buffer) => {
    let pos = buf.pos;
    const quote = buf.peek();
    if (quote !== '"' && quote !== "'") return undefined;

    buf.consume();
    while (!buf.atEnd() && buf.peek() !== quote) {
      if (buf.peek() === '\\') buf.consume();
      buf.consume();
    }

    buf.consume();
    return { content: buf.s.slice(pos, buf.pos), tag: 'literal' };
  },

  regex: (buf: Buffer) => {
    let pos = buf.pos;
    if (buf.match('//')) {
      buf.pos = pos;
      return undefined;
    }
    if (!buf.match('/')) return undefined;

    while (!buf.atEnd() && buf.peek() !== '/') {
      if (buf.peek() === '\\') buf.consume();
      if (buf.peek() === '\n')
        return { content: buf.s.slice(buf.pos), tag: 'literal' };
      buf.consume();
    }

    buf.consume();
    return { content: buf.s.slice(pos, buf.pos), tag: 'literal' };
  },

  identifier: (buf: Buffer) => {
    let pos = buf.pos;
    while (!buf.atEnd() && /[a-zA-Z0-9_]/.test(buf.peek())) buf.consume();
    if (buf.pos === pos) return undefined;
    return { content: buf.s.slice(pos, buf.pos), tag: 'identifier' };
  },

  keyword: (buf: Buffer) => {
    // If the preceding character is a dot, this is not a keyword
    // i.e. in "foo.done", `done` is not a keyword
    if (buf.pos > 0 && /[\.]/.test(buf.s[buf.pos - 1])) return undefined;

    const keywords = Object.keys(DEFAULT_KEYWORDS);

    // Sort by length, longest first
    keywords.sort((a, b) => b.length - a.length);

    let pos = buf.pos;
    for (const keyword of keywords) {
      buf.pos = pos;
      if (buf.match(keyword)) {
        // If the keywords ends with a letter, check that the next character is not a letter or number
        const lastChar = keyword[keyword.length - 1];
        if (lastChar.match(/[a-zA-Z0-9_]/)) {
          if (!buf.atEnd() && /[a-zA-Z0-9_]/.test(buf.peek())) {
            buf.pos = pos;
            return undefined;
          }
        }
        return { content: keyword, tag: DEFAULT_KEYWORDS[keyword] };
      }
    }

    return undefined;
  },
};

export function parseCode(
  text: string,
  grammar: SyntaxGrammar = defaultGrammar,
  pos = 0
): CodeSpan[] {
  const spans: CodeSpan[] = [];

  const buf = new Buffer(text, pos);

  while (!buf.atEnd()) {
    const result =
      grammar.comment?.(buf) ??
      grammar.number?.(buf) ??
      grammar.regex?.(buf) ??
      grammar.string?.(buf) ??
      grammar.keyword?.(buf) ??
      grammar.identifier?.(buf);

    if (result) {
      spans.push(result);
      continue;
    }

    // If last span is default, coalesce with this one
    let lastSpan = spans.length ? spans[spans.length - 1] : null;
    if (lastSpan?.tag === 'default') {
      lastSpan.content += buf.consume();
    } else {
      spans.push({ content: buf.consume(), tag: 'default' });
    }
  }

  return spans;
}

function renderCode(spans: CodeSpan[], theme = DEFAULT_THEME): StyledSpan[] {
  return spans.map((span) => {
    const style = { ...theme[span.tag], content: span.content };
    return style;
  });
}

/** Return a style span of the input code */
export function highlightCodeSpan(
  code: string,
  grammar?: SyntaxGrammar
): StyledSpan[] {
  const spans = parseCode(code, grammar);
  return renderCode(spans);
}

/** Return a style block of the input code, including a
 * gutter with line numbers and an optional highlighted line
 */
export function highlightCodeBlock(
  code: string,
  lineStart: number | undefined = 1,
  markIndicator?: string,
  grammar?: SyntaxGrammar
): StyledBlock {
  // Split the mark into a line and column range
  // e.g 14:3-14 -> { line: 14, colStart: 3, colEnd: 14 }
  let markLine = 0;
  let markCol = '';
  if (markIndicator) {
    let lineStr = '';
    [lineStr, markCol] = markIndicator.split(':');
    markLine = parseInt(lineStr);
  }

  // Split the code into lines
  const sourceLines = code.split('\n');

  // Parse each line
  const lines = sourceLines.map((line) => renderCode(parseCode(line, grammar)));

  if (lineStart === undefined) {
    // Concatenate the lines into a single block without a gutter
    const content = lines.flatMap((line) => [...line, { content: '\n' }]);
    return { tag: 'block', spans: content };
  }

  // Turn the lines into a StyleBlock
  const lastLine = lineStart + sourceLines.length - 1;
  const maxDigits = lastLine.toString().length;

  // Return a StyleBlock with a gutter including line numbers

  const content: StyledSpan[] = lines.flatMap((line, i) => {
    const lineNo = lineStart + i;
    if (lineNo === markLine) {
      return [
        {
          content: `\n${lineNo.toString().padStart(maxDigits, ' ')} `,
          weight: 'normal',
          ...DEFAULT_THEME.mark,
        },
        {
          content: `\u2503`,
          ...DEFAULT_THEME.mark_indicator,
        },
        ...mark(line, markCol),
      ];
    } else {
      const lineNoStr = `\n${lineNo.toString().padStart(maxDigits, ' ')}`;
      return [
        { content: lineNoStr, weight: 'thin' },
        { content: ' \u2502 ', fg: 'white' }, // U+2502 Thin vertical line
        ...line,
      ];
    }
  });

  content.push({ content: '\n' });

  return { tag: 'block', spans: content };
}

export function mark(line: StyledSpan[], mark: string): StyledSpan[] {
  // Mark is of the form "1-3" and indicates a range of characters to mark
  let [start, end] = mark.split('-').map((x) => parseInt(x));
  if (end === undefined) end = start + 1;
  if (start >= end) end = start + 1;

  let pos = 0;

  const markSpan = (span: StyledSpan): StyledSpan[] => {
    const content = span.content;

    const spanStart = pos;
    const spanEnd = pos + content.length - 1;

    pos += content.length;

    // Is the span entirely outside the marked range?
    if (spanEnd < start || end < spanStart) return [span];

    // Is the span entirely inside the marked range?
    if (spanStart >= start && spanEnd <= end)
      return [{ ...span, ...DEFAULT_THEME.mark }];

    // Is the start of the span in the marked range?
    if (spanStart >= start && spanEnd > end) {
      const before = content.slice(0, end + 1 - pos);
      const after = content.slice(end + 1 - pos);
      return [
        { ...span, content: before, ...DEFAULT_THEME.mark },
        { ...span, content: after },
      ];
    }

    // Is the end of the span in the marked range?
    if (start >= spanStart && end >= spanEnd) {
      const before = content.slice(0, start - pos);
      const after = content.slice(start - pos);
      return [
        { ...span, content: before },
        { ...span, content: after, ...DEFAULT_THEME.mark },
      ];
    }

    // The span is entirely inside the marked range
    const before = content.slice(0, start - pos);
    const marked = content.slice(start - pos, end - pos + 1);
    const after = content.slice(end - pos + 1);
    return [
      { ...span, content: before },
      { ...span, content: marked, ...DEFAULT_THEME.mark },
      { ...span, content: after },
    ];
  };

  return line.flatMap((span) => markSpan(span));
}

// http://octopress.org/docs/blogging/code/test/

// Python
/*

#!/usr/bin/env python
"""Test file for Python syntax highlighting in editors / IDEs.

Meant to cover a wide range of different types of statements and expressions.
Not necessarily sensical or comprehensive (assume that if one exception is
highlighted that all are, for instance).

Extraneous trailing whitespace can't be tested because of svn pre-commit hook
checks for such things.

"""
# Comment
# OPTIONAL: XXX catch your attention
# TODO(me): next big thing
# FIXME: this does not work

# Statements
from __future__ import with_statement  # Import
from sys import path as thing

print(thing)

assert True  # keyword


def foo():  # function definition
    return []


class Bar(object):  # Class definition
    def __enter__(self):
        pass

    def __exit__(self, *args):
        pass

foo()  # UNCOLOURED: function call
while False:  # 'while'
    continue
for x in foo():  # 'for'
    break
with Bar() as stuff:
    pass
if False:
    pass  # 'if'
elif False:
    pass
else:
    pass

# Constants
'single-quote', u'unicode'  # Strings of all kinds; prefixes not highlighted
"double-quote"
"""triple double-quote"""
'''triple single-quote'''
r'raw'
ur'unicode raw'
'escape\n'
'\04'  # octal
'\xFF'  # hex
'\u1111'  # unicode character
1  # Integral
1L
1.0  # Float
.1
1+2j  # Complex

# Expressions
1 and 2 or 3  # Boolean operators
2 < 3  # UNCOLOURED: comparison operators
spam = 42  # UNCOLOURED: assignment
2 + 3  # UNCOLOURED: number operators
[]  # UNCOLOURED: list
{}  # UNCOLOURED: dict
(1,)  # UNCOLOURED: tuple
all  # Built-in functions
GeneratorExit  # Exceptions

*/

/** JS sample  */
/*

let letNumber = 10;
const constNumber = 20;

const bool: boolean = true;
const list: number[] = [1, 2, 3];
const array: Array<number> = [1, 2, 3];
const pair: [string, number] = ['hello', 10];

for (let i = 0; i < list.length; i += 1) {
  console.log(list[i]);
}

if (bool) {
  console.log('True');
} else {
  console.log('False');
}

const str: string = 'Jake';
const templateStr: string = `Hello, ${str}!`;

// A comment

/*
 * Multiline comments
 * Multiline comments
 *\/

interface SquareConfig {
  label: string;
  color?: string;
  width?: number;
  [propName: string]: any;
}

interface SearchFunc {
  (source: string, subString: string): boolean;
}

enum Color {
  Red,
  Green,
}

type Easing = "ease-in" | "ease-out" | "ease-in-out";

class Greeter {
  private readonly greeting: string;

  constructor(message: string) {
    this.greeting = message;
  }

  greet() {
    return "Hello, " + this.greeting;
  }
}

let greeter = new Greeter("world");

class Animal {
  move(distanceInMeters: number = 0) {
    console.log(`Animal moved ${distanceInMeters}m.`);
  }
}

class Dog extends Animal {
  bark() {
    console.log("Woof! Woof!");
  }
}

const dog = new Dog();
dog.bark();
dog.move(10);
dog.bark();

class Point {
  x: number;
  y: number;
}

interface Point3d extends Point {
  z: number;
}

let point3d: Point3d = { x: 1, y: 2, z: 3 };

function add(x, y) {
  return x + y;
}

let myAdd = function (x, y) {
  return x + y;
};

(function () {
  console.log('IIFE');
}());

function identity<T>(arg: T): T {
  return arg;
}

let myIdentity: <T>(arg: T) => T = identity;

class GenericNumber<T> {
  zeroValue: T;
  add: (x: T, y: T) => T;
}

*/
