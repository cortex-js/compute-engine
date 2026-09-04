import type { MathJsonExpression } from '../math-json/types.js';
import {
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import type { Type } from '../common/type/types.js';
import { declarationOf } from '../common/type/reference.js';
import { sumVariantInfo } from '../compute-engine/sum-representation.js';

// Type-only import: like `static-diagnostics.ts`, this module never
// statically imports the engine — the engine is injected at call time.
import type { ComputeEngine } from '../compute-engine.js';

import type { ParsingDiagnostic } from './diagnostics.js';

/**
 * The `match` EXHAUSTIVENESS lint, one of the static checks `epsil check`
 * and `executeEpsil` run before anything evaluates.
 *
 * A `match` whose subject has a CLOSED type — a sugar-declared sum
 * (`type light = red | green | yellow`) or `boolean` — is checked for a case
 * that every inhabitant can reach. A subject the cases do not cover reports a
 * `match-not-exhaustive` warning naming the uncovered alternatives:
 *
 * ```epsil
 * type light = red | green | yellow
 * function canGo(t: light) -> boolean {
 *   match t {
 *     green() => true        // warning: `red()`, `yellow()` reach no case
 *   }
 * }
 * ```
 *
 * It is a warning, not an error: a subject no case matches is a legitimate
 * program that evaluates to the `match-no-case` error VALUE, so the lint
 * reports a likely mistake, never a rejected program.
 *
 * ## Which types are closed
 *
 * The lint claims a type is closed only when it can enumerate the type's
 * inhabitants from a declaration, so a `match` it accepts really cannot fall
 * through:
 *
 * - a SUGAR-DECLARED SUM (`declareSumType` writes the `_sumVariants` record
 *   the enumeration reads), reached by name, through an alias of the name, or
 *   as the union of its variants — which is what an applied generic sum
 *   (`tree<number>`) expands to;
 * - a UNION whose members are all variants of sugar-declared sums (`t: red |
 *   green`): every member is a nominal tag, so the value is one of exactly
 *   those;
 * - a single variant (`n: node<integer>`);
 * - `boolean`, covered by `true` and `false`.
 *
 * Every other type is treated as OPEN and never reported: a hand-assembled
 * union of nominals, a union with a non-variant member (`light | nothing`),
 * `integer`, `string`, and every structural type. The lint never claims
 * exhaustiveness it cannot prove — and, symmetrically, never reports a
 * `match` whose subject type it cannot read.
 *
 * Silence is a weaker statement than a warning: it means the lint found no
 * uncovered alternative, not that the `match` is total. Two subjects of a
 * closed type still reach no case when every alternative is covered: a
 * `boolean` that stays SYMBOLIC (an undecided comparison such as `x < 3`
 * with `x` unknown is typed `boolean` but is neither `true` nor `false`),
 * and a declared name with no value (`let u: light` and no initializer
 * evaluates to the symbol `u`). A final `_` case is the idiom for either.
 *
 * ## Where the subject's type comes from
 *
 * The parser writes each annotation into the AST (`Typed(t, "light")` on a
 * parameter, the type operand of a `Declare`), and the walk keeps a lexical
 * map from a name to its annotation as it descends: function parameters,
 * typed `let`/`const` declarations, and typed `match` bindings (`x: light =>
 * …`) add to it; every other binding form the walk knows — an untyped `let`,
 * a `for` element, a `match` capture, an unannotated parameter — REMOVES the
 * name, so a shadowed name reads as unknown rather than as its outer type.
 * Only a subject that is a bare, annotated name is checked: the boxed
 * subject's own static type cannot serve, because a parameter's type does not
 * survive the canonicalization of its function body (the parameter scope is
 * popped by then and the symbol reads `unknown`).
 *
 * ## What counts as covering an alternative
 *
 * With the subject's alternatives enumerated, each case contributes what it
 * matches UNCONDITIONALLY:
 *
 * - a wildcard or bare binding (`_`, `x`) with no guard covers everything;
 * - a constructor pattern whose operands are all wildcards (`red()`,
 *   `node(_, _)`, `node(v, ...)`), with no guard, covers that variant — an
 *   operand that is a literal, a pin or a nested shape makes the case
 *   conditional, and the operand count must fit the variant's arity (a rest
 *   wildcard `...` fits any remainder);
 * - `true` / `false` cover the boolean inhabitants;
 * - a typed binding (`x: green`, `x: light`) covers the alternatives of ITS
 *   annotation's closed type, and a binding typed `any`, `unknown` or
 *   `expression` covers everything;
 * - or-alternatives (`red() | yellow()`) cover the union of their arms;
 * - any other guard makes the case cover nothing: the lint does not reason
 *   about guard conditions.
 *
 * The parser writes a typed binding as the binding plus an implicit
 * `MatchesType(name, TypeFrom("T"))` guard, and folds an explicit `if` guard
 * into an `And` with it — so a guard that is exactly one `MatchesType` on the
 * pattern's own binding IS the typed-binding form, and any `And` is a real
 * guard.
 */

/** A closed type: its written label and the alternatives that inhabit it. */
interface ClosedType {
  /** The annotation as the program wrote it (`light`, `tree<number>`). */
  label: string;
  alternatives: Alternative[];
}

/** One inhabitant of a closed type. */
type Alternative =
  | {
      kind: 'variant';
      /** The variant's name — its constructor's name and its pattern head. */
      name: string;
      /** The constructor's operand count: 0 for a payload-free variant, the
       * element count for a tuple payload, 1 for any other payload. */
      arity: number;
    }
  | { kind: 'boolean'; name: 'True' | 'False' };

/** Name → annotation text, for the names in scope at the point of the walk.
 * A name whose type the walk does not know is ABSENT. */
export type AnnotationScope = Map<string, string>;

/**
 * Report every non-exhaustive `match` in `statement` into `into`, reading and
 * extending `scope` (the annotations in force at the start of the statement;
 * a top-level `let x: light` in one statement types `x` for the statements
 * that follow, so the caller threads one scope through a whole program).
 *
 * `ce` resolves annotations against the engine's type registry, so a sum
 * declared by an EARLIER statement is known here only once that statement has
 * been canonicalized — the caller runs this after boxing each statement.
 */
export function matchExhaustivenessDiagnostics(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  source: string,
  into: ParsingDiagnostic[],
  scope: AnnotationScope
): void {
  walk(ce, statement, scope, into, source);
}

//
// ─── The walk ─────────────────────────────────────────────────────────────
//

function walk(
  ce: ComputeEngine,
  node: MathJsonExpression,
  scope: AnnotationScope,
  into: ParsingDiagnostic[],
  source: string
): void {
  const op = operator(node);
  if (op === '') return;

  switch (op) {
    case 'Block': {
      // A `let` inside a block is scoped to the block.
      const saved = new Map(scope);
      for (const x of operands(node)) walk(ce, x, scope, into, source);
      restore(scope, saved);
      return;
    }

    case 'Declare': {
      // `let x: T = v` → `Declare(x, "T", …)`; `let x = v` → `Declare(x, …)`.
      // The initializer is read in the scope BEFORE the declaration.
      // A destructuring target (`let (u, v) = p`) is a shape whose names are
      // all untyped.
      const ops = operands(node);
      for (const x of ops.slice(1)) walk(ce, x, scope, into, source);
      if (ops[0] === undefined) return;
      const name = symbol(ops[0]);
      if (name === null) {
        for (const bound of symbolsIn(ops[0])) scope.delete(bound);
        return;
      }
      const type = stringValue(ops[1]);
      if (type !== null) scope.set(name, type);
      else scope.delete(name);
      return;
    }

    case 'Function': {
      // `Function(body, param…)`: a parameter is `Typed(name, "T")` or a bare
      // name (or a destructuring shape, whose names are all untyped).
      const [body, ...params] = operands(node);
      const saved = new Map(scope);
      for (const p of params) {
        if (operator(p) === 'Typed') {
          const name = symbol(operand(p, 1));
          const type = stringValue(operand(p, 2));
          if (name !== null && type !== null) {
            scope.set(name, type);
            continue;
          }
        }
        for (const name of symbolsIn(p)) scope.delete(name);
      }
      if (body !== undefined) walk(ce, body, scope, into, source);
      restore(scope, saved);
      return;
    }

    case 'Loop': {
      // `for x in xs { … }` → `Loop(body, Element(x, xs))`: the collection is
      // read in the enclosing scope, the body with the element name bound.
      const [body, element] = operands(node);
      if (operator(element) === 'Element') {
        const [target, collection] = operands(element);
        if (collection !== undefined) walk(ce, collection, scope, into, source);
        const saved = new Map(scope);
        if (target !== undefined)
          for (const name of symbolsIn(target)) scope.delete(name);
        if (body !== undefined) walk(ce, body, scope, into, source);
        restore(scope, saved);
        return;
      }
      for (const x of operands(node)) walk(ce, x, scope, into, source);
      return;
    }

    case 'Match': {
      const [subject, ...cases] = operands(node);
      if (subject !== undefined) {
        checkMatch(ce, node, subject, cases, scope, into, source);
        walk(ce, subject, scope, into, source);
      }
      for (const c of cases) {
        if (operator(c) !== 'MatchCase') continue;
        const [pattern, ...rest] = operands(c);
        // The pattern's captures shadow the enclosing names in the guard and
        // the body. A typed capture (`x: T`, at the top of the pattern or
        // nested in a shape) is a known annotation in the body: the parser
        // writes it as a `MatchesType(x, TypeFrom("T"))` conjunct of the
        // guard, and the body only runs when the guard holds.
        const saved = new Map(scope);
        const captures = captureNames(pattern);
        for (const name of captures) scope.delete(name);
        if (rest.length === 2)
          for (const c of conjuncts(rest[0])) {
            const typed = typeTest(c);
            if (typed !== undefined && captures.includes(typed.name))
              scope.set(typed.name, typed.type);
          }
        for (const x of rest) walk(ce, x, scope, into, source);
        restore(scope, saved);
      }
      return;
    }

    default:
      for (const x of operands(node)) walk(ce, x, scope, into, source);
  }
}

/** Reset `scope` to the entries of `saved`, in place. */
function restore(scope: AnnotationScope, saved: AnnotationScope): void {
  scope.clear();
  for (const [k, v] of saved) scope.set(k, v);
}

/** Every symbol in `node`, at any depth. */
function symbolsIn(node: MathJsonExpression): string[] {
  const name = symbol(node);
  if (name !== null) return [name];
  return operands(node).flatMap(symbolsIn);
}

/** The names a pattern binds: each wildcard `_name` / `___name` in it, at any
 * depth, minus the anonymous `_` / `___`. A `Pin` holds a value expression,
 * not a pattern, so it binds nothing. */
function captureNames(pattern: MathJsonExpression): string[] {
  const s = symbol(pattern);
  if (s !== null) {
    if (!s.startsWith('_')) return [];
    const name = s.replace(/^_+/, '');
    return name === '' ? [] : [name];
  }
  if (operator(pattern) === 'Pin') return [];
  return operands(pattern).flatMap(captureNames);
}

//
// ─── The check ────────────────────────────────────────────────────────────
//

function checkMatch(
  ce: ComputeEngine,
  node: MathJsonExpression,
  subject: MathJsonExpression,
  cases: MathJsonExpression[],
  scope: AnnotationScope,
  into: ParsingDiagnostic[],
  source: string
): void {
  const name = symbol(subject);
  if (name === null) return;
  const annotation = scope.get(name);
  if (annotation === undefined) return;
  const closed = closedTypeOf(ce, annotation);
  if (closed === undefined) return;

  const covered = new Set<string>();
  for (const c of cases) {
    if (operator(c) !== 'MatchCase') continue;
    const ops = operands(c);
    const pattern = ops[0];
    const guard = ops.length === 3 ? ops[1] : null;
    if (pattern === undefined) continue;
    const cover = caseCoverage(ce, pattern, guard, closed);
    if (cover === 'all') return;
    for (const x of cover) covered.add(x);
  }

  const missing = closed.alternatives.filter((a) => !covered.has(a.name));
  if (missing.length === 0) return;

  into.push({
    severity: 'warning',
    message: [
      'match-not-exhaustive',
      closed.label,
      missing.map(spelling).join(', '),
    ],
    range: nodeRange(node) ?? [0, source.length],
  });
}

/** The alternatives a case matches unconditionally: `'all'` for a catch-all,
 * else the names it covers. */
function caseCoverage(
  ce: ComputeEngine,
  pattern: MathJsonExpression,
  guard: MathJsonExpression | null,
  closed: ClosedType
): 'all' | string[] {
  // A guard that is the literal `true` (`red() if true`) cannot fail, so the
  // case is unconditional.
  if (guard !== null && symbol(guard) === 'True') guard = null;

  if (guard !== null) {
    // Only the typed-binding form (`x: T`) is read; any other guard is a
    // condition the lint does not reason about.
    const typed = typedBinding(pattern, guard);
    if (typed === undefined) return [];
    if (['any', 'unknown', 'expression'].includes(typed.type.trim()))
      return 'all';
    const bound = closedTypeOf(ce, typed.type);
    if (bound === undefined) return [];
    return bound.alternatives.map((a) => a.name);
  }

  const s = symbol(pattern);
  if (s !== null) {
    if (isSingleWildcard(s)) return 'all';
    // `true` / `false` literals of a boolean subject.
    if (
      (s === 'True' || s === 'False') &&
      closed.alternatives.some((a) => a.kind === 'boolean' && a.name === s)
    )
      return [s];
    return [];
  }

  const head = operator(pattern);
  if (head === 'Alternatives') {
    const names: string[] = [];
    for (const alt of operands(pattern)) {
      const cover = caseCoverage(ce, alt, null, closed);
      if (cover === 'all') return 'all';
      names.push(...cover);
    }
    return names;
  }

  const variant = closed.alternatives.find(
    (a) => a.kind === 'variant' && a.name === head
  );
  if (variant === undefined || variant.kind !== 'variant') return [];
  return irrefutableOperands(operands(pattern), variant.arity)
    ? [variant.name]
    : [];
}

/** Whether constructor-pattern operands match any payload of a variant of the
 * given arity: every operand a wildcard, and the count fitting the arity (a
 * rest wildcard `...` absorbs whatever operands remain). */
function irrefutableOperands(
  ops: readonly MathJsonExpression[],
  arity: number
): boolean {
  let singles = 0;
  let rest = false;
  for (const x of ops) {
    const s = symbol(x);
    if (s === null) return false;
    if (isRestWildcard(s)) {
      if (rest) return false;
      rest = true;
    } else if (isSingleWildcard(s)) singles += 1;
    else return false;
  }
  return rest ? singles <= arity : singles === arity;
}

/** `_` or `_name`: a wildcard matching exactly one operand. */
function isSingleWildcard(s: string): boolean {
  return s.startsWith('_') && !s.startsWith('__');
}

/** `___` or `___name`: a wildcard matching any number of operands. */
function isRestWildcard(s: string): boolean {
  return s.startsWith('___');
}

/** The `(name, type)` of a typed binding `name: T` — a bare binding pattern
 * whose guard is exactly the implicit `MatchesType(name, TypeFrom("T"))` the
 * parser attaches to it — or `undefined` for any other pattern/guard pair. */
function typedBinding(
  pattern: MathJsonExpression,
  guard: MathJsonExpression | null
): { name: string; type: string } | undefined {
  if (guard === null) return undefined;
  const s = symbol(pattern);
  if (s === null || !isSingleWildcard(s)) return undefined;
  const name = s.slice(1);
  if (name === '') return undefined;
  const typed = typeTest(guard);
  return typed !== undefined && typed.name === name ? typed : undefined;
}

/** The `(name, type)` a `MatchesType(name, TypeFrom("T"))` node tests — the
 * form the parser writes for a typed capture — or `undefined` for any other
 * node. */
function typeTest(
  node: MathJsonExpression
): { name: string; type: string } | undefined {
  if (operator(node) !== 'MatchesType') return undefined;
  const name = symbol(operand(node, 1));
  if (name === null) return undefined;
  const from = operand(node, 2);
  if (operator(from) !== 'TypeFrom') return undefined;
  const type = stringValue(operand(from, 1));
  return type === null ? undefined : { name, type };
}

/** The conjuncts of a guard: the operands of an `And`, at any nesting, or the
 * guard itself. */
function conjuncts(guard: MathJsonExpression): MathJsonExpression[] {
  if (operator(guard) !== 'And') return [guard];
  return operands(guard).flatMap(conjuncts);
}

//
// ─── Closed types ─────────────────────────────────────────────────────────
//

/** The closed type an annotation names, or `undefined` when the annotation
 * does not resolve or names an open type. */
function closedTypeOf(
  ce: ComputeEngine,
  annotation: string
): ClosedType | undefined {
  let t: Type;
  try {
    t = ce.type(annotation).type;
  } catch {
    return undefined;
  }
  const alternatives = alternativesOf(ce, t, 0);
  return alternatives === undefined
    ? undefined
    : { label: annotation, alternatives };
}

/** How many alias indirections `alternativesOf` follows before giving up —
 * an alias chain is short in any real program, and the bound is what keeps
 * a self-referential alias from looping. */
const ALIAS_DEPTH_LIMIT = 8;

function alternativesOf(
  ce: ComputeEngine,
  t: Type,
  depth: number
): Alternative[] | undefined {
  if (t === 'boolean')
    return [
      { kind: 'boolean', name: 'True' },
      { kind: 'boolean', name: 'False' },
    ];
  if (typeof t !== 'object') return undefined;

  if (t.kind === 'reference') {
    const decl = declarationOf(t);
    // The sum itself: its variant list is the enumeration.
    if (decl._sumVariants !== undefined) {
      const result: Alternative[] = [];
      for (const v of decl._sumVariants) {
        const alt = variantAlternative(ce, v.name);
        if (alt === undefined) return undefined;
        result.push(alt);
      }
      return result;
    }
    // One variant, possibly applied (`node<integer>`).
    if (decl._sumOf !== undefined) {
      const alt = variantAlternative(ce, decl.name);
      return alt === undefined ? undefined : [alt];
    }
    // An alias of something closed (`type alias L = light`).
    if (decl.alias && decl.def !== undefined && depth < ALIAS_DEPTH_LIMIT)
      return alternativesOf(ce, decl.def, depth + 1);
    return undefined;
  }

  if (t.kind === 'union') {
    // Closed only when EVERY member is a variant: one open member (`light |
    // nothing`) admits values no constructor pattern can name.
    const result: Alternative[] = [];
    const seen = new Set<string>();
    for (const member of t.types) {
      if (typeof member !== 'object' || member.kind !== 'reference')
        return undefined;
      const decl = declarationOf(member);
      if (decl._sumOf === undefined) return undefined;
      const alt = variantAlternative(ce, decl.name);
      if (alt === undefined) return undefined;
      if (!seen.has(alt.name)) {
        seen.add(alt.name);
        result.push(alt);
      }
    }
    return result.length === 0 ? undefined : result;
  }

  return undefined;
}

/** The alternative for the variant `name` of a sugar-declared sum, or
 * `undefined` when `name` is not (or no longer) such a variant.
 *
 * `sumVariantInfo` owns the membership rule — the `_sumOf` back-pointer is
 * trusted only while the sum's own record still lists the variant — and the
 * arity reading the constructor is minted with, so the lint cannot drift
 * from the compiler on either. */
function variantAlternative(
  ce: ComputeEngine,
  name: string
): Alternative | undefined {
  const info = sumVariantInfo(ce, name);
  return info === undefined
    ? undefined
    : { kind: 'variant', name, arity: info.arity };
}

/** How a missing alternative is spelled in the message — as the pattern that
 * would cover it. */
function spelling(a: Alternative): string {
  if (a.kind === 'boolean') return a.name === 'True' ? 'true' : 'false';
  return `${a.name}(${Array.from({ length: a.arity }, () => '_').join(', ')})`;
}

/** The source range the parser recorded on a node, if any. */
function nodeRange(node: MathJsonExpression): [number, number] | undefined {
  if (typeof node !== 'object' || node === null || Array.isArray(node))
    return undefined;
  const offsets = (node as { sourceOffsets?: [number, number] }).sourceOffsets;
  return Array.isArray(offsets) ? [offsets[0], offsets[1]] : undefined;
}
