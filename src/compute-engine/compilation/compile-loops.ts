// Loops: For, comprehensions, counted ranges, element loops and the loop body.

import type { Expression, FunctionInterface } from '../global-types.js';
import {
  clearDecidedLoopIndices,
  clearIntegerRanges,
  recordDecidedLoopIndex,
  recordIntegerRange,
} from './javascript-value-facts.js';
import { javascriptStatements } from './javascript-statements.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { normalizeIndexingSet } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
import type { CompileTarget, TargetSource } from './types.js';
import { isCallerMapped } from './cse.js';
import { rangeCount, RANGE_COUNT_JS_SOURCE } from '../numerics/range-count.js';
import { bindsLocalFunctions, nestedAssignmentsTo } from './compile-locals.js';
import { compileOp, hoistLoopInvariants, withCseScope } from './compile-cse.js';
import { core } from './compiler-core-hooks.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { assertBreakLeavesWholeLoop } from './compile-match.js';
import type { ElementBinder, ReboundFunctionLocals } from './compiler-types.js';
import {
  compilationType,
  isProvablyStringOperand,
  numericLiteralSource,
  typeHasFunctionArm,
} from './compiler-type-facts.js';
import { mentionsExcludedName, symbolOccursFree } from './compiler-names.js';
import { _pushComplexMemoLayer, wideIsComplex } from './compiler-mode.js';
import {
  _popComplexMemoLayer,
  complexDiscipline,
  declareValueOperand,
  withBinderMask,
} from './compile-declarations.js';
import { laneMismatch, wideEntriesType } from './compile-lanes.js';
import { compileGuardTest } from './compile-absence.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { returnedFunctionLiterals } from './compile-conditions.js';
import { assertScalarBigOpBody } from './compile-shapes.js';
import { CompilerState } from './compiler-state.js';

/**
 * Compile a `Loop` expression — imperative control flow, **for effect** (no
 * value is collected). Three shapes:
 *
 * 1. **Bare infinite loop:** `Loop(body)` → `(() => { while (true) { … } })()`.
 *    The body compiles as statements (`compileLoopBody`), so `break` /
 *    `continue` / `return` terminate it. Unbounded loops are rejected on GPU
 *    targets (GLSL/WGSL).
 *
 * 2. **Counted loop:** `Loop(body, Element(i, Range(lo, hi)))` where the
 *    Range is integer-ascending with step 1 → the legacy
 *    `for (let i = lo; i <= hi; i++) { … }` shape, emitted as bare statements
 *    (no result array). The counter is a plain number; wrapping targets
 *    (interval-js) re-wrap references to `i` in the body.
 *
 * 3. **General for-each:** any other Element form (multiple clauses, a
 *    non-`Range` collection, or a stepped/descending/fractional `Range`) →
 *    nested `for (const x of …) { … }` loops whose innermost statement is the
 *    compiled body. No result array.
 *
 * Value-producing comprehensions are compiled by `compileComprehension`
 * (head `Comprehension`), not here.
 */
export function compileForLoop(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node?: Expression
): TargetSource {
  if (!args[0]) throw new Error('Could not compile `Loop`: no body');

  const body = args[0];
  const elements = args.slice(1);
  // An assignment to the index in the body writes the binding of the loop
  // for the rest of that iteration only: the interpreter gives the index
  // the next element at the next iteration. The emitted loops cannot do
  // that (a `const` index, or a counter that the assignment would move), so
  // the interpreter evaluates such a loop.
  const indexNames = new Set(
    elements.flatMap((e) =>
      isFunction(e, 'Element') && e.ops[0] !== undefined
        ? isFunction(e.ops[0], 'Tuple')
          ? tuplePatternNames(e.ops[0])
          : isSymbol(e.ops[0])
            ? [e.ops[0].symbol]
            : []
        : []
    )
  );
  const assigned =
    indexNames.size > 0 ? nestedAssignmentsTo(body, indexNames)[0] : undefined;
  if (assigned !== undefined)
    throw new Error(
      `Could not compile \`Loop\`: the body assigns the loop index \`${assigned.name}\`. ` +
        `The interpreter evaluates it instead.`
    );
  const lang = target.language ?? '';
  // The loop body is a statement list — an INERT region (§5.1(c)): nothing
  // binds at the list level (a body may run zero times), while each
  // statement's own value expressions are bindable child regions.
  const inBody = <T>(bodyTarget: CompileTarget<Expression>, fn: () => T): T =>
    withCseScope(node, 0, bodyTarget, fn);

  // ── Bare infinite loop ────────────────────────────────────────────────
  if (elements.length === 0) {
    if (lang === 'glsl' || lang === 'wgsl')
      throw new Error(
        `Could not compile \`${lang.toUpperCase()}\`: an unbounded Loop(body) is not supported.`
      );
    const bodyStmts = inBody(target, () => core.compileLoopBody(body, target));
    return `(() => {${target.ws('\n')}while (true) {${target.ws(
      '\n'
    )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
  }

  // ── Counted loop: single integer-ascending step-1 Range ───────────────
  // A GUARDED clause (`Element(k, Range(lo, hi), cond)`) takes the general
  // path below, whose loop emission applies the guard; this counted form
  // reads the index and the range only.
  if (
    elements.length === 1 &&
    isFunction(elements[0], 'Element') &&
    elements[0].nops === 2 &&
    isLegacyCompatibleRange(elements[0].ops[1])
  ) {
    const indexing = elements[0];
    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr))
      throw new Error('Could not compile `Loop`: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range'))
      throw new Error('Could not compile `Loop`: expected Range(lo, hi)');

    const index = indexExpr.symbol;

    // Use raw numeric values for the for-loop counter (not target-wrapped).
    // This ensures `for (let i = 1; i <= 5; i++)` uses plain numbers even
    // when the target wraps values (e.g. interval-js would produce
    // `_IA.point(1)` which breaks `i++`).
    const lower = Math.floor(rangeExpr.ops[0].re);
    const upper = Math.floor(rangeExpr.ops[1].re);

    if (!Number.isFinite(lower) || !Number.isFinite(upper))
      throw new Error(
        'Could not compile `Loop`: bounds must be finite numbers'
      );

    // Check if the target wraps numeric values (e.g. interval-js).
    // If so, references to the loop index in the body must be wrapped.
    const needsWrap = target.number(0) !== '0';

    const bodyTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) =>
        id === index
          ? needsWrap
            ? target.number(0).replace('0', index)
            : index
          : target.var(id),
      ...withBoundScope(target, [index]),
    };

    const bodyStmts = inBody(bodyTarget, () =>
      core.compileLoopBody(body, bodyTarget)
    );

    return `(() => {${target.ws(
      '\n'
    )}for (let ${index} = ${lower}; ${index} <= ${upper}; ${index}++) {${target.ws(
      '\n'
    )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
  }

  // ── General for-each (for effect) ─────────────────────────────────────
  // A shader loop needs bounds that are known when the shader is written:
  // the counted loop above takes a single `Range` with integer literal
  // bounds, and every other loop (several `Element` clauses, a collection
  // that is not a `Range`, a `Range` with a bound that is a symbol or an
  // expression) is read at run time, which a shader cannot do.
  if (lang === 'glsl' || lang === 'wgsl')
    throw new Error(
      `Could not compile \`${lang.toUpperCase()}\`: a Loop compiles to a shader only over a single Range with integer literal bounds.`
    );

  assertBreakLeavesWholeLoop(elements, body);
  const inner = compileElementLoops(elements, target, (bodyTarget) =>
    inBody(bodyTarget, () => core.compileLoopBody(body, bodyTarget))
  );
  return `(() => {${target.ws('\n')}${inner}${target.ws('\n')}})()`;
}

/**
 * Compile a `Comprehension` expression — a value-producing comprehension.
 * `Comprehension(body, Element(x, coll1), Element(y, coll2), …)` compiles to
 * nested `for (const x of …)` loops that `result.push(body)`, returning the
 * collected array:
 *
 * ```js
 * (() => { const result = [];
 *   for (const x of [1,2]) { for (const y of [3,4]) { result.push(body); } }
 *   return result; })()
 * ```
 *
 * GLSL/WGSL have no dynamic arrays, so a comprehension is rejected there.
 */
export function compileComprehension(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The `Comprehension` node itself: the body is its operand 0, whose
   * harvested region (a binder body, design §5.1(a)) the emission enters
   * through `compileOp`, so candidates repeated inside the body bind once
   * per iteration and a temporary an enclosing instance already holds is
   * reused instead of recomputed. Without the node the body compiles
   * under a blind instance. */
  node?: Expression
): TargetSource {
  if (!args[0]) throw new Error('Could not compile `Comprehension`: no body');
  if (!args[1])
    throw new Error('Could not compile `Comprehension`: no indexing set');

  const body = args[0];
  const elements = args.slice(1);
  const statements = javascriptStatements(target);

  // An assignment to an index in the term writes the binding of that index
  // for the rest of the iteration only (CE-226.1). The emitted loop binds
  // the index as a `const`, so the write would fail at run time: decline,
  // as `compileForLoop` does.
  const indexNames = new Set(
    elements.flatMap((e) =>
      isFunction(e, 'Element') && e.ops[0] !== undefined
        ? isFunction(e.ops[0], 'Tuple')
          ? tuplePatternNames(e.ops[0])
          : isSymbol(e.ops[0])
            ? [e.ops[0].symbol]
            : []
        : []
    )
  );
  const assigned =
    indexNames.size > 0 ? nestedAssignmentsTo(body, indexNames)[0] : undefined;
  if (assigned !== undefined)
    throw new Error(
      `Could not compile \`Comprehension\`: the term assigns the index \`${assigned.name}\`. ` +
        `The interpreter evaluates it instead.`
    );

  const lang = target.language ?? '';
  if (lang === 'glsl' || lang === 'wgsl')
    throw new Error(
      `Could not compile \`${lang.toUpperCase()}\`: Comprehension is not supported (no dynamic arrays). ` +
        'TODO(E3-GLSL): unroll or use a fixed-size array.'
    );

  // Loop-invariant subexpressions of the body — a collection it rebuilds,
  // a reduction over one — are computed once, not once per element (Tycho
  // item 248). The bindings are INITIALIZED ON THE FIRST ITERATION, inside
  // the INNERMOST loop, rather than before the loops: any source may be
  // empty (an inner one even when the outer ones are not), and a body that
  // never ran must not have its subexpressions evaluated (an error they
  // raise would be new). The flag test costs one boolean read per body
  // evaluation.
  const binders = elementClauseBinders(elements, target);
  const binderNames = binders.flatMap((b) => b.names);
  let flag: string | undefined;
  const { bindings, result: inner } = hoistLoopInvariants(
    body,
    binderNames,
    target,
    (hoisted) => {
      let prelude = '';
      if (hoisted.length > 0) {
        flag = tempVar(target);
        prelude = `if (!${flag}) { ${flag} = true; ${hoisted
          .map(([name, code]) => `${name} = ${code};`)
          .join(' ')} } `;
      }
      return compileElementLoops(
        elements,
        target,
        (bodyTarget) => {
          const code = compileOp(node, 0, bodyTarget, 0, body);
          return (
            statements?.consume(code, (value) => `result.push(${value});`) ??
            `result.push(${code});`
          );
        },
        prelude,
        binders
      );
    }
  );
  const declarations =
    bindings.length === 0
      ? ''
      : `let ${flag} = false; let ${bindings.map(([name]) => name).join(', ')}; `;
  return (
    statements?.expression(
      (exit) => `const result = []; ${declarations}${inner} ${exit('result')}`
    ) ??
    `(() => { const result = []; ${declarations}${inner} return result; })()`
  );
}

/**
 * The validated binders of a loop's `Element` clauses — what a `for`
 * header binds on each turn, in a form every target can spell. Shared by
 * the JavaScript lowerings (`compileElementLoops`) and the Python ones
 * (`compilePythonLoop`, `compilePythonComprehension`), so the two targets
 * accept the same clauses and refuse the same ones.
 *
 * A binder is a bare name, or a DESTRUCTURING tuple pattern (`for (p, q) in
 * pairs`): a `Tuple` of names, `_` positions, and nested patterns. The
 * interpreter binds such a pattern only to a TUPLE of the pattern's arity
 * and answers a shape-mismatch error value for anything else — a list of
 * the right length included. Compiled code cannot make that distinction
 * (a tuple and a list are both arrays), so a pattern compiles only when
 * the source's STATIC element type is a tuple of the matching arity, at
 * every nesting: then no mismatch can happen at run time and the emitted
 * destructuring is faithful. Anything else declines.
 *
 * Two binder shapes the emitted loops cannot carry decline as well (Tycho
 * item 245); both compiled and then THREW at run time, where a refusal at
 * compile time is the honest answer (D6):
 *
 * - A binder that occurs in its own source, or in the source of an OUTER
 *   clause: `[P.x + 1 for P in P]` emitted `for (const P of P)`, a
 *   temporal-dead-zone read of the loop variable it declares. The
 *   interpreter leaves the form inert. An outer source is emitted before
 *   this clause's binding exists, so a mention there is the same read.
 *   Only a FREE occurrence counts: a source whose own lambda reuses the
 *   name (`Filter(A, x ↦ x > 0)` under a binder `x`) binds it afresh and
 *   never reads the loop variable.
 * - A binder whose static type contradicts the source's element type. The
 *   body was typed under the binder's type, so its lowering assumes that
 *   shape; the loop hands it the source's elements instead. Measured:
 *   `[q.x + 1 for q in C]` over a point `C: tuple<number, number>` typed
 *   the binder `matrix` (the body's `PointX(q)` use retyped it), lowered
 *   `PointX(q)` as a list-of-points read, and threw `q.map is not a
 *   function` at run time on the number the loop bound. A binder type
 *   NARROWER than the element type is the ordinary inference of a use and
 *   is kept when it keeps the element's VALUE SHAPE: a binder inferred
 *   `integer` over `number` elements lowers the same JavaScript. A
 *   non-real binder over real elements does not — `complex <: number`, but
 *   the body then reads `.re`/`.im` off the plain numbers the loop binds —
 *   so that narrowing declines with the disjoint case.
 */
export function elementClauseBinders(
  elements: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): ElementBinder[] {
  const binders: ElementBinder[] = [];
  for (let i = 0; i < elements.length; i++) {
    const elem = elements[i];
    if (!isFunction(elem, 'Element'))
      throw new Error(
        `Could not compile \`Loop\`: argument ${i + 1} must be an Element clause, got ${(elem as Expression & { operator?: string }).operator ?? '?'}`
      );
    const clause = elem as ElementBinder['clause'];
    const pattern = clause.ops[0];
    const source = clause.ops[1];
    const eltType = collectionElementType(compilationType(source));
    let binder: ElementBinder;
    if (isSymbol(pattern)) {
      binder = {
        clause,
        names: [pattern.symbol],
        jsPattern: pattern.symbol,
        pyPattern: pattern.symbol,
        leaves: [[pattern, eltType]],
      };
    } else if (isFunction(pattern, 'Tuple')) {
      const spelled = spellTuplePattern(pattern, eltType, i, target);
      // A name bound twice in one pattern (`(a, a)`) is a JavaScript
      // syntax error in a `const` destructuring; the interpreter binds the
      // leaves in order and the last one wins. Decline rather than emit a
      // header that does not parse.
      if (new Set(spelled.names).size !== spelled.names.length)
        throw new Error(
          `Could not compile \`Loop\`: the destructuring binder \`${pattern.toString()}\` binds a ` +
            `name more than once. The interpreter evaluates it instead.`
        );
      binder = { clause, ...spelled };
    } else
      throw new Error(
        `Could not compile \`Loop\`: Element index (argument ${i + 1}) must be a symbol or a tuple pattern`
      );

    for (const [leaf, componentType] of binder.leaves) {
      const name = leaf.symbol;
      for (let j = 0; j <= i; j++)
        if (symbolOccursFree(binders[j]?.clause.ops[1] ?? source, name))
          throw new Error(
            `Could not compile \`Loop\`: the binder \`${name}\` occurs in the collection it (or an ` +
              `enclosing clause) iterates, which the emitted loop would read ` +
              `before binding it. The interpreter evaluates it instead.`
          );
      const binderType = compilationType(leaf);
      if (
        componentType !== undefined &&
        !isSubtype(componentType, binderType) &&
        (!isSubtype(binderType, componentType) ||
          (isNonRealNumber(binderType) && !isNonRealNumber(componentType)))
      )
        throw new Error(
          `Could not compile \`Loop\`: the binder \`${name}\` is typed \`${typeToString(binderType)}\` ` +
            `but iterates elements of type \`${typeToString(componentType)}\`; the ` +
            `body's lowering assumes a shape the loop never binds. The interpreter evaluates it instead.`
        );
    }
    binders.push(binder);
  }
  return binders;
}

/**
 * The spellings and leaves of a destructuring tuple pattern whose source
 * elements have the static type `eltType`, or a fail-closed throw when the
 * type does not prove a tuple of the pattern's arity at every nesting (see
 * `elementClauseBinders`). A `_` position binds nothing: it spells as an
 * array hole in JavaScript, and as a generated temporary in Python, where
 * a literal `_` would be an ordinary assignment target and overwrite an
 * enclosing variable of that name on every turn. A one-position Python
 * pattern needs its trailing comma (`(x,)`): `(x)` is the bare name and
 * would bind the whole one-tuple.
 */
export function spellTuplePattern(
  pattern: Expression & { ops: ReadonlyArray<Expression> },
  eltType: Type | undefined,
  clauseIndex: number,
  target: CompileTarget<Expression>
): Omit<ElementBinder, 'clause'> {
  const decline = (why: string): never => {
    throw new Error(
      `Could not compile \`Loop\`: the destructuring binder \`${pattern.toString()}\` of Element ` +
        `clause ${clauseIndex + 1} ${why}. A tuple pattern compiles only ` +
        `when the source's elements are provably tuples of the pattern's ` +
        `arity: the interpreter refuses any other element with an error ` +
        `value, which compiled code cannot reproduce. The interpreter evaluates it instead.`
    );
  };
  const t = eltType === undefined ? undefined : resolveTypeAlias(eltType);
  if (typeof t !== 'object' || t.kind !== 'tuple')
    return decline(
      `iterates elements of type \`${eltType === undefined ? 'unknown' : typeToString(eltType)}\`, not a tuple`
    );
  if (t.elements.length !== pattern.ops.length)
    return decline(
      `has ${pattern.ops.length} positions but the elements are tuples of ${t.elements.length}`
    );
  const names: string[] = [];
  const leaves: ElementBinder['leaves'] = [];
  const js: string[] = [];
  const py: string[] = [];
  for (let i = 0; i < pattern.ops.length; i++) {
    const p = pattern.ops[i];
    const componentType = t.elements[i].type;
    if (isFunction(p, 'Tuple')) {
      const nested = spellTuplePattern(p, componentType, clauseIndex, target);
      names.push(...nested.names);
      leaves.push(...nested.leaves);
      js.push(nested.jsPattern);
      py.push(nested.pyPattern);
      continue;
    }
    if (!isSymbol(p))
      return decline(`has a position that is neither a name nor a pattern`);
    if (p.symbol === '_') {
      js.push('');
      py.push(tempVar(target));
      continue;
    }
    names.push(p.symbol);
    leaves.push([p, componentType]);
    js.push(p.symbol);
    py.push(p.symbol);
  }
  return {
    names,
    leaves,
    jsPattern: `[${js.join(', ')}]`,
    pyPattern: py.length === 1 ? `(${py[0]},)` : `(${py.join(', ')})`,
  };
}

/**
 * The value shape the body of a loop must assume for the bare binder
 * `leaf` of an `Element` clause over `source`.
 *
 * The body is compiled with the binder bound in the compile context, and a
 * bound name is classified from its TYPE (`isComplexValued`), while the
 * `for (const k of …)` header hands it the elements the SOURCE emits. The
 * two disagree when the elements compile to `{re, im}` objects but the
 * binder's type is real, or wide under the real discipline: a binder over
 * `[a + √d, a - √d]` with `d` of unknown sign types `number`, each `√d`
 * takes the complex lane, and the body then compared and divided the
 * objects as numbers (`0 < k` is `false`, `1 / k` is `NaN`), a silent wrong
 * answer. (Measured on the Apollonian-gasket program of Tycho ask 332: the
 * compiled run returned 4 where the interpreter returns 224.)
 *
 * - `'as-typed'`: the binder's own classification already matches the
 *   elements, or the source is a numeric `Range`/`Linspace` (a real
 *   counter). Nothing to do.
 * - `'complex'`: every element the source emits is complex-valued while
 *   the binder reads real; the body must bind the name complex.
 * - `'mixed'`: the source emits complex values, but not for every element,
 *   or for elements that cannot be identified. No single lowering of the
 *   body fits every element: a lane mismatch.
 *
 * Shared by the emitter (`compileElementLoops`) and the analysis
 * (`binderParts`), so the loop body and the enclosing expression agree on
 * the binder's value shape.
 */
export function elementBinderLane(
  leaf: Expression & { symbol: string },
  source: Expression
): 'as-typed' | 'complex' | 'mixed' {
  if (isFunction(source, 'Range') || isFunction(source, 'Linspace'))
    return 'as-typed';
  const t = leaf.type.type;
  if (isNonRealNumber(t) || wideIsComplex(t)) return 'as-typed';
  // Under the complex discipline a read of a WIDE entry is lifted at its
  // use (`_SYS.cplx`, idempotent), so a collection binder whose every leaf
  // entry is wide reads a complex entry correctly wherever the element
  // holds one.
  if (
    complexDiscipline() &&
    collectionElementType(t) !== undefined &&
    wideEntriesType(t)
  )
    return 'as-typed';
  // Under the complex discipline a mixed source is not a mismatch: the
  // binder is bound complex and a real element is lifted at its read
  // (`_SYS.cplx`), so the `auto` retry that the real-discipline `'mixed'`
  // verdict asks for can succeed. Without this the retry raised the same
  // lane mismatch and `auto` could not recover.
  const mixed = complexDiscipline() ? 'complex' : 'mixed';
  const elements = core.elementComplexness(source);
  if (elements !== undefined) {
    if (elements.length === 0 || !elements.some((e) => e)) return 'as-typed';
    return elements.every((e) => e) ? 'complex' : mixed;
  }
  // The elements cannot be identified (a symbol, a call): the source's own
  // verdict describes whether it may hold a complex value anywhere.
  return core.isComplexValued(source) ? mixed : 'as-typed';
}

/**
 * Build nested `for (const name of collection) { … }` loops from a list of
 * `Element` clauses. `makeInner` produces the innermost statement given the
 * loop-variable-aware `bodyTarget`. `prelude` is emitted at the top of the
 * INNERMOST loop's body, just before the statement `makeInner` produced —
 * where a statement that must run only once the body is actually reached
 * belongs (an inner source may be empty while the outer ones are not).
 * Shared by `compileForLoop` (general for-each) and `compileComprehension`.
 */
export function compileElementLoops(
  elements: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  makeInner: (bodyTarget: CompileTarget<Expression>) => string,
  prelude = '',
  /** The clauses' binders when the caller has validated them already
   * (`compileComprehension` needs their names before it emits). */
  validated?: ReadonlyArray<ElementBinder>
): string {
  const binders = validated ?? elementClauseBinders(elements, target);
  const narrowedElements = binders.map((b) => b.clause);

  // For wrapping targets (e.g. interval-js where `target.number(0)` is
  // `_IA.point(0)`), a loop variable over a `Range` with number-literal
  // bounds must be wrapped wherever it appears in the body or in an inner
  // collection expression: the iterable of such a range
  // (`compileRangeIterable`) emits plain numbers, and `_IA.add(x, y)`
  // invoked with raw numbers produces incorrect intervals. A `Range` with
  // a bound read at run time iterates `_IA.range`, whose elements are
  // point intervals already, so it is a source like the others below.
  // Any other source is a collection value of the target, whose elements
  // are usually wrapped already (on interval-js, `run()` converts each
  // element of a list input to a `{lo, hi}` interval, and a compiled list
  // holds intervals). A second wrap gave `_IA.point({lo, hi})`, an interval
  // whose bounds are objects: a `Loop` over a `list<number>` input summed
  // to the string `"5[object Object]…"`. But a source that the caller maps
  // through `vars` (`L: '[1, 2, 3]'`), or a host that runs the code with
  // its own vars object, can give plain numbers. So such an element is
  // wrapped only when it is a number, as the `Sum` lowering of
  // interval-js does.
  const loopVarSet = new Set(binders.flatMap((b) => b.names));
  const needsWrap = target.number(0) !== '0';
  // A name can be bound by more than one clause (`k ∈ Range(1, 2)`, then
  // `k ∈ Range(1, n)`), and this rule applies to every use of the name.
  // So the unconditional wrap is only for a name that every one of its
  // clauses binds over a literal range; a name with any other source gets
  // the `typeof` test.
  const wrappedVars = new Set(
    [...loopVarSet].filter((name) =>
      binders.every(
        (b) => !b.names.includes(name) || isLiteralRange(b.clause.ops[1])
      )
    )
  );
  // The wrap rule below re-wraps each loop variable as a NUMBER; a
  // destructured leaf is a component of a tuple value, whose wrapping on
  // such a target this lowering does not know. Decline rather than
  // guess.
  if (needsWrap && binders.some((b) => b.jsPattern !== b.names[0]))
    throw new Error(
      `Could not compile \`Loop\`: a destructuring binder is not supported on target ` +
        `'${target.language ?? '?'}'. The interpreter evaluates it instead.`
    );
  // Always shadow the loop variables in the body's target: a loop variable
  // is bound to the bare emitted identifier (wrapped only for wrapping
  // targets like interval-js). Without this, a loop variable that collides
  // with a symbol the engine knows (e.g. an index named `i`, which the
  // engine resolves to the imaginary unit) would be folded to that value by
  // `target.var` instead of referencing the loop binding.
  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id: string) =>
      loopVarSet.has(id)
        ? needsWrap
          ? wrappedVars.has(id)
            ? target.number(0).replace('0', id)
            : `(typeof ${id} === 'number' ? ${target.number(0).replace('0', id)} : ${id})`
          : id
        : target.var(id),
    ...withBoundScope(target, [...loopVarSet]),
  };

  if (target.language === 'javascript') {
    for (const binder of binders) {
      const range = binder.clause.ops[1];
      if (
        binder.names.length !== 1 ||
        binders.filter((b) => b.names.includes(binder.names[0])).length !== 1 ||
        !isFunction(range, 'Range')
      )
        continue;
      const [lo, hi, step] = range.ops;
      if (
        isNumber(lo) &&
        !lo.isComplex &&
        isNumber(hi) &&
        !hi.isComplex &&
        Number.isSafeInteger(hi.re - lo.re) &&
        (step === undefined ||
          (isNumber(step) && !step.isComplex && Number.isSafeInteger(step.re)))
      )
        recordIntegerRange(
          bodyTarget,
          binder.names[0],
          Math.min(lo.re, hi.re),
          Math.max(lo.re, hi.re)
        );
      // Whatever the UPPER bound is, both loop shapes this clause can take
      // bind the name to `start + step · counter` with `counter` a whole
      // number the emitted loop produces itself (`compileCountedRange` and
      // `compileRangeIterable` agree on that element rule). So a finite
      // literal start and step make every value the name ever holds a
      // finite number — never NaN, never the `undefined` an absent caller
      // variable reads as — which is what lets a comparison against it skip
      // its decidedness test (`mayBeUndecided`). A CALLER-MAPPED source is
      // excluded: the emitted loop then iterates the caller's own code
      // instead of the range.
      if (
        isNumber(lo) &&
        !lo.isComplex &&
        Number.isFinite(lo.re) &&
        (step === undefined ||
          (isNumber(step) && !step.isComplex && Number.isFinite(step.re))) &&
        target.cse?.harvestOptions !== undefined &&
        !isCallerMapped(range, target.cse.harvestOptions)
      )
        recordDecidedLoopIndex(bodyTarget, binder.names[0]);
    }
  }

  // A bare binder whose source emits complex-valued elements while the
  // binder's type reads real is bound COMPLEX for the body and for the inner
  // sources, which read it the same way (see `elementBinderLane`). A source
  // whose elements disagree has no single lowering for the body under the
  // real discipline: that is a lane mismatch, which `mode: 'auto'` answers
  // by compiling again under the complex discipline (where a wide binder
  // is lifted at each use) and `mode: 'strict'` by declining.
  const complexFrame = new Map<string, boolean>();
  for (const binder of binders) {
    const leaf = binder.clause.ops[0];
    if (!isSymbol(leaf)) continue;
    const lane = elementBinderLane(leaf, binder.clause.ops[1]);
    if (lane === 'mixed')
      laneMismatch(
        'Loop index',
        `the loop variable \`${leaf.symbol}\``,
        binder.clause.ops[1]
      );
    if (lane === 'complex') complexFrame.set(leaf.symbol, true);
  }
  if (complexFrame.size > 0) _pushLocalComplex(complexFrame);
  try {
    return emitElementLoops(
      narrowedElements,
      binders,
      target,
      bodyTarget,
      makeInner,
      prelude,
      needsWrap
    );
  } finally {
    if (complexFrame.size > 0) _popLocalComplex();
  }
}

/**
 * The emission half of `compileElementLoops`, run while the loop binders'
 * complex frame (if any) is pushed.
 */
export function emitElementLoops(
  narrowedElements: ReadonlyArray<ElementBinder['clause']>,
  binders: ReadonlyArray<ElementBinder>,
  target: CompileTarget<Expression>,
  bodyTarget: CompileTarget<Expression>,
  makeInner: (bodyTarget: CompileTarget<Expression>) => string,
  prelude: string,
  needsWrap: boolean
): string {
  // Build nested for-of loops from innermost to outermost. Inner collections
  // are compiled with `bodyTarget` so that references to outer loop variables
  // are wrapped consistently.
  let inner: string;
  try {
    inner = prelude + makeInner(bodyTarget);
  } finally {
    // Source expressions run outside their own iteration binding.
    clearIntegerRanges(bodyTarget);
    clearDecidedLoopIndices(bodyTarget);
  }
  for (let i = narrowedElements.length - 1; i >= 0; i--) {
    const elem = narrowedElements[i];
    // A destructuring binder spells as an array pattern (`[a, , [b, c]]`,
    // a hole where the pattern skips a position).
    const name = binders[i].jsPattern;
    const collExpr = elem.ops[1];
    // A GUARDED clause, `Element(x, xs, cond)`: the inner loops and the
    // body run only for the elements the guard accepts, so the guard
    // wraps everything nested inside this clause's loop. The interpreter
    // keeps an element only when the guard evaluates to exactly `True`
    // (`runNested`), so the emitted test is the DECIDED-TRUE test of the
    // three-valued condition lowering, not JavaScript truthiness: a
    // non-boolean guard (`if x`) keeps nothing, a relation over `NaN` and a
    // `Not` of one are undecided and keep nothing, exactly as they do for a
    // branch condition (`compileGuardTest`).
    //
    // The guard reads the bindings of ITS clause and the clauses before it
    // — a name bound by a LATER clause is, in the interpreter, the
    // enclosing variable of that name (`canonicalLoopLike` canonicalizes
    // each guard before the later indices are declared, and the node's
    // free variables count it as free: `boundVariableNamesInOperand`). The
    // body target binds every clause's name, so it is not the target for
    // the guard: a later name would be emitted bare, before its loop
    // declares it; under the guard target it reads the enclosing variable.
    //
    // A target that wraps its numbers (interval arithmetic) has no plain
    // boolean to test, so the guard declines there and the interpreter
    // evaluates the comprehension.
    const guard = elem.ops[2];
    if (guard !== undefined && !isSymbol(guard, 'Nothing')) {
      if (needsWrap)
        throw new Error(
          `Could not compile \`Loop\`: a guarded clause is not supported on target ` +
            `'${target.language ?? '?'}'. The interpreter evaluates it instead.`
        );
      const visible = new Set(binders.slice(0, i + 1).flatMap((b) => b.names));
      const guardTarget: CompileTarget<Expression> = {
        ...target,
        var: (id: string) => (visible.has(id) ? id : target.var(id)),
        ...withBoundScope(target, [...visible]),
      };
      inner = `if (${compileGuardTest(guard, guardTarget)}) { ${inner} }`;
    }
    let collection: string;
    if (
      target.language === 'javascript' &&
      isFunction(collExpr, 'Range') &&
      // The iterable lowering uses the real parts of complex constants.
      !collExpr.ops.some((op) => isNumber(op) && op.isComplex) &&
      binders[i].names.length === 1 &&
      !mentionsExcludedName(collExpr, new Set(binders[i].names), undefined) &&
      target.cse?.harvestOptions !== undefined &&
      !isCallerMapped(collExpr, target.cse.harvestOptions)
    ) {
      inner = compileCountedRange(collExpr, name, inner, bodyTarget);
      continue;
    }
    if (isFunction(collExpr, 'Range'))
      collection = compileRangeIterable(collExpr, bodyTarget);
    else if (isProvablyStringOperand(collExpr)) {
      // A STRING source iterates its GRAPHEME CLUSTERS — the elements the
      // interpreter's `BoxedString.each()` yields. The bare `for (const c of
      // "abc")` a target string would give iterates CODE POINTS instead, so a
      // ZWJ emoji family or a combining sequence would be torn into several
      // loop iterations where the interpreter runs one. `_SYS.chars` is the
      // interpreter's own segmenter, so segment first and iterate the array.
      // Only JavaScript has that helper; every other target declines rather
      // than emit the code-point loop.
      // (`docs/STRING_ROADMAP.md`, D13.)
      if (target.language !== 'javascript')
        throw new Error(
          `Could not compile the iteration over a string on target '${target.language ?? '?'}': ` +
            `its elements are UAX #29 grapheme clusters and this target has ` +
            `no grapheme segmentation, so the emitted loop would run over ` +
            `code points instead. The interpreter evaluates it.`
        );
      collection = `_SYS.chars(${core.compile(collExpr, bodyTarget)})`;
    }
    // A loop source consumes its collection whole, so a target that spells
    // a collection value only in such positions (`compileCollectionValue`:
    // the interval target has no ordinary lowering for a literal `List`,
    // `Tuple` or `Map`) is asked first, so `k ∈ [1, 2, 3]` compiles on
    // interval-js. The hook is asked only for a `List`, `Tuple`,
    // `Linspace` or `Map`, written inline or held as a symbol's value: a
    // `List` or `Tuple` is always an array. A `Linspace` is an array unless
    // an endpoint has no finite value, and a `Map` unless its own source
    // has no array value (a `Range` with a NaN or wide bound); the loop
    // then answers `entire`, as a loop over that `Range` does. Its
    // spelling of a selection (`When`, `If`, `Which`) can give a value
    // that is not an array (`empty` when the condition of a `When`
    // fails), which a `for … of` cannot iterate, so such a source keeps
    // the ordinary lowering, which declines it.
    else
      collection =
        (isArrayValuedLoopSource(collExpr)
          ? target.compileCollectionValue?.(collExpr, bodyTarget)
          : undefined) ?? core.compile(collExpr, bodyTarget);
    inner = `for (const ${name} of ${collection}) { ${inner} }`;
  }

  return inner;
}

/**
 * True when the loop source `source` is a `List`, `Tuple`, `Linspace` or
 * `Map`, written inline or held as the value of a symbol: a collection
 * whose spelling by `CompileTarget.compileCollectionValue` is an array that
 * `for … of` can iterate. (A `Linspace` with an endpoint that has no
 * finite value, and a `Map` whose own source has no array value, are the
 * exceptions; see the loop-source branch of `emitElementLoops`.)
 */
export function isArrayValuedLoopSource(source: Expression): boolean {
  const value = isSymbol(source)
    ? source.engine._getSymbolValue(source.symbol)
    : source;
  return (
    value !== undefined &&
    isFunction(value) &&
    (value.operator === 'List' ||
      value.operator === 'Tuple' ||
      value.operator === 'Linspace' ||
      value.operator === 'Map')
  );
}

/**
 * Returns `true` when the given collection expression is a `Range` whose
 * runtime semantics match the legacy imperative for-loop shape
 * `for (let i = lo; i <= hi; i++)`.
 *
 * Concretely: integer number literal bounds, ascending, and a step that is
 * omitted or 1. The counted loop reads both bounds at compile time, so a
 * bound that is not a number literal (`Range(1, n)`) is refused here: the
 * general for-each loop reads it at run time, and also handles a range
 * that counts down.
 */
export function isLegacyCompatibleRange(coll: Expression): boolean {
  if (!isFunction(coll, 'Range')) return false;
  if (coll.ops.length >= 3) {
    const stepExpr = coll.ops[2];
    if (!isNumber(stepExpr) || stepExpr.re !== 1) return false;
  }
  const lo = coll.ops[0];
  const hi = coll.ops[1];
  if (!isNumber(lo) || !Number.isInteger(lo.re)) return false;
  if (!isNumber(hi) || !Number.isInteger(hi.re)) return false;
  if (lo.re > hi.re) return false;
  return true;
}

/** Iterate range values without allocating the intermediate array. Bounds
 * are captured in source order and each value uses the same multiplication
 * as Array.from, avoiding cumulative error for fractional steps. */
export function compileCountedRange(
  range: Expression & { ops: ReadonlyArray<Expression> },
  name: string,
  body: string,
  target: CompileTarget<Expression>
): string {
  const [loExpr, hiExpr, stepExpr] = range.ops;

  /** The element count of the range, using the runtime rule. */
  const countOf = (lo: number, hi: number, step: number): number =>
    rangeCount(lo, hi, step);

  /** The loop for a range whose start, step and count are all known at
   * compile time: no bound temporaries, no length test, no prologue. */
  const constantLoop = (
    lo: number,
    step: number,
    count: number
  ): string | undefined => {
    if (
      !Number.isFinite(count) ||
      count > 4294967295 ||
      !Number.isFinite(lo) ||
      !Number.isFinite(step)
    )
      return undefined;
    const index = tempVar(target);
    return (
      `for (let ${index} = 0; ${index} < ${count}; ${index}++) { ` +
      `const ${name} = ${lo} + (${step}) * ${index}; ${body} }`
    );
  };

  if (
    isNumber(loExpr) &&
    !loExpr.isComplex &&
    isNumber(hiExpr) &&
    !hiExpr.isComplex &&
    (stepExpr === undefined || (isNumber(stepExpr) && !stepExpr.isComplex))
  ) {
    const stepValue =
      stepExpr === undefined ? (hiExpr.re >= loExpr.re ? 1 : -1) : stepExpr.re;
    const loop = constantLoop(
      loExpr.re,
      stepValue,
      countOf(loExpr.re, hiExpr.re, stepValue)
    );
    if (loop !== undefined) return loop;
  }

  const loCode = compileRangeOperand(loExpr, target);
  const hiCode = compileRangeOperand(hiExpr, target);
  const stepLiteralCode =
    stepExpr === undefined ? undefined : compileRangeOperand(stepExpr, target);

  // A bound whose EXPRESSION is not a literal can still COMPILE to one: a
  // symbol with an assigned value, or arithmetic the constant fold reduced
  // (`1..W^2` with `W ⩴ 150` compiles its upper bound to `22500`). The
  // check above cannot see that, so repeat it on the emitted code — where
  // the constant finally is — and skip the whole runtime prologue.
  const loValue = numericLiteralSource(loCode);
  const hiValue = numericLiteralSource(hiCode);
  const stepValue =
    stepLiteralCode === undefined
      ? undefined
      : numericLiteralSource(stepLiteralCode);
  if (
    loValue !== undefined &&
    hiValue !== undefined &&
    (stepExpr === undefined || stepValue !== undefined)
  ) {
    const s = stepValue ?? (hiValue >= loValue ? 1 : -1);
    const loop = constantLoop(loValue, s, countOf(loValue, hiValue, s));
    if (loop !== undefined) return loop;
  }

  const lo = tempVar(target);
  const hi = tempVar(target);
  const step = tempVar(target);
  const count = tempVar(target);
  const index = tempVar(target);
  const stepCode = stepLiteralCode ?? `(${hi} >= ${lo} ? 1 : -1)`;
  // The count is the interpreter's own function, `rangeCount`, reached as
  // the runtime helper `_SYS.rangeCount` (this method emits for the
  // JavaScript target only). It returns 0 for a zero step and for a step
  // that points away from the stop (`Range(10, 1, 1)` is empty), floors a
  // fractional count (an INTEGER-typed bound can still arrive as 2.5 from
  // the caller's `vars` object), and counts an end point that lies on the
  // step grid in exact arithmetic but one rounding error short of it in
  // floating point.
  const countCode = `_SYS.rangeCount(${lo}, ${hi}, ${step})`;
  return (
    `{ const ${lo} = ${loCode}; const ${hi} = ${hiCode}; ` +
    `const ${step} = ${stepCode}; ` +
    `const ${count} = ${countCode}; ` +
    // Array.from treats NaN as a zero length and rejects lengths that
    // exceed the maximum Array length. Preserve both behaviors.
    //
    // The test survives an INTEGER-typed bound, whose count is a whole
    // number by the rule above. A declared type constrains what the ENGINE
    // may assign, not what a caller may put in the kernel's `vars` object,
    // so an `integer` bound can still arrive as `+∞` at run time — and
    // without this test the loop below would never reach its stop and would
    // hang the calling thread instead of raising the error `Array.from`
    // raised.
    `if (${count} > 4294967295) throw new RangeError('Invalid array length'); ` +
    `for (let ${index} = 0; ${index} < ${count}; ${index}++) { ` +
    `const ${name} = ${lo} + ${step} * ${index}; ${body} } }`
  );
}

/**
 * Compile a bound or step of a `Range` the comprehension path iterates.
 * On the JavaScript target an operand the compiler emits on the complex
 * lane (a `{ re, im }` object, as for `\sqrt{K}` with `K` not provably
 * non-negative) is read through its real part (`_SYS.realPart`), as the
 * interpreter reads a complex bound: without it the object reached
 * `rangeCount` as NaN and `[i for i = [1...\sqrt{K}]]` at `K = 4` was
 * `[]`, where the interpreter gives `[1, 2]`. Every other operand, and
 * every other target, compiles as it is.
 */
export function compileRangeOperand(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  const code = core.compile(expr, target);
  return target.language === 'javascript' && core.isComplexValued(expr)
    ? `_SYS.realPart(${code})`
    : code;
}

/**
 * `true` when `expr` is a `Range` whose bounds (and step, if present) are
 * number literals: `compileRangeIterable` then spells its elements as
 * plain numbers at compile time, on every target.
 */
export function isLiteralRange(expr: Expression): boolean {
  if (!isFunction(expr, 'Range')) return false;
  const [lo, hi, step] = expr.ops;
  return isNumber(lo) && isNumber(hi) && (step === undefined || isNumber(step));
}

/**
 * Compile a `Range(lo, hi)` or `Range(lo, hi, step)` expression into a JS
 * iterable expression. Mirrors the runtime semantics in
 * `library/collections.ts` Range:
 *     count    = rangeCount(lo, hi, step)   (numerics/range-count.ts)
 *     element  = lo + step * k          (0-indexed)
 * Default step is 1 when omitted. Bounds and step may be fractional.
 *
 * Only used from the comprehension path in `compileForLoop`.
 * Caller must have already verified `isFunction(rangeExpr, 'Range')`.
 */
export function compileRangeIterable(
  rangeExpr: Expression & { ops: ReadonlyArray<Expression> },
  target: CompileTarget<Expression>
): string {
  const loExpr = rangeExpr.ops[0];
  const hiExpr = rangeExpr.ops[1];
  const stepExpr = rangeExpr.ops[2];

  // Fast path: all bounds (and step, if present) are numeric constants.
  if (isLiteralRange(rangeExpr)) {
    const lo = loExpr.re;
    const hi = hiExpr.re;
    // When step is omitted, auto-direct: +1 if hi >= lo, else -1.
    // Mirrors the runtime range() helper in library/collections.ts.
    const step = stepExpr === undefined ? (hi >= lo ? 1 : -1) : stepExpr.re;
    if (step === 0) return '[]';
    const len = rangeCount(lo, hi, step);
    if (step === 1) {
      if (lo === 0) return `Array.from({length:${len}},(_,k)=>k)`;
      return `Array.from({length:${len}},(_,k)=>${lo}+k)`;
    }
    return `Array.from({length:${len}},(_,k)=>${lo}+(${step})*k)`;
  }

  // General path: compute bounds (and step) at runtime. The count is
  // `rangeCount`: the runtime helper `_SYS.rangeCount` on the JavaScript
  // target, and an inline copy of it on a custom target whose emitted code
  // runs without `_SYS`.
  //
  // On interval-js a bound is an interval at run time, and the plain
  // arithmetic of the `Array.from` forms below on such objects gives an
  // empty array: `Loop(c ≔ c + k, k ∈ Range(1, n))` at `n = 3` would give
  // 0, where the interpreter gives 6. So there the iterable is `_IA.range`,
  // the run-time range of the target: an array of intervals when the
  // number of elements is the same for every value inside the bounds, and
  // `entire` when it is not known (a bound such as `[2, 4]`, a quotient
  // near a whole number, a count above `MAX_RUNTIME_COLLECTION_LENGTH`;
  // `range` in `interval/collections.ts` gives the rule). `entire` is not
  // iterable, so the `for … of` over it throws a `TypeError`: the `catch`
  // of `run()` then answers `entire` for the whole result, and a cell of
  // `broadcast`, which answers the kind `error` for any cell that throws,
  // gives `error`. The loop variable over it is not wrapped again
  // (`compileElementLoops` wraps a number only, by a `typeof` test).
  if (target.language === 'interval-javascript')
    return `_IA.range(${rangeExpr.ops
      .map((op) => compileRangeOperand(op, target))
      .join(', ')})`;
  const countFn =
    target.language === 'javascript'
      ? '_SYS.rangeCount'
      : RANGE_COUNT_JS_SOURCE;
  const lo = compileRangeOperand(loExpr, target);
  const hi = compileRangeOperand(hiExpr, target);
  // On the JavaScript target the run-time helper `_SYS.range` builds the
  // array in a counted loop, with the same count and the same elements as
  // the `Array.from` forms below, which are much slower on V8 (issue #387).
  if (target.language === 'javascript') {
    if (stepExpr === undefined)
      return `((_lo,_hi)=>_SYS.range(_lo,_hi,_hi>=_lo?1:-1))(${lo},${hi})`;
    const step = compileRangeOperand(stepExpr, target);
    return `_SYS.range(${lo},${hi},${step})`;
  }
  if (stepExpr === undefined) {
    // Auto-direction step at runtime: +1 if _hi >= _lo, else -1.
    return `((_lo,_hi)=>{const _st=_hi>=_lo?1:-1;return Array.from({length:${countFn}(_lo,_hi,_st)},(_,k)=>_lo+_st*k);})(${lo},${hi})`;
  }
  const step = compileRangeOperand(stepExpr, target);
  return `((_lo,_hi,_st)=>_st===0?[]:Array.from({length:${countFn}(_lo,_hi,_st)},(_,k)=>_lo+_st*k))(${lo},${hi},${step})`;
}

export function newLocalFunctionScope(
  target: CompileTarget<Expression>
): Map<string, Expression> | undefined {
  if (!bindsLocalFunctions(target)) return undefined;
  return new Map(target.localFunctions ?? []);
}

/**
 * The `lexicalFunctions` scope for a statement list: every function-valued
 * local the list declares, merged over the enclosing lexical scope. Unlike
 * {@link newLocalFunctionScope} this is complete before any statement is
 * emitted — see `CompileTarget.lexicalFunctions` for why a function-literal
 * body resolves against the whole list and a statement against only the
 * part before it.
 */
export function lexicalFunctionScope(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  rebound: ReboundFunctionLocals
): ReadonlyMap<string, Expression> | undefined {
  if (!bindsLocalFunctions(target)) return undefined;
  const scope = new Map(target.lexicalFunctions ?? target.localFunctions ?? []);
  for (const stmt of stmts) noteLocalFunction(stmt, scope, rebound);
  return scope;
}

/**
 * The `reboundFunctions` scope for a statement list (see
 * `CompileTarget.reboundFunctions`): the enclosing scope, without the names
 * this list declares again (a `Declare` makes a new binding, which this
 * list's own analysis describes), and with the names this list rebinds.
 *
 * A name this list writes but does NOT declare is a binding of an enclosing
 * list. That list saw every write of this list as a nested write, so its
 * entry already accounts for all of the literals the name can hold. Keep
 * that complete entry: this list sees only some of those literals, and
 * their signatures and return paths prove nothing about the others.
 */
export function reboundFunctionScope(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  rebound: ReboundFunctionLocals
): CompileTarget<Expression>['reboundFunctions'] {
  if (!bindsLocalFunctions(target)) return undefined;
  const inherited = target.reboundFunctions;
  if (rebound.rebound.size === 0 && (inherited?.size ?? 0) === 0)
    return inherited;
  const scope = new Map(inherited ?? []);
  const declared = new Set<string>();
  for (const stmt of stmts)
    if (isFunction(stmt, 'Declare') && isSymbol(stmt.ops[0])) {
      declared.add(stmt.ops[0].symbol);
      scope.delete(stmt.ops[0].symbol);
    }
  for (const [name, info] of rebound.rebound) {
    if (!declared.has(name) && inherited?.has(name)) continue;
    scope.set(
      name,
      info.decline === undefined
        ? { literals: info.literals }
        : { decline: info.decline }
    );
  }
  return scope;
}

/**
 * The function-valued locals of statement list `stmts` whose value can
 * change while the list runs, so that no single function literal is their
 * value at every call. A name is such a local when an `Assign` writes it
 * INSIDE a statement (a loop body, a branch, an inner block, a
 * function-literal body), or when the list binds it more than once at the
 * top level (a `Declare` with a value, or an `Assign`).
 *
 * In `k := f1; for … { k(1); k := f2 }` the call runs with `f1` in the first
 * iteration and with `f2` after it. Such a call is compiled as a call of the
 * run-time binding (`k(1)`), which reads the value the interpreter reads at
 * that point, and it never folds or inlines one literal. The call site needs
 * the signature of the callee (arity, broadcast, complex arguments), so the
 * name compiles only when every literal it is assigned has the same
 * signature. Otherwise, and when the name is also assigned a value that is
 * not a function literal, the entry holds the reason the call declines.
 *
 * A write is not counted when it writes a different binding of the same
 * name: inside an inner block that declares the name again, or inside a
 * function literal that has a parameter of that name.
 *
 * The result is empty when the list has no function literal. Then the list
 * binds no function-valued local, and an entry it inherits is already
 * correct: a write to that name inside this list is a nested write in the
 * list that made the entry.
 */
export function reboundLocalNames(
  stmts: ReadonlyArray<Expression>
): ReboundFunctionLocals {
  const result: ReboundFunctionLocals = {
    rebound: new Map(),
    writes: new Map(),
  };
  // The literals a call returns, when the callee is one function literal
  // that returns a function literal on every path (see
  // `returnedFunctionLiterals`): `mk(2)` for `function mk(n) { (x) => x + n
  // }`. The callee is the one literal that this list binds the name to at
  // the top level, or else the engine's user function of that name.
  const callResults = (
    value: Expression | undefined
  ): Array<Expression & FunctionInterface> | undefined => {
    if (!isFunction(value) || value.operator === 'Function') return undefined;
    const h = value.operator;
    const local: Expression[] = [];
    for (const s of stmts) {
      if (!isFunction(s, 'Declare') && !isFunction(s, 'Assign')) continue;
      if (!isFunction(s) || !isSymbol(s.ops[0]) || s.ops[0].symbol !== h)
        continue;
      const v =
        s.operator === 'Declare' ? declareValueOperand(s.ops) : s.ops[1];
      if (v !== undefined) local.push(v);
    }
    const callee =
      local.length === 0
        ? userFunctionLiteral(value.engine, h)
        : local.length === 1 && isFunction(local[0], 'Function')
          ? local[0]
          : undefined;
    if (callee === undefined || value.nops !== callee.nops - 1)
      return undefined;
    return returnedFunctionLiterals(callee.op1);
  };
  const topLevelValue = (s: Expression): Expression | undefined => {
    if (!isFunction(s, 'Declare') && !isFunction(s, 'Assign')) return undefined;
    if (!isFunction(s) || !isSymbol(s.ops[0])) return undefined;
    return s.operator === 'Declare' ? declareValueOperand(s.ops) : s.ops[1];
  };
  if (
    !stmts.some((s) => s.has('Function')) &&
    !stmts.some((s) => callResults(topLevelValue(s)) !== undefined)
  )
    return result;
  // The names bound at the top level to the value of such a call. Their
  // value is a function known only at run time, so a call of one is
  // compiled as a call of the run-time binding, as for a name assigned
  // more than once, with the returned literals as the values it can hold.
  // Without this, `let a = mk(2)` then `a(1)` failed with "Unknown
  // operator `a`". CE-225.
  const fromCall = new Set<string>();
  // The names bound to the value of another call whose type has a
  // function arm (`((unknown) -> number) | integer`): a call of such a
  // name declines with that reason.
  const maybeFunction = new Set<string>();
  // Every value each name is bound to in the list (`undefined` for a leaf of
  // a destructuring write, whose value is not read here), and the
  // statements that bind it.
  const values = new Map<string, Array<Expression | undefined>>();
  const writers = new Map<string, Set<Expression>>();
  const nested = new Set<string>();
  const topLevelCount = new Map<string, number>();
  const record = (
    name: string,
    value: Expression | undefined,
    stmt: Expression
  ): void => {
    values.set(name, [...(values.get(name) ?? []), value]);
    writers.set(name, (writers.get(name) ?? new Set()).add(stmt));
  };
  const walk = (
    node: Expression | undefined,
    shadowed: ReadonlySet<string>,
    stmt: Expression
  ): void => {
    if (!isFunction(node)) return;
    let inner = shadowed;
    if (node.operator === 'Function') {
      const params = node.ops
        .slice(1)
        .map((p) => functionLiteralParameterName(p))
        .filter((p) => p !== '');
      if (params.length > 0) inner = new Set([...shadowed, ...params]);
    } else if (node.operator === 'Block') {
      const names = [...(node.localScope?.bindings.keys() ?? [])];
      for (const s of node.ops)
        if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
          names.push(s.ops[0].symbol);
      if (names.length > 0) inner = new Set([...shadowed, ...names]);
    }
    if (node.operator === 'Assign') {
      const writeLeaf = (t: Expression | undefined, value?: Expression) => {
        if (isSymbol(t)) {
          if (inner.has(t.symbol)) return;
          nested.add(t.symbol);
          record(t.symbol, value, stmt);
        } else if (isFunction(t, 'Tuple'))
          for (const leaf of t.ops) writeLeaf(leaf);
      };
      writeLeaf(node.ops[0], node.ops[1]);
    }
    for (const op of node.ops) walk(op, inner, stmt);
  };
  const none = new Set<string>();
  for (const stmt of stmts) {
    if (
      (isFunction(stmt, 'Declare') || isFunction(stmt, 'Assign')) &&
      isSymbol(stmt.ops[0])
    ) {
      const name = stmt.ops[0].symbol;
      const value =
        stmt.operator === 'Declare'
          ? declareValueOperand(stmt.ops)
          : stmt.ops[1];
      if (value !== undefined) {
        topLevelCount.set(name, (topLevelCount.get(name) ?? 0) + 1);
        const returned = callResults(value);
        if (returned !== undefined) {
          fromCall.add(name);
          for (const literal of returned) record(name, literal, stmt);
        } else {
          if (
            isFunction(value) &&
            value.operator !== 'Function' &&
            typeHasFunctionArm(value.type.type)
          )
            maybeFunction.add(name);
          record(name, value, stmt);
        }
      }
      for (const op of stmt.ops.slice(1)) walk(op, none, stmt);
    } else walk(stmt, none, stmt);
  }

  const signature = (literal: Expression & FunctionInterface): string =>
    [
      String(literal.nops - 1),
      typeToString(literal.type.type),
      ...literal.ops.slice(1).map((p) => {
        const t = functionLiteralParameterType(p);
        return t === undefined ? '' : typeToString(t);
      }),
    ].join('|');
  for (const [name, vals] of values) {
    if (
      !nested.has(name) &&
      !fromCall.has(name) &&
      !maybeFunction.has(name) &&
      (topLevelCount.get(name) ?? 0) <= 1
    )
      continue;
    const literals = vals.filter(
      (v): v is Expression & FunctionInterface =>
        v !== undefined && isFunction(v, 'Function')
    );
    // A name never assigned a function literal is not function-valued.
    if (literals.length === 0) {
      if (maybeFunction.has(name))
        result.rebound.set(name, {
          decline:
            `Could not compile a call of \`${name}\`: the value of ` +
            `\`${name}\` is the result of a call that can return a ` +
            `function, but does not return a function literal on every ` +
            `path, so the compiled call has no signature to follow.`,
        });
      continue;
    }
    const reason = fromCall.has(name)
      ? `Could not compile a call of \`${name}\`: the value of ` +
        `\`${name}\` is a function returned by a call, so the compiled ` +
        `call reads it at run time and must know the signature of every ` +
        `function it can be. `
      : `Could not compile a call of \`${name}\`: the block-local function ` +
        `\`${name}\` is assigned more than once or inside a nested statement, ` +
        `so the compiled call reads its value at run time and must know the ` +
        `signature of every value it can hold. `;
    let decline: string | undefined;
    if (literals.length < vals.length)
      decline =
        reason +
        `It is also assigned a value that is not a function literal, ` +
        `whose signature is not known.`;
    else if (new Set(literals.map(signature)).size > 1)
      decline =
        reason +
        `It is assigned functions with different signatures ` +
        `(${[...new Set(literals.map((l) => typeToString(l.type.type)))].join(', ')}, ` +
        `or a different number of parameters).`;
    result.rebound.set(
      name,
      decline === undefined ? { literal: literals[0], literals } : { decline }
    );
    for (const stmt of writers.get(name) ?? [])
      result.writes.set(stmt, (result.writes.get(stmt) ?? new Set()).add(name));
  }
  return result;
}

/**
 * Record statement `stmt`'s function-valued local in `scope`, if it binds
 * one: a `Declare` whose value is a function literal (`const g = (k) => …`),
 * or an `Assign` of a function literal to a name (`Declare(g, "function")`
 * followed by `Assign(g, Function(…))`, or an `Assign` whose `Declare` was
 * synthesized by `withImplicitLocalDeclares`).
 *
 * A binding whose value is NOT a function literal REMOVES the entry it
 * shadows or replaces (`let g = 5` over an outer function-valued `g` must
 * not keep calling the outer one).
 *
 * A name that `rebound` lists (its value can change while the list runs —
 * see `reboundLocalNames`) enters the scope at the first statement that
 * assigns it, at the top level or inside the statement, with the literal
 * `rebound` chose for it; it has no entry when its call declines. A
 * `Declare` of it with no value removes the entry: the binding has no value
 * until an assignment runs.
 */
export function noteLocalFunction(
  stmt: Expression,
  scope: Map<string, Expression> | undefined,
  rebound: ReboundFunctionLocals
): void {
  if (scope === undefined) return;
  for (const name of rebound.writes.get(stmt) ?? []) {
    const literal = rebound.rebound.get(name)?.literal;
    if (literal !== undefined) scope.set(name, literal);
    else scope.delete(name);
  }
  if (!isFunction(stmt, 'Declare') && !isFunction(stmt, 'Assign')) return;
  if (!isSymbol(stmt.ops[0])) return;
  const name = stmt.ops[0].symbol;
  const value =
    stmt.operator === 'Declare' ? declareValueOperand(stmt.ops) : stmt.ops[1];
  if (rebound.rebound.has(name)) {
    if (value === undefined) scope.delete(name);
    return;
  }
  if (value !== undefined && isFunction(value, 'Function'))
    scope.set(name, value);
  else scope.delete(name);
}

/**
 * Create a target that compiles conditions as plain JS booleans.
 * Used inside `compileLoopBody` so that `if (cond)` gets a real boolean,
 * not an interval result object (which would always be truthy).
 *
 * Overrides comparison and logical operators to use plain JS, and
 * numeric values/variables to use raw numbers (the loop counter is
 * already a plain number).
 */
export function scalarConditionTarget(
  target: CompileTarget<Expression>
): CompileTarget<Expression> {
  const SCALAR_OPS: Record<string, [string, number]> = {
    Less: ['<', 20],
    Greater: ['>', 20],
    LessEqual: ['<=', 20],
    GreaterEqual: ['>=', 20],
    Equal: ['===', 20],
    NotEqual: ['!==', 20],
    And: ['&&', 6],
    Or: ['||', 5],
    Not: ['!', 16],
  };

  // If the target doesn't wrap numbers, no override needed
  if (target.number(0) === '0') return target;

  return {
    ...target,
    number: (n: number) => String(n),
    var: (id: string) => {
      // Resolve through original target, then strip interval wrapping
      // e.g. '_IA.point(i)' → 'i', plain 'x' stays 'x'
      const resolved = target.var(id);
      if (!resolved) return undefined as any;
      const match = resolved.match(/^_IA\.point\((.+)\)$/);
      return match ? match[1] : resolved;
    },
    operators: (op: string) => SCALAR_OPS[op] ?? target.operators?.(op),
    functions: (id: string) => {
      // Comparison functions should not be used — operators handle them
      if (id in SCALAR_OPS) return undefined;
      return target.functions?.(id);
    },
  };
}

/**
 * Compile loop constructs (Sum/Product)
 */
export function compileLoop(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node?: Expression
): string {
  if (!args[0])
    throw new Error('Could not compile `Sum` or `Product`: no body');

  // Multi-index Sum/Product (more than one indexing-set clause) is not
  // representable in this generic single-index loop. Fail closed rather
  // than silently drop the trailing clauses and emit code with a dangling
  // index variable.
  if (args.length > 2)
    throw new Error(
      `Could not compile \`${h}\`: multi-index (${args.length - 1} indexing sets) is not supported by this target`
    );

  const {
    index,
    lower,
    upper,
    isFinite: _isFinite,
  } = normalizeIndexingSet(args[1]);
  const isSum = h === 'Sum';
  const op = isSum ? '+' : '*';
  // Analyze the body with the index masked, exactly as `isComplexValued`
  // does for the whole `Sum`/`Product` — otherwise the emitter could produce
  // a complex accumulator that the enclosing expression consumes as a real
  // number (Tycho item 65).
  const bodyIsComplex = withBinderMask(
    { real: index ? [index] : [], shielded: index ? [index] : [] },
    () => core.isComplexValued(args[0])
  );

  if (!index) {
    // Loop over a collection
    const indexVar = tempVar(target);
    const acc = tempVar(target);
    const col = core.compile(args[0], target);
    if (bodyIsComplex) {
      if (isSum) {
        return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re + ${indexVar}.re, im: ${acc}.im + ${indexVar}.im }), { re: 0, im: 0 })`;
      }
      // Product
      return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re * ${indexVar}.re - ${acc}.im * ${indexVar}.im, im: ${acc}.re * ${indexVar}.im + ${acc}.im * ${indexVar}.re }), { re: 1, im: 0 })`;
    }
    return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
      isSum ? '0' : '1'
    })`;
  }

  // Reject a collection-valued body for the indexed form (see
  // `assertScalarBigOpBody`); the `!index` collection-reduce arm above is
  // exempt. (The JavaScript target never reaches this generic loop — its
  // own `emitSumProduct` handles the indexed form, including the
  // element-wise collection-body arm.)
  assertScalarBigOpBody(h, args[0]);

  // The body is the binder's own bindable region (§5.1(a)), pushed under the
  // target that binds the index — so a temporary lands INSIDE the loop and
  // is recomputed per iteration, never hoisted out of it.
  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) => {
      if (id === index) return index;
      return target.var(id);
    },
    ...withBoundScope(target, [index]),
  };
  const fn = compileOp(node, 0, bodyTarget, 0, args[0]);

  const acc = tempVar(target);

  // Iteration-budget guard (see CompileTarget.iterationBudget): a trip
  // count over the budget — including infinite or NaN bounds, for which
  // the negated comparison also fails — evaluates to NaN instead of
  // running the loop.
  const budget = target.iterationBudget;
  const guardNaN = (nan: string): string =>
    budget !== undefined
      ? `\n  if (!((${upper}) - ${index} < ${budget})) return ${nan};`
      : '';

  if (bodyIsComplex) {
    const val = tempVar(target);
    const guard = guardNaN('{ re: NaN, im: NaN }');
    if (isSum) {
      return `(() => {
let ${acc} = { re: 0, im: 0 };
let ${index} = ${lower};${guard}
while (${index} <= ${upper}) {
  const ${val} = ${fn};
  ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im };
  ${index}++;
}
return ${acc};
})()`;
    }
    // Product
    return `(() => {
let ${acc} = { re: 1, im: 0 };
let ${index} = ${lower};${guard}
while (${index} <= ${upper}) {
  const ${val} = ${fn};
  ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re };
  ${index}++;
}
return ${acc};
})()`;
  }

  return `(() => {
let ${acc} = ${isSum ? '0' : '1'};
let ${index} = ${lower};${guardNaN('NaN')}
while (${index} <= ${upper}) {
  ${acc} ${op}= ${fn};
  ${index}++;
}
return ${acc};
})()`;
}

/** Push a lexical frame of local complex-ness onto `_localComplex`. */
export function _pushLocalComplex(frame: Map<string, boolean>): void {
  CompilerState._localComplex.push(frame);
  _pushComplexMemoLayer();
}

/** Pop the innermost `_localComplex` frame. */
export function _popLocalComplex(): void {
  CompilerState._localComplex.pop();
  _popComplexMemoLayer();
}
