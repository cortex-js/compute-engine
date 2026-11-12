/**
 * Where an emitter may write the result of a `replace-at` or of an
 * `append` into the array of its operand list, in place of a copy
 * (`structured-ir.ts`, `IRReplaceAt`, `IRAppend`).
 *
 * A list is a value: `replace-at` and `append` give a new list and leave
 * their operand unchanged. An update in place gives the same values only when no code
 * that runs after the update reads the old array. This file decides that on
 * the representation, from the definitions and the uses of the values; it
 * names no target. It also puts a copy before a loop whose carried list
 * the program does not own, where the copy lets the loop update in place
 * (`withOwnedCopies()`).
 */
import {
  elementOf,
  exitsOf,
  isClosedRegion,
  isListType,
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
 * The `replace-at` and `append` operations of `program` that an emitter
 * may write in place: it writes the element into the array of the operand
 * list (at the index, or after the last element) and gives that array as
 * the result, in place of a copy. Every other such operation copies.
 *
 * The rule. A `replace-at` or an `append` R of the list X updates in place
 * when X is consumable by R. A value X is consumable by the operation C
 * that uses it when all of these hold:
 *
 * 1. X is unique: its array is made by this invocation of the body, and at
 *    the definition of X no other value of the program holds it. These
 *    values are unique: the result of a `build`, of a `list`, of a `tuple`,
 *    of a `replace-at`, of an `append`, of a `copy` and of a function of
 *    lists with a list result (`collection`, which copies or joins its
 *    operands); the
 *    result of a call of a function whose body yields a unique value; the
 *    result `i` of an `if` when the value `i` that each open branch yields
 *    is consumable by the yield of that branch (a closed branch yields
 *    nothing); the parameter of a carried value of a `loop` in the body
 *    when its initial value is consumable by the loop and its next value by
 *    the yield of the body, with the parameter taken as unique while this
 *    is checked (each iteration starts with the array that the previous one
 *    handed over); the result of the carried value when, in addition, its
 *    operand in each `exit` of the loop is consumable by that `exit`.
 *    An input, a capture, a constant (`IRConstantRead`, an array that every
 *    call shares), a parameter of a function, and every other value are not
 *    unique: the caller of the code, or of the function, or the next call,
 *    can hold the array and read it after the call.
 * 2. C runs in the same iteration as the definition of X: between the
 *    region of the definition and C there is no region but a branch of an
 *    `if`, an operand of an `and` or an `or` and the body of a `seeded`,
 *    which run at most once where they are. The body of a `loop`, of a
 *    `build` or of a `routine` (which runs its body at each point that it
 *    samples), or of an operation that a later change adds, would run C
 *    once per iteration on the one array of X.
 * 3. C uses X once, and every other use of X either is in the other branch
 *    of an `if` that holds C (it does not run when C runs), or runs before
 *    C and is an `at`, a `get` or a `length`, whose result is a number or a
 *    row of X (not the array of X), or a function of lists or a `copy`,
 *    whose result is a number or a new array, or does not run when C runs
 *    because of an `exit` (below).
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
 * The rows of a list of lists. A row is an array too, and the rule above
 * never writes one: an `at` is not unique. The lowering of
 * `ReplaceAt(S, i, j, x)` is `R1 = replace-at(S, i, R2)` with
 * `R2 = replace-at(r, j, x)` and `r = at(S, i)`. R2 also updates in place
 * (it writes the row r, and R1 writes r back into its slot) when:
 *
 * 4. The `at`, R2 and R1 are in one region, in this order; R1 reads S, the
 *    index value of the `at` and the result of R2, which has no other use;
 *    R2 reads r once.
 * 5. S is consumable by R1 (1 to 3), and S owns its rows: no other value
 *    and no other slot of S holds a row of S (below).
 * 6. Every other use of S that can run with R2 runs before R2 and is a
 *    `length`, a `copy` of two levels, a function of lists with a number
 *    result, or an `at`; every use of the row of such an `at` but R2 runs
 *    before R2 and is an `at`, a `get`, a `length`, a function of lists or
 *    a `copy`, which make a number or a new array.
 *
 * A value owns its rows when it is a list of lists and is: the result of a
 * `copy` of two levels; of a `build` whose element is consumable by the
 * yield of its body; of a `list` whose every operand is consumable by it;
 * of a `replace-at` R of a list X that owns its rows and that R consumes
 * with rule 6 at R (the row of the pair of rule 4 is allowed), and of an
 * element (a row) that R consumes; of a call of a function whose body
 * yields such a value; of an `if`, of a conversion that keeps the
 * representation and of a carried value of a `loop`, by the rule of 1 with
 * "owns its rows and is consumable" in place of "consumable".
 *
 * Soundness of 4 to 6. By 5, the row r is held by the slot i of S only, and
 * S by the values that a use of S made. By 6, the uses of S and of its rows
 * that run with R2 have run before it and made numbers or new arrays, so no
 * code reads r after R2 but R1, which puts the array of R2 (r itself) into
 * the slot i of S, in place: no position of the program reads the old
 * value of r. R1 is in place, so its result holds the rows of S, each in
 * one slot, and owns its rows again. An index out of range throws in R2
 * or before it: `at` gives the absent row, and the update of an absent row
 * throws as its copy does.
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

/**
 * Whether the value of the root of `program` is unique by the rule of
 * `inPlaceUpdates()`: its array is made by the call, and no input, no
 * constant (`IRConstantRead`) and no other value of the program holds it. A
 * target that gives a list value to the host gives a copy of a value that is
 * not unique and can be the array of a constant, which every call shares.
 */
export function rootYieldsUnique(program: IRProgram): boolean {
  return analyzeInPlace(program).root;
}

/** For a `loop`, the levels of the copy that `withOwnedCopies()` would put
 *  before it, by the index of the carried value: the initial value is then
 *  taken as consumable by the loop, and with 2 as owning its rows. */
type OwnedInitials = ReadonlyMap<IROperation, ReadonlyMap<number, 1 | 2>>;

/** The number of answers that the analyses of `inPlaceUpdates()` computed
 *  (not read from their memo), for the tests of its cost. */
export const IN_PLACE_WORK = { evaluations: 0 };

type Analysis = {
  inPlace: Set<IROperation>;
  loopInitials: Map<IROperation, boolean[]>;
  root: boolean;
};

/** Whether `value` is a list of lists. */
function isNested(value: IRValue): boolean {
  const element = elementOf(value.type);
  return element !== undefined && isListType(element);
}

/** The kinds of the uses of a list, before an update in place, whose
 *  result is a number, a row or a new array, never the array of the list
 *  (rule 3 of `inPlaceUpdates()`). */
const READS: ReadonlySet<IROperation['kind']> = new Set<IROperation['kind']>([
  'at',
  'get',
  'length',
  'collection',
  'copy',
]);

function analyzeInPlace(
  program: IRProgram,
  owned: OwnedInitials = new Map()
): Analysis {
  const inPlace = new Set<IROperation>();
  const loopInitials = new Map<IROperation, boolean[]>();
  /** Whether the body of each function yields a unique value, and one that
   *  owns its rows. */
  const yieldsUnique: boolean[] = [];
  const yieldsOwnedRows: boolean[] = [];
  const analyze = (
    body: IRRegion,
    parameters: readonly IRValue[]
  ): { unique: boolean; rows: boolean } => {
    const facts = bodyFacts(body, parameters);
    /** The loop parameters and results taken as unique while checked. */
    const assumed = new Set<number>();
    /** The loop parameters and results taken as owning their rows while
     *  checked. */
    const assumedRows = new Set<number>();
    const ownedLevels = (loop: IROperation, i: number): number =>
      owned.get(loop)?.get(i) ?? 0;
    /** The answers of `unique()`, `ownsRows()`, `consumable()` and
     *  `consumableRows()`, by the values taken as unique and as owning their
     *  rows when they were computed: an answer is a function of the value
     *  (and of the consumer) and of those assumptions. Without it, a chain of
     *  `if` operations that each update a row or keep the list asks for the
     *  same answers once per path, twice as often per level. */
    const memo = new Map<string, Map<string, boolean>>();
    const remembered = (key: string, compute: () => boolean): boolean => {
      const state = `${[...assumed].join(',')}/${[...assumedRows].join(',')}`;
      let answers = memo.get(state);
      if (answers === undefined) memo.set(state, (answers = new Map()));
      const known = answers.get(key);
      if (known !== undefined) return known;
      IN_PLACE_WORK.evaluations += 1;
      const answer = compute();
      // The assumptions are the same after `compute()`: each check removes
      // the ones that it adds.
      answers.set(key, answer);
      return answer;
    };
    const consumerIds = new Map<IROperation, number>();
    const consumerKey = (consumer: IROperation): number => {
      let id = consumerIds.get(consumer);
      if (id === undefined) consumerIds.set(consumer, (id = consumerIds.size));
      return id;
    };

    const unique = (value: IRValue): boolean =>
      assumed.has(value.id) ||
      remembered(`u${value.id}`, () => computeUnique(value));
    const computeUnique = (value: IRValue): boolean => {
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
        case 'list':
        case 'tuple':
        case 'replace-at':
        case 'append':
        case 'copy':
          return true;
        // Each function of lists with a list result makes a new array: a
        // copy (`take`, `drop`, `reverse`, `sort`) or the elements of its
        // operands (`join`); none gives the array of an operand.
        case 'collection':
          return isListType(op.result.type);
        case 'call':
          return yieldsUnique[op.function] === true;
        // A conversion of a list that keeps its representation (a list of
        // integers written to a local of a list of reals) is the array of
        // its operand.
        case 'convert':
          return (
            op.result.representation === op.operands[0].representation &&
            consumable(op.operands[0], op, definition.position)
          );
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
          (ownedLevels(loop, i) >= 1 ||
            consumable(loop.operands[i + 2], loop, position)) &&
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

    /** 2: `at` is in the same iteration as `definition`: between their
     *  regions, no region of an operation that can evaluate it more than
     *  once where it is. */
    const sameIteration = (definition: Position, at: Position): boolean => {
      const start = at.findIndex(
        (p) => p.region === definition.at(-1)!.region
      );
      if (start < 0) return false;
      return at.slice(start + 1).every((p) => {
        const owner = facts.owners.get(p.region)?.kind;
        return (
          owner === 'if' ||
          owner === 'and' ||
          owner === 'or' ||
          owner === 'seeded'
        );
      });
    };

    /** When `use` runs relative to the consumer `consumer` at `at`: `apart`
     *  when the two never both run with one value (exclusive branches, or
     *  an `exit` and a use that the body of its loop holds after it), else
     *  `before` or `after` (`order()`, `nested` is `after`). */
    const relation = (
      use: Use,
      at: Position,
      consumer: IROperation
    ): 'apart' | 'before' | 'after' => {
      const when = order(use.position, at, facts.owners);
      if (when === 'exclusive') return 'apart';
      if (
        when === 'before' &&
        use.op.kind === 'exit' &&
        inBodyOfExitLoop(use.position, at, facts.owners)
      )
        return 'apart';
      if (
        when === 'after' &&
        consumer.kind === 'exit' &&
        inBodyOfExitLoop(at, use.position, facts.owners)
      )
        return 'apart';
      return when === 'before' ? 'before' : 'after';
    };

    /** `at` is the position of `consumer`, so the answer is keyed by the
     *  consumer. */
    const consumable = (
      value: IRValue,
      consumer: IROperation,
      at: Position
    ): boolean =>
      remembered(`c${value.id}:${consumerKey(consumer)}`, () =>
        computeConsumable(value, consumer, at)
      );
    const computeConsumable = (
      value: IRValue,
      consumer: IROperation,
      at: Position
    ): boolean => {
      if (!unique(value)) return false;
      const definition = facts.definitions.get(value.id)!;
      if (!sameIteration(definition.position, at)) return false;
      // 3: one use by C; every other use runs in the other branch, or
      // before C and makes a number or a new array.
      if (consumer.operands.filter((o) => o.id === value.id).length !== 1)
        return false;
      return (facts.uses.get(value.id) ?? []).every((use) => {
        if (use.op === consumer) return true;
        const when = relation(use, at, consumer);
        return when === 'apart' || (when === 'before' && READS.has(use.op.kind));
      });
    };

    /** Whether the list of lists `value` owns its rows (rules 4 to 6 of
     *  `inPlaceUpdates()`). */
    const ownsRows = (value: IRValue): boolean =>
      isNested(value) &&
      (assumedRows.has(value.id) ||
        remembered(`r${value.id}`, () => computeOwnsRows(value)));
    const computeOwnsRows = (value: IRValue): boolean => {
      const definition = facts.definitions.get(value.id);
      if (definition === undefined) return false;
      if (definition.kind === 'parameter') {
        const loop = definition.owner;
        if (loop?.kind !== 'loop') return false;
        const i = (loop.body.parameters ?? []).findIndex(
          (p) => p.id === value.id
        );
        return (
          i > 0 &&
          carriedRows(loop, i - 1, definition.position.slice(0, -1), false)
        );
      }
      const op = definition.op;
      const position = definition.position;
      switch (op.kind) {
        case 'copy':
          return op.levels === 2;
        case 'build': {
          const last = op.body.operations.length - 1;
          const yieldOp = op.body.operations[last];
          return consumable(yieldOp.operands[0], yieldOp, [
            ...position,
            { region: op.body, index: last },
          ]);
        }
        case 'list':
          return op.operands.every((o) => consumable(o, op, position));
        case 'replace-at':
          return (
            consumableRows(op.operands[0], op, position) &&
            consumable(op.operands[2], op, position)
          );
        case 'call':
          return yieldsOwnedRows[op.function] === true;
        case 'convert':
          return (
            op.result.representation === op.operands[0].representation &&
            consumableRows(op.operands[0], op, position)
          );
        case 'if': {
          const i = op.results.indexOf(value);
          return [op.then, op.else].every((region) => {
            if (isClosedRegion(region)) return true;
            const last = region.operations.length - 1;
            const yieldOp = region.operations[last];
            return consumableRows(yieldOp.operands[i], yieldOp, [
              ...position,
              { region, index: last },
            ]);
          });
        }
        case 'loop':
          return carriedRows(op, op.results.indexOf(value), position, true);
        default:
          return false;
      }
    };

    /** `carriedUnique()` for the rule of the rows. */
    const carriedRows = (
      loop: Extract<IROperation, { kind: 'loop' }>,
      i: number,
      position: Position,
      exits: boolean
    ): boolean => {
      const parameter = loop.body.parameters![i + 1];
      const result = loop.results[i];
      if (assumedRows.has(parameter.id)) return true;
      assumedRows.add(parameter.id);
      assumedRows.add(result.id);
      try {
        const last = loop.body.operations.length - 1;
        const yieldOp = loop.body.operations[last];
        return (
          (ownedLevels(loop, i) === 2 ||
            consumableRows(loop.operands[i + 2], loop, position)) &&
          consumableRows(yieldOp.operands[i], yieldOp, [
            ...position,
            { region: loop.body, index: last },
          ]) &&
          (!exits ||
            exitPositions(loop, position).every(({ op, at }) =>
              consumableRows(op.operands[i], op, at)
            ))
        );
      } finally {
        assumedRows.delete(parameter.id);
        assumedRows.delete(result.id);
      }
    };

    /** Whether the list of lists `value` owns its rows, is consumable by
     *  `consumer` at `at`, and keeps its rows to `consumer` (rule 6, with
     *  `consumer` in the place of R2). */
    const consumableRows = (
      value: IRValue,
      consumer: IROperation,
      at: Position
    ): boolean =>
      remembered(
        `k${value.id}:${consumerKey(consumer)}`,
        () =>
          consumable(value, consumer, at) &&
          ownsRows(value) &&
          rowsKept(value, consumer, at, at)
      );

    /** Rule 6: every use of the list of lists `value` but `consumer` (at
     *  `at`) that can run with `consumer` runs before `barrier` and makes a
     *  number or a new array that holds no row of `value`; for an `at`, so
     *  does every use of its row, but the update R2 of the pair of rule 4
     *  when `consumer` is its R1. */
    const rowsKept = (
      value: IRValue,
      consumer: IROperation,
      at: Position,
      barrier: Position
    ): boolean =>
      (facts.uses.get(value.id) ?? []).every((use) => {
        if (use.op === consumer) return true;
        const when = relation(use, barrier, consumer);
        if (when === 'apart') return true;
        if (when === 'after') return false;
        const op = use.op;
        switch (op.kind) {
          case 'length':
            return true;
          case 'copy':
            return op.levels === 2;
          case 'collection':
            return !isListType(op.result.type);
          case 'at': {
            const row = op.result;
            if (!isListType(row.type)) return true;
            return (facts.uses.get(row.id) ?? []).every((rowUse) => {
              const update = rowUse.op;
              if (
                consumer.kind === 'replace-at' &&
                update.kind === 'replace-at' &&
                consumer.operands[0].id === value.id &&
                consumer.operands[1].id === op.operands[1].id &&
                consumer.operands[2].id === update.result.id &&
                update.operands[0].id === row.id &&
                update.operands.filter((o) => o.id === row.id).length === 1
              )
                return true;
              const rowWhen = relation(rowUse, barrier, consumer);
              return (
                rowWhen === 'apart' ||
                (rowWhen === 'before' && READS.has(update.kind))
              );
            });
          }
          default:
            return false;
        }
      });

    /** Rules 4 to 6: whether the `replace-at` `op` at `position`, of a row
     *  that an `at` reads, writes the row in place. */
    const rowInPlace = (
      op: Extract<IROperation, { kind: 'replace-at' }>,
      position: Position
    ): boolean => {
      const row = op.operands[0];
      const read = facts.definitions.get(row.id);
      if (read?.kind !== 'operation' || read.op.kind !== 'at') return false;
      const [list, index] = read.op.operands;
      const uses = facts.uses.get(op.result.id) ?? [];
      if (uses.length !== 1) return false;
      const { op: outer, position: at } = uses[0];
      if (
        outer.kind !== 'replace-at' ||
        outer.operands[0].id !== list.id ||
        outer.operands[1].id !== index.id ||
        outer.operands[2].id !== op.result.id ||
        op.operands.filter((o) => o.id === row.id).length !== 1
      )
        return false;
      // 4: the `at`, R2 and R1 in one region, in this order.
      const here = position.at(-1)!;
      const readAt = read.position.at(-1)!;
      const outerAt = at.at(-1)!;
      if (
        read.position.length !== position.length ||
        at.length !== position.length ||
        readAt.region !== here.region ||
        outerAt.region !== here.region ||
        !(readAt.index < here.index && here.index < outerAt.index)
      )
        return false;
      // 5 and 6.
      return (
        consumableRows(list, outer, at) && rowsKept(list, outer, at, position)
      );
    };

    const visit = (region: IRRegion, outer: Position) =>
      region.operations.forEach((op, index) => {
        const position = [...outer, { region, index }];
        if (
          (op.kind === 'replace-at' || op.kind === 'append') &&
          (consumable(op.operands[0], op, position) ||
            (op.kind === 'replace-at' && rowInPlace(op, position)))
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
    const value = body.operations[last].operands[0];
    return { unique: unique(value), rows: ownsRows(value) };
  };
  // A function calls only functions of a lower index (the lowering lowers
  // a called helper first), so the fact of each callee is known.
  program.functions.forEach((fn, i) => {
    const facts = analyze(fn.body, fn.parameters);
    yieldsUnique[i] = facts.unique;
    yieldsOwnedRows[i] = facts.rows;
  });
  const root = analyze(program.root, []).unique;
  return { inPlace, loopInitials, root };
}

/** The most loops that `withOwnedCopies()` tries: each try analyzes the
 *  program again. */
const OWNED_COPY_TRIES = 32;

/**
 * `program`, with a `copy` (`IRCopy`) of the initial value of a carried
 * list of a `loop` before the loop, where the copy lets an update in the
 * body of the loop write in place (`inPlaceUpdates()`) that copies without
 * it. A list that the program does not own (an input, a constant, a
 * parameter of a function, a row read, a value that other code reads after
 * the loop) is then copied once, before the first pass, where each pass
 * copied it. The values are the same: the copy is a new array, which
 * becomes the initial value, and the rule of `inPlaceUpdates()` proves the
 * writes; the first pass reads the elements that the initial value has.
 *
 * The copy has one level, or two for a list of lists when the body writes
 * an element of a row (rules 4 to 6 of `inPlaceUpdates()`) and one level
 * would not let it write in place. A copy is put only where it lets an
 * update of the body of that loop (or of a loop in it) write in place:
 * never for a loop that only reads the list. The loops are tried in the
 * order of the program, an outer loop before the loops of its body, so an
 * inner loop of a copied list needs no copy of its own. A copy is put in
 * the region of its loop. A loop in a region that runs more than once (the
 * body of another loop, of a build or of a routine) gets a copy of one
 * level only, which
 * copies no more than one copying update of a pass would: a copy of every
 * row on each outer pass can cost more than the row copies it saves. After
 * the trials, a copy is dropped when the program without it writes in
 * place every update that it writes with it. Each trial analyzes the whole
 * program, with the answers of the analysis remembered per value
 * (`IN_PLACE_WORK`); at most `OWNED_COPY_TRIES` loops are tried.
 *
 * The result keeps the owner, the revision and every value and operation
 * of `program`: it is the last step of the lowering, which calls it before
 * the program is verified. It adds the copies and their results, and
 * replaces each loop that reads a copy, and each region and operation that
 * holds such a loop, with a new object.
 */
export function withOwnedCopies(program: IRProgram): IRProgram {
  // The loops whose body updates a list, with each carried list, and
  // whether the loop is in a region that runs more than once (the body of
  // a loop or of a build).
  const candidates: {
    loop: IROperation;
    i: number;
    nested: boolean;
    repeated: boolean;
  }[] = [];
  const updates = (region: IRRegion): boolean =>
    region.operations.some(
      (op) =>
        op.kind === 'replace-at' ||
        op.kind === 'append' ||
        regionsOf(op).some(updates)
    );
  const collect = (region: IRRegion, repeated: boolean) => {
    for (const op of region.operations) {
      if (op.kind === 'loop' && updates(op.body))
        op.results.forEach((result, i) => {
          if (isListType(result.type))
            candidates.push({ loop: op, i, nested: isNested(result), repeated });
        });
      const once =
        op.kind === 'if' ||
        op.kind === 'and' ||
        op.kind === 'or' ||
        op.kind === 'seeded';
      for (const inner of regionsOf(op)) collect(inner, repeated || !once);
    }
  };
  for (const fn of program.functions) collect(fn.body, false);
  collect(program.root, false);
  if (candidates.length === 0) return program;

  const owned = new Map<IROperation, Map<number, 1 | 2>>();
  const withLevels = (
    from: ReadonlyMap<IROperation, ReadonlyMap<number, 1 | 2>>,
    loop: IROperation,
    i: number,
    levels: 1 | 2 | undefined
  ) => {
    const result = new Map<IROperation, Map<number, 1 | 2>>(
      [...from].map(([l, m]) => [l, new Map(m)])
    );
    const forLoop = result.get(loop) ?? new Map<number, 1 | 2>();
    if (levels === undefined) forLoop.delete(i);
    else forLoop.set(i, levels);
    if (forLoop.size === 0) result.delete(loop);
    else result.set(loop, forLoop);
    return result;
  };
  let current = analyzeInPlace(program);
  for (const { loop, i, nested, repeated } of candidates.slice(
    0,
    OWNED_COPY_TRIES
  )) {
    // An initial value that the loop consumes needs a copy only for its
    // rows; in a region that runs more than once, a copy has one level:
    // a copy of every row on each pass of the outer region can cost more
    // than the updates of the rows that it saves.
    const consumed = current.loopInitials.get(loop)?.[i] === true;
    if (consumed && (!nested || repeated)) continue;
    const inside = new Set<IROperation>();
    const gather = (region: IRRegion) => {
      for (const op of region.operations) {
        inside.add(op);
        for (const inner of regionsOf(op)) gather(inner);
      }
    };
    gather((loop as Extract<IROperation, { kind: 'loop' }>).body);
    /** The analysis with a copy of `levels` levels before `loop`, and the
     *  updates of its body that it writes in place and `current` copies. */
    const trial = (levels: 1 | 2) => {
      const assumed = withLevels(owned, loop, i, levels);
      const analysis = analyzeInPlace(program, assumed);
      const gained = [...analysis.inPlace].filter(
        (op) => inside.has(op) && !current.inPlace.has(op)
      );
      return { assumed, analysis, gained };
    };
    const one = consumed ? undefined : trial(1);
    const two = nested && !repeated ? trial(2) : undefined;
    const chosen =
      two !== undefined &&
      two.gained.some((op) => one === undefined || !one.analysis.inPlace.has(op))
        ? two
        : one !== undefined && one.gained.length > 0
          ? one
          : undefined;
    if (chosen === undefined) continue;
    owned.clear();
    for (const [l, levels] of chosen.assumed) owned.set(l, levels);
    current = chosen.analysis;
  }
  // A copy that a later copy made useless (an inner loop that starts from
  // its own copy) is dropped: the analysis without it writes in place every
  // update that the analysis with it writes.
  for (const [loop, levels] of [...owned].map(
    ([l, m]) => [l, [...m.keys()]] as const
  ))
    for (const i of levels) {
      const without = withLevels(owned, loop, i, undefined);
      const analysis = analyzeInPlace(program, without);
      if ([...current.inPlace].every((op) => analysis.inPlace.has(op))) {
        owned.clear();
        for (const [l, m] of without) owned.set(l, m);
        current = analysis;
      }
    }
  if (owned.size === 0) return program;

  let nextId = 0;
  const count = (v: IRValue) => {
    if (v.id >= nextId) nextId = v.id + 1;
  };
  const countRegion = (region: IRRegion) => {
    (region.parameters ?? []).forEach(count);
    for (const op of region.operations) {
      if (op.kind === 'if' || op.kind === 'loop') op.results.forEach(count);
      else if (op.result !== undefined) count(op.result);
      regionsOf(op).forEach(countRegion);
    }
  };
  for (const fn of program.functions) {
    fn.parameters.forEach(count);
    countRegion(fn.body);
  }
  countRegion(program.root);

  const rewrite = (region: IRRegion): IRRegion => {
    let changed = false;
    const operations: IROperation[] = [];
    for (const op of region.operations) {
      let next = withRegions(op, rewrite);
      const levels = owned.get(op);
      if (levels !== undefined && next.kind === 'loop') {
        const operands = [...next.operands];
        for (const [i, l] of levels) {
          const initial = operands[i + 2];
          const result: IRValue = {
            owner: program.owner,
            revision: program.revision,
            id: nextId++,
            type: initial.type,
            representation: initial.representation,
          };
          operations.push({
            kind: 'copy',
            levels: l,
            result,
            operands: [initial],
            effect: 'pure',
            origin: op.origin,
          });
          operands[i + 2] = result;
        }
        next = { ...next, operands };
      }
      if (next !== op) changed = true;
      operations.push(next);
    }
    return changed ? { ...region, operations } : region;
  };
  return {
    ...program,
    functions: program.functions.map((fn) => {
      const body = rewrite(fn.body);
      return body === fn.body ? fn : { ...fn, body };
    }),
    root: rewrite(program.root),
  };
}

/** `op` with each of its regions replaced by `f(region)`, or `op` itself
 *  when `f` changes none. */
function withRegions(
  op: IROperation,
  f: (region: IRRegion) => IRRegion
): IROperation {
  switch (op.kind) {
    case 'if': {
      const then = f(op.then);
      const otherwise = f(op.else);
      return then === op.then && otherwise === op.else
        ? op
        : { ...op, then, else: otherwise };
    }
    case 'loop':
    case 'build':
    case 'seeded':
    case 'routine': {
      const body = f(op.body);
      return body === op.body ? op : { ...op, body };
    }
    case 'and':
    case 'or': {
      const rest = op.rest.map(f);
      return rest.every((r, k) => r === op.rest[k]) ? op : { ...op, rest };
    }
    default:
      return op;
  }
}

/**
 * Whether `op` writes an array in place: it is a `replace-at` or an
 * `append` of `inPlace`, or it evaluates a region that holds one. An emitter that
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
