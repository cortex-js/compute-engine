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
import { isLiteralParamName } from '../math-json/symbols.js';
import { parseType } from '../common/type/parse.js';
import type { Type, TypeResolver } from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';
import {
  isGroupedTypeText,
  returnTypeText,
  signatureEffects,
} from '../common/type/utils.js';
import { effectSetToString } from '../common/type/effects.js';
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
  // Cortex's literal spelling is unsigned (`x + Infinity`, not
  // `x + +Infinity`) — the leading `+` came from the generic default and
  // re-parsed only by grace of unary plus.
  positiveInfinity: 'Infinity',
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
 * A PERMISSIVE type resolver: every identifier resolves, as a bare nominal
 * reference to itself.
 *
 * The serializer re-parses a `Typed` marker's type text only to DECOMPOSE it
 * (does it carry effects or a `forall` clause? what are its argument types?)
 * and then writes the pieces back out with `typeToString`, so names only have
 * to round-trip TEXTUALLY — validating them is the parser's and the engine's
 * job, and there is no type environment here to validate against. Without
 * this, a signature naming a user-declared type (`function f<T>(x: T, y: Tx)`
 * with `type Tx = integer`) throws `Unknown type "Tx"` and the definition
 * silently loses its sugared form.
 */
const PERMISSIVE_TYPE_RESOLVER: TypeResolver = {
  get names(): string[] {
    return [];
  },
  forward: () => undefined,
  resolve: (name: string) => ({
    kind: 'reference',
    name,
    alias: false,
    def: undefined,
  }),
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
        // `dictionaryFromExpression` returns a `MathJsonDictionaryObject`
        // (`{ dict: { key: value, … } }`); the entries live in `.dict`, not on
        // the wrapper itself.
        const dictEntries = dict.dict as unknown as Record<
          string,
          MathJsonExpression
        >;
        const keyValues = Object.keys(dictEntries).map((key) =>
          fmt.line(
            serializeString(key),
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
    // Field access: `["Field", base, "'name'"]` → `base.name` when the field
    // is an identifier-shaped string; the generic call form otherwise.
    //
    Field: (expr: MathJsonExpression): FormattingBlock => {
      const base = operand(expr, 1);
      const field = operand(expr, 2);
      const name = field === null ? null : stringValue(field);
      if (
        base === null ||
        name === null ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      )
        return serializeGenericFunction(expr);
      // Parenthesize a base that is itself an operator expression, so the
      // postfix `.name` binds to the whole thing (mirrors `At`).
      const baseBlock =
        OPERATORS[operator(base)] !== undefined
          ? fmt.line('(', serializeExpression(base), ')')
          : serializeExpression(base);
      return fmt.line(baseBlock, fmt.text('.' + name));
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
    //
    // Spread — `...t` in an argument list
    //
    Spread: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) !== 1) return serializeGenericFunction(expr);
      return fmt.line('...', serializeExpression(operand(expr, 1)));
    },

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
      // A plain return-type ascription has no anonymous-mapsto spelling; drop
      // it (the body is serialized without the ascription), as LaTeX and
      // ASCII-math do.
      const { bodyExpr, decomposed } = fnLiteralParts(expr);
      // A marker that DECOMPOSED is not an ascription though — it is the
      // literal's own signature (`docs/EFFECTS-MODEL.md`, "Cortex surface"),
      // and dropping it would silently weaken the literal. None of its pieces
      // has an anonymous-mapsto spelling — the specifier and `forall` slots
      // exist only on the named definition forms, and the mapsto's `-> ‹ret›`
      // slot does not exist at all — so a marker-carrying anonymous literal
      // falls back to the generic `Function(…)` spelling, where the `Typed`
      // handler below keeps the marker as an explicit `Typed(body, "‹sig›")`
      // call (option B, ruled 2026-08-01; widened from "effect-bearing" to
      // "decomposed" 2026-08-04). That re-parses to this very node, so the
      // round-trip is lossless — including a ground marker whose result is
      // NARROWER than the body's inferred type, which the dropped-ascription
      // path would have silently widened.
      if (decomposed) return serializeGenericFunction(expr);
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
    // EXCEPTION (option B, ruled 2026-08-01; widened 2026-08-04): an UNGROUPED
    // signature ascription is the literal's own CONTRACT
    // (`docs/EFFECTS-MODEL.md`, "Cortex surface"), and dropping it would
    // silently weaken the literal — the one thing the effects model promises
    // not to do. It has no surface spelling outside the named definition forms,
    // so it keeps the explicit call form `Typed(body, "‹sig›")`, which re-parses
    // to this very node. A GROUPED spelling (`((real) random -> real)`) is an
    // ordinary return-type ascription and stays transparent, like every
    // non-signature ascription. Mirrors the engine's decomposition predicate in
    // `functionLiteralDeclaredSignature` — the two never disagree.
    //
    Typed: (expr: MathJsonExpression): FormattingBlock => {
      const text = typeText(operand(expr, 2));
      if (text !== null && !isGroupedTypeText(text)) {
        try {
          const t = parseType(text, PERMISSIVE_TYPE_RESOLVER);
          if (typeof t !== 'string' && t.kind === 'signature')
            return serializeGenericFunction(expr);
        } catch {
          // Not a parseable type: keep the transparent reading.
        }
      }
      return serializeExpression(operand(expr, 1));
    },

    //
    // Assignment — and named function definitions (Phase 4)
    //
    // `["Assign", "f", ‹annotated Function literal›]` reconstructs the Cortex
    // definition syntax: `f(x: integer) -> real = body` for an expression body,
    // or `function f(x: integer) -> real { … }` for a `Block` body. Every other
    // `Assign` (including an UNANNOTATED function literal) keeps the generic
    // infix `a = b` form (unchanged).
    //
    //
    // Declarations: reconstruct the `let`/`const` statement syntax.
    //
    //   ["Declare", "x"]                              → let x
    //   ["Declare", "x", {str:"real"}]                → let x: real
    //   ["Declare", "x", {value -> v}]                → let x = v
    //   ["Declare", "x", {str:"real"}, {value -> v}]  → let x: real = v
    //   …with a `constant -> True` attribute          → const …
    //   ["Declare", ["Tuple", …], {value -> v}]       → let (x, y) = v
    //
    // Any other shape — extra attributes (`holdUntil`), a computed name, a
    // pattern whose leaves are not symbols — has no `let` spelling and falls
    // back to the generic function form.
    //
    Declare: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length < 1 || args.length > 3)
        return serializeGenericFunction(expr);

      // The declared name: a symbol, or a destructuring Tuple pattern whose
      // leaves are all symbols.
      const nameOp = args[0];
      const isSymbolLeafPattern = (p: MathJsonExpression): boolean =>
        operator(p) === 'Tuple' &&
        nops(p) >= 2 &&
        operands(p).every(
          (el) => symbol(el) !== null || isSymbolLeafPattern(el)
        );
      const isPattern = isSymbolLeafPattern(nameOp);
      if (!isPattern && symbol(nameOp) === null)
        return serializeGenericFunction(expr);

      // Optional positional type (a string or type-name symbol), optional
      // trailing attributes dictionary.
      let typeStr: string | null = null;
      let attrsOp: MathJsonExpression | null = null;
      for (const a of args.slice(1)) {
        if (operator(a) === 'Dictionary') {
          if (attrsOp !== null) return serializeGenericFunction(expr);
          attrsOp = a;
        } else {
          const s = stringValue(a) ?? symbol(a);
          if (s === null || typeStr !== null || attrsOp !== null)
            return serializeGenericFunction(expr);
          typeStr = s;
        }
      }

      // The attributes bag: only `value` and `constant -> True` have a
      // `let`/`const` spelling.
      let valueOp: MathJsonExpression | null = null;
      let isConst = false;
      if (attrsOp !== null) {
        for (const entry of operands(attrsOp)) {
          if (operator(entry) !== 'KeyValuePair')
            return serializeGenericFunction(expr);
          const key =
            stringValue(operand(entry, 1)) ?? symbol(operand(entry, 1));
          if (key === 'value') valueOp = operand(entry, 2);
          else if (key === 'constant') {
            if (symbol(operand(entry, 2)) !== 'True')
              return serializeGenericFunction(expr);
            isConst = true;
          } else return serializeGenericFunction(expr);
        }
      }

      // A pattern requires an initializer and takes no type annotation.
      if (isPattern && (typeStr !== null || valueOp === null))
        return serializeGenericFunction(expr);

      const parts: (string | FormattingBlock)[] = [
        isConst ? 'const ' : 'let ',
        serializeExpression(nameOp),
      ];
      if (typeStr !== null) parts.push(': ' + typeStr);
      if (valueOp !== null) parts.push(' = ', serializeExpression(valueOp));
      return fmt.line(...parts);
    },

    //
    // Type declarations: reconstruct the `type` statement syntax (both forms,
    // mirroring the parser's lowering).
    //
    //   ["DeclareType", "point", {str:"tuple<number, number>"}]
    //                                → type point = tuple<number, number>
    //   ["DeclareType", "pair", {str:"tuple<number, number>"},
    //     ["Dictionary", ["KeyValuePair", "alias", "True"]]]
    //                                → type alias pair = tuple<number, number>
    //
    // A bare `type` declares a NOMINAL type (no attributes needed — nominal is
    // `DeclareType`'s default); `type alias` declares a structural alias. Any
    // other attributes bag falls back to the generic function form.
    //
    DeclareType: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length !== 2 && args.length !== 3)
        return serializeGenericFunction(expr);

      const name = symbol(args[0]) ?? stringValue(args[0]);
      const body = stringValue(args[1]) ?? symbol(args[1]);
      if (name === null || body === null) return serializeGenericFunction(expr);

      if (args.length === 2) return fmt.line('type ', name, ' = ', body);

      const attrs = args[2];
      if (operator(attrs) !== 'Dictionary')
        return serializeGenericFunction(expr);
      const entries = operands(attrs);
      if (entries.length !== 1) return serializeGenericFunction(expr);
      const entry = entries[0];
      if (operator(entry) !== 'KeyValuePair')
        return serializeGenericFunction(expr);
      const key = stringValue(operand(entry, 1)) ?? symbol(operand(entry, 1));
      if (key !== 'alias' || symbol(operand(entry, 2)) !== 'True')
        return serializeGenericFunction(expr);

      return fmt.line('type alias ', name, ' = ', body);
    },

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

    // A definition statement — one clause of a (possibly multi-clause)
    // function. `["DefineFunction", "f", ‹Function literal›]` reconstructs
    // the Cortex definition syntax it lowered from: `f(0) = 1` for an
    // expression body, `function f(x: integer) { … }` for a `Block` body.
    // Any other shape falls back to the generic call form.
    DefineFunction: (expr: MathJsonExpression): FormattingBlock => {
      const name = operand(expr, 1);
      const rhs = operand(expr, 2);
      if (
        nops(expr) === 2 &&
        name !== null &&
        symbol(name) !== null &&
        rhs !== null &&
        operator(rhs) === 'Function'
      )
        return serializeNamedDef(name, rhs);
      return serializeGenericFunction(expr);
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
    if (h === 'Pin') return fmt.line('== ', serializeExpression(operand(p, 1)));
    if (h === 'Alternatives') {
      const alts = operands(p);
      const parts: (string | FormattingBlock)[] = [];
      alts.forEach((a, i) => {
        if (i > 0) parts.push(' | ');
        parts.push(serializePattern(a));
      });
      return fmt.line(...parts);
    }
    // A two-operand `Range` in pattern position is the range-membership pattern
    // `lo..hi` (see the `match` design §8), so it keeps its infix spelling here
    // even though `Range` serializes in call form in expression position. The
    // `..` is spaced like any other infix operator, which also keeps a negative
    // upper bound (`0 .. -1`) re-parsable — maximal munch would otherwise glue
    // `..-` into one token.
    if (h === 'Range' && operands(p).length === 2)
      return fmt.line(
        serializePattern(operand(p, 1) ?? 'Nothing'),
        fmt.infixOperator('..'),
        serializePattern(operand(p, 2) ?? 'Nothing')
      );
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
    const sv =
      typeof p === 'string' && /^'[\s\S]*'$/.test(p) ? stringValue(p) : null;
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

  // Split a `Function` literal's body slot into its (un-ascribed) body, the
  // ascribed return type, and the effect specifier. Only the authoring form
  // `["Typed", body, type]` is recognized here; the engine's canonical
  // Block-embedded ascription is not produced by the Cortex parser.
  //
  // A marker holding a FULL SIGNATURE — effect-bearing, quantified (the M2
  // sugared generic form) or plain ground — decomposes back into the surface
  // `<clause>(params) ‹effects› -> ‹result›`: the same decomposition predicate
  // the engine applies in `boxed-expression/function-literal.ts`, so the two
  // never disagree about what a marker means. A GROUPED spelling (tested just
  // below) is the "return type that happens to be a function" reading and keeps
  // its text verbatim. Under the wide-result convention a result of
  // `unknown`/`any` declares no return type at all (`function tick() scope
  // { … }`), so it serializes with no arrow.
  const fnLiteralParts = (
    fn: MathJsonExpression
  ): {
    bodyExpr: MathJsonExpression | null;
    retType: string | null;
    specifier: string | null;
    /** The rendered `forall` declarations (`T, U: number`), or `null`. */
    typeParams: string | null;
    /** The marker signature's argument TYPES, positionally aligned with the
     * literal's parameter operands. Marker argument NAMES are cosmetic — the
     * literal's operands stay the names of record — so only the types are
     * recovered, and only for a quantified marker, whose quantified parameters
     * were erased to bare symbols at lowering. */
    argTypes: readonly Type[];
    /** True when the marker DECOMPOSED — i.e. it is the literal's own
     * signature, not a plain return-type ascription. The named definition forms
     * can spell every piece of it; the anonymous mapsto cannot, so that route
     * uses this to fall back to the lossless generic `Function(…)` form. */
    decomposed: boolean;
  } => {
    const none = {
      typeParams: null,
      argTypes: [] as readonly Type[],
      decomposed: false,
    };
    const op1 = operand(fn, 1);
    if (operator(op1) !== 'Typed')
      return { bodyExpr: op1, retType: null, specifier: null, ...none };
    const bodyExpr = operand(op1, 1);
    const text = typeText(operand(op1, 2));
    // A fully parenthesized spelling is a GROUPED type (ruled 2026-08-01):
    // an ordinary return-type ascription whose return happens to be an
    // effect-bearing arrow — `-> ((real) random -> real)` — never the
    // literal's own contract. Mirrors the engine's gate in
    // `functionLiteralDeclaredSignature`; the text (parens included)
    // serializes back verbatim through the plain return-type path below.
    if (text !== null && !isGroupedTypeText(text)) {
      try {
        // Parsed with the PERMISSIVE resolver: a signature may name a
        // user-declared type (`type Tx = integer` … `(x: T, y: Tx) -> T`),
        // which a resolver-less parse rejects — the decomposition would fall
        // into the catch below and the definition would lose its sugared form.
        const t = parseType(text, PERMISSIVE_TYPE_RESOLVER);
        if (typeof t !== 'string' && t.kind === 'signature') {
          const effects = signatureEffects(t);
          const quantifiers = t.typeParams ?? [];
          const result = t.result;
          const isWide = result === 'unknown' || result === 'any';
          return {
            bodyExpr,
            // A result that is ITSELF a signature has to be re-spelled grouped
            // (`returnTypeText`) or the `-> …` it produces would read back as
            // the definition's own contract.
            retType: isWide ? null : returnTypeText(result),
            specifier: effects !== undefined ? effectSetToString(effects) : null,
            typeParams:
              quantifiers.length > 0
                ? quantifiers
                    .map((p) =>
                      p.bound !== undefined
                        ? `${p.name}: ${typeToString(p.bound)}`
                        : p.name
                    )
                    .join(', ')
                : null,
            argTypes:
              quantifiers.length > 0 ? (t.args ?? []).map((a) => a.type) : [],
            decomposed: true,
          };
        }
      } catch {
        // Not a parseable type: keep the plain return-type reading.
      }
    }
    return { bodyExpr, retType: text, specifier: null, ...none };
  };

  // A single function-literal parameter: `x` (bare), `x: integer` (typed), or
  // — for a generated literal parameter (`["Typed", "literalParam_1",
  // {str: "0"}]`) — the literal spelling alone (`0`), which is exactly its
  // value type's text. The generated name never surfaces (function-
  // polymorphism design §4.5).
  // The spelling of a value type — what a literal parameter's type text
  // looks like: a (signed) number, a quoted string, a boolean, or the
  // infinity/NaN spellings (`oo`/`-oo`/`+oo`/`nan`). Guards the name
  // suppression below so a non-value-typed parameter that merely wears the
  // reserved prefix (box route) keeps its name.
  // The Cortex spelling of an infinity/NaN value-type text. Both the type
  // grammar's compact spellings (`oo`/`nan`, what the Cortex parser lowers
  // to) and the CANONICAL spellings its serializer emits
  // (`typeToString` writes `Infinity`/`-Infinity`/`NaN`, which box-route
  // markers carry) map to the Cortex literal.
  const CORTEX_VALUE_SPELLING: Record<string, string> = {
    'oo': 'Infinity',
    '+oo': 'Infinity',
    '-oo': '-Infinity',
    'nan': 'NaN',
    'Infinity': 'Infinity',
    '+Infinity': 'Infinity',
    '-Infinity': '-Infinity',
    'NaN': 'NaN',
  };

  const isValueTypeText = (t: string): boolean =>
    /^-?[0-9.]/.test(t) ||
    t.startsWith('"') ||
    t === 'true' ||
    t === 'false' ||
    t in CORTEX_VALUE_SPELLING;

  const serializeParam = (
    p: MathJsonExpression,
    markerType?: Type
  ): FormattingBlock => {
    const typed = operator(p) === 'Typed';
    const nameSym = typed ? symbol(operand(p, 1)) : symbol(p);
    // A BARE operand at a quantified position carries no type of its own (it
    // was erased at lowering); its type is the positionally aligned marker
    // argument. An operand that kept its own annotation keeps it verbatim.
    const t =
      (typed ? typeText(operand(p, 2)) : null) ??
      (markerType !== undefined && markerType !== 'unknown'
        ? typeToString(markerType)
        : null);
    if (
      nameSym !== null &&
      isLiteralParamName(nameSym) &&
      t !== null &&
      isValueTypeText(t)
    ) {
      // A string value type carries its content RAW (the type grammar
      // resolves only `\"` and `\\`, and control characters are stored
      // as-is) — re-escape it for the single-line Cortex string spelling,
      // or a parameter like `f("a\nb")` would serialize with a raw line
      // break the lexer rejects.
      if (t.startsWith('"') && t.endsWith('"')) {
        const inner = t.slice(1, -1).replace(/\\(["\\])/g, '$1');
        return fmt.text(`"${escapeString(inner)}"`);
      }
      return fmt.text(CORTEX_VALUE_SPELLING[t] ?? t);
    }
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    return fmt.text(t !== null ? `${nameStr}: ${t}` : nameStr);
  };

  const serializeParamList = (
    params: MathJsonExpression[],
    markerTypes: readonly Type[] = []
  ): FormattingBlock =>
    fmt.fencedList(
      '(',
      fmt.separator(','),
      ')',
      params.map((p, i) => serializeParam(p, markerTypes[i]))
    );

  // Reconstruct a named function definition from `f` and its `Function`
  // literal: `f(params) ‹effects› -> ret = body`, or
  // `function f(params) ‹effects› -> ret { … }` for a `Block` body. The effect
  // specifier sits between the parameter list and the arrow (Swift-style); it
  // is omitted, along with its space, when the literal declares no effects.
  const serializeNamedDef = (
    name: MathJsonExpression,
    fn: MathJsonExpression
  ): FormattingBlock => {
    const nameSym = symbol(name);
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    const params = operands(fn).slice(1);
    const { bodyExpr, retType, specifier, typeParams, argTypes } =
      fnLiteralParts(fn);
    const specPart = specifier !== null ? ` ${specifier}` : '';
    const retPart = retType !== null ? ` -> ${retType}` : '';
    // The M2 type-parameter clause sits between the name and the `(`.
    const clausePart = typeParams !== null ? `<${typeParams}>` : '';
    if (operator(bodyExpr) === 'Block') {
      return fmt.line(
        `function ${nameStr}${clausePart}`,
        serializeParamList(params, argTypes),
        `${specPart}${retPart} `,
        fmt.fencedList(
          '{',
          fmt.separator(';'),
          '}',
          mapArgs<FormattingBlock>(bodyExpr!, serializeExpression)
        )
      );
    }
    // The math form has no specifier-without-arrow spelling — `f(x) random = 5`
    // is an expression, not a definition — so a wide result is spelled out
    // (`-> unknown`, which re-parses to the same marker signature).
    // The math form `f<T>(x) = …` is NOT a definition — `f<T>(x)` is genuinely
    // ambiguous with a relational expression, so the grammar does not claim it
    // (§3.1). A generic definition therefore always serializes in the
    // `function` block form, wrapping a non-`Block` body in braces.
    if (typeParams !== null) {
      return fmt.line(
        `function ${nameStr}${clausePart}`,
        serializeParamList(params, argTypes),
        `${specPart}${retPart} `,
        fmt.fencedList('{', fmt.separator(';'), '}', [
          serializeExpression(bodyExpr),
        ])
      );
    }
    const mathRetPart =
      retType !== null ? retPart : specifier !== null ? ' -> unknown' : '';
    return fmt.line(
      nameStr,
      serializeParamList(params),
      `${specPart}${mathRetPart} = `,
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
