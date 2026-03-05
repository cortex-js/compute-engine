# Text Promotion & Keyword Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When `\text{}` appears between math expressions, promote the surrounding math into a single `Text` expression instead of `InvisibleOperator`/`Multiply`. Also expand the set of recognized text keywords (`and`, `or`, `iff`, `if and only if`).

**Architecture:** Two changes: (1) New infix dictionary entries in `definitions-core.ts` for keyword text operators, following the existing `where` pattern. (2) Text promotion logic in `invisible-operator.ts` that detects `Text` operands and absorbs adjacent math into a single `Text`.

**Tech Stack:** TypeScript, Jest (inline snapshots)

---

### Task 1: Add `and`/`or` infix keyword tests

**Files:**
- Create: `test/compute-engine/latex-syntax/parse-text-keywords.test.ts`

**Step 1: Write failing tests**

```typescript
import { engine as ce } from '../../utils';

describe('TEXT KEYWORDS', () => {
  test('\\text{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\text{ and } x < 10').json).toMatchInlineSnapshot(
      `["And", ["Greater", "x", 0], ["Less", "x", 10]]`
    );
  });

  test('\\text{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\text{ or } x = 1').json).toMatchInlineSnapshot(
      `["Or", ["Equal", "x", 0], ["Equal", "x", 1]]`
    );
  });

  test('\\text{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{andy}').json).toMatchInlineSnapshot(`"'andy'"`);
  });

  test('\\text{organic} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{organic}').json).toMatchInlineSnapshot(
      `"'organic'"`
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`
Expected: FAIL — `and`/`or` not recognized as infix operators, parsed as text runs

---

### Task 2: Implement `and`/`or` infix keyword entries

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`

**Step 1: Add infix entries after the existing `where` block (after line 828)**

Add these entries right after the `\operatorname{where}` entry (line 828) and before the Block serializer (line 830):

```typescript
// \text{and} — logical conjunction infix
{
  latexTrigger: ['\\text'],
  kind: 'infix',
  associativity: 'right',
  precedence: 235, // Same as \land
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'and')) {
      parser.index = start;
      return null;
    }
    const rhs = parser.parseExpression({ ...until, minPrec: 235 });
    return ['And', lhs, rhs ?? 'Nothing'] as MathJsonExpression;
  },
},
// \text{or} — logical disjunction infix
{
  latexTrigger: ['\\text'],
  kind: 'infix',
  associativity: 'right',
  precedence: 230, // Same as \lor
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'or')) {
      parser.index = start;
      return null;
    }
    const rhs = parser.parseExpression({ ...until, minPrec: 230 });
    return ['Or', lhs, rhs ?? 'Nothing'] as MathJsonExpression;
  },
},
```

**Step 2: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`
Expected: PASS

---

### Task 3: Add `iff` keyword tests and implementation

**Files:**
- Modify: `test/compute-engine/latex-syntax/parse-text-keywords.test.ts`
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`

**Step 1: Add failing test**

Add to the `TEXT KEYWORDS` describe block:

```typescript
test('\\text{iff} as biconditional', () => {
  expect(ce.parse('P \\text{ iff } Q').json).toMatchInlineSnapshot(
    `["Equivalent", "P", "Q"]`
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`

**Step 3: Add infix entry** (same location as Task 2, after the `or` entry)

```typescript
// \text{iff} — biconditional (if and only if)
{
  latexTrigger: ['\\text'],
  kind: 'infix',
  associativity: 'right',
  precedence: 219, // Same as \iff
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'iff')) {
      parser.index = start;
      return null;
    }
    const rhs = parser.parseExpression({ ...until, minPrec: 219 });
    return ['Equivalent', lhs, rhs ?? 'Nothing'] as MathJsonExpression;
  },
},
```

**Step 4: Run tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`

---

### Task 4: Add multi-word keyword support and `if and only if`

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`
- Modify: `test/compute-engine/latex-syntax/parse-text-keywords.test.ts`

**Step 1: Add failing test**

```typescript
test('\\text{if and only if} as biconditional', () => {
  expect(ce.parse('P \\text{ if and only if } Q').json).toMatchInlineSnapshot(
    `["Equivalent", "P", "Q"]`
  );
});
```

**Step 2: Run test to verify it fails**

**Step 3: Modify `matchTextKeyword` to support multi-word keywords**

Replace the current `matchTextKeyword` function (lines 2040-2080) with:

```typescript
function matchTextKeyword(parser: Parser, keyword: string): boolean {
  const start = parser.index;

  // We expect <{> after \text (the latexTrigger already consumed \text)
  if (!parser.match('<{>')) {
    parser.index = start;
    return false;
  }

  // Skip leading spaces
  while (parser.match('<space>')) {}

  // Match keyword character by character.
  // Spaces in the keyword require at least one <space> token.
  for (let i = 0; i < keyword.length; i++) {
    if (keyword[i] === ' ') {
      // Require at least one space, skip extras
      if (!parser.match('<space>')) {
        parser.index = start;
        return false;
      }
      while (parser.match('<space>')) {}
    } else {
      if (parser.peek !== keyword[i]) {
        parser.index = start;
        return false;
      }
      parser.nextToken();
    }
  }

  // Skip trailing spaces
  while (parser.match('<space>')) {}

  // Must close with <}>
  if (!parser.match('<}>')) {
    parser.index = start;
    return false;
  }

  return true;
}
```

This is backward-compatible with single-word keywords (no spaces → same behavior as before).

**Step 4: Add the infix entry** (after the `iff` entry)

```typescript
// \text{if and only if} — verbose biconditional
{
  latexTrigger: ['\\text'],
  kind: 'infix',
  associativity: 'right',
  precedence: 219,
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'if and only if')) {
      parser.index = start;
      return null;
    }
    const rhs = parser.parseExpression({ ...until, minPrec: 219 });
    return ['Equivalent', lhs, rhs ?? 'Nothing'] as MathJsonExpression;
  },
},
```

**Step 5: Run all keyword tests**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`
Expected: PASS

**Step 6: Run the existing `where` tests to verify no regression**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-where.test.ts`
Expected: PASS

---

### Task 5: Add Text promotion tests

**Files:**
- Modify: `test/compute-engine/latex-syntax/style.test.ts`

**Step 1: Add failing tests**

Add a new describe block at the end of the file:

```typescript
describe('TEXT PROMOTION', () => {
  test('math + text + math promotes to Text', () => {
    expect(check('a\\text{ hello }b')).toMatchInlineSnapshot(`
      box       = ["Text", "a", "' hello '", "b"]
    `);
  });

  test('math + text with inline math + math promotes to Text', () => {
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["Text", "a", "' in '", "x", "' '", "b"]
    `);
  });

  test('text alone (no surrounding math) stays as-is', () => {
    expect(check('\\text{hello}')).toMatchInlineSnapshot(`
      box       = "'hello'"
    `);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/style.test.ts`
Expected: FAIL — InvisibleOperator wraps text + math instead of promoting

---

### Task 6: Implement Text promotion in InvisibleOperator

**Files:**
- Modify: `src/compute-engine/boxed-expression/invisible-operator.ts`

**Step 1: Add Text promotion logic**

After the `flattenInvisibleOperator` call (line 148) and before `combineFunctionApplications` (line 154), add:

```typescript
  // Text promotion: if any operand is a Text expression, absorb all
  // operands into a single Text. This handles cases like
  // `a \text{ hello } b` where InvisibleOperator wraps math + text,
  // but the semantically correct result is a single Text flow.
  if (ops.some((op) => isFunction(op, 'Text'))) {
    const runs: Expression[] = [];
    for (const op of ops) {
      if (isFunction(op, 'Text')) {
        // Flatten Text's inner runs into the parent
        runs.push(...op.ops);
      } else if (op.operator !== 'HorizontalSpacing') {
        runs.push(op.canonical);
      }
    }
    return ce._fn('Text', runs);
  }
```

No new imports needed — `isFunction` is already imported.

**Step 2: Run style tests to verify they pass**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/style.test.ts`

Note: The existing `a\text{ in $x$ }b` snapshot (line 30) will need updating since it currently expects `["InvisibleOperator", ...]` but will now produce `["Text", ...]`. Update the inline snapshot to match the new (correct) output.

**Step 3: Run keyword tests to ensure no interference**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parse-text-keywords.test.ts`
Expected: PASS — keywords are parsed as infix operators before reaching InvisibleOperator

---

### Task 7: Update existing snapshots and run full regression

**Files:**
- Modify: `test/compute-engine/latex-syntax/style.test.ts` (update snapshots)

**Step 1: Update the `a\text{ in $x$ }b` snapshot**

The test at line 30 currently expects:
```
box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
```

After Text promotion, it should produce:
```
box       = ["Text", "a", " in ", "x", " ", "b"]
```

Update the inline snapshot to match. The canonical/simplify/eval lines will also change — use the actual test output.

**Step 2: Update the `a\text{ black \color{red}RED\color{blue}BLUE} b` snapshot**

Similar update — the InvisibleOperator wrapping will be replaced by Text promotion.

**Step 3: Run the full style test suite**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/style.test.ts`
Expected: PASS

**Step 4: Run the full parsing test suite**

Run: `npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/latex-syntax/parsing.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors
