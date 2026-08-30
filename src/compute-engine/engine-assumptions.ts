import type {
  Expression,
  BoxedSubstitution,
  IComputeEngine,
  AssumeResult,
} from './global-types.js';

import type { MathJsonSymbol } from '../math-json/types.js';

import { isWildcard, wildcardName } from './boxed-expression/pattern-utils.js';
import { isSymbol, isFunction } from './boxed-expression/type-guards.js';
import {
  contextAssumptions,
  isFactTrue,
  subjectOf,
} from './boxed-expression/constraint-subject.js';
import { isValueDef } from './boxed-expression/utils.js';
import type { BoxedValueDefinition } from './types-definitions.js';

import {
  assume as assumeImpl,
  getInequalityBoundsFromAssumptions,
} from './assume.js';

import { asLatexString } from './latex-syntax/utils.js';
import { parse as parseLatex } from './latex-syntax/latex-syntax.js';

/**
 * Normalize a predicate argument that may be a string.
 *
 * `assume()` and `verify()` accept a predicate as a `BoxedExpression`, a
 * MathJSON expression, or a **string**. A string is parsed as LaTeX:
 *
 * - `$…$` / `$$…$$`-delimited: the delimiters are stripped, then parsed
 *   (`asLatexString`).
 * - any other string (a bare infix predicate like `'x > 0'`, or one
 *   containing LaTeX commands like `'\\pi > 0'`): parsed directly as LaTeX —
 *   `ce.parse` handles infix relational operators.
 *
 * Throws a clear error if the string cannot be parsed into a valid
 * expression.
 *
 * A **non-string** input is boxed raw, exactly preserving the previous
 * behavior (an already-canonical `BoxedExpression` stays canonical). A
 * **string** is boxed CANONICALLY: a freshly parsed relational such as
 * `Less(x, 0)` only reduces against the assumptions DB (`x < 0 → False` under
 * `assume(x > 0)`) once its operator definition is bound, i.e. in canonical
 * form — a raw parse would evaluate back to itself and `verify()` would return
 * `undefined` where the boxed-expression path returns `false`.
 */
function predicateFromArg(
  ce: IComputeEngine,
  predicate: Expression | string,
  who: 'assume' | 'verify'
): Expression {
  if (typeof predicate !== 'string') return ce.expr(predicate, { form: 'raw' });

  // `asLatexString` strips `$…$`/`$$…$$`; a plain string is used verbatim.
  const latex = asLatexString(predicate) ?? predicate;
  const parsed = parseLatex(latex);
  const boxed = parsed === null ? null : ce.expr(parsed);
  if (boxed === null || !boxed.isValid)
    throw new Error(
      `${who}(): cannot parse the predicate string ${JSON.stringify(
        predicate
      )} as a mathematical expression`
    );
  return boxed;
}

export function ask(
  ce: IComputeEngine,
  pattern: Expression
): BoxedSubstitution[] {
  const pat = ce.expr(pattern, { form: 'raw' });
  const result: BoxedSubstitution[] = [];

  const patternHasWildcards = (expr: Expression): boolean => {
    if (expr.operator.startsWith('_')) return true;
    if (isWildcard(expr)) return true;
    if (isFunction(expr)) return expr.ops.some(patternHasWildcards);
    return false;
  };

  const pushResult = (m: BoxedSubstitution) => {
    const keys = Object.keys(m).sort();
    for (const prev of result) {
      const prevKeys = Object.keys(prev).sort();
      if (prevKeys.length !== keys.length) continue;
      let same = true;
      for (let i = 0; i < keys.length; i++) {
        if (prevKeys[i] !== keys[i]) {
          same = false;
          break;
        }
        const k = keys[i]!;
        if (!m[k]!.isSame(prev[k]!)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    result.push(m);
  };

  const assumptions = contextAssumptions(ce);

  const candidatesFromAssumptions = (): string[] => {
    const candidates = new Set<string>();
    for (const [assumption, records] of assumptions) {
      if (!isFactTrue(records)) continue;
      for (const s of assumption.symbols) candidates.add(s);
    }
    return [...candidates];
  };

  const normalizedInequalityPatterns = (
    expr: Expression
  ): Array<{ pattern: Expression; matchPermutations?: boolean }> => {
    const op = expr.operator;

    // Equalities are stored as `Equal(lhs - rhs, 0)` (assume.ts, Cases 3 & 4:
    // e.g. `x + y = 5` → `Equal(Add(x, y, −5), 0)`, `x² = 4` → `Equal(Add(x²,
    // −4), 0)`). Try both the verbatim query and the normalized diff form so
    // that `verify`/`ask` recover these stored equalities (P1-3, P1-4).
    if (op === 'Equal') {
      if (!isFunction(expr) || expr.ops.length !== 2)
        return [{ pattern: expr }];
      const diff = expr.op1.canonical.sub(expr.op2.canonical);
      return [
        { pattern: expr },
        { pattern: ce.expr(['Equal', diff, 0]), matchPermutations: false },
      ];
    }

    if (
      op !== 'Less' &&
      op !== 'LessEqual' &&
      op !== 'Greater' &&
      op !== 'GreaterEqual'
    )
      return [{ pattern: expr }];

    if (!isFunction(expr)) return [{ pattern: expr }];
    const lhs = op === 'Greater' || op === 'GreaterEqual' ? expr.op2 : expr.op1;
    const rhs = op === 'Greater' || op === 'GreaterEqual' ? expr.op1 : expr.op2;
    const normalizedOp =
      op === 'Less' || op === 'Greater' ? 'Less' : 'LessEqual';

    // Normalize to Less/LessEqual with RHS = 0, matching how assumptions are stored:
    //   Greater(a, b) -> Less(b - a, 0)
    //   Less(a, b)    -> Less(a - b, 0)
    //
    // Build the difference with the same arithmetic `assumeInequality` uses to
    // store the fact (P1-4): `.sub()` distributes the negation over a sum, so
    // `x + y > 0` is stored as `Less(Add(Negate(x), Negate(y)), 0)`. A pattern
    // built structurally (`Less(Negate(Add(x, y)), 0)`) would never
    // `isSame`-match that with `matchPermutations: false`. Operate on canonical
    // operands, as `assumeInequality` does.
    const diff = lhs.canonical.sub(rhs.canonical);
    return [
      { pattern: expr },
      // For the normalized form, disable permutations: for commutative
      // subexpressions (notably Add), allowing permutations can lead to
      // ambiguous wildcard bindings and duplicate, surprising matches.
      {
        pattern: ce.expr([normalizedOp, diff, 0]),
        matchPermutations: false,
      },
    ];
  };

  // B1: Element(x, _T) can be answered from the declared/inferred type of x
  if (isFunction(pat, 'Element')) {
    const patOp1 = pat.op1;
    const patOp2 = pat.op2;
    if (isSymbol(patOp1) && isWildcard(patOp2)) {
      const typeWildcard = wildcardName(patOp2);
      if (typeWildcard && !typeWildcard.startsWith('__')) {
        const symbolType = ce.expr(patOp1.symbol).type;
        if (!symbolType.isUnknown) {
          pushResult({
            [typeWildcard]: ce.expr(symbolType.toString(), {
              form: 'raw',
            }),
          });
        }
      }
    }
  }

  // B2: Inequality bound queries, e.g. Greater(x, _k) -> {_k: lowerBound}
  if (
    (pat.operator === 'Greater' ||
      pat.operator === 'GreaterEqual' ||
      pat.operator === 'Less' ||
      pat.operator === 'LessEqual') &&
    isFunction(pat) &&
    isWildcard(pat.op2)
  ) {
    const boundWildcard = wildcardName(pat.op2);
    if (boundWildcard && !boundWildcard.startsWith('__')) {
      const isLower =
        pat.operator === 'Greater' || pat.operator === 'GreaterEqual';
      const isStrict = pat.operator === 'Greater' || pat.operator === 'Less';

      // Subject on LHS: a bare symbol — Greater(x, _k) — or a part
      // extractor of one (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §2):
      // Greater(Real(s), _k), Greater(Imaginary(tau), _k), Less(Abs(q), _k),
      // Less(Argument(z), _k). The bare-symbol case behaves exactly as
      // before (subjectOf maps it to the 'self' part).
      const patOp1B2 = pat.op1;
      const subject = subjectOf(patOp1B2);
      if (subject !== undefined) {
        const bounds = getInequalityBoundsFromAssumptions(ce, subject);
        const bound = isLower ? bounds.lower : bounds.upper;
        const strictOk = isLower ? bounds.lowerStrict : bounds.upperStrict;
        if (bound !== undefined && (!isStrict || strictOk === true))
          pushResult({ [boundWildcard]: bound });
      }

      // Wildcard on LHS: Greater(_x, _k)
      if (isWildcard(patOp1B2)) {
        const symbolWildcard = wildcardName(patOp1B2);
        if (symbolWildcard && !symbolWildcard.startsWith('__')) {
          for (const s of candidatesFromAssumptions()) {
            const bounds = getInequalityBoundsFromAssumptions(ce, s);
            const bound = isLower ? bounds.lower : bounds.upper;
            const strictOk = isLower ? bounds.lowerStrict : bounds.upperStrict;
            if (bound === undefined || (isStrict && strictOk !== true))
              continue;
            pushResult({
              [symbolWildcard]: ce.expr(s, { form: 'canonical' }),
              [boundWildcard]: bound,
            });
          }
        }
      }
    }
  }

  // B2b: Flipped canonical bound queries (P1-5). Canonicalization normalizes
  // `Greater(x, _k)` → `Less(_k, x)` and `GreaterEqual(x, _k)` →
  // `LessEqual(_k, x)`, moving the wildcard bound onto op1 and the subject onto
  // op2. A caller who pre-boxes the pattern (`ce.expr(['Greater','x','_k'])`)
  // hits this form. `_k < x` (resp. `≤`) is a *lower*-bound query on `x`.
  if (
    (pat.operator === 'Less' || pat.operator === 'LessEqual') &&
    isFunction(pat) &&
    isWildcard(pat.op1) &&
    !isWildcard(pat.op2)
  ) {
    const boundWildcard = wildcardName(pat.op1);
    if (boundWildcard && !boundWildcard.startsWith('__')) {
      const isStrict = pat.operator === 'Less';
      const subject = subjectOf(pat.op2);
      if (subject !== undefined) {
        const bounds = getInequalityBoundsFromAssumptions(ce, subject);
        if (
          bounds.lower !== undefined &&
          (!isStrict || bounds.lowerStrict === true)
        )
          pushResult({ [boundWildcard]: bounds.lower });
      }
    }
  }

  const patternsToTry = normalizedInequalityPatterns(pat);
  for (const [assumption, records] of assumptions) {
    if (!isFactTrue(records)) continue;
    for (const { pattern: p, matchPermutations } of patternsToTry) {
      const m = assumption.match(p, {
        useVariations: true,
        matchPermutations,
      });
      if (m !== null) pushResult(m);
    }
  }

  // B3: For closed predicates (no wildcards), fall back to verify().
  // This makes `ask()` useful for "is this known?" queries even when the
  // fact is not explicitly stored in the assumptions DB (e.g. declarations).
  //
  // IMPORTANT: Skip this if we're already inside a verify() call to prevent
  // infinite recursion. The recursion occurs when:
  //   verify(Equal(x,0)) → Equal.evaluate() → eq() → ask(NotEqual(x,0)) → verify()
  // By checking _isVerifying, we break this cycle.
  if (result.length === 0 && !patternHasWildcards(pat) && !ce._isVerifying) {
    // Use the canonical form so symbol declarations/definitions are visible
    // to the evaluator.
    const verified = verify(ce, ce.expr(pattern, { form: 'canonical' }));
    if (verified === true) pushResult({});
  }

  return result;
}

export function verify(
  ce: IComputeEngine,
  query: Expression | string
): boolean | undefined {
  // Prevent recursive verify() -> ask() -> verify() loops. The `_isVerifying`
  // flag is set once, here, at the OUTERMOST call; the logical recursion below
  // goes through `verifyInner`, which does NOT re-check the flag (SYM P3-2 —
  // the previous `verify()`-recurses-into-`verify()` shape was dead code: the
  // inner calls hit `ce._isVerifying === true` and returned `undefined`, so
  // compound predicates were only ever decided by `evaluate()`'s own
  // reduction). `ask()` still reads the flag to disable its B3 fallback.
  if (ce._isVerifying) return undefined;

  ce._isVerifying = true;
  try {
    return verifyInner(ce, query);
  } finally {
    ce._isVerifying = false;
  }
}

/**
 * The recursive core of `verify()`. Must only be reached while
 * `ce._isVerifying` is already `true` (i.e. from `verify()` or from itself),
 * so the Kleene `And`/`Or`/`Not` recursion runs instead of short-circuiting on
 * the non-reentrant flag (SYM P3-2).
 */
function verifyInner(
  ce: IComputeEngine,
  query: Expression | string
): boolean | undefined {
  // Accept string predicates ('x > 0', '$x > 0$', '\\pi > 0'); throws on
  // unparseable input (SYM P3-1).
  const boxed = predicateFromArg(ce, query, 'verify');

  const expr = boxed.evaluate();
  if (isSymbol(expr)) {
    if (expr.symbol === 'True') return true;
    if (expr.symbol === 'False') return false;
  }

  const op = expr.operator;

  if (op === 'Not' && isFunction(expr)) {
    const result = verifyInner(ce, expr.op1);
    if (result === undefined) return undefined;
    return !result;
  }

  if (op === 'And' && isFunction(expr)) {
    // Kleene 3-valued logic:
    // - if any operand is false, the result is false
    // - if all operands are true, the result is true
    // - otherwise the result is unknown
    let hasUnknown = false;
    for (const x of expr.ops) {
      const r = verifyInner(ce, x);
      if (r === false) return false;
      if (r === undefined) hasUnknown = true;
    }
    return hasUnknown ? undefined : true;
  }

  if (op === 'Or' && isFunction(expr)) {
    // Kleene 3-valued logic:
    // - if any operand is true, the result is true
    // - if all operands are false, the result is false
    // - otherwise the result is unknown
    let hasUnknown = false;
    for (const x of expr.ops) {
      const r = verifyInner(ce, x);
      if (r === true) return true;
      if (r === undefined) hasUnknown = true;
    }
    return hasUnknown ? undefined : false;
  }

  // Direct assumption-DB lookup (P1-4): `assume(P) ⇒ verify(P)`. Some facts
  // (opaque multi-symbol inequalities like `x·y > 0` or `x + y > 0`) are
  // stored verbatim but cannot be decided by the evaluator, so the paths
  // above leave them `undefined`. Consult the DB via `ask`, which matches
  // the query against the stored (normalized) facts. `ask` runs with
  // `_isVerifying` set, so its own closed-predicate `verify` fallback (B3)
  // is disabled and cannot recurse back into this function. A closed
  // predicate that is stored yields an empty-substitution match.
  if (!exprHasWildcards(boxed)) {
    const matches = ask(ce, boxed);
    if (matches.some((m) => Object.keys(m).length === 0)) return true;
  }

  return undefined;
}

/** True if `expr` contains a wildcard (a symbol/operator starting with `_`). */
function exprHasWildcards(expr: Expression): boolean {
  if (expr.operator.startsWith('_')) return true;
  if (isWildcard(expr)) return true;
  if (isFunction(expr)) return expr.ops.some(exprHasWildcards);
  return false;
}

/**
 * Refuse a fact MUTATION made from inside a fact-blind bracket
 * (`ce._withoutFacts`, the window every type-write routine runs in).
 *
 * Such a call reads an empty store and would decide entailment, tautology and
 * contradiction against facts it cannot see, then commit the result to the
 * real store. There is no sensible answer, so it is a program error rather
 * than a silently wrong one.
 */
function assertFactsVisible(ce: IComputeEngine, operation: string): void {
  if (ce._factSuppressionDepth > 0)
    throw new Error(
      `"${operation}" cannot run while the assumptions are hidden: a computation whose result is stored must not change what is assumed`
    );
}

export function assumeFn(
  ce: IComputeEngine,
  predicate: Expression | string
): AssumeResult {
  assertFactsVisible(ce, 'assume');
  try {
    // Accept string predicates ('x > 0', '$x > 0$', '\\pi > 0') — parsed as
    // LaTeX by the shared `predicateFromArg` helper, consistent with verify()
    // (SYM P3-1). Then canonicalize the predicate so the assumption machinery
    // sees a normalized form regardless of how the caller boxed it (e.g.
    // `Negate(ImaginaryUnit)` folded to the complex literal `-i`).
    // Canonicalization normalizes structure without evaluating the predicate,
    // so `Greater(x, 0)` etc. stay intact. (Historically this boxed with
    // `{ canonical: false }`, which was silently ignored and so always
    // produced a canonical predicate; a later refactor swapped it to
    // `{ form: 'raw' }`, inadvertently feeding raw predicates through.)
    const raw = predicateFromArg(ce, predicate, 'assume');

    // The names the proposition mentions that nothing has declared YET.
    // Canonicalizing below binds every free symbol it mentions, so this is the
    // last moment at which a binding the assumption is answerable for can be
    // told from one the user made: a transaction that rolls back — or a
    // conjunct the assumptions layer refuses — has to leave the scope as it
    // found it. (A caller who canonicalizes the predicate itself, as
    // `ce.assume(ce.parse('x > 3'))` does, has already bound them; the
    // transaction then has nothing to answer for and leaves them alone.)
    const undeclared = raw.symbols.filter(
      (s) => ce.lookupDefinition(s) === undefined
    );

    const pred = raw.canonical;

    // Popping this context silently reverts the assumption: mark it so the
    // pop bumps `_semanticVersion` too (clean pops don't). The `assumption`
    // state event itself is emitted by `assume()` on EVERY outcome, a rollback
    // included, so emitting one here as well would be a second advance for the
    // same change.
    if (ce.context) ce.context._assumptionsDirty = true;

    return assumeImpl(pred, undeclared);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * Every value definition `name` is bound to along the current context's
 * lexical scope chain — the innermost binding and each one it shadows.
 *
 * `forget(name)` removes what the name reaches from HERE: an assertion
 * recorded against an enclosing scope's definition is in force in this
 * context and must go, while a definition of the same name in a sibling
 * scope is not reachable and is left alone.
 */
function valueDefinitionsNamed(
  ce: IComputeEngine,
  name: MathJsonSymbol
): Set<BoxedValueDefinition> {
  const result = new Set<BoxedValueDefinition>();
  let scope: IComputeEngine['context']['lexicalScope'] | null | undefined =
    ce.context?.lexicalScope;
  while (scope) {
    const binding = scope.bindings.get(name);
    if (binding !== undefined && isValueDef(binding)) result.add(binding.value);
    scope = scope.parent;
  }
  return result;
}

export function forget(
  ce: IComputeEngine,
  symbol: undefined | MathJsonSymbol | MathJsonSymbol[]
): void {
  //
  // ## THEORY OF OPERATIONS
  //
  // Forgetting removes FACTS. Existing definitions are preserved —
  // expressions point at them — and their declared TYPES are never touched,
  // because an assumption never wrote one: a type an assumption proved was
  // merged in by the READ, so dropping the fact is all it takes for the read
  // to stop proving it. A value an assumption installed lives in the
  // context's assumed-value overlay, not on the definition, so dropping the
  // overlay entry is all that form of retraction takes either.
  //
  // The one-name form does one thing more, as it always has: it resets the
  // VALUE of the current scope's binding of that name, whoever wrote it. The
  // no-argument form does not — a user `assign()` value survives it.
  //

  assertFactsVisible(ce, 'forget');

  if (symbol === undefined) {
    ce.context.assumptions?.clear();
    // The overlay holds the values `assume(x = …)` put in force, so a
    // no-argument forget drops it whole, exactly like the fact map. A user
    // `declare()`/`assign()` value is stored on the definition and is
    // untouched.
    ce.context.assumedValues?.clear();

    // The removed assumptions could affect existing expressions
    ce._noteStateEvent({ kind: 'assumption' });
    if (ce.context) ce.context._assumptionsDirty = true;

    return;
  }

  if (Array.isArray(symbol)) {
    for (const x of symbol) forget(ce, x);
    return;
  }

  if (typeof symbol === 'string') {
    // Remove any assumptions that make a reference to this symbol
    // (note that when a scope is created, any assumptions from the
    // parent scope are copied over, so this effectively removes any
    // reference to this symbol, even if there are assumptions about
    // it in a parent scope. However, when the current scope exits,
    // any previous assumptions about the symbol will be restored).
    //
    // Two reasons to drop an entry, because an assertion is recorded against
    // a DEFINITION while the fact expression is written with NAMES:
    // an assertion whose subjects include a definition this name is bound to
    // in the current context, and — the historical test, kept so this never
    // removes less than it used to — any fact whose expression mentions the
    // name at all (a fact about a symbol with no value definition has no
    // subject to match). Dropping the last assertion of a key drops the key.
    const definitions = valueDefinitionsNamed(ce, symbol);
    for (const [assumption, records] of [...ce.context.assumptions.entries()]) {
      if (assumption.has(symbol)) {
        ce.context.assumptions.delete(assumption);
        continue;
      }
      const kept = records.filter(
        (record) => !record.subjects.some((s) => definitions.has(s.def))
      );
      if (kept.length === records.length) continue;
      if (kept.length === 0) ce.context.assumptions.delete(assumption);
      else ce.context.assumptions.set(assumption, kept);
    }

    // The overlay is keyed by definition, so drop the entry of every
    // definition this name reaches in the current context — the same reach
    // the fact loop above uses.
    for (const def of definitions) ce.context.assumedValues.delete(def);

    // `forget(name)` also resets the VALUE of the current scope's binding, as
    // the theory of operations above states: the value goes, the declared
    // type stays. This is broader than the assumption store — a
    // `declare(name, { value })` value goes too — and it is the documented
    // behavior of the one-name form, unlike the no-argument form, which
    // drops only what the assumptions put in force.
    const scopeBinding = ce.context.lexicalScope.bindings.get(symbol);
    if (
      scopeBinding &&
      isValueDef(scopeBinding) &&
      !scopeBinding.value.isConstant
    )
      scopeBinding.value.value = undefined;
  }
  // The removed assumptions could affect existing expressions
  ce._noteStateEvent({ kind: 'assumption' });
  if (ce.context) ce.context._assumptionsDirty = true;
}
