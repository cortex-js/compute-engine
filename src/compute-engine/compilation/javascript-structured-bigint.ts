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
 * integers. A node that the structured route does not lower yet (a `Sum`, a
 * list, a call of a user function, a `Function` literal at the root)
 * throws a `StructuredBigintRefusal`, which the profile declines.
 *
 * - An integer input is read once, at the entry, and a `number` that the
 *   host gives is converted there (`IRInput.lifted`).
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
 *   parent: `Floor(n/2) + Ceil(n/2)` lowers two quotients.
 *
 * Every operation is `pure`; an abort is not an effect.
 */
import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  exactRational,
  type BigintForcingParent,
  type BigintLaneAnalysis,
  type BigintLaneRecord,
} from './compile-bigint-lane.js';
import { nodeText } from './fragment.js';
import { JAVASCRIPT_BIGINT_POLICY } from './javascript-structured-policy.js';
import {
  STRUCTURED_OPERATION_LIMIT,
  StructuredLimitError,
} from './javascript-structured-lower.js';
import {
  operationCanAbort,
  regionsOf,
  type IRInput,
  type IntegerFunctionName,
  type IntegerRounding,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
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

/** The program of `root`, whose lane analysis is `analysis`, and the nodes
 *  that an operation can come from (the nodes of the analysis). Throws a
 *  `StructuredBigintRefusal` for a node that the route does not lower, and
 *  a `StructuredLimitError` past `STRUCTURED_OPERATION_LIMIT` values. */
export function lowerBigintProgram(
  root: Expression,
  analysis: BigintLaneAnalysis
): { program: IRProgram; preparedNodes: ReadonlySet<Expression> } {
  if (analysis.root !== root)
    throw new Error(
      'JS structured bigint lowering: the analysis is not the analysis of the root'
    );
  return {
    program: new BigintLowering(analysis).program(root),
    preparedNodes: new Set(analysis.records.keys()),
  };
}

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

/** The heads of the lane that a later slice of the design lowers. */
const LATER_HEADS: ReadonlySet<string> = new Set([
  'Sum',
  'Product',
  'Reduce',
  'Fold',
  'Range',
  'List',
  'Map',
  'Length',
  'Count',
  'At',
  'First',
  'Last',
  'Take',
  'Drop',
  'ReplaceAt',
  'Function',
]);

/** The key of the value of a node in a region: its value, or its value
 *  under an integer-forcing parent. */
type ValueKey = BigintForcingParent | 'value';

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
   *  values of the function nodes lowered in it, by node and key. */
  private readonly regions: {
    readonly operations: IROperation[];
    readonly values: Map<Expression, Map<ValueKey, IRValue>>;
  }[] = [];

  constructor(private readonly analysis: BigintLaneAnalysis) {}

  program(root: Expression): IRProgram {
    if (isFunction(root, 'Function'))
      this.refuse(
        root,
        'a Function literal at the root is not in the profile in the mode bigint'
      );
    const operations: IROperation[] = [];
    const value = this.inRegion(operations, () => this.value(root));
    const region = this.region(operations, root, value);
    const noValue = [region].some(function holds(r: IRRegion): boolean {
      return r.operations.some(
        (op) => op.aborts?.includes('no-value') || regionsOf(op).some(holds)
      );
    });
    return {
      owner: this.owner,
      revision: this.revision,
      inputs: this.inputs,
      numericPolicy: 'bigint',
      ...(noValue
        ? { noValueResult: JAVASCRIPT_BIGINT_POLICY.noValueResult }
        : {}),
      captures: [],
      functions: [],
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

  private newValue(type: 'integer' | 'boolean'): IRValue {
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
    type: 'integer' | 'boolean',
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

  /** End `operations` with the yield of `value` and summarize it. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue
  ): IRRegion {
    operations.push({
      kind: 'yield',
      operands: [value],
      effect: 'pure',
      origin,
    });
    return {
      operations,
      effect: 'pure',
      ...(operations.some((op) => operationCanAbort(op, []))
        ? { canAbort: true as const }
        : {}),
    };
  }

  private inRegion<T>(operations: IROperation[], step: () => T): T {
    this.regions.push({ operations, values: new Map() });
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

  /**
   * The value of a function node under the key `key`: the value of its
   * first lowering in the current region or a region around it, or a new
   * lowering, remembered in the current region.
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

  private symbol(
    node: Expression & { symbol: string },
    record: BigintLaneRecord
  ): IRValue {
    if (record.lowering !== 'input' || record.input !== 'integer')
      return this.refuse(
        node,
        record.input === 'integer-list'
          ? `the list input ${node.symbol} is not in the profile in the mode bigint`
          : `the local ${node.symbol} is not in the profile in the mode bigint`
      );
    const name = node.symbol;
    let index = this.inputIndex.get(name);
    if (index === undefined) {
      index = this.inputs.length;
      this.inputs.push({
        name,
        type: 'integer',
        representation: 'bigint',
        lifted: true,
      });
      this.inputIndex.set(name, index);
    }
    return this.push({ kind: 'input', input: index, operands: [] }, 'integer', node);
  }

  /** A constant subtree, from the exact value of `evaluate()`, or the
   *  abort of a constant pole (`folded()` in `compile-bigint-emit.ts`). */
  private folded(node: Expression, record: BigintLaneRecord): IRValue {
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
    if (record.userCall !== undefined)
      return this.refuse(
        node,
        `a call of the user function ${record.userCall.name} is not in the profile in the mode bigint`
      );
    if (LATER_HEADS.has(head))
      return this.refuse(
        node,
        `${head} is not in the profile in the mode bigint`
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
          return i === 0 ? v : this.push({ kind: 'negate', operands: [v] }, 'integer', node);
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
          { kind: 'mod', operands: [this.value(node.op1), this.value(node.op2)] },
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
    }
    const fn = INTEGER_HEADS[head];
    if (fn !== undefined)
      return this.integer(
        fn,
        ops.map((op) => this.argument(op)),
        node
      );
    return this.refuse(node, `${head} is not in the profile in the mode bigint`);
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
