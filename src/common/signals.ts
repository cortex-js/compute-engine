export type RuntimeSignalCode =
  | 'timeout'
  | 'out-of-memory'
  | 'recursion-depth-exceeded'
  | 'iteration-limit-exceeded';

export type SignalCode =
  | RuntimeSignalCode
  | (
      | 'invalid-name'
      | 'expected-predicate'
      | 'expected-symbol'
      | 'operator-requires-one-operand'
      | 'postfix-operator-requires-one-operand'
      | 'prefix-operator-requires-one-operand'
      | 'unbalanced-symbols'
      | 'expected-argument'
      | 'unexpected-command'
      | 'cyclic-definition' // arg: [cycle]
      | 'invalid-supersets' // arg: [superset-domain]
      | 'expected-supersets'
      | 'unknown-domain' // arg: [domain]
      | 'duplicate-wikidata' // arg: [wikidata]
      | 'invalid-dictionary-entry' // arg: [error]
      | 'syntax-error'
    );

export type SignalMessage = SignalCode | [SignalCode, ...any[]];

export type SignalOrigin = {
  url?: string;
  source?: string;
  offset?: number;
  line?: number;
  column?: number;
  around?: string;
};

export type Signal = {
  severity?: 'warning' | 'error';

  /** An error/warning code or, a code with one or more arguments specific to
   * the signal code.
   */
  message: SignalMessage;

  /** If applicable, the head of the function about which the
   * signal was raised
   */
  head?: string;

  /** Location where the signal was raised. */
  origin?: SignalOrigin;
};

export type ErrorSignal = Signal & {
  severity: 'error';
};

export type WarningSignal = Signal & {
  severity: 'warning';
};

export type WarningSignalHandler = (warnings: WarningSignal[]) => void;

/**
 * The error codes can be used in an `ErrorCode` expression:
 *
 *        `["ErrorCode", "'syntax-error'", arg1]`
 *
 * It evaluates to a localized, human-readable string.
 *
 *
 * * `unknown-symbol`: a symbol was encountered which does not have a
 * definition.
 *
 * * `unknown-operator`: a presumed operator was encountered which does not
 * have a definition.
 *
 * * `unknown-function`: a LaTeX command was encountered which does not
 * have a definition.
 *
 * * `unexpected-command`: a LaTeX command was encountered when only a string
 * was expected
 *
 * * `unexpected-superscript`: a superscript was encountered in an unexpected
 * context, or no `powerFunction` was defined. By default, superscript can
 * be applied to numbers, symbols or expressions, but not to operators (e.g.
 * `2+^34`) or to punctuation.
 *
 * * `unexpected-subscript`: a subscript was encountered in an unexpected
 * context or no 'subscriptFunction` was defined. By default, subscripts
 * are not expected on numbers, operators or symbols. Some commands (e.g. `\sum`)
 * do expected a subscript.
 *
 * * `unexpected-sequence`: some adjacent elements were encountered (for
 * example `xy`), but no `invisibleOperator` is defined, therefore the elements
 * can't be combined. The default `invisibleOperator` is `Multiply`, but you
 * can also use `list`.
 *
 * * `expected-argument`: a LaTeX command that requires one or more argument
 * was encountered without the required arguments.
 *
 * * `expected-operand`: an operator was encountered without its required
 * operands.
 *
 * * `non-associative-operator`: an operator which is not associative was
 * encountered in an associative context, for example: `a < b < c` (assuming
 * `<` is defined as non-associative)
 *
 * * `postfix-operator-requires-one-operand`: a postfix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `prefix-operator-requires-one-operand`: a prefix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `base-out-of-range`:  The base is expected to be between 2 and 36.
 *
 */
export type ErrorCode =
  | 'expected-argument'
  | 'unexpected-argument'
  | 'expected-operator'
  | 'expected-operand'
  | 'invalid-name'
  | 'invalid-dictionary-entry'
  | 'unknown-symbol'
  | 'unknown-operator'
  | 'unknown-function'
  | 'unknown-command'
  | 'unexpected-command'
  | 'unbalanced-symbols'
  | 'unexpected-superscript'
  | 'unexpected-subscript'
  | 'unexpected-sequence'
  | 'non-associative-operator'
  | 'function-has-too-many-arguments'
  | 'function-has-too-few-arguments'
  | 'operator-requires-one-operand'
  | 'infix-operator-requires-two-operands'
  | 'prefix-operator-requires-one-operand'
  | 'postfix-operator-requires-one-operand'
  | 'associative-function-has-too-few-arguments'
  | 'commutative-function-has-too-few-arguments'
  | 'threadable-function-has-too-few-arguments'
  | 'hold-first-function-has-too-few-arguments'
  | 'hold-rest-function-has-too-few-arguments'
  | 'base-out-of-range'
  | 'syntax-error';
