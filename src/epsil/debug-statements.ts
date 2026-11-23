import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator, symbol } from '../math-json/utils.js';
import type { Type } from '../common/type/types.js';

import { parseEpsil } from './parse-epsil.js';
import { islandParser } from './latex-islands.js';
import { resolveLibraryNames } from './resolve-library-names.js';

//
// The statements of an Epsil source at which a debug run of
// `executeEpsilAsync()` can pause (`EpsilDebugHooks`), for a debugger that
// greys out a breakpoint that can never stop.
//
// A statement calls the hooks when the asynchronous statement sequencer runs
// it (`evaluateStatementsAsync()`, `compute-engine/function-utils.ts`): an
// operand of a `Program` or of a `Block`, and the body of a function, when it
// carries source offsets. A statement that the engine evaluates on the
// synchronous route calls no hook. The analysis is simple and sound: it says
// "cannot pause" only for a statement that runs on the synchronous route in
// every run, and "can pause" for every other statement, also for some that
// never pause.
//

/** A statement of an Epsil source, and whether a debug run can pause at it. */
export type EpsilDebugStatementSite = {
  /** The offsets of the statement in the source, as in the `range` that the
   * debug hooks receive (`EpsilDebugStatement.range`). */
  range: [start: number, end: number];
  /** `false` when no run of `executeEpsilAsync()` with debug hooks calls
   * `beforeStatement` for the statement. `true` does not mean that a run
   * reaches it. */
  canPause: boolean;
};

/** The options of `parseEpsil()` that the editor functions take. */
type SourceOptions = {
  typeNames?: readonly string[];
  protocolNames?: readonly string[];
  sumVariants?: Readonly<Record<string, string>>;
  parseLatex?: (latex: string) => MathJsonExpression;
};

/** The library operators that apply a function literal written as one of
 * their operands on the synchronous route only, with the position of that
 * operand. `Map`, `Filter` and `TakeWhile` are lazy collections, with no
 * `evaluate` handler: their elements are produced by the synchronous
 * iterators of their collection handlers. `Count` has no `evaluateAsync`
 * handler, and counts with a predicate through `Filter`. (`Any` and `All`
 * await their predicate on the asynchronous route, `asyncCallbackRoute()` in
 * `library/collections.ts`: a statement of their predicate can pause.) */
const SYNCHRONOUS_CALLBACKS: ReadonlyMap<string, number> = new Map([
  ['Map', 0],
  ['Filter', 1],
  ['TakeWhile', 1],
  ['Count', 1],
]);

/** The slot names of a shorthand function (`any(L, _1 > 1)`): an operand
 * that mentions one outside a nested function literal is made a function
 * whose body is that operand, and the body is a statement
 * (`function-literal.ts`, `ANONYMOUS_SLOT_NAMES`). */
const SLOT_NAMES: ReadonlySet<string> = new Set([
  '_',
  ...Array.from({ length: 9 }, (_, i) => `_${i + 1}`),
]);

/** The operators whose operands can run after the statement that holds them,
 * when the value they make is applied, released or called. Their operands
 * are not on the route of the enclosing statement: a function literal
 * written in the body of a `map` callback, and returned by it, runs on the
 * asynchronous route when a later statement calls it. */
const DEFERRED: ReadonlySet<string> = new Set([
  'Function',
  'DefineFunction',
  'Hold',
  'DeclareType',
  'DeclareSumType',
  'DeclareProtocol',
  'DeclareConformance',
]);

/**
 * The statements of `source` at which a debug run of `executeEpsilAsync()`
 * (`ExecuteEpsilAsyncOptions.debug`) can call `beforeStatement`, and those at
 * which it cannot.
 *
 * Each item is a statement that carries source offsets: a top-level
 * statement, a statement of a block (`do`, a function body, a loop body, a
 * branch of `if`, an arm of `match`), and the body of a function that is not
 * a block (`t => t * 2`). The items are in source order, an enclosing
 * statement before the statements it holds.
 *
 * `canPause` is `false` for a statement that the engine always evaluates on
 * the synchronous route:
 * a statement of a function literal written as the function of `map`, the
 * predicate of `filter`, `takeWhile` or `count`: `map(k => do { let t = k;
 * t * 2 }, 1..3)`. The collection applies it when it produces an element,
 * also when the host reads the collection after the run ends. This holds
 * only for the library operator: when the source binds the name (a
 * `function Map(f, xs)`, a variable `Map`) or the engine has another
 * definition of it, the statements of its callback can pause.
 *
 * A function literal, a `function`, a `hold` and a type declaration written
 * inside such a place make a value that a later statement can call or
 * release on the asynchronous route: their statements can pause. Every other
 * statement can pause too, including some that never do: a statement of a
 * named function that only `map` applies (`map(sq, 1..3)`), or that only the
 * domain of a `for` calls (`for x in 1..g(2)`), a statement of a function
 * literal that a name holds (`let f = k => …; map(f, xs)`), a statement of a
 * `do` block in a comprehension (`[do { … } for k in 1..3]`), a statement of
 * `withRandomSeed`, which the engine evaluates on the synchronous route
 * unless the engine has an operator with only an asynchronous handler.
 *
 * The body of a shorthand function given to a library operator
 * (`any(L, _1 > 1)`) is listed as a statement that can pause. A callback
 * written with no slot and no `=>`, and a shorthand function given to a
 * function of the source, which the engine also make functions, are not
 * listed.
 *
 * The library names are read as the run reads them
 * (`resolveLibraryNames()`): a `map` that the source or the engine defines
 * is not the library `map`. Pass the engine that the run uses.
 *
 * The result describes the hooks of `executeEpsilAsync()` only. The
 * synchronous statement hook of `executeEpsil()` that the VS Code debugger
 * uses fires on both routes, so every statement can pause there.
 *
 * The source is parsed and not evaluated. The options are those of
 * `epsilCompletions()`. A source that does not parse (`#error`) has no
 * statements.
 */
export function epsilDebugStatements(
  ce: ComputeEngine,
  source: string,
  options?: SourceOptions
): EpsilDebugStatementSite[] {
  let ast: MathJsonExpression;
  try {
    const [parsed] = parseEpsil(source, undefined, {
      typeNames: options?.typeNames,
      protocolNames: options?.protocolNames,
      sumVariants: options?.sumVariants,
      parseLatex: islandParser(ce, options?.parseLatex),
    });
    ast = resolveLibraryNames(parsed, source, ce);
  } catch {
    // A `#error` pragma throws: no tree, so no statement.
    return [];
  }

  const sites: EpsilDebugStatementSite[] = [];
  const statement = (node: MathJsonExpression, sync: boolean): void => {
    const offsets = offsetsOf(node);
    if (offsets !== undefined)
      sites.push({ range: [offsets[0], offsets[1]], canPause: !sync });
  };

  // The function literals written at a position of `SYNCHRONOUS_CALLBACKS`.
  const callbacks = new Set<MathJsonExpression>();
  // The names that the source may bind (`valueNames()`): a callee of that
  // name is not taken as the library operator.
  const bound = valueNames(ast);
  const isLibraryCallee = (head: string): boolean =>
    !bound.has(head) && ce._isLibraryFunction(head);

  // `sync` is true when every evaluation of `node` is on the synchronous
  // route.
  const walk = (node: MathJsonExpression, sync: boolean): void => {
    const head = operator(node);
    const ops = operands(node);
    if (head === 'Program' || head === 'Block')
      for (const op of ops) statement(op, sync);
    if (head === 'Function') {
      // The body runs when the function is applied: on the synchronous route
      // when the function is a synchronous callback (`callbacks`).
      const bodySync = callbacks.has(node);
      const [body, ...params] = ops;
      if (body !== undefined) {
        const inner = operator(body) === 'Typed' ? operands(body)[0] : body;
        if (inner !== undefined && operator(inner) !== 'Block')
          statement(inner, bodySync);
        walk(body, bodySync);
      }
      for (const param of params) walk(param, bodySync);
      return;
    }
    const callback = SYNCHRONOUS_CALLBACKS.get(head);
    if (callback !== undefined && isLibraryCallee(head)) {
      const fn = ops[callback];
      if (fn !== undefined && operator(fn) === 'Function') callbacks.add(fn);
    }
    const opsSync = DEFERRED.has(head) ? false : sync;
    // The operands that the engine makes a function when they are not one:
    // those at a parameter of a function type of a library operator.
    // A leaf has no operator (`head` is ''): it has no operand to lift.
    const lifted =
      head === '' || head === 'Program' || head === 'Block'
        ? undefined
        : functionParameters(ce, head, ops.length);
    ops.forEach((op, i) => {
      // A shorthand function: its body is a statement that can pause.
      if (
        lifted?.has(i) === true &&
        operator(op) !== 'Function' &&
        mentionsSlot(op)
      )
        statement(op, false);
      walk(op, opsSync);
    });
  };
  walk(ast, false);
  return sites.sort(
    (a, b) => a.range[0] - b.range[0] || b.range[1] - a.range[1]
  );
}

/** The positions of the operands of a call of the library operator `head`,
 * with `count` operands, at which a parameter of its signature, in one of its
 * arms, has a function type. Empty for a name that is not a library
 * operator. */
function functionParameters(
  ce: ComputeEngine,
  head: string,
  count: number
): Set<number> {
  const positions = new Set<number>();
  const visit = (type: Type | undefined): void => {
    if (typeof type !== 'object') return;
    if (type.kind === 'intersection') {
      for (const arm of type.types) visit(arm);
      return;
    }
    if (type.kind !== 'signature') return;
    const fixed = [...(type.args ?? []), ...(type.optArgs ?? [])];
    for (let i = 0; i < count; i++) {
      const element = i < fixed.length ? fixed[i] : type.variadicArg;
      if (element !== undefined && isFunctionType(element.type))
        positions.add(i);
    }
  };
  visit(ce.operatorInfo(head)?.signature?.type);
  return positions;
}

/** Whether a value of the type `type` can be a function. */
function isFunctionType(type: Type): boolean {
  if (type === 'function') return true;
  if (typeof type !== 'object') return false;
  if (type.kind === 'signature') return true;
  if (type.kind === 'union') return type.types.some(isFunctionType);
  return false;
}

/** Whether `node` mentions a slot name (`SLOT_NAMES`) outside a nested
 * function literal: the engine makes it a shorthand function. */
function mentionsSlot(node: MathJsonExpression): boolean {
  const name = symbolName(node);
  if (name !== undefined) return SLOT_NAMES.has(name);
  const head = operator(node);
  if (head === 'Function') return false;
  // A slot can be the callee: `_1(1)`.
  if (SLOT_NAMES.has(head)) return true;
  if (typeof node !== 'object' || node === null) return false;
  // Each node is walked once: the walk asks the question at every depth.
  let answer = SLOT_MEMO.get(node);
  if (answer === undefined) {
    answer = operands(node).some(mentionsSlot);
    SLOT_MEMO.set(node, answer);
  }
  return answer;
}

/** The answers of `mentionsSlot()`, for the nodes of the parsed trees. */
const SLOT_MEMO = new WeakMap<object, boolean>();

/** The names that the source writes as a value anywhere: every symbol that
 * is not the callee of a call. Each form that binds a name (a `function`, a
 * `let`, an assignment, a parameter, a loop variable, a `match` pattern, a
 * destructuring pattern) writes it as a symbol, while a call of a library
 * operator writes its name only as the callee. A name in this set may be
 * bound by the source, so a call of it is not taken as the library operator:
 * the set holds more names than the source binds (`map(Map, xs)`), which
 * only lists more statements as able to pause. */
function valueNames(tree: MathJsonExpression): Set<string> {
  const names = new Set<string>();
  const visit = (node: MathJsonExpression): void => {
    const name = symbolName(node);
    if (name !== undefined) {
      names.add(name);
      return;
    }
    for (const op of operands(node)) visit(op);
  };
  visit(tree);
  return names;
}

/** The name of a symbol node of the parsed tree, or `undefined`. */
function symbolName(node: MathJsonExpression | undefined): string | undefined {
  return node === undefined ? undefined : (symbol(node) ?? undefined);
}

/** The `sourceOffsets` of a node of the parsed tree, when it carries them. */
function offsetsOf(
  node: MathJsonExpression | null
): readonly [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}
