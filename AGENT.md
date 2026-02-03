# AGENT.md

Guidance for coding agents working in this repository. Derived from `CLAUDE.md`.

## Common Development Commands

### Building

- `npm run build` - Development build in `/build`
- `npm run build watch` - Development build with file watching
- `npm run build production` - Production build in `/dist`
- `npm run clean` - Remove `/build` and `/dist`
- `npm run typecheck` - Run TypeScript type checking (always when completing a task)

### Testing

- `npm run test` - Requires a specific test suite to be specified
- `npm run test compute-engine/<test-name>` - Run specific test file (e.g., `npm run test compute-engine/arithmetic`)
- `npm run test snapshot` - Update test snapshots
- `npm test` - Alias for `npm run test`

### Development

- `npm start` - Development build with watch and local server
- `npm run lint` - Run ESLint with auto-fix
- `npm run doc` - Generate documentation

### Test File Patterns

- Tests live under `/test/`
- Pattern: `npm run test compute-engine/<test-name>` maps to `/test/compute-engine/<test-name>.test.ts`

## Architecture Overview

### Core Components

- `src/compute-engine/index.ts` - ComputeEngine: parsing, evaluation, manipulation, scopes, precision, validation
- `src/compute-engine/boxed-expression/` - Boxed expression types
  - `BoxedExpression`, `BoxedNumber`, `BoxedSymbol`, `BoxedFunction`, `BoxedString`
- `src/common/type/` - Type system with inference and subtype checking
- `src/compute-engine/latex-syntax/` - LaTeX parsing to MathJSON
- `src/math-json/` - MathJSON structures and utilities

### Key Architecture Patterns

- Boxing system: expressions are boxed with consistent interfaces
- Canonical forms: normalized representation for efficiency
- Scoped evaluation: symbol definitions and assumptions in lexical scopes
- Library system: domain-specific math libraries loaded selectively
- Validation modes: `strict` (default) vs non-strict
- Numeric precision: machine (64-bit) and arbitrary precision (Decimal.js)

## Expression Creation Modes

### Canonical vs Structural vs Non-Canonical

1. **Canonical** (`{ canonical: true }` or default)
   - Fully canonicalized, `bind()` is called, `isCanonical` true
2. **Structural** (`{ structural: true }`)
   - Bound, only structural normalization, `isStructural` true
   - Use to avoid specific canonical transforms (e.g., keep `Power(x, 1/3)`)
3. **Non-canonical** (`{ canonical: false }` without `structural`)
   - Not bound, not canonical/structural
   - **Cannot be used** in arithmetic operations (`.mul()`, `.add()`, etc.)

**Pitfall**: `ce._fn('Power', ..., { canonical: false }).mul(...)` will assert.
Use structural mode instead:
```ts
ce.function('Power', [base, exp], { structural: true }).mul(other)
```
Note: `ce._fn()` does not support `structural`.

## Simplification and Recursion Prevention

**Critical**: Do not call `.simplify()` inside simplification rules or functions
used by them. This can cause infinite recursion.

### Do not call `.simplify()` in:
- `src/compute-engine/symbolic/simplify-rules.ts`
- Polynomial helpers called by rules (e.g., `polynomialDivide`, `polynomialGCD`, `cancelCommonFactors`)
- Any function in the simplification pipeline

### Safe to call `.simplify()` in:
- Top-level APIs
- Tests
- Evaluation contexts
- On simple numeric coefficients (with care)

### Best practice
Return canonical expressions and let callers decide whether to simplify.

### Recursion Guards (do not rely on these if you recurse)
- Expression deduplication in `simplify.ts`
- Step limit guard (max 1000 steps)
- Loop detection in main simplify loop

## Expression Lifecycle

1. Parse (LaTeX → MathJSON → BoxedExpression)
2. Canonicalize
3. Evaluate
4. Simplify
5. Serialize (LaTeX/MathJSON)

## Important Files

- Core engine: `src/compute-engine/index.ts`
- Base expression: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`
- Arithmetic: `src/compute-engine/boxed-expression/arithmetic-*.ts`
- Validation: `src/compute-engine/boxed-expression/validate.ts`
- Libraries: `src/compute-engine/library/`
- Type system: `src/common/type/`
- Test helpers: `test/utils.ts`
- Generated: `API.md` (do not edit manually)

## Circular Dependency Resolution

Common problematic chain:
```
abstract-boxed-expression.ts → compile.ts → library/utils.ts → collections.ts → box.ts → abstract-boxed-expression.ts
```

Resolution strategy:
- Extract shared utilities (e.g., `canonical-utils.ts`)
- Prefer static imports after breaking cycles
- Verify via:
```bash
npx tsx -e "import {ComputeEngine} from './src/compute-engine'; new ComputeEngine()"
```

Warning signs:
- `ReferenceError: Cannot access '_BoxedExpression' before initialization`
- Build failures with circular dependency warnings
- ESLint: `Dependency cycle detected`
