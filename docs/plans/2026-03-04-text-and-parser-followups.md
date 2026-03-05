# Text & Parser Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 follow-up issues from the `\text{}` and parser work: Text serialization round-trip, Text evaluation, `\textcolor` inside `\text{}`, `parseSyntaxError` token consumption, `parseSymbolToken` catch-all hardening, and additional text keywords.

**Architecture:** Each task is independent and can be done in any order. Tasks 1-2 add handlers to existing operator definitions. Task 3 fixes a bug in `parseTextRun`. Task 4-5 harden parser error handling. Task 6 adds new dictionary entries following the existing `\text{and}` pattern.

**Tech Stack:** TypeScript, Jest (inline snapshots), LaTeX parsing/serialization

---

### Task 1: Text serializer — round-trip `Text` back to `\text{}` LaTeX

Currently `Text` has no serializer, so it falls through to the default `\mathrm{Text}(...)` output. We need a serializer that produces proper `\text{}` with inline `$...$` for math sub-expressions.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` (add serializer entry near line 940, after the `Return` serializer)
- Test: `test/compute-engine/latex-syntax/style.test.ts`

**Step 1: Write failing tests**

Add a new `describe('TEXT SERIALIZATION')` block at the end of `style.test.ts`:

```typescript
describe('TEXT SERIALIZATION', () => {
  test('Text with only strings concatenates into \\text{}', () => {
    expect(check('\\text{hello}')).toMatchInlineSnapshot(`'hello'`);
  });

  test('Text with math sub-expressions uses inline $...$', () => {
    // Text(a, " in ", x, " ") should serialize as a\text{ in $x$ }
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
      canonical = ["Text", "a", " in ", "x", " ", "b"]
    `);
  });
});
```

Note: the existing tests already cover serialization implicitly via the `check()` helper which includes `latex` output when it differs from input. The key test is that `["Text", "a", " in ", "x", " ", "b"]` serializes back to `a\\text{ in $x$ }b`. We need to add explicit round-trip tests.

**Step 2: Run tests to see current behavior**

Run: `npm run test compute-engine/latex-syntax/style`

The existing tests should pass (they don't test serialization of `Text`). Check the `check()` output — if `latex` appears in the snapshot, it means serialization differs from input.

**Step 3: Add the Text serializer**

In `definitions-core.ts`, add a new entry after the `Return` serializer (after line 986):

```typescript
// Text serializer — reconstructs \text{...} with inline $...$ for math
{
  name: 'Text',
  serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
    const args = operands(expr);
    if (args.length === 0) return '';

    // Classify each arg as text (string) or math (expression)
    const parts: string[] = [];
    let inText = false;

    for (const arg of args) {
      const s = stringValue(arg);
      if (s !== null) {
        // String operand — belongs in \text{}
        if (!inText) {
          parts.push('\\text{');
          inText = true;
        }
        parts.push(sanitizeLatex(s));
      } else {
        // Math operand
        if (inText) {
          // Wrap math in $...$ inside the \text{} run
          parts.push('$');
          parts.push(serializer.serialize(arg));
          parts.push('$');
        } else {
          // Standalone math — just serialize
          parts.push(serializer.serialize(arg));
        }
      }
    }
    if (inText) parts.push('}');

    return joinLatex(parts);
  },
},
```

Wait — this approach has a subtlety. Consider `["Text", "a", " in ", "x", " ", "b"]`. Here `"a"` and `"b"` are symbols (math), not strings. Strings are quoted like `"' in '"`. Let me reconsider.

In MathJSON, string literals are `"'hello'"` (with quotes), symbols are `"x"`. The `stringValue()` function strips the quotes. So for `["Text", "a", " in ", "x", " ", "b"]`:
- `"a"` → `stringValue` returns `null` (it's a symbol) → math
- `" in "` → depends on whether it's `"' in '"` (string) or `" in "` (symbol with spaces)

Actually, looking at the test snapshots, `" in "` is a string value in the parsed output — but in the canonical form `["Text", "a", " in ", "x", " ", "b"]`, these intermediate strings don't have quotes in the snapshot because the snapshot format strips them. Let me check how `check()` displays them.

Looking at the existing test at line 29: `canonical = ["Text", "a", " in ", "x", " ", "b"]` — the `" in "` here is displayed without single-quote wrapping, which means it's being displayed as the snapshot printer shows it. In the actual MathJSON, text runs are single-quote-wrapped strings like `"' in '"`.

The serializer needs to handle both cases. Let me revise:

```typescript
{
  name: 'Text',
  serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
    const args = operands(expr);
    if (args.length === 0) return '';

    // Group consecutive text (string) args into \text{} runs,
    // with math args either as inline $...$ (inside a text run)
    // or standalone (outside).
    const parts: string[] = [];
    let textRun = '';
    let hasTextRun = false;

    const flushText = () => {
      if (hasTextRun) {
        parts.push('\\text{' + textRun + '}');
        textRun = '';
        hasTextRun = false;
      }
    };

    for (const arg of args) {
      const s = stringValue(arg);
      if (s !== null) {
        // String operand — accumulate into text run
        textRun += s;
        hasTextRun = true;
      } else {
        if (hasTextRun) {
          // Math inside a text run — use inline $...$
          textRun += '$' + serializer.serialize(arg) + '$';
        } else {
          // Math outside text — serialize directly
          parts.push(serializer.serialize(arg));
        }
      }
    }
    flushText();

    return joinLatex(parts);
  },
},
```

Hmm, but this logic is tricky. The pattern from the parser is: `["Text", "a", " in ", "x", " ", "b"]` where `"a"` and `"b"` are symbols and `" in "` / `" "` are strings. The expected LaTeX is `a\text{ in $x$ }b`.

So the algorithm: iterate args. When we hit a string, start a `\text{}` run. Math args within a text run become `$...$`. When a string hasn't started or has ended and we hit math, output it raw.

Actually, the right heuristic: a text run starts at the first string and extends to the last string. Math args before the first string are standalone; math args after the last string are standalone; math args between strings are inline `$...$`.

Let me simplify — just scan for the first and last string index:

```typescript
{
  name: 'Text',
  serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
    const args = operands(expr);
    if (args.length === 0) return '';

    // Find extent of text (string) args
    let firstStr = -1;
    let lastStr = -1;
    for (let i = 0; i < args.length; i++) {
      if (stringValue(args[i]) !== null) {
        if (firstStr < 0) firstStr = i;
        lastStr = i;
      }
    }

    // No strings at all — just serialize math args
    if (firstStr < 0) {
      return joinLatex(args.map((a) => serializer.serialize(a)));
    }

    const parts: string[] = [];
    // Math args before the text run
    for (let i = 0; i < firstStr; i++)
      parts.push(serializer.serialize(args[i]));

    // The text run (firstStr..lastStr inclusive)
    let textContent = '';
    for (let i = firstStr; i <= lastStr; i++) {
      const s = stringValue(args[i]);
      if (s !== null) textContent += s;
      else textContent += '$' + serializer.serialize(args[i]) + '$';
    }
    parts.push('\\text{' + textContent + '}');

    // Math args after the text run
    for (let i = lastStr + 1; i < args.length; i++)
      parts.push(serializer.serialize(args[i]));

    return joinLatex(parts);
  },
},
```

This is cleaner. For `["Text", "a", " in ", "x", " ", "b"]`:
- firstStr = 1 (" in "), lastStr = 3 (" ")
- Before text: serialize "a" → `a`
- Text run: " in " + "$x$" + " " → `\text{ in $x$ }`
- After text: serialize "b" → `b`
- Result: `a\text{ in $x$ }b` ✓

Note: `sanitizeLatex` should be applied to string values inside `\text{}`. The existing `sanitizeLatex` function (line 1663) handles `{`, `}`, `\`, `$`, `%`, etc.

**Step 4: Run tests**

Run: `npm run test compute-engine/latex-syntax/style`

Update snapshots if needed: `npm run test snapshot -- --testPathPattern style`

**Step 5: Run full test suite to check for regressions**

Run: `npm run test compute-engine/latex-syntax/stefnotch`
Run: `npm run test compute-engine/latex-syntax/parsing`
Run: `npm run test compute-engine/latex-syntax/errors`

---

### Task 2: Text evaluate handler — concatenate operands into a string

Currently `Text` has no `evaluate` handler, so evaluating a `Text` expression returns itself. It should concatenate all operands into a single string.

**Files:**
- Modify: `src/compute-engine/library/core.ts:372-376` (add evaluate handler to `Text` definition)
- Test: `test/compute-engine/latex-syntax/style.test.ts`

**Step 1: Write failing test**

Add to the `TEXT PROMOTION` describe block in `style.test.ts`:

```typescript
test('Text evaluates to concatenated string', () => {
  expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
    box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
    canonical = ["Text", "a", " in ", "x", " ", "b"]
    eval-auto = Text(a, " in ", x, " ", b)
  `);
});
```

Note: The exact eval output depends on what `check()` produces. The `eval-auto` line will show the evaluated result. Currently it probably shows the unevaluated form. After adding the handler, it should show a single string like `"a in x b"`.

**Step 2: Run test to see current behavior**

Run: `npm run test compute-engine/latex-syntax/style`

**Step 3: Add evaluate handler**

In `core.ts`, modify the `Text` definition at line 372:

```typescript
Text: {
  description:
    'A sequence of strings, annotated expressions and other Text expressions',
  signature: '(any*) -> string',
  evaluate: (ops, { engine: ce }) => {
    if (ops.length === 0) return ce.string('');
    const parts: string[] = [];
    for (const op of ops) {
      if (isString(op)) parts.push(op.string);
      else {
        const evaluated = op.evaluate();
        if (isString(evaluated)) parts.push(evaluated.string);
        else parts.push(evaluated.toString());
      }
    }
    return ce.string(parts.join(''));
  },
},
```

Make sure `isString` is imported at the top of `core.ts` (it likely already is — check).

**Step 4: Run tests and update snapshots**

Run: `npm run test compute-engine/latex-syntax/style`

Some existing snapshots will need updating because the `eval-auto` and `eval-mach` lines will now show string results.

---

### Task 3: Fix `\textcolor{}{...}` inside `\text{}`

The `\textcolor` handler inside `parseTextRun` (definitions-core.ts:1524-1535) calls `parser.parseExpression()` for the body, which switches to math mode. Inside `\text{}`, the body should be parsed as text using `parseTextRun(parser)`.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts:1524-1535`
- Test: `test/compute-engine/latex-syntax/style.test.ts`

**Step 1: Understand the bug**

Currently at line 1528:
```typescript
const body = parser.parseExpression();
```

This parses `{RED}` as a math expression, treating `R`, `E`, `D` as separate math symbols multiplied together. It should instead parse as text using `parseTextRun(parser)`.

**Step 2: Write failing test**

The existing tests at lines 32-54 and 80-107 of `style.test.ts` already show the broken behavior (marked `invalid`). After the fix, these tests will produce correct output:

```typescript
test('\\textcolor inside \\text parses as text', () => {
  expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
    .toMatchInlineSnapshot(`
    box       = [
      "InvisibleOperator",
      "a",
      [
        "Text",
        " black ",
        ["Annotated", "'RED'", {dict: {color: "red"}}],
        " "
      ],
      "b"
    ]
    canonical = [
      "Text",
      "a",
      " black ",
      ["Annotated", "'RED'", {dict: {color: "red"}}],
      " ",
      "b"
    ]
  `);
});
```

**Step 3: Fix the `\textcolor` handler in `parseTextRun`**

In `definitions-core.ts`, replace lines 1524-1535:

```typescript
} else if (parser.match('\\textcolor')) {
  // Run-in style with color
  const pos = parser.index;
  const color = parser.parseStringGroup();
  if (color !== null) {
    flush();
    const body = parseTextRun(parser);
    runs.push(['Annotated', body, dictionaryFromEntries({ color })]);
  } else {
    parser.index = pos;
    text += '\\textcolor';
  }
}
```

Key changes:
1. Use `parseTextRun(parser)` instead of `parser.parseExpression()` — this stays in text mode
2. Use `dictionaryFromEntries({ color })` for consistency (matches the `\color` handler pattern)
3. Only check `color !== null` (the body is always parsed by `parseTextRun` which returns at least `"''"`)
4. Call `flush()` before pushing to separate preceding text from the annotated run

**Step 4: Run tests and update snapshots**

Run: `npm run test compute-engine/latex-syntax/style`

The `invalid` markers on the `\textcolor` tests should disappear. Update snapshots.

**Step 5: Run related tests**

Run: `npm run test compute-engine/latex-syntax/stefnotch`
Run: `npm run test compute-engine/latex-syntax/parsing`

---

### Task 4: Fix `parseSyntaxError` non-`\` token consumption

Currently when `parseSyntaxError` encounters a non-`\` token (line 2145-2150 of `parse.ts`), it returns an error but does NOT consume the token. This means the caller's loop may call `parseSyntaxError` again on the same token, potentially causing an infinite loop or leaving trailing errors unreported.

**Files:**
- Modify: `src/compute-engine/latex-syntax/parse.ts:2145-2150`
- Test: `test/compute-engine/latex-syntax/errors.test.ts`

**Step 1: Write test for multiple trailing bad tokens**

Add to `errors.test.ts`:

```typescript
test('Multiple trailing non-command tokens', () => {
  expect(parse('x##')).toMatchInlineSnapshot(
    `["Sequence", "x", ["Error", ["ErrorCode", "unexpected-token", "#"]]]`
  );
});
```

Note: this test may already exist from the `#` fix. The key is that both `#` tokens should be consumed and reported, not just the first one.

**Step 2: Run test to check current behavior**

Run: `npm run test compute-engine/latex-syntax/errors`

**Step 3: Fix token consumption**

In `parse.ts`, at line 2145, consume the token before returning the error:

```typescript
if (command[0] !== '\\') {
  this.nextToken(); // consume the non-command token
  return this.error(
    ['unexpected-token', { str: tokensToString(command) }],
    start
  );
}
```

**Step 4: Run tests**

Run: `npm run test compute-engine/latex-syntax/errors`
Run: `npm run test compute-engine/latex-syntax/parsing`

Check that `x##` now reports both `#` tokens as errors (or at least doesn't loop).

---

### Task 5: Harden `parseSymbolToken` catch-all

The catch-all at line 123 of `parse-symbol.ts` (`return parser.nextToken()`) unconditionally consumes any token as a potential symbol. This relies entirely on `isValidSymbol()` in the caller to reject bad tokens. If `isValidSymbol` has a bug (as we just saw with emoji), bad tokens slip through silently.

**Files:**
- Modify: `src/compute-engine/latex-syntax/parse-symbol.ts:120-123`
- Test: `test/compute-engine/latex-syntax/errors.test.ts`

**Step 1: Write test**

The existing `x##` test from the `#` fix already covers this. Add an explicit test for other edge-case tokens:

```typescript
test('Bare non-symbol tokens are rejected', () => {
  // & is a table column separator, not a valid symbol
  expect(parse('x&y')).toMatchInlineSnapshot(
    `["Sequence", "x", ["Error", ["ErrorCode", "unexpected-token", "&"]], "y"]`
  );
});
```

**Step 2: Run test**

Run: `npm run test compute-engine/latex-syntax/errors`

**Step 3: Add pre-validation in `parseSymbolToken`**

In `parse-symbol.ts`, replace lines 120-123:

```typescript
  // Raw token — only pass through if it could be a valid symbol character.
  // This prevents tokens like '#', '&', etc. from being consumed as symbols
  // even if isValidSymbol() has a bug.
  const token = parser.peek;
  if (token && /^[\p{XIDC}\p{M}]/u.test(token)) return parser.nextToken();

  return null;
```

This ensures only tokens starting with a Unicode identifier character can be treated as raw symbols. Punctuation like `#`, `&`, `~` etc. will return `null`, causing the caller to fall through to error handling.

**Step 4: Run full test suite**

Run: `npm run test compute-engine/latex-syntax/errors`
Run: `npm run test compute-engine/latex-syntax/parsing`
Run: `npm run test compute-engine/latex-syntax/stefnotch`

---

### Task 6: Add `such that`, `for all`, `there exists` text keywords

Following the existing `\text{and}` → `And` pattern (definitions-core.ts:829-848), add keyword entries for common logical phrases.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` (after line 908, before the Block serializer)
- Test: `test/compute-engine/latex-syntax/style.test.ts` or a new test in an existing logic test file

**Step 1: Write failing tests**

Add to `style.test.ts` or create a dedicated section:

```typescript
describe('TEXT KEYWORDS', () => {
  test('\\text{such that} as infix', () => {
    expect(check('x \\text{ such that } x > 0')).toMatchInlineSnapshot(
      `["Colon", "x", ["Greater", "x", 0]]`
    );
  });

  test('\\text{for all} as prefix', () => {
    expect(check('\\text{for all} x: x > 0')).toMatchInlineSnapshot(
      `["ForAll", "x", ["Greater", "x", 0]]`
    );
  });

  test('\\text{there exists} as prefix', () => {
    expect(check('\\text{there exists} x: x > 0')).toMatchInlineSnapshot(
      `["Exists", "x", ["Greater", "x", 0]]`
    );
  });
});
```

Note: The exact MathJSON output depends on how the parser handles precedence. The snapshots above are educated guesses — run the tests to see actual output and adjust.

**Step 2: Run tests to confirm they fail**

Run: `npm run test compute-engine/latex-syntax/style`

**Step 3: Add keyword entries**

In `definitions-core.ts`, after line 908 (after the `\text{if and only if}` entry), add:

```typescript
// \text{such that} — constraint/condition separator
{
  latexTrigger: ['\\text'],
  kind: 'infix',
  associativity: 'right',
  precedence: 250, // Same as Colon
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'such that')) {
      parser.index = start;
      return null;
    }
    const rhs = parser.parseExpression({ ...until, minPrec: 250 });
    return ['Colon', lhs, rhs ?? 'Nothing'] as MathJsonExpression;
  },
},
// \text{for all} — universal quantifier
{
  latexTrigger: ['\\text'],
  kind: 'prefix',
  precedence: 200, // Same as \forall
  parse: (
    parser: Parser,
    until?: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'for all')) {
      parser.index = start;
      return null;
    }
    return parseQuantifier('ForAll')(parser, until);
  },
},
// \text{there exists} — existential quantifier
{
  latexTrigger: ['\\text'],
  kind: 'prefix',
  precedence: 200, // Same as \exists
  parse: (
    parser: Parser,
    until?: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const start = parser.index;
    if (!matchTextKeyword(parser, 'there exists')) {
      parser.index = start;
      return null;
    }
    return parseQuantifier('Exists')(parser, until);
  },
},
```

Note: `parseQuantifier` is defined in `definitions-logic.ts`. You'll need to either:
- Import it (check if it's exported)
- Or inline the quantifier parsing logic

Check if `parseQuantifier` is exported:

```bash
grep -n 'export.*parseQuantifier\|function parseQuantifier' src/compute-engine/latex-syntax/dictionary/definitions-logic.ts
```

If not exported, either export it or use a simpler inline approach:

```typescript
// Simpler alternative if parseQuantifier isn't easily importable:
parse: (
  parser: Parser,
  until?: Readonly<Terminator>
): MathJsonExpression | null => {
  const start = parser.index;
  if (!matchTextKeyword(parser, 'for all')) {
    parser.index = start;
    return null;
  }
  const body = parser.parseExpression({ ...until, minPrec: 200 });
  return ['ForAll', body ?? 'Nothing'] as MathJsonExpression;
},
```

**Step 4: Run tests and update snapshots**

Run: `npm run test compute-engine/latex-syntax/style`

**Step 5: Run related tests**

Run: `npm run test compute-engine/latex-syntax/parsing`
Run: `npm run test compute-engine/latex-syntax/stefnotch`

---

## Task Dependencies

All 6 tasks are independent. However, Task 1 (Text serializer) and Task 2 (Text evaluate) may cause snapshot changes that interact, so doing them in order 1→2 is slightly easier. Task 3 (textcolor fix) will change style.test.ts snapshots. Do Tasks 1-3 first, then 4-6.

Suggested order: **3 → 1 → 2 → 4 → 5 → 6**

- Task 3 first because it fixes parse-time bugs that affect serialization test outputs
- Task 1 after because serialization tests depend on correct parsing
- Task 2 after because evaluation snapshots depend on correct serialization
- Tasks 4-6 are parser hardening and can go last
