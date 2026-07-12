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
} from '../math-json/utils.js';
import { splitGraphemes } from '../common/grapheme-splitter.js';
import { NumberSerializationFormat } from '../compute-engine/latex-syntax/types.js';
import { MathJsonExpression } from '../math-json/types.js';
import {
  serializeHexFloat,
  serializeNumber,
} from '../compute-engine/latex-syntax/serialize-number.js';
import {
  EmptyBlock,
  FormattingOptions,
  Formatter,
  FormattingBlock,
} from './formatter.js';
import { DIGITS, ESCAPED_CHARS, isBreak, isInvisible } from './characters.js';
import { RESERVED_WORDS } from './reserved-words.js';
import { OPERATORS as SHARED_OPERATORS } from './operators.js';

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
    postfix?: boolean;
    relational?: boolean;
  };

  // A serializer-shaped view over the single shared operator table
  // (`operators.ts`). `kind === 'prefix'` maps to the existing `unary`
  // codepath; `kind === 'postfix'` (e.g. `!` Factorial) to the `postfix`
  // codepath; `precedence` drives parenthesization; `relational` drives
  // spacing. Keyed by MathJSON operator name.
  const OPERATORS: { [name: string]: OperatorInfo } = {};
  for (const def of SHARED_OPERATORS) {
    if (def.name in OPERATORS) continue; // canonical (first) row wins
    // `Range` has an infix parse spelling (`a..b`) but is serialized in
    // function-call form `Range(a, b)`: that form also covers the 3-argument
    // `Range(a, b, step)`, which has no binary infix spelling.
    if (def.name === 'Range') continue;
    OPERATORS[def.name] = {
      symbol: def.symbol,
      fancySymbol: def.fancySymbol,
      precedence: def.precedence,
      unary: def.kind === 'prefix',
      postfix: def.kind === 'postfix',
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

    //
    // Block (expression position): `do { stmt; stmt; … }`
    //
    // A `Block` reached here is nested inside another expression (the root
    // multi-statement program is handled separately, below `FUNCTIONS`, as a
    // bare statement list). The `do { … }` block-expression form is the only
    // spelling that makes a `Block` re-parse as a `Block` in expression
    // position (a bare `{ … }` there is the collection grammar). Statements are
    // `;`-separated; the block scopes and yields its final statement's value.
    //
    Block: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) === 0) return fmt.text('do {}');
      return fmt.line(
        'do ',
        fmt.fencedList(
          '{',
          fmt.separator(';'),
          '}',
          mapArgs<FormattingBlock>(expr, serializeExpression)
        )
      );
    },

    //
    // Function literal (typed function literals, Phase 4)
    //
    // An annotated `Function` literal — one carrying `["Typed", …]` parameters
    // and/or a `["Typed", body, type]` return ascription — is serialized as an
    // anonymous mapsto `(x: integer) |-> body`. An UNANNOTATED literal is left
    // to the generic `Function(body, …params)` form (unchanged round-trip).
    // (Named typed defs go through the `Assign` handler, which reconstructs the
    // `f(x: integer) -> real = …` / `function … { … }` syntax.)
    //
    Function: (expr: MathJsonExpression): FormattingBlock => {
      const params = operands(expr).slice(1);
      const op1 = operand(expr, 1);
      const hasTypedParam = params.some((p) => operator(p) === 'Typed');
      const hasReturn = operator(op1) === 'Typed';
      if (!hasTypedParam && !hasReturn) return serializeGenericFunction(expr);
      // The return type has no anonymous-mapsto spelling; drop it (the body is
      // serialized without the ascription).
      const { bodyExpr } = fnLiteralParts(expr);
      const arrow = options?.fancySymbols ? '↦' : '|->';
      return fmt.line(
        serializeParamList(params),
        ` ${arrow} `,
        serializeExpression(bodyExpr)
      );
    },

    //
    // Type ascription: serialized transparently (the annotation is dropped, as
    // in LaTeX / ASCII-math). Reached only for a stray `Typed` outside a
    // function literal; the `Function`/`Assign` handlers read the annotation
    // directly.
    //
    Typed: (expr: MathJsonExpression): FormattingBlock =>
      serializeExpression(operand(expr, 1)),

    //
    // Assignment — and named function definitions (Phase 4)
    //
    // `["Assign", "f", ‹annotated Function literal›]` reconstructs the Cortex
    // definition syntax: `f(x: integer) -> real = body` for an expression body,
    // or `function f(x: integer) -> real { … }` for a `Block` body. Every other
    // `Assign` (including an UNANNOTATED function literal) keeps the generic
    // infix `a = b` form (unchanged).
    //
    Assign: (expr: MathJsonExpression): FormattingBlock => {
      const name = operand(expr, 1);
      const rhs = operand(expr, 2);
      if (name !== null && rhs !== null && operator(rhs) === 'Function') {
        const params = operands(rhs).slice(1);
        const op1 = operand(rhs, 1);
        const hasTypedParam = params.some((p) => operator(p) === 'Typed');
        const hasReturn = operator(op1) === 'Typed';
        if (hasTypedParam || hasReturn) return serializeNamedDef(name, rhs);
      }
      return serializeOperator(expr) ?? serializeGenericFunction(expr);
    },

    //
    // Match (structural pattern matching): the keyword-led block form
    //
    //   match <subject> {
    //     <pattern> [if <guard>] => <body>
    //     …
    //   }
    //
    // Cases serialize one per line; patterns go through `serializePattern`
    // (bindings `_n` → `n`, `___rest` → `...rest`, `Pin`/bare symbol → `== …`,
    // `Alternatives` → ` | `-joined). See the Cortex `match` design §2–3.
    //
    Match: (expr: MathJsonExpression): FormattingBlock => {
      const subject = operand(expr, 1);
      const cases = operands(expr).slice(1);
      const head = fmt.line('match ', serializeExpression(subject), ' {');
      if (cases.length === 0)
        return fmt.line('match ', serializeExpression(subject), ' {}');
      return fmt.stack(
        head,
        fmt.indent(fmt.stack(...cases.map(serializeMatchCase))),
        fmt.text('}')
      );
    },

    // A stray `MatchCase` outside a `Match` (or the entry used by `Match`).
    MatchCase: (expr: MathJsonExpression): FormattingBlock =>
      serializeMatchCase(expr),

    // A stray `Pin` / `Alternatives` outside pattern position: serialize in the
    // pattern spelling so it round-trips.
    Pin: (expr: MathJsonExpression): FormattingBlock => serializePattern(expr),
    Alternatives: (expr: MathJsonExpression): FormattingBlock =>
      serializePattern(expr),
  };

  // A single `match` case: `pattern [if guard] => body`.
  function serializeMatchCase(expr: MathJsonExpression): FormattingBlock {
    const args = operands(expr);
    const pattern = serializePattern(args[0] ?? 'Nothing');
    const hasGuard = args.length >= 3;
    const guard = hasGuard ? args[1] : null;
    const body = hasGuard ? args[2] : args[1];
    const parts: (string | FormattingBlock)[] = [pattern];
    if (guard !== null && guard !== undefined)
      parts.push(' if ', serializeExpression(guard));
    parts.push(' => ', serializeExpression(body ?? 'Nothing'));
    return fmt.line(...parts);
  }

  // Serialize a MathJSON pattern back to Cortex pattern syntax. The inverse of
  // the parser's `patternize` pass.
  function serializePattern(p: MathJsonExpression): FormattingBlock {
    const h = operator(p);
    if (h === 'Pin')
      return fmt.line('== ', serializeExpression(operand(p, 1)));
    if (h === 'Alternatives') {
      const alts = operands(p);
      const parts: (string | FormattingBlock)[] = [];
      alts.forEach((a, i) => {
        if (i > 0) parts.push(' | ');
        parts.push(serializePattern(a));
      });
      return fmt.line(...parts);
    }
    if (h === 'List')
      return fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        operands(p).map(serializePattern)
      );
    if (h === 'Tuple')
      return fmt.fencedList(
        '(',
        fmt.separator(','),
        ')',
        operands(p).map(serializePattern)
      );
    if (h === 'Dictionary') {
      const entries = operands(p);
      if (entries.length === 0)
        return fmt.line(
          fmt.fence('{'),
          fmt.relationalOperator('->'),
          fmt.fence('}')
        );
      return fmt.fencedList(
        '{',
        fmt.separator(','),
        '}',
        entries.map((kv) =>
          fmt.line(
            serializeExpression(operand(kv, 1)),
            fmt.relationalOperator('->'),
            serializePattern(operand(kv, 2) ?? 'Nothing')
          )
        )
      );
    }

    // Symbol leaves: wildcard, binding, rest, boolean literal, or a bare
    // constant symbol (which must re-parse as a pin, not a binding).
    const s = symbol(p);
    if (s !== null) {
      if (s === '_') return fmt.text('_');
      if (s === 'True') return fmt.text('true');
      if (s === 'False') return fmt.text('false');
      if (s.startsWith('___')) return fmt.text('...' + s.slice(3));
      if (s.startsWith('_')) return fmt.text(escapeSymbol(s.slice(1)));
      return fmt.line('== ', fmt.text(escapeSymbol(s)));
    }

    if (isNumberLiteral(p))
      return fmt.text(serializeNumber(p, NUMBER_FORMATTING_OPTIONS));
    if (typeof p === 'object' && p !== null && 'str' in p)
      return serializeString((p as { str: string }).str);
    const sv = typeof p === 'string' && /^'[\s\S]*'$/.test(p) ? stringValue(p) : null;
    if (sv !== null) return serializeString(sv);

    // A general operator/call pattern (`a + b`, `f(p…)`): revert bindings to
    // their written names, then serialize as an ordinary expression.
    return serializeExpression(unpatternizeForDisplay(p));
  }

  // Revert a pattern's bindings (`_n` → `n`) recursively so a general
  // operator/call pattern can be serialized by the ordinary path.
  function unpatternizeForDisplay(p: MathJsonExpression): MathJsonExpression {
    const s = symbol(p);
    if (s !== null) {
      if (s !== '_' && !s.startsWith('___') && s.startsWith('_'))
        return { sym: s.slice(1) };
      return p;
    }
    const h = operator(p);
    if (h)
      return {
        fn: [h, ...operands(p).map(unpatternizeForDisplay)],
      } as MathJsonExpression;
    return p;
  }

  // The type text of a `Typed` type operand (`{str: 'integer'}`, a quoted
  // MathJSON string `'integer'`, or a bare type-name symbol `integer`).
  const typeText = (t: MathJsonExpression | null): string | null => {
    if (t === null) return null;
    const s = stringValue(t);
    if (s !== null) return s;
    return symbol(t);
  };

  // Split a `Function` literal's body slot into its (un-ascribed) body and the
  // ascribed return type. Only the authoring form `["Typed", body, type]` is
  // recognized here; the engine's canonical Block-embedded ascription is not
  // produced by the Cortex parser.
  const fnLiteralParts = (
    fn: MathJsonExpression
  ): { bodyExpr: MathJsonExpression | null; retType: string | null } => {
    const op1 = operand(fn, 1);
    if (operator(op1) === 'Typed')
      return { bodyExpr: operand(op1, 1), retType: typeText(operand(op1, 2)) };
    return { bodyExpr: op1, retType: null };
  };

  // A single function-literal parameter: `x` (bare) or `x: integer` (typed).
  const serializeParam = (p: MathJsonExpression): FormattingBlock => {
    const typed = operator(p) === 'Typed';
    const nameSym = typed ? symbol(operand(p, 1)) : symbol(p);
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    const t = typed ? typeText(operand(p, 2)) : null;
    return fmt.text(t !== null ? `${nameStr}: ${t}` : nameStr);
  };

  const serializeParamList = (
    params: MathJsonExpression[]
  ): FormattingBlock =>
    fmt.fencedList('(', fmt.separator(','), ')', params.map(serializeParam));

  // Reconstruct a named function definition from `f` and its `Function`
  // literal: `f(params) -> ret = body`, or `function f(params) -> ret { … }`
  // for a `Block` body.
  const serializeNamedDef = (
    name: MathJsonExpression,
    fn: MathJsonExpression
  ): FormattingBlock => {
    const nameSym = symbol(name);
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    const params = operands(fn).slice(1);
    const { bodyExpr, retType } = fnLiteralParts(fn);
    const retPart = retType !== null ? ` -> ${retType}` : '';
    if (operator(bodyExpr) === 'Block') {
      return fmt.line(
        `function ${nameStr}`,
        serializeParamList(params),
        `${retPart} `,
        fmt.fencedList(
          '{',
          fmt.separator(';'),
          '}',
          mapArgs<FormattingBlock>(bodyExpr!, serializeExpression)
        )
      );
    }
    return fmt.line(
      nameStr,
      serializeParamList(params),
      `${retPart} = `,
      serializeExpression(bodyExpr)
    );
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

    if (op.postfix) {
      if (nops(expr) !== 1) return null;
      const arg = operand(expr, 1);
      const argHead = operator(arg);
      const argOp = OPERATORS[argHead];
      // Parenthesize an operand that is itself an operator at the same or lower
      // precedence, so the postfix binds to the whole operand and re-parses
      // faithfully. `<=` (not `<`) matters for a nested postfix:
      // `Factorial(Factorial(n))` must serialize `(n!)!`, never `n!!` (which
      // classically means double factorial), and `Factorial(Power(x, 2))`
      // must serialize `(x^2)!`, not `x^2!` (= `x^(2!)`).
      if (argOp && argOp.precedence <= op.precedence) {
        return fmt.line('(', serializeExpression(arg), ')', opSymbol);
      }
      return fmt.line(serializeExpression(arg), opSymbol);
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

// Wrap a symbol name in the Verbatim Form when necessary.
// Verbatim symbols are literal (no escape processing), but escapeString() is
// the identity on every valid MathJSON symbol name, so valid names — in
// particular reserved words — are always emitted as-is. A name that is NOT a
// valid symbol has no Cortex spelling at all; it is emitted with escapes so
// the output stays lexically balanced (single line, closed backticks), and
// re-parses with an `invalid-symbol-name` diagnostic.
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
