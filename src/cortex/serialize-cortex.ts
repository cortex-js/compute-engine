import {
  getArg,
  getArgCount,
  getDictionary,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getStringValue,
  getSymbolName,
  isNumberObject,
  mapArgs,
} from '../common/utils';
import { splitGraphemes } from '../common/grapheme-splitter';
import { NumberFormattingOptions } from '../latex-syntax/public';
import { Expression } from '../public';
import { serializeHexFloat, serializeNumber } from '../common/serialize-number';
import { CortexErrorListener } from './cortex-utils';
import {
  EmptyBlock,
  FormatingOptions,
  Formatter,
  FormattingBlock,
} from './formatter';

export const NUMBER_FORMATTING_OPTIONS: Required<NumberFormattingOptions> = {
  precision: 15, // assume 2^53 bits floating points
  decimalMarker: '.',
  groupSeparator: '_', // for thousands, etc...
  exponentProduct: '',
  beginExponentMarker: 'e',
  endExponentMarker: '',
  notation: 'auto',
  imaginaryNumber: 'i',
  truncationMarker: '',
  beginRepeatingDigits: '',
  endRepeatingDigits: '',
  positiveInfinity: 'Infinity',
  negativeInfinity: '-Infinity',
  notANumber: 'NotANumber',
};

/**
 * Generate Cortex code for an expression
 */
export function serializeCortex(
  expr: Expression,
  onError?: CortexErrorListener,
  options?: FormatingOptions
): string {
  const fmt = new Formatter(options);

  function serializeExpression(expr: Expression): FormattingBlock {
    // Is this a string literal?
    const stringValue = getStringValue(expr);
    if (stringValue !== null) return serializeString(stringValue);

    const comment = serializeComment(expr);
    let body: FormattingBlock;
    const head = getFunctionHead(expr);
    if (head !== null) {
      body =
        serializeFunction(expr) ??
        serializeOperator(expr) ??
        serializeGenericFunction(expr);
    }

    if (!body) {
      const symName = getSymbolName(expr);
      if (symName !== null) {
        body = fmt.text(escapeSymbol(symName));
      }
    }
    if (!body) {
      if (typeof expr === 'number' || isNumberObject(expr)) {
        body = fmt.text(serializeNumber(expr, NUMBER_FORMATTING_OPTIONS));
      }
    }
    if (!body) {
      const dict = getDictionary(expr);
      if (dict !== null) {
        const keyValues = Object.keys(dict).map((key) =>
          fmt.line(
            escapeString(key),
            fmt.infixOperator('->'),
            serializeExpression(dict[key])
          )
        );

        body = fmt.fencedList('{', fmt.separator(','), '}', keyValues);
      }
    }
    if (body) {
      if (comment instanceof EmptyBlock) return body;
      return fmt.choice(fmt.line(comment, body), fmt.stack(comment, body));
    }
    onError?.({ code: 'syntax-error', pos: 0 });
    return fmt.text();
  }

  function serializeString(s: string): FormattingBlock {
    // @todo:
    // could be more clever: if `s` contains line feeds, use a `"""` string
    // Also, if string doesn't fit margin, wrap it
    return fmt.text(`"${escapeString(s)}"`);
  }

  function serializeComment(expr: Expression): FormattingBlock {
    if (!(typeof expr === 'object')) return fmt.text();
    if ('comment' in expr) {
      if (expr.comment.length > 0) {
        // @todo: could be more clever. Use /* */ or // depending on whether
        // comment is multiline
        return fmt.text(`/* ${expr.comment} */`);
      }
    }
    return fmt.text();
  }

  const OPERATORS = {
    NotElementOf: { symbol: '!in', precedence: 160 },
    ElementOf: { symbol: 'in', precedence: 240 },
    LessEqual: { symbol: '<=', precedence: 241 },
    GreaterEqual: { symbol: '>=', precedence: 242 },
    Less: { symbol: '<', precedence: 245 },
    Greater: { symbol: '>', precedence: 245 },
    NotEqual: { symbol: '!=', precedence: 255 },
    Assign: { symbol: '=', precedence: 258 },
    Equal: { symbol: '==', precedence: 260 },
    Same: { symbol: '===', precedence: 260 },
    KeyValue: { symbol: '->', precedence: 265 },
    Add: { symbol: '+', precedence: 275 },
    Subtract: { symbol: '-', precedence: 275 },
    Multiply: { symbol: '*', precedence: 390 },
    Divide: { symbol: '/', precedence: 660 },
    Negate: { symbol: '-', precedence: 665 },
    Power: { symbol: '^', precedence: 720 },
    Or: { symbol: '||', precedence: 800 },
    And: { symbol: '&&', precedence: 810 }, // @todo revisit precedence
    Not: { symbol: '!', precedence: 820 },
  };
  const UNARY_OPERATORS = ['Not', 'Negate'];

  //
  // Functions with a custom serializer: BaseForm, String, List, Set
  //
  const FUNCTIONS: { [key: string]: (exp: Expression) => FormattingBlock } = {
    BaseForm: (expr: Expression): FormattingBlock => {
      const base = getNumberValue(getArg(expr, 2)) ?? 16;
      const arg1 = getArg(expr, 1);
      const value = getNumberValue(arg1);
      if (
        value === null ||
        Number.isNaN(value) ||
        !Number.isFinite(value) ||
        !(base === 2 || base === 10 || base === 16)
      ) {
        return serializeGenericFunction(expr);
      }
      if (base === 2) {
        // Special notation for base-2
        return fmt.text('0b' + Number(value).toString(2));
      }
      if (base === 10) {
        // Base-10 notation, nothing special
        // @todo: we could do a wrap with a \ continuation character at the end
        // of the line
        return fmt.text(serializeNumber(arg1, NUMBER_FORMATTING_OPTIONS));
      }
      if (base === 16) {
        if (!Number.isFinite(value)) {
          return fmt.text(serializeNumber(arg1, NUMBER_FORMATTING_OPTIONS));
        }
        if (Number.isInteger(value)) {
          // Integer to hex
          return fmt.text('0x' + Number(value).toString(16));
        }
        // Floating point to hex
        return fmt.text(serializeHexFloat(value));
      }
      return serializeGenericFunction(expr);
    },
    // Interpolated string, e.g. `["String", "'hello '", "name"]`
    String: (expr: Expression): FormattingBlock =>
      fmt.wrap(
        '"',
        ...mapArgs<FormattingBlock>(expr, (x) => {
          const sv = getStringValue(x);
          if (sv !== null) return fmt.text(escapeString(sv));
          return fmt.fencedBlock('\\(', serializeExpression(x), ')');
        }),
        '"'
      ),

    List: (expr: Expression): FormattingBlock =>
      fmt.fencedList(
        '{',
        fmt.separator(','),
        '}',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      ),

    Set: (expr: Expression): FormattingBlock => {
      if (getArgCount(expr) === 0) return fmt.text('EmptySet');
      return fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      );
    },
  };

  function serializeFunction(expr: Expression): FormattingBlock | null {
    return FUNCTIONS[getFunctionName(expr)]?.(expr) ?? null;
  }

  function serializeGenericFunction(expr: Expression): FormattingBlock {
    const head = getFunctionHead(expr);
    if (typeof head === 'string') {
      // It's a function application with a named function
      return fmt.line(
        escapeSymbol(head),
        fmt.fencedList(
          '(',
          fmt.separator(','),
          ')',
          mapArgs<FormattingBlock>(expr, serializeExpression)
        )
      );
    }

    // A function application with a function expression.
    return fmt.line(
      'Apply(',
      serializeExpression(head),
      fmt.separator(','),
      fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      ),
      ')'
    );
  }

  // @todo: 2x, 2(x+1)
  function serializeOperator(expr: Expression): FormattingBlock | null {
    const head = getFunctionName(expr);
    if (!head) return null;

    const op = OPERATORS[head];
    if (!op) return null;

    if (UNARY_OPERATORS.includes(head)) {
      if (getArgCount(expr) !== 1) return null;
      const arg = getArg(expr, 1);
      const argHead = getFunctionName(arg);
      const argOp = OPERATORS[argHead];
      if (argOp && argOp.precedence < op.precedence) {
        return fmt.line(op.symbol, '(', serializeExpression(arg), ')');
      }
      return fmt.line(op.symbol, serializeExpression(arg));
    }

    const operands = mapArgs<FormattingBlock>(expr, (arg) => {
      const argHead = getFunctionName(arg);
      const argOp = OPERATORS[argHead];
      if (argOp && argOp.precedence < op.precedence) {
        return fmt.line('(', serializeExpression(arg), ')');
      }
      return serializeExpression(arg);
    });

    if (!operands) return null;

    return fmt.list(fmt.infixOperator(op.symbol), operands);
  }

  // Main body of `serializeCortex()`
  const result = serializeExpression(expr);
  console.log(result.debug());
  return result.serialize(0);
  //return serializeExpression(expr).serialize(0);
}
function escapeInvisibleCharacter(code: number): string {
  const INVISIBLE_CHARS = [
    0x007f, // Delete
    0x00a0, // NBS Non-Breaking Space
    0x00ad, // Soft-hyphen
    0x061c, // Arabic Letter Mark
    0x180e, // Mongolian Vowel Separator
    0x2000, // En Quad
    0x2001, // Em Quad
    0x2002, // En Space
    0x2003, // Em Space
    0x2004, // Three-per-em Space
    0x2005, // Four-per-em Space
    0x2006, // Six-per-em Space
    0x2007, // Figure Space
    0x2008, // Punctuation Space
    0x2009, // Thin Space
    0x200a, // Hair Space
    0x200b, // Zero-Width Space
    0x200c, // Zero-Width Non-Joiner
    0x200d, // ZWJ, Zero-Width Joiner
    0x200e, // Left-to-right Mark
    0x200f, // Right-to-left Mark
    0x2028, // Line Separator
    0x202f, // Narrow No-break Space
    0x205f, // Medium mathematical Space
    0x2060, // Word Joiner
    0x2061, // FUNCTION APPLICATION
    0x2062, // INVISIBLE TIMES
    0x2063, // INVISIBLE SEPARATOR
    0x2064, // INVISIBLE PLUS
    0x2066, // LEFT - TO - RIGHT ISOLATE
    0x2067, // RIGHT - TO - LEFT ISOLATE
    0x2068, // FIRST STRONG ISOLATE
    0x2069, // POP DIRECTIONAL ISOLATE
    0x206a, // INHIBIT SYMMETRIC SWAPPING
    0x206b, // ACTIVATE SYMMETRIC SWAPPING
    0x206c, // INHIBIT ARABIC FORM SHAPING
    0x206d, // ACTIVATE ARABIC FORM SHAPING
    0x206e, // NATIONAL DIGIT SHAPES
    0x206f, // NOMINAL DIGIT SHAPES
    0x2800, // Braille Pattern Blank
    0x3000, // Ideographic Space
    0xfeff, // Byte Order Mark
    0xfffe, // Byte Order Mark
  ];
  if (code < 31 || INVISIBLE_CHARS.includes(code)) {
    return `\\u{${('0000' + code.toString(16)).slice(-4)}}`;
  }
  return String.fromCodePoint(code);
}

function escapeString(s: string): string {
  const ESCAPED_CHARS = {
    '\\': '\\\\',
    "'": "\\'",
    '"': '\\"',
    '\t': '\\t', // Tab
    '\n': '\\n', // Newline
    '\r': '\\r', // Return
  };
  let result = '';
  const graphemes = splitGraphemes(s);
  if (typeof graphemes === 'string') {
    for (const c of graphemes) {
      result += ESCAPED_CHARS[c] ?? escapeInvisibleCharacter(c.charCodeAt(0));
    }
  } else {
    for (const c of graphemes) {
      if (c.length === 1) {
        result += ESCAPED_CHARS[c] ?? escapeInvisibleCharacter(c.charCodeAt(0));
      } else {
        // If the grapheme is a multi-code point sequence (e.g. a combined emoji)
        // use the entire composed sequence, don't try to break it up
        // (which would break some emojis)
        result += c;
      }
    }
  }
  return result;
}

function escapeSymbol(s: string): string {
  s = escapeString(s);
  const needWrapping = !/^[a-zA-Z][a-zA-Z\d_]*$/.test(s);
  if (!needWrapping) return s;

  // If the string is entirely composed of emojis (multi-code point sequences)
  // don't wrap it
  const graphemes = splitGraphemes(s);
  if (typeof graphemes === 'string') return `\`${s}\``;

  let allEmoji = true;
  let i = 0;
  while (i < graphemes.length && allEmoji) {
    if (graphemes[i].length === 1) allEmoji = false;
    i++;
  }
  if (allEmoji) return s;
  return `\`${s}\``;
}
