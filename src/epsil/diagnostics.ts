/**
 * Diagnostic codes shared by the Epsil lexer, parser, and presentation layer.
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
  | 'expression-nesting-limit' // %0 = maximum supported recursive expression nesting
  | 'hexadecimal-number-expected'
  | 'invalid-symbol-name' // %0 = symbol name
  | 'type-annotation-error' // %0 = message from the type subparser
  | 'type-variables-unsupported' // %0 = type name — a parameterized NOMINAL type (`type name<…> = …`); only the `type alias name<…>` form takes a clause
  | 'empty-type-parameter-clause' // %0 = function name — `function f<>(…)`: the clause slot is present but declares nothing
  | 'duplicate-type-parameter' // %0 = variable name — the same name twice in one `function f<T, T>(…)` clause
  | 'duplicate-type-parameter-clause' // %0 = function name — BOTH binder spellings on one definition (`function f<T>(x: T) -> T where T`); `<T>` and `where T` are the same binding site
  | 'generic-clause-unsupported' // %0 = function name — a generic (`function f<T>(…)`) definition cannot take part in a multi-clause set
  | 'hold-literal-parameter' // %0 = function name — a `hold` definition with a literal parameter (`hold f(0) = …`); a literal parameter selects a clause by the argument's VALUE, and a hold function never evaluates its arguments
  | 'bind-requires-hold' // %0 = function name — a `bind`-marked (bound-variable) parameter on a definition without the `hold` prefix; a bound variable can only be received unevaluated
  | 'unexpected-definition-attribute' // %0 = the word — an algebraic word (`commutative`, `associative`, `idempotent`, `involution`) where it has no meaning: on a `hold` definition (its calls are neither reordered nor flattened) or on a protocol member (a requirement, not an operator)
  | 'duplicate-definition-attribute' // %0 = the word — the same algebraic word twice in one specifier slot
  | 'type-declaration-not-top-level' // %0 = type name — a `type` statement inside a block or function body; types are engine-global, so declarations are legal only at the top level of a program
  | 'type-redefinition' // %0 = type name — a second `type` statement declaring the same name in ONE program (a sum's variant names count as its statement's own). Within one compilation unit a redeclaration is a mistake; across units (a re-run cell) it is the notebook redefinition gesture and stays legal. See `docs/TYPE-SYSTEM.md`
  | 'object-type-not-inline' // an `object{…}` layout written anywhere other than as the definition of a NOMINAL named type (`let x: object{id: string}`, nested inside a declaration body, or as a `type alias` body). Object types are nominal: only a named declaration mints the constructor and carries the conformances, so an inline layout would name a type nothing can construct. See `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an object type"
  | 'protocol-redefinition' // %0 = protocol name — the protocol counterpart of `type-redefinition`; same rule, same boundary
  | 'function-redefinition' // %0 = function name — two clauses in ONE program share a parameter list, so the second silently replaces the first (user ruling 2026-08-14). Only REPLACEMENT is refused: clauses at distinct parameter lists still accumulate, which is what multi-clause functions are for. Same unit boundary as the two above — a re-run cell still replaces last-wins. Reported by BOTH tiers, like the two above: the static pass collects each clause's parameter domain from the canonicalized literal (`epsil check` reports it before anything runs), the statement route by the batch stamp. See `docs/TYPE-SYSTEM.md`
  | 'protocol-declaration-not-top-level' // %0 = protocol name — a `protocol` statement inside a block or function body; protocols are engine-global, so declarations are legal only at the top level of a program
  | 'protocol-name-expected' // a `protocol` statement whose head is not followed by a name
  | 'protocol-member-keyword-missing' // %0 = member name — a bare `value: string` protocol member; every member starts with `function`, `readonly` or `readwrite`
  | 'protocol-member-signature-expected' // %0 = protocol name — a protocol member that is neither `function IDENT(…) -> type` nor `readonly`/`readwrite` IDENT: type`
  | 'protocol-implementation-pending' // (warning) %0 = conformance target, %1 = protocol name, %2 = why it is pending ('' for the ordinary declare-then-implement case; a description of what moved when a protocol replacement or a target-type redefinition left the edge unsatisfied) — a conformance still without an implementation at the end of a `ce.parse()` batch
  | 'protocol-in-type-position' // %0 = protocol name — a PROTOCOL used where a type is expected (`function f(x: Comparable)`); protocols are not types (ruling P8), so the annotation must be a constrained variable instead
  | 'host-pragma-disabled' // %0 = pragma name (host-state pragmas gated off)
  | 'error-directive' // %0 = message from a `#error` pragma
  | 'runtime-error' // %0 = error description (non-final statement evaluated to an error value), %1 = breadcrumb frame chain ('' when the error was raised in place, e.g. "in Ln argument 1, in Add argument 2"), %2 = engine error code (keys `epsil doc <code>` extended docs)
  | 'static-type-error' // %0 = error description, %1 = offending statement in Epsil form (a type error the engine detects at canonicalization time, before anything runs)
  | 'evaluation-canceled' // %0 = machine-readable CancellationCause, %1 = error description (non-final statement hit a cap breach: timeout/iteration/recursion)
  | 'unknown-function' // %0 = called name, %1 = suggested known operator ("did you mean")
  | 'print-not-available' // %0 = called name — an unresolved print-like alias (`puts`, `echo`, ...); the function that exists is `print`
  | 'type-not-callable' // %0 = type name — a type name used as a function; types have no constructor yet; annotate instead: `const p: %0 = …`
  | 'protocol-property-not-callable' // %0 = member name, %1 = protocol name — a protocol PROPERTY (`readonly`/`readwrite`) member called as a function (`area(c)`). The two member kinds have different spellings: a `function` member is called (`span(b)`), a property is read with a dot (`b.area`). Only properties reach this — a function member in call position is exactly right
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
  | 'match-not-exhaustive' // (warning) %0 = the subject's declared type, %1 = the uncovered alternatives spelled as patterns (`red(), yellow()`) — a `match` on a closed type (a sugar-declared sum, or `boolean`) with no case for some inhabitant, so that subject evaluates to the `match-no-case` error value. Static tier only: the subject must be a name with a declared annotation in scope
  | 'if-let-equal-expected' // an `if let` head is missing the `=` between its pattern and its subject
  | 'if-let-irrefutable' // (warning) %0 = binding name — an `if let` pattern that matches anything (a bare binding or `_`, no type guard), so the statement cannot fail and an `else` would never run; a plain `let` binds unconditionally
  | 'while-let-equal-expected' // a `while let` head is missing the `=` between its pattern and its subject
  | 'while-let-irrefutable' // (warning) %0 = binding name — a `while let` pattern that matches anything (a bare binding or `_`, no type guard), so the loop can only end on a `break` in its body; `while true` with a `let` in the body says so plainly
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
  | 'mapsto-arrow-expected' // `->` (KeyValuePair) whose left side is shaped like a parameter list — `(x: number) -> x^2`, `(x, y) -> x + y`, `= x -> x + 1` — a function written with the wrong arrow; recovered as the intended `=>`
  | 'mapsto-arrow-legacy' // the retired `|->` spelling of the mapsto arrow — `x |-> x + 1`; carries a fixit replacing it by `=>` and is recovered AS the arrow, so the rest of the program parses normally
  | 'parameter-name-mismatch' // %0 = lambda parameter name, %1 = name in the type annotation — a typed declaration's annotation and its lambda initializer name the same positional parameter differently
  | 'pattern-binding-expected' // a leaf of a destructuring pattern (`((p, q)) => …`, `for (p, q) in xs`, `let (p, q) = v`) that is neither a name, `_`, nor a nested pattern — a pattern in BINDING position matches by shape alone, so it has no place for a literal to match against
  | 'pattern-element-annotation' // a per-element type annotation inside a destructuring pattern — `((p: integer, q)) => …`; a pattern position binds a name and states no type
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

/**
 * A supplementary explanation attached to a diagnostic: the context that
 * makes the primary message actionable — the signature of the function whose
 * call failed, the place that function was defined.
 *
 * A note carrying a `range` points at a *second* place in the source, and a
 * renderer that shows source excerpts is expected to show that place too
 * (the CLI renders a sub-block with its own `-->` location line); a note
 * without one is a plain sentence appended under the primary excerpt.
 *
 * Notes are advisory: dropping them loses explanation, never meaning, so a
 * host is free to render only `message`.
 */
export type DiagnosticNote = {
  message: string;
  range?: [start: number, end: number];
};

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
  // Supplementary explanations — see {@link DiagnosticNote}. They add context
  // to the message; they never change what the diagnostic means.
  notes?: DiagnosticNote[];
};
