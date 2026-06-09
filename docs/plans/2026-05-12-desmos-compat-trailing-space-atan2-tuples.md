# Desmos Compatibility: Trailing `\`, 2-arg Inverse Trig, Tuple Investigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three Desmos-corpus parsing gaps reported by the GP team: trailing stray backslash, 2-argument inverse-tangent (`\tan^{-1}(y,x)`), and verify tuple parsing inside function-call arguments.

**Architecture:** Two narrow parser-level fixes (post-`parseExpression` token tolerance; extend the existing 2-arg `\arctan → Arctan2` rule in `parseTrig` to also fire when the operator was inverted via `^{-1}`). One investigation task that produces a written conclusion plus regression tests for cases that already work, so the GP audit can be re-classified.

**Tech Stack:** TypeScript, Jest. Test runner via `npm run test compute-engine/<name>`. No new dependencies.

**Important constraints:**
- Do NOT include `git add` / `git commit` steps. The user commits separately when ready.
- Use `npm run typecheck` after each implementation step.
- Tests are added to `test/compute-engine/a6-polish.test.ts` (existing Desmos-compat polish file).

---

## File Map

**Modify:**
- `src/compute-engine/latex-syntax/parse.ts` — top-level `parse()` function near line 2693 (post-`parseExpression` tolerance for stray `\`).
- `src/compute-engine/latex-syntax/dictionary/definitions-trigonometry.ts` — `parseTrig` factory around line 105 (extend 2-arg → Arctan2 detection to cover `^{-1}`-inverted forms).

**Test:**
- `test/compute-engine/a6-polish.test.ts` — extend with new `describe` blocks.

**Read-only reference:**
- `src/compute-engine/latex-syntax/tokenizer.ts` — to confirm how stray `\` tokenizes at EOF (already verified: emits a literal `\` token).
- `src/compute-engine/boxed-expression/trigonometry.ts` — `processInverseFunction` / `inverseTrigFuncName` mapping (already lowers `InverseFunction(Tan)` to `Arctan`; we rely on this rather than duplicating it).

---

## Task 1: Tolerate a trailing stray `\` at end of input

**Why:** 8 corpus rows fail because Desmos LaTeX sometimes ends with a bare `\` (e.g. `C_{x}=\operatorname{hsv}\left(...\right)\`). The tokenizer emits this as a literal `\` token (parse.ts tokenizer falls through when `\` is followed by EOF). The named space commands `\,`, `\;`, `\quad`, etc. are already swallowed by `parser.skipVisualSpace()` — only the bare `\` case is broken.

**Files:**
- Modify: `src/compute-engine/latex-syntax/parse.ts` (function `parse`, around line 2686–2701)
- Test: `test/compute-engine/a6-polish.test.ts`

- [ ] **Step 1.1: Write failing tests**

Add this block at the end of `test/compute-engine/a6-polish.test.ts`:

```typescript
describe('Desmos compat — trailing stray backslash', () => {
  test('trailing bare \\ at end of input is tolerated', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('C_{x}=\\operatorname{hsv}\\left(1,1,1\\right)\\');
    expect(expr.json).toEqual(['Equal', 'C_x', ['Hsv', 1, 1, 1]]);
    expect(expr.isValid).toBe(true);
  });

  test('trailing \\ after a simple expression', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x+1\\');
    expect(expr.json).toEqual(['Add', 'x', 1]);
    expect(expr.isValid).toBe(true);
  });

  test('trailing \\ after a function call', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x)\\');
    expect(expr.json).toEqual(['Sin', 'x']);
    expect(expr.isValid).toBe(true);
  });

  test('named space commands still tolerated (regression)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x\\,').json).toEqual('x');
    expect(ce.parse('x\\quad').json).toEqual('x');
    expect(ce.parse('x\\;').json).toEqual('x');
  });

  test('trailing space command before bare \\ is also tolerated', () => {
    const ce = new ComputeEngine();
    // Verifies the order of operations in the fix: skipVisualSpace runs
    // before the bare-\ check, so `x\,\` (visual space + bare \ + EOF)
    // is also accepted.
    const expr = ce.parse('x\\,\\');
    expect(expr.json).toEqual('x');
    expect(expr.isValid).toBe(true);
  });
});

// NOTE: a stray bare `\` can only realistically appear at end of input
// because the tokenizer always combines `\` with the next character into
// a command or `<space>` token (see tokenizer.ts:167–185). The
// `parser.index = saved` rollback in the implementation is defensive:
// it ensures correctness if a future tokenizer change ever surfaces a
// stray `\` mid-stream.
```

- [ ] **Step 1.2: Run the new tests and verify they fail**

Run: `npm run test compute-engine/a6-polish`

Expected: the first three trailing-`\` tests fail (current behavior emits an `Error 'unexpected-command' '\\'` and wraps in InvisibleOperator/Sequence). The regression test for named space commands passes already. The middle-of-expression test passes already.

- [ ] **Step 1.3: Implement the fix**

In `src/compute-engine/latex-syntax/parse.ts`, locate the `parse` function (around line 2686). Currently it reads:

```typescript
export function parse(
  latex: string,
  dictionary: IndexedLatexDictionary,
  options: Readonly<ParseLatexOptions>
): MathJsonExpression | null {
  const parser = new _Parser(tokenize(latex), dictionary, options);

  let expr = parser.parseExpression();

  // If we didn't reach the end of the input, there was an error
  if (!parser.atEnd) {
    const error = parser.parseSyntaxError();
    // Note: there may still be tokens left in the input, but we will
    // ignore them
    expr = expr !== null ? ['Sequence', expr, error] : error;
  }
  ...
```

Change it to:

```typescript
export function parse(
  latex: string,
  dictionary: IndexedLatexDictionary,
  options: Readonly<ParseLatexOptions>
): MathJsonExpression | null {
  const parser = new _Parser(tokenize(latex), dictionary, options);

  let expr = parser.parseExpression();

  // Tolerate trailing whitespace and a stray bare `\` at end of input.
  // Some sources (notably Desmos) sometimes emit a trailing `\` that the
  // LaTeX tokenizer surfaces as a literal `\` token when followed by EOF.
  if (!parser.atEnd) {
    parser.skipVisualSpace();
    if (!parser.atEnd && parser.peek === '\\') {
      const saved = parser.index;
      parser.nextToken();
      parser.skipVisualSpace();
      if (!parser.atEnd) {
        // The `\` was not trailing junk — restore and let the error path run.
        parser.index = saved;
      }
    }
  }

  // If we didn't reach the end of the input, there was an error
  if (!parser.atEnd) {
    const error = parser.parseSyntaxError();
    // Note: there may still be tokens left in the input, but we will
    // ignore them
    expr = expr !== null ? ['Sequence', expr, error] : error;
  }
  ...
```

Key points the implementer must preserve:
- The `parser.index = saved` rollback is critical: a stray `\` *inside* an expression (followed by more tokens) must continue to produce an error.
- `parser.peek`, `parser.nextToken()`, `parser.skipVisualSpace()`, and `parser.index` are all already used elsewhere in this file — they are available on the concrete `_Parser` instance.

- [ ] **Step 1.4: Re-run the tests and verify they pass**

Run: `npm run test compute-engine/a6-polish`

Expected: all five new tests pass; no other test in the file regresses.

- [ ] **Step 1.5: Run full LaTeX syntax test suite to catch regressions**

Run: `npm run test compute-engine/latex-syntax/parsing` and `npm run test compute-engine/latex-syntax/trigonometry`

Expected: both pass with no new failures. If a previously-snapshotted test now produces a slightly different shape (e.g. an error message that used to mention `\` no longer appears), investigate — the fix should *only* affect inputs that end with a bare `\` after their last meaningful token.

- [ ] **Step 1.6: Type check**

Run: `npm run typecheck`

Expected: no new errors.

---

## Task 2: Lower `\tan^{-1}(y, x)` (and `\sin^{-1}(y, x)` etc.) to 2-argument forms

**Why:** CE already lowers `\arctan(y, x)` to `Arctan2(y, x)` (`definitions-trigonometry.ts:106`). But `\tan^{-1}(y, x)` — the Desmos-style equivalent — produces `["Arctan", "y", ["Error", "'unexpected-argument'", "x"]]`. The cause is that the `^{-1}` postfix converts `Tan` to `InverseFunction(Tan)` (later canonicalized to `Arctan`) *before* `parseTrig`'s 2-arg check, but that check only fires when `fn === 'Arctan'` literally.

**Verified current behavior** (from probing):
```
'\\arctan(y, x)'        => ["Arctan2","y","x"]                                       ✓
'\\tan^{-1}(y, x)'      => ["Arctan","y",["Error","'unexpected-argument'","x"]]      ✗
'\\sin^{-1}(y, x)'      => ["Arcsin","y",["Error","'unexpected-argument'","x"]]      ✗ (only Arctan2 is meaningful;
                                                                                       Arcsin with 2 args should still error,
                                                                                       so we only fix the tangent case)
'\\tan^{-1}(x)'         => ["Arctan","x"]                                            ✓ (must not regress)
```

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-trigonometry.ts` (function `parseTrig`, around line 105)
- Test: `test/compute-engine/a6-polish.test.ts`

- [ ] **Step 2.1: Write failing tests**

Append this block to `test/compute-engine/a6-polish.test.ts`:

```typescript
describe('Desmos compat — \\tan^{-1}(y, x) → Arctan2', () => {
  test('single-arg \\tan^{-1}(x) stays Arctan(x)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan^{-1}(x)');
    expect(expr.operator).toEqual('Arctan');
    expect(expr.ops?.length).toEqual(1);
  });

  test('two-arg \\tan^{-1}(y, x) lowers to Arctan2(y, x)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan^{-1}(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
    expect(expr.isValid).toBe(true);
  });

  test('two-arg \\tan^{-1} inside a larger expression', () => {
    const ce = new ComputeEngine();
    // Mirrors the Desmos "Domain coloring" row from the corpus:
    //   p + u\tan^{-1}(\operatorname{imag}(...), \operatorname{real}(...))
    const expr = ce.parse(
      '\\tan^{-1}(\\operatorname{imag}(z), \\operatorname{real}(z))'
    );
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.isValid).toBe(true);
  });

  test('\\arctan(y, x) still lowers to Arctan2 (regression)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
  });

  test('\\sin^{-1}(x) still parses as Arcsin (regression)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin^{-1}(x)');
    expect(expr.operator).toEqual('Arcsin');
    expect(expr.ops?.length).toEqual(1);
  });
});
```

- [ ] **Step 2.2: Run the new tests and verify they fail**

Run: `npm run test compute-engine/a6-polish`

Expected: the two-arg tests fail (current output has `Arctan` + unexpected-argument error). The single-arg regression tests pass already.

- [ ] **Step 2.3: Implement the fix**

In `src/compute-engine/latex-syntax/dictionary/definitions-trigonometry.ts`, locate the line:

```typescript
    // Desmos compatibility: `\arctan(y, x)` is the 2-arg atan2.
    const head = fn === 'Arctan' && args?.length === 2 ? 'Arctan2' : fn;
```

(around line 105–106). Replace those two lines with:

```typescript
    // Desmos compatibility: `\arctan(y, x)` and `\tan^{-1}(y, x)` are
    // both 2-arg atan2. The first case: `fn` is the literal string
    // 'Arctan' (from \arctan via trigCommands). The second case: the
    // ^{-1} postfix has wrapped the operator as ['InverseFunction', 'Tan'],
    // which would otherwise canonicalize to Arctan only after parsing.
    const isTwoArgArctan =
      args?.length === 2 &&
      (fn === 'Arctan' ||
        (Array.isArray(fn) &&
          fn[0] === 'InverseFunction' &&
          fn[1] === 'Tan'));
    const head = isTwoArgArctan ? 'Arctan2' : fn;
```

Important: do NOT also rewrite `appliedFn` when `head` is `Arctan2`. The existing line just below already handles the `typeof head === 'string'` branch correctly — when `isTwoArgArctan` is true, head is the string `'Arctan2'`, so we get `['Arctan2', ...args]`.

- [ ] **Step 2.4: Run the tests and verify they pass**

Run: `npm run test compute-engine/a6-polish`

Expected: all new tests pass plus all previously-passing tests in the file. In particular the existing `'A6 polish — 2-arg arctan → Arctan2'` block must still pass unchanged.

- [ ] **Step 2.5: Run trig-adjacent test suites**

Run these three in sequence (or in parallel from separate shells if convenient):
- `npm run test compute-engine/latex-syntax/trigonometry`
- `npm run test compute-engine/trigonometry`
- `npm run test compute-engine/latex-syntax/stefnotch`

Expected: all pass. The `stefnotch` suite exercises `\sin^{-1}` derivatives which must not be perturbed (we only changed the Tan 2-arg case, but verify).

- [ ] **Step 2.6: Type check**

Run: `npm run typecheck`

Expected: no new errors.

---

## Task 3: Investigate "tuples in function-call arguments" claim

**Why:** The GP audit lists 3 duplicate rows under this category. Initial probing (already done while drafting this plan) shows the well-formed cases *already parse correctly*. The actually-failing corpus row (`azajxdjjn7/latex@33 Poly Banana`) has malformed LaTeX with unbalanced `\left`/`\right`. This task confirms the finding, adds regression tests for the working cases, and writes up the conclusion so GP can re-classify the audit.

**No code changes are expected in this task.** If the investigation reveals a genuine gap, stop and ask before extending scope.

**Files:**
- Read: corpus rows in `/Users/arno/dev/tycho/_TASK/desmos/desmos-corpus/AUDIT_PARSE_ERRORS.md` (lines mentioning `triangle`).
- Read: full LaTeX of `khpocp8io0` rows 37–38 in `/Users/arno/dev/tycho/_TASK/desmos/desmos-corpus/states/khpocp8io0.json`.
- Test: `test/compute-engine/a6-polish.test.ts`.
- Create: `docs/desmos-compat-notes.md` (short investigation write-up; only this file is genuinely new).

- [ ] **Step 3.1: Reproduce each cited row in isolation**

Create a temporary probe file at `/tmp/desmos-tuple-probe.ts`:

```typescript
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
const ce = new ComputeEngine();

// (a) The original example cited by GP:
const a = '\\operatorname{triangle}\\left((-3.3,1,1.2),(-2,1.9,1.3),(-2.5,2.5,1.4)\\right)';

// (b) Gomoku row 37 (real corpus, abbreviated for readability — see notes
// below for full LaTeX). Tuples are written with \left(\right) instead of
// plain ( ).
const b =
  '\\operatorname{triangle}\\left(' +
  '\\left(1, 2, 3\\right),' +
  '\\left(4, 5, 6\\right),' +
  '\\left(7, 8, 9\\right)' +
  '\\right)';

// (c) Poly Banana row 33: malformed (unbalanced \left/\right):
const c =
  '\\operatorname{triangle}\\left((-3.3,1,1.2),(-2,1.9,1.3),(-1.65,1.2,1.2\\right))';

for (const [label, s] of [['(a)', a], ['(b)', b], ['(c)', c]] as const) {
  const e = ce.parse(s);
  console.log(label, JSON.stringify(e?.json));
  console.log('   isValid:', e?.isValid);
}
```

Run: `npx tsx /tmp/desmos-tuple-probe.ts`

Expected output (pre-verified during plan drafting):
- (a) `["Triangle",["Tuple",-3.3,1,1.2],["Tuple",-2,1.9,1.3],["Tuple",-2.5,2.5,1.4]]` — `isValid: true`
- (b) `["Triangle",["Tuple",1,2,3],["Tuple",4,5,6],["Tuple",7,8,9]]` — `isValid: true`
- (c) `["Tuple","Triangle", … unexpected-command '\\left' …]` — `isValid: false`

If (a) or (b) does *not* match the expected output, STOP — that means tuple parsing has regressed since the plan was drafted, and the investigation conclusion below no longer holds.

- [ ] **Step 3.2: Confirm the Gomoku row in full**

Read `/Users/arno/dev/tycho/_TASK/desmos/desmos-corpus/states/khpocp8io0.json` and extract `expressions.list[37].latex`. Pass the full string through `ce.parse(...)` and confirm `isValid === true`. (If the file is too large to read in one go, use jq or a Python one-liner; do NOT bypass the read.)

If `isValid` is false for the full Gomoku LaTeX, the simplified test case (b) was insufficient — investigate and report. Otherwise, the simplified case captures the relevant parsing path.

- [ ] **Step 3.3: Add regression tests for the working cases**

Append this block to `test/compute-engine/a6-polish.test.ts`:

```typescript
describe('Desmos compat — tuples inside function-call arguments', () => {
  test('triangle with plain-paren tuples (3-component points)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{triangle}\\left((-3.3,1,1.2),(-2,1.9,1.3),(-2.5,2.5,1.4)\\right)'
    );
    expect(expr.operator).toEqual('Triangle');
    expect(expr.ops?.length).toEqual(3);
    expect(expr.isValid).toBe(true);
  });

  test('triangle with \\left(\\right) tuples (Gomoku-style)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{triangle}\\left(' +
        '\\left(1, 2, 3\\right),' +
        '\\left(4, 5, 6\\right),' +
        '\\left(7, 8, 9\\right)' +
      '\\right)'
    );
    expect(expr.operator).toEqual('Triangle');
    expect(expr.ops?.length).toEqual(3);
    expect(expr.isValid).toBe(true);
  });

  test('arbitrary function with tuple arguments', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f\\left(\\left(1, 2\\right), \\left(3, 4\\right)\\right)');
    expect(expr.operator).toEqual('f');
    expect(expr.ops?.length).toEqual(2);
    expect(expr.isValid).toBe(true);
  });
});
```

- [ ] **Step 3.4: Run the regression tests**

Run: `npm run test compute-engine/a6-polish`

Expected: all three new tests pass without any code change to CE.

- [ ] **Step 3.5: Write the investigation note**

Create `docs/desmos-compat-notes.md` with exactly this content (no extra sections, no marketing fluff):

```markdown
# Desmos Compatibility Notes — Tuple Parsing in Function Arguments

Investigated: 2026-05-12. Reporter: GP team, Desmos corpus audit
(`_TASK/desmos/desmos-corpus/AUDIT_PARSE_ERRORS.md`).

## Conclusion

CE already parses tuples inside function-call arguments correctly, both
with plain parentheses and with `\left(\right)` brackets. Regression
tests live in `test/compute-engine/a6-polish.test.ts` under
`describe('Desmos compat — tuples inside function-call arguments')`.

## Per-row breakdown

- `azajxdjjn7/latex@33 Poly Banana`: malformed LaTeX. The expression
  ends `...(-1.65,1.2,1.2\right))` — the inner `(` is never closed
  before `\right)` is consumed. Desmos appears to match `\right`
  against any open delimiter (or no delimiter at all); CE matches
  `\left`/`\right` strictly. This is not a tuple-parsing gap; it is a
  delimiter-matching laxness gap. Recommend the importer detect and
  repair unbalanced `\right` rather than relaxing CE.

- `khpocp8io0/latex@37`, `khpocp8io0/latex@38` (Gomoku): tuples written
  as `\left(a, b, c\right)`. Verified to parse correctly (see test
  `triangle with \left(\right) tuples (Gomoku-style)`). The audit
  classification appears to have been a false positive.
```

- [ ] **Step 3.6: Type check**

Run: `npm run typecheck`

Expected: no new errors (no production code changed).

---

## Final verification (after all three tasks)

- [ ] **Step F.1: Run the full polish suite**

Run: `npm run test compute-engine/a6-polish`

Expected: every test in the file passes.

- [ ] **Step F.2: Run the broader LaTeX-syntax suites**

Run, sequentially:
- `npm run test compute-engine/latex-syntax/parsing`
- `npm run test compute-engine/latex-syntax/trigonometry`
- `npm run test compute-engine/latex-syntax/stefnotch`
- `npm run test compute-engine/trigonometry`

Expected: all pass. If any test produces an inline-snapshot diff, read the diff carefully — Task 1 should only change behavior for inputs ending in a bare `\`, and Task 2 should only change behavior for `\tan^{-1}(y, x)` (two args).

- [ ] **Step F.3: Type check the whole project**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step F.4: Report results to the user**

Summarize for the user:
- Which audit rows are now expected to pass (the 8 trailing-`\` rows, the Domain-coloring row, both Gomoku rows).
- Which audit row remains a known gap (`azajxdjjn7` Poly Banana — unbalanced `\right`, recommended for importer-side repair).
- Note that no commits have been made; user should review `git status` / `git diff` and commit when ready.

---

## Out of scope (deliberately)

These were considered and rejected during planning. Do NOT add them while implementing:

- The Tuple-wrapping anomaly on `\operatorname{hsv}(1,1,1)\,` (color constructors wrap in `Tuple` when followed by `\,`). This is a separate bug unrelated to the three issues above; it does not appear in the cited audit rows. File a separate ticket.
- Relaxing `\left`/`\right` matching (would address Poly Banana but is a much larger change with ambiguous semantics; the importer is a better fix point).
- Items 2, 3, 4 from the GP feedback (trailing `1.`, leading-decimal implicit multiply, `.member` access). User is pushing these back to the importer team.
