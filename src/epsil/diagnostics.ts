/**
 * Epsil parsing diagnostics.
 *
 * These types were ported from the old combinator library. They are the
 * **canonical** diagnostic types for the Phase 1 lexer/parser rewrite.
 */

export type DiagnosticCode =
  | 'asymmetric-operator-whitespace' // %0 = operator
  | 'reserved-word' // %0 = word
  | 'binary-number-expected'
  | 'closing-bracket-expected' // %0 = bracket
  | 'decimal-number-expected'
  | 'dictionary-key-value-expected'
  | 'duplicate-dictionary-key' // %0 = key
  | 'eof-expected' // %0 = unexpected symbol
  | 'empty-verbatim-symbol'
  | 'end-of-comment-expected'
  | 'exponent-expected'
  | 'expression-expected'
  | 'hexadecimal-number-expected'
  | 'invalid-symbol-name' // %0 = symbol name
  | 'type-annotation-error' // %0 = message from the type subparser
  | 'type-variables-unsupported' // %0 = type name — a parameterized NOMINAL type (`type name<…> = …`); only the `type alias name<…>` form takes a clause
  | 'empty-type-parameter-clause' // %0 = function name — `function f<>(…)`: the clause slot is present but declares nothing
  | 'duplicate-type-parameter' // %0 = variable name — the same name twice in one `function f<T, T>(…)` clause
  | 'duplicate-type-parameter-clause' // %0 = function name — BOTH binder spellings on one definition (`function f<T>(x: T) -> T where T`); `<T>` and `where T` are the same binding site
  | 'generic-clause-unsupported' // %0 = function name — a generic (`function f<T>(…)`) definition cannot take part in a multi-clause set
  | 'type-declaration-not-top-level' // %0 = type name — a `type` statement inside a block or function body; types are engine-global, so declarations are legal only at the top level of a program
  | 'host-pragma-disabled' // %0 = pragma name (host-state pragmas gated off)
  | 'error-directive' // %0 = message from a `#error` pragma
  | 'runtime-error' // %0 = error description (non-final statement evaluated to an error value), %1 = breadcrumb frame chain, if the error bubbled (e.g. "in Ln argument 1, in Add argument 2")
  | 'static-type-error' // %0 = error description, %1 = offending statement in Epsil form (a type error the engine detects at canonicalization time, before anything runs)
  | 'evaluation-canceled' // %0 = machine-readable CancellationCause, %1 = error description (non-final statement hit a cap breach: timeout/iteration/recursion)
  | 'unknown-function' // %0 = called name, %1 = suggested known operator ("did you mean")
  | 'print-not-available' // %0 = called name — there is no print; a program's output is its last statement's value
  | 'type-not-callable' // %0 = type name — a type name used as a function; types have no constructor yet; annotate instead: `const p: %0 = …`
  | 'assign-in-condition' // `if flag := true { … }` — the assignment's VALUE becomes the test. A bare `=` in a condition compares (positional `=`), so only the explicit `:=` reaches this
  | 'chained-assignment' // `a = b = 5` — the outer `=` assigns and the inner COMPARES, so this assigns a boolean. Write `a := b := 5` to chain, or `a := (b == 5)` if the comparison was meant
  | 'destructuring-bare-equal' // `(a, b) = (b, a)` — a parenthesized left side is not a binding target, so this COMPARES two tuples and discards the result. Write `(a, b) := (b, a)` to destructure, or `==` if the comparison was meant
  | 'control-outside-loop' // %0 = `break` or `continue` — used outside a `while`/`for` body. The context resets at every function/lambda boundary, so a `break` inside a lambda defined in a loop is also outside
  | 'parameter-shadows-constant' // %0 = name — a function parameter named after a multi-character engine constant (`f(Pi) = …`): the body's `Pi` is the argument, not π
  | 'zero-index' // literal index 0 — indexing is 1-based
  | 'floor-division-comment' // `//` after code on the same line looks like floor division; it starts a comment
  | 'latex-parsing-unavailable' // no LaTeX parser was injected for a `$…$` island
  | 'conditional-else-expected' // a conditional expression (`a if c else b`) is missing its `else` branch
  | 'conditional-if-line-start' // an `if` starting a line always begins an if-STATEMENT; a conditional tail (`a if c else b`) must keep `if` on the same line as `a`
  | 'match-case-arrow-expected' // a `match` case is missing its `=>` arrow
  | 'match-case-separator' // match cases are separated by a newline or `;`, not a comma
  | 'match-alternative-binding' // a named binding appears inside an or-alternative
  | 'match-multiple-rest' // more than one `...rest` in a single list/tuple pattern
  | 'match-irrefutable-case' // %0 = binding name — a non-final case that matches anything
  | 'type-pattern-unsupported' // %0 = annotation text — a typed pattern's annotation is not a simple named type (it never resolves, so the case can never match)
  | 'range-pattern-bounds' // a range pattern bound is not a numeric literal
  | 'range-pattern-step' // a stepped / non-binary range in pattern position
  | 'range-pattern-empty' // %0 = lo, %1 = hi — an empty range pattern (lo > hi)
  | 'invalid-escape-sequence' // %0 = escape sequence char
  | 'invalid-unicode-codepoint-string' // %0 = codepoint string
  | 'invalid-unicode-codepoint-value' // %0 = codepoint
  | 'literal-expected' // %0 = literal
  | 'multiline-string-expected'
  | 'multiline-whitespace-expected'
  | 'opening-bracket-expected' // %0 = bracket
  | 'primary-expected'
  | 'string-literal-opening-delimiter-expected'
  | 'string-literal-closing-delimiter-expected' // %0 = delimiter
  | 'mapsto-arrow-expected' // `->` (KeyValuePair) whose left side is shaped like a parameter list — `(x: number) -> x^2`, `(x, y) -> x + y`, `= x -> x + 1` — a function written with the wrong arrow; recovered as the intended `|->`
  | 'parameter-name-mismatch' // %0 = lambda parameter name, %1 = name in the type annotation — a typed declaration's annotation and its lambda initializer name the same positional parameter differently
  | 'symbol-expected'
  | 'unbalanced-verbatim-symbol' // %0 = symbol name
  | 'unexpected-symbol'; // %0 symbol, %1 = trace

export type DiagnosticMessage = DiagnosticCode | [DiagnosticCode, ...any];

/**
 * The parser will attempt to continue parsing even when an error is
 * encountered.
 *
 * However, in the rare cases where parsing cannot proceed, this
 * error will be thrown.
 *
 * This would happen if a `#error` directive is encountered.
 */
export class FatalParsingError extends Error {
  constructor(msg: string) {
    super();
    this.message = msg;
  }
}

export type Fixit = [start: number, end: number, value: string];

export type ParsingDiagnostic = {
  // A `warning` is a diagnostic that indicate something that does not
  // prevent the code from being compiled. It could be a linting issue for
  // example.
  // An `error` is something that will prevent the code from being parsed.
  severity: 'warning' | 'error';
  message: DiagnosticMessage;
  range: [start: number, end: number, position?: number];
  // "Fixits" is a suggestion in the form of a series of operations
  // to modify the source in a way that could address the warning or error.
  // The fixit for a warning is always safe to apply. The fixit for an error
  // is a guess and should be reviewed before being applied.
  fixits?: Fixit[];
};
