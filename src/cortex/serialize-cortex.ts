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
import {
  EmptyBlock,
  FormattingOptions,
  Formatter,
  FormattingBlock,
} from './formatter';
import {
  DIGITS,
  ESCAPED_CHARS,
  isBreak,
  isInvisible,
} from '../point-free-parser/characters';
import { RESERVED_WORDS } from './reserved-words';

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
  notANumber: 'NaN',
};

/**
 * Serialize a MathJSON expression to Cortex.
 *
 * @param options.fancySymbols - If true, some operators are replaced
 * with an equivalent Unicode character, for example: `*` -> `×`.
 *
 */
export function serializeCortex(
  expr: Expression,
  options?: FormattingOptions & {
    fancySymbols?: boolean;
  }
): string {
  // To provide automatic formatting of the result, a Formatter is used.
  // The result of the serialization is a series of `FormattingBlock`
  // representing various layout options. They are then combined and arranged
  // accounting for constraints such as a maximum width and other formatting
  // options)
  const fmt = new Formatter({
    ...(options?.fancySymbols
      ? {
          aroundInfixOperator: '\u205f', // Four-Per-Em Space
          aroundRelationalOperator: '\u2005', // Four-Per-Em Space
          afterSeparator: '\u2009', // Thin Space
        }
      : {}),
    ...options,
  });

  function serializeExpression(expr: Expression | null): FormattingBlock {
    if (expr === null) return new EmptyBlock(this);
    // Is this a string literal?
    const stringValue = getStringValue(expr);
    if (stringValue !== null) return serializeString(stringValue);

    const comment = serializeComment(expr);
    let body: FormattingBlock | undefined;
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
            fmt.relationalOperator('->'),
            serializeExpression(dict[key])
          )
        );

        if (keyValues.length === 0)
          return fmt.line(
            fmt.fence('{'),
            fmt.relationalOperator('->'),
            fmt.fence('}')
          );

        body = fmt.fencedList('{', fmt.separator(','), '}', keyValues);
      }
    }
    if (body) {
      if (comment instanceof EmptyBlock) return body;
      return fmt.choice(fmt.line(comment, body), fmt.stack(comment, body));
    }
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
      if (expr.comment && expr.comment.length > 0) {
        // @todo: could be more clever. Use /* */ or // depending on whether
        // comment is multiline
        return fmt.text(`/* ${expr.comment} */`);
      }
    }
    return fmt.text();
  }

  type OperatorInfo = {
    symbol: string;
    fancySymbol?: string;
    precedence: number;
    unary?: boolean;
    relational?: boolean;
  };

  const OPERATORS: { [name: string]: OperatorInfo } = {
    NotElementOf: {
      symbol: '!in',
      fancySymbol: '\u2209',
      relational: true,
      precedence: 160,
    },
    ElementOf: {
      symbol: 'in',
      fancySymbol: '\u2208',
      relational: true,
      precedence: 240,
    },
    LessEqual: {
      symbol: '<=',
      relational: true,
      fancySymbol: '\u2A7d',
      precedence: 241,
    },
    GreaterEqual: {
      symbol: '>=',
      fancySymbol: '\u2A7e',
      relational: true,
      precedence: 242,
    },
    Less: { symbol: '<', relational: true, precedence: 245 },
    Greater: { symbol: '>', relational: true, precedence: 245 },
    NotEqual: {
      symbol: '!=',
      fancySymbol: '\u2260',
      relational: true,
      precedence: 255,
    },
    Assign: { symbol: '=', relational: true, precedence: 258 },
    Equal: { symbol: '==', relational: true, precedence: 260 },
    Same: {
      symbol: '===',
      fancySymbol: '\u2263',
      relational: true,
      precedence: 260,
    },
    KeyValue: {
      symbol: '->',
      fancySymbol: '\u2192',
      precedence: 265,
    },
    Add: { symbol: '+', precedence: 275 },
    Subtract: { symbol: '-', fancySymbol: '\u2212', precedence: 275 },
    Multiply: { symbol: '*', fancySymbol: '\u00d7', precedence: 390 },
    Divide: { symbol: '/', fancySymbol: '\u00f7', precedence: 660 },
    Negate: {
      symbol: '-',
      unary: true,
      fancySymbol: '\u2212',
      precedence: 665,
    },
    Power: { symbol: '^', precedence: 720 },
    Or: { symbol: '||', fancySymbol: '\u22c1', precedence: 800 },
    And: { symbol: '&&', fancySymbol: '\u22c0', precedence: 810 }, // @todo revisit precedence
    Not: { symbol: '!', unary: true, fancySymbol: '\u00ac', precedence: 820 },
  };

  //
  // Functions with a custom serializer: BaseForm, String, List, Set
  //
  const FUNCTIONS: { [key: string]: (exp: Expression) => FormattingBlock } = {
    //
    // BaseForm
    //
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
    //
    // String
    //
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

    //
    // List
    //
    // Interpolated string, e.g. `["String", "'hello '", "name"]`
    List: (expr: Expression): FormattingBlock =>
      fmt.fencedList(
        '{',
        fmt.separator(','),
        '}',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      ),

    //
    // Set
    //
    // Interpolated string, e.g. `["String", "'hello '", "name"]`
    Set: (expr: Expression): FormattingBlock => {
      if (getArgCount(expr) === 0) return fmt.text('EmptySet');
      return fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      );
    },

    // @todo: Dictionary, Do, If
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
    const opSymbol = options?.fancySymbols
      ? op.fancySymbol ?? op.symbol
      : op.symbol;

    if (op.unary) {
      if (getArgCount(expr) !== 1) return null;
      const arg = getArg(expr, 1);
      const argHead = getFunctionName(arg);
      const argOp = OPERATORS[argHead];
      if (argOp && argOp.precedence < op.precedence) {
        return fmt.line(opSymbol, '(', serializeExpression(arg), ')');
      }
      return fmt.line(opSymbol, serializeExpression(arg));
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

    return fmt.list(
      op.relational
        ? fmt.relationalOperator(opSymbol)
        : fmt.infixOperator(opSymbol),
      operands
    );
  }

  // Main body of `serializeCortex()`
  return serializeExpression(expr).serialize(0);
}
function escapeInvisibleCharacter(code: number): string {
  if (ESCAPED_CHARS.has(code)) return ESCAPED_CHARS.get(code)!;
  if (isInvisible(code)) {
    if (code < 0x10000) {
      return `\\u${('0000' + code.toString(16)).slice(-4)}`;
    }
    return `\\u{${('000000000' + code.toString(16)).slice(-8)}}`;
  }
  return String.fromCodePoint(code);
}

// Replace the characters in a raw string with escaped characters (`"`, `/`,
// some invisible characters, etc...)
function escapeString(s: string): string {
  let result = '';
  const graphemes = splitGraphemes(s);
  if (typeof graphemes === 'string') {
    for (const c of graphemes) {
      result += escapeInvisibleCharacter(c.codePointAt(0)!);
    }
  } else {
    for (const c of graphemes) {
      if (c.length === 1) {
        result += escapeInvisibleCharacter(c.codePointAt(0)!);
      } else {
        // @todo: we could check specifically for the emoji range, rather
        // than anything outside the BMP.
        // If the grapheme is a multi-code point sequence (e.g. a combined emoji)
        // use the entire composed sequence, don't try to break it up
        // (which would break some emojis)
        result += c;
      }
    }
  }
  return result;
}

// Escape the name of a symbol.
// Use a Verbatim Form when necessary
function escapeSymbol(s: string): string {
  // If it's a reserved word: it should be always be escaped
  if (RESERVED_WORDS.has(s)) return `\`${s}\``;

  // Shortcut common case: all alphanumeric symbol => nothing to escape
  if (/^[a-zA-Z][a-zA-Z\d_]*$/.test(s)) return s;

  // If starts with a digit: need verbatim
  const code = s.codePointAt(0)!;
  if (DIGITS.has(code)) return `\`${escapeString(s)}\``;

  let needVerbatim = false;
  const graphemes = splitGraphemes(s);
  let i = 0;
  while (!needVerbatim && i < graphemes.length) {
    const c = graphemes[i].codePointAt(0)!;
    needVerbatim = ESCAPED_CHARS.has(c) || isInvisible(c) || isBreak(c);
    i += 1;
  }

  if (!needVerbatim) return s;
  return `\`${escapeString(s)}\``;
}
