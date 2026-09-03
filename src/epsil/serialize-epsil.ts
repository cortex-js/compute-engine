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
import { HARD_RESERVED_WORDS } from './reserved-words.js';
import {
  CONDITIONAL_PRECEDENCE,
  OPERATORS as SHARED_OPERATORS,
} from './operators.js';

export const NUMBER_FORMATTING_OPTIONS: NumberSerializationFormat = {
  // Epsil's literal spelling is unsigned (`x + Infinity`, not
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
 * (does it carry effects or a `where` clause? what are its argument types?)
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
  // Serialization is a purely syntactic reading: a marker signature carrying
  // the `is` slot of a `where` clause (a conditional conformance's member) must
  // DECOMPOSE here, and the type grammar refuses the slot outright when no
  // conformance oracle is in reach (`validatePolytypeArm`). There is no registry
  // on this side, so every conformance is admitted — the engine checked it when
  // the statement ran.
  conformsTo: () => true,
};

/**
 * Serialize a MathJSON expression to Epsil.
 *
 * @param options.fancySymbols - If true, some operators are replaced
 * with an equivalent Unicode character, for example: `*` -> `×`.
 *
 */
export function serializeEpsil(
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
        const dictEntries = dict.dict;
        const keyValues = Object.keys(dictEntries).map((key) =>
          fmt.line(
            serializeString(key),
            fmt.relationalOperator('->'),
            serializeExpression(dictionaryValueToExpression(dictEntries[key]))
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

  /**
   * Lexically enclosing SERIALIZED loop bodies — the `break`/`continue`
   * context, mirroring the parser's own `loopDepth` (`parser.ts`,
   * `inLoopContext`). Zero means "not inside a `for`/`while` body", and
   * `["Break"]` / `["Continue"]` then have to take their call spelling
   * `Break()` / `Continue()`: a bare `break` there re-parses as the
   * `control-outside-loop` diagnostic.
   *
   * Per-serialization state (a closure over this call), not a module global,
   * so concurrent serializations cannot see each other's depth.
   */
  let loopDepth = 0;

  /** Serialize with the `break`/`continue` context set to `depth`: one deeper
   * for a loop body, zero for a function-literal body (the boundary a `break`
   * may not cross). The serializer must reset at exactly the boundaries the
   * parser resets at, or a round trip either fails to parse or silently
   * rebinds a `break` to the wrong loop. */
  function inLoopContext<T>(depth: number, serialize: () => T): T {
    const saved = loopDepth;
    loopDepth = depth;
    try {
      return serialize();
    } finally {
      loopDepth = saved;
    }
  }

  function serializeString(s: string): FormattingBlock {
    // Strings always use the escaped single-line form; multiline selection and
    // margin-aware wrapping are not implemented.
    return fmt.text(`"${escapeString(s)}"`);
  }

  function serializeComment(expr: MathJsonExpression): FormattingBlock {
    if (!(typeof expr === 'object')) return fmt.text();
    if ('comment' in expr) {
      if (expr.comment && expr.comment.length > 0) {
        // Metadata comments always use block syntax, including single-line
        // content.
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

  // The conditional expression `a if c else b` is not a row in the shared
  // table (it is a word-spelled ternary the parser recognizes directly), but it
  // needs a precedence HERE so an `If` appearing as another operator's operand
  // is parenthesized: `Add(If(c, 1, 2), 3)` must serialize `(1 if c else 2) + 3`,
  // never `1 if c else 2 + 3` (which re-parses as `If(c, 1, 2 + 3)`). Its own
  // spelling comes from the `If` entry in `FUNCTIONS`, which runs first, so
  // this row is only ever read as an *operand's* precedence.
  OPERATORS['If'] = { symbol: 'if', precedence: CONDITIONAL_PRECEDENCE };

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
    // Character
    //
    // A character value arrives as the call form `["CharacterFrom", "'x'"]`
    // (MathJSON has no character literal, and neither does Epsil). It is
    // deliberately NOT shortened to the one-character string `"x"`: at top
    // level that reparses as a `string`, not a `character`, and an INVALID
    // constructor such as `CharacterFrom("ab")` (an error value) would come
    // back as the perfectly valid string `"ab"`. The generic call form
    // `CharacterFrom("x")` reparses to the same value with the same
    // validation, so no entry is needed here — the fallback handles it.

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
    // Qualified protocol property: `["ProtocolProperty", "P", "name", base]`
    // → `base.(P.name)` — the parenthesized field production the protocols
    // design adds to the D16 grammar (P6).
    //
    // A FOUR-operand node is the property STORE, and it keeps the generic call
    // form deliberately. The surface spelling `base.(P.name) = value` parses to
    // `Assign(ProtocolProperty(P, name, base), value)` and stays that shape
    // through canonicalization, so the `Assign` serializer — which is
    // precedence-aware — is what renders a store the author wrote. The
    // four-operand node is the form the evaluator folds that `Assign` into, and
    // it can appear in any position, including nested ones a store can never
    // occupy: assignment is statement-only in Epsil, so emitting
    // `base.(P.name) = value` for `1 + «store»` would print
    // `1 + p.(P.n) = 3`, which re-parses as a COMPARISON — and parenthesizing
    // does not help, since `(x = 3)` is a comparison too. The generic call form
    // is faithful in every position.
    //
    ProtocolProperty: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) !== 3) return serializeGenericFunction(expr);
      const protocol =
        stringValue(operand(expr, 1)) ?? symbol(operand(expr, 1));
      const name = stringValue(operand(expr, 2)) ?? symbol(operand(expr, 2));
      const base = operand(expr, 3);
      if (protocol === null || name === null || base === null)
        return serializeGenericFunction(expr);
      const baseBlock =
        OPERATORS[operator(base)] !== undefined
          ? fmt.line('(', serializeExpression(base), ')')
          : serializeExpression(base);
      return fmt.line(
        baseBlock,
        fmt.text(`.(${escapeSymbol(protocol)}.${escapeSymbol(name)})`)
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
    //
    // Spread — `...t` in an argument list
    //
    Spread: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) !== 1) return serializeGenericFunction(expr);
      return fmt.line('...', serializeExpression(operand(expr, 1)));
    },

    //
    // NamedArgument — `name: value` in an argument list
    //
    // `["NamedArgument", "'rate'", 0.05]` → `rate: 0.05`. The carrier only
    // exists between parsing and canonicalization (the call's normalization
    // consumes it), so this row serves the RAW tree: formatting a source file
    // and quoting the offending statement back in a diagnostic.
    //
    NamedArgument: (expr: MathJsonExpression): FormattingBlock => {
      if (nops(expr) !== 2) return serializeGenericFunction(expr);
      const name = stringValue(operand(expr, 1));
      if (name === null) return serializeGenericFunction(expr);
      return fmt.line(
        `${escapeSymbol(name)}: `,
        serializeExpression(operand(expr, 2))
      );
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

    //
    // If — two surface forms, selected by the shape of the branches
    //
    // The parser builds `Block` branches for the block form and plain
    // expressions for the conditional form, so keying on that shape is exactly
    // what makes each spelling round-trip:
    //
    //   If(c, Block(…), Block(…))  →  `if c { … } else { … }`
    //                                 (chaining to `else if …` when the
    //                                  alternative is itself a block-form `If`,
    //                                  the shape `parseIf` builds)
    //   If(c, a, b), branches non-Block  →  `a if c else b`
    //
    // Anything else — a mixed `If(c, Block(1), 2)`, or an arity outside 2…3 —
    // falls through to the generic `If(c, …)` call form, which also re-parses
    // faithfully.
    //
    If: (expr: MathJsonExpression): FormattingBlock =>
      serializeIf(expr) ?? serializeGenericFunction(expr),

    //
    // Block (expression position): `do { stmt; stmt; … }`
    //
    // A `Block` reached here is nested inside another expression (the root
    // multi-statement program is handled separately, below `FUNCTIONS`, as a
    // bare statement list). The `do { … }` block-expression form is the only
    // spelling that makes a `Block` re-parse as a `Block` in expression
    // position (a bare `{ … }` there is the collection grammar). Statements are
    // `;`-separated inline, line-separated when stacked (a linebreak is a
    // statement separator too); the block scopes and yields its final
    // statement's value.
    //
    Block: (expr: MathJsonExpression): FormattingBlock =>
      serializeBraceBlockStatement('do ', expr),

    //
    // Loop: the two loop statements, in the shapes the parser lowers them to
    // (`parseFor` / `parseWhile`):
    //
    //   Loop(Block(…), Element(x, xs))              →  for x in xs { … }
    //   Loop(Block(…), Element(Tuple(p, q), pairs)) →  for (p, q) in pairs { … }
    //   Loop(Block(If(Not(c), Break()), Block(…)))  →  while c { … }
    //
    // `while` has no head of its own: it lowers to an unconditional `Loop`
    // whose body opens with a guard that breaks when the condition fails, so
    // the `while` spelling is recovered by matching that guard exactly.
    //
    // Anything else — several iterator clauses, a non-`Block` body, a
    // destructuring pattern whose leaves are not all names, or a bare `Loop(…)`
    // with no `while` guard (an infinite loop, which the grammar cannot spell)
    // — falls through to the generic `Loop(…)` call form, which re-parses
    // faithfully.
    //
    Loop: (expr: MathJsonExpression): FormattingBlock =>
      serializeLoop(expr) ?? serializeGenericFunction(expr),

    //
    // `break` / `continue` — the keyword spelling, but ONLY when this node is
    // being serialized inside the body of a loop that is itself taking its
    // `for`/`while` keyword spelling (`loopDepth > 0`). Everywhere else the
    // call form `Break()` / `Continue()` is the only faithful one: at the top
    // level, or inside a function literal defined in a loop, a bare keyword
    // re-parses as the `control-outside-loop` diagnostic instead of the node
    // it came from.
    //
    // `Break(value)` — the engine's valued form — has no keyword spelling
    // at all (`break value` is not surface syntax), so it keeps the call
    // form regardless of the depth.
    //
    Break: (expr: MathJsonExpression): FormattingBlock =>
      loopDepth > 0 && nops(expr) === 0
        ? fmt.text('break')
        : serializeGenericFunction(expr),

    Continue: (expr: MathJsonExpression): FormattingBlock =>
      loopDepth > 0 && nops(expr) === 0
        ? fmt.text('continue')
        : serializeGenericFunction(expr),

    //
    // Function literal (typed function literals, Phase 4)
    //
    // An annotated `Function` literal — one carrying `["Typed", …]` parameters
    // and/or a `["Typed", body, type]` return ascription — is serialized as an
    // anonymous mapsto `(x: integer) => body`. An UNANNOTATED literal is left
    // to the generic `Function(body, …params)` form (unchanged round-trip).
    // (Named typed defs go through the `Assign` handler, which reconstructs the
    // `f(x: integer) -> real = …` / `function … { … }` syntax.)
    //
    Function: (expr: MathJsonExpression): FormattingBlock =>
      // A function literal is a `break`/`continue` BOUNDARY: the parser resets
      // its loop context both for a `=>` body and for every argument of an
      // explicit `Function(…)` call, so a `break` written inside a lambda
      // defined in a loop is outside that loop. Both spellings this handler
      // can produce are covered by resetting here.
      inLoopContext(0, () => serializeFunctionLiteral(expr)),

    //
    // Type ascription: serialized transparently (the annotation is dropped, as
    // in LaTeX / ASCII-math). Reached only for a stray `Typed` outside a
    // function literal; the `Function`/`Assign` handlers read the annotation
    // directly.
    //
    // EXCEPTION (option B, ruled 2026-08-01; widened 2026-08-04): an UNGROUPED
    // signature ascription is the literal's own CONTRACT
    // (`docs/EFFECTS-MODEL.md`, "Epsil surface"), and dropping it would
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
    // `["Assign", "f", ‹annotated Function literal›]` reconstructs the Epsil
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
      let entries: Record<string, MathJsonExpression> | null = null;
      for (const a of args.slice(1)) {
        // The attributes bag, read through `attributeEntries` so BOTH
        // dictionary encodings are recognized: the operator form the parser
        // emits, and the `{dict: …}` shorthand a CANONICALIZED `Declare`
        // carries. Matching only the operator form lost the `let`/`const`
        // spelling on every round trip through the boxer.
        const bag = attributeEntries(a);
        if (bag !== null) {
          if (entries !== null) return serializeGenericFunction(expr);
          entries = bag;
        } else {
          const s = stringValue(a) ?? symbol(a);
          if (s === null || typeStr !== null || entries !== null)
            return serializeGenericFunction(expr);
          typeStr = s;
        }
      }

      // The attributes bag: only `value` and `constant -> True` have a
      // `let`/`const` spelling.
      let valueOp: MathJsonExpression | null = null;
      let isConst = false;
      if (entries !== null) {
        for (const key of Object.keys(entries)) {
          if (key === 'value') valueOp = entries[key];
          else if (key === 'constant') {
            // Both encodings, as `Declare`'s evaluate handler reads it.
            const v = entries[key];
            if ((symbol(v) ?? stringValue(v)) !== 'True')
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
    //   ["DeclareType", "Pair", {str:"tuple<T, T>"},
    //     ["Dictionary", ["KeyValuePair", "alias", "True"],
    //                    ["KeyValuePair", "typeParams", {str:"T"}]]]
    //                                → type alias Pair<T> = tuple<T, T>
    //   ["DeclareType", "box", {str:"tuple<v: T>"},
    //     ["Dictionary", ["KeyValuePair", "typeParams", {str:"out T"}]]]
    //                                → type box<out T> = tuple<v: T>
    //
    // A bare `type` declares a NOMINAL type (no attributes needed — nominal is
    // `DeclareType`'s default); `type alias` declares a structural alias, and a
    // `typeParams` entry (clause TEXT) makes EITHER form generic — a
    // parameterized nominal type is `typeParams` WITHOUT `alias -> True`. The
    // clause text is bracket-free and carries any variance marker verbatim
    // (`"out T"`), so re-emitting it inside `<…>` reproduces the source. The
    // attributes bag is read in either MathJSON dictionary encoding (the
    // operator `Dictionary` form the parser emits, and the `{dict: …}`
    // shorthand) and in any key order. Any other bag falls back to the generic
    // function form.
    //
    DeclareType: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length !== 2 && args.length !== 3)
        return serializeGenericFunction(expr);

      const name = symbol(args[0]) ?? stringValue(args[0]);
      const body = stringValue(args[1]) ?? symbol(args[1]);
      if (name === null || body === null) return serializeGenericFunction(expr);

      if (args.length === 2) return fmt.line('type ', name, ' = ', body);

      const entries = attributeEntries(args[2]);
      if (entries === null) return serializeGenericFunction(expr);
      const keys = Object.keys(entries);
      if (
        keys.length === 0 ||
        keys.some((k) => k !== 'alias' && k !== 'typeParams')
      )
        return serializeGenericFunction(expr);

      // Read the flag in BOTH encodings, exactly as `declareTypeStatement`
      // does: the `{dict: …}` shorthand boxes an unquoted `True` as a STRING,
      // the operator `Dictionary` form carries the SYMBOL.
      const aliasOp = entries['alias'] ?? null;
      if (
        aliasOp !== null &&
        (symbol(aliasOp) ?? stringValue(aliasOp)) !== 'True'
      )
        return serializeGenericFunction(expr);
      const kind = aliasOp !== null ? 'type alias ' : 'type ';

      const clauseOp = entries['typeParams'];
      // No clause: only the `alias` flag is left, since the bag is non-empty.
      if (clauseOp === undefined) return fmt.line(kind, name, ' = ', body);
      const clause = stringValue(clauseOp) ?? symbol(clauseOp);
      if (clause === null || clause.length === 0)
        return serializeGenericFunction(expr);

      return fmt.line(kind, name, '<', clause, '> = ', body);
    },

    //
    // Protocol declarations: reconstruct the `protocol NAME { … }` statement.
    //
    //   ["DeclareProtocol", "Comparable",
    //     ["Dictionary", ["KeyValuePair", "compare",
    //       ["Pair", {str:"function"}, {str:"(self: Self) -> string"}]]]]
    //     → protocol Comparable {
    //         function compare(self: Self) -> string
    //       }
    //
    // A member's signature rides as the SOURCE TEXT the parser captured, so
    // re-emitting it after the keyword and the member name reproduces the
    // statement verbatim. A protocol with no members is a SEMANTIC protocol
    // and prints as `protocol NAME {}`.
    //
    DeclareProtocol: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length !== 1 && args.length !== 2)
        return serializeGenericFunction(expr);
      const rawName = symbol(args[0]) ?? stringValue(args[0]);
      if (rawName === null) return serializeGenericFunction(expr);
      const name = escapeSymbol(rawName);
      if (args.length === 1) return fmt.line('protocol ', name, ' {}');

      const entries = attributeEntries(args[1]);
      if (entries === null) return serializeGenericFunction(expr);
      const members: FormattingBlock[] = [];
      for (const [member, spec] of Object.entries(entries)) {
        if (operator(spec) !== 'Pair' || nops(spec) !== 2)
          return serializeGenericFunction(expr);
        const kind = stringValue(operand(spec, 1)) ?? symbol(operand(spec, 1));
        const text = stringValue(operand(spec, 2)) ?? symbol(operand(spec, 2));
        if (text === null) return serializeGenericFunction(expr);
        if (kind === 'function')
          members.push(fmt.text(`function ${escapeSymbol(member)}${text}`));
        else if (kind === 'readonly' || kind === 'readwrite')
          members.push(fmt.text(`${kind} ${escapeSymbol(member)}: ${text}`));
        else return serializeGenericFunction(expr);
      }
      if (members.length === 0) return fmt.line('protocol ', name, ' {}');
      return fmt.stack(
        fmt.line('protocol ', name, ' {'),
        fmt.indent(fmt.stack(...members)),
        fmt.text('}')
      );
    },

    //
    // Conformance declarations: reconstruct `type <target> is P₁ & P₂ [{ … }]`.
    //
    //   ["DeclareConformance", {str:"string"}, ["List", "Hashable"]]
    //     → type string is Hashable
    //
    // The implementation block, when present, is a dictionary of member name
    // → function literal; a `__get__x` / `__set__x` key is a property handler
    // and prints back in its `get x(…)` / `set x(…)` spelling.
    //
    DeclareConformance: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length < 2 || args.length > 4)
        return serializeGenericFunction(expr);
      const target = stringValue(args[0]) ?? symbol(args[0]);
      if (target === null) return serializeGenericFunction(expr);

      const listed =
        operator(args[1]) === 'List' ? operands(args[1]) : [args[1]];
      const names = listed.map((p) => symbol(p) ?? stringValue(p));
      if (names.length === 0 || names.some((n) => n === null))
        return serializeGenericFunction(expr);
      let head = `type ${target} is ${names.map((n) => escapeSymbol(n!)).join(' & ')}`;

      // A CONDITIONAL conformance carries its trailing `where` clause as SOURCE
      // TEXT, ahead of the implementation block and told apart from it by its
      // head (a string, where a block is a `Dictionary`). The text is verbatim,
      // so re-emitting it reproduces the statement.
      let rest = args.slice(2);
      if (rest.length > 0 && stringValue(rest[0]) !== null) {
        const clause = stringValue(rest[0])!;
        rest = rest.slice(1);
        head += /^\s*where\b/.test(clause)
          ? ` ${clause.trim()}`
          : ` where ${clause.trim()}`;
      }
      if (rest.length > 1) return serializeGenericFunction(expr);
      if (rest.length === 0) return fmt.text(head);

      const entries = attributeEntries(rest[0]);
      if (entries === null) return serializeGenericFunction(expr);
      const members: FormattingBlock[] = [];
      for (const [key, fn] of Object.entries(entries)) {
        if (operator(fn) !== 'Function') return serializeGenericFunction(expr);
        const get = key.startsWith('__get__');
        const set = key.startsWith('__set__');
        const member = get || set ? key.slice('__get__'.length) : key;
        const line = serializeImplMember(
          get ? 'get' : set ? 'set' : 'function',
          member,
          fn
        );
        if (line === null) return serializeGenericFunction(expr);
        members.push(line);
      }
      if (members.length === 0) return fmt.line(head, ' {}');
      return fmt.stack(
        fmt.text(`${head} {`),
        fmt.indent(fmt.stack(...members)),
        fmt.text('}')
      );
    },

    //
    // Sum-type declarations: reconstruct the `type NAME = v₁ | v₂(…)` sugar
    // (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §A6).
    //
    //   ["DeclareSumType", "node",
    //      ["Tuple", {str:"lit"},  {str:"tuple<num: number>"}],
    //      ["Tuple", {str:"plus"}, {str:"tuple<op1: node, op2: node>"}]]
    //        → type node = lit(num: number) | plus(op1: node, op2: node)
    //
    // The lowering is inverted per the A2 table: a `"nothing"` payload is a
    // NULLARY variant (printed bare), a `tuple<…>` payload prints its element
    // list inside the parentheses, and anything else is the single positional
    // payload (`{str:"boolean"}` → `jbool(boolean)`). Two payloads spell the
    // same declaration in the source and in the reconstruction — `red(nothing)`
    // comes back as `red`, and `f(tuple<a: integer>)` as `f(a: integer)` —
    // which is exact, since both lower to the identical variant declaration.
    //
    DeclareSumType: (expr: MathJsonExpression): FormattingBlock => {
      const args = operands(expr);
      if (args.length < 2) return serializeGenericFunction(expr);

      const name = symbol(args[0]) ?? stringValue(args[0]);
      if (name === null) return serializeGenericFunction(expr);

      let rest = args.slice(1);
      let clause: string | null = null;
      if (operator(rest[0]) !== 'Tuple') {
        const entries = attributeEntries(rest[0]);
        rest = rest.slice(1);
        if (entries === null) return serializeGenericFunction(expr);
        const keys = Object.keys(entries);
        if (keys.length !== 1 || keys[0] !== 'typeParams')
          return serializeGenericFunction(expr);
        clause =
          stringValue(entries['typeParams']) ?? symbol(entries['typeParams']);
        if (clause === null || clause.length === 0)
          return serializeGenericFunction(expr);
      }
      if (rest.length === 0) return serializeGenericFunction(expr);

      const arms: string[] = [];
      for (const v of rest) {
        if (operator(v) !== 'Tuple' || nops(v) !== 2)
          return serializeGenericFunction(expr);
        const variant = stringValue(operand(v, 1)) ?? symbol(operand(v, 1));
        const payload = stringValue(operand(v, 2)) ?? symbol(operand(v, 2));
        if (variant === null || payload === null)
          return serializeGenericFunction(expr);
        if (payload === 'nothing') arms.push(variant);
        else {
          const inner = tupleElementList(payload);
          arms.push(`${variant}(${inner ?? payload})`);
        }
      }

      return fmt.line(
        'type ',
        name,
        clause === null ? '' : `<${clause}>`,
        ' = ',
        arms.join(' | ')
      );
    },

    Assign: (expr: MathJsonExpression): FormattingBlock => {
      const name = operand(expr, 1);
      const rhs = operand(expr, 2);
      if (name !== null && rhs !== null && operator(rhs) === 'Function') {
        const params = operands(rhs).slice(1);
        const op1 = operand(rhs, 1);
        const hasTypedParam = params.some((p) => operator(p) === 'Typed');
        const hasReturn = operator(op1) === 'Typed';
        if ((hasTypedParam || hasReturn) && paramsAreSpellable(params))
          return serializeNamedDef(name, rhs);
      }
      return serializeOperator(expr) ?? serializeGenericFunction(expr);
    },

    // A definition statement — one clause of a (possibly multi-clause)
    // function. `["DefineFunction", "f", ‹Function literal›]` reconstructs
    // the Epsil definition syntax it lowered from: `f(0) = 1` for an
    // expression body, `function f(x: integer) { … }` for a `Block` body.
    // Any other shape falls back to the generic call form.
    //
    // An optional third operand carries the definition's ATTRIBUTES as a
    // dictionary. The only one today is `hold` (`{hold -> True}`), which is
    // the `hold` prefix: `hold f(e) = …` / `hold function f(e) { … }`. Any
    // other attribute has no surface spelling and falls back to the generic
    // call form, so nothing is silently dropped.
    DefineFunction: (expr: MathJsonExpression): FormattingBlock => {
      const name = operand(expr, 1);
      const rhs = operand(expr, 2);
      const attrs =
        nops(expr) === 3 ? definitionAttributes(operand(expr, 3)) : null;
      if (
        (nops(expr) === 2 || attrs !== null) &&
        name !== null &&
        symbol(name) !== null &&
        rhs !== null &&
        operator(rhs) === 'Function' &&
        paramsAreSpellable(operands(rhs).slice(1))
      ) {
        const def = serializeNamedDef(name, rhs, attrs ?? {});
        // The doc comment is re-emitted as `///` lines above the definition
        // — the one comment the reader can write that survives a round trip.
        if (attrs?.description !== undefined)
          return fmt.stack(
            ...attrs.description.split('\n').map((l) => fmt.text(`/// ${l}`)),
            def
          );
        return def;
      }
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
    // `Alternatives` → ` | `-joined). See the Epsil `match` design §2–3.
    //
    Match: (expr: MathJsonExpression): FormattingBlock => {
      // The `if let` statement has no head of its own: it lowers to a
      // two-case `Match` whose fallback arm is the wildcard (see
      // `ifLetParts`). That shape is spelled back as `if let`, exactly as the
      // `while` lowering is spelled back as `while`. A hand-written `match`
      // of that shape — two cases, `do { … }` bodies, a final `_` — is the
      // same expression, so it takes the `if let` spelling too. (The
      // `while let` lowering is the same two-case shape with a `Break` in the
      // wildcard arm, but it lives under a `Loop`, so `serializeLoop` claims
      // it before this entry sees the `Match`.)
      const ifLet = serializeIfBlockForm(expr);
      if (ifLet !== null) return ifLet;

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
    // The case arrow is the mapsto arrow, so it takes the same fancy
    // spelling: a fancy-printed program uses `⇒` for both roles.
    parts.push(
      options?.fancySymbols ? ' ⇒ ' : ' => ',
      serializeExpression(body ?? 'Nothing')
    );
    return fmt.line(...parts);
  }

  // Serialize a MathJSON pattern back to Epsil pattern syntax. The inverse of
  // the parser's `patternize` pass. `typed` maps a binding name to the type
  // text of its `name: type` annotation — the `if let` spelling folds a
  // case's `MatchesType` guard conjuncts back onto their bindings this way
  // (see `typedBindingAnnotations`); a `match` case keeps printing the guard.
  function serializePattern(
    p: MathJsonExpression,
    typed?: ReadonlyMap<string, string>
  ): FormattingBlock {
    const h = operator(p);
    if (h === 'Pin') return fmt.line('== ', serializeExpression(operand(p, 1)));
    if (h === 'Alternatives') {
      const alts = operands(p);
      const parts: (string | FormattingBlock)[] = [];
      alts.forEach((a, i) => {
        if (i > 0) parts.push(' | ');
        parts.push(serializePattern(a, typed));
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
        serializePattern(operand(p, 1) ?? 'Nothing', typed),
        fmt.infixOperator('..'),
        serializePattern(operand(p, 2) ?? 'Nothing', typed)
      );
    if (h === 'List')
      return fmt.fencedList(
        '[',
        fmt.separator(','),
        ']',
        operands(p).map((x) => serializePattern(x, typed))
      );
    if (h === 'Tuple')
      return fmt.fencedList(
        '(',
        fmt.separator(','),
        ')',
        operands(p).map((x) => serializePattern(x, typed))
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
            serializePattern(operand(kv, 2) ?? 'Nothing', typed)
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
      if (s.startsWith('_')) {
        const name = s.slice(1);
        const annotation = typed?.get(name);
        return fmt.text(
          annotation === undefined
            ? escapeSymbol(name)
            : escapeSymbol(name) + ': ' + annotation
        );
      }
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
  // Block-embedded ascription is not produced by the Epsil parser.
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
    /** The rendered type-parameter declarations (`T, U: number`), or `null`. */
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
            specifier:
              effects !== undefined ? effectSetToString(effects) : null,
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
  // infinity/NaN spellings (`oo`/`-oo`/`+oo`/`NaN`). Guards the name
  // suppression below so a non-value-typed parameter that merely wears the
  // reserved prefix (box route) keeps its name.
  // The Epsil spelling of an infinity/NaN value-type text. Both the type
  // grammar's compact spellings (`oo`, what the Epsil parser lowers to) and
  // the CANONICAL spellings its serializer emits (`typeToString` writes
  // `Infinity`/`-Infinity`/`NaN`, which box-route markers carry) map to the
  // Epsil literal. The lowercase `nan` is a LEGACY read-compatibility row: the
  // parser now lowers a NaN literal parameter to the capitalized `NaN`, and
  // the lowercase spelling names the not-a-number PRIMITIVE type. The row
  // exists only so MathJSON lowered before that spelling change — when the
  // type grammar still read `nan` as the value literal — keeps suppressing the
  // generated name. It cannot affect an ordinary parameter declared `x: nan`,
  // because the name suppression below also requires the reserved
  // `literalParam_` prefix (`isLiteralParamName`), which a user-written name
  // never has.
  // The unsigned complex infinity (`~oo`, what `typeToString` emits for that
  // value type) is deliberately absent: Epsil has no literal spelling for it —
  // `⧝` lexes to the ORDINARY symbol `ComplexInfinity`, which the parameter
  // grammar reads as a parameter NAME, not as a literal — so such a parameter
  // keeps its name rather than serializing to something that would not read
  // back as a literal.
  const EPSIL_VALUE_SPELLING: Record<string, string> = {
    'oo': 'Infinity',
    '+oo': 'Infinity',
    '-oo': '-Infinity',
    'Infinity': 'Infinity',
    '+Infinity': 'Infinity',
    '-Infinity': '-Infinity',
    'NaN': 'NaN',
    'nan': 'NaN',
  };

  const isValueTypeText = (t: string): boolean =>
    /^-?[0-9.]/.test(t) ||
    t.startsWith('"') ||
    t === 'true' ||
    t === 'false' ||
    t in EPSIL_VALUE_SPELLING;

  /** A destructuring `Tuple` pattern — `(p, q)`, `(a, (b, c))` — as source.
   * Returns `null` when a leaf is not a name (so the caller falls back to the
   * generic `Function(…)` spelling rather than emitting something that would
   * not re-parse). */
  const serializeDestructuringPattern = (
    p: MathJsonExpression
  ): string | null => {
    const parts: string[] = [];
    for (const el of operands(p)) {
      if (operator(el) === 'Tuple') {
        const nested = serializeDestructuringPattern(el);
        if (nested === null) return null;
        parts.push(nested);
        continue;
      }
      const name = symbol(el);
      if (name === null) return null;
      parts.push(escapeSymbol(name));
    }
    return `(${parts.join(', ')})`;
  };

  /** Does every parameter in the list have a spelling? A destructuring pattern
   * whose leaves are not all names (reachable from raw MathJSON, never from
   * the parser) has none, and `serializeParam` would emit it as an empty slot,
   * so a parameter list containing one cannot be reconstructed at all: the
   * caller falls back to the generic `Function(…)` call form. */
  const paramsAreSpellable = (params: readonly MathJsonExpression[]): boolean =>
    params.every(
      (p) =>
        operator(p) !== 'Tuple' || serializeDestructuringPattern(p) !== null
    );

  const serializeParam = (
    p: MathJsonExpression,
    markerType?: Type,
    bind?: ReadonlySet<string>
  ): FormattingBlock => {
    // A DESTRUCTURING parameter — `((p, q)) => …`, one parameter that binds a
    // pattern of names. `serializeParamList` supplies the surrounding
    // parentheses of the parameter list, so the pattern's own pair is what
    // makes the doubled spelling that distinguishes it from two parameters.
    if (operator(p) === 'Tuple')
      return fmt.text(serializeDestructuringPattern(p) ?? '');
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
      // as-is) — re-escape it for the single-line Epsil string spelling,
      // or a parameter like `f("a\nb")` would serialize with a raw line
      // break the lexer rejects.
      if (t.startsWith('"') && t.endsWith('"')) {
        const inner = t.slice(1, -1).replace(/\\(["\\])/g, '$1');
        return fmt.text(`"${escapeString(inner)}"`);
      }
      return fmt.text(EPSIL_VALUE_SPELLING[t] ?? t);
    }
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    // A BOUND-VARIABLE parameter of a `hold` definition (`bind i`).
    const marker =
      nameSym !== null && bind !== undefined && bind.has(nameSym)
        ? 'bind '
        : '';
    return fmt.text(
      t !== null ? `${marker}${nameStr}: ${t}` : `${marker}${nameStr}`
    );
  };

  const serializeParamList = (
    params: MathJsonExpression[],
    markerTypes: readonly Type[] = [],
    bind?: ReadonlySet<string>
  ): FormattingBlock =>
    fmt.fencedList(
      '(',
      fmt.separator(','),
      ')',
      params.map((p, i) => serializeParam(p, markerTypes[i], bind))
    );

  /** The body of the `Function` entry in `FUNCTIONS` — an ANONYMOUS function
   * literal, in its mapsto spelling `(x: integer) => body` or, for a literal
   * with nothing to annotate, the generic `Function(body, …params)` call
   * form. Split out from the table entry only so the entry can wrap it in
   * the `break`/`continue` boundary both spellings need. */
  const serializeFunctionLiteral = (
    expr: MathJsonExpression
  ): FormattingBlock => {
    const params = operands(expr).slice(1);
    const op1 = operand(expr, 1);
    const hasTypedParam = params.some((p) => operator(p) === 'Typed');
    const hasReturn = operator(op1) === 'Typed';
    // A pattern parameter with a leaf that is not a name — `Tuple(1, "q")`,
    // reachable from raw MathJSON — has NO parameter-list spelling at all, so
    // the whole literal takes the generic form. This has to be decided here,
    // ahead of the annotation test: an annotation elsewhere in the parameter
    // list would otherwise force the arrow spelling and emit the unspellable
    // parameter as an empty slot (`(x: integer, ) => …`), which does not
    // re-parse.
    if (!paramsAreSpellable(params)) return serializeGenericFunction(expr);
    // A DESTRUCTURING parameter has no generic-form spelling that reads as
    // one: `Function(p + q, (p, q))` re-parses correctly but looks like the
    // two-parameter literal. The mapsto form says which it is, so a literal
    // carrying one takes the arrow spelling even with no annotation
    // anywhere.
    const destructuring = params.some((p) => operator(p) === 'Tuple');
    if (!hasTypedParam && !hasReturn && !destructuring)
      return serializeGenericFunction(expr);
    // A plain return-type ascription has no anonymous-mapsto spelling; drop
    // it (the body is serialized without the ascription), as LaTeX and
    // ASCII-math do.
    const { bodyExpr, decomposed } = fnLiteralParts(expr);
    // A marker that DECOMPOSED is not an ascription though — it is the
    // literal's own signature (`docs/EFFECTS-MODEL.md`, "Epsil surface"),
    // and dropping it would silently weaken the literal. None of its pieces
    // has an anonymous-mapsto spelling — the specifier and quantifier slots
    // exist only on the named definition forms, and the mapsto's `-> ‹ret›`
    // slot does not exist at all — so a marker-carrying anonymous literal
    // falls back to the generic `Function(…)` spelling, where the `Typed`
    // handler keeps the marker as an explicit `Typed(body, "‹sig›")`
    // call (option B, ruled 2026-08-01; widened from "effect-bearing" to
    // "decomposed" 2026-08-04). That re-parses to this very node, so the
    // round-trip is lossless — including a ground marker whose result is
    // NARROWER than the body's inferred type, which the dropped-ascription
    // path would have silently widened.
    if (decomposed) return serializeGenericFunction(expr);
    const arrow = options?.fancySymbols ? '⇒' : '=>';
    return fmt.line(
      serializeParamList(params),
      ` ${arrow} `,
      serializeExpression(bodyExpr)
    );
  };

  /**
   * One member of a protocol-implementation block:
   * `function|get|set NAME(params) ‹effects› -> ret { … }`.
   *
   * The `function` branch of {@link serializeNamedDef} with the keyword made
   * a parameter (a property handler spells `get`/`set` instead) and the body
   * always braced — an implementation member has no math form.
   *
   * `null` when a parameter has no spelling, so the whole declaration falls
   * back to its generic call form rather than emitting a member line that
   * would not re-parse.
   */
  const serializeImplMember = (
    keyword: 'function' | 'get' | 'set',
    member: string,
    fn: MathJsonExpression
  ): FormattingBlock | null =>
    // An implementation body is a `break`/`continue` boundary, like any
    // function body (`parser.ts` parses it with the loop context reset).
    inLoopContext(0, () => serializeImplMemberBody(keyword, member, fn));

  const serializeImplMemberBody = (
    keyword: 'function' | 'get' | 'set',
    member: string,
    fn: MathJsonExpression
  ): FormattingBlock | null => {
    const params = operands(fn).slice(1);
    if (!paramsAreSpellable(params)) return null;
    const { bodyExpr, retType, specifier, argTypes } = fnLiteralParts(fn);
    const specPart = specifier !== null ? ` ${specifier}` : '';
    const retPart = retType !== null ? ` -> ${retType}` : '';
    return fmt.line(
      `${keyword} ${escapeSymbol(member)}`,
      serializeParamList(params, argTypes),
      `${specPart}${retPart} `,
      fmt.fencedList(
        '{',
        fmt.separator(';'),
        '}',
        operator(bodyExpr) === 'Block'
          ? mapArgs<FormattingBlock>(bodyExpr!, serializeExpression)
          : [serializeExpression(bodyExpr)]
      )
    );
  };

  // Reconstruct a named function definition from `f` and its `Function`
  // literal: `f(params) ‹effects› -> ret = body`, or
  // `function f(params) ‹effects› -> ret { … }` for a `Block` body. The effect
  // specifier sits between the parameter list and the arrow (Swift-style); it
  // is omitted, along with its space, when the literal declares no effects.
  const serializeNamedDef = (
    name: MathJsonExpression,
    fn: MathJsonExpression,
    attrs: DefinitionAttributes = {}
  ): FormattingBlock =>
    // A named definition's body — braced (`function f(x) { … }`) or math
    // form (`f(x) = …`) — is a `break`/`continue` boundary: the parser
    // resets the loop context for both spellings.
    inLoopContext(0, () => serializeNamedDefBody(name, fn, attrs));

  const serializeNamedDefBody = (
    name: MathJsonExpression,
    fn: MathJsonExpression,
    attrs: DefinitionAttributes
  ): FormattingBlock => {
    const nameSym = symbol(name);
    const nameStr = nameSym !== null ? escapeSymbol(nameSym) : '';
    const params = operands(fn).slice(1);
    const { bodyExpr, retType, specifier, typeParams, argTypes } =
      fnLiteralParts(fn);
    // The specifier slot: the effect words the ascription carries, then the
    // algebraic words of the definition's attributes.
    const specWords = [
      ...(specifier !== null ? [specifier] : []),
      ...(attrs.algebraic ?? []),
    ];
    const specifierText = specWords.length > 0 ? specWords.join(' ') : null;
    const specPart = specifierText !== null ? ` ${specifierText}` : '';
    const retPart = retType !== null ? ` -> ${retType}` : '';
    const bind = attrs.bind !== undefined ? new Set(attrs.bind) : undefined;
    const holdPrefix = attrs.hold ? 'hold ' : '';
    // The M2 type-parameter clause sits between the name and the `(`.
    const clausePart = typeParams !== null ? `<${typeParams}>` : '';
    if (operator(bodyExpr) === 'Block') {
      return fmt.line(
        `${holdPrefix}function ${nameStr}${clausePart}`,
        serializeParamList(params, argTypes, bind),
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
        `${holdPrefix}function ${nameStr}${clausePart}`,
        serializeParamList(params, argTypes, bind),
        `${specPart}${retPart} `,
        fmt.fencedList('{', fmt.separator(';'), '}', [
          serializeExpression(bodyExpr),
        ])
      );
    }
    // The math form claims a specifier — effect OR algebraic words — only
    // WITH the arrow (`f(x) random = 5` is an expression), hence `-> unknown`.
    const mathRetPart =
      retType !== null ? retPart : specifierText !== null ? ' -> unknown' : '';
    return fmt.line(
      `${holdPrefix}${nameStr}`,
      serializeParamList(params, undefined, bind),
      `${specPart}${mathRetPart} = `,
      serializeExpression(bodyExpr)
    );
  };

  /** The decoded attributes of a definition — see {@link definitionAttributes}. */
  type DefinitionAttributes = {
    hold?: boolean;
    bind?: string[];
    algebraic?: string[];
    description?: string;
  };

  /**
   * The attributes dictionary of a `DefineFunction` node, decoded — `null`
   * when the operand is not an attribute bag or holds a key this serializer
   * has no spelling for. Booleans are read in both encodings, exactly as
   * `DeclareType`'s `alias` is: the `{dict: …}` shorthand boxes an unquoted
   * `True` as a STRING, the operator `Dictionary` form the parser emits
   * carries the SYMBOL. `bind` is a list of parameter names (strings in the
   * shorthand, `{str}`/`{sym}` nodes in the operator form); `description` is
   * a string.
   */
  function definitionAttributes(
    attrs: MathJsonExpression | null
  ): DefinitionAttributes | null {
    if (attrs === null) return null;
    const entries = attributeEntries(attrs);
    if (entries === null) return null;
    const out: DefinitionAttributes = {};
    const isTrue = (v: MathJsonExpression) =>
      (symbol(v) ?? stringValue(v)) === 'True';
    for (const key of Object.keys(entries)) {
      const v = entries[key];
      if (v === undefined || v === null) continue;
      switch (key) {
        case 'hold':
          if (!isTrue(v)) return null;
          out.hold = true;
          break;
        case 'commutative':
        case 'associative':
        case 'idempotent':
        case 'involution':
          if (!isTrue(v)) return null;
          (out.algebraic ??= []).push(key);
          break;
        case 'bind': {
          // The operator form carries `["List", …]`; the `{dict: …}` shorthand
          // carries a plain array of names — which, read as MathJSON, would be
          // the CALL `["i"]`; a bind value can only be a list, so an array here
          // is its element list.
          const items =
            operator(v) === 'List'
              ? operands(v)
              : Array.isArray(v)
                ? (v as MathJsonExpression[])
                : [v];
          const names: string[] = [];
          for (const item of items) {
            const n = stringValue(item) ?? symbol(item);
            if (n === null) return null;
            names.push(n);
          }
          out.bind = names;
          break;
        }
        case 'description': {
          const text = stringValue(v);
          if (text === null) return null;
          out.description = text;
          break;
        }
        default:
          return null;
      }
    }
    return out;
  }

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

  /** A keyword-introduced statement block — `do { … }` — laid out the same way
   * as the `if` block form: inline when it fits, otherwise an outer stack
   * anchored at the KEYWORD, so the body sits one indent in and the closing
   * brace lines up under the keyword. Anchoring at the `{` instead (what
   * `fencedList` does) staircases the body out to the brace's column. */
  function serializeBraceBlockStatement(
    head: string,
    block: MathJsonExpression
  ): FormattingBlock {
    const statements = blockStatements(block);
    if (statements.length === 0) return fmt.text(head + '{}');
    return fmt.choice(
      fmt.line(head, serializeBraceBlockInline(block)),
      fmt.stack(
        fmt.text(head + '{'),
        fmt.indent(fmt.stack(...statements)),
        fmt.text('}')
      )
    );
  }

  /** The `{ … }` of a `Block`, forced onto ONE line. Where a caller offers its
   * own stacked layout, the inline alternative must be strictly inline, or the
   * two stacked layouts compete and the brace-anchored one can win on cost and
   * staircase the body. */
  function serializeBraceBlockInline(
    block: MathJsonExpression
  ): FormattingBlock {
    const statements = blockStatements(block);
    if (statements.length === 0) return fmt.text('{}');
    const parts: FormattingBlock[] = [];
    statements.forEach((statement, i) => {
      if (i > 0) parts.push(fmt.separator(';'));
      parts.push(statement);
    });
    return fmt.line(fmt.fence('{'), ...parts, fmt.fence('}'));
  }

  /** Serialize an operand of the conditional form, parenthesizing it when it
   * binds too loosely to re-parse as itself. The consequent and the condition
   * are parsed ABOVE the conditional's own precedence, so a nested conditional
   * (or an `=`) needs parentheses there; the alternative is parsed AT it
   * (right-nesting), so a nested conditional needs none. */
  function serializeConditionalOperand(
    arg: MathJsonExpression | null,
    minPrecedence: number
  ): FormattingBlock {
    const argOp = OPERATORS[operator(arg)];
    if (argOp && argOp.precedence < minPrecedence)
      return fmt.line('(', serializeExpression(arg), ')');
    return serializeExpression(arg);
  }

  const isBlock = (x: MathJsonExpression | null): boolean =>
    x !== null && operator(x) === 'Block';

  /** One clause of a block-form `if` chain: what stands between the keyword
   * and the `{` — a condition (`if c {`) or an `if let` head
   * (`if let p = s {`) — and the clause's body block. The head is a thunk so
   * each layout serializes it afresh (the inline and the stacked layout are
   * both built, and a formatting block belongs to one tree). */
  type IfClause = { head: () => FormattingBlock; body: MathJsonExpression };

  /** Flatten a block-form `If` (or an `if let` `Match`) and its `else if`
   * chain into a list of clauses plus a final `else` body, or `null` when the
   * node is not that shape (a branch that is not a `Block`, an arity outside
   * 2…3, a `Match` that is not the `if let` lowering, or an `else` that is
   * none of a `Block`, a block-form `If`, or an `if let`). Flattening the
   * chain here is what lets the stacked layout below put every `} else if …`
   * at the same column instead of nesting each one a level deeper. */
  function ifBlockClauses(expr: MathJsonExpression): {
    clauses: IfClause[];
    elseBody: MathJsonExpression | null;
  } | null {
    const clauses: IfClause[] = [];
    let node: MathJsonExpression = expr;
    for (;;) {
      let alternative: MathJsonExpression | null;
      if (operator(node) === 'If') {
        const count = nops(node);
        if (count !== 2 && count !== 3) return null;
        const cond = operand(node, 1);
        const body = operand(node, 2);
        alternative = count === 3 ? operand(node, 3) : null;
        if (cond === null || body === null || !isBlock(body)) return null;
        clauses.push({
          head: () =>
            serializeConditionalOperand(cond, CONDITIONAL_PRECEDENCE + 1),
          body,
        });
      } else {
        const parts = ifLetParts(node);
        if (parts === null) return null;
        const { pattern, typed, subject, body } = parts;
        clauses.push({
          head: () =>
            fmt.line(
              'let ',
              serializePattern(pattern, typed),
              ' = ',
              serializeConditionalOperand(subject, CONDITIONAL_PRECEDENCE + 1)
            ),
          body,
        });
        alternative = parts.fallback;
      }

      if (alternative === null) return { clauses, elseBody: null };
      if (isBlock(alternative)) return { clauses, elseBody: alternative };
      // Only a block-form `If` or an `if let` can chain into `else if`.
      // Anything else in `else` position has no block spelling, so the whole
      // node falls back to its generic spelling rather than emitting a
      // half-block hybrid.
      const h = operator(alternative);
      if (h !== 'If' && h !== 'Match') return null;
      node = alternative;
    }
  }

  /** The two-case `Match` both `let`-headed statements lower to, taken
   * apart:
   *
   *   Match(subject,
   *     MatchCase(pattern, [guard], Block(…)),
   *     MatchCase(_, fallbackBody))
   *
   * or `null` when the `Match` does not have exactly that shape. What the
   * wildcard arm's body may be is the caller's test: `ifLetParts` admits the
   * `else` shapes and `Missing`, `whileLetParts` a bare `Break`. A guard
   * must fold back into `name: type` annotations on the pattern's bindings
   * (`typed`); any other guard has no `let`-headed spelling, so the `Match`
   * keeps its `match` spelling. */
  function letMatchParts(node: MathJsonExpression): {
    subject: MathJsonExpression;
    pattern: MathJsonExpression;
    typed: ReadonlyMap<string, string>;
    body: MathJsonExpression;
    fallbackBody: MathJsonExpression;
  } | null {
    if (operator(node) !== 'Match' || nops(node) !== 3) return null;
    const subject = operand(node, 1);
    const arm = operand(node, 2);
    const wildcardArm = operand(node, 3);
    if (subject === null || arm === null || wildcardArm === null) return null;

    if (operator(arm) !== 'MatchCase') return null;
    const armCount = nops(arm);
    if (armCount !== 2 && armCount !== 3) return null;
    const pattern = operand(arm, 1);
    const guard = armCount === 3 ? operand(arm, 2) : null;
    const body = operand(arm, armCount);
    if (pattern === null || body === null || !isBlock(body)) return null;
    const typed = typedBindingAnnotations(pattern, guard);
    if (typed === null) return null;

    if (operator(wildcardArm) !== 'MatchCase' || nops(wildcardArm) !== 2)
      return null;
    if (symbol(operand(wildcardArm, 1)) !== '_') return null;
    const fallbackBody = operand(wildcardArm, 2);
    if (fallbackBody === null) return null;
    return { subject, pattern, typed, body, fallbackBody };
  }

  /** The `if let` lowering (`parseIfLet`): `letMatchParts` whose wildcard
   * arm holds the `else` — a `Block`, or the nested `If`/`Match` of an
   * `else if` chain (checked by the caller) — returned as `fallback`, or the
   * symbol `Missing`, the body the parser gives the arm when there is no
   * `else`, returned as `null`. Any other wildcard body is not this
   * statement. */
  function ifLetParts(node: MathJsonExpression): {
    subject: MathJsonExpression;
    pattern: MathJsonExpression;
    typed: ReadonlyMap<string, string>;
    body: MathJsonExpression;
    fallback: MathJsonExpression | null;
  } | null {
    const parts = letMatchParts(node);
    if (parts === null) return null;
    const { subject, pattern, typed, body, fallbackBody } = parts;
    let fallback: MathJsonExpression | null;
    if (symbol(fallbackBody) === 'Missing') fallback = null;
    else if (
      isBlock(fallbackBody) ||
      operator(fallbackBody) === 'If' ||
      operator(fallbackBody) === 'Match'
    )
      fallback = fallbackBody;
    else return null;

    return { subject, pattern, typed, body, fallback };
  }

  /** The `while let` lowering (`parseWhileLet`) — the operand of a
   * single-operand `Loop` — taken apart: `letMatchParts` whose wildcard arm
   * is a bare `Break`, the exit the parser synthesizes. Any other wildcard
   * body is not this statement. */
  function whileLetParts(loopBody: MathJsonExpression): {
    subject: MathJsonExpression;
    pattern: MathJsonExpression;
    typed: ReadonlyMap<string, string>;
    body: MathJsonExpression;
  } | null {
    const parts = letMatchParts(loopBody);
    if (parts === null) return null;
    const { subject, pattern, typed, body, fallbackBody } = parts;
    if (operator(fallbackBody) !== 'Break' || nops(fallbackBody) !== 0)
      return null;
    return { subject, pattern, typed, body };
  }

  /** The `name: type` annotations a case guard folds back into, as a map from
   * binding name to type text, or `null` when the guard is not purely typed
   * bindings. The guard the parser builds for typed bindings is a conjunction
   * (`And`, or a single conjunct) of `MatchesType(name, TypeFrom("T"))`
   * terms, one per annotated binding, in pattern order — so a guard folds
   * exactly when every conjunct has that form, names a binding that occurs
   * ONCE in the pattern at a position `serializePattern` prints as a binding
   * leaf, and no binding is named twice. `guard === null` folds to the empty
   * map. */
  function typedBindingAnnotations(
    pattern: MathJsonExpression,
    guard: MathJsonExpression | null
  ): ReadonlyMap<string, string> | null {
    const typed = new Map<string, string>();
    if (guard === null) return typed;
    const conjuncts = operator(guard) === 'And' ? operands(guard) : [guard];
    for (const conjunct of conjuncts) {
      if (operator(conjunct) !== 'MatchesType' || nops(conjunct) !== 2)
        return null;
      const name = symbol(operand(conjunct, 1));
      const typeFrom = operand(conjunct, 2);
      if (name === null || operator(typeFrom) !== 'TypeFrom') return null;
      if (nops(typeFrom) !== 1) return null;
      const text = stringValue(operand(typeFrom, 1));
      if (text === null || typed.has(name)) return null;
      if (!isAnnotationText(text)) return null;
      if (bindingLeafCount(pattern, name) !== 1) return null;
      typed.set(name, text);
    }
    return typed;
  }

  /** Whether `text` can stand as the type of a `name: type` annotation in an
   * `if let` head. A guard the parser built carries the annotation's own
   * source slice, but a guard can also be written by hand —
   * `MatchesType(v, TypeFrom("boolean = true"))` — and folding that text into
   * the head verbatim would let the string rewrite the statement (its `=`
   * would be read as the head's separator). So the text must parse as a type
   * on its own (the permissive resolver admits user-declared names, and the
   * type grammar rejects trailing input) and must stay on one line, since a
   * line break inside the head ends the statement. Anything else keeps the
   * `match` spelling. */
  function isAnnotationText(text: string): boolean {
    if (/[\r\n\u2028\u2029]/.test(text)) return false;
    try {
      parseType(text, PERMISSIVE_TYPE_RESOLVER);
      return true;
    } catch {
      return false;
    }
  }

  /** How many times the binding `_name` occurs in `pattern` at a position
   * `serializePattern` prints itself as a binding leaf — the top level, or
   * nested through `List`/`Tuple` elements and `Dictionary` values. A binding
   * inside an operator or call pattern (`a + b`, `f(x)`) is printed by the
   * ordinary expression path, which has no place for an annotation, so it is
   * not counted. */
  function bindingLeafCount(pattern: MathJsonExpression, name: string): number {
    if (symbol(pattern) === '_' + name) return 1;
    const h = operator(pattern);
    if (h === 'List' || h === 'Tuple')
      return operands(pattern).reduce(
        (n: number, op) => n + bindingLeafCount(op, name),
        0
      );
    if (h === 'Dictionary')
      return operands(pattern).reduce(
        (n: number, kv) =>
          n + bindingLeafCount(operand(kv, 2) ?? 'Nothing', name),
        0
      );
    return 0;
  }

  /** The statements of a `Block`, one per element. */
  const blockStatements = (block: MathJsonExpression): FormattingBlock[] =>
    mapArgs<FormattingBlock>(block, serializeExpression) ?? [];

  /** The block form — `if c { … }`, `if c { … } else { … }`, the `else if`
   * chain, and the `if let p = s { … }` clauses that may stand anywhere in it
   * — or `null` when the node is not that shape.
   *
   * Two layouts, and the formatter picks the cheaper: everything on one line,
   * or the conventional stacked form. The stacked one is built as an OUTER
   * stack whose rows are the head lines and the closing `}`, with each body one
   * indent in. That matters: a `StackBlock` aligns its continuation lines to
   * the column where the stack BEGINS, so anchoring the stack at the `if`
   * itself puts `} else {` and `}` under the `if` and the bodies one indent
   * further. Handing the braces to `fencedList` instead (as the inline layout
   * does) would anchor the body at the `{`, which for a statement block
   * staircases it far to the right. */
  function serializeIfBlockForm(
    expr: MathJsonExpression
  ): FormattingBlock | null {
    const parsed = ifBlockClauses(expr);
    if (parsed === null) return null;
    const { clauses, elseBody } = parsed;

    // Inline: `if c { … } else if d { … } else { … }`.
    const inlineParts: (string | FormattingBlock)[] = [];
    clauses.forEach(({ head, body }, i) => {
      inlineParts.push(i === 0 ? 'if ' : ' else if ');
      inlineParts.push(head(), ' ', serializeBraceBlockInline(body));
    });
    if (elseBody !== null)
      inlineParts.push(' else ', serializeBraceBlockInline(elseBody));
    const inline = fmt.line(...inlineParts);

    // Stacked. Statements are separated by the line break itself — a linebreak
    // is a statement separator in Epsil, so no `;` is needed. An empty body
    // contributes no row at all, rather than a line of indent whitespace.
    const rows: FormattingBlock[] = [];
    const pushBody = (body: MathJsonExpression): void => {
      const statements = blockStatements(body);
      if (statements.length > 0)
        rows.push(fmt.indent(fmt.stack(...statements)));
    };
    clauses.forEach(({ head, body }, i) => {
      rows.push(fmt.line(i === 0 ? 'if ' : '} else if ', head(), ' {'));
      pushBody(body);
    });
    if (elseBody !== null) {
      rows.push(fmt.text('} else {'));
      pushBody(elseBody);
    }
    rows.push(fmt.text('}'));

    return fmt.choice(inline, fmt.stack(...rows));
  }

  /** `If` in either of its two Epsil spellings, or `null` for the shapes that
   * have neither (the caller then emits the generic call form). */
  function serializeIf(expr: MathJsonExpression): FormattingBlock | null {
    const blockForm = serializeIfBlockForm(expr);
    if (blockForm !== null) return blockForm;

    // The conditional form. Both branches must be present (the `else` is
    // mandatory) and neither may be a `Block` — a `Block` branch belongs to the
    // block form, and a mixed node has no single spelling.
    if (nops(expr) !== 3) return null;
    const cond = operand(expr, 1);
    const consequent = operand(expr, 2);
    const alternative = operand(expr, 3);
    if (cond === null || consequent === null || alternative === null)
      return null;
    if (isBlock(consequent) || isBlock(alternative)) return null;

    return fmt.line(
      serializeConditionalOperand(consequent, CONDITIONAL_PRECEDENCE + 1),
      ' if ',
      serializeConditionalOperand(cond, CONDITIONAL_PRECEDENCE + 1),
      ' else ',
      serializeConditionalOperand(alternative, CONDITIONAL_PRECEDENCE)
    );
  }

  /** The `‹head› { … }` statement layout: inline when it fits, otherwise the
   * head line, the body one indent in, and the closing brace back under the
   * head. Built like the `if` block form — as an OUTER stack anchored at the
   * KEYWORD, not at the `{` — because a `StackBlock` aligns its continuation
   * lines to the column where the stack begins, and anchoring at the brace
   * staircases the body far to the right. Unlike
   * `serializeBraceBlockStatement`, the head is a block, so it can contain
   * serialized subexpressions (a loop variable, a collection, a condition). */
  function serializeHeadedBlock(
    head: FormattingBlock,
    body: MathJsonExpression
  ): FormattingBlock {
    const statements = blockStatements(body);
    if (statements.length === 0) return fmt.line(head, ' {}');
    return fmt.choice(
      fmt.line(head, ' ', serializeBraceBlockInline(body)),
      fmt.stack(
        fmt.line(head, ' {'),
        fmt.indent(fmt.stack(...statements)),
        fmt.text('}')
      )
    );
  }

  /** The `while` lowering `Loop(Block(If(Not(cond), Break()), body))` taken
   * apart into its condition and its body block, or `null` when the
   * single-operand `Loop` does not have exactly that shape. */
  function whileParts(
    loopBody: MathJsonExpression
  ): { cond: MathJsonExpression; body: MathJsonExpression } | null {
    if (!isBlock(loopBody) || nops(loopBody) !== 2) return null;
    const guard = operand(loopBody, 1);
    const body = operand(loopBody, 2);
    if (guard === null || body === null || !isBlock(body)) return null;
    if (operator(guard) !== 'If' || nops(guard) !== 2) return null;
    const negated = operand(guard, 1);
    const control = operand(guard, 2);
    if (operator(negated) !== 'Not' || nops(negated) !== 1) return null;
    if (operator(control) !== 'Break' || nops(control) !== 0) return null;
    const cond = operand(negated, 1);
    if (cond === null) return null;
    return { cond, body };
  }

  /** `Loop` in one of its three Epsil statement spellings — `for … in … { … }`,
   * `while … { … }` and `while let … = … { … }` — or `null` for a shape that
   * has none of them (the caller then emits the generic call form). */
  function serializeLoop(expr: MathJsonExpression): FormattingBlock | null {
    // The head expressions sit where the parser resumes at precedence 0 and
    // then requires a `{`, so they are parenthesized on the same rule as an
    // `if` condition: a conditional (or anything binding more loosely) would
    // otherwise swallow what follows it.
    const headOperand = (x: MathJsonExpression): FormattingBlock =>
      serializeConditionalOperand(x, CONDITIONAL_PRECEDENCE + 1);

    const args = operands(expr);

    // `for`: one `Element` iterator clause, a `Block` body.
    if (args.length === 2) {
      const [body, clause] = args;
      if (!isBlock(body)) return null;
      if (operator(clause) !== 'Element' || nops(clause) !== 2) return null;
      const binding = operand(clause, 1);
      const collection = operand(clause, 2);
      if (binding === null || collection === null) return null;
      // The loop variable is either a name or a destructuring `Tuple` pattern
      // (`for (p, q) in pairs`), the same pattern grammar as `let (p, q) = v`.
      let bindingText: string | null;
      if (operator(binding) === 'Tuple')
        bindingText = serializeDestructuringPattern(binding);
      else {
        const name = symbol(binding);
        bindingText = name === null ? null : escapeSymbol(name);
      }
      if (bindingText === null) return null;
      // The head is serialized OUTSIDE the loop context — the parser reads
      // the collection at the enclosing depth (`parseFor` calls `inLoopContext`
      // around the body only), so a `["Break"]` buried in the collection
      // expression must keep whatever spelling that enclosing depth gives it.
      const head = fmt.line(
        'for ',
        bindingText,
        ' in ',
        headOperand(collection)
      );
      return inLoopContext(loopDepth + 1, () =>
        serializeHeadedBlock(head, body)
      );
    }

    // `while`: no iterator clause, and a body that opens with the break guard.
    if (args.length === 1) {
      const parts = whileParts(args[0]);
      if (parts !== null) {
        // As in the `for` case, the condition belongs to the enclosing loop
        // context: `parseWhile` parses it before entering the body's context.
        const head = fmt.line('while ', headOperand(parts.cond));
        return inLoopContext(loopDepth + 1, () =>
          serializeHeadedBlock(head, parts.body)
        );
      }

      // `while let`: no iterator clause, and a two-case `Match` body whose
      // wildcard arm breaks.
      const letParts = whileLetParts(args[0]);
      if (letParts !== null) {
        const { pattern, typed, subject, body } = letParts;
        // The pattern (a pin holds an expression) and the subject are read
        // at the enclosing depth, before the body's loop context opens.
        const head = fmt.line(
          'while let ',
          serializePattern(pattern, typed),
          ' = ',
          headOperand(subject)
        );
        return inLoopContext(loopDepth + 1, () =>
          serializeHeadedBlock(head, body)
        );
      }
    }

    return null;
  }

  // Invisible-multiply (`2x`) is handled by the `Multiply` entry in
  // `FUNCTIONS`; this serializes the explicit infix/prefix operator forms.
  function serializeOperator(expr: MathJsonExpression): FormattingBlock | null {
    const opName = operator(expr);
    if (!opName) return null;

    const op = OPERATORS[opName];
    if (!op) return null;
    // `MapsTo` prints as `x => body`, which the parser reads as a LAMBDA — a
    // `break`/`continue` boundary. (The parser itself rewrites the node into
    // `["Function", …]`, so a raw `MapsTo` head reaches the serializer only
    // from hand-written MathJSON.) Recursing with the depth already zeroed
    // cannot loop.
    if (opName === 'MapsTo' && loopDepth !== 0)
      return inLoopContext(0, () => serializeOperator(expr));
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

  // Main body of `serializeEpsil()`
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
/**
 * The entries of an ATTRIBUTES bag, in either MathJSON dictionary encoding:
 * the operator form `["Dictionary", ["KeyValuePair", key, value], …]` the
 * Epsil parser emits, and the `{dict: {key: value, …}}` shorthand a host may
 * box directly. `null` when the operand is not a well-formed bag at all — the
 * caller then has no keyword spelling for it.
 *
 * Not `dictionaryFromExpression()`: that one reads a key with `stringValue`
 * only, so it silently DROPS the SYMBOL keys the parser's lowering uses
 * (`["KeyValuePair", "alias", "True"]`), and it flattens values, losing the
 * string/symbol distinction. The map is prototype-free: an attribute key comes
 * from author text and may be `__proto__`.
 */
/**
 * A `{dict: …}` VALUE is a `DictionaryValue`, not a `MathJsonExpression`: the
 * two unions differ on `boolean`, which is a legal dictionary value but not a
 * legal expression. Canonicalizing a dictionary collapses the `True`/`False`
 * symbols to JS booleans (`boxedExpressionToDictionaryValue`), so a bag that
 * was authored in the operator form comes back as `{dict: {alias: true}}` —
 * and a raw cast would hand `true` to `serializeExpression()`, which matches
 * no expression shape and renders EMPTY (`{"alias" -> }`, unparseable).
 *
 * Map the booleans back to the symbols they canonicalized from. Every other
 * `DictionaryValue` is passed through as before: a bare string keeps reading
 * as a symbol shorthand and an array as a nested expression, which is the
 * convention the dictionary serialization tests pin (`z: ['Add', 2, 'x']` →
 * `"z" -> 2 + x`).
 */
function dictionaryValueToExpression(v: unknown): MathJsonExpression {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return v as MathJsonExpression;
}

/** The element list of a payload type text that is EXACTLY one `tuple<…>` —
 * `"tuple<op1: node, op2: node>"` → `"op1: node, op2: node"` — and `null` for
 * anything else, including a type that merely CONTAINS a tuple
 * (`"list<tuple<integer>>"`). Used to invert the sum-sugar payload lowering
 * (A2); the bracket walk is what tells `tuple<a>` apart from
 * `tuple<a> | integer`, and `->` is skipped atomically so its `>` closes
 * nothing. */
function tupleElementList(payload: string): string | null {
  const OPEN = 'tuple<';
  if (!payload.startsWith(OPEN) || !payload.endsWith('>')) return null;
  let depth = 0;
  for (let i = OPEN.length; i < payload.length; i++) {
    const ch = payload[i];
    if (ch === '-' && payload[i + 1] === '>') {
      i += 1;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']') {
      if (depth === 0)
        // The matching close of the leading `tuple<`: it is the whole payload
        // only when nothing follows it.
        return ch === '>' && i === payload.length - 1
          ? payload.slice(OPEN.length, i)
          : null;
      depth -= 1;
    }
  }
  return null;
}

function attributeEntries(
  expr: MathJsonExpression | null
): Record<string, MathJsonExpression> | null {
  if (expr === null) return null;
  const entries: Record<string, MathJsonExpression> = Object.create(null);

  if (
    typeof expr === 'object' &&
    !Array.isArray(expr) &&
    'dict' in expr &&
    typeof expr.dict === 'object' &&
    expr.dict !== null
  ) {
    for (const [k, v] of Object.entries(expr.dict))
      entries[k] = dictionaryValueToExpression(v);
    return entries;
  }

  if (operator(expr) !== 'Dictionary') return null;
  for (const entry of operands(expr)) {
    if (operator(entry) !== 'KeyValuePair') return null;
    const key = stringValue(operand(entry, 1)) ?? symbol(operand(entry, 1));
    if (key === null) return null;
    entries[key] = operand(entry, 2) ?? 'Nothing';
  }
  return entries;
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
// valid symbol has no Epsil spelling at all; it is emitted with escapes so
// the output stays lexically balanced (single line, closed backticks), and
// re-parses with an `invalid-symbol-name` diagnostic.
function escapeSymbol(s: string): string {
  // A HARD-reserved word (a literal or a head/word operator the grammar claims)
  // has no plain spelling — emit the verbatim form so it re-parses as a symbol.
  // Merely *reserved* words are ordinary identifiers and are emitted as-is.
  if (HARD_RESERVED_WORDS.has(s)) return `\`${s}\``;
  // `let` is contextual in the grammar (it can name a binding), but it heads
  // a construct wherever a statement or an `if` condition begins: `let = 5`
  // is read as a declaration and `if let == x { … }` as an `if let`. A symbol
  // NAMED `let` therefore has no plain spelling that re-parses in every
  // position; the verbatim form does.
  if (s === 'let') return `\`${s}\``;

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
