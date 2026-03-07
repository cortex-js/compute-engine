# LaTeX Parser @todo Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Address ~13 `@todo` items in `src/compute-engine/latex-syntax/`
covering missing parse/serialize features and presentation quality fixes.

**Architecture:** Six independent work units touching the latex-syntax
dictionary definitions, parser, and serializer. Each unit adds tests first
(TDD), then implements the minimal fix, then cleans up the stale comment.

**Tech Stack:** TypeScript, Jest inline snapshots, `check()`/`engine.parse()`
test utilities.

**Reference:** `docs/plans/2026-03-07-latex-todo-cleanup-design.md`

---

### Task 1: Remove Stale Derivative @todo Comments

The derivative `@todo` items reference features that are already implemented.

**Files:**

- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts:1365-1366`
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts:1712`

**Step 1: Remove stale derivative comments**

In `definitions-core.ts:1365-1366`, remove the two `@todo` lines:

```typescript
// @todo: Leibniz notation: {% latex " \\frac{d^n}{dx^n} f(x)" %}
// @todo: Euler modified notation: This notation is used by Mathematica. The Euler notation uses `D` instead of
// `\partial`: `\partial_{x} f`,  `\partial_{x,y} f`
```

These are implemented: Leibniz at `definitions-arithmetic.ts:454-500`, Euler at
`definitions-core.ts:1478-1518`.

**Step 2: Update BigOp step range comment**

In `definitions-arithmetic.ts:1712`, replace the `@todo` with a note that
`Element` is handled:

```typescript
// Note: Element expressions (i \in S) are handled below at line ~1720.
// Step ranges (i=1..3..10) are intentionally not supported — uncommon LaTeX notation.
```

**Step 3: Run tests to verify nothing changed**

Run: `npm run test compute-engine/latex-syntax`
Expected: All tests pass (no behavior change).

---

### Task 2: Set Builder Parsing

**Files:**

- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts:360-375`
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` (register `\mid`)
- Test: `test/compute-engine/latex-syntax/sets.test.ts`

**Context:** The `{...}` matchfix handler receives `(parser, body)` where `body`
is already parsed. Currently `\mid` is not registered as any kind of operator, so
it produces parse errors. The `:` / `\colon` case already parses via the existing
`Colon` infix (precedence 250), but Colon binds tighter than comparisons (245),
so `{x : x > 0}` produces `["Set", ["Greater", ["Colon", "x", "x"], 0]]` — the
Colon is buried inside Greater.

**Approach:** Register `\mid` as a low-precedence infix operator `Divides`
(precedence 160, below logic operators at 200, below comparisons at 245). This
ensures `\{x \in \R \mid x > 0\}` parses the body as
`["Divides", ["Element", "x", "RealNumbers"], ["Greater", "x", 0]]` — cleanly
split at the top level.

In the Set matchfix handler, detect `Divides` (or `Colon`) at the top level of
the body and restructure to `["Set", lhs, ["Condition", rhs]]`.

Note: `\mid` as `Divides` is also correct for standalone use (`a \mid b`).

**Step 1: Write failing tests**

Add to `test/compute-engine/latex-syntax/sets.test.ts`:

```typescript
describe('SET BUILDER NOTATION', () => {
  test('\\{x \\mid x > 0\\}', () => {
    const expr = ce.parse('\\{x \\mid x > 0\\}', { form: 'raw' });
    expect(expr.json).toEqual([
      'Set',
      'x',
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });

  test('\\{x \\in R \\mid x > 0\\}', () => {
    const expr = ce.parse(
      '\\{x \\in \\R \\mid x > 0\\}', { form: 'raw' }
    );
    expect(expr.json).toEqual([
      'Set',
      ['Element', 'x', 'RealNumbers'],
      ['Condition', ['Greater', 'x', 0]],
    ]);
  });

  test('set builder serialization roundtrip', () => {
    const expr = ce.expr([
      'Set',
      ['Element', 'x', 'RealNumbers'],
      ['Condition', ['Greater', 'x', 0]],
    ]);
    expect(expr.latex).toContain('\\mid');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/latex-syntax -- --testNamePattern "SET BUILDER"`
Expected: FAIL

**Step 3: Register `\mid` as infix `Divides`**

In `definitions-core.ts` (or `definitions-arithmetic.ts` near other relational
operators), add:

```typescript
{
  name: 'Divides',
  latexTrigger: ['\\mid'],
  kind: 'infix',
  precedence: 160,
},
```

**Step 4: Update Set matchfix handler**

In `definitions-sets.ts`, replace the Set parse handler:

```typescript
parse: (_parser: Parser, body: MathJsonExpression): MathJsonExpression => {
  if (isEmptySequence(body)) return 'EmptySet';

  // Set builder notation: {expr | condition} or {expr : condition}
  const h = operator(body);
  if (h === 'Divides' || h === 'Colon') {
    const lhs = operand(body, 1);
    const rhs = operand(body, 2);
    if (lhs !== null && rhs !== null)
      return ['Set', lhs, ['Condition', rhs]];
  }

  // Enumerated set: {1, 2, 3}
  if (
    operator(body) === 'Delimiter' &&
    stringValue(operand(body, 2)) === ','
  ) {
    body = operand(body, 1)!;
  }
  if (operator(body) !== 'Sequence') return ['Set', body];
  return ['Set', ...operands(body)];
},
```

**Step 5: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass including new set builder tests.

---

### Task 3: Multi-arg CartesianProduct / Complement Serialize

**Files:**

- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-sets.ts:213-229`
- Test: `test/compute-engine/latex-syntax/sets.test.ts`

**Step 1: Write failing tests**

```typescript
test('Complement serialize', () => {
  expect(latex(['Complement', 'A'])).toContain('\\complement');
});
```

**Step 2: Investigate current behavior**

Check whether `Complement` already serializes correctly for 1-arg (postfix) and
whether multi-arg is actually needed (it may not be — complement is typically
unary). If the `@todo` is stale, just remove it and add the test. Similarly check
`CartesianProduct`.

**Step 3: Remove stale comments or implement**

The `CartesianProduct` entry is entirely commented out (lines 188-212). The
`Complement` entries (lines 214-229) have duplicate definitions. Clean up:

- Remove the `// @todo: serialize for the multiple argument case` comments
- If multi-arg is needed, add a serialize handler; if not, remove the comment

**Step 4: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass.

---

### Task 4: Spacing Commands — `\hspace`, `\hskip`, `\kern`

**Files:**

- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-other.ts`
- Modify: `src/compute-engine/latex-syntax/parse.ts:689` (remove @todo)
- Test: `test/compute-engine/latex-syntax/style.test.ts`

**Step 1: Write failing tests**

```typescript
describe('SPACING COMMANDS', () => {
  test('\\hspace{1em} parse', () => {
    const expr = engine.parse('x\\hspace{1em}y', { form: 'raw' });
    // Should contain HorizontalSpacing with dimension string
    expect(JSON.stringify(expr.json)).toContain('HorizontalSpacing');
  });

  test('\\kern5pt parse', () => {
    const expr = engine.parse('x\\kern5pt y', { form: 'raw' });
    expect(JSON.stringify(expr.json)).toContain('HorizontalSpacing');
  });
});
```

**Step 2: Implement spacing command parsers**

In `definitions-other.ts`, add expression entries:

```typescript
{
  latexTrigger: ['\\hspace'],
  parse: (parser: Parser): MathJsonExpression => {
    // \hspace* is also valid (same behavior for us)
    parser.match('*');
    const dim = parser.parseStringGroup();
    if (dim !== null) return ['HorizontalSpacing', `'${dim}'`];
    return 'Nothing';
  },
},
{
  latexTrigger: ['\\hspace*'],
  parse: (parser: Parser): MathJsonExpression => {
    const dim = parser.parseStringGroup();
    if (dim !== null) return ['HorizontalSpacing', `'${dim}'`];
    return 'Nothing';
  },
},
{
  latexTrigger: ['\\kern'],
  parse: (parser: Parser): MathJsonExpression => {
    // \kern takes inline dimension: \kern5pt, \kern-3mu, \kern 1em
    // Parse: optional minus, digits (with optional decimal), unit letters
    parser.skipSpace();
    let dim = '';
    // Optional sign
    if (parser.match('-')) dim += '-';
    else if (parser.match('+')) dim += '+';
    // Digits and decimal point
    while (/[0-9.]/.test(parser.peek)) dim += parser.nextToken();
    // Unit (letters like pt, em, mu, ex, mm, cm, in, bp, pc, dd, cc, sp)
    while (/[a-z]/.test(parser.peek)) dim += parser.nextToken();
    if (dim) return ['HorizontalSpacing', `'${dim}'`];
    return 'Nothing';
  },
},
{
  latexTrigger: ['\\hskip'],
  parse: (parser: Parser): MathJsonExpression => {
    // Same as \kern for our purposes (ignore plus/minus stretch)
    parser.skipSpace();
    let dim = '';
    if (parser.match('-')) dim += '-';
    else if (parser.match('+')) dim += '+';
    while (/[0-9.]/.test(parser.peek)) dim += parser.nextToken();
    while (/[a-z]/.test(parser.peek)) dim += parser.nextToken();
    if (dim) return ['HorizontalSpacing', `'${dim}'`];
    return 'Nothing';
  },
},
```

**Step 3: Update `HorizontalSpacing` serialize for math spacing classes**

In `definitions-other.ts`, update the `HorizontalSpacing` serializer (line ~542)
to handle the 2-arg form:

```typescript
serialize: (serializer, expr): string => {
  if (operand(expr, 2) !== null) {
    const cls = stringValue(operand(expr, 2));
    const inner = serializer.serialize(operand(expr, 1));
    const cmd = {
      bin: '\\mathbin',
      op: '\\mathop',
      rel: '\\mathrel',
      ord: '\\mathord',
      open: '\\mathopen',
      close: '\\mathclose',
      punct: '\\mathpunct',
    }[cls ?? ''];
    if (cmd) return `${cmd}{${inner}}`;
    return inner;
  }
  // ... existing numeric spacing code ...
```

**Step 4: Remove `parse.ts:689` @todo comment**

Replace:
```
// @todo maybe also `\hspace` and `\hspace*` and `\hskip` and `\kern` with a glue param
```
with nothing (delete the line).

**Step 5: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass.

---

### Task 5: Serializer Quality

**Files:**

- Modify: `src/compute-engine/latex-syntax/serializer.ts:90-125`
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions.ts:519-547`
- Test: `test/compute-engine/latex-syntax/style.test.ts` or new file

#### 5a: Skip redundant parens on matchfix

**Step 1: Write failing test**

```typescript
test('no redundant parens on Abs', () => {
  // 2 * |x| should not produce 2\left(|x|\right)
  expect(latex(['Multiply', 2, ['Abs', 'x']])).not.toContain('\\left');
});
```

**Step 2: Update `wrap()` in `serializer.ts`**

At line ~107, after getting `name`, add a check before the precedence comparison:

```typescript
const name = operator(expr);
if (name && name !== 'Delimiter' && name !== 'Subscript') {
  // Don't wrap matchfix operators — they already have visible delimiters
  if (name === 'Abs' || name === 'Floor' || name === 'Ceil' || name === 'Norm')
    return this.serialize(expr);
  const def = this.dictionary.ids.get(name);
  // ... existing precedence check ...
```

**Step 3: Remove @todo comment at serializer.ts:90**

**Step 4: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass. Check no snapshots break.

#### 5b: `serializeTabular()` for environments

**Step 1: Write test**

```typescript
test('environment with matrix body serializes as tabular', () => {
  // A matrix inside a custom environment should use & and \\
  expect(
    latex(['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]])
  ).toContain('&');
});
```

**Step 2: Add `serializeTabular` helper**

In `definitions.ts`, near line 519, add a helper:

```typescript
function serializeTabular(
  serializer: Serializer,
  expr: MathJsonExpression
): string {
  // expr should be a List of Lists (rows of columns)
  const rows = operands(expr);
  return rows
    .map((row) =>
      operator(row) === 'List'
        ? operands(row).map((cell) => serializer.serialize(cell)).join(' & ')
        : serializer.serialize(row)
    )
    .join(' \\\\ ');
}
```

Update the environment default serializer to use it when the body is a matrix:

```typescript
if (kind === 'environment') {
  const envName = entry['symbolTrigger'] ?? entry.name ?? 'unknown';
  return (serializer, expr) => {
    const body = operand(expr, 1);
    const bodyStr =
      operator(body) === 'List' && operands(body).every((r) => operator(r) === 'List')
        ? serializeTabular(serializer, body)
        : serializer.serialize(body);
    return joinLatex([`\\begin{${envName}}`, bodyStr, `\\end{${envName}}`]);
  };
}
```

**Step 3: Remove @todo at definitions.ts:519**

#### 5c: `groupStyle` for matchfix `\left..\right`

**Step 1: Investigate**

Check what `serializer.groupStyle()` returns and how `wrapString()` uses it.
The matchfix default serializer at `definitions.ts:530-546` currently uses raw
delimiters. Update it to call `serializer.wrapString()` which respects
`groupStyle`:

```typescript
if (isMatchfixEntry(entry)) {
  const openDelim = /* existing code */;
  const closeDelim = /* existing code */;
  return (serializer, expr) => {
    const body = serializer.serialize(operand(expr, 1));
    return serializer.wrapString(body, serializer.options.groupStyle(expr, serializer.level), openDelim, closeDelim);
  };
}
```

Note: Verify `wrapString` signature supports custom delimiters. If not, this may
require a different approach — possibly checking the group style and prepending
`\left`/`\right` or `\bigl`/`\bigr` to the delimiter strings.

**Step 2: Remove @todo at definitions.ts:531**

**Step 3: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass. Snapshot updates likely needed.

---

### Task 6: String Group Symbol Interpretation

**Files:**

- Modify: `src/compute-engine/latex-syntax/parse.ts:1139-1144`
- Reference: `src/compute-engine/latex-syntax/dictionary/definitions-symbols.ts`
  (the `SYMBOLS` table)
- Test: `test/compute-engine/latex-syntax/style.test.ts` or new test

**Step 1: Write failing test**

```typescript
test('\\alpha in string group', () => {
  // \operatorname uses parseStringGroup internally
  const expr = engine.parse('\\operatorname{\\alpha}x', { form: 'raw' });
  // Should interpret \alpha as the symbol name, not raw "\\alpha"
  expect(JSON.stringify(expr.json)).toContain('alpha');
  expect(JSON.stringify(expr.json)).not.toContain('\\\\alpha');
});
```

**Step 2: Build a latex-to-unicode lookup**

In `parse.ts`, import or build a map from the `SYMBOLS` table:

```typescript
import { SYMBOLS } from './dictionary/definitions-symbols';

const LATEX_TO_UNICODE: Record<string, string> = {};
for (const [_name, trigger, codepoint] of SYMBOLS) {
  LATEX_TO_UNICODE[trigger] = String.fromCodePoint(codepoint);
}
```

Alternatively, make this a lazy singleton to avoid import-time cost.

**Step 3: Use the lookup in `parseStringGroupContent`**

At line 1139-1144, replace:

```typescript
} else if (token[0] === '\\') {
  // @todo: interpret some symbols, i.e. \alpha, etc..
  result += token;
```

with:

```typescript
} else if (token[0] === '\\') {
  const unicode = LATEX_TO_UNICODE[token];
  result += unicode ?? token;
```

**Step 4: Run tests**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass. Some snapshots may change if `\alpha` appears in
operatorname tests.

---

### Task 7: Cleanup and Final Verification

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: Clean pass.

**Step 2: Run full latex-syntax test suite**

Run: `npm run test compute-engine/latex-syntax`
Expected: All pass.

**Step 3: Verify no remaining stale @todo items**

Grep for `@todo` in `src/compute-engine/latex-syntax/` and confirm all addressed
items are removed. Remaining items should only be the intentionally deferred
ones (domain checks, percent notation, precedence values, etc.).
