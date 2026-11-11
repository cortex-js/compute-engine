/**
 * The lowering of a program of the compile mode `bigint` of the JavaScript
 * target to the structured representation (`structured-ir.ts`), on the
 * policy `JS-bigint` (`JAVASCRIPT_BIGINT_POLICY`): every integer is an exact
 * integer, held as a JavaScript `bigint`, and every boolean a boolean. The
 * design is `docs/plans/2026-11-11-structured-bigint-mode.md`.
 *
 * The admission is the lane analysis of the existing compiler
 * (`requireBigintLane()` in `compile-bigint-lane.ts`), which the
 * preparation of the JavaScript target runs in the mode: the lowering reads
 * its record of each node (the kind of the value, the kind of the lowering,
 * the shape under an integer-forcing parent, the constant of a comparison)
 * and follows the bigint emitter of the existing compiler
 * (`compile-bigint-emit.ts`) head by head, so the two give the same
 * integers. A node that the structured route does not lower (a `Map`, a
 * `Reduce` or a `Fold`, whose function operand the profile does not hold in
 * the mode; a recursive user function; a user function whose body reads an
 * input of the program, or whose parameters are not distinct names, one per
 * argument; a nested list) throws a `StructuredBigintRefusal`, which the
 * profile declines.
 *
 * - An integer input is read once, at the entry, and a `number` that the
 *   host gives is converted there (`IRInput.lifted`). A `list<integer>`
 *   input is read as the host gives it, an array of `bigint` values, as the
 *   existing emitter reads it: the entry check converts a `number` cell.
 *   The parameters of a `Function` literal at the root are the inputs.
 * - `Sum` and `Product` are one `loop` per index, the first index
 *   outermost, from the lower to the upper bound by 1 and no pass when the
 *   upper bound is less than the lower one (`ascending`), with one carried
 *   value, the accumulator: no iteration budget, no unrolling, and no
 *   bound check, as the existing emitter writes a `for` statement with a
 *   `bigint` counter. The upper bound is evaluated before the lower one, as
 *   that emitter evaluates them.
 * - A call of a user function is a call of one function of the program
 *   per literal that the lane analysis analyzed (a function specialized to
 *   the types of the arguments is its own literal), as the existing emitter
 *   writes one local arrow function per literal. A recursive function is
 *   refused.
 * - A list of integers is an array of `bigint` values (`bigint-array`):
 *   `List`, `Range`, `At`, `First`, `Last`, `Length`, `Count`, `Take`,
 *   `Drop` and `ReplaceAt` are the operations of the policy, each the
 *   helper that the existing emitter calls.
 * - A constant subtree is a literal of the exact value of `evaluate()`, as
 *   the lane analysis folds it, also with `constantFold: false`; a constant
 *   whose value is a pole is an `IRNoValue`, which aborts where it is
 *   evaluated.
 * - `n < p/q` with a rational constant is `q·n < p`; `Floor(a/b)` and the
 *   other integer-forcing parents of a quotient, a power and a square root
 *   are one `quotient`, `rounded-pow` or `isqrt` with the rounding of the
 *   parent; an integer promise (`Typed`, a parameter of a library head
 *   declared an integer) is the rounding `exact`.
 * - A function node reached again (a DAG) is the value of its first
 *   lowering when that lowering is in the current region or in a region
 *   around it, also when it can abort: an abort of the mode comes from the
 *   operands of the operation, so a reuse that its first lowering
 *   dominates aborts exactly when the first did (choice C3 of the design).
 *   A node under an integer-forcing parent is shared only under the same
 *   parent: `Floor(n/2) + Ceil(n/2)` lowers two quotients. A region that
 *   binds names (the body of a loop or of a function) shares no value of a
 *   region around it: the same node object can read another binding of a
 *   name there.
 *
 * Every operation is `pure`; an abort is not an effect.
 */
import type { Expression, FunctionInterface } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { parseType } from '../../common/type/parse.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralBoundNames } from '../boxed-expression/function-literal.js';
import {
  exactRational,
  type BigintForcingParent,
  type BigintLaneAnalysis,
  type BigintLaneRecord,
} from './compile-bigint-lane.js';
import { nodeText } from './fragment.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { isUserDefinedFunction } from './compile-statements.js';
import { JAVASCRIPT_BIGINT_POLICY } from './javascript-structured-policy.js';
import {
  STRUCTURED_OPERATION_LIMIT,
  StructuredLimitError,
} from './javascript-structured-lower.js';
import {
  listType,
  operationCanAbort,
  regionsOf,
  type CollectionFunctionName,
  type IRFunction,
  type IRInput,
  type IntegerFunctionName,
  type IntegerRounding,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ListType,
} from './structured-ir.js';

/** A node that the structured route does not lower in the mode `bigint`:
 *  the profile declines it with `reason`. */
export class StructuredBigintRefusal extends Error {
  constructor(
    readonly node: Expression,
    readonly reason: string
  ) {
    super(`JS structured bigint lowering: ${reason}`);
    this.name = 'StructuredBigintRefusal';
  }
}

/** The program of `root`, whose lane analysis is `analysis`, the nodes
 *  that an operation can come from (the nodes of the analysis), and the
 *  names whose definitions the code holds (`CompileTarget.symbolDeps`): each
 *  user function that the program calls, and each symbol with a value, or
 *  user function, that a constant subtree folded from `evaluate()` reads.
 *  Throws a
 *  `StructuredBigintRefusal` for a node that the route does not lower, and
 *  a `StructuredLimitError` past `STRUCTURED_OPERATION_LIMIT` values. */
export function lowerBigintProgram(
  root: Expression,
  analysis: BigintLaneAnalysis
): {
  program: IRProgram;
  preparedNodes: ReadonlySet<Expression>;
  dependencies: ReadonlySet<string>;
} {
  if (analysis.root !== root)
    throw new Error(
      'JS structured bigint lowering: the analysis is not the analysis of the root'
    );
  const lowering = new BigintLowering(analysis);
  return {
    program: lowering.program(root),
    preparedNodes: new Set(analysis.records.keys()),
    dependencies: lowering.dependencies,
  };
}

/** The type of a list of integers in the mode: a flat list. */
const INTEGER_LIST: ListType = listType('integer');
const LIST_OF_INTEGERS: Type = parseType('list<integer>');

/** The rounding of each integer-forcing parent (`BigintForcingParent`). */
const ROUNDING: Readonly<Record<BigintForcingParent, IntegerRounding>> = {
  Floor: 'floor',
  Ceil: 'ceil',
  Round: 'round-ties-away',
  Truncate: 'truncate',
  promise: 'exact',
};

/** The heads of the lane that are integer functions of their operands
 *  (`IntegerFunctionName`), each operand at a parameter declared an
 *  integer under an integer promise, as the existing emitter writes them
 *  (`helperCall()` in `compile-bigint-emit.ts`). */
const INTEGER_HEADS: Readonly<Record<string, IntegerFunctionName>> = {
  GCD: 'gcd',
  LCM: 'lcm',
  Factorial: 'factorial',
  Binomial: 'binomial',
  Fibonacci: 'fibonacci',
};

/** The heads of the lane whose function operand (a callback literal or a
 *  user function) the profile does not hold in the mode. */
const CALLBACK_HEADS: ReadonlySet<string> = new Set(['Map', 'Reduce', 'Fold']);

/** The key of the value of a node in a region: its value, or its value
 *  under an integer-forcing parent. */
type ValueKey = BigintForcingParent | 'value';

/** The types of the values of the mode. */
type BigintType = 'integer' | 'boolean' | ListType;

/** The fields of an operation of one result that `BigintLowering.push()`
 *  does not fill. */
type OperationFields = IROperation extends infer O
  ? O extends IROperation
    ? O extends { readonly kind: 'if' | 'loop' | 'yield' | 'exit' }
      ? never
      : Omit<O, 'result' | 'effect' | 'aborts' | 'origin'>
    : never
  : never;

class BigintLowering {
  private readonly owner = {};
  private readonly revision = 1;
  private nextId = 0;
  private readonly inputs: IRInput[] = [];
  private readonly inputIndex = new Map<string, number>();
  /** The regions open at this point, the innermost last, each with the
   *  values of the function nodes lowered in it, by node and key. A region
   *  that binds names (`barrier`) ends the search of `shared()`. */
  private readonly regions: {
    readonly operations: IROperation[];
    readonly values: Map<Expression, Map<ValueKey, IRValue>>;
    readonly barrier?: true;
  }[] = [];
  /** The values of the names that the enclosing constructs bind (a loop
   *  index, a parameter of a user function), the innermost last. */
  private scopes: ReadonlyMap<string, IRValue>[] = [];
  /** The functions of the program, each after the functions that it calls. */
  private readonly functions: IRFunction[] = [];
  /** The index of the function of each literal that a call lowered. */
  private readonly functionIndex = new Map<Expression, number>();
  /** The literals whose function is being lowered: a call of one of them is
   *  a recursive call. */
  private readonly inProgress = new Set<Expression>();
  /** The names whose definitions the code holds: each user function that
   *  the program calls, and each name that a folded constant reads
   *  (`recordFolded()`). */
  readonly dependencies = new Set<string>();

  constructor(private readonly analysis: BigintLaneAnalysis) {}

  program(root: Expression): IRProgram {
    // The body of a `Function` literal at the root: its parameters are the
    // inputs (`analyzeRoot()` of the lane analysis), and the closure that
    // the host receives has the wrapper of the entry.
    const body = isFunction(root, 'Function') ? root.ops[0] : root;
    const operations: IROperation[] = [];
    const value = this.inRegion(operations, () => this.value(body));
    const region = this.region(operations, root, value);
    const noValue = [region, ...this.functions.map((fn) => fn.body)].some(
      function holds(r: IRRegion): boolean {
        return r.operations.some(
          (op) => op.aborts?.includes('no-value') || regionsOf(op).some(holds)
        );
      }
    );
    return {
      owner: this.owner,
      revision: this.revision,
      inputs: this.inputs,
      numericPolicy: 'bigint',
      ...(noValue
        ? { noValueResult: JAVASCRIPT_BIGINT_POLICY.noValueResult }
        : {}),
      captures: [],
      functions: this.functions,
      root: region,
    };
  }

  private refuse(node: Expression, reason: string): never {
    throw new StructuredBigintRefusal(node, reason);
  }

  private record(node: Expression): BigintLaneRecord {
    const record = this.analysis.records.get(node);
    if (record === undefined)
      throw new Error(
        `JS structured bigint lowering: no lane record for ${nodeText(node)}`
      );
    return record;
  }

  private newValue(type: BigintType): IRValue {
    if (this.nextId >= STRUCTURED_OPERATION_LIMIT)
      throw new StructuredLimitError();
    return {
      owner: this.owner,
      revision: this.revision,
      id: this.nextId++,
      type,
      representation: JAVASCRIPT_BIGINT_POLICY.representationOf(type)!,
    };
  }

  /** The innermost open region. */
  private get operations(): IROperation[] {
    return this.regions[this.regions.length - 1].operations;
  }

  /** Append the operation of `fields` to the innermost region, with the
   *  abort kinds that the policy states for it, and return its result. */
  private push(
    fields: OperationFields,
    type: BigintType,
    origin: Expression
  ): IRValue {
    const result = this.newValue(type);
    const op = {
      ...fields,
      result,
      effect: 'pure',
      origin,
    } as IROperation;
    const aborts = JAVASCRIPT_BIGINT_POLICY.aborts!(op);
    this.operations.push(
      aborts === undefined ? op : ({ ...op, aborts } as IROperation)
    );
    return result;
  }

  private literal(value: bigint | boolean, origin: Expression): IRValue {
    return this.push(
      { kind: 'literal', value, operands: [] },
      typeof value === 'boolean' ? 'boolean' : 'integer',
      origin
    );
  }

  private integer(
    fn: IntegerFunctionName,
    operands: readonly IRValue[],
    origin: Expression,
    rounding?: IntegerRounding
  ): IRValue {
    return this.push(
      {
        kind: 'integer',
        fn,
        operands,
        ...(rounding === undefined ? {} : { rounding }),
      },
      fn === 'is-prime' ? 'boolean' : 'integer',
      origin
    );
  }

  /** End `operations` with the yield of `value` and summarize it; the
   *  region has the parameters `parameters`, when there are any. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue,
    parameters?: readonly IRValue[]
  ): IRRegion {
    operations.push({
      kind: 'yield',
      operands: [value],
      effect: 'pure',
      origin,
    });
    return {
      ...(parameters === undefined ? {} : { parameters }),
      operations,
      effect: 'pure',
      ...(operations.some((op) => operationCanAbort(op, this.functions))
        ? { canAbort: true as const }
        : {}),
    };
  }

  private inRegion<T>(
    operations: IROperation[],
    step: () => T,
    barrier = false
  ): T {
    this.regions.push({
      operations,
      values: new Map(),
      ...(barrier ? { barrier: true as const } : {}),
    });
    try {
      return step();
    } finally {
      this.regions.pop();
    }
  }

  /** A region that yields the value that `step` lowers in it. */
  private nested(origin: Expression, step: () => IRValue): IRRegion {
    const operations: IROperation[] = [];
    const value = this.inRegion(operations, step);
    return this.region(operations, origin, value);
  }

  /** A region with the parameters `parameters` (none for the body of a
   *  function, whose parameters are `IRFunction.parameters`) that binds the
   *  names of `names` to their values and yields the value that `step`
   *  lowers in it. The region shares no value of the regions around it
   *  (`shared()`). With `fresh`, no name of an enclosing construct is
   *  visible in it: the body of a user function is lexically outside the
   *  call. */
  private binding(
    origin: Expression,
    parameters: readonly IRValue[] | undefined,
    names: ReadonlyMap<string, IRValue>,
    step: () => IRValue,
    fresh = false
  ): IRRegion {
    const saved = this.scopes;
    this.scopes = [...(fresh ? [] : saved), names];
    try {
      const operations: IROperation[] = [];
      const value = this.inRegion(operations, step, true);
      return this.region(operations, origin, value, parameters);
    } finally {
      this.scopes = saved;
    }
  }

  /**
   * The value of a function node under the key `key`: the value of its
   * first lowering in the current region or a region around it, up to the
   * innermost region that binds names, or a new lowering, remembered in the
   * current region.
   */
  private shared(
    node: Expression,
    key: ValueKey,
    lower: () => IRValue
  ): IRValue {
    if (!isFunction(node)) return lower();
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const known = this.regions[i].values.get(node)?.get(key);
      if (known !== undefined) return known;
      if (this.regions[i].barrier === true) break;
    }
    const value = lower();
    const values = this.regions[this.regions.length - 1].values;
    let byKey = values.get(node);
    if (byKey === undefined) values.set(node, (byKey = new Map()));
    byKey.set(key, value);
    return value;
  }

  // -------------------------------------------------------------------------
  // Values (`value()` in `compile-bigint-emit.ts`)
  // -------------------------------------------------------------------------

  private value(node: Expression): IRValue {
    const record = this.record(node);
    if (record.value === 'parent-lowered')
      throw new Error(
        `JS structured bigint lowering: ${nodeText(node)} is lowered by its integer-forcing parent only`
      );
    return this.shared(node, 'value', () => {
      if (record.lowering === 'folded') return this.folded(node, record);
      if (isSymbol(node)) return this.symbol(node, record);
      if (!isFunction(node))
        return this.refuse(
          node,
          `${nodeText(node)} is not in the profile in the mode bigint`
        );
      return this.application(node, record);
    });
  }

  /** The value of an operand whose parent forces an integer. */
  private forced(node: Expression, forcing: BigintForcingParent): IRValue {
    const record = this.record(node);
    if (record.value !== 'parent-lowered') return this.value(node);
    return this.shared(node, forcing, () =>
      this.lowered(node, record, forcing)
    );
  }

  /** An operand at a parameter declared an integer: an integer promise
   *  for a parent-lowered operand (`Fibonacci(n/2)`). */
  private argument(node: Expression): IRValue {
    return this.record(node).value === 'parent-lowered'
      ? this.forced(node, 'promise')
      : this.value(node);
  }

  /** A name that an enclosing construct binds (`lowering` `bigint` of the
   *  lane analysis), or an input: an integer, lifted at the entry, or a flat
   *  list of integers, read as the host gives it. */
  private symbol(
    node: Expression & { symbol: string },
    record: BigintLaneRecord
  ): IRValue {
    const name = node.symbol;
    if (record.lowering !== 'input') {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const value = this.scopes[i].get(name);
        if (value !== undefined) return value;
      }
      return this.refuse(
        node,
        `the local ${name} is not in the profile in the mode bigint`
      );
    }
    const list = record.input === 'integer-list';
    // A nested list is not held in the mode.
    if (
      list &&
      (record.type === 'never' || !isSubtype(record.type, LIST_OF_INTEGERS))
    )
      return this.refuse(
        node,
        `the input ${name} has the type ${String(node.type)}, and the profile holds only a list of integers in the mode bigint`
      );
    if (!list && record.input !== 'integer')
      return this.refuse(
        node,
        `the input ${name} is not in the profile in the mode bigint`
      );
    if (this.inFunction())
      return this.refuse(
        node,
        `the body of a user function reads the input ${name}, which a function of the profile does not read in the mode bigint`
      );
    let index = this.inputIndex.get(name);
    if (index === undefined) {
      index = this.inputs.length;
      this.inputs.push(
        list
          ? { name, type: INTEGER_LIST, representation: 'bigint-array' }
          : { name, type: 'integer', representation: 'bigint', lifted: true }
      );
      this.inputIndex.set(name, index);
    }
    return this.push(
      { kind: 'input', input: index, operands: [] },
      list ? INTEGER_LIST : 'integer',
      node
    );
  }

  /**
   * Record in `dependencies` each name of the constant subtree `node` whose
   * definition its folded value holds: a symbol with a value (and the names
   * of that value), and the head of a call of a user function (and the names
   * of its body), as the existing route records a folded symbol
   * (`tryFoldKnownSymbol()` in `compile-folded-values.ts`). A constant of the
   * engine (`Pi`) is not one: its value does not change.
   */
  private recordFolded(node: Expression): void {
    const engine = node.engine;
    const visit = (e: Expression): void => {
      if (isSymbol(e)) {
        const name = e.symbol;
        if (e.isConstant || this.dependencies.has(name)) return;
        const value = engine._getSymbolValue(name);
        if (value === undefined) return;
        this.dependencies.add(name);
        visit(value);
        return;
      }
      if (!isFunction(e)) return;
      const head = e.operator;
      if (!this.dependencies.has(head) && isUserDefinedFunction(engine, head)) {
        this.dependencies.add(head);
        const literal = userFunctionLiteral(engine, head);
        if (literal !== undefined) visit(literal.ops[0]);
      }
      for (const op of e.ops) visit(op);
    };
    visit(node);
  }

  /** Whether the current region is in the body of a user function. */
  private inFunction(): boolean {
    return this.inProgress.size > 0;
  }

  /** A constant subtree, from the exact value of `evaluate()`, or the
   *  abort of a constant pole (`folded()` in `compile-bigint-emit.ts`). */
  private folded(node: Expression, record: BigintLaneRecord): IRValue {
    this.recordFolded(node);
    if (record.pole !== undefined)
      return this.push(
        {
          kind: 'no-value',
          value: Number.isNaN(record.pole) ? 'undefined' : 'infinite',
          operands: [],
        },
        'integer',
        node
      );
    if (isSymbol(node, 'True')) return this.literal(true, node);
    if (isSymbol(node, 'False')) return this.literal(false, node);
    const value = isNumber(node) ? node : node.evaluate();
    if (isSymbol(value, 'True')) return this.literal(true, node);
    if (isSymbol(value, 'False')) return this.literal(false, node);
    // A constant list: the `list` of its literal elements, as the existing
    // emitter writes the array literal of the value (`literalCode()` in
    // `compile-bigint-emit.ts`).
    if (record.value === 'bigint-list') {
      const cells = isFunction(value, 'List')
        ? value.ops
        : value.isFiniteCollection === true
          ? [...value.each()]
          : undefined;
      const integers = cells?.map((cell) => {
        const r = isNumber(cell) ? exactRational(cell) : undefined;
        return r !== undefined && r.q === 1n ? r.p : undefined;
      });
      if (integers === undefined || integers.some((v) => v === undefined))
        return this.refuse(
          node,
          `the constant ${nodeText(node)} has no value that is a list of exact integers: the interpreter gives ${nodeText(value)}`
        );
      return this.push(
        {
          kind: 'list',
          operands: integers.map((v) => this.literal(v!, node)),
        },
        INTEGER_LIST,
        node
      );
    }
    const r = isNumber(value) ? exactRational(value) : undefined;
    if (r === undefined || r.q !== 1n)
      return this.refuse(
        node,
        `the constant ${nodeText(node)} has no exact integer or boolean value: the interpreter gives ${nodeText(value)}`
      );
    return this.literal(r.p, node);
  }

  private application(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): IRValue {
    const head = node.operator;
    if (head === 'Block') return this.value(node.op1);
    if (record.userCall !== undefined) return this.userCall(node, record);
    if (CALLBACK_HEADS.has(head))
      return this.refuse(
        node,
        `${head} with a function operand is not in the profile in the mode bigint`
      );
    const ops = node.ops;
    const values = () => ops.map((op) => this.value(op));
    switch (head) {
      case 'Add':
        return this.arithmetic('add', values(), node);
      case 'Subtract': {
        // `a - b - c`: the operands in order, the later ones negated.
        const [first, ...rest] = ops.map((op, i) => {
          const v = this.value(op);
          return i === 0
            ? v
            : this.push({ kind: 'negate', operands: [v] }, 'integer', node);
        });
        return this.arithmetic('add', [first, ...rest], node);
      }
      case 'Negate':
        return this.push(
          { kind: 'negate', operands: [this.value(node.op1)] },
          'integer',
          node
        );
      case 'Multiply':
        return this.arithmetic('multiply', values(), node);
      case 'Min':
      case 'Max':
        return this.arithmetic(
          head === 'Min' ? 'min' : 'max',
          ops.map((op) => this.argument(op)),
          node
        );
      case 'Power':
        return this.power(node);
      case 'Abs':
      case 'Sign':
        return this.push(
          {
            kind: 'unary',
            fn: head === 'Abs' ? 'abs' : 'sign',
            operands: [this.value(node.op1)],
          },
          'integer',
          node
        );
      case 'Mod':
        return this.push(
          {
            kind: 'mod',
            operands: [this.value(node.op1), this.value(node.op2)],
          },
          'integer',
          node
        );
      case 'Remainder':
        return this.integer(
          'remainder',
          [this.value(node.op1), this.value(node.op2)],
          node
        );
      case 'Factorial2':
        return this.integer('factorial2', [this.value(node.op1)], node);
      case 'IsPrime':
        return this.integer('is-prime', [this.value(node.op1)], node);
      case 'Floor':
      case 'Ceil':
      case 'Round':
      case 'Truncate':
        // The rounding of an integer is that integer.
        return this.forced(node.op1, head);
      case 'Typed':
        return this.forced(node.op1, 'promise');
      case 'If':
      case 'Which':
        return this.conditional(node);
      case 'Less':
      case 'Greater':
      case 'LessEqual':
      case 'GreaterEqual':
      case 'Equal':
      case 'NotEqual':
        return this.comparison(node, record);
      case 'And':
      case 'Or':
        return this.shortCircuit(node);
      case 'Not':
        return this.push(
          { kind: 'not', operands: [this.value(node.op1)] },
          'boolean',
          node
        );
      case 'Boole': {
        // `b ? 1n : 0n`.
        const test = this.value(node.op1);
        return this.choice(
          node,
          test,
          () => this.literal(1n, node),
          () => this.literal(0n, node),
          'integer'
        );
      }
      case 'Sum':
      case 'Product':
        return this.loop(node);
      case 'List':
        // `[a, b, …]`: a cell that is a list is a nested list.
        return this.push(
          {
            kind: 'list',
            operands: ops.map((op) => {
              if (this.record(op).value !== 'bigint')
                this.refuse(
                  op,
                  `the list ${nodeText(node)} has a cell that is not an integer, and the profile holds only a list of integers in the mode bigint`
                );
              return this.value(op);
            }),
          },
          INTEGER_LIST,
          node
        );
      case 'Range':
        // `_SYS.brange(lo, hi)` and `_SYS.brange(lo, hi, step)`; `Range(hi)`
        // starts at 1.
        return this.collection(
          'range',
          ops.length === 1
            ? [this.literal(1n, node), this.value(ops[0])]
            : values(),
          node
        );
      case 'Length':
      case 'Count':
        // `_SYS.toBigint(L.length)`.
        return this.push(
          { kind: 'length', operands: [this.value(node.op1)] },
          'integer',
          node
        );
      case 'At':
      case 'First':
      case 'Last': {
        // `_SYS.bat(L, i)`, with `i` `1n` for `First` and `-1n` for `Last`.
        const list = this.value(node.op1);
        const index =
          head === 'At'
            ? this.value(node.op2)
            : this.literal(head === 'First' ? 1n : -1n, node);
        return this.push(
          { kind: 'at', operands: [list, index] },
          'integer',
          node
        );
      }
      case 'Take':
      case 'Drop':
        // `_SYS.btake(L, c)`, `_SYS.bdrop(L, c)`.
        return this.collection(
          head === 'Take' ? 'take' : 'drop',
          [this.value(node.op1), this.value(node.op2)],
          node
        );
      case 'ReplaceAt': {
        // `_SYS.breplaceAt(L, i, v)`: the position and the value are at
        // parameters declared an integer, integer promises.
        const list = this.value(node.op1);
        const index = this.argument(node.op2);
        const element = this.argument(node.op3);
        return this.push(
          { kind: 'replace-at', operands: [list, index, element] },
          INTEGER_LIST,
          node
        );
      }
    }
    const fn = INTEGER_HEADS[head];
    if (fn !== undefined)
      return this.integer(
        fn,
        ops.map((op) => this.argument(op)),
        node
      );
    return this.refuse(
      node,
      `${head} is not in the profile in the mode bigint`
    );
  }

  /** `add`, `multiply`, `min` or `max` of `operands`; one operand is its
   *  own value, as the helper of one operand gives it. */
  private arithmetic(
    kind: 'add' | 'multiply' | 'min' | 'max',
    operands: readonly IRValue[],
    node: Expression
  ): IRValue {
    if (operands.length === 1) return operands[0];
    return this.push({ kind, operands }, 'integer', node);
  }

  /** `Power(−1, k)` by the parity of `k`; any other power on the lane has an
   *  exponent typed `integer<0..>`. */
  private power(node: Expression & FunctionInterface): IRValue {
    const base = exactRational(node.op1);
    if (base !== undefined && base.q === 1n && base.p === -1n)
      return this.integer('neg-one-pow', [this.value(node.op2)], node);
    return this.integer(
      'int-pow',
      [this.value(node.op1), this.value(node.op2)],
      node
    );
  }

  /** An `if` of the test `test` whose branches yield `then` and `otherwise`,
   *  of the type `type`. */
  private choice(
    node: Expression,
    test: IRValue,
    then: () => IRValue,
    otherwise: () => IRValue,
    type: 'integer' | 'boolean'
  ): IRValue {
    const thenRegion = this.nested(node, then);
    const elseRegion = this.nested(node, otherwise);
    const result = this.newValue(type);
    this.operations.push({
      kind: 'if',
      results: [result],
      operands: [test],
      then: thenRegion,
      else: elseRegion,
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /** `If(c, a, b)`, and `Which(c₁, v₁, …, True, vₖ)` as a chain of `if`
   *  operations whose last else branch is `vₖ`: the test `True` is not
   *  evaluated, as the existing emitter writes it. */
  private conditional(node: Expression & FunctionInterface): IRValue {
    const ops = node.ops;
    const type = this.record(node).value === 'boolean' ? 'boolean' : 'integer';
    if (node.operator === 'If')
      return this.choice(
        node,
        this.value(ops[0]),
        () => this.value(ops[1]),
        () => this.value(ops[2]),
        type
      );
    const chain = (i: number): IRValue =>
      i >= ops.length - 2
        ? this.value(ops[ops.length - 1])
        : this.choice(
            node,
            this.value(ops[i]),
            () => this.value(ops[i + 1]),
            () => chain(i + 2),
            type
          );
    return chain(0);
  }

  /**
   * A comparison of two lane values, or of a lane value and a rational
   * constant `p/q` (`q > 0`), compared exactly: `n < p/q` is `q·n < p`.
   * `Greater` and `GreaterEqual` are `less` and `less-equal` of the
   * operands in the other order, which are lowered in their order. An
   * `Equal` or a `NotEqual` with a constant that is not an integer has a
   * value known at compile time: the lane operand is still lowered, so its
   * abort ends the call as it does elsewhere.
   */
  private comparison(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): IRValue {
    const head = node.operator;
    const c = record.comparison;
    let left: IRValue;
    let right: IRValue;
    if (c === undefined) {
      left = this.value(node.op1);
      right = this.value(node.op2);
    } else {
      const lane = this.value(node.ops[1 - c.constantOperand]);
      if (c.folded !== undefined) return this.literal(c.folded, node);
      const scaled = this.push(
        { kind: 'multiply', operands: [this.literal(c.q, node), lane] },
        'integer',
        node
      );
      const p = this.literal(c.p, node);
      [left, right] = c.constantOperand === 1 ? [scaled, p] : [p, scaled];
    }
    const [kind, operands] =
      head === 'Less'
        ? (['less', [left, right]] as const)
        : head === 'Greater'
          ? (['less', [right, left]] as const)
          : head === 'LessEqual'
            ? (['less-equal', [left, right]] as const)
            : head === 'GreaterEqual'
              ? (['less-equal', [right, left]] as const)
              : head === 'Equal'
                ? (['equal', [left, right]] as const)
                : (['not-equal', [left, right]] as const);
    return this.push({ kind, operands }, 'boolean', node);
  }

  /** `And` and `Or`: each operand after the first in a region that runs
   *  only when the operands before it do not decide the result. */
  private shortCircuit(node: Expression & FunctionInterface): IRValue {
    const [first, ...rest] = node.ops;
    const value = this.value(first);
    if (rest.length === 0) return value;
    return this.push(
      {
        kind: node.operator === 'And' ? 'and' : 'or',
        operands: [value],
        rest: rest.map((op) => this.nested(node, () => this.value(op))),
      },
      'boolean',
      node
    );
  }

  /** A function of lists of the policy (`take`, `drop`, `range`), whose
   *  result is a list of integers. */
  private collection(
    fn: CollectionFunctionName,
    operands: readonly IRValue[],
    node: Expression
  ): IRValue {
    return this.push({ kind: 'collection', fn, operands }, INTEGER_LIST, node);
  }

  // -------------------------------------------------------------------------
  // Loops and user functions (`loop()` and `userCall()` in
  // `compile-bigint-emit.ts`)
  // -------------------------------------------------------------------------

  /**
   * `Sum(body, Limits(i, lo, hi), …)` and `Product(…)`: one `loop` per
   * `Limits`, the first one outermost, each from `lo` to `hi` by 1 with no
   * pass when `hi < lo` (`ascending`), and one carried value, the
   * accumulator, `0` for a sum and `1` for a product. The bounds of each
   * `Limits` are evaluated once per run of its loop, `hi` before `lo`, as
   * the existing emitter writes `const upper = hi; for (let i = lo; …)`;
   * the inner loops start with the value of the accumulator of the loop
   * around them, as the existing emitter adds every term to one variable.
   * A limit whose index is not a name has an index that no name binds.
   */
  private loop(node: Expression & FunctionInterface): IRValue {
    const [body, ...limits] = node.ops;
    const product = node.operator === 'Product';
    const nest = (i: number, carried: IRValue): IRValue => {
      if (i === limits.length)
        return this.push(
          {
            kind: product ? 'multiply' : 'add',
            operands: [carried, this.value(body)],
          },
          'integer',
          node
        );
      const limit = limits[i] as Expression & FunctionInterface;
      const hi = this.value(limit.ops[2]);
      const lo = this.value(limit.ops[1]);
      const index = this.newValue('integer');
      const accumulator = this.newValue('integer');
      const names = new Map<string, IRValue>();
      if (isSymbol(limit.op1)) names.set(limit.op1.symbol, index);
      const region = this.binding(node, [index, accumulator], names, () =>
        nest(i + 1, accumulator)
      );
      const result = this.newValue('integer');
      this.operations.push({
        kind: 'loop',
        results: [result],
        operands: [lo, hi, carried],
        body: region,
        ascending: true,
        effect: 'pure',
        origin: node,
      });
      return result;
    };
    return nest(0, this.literal(product ? 1n : 0n, node));
  }

  /**
   * A call of a user function: a call of the function of the program of
   * the literal that the lane analysis analyzed for it. An argument at a
   * parameter declared an integer is an integer promise for a
   * parent-lowered argument, as for a library head. A function declared
   * `-> integer` is an integer promise for its body. A call of a function
   * whose body is being lowered (a recursive call) is refused, as the
   * structured route refuses recursion in every mode.
   */
  private userCall(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): IRValue {
    const call = record.userCall!;
    const literal = call.literal;
    if (
      this.inProgress.has(literal) ||
      !this.analysis.records.has(literal.ops[0])
    )
      return this.refuse(
        node,
        `the recursive function ${call.name} is not in the profile`
      );
    const index = this.helper(call.name, literal, call.resultPromise);
    return this.push(
      {
        kind: 'call',
        function: index,
        operands: node.ops.map((arg) => this.argument(arg)),
      },
      'integer',
      node
    );
  }

  /** The index of the function of the program of the user function `name`
   *  whose body the lane analysis analyzed in `literal`: its body is
   *  lowered at the first call, after the functions that it calls. */
  private helper(
    name: string,
    literal: Expression & FunctionInterface,
    resultPromise: boolean
  ): number {
    const known = this.functionIndex.get(literal);
    if (known !== undefined) return known;
    const names = functionLiteralBoundNames(literal.ops.slice(1));
    if (
      names.length !== literal.nops - 1 ||
      new Set(names).size !== names.length
    )
      return this.refuse(
        literal,
        `the parameters of the user function ${name} are not names, one per argument`
      );
    const parameters = names.map(() => this.newValue('integer'));
    this.inProgress.add(literal);
    let body: IRRegion;
    try {
      body = this.binding(
        literal,
        undefined,
        new Map(names.map((p, i) => [p, parameters[i]])),
        () =>
          resultPromise
            ? this.forced(literal.ops[0], 'promise')
            : this.value(literal.ops[0]),
        true
      );
    } finally {
      this.inProgress.delete(literal);
    }
    const index = this.functions.length;
    // A function specialized to other argument types has a name of its own.
    const taken = new Set(this.functions.map((fn) => fn.name));
    let unique = name;
    for (let k = 2; taken.has(unique); k++) unique = `${name}_${k}`;
    this.functions.push({
      name: unique,
      parameters,
      result: { type: 'integer', representation: 'bigint' },
      body,
      origin: literal,
    });
    this.functionIndex.set(literal, index);
    this.dependencies.add(name);
    return index;
  }

  // -------------------------------------------------------------------------
  // Non-integer shapes under an integer-forcing parent (`lowered()` in
  // `compile-bigint-emit.ts`)
  // -------------------------------------------------------------------------

  /** The value of the non-integer subtree `node` under the integer-forcing
   *  parent `forcing`: one rounded `quotient`, `rounded-pow` or `isqrt`. A
   *  single-statement `Block` passes the parent down. */
  private lowered(
    node: Expression,
    record: BigintLaneRecord,
    forcing: BigintForcingParent
  ): IRValue {
    if (!isFunction(node))
      throw new Error(
        `JS structured bigint lowering: the parent-lowered ${nodeText(node)} is not an application`
      );
    if (node.operator === 'Block') return this.forced(node.op1, forcing);
    const rounding = ROUNDING[forcing];
    switch (record.parentLowered?.shape) {
      case 'rational-product': {
        // `p·t₁·… / q`.
        const r = exactRational(node.op1);
        if (r === undefined)
          throw new Error(
            `JS structured bigint lowering: the rational factor of ${nodeText(node)} has no exact value`
          );
        const product = this.push(
          {
            kind: 'multiply',
            operands: [
              this.literal(r.p, node),
              ...node.ops.slice(1).map((op) => this.value(op)),
            ],
          },
          'integer',
          node
        );
        return this.integer(
          'quotient',
          [product, this.literal(r.q, node)],
          node,
          rounding
        );
      }
      case 'quotient':
        return this.integer(
          'quotient',
          [this.value(node.op1), this.value(node.op2)],
          node,
          rounding
        );
      case 'power':
        return this.integer(
          'rounded-pow',
          [this.value(node.op1), this.value(node.op2)],
          node,
          rounding
        );
      case 'sqrt':
        if (rounding === 'exact')
          return this.refuse(
            node,
            'a square root is lowered by a rounding parent only'
          );
        return this.integer('isqrt', [this.value(node.op1)], node, rounding);
    }
    throw new Error(
      `JS structured bigint lowering: ${nodeText(node)} has no lowered shape`
    );
  }
}
