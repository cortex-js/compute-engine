import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';
import { isLibraryOperator } from '../library-shadowing.js';
import { rewriteWithBinders } from './binders.js';
import {
  isDictionary,
  isExpression,
  isFunction,
  isNumber,
} from './type-guards.js';

/**
 * The arbitrary constants of a result: `["ArbitraryConstant", k]` stands for
 * any number (a constant of integration, the free parameter of an identity),
 * `["ArbitraryInteger", k]` for any integer (the parameter of a family of
 * roots, of a diophantine or a congruence solution).
 *
 * Inside one result, two calls with the same index are the same value, and
 * two calls with different indexes are independent. The indexes are given
 * for one public operation (one evaluation of `Solve`, `DSolve` or `RSolve`,
 * one `expr.solve()`): each new constant takes the smallest index that is not
 * used by the input or the result, the values of the names they read
 * included. The index is decided when the operation ends, from its result
 * (`withArbitraryIndexes()`). Two results of two operations
 * both use the index 1: an expression that combines them identifies their
 * constants. Nothing is declared, and no definition is read to choose an
 * index. See `docs/plans/2026-11-12-arbitrary-constants-spec.md`.
 */
export type ArbitraryOperator = 'ArbitraryConstant' | 'ArbitraryInteger';

const ARBITRARY_OPERATORS: ReadonlySet<string> = new Set([
  'ArbitraryConstant',
  'ArbitraryInteger',
]);

/** Whether `expr` is a call of the library `ArbitraryConstant` or
 * `ArbitraryInteger`. A call of a user operator of the same name is not
 * (`isLibraryOperator()`). */
function isArbitraryCall(expr: Expression): boolean {
  return (
    isFunction(expr) &&
    ARBITRARY_OPERATORS.has(expr.operator) &&
    isLibraryOperator(expr)
  );
}

/** The index of a valid call `ArbitraryConstant(k)` or `ArbitraryInteger(k)`,
 * or `undefined` when `expr` is not such a call. Inside an operation, the
 * index of a provisional call is a negative number (`isProvisional()`). */
export function arbitraryIndex(expr: Expression): number | undefined {
  if (!isFunction(expr) || !isArbitraryCall(expr)) return undefined;
  if (expr.nops !== 1) return undefined;
  const k = positiveIntegerLiteral(expr.op1);
  if (k !== undefined) return k;
  const p = integerLiteral(expr.op1);
  return p !== undefined &&
    isProvisional(expr.engine, expr.operator as ArbitraryOperator, p)
    ? p
    : undefined;
}

function positiveIntegerLiteral(x: Expression): number | undefined {
  const k = integerLiteral(x);
  return k !== undefined && k >= 1 ? k : undefined;
}

function integerLiteral(x: Expression): number | undefined {
  if (!isNumber(x) || !x.isInteger) return undefined;
  const k = x.re;
  return Number.isSafeInteger(k) ? k : undefined;
}

/**
 * The canonical form of a call of `ArbitraryConstant` or `ArbitraryInteger`:
 * the operand must be a positive integer literal after its canonical form
 * (`Z(1 + 1)` is `Z(2)`). Any other call (`Z(0)`, `Z(-1)`, `Z(x)`, no operand,
 * two operands) has an error operand. The one exception is a provisional
 * index of the running operation (`isProvisional()`), which only the
 * operation makes.
 */
export function canonicalArbitrary(
  ce: ComputeEngine,
  operator: ArbitraryOperator,
  ops: ReadonlyArray<Expression>
): Expression {
  if (ops.length === 0) return ce._fn(operator, [ce.error('missing')]);
  const k = ops[0].canonical;
  const p = integerLiteral(k);
  const first =
    (p !== undefined && (p >= 1 || isProvisional(ce, operator, p))) ||
    !k.isValid
      ? k
      : ce.error('expected-positive-integer', k.toString());
  const extra = ops
    .slice(1)
    .map((op) => ce.error('unexpected-argument', op.toString()));
  return ce._fn(operator, [first, ...extra]);
}

/**
 * Whether `expr` holds a call of `ArbitraryConstant` or `ArbitraryInteger`.
 * A shared node is visited once.
 *
 * A call is not in `unknowns` or `freeVariables`. A test of "nothing is left
 * to decide" that reads them also tests this function: an expression that
 * holds a constant has an unknown.
 */
export function hasArbitraryConstant(expr: Expression): boolean {
  if (!isFunction(expr) && !isDictionary(expr)) return false;
  const seen = new Set<Expression>();
  const visit = (x: Expression): boolean => {
    if (isDictionary(x)) {
      if (seen.has(x)) return false;
      seen.add(x);
      return x.keys.some((key) => visit(x.get(key)!));
    }
    if (!isFunction(x)) return false;
    if (isArbitraryCall(x)) return true;
    if (seen.has(x)) return false;
    seen.add(x);
    return x.ops.some(visit);
  };
  return visit(expr);
}

/**
 * Replace each valid call of `ArbitraryConstant` or `ArbitraryInteger` in
 * `expr` by what `replace` gives for it. A call for which `replace` gives
 * `undefined` is kept. The nodes that hold no replaced call are kept as they
 * are; the others are made again in their form, with their scope and the
 * binding of their operator (`rewriteWithBinders()`).
 */
export function replaceArbitraryConstants(
  expr: Expression,
  replace: (operator: ArbitraryOperator, index: number) => Expression | undefined
): Expression {
  if (!hasArbitraryConstant(expr)) return expr;
  return rewriteWithBinders(
    expr,
    (sym) => sym,
    undefined,
    false,
    undefined,
    (app) => {
      const k = arbitraryIndex(app);
      return k === undefined
        ? undefined
        : replace(app.operator as ArbitraryOperator, k);
    }
  );
}

//
// ─── The indexes of one operation ───────────────────────────────────────────
//

type IndexSets = Record<ArbitraryOperator, Set<number>>;

function emptySets(): IndexSets {
  return { ArbitraryConstant: new Set(), ArbitraryInteger: new Set() };
}

/** The constants of integration of one `DSolve` or `RSolve`: symbols inside
 * the operation, calls in its result. */
interface IntegrationFrame {
  /** The names of the operands, which a constant does not take. */
  readonly reserved: Set<string>;
  /** The names that `integrationConstants()` gave, in order. */
  readonly names: string[];
}

interface ArbitraryOperation {
  /** The indexes of the inputs, of the operation and of the solvers and
   * helpers called inside it. The final indexes avoid them. */
  readonly used: IndexSets;
  /** The provisional indexes given during the operation, in the order in
   * which they were given, with their operator. */
  readonly provisional: Map<number, ArbitraryOperator>;
  readonly frames: IntegrationFrame[];
  /** The unknowns of the operation and of the solvers called inside it:
   * the values of these names are not read in the inputs. */
  readonly unknowns: Set<string>;
}

const OPERATIONS = new WeakMap<object, ArbitraryOperation>();

/** The magnitude of the last provisional index given, for all engines: a
 * provisional index is never given twice. */
let lastProvisional = 0;

/**
 * Whether `k` is a provisional index of `operator` given by the operation
 * that runs on `ce`.
 *
 * During an operation, a new constant has a provisional index: a negative
 * integer, which the canonical form of a call accepts only while the
 * operation that gave it runs (`canonicalArbitrary()`). A constant of an
 * input, a stored value or a function body has an index `k ≥ 1`, so no
 * provisional constant is the same value as one of them, and two
 * provisional constants are independent. When the outermost operation
 * ends, each provisional index of the result is replaced by its final index
 * (`finalIndexes()`), so a provisional index never leaves the operation.
 */
function isProvisional(
  ce: ComputeEngine,
  operator: ArbitraryOperator,
  k: number
): boolean {
  return k < 0 && OPERATIONS.get(ce)?.provisional.get(k) === operator;
}

const NO_NAMES: ReadonlySet<string> = new Set();

/** Add the indexes that occur in `expr` to `sets`, with those of the values
 * of the names that `expr` reads. The value of a name of `skip` (an unknown
 * of the operation, whose value the solver does not read) and of a name
 * bound by a binder of `expr` is not read. */
function collectIndexes(
  expr: Expression | undefined,
  sets: IndexSets,
  seen: Set<unknown>,
  skip: ReadonlySet<string> = NO_NAMES
): void {
  if (expr === undefined || seen.has(expr)) return;
  seen.add(expr);
  // The same walk as for a result: it reads the value of a name through the
  // binding of the occurrence, and the bounds of a clause with the enclosing
  // name. A provisional index of the input is not a used index.
  collectResultIndexes(expr, sets, new Set(), seen, skip);
}

/**
 * Run `fn`, one public operation. When an operation is already running (a
 * solver called inside another one), `fn` is part of it, and the indexes of
 * `inputs` are added to its used indexes.
 *
 * A new constant of the operation has a provisional index
 * (`isProvisional()`). When the outermost operation ends, the final indexes
 * are decided from its result (`finalIndexes()`): the provisional indexes
 * that occur in the result take, in the order in which they were given, the
 * smallest indexes that are used neither in the result (the values of the
 * names it holds included) nor in the inputs. A provisional index that is not
 * in the result (a strategy that failed) takes no index: a failed strategy
 * gives its indexes back.
 *
 * The result is an expression, a list or a record of expressions, or a list
 * of records. For another result, `map` applies a function to each of its
 * expressions, and `primary` gives the expressions whose provisional indexes
 * are numbered first (the indexes that occur only in the other expressions
 * come after them).
 *
 * `unknowns` are the names that the operation solves for: the solver does
 * not read their values, so the indexes of these values in the inputs are not
 * used.
 */
export function withArbitraryIndexes<T>(
  ce: ComputeEngine,
  inputs: ReadonlyArray<Expression | undefined>,
  fn: () => T,
  options?: {
    map?: (result: T, f: (x: Expression) => Expression) => T;
    primary?: (result: T) => ReadonlyArray<Expression>;
    unknowns?: Iterable<string>;
  }
): T {
  const active = OPERATIONS.get(ce);
  if (active !== undefined) {
    // The unknowns of the inner solver, for the time it runs.
    const added = [...(options?.unknowns ?? [])].filter(
      (name) => !active.unknowns.has(name)
    );
    for (const name of added) active.unknowns.add(name);
    try {
      const seen = new Set<unknown>();
      for (const input of inputs)
        collectIndexes(input, active.used, seen, active.unknowns);
      return fn();
    } finally {
      for (const name of added) active.unknowns.delete(name);
    }
  }
  const used = emptySets();
  const unknowns = new Set(options?.unknowns ?? []);
  const seen = new Set<unknown>();
  for (const x of inputs) collectIndexes(x, used, seen, unknowns);
  const operation: ArbitraryOperation = {
    used,
    provisional: new Map(),
    frames: [],
    unknowns,
  };
  OPERATIONS.set(ce, operation);
  let result: T;
  try {
    const map =
      options?.map ??
      ((r: T, f: (x: Expression) => Expression) =>
        mapSolveResult(r as SolveResult, f) as T);
    result = finalIndexes(operation, fn(), map, options?.primary);
  } finally {
    OPERATIONS.delete(ce);
  }
  if (PROVISIONAL_GUARD) assertNoProvisional(result);
  return result;
}

/**
 * Add to `real` the indexes `k ≥ 1` that occur in `expr`, and to
 * `provisional` its provisional indexes. The values of the names that
 * `expr` holds are read through the binding of each symbol (the stored
 * value, the literal of a function definition), also for a name called as
 * an operator. A name that a binder of `expr` binds is not read where it is
 * bound, and the bounds of a clause read the enclosing name
 * (`rewriteWithBinders()`). The values of dictionaries are read. A node or
 * a value reached twice is read once.
 */
function collectResultIndexes(
  expr: Expression,
  real: IndexSets,
  provisional: Set<number>,
  seen: Set<unknown>,
  skip: ReadonlySet<string> = NO_NAMES
): void {
  const read = (value: Expression | null | undefined): void => {
    if (value === undefined || value === null || seen.has(value)) return;
    seen.add(value);
    collectResultIndexes(value, real, provisional, seen, skip);
  };
  const readDefinition = (x: Expression): void => {
    const def = x.valueDefinition;
    if (def !== undefined && def.holdUntil !== 'N') read(def.value);
    read(x.operatorDefinition?._lambdaLiteral);
  };
  rewriteWithBinders(
    expr,
    (sym, shadowed) => {
      if (!shadowed?.has(sym.symbol) && !skip.has(sym.symbol))
        readDefinition(sym);
      return sym;
    },
    undefined,
    false,
    undefined,
    (app, _ops, shadowed) => {
      // An operand of a lazy operator is not canonical yet.
      const k =
        arbitraryIndex(app) ??
        (isArbitraryCall(app) && !app.isCanonical
          ? arbitraryIndex(app.canonical)
          : undefined);
      if (k !== undefined) {
        if (k < 0) provisional.add(k);
        else real[app.operator as ArbitraryOperator].add(k);
      } else if (!shadowed?.has(app.operator))
        read(app.operatorDefinition?._lambdaLiteral);
      return undefined;
    }
  );
}

/**
 * The result of the outermost operation with each provisional index
 * replaced by its final index. The provisional indexes that occur in the
 * expressions of `primary` are numbered first, then those that occur only
 * in the other expressions of the result, each group in the order in which
 * the indexes were given. Each takes the smallest index `k ≥ 1` of its
 * operator that is not used (by the inputs of the operation and of the
 * solvers called inside it, or by the result and the values it reads) and
 * not taken yet.
 */
function finalIndexes<T>(
  operation: ArbitraryOperation,
  result: T,
  map: (result: T, f: (x: Expression) => Expression) => T,
  primary: ((result: T) => ReadonlyArray<Expression>) | undefined
): T {
  if (result === null || result === undefined) return result;
  if (operation.provisional.size === 0) return result;
  const used: IndexSets = {
    ArbitraryConstant: new Set(operation.used.ArbitraryConstant),
    ArbitraryInteger: new Set(operation.used.ArbitraryInteger),
  };
  const inResult = new Set<number>();
  const seen = new Set<unknown>();
  map(result, (x) => {
    collectResultIndexes(x, used, inResult, seen);
    return x;
  });
  if (inResult.size === 0) return result;
  const first = new Set<number>();
  if (primary !== undefined)
    for (const x of primary(result))
      collectResultIndexes(x, emptySets(), first, new Set());
  const order = [...operation.provisional.keys()].filter((k) =>
    inResult.has(k)
  );
  const table = new Map<number, number>();
  const next: Record<ArbitraryOperator, number> = {
    ArbitraryConstant: 1,
    ArbitraryInteger: 1,
  };
  for (const k of [
    ...order.filter((k) => first.has(k)),
    ...order.filter((k) => !first.has(k)),
  ]) {
    const operator = operation.provisional.get(k)!;
    while (used[operator].has(next[operator])) next[operator] += 1;
    table.set(k, next[operator]);
    next[operator] += 1;
  }
  return map(result, (x) =>
    replaceArbitraryConstants(x, (operator, k) => {
      const to = table.get(k);
      return to === undefined ? undefined : arbitraryCall(x.engine, operator, to);
    })
  );
}

/** Whether the development check of `assertNoProvisional()` runs. */
const PROVISIONAL_GUARD: boolean = (() => {
  try {
    return (
      typeof process !== 'undefined' &&
      process.env !== undefined &&
      process.env.NODE_ENV === 'test'
    );
  } catch {
    return false;
  }
})();

/** Throw when `result` (an expression, or an array or an object that holds
 * expressions) holds a call of `ArbitraryConstant` or `ArbitraryInteger`
 * whose operand is a negative integer: a provisional index that left its
 * operation. */
function assertNoProvisional(result: unknown): void {
  const seen = new Set<unknown>();
  const holds = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    if (isDictionary(x)) return x.keys.some((key) => holds(x.get(key)!));
    if (!isFunction(x)) return false;
    if (isArbitraryCall(x) && x.nops === 1) {
      const k = integerLiteral(x.op1);
      if (k !== undefined && k < 1) return true;
    }
    return x.ops.some(holds);
  };
  const visit = (x: unknown): boolean => {
    if (typeof x !== 'object' || x === null) return false;
    if (isExpressionLike(x)) return holds(x);
    if (seen.has(x)) return false;
    seen.add(x);
    return Object.values(x).some(visit);
  };
  if (visit(result))
    throw new Error(
      'A provisional index of ArbitraryConstant or ArbitraryInteger left its operation'
    );
}

type SolveResult =
  | Expression
  | ReadonlyArray<Expression>
  | Record<string, Expression>
  | ReadonlyArray<Record<string, Expression>>;

function mapSolveResult(
  result: SolveResult | null | undefined,
  f: (x: Expression) => Expression
): SolveResult | null | undefined {
  if (result === null || result === undefined) return result;
  if (Array.isArray(result))
    return result.map((item) =>
      isExpressionLike(item) ? f(item) : mapRecord(item, f)
    ) as SolveResult;
  if (isExpressionLike(result)) return f(result as Expression);
  if (typeof result === 'object')
    return mapRecord(result as Record<string, Expression>, f);
  return result;
}

function isExpressionLike(x: unknown): x is Expression {
  // Not a test of properties: `engine` and `operator` can be the names of
  // the unknowns of a solution record.
  return isExpression(x);
}

function mapRecord(
  record: Record<string, Expression>,
  f: (x: Expression) => Expression
): Record<string, Expression> {
  // `Object.fromEntries()` makes own properties, also for a name such as
  // `__proto__`, and keeps the prototype of a record of the solver.
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      isExpressionLike(value) ? f(value) : value,
    ])
  );
}

/** The call `operator(k)` bound to the library operator, also in a scope
 * where a user operator of the same name shadows it (`ce._libraryCall()`). */
function arbitraryCall(
  ce: ComputeEngine,
  operator: ArbitraryOperator,
  k: number
): Expression {
  return (
    ce._libraryCall(operator, [ce.number(k)]) ??
    ce._fn(operator, [ce.number(k)])
  );
}

function newIndexes(
  ce: ComputeEngine,
  operator: ArbitraryOperator,
  seed: Expression | undefined,
  count: number
): Expression[] {
  const operation = OPERATIONS.get(ce);
  const out: Expression[] = [];
  if (operation === undefined) {
    // A helper called outside an operation: its own input is the input, and
    // the indexes are final.
    const used = emptySets();
    collectIndexes(seed, used, new Set());
    const set = used[operator];
    for (let k = 1; out.length < count; k++)
      if (!set.has(k)) out.push(arbitraryCall(ce, operator, k));
    return out;
  }
  if (seed !== undefined)
    collectIndexes(seed, operation.used, new Set(), operation.unknowns);
  for (let i = 0; i < count; i++) {
    lastProvisional += 1;
    const k = -lastProvisional;
    // Recorded first: the canonical form of the call accepts it then.
    operation.provisional.set(k, operator);
    out.push(arbitraryCall(ce, operator, k));
  }
  return out;
}

/**
 * `count` new `ArbitraryInteger` calls of the running operation: the
 * parameters of a family of roots. `seed` is the input of the helper that
 * asks; its indexes are counted as used.
 */
export function arbitraryIntegers(
  ce: ComputeEngine,
  seed: Expression | undefined,
  count: number
): Expression[] {
  return newIndexes(ce, 'ArbitraryInteger', seed, count);
}

/**
 * `count` new `ArbitraryConstant` calls of the running operation: the free
 * parameter of an identity, a constant of integration in a result.
 */
export function arbitraryConstants(
  ce: ComputeEngine,
  seed: Expression | undefined,
  count: number
): Expression[] {
  return newIndexes(ce, 'ArbitraryConstant', seed, count);
}

//
// ─── Constants of integration (DSolve, RSolve) ──────────────────────────────
//

/**
 * Run `fn`, the body of one `DSolve` or `RSolve`, as a public operation. The
 * constants of integration are symbols inside it (`integrationConstants()`
 * names them); each one that is left in the result is replaced by a new
 * `ArbitraryConstant` call, in the order in which they were named.
 */
export function withIntegrationConstants(
  ce: ComputeEngine,
  inputs: ReadonlyArray<Expression | undefined>,
  fn: () => Expression | undefined
): Expression | undefined {
  // The operands after the equation are the unknown functions and the
  // variable: the solver does not read their values.
  const unknowns = new Set<string>();
  for (const input of inputs.slice(1))
    if (input !== undefined) collectNames(input, unknowns);
  return withArbitraryIndexes(
    ce,
    inputs,
    () => {
      const operation = OPERATIONS.get(ce)!;
      const reserved = new Set<string>();
      for (const input of inputs) if (input !== undefined) collectNames(input, reserved);
      const frame: IntegrationFrame = { reserved, names: [] };
      operation.frames.push(frame);
      let result: Expression | undefined;
      try {
        result = fn();
      } finally {
        operation.frames.pop();
      }
      if (result === undefined || frame.names.length === 0) return result;
      const left = frame.names.filter((name) => result!.has(name));
      if (left.length === 0) return result;
      const calls = arbitraryConstants(ce, undefined, left.length);
      const subs: Record<string, Expression> = { __proto__: null as never };
      left.forEach((name, i) => (subs[name] = calls[i]));
      return result.subs(subs);
    },
    { unknowns }
  );
}

function collectNames(expr: Expression, names: Set<string>): void {
  for (const name of expr.symbols) names.add(name);
}

/** The frame of the running `DSolve` or `RSolve`, if any. */
function integrationFrame(ce: ComputeEngine): IntegrationFrame | undefined {
  const frames = OPERATIONS.get(ce)?.frames;
  return frames === undefined ? undefined : frames[frames.length - 1];
}

/** The names of the operands of the running `DSolve` or `RSolve`, which a
 * constant of integration does not take. */
export function reservedIntegrationNames(
  ce: ComputeEngine
): ReadonlySet<string> | undefined {
  return integrationFrame(ce)?.reserved;
}

/** Record `name` as a constant of integration of the running `DSolve` or
 * `RSolve`. */
export function recordIntegrationConstant(
  ce: ComputeEngine,
  name: string
): void {
  const frame = integrationFrame(ce);
  if (frame !== undefined && !frame.names.includes(name)) frame.names.push(name);
}

/** The names of the constants of integration of the running `DSolve` or
 * `RSolve`. */
export function integrationConstantNames(
  ce: ComputeEngine
): ReadonlyArray<string> {
  return integrationFrame(ce)?.names ?? [];
}
