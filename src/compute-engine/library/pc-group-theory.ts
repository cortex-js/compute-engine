// Collected polycyclic presentations use exact coordinates instead of finite
// tables. The constructor checks cyclic-extension consistency before exposing a
// group; arithmetic trusts the resulting kernel values and shares one ledger.
import type {
  Expression,
  IComputeEngine,
  OperatorDefinition,
} from '../global-types.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { toBigint } from '../boxed-expression/numerics.js';
import { checkDeadline } from '../../common/interruptible.js';
import { GroupInputError, GroupWork } from '../group-theory/finite-group.js';
import { CollectedPcGroup } from '../group-theory/polycyclic-presentation.js';

/** Encode mathematical relations only; receiving evaluations enforce their own limits. */
export function encodeCollectedPcGroup(
  ce: IComputeEngine,
  group: CollectedPcGroup
): Expression {
  const integers = (values: readonly bigint[]) =>
    ce.function(
      'List',
      values.map((x) => ce.number(x))
    );
  const vectors = (values: readonly (readonly bigint[])[]) =>
    ce.function('List', values.map(integers));
  const orders: bigint[] = [],
    powers: Expression[] = [],
    conjugates: Expression[] = [],
    inverse: Expression[] = [];
  for (let current = group; current.tail; current = current.tail) {
    orders.push(current.relativeOrder);
    powers.push(integers(current.powerRelation));
    conjugates.push(vectors(current.conjugates));
    inverse.push(vectors(current.inverseConjugates));
  }
  return ce._fn('PcGroup', [
    integers(orders),
    ce.function('List', powers),
    ce.function('List', conjugates),
    ce.function('List', inverse),
  ]);
}

class UnresolvedPcOperand extends Error {}

/** Register checked presentation/element values and exact coordinate arithmetic. */
export function collectedPcDefinitions(
  ce: IComputeEngine,
  maxWork: number
): Record<string, OperatorDefinition> {
  const definitions: Record<string, OperatorDefinition> = {};
  type Presentation = {
    source: Expression;
    group: CollectedPcGroup;
    cost: number;
    encoded?: Expression;
  };
  // Boxed identity owns the cache lifetime. Reusing a proof saves CPU, but each
  // evaluation still reserves its validation cost and checks the current deadline.
  // Equal domains within one evaluation share that reservation and kernel object.
  const presentations = new WeakMap<Expression, Presentation>();
  const byGroup = new WeakMap<CollectedPcGroup, Presentation>();
  const received = new WeakMap<GroupWork, Presentation[]>();
  const invalid = (code: string): never => {
    throw new GroupInputError(code);
  };
  const unresolved = (value: Expression): never => {
    if (isFunction(value, 'Error')) throw value;
    if (!value.isConstant) throw new UnresolvedPcOperand();
    return invalid('incompatible-type');
  };
  const list = (value: Expression) =>
    isFunction(value, 'List') ? value.ops : unresolved(value);
  const integer = (value: Expression): bigint => {
    if (!isNumber(value)) return unresolved(value);
    if (value.isInteger !== true) return invalid('incompatible-type');
    return toBigint(value) ?? invalid('incompatible-type');
  };
  const integers = (values: readonly bigint[]) =>
    ce.function(
      'List',
      values.map((x) => ce.number(x))
    );
  const readVector = (
    value: Expression,
    length: number,
    work: GroupWork
  ): bigint[] => {
    const cells = list(value);
    if (cells.length !== length) return invalid('invalid-pc-coordinate-length');
    work.tick(length);
    return cells.map(integer);
  };
  // The flat descriptor lists each generator's tail relations in normal-form order.
  // Building from the last generator gives every extension an already-proven tail.
  const readGroup = (value: Expression, work: GroupWork): CollectedPcGroup => {
    const current = received.get(work) ?? [];
    const cached = presentations.get(value);
    if (cached && current.includes(cached)) {
      // Reserve the same domain-comparison work whether equality is already
      // cached or must be established structurally below.
      work.tick(cached.group.storedCoefficients);
      return cached.group;
    }
    for (const entry of current) {
      // Structural comparison is bounded by a validated descriptor's storage.
      // Only an equal, already-proved expression can bypass decoding.
      work.tick(entry.group.storedCoefficients);
      if (
        value.isSame(entry.source) ||
        value.isSame(entry.encoded ?? entry.source)
      ) {
        presentations.set(value, entry);
        return entry.group;
      }
    }
    if (cached) {
      work.tick(cached.cost);
      current.push(cached);
      received.set(work, current);
      return cached.group;
    }
    const before = work.used;
    if (!isFunction(value, 'PcGroup')) return unresolved(value);
    if (value.ops.length !== 4) return invalid('unexpected-argument');
    const orders = list(value.ops[0]),
      powers = list(value.ops[1]),
      conjugates = list(value.ops[2]),
      inverseConjugates = list(value.ops[3]);
    if (orders.length > 64) return invalid('pc-presentation-rank-limit');
    if (
      [powers, conjugates, inverseConjugates].some(
        (x) => x.length !== orders.length
      )
    )
      return invalid('invalid-pc-presentation-relations');
    let group = CollectedPcGroup.trivial(work);
    for (let i = orders.length - 1; i >= 0; i--) {
      const rank = group.rank;
      const matrix = (input: Expression) => {
        const rows = list(input);
        if (rows.length !== rank)
          return invalid('invalid-pc-presentation-relations');
        return rows.map((row) => readVector(row, rank, work));
      };
      group = CollectedPcGroup.extend(
        group,
        {
          relativeOrder: integer(orders[i]),
          power: readVector(powers[i], rank, work),
          conjugates: matrix(conjugates[i]),
          inverseConjugates: matrix(inverseConjugates[i]),
        },
        work
      );
    }
    const entry = { source: value, group, cost: work.used - before };
    presentations.set(value, entry);
    byGroup.set(group, entry);
    current.push(entry);
    received.set(work, current);
    return group;
  };
  const encodeGroup = (group: CollectedPcGroup): Expression => {
    const entry = byGroup.get(group)!;
    if (entry.encoded) return entry.encoded;
    const descriptor = encodeCollectedPcGroup(ce, group);
    entry.encoded = descriptor;
    presentations.set(descriptor, entry);
    return descriptor;
  };
  const elementOperands = (value: Expression) => {
    if (!isFunction(value, 'PcElement')) return unresolved(value);
    if (value.ops.length !== 2) return invalid('unexpected-argument');
    return value.ops;
  };
  const readElement = (value: Expression, work: GroupWork) => {
    const operands = elementOperands(value),
      group = readGroup(operands[0], work);
    return {
      group,
      coordinates: group.coordinates(
        readVector(operands[1], group.rank, work),
        work
      ),
    };
  };
  const encodeElement = (group: Expression, coordinates: readonly bigint[]) =>
    ce._fn('PcElement', [group, integers(coordinates)]);
  const register = (
    name: string,
    signature: string,
    count: number,
    body: (
      ops: readonly Expression[],
      work: GroupWork,
      expression?: Expression
    ) => Expression
  ) => {
    definitions[name] = {
      signature: signature.replace(
        ') ->',
        ', options: dictionary<integer>?) ->'
      ),
      pure: true,
      evaluate: (ops, context) => {
        try {
          let limit = maxWork;
          const options = ops[count];
          if (options && !isSymbol(options, 'Nothing')) {
            if (!isDictionary(options)) return unresolved(options);
            for (const key of options.keys) {
              if (key !== 'maxWork') return invalid('unknown-group-option');
              const value = integer(options.get(key)!);
              if (value < 0n || value > BigInt(maxWork))
                return invalid('group-option-exceeds-limit');
              limit = Number(value);
            }
          }
          const work = new GroupWork(limit, () =>
            checkDeadline(ce._deadlineFrame)
          );
          work.tick(0);
          return body(ops.slice(0, count), work, context.expression);
        } catch (error) {
          if (error instanceof UnresolvedPcOperand) return undefined;
          if (
            error &&
            typeof error === 'object' &&
            isFunction(error as Expression, 'Error')
          )
            return error as Expression;
          if (
            error &&
            typeof error === 'object' &&
            'name' in error &&
            ['GroupInputError', 'GroupLimitError'].includes(String(error.name))
          )
            return ce.error(String((error as Error).message));
          throw error;
        }
      },
    };
  };
  register(
    'PcGroup',
    '(list<integer>, list<list<integer>>, list<list<list<integer>>>, list<list<list<integer>>>) -> PcGroup',
    4,
    (ops, work, expression) => {
      // Retain boxed identity when evaluation leaves the mathematical operands
      // unchanged. A symbolic relation that evaluates differently must be decoded.
      const value =
        isFunction(expression, 'PcGroup') &&
        expression.ops.length === 4 &&
        ops.every((op, i) => op.isSame(expression.ops[i]))
          ? expression
          : ce._fn('PcGroup', ops);
      return encodeGroup(readGroup(value, work));
    }
  );
  register(
    'PcElement',
    '(PcGroup, list<integer>) -> PcElement',
    2,
    (ops, work) => {
      const value = readElement(ce._fn('PcElement', ops), work);
      return encodeElement(encodeGroup(value.group), value.coordinates);
    }
  );
  register('PcGroupOrder', '(PcGroup) -> integer', 1, (ops, work) =>
    ce.number(readGroup(ops[0], work).order)
  );
  register('PcRelativeOrders', '(PcGroup) -> list<integer>', 1, (ops, work) =>
    integers(readGroup(ops[0], work).relativeOrders)
  );
  register('PcIdentity', '(PcGroup) -> PcElement', 1, (ops, work) => {
    const group = readGroup(ops[0], work);
    return encodeElement(encodeGroup(group), group.identity());
  });
  register('PcGenerators', '(PcGroup) -> list<PcElement>', 1, (ops, work) => {
    const group = readGroup(ops[0], work),
      descriptor = encodeGroup(group);
    return ce.function(
      'List',
      Array.from({ length: group.rank }, (_, i) =>
        encodeElement(descriptor, group.generator(i, work))
      )
    );
  });
  register('PcCoordinates', '(PcElement) -> list<integer>', 1, (ops, work) =>
    integers(readElement(ops[0], work).coordinates)
  );
  register(
    'PcMultiply',
    '(PcElement, PcElement) -> PcElement',
    2,
    (ops, work) => {
      const left = elementOperands(ops[0]),
        right = elementOperands(ops[1]);
      const group = readGroup(left[0], work);
      // Resolve and validate both domains before comparing their mathematical data.
      const target = readGroup(right[0], work);
      const descriptor = encodeGroup(group);
      if (group !== target) return invalid('incompatible-pc-presentation');
      const a = group.coordinates(readVector(left[1], group.rank, work), work),
        b = group.coordinates(readVector(right[1], group.rank, work), work);
      return encodeElement(descriptor, group.multiply(a, b, work));
    }
  );
  register('PcInverse', '(PcElement) -> PcElement', 1, (ops, work) => {
    const value = readElement(ops[0], work);
    return encodeElement(
      encodeGroup(value.group),
      value.group.inverse(value.coordinates, work)
    );
  });
  register('PcPower', '(PcElement, integer) -> PcElement', 2, (ops, work) => {
    const value = readElement(ops[0], work);
    return encodeElement(
      encodeGroup(value.group),
      value.group.power(value.coordinates, integer(ops[1]), work)
    );
  });
  return definitions;
}
