import type { ParsingDiagnostic } from './diagnostics.js';

/**
 * The text of a diagnostic of `parseEpsil()` or `checkEpsil()`, for display
 * to a user: the message tuple `[code, ...args]` of the diagnostic written as
 * a sentence, without the code.
 *
 * ```ts
 * epsilDiagnosticMessage(checkEpsil(ce, 'let x: notatype = 1').diagnostics[0]);
 * // ➔ 'Unknown type "notatype"'
 * ```
 *
 * The command line, the MCP server and the VS Code extension show the same
 * text. The text is in English.
 */
export function epsilDiagnosticMessage(diagnostic: ParsingDiagnostic): string {
  const parts = Array.isArray(diagnostic.message)
    ? diagnostic.message
    : [diagnostic.message];
  const [code, ...args] = parts;

  switch (code) {
    case 'unknown-function':
      return `Unknown function "${args[0]}"; did you mean "${args[1]}"?`;
    case 'print-not-available':
      return `There is no "${args[0]}" function; did you mean "print"?`;
    case 'type-not-callable':
      return `"${args[0]}" is a type, not a function: types have no constructor; annotate instead, e.g. "const p: ${args[0]} = …"`;
    case 'type-declaration-not-top-level':
      return `The type "${args[0]}" is declared inside a block: types are global, so type declarations are only allowed at the top level of a program`;
    case 'type-redefinition':
      return `The type "${args[0]}" is declared twice in this program; a name may only be declared once per program (re-running an edited declaration in a later program still replaces it)`;
    case 'object-type-not-inline':
      return `An "object{…}" type may only be the definition of a named type: object types are nominal, so declare one with "type Person = object{…}" (not "type alias"), then use "Person" here`;
    case 'protocol-redefinition':
      return `The protocol "${args[0]}" is declared twice in this program; a name may only be declared once per program (re-running an edited declaration in a later program still replaces it)`;
    case 'function-redefinition':
      return `Two clauses of "${args[0]}" in this program have the same parameter list, so the second would silently replace the first; give them different parameter lists to dispatch between them (re-running an edited definition in a later program still replaces it)`;
    case 'absence-marker-binding':
      return `"${args[0]}" is an absence marker and cannot be rebound: the engine recognizes it by its name, so a binding of it could never behave like the value it holds. Choose another name (to test for it in a match, write "== ${args[0]}")`;
    case 'variable-redeclaration':
      return `"${args[0]}" is already declared in this scope; assign to it with "${args[0]} = …" to update it, or choose another name (a "let" in a nested block may shadow it)`;
    case 'protocol-declaration-not-top-level':
      return `The protocol "${args[0]}" is declared inside a block: protocols are global, so protocol declarations are only allowed at the top level of a program`;
    case 'protocol-name-expected':
      return `Expected a protocol name after "protocol"`;
    case 'protocol-member-keyword-missing':
      return `The protocol member "${args[0]}" needs a keyword; did you mean "readonly ${args[0]}" or "readwrite ${args[0]}"?`;
    case 'protocol-member-signature-expected':
      return `Expected a member of the "${args[0]}" protocol: "function name(self: Self, …) -> type", "readonly name: type" or "readwrite name: type"`;
    case 'protocol-extends-member-conflict':
      return `The closure of the protocol "${args[0]}" declares one member name twice: ${args[1]}`;
    case 'protocol-implementation-pending':
      return args[2]
        ? `The conformance "type ${args[0]} is ${args[1]}" is not satisfied: ${args[2]}`
        : `The conformance "type ${args[0]} is ${args[1]}" has no implementation yet; provide one with "type ${args[0]} is ${args[1]} { … }"`;
    case 'protocol-property-not-callable':
      return `"${args[0]}" is a property of the "${args[1]}" protocol, not a function: read it with a dot, e.g. "x.${args[0]}" (only "function" members are called)`;
    case 'protocol-in-type-position':
      return `"${args[0]}" is a protocol, not a type. Use a constrained variable: "where T is ${args[0]}"`;
    case 'type-variables-unsupported':
      return `Generic type aliases are not supported yet: "type ${args[0]}<…>" is reserved syntax`;
    case 'empty-type-parameter-clause':
      return `"function ${args[0]}<>" declares no type variable; write "function ${args[0]}<T>(…)" or drop the "<>"`;
    case 'duplicate-type-parameter':
      return `The type variable "${args[0]}" is declared more than once`;
    case 'duplicate-type-parameter-clause':
      return `"${args[0]}" declares its type variables twice: "function ${args[0]}<T>(…)" and "… where T" are the same binding site, so use one or the other`;
    case 'generic-clause-unsupported':
      return `"${args[0]}" is generic; generic functions are single-clause — they cannot use literal parameters or be extended with more clauses`;
    case 'control-outside-loop':
      return `"${args[0]}" is only valid inside a "while" or "for" body; the loop context resets at every function and lambda boundary`;
    case 'assign-in-condition':
      return `":=" in a condition assigns, and the assigned value becomes the test; use "==" to compare, or assign on its own line first`;
    case 'chained-assignment':
      return `An assignment is a statement, not a value, so assignments do not chain; write two statements, "b := 5; a := b", or "a := (b == 5)" if the comparison was meant`;
    case 'add-to-target':
      return `The target of "+=" must be a variable or a list element at integer positions: "s += e" or "L[i] += e"`;
    case 'parallel-clause-not-first':
      return `Only the first clause of a comprehension can be "parallel": the other clauses run in order inside each pass of the first one`;
    case 'parallel-outer-write':
      return `The body of a "parallel for" loop can change "${args[0]}", which is declared outside the loop, only with "+=": the passes can run in any order`;
    case 'parallel-accumulator-read':
      return `The body of a "parallel for" loop changes "${args[0]}" with "+=", so it cannot read "${args[0]}": its value depends on the order of the passes`;
    case 'parallel-effect':
      return `The body of a parallel loop can have only the "random" effect, and this body has: ${args[0]}`;
    case 'parallel-exit':
      return `"${args[0]}" cannot leave a parallel loop; an inner loop of the body can use "break" and "continue"`;
    case 'parallel-comprehension-write':
      return `The body of a parallel comprehension cannot change "${args[0]}", which is declared outside it; use a "parallel for" loop with "+=" to add to a variable`;
    case 'parameter-shadows-constant':
      return `The parameter "${args[0]}" shadows the constant of the same name: inside the body, "${args[0]}" is the argument, not the constant. Rename the parameter, or use the constant's value directly`;
    case 'zero-index':
      return `Indexing is 1-based: xs[1] is the first element (index 0 yields NaN)`;
    case 'pattern-binding-expected':
      return `A destructuring pattern binds names by position: each element must be a name, "_" to skip the position, or a nested "(…)" pattern. To match against a value, use a "match" expression`;
    case 'default-value-invalid':
      return `Invalid default value: ${args[0]}`;
    case 'pattern-element-annotation':
      return `A destructuring pattern position binds a name and states no type; drop the annotation (write "((p, q)) => …") or take the tuple as one named parameter and unpack it in the body`;
    case 'range-pattern-bounds':
      return `Range pattern bounds must be numeric literals; use a guard (e.g. "n if n >= lo && n <= hi => …") to test against a computed bound`;
    case 'range-pattern-step':
      return `A stepped range is not a pattern; write "lo..hi" (two numeric bounds), or use a guard`;
    case 'match-not-exhaustive':
      return `The "match" on a "${args[0]}" value has no case for ${args[1]}; add a case for each, or a final "_" case`;
    case 'equation-not-assignment':
      return `"${args[0]}" here is an equation, not an assignment, and nothing reads its value; write "do { ${args[0]} }" to assign (a function that writes a variable outside itself also declares the "scope" effect), or "==" to compare`;
    case 'range-pattern-empty':
      return `Range pattern "${args[0]}..${args[1]}" is empty (the lower bound is greater than the upper bound); this case can never match`;
    case 'floor-division-comment':
      return `"//" starts a comment, not floor division; use Floor(a / b) for the integer quotient`;
    case 'runtime-error':
      // `%1` (the breadcrumb frame chain, engine design §2a) is deliberately
      // not rendered: the caret already points at the innermost source-mapped
      // frame. It stays in the diagnostic data for machine consumers.
      return `Runtime error: ${args[0]}`;
    case 'static-type-error': {
      // The canonicalization walk collects more than type errors (`missing`,
      // `unexpected-argument`, …), so the label follows the error code
      // (`args[2]`) instead of claiming "Type error" for all of them. The
      // diagnostic *code* stays `static-type-error` for consumer stability.
      const label =
        args[2] === 'incompatible-type' ? 'Type error' : 'Static error';
      return args[1]
        ? `${label}: ${args[0]} in \`${args[1]}\``
        : `${label}: ${args[0]}`;
    }
    case 'evaluation-canceled':
      return `Evaluation canceled (${args[0]}): ${args[1]}`;
    case 'host-pragma-disabled':
      return `Host pragma "${args[0]}" is disabled`;
    case 'closing-bracket-expected':
      return `Expected closing bracket "${args[0]}"`;
    case 'string-literal-closing-delimiter-expected':
      return `Expected closing string delimiter ${JSON.stringify(args[0])}`;
    case 'match-case-separator':
      return `Match cases are separated by a newline or ";", not a comma`;
    case 'if-let-equal-expected':
      return `Expected "=" after the "if let" pattern, followed by the value to match`;
    case 'if-let-irrefutable':
      return `The pattern "${args[0]}" matches every value, so this "if let" cannot fail (an "else" branch would never run); use "let" to bind unconditionally`;
    case 'while-let-equal-expected':
      return `Expected "=" after the "while let" pattern, followed by the value to match`;
    case 'while-let-irrefutable':
      return `The pattern "${args[0]}" matches every value, so this "while let" can only end on a "break" in its body; write "while true" with a "let" in the body instead`;
    case 'conditional-if-line-start':
      return `An "if" at the start of a line begins a new if-statement; for a conditional expression ("a if c else b"), keep "if" on the same line as the value before it`;
    case 'mapsto-arrow-expected':
      // With arguments, the static checker found a rule (`x -> x^2`) passed
      // at a function parameter of a call: the callee and the 1-based
      // argument position. Without them, the parser found a pair whose left
      // side is shaped like a parameter list.
      if (args.length >= 2)
        return `"->" builds a key-value pair, but argument ${args[1]} of "${args[0]}" must be a function; to write a function, use the mapsto arrow "=>"`;
      return `"->" pairs a key with a value (and the key must be a string); to write a function, use the mapsto arrow "=>"`;
    case 'mapsto-arrow-legacy':
      return `"|->" is the old spelling of the mapsto arrow; write "=>"`;
    case 'parameter-name-mismatch':
      return `The parameter is named "${args[0]}" in the lambda but "${args[1]}" in the type annotation; a parameter name binds wherever it is written, so the two must agree — rename one side, or leave the annotation's parameters unnamed`;
    case 'unexpected-symbol':
      return `Unexpected symbol "${args[0]}"`;
    case 'type-annotation-error':
      // The argument is the sentence of the type parser.
      if (typeof args[0] === 'string' && args[0] !== '') return args[0];
      return 'Invalid type annotation';
    default: {
      const description = String(code).replaceAll('-', ' ');
      return args.length === 0
        ? description
        : `${description}: ${args.map(String).join(', ')}`;
    }
  }
}
