/**
 * Cortex parsing diagnostics.
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
  | 'host-pragma-disabled' // %0 = pragma name (host-state pragmas gated off)
  | 'error-directive' // %0 = message from a `#error` pragma
  | 'runtime-error' // %0 = error description (non-final statement evaluated to an error value)
  | 'evaluation-canceled' // %0 = machine-readable CancellationCause, %1 = error description (non-final statement hit a cap breach: timeout/iteration/recursion)
  | 'unknown-function' // %0 = called name, %1 = suggested known operator ("did you mean")
  | 'latex-parsing-unavailable' // no LaTeX parser was injected for a `$…$` island
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
