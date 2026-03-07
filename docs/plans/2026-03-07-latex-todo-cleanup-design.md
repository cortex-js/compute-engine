# LaTeX Parser @todo Cleanup — Design

**Date**: 2026-03-07

## Goal

Address ~30 `@todo` comments across `src/compute-engine/latex-syntax/`, covering
missing parse/serialize implementations (Category B) and presentation quality
fixes (Category D).

## Work Units

### 1. Stale Derivative Comments (trivial)

The `@todo` items at `definitions-core.ts:1365-1366` reference missing Leibniz
and Euler derivative parsing. Investigation shows these are **already
implemented**:

- Leibniz ordinary: `definitions-arithmetic.ts:454-500` (outputs `D`)
- Leibniz partial: `definitions-arithmetic.ts:420-451` (outputs
  `PartialDerivative`)
- Euler `D_x f`: `definitions-core.ts:1478-1518`
- Euler partial `\partial_x f`: `definitions-other.ts:127-157`
- Newton `\dot{x}`: `definitions-core.ts:1428-1476`
- `D` serializer: `definitions-core.ts:1381-1425`

**Action**: Remove the stale `@todo` comments.

### 2. Set Operations (medium)

#### 2a. Set Builder Parsing

**File**: `definitions-sets.ts:364`

The `{...}` matchfix parser only handles enumerated sets (`\{1,2,3\}`). Add
detection of `\mid`, `|`, or `\colon` as a separator to produce set-builder
notation.

**Parsing**: `\{x \in \R \mid x > 0\}` →

```json
["Set", ["Element", "x", "RealNumbers"], ["Condition", ["Greater", "x", 0]]]
```

The serializer for this shape already exists at `definitions-sets.ts:571-581`.

**Implementation**: Inside the matchfix parse handler, after parsing the body,
check if the body contains a `\mid`/`|`/`\colon` separator. If so, split into
expression + condition and wrap in `["Set", expr, ["Condition", cond]]`.

The challenge: `|` is ambiguous (could be absolute value). Use `\mid` and
`\colon` as unambiguous triggers. For bare `|`, only treat as separator when
inside `\{...\}` matchfix context (which is already the case here).

#### 2b. `Multiple` — Defer

`Multiple` has no library definition (no entry in `sets.ts`). The latex-syntax
entry has a name and an empty serialize stub. Since it's not a real operator in
the engine, **defer** this until `Multiple` is defined in the library. Remove the
empty serialize stub to avoid confusion.

#### 2c. Multi-arg `CartesianProduct` / `Complement` Serialization

**File**: `definitions-sets.ts:221,228`

Currently these only handle the 2-arg infix case. Extend:

- `CartesianProduct(A, B, C)` → `A \times B \times C`
- `Complement(A, B)` — already works as postfix `A^\complement`; the multi-arg
  comment may be stale. Verify and update/remove.

### 3. BigOp Step Ranges — Update Comment (trivial)

**File**: `definitions-arithmetic.ts:1712`

The `Element` form (`i \in S`) is already handled at line 1720-1725. The
step-range gap (`i=1..3..10`) is intentionally deferred — uncommon LaTeX
notation. **Action**: Update the comment to reflect current state.

### 4. Spacing Commands (small)

#### 4a. Parse `\hspace`, `\hskip`, `\kern`

**File**: `parse.ts:689`

These take dimension arguments. Parse into
`["HorizontalSpacing", "'<dimension>'"]` with the dimension as a string
preserving unit.

- `\hspace{1em}`, `\hspace*{1em}` — group argument
- `\hskip 5pt`, `\kern-3mu` — inline glue (parse number + unit, ignore
  plus/minus stretch)

Register as expression triggers in `definitions-other.ts`. The parse handler
reads the dimension and returns `["HorizontalSpacing", "'<value><unit>'"]`.

#### 4b. Serialize `HorizontalSpacing` with Math Spacing Classes

**File**: `definitions-other.ts:544`

The 2-arg form `["HorizontalSpacing", expr, "'bin'"]` should serialize as:

- `"bin"` → `\mathbin{expr}`
- `"op"` → `\mathop{expr}`
- `"rel"` → `\mathrel{expr}`
- `"ord"` → `\mathord{expr}`
- `"open"` → `\mathopen{expr}`
- `"close"` → `\mathclose{expr}`
- `"punct"` → `\mathpunct{expr}`

Currently the second argument is silently dropped.

### 5. Serializer Quality (medium)

#### 5a. Skip Redundant Parens on Matchfix Operators

**File**: `serializer.ts:90`

`wrap()` adds parentheses around low-precedence expressions. But matchfix
operators (`Abs`, `Floor`, `Ceil`, `Delimiter`) already have visible delimiters.
Adding parens produces `\left(|x|\right)`.

**Fix**: In `wrap()`, check if the expression is a matchfix operator with visible
delimiters. If so, skip the wrapping. Identify matchfix by operator name:
`Abs`, `Floor`, `Ceil`, `Norm`, and any `Delimiter` expression.

#### 5b. `serializeTabular()` for Environments

**File**: `definitions.ts:519`

Environment entries use a generic serializer. When the body is a Matrix (List of
Lists), serialize as tabular: `&` between columns, `\\` between rows.

**Implementation**: Add a `serializeTabular()` helper that takes a matrix
expression and produces `row1col1 & row1col2 \\ row2col1 & row2col2`. Wire it
into the environment default serializer when the body matches a matrix shape.

#### 5c. `groupStyle` for `\left..\right` in Matchfix

**File**: `definitions.ts:531`

Matchfix serialization currently emits raw delimiter strings. It should call
`serializer.groupStyle(expr)` to choose between:

- `"none"` → bare delimiters `(`, `)`
- `"auto"` → `\left(`, `\right)`
- `"big"` → `\bigl(`, `\bigr)`
- etc.

### 6. String Group Symbols (small)

**File**: `parse.ts:1143`

In `parseStringGroup()`, when encountering a `\`-prefixed token, check if it
maps to a known Unicode symbol (Greek letters, common math symbols). Substitute
the Unicode character instead of passing through the raw LaTeX command.

Example: `\operatorname{\alpha-test}` → the string `"α-test"` instead of
`"\\alpha-test"`.

**Implementation**: Use the existing symbol dictionary to look up the mapping.
Only substitute for symbols that have a single Unicode character representation
(Greek letters, `\infty`, etc.). Leave unknown commands as-is.

## Out of Scope

- `Multiple` operator (no library definition)
- Step ranges in BigOp indexing (uncommon notation)
- Percent notation (`types.ts:618,693`)
- Domain checks for `Abs`/`Norm` (`definitions-arithmetic.ts:877,1470,1479`)
- Precedence corrections vs MathML (`definitions-other.ts:54,60,110`)

## Testing Strategy

Each work unit gets its own test block in the appropriate test file:

- Set builder: `test/compute-engine/latex-syntax/sets.test.ts`
- Spacing: `test/compute-engine/latex-syntax/style.test.ts`
- Serializer quality: new tests alongside existing serialize tests
- String groups: `test/compute-engine/latex-syntax/stefnotch.test.ts` or a new
  `string-groups.test.ts`

Round-trip tests (parse → serialize → parse) for all new parse/serialize pairs.
