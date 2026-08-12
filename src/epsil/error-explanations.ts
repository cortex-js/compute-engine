/**
 * Extended explanations for diagnostic codes, served by `epsil doc <code>`
 * and advertised by a `note:` footer on rendered diagnostics.
 *
 * Philosophy (ruled 2026-08-12): no opaque numeric codes and no separate
 * `--explain` registry — the kebab-case diagnostic codes ARE the stable
 * identifiers, and the doc command is the lookup surface. An entry exists
 * only when there is genuinely more to say than the diagnostic message
 * already does; the footer is emitted only for codes present here, so there
 * is never a "no extended information available" dead end.
 *
 * Entries are plain text (printed to a terminal): short paragraphs separated
 * by blank lines, with `code` spans in backticks. The first sentence should
 * stand alone — it doubles as the summary line.
 */
export const ERROR_EXPLANATIONS: Record<string, string> = {
  'incompatible-type': `A value's type does not match what its context requires — a typed declaration ("let x: string = …") whose initializer has a different type, an argument outside a function's signature, or a value that fails a type ascription.

The message reads "expected \`T\`, got \`U\`": T is what the context requires, U is what the value actually has. A site may follow — "for argument 2" points at a position in a call, "at \`x\`" quotes the offending subexpression. A type like \`list<string^5>\` is a list of exactly 5 strings; \`finite_integer\` is an integer that is not infinite.

The check runs twice by design: once statically, when the program is canonicalized (reported before anything runs), and again during evaluation, where the mismatch becomes an error value that propagates outward (see "epsil doc runtime-error").`,

  missing: `A function was called with fewer arguments than its signature requires; the error marks the position of the argument that was not provided.

Check the signature with "epsil doc <FunctionName>". Optional parameters never produce this error — only required ones do.`,

  'unexpected-argument': `A function was called with more arguments than its signature accepts; the quoted value is the first extra one.

Check the signature with "epsil doc <FunctionName>". A common cause is passing a collection's elements separately where the function expects the collection itself (or the reverse).`,

  'zero-index': `Indexing is 1-based: "xs[1]" is the first element of a collection and "xs[n]" the n-th, so the literal index 0 never names an element (it yields NaN).

The last element is "xs[-1]" — negative indices count from the end, which is usually what a 0-index habit is reaching for.`,

  'mapsto-arrow-expected': `"->" and "|->" are different operators: "->" pairs a key with a value (the key must be a string, as in a dictionary entry) and also writes function TYPES in annotations ("(number) -> number"), while "|->" is the mapsto arrow that builds a function value.

So "(x) -> x^2" reads as a key-value pair with a malformed key, not a lambda. Write "(x) |-> x^2" for the function; the fixit in the diagnostic applies exactly that rewrite.`,

  'chained-assignment': `"a = b = 5" does not chain: "=" only assigns as a whole statement, so the OUTER "=" assigns and the inner one compares — "a" receives the boolean of "b = 5".

Write "a := b := 5" to actually chain the assignment, or "a := (b == 5)" if the comparison was the intent.`,

  'assign-in-condition': `Inside a condition, ":=" assigns — and the assigned value, not a comparison, becomes the test: "if flag := true { … }" sets flag and then tests "true".

Use "==" to compare, or perform the assignment on its own line before the condition. (A bare "=" in a condition already compares, so only an explicit ":=" reaches this diagnostic.)`,

  'floor-division-comment': `"//" starts a line comment, not floor division — everything after it on the line is ignored, which silently truncates an expression like "a // b".

Use "Floor(a / b)" for the integer quotient.`,

  'control-outside-loop': `"break" and "continue" are only valid directly inside a "while" or "for" body — and the loop context resets at every function and lambda boundary, so a "break" inside a lambda DEFINED in a loop is still outside the loop.

To stop a pipeline early, restructure with a condition or a Take/Filter stage instead of breaking out of a callback.`,

  'runtime-error': `Runtime problems in Epsil are VALUES, not exceptions: a failing subexpression evaluates to an Error value, which propagates outward through the enclosing expressions. Nothing is thrown, and the rest of the program keeps running.

The parenthesized chain in the message ("in Characters argument 1, in Map argument 2") is the propagation path, innermost first — where the error was born, then the calls it traveled through. The caret in the report points at the innermost location the source can show.

Only the last statement's value is a program's result, so an error produced by an EARLIER statement would vanish silently; that is why it is reported as a diagnostic. The final statement's error simply is the program's value.`,

  'static-type-error': `This problem was detected before anything ran, when the program was canonicalized — the same analysis "epsil check" performs.

A static diagnostic never suppresses evaluation: the program still runs exactly as written (errors are values — see "epsil doc runtime-error"), so the same mistake may be reported a second time by the run itself. The label distinguishes the tiers: "Type error"/"Static error" for the pre-run analysis, "Runtime error" for the run.`,
};

/**
 * The explanation for a diagnostic code, or `undefined`. Case-insensitive:
 * codes are typed by hand from a rendered diagnostic.
 */
export function explainErrorCode(code: string): string | undefined {
  return ERROR_EXPLANATIONS[code.toLowerCase()];
}
