/**
 * Three questions about how the code of a verified program of the
 * structured representation (`structured-ir.ts`) can run, answered on the
 * representation, with no target. The analysis is internal: no compile
 * option reads it, and it changes no result.
 *
 * Each answer is a property of the program as compiled on the structured
 * route. It says nothing about a host function passed to the compiled code
 * at run time, nothing about speed, and nothing about a host that shares one
 * input array between a call that reads it and other host code that writes
 * it at the same time: the code reads its inputs, and a write by the host
 * during the call changes what it reads.
 *
 * - `independentCalls`: two calls of the compiled function can run at the
 *   same time and each gives the value that it gives alone. It holds when no
 *   operation of the program, or of a function that it calls, is
 *   `effectful` or `unknown`, and no array that the host or a caller can
 *   hold is written in place. Captures are snapshots, fixed when the program
 *   is compiled, so no call can change what another call reads. The
 *   iteration budget is a caveat, not a failure (`ExecutionCaveat`). A
 *   `seeded` region whose body touches no state but the random stream is
 *   `pure` (`IRSeeded`): each call draws the same numbers from a new frame,
 *   so a program whose draws are all in such regions has independent calls.
 * - `workerPortable`: the code and what it reads can be sent to another
 *   worker, which rebuilds the function from its stored form with the
 *   runtime of the same version (`createJavaScriptRuntime().load()`). It
 *   holds when every function called is a function of the program, every
 *   capture is a snapshot of a number, no operation is `unknown` (such
 *   an operation can be a closure of the host, which a worker does not
 *   have) or `effectful` (see `workerPortable` in `analyzeExecution()`),
 *   and no operation is a `draw` or a `seeded` region, also when the region
 *   is `pure`: the random stream is not portable, as `isShippableCode()`
 *   (`kernel-pool.ts`) says of code that names its helpers.
 * - `parallelLoops`: for each `loop`, a candidate judgment: the iterations
 *   could run in any order, or at the same time, and give the same results.
 *   It is not a proof that running them at the same time is faster, and the
 *   analysis transforms nothing.
 */
import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  exitsOf,
  operationCanAbort,
  regionsOf,
  yieldedValues,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
} from './structured-ir.js';
import {
  consumableLoopInitials,
  inPlaceUpdates,
} from './structured-in-place.js';

/** An operation that makes a property fail. */
export type ExecutionBlocker = {
  readonly kind: IROperation['kind'];
  /** The prepared node of the operation. */
  readonly origin: Expression;
  /** The name of the function of the program whose body holds the
   *  operation; absent for the root. */
  readonly function?: string;
  /** Why the operation makes the property fail, in one phrase. */
  readonly reason: string;
};

/** A condition under which an answer that holds is still true, with the
 *  loops that it concerns. */
export type ExecutionCaveat = {
  readonly name: 'iteration-budget';
  readonly text: string;
  readonly loops: readonly Expression[];
};

export type ExecutionAnswer = {
  readonly holds: boolean;
  /** Empty when `holds` is true. */
  readonly blockers: readonly ExecutionBlocker[];
};

/**
 * A carried list of a candidate loop that the body updates, and the index of
 * its updates, as prepared nodes: `list` and `index` are the operands of a
 * `replace-at` of the list in the body (the first in the order of the
 * program). The body can hold several `replace-at` of the list at the index:
 * one per branch of an `if`, a chain of them, or one whose result is not
 * yielded. The judgment names the list and the index, not an operation: a
 * consumer takes the value of the list on the path to the yield of the body,
 * as the sequential code does.
 */
export type CarriedUpdate = {
  readonly list: Expression;
  readonly index: Expression;
  /** Whether the initial value of the carried list is consumable by the
   *  loop, by the rule of `inPlaceUpdates()` (`consumableLoopInitials()`):
   *  the sequential code then writes its array in place. When it is false,
   *  the initial list can be an input, a list that the body or later code
   *  reads, or another carried value, and the sequential code copies it at
   *  the first update: a parallel run must copy the initial list once
   *  before the iterations write into it. */
  readonly initialUnique: boolean;
};

/**
 * A check that a parallel implementation of a candidate loop must make at
 * run time, before it splits the loop, and run the loop in order when the
 * check fails.
 *
 * `bounds-at-least-one`: both bounds of the range are at least 1. The
 * analysis could not prove it from the representation (a bound that is a
 * literal, a numeric capture, or a sum or a product of such values, each at
 * least 1). The order of the writes does not matter only when no two indices
 * of the range name the same element: two different integers of one sign
 * name different elements, but an index and a negative index can name the
 * same element (`-1` and `n` in a list of `n` elements). A range whose bounds
 * are both at least 1 holds positive integers only.
 */
export type LoopCondition = 'bounds-at-least-one';

export type LoopJudgment = {
  readonly loop: IRLoop;
  readonly origin: Expression;
  /** The function of the program whose body holds the loop; absent for the
   *  root. */
  readonly function?: string;
} & (
  | {
      readonly candidate: true;
      /** One entry per carried list that the body updates, not one per
       *  `replace-at` (`CarriedUpdate`). A carried list
       *  that the body yields unchanged has no entry. */
      readonly updates: readonly CarriedUpdate[];
      /** Whether the loop can abort (`operationCanAbort()`): it has an
       *  iteration budget, or its body holds or calls a loop that has one. */
      readonly canAbort: boolean;
      /** The run-time checks that a parallel implementation must make
       *  before it splits the loop (`LoopCondition`); empty when the
       *  analysis proved each of them. */
      readonly conditions: readonly LoopCondition[];
    }
  | { readonly candidate: false; readonly reason: ExecutionBlocker }
);

export type ExecutionAnalysis = {
  readonly independentCalls: ExecutionAnswer & {
    readonly caveats: readonly ExecutionCaveat[];
  };
  readonly workerPortable: ExecutionAnswer;
  readonly parallelLoops: readonly LoopJudgment[];
};

/** The reason of a draw outside every `seeded` region, for
 *  `independentCalls`. */
const DRAW_REASON =
  'draws from the random stream of the engine: two calls give different values, and a call inside a seeded frame of its caller moves the counter of that frame';

/** The reason of a draw, or of an operation that touches only the random
 *  stream (a call of a function whose signature states `random`), for
 *  `workerPortable`. */
const WORKER_DRAW_REASON =
  'draws from the random stream of the engine, which the runtime of a worker does not share';

/** The text of the caveat of the iteration budget. */
const BUDGET_CAVEAT =
  'The iteration budget counts the passes of every loop of one call in a counter of the runtime, which each call sets to 0 when it starts. ' +
  'A call is synchronous: on one thread of JavaScript, two calls cannot interleave, so each counts its own passes. ' +
  'A worker has its own runtime, so its own counter. ' +
  'A call that calls the compiled function again before it ends (from a host function) would share the counter; such a call is an operation that is not pure, and makes the answer false.';

type Visit = (
  op: IROperation,
  fn: string | undefined,
  region: IRRegion
) => void;

/**
 * The analysis of `program`, which the verifier accepted.
 *
 * `independentCalls`: false when an operation, in the root or in a function
 * that the root calls, is `effectful` or `unknown` (each such operation is a
 * blocker, at the deepest operation that has the effect: a call is a blocker
 * only when the body of its function has no such operation), or when an
 * update in place writes an array that the host or a caller can hold. The
 * rule of `inPlaceUpdates()` never selects such an update: it writes in
 * place only a list that this invocation made, and an input, a capture or a
 * parameter of a function is never such a list. This function checks that
 * invariant again, with its own analysis (`hostArrays()`), and reports a
 * violation as a blocker. While the rule of `inPlaceUpdates()` holds, no
 * program, lowered or made, reaches that blocker: it guards a later change of
 * the rule. A loop with an iteration budget adds the caveat
 * `iteration-budget`.
 *
 * A `draw` outside every `seeded` region is a blocker with the reason that
 * names the random stream: two calls give different values, and a call made
 * inside a seeded frame of its caller advances that frame. A `seeded` region
 * whose body touches no other state is `pure` and is no blocker.
 *
 * `workerPortable`: false for an `unknown` operation, an `effectful`
 * operation, a `draw` or a `seeded` region anywhere (also a pure one), a
 * call of a function that is not in the program, or a capture whose
 * snapshot is not a number. The random stream is not portable (the choice
 * of `isShippableCode()`, which refuses code that names its helpers). For
 * another `effectful` operation (a write to the console of the host) the
 * analysis does not decide whether the runtime of a worker provides the
 * effect, and answers false.
 *
 * `parallelLoops`: one judgment per `loop` of the root and of the functions
 * that the root calls, in the order of the program. A wrong candidate is a
 * defect and a missed one is not, so a case that the rule cannot decide is
 * not a candidate. A body that draws outside a `seeded` region is not pure,
 * and the reason names the random stream: the values of a pass depend on
 * the passes before it. A loop is a candidate when its body is pure and every
 * carried value is a list whose every use in the body is in this list: the
 * list operand of a `replace-at` whose index is the loop index (the index
 * parameter itself; a local bound to it is the same value; not an expression
 * of it); the yield of the
 * body at the position of that carried value; the yield of a branch of an
 * `if` that is in the body or in such a branch, when both branches yield the
 * list or an update of it (one branch that does not replaces the list, which
 * fails). Every other use fails, among them an `at`, a `length`, an argument
 * of a call, the initial value of an inner loop, a yield at the position of
 * another carried value, and any use inside the body of an inner loop or of
 * a comprehension, or inside an operand of `and` or `or`. A loop whose body
 * holds an `exit` (in its body or in a branch of an `if` there, not in an
 * inner loop) is not a candidate: the number of its passes depends on the
 * earlier passes; the judgment names the first such `exit`. A body that yields
 * another list in place of the carried list also fails. A carried scalar is
 * an accumulation and fails with the reason `carried scalar` (a reduction is
 * a later step). Reads of other lists are allowed.
 *
 * Why the order does not matter for a candidate. Each iteration writes only
 * the element at its own index, and reads no element of the carried list, so
 * no iteration reads what another writes. Two iterations write the same
 * element only when their indices name the same element. When both bounds of
 * the range are at least 1 the indices are distinct positive integers, which
 * name distinct elements; otherwise an index and a negative index can name
 * the same element, and the candidate carries the run-time condition
 * `bounds-at-least-one` (`LoopCondition`). An abort does not depend on the
 * order either: an index out of range throws in whichever iteration it is,
 * and the iteration budget aborts the call when the total of its passes is
 * over the budget, a total that the order does not change. A parallel
 * implementation that splits the passes over workers counts that total
 * itself, since each worker has its own counter (`canAbort`). When the
 * initial list is not unique (`CarriedUpdate.initialUnique`), the sequential
 * code copies it, and a parallel implementation copies it once first.
 */
export function analyzeExecution(program: IRProgram): ExecutionAnalysis {
  // The operations of the root and of the functions that it calls, each
  // function once, in the order of the program.
  const visited = new Set<number>();
  const walk = (region: IRRegion, fn: string | undefined, visit: Visit) => {
    for (const op of region.operations) {
      visit(op, fn, region);
      if (op.kind === 'call' && !visited.has(op.function)) {
        visited.add(op.function);
        const callee = program.functions[op.function];
        if (callee !== undefined) walk(callee.body, callee.name, visit);
      }
      for (const inner of regionsOf(op)) walk(inner, fn, visit);
    }
  };

  const effects = effectBlockers(program);
  const independent: ExecutionBlocker[] = effects.map((b) => ({
    ...b.blocker,
    reason:
      b.draws
        ? DRAW_REASON
        : b.effect === 'unknown'
          ? 'an operation whose definition does not state its effects'
          : 'an operation whose definition states an effect',
  }));
  // A draw and a seeded region are blockers of their own below, wherever
  // they are.
  const portable: ExecutionBlocker[] = effects
    .filter((b) => b.blocker.kind !== 'draw')
    .map((b) => ({
      ...b.blocker,
      reason: b.draws
        ? WORKER_DRAW_REASON
        : b.effect === 'unknown'
          ? 'an operation whose definition does not state its effects: it can call a closure of the host, which a worker does not have'
          : 'an operation with an effect that the effect facts do not name: a worker may not provide it',
    }));

  const inPlace = inPlaceUpdates(program);
  const initials = consumableLoopInitials(program);
  const shared = hostArrays(program, inPlace);
  const budgetLoops: Expression[] = [];
  const loops: { loop: IRLoop; fn: string | undefined }[] = [];
  const bodyOf = (fn: string | undefined) =>
    program.functions.find((f) => f.name === fn)?.body ?? program.root;
  walk(program.root, undefined, (op, fn) => {
    if (
      op.kind === 'replace-at' &&
      inPlace.has(op) &&
      shared.has(op.operands[0].id)
    )
      independent.push(
        blocker(
          op,
          fn,
          'an update in place of an array that the host or a caller can hold'
        )
      );
    if (op.kind === 'loop') {
      loops.push({ loop: op, fn });
      if (op.iterationBudget !== undefined) budgetLoops.push(op.origin);
    }
    if (op.kind === 'call' && program.functions[op.function] === undefined)
      portable.push(
        blocker(op, fn, 'a call of a function that is not in the program')
      );
    if (op.kind === 'capture' && typeof op.snapshot !== 'number')
      portable.push(
        blocker(op, fn, 'a capture that is not a snapshot of a number')
      );
    if (op.kind === 'draw' || op.kind === 'seeded')
      portable.push(
        blocker(
          op,
          fn,
          op.kind === 'draw'
            ? WORKER_DRAW_REASON
            : 'a seeded region of the random stream of the engine, whose frames the runtime of a worker does not have: the stream is not portable'
        )
      );
  });

  return {
    independentCalls: {
      holds: independent.length === 0,
      blockers: independent,
      caveats:
        budgetLoops.length === 0
          ? []
          : [
              {
                name: 'iteration-budget',
                text: BUDGET_CAVEAT,
                loops: budgetLoops,
              },
            ],
    },
    workerPortable: { holds: portable.length === 0, blockers: portable },
    parallelLoops: loops.map(({ loop, fn }) =>
      judgeLoop(program, bodyOf(fn), loop, fn, initials)
    ),
  };
}

function blocker(
  op: IROperation,
  fn: string | undefined,
  reason: string
): ExecutionBlocker {
  return fn === undefined
    ? { kind: op.kind, origin: op.origin, reason }
    : { kind: op.kind, origin: op.origin, function: fn, reason };
}

/**
 * The operations that are `effectful` or `unknown` in the root and in the
 * functions that it calls: in each region, the deepest operation that has
 * the effect. An operation with regions, or a call, that is not `pure` is
 * reported only when nothing that it evaluates is (its effect then is its
 * own). In the body of a `seeded` region a draw is discharged and is not
 * reported (`onlyRandom()`). Each function is visited once, or once in and
 * once out of a seeded region, and each operation is reported once.
 */
function effectBlockers(
  program: IRProgram
): {
  blocker: ExecutionBlocker;
  effect: 'effectful' | 'unknown';
  /** The operation touches the random stream only (`onlyRandom()`). */
  draws: boolean;
}[] {
  const found: {
    blocker: ExecutionBlocker;
    effect: 'effectful' | 'unknown';
    draws: boolean;
  }[] = [];
  const visitedFunctions = new Map<string, boolean>();
  /** Whether `region` holds an operation that is not pure; reports each.
   *  `seeded`: the region is in the body of a `seeded` region, where a draw
   *  is discharged: it is not reported, nor the operations that it makes
   *  impure. */
  const scan = (
    region: IRRegion,
    fn: string | undefined,
    seeded: boolean
  ): boolean => {
    let any = false;
    for (const op of region.operations) {
      if (op.effect === 'pure') continue;
      if (seeded && onlyRandom(op)) continue;
      any = true;
      let inside = false;
      for (const inner of regionsOf(op))
        if (scan(inner, fn, seeded || op.kind === 'seeded')) inside = true;
      if (op.kind === 'call') {
        const callee = program.functions[op.function];
        const key = `${op.function}:${seeded}`;
        if (callee !== undefined) {
          if (!visitedFunctions.has(key)) {
            visitedFunctions.set(key, false);
            visitedFunctions.set(key, scan(callee.body, callee.name, seeded));
          }
          if (visitedFunctions.get(key) === true) inside = true;
        }
      }
      // A function scanned in and out of a seeded region reports an
      // operation once.
      if (!inside && !reported.has(op)) {
        reported.add(op);
        found.push({
          blocker: blocker(op, fn, ''),
          effect: op.effect,
          draws: onlyRandom(op),
        });
      }
    }
    return any;
  };
  const reported = new Set<IROperation>();
  scan(program.root, undefined, false);
  return found;
}

/** Whether the only effect of `op` is on the random stream: it is
 *  `effectful` and touches `random` only. In a `seeded` region such an
 *  operation is discharged (`IRSeeded`). */
function onlyRandom(op: IROperation): boolean {
  return (
    op.effect === 'effectful' &&
    op.touches?.length === 1 &&
    op.touches[0] === 'random'
  );
}

/**
 * The values of `program` that can hold an array that the host or a caller
 * holds: a list input, a list parameter of a function, and every value that
 * can be the same array (a value of an `if` or of a loop that one of them
 * flows into, the result of a loop that an `exit` hands one of them, the
 * result of a call of a function whose value can be its
 * parameter, the result of an update in place of such a value). A `build`
 * and a copying `replace-at` make a new array. The analysis is a may-alias
 * analysis, by ids of values: a fixed point over the functions and the root.
 * Exported for tests only.
 */
export function hostArrays(
  program: IRProgram,
  inPlace: ReadonlySet<IROperation>
): Set<number> {
  const shared = new Set<number>();
  /** For each function: whether its value can be an array of its caller. */
  const returnsShared: boolean[] = [];
  const isList = (v: IRValue) => v.type.startsWith('list<');
  const body = (region: IRRegion): boolean => {
    let size = -1;
    while (size !== shared.size) {
      size = shared.size;
      const visit = (r: IRRegion) => {
        for (const op of r.operations) {
          for (const inner of regionsOf(op)) visit(inner);
          const add = (v: IRValue | undefined) => {
            if (v !== undefined && isList(v)) shared.add(v.id);
          };
          if (op.kind === 'input') add(op.result);
          if (op.kind === 'call' && returnsShared[op.function] === true)
            add(op.result);
          if (
            op.kind === 'replace-at' &&
            inPlace.has(op) &&
            shared.has(op.operands[0].id)
          )
            add(op.result);
          // A closed branch yields nothing (`yieldedValues()` is empty).
          if (op.kind === 'if')
            op.results.forEach((result, j) => {
              if (
                [op.then, op.else].some((b) => {
                  const value = yieldedValues(b)[j];
                  return value !== undefined && shared.has(value.id);
                })
              )
                add(result);
            });
          if (op.kind === 'loop') {
            const next = yieldedValues(op.body);
            const exits = exitsOf(op);
            op.results.forEach((result, i) => {
              if (shared.has(op.operands[i + 2].id) || shared.has(next[i].id)) {
                add(result);
                add(op.body.parameters?.[i + 1]);
              }
              // The operand of an `exit` flows into the result only.
              if (exits.some((exit) => shared.has(exit.operands[i].id)))
                add(result);
            });
          }
        }
      };
      visit(region);
    }
    return shared.has(yieldedValues(region)[0]?.id);
  };
  // The lowering gives a called function a lower index, but the verifier
  // does not require it: the functions and the root are analyzed again
  // until no fact changes, so that a call of a function of the same or a
  // higher index reads the final fact of that function.
  for (const fn of program.functions)
    for (const p of fn.parameters) if (isList(p)) shared.add(p.id);
  for (let changed = true; changed;) {
    changed = false;
    const size = shared.size;
    program.functions.forEach((fn, i) => {
      const value = body(fn.body);
      if (value !== (returnsShared[i] === true)) changed = true;
      returnsShared[i] = value;
    });
    body(program.root);
    if (shared.size !== size) changed = true;
  }
  return shared;
}

/** The candidate judgment of `loop` (`analyzeExecution()`). `body`: the
 *  body of the function, or the root, that holds the loop. `initials`: the
 *  result of `consumableLoopInitials()`. */
function judgeLoop(
  program: IRProgram,
  body: IRRegion,
  loop: IRLoop,
  fn: string | undefined,
  initials: ReadonlyMap<IROperation, readonly boolean[]>
): LoopJudgment {
  const base =
    fn === undefined
      ? { loop, origin: loop.origin }
      : { loop, origin: loop.origin, function: fn };
  const fail = (op: IROperation, reason: string): LoopJudgment => ({
    ...base,
    candidate: false,
    reason: blocker(op, fn, reason),
  });

  // An `exit` ends the loop at a pass that the earlier passes decide.
  const [exit] = exitsOf(loop);
  if (exit !== undefined)
    return fail(
      exit,
      'the body holds an exit: the number of passes depends on the earlier passes'
    );

  if (loop.body.effect !== 'pure') {
    const first = firstImpure(program, loop.body);
    return fail(
      first ?? loop,
      first !== undefined && onlyRandom(first)
        ? 'the body draws from the random stream of the engine: the values of a pass depend on the passes before it'
        : first?.effect === 'unknown'
          ? 'the body has an operation whose definition does not state its effects'
          : 'the body has an operation whose definition states an effect'
    );
  }

  const parameters = loop.body.parameters ?? [];
  const index = parameters[0];
  const next = yieldedValues(loop.body);
  const bodyYield = loop.body.operations[loop.body.operations.length - 1];
  const updates: CarriedUpdate[] = [];

  for (let i = 0; i < loop.results.length; i++) {
    const parameter = parameters[i + 1];
    if (!parameter.type.startsWith('list<')) {
      const definer = definitionIn(loop.body, next[i].id);
      return fail(
        definer ?? loop,
        `carried scalar ${String((definer ?? loop).origin)}`
      );
    }
    // The values of the iteration that are the carried list or an update of
    // it at the loop index. Every use of such a value must be one of these,
    // and any other use fails the loop:
    // - the list operand of a `replace-at` whose index is the loop index
    //   itself, in the body or in a branch of an `if` of the chain below
    //   (its result is such a value);
    // - the yield of the body, at the position of this carried value;
    // - the yield of a branch of an `if` that is in the body, or in a branch
    //   of such an `if` (the chain): the `if` result is such a value when
    //   both branches yield one, and a failure when one branch does.
    // A region of another operation (the body of an inner loop or of a
    // `build`, an operand of `and` or `or`), and every region nested in
    // it, is outside the chain: any use there fails, because its result is
    // a new value that the check would not follow.
    const derived = new Set<number>([parameter.id]);
    let first: IROperation | undefined;
    let failure: LoopJudgment | undefined;
    /** `outside`: the operation whose region is outside the chain, or
     *  undefined in the chain. */
    const visit = (region: IRRegion, outside: IROperation | undefined) => {
      for (const op of region.operations) {
        if (failure !== undefined) return;
        const use = op.operands.findIndex((v) => derived.has(v.id));
        if (use >= 0 && outside !== undefined) {
          failure = fail(
            op,
            `a use of the carried list inside ${
              outside.kind === 'loop'
                ? 'the body of an inner loop'
                : outside.kind === 'build'
                  ? 'the body of a comprehension'
                  : outside.kind === 'seeded'
                    ? 'the body of a seeded region'
                    : `an operand of ${outside.kind}`
            }`
          );
          return;
        }
        if (op.kind === 'yield') {
          if (region === loop.body && use >= 0) {
            if (op.operands.some((v, k) => k !== i && derived.has(v.id)))
              failure = fail(
                op,
                'the carried list flows into another carried value'
              );
          }
          // A yield of a branch in the chain is decided at its `if`.
          continue;
        }
        if (use >= 0) {
          if (op.kind === 'replace-at' && use === 0) {
            if (op.operands[1].id !== index.id) {
              failure = fail(
                op,
                'an update of the carried list at an index other than the loop index'
              );
              return;
            }
            if (op.operands.slice(1).some((v) => derived.has(v.id))) {
              failure = fail(op, 'a read of the carried list');
              return;
            }
            first ??= op;
            derived.add(op.result.id);
          } else {
            failure = fail(
              op,
              op.kind === 'call'
                ? 'the carried list is an argument of a call'
                : op.kind === 'loop'
                  ? 'the carried list is the initial value of an inner loop'
                  : 'a read of the carried list'
            );
            return;
          }
        }
        const inChain = outside === undefined && op.kind === 'if';
        for (const inner of regionsOf(op))
          visit(inner, inChain ? undefined : (outside ?? op));
        if (failure !== undefined) return;
        if (inChain)
          op.results.forEach((result, j) => {
            const inThen = derived.has(yieldedValues(op.then)[j].id);
            const inElse = derived.has(yieldedValues(op.else)[j].id);
            if (inThen && inElse) derived.add(result.id);
            else if ((inThen || inElse) && failure === undefined)
              failure = fail(
                op,
                'a branch replaces the carried list with another list'
              );
          });
      }
    };
    visit(loop.body, undefined);
    if (failure !== undefined) return failure;
    if (!derived.has(next[i].id))
      return fail(
        bodyYield,
        'the body replaces the carried list with another list'
      );
    // The origin of a `replace-at` is `ReplaceAt(list, index, element)`.
    if (first !== undefined && isFunction(first.origin))
      updates.push({
        list: first.origin.ops[0],
        index: first.origin.ops[1],
        initialUnique: initials.get(loop)?.[i] === true,
      });
  }

  const definitions = new Map<number, IROperation>();
  const collect = (region: IRRegion) => {
    for (const op of region.operations) {
      if (op.result !== undefined) definitions.set(op.result.id, op);
      for (const inner of regionsOf(op)) collect(inner);
    }
  };
  collect(body);
  /** Whether `value` is proved to be at least 1: a literal or a numeric
   *  capture of at least 1, or a sum or a product of such values. */
  const atLeastOne = (value: IRValue, depth = 0): boolean => {
    const op = definitions.get(value.id);
    if (op === undefined || depth > 16) return false;
    if (op.kind === 'literal')
      return typeof op.value === 'number' && op.value >= 1;
    if (op.kind === 'capture') return op.snapshot >= 1;
    if (op.kind === 'add' || op.kind === 'multiply')
      return (
        op.operands.length > 0 &&
        op.operands.every((v) => atLeastOne(v, depth + 1))
      );
    return false;
  };
  const conditions: LoopCondition[] =
    atLeastOne(loop.operands[0]) && atLeastOne(loop.operands[1])
      ? []
      : ['bounds-at-least-one'];

  return {
    ...base,
    candidate: true,
    updates,
    canAbort: operationCanAbort(loop, program.functions),
    conditions,
  };
}

/** The first operation of `region`, of a region nested in it or of a
 *  function that it calls, that is not `pure` and has nothing inside that
 *  is not. */
function firstImpure(
  program: IRProgram,
  region: IRRegion,
  seeded = false
): IROperation | undefined {
  for (const op of region.operations) {
    if (op.effect === 'pure') continue;
    // A draw in a seeded region is discharged (`effectBlockers()`).
    if (seeded && onlyRandom(op)) continue;
    for (const inner of regionsOf(op)) {
      const found = firstImpure(program, inner, seeded || op.kind === 'seeded');
      if (found !== undefined) return found;
    }
    if (op.kind === 'call') {
      const callee = program.functions[op.function];
      const found =
        callee === undefined
          ? undefined
          : firstImpure(program, callee.body, seeded);
      if (found !== undefined) return found;
    }
    return op;
  }
  return undefined;
}

/** The operation of `region`, or of a region nested in it, that defines the
 *  value `id`. */
function definitionIn(region: IRRegion, id: number): IROperation | undefined {
  for (const op of region.operations) {
    if (op.kind === 'if' || op.kind === 'loop') {
      if (op.results.some((r) => r.id === id)) return op;
    } else if (op.result?.id === id) return op;
    for (const inner of regionsOf(op)) {
      const found = definitionIn(inner, id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
