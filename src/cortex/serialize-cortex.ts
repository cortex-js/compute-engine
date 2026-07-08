import {
  operand,
  operands,
  nops,
  dictionaryFromExpression,
  operator,
  machineValue,
  stringValue,
  symbol,
  isNumberObject,
  mapArgs,
  matchesNumber,
  matchesString,
} from '../math-json/utils';
import { splitGraphemes } from '../common/grapheme-splitter';
import { NumberSerializationFormat } from '../compute-engine/latex-syntax/types';
import { MathJsonExpression } from '../math-json/types';
import {
  serializeHexFloat,
  serializeNumber,
} from '../compute-engine/latex-syntax/serialize-number';
import {
  EmptyBlock,
  FormattingOptions,
  Formatter,
  FormattingBlock,
} from './formatter';
import { DIGITS, ESCAPED_CHARS, isBreak, isInvisible } from './characters';
import { RESERVED_WORDS } from './reserved-words';
import { OPERATORS as SHARED_OPERATORS } from './operators';

export const NUMBER_FORMATTING_OPTIONS: NumberSerializationFormat = {
  positiveInfinity: '+Infinity',
  negativeInfinity: '-Infinity',
  notANumber: 'NaN',
  imaginaryUnit: 'i',

  decimalSeparator: '.',
  digitGroupSeparator: '_', // for thousands, etc...
  digitGroup: 3,

  exponentProduct: '',
  beginExponentMarker: 'e',
  endExponentMarker: '',
  truncationMarker: '',

  repeatingDecimal: 'none',

  fractionalDigits: 'max',
  notation: 'auto',
  avoidExponentsInRange: [-7, 20],
};

/**
 * Serialize a MathJSON expression to Cortex.
 *
 * @param options.fancySymbols - If true, some operators are replaced
 * with an equivalent Unicode character, for example: `*` -> `×`.
 *
 */
export function serializeCortex(
  expr: MathJsonExpression,
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

  function serializeExpression(
    expr: MathJsonExpression | null
  ): FormattingBlock {
    if (expr === null) return new EmptyBlock(fmt);
    // Is this a string literal?
    if (typeof expr === 'string' && matchesString(expr)) {
      const s = stringValue(expr);
      if (s !== null) return serializeString(s);
    }
    // A string object (`{str: …}`), e.g. a dictionary key.
    if (typeof expr === 'object' && expr !== null && 'str' in expr) {
      return serializeString((expr as { str: string }).str);
    }
    const comment = serializeComment(expr);
    let body: FormattingBlock | undefined;
    const h = operator(expr);
    if (h) {
      body =
        serializeFunction(expr) ??
        serializeOperator(expr) ??
        serializeGenericFunction(expr);
    }

    if (!body) {
      const symName = symbol(expr);
      if (symName !== null) body = fmt.text(escapeSymbol(symName));
    }
    if (
      !body &&
      (typeof expr === 'number' ||
        isNumberObject(expr) ||
        (typeof expr === 'string' && matchesNumber(expr)))
    ) {
      const num = serializeNumber(expr, NUMBER_FORMATTING_OPTIONS);
      if (num) body = fmt.text(num);
    }

    if (!body) {
      const dict = dictionaryFromExpression(expr);
      if (dict !== null) {
        const dictEntries = dict as unknown as Record<
          string,
          MathJsonExpression
        >;
        const keyValues = Object.keys(dict).map((key) =>
          fmt.line(
            escapeString(key),
            fmt.relationalOperator('->'),
            serializeExpression(dictEntries[key])
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

  function serializeComment(expr: MathJsonExpression): FormattingBlock {
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

  // A serializer-shaped view over the single shared operator table
  // (`operators.ts`). `kind === 'prefix'` maps to the existing `unary`
  // codepath; `precedence` drives parenthesization; `relational` drives
  // spacing. Keyed by MathJSON operator name.
  const OPERATORS: { [name: string]: OperatorInfo } = {};
  for (const def of SHARED_OPERATORS) {
    if (def.name in OPERATORS) continue; // canonical (first) row wins
    OPERATORS[def.name] = {
      symbol: def.symbol,
      fancySymbol: def.fancySymbol,
      precedence: def.precedence,
      unary: def.kind === 'prefix',
      relational: def.relational,
    };
  }

  // `Rational` has no infix spelling of its own; serialize it exactly like a
  // `Divide` (`["Rational", 1, 2]` → `1 / 2`), which also gives it the right
  // precedence for parenthesization when it appears as an operand. The parser
  // has no rational literal, so it re-parses as `Divide` — a documented
  // normalization (see docs/syntax.md).
  if (OPERATORS['Divide'] && !OPERATORS['Rational'])
    OPERATORS['Rational'] = { ...OPERATORS['Divide'] };

  // Is `expr` a number literal (a plain number, a `{num}` object, or a numeric
  // string)? Used by the `Negate`/`Multiply` serializers below.
  const isNumberLiteral = (x: MathJsonExpression | null): boolean =>
    x !== null &&
    (typeof x === 'number' ||
      isNumberObject(x) ||
      (typeof x === 'string' && matchesNumber(x)));

  //
  // Functions with a custom serializer: BaseForm, String, List, Set
  //
  const FUNCTIONS: {
    [key: string]: (exp: MathJsonExpression) => FormattingBlock;
  } = {
    //
    // BaseForm
    //
    BaseForm: (expr: MathJsonExpression): FormattingBlock => {
      // CAUTION: machineValue will truncate number expessions to a machine
      // number, which may result in a loss of precision
      const base = machineValue(operand(expr, 2)) ?? 16;
      const arg1 = operand(expr, 1);
      const value = machineValue(arg1);
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
    String: (expr: MathJsonExpression): FormattingBlock =>
      fmt.wrap(
        '"',
        ...mapArgs<FormattingBlock>(expr, (x) => {
          const sv = stringValue(x);
          if (sv !== null) return fmt.text(escapeString(sv));
          return fmt.fencedBlock('\\(', serializeExpression(x), ')');
        }),
        '"'
      ),

    //
    // List
    //
    List: (expr: MathJsonExpression): FormattingBlock =>
      fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      ),

    //
    // Set
    //
    Set: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) === 0) return fmt.text('{}');
      return fmt.fencedList(
        '{',
        fmt.separator(','),
        '}',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      );
    },

    //
    // Tuple
    //
    // `(a, b)` for 2+ elements; the empty and 1-element cases have no
    // parenthesized spelling (`()` is a diagnostic, `(a)` is grouping), so
    // fall back to the generic `Tuple(…)` function form.
    //
    Tuple: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) < 2) return serializeGenericFunction(expr);
      return fmt.fencedList(
        '(',
        fmt.separator(','),
        ')',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      );
    },

    //
    // At (indexing), 1-based: `["At", xs, i]` → `xs[i]`
    //
    At: (expr: MathJsonExpression): FormattingBlock => {
      const base = operand(expr, 1);
      const indices = operands(expr).slice(1);
      if (base === null || indices.length === 0)
        return serializeGenericFunction(expr);
      // Parenthesize a base that is itself an operator expression, so the
      // postfix `[…]` binds to the whole thing.
      const baseBlock =
        OPERATORS[operator(base)] !== undefined
          ? fmt.line('(', serializeExpression(base), ')')
          : serializeExpression(base);
      return fmt.line(
        baseBlock,
        fmt.fencedList(
          '[',
          fmt.separator(','),
          ']',
          indices.map((x) => serializeExpression(x))
        )
      );
    },

    //
    // Dictionary
    //
    // `["Dictionary", ["KeyValuePair", key, value], …]` → `{key -> value, …}`;
    // the empty dictionary is `{->}`. Each `KeyValuePair` entry is serialized
    // through the operator table (`->`), so a string key prints quoted.
    //
    Dictionary: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) === 0)
        return fmt.line(
          fmt.fence('{'),
          fmt.relationalOperator('->'),
          fmt.fence('}')
        );
      return fmt.fencedList(
        '{',
        fmt.separator(','),
        '}',
        mapArgs<FormattingBlock>(expr, serializeExpression)
      );
    },

    //
    // Negate
    //
    // A `Negate` of a numeric literal folds the sign into the literal
    // (`["Negate", 3]` → `-3`, `["Negate", -1]` → `1`) so the output is a
    // clean signed `num` rather than a doubled sign (`--1`). Non-literal
    // operands go through the prefix-operator path (`-x`, `-(2 + 3)`).
    //
    Negate: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) !== 1) return serializeGenericFunction(expr);
      const arg = operand(expr, 1);
      if (isNumberLiteral(arg))
        return fmt.text(
          negateNumberString(serializeNumber(arg, NUMBER_FORMATTING_OPTIONS))
        );
      return serializeOperator(expr) ?? serializeGenericFunction(expr);
    },

    //
    // Multiply
    //
    // Invisible multiplication is emitted ONLY for a binary
    // `["Multiply", {num}, {sym}]` where the juxtaposition `2x` re-lexes as a
    // number followed by a symbol (see `canJuxtapose`). Everything else
    // (n-ary products, number×group, group×group) stays explicit `*` via the
    // operator path.
    //
    Multiply: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length === 2 && isNumberLiteral(args[0])) {
        const symName = symbol(args[1]);
        if (symName !== null) {
          const numStr = serializeNumber(args[0], NUMBER_FORMATTING_OPTIONS);
          if (canJuxtapose(numStr, symName)) return fmt.text(numStr + symName);
        }
      }
      return serializeOperator(expr) ?? serializeGenericFunction(expr);
    },

    // `If` has no `if`-expression spelling in the Phase 2 grammar, so it is
    // left to the generic `If(cond, then, else)` function form (which
    // round-trips). Phase 4 owns the statement form.
  };

  function serializeFunction(expr: MathJsonExpression): FormattingBlock | null {
    return FUNCTIONS[operator(expr)]?.(expr) ?? null;
  }

  function serializeGenericFunction(expr: MathJsonExpression): FormattingBlock {
    const h = operator(expr);
    if (h) {
      // It's a function application with a named function
      return fmt.line(
        escapeSymbol(h),
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
      serializeExpression(h),
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

  // Invisible-multiply (`2x`) is handled by the `Multiply` entry in
  // `FUNCTIONS`; this serializes the explicit infix/prefix operator forms.
  function serializeOperator(expr: MathJsonExpression): FormattingBlock | null {
    const opName = operator(expr);
    if (!opName) return null;

    const op = OPERATORS[opName];
    if (!op) return null;
    const opSymbol = options?.fancySymbols
      ? (op.fancySymbol ?? op.symbol)
      : op.symbol;

    if (op.unary) {
      if (nops(expr) !== 1) return null;
      const arg = operand(expr, 1);
      const argHead = operator(arg);
      const argOp = OPERATORS[argHead];
      if (argOp && argOp.precedence < op.precedence) {
        return fmt.line(opSymbol, '(', serializeExpression(arg), ')');
      }
      return fmt.line(opSymbol, serializeExpression(arg));
    }

    const operands = mapArgs<FormattingBlock>(expr, (arg) => {
      const argHead = operator(arg);
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
  //
  // A multi-statement program is the parser's top-level `Block` wrapper: it
  // serializes one statement per line. This is handled here — at the root
  // only — rather than as a `FUNCTIONS` handler, because those handlers apply
  // at every recursion depth, and a `Block` nested inside another expression
  // must keep the generic `Block(a, b)` function spelling (Phase 4 owns the
  // nested statement form). A 0- or 1-element `Block` has no statement-list
  // spelling, so it too falls through to normal serialization.
  if (operator(expr) === 'Block' && nops(expr) >= 2)
    return fmt
      .stack(...mapArgs<FormattingBlock>(expr, serializeExpression))
      .serialize(0);
  return serializeExpression(expr).serialize(0);
}
// Flip the sign of an already-serialized number so a `Negate` of a literal
// folds into the literal (`3` → `-3`, `-3` → `3`, `+Infinity` → `-Infinity`).
function negateNumberString(n: string): string {
  if (n.startsWith('-')) return n.slice(1);
  if (n.startsWith('+')) return '-' + n.slice(1);
  return '-' + n;
}

// Can `numStr` and `symName` be juxtaposed (`2` + `x` → `2x`) and re-lex as a
// number followed by a symbol? Conservative: the number must be a plain
// non-negative decimal (no sign, exponent, `NaN`/`Infinity`), and the symbol a
// bare inline identifier that starts neither an exponent (`2e5`) nor a base
// prefix (`0b…`/`0x…`).
function canJuxtapose(numStr: string, symName: string): boolean {
  if (!/^\d[\d_]*(\.\d[\d_]*)?$/.test(numStr)) return false;
  if (escapeSymbol(symName) !== symName) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(symName)) return false;
  if (/^[eE]/.test(symName)) return false;
  if (numStr === '0' && /^[bBxX]/.test(symName)) return false;
  return true;
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

  // If starts with a digit: needs verbatim
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

  return needVerbatim ? `\`${escapeString(s)}\`` : s;
}
