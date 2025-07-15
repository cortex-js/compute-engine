# Copilot Instructions for Compute Engine

Welcome to the Compute Engine codebase! This guide is for AI coding agents to
quickly become productive and aligned with project conventions.

## Architecture Overview

- **Core Structure:** The engine is organized around _boxed expressions_
  (`BoxedExpression`), which abstract mathematical objects (numbers, symbols,
  functions, tensors, collections, etc.) and their manipulation.
- **Major Components:**
  - `/src/compute-engine/boxed-expression/`: Core types and implementations for
    boxed expressions (e.g., `abstract-boxed-expression.ts`,
    `boxed-function.ts`, `boxed-string.ts`).
  - `/src/compute-engine/library/`: Symbol/operator definitions for mathematical
    collections, sets, and functions (`collections.ts`, `sets.ts`).
  - `/src/compute-engine/latex-syntax/dictionary/`: LaTeX parsing and
    serialization logic (`definitions-core.ts`).
  - `/src/compute-engine/global-types.ts`: Central type definitions, including
    generics for tensors, boxed types, and operator signatures.
- **Data Flow:** Expressions are parsed, boxed, and manipulated via engine APIs.
  Collections and sets are handled via operator definitions and iterators.

## Key Patterns & Conventions

- **BoxedExpression Interface:** All mathematical objects implement this
  interface. Use `isSame`, `isEqual`, `isLess`, etc. for comparisons. Properties
  like `symbol`, `tensor`, `string` are often `null` unless overridden.
- **TypeScript Generics:** Tensor types require explicit type arguments (e.g.,
  `Tensor<'float64'>`). Avoid using `unknown` as a generic argument for
  constrained types.
- **Iterators vs. Iterables:** When using `Array.from()`, ensure you pass an
  iterable (object with `[Symbol.iterator]()`), not just an iterator (`next()`
  method).
- **Operator Definitions:** Mathematical operations and collections are defined
  as objects with `type`, `canonical`, `evaluate`, and `collection` handlers.
  See `COLLECTIONS_LIBRARY` and `SETS_LIBRARY`.
- **LaTeX Parsing:** Parsing functions (e.g., `parseTextRun`, `parseBrackets`,
  `parseRange`) handle LaTeX tokens and convert them to boxed expressions.
  Serialization functions convert boxed expressions back to LaTeX.
- **Error Handling:** Use `'Error'` boxed expressions for parse or evaluation
  errors. See `errorContextAsLatex()` for serialization.

## Developer Workflows

- **Build:** Standard TypeScript build (`tsc`). No custom build scripts
  detected.
- **Test:** Unit tests are likely present in `/test` or similar. Use `npm test`
  or `yarn test` if available.
- **Debug:** Use VS Code's debugging tools. Place breakpoints in boxed
  expression implementations or operator definitions for core logic.
- **Formatting:** Use VS Code's format command (`Shift+Option+F` on Mac) to
  reveal syntax issues, especially unbalanced braces.

## Integration Points

- **External Dependencies:** Minimal; most logic is custom. Some math and LaTeX
  utilities are imported from sibling modules.
- **Cross-Component Communication:** Boxed expressions and operator definitions
  communicate via engine APIs and shared types.

## Project-Specific Advice

- **Always provide explicit type arguments for generics.** Example:
  `get tensor(): null | Tensor<'float64'> { ... }`
- **Check for unbalanced braces in large object definitions.** Use VS Code
  folding and formatting to spot issues.
- **When extending collections or sets, follow the pattern in
  `COLLECTIONS_LIBRARY` and `SETS_LIBRARY`.**
- **For LaTeX parsing, ensure new triggers and handlers are registered in
  `DEFINITIONS_CORE`.**

## Key Files

- `/src/compute-engine/boxed-expression/abstract-boxed-expression.ts`
- `/src/compute-engine/boxed-expression/boxed-function.ts`
- `/src/compute-engine/boxed-expression/boxed-string.ts`
- `/src/compute-engine/global-types.ts`
- `/src/compute-engine/library/collections.ts`
- `/src/compute-engine/latex-syntax/dictionary/definitions-core.ts`

---

**Feedback Requested:**  
If any section is unclear or missing important project-specific details, please
let us know so we can refine
