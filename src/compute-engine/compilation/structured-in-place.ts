/**
 * Where an emitter may write the result of a `replace-at` into the array of
 * its operand list, in place of a copy (`structured-ir.ts`, `IRReplaceAt`).
 *
 * A list is a value: `replace-at` gives a new list and leaves its operand
 * unchanged. An update in place gives the same values only when no code
 * that runs after the update reads the old array. This file decides that on
 * the representation, from the definitions and the uses of the values; it
 * names no target.
 */
import {
  exitsOf,
  isClosedRegion,
  regionsOf,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
} from './structured-ir.js';

/** The position of an operation: the regions from the body of its function
 *  (or the root) to the region that holds it, each with the index of the
 *  operation in it that holds the next region. The index of the last entry
 *  is the index of the operation itself; it is -1 for a parameter of the
 *  region. */
type Position = readonly {
  readonly region: IRRegion;
  readonly index: number;
}[];

type Use = { readonly op: IROperation; readonly position: Position };

type Definition =
  | {
      readonly kind: 'operation';
      readonly op: IROperation;
      readonly position: Position;
    }
  | {
      readonly kind: 'parameter';
      readonly owner?: IROperation;
      readonly position: Position;
    };

/** The facts of one body (a function or the root) that the rule reads. */
type BodyFacts = {
  readonly definitions: Map<number, Definition>;
  readonly uses: Map<number, Use[]>;
  /** The operation that evaluates each region of the body. */
  readonly owners: Map<IRRegion, IROperation>;
};

function bodyFacts(body: IRRegion, parameters: readonly IRValue[]): BodyFacts {
  const facts: BodyFacts = {
    definitions: new Map(),
    uses: new Map(),
    owners: new Map(),
  };
  for (const p of parameters)
    facts.definitions.set(p.id, {
      kind: 'parameter',
      position: [{ region: body, index: -1 }],
    });
  const visit = (region: IRRegion, outer: Position) => {
    region.operations.forEach((op, index) => {
      const position = [...outer, { region, index }];
      for (const operand of op.operands) {
        const list = facts.uses.get(operand.id) ?? [];
        list.push({ op, position });
        facts.uses.set(operand.id, list);
      }
      const results =
        op.kind === 'if' || op.kind === 'loop'
          ? op.results
          : op.result
            ? [op.result]
            : [];
      for (const r of results)
        facts.definitions.set(r.id, { kind: 'operation', op, position });
      for (const inner of regionsOf(op)) {
        facts.owners.set(inner, op);
        for (const p of inner.parameters ?? [])
          facts.definitions.set(p.id, {
            kind: 'parameter',
            owner: op,
            position: [...position, { region: inner, index: -1 }],
          });
        visit(inner, position);
      }
    });
  };
  visit(body, []);
  return facts;
}

/** The `exit` operations of `loop` (`exitsOf()`), each with its position,
 *  for the loop at `position`. */
function exitPositions(
  loop: Extract<IROperation, { kind: 'loop' }>,
  position: Position
): { op: IROperation; at: Position }[] {
  const found: { op: IROperation; at: Position }[] = [];
  const exits = new Set<IROperation>(exitsOf(loop));
  const visit = (region: IRRegion, outer: Position) =>
    region.operations.forEach((op, index) => {
      const at = [...outer, { region, index }];
      if (exits.has(op)) found.push({ op, at });
      if (op.kind === 'if') for (const inner of regionsOf(op)) visit(inner, at);
    });
  visit(loop.body, position);
  return found;
}

/** Whether `other` is in the body of the loop that the `exit` at `exit`
 *  ends: the innermost region of `exit` that is the body of a loop. */
function inBodyOfExitLoop(
  exit: Position,
  other: Position,
  owners: ReadonlyMap<IRRegion, IROperation>
): boolean {
  for (let level = exit.length - 1; level >= 0; level--) {
    const region = exit[level].region;
    if (owners.get(region)?.kind === 'loop')
      return other.some((p) => p.region === region);
  }
  return false;
}

/**
 * When `use` runs relative to `consumer`, both positions in one body:
 * `before` or `after` in the order of evaluation, `exclusive` when they are
 * in the two branches of one `if` (at most one of them runs), and
 * `nested` when one of them is an operation that evaluates a region that
 * holds the other (a loop whose body holds the other one, for example):
 * such a use is treated as running after the consumer.
 */
function order(
  use: Position,
  consumer: Position,
  owners: ReadonlyMap<IRRegion, IROperation>
) {
  for (let level = 0; ; level++) {
    const a = use[level];
    const b = consumer[level];
    if (a === undefined || b === undefined) return 'nested';
    if (a.region !== b.region) {
      // Two regions of the operation of the level above.
      const op = owners.get(a.region);
      if (op?.kind === 'if') return 'exclusive';
      if (op !== undefined && (op.kind === 'and' || op.kind === 'or'))
        return op.rest.indexOf(a.region) < op.rest.indexOf(b.region)
          ? 'before'
          : 'after';
      return 'nested';
    }
    if (a.index !== b.index) return a.index < b.index ? 'before' : 'after';
    if (level === use.length - 1 || level === consumer.length - 1)
      return 'nested';
  }
}

/**
 * The `replace-at` operations of `program` that an emitter may write in
 * place: it writes the element into the array of the operand list and
 * gives that array as the result, in place of a copy. Every other
 * `replace-at` copies.
 *
 * The rule. A `replace-at` R of the list X updates in place when X is
 * consumable by R. A value X is consumable by the operation C that uses it
 * when all of these hold:
 *
 * 1. X is unique: its array is made by this invocation of the body, and at
 *    the definition of X no other value of the program holds it. These
 *    values are unique: the result of a `build` and of a `replace-at`; the
 *    result of a call of a function whose body yields a unique value; the
 *    result `i` of an `if` when the value `i` that each open branch yields
 *    is consumable by the yield of that branch (a closed branch yields
 *    nothing); the parameter of a carried value of a `loop` in the body
 *    when its initial value is consumable by the loop and its next value by
 *    the yield of the body, with the parameter taken as unique while this
 *    is checked (each iteration starts with the array that the previous one
 *    handed over); the result of the carried value when, in addition, its
 *    operand in each `exit` of the loop is consumable by that `exit`.
 *    An input, a capture, a parameter of a function, and every other value
 *    are not unique: the caller of the code, or of the function, can hold
 *    the array and read it after the call.
 * 2. C runs in the same iteration as the definition of X: no body of a
 *    `loop` or of a `build` is between the region of the definition and C.
 *    Otherwise C would run once per iteration on the one array of X.
 * 3. C uses X once, and every other use of X either is in the other branch
 *    of an `if` that holds C (it does not run when C runs), or runs before
 *    C and is an `at` or a `length`, whose result is a number and holds no
 *    array, or does not run when C runs because of an `exit` (below).
 *
 * An operand of an `exit` (`IRExit`) is a use, as an operand of the yield
 * of the loop body is: the `exit` hands the array to the result of its
 * loop. After an `exit`, the code of the body of its loop does not run
 * again in that run of the loop, so an `exit` E and a use U that the body
 * of the loop of E holds after E never both run with one value: U before
 * C, or C before U, is then not a use that runs after the other. Every
 * other order with an `exit` is a use as any other: an `exit` that runs
 * before C, where C is outside the body of the loop of E, fails the rule.
 * The only later uses of the operand of an `exit` are the uses of the
 * result of its loop, which the uniqueness of that result checks.
 *
 * Soundness. By 1, when C runs, the array of X is referenced only by X and
 * by values that a use of X made. By 3, no use of X runs after C, and the
 * uses that run before C made only numbers. So after C, no code reads the
 * array through X or through another value, and C may write it: the
 * values that the code reads are the values of the program, where C gives
 * a new list. The result of an in-place R is again unique (the array is
 * held by the result only), and so is the result of a copying R (a new
 * array). The emitter must also keep the order of evaluation: a read of X
 * that the program evaluates before R must not be moved after R
 * (`mutatesInPlace()` marks the operations that it must not move a read
 * across).
 *
 * The rule is a sufficient condition, not a necessary one: a case that it
 * cannot prove copies, and gives the same values.
 */
export function inPlaceUpdates(program: IRProgram): ReadonlySet<IROperation> {
  return analyzeInPlace(program).inPlace;
}

/**
 * For each `loop` of `program`, and for each of its carried values in the
 * order of `results`: whether the initial value is consumable by the loop,
 * by the rule of `inPlaceUpdates()` (unique, and with no other use that runs
 * after the loop or that holds the array). When it is true, the first
 * iteration may write the array of the initial value; when it is false, the
 * array can be an input, a capture, a parameter of a function or a value
 * that other code reads, and a write needs a copy first.
 */
export function consumableLoopInitials(
  program: IRProgram
): ReadonlyMap<IROperation, readonly boolean[]> {
  return analyzeInPlace(program).loopInitials;
}

function analyzeInPlace(program: IRProgram): {
  inPlace: Set<IROperation>;
  loopInitials: Map<IROperation, boolean[]>;
} {
  const inPlace = new Set<IROperation>();
  const loopInitials = new Map<IROperation, boolean[]>();
  /** Whether the body of each function yields a unique value. */
  const yieldsUnique: boolean[] = [];
  const analyze = (body: IRRegion, parameters: readonly IRValue[]): boolean => {
    const facts = bodyFacts(body, parameters);
    /** The loop parameters and results taken as unique while checked. */
    const assumed = new Set<number>();

    const unique = (value: IRValue): boolean => {
      if (assumed.has(value.id)) return true;
      const definition = facts.definitions.get(value.id);
      if (definition === undefined) return false;
      if (definition.kind === 'parameter') {
        const loop = definition.owner;
        if (loop?.kind !== 'loop') return false;
        const i = (loop.body.parameters ?? []).findIndex(
          (p) => p.id === value.id
        );
        // The parameter holds the initial value or the next value of the
        // previous pass, never the operand of an `exit`.
        return (
          i > 0 &&
          carriedUnique(loop, i - 1, definition.position.slice(0, -1), false)
        );
      }
      const op = definition.op;
      switch (op.kind) {
        case 'build':
        case 'replace-at':
          return true;
        case 'call':
          return yieldsUnique[op.function] === true;
        case 'if': {
          const i = op.results.indexOf(value);
          // A closed branch yields nothing to the result.
          return [op.then, op.else].every((region) => {
            if (isClosedRegion(region)) return true;
            const last = region.operations.length - 1;
            const yieldOp = region.operations[last];
            return consumable(yieldOp.operands[i], yieldOp, [
              ...definition.position,
              { region, index: last },
            ]);
          });
        }
        case 'loop':
          return carriedUnique(
            op,
            op.results.indexOf(value),
            definition.position,
            true
          );
        default:
          return false;
      }
    };

    /** Whether the carried value `i` of `loop`, at `position`, is unique:
     *  its parameter, or with `exits` its result, which can also be the
     *  operand of an `exit`. */
    const carriedUnique = (
      loop: Extract<IROperation, { kind: 'loop' }>,
      i: number,
      position: Position,
      exits: boolean
    ): boolean => {
      const parameter = loop.body.parameters![i + 1];
      const result = loop.results[i];
      if (assumed.has(parameter.id)) return true;
      assumed.add(parameter.id);
      assumed.add(result.id);
      try {
        const last = loop.body.operations.length - 1;
        const yieldOp = loop.body.operations[last];
        return (
          consumable(loop.operands[i + 2], loop, position) &&
          consumable(yieldOp.operands[i], yieldOp, [
            ...position,
            { region: loop.body, index: last },
          ]) &&
          // The result can also be the operand of an `exit`.
          (!exits ||
            exitPositions(loop, position).every(({ op, at }) =>
              consumable(op.operands[i], op, at)
            ))
        );
      } finally {
        assumed.delete(parameter.id);
        assumed.delete(result.id);
      }
    };

    const consumable = (
      value: IRValue,
      consumer: IROperation,
      at: Position
    ): boolean => {
      if (!unique(value)) return false;
      const definition = facts.definitions.get(value.id)!;
      // 2: no body of a loop or a build between the definition and C.
      const start = at.findIndex(
        (p) => p.region === definition.position.at(-1)!.region
      );
      if (start < 0) return false;
      for (const p of at.slice(start + 1)) {
        const owner = facts.owners.get(p.region);
        if (owner?.kind === 'loop' || owner?.kind === 'build') return false;
      }
      // 3: one use by C; every other use runs in the other branch, or
      // before C and makes a number.
      if (consumer.operands.filter((o) => o.id === value.id).length !== 1)
        return false;
      return (facts.uses.get(value.id) ?? []).every((use) => {
        if (use.op === consumer) return true;
        const when = order(use.position, at, facts.owners);
        return (
          when === 'exclusive' ||
          (when === 'before' &&
            (use.op.kind === 'at' || use.op.kind === 'length')) ||
          // An `exit` and a use that the body of its loop holds after it.
          (when === 'before' &&
            use.op.kind === 'exit' &&
            inBodyOfExitLoop(use.position, at, facts.owners)) ||
          (when === 'after' &&
            consumer.kind === 'exit' &&
            inBodyOfExitLoop(at, use.position, facts.owners))
        );
      });
    };

    const visit = (region: IRRegion, outer: Position) =>
      region.operations.forEach((op, index) => {
        const position = [...outer, { region, index }];
        if (
          op.kind === 'replace-at' &&
          consumable(op.operands[0], op, position)
        )
          inPlace.add(op);
        if (op.kind === 'loop')
          loopInitials.set(
            op,
            op.results.map((_, i) =>
              consumable(op.operands[i + 2], op, position)
            )
          );
        for (const inner of regionsOf(op)) visit(inner, position);
      });
    visit(body, []);
    const last = body.operations.length - 1;
    return unique(body.operations[last].operands[0]);
  };
  // A function calls only functions of a lower index (the lowering lowers
  // a called helper first), so the fact of each callee is known.
  program.functions.forEach((fn, i) => {
    yieldsUnique[i] = analyze(fn.body, fn.parameters);
  });
  analyze(program.root, []);
  return { inPlace, loopInitials };
}

/**
 * Whether `op` writes an array in place: it is a `replace-at` of
 * `inPlace`, or it evaluates a region that holds one. An emitter that
 * moves the evaluation of a pure value to its use must not move it across
 * such an operation: the value can be a read of the array that the
 * operation writes, which the program evaluates before the write.
 */
export function mutatesInPlace(
  op: IROperation,
  inPlace: ReadonlySet<IROperation>
): boolean {
  if (inPlace.has(op)) return true;
  return regionsOf(op).some((region) =>
    region.operations.some((inner) => mutatesInPlace(inner, inPlace))
  );
}
