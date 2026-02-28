# Package Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Split the monolithic `@cortex-js/compute-engine` into seven
independently importable sub-paths with clean module boundaries.

**Architecture:** Create new source entry points (`src/latex-syntax.ts`,
`src/interval.ts`, `src/numerics.ts`, `src/core.ts`, `src/compile.ts`) alongside
the existing `src/compute-engine.ts` and `src/math-json.ts`. Decouple LaTeX
dictionaries from library definitions. Remove LaTeX/compile methods from
ComputeEngine and BoxedExpression. Rename `box()` → `expr()`. Add build
configuration for all new entry points.

**Tech Stack:** TypeScript, esbuild, Jest

**Design doc:** `docs/plans/2026-02-27-modularization-design.md`

---

## Phase 1: Build Infrastructure

### Task 1: Create entry point source files

Create empty/minimal entry point files for each new sub-path.

**Files:**

- Create: `src/latex-syntax.ts`
- Create: `src/interval.ts`
- Create: `src/numerics.ts`
- Create: `src/core.ts`
- Create: `src/compile.ts`

**Step 1: Create `src/interval.ts`**

```ts
// Interval arithmetic — standalone, no engine dependency
export type { Interval, IntervalResult, BoolInterval } from './compute-engine/interval/types';
export {
  ok, point, containsExtremum, unionResults, mergeDomainClip,
  isPoint, containsZero, isPositive, isNegative, isNonNegative, isNonPositive,
  width, midpoint, getValue, unwrap, unwrapOrPropagate,
  add, sub, mul, div, negate,
  sqrt, square, pow, powInterval, exp, ln, log10, log2,
  abs, floor, ceil, round, fract, trunc, min, max, mod, remainder,
  heaviside, sign, gamma, gammaln, factorial, factorial2, binomial,
  gcd, lcm, chop, erf, erfc, exp2, hypot,
  sin, cos, tan, cot, sec, csc, asin, acos, atan, atan2,
  sinh, cosh, tanh, asinh, acosh, atanh,
  acot, acsc, asec, coth, csch, sech, acoth, acsch, asech, sinc,
  fresnelS, fresnelC,
  less, lessEqual, greater, greaterEqual, equal, notEqual,
  and, or, not, piecewise, clamp,
  IntervalArithmetic,
} from './compute-engine/interval/index';

export const version = '{{SDK_VERSION}}';
```

**Step 2: Create `src/numerics.ts`**

This requires auditing the exact exports of `src/compute-engine/numerics/` files.
Export all public numeric functions. Start with a barrel that re-exports from the
numerics and numeric-value subdirectories:

```ts
// Standalone numeric functions — no engine, no expressions
export * from './compute-engine/numerics/special-functions';
export * from './compute-engine/numerics/primes';
export * from './compute-engine/numerics/statistics';
export * from './compute-engine/numerics/rationals';
export * from './compute-engine/numerics/numeric-bigint';
export * from './compute-engine/numerics/numeric-bignum';
export * from './compute-engine/numerics/numeric-complex';
export * from './compute-engine/numerics/numeric';
export * from './compute-engine/numerics/linear-algebra';
export * from './compute-engine/numerics/monte-carlo';
export * from './compute-engine/numerics/richardson';
export * from './compute-engine/numeric-value/exact-numeric-value';
export * from './compute-engine/numeric-value/machine-numeric-value';
export * from './compute-engine/numeric-value/big-numeric-value';
export type * from './compute-engine/numerics/types';
export type * from './compute-engine/numeric-value/types';

export const version = '{{SDK_VERSION}}';
```

Note: The exact exports will need auditing — some internal functions may not be
suitable for public API. Start broad, then prune.

**Step 3: Create `src/latex-syntax.ts` (stub)**

```ts
// LaTeX ↔ MathJSON — standalone, no engine dependency
// Full implementation in Task 4+
export const version = '{{SDK_VERSION}}';
```

**Step 4: Create `src/core.ts` (stub)**

```ts
// Compute engine core — no LaTeX, no compilation
// Full implementation after Phase 3
export const version = '{{SDK_VERSION}}';
```

**Step 5: Create `src/compile.ts` (stub)**

```ts
// Compilation targets — depends on core
// Full implementation after Phase 4
export const version = '{{SDK_VERSION}}';
```

**Step 6: Verify stubs compile**

Run: `npx tsc --noEmit src/interval.ts src/numerics.ts`

---

### Task 2: Add new entry points to build system

**Files:**

- Modify: `scripts/build.mjs`
- Modify: `scripts/build.sh` (lines 49-50, after line 89)
- Modify: `package.json` (exports field, lines 45-58)

**Step 1: Add UMD wrappers to `build.mjs`**

After line 34 (after `MATH_JSON_UMD_OPTIONS`), add UMD wrappers for each new
module: `LATEX_SYNTAX_UMD_OPTIONS`, `INTERVAL_UMD_OPTIONS`,
`NUMERICS_UMD_OPTIONS`, `CORE_UMD_OPTIONS`, `COMPILE_UMD_OPTIONS`. Follow the
exact pattern of `MATH_JSON_UMD_OPTIONS`, changing the global name.

**Step 2: Add esbuild configs to `build.mjs`**

For each new entry point, add 4 configs to the `Promise.all([])` (lines 59-137):
non-minified ESM, non-minified UMD, minified ESM, minified UMD. Follow the exact
pattern of the existing math-json entries.

Entry points:

- `./src/latex-syntax.ts` → `./dist/latex-syntax.*`
- `./src/interval.ts` → `./dist/interval.*`
- `./src/numerics.ts` → `./dist/numerics.*`
- `./src/core.ts` → `./dist/core.*`
- `./src/compile.ts` → `./dist/compile.*`

**Step 3: Add to `build.sh` TARGETS**

Line 50:
```bash
export TARGETS="math-json latex-syntax interval numerics core compile compute-engine"
```

After line 89, add tsc declaration generation for each new target:
```bash
if [[ "$TARGETS" == *latex-syntax* ]]; then
  npx tsc --target "es2022" -d --moduleResolution "node" --allowImportingTsExtensions "true" \
    --emitDeclarationOnly --outDir ./dist/types ./src/latex-syntax.ts
fi
if [[ "$TARGETS" == *interval* ]]; then
  npx tsc --target "es2022" -d --moduleResolution "node" --allowImportingTsExtensions "true" \
    --emitDeclarationOnly --outDir ./dist/types ./src/interval.ts
fi
if [[ "$TARGETS" == *numerics* ]]; then
  npx tsc --target "es2022" -d --moduleResolution "node" --allowImportingTsExtensions "true" \
    --emitDeclarationOnly --outDir ./dist/types ./src/numerics.ts
fi
if [[ "$TARGETS" == *core* ]]; then
  npx tsc --target "es2022" -d --moduleResolution "node" --allowImportingTsExtensions "true" \
    --emitDeclarationOnly --outDir ./dist/types ./src/core.ts
fi
if [[ "$TARGETS" == *compile* ]]; then
  npx tsc --target "es2022" -d --moduleResolution "node" --allowImportingTsExtensions "true" \
    --emitDeclarationOnly --outDir ./dist/types ./src/compile.ts
fi
```

**Step 4: Add exports to `package.json`**

Add to the `exports` field:
```json
"./latex-syntax": {
  "types": "./dist/types/latex-syntax.d.ts",
  "import": "./dist/latex-syntax.min.esm.js",
  "require": "./dist/latex-syntax.min.umd.cjs",
  "default": "./dist/latex-syntax.min.esm.js"
},
"./interval": {
  "types": "./dist/types/interval.d.ts",
  "import": "./dist/interval.min.esm.js",
  "require": "./dist/interval.min.umd.cjs",
  "default": "./dist/interval.min.esm.js"
},
"./numerics": {
  "types": "./dist/types/numerics.d.ts",
  "import": "./dist/numerics.min.esm.js",
  "require": "./dist/numerics.min.umd.cjs",
  "default": "./dist/numerics.min.esm.js"
},
"./core": {
  "types": "./dist/types/core.d.ts",
  "import": "./dist/core.min.esm.js",
  "require": "./dist/core.min.umd.cjs",
  "default": "./dist/core.min.esm.js"
},
"./compile": {
  "types": "./dist/types/compile.d.ts",
  "import": "./dist/compile.min.esm.js",
  "require": "./dist/compile.min.umd.cjs",
  "default": "./dist/compile.min.esm.js"
}
```

**Step 5: Test the build**

Run: `npm run build`
Expected: All entry points build without errors. Verify with `ls -lh dist/*.esm.js`.

**Step 6: Commit**

---

## Phase 2: Extract latex-syntax as Standalone Module

### Task 3: Decouple LaTeX dictionaries from library definitions

The dictionaries in `src/compute-engine/latex-syntax/dictionary/definitions-*.ts`
are currently bundled into `STANDARD_LIBRARIES` via the `latexDictionary` field
on `LibraryDefinition`. We need to make them independently importable.

**Files:**

- Modify: `src/compute-engine/types-definitions.ts` (line ~604: remove
  `latexDictionary` from `LibraryDefinition`)
- Modify: `src/compute-engine/library/library.ts` (remove `latexDictionary`
  entries from all STANDARD_LIBRARIES items)
- Modify: `src/compute-engine/engine-library-bootstrap.ts` (remove
  `collectLibraryLatexEntries`, update `bootstrapLibraries` in
  `engine-startup-coordinator.ts`)
- Modify: `src/compute-engine/engine-startup-coordinator.ts` (line ~74: change
  how LaTeX dictionary is initialized)
- Create:
  `src/compute-engine/latex-syntax/dictionary/default-dictionary.ts` — new file
  that assembles the full default dictionary from all domain files

**Step 1: Create the default dictionary assembly file**

Create
`src/compute-engine/latex-syntax/dictionary/default-dictionary.ts`:

```ts
import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_LOGIC } from './definitions-logic';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_COMPLEX } from './definitions-complex';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_LINEAR_ALGEBRA } from './definitions-linear-algebra';
import { DEFINITIONS_STATISTICS } from './definitions-statistics';
import { DEFINITIONS_UNITS } from './definitions-units';
import { DEFINITIONS_OTHERS } from './definitions-other';
import type { LatexDictionaryEntry } from '../types';

// Individual domain dictionaries (for selective imports)
export {
  DEFINITIONS_CORE, DEFINITIONS_SYMBOLS, DEFINITIONS_ALGEBRA,
  DEFINITIONS_LOGIC, DEFINITIONS_SETS, DEFINITIONS_INEQUALITIES,
  DEFINITIONS_ARITHMETIC, DEFINITIONS_COMPLEX, DEFINITIONS_TRIGONOMETRY,
  DEFINITIONS_CALCULUS, DEFINITIONS_LINEAR_ALGEBRA, DEFINITIONS_STATISTICS,
  DEFINITIONS_UNITS, DEFINITIONS_OTHERS,
};

// Rename exports for public API
export {
  DEFINITIONS_CORE as CORE_DICTIONARY,
  DEFINITIONS_SYMBOLS as SYMBOLS_DICTIONARY,
  DEFINITIONS_ALGEBRA as ALGEBRA_DICTIONARY,
  DEFINITIONS_LOGIC as LOGIC_DICTIONARY,
  DEFINITIONS_SETS as SETS_DICTIONARY,
  DEFINITIONS_INEQUALITIES as RELATIONAL_DICTIONARY,
  DEFINITIONS_ARITHMETIC as ARITHMETIC_DICTIONARY,
  DEFINITIONS_COMPLEX as COMPLEX_DICTIONARY,
  DEFINITIONS_TRIGONOMETRY as TRIGONOMETRY_DICTIONARY,
  DEFINITIONS_CALCULUS as CALCULUS_DICTIONARY,
  DEFINITIONS_LINEAR_ALGEBRA as LINEAR_ALGEBRA_DICTIONARY,
  DEFINITIONS_STATISTICS as STATISTICS_DICTIONARY,
  DEFINITIONS_UNITS as UNITS_DICTIONARY,
  DEFINITIONS_OTHERS as OTHER_DICTIONARY,
};

// Full default dictionary (all domains combined)
export const LATEX_DICTIONARY: Readonly<Partial<LatexDictionaryEntry>[]> = [
  ...DEFINITIONS_CORE,
  ...DEFINITIONS_SYMBOLS,
  ...DEFINITIONS_ALGEBRA,
  ...DEFINITIONS_LOGIC,
  ...DEFINITIONS_SETS,
  ...DEFINITIONS_INEQUALITIES,
  ...DEFINITIONS_ARITHMETIC,
  ...DEFINITIONS_COMPLEX,
  ...DEFINITIONS_TRIGONOMETRY,
  ...DEFINITIONS_CALCULUS,
  ...DEFINITIONS_LINEAR_ALGEBRA,
  ...DEFINITIONS_STATISTICS,
  ...DEFINITIONS_UNITS,
  ...DEFINITIONS_OTHERS,
];
```

**Step 2: Remove `latexDictionary` from `LibraryDefinition`**

In `src/compute-engine/types-definitions.ts`, remove the `latexDictionary` field
from the `LibraryDefinition` interface.

**Step 3: Remove `latexDictionary` from all STANDARD_LIBRARIES entries**

In `src/compute-engine/library/library.ts`, remove every `latexDictionary: [...]`
line from the STANDARD_LIBRARIES array. Also remove the now-unused imports of
`DEFINITIONS_*` from `../latex-syntax/dictionary/definitions-*`.

Note: The `physics` library (lines 150-305) has 2 inline LaTeX entries for Mu0
and VacuumPermittivity. Move these to a new `PHYSICS_DICTIONARY` constant in
`default-dictionary.ts` and include in `LATEX_DICTIONARY`.

**Step 4: Update engine bootstrap**

In `src/compute-engine/engine-library-bootstrap.ts`:

- Remove `collectLibraryLatexEntries()` function (lines 51-60)
- Remove `getLatexDictionaryForDomain()` function (lines 62-71) — this moves to
  the new default-dictionary.ts

In `src/compute-engine/engine-startup-coordinator.ts`:

- Remove the lines that collect and set LaTeX entries (lines 74-75):
  ```ts
  const latexEntries = collectLibraryLatexEntries(resolved);
  if (latexEntries.length > 0) this.engine.latexDictionary = latexEntries;
  ```
- Instead, the engine's `EngineLatexDictionaryState` default provider should
  import `LATEX_DICTIONARY` from the new default-dictionary.ts.

In `src/compute-engine/index.ts`:

- Update `_latexDictionaryState` default provider (line ~465-467) to use
  `LATEX_DICTIONARY` from the new file
- Remove `static getLatexDictionary()` method (lines ~507-511)

**Step 5: Run typecheck and tests**

Run: `npm run typecheck`
Run: `npm run test compute-engine/latex-syntax`
Run: `npm run test compute-engine/parse`

---

### Task 4: Create LatexSyntax class and free functions

**Files:**

- Create: `src/compute-engine/latex-syntax/latex-syntax.ts`
- Modify: `src/latex-syntax.ts` (fill in real exports)

**Step 1: Create the LatexSyntax class**

Create `src/compute-engine/latex-syntax/latex-syntax.ts`:

```ts
import type { MathJsonExpression } from '../../math-json/types';
import type { LatexDictionaryEntry, ParseLatexOptions, SerializeLatexOptions } from './types';
import { LATEX_DICTIONARY } from './dictionary/default-dictionary';
import { indexLatexDictionary } from './dictionary/definitions';
import type { IndexedLatexDictionary } from './dictionary/indexed-types';
import { parse as parseImpl } from './parse';
import { serializeLatex as serializeImpl } from './serializer';

export interface LatexSyntaxOptions {
  dictionary?: Readonly<Partial<LatexDictionaryEntry>[]>[];
  decimalSeparator?: string;
  // Additional parse/serialize options as needed
}

export class LatexSyntax {
  private _options: LatexSyntaxOptions;
  private _indexed: IndexedLatexDictionary | undefined;

  constructor(options?: LatexSyntaxOptions) {
    this._options = options ?? {};
  }

  private get indexed(): IndexedLatexDictionary {
    if (!this._indexed) {
      const dict = this._options.dictionary
        ? this._options.dictionary.flat()
        : LATEX_DICTIONARY;
      this._indexed = indexLatexDictionary(
        dict as LatexDictionaryEntry[],
        (signal) => console.error(signal)
      );
    }
    return this._indexed;
  }

  parse(latex: string, options?: Partial<ParseLatexOptions>): MathJsonExpression | null {
    return parseImpl(latex, this.indexed, {
      ...this._buildParseOptions(),
      ...options,
    });
  }

  serialize(expr: MathJsonExpression, options?: Partial<SerializeLatexOptions>): string {
    return serializeImpl(expr, this.indexed, {
      ...this._buildSerializeOptions(),
      ...options,
    });
  }

  private _buildParseOptions(): ParseLatexOptions {
    // Build default parse options using this._options
    // This needs to match the defaults currently in engine-parse-entrypoint.ts
    return {
      decimalSeparator: this._options.decimalSeparator ?? '.',
      // ... other defaults
    } as ParseLatexOptions;
  }

  private _buildSerializeOptions(): SerializeLatexOptions {
    return {
      decimalSeparator: this._options.decimalSeparator ?? '.',
      fractionalDigits: 'max' as const,
      // ... other defaults
    } as SerializeLatexOptions;
  }
}
```

Note: The exact set of default options will need to be extracted from
`engine-parse-entrypoint.ts` (lines 38-87) and
`abstract-boxed-expression.ts:toLatex()` (lines 223-314). The key insight is
that these are all simple config values — no engine state is needed.

**Step 2: Add lazy singleton free functions**

At the bottom of the same file or in a separate file:

```ts
let _defaultSyntax: LatexSyntax | null = null;

function getDefaultSyntax(): LatexSyntax {
  _defaultSyntax ??= new LatexSyntax();
  return _defaultSyntax;
}

export function parse(latex: string): MathJsonExpression | null {
  return getDefaultSyntax().parse(latex);
}

export function serialize(expr: MathJsonExpression): string {
  return getDefaultSyntax().serialize(expr);
}
```

**Step 3: Fill in `src/latex-syntax.ts`**

```ts
export { LatexSyntax, parse, serialize } from './compute-engine/latex-syntax/latex-syntax';
export {
  LATEX_DICTIONARY,
  CORE_DICTIONARY, SYMBOLS_DICTIONARY, ALGEBRA_DICTIONARY,
  ARITHMETIC_DICTIONARY, COMPLEX_DICTIONARY, TRIGONOMETRY_DICTIONARY,
  CALCULUS_DICTIONARY, LINEAR_ALGEBRA_DICTIONARY, STATISTICS_DICTIONARY,
  LOGIC_DICTIONARY, SETS_DICTIONARY, RELATIONAL_DICTIONARY,
  UNITS_DICTIONARY, OTHER_DICTIONARY,
} from './compute-engine/latex-syntax/dictionary/default-dictionary';
export type {
  LatexDictionaryEntry, SerializeLatexOptions, ParseLatexOptions, LatexString,
} from './compute-engine/latex-syntax/types';
export type { MathJsonExpression } from './math-json/types';
export const version = '{{SDK_VERSION}}';
```

**Step 4: Write tests for standalone latex-syntax**

Create `test/compute-engine/latex-syntax-standalone.test.ts`:

```ts
import { parse, serialize, LatexSyntax, ARITHMETIC_DICTIONARY, CORE_DICTIONARY }
  from '../../src/latex-syntax';

describe('standalone parse', () => {
  test('basic expression', () => {
    expect(parse('x + 1')).toEqual(['Add', 'x', 1]);
  });
  test('fraction', () => {
    expect(parse('\\frac{x}{2}')).toEqual(['Divide', 'x', 2]);
  });
});

describe('standalone serialize', () => {
  test('basic expression', () => {
    const result = serialize(['Add', 'x', 1]);
    expect(result).toContain('x');
    expect(result).toContain('+');
    expect(result).toContain('1');
  });
});

describe('custom LatexSyntax instance', () => {
  test('selective dictionary', () => {
    const syntax = new LatexSyntax({
      dictionary: [CORE_DICTIONARY, ARITHMETIC_DICTIONARY],
    });
    expect(syntax.parse('x + 1')).toEqual(['Add', 'x', 1]);
  });
});
```

**Step 5: Run tests**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax-standalone.test.ts`

**Step 6: Build and verify bundle size**

Run: `npm run build`
Run: `ls -lh dist/latex-syntax.min.esm.js`
Expected: ~100-150 KB (significantly smaller than the 1 MB monolith)

**Step 7: Commit**

---

## Phase 3: API Changes on ComputeEngine and BoxedExpression

### Task 5: Rename `box()` → `expr()` everywhere

**Files:**

- Modify: `src/compute-engine/index.ts` (line ~1494: rename `box()` method to
  `expr()`)
- Modify: `src/compute-engine/types-engine.ts` (line ~171: rename in interface)
- Modify: `src/compute-engine/engine-validation-entrypoints.ts` (line ~15:
  rename in interface)
- Modify: `src/compute-engine/free-functions.ts` (line ~52: rename free
  function)
- Modify: All internal callers of `ce.box()` across the codebase

**Step 1: Rename in the interfaces/types**

Update `IComputeEngine` interface in `types-engine.ts` and
`engine-validation-entrypoints.ts`: rename `box(` to `expr(`.

**Step 2: Rename the method in `index.ts`**

Line ~1494: `box(` → `expr(`.

**Step 3: Rename the free function in `free-functions.ts`**

Line ~52: `export function box(` → `export function expr(`.

**Step 4: Update all internal callers**

Search for `ce.box(` and `.box(` across the codebase and rename to `.expr(`.
Also search for `this.engine.box(` and rename to `this.engine.expr(`.

Note: The internal `box()` function in `boxed-expression/box.ts` is a different
function (internal boxing implementation) — do NOT rename that one. Only rename
the public API method on `ComputeEngine` and the free function.

Use: `ast-grep --pattern 'ce.box($$$)' --rewrite 'ce.expr($$$)' --lang ts`
or manual search-and-replace with careful review.

**Step 5: Update exports in `src/compute-engine.ts`**

Ensure `expr` (not `box`) is exported from the free functions.

**Step 6: Run typecheck and tests**

Run: `npm run typecheck`
Run: `npm run test compute-engine/arithmetic`
Run: `npm run test compute-engine/simplify`

**Step 7: Commit**

---

### Task 6: Remove LaTeX methods from ComputeEngine and BoxedExpression

**Files:**

- Modify: `src/compute-engine/index.ts` — remove `parse()`, `latexDictionary`
  get/set, `decimalSeparator`, `_indexedLatexDictionary` getter, `static
  getLatexDictionary()`
- Modify: `src/compute-engine/types-engine.ts` — remove corresponding interface
  members
- Modify: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` —
  remove `toLatex()`, `latex` getter
- Modify: `src/compute-engine/engine-parse-entrypoint.ts` — remove or repurpose
  (this entire file may become dead code)
- Modify: `src/compute-engine/engine-latex-dictionary-state.ts` — may become
  dead code in core, but still used by the full package's lazy singleton

**Step 1: Remove from BoxedExpression**

In `abstract-boxed-expression.ts`:

- Remove `toLatex()` method (lines ~223-314)
- Remove `latex` getter
- Remove imports from `../latex-syntax/serializer` and
  `../latex-syntax/serializer-style`

**Step 2: Remove from ComputeEngine**

In `index.ts`:

- Remove `parse()` method overloads
- Remove `latexDictionary` getter/setter
- Remove `decimalSeparator` property
- Remove `_indexedLatexDictionary` getter
- Remove `_latexDictionaryState` field
- Remove `static getLatexDictionary()` method
- Remove import of `EngineLatexDictionaryState`
- Remove import of `engine-parse-entrypoint`

In `types-engine.ts`:

- Remove `parse()` from the `IComputeEngine` interface
- Remove `latexDictionary` property
- Remove `decimalSeparator` property
- Remove `_indexedLatexDictionary` property

**Step 3: Remove engine-parse-entrypoint.ts**

This file's sole purpose is `ce.parse()`. Delete it.

**Step 4: Update tests**

Many existing tests use `ce.parse()` and `expr.toLatex()`. These need updating:

```ts
// Before
const expr = ce.parse('x + 1');
expect(expr.toLatex()).toBe('x + 1');

// After
import { parse, serialize } from '../../src/latex-syntax';
const expr = ce.expr(parse('x + 1'));
expect(serialize(expr.json)).toBe('x + 1');
```

This is the highest-effort step. Use search-and-replace to update test files.
The pattern is mechanical:

- `ce.parse('...')` → `ce.expr(parse('...'))`
- `expr.latex` / `expr.toLatex()` → `serialize(expr.json)`
- Add `import { parse, serialize } from '../../src/latex-syntax';` to each test
  file

**Step 5: Run typecheck and full test suite**

Run: `npm run typecheck`
Run: `npm run test compute-engine/arithmetic`
Run: `npm run test compute-engine/simplify`
Run: `npm run test compute-engine/parse`

**Step 6: Commit**

---

### Task 7: Remove compilation methods from ComputeEngine and BoxedExpression

**Files:**

- Modify: `src/compute-engine/index.ts` — remove `registerCompilationTarget()`,
  `getCompilationTarget()`, `listCompilationTargets()`,
  `unregisterCompilationTarget()`, `_compile()`
- Modify: `src/compute-engine/types-engine.ts` — remove from interface
- Modify: `src/compute-engine/engine-compilation-targets.ts` — may become
  internal to compile module
- Modify: `src/compute-engine/free-functions.ts` — remove `compile()` free
  function (moves to compile module)

**Step 1: Remove from ComputeEngine class**

In `index.ts`, remove:

- `registerCompilationTarget()`, `getCompilationTarget()`,
  `listCompilationTargets()`, `unregisterCompilationTarget()`, `_compile()`
- The `CompilationTargetRegistry` field
- Imports of compilation-related code

In `types-engine.ts`, remove corresponding interface members.

**Step 2: Remove `compile()` from free-functions.ts**

Remove the `compile()` function (lines ~116-129) and its import of
`compileExpr`.

**Step 3: Update `src/compute-engine.ts` root exports**

Remove compilation target class exports and compilation type exports from the
root file. These will be re-added when the full package re-export layer is built.

**Step 4: Run typecheck**

Run: `npm run typecheck`

**Step 5: Commit**

---

## Phase 4: Create Core and Compile Entry Points

### Task 8: Fill in `src/core.ts`

**Files:**

- Modify: `src/core.ts`

**Step 1: Populate core entry point**

```ts
// Compute engine core — no LaTeX, no compilation
export { ComputeEngine } from './compute-engine/index';
export type * from './compute-engine/types';

// expr() free function backed by lazy global engine
export { expr, getDefaultEngine } from './compute-engine/free-functions';

// Type guards
export {
  isExpression, isNumber, isSymbol, isFunction, isString,
  isTensor, isDictionary, isCollection, isIndexedCollection,
  numericValue,
} from './compute-engine/boxed-expression/type-guards';

// Boxed expression types
export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string';
export type { BoxedTensor } from './compute-engine/boxed-expression/boxed-tensor';

export const version = '{{SDK_VERSION}}';
```

**Step 2: Build and verify**

Run: `npm run build`
Run: `ls -lh dist/core.min.esm.js`
Expected: ~550 KB (no latex-syntax, no compilation code)

**Step 3: Commit**

---

### Task 9: Fill in `src/compile.ts`

**Files:**

- Modify: `src/compile.ts`
- Create or modify:
  `src/compute-engine/compilation/compile-standalone.ts` — standalone
  `compile()` function that doesn't need engine registry

**Step 1: Create standalone compile function**

The current `compile()` in `compile-expression.ts` looks up targets from the
engine's registry. Create a version that resolves built-in target names
internally:

```ts
// src/compute-engine/compilation/compile-standalone.ts
import { JavaScriptTarget } from './javascript-target';
import { GLSLTarget } from './glsl-target';
import { WGSLTarget } from './wgsl-target';
import { PythonTarget } from './python-target';
import { IntervalJavaScriptTarget } from './interval-javascript-target';
import { BaseCompiler } from './base-compiler';
import type { CompilationOptions, CompilationResult } from './types';
import type { Expression } from '../types-expression';

const BUILTIN_TARGETS = {
  'javascript': () => new JavaScriptTarget(),
  'glsl': () => new GLSLTarget(),
  'wgsl': () => new WGSLTarget(),
  'python': () => new PythonTarget(),
  'interval-js': () => new IntervalJavaScriptTarget(),
};

export function compile<T extends string = 'javascript'>(
  expr: Expression,
  options?: CompilationOptions<T>
): CompilationResult<T> {
  // Resolve target from name or direct target object
  const targetName = options?.to ?? 'javascript';
  const target = options?.target
    ?? BUILTIN_TARGETS[targetName]?.().createTarget(options ?? {});

  if (!target) throw new Error(`Unknown compilation target: ${targetName}`);

  const code = BaseCompiler.compile(expr, target);
  // ... build CompilationResult
}
```

Note: The exact implementation needs to match the current `compile()` behavior
in `compile-expression.ts`. Study that file and adapt.

**Step 2: Fill in `src/compile.ts`**

```ts
export { compile } from './compute-engine/compilation/compile-standalone';
export { JavaScriptTarget } from './compute-engine/compilation/javascript-target';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target';
export { GLSLTarget } from './compute-engine/compilation/glsl-target';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target';
export { PythonTarget } from './compute-engine/compilation/python-target';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target';
export { BaseCompiler } from './compute-engine/compilation/base-compiler';
export type {
  CompileTarget, CompiledOperators, CompiledFunctions,
  CompilationOptions, CompilationResult, ExecutableTarget,
  ComplexResult, CompiledRunner, ExpressionRunner, LambdaRunner,
  LanguageTarget, TargetSource, CompiledFunction,
} from './compute-engine/compilation/types';
export const version = '{{SDK_VERSION}}';
```

**Step 3: Write tests**

Create `test/compute-engine/compile-standalone.test.ts`:

```ts
import { ComputeEngine } from '../../src/core';
import { compile, GLSLTarget } from '../../src/compile';

const ce = new ComputeEngine();

describe('standalone compile', () => {
  test('javascript target by name', () => {
    const e = ce.expr(['Power', 'x', 2]);
    const result = compile(e, { to: 'javascript' });
    expect(result.code).toBeDefined();
  });
  test('explicit target instance', () => {
    const e = ce.expr(['Add', 'x', 1]);
    const result = compile(e, { target: new GLSLTarget() });
    expect(result.code).toBeDefined();
  });
});
```

**Step 4: Build and verify**

Run: `npm run build`
Run: `ls -lh dist/compile.min.esm.js`

**Step 5: Commit**

---

## Phase 5: Full Package Entry Point

### Task 10: Build the full package with re-exports and free functions

**Files:**

- Modify: `src/compute-engine.ts` — rewrite as re-export aggregator
- Modify: `src/compute-engine/free-functions.ts` — update to accept
  `string | MathJsonExpression | Expression` uniformly

**Step 1: Update free functions to accept all input types**

In `free-functions.ts`, update the `toExpression` helper:

```ts
import { parse as parseLatex } from '../latex-syntax';

type ExprInput = string | MathJsonExpression | Expression;

function toExpression(input: ExprInput): Expression {
  if (typeof input === 'string')
    return getDefaultEngine().expr(parseLatex(input));
  if (isExpression(input)) return input;
  return getDefaultEngine().expr(input);
}
```

Update all free functions to use `ExprInput`:

```ts
export function simplify(input: ExprInput): Expression {
  return toExpression(input).simplify();
}
export function evaluate(input: ExprInput): Expression {
  return toExpression(input).evaluate();
}
// ... same for N, expand, expandAll, factor, solve
```

Add `compile` back as a free function that wraps the standalone compile:

```ts
import { compile as compileExpr } from '../compile';

export function compile(input: ExprInput, options?: CompilationOptions): CompilationResult {
  return compileExpr(toExpression(input), options);
}
```

**Step 2: Rewrite `src/compute-engine.ts`**

```ts
// Full package — re-exports everything + adds convenience free functions
export const version = '{{SDK_VERSION}}';

// Re-export all sub-paths
export * from './math-json';
export * from './latex-syntax';
export * from './interval';
export * from './numerics';
export * from './core';
export * from './compile';

// Convenience free functions (accept string | MathJSON | Expression)
export {
  simplify, evaluate, N,
  expand, expandAll, factor, solve,
  compile,
  declare, assign,
} from './compute-engine/free-functions';

// Global registration
import { ComputeEngine } from './compute-engine/index';
globalThis[Symbol.for('io.cortexjs.compute-engine')] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
```

Note: There may be export name conflicts between sub-paths (e.g., `parse` from
latex-syntax vs a potential `parse` elsewhere). Audit and use explicit named
exports if `export *` causes collisions.

**Step 3: Build and verify**

Run: `npm run build`
Run: `ls -lh dist/compute-engine.min.esm.js`
Expected: ~1 MB (same as today — it bundles everything)

**Step 4: Run full test suite**

Run: `npm run test compute-engine/arithmetic`
Run: `npm run test compute-engine/simplify`
Run: `npm run test compute-engine/compile`

**Step 5: Commit**

---

## Phase 6: Cleanup

### Task 11: Remove dead code from common/

**Files to delete** (never imported by anything):

- `src/common/buffer.ts`
- `src/common/json5.ts`
- `src/common/markdown.ts`
- `src/common/markdown-block.ts`
- `src/common/markdown-span.ts`
- `src/common/markdown-types.ts`
- `src/common/parser.ts`
- `src/common/result.ts`
- `src/common/sigil.ts`
- `src/common/styled-text.ts`
- `src/common/syntax-highlighter.ts`
- `src/common/terminal.ts`

Also check these type/ files from the earlier analysis:

- `src/common/type/ast-nodes.ts`
- `src/common/type/error-handler.ts`
- `src/common/type/lexer.ts`
- `src/common/type/parser.ts`
- `src/common/type/resolve.ts`
- `src/common/type/type-builder.ts`

**Step 1: Verify each file is unused**

For each file, run: `grep -r 'filename' src/ --include='*.ts'` to confirm no
imports exist.

**Step 2: Delete confirmed dead files**

**Step 3: Build and run tests**

Run: `npm run build`
Run: `npm run typecheck`

**Step 4: Commit**

---

### Task 12: Remove deprecated type guard aliases

**Files:**

- Modify: `src/compute-engine/boxed-expression/type-guards.ts`

Remove the deprecated aliases:

- `isBoxedExpression` (use `isExpression`)
- `isBoxedNumber` (use `isNumber`)
- `isBoxedSymbol` (use `isSymbol`)
- `isBoxedFunction` (use `isFunction`)
- `isBoxedString` (use `isString`)
- `isBoxedTensor` (use `isTensor`)

Search codebase for any internal usage first and update.

**Step 1: Verify and update internal callers**

**Step 2: Remove deprecated exports**

**Step 3: Run typecheck and tests**

**Step 4: Commit**

---

## Implementation Notes

### Test Migration Strategy (Task 6)

The test update in Task 6 is the most labor-intensive step. Consider this
approach:

1. Create a test helper in `test/utils.ts`:
   ```ts
   import { parse, serialize } from '../src/latex-syntax';
   export { parse, serialize };
   ```

2. Use search-and-replace across all test files:
   - `ce.parse(` → `ce.expr(parse(`  (add closing paren)
   - `.latex` → use serialize helper
   - `.toLatex()` → use serialize helper

3. Process test files in batches, running tests after each batch.

### Potential Issues

- **ParseLatexOptions.getSymbolType**: The parser has an optional callback that
  returns `BoxedType`. For standalone usage, this can default to returning
  `'unknown'`. Document that type-aware parsing requires the engine.

- **Export name collisions**: Multiple sub-paths may export types with the same
  name (e.g., `Expression`). The root `export *` pattern may need explicit
  re-exports to resolve ambiguities.

- **Numerics entry point audit**: The `src/numerics.ts` file in Task 1 uses
  broad `export *` which may expose internal-only functions. Audit the exports
  and use explicit named exports for the public API.

- **Circular dependencies**: Moving code between modules may introduce new
  cycles. Run `npx madge --circular --extensions ts src/compute-engine` after
  each phase.
