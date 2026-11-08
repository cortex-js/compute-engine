import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator, symbol } from '../math-json/utils.js';
// Type-only import: this module never statically imports the engine — the
// engine is injected at call time, as in `static-diagnostics.ts`.
import type { ComputeEngine } from '../compute-engine.js';
import type { Expression } from '../compute-engine/types-expression.js';
import type { Type } from '../common/type/types.js';
import { containsSignatureArm } from '../common/type/utils.js';
import { typeToString } from '../common/type/serialize.js';
import { inferFunctionLiteralEffects } from '../compute-engine/boxed-expression/effects-inference.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';
import type { ParsingDiagnostic } from './diagnostics.js';

//
// The static rules of a parallel loop (`parallel for x in xs { … }`, the MathJSON
// `ParallelLoop`) and of a parallel comprehension (`[e parallel for x in
// xs]`, `ParallelComprehension`). The passes of such a loop can run in any
// order, so the rules make the result independent of that order:
//
// 1. The body changes a variable declared outside the loop only with `+=`
//    (`parallel-outer-write`).
// 2. The body does not read a variable that it changes with `+=`, an
//    accumulator (`parallel-accumulator-read`). This check reports only a
//    read written by name in the text of the pass, also in a function literal
//    written in the pass. A read by another route (a function that the pass
//    calls, `parse("s")`, host code) cannot be found by a static check. Such
//    a read gives an unspecified value: the interpreter and the JavaScript
//    target give the value that the passes, run in order, give, and a target
//    that runs the passes in parallel declines a pass that reads an
//    accumulator.
// 4. The effects of the body that the engine infers are at most `random`
//    (`parallel-effect`). A function that calls an unannotated parameter is
//    inferred pure whatever function it receives: this rule does not see the
//    effects of that function.
// 5. No `break`, `continue` or `return` leaves the loop (`parallel-exit`).
// 6. The body of a parallel comprehension changes no variable declared
//    outside it, also with `+=` (`parallel-comprehension-write`).
//
// Rule 3 (the targets of `+=`) is checked by the parser (`add-to-target`), as
// is the rule that only the first clause of a comprehension can be parallel
// (`parallel-clause-not-first`).
//
// The walk reads the RAW statement, the tree that has the source offsets. A
// name is LOCAL to a pass when the body declares it (`let`, `const`, a
// function definition, a destructuring `let`, a first assignment in a
// function body), when it is bound by a clause of the loop or of a loop or
// comprehension in the body, when it is a parameter of a function literal in
// the body, or when it is a capture of a `match` case. A block scopes the
// names it declares. The static types of the clause variables of rule 4 come
// from the BOXED statement: a boxed node has the source offsets of the raw
// node it comes from.
//
// Design: `docs/plans/2026-11-07-ce1093-parallel-for.md`, §3.
//

/** The heads whose `Element` clauses bind names for their body. */
const CLAUSE_BINDERS = new Set([
  'Loop',
  'ParallelLoop',
  'Comprehension',
  'ParallelComprehension',
]);

/** The heads of the loops in which a `break` or a `continue` stays. */
const LOOP_HEADS = new Set(['Loop', 'ParallelLoop']);

type Write = { name: string; node: MathJsonExpression };

type WalkResult = {
  /** Assignments to names that are not local (rules 1 and 6). */
  outerWrites: Write[];
  /** `AddTo` targets whose root is not local: the accumulators. */
  accumulators: Write[];
  /** Reads of names that are not local, in source order. */
  outerReads: Write[];
  /** `break`/`continue`/`return` that leave the parallel loop (rule 5). */
  exits: { keyword: string; node: MathJsonExpression }[];
};

/**
 * The diagnostics of the parallel loops and comprehensions in `statement`, a
 * statement of a program as `staticDiagnostics()` reads it (library names
 * resolved). The effects of rule 4 are inferred with `ce`, in the scope of
 * the static pass: a function that an earlier statement defines is known.
 *
 * `boxed` is the statement boxed in that scope, when it could be boxed. The
 * static types of the clause variables of rule 4 and the lexical scope of
 * each parallel node come from it.
 */
export function parallelLoopDiagnostics(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  boxed?: Expression
): ParsingDiagnostic[] {
  const diagnostics: ParsingDiagnostic[] = [];
  const seen = new Set<string>();
  // The range of the parallel node that is checked: a node of the pass that
  // has no source range (a node that a rewrite made) is reported there, so
  // that no diagnostic is lost.
  let enclosingRange: [number, number] | undefined = undefined;
  const report = (
    node: MathJsonExpression,
    message: ParsingDiagnostic['message']
  ): void => {
    const range = rangeOf(node) ??
      enclosingRange ??
      rangeOf(statement) ?? [0, 0];
    // A write in a nested parallel loop is reported by the check of each
    // enclosing loop: keep one diagnostic per code and range.
    const key = `${JSON.stringify(message)}@${range[0]}:${range[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({ severity: 'error', message, range });
  };
  // Computed when the statement has a parallel node, once for the statement.
  let context: ParallelContexts | undefined = undefined;

  for (const node of parallelNodes(statement)) {
    enclosingRange = rangeOf(node);
    const head = operator(node);
    const [body, ...clauses] = operands(node);
    if (body === undefined) continue;
    const comprehension = head === 'ParallelComprehension';
    context ??= parallelContexts(boxed);

    // The clauses are read outside the passes, except the names they bind.
    const locals = new Set<string>();
    for (const clause of clauses) {
      if (operator(clause) !== 'Element') continue;
      const binding = operands(clause)[0];
      if (binding !== undefined) bindPattern(binding, locals);
    }
    // The guards and the domains of the later clauses of a comprehension
    // run in each pass, so they follow the rules of the body too.
    const passParts: MathJsonExpression[] = [body];
    clauses.forEach((clause, i) => {
      const parts = operands(clause);
      if (i > 0 && parts[1] !== undefined) passParts.push(parts[1]);
      if (parts[2] !== undefined) passParts.push(parts[2]);
    });

    const env: WalkEnv = { ce, enclosing: namesAround(statement, node) };
    const result: WalkResult = {
      outerWrites: [],
      accumulators: [],
      outerReads: [],
      exits: [],
    };
    for (const part of passParts)
      walk(part, locals, { loopDepth: 0, inFunction: false }, env, result);

    for (const { keyword, node: exit } of result.exits)
      report(exit, ['parallel-exit', keyword]);

    if (comprehension) {
      for (const { name, node: write } of [
        ...result.outerWrites,
        ...result.accumulators,
      ])
        report(write, ['parallel-comprehension-write', name]);
    } else {
      for (const { name, node: write } of result.outerWrites)
        report(write, ['parallel-outer-write', name]);
      const accumulators = new Set(result.accumulators.map((w) => w.name));
      for (const { name, node: read } of result.outerReads)
        if (accumulators.has(name))
          report(read, ['parallel-accumulator-read', name]);
    }

    // Rule 4. The writes that rules 1, 2 and 6 judge are taken out first: an
    // accumulator update and a write to an outer variable are not effects of
    // the pass for this rule (the first is allowed, the second has its own
    // diagnostic). The rest is inferred as the body of a function literal
    // whose parameters are the names that the clauses bind, so the writes to
    // the locals of the pass are confined to it.
    const judged = new Set(
      [...result.accumulators, ...result.outerWrites].map((w) => w.node)
    );
    const bound = new Set([...locals, ...env.enclosing]);
    for (const part of passParts) collectBindings(part, bound);
    const key = rangeKey(node);
    const effects = passEffects(ce, passParts, locals, judged, {
      types: context.clauses.get(key) ?? new Map(),
      scope: context.scopes.get(key),
      bound,
    });
    if (effects !== undefined) report(body, ['parallel-effect', effects]);
  }
  return diagnostics;
}

/** What rule 4 reads from a boxed statement, for each parallel node, by the
 * source range of the node (`rangeKey()`). */
type ParallelContexts = {
  /** The types of the names that the clauses bind. A destructuring pattern
   * gives no type. */
  clauses: ReadonlyMap<string, ReadonlyMap<string, Type>>;
  /** The lexical scope of the parallel node. */
  scopes: ReadonlyMap<string, Scope>;
};

/** A lexical scope of the engine (`ce._inScope()`). */
type Scope = Parameters<ComputeEngine['_inScope']>[0];

/**
 * The types of the clause variables and the lexical scope of each canonical
 * parallel node of `boxed` that has a source range, or empty maps when there
 * is no boxed statement. Nothing is evaluated.
 */
function parallelContexts(boxed: Expression | undefined): ParallelContexts {
  const clauses = new Map<string, Map<string, Type>>();
  const scopes = new Map<string, Scope>();
  if (boxed === undefined) return { clauses, scopes };
  const visit = (e: Expression, scope: Scope): void => {
    if (!e.isCanonical) return;
    const range = e.sourceOffsets;
    if (
      range !== undefined &&
      (isFunction(e, 'ParallelLoop') || isFunction(e, 'ParallelComprehension'))
    ) {
      const key = `${range[0]}:${range[1]}`;
      const bound = new Map<string, Type>();
      for (const clause of e.ops.slice(1))
        if (isFunction(clause, 'Element') && isSymbol(clause.op1))
          bound.set(clause.op1.symbol, clause.op1.type.type);
      clauses.set(key, bound);
      scopes.set(key, scope);
    }
    const inner = e.localScope ?? scope;
    if (isFunction(e)) for (const op of e.ops) visit(op, inner);
    else if (isDictionary(e)) for (const v of e.values) visit(v, inner);
  };
  try {
    visit(boxed, undefined);
  } catch {
    // A type that cannot be computed: the clause variables have no type, and
    // the effects are inferred in the scope of the static pass.
    clauses.clear();
    scopes.clear();
  }
  return { clauses, scopes };
}

/** The key of the source range of a raw node in `ParallelContexts`, or
 * `''` when the node has no source range. */
function rangeKey(node: MathJsonExpression): string {
  const range = rangeOf(node);
  return range === undefined ? '' : `${range[0]}:${range[1]}`;
}

/**
 * The names that `statement` binds around the parallel node `node`: the
 * parameters, the locals and the clause variables of the functions, blocks
 * and loops that the statement holds outside `node`. The name that the
 * statement itself defines at the top level (`function f`, `let f`, `f =
 * …`) is not one: in the scope of the static pass, `f` resolves to that
 * definition.
 */
function namesAround(
  statement: MathJsonExpression,
  node: MathJsonExpression
): Set<string> {
  const names = new Set<string>();
  const h = operator(statement);
  const parts =
    h === 'DefineFunction' || h === 'Assign'
      ? operands(statement).slice(1)
      : h === 'Declare'
        ? [declaredValue(operands(statement))].filter((v) => v !== undefined)
        : [statement];
  for (const part of parts) collectBindings(part, names, node);
  return names;
}

/**
 * Add the names that `expr` binds, at any depth, to `into`: a function
 * definition, a `let`, the root of an assignment target (a name, the list of
 * an element target, the base of a field target), a destructuring pattern, a
 * parameter, a clause variable, a `+=` target, a capture of a `match` case.
 * The subtree `skip`, when given, is not read.
 */
function collectBindings(
  expr: MathJsonExpression,
  into: Set<string>,
  skip?: MathJsonExpression
): void {
  if (expr === skip) return;
  const h = operator(expr);
  if (h === '') return;
  const ops = operands(expr);
  const [target] = ops;
  if (
    target !== undefined &&
    (h === 'Declare' ||
      h === 'DefineFunction' ||
      h === 'Assign' ||
      h === 'AddTo')
  ) {
    const root = targetRoot(target);
    if (root !== null) into.add(root);
    else bindPattern(target, into);
  } else if (h === 'Element' && target !== undefined) bindPattern(target, into);
  else if (h === 'MatchCase' && target !== undefined)
    for (const name of matchCaptures(target)) into.add(name);
  if (h === 'Function') for (const p of ops.slice(1)) bindPattern(p, into);
  for (const op of ops) collectBindings(op, into, skip);
}

/** The value of a raw `Declare` (its operands): the `value` entry of its
 * `Dictionary` operand, or `undefined` for a `let` with no value. */
function declaredValue(
  ops: ReadonlyArray<MathJsonExpression>
): MathJsonExpression | undefined {
  for (const op of ops.slice(1)) {
    if (operator(op) !== 'Dictionary') continue;
    for (const entry of operands(op)) {
      const [key, value] = operands(entry);
      if (operator(entry) === 'KeyValuePair' && symbol(key) === 'value')
        return value;
    }
  }
  return undefined;
}

/** The parallel loops and comprehensions in `expr`, outermost first. */
function parallelNodes(expr: MathJsonExpression): MathJsonExpression[] {
  const found: MathJsonExpression[] = [];
  const visit = (e: MathJsonExpression): void => {
    const h = operator(e);
    if (h === '') return;
    if (h === 'ParallelLoop' || h === 'ParallelComprehension') found.push(e);
    for (const op of operands(e)) visit(op);
  };
  visit(expr);
  return found;
}

/** Add the names that a binding pattern binds (a name, or a `Tuple` of
 * patterns; a `Typed` name binds the name; a parameter with a default
 * value, `["Optional", param, default]`, and a rest parameter, `["Spread",
 * param]`, bind the name of the parameter) to `into`. */
function bindPattern(pattern: MathJsonExpression, into: Set<string>): void {
  const name = symbol(pattern);
  if (name !== null) {
    into.add(name);
    return;
  }
  const h = operator(pattern);
  if (h === 'Tuple' || h === 'List' || h === 'Typed') {
    const parts = operands(pattern);
    for (const p of h === 'Typed' ? parts.slice(0, 1) : parts)
      bindPattern(p, into);
  } else if (h === 'Optional' || h === 'Spread') {
    const param = operands(pattern)[0];
    if (param !== undefined) bindPattern(param, into);
  }
}

/**
 * The names that the pattern of a `match` case binds: a capture is a symbol
 * that starts with `_` (`_x` binds `x`, the rest capture `___xs` binds
 * `xs`), at any depth of the pattern. `_` alone binds nothing, and the type
 * of a `Typed` pattern is not read.
 */
function matchCaptures(pattern: MathJsonExpression): string[] {
  const name = symbol(pattern);
  if (name !== null) {
    const bound = name.replace(/^_+/, '');
    return name.startsWith('_') && bound !== '' ? [bound] : [];
  }
  const h = operator(pattern);
  if (h === '') return [];
  const parts = operands(pattern);
  return (h === 'Typed' ? parts.slice(0, 1) : parts).flatMap(matchCaptures);
}

/** The names that a `match` pattern reads: its symbols that are not
 * captures (a constant such as `Pi`, a name compared with `==`). */
function matchPatternReads(pattern: MathJsonExpression): MathJsonExpression[] {
  const name = symbol(pattern);
  if (name !== null) return name.startsWith('_') ? [] : [pattern];
  const h = operator(pattern);
  if (h === '') return [];
  const parts = operands(pattern);
  return (h === 'Typed' ? parts.slice(0, 1) : parts).flatMap(matchPatternReads);
}

/** The root name of an assignment target: the name, the list of an `At`
 * chain, the base of a `Field` chain; `null` for a destructuring pattern. */
function targetRoot(target: MathJsonExpression): string | null {
  const name = symbol(target);
  if (name !== null) return name;
  const h = operator(target);
  if (h === 'At' || h === 'Field') {
    const base = operands(target)[0];
    return base === undefined ? null : targetRoot(base);
  }
  return null;
}

/** The names that the statements of a block declare (`let`, `const`, a
 * function definition), which are local to the whole block. */
function blockDeclarations(stmts: ReadonlyArray<MathJsonExpression>): string[] {
  const names = new Set<string>();
  for (const s of stmts) {
    const h = operator(s);
    if (h === 'Declare' || h === 'DefineFunction') {
      const target = operands(s)[0];
      if (target !== undefined) bindPattern(target, names);
    }
  }
  return [...names];
}

type WalkContext = {
  /** The number of loops of the body around the node: a `break` or a
   * `continue` in one of them stays in the pass. */
  loopDepth: number;
  /** Inside a function literal of the body: its `return` ends that
   * function. */
  inFunction: boolean;
};

/** What the walk reads besides the pass. */
type WalkEnv = {
  ce: ComputeEngine;
  /** The names that the statement binds around the parallel node
   * (`namesAround()`). */
  enclosing: ReadonlySet<string>;
};

/**
 * The name that the assignment `node` declares as a local, or `null`. In a
 * function body, an assignment to a name that no enclosing scope declares
 * declares a local of the block where it is written
 * (`src/epsil/docs/declarations.md`): it writes no variable outside the
 * function.
 */
function firstAssignmentLocal(
  node: MathJsonExpression,
  locals: ReadonlySet<string>,
  ctx: WalkContext,
  env: WalkEnv
): string | null {
  if (!ctx.inFunction || operator(node) !== 'Assign') return null;
  const target = operands(node)[0];
  const name = target === undefined ? null : symbol(target);
  if (name === null || locals.has(name) || env.enclosing.has(name)) return null;
  return env.ce.lookupDefinition(name) === undefined ? name : null;
}

function walk(
  node: MathJsonExpression,
  locals: ReadonlySet<string>,
  ctx: WalkContext,
  env: WalkEnv,
  result: WalkResult
): void {
  const name = symbol(node);
  if (name !== null) {
    if (!locals.has(name)) result.outerReads.push({ name, node });
    return;
  }
  const h = operator(node);
  if (h === '') return;
  const ops = operands(node);
  const visit = (e: MathJsonExpression, scope = locals, c = ctx): void =>
    walk(e, scope, c, env, result);

  switch (h) {
    case 'Block': {
      // A first assignment in a function body declares a local of the
      // block, from that statement on: `t` in `{ t = x; t += 1; t }` is a
      // local, not an accumulator.
      const inner = new Set([...locals, ...blockDeclarations(ops)]);
      for (const op of ops) {
        const local = firstAssignmentLocal(op, inner, ctx, env);
        if (local !== null) inner.add(local);
        visit(op, inner);
      }
      return;
    }
    case 'Declare': {
      // The target is declared by the enclosing block; the value is read.
      // Only the value: the key `value` of the `Dictionary` operand is not a
      // read of a variable `value`.
      const value = declaredValue(ops);
      if (value !== undefined) visit(value);
      return;
    }
    case 'DefineFunction': {
      // The target is declared by the enclosing block; the value is read.
      for (const op of ops.slice(1)) visit(op);
      return;
    }
    case 'Assign': {
      const [target, value] = ops;
      if (
        target !== undefined &&
        firstAssignmentLocal(node, locals, ctx, env) === null
      ) {
        const root = targetRoot(target);
        const names = new Set<string>();
        if (root !== null) names.add(root);
        else bindPattern(target, names);
        for (const n of names)
          if (!locals.has(n)) result.outerWrites.push({ name: n, node });
        // The positions of an `At` target and the receiver of a `Field`
        // target are read.
        if (operator(target) === 'At' || operator(target) === 'Field')
          for (const op of operands(target).slice(1)) visit(op);
      }
      if (value !== undefined) visit(value);
      return;
    }
    case 'AddTo': {
      const [target, value] = ops;
      if (target !== undefined) {
        const root = targetRoot(target);
        if (root !== null && !locals.has(root))
          result.accumulators.push({ name: root, node });
        if (operator(target) === 'At')
          for (const op of operands(target).slice(1)) visit(op);
      }
      if (value !== undefined) visit(value);
      return;
    }
    case 'Function': {
      const [body, ...params] = ops;
      const inner = new Set(locals);
      for (const p of params) bindPattern(p, inner);
      const fnCtx = { loopDepth: 0, inFunction: true };
      // A default value is not a binding, but it is evaluated when the
      // function is called: its free names are reads of the function. They
      // are read with the names of the enclosing scope, so a default that
      // names another parameter counts as a read of an outer variable too.
      for (const p of params)
        if (operator(p) === 'Optional') {
          const fallback = operands(p)[1];
          if (fallback !== undefined) visit(fallback, locals, fnCtx);
        }
      if (body !== undefined) visit(body, inner, fnCtx);
      return;
    }
    case 'Match': {
      // A case binds its captures for its guard and its body. The pattern
      // is not code: only the names that it reads are walked.
      const [subject, ...cases] = ops;
      if (subject !== undefined) visit(subject);
      for (const c of cases) {
        if (operator(c) !== 'MatchCase') {
          visit(c);
          continue;
        }
        const [pattern, ...rest] = operands(c);
        if (pattern === undefined) continue;
        for (const read of matchPatternReads(pattern)) visit(read);
        const inner = new Set([...locals, ...matchCaptures(pattern)]);
        for (const op of rest) visit(op, inner);
      }
      return;
    }
    case 'Break':
    case 'Continue':
      if (ctx.loopDepth === 0 && !ctx.inFunction)
        result.exits.push({
          keyword: h === 'Break' ? 'break' : 'continue',
          node,
        });
      for (const op of ops) visit(op);
      return;
    case 'Return':
      if (!ctx.inFunction) result.exits.push({ keyword: 'return', node });
      for (const op of ops) visit(op);
      return;
  }

  if (CLAUSE_BINDERS.has(h)) {
    const [body, ...clauses] = ops;
    const inner = new Set(locals);
    for (const clause of clauses) {
      if (operator(clause) !== 'Element') {
        visit(clause, inner);
        continue;
      }
      const [binding, domain, guard] = operands(clause);
      if (domain !== undefined) visit(domain, inner);
      if (binding !== undefined) bindPattern(binding, inner);
      if (guard !== undefined) visit(guard, inner);
    }
    // A `while` loop is a `Loop` with no clause: its `break` stays in it too.
    const bodyCtx = LOOP_HEADS.has(h)
      ? { ...ctx, loopDepth: ctx.loopDepth + 1 }
      : ctx;
    if (body !== undefined) visit(body, inner, bodyCtx);
    return;
  }

  // A call `f(x)` is `["f", "x"]`: the arguments are read. The callee is
  // not a read: a function that the pass calls is not followed (rule 2).
  for (const op of ops) visit(op);
}

/**
 * The effects of the parts of a pass that rule 4 refuses, as the text of the
 * diagnostic (`"console"`, `"random, state"`, `"any"`), or `undefined` when
 * the effects are at most `random`.
 *
 * The parts are inferred as the body of a function literal, in the lexical
 * scope of the parallel node, so that a function that the statement defines
 * around the loop is known:
 *
 * - `types` are the static types of the names that the clauses bind
 *   (`ParallelContexts.clauses`). A name whose type can hold a function is a
 *   parameter of the literal with that type, so a call of it has the effects
 *   that the type declares (`parallel for f in [() => print(1)] { f() }` is
 *   `console`).
 * - `scope` is the lexical scope of the parallel node, when the statement
 *   was boxed.
 * - A call of a name that has no definition in that scope, and that is not
 *   in `bound` (the names that the statement binds), is a call of a
 *   function that the program defines later, or of no function. It is
 *   inferred as the `Tuple` of its arguments: the effects of its arguments
 *   count, and the function itself is not seen, as the engine does not see
 *   it when it checks the effects that a function declares.
 */
function passEffects(
  ce: ComputeEngine,
  parts: ReadonlyArray<MathJsonExpression>,
  locals: ReadonlySet<string>,
  judged: ReadonlySet<MathJsonExpression>,
  context: {
    types: ReadonlyMap<string, Type>;
    scope: Scope;
    bound: ReadonlySet<string>;
  }
): string | undefined {
  const { types, scope, bound } = context;
  const notDefined = (name: string): boolean =>
    !bound.has(name) && ce.lookupDefinition(name) === undefined;
  let effects: ReadonlyArray<string> | 'any' | undefined;
  try {
    // The names that the clauses bind (also each name of a destructuring
    // pattern) are the parameters of the literal: a write to one of them,
    // `k += 1`, changes a local of the pass, not a variable of the scope.
    const params = [...locals].map((name): MathJsonExpression => {
      const type = types.get(name);
      return type !== undefined && containsSignatureArm(type)
        ? ['Typed', name, { str: typeToString(type) }]
        : name;
    });
    const inferred = ce._inScope(scope, () => {
      const body: MathJsonExpression = [
        'Block',
        ...parts.map((p) => withoutJudgedWrites(p, judged, notDefined)),
      ];
      return inferFunctionLiteralEffects(
        ce,
        ce.box(['Function', body, ...params] as MathJsonExpression, {
          form: 'raw',
        })
      );
    });
    effects = inferred.unresolvedHead
      ? 'any'
      : (inferred.effects as ReadonlyArray<string> | 'any' | undefined);
  } catch {
    // An inference that fails cannot show that the effects are at most
    // `random`, so the pass is refused with the effect `any`.
    return 'any';
  }
  if (effects === undefined) return undefined;
  if (effects === 'any') return 'any';
  const refused = effects.filter((e) => e !== 'random');
  return refused.length === 0 ? undefined : [...effects].sort().join(', ');
}

/**
 * `expr` with the writes that rules 1, 2 and 6 judge replaced by the values
 * they compute: an `AddTo` in `judged` becomes the `Tuple` of its target and
 * its value, and an `Assign` in `judged` becomes its value. What these
 * writes read and compute is kept, so its effects still count. A call
 * whose head satisfies `notDefined` becomes the `Tuple` of its arguments.
 *
 * `judged` holds the nodes of the writes whose target is not local where
 * they are written, as the walk found them (`WalkResult.accumulators` and
 * `WalkResult.outerWrites`). The effect inference judges the writes to the
 * locals of the pass itself.
 */
function withoutJudgedWrites(
  expr: MathJsonExpression,
  judged: ReadonlySet<MathJsonExpression>,
  notDefined: (name: string) => boolean
): MathJsonExpression {
  const strip = (e: MathJsonExpression): MathJsonExpression => {
    const h = operator(e);
    if (h === '') return e;
    const ops = operands(e);
    if (judged.has(e)) {
      if (h === 'AddTo') return ['Tuple', ...ops.map(strip)];
      if (h === 'Assign' && ops[1] !== undefined) return strip(ops[1]);
    }
    if (notDefined(h)) return ['Tuple', ...ops.map(strip)];
    return [h, ...ops.map(strip)];
  };
  return strip(expr);
}

/** The source range of a raw node, when it has one. */
function rangeOf(node: MathJsonExpression): [number, number] | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node))
    return undefined;
  const offsets = (node as { sourceOffsets?: unknown }).sourceOffsets;
  if (
    Array.isArray(offsets) &&
    offsets.length === 2 &&
    typeof offsets[0] === 'number' &&
    typeof offsets[1] === 'number'
  )
    return [offsets[0], offsets[1]];
  return undefined;
}
