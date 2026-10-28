// Bounded finite-group, exact matrix, and polycyclic adapters. Mathematical
// inputs are decoded at this boundary; nested kernels share one work ledger.
// Subgroup results preserve their representation. Explicit maps carry their
// source and target so representation changes cannot silently lose a kernel.

import { FiniteModuloPcgs } from '../group-theory/polycyclic-quotient.js';
import {
  finitePcgsBySeries,
  finitePcOrbitStabilizer,
} from '../group-theory/polycyclic-actions.js';
import type {
  Expression,
  IComputeEngine,
  OperatorDefinition,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { asRational, toBigint } from '../boxed-expression/numerics.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  GroupInputError,
  GroupLimitError,
  GroupWork,
  finitePermutationModel,
  FiniteGroupTable,
  FiniteGroupHomomorphism,
  type FiniteSubgroup,
} from '../group-theory/finite-group.js';
import {
  finiteAutomorphisms,
  finiteGroupExponent,
  finiteGroupPrime,
  finiteGroupIsElementaryAbelian,
  finiteHallSubgroups,
  finiteComplementRepresentatives,
  finiteGroupSeries,
  finitePowerSubgroup,
  finitePCentralSeries,
  finiteRationalClasses,
  finiteIsCharacteristic,
  finiteAbelianInvariants,
  finiteEulerianFunction,
  finiteMinimalGenerators,
  finiteIndependentAbelianGenerators,
  finiteCommutatorLength,
  finiteSubgroupConjugacyClasses,
} from '../group-theory/finite-structure.js';
import { FinitePcgs } from '../group-theory/polycyclic.js';
import { fromFinitePcgs } from '../group-theory/polycyclic-presentation.js';
import { encodeCollectedPcGroup } from './pc-group-theory.js';
import {
  ExactMatrixField,
  ExactMatrixValue,
  ExactMatrixGroup,
  naturalLinearGroup,
  primeFieldMatrixGroupOrder,
  isNaturalLinearGroup,
  invariantRationalGroupLattice,
} from '../group-theory/matrix.js';
import { PermutationGroupValue } from '../group-theory/permutation/groups.js';
import {
  PermutationValue,
  PermutationAction,
} from '../group-theory/permutation/values.js';

// These predicates select a representation among already-decoded kernel values.
// Input validation belongs to the MathJSON readers, not to these dispatch checks.
const isPermutationValue = (x: Element): x is PermutationValue => 'images' in x;
const isMatrixValue = (x: Element): x is ExactMatrixValue => 'rows' in x;
const isPermutationGroup = (x: Descriptor): x is PermutationGroupValue =>
  !('field' in x);
const isMatrixGroup = (x: Descriptor): x is ExactMatrixGroup => 'field' in x;

/** Shared ceilings of the bounded finite, matrix, and coordinate algorithms. */
export interface FiniteGroupLimits {
  maxElements: number;
  maxWork: number;
  maxPoints: number;
}
export function finiteGroupLimits(
  input: Partial<FiniteGroupLimits> = {}
): FiniteGroupLimits {
  const limits = {
    maxElements: 256,
    maxWork: 50_000_000,
    maxPoints: 100_000,
    ...input,
  };
  for (const [key, ceiling] of Object.entries({
    maxElements: 256,
    maxWork: 50_000_000,
    maxPoints: 100_000,
  })) {
    const value = limits[key as keyof FiniteGroupLimits];
    if (
      !Number.isSafeInteger(value) ||
      value < (key === 'maxElements' ? 1 : 0) ||
      value > ceiling
    )
      throw new GroupInputError('invalid-group-option');
  }
  return limits;
}

/** Select a faithful vector action only when its point and storage bounds fit.
 * Otherwise a small closure can still determine the order, even in high degree.
 */
function fitsMatrixOrderAction(
  group: ExactMatrixGroup,
  maxPoints: number
): boolean {
  if (group.field.characteristic === 0) return false;
  const points = BigInt(group.field.characteristic) ** BigInt(group.dimension);
  return (
    points <= BigInt(maxPoints) &&
    points * BigInt(Math.max(group.dimension, group.generators.length)) <=
      1_000_000n
  );
}

type Element = PermutationValue | ExactMatrixValue;
type Descriptor = PermutationGroupValue | ExactMatrixGroup;
interface Model {
  table: FiniteGroupTable;
  elements: readonly Element[];
  indexOf: (x: Element) => number | undefined;
  descriptor: Descriptor;
}
class UnresolvedGroupOperand extends Error {}

/** Opt-in adapter. Expensive validation occurs on evaluation, never during boxing. */
export function exactGroupDefinitions(
  ce: IComputeEngine,
  ceilings: FiniteGroupLimits,
  bridge: {
    readPermutation: (x: Expression) => PermutationValue | undefined;
    readGroup: (x: Expression) => PermutationGroupValue | undefined;
    encodePermutation: (x: PermutationValue) => Expression;
    encodeGroup: (x: PermutationGroupValue) => Expression;
    queryPermutationRelation: (
      g: PermutationGroupValue,
      h: PermutationGroupValue,
      query: 'subgroup' | 'equal' | 'normal' | 'index',
      maxWork: number
    ) => boolean | bigint;
    queryPermutation: (
      g: PermutationGroupValue,
      kind: 'order' | 'contains' | 'abelian',
      maxWork: number,
      element?: PermutationValue
    ) => bigint | boolean;
  }
): Record<string, OperatorDefinition> {
  const defs: Record<string, OperatorDefinition> = {};
  const invalid = (message: string): never => {
    throw new GroupInputError(message);
  };
  const unresolved = (x: Expression): never => {
    if (isFunction(x, 'Error')) throw x;
    if (!x.isConstant) throw new UnresolvedGroupOperand();
    return invalid('incompatible-type');
  };
  const list = (x: Expression): readonly Expression[] =>
    isFunction(x, 'List') ? x.ops : unresolved(x);
  const integer = (x: Expression): number => {
    if (!isNumber(x)) return unresolved(x);
    if (x.isInteger !== true || !Number.isSafeInteger(x.re))
      return invalid('incompatible-type');
    return x.re;
  };
  const bigint = (x: Expression): bigint => {
    if (!isNumber(x)) return unresolved(x);
    if (x.isInteger !== true) return invalid('incompatible-type');
    const n = toBigint(x);
    return n ?? invalid('incompatible-type');
  };
  const coordinates = (
    value: Expression,
    length: number,
    work: GroupWork
  ): readonly Expression[] => {
    const result = list(value);
    if (result.length !== length)
      return invalid('invalid-pc-coordinate-length');
    work.tick(length);
    return result;
  };
  const bool = (x: boolean) => (x ? ce.True : ce.False);
  const numbers = (xs: readonly number[]) =>
    ce.function(
      'List',
      xs.map((x) => ce.number(x))
    );
  const expressions = (xs: readonly Expression[]) => ce.function('List', xs);
  // All optional settings lower loader ceilings; they never enter a value's identity.
  const requestedLimits = (
    value: Expression | undefined
  ): FiniteGroupLimits => {
    if (!value || isSymbol(value, 'Nothing')) return ceilings;
    if (isFunction(value, 'Error')) throw value;
    if (!isDictionary(value)) return unresolved(value);
    const limits = { ...ceilings };
    for (const key of value.keys) {
      if (!Object.hasOwn(limits, key)) return invalid('unknown-group-option');
      const bound = integer(value.get(key)!);
      if (
        bound < (key === 'maxElements' ? 1 : 0) ||
        bound > ceilings[key as keyof FiniteGroupLimits]
      )
        return invalid('group-option-exceeds-limit');
      limits[key as keyof FiniteGroupLimits] = bound;
    }
    return limits;
  };
  // A registered signature describes the mathematical operands. The common wrapper
  // adds named execution options and one ledger shared by all nested algorithms.
  const register = (
    name: string,
    signature: string,
    count: number,
    body: (
      ops: readonly Expression[],
      work: GroupWork,
      limits: FiniteGroupLimits
    ) => Expression | undefined
  ) => {
    defs[name] = {
      signature: signature.replace(
        ') ->',
        `${count ? ', ' : ''}options: dictionary<integer>?) ->`
      ),
      pure: true,
      evaluate: (ops) => {
        try {
          if (ops.length < count || ops.length > count + 1)
            return invalid(
              ops.length < count ? 'missing' : 'unexpected-argument'
            );
          const limits = requestedLimits(ops[count]);
          const work = new GroupWork(limits.maxWork, () =>
            checkDeadline(ce._deadlineFrame)
          );
          work.tick(0);
          return body(ops.slice(0, count), work, limits);
        } catch (error) {
          if (error instanceof UnresolvedGroupOperand) return undefined;
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
            [
              'GroupInputError',
              'GroupLimitError',
              'PermutationInputError',
              'PermutationClosureLimitError',
              'PermutationChainLimitError',
            ].includes(String(error.name))
          ) {
            return ce.error(
              'code' in error
                ? String(error.code)
                : String((error as Error).message)
            );
          }
          throw error;
        }
      },
    };
  };
  const readMatrix = (x: Expression, w: GroupWork): ExactMatrixValue => {
    if (!isFunction(x, 'GroupMatrix')) return unresolved(x);
    if (x.ops.length !== 2)
      return invalid(x.ops.length < 2 ? 'missing' : 'unexpected-argument');
    const F = new ExactMatrixField(integer(x.op1)),
      input = list(x.op2);
    if (input.length < 1 || input.length > 32)
      return invalid('invalid-matrix-dimension');
    const rows = input.map((row) => {
      const cells = list(row);
      if (cells.length !== input.length)
        return invalid('invalid-square-matrix');
      return cells.map((cell) => {
        w.tick();
        if (!isNumber(cell)) return unresolved(cell);
        if (!cell.isExact) return invalid('incompatible-type');
        const r = asRational(cell);
        if (!r) return invalid('incompatible-type');
        return { numerator: BigInt(r[0]), denominator: BigInt(r[1]) };
      });
    });
    return ExactMatrixValue.fromRows(F, rows, w);
  };
  const encodeMatrix = (x: ExactMatrixValue): Expression =>
    ce._fn('GroupMatrix', [
      ce.number(x.field.characteristic),
      expressions(
        x.rows.map((row) =>
          expressions(row.map((q) => ce.number([q.numerator, q.denominator])))
        )
      ),
    ]);
  const readMatrixGroup = (x: Expression, w: GroupWork): ExactMatrixGroup => {
    if (!isFunction(x, 'MatrixGroup')) return unresolved(x);
    if (x.ops.length !== 3)
      return invalid(x.ops.length < 3 ? 'missing' : 'unexpected-argument');
    const n = integer(x.ops[0]),
      F = new ExactMatrixField(integer(x.ops[1])),
      input = list(x.ops[2]);
    if (input.length > 256) return invalid('matrix-generator-limit');
    return new ExactMatrixGroup(
      F,
      n,
      input.map((m) => readMatrix(m, w)),
      w
    );
  };
  const encodeMatrixGroup = (g: ExactMatrixGroup): Expression =>
    ce._fn('MatrixGroup', [
      ce.number(g.dimension),
      ce.number(g.field.characteristic),
      expressions(g.generators.map(encodeMatrix)),
    ]);
  const encodeElement = (x: Element): Expression =>
    isPermutationValue(x) ? bridge.encodePermutation(x) : encodeMatrix(x);
  const encodeDescriptor = (g: Descriptor): Expression =>
    isPermutationGroup(g) ? bridge.encodeGroup(g) : encodeMatrixGroup(g);
  const readDescriptor = (x: Expression, w: GroupWork): Descriptor => {
    if (isFunction(x, 'PermutationGroup')) {
      const g = bridge.readGroup(x);
      if (!g) throw new UnresolvedGroupOperand();
      w.tick(
        1 +
          g.generators.reduce((sum, element) => sum + element.supportDegree, 0)
      );
      return g;
    }
    return readMatrixGroup(x, w);
  };
  const readElement = (x: Expression, g: Descriptor, w: GroupWork): Element => {
    if (isPermutationGroup(g)) {
      const p = bridge.readPermutation(x);
      if (!p) throw new UnresolvedGroupOperand();
      w.tick(Math.max(1, p.supportDegree));
      if (p.supportDegree > g.action.degree)
        return invalid('incompatible-permutation-action');
      return p;
    }
    const m = readMatrix(x, w);
    g.identity.compatible(m);
    return m;
  };
  const model = (g: Descriptor, max: number, w: GroupWork): Model => {
    if (isPermutationGroup(g)) {
      const m = finitePermutationModel(g, max, w);
      return {
        ...m,
        descriptor: g,
        indexOf: (x) =>
          isPermutationValue(x)
            ? m.indexOf(x)
            : invalid('incompatible-group-element'),
      };
    }
    const m = g.finiteModel(max, w);
    return {
      ...m,
      descriptor: g,
      indexOf: (x) =>
        isMatrixValue(x) ? m.indexOf(x) : invalid('incompatible-group-element'),
    };
  };
  const member = (x: Expression, m: Model, w: GroupWork): number =>
    m.indexOf(readElement(x, m.descriptor, w)) ??
    invalid('element-outside-group');
  const subgroup = (x: Expression, m: Model, w: GroupWork): FiniteSubgroup => {
    const g = readDescriptor(x, w);
    if (isPermutationGroup(g) !== isPermutationGroup(m.descriptor))
      return invalid('incompatible-group-domains');
    if (
      isPermutationGroup(g) &&
      isPermutationGroup(m.descriptor) &&
      g.action.degree !== m.descriptor.action.degree
    )
      return invalid('incompatible-permutation-action');
    if (isMatrixGroup(g) && isMatrixGroup(m.descriptor))
      m.descriptor.identity.compatible(g.identity);
    return m.table
      .session(w)
      .generated(
        g.generators.map((x) => m.indexOf(x) ?? invalid('not-a-subgroup'))
      );
  };
  const encodeSubgroup = (
    h: FiniteSubgroup,
    m: Model,
    w: GroupWork
  ): Expression => {
    const S = m.table.session(w),
      gens: number[] = [];
    let generated = S.trivial;
    for (const x of h.members) {
      w.tick();
      if (generated.has(x)) continue;
      gens.push(x);
      generated = S.generated(gens);
    }
    const g = m.descriptor;
    return encodeDescriptor(
      isPermutationGroup(g)
        ? new PermutationGroupValue(
            gens.map((x) => m.elements[x] as PermutationValue),
            g.action,
            { check: () => w.tick() }
          )
        : new ExactMatrixGroup(
            g.field,
            g.dimension,
            gens.map((x) => m.elements[x] as ExactMatrixValue),
            w
          )
    );
  };
  // The result types distinguish elements, subgroups, and optional answers.
  // Algorithms below share decoding and a small-group model, not an untyped API.
  interface MapModel {
    source: Model;
    target: Model;
    mapping: FiniteGroupHomomorphism;
  }
  // Complete element/image pairs survive changes in enumeration order. Count
  // their expanded serialization before rendering: shared boxed objects reduce
  // live allocations, but MathJSON serialization repeats each occurrence.
  // Homomorphism payloads may emit at most 1,000,000 storage units per query. Large
  // rational scalars count once per eight decimal characters, so large exact
  // coefficients cannot evade the bound. This is an output bound, not a limit
  // on the number of automorphisms the kernel can compute.
  const maximumMapOutputUnits = 1_000_000;
  const encodeMaps = (
    maps: readonly MapModel[],
    work: GroupWork
  ): Expression[] => {
    const elementUnits = new Map<Element, number>();
    const modelUnits = new Map<Model, number>();
    const unitsOfElement = (element: Element): number => {
      const known = elementUnits.get(element);
      if (known !== undefined) return known;
      work.tick();
      let units: number;
      if (isPermutationValue(element)) units = 2 + element.supportDegree;
      else {
        units = 3 + element.dimension;
        for (const row of element.rows)
          for (const coefficient of row) {
            work.tick();
            units += Math.max(
              1,
              Math.ceil(coefficient.numerator.toString().length / 8)
            );
            if (coefficient.denominator !== 1n)
              units +=
                1 + Math.ceil(coefficient.denominator.toString().length / 8);
          }
      }
      elementUnits.set(element, units);
      return units;
    };
    const unitsOfModel = (model: Model): number => {
      const known = modelUnits.get(model);
      if (known !== undefined) return known;
      const units =
        4 +
        model.descriptor.generators.reduce(
          (sum, generator) => sum + unitsOfElement(generator),
          0
        );
      modelUnits.set(model, units);
      return units;
    };
    let units = 1;
    // Complete this pass for the whole result list before allocating any map
    // expressions. In particular, a failed automorphism list has no rendered prefix.
    for (const { source, target, mapping } of maps) {
      units += 2 + unitsOfModel(source) + unitsOfModel(target);
      for (let i = 0; i < source.elements.length; i++) {
        work.tick();
        units +=
          1 +
          unitsOfElement(source.elements[i]) +
          unitsOfElement(target.elements[mapping.images[i]]);
        if (units > maximumMapOutputUnits)
          throw new GroupLimitError('group-map-output-limit');
      }
      if (units > maximumMapOutputUnits)
        throw new GroupLimitError('group-map-output-limit');
    }
    work.tick(units);
    const encoded = new Map<
      Model,
      { descriptor: Expression; elements: Map<number, Expression> }
    >();
    const renderedModel = (model: Model) => {
      let result = encoded.get(model);
      if (!result) {
        result = {
          descriptor: encodeDescriptor(model.descriptor),
          elements: new Map<number, Expression>(),
        };
        encoded.set(model, result);
      }
      return result;
    };
    const renderedElement = (model: Model, index: number): Expression => {
      const cache = renderedModel(model).elements;
      let result = cache.get(index);
      if (!result) {
        work.tick(0);
        result = encodeElement(model.elements[index]);
        cache.set(index, result);
      }
      return result;
    };
    return maps.map(({ source, target, mapping }) => {
      work.tick(0);
      const from = renderedModel(source),
        to = renderedModel(target);
      return ce._fn('GroupHomomorphism', [
        from.descriptor,
        to.descriptor,
        expressions(
          source.elements.map((_, index) =>
            ce.function('Tuple', [
              renderedElement(source, index),
              renderedElement(target, mapping.images[index]),
            ])
          )
        ),
      ]);
    });
  };
  const encodeMap = (map: MapModel, work: GroupWork): Expression =>
    encodeMaps([map], work)[0];
  const readMap = (
    value: Expression,
    work: GroupWork,
    limits: FiniteGroupLimits
  ): MapModel => {
    if (!isFunction(value, 'GroupHomomorphism')) return unresolved(value);
    if (value.ops.length !== 3) return invalid('unexpected-argument');
    const source = model(
      readDescriptor(value.op1, work),
      limits.maxElements,
      work
    );
    const target = model(
      readDescriptor(value.op2, work),
      limits.maxElements,
      work
    );
    const pairs = list(value.ops[2]);
    if (pairs.length !== source.table.order)
      return invalid('invalid-group-homomorphism');
    const images = Array<number>(source.table.order).fill(-1);
    for (const pair of pairs) {
      if (!isFunction(pair, 'Tuple') || pair.ops.length !== 2)
        return unresolved(pair);
      const index = member(pair.op1, source, work);
      if (images[index] !== -1) return invalid('duplicate-homomorphism-source');
      images[index] = member(pair.op2, target, work);
    }
    return {
      source,
      target,
      mapping: FiniteGroupHomomorphism.fromImages(
        source.table,
        target.table,
        images,
        work
      ),
    };
  };
  // A fresh decode yields a fresh table object. Match exact elements and ambient
  // domains before relating indices; equal table sizes alone do not identify groups.
  const correspondence = (
    left: Model,
    right: Model,
    work: GroupWork
  ): number[] => {
    const a = left.descriptor,
      b = right.descriptor;
    if (isPermutationGroup(a) && isPermutationGroup(b)) {
      if (a.action.degree !== b.action.degree)
        return invalid('incompatible-group-domains');
    } else if (isMatrixGroup(a) && isMatrixGroup(b))
      a.identity.compatible(b.identity);
    else return invalid('incompatible-group-domains');
    if (left.elements.length !== right.elements.length)
      return invalid('incompatible-homomorphism-domains');
    return left.elements.map((x) => {
      work.tick();
      return right.indexOf(x) ?? invalid('incompatible-homomorphism-domains');
    });
  };
  // The projection is onto its declared target, and its kernel must equal the
  // declared denominator. This makes a quotient a checked construction, not a tuple.
  const readQuotient = (
    value: Expression,
    work: GroupWork,
    limits: FiniteGroupLimits
  ) => {
    if (!isFunction(value, 'GroupQuotientValue')) return unresolved(value);
    if (value.ops.length !== 3) return invalid('unexpected-argument');
    const map = readMap(value.ops[2], work, limits);
    const source = model(
      readDescriptor(value.op1, work),
      limits.maxElements,
      work
    );
    correspondence(source, map.source, work);
    const denominator = subgroup(value.op2, map.source, work);
    const kernel = map.mapping.kernel(work);
    if (
      denominator.order !== kernel.order ||
      denominator.members.some((x) => !kernel.has(x)) ||
      map.mapping.image(work).order !== map.target.table.order
    )
      return invalid('invalid-group-quotient-projection');
    return { map, denominator };
  };
  register(
    'GroupHomomorphism',
    '(GroupDescriptor, GroupDescriptor, list<tuple<GroupElement, GroupElement>>) -> GroupHomomorphism',
    3,
    (ops, work, limits) =>
      encodeMap(readMap(ce._fn('GroupHomomorphism', ops), work, limits), work)
  );
  register(
    'GroupHomomorphismByImages',
    '(GroupDescriptor, GroupDescriptor, list<GroupElement>, list<GroupElement>) -> GroupHomomorphism',
    4,
    (ops, work, limits) => {
      const source = model(
        readDescriptor(ops[0], work),
        limits.maxElements,
        work
      );
      const target = model(
        readDescriptor(ops[1], work),
        limits.maxElements,
        work
      );
      const generators = list(ops[2]),
        images = list(ops[3]);
      if (generators.length !== images.length || generators.length > 256)
        return invalid('invalid-group-homomorphism');
      const mapping = FiniteGroupHomomorphism.fromGeneratorImages(
        source.table,
        target.table,
        generators.map((x) => {
          work.tick();
          return member(x, source, work);
        }),
        images.map((x) => {
          work.tick();
          return member(x, target, work);
        }),
        work
      );
      if (!mapping) return invalid('map-is-not-a-group-homomorphism');
      return encodeMap({ source, target, mapping }, work);
    }
  );
  register(
    'GroupHomomorphismApply',
    '(GroupHomomorphism, GroupElement) -> GroupElement',
    2,
    (ops, work, limits) => {
      const map = readMap(ops[0], work, limits);
      return encodeElement(
        map.target.elements[map.mapping.apply(member(ops[1], map.source, work))]
      );
    }
  );
  for (const name of [
    'GroupHomomorphismSource',
    'GroupHomomorphismTarget',
    'GroupHomomorphismKernel',
    'GroupHomomorphismImage',
  ])
    register(
      name,
      '(GroupHomomorphism) -> GroupDescriptor',
      1,
      (ops, work, limits) => {
        const map = readMap(ops[0], work, limits);
        if (name === 'GroupHomomorphismSource')
          return encodeDescriptor(map.source.descriptor);
        if (name === 'GroupHomomorphismTarget')
          return encodeDescriptor(map.target.descriptor);
        return name === 'GroupHomomorphismKernel'
          ? encodeSubgroup(map.mapping.kernel(work), map.source, work)
          : encodeSubgroup(map.mapping.image(work), map.target, work);
      }
    );
  register(
    'GroupHomomorphismPreimage',
    '(GroupHomomorphism, GroupDescriptor) -> GroupDescriptor',
    2,
    (ops, work, limits) => {
      const map = readMap(ops[0], work, limits),
        target = subgroup(ops[1], map.target, work);
      return encodeSubgroup(
        map.source.table
          .session(work)
          .generated(
            map.mapping.images.flatMap((image, index) =>
              target.has(image) ? [index] : []
            )
          ),
        map.source,
        work
      );
    }
  );
  register(
    'GroupHomomorphismInverse',
    '(GroupHomomorphism) -> GroupHomomorphism',
    1,
    (ops, work, limits) => {
      const map = readMap(ops[0], work, limits);
      return encodeMap(
        {
          source: map.target,
          target: map.source,
          mapping: map.mapping.inverse(work),
        },
        work
      );
    }
  );
  register(
    'GroupHomomorphismCompose',
    '(GroupHomomorphism, GroupHomomorphism) -> GroupHomomorphism',
    2,
    (ops, work, limits) => {
      const first = readMap(ops[0], work, limits),
        second = readMap(ops[1], work, limits);
      const indices = correspondence(first.target, second.source, work);
      const mapping = FiniteGroupHomomorphism.fromImages(
        first.source.table,
        second.target.table,
        first.mapping.images.map((x) => second.mapping.images[indices[x]]),
        work
      );
      return encodeMap(
        {
          source: first.source,
          target: second.target,
          mapping,
        },
        work
      );
    }
  );
  register(
    'GroupQuotientValue',
    '(GroupDescriptor, GroupDescriptor, GroupHomomorphism) -> GroupQuotientValue',
    3,
    (ops, work, limits) => {
      const value = ce._fn('GroupQuotientValue', ops);
      readQuotient(value, work, limits);
      return value;
    }
  );
  register(
    'GroupQuotientProjection',
    '(GroupQuotientValue) -> GroupHomomorphism',
    1,
    (ops, work, limits) =>
      encodeMap(readQuotient(ops[0], work, limits).map, work)
  );
  register(
    'GroupQuotientGroup',
    '(GroupQuotientValue) -> GroupDescriptor',
    1,
    (ops, work, limits) =>
      encodeDescriptor(readQuotient(ops[0], work, limits).map.target.descriptor)
  );
  // Right multiplication gives a faithful action: the image of identity under
  // x is x itself. Preserve table order so a verified quotient projection can
  // reuse its indices. Construction costs O(n²) table lookups and image storage.
  const regularModel = (
    table: FiniteGroupTable,
    work: GroupWork
  ): Model & { descriptor: PermutationGroupValue } => {
    const elements = Array.from({ length: table.order }, (_, x) =>
      PermutationValue.fromImages(
        Array.from(
          { length: table.order },
          (_, i) => table.product(i, x, work) + 1
        ),
        { check: () => work.tick() }
      )
    );
    const indices = new Map(
      elements.map((element, index) => [element.images.join(','), index])
    );
    const descriptor = new PermutationGroupValue(
      table.session(work).whole.generators.map((index) => elements[index]),
      new PermutationAction(table.order),
      { check: () => work.tick() }
    );
    return {
      table,
      elements,
      descriptor,
      indexOf: (element) => {
        if (!isPermutationValue(element)) return undefined;
        work.tick(element.supportDegree + 1);
        return indices.get(element.images.join(','));
      },
    };
  };
  // An arbitrary multiplication table is checked cubically before its regular
  // permutation action is exposed. Table index zero denotes the identity.
  register(
    'GroupFromTable',
    '(list<list<integer>>) -> PermutationGroup',
    1,
    (ops, work, limits) => {
      const rows = list(ops[0]);
      if (rows.length > limits.maxElements)
        return invalid('finite-group-element-limit');
      const table = FiniteGroupTable.fromTable(
        rows.map((row) => {
          const cells = list(row);
          if (cells.length !== rows.length)
            return invalid('invalid-group-table-entry');
          return cells.map((cell) => {
            work.tick();
            return integer(cell);
          });
        }),
        work
      );
      return bridge.encodeGroup(regularModel(table, work).descriptor);
    }
  );

  register(
    'GroupGenerators',
    '(GroupDescriptor) -> list<GroupElement>',
    1,
    (ops, work) =>
      expressions(readDescriptor(ops[0], work).generators.map(encodeElement))
  );
  register(
    'GroupIdentity',
    '(GroupDescriptor) -> GroupElement',
    1,
    (ops, work) => {
      const group = readDescriptor(ops[0], work);
      return isPermutationGroup(group)
        ? bridge.encodePermutation(PermutationValue.fromImages([]))
        : encodeMatrix(group.identity);
    }
  );
  register(
    'GroupElements',
    '(GroupDescriptor) -> list<GroupElement>',
    1,
    (ops, work, limits) =>
      expressions(
        model(
          readDescriptor(ops[0], work),
          limits.maxElements,
          work
        ).elements.map(encodeElement)
      )
  );
  register(
    'GroupAutomorphisms',
    '(GroupDescriptor) -> list<GroupHomomorphism>',
    1,
    (ops, work, limits) => {
      const source = model(
        readDescriptor(ops[0], work),
        limits.maxElements,
        work
      );
      const mappings = finiteAutomorphisms(source.table.session(work));
      return expressions(
        encodeMaps(
          mappings.map((mapping) => ({ source, target: source, mapping })),
          work
        )
      );
    }
  );
  register(
    'GroupHomomorphismImageOf',
    '(GroupHomomorphism, GroupDescriptor) -> GroupDescriptor',
    2,
    (ops, work, limits) => {
      const map = readMap(ops[0], work, limits);
      return encodeSubgroup(
        map.mapping.imageOf(subgroup(ops[1], map.source, work), work),
        map.target,
        work
      );
    }
  );
  register(
    'GroupHomomorphismPreimages',
    '(GroupHomomorphism, GroupElement) -> list<GroupElement>',
    2,
    (ops, work, limits) => {
      const map = readMap(ops[0], work, limits),
        image = member(ops[1], map.target, work);
      return expressions(
        map.mapping.images.flatMap((x, index) => {
          work.tick();
          return x === image ? [encodeElement(map.source.elements[index])] : [];
        })
      );
    }
  );
  // A lift chooses one source element; it is a section, with no multiplicativity claim.
  register(
    'GroupQuotientLift',
    '(GroupQuotientValue, GroupElement) -> GroupElement',
    2,
    (ops, work, limits) => {
      const { map } = readQuotient(ops[0], work, limits),
        image = member(ops[1], map.target, work);
      return encodeElement(
        map.source.elements[map.mapping.images.indexOf(image)]
      );
    }
  );
  const groupOps: Record<string, readonly [string, string]> = {
    GroupAbelianInvariants: ['', 'list<integer>'],
    GroupMinimalGenerators: ['', 'list<GroupElement>'],
    GroupIndependentAbelianGenerators: ['', 'list<GroupElement>'],
    GroupEulerianFunction: ['integer', 'integer'],
    GroupCommutatorLength: ['GroupElement', 'integer | nothing'],
    GroupSubgroupConjugacyClasses: ['', 'list<list<GroupDescriptor>>'],
    GroupOrder: ['', 'integer'],
    GroupIsAbelian: ['', 'boolean'],
    GroupContains: ['GroupElement', 'boolean'],
    GroupIsSubgroup: ['GroupDescriptor', 'boolean'],
    GroupEqual: ['GroupDescriptor', 'boolean'],
    GroupIsNormal: ['GroupDescriptor', 'boolean'],
    GroupIndex: ['GroupDescriptor', 'integer'],
    GroupIsConjugate: ['GroupElement, GroupElement', 'boolean'],
    GroupQuotient: ['GroupDescriptor', 'GroupQuotientValue'],
    GroupCenter: ['', 'GroupDescriptor'],
    GroupDerivedSubgroup: ['', 'GroupDescriptor'],
    GroupFrattiniSubgroup: ['', 'GroupDescriptor'],
    GroupFittingSubgroup: ['', 'GroupDescriptor'],
    GroupSolvableRadical: ['', 'GroupDescriptor'],
    GroupSocle: ['', 'GroupDescriptor'],
    GroupIsCyclic: ['', 'boolean'],
    GroupIsSolvable: ['', 'boolean'],
    GroupIsNilpotent: ['', 'boolean'],
    GroupIsPerfect: ['', 'boolean'],
    GroupIsSimple: ['', 'boolean'],
    GroupIsElementaryAbelian: ['', 'boolean'],
    GroupIsPGroup: ['', 'boolean'],
    GroupIsSupersolvable: ['', 'boolean'],
    GroupExponent: ['', 'integer'],
    GroupNilpotencyClass: ['', 'integer | nothing'],
    GroupPrime: ['', 'integer | nothing'],
    GroupConjugacyClasses: ['', 'list<list<GroupElement>>'],
    GroupRationalClasses: ['', 'list<list<GroupElement>>'],
    GroupSubgroups: ['', 'list<GroupDescriptor>'],
    GroupNormalSubgroups: ['', 'list<GroupDescriptor>'],
    GroupMaximalSubgroups: ['', 'list<GroupDescriptor>'],
    GroupDerivedSeries: ['', 'list<GroupDescriptor>'],
    GroupLowerCentralSeries: ['', 'list<GroupDescriptor>'],
    GroupUpperCentralSeries: ['', 'list<GroupDescriptor>'],
    GroupCompositionSeries: ['', 'list<GroupDescriptor>'],
    GroupChiefSeries: ['', 'list<GroupDescriptor>'],
    GroupCentralizer: ['GroupDescriptor', 'GroupDescriptor'],
    GroupNormalizer: ['GroupDescriptor', 'GroupDescriptor'],
    GroupNormalClosure: ['GroupDescriptor', 'GroupDescriptor'],
    GroupCore: ['GroupDescriptor', 'GroupDescriptor'],
    GroupCommutatorSubgroup: ['GroupDescriptor', 'GroupDescriptor'],
    GroupIntersection: ['GroupDescriptor', 'GroupDescriptor'],
    GroupJoin: ['GroupDescriptor', 'GroupDescriptor'],
    GroupIsSubnormal: ['GroupDescriptor', 'boolean'],
    GroupIsCharacteristic: ['GroupDescriptor', 'boolean'],
    GroupRightCosets: ['GroupDescriptor', 'list<list<GroupElement>>'],
    GroupRightTransversal: ['GroupDescriptor', 'list<GroupElement>'],
    GroupComplementRepresentatives: [
      'GroupDescriptor',
      'list<GroupDescriptor>',
    ],
    GroupSylowSubgroup: ['integer', 'GroupDescriptor'],
    GroupPCore: ['integer', 'GroupDescriptor'],
    GroupHallSubgroups: ['list<integer>', 'list<GroupDescriptor>'],
    GroupPCentralSeries: ['integer', 'list<GroupDescriptor>'],
    GroupFactorization: ['GroupElement', 'list<integer> | nothing'],
    GroupDoubleCosets: [
      'GroupDescriptor, GroupDescriptor',
      'list<list<GroupElement>>',
    ],
    GroupNthRoots: ['GroupElement, integer', 'list<GroupElement>'],
    GroupOmega: ['integer, integer', 'GroupDescriptor'],
    GroupAgemo: ['integer, integer', 'GroupDescriptor'],
  };
  for (const [name, [parameters, result]] of Object.entries(groupOps))
    register(
      name,
      `(GroupDescriptor${parameters ? ', ' + parameters : ''}) -> ${result}`,
      1 + (parameters ? parameters.split(',').length : 0),
      (ops, w, limits) => {
        const original = readDescriptor(ops[0], w);
        const maxElements = limits.maxElements;
        if (maxElements < 1 || maxElements > 256)
          return invalid('invalid-finite-group-element-limit');
        if (
          isPermutationGroup(original) &&
          ['GroupOrder', 'GroupContains', 'GroupIsAbelian'].includes(name)
        ) {
          const element =
            name === 'GroupContains'
              ? (readElement(ops[1], original, w) as PermutationValue)
              : undefined;
          const answer = bridge.queryPermutation(
            original,
            name === 'GroupOrder'
              ? 'order'
              : name === 'GroupContains'
                ? 'contains'
                : 'abelian',
            w.limit - w.used,
            element
          );
          return typeof answer === 'bigint' ? ce.number(answer) : bool(answer);
        }
        if (
          isPermutationGroup(original) &&
          [
            'GroupIsSubgroup',
            'GroupEqual',
            'GroupIsNormal',
            'GroupIndex',
          ].includes(name)
        ) {
          const other = readDescriptor(ops[1], w);
          if (!isPermutationGroup(other))
            return invalid('incompatible-group-domains');
          const answer = bridge.queryPermutationRelation(
            original,
            other,
            name === 'GroupIsSubgroup'
              ? 'subgroup'
              : name === 'GroupEqual'
                ? 'equal'
                : name === 'GroupIsNormal'
                  ? 'normal'
                  : 'index',
            w.limit - w.used
          );
          return typeof answer === 'bigint' ? ce.number(answer) : bool(answer);
        }
        if (name === 'GroupIsAbelian' && isMatrixGroup(original)) {
          for (let i = 0; i < original.generators.length; i++)
            for (let j = i + 1; j < original.generators.length; j++) {
              const a = original.generators[i],
                b = original.generators[j];
              if (a.multiply(b, w).key(w) !== b.multiply(a, w).key(w))
                return ce.False;
            }
          return ce.True;
        }
        if (
          name === 'GroupOrder' &&
          isMatrixGroup(original) &&
          fitsMatrixOrderAction(original, limits.maxPoints)
        )
          return ce.number(
            primeFieldMatrixGroupOrder(original, limits.maxPoints, w)
          );
        let ambient = original;
        if (
          [
            'GroupJoin',
            'GroupIntersection',
            'GroupCommutatorSubgroup',
            'GroupCentralizer',
            'GroupNormalizer',
          ].includes(name)
        ) {
          const other = readDescriptor(ops[1], w);
          if (isPermutationGroup(original) && isPermutationGroup(other)) {
            if (original.action.degree !== other.action.degree)
              return invalid('incompatible-permutation-action');
            ambient = new PermutationGroupValue(
              [...original.generators, ...other.generators],
              original.action,
              { check: () => w.tick() }
            );
          } else if (isMatrixGroup(original) && isMatrixGroup(other)) {
            original.identity.compatible(other.identity);
            ambient = new ExactMatrixGroup(
              original.field,
              original.dimension,
              [...original.generators, ...other.generators],
              w
            );
          } else return invalid('incompatible-group-domains');
        }
        const m = model(ambient, limits.maxElements, w),
          s = m.table.session(w);
        const g = ambient === original ? s.whole : subgroup(ops[0], m, w);
        const sub = (h: FiniteSubgroup) => encodeSubgroup(h, m, w),
          subs = (hs: readonly FiniteSubgroup[]) => expressions(hs.map(sub));
        const elts = (xs: readonly number[]) =>
          expressions(xs.map((x) => encodeElement(m.elements[x])));
        const sets = (xs: readonly (readonly number[])[]) =>
          expressions(xs.map(elts));
        switch (name) {
          case 'GroupAbelianInvariants':
            return numbers(finiteAbelianInvariants(s));
          case 'GroupMinimalGenerators':
            return elts(finiteMinimalGenerators(s));
          case 'GroupIndependentAbelianGenerators':
            return elts(finiteIndependentAbelianGenerators(s));
          case 'GroupEulerianFunction':
            return ce.number(finiteEulerianFunction(s, integer(ops[1])));
          case 'GroupCommutatorLength': {
            const length = finiteCommutatorLength(s, member(ops[1], m, w));
            return length === undefined ? ce.Nothing : ce.number(length);
          }
          case 'GroupSubgroupConjugacyClasses':
            return expressions(finiteSubgroupConjugacyClasses(s).map(subs));
          case 'GroupOrder':
            return ce.number(g.order);
          case 'GroupIsAbelian':
            return bool(s.isAbelian(g));
          case 'GroupContains':
            return bool(
              m.indexOf(readElement(ops[1], m.descriptor, w)) !== undefined
            );
          case 'GroupIsSubgroup':
          case 'GroupEqual':
          case 'GroupIsNormal':
          case 'GroupIsSubnormal':
          case 'GroupIsCharacteristic': {
            const h = readDescriptor(ops[1], w);
            if (isPermutationGroup(h) && isPermutationGroup(m.descriptor)) {
              if (h.action.degree !== m.descriptor.action.degree)
                return invalid('incompatible-permutation-action');
            } else if (isMatrixGroup(h) && isMatrixGroup(m.descriptor))
              m.descriptor.identity.compatible(h.identity);
            else return invalid('incompatible-group-domains');
            const indices = h.generators.map((x) => m.indexOf(x));
            if (indices.some((x) => x === undefined)) return ce.False;
            if (name === 'GroupIsSubgroup') return ce.True;
            const candidate = s.generated(indices as number[]);
            if (name === 'GroupIsNormal') return bool(s.isNormal(g, candidate));
            if (name === 'GroupIsSubnormal')
              return bool(s.isSubnormal(g, candidate));
            if (name === 'GroupIsCharacteristic')
              return bool(finiteIsCharacteristic(s, candidate));
            return bool(candidate.order === g.order);
          }
          case 'GroupIsConjugate': {
            const a = member(ops[1], m, w),
              b = member(ops[2], m, w);
            return bool(g.members.some((x) => s.conjugate(a, x) === b));
          }
          case 'GroupCenter':
            return sub(s.center());
          case 'GroupDerivedSubgroup':
            return sub(s.derived());
          case 'GroupFrattiniSubgroup':
            return sub(s.frattini());
          case 'GroupFittingSubgroup':
            return sub(s.radical(g, 'fitting'));
          case 'GroupSolvableRadical':
            return sub(s.radical());
          case 'GroupSocle':
            return sub(s.radical(g, 'socle'));
          case 'GroupIsCyclic':
            return bool(s.isCyclic());
          case 'GroupIsSolvable':
            return bool(s.isSolvable());
          case 'GroupIsNilpotent':
            return bool(s.isNilpotent());
          case 'GroupIsPerfect':
            return bool(s.derived().order === g.order);
          case 'GroupIsSimple':
            return bool(s.isSimple());
          case 'GroupIsElementaryAbelian':
            return bool(finiteGroupIsElementaryAbelian(s));
          case 'GroupIsPGroup':
            return bool(g.order === 1 || finiteGroupPrime(s) !== undefined);
          case 'GroupIsSupersolvable':
            return bool(finiteGroupSeries(s, 'supersolvable') !== undefined);
          case 'GroupExponent':
            return ce.number(finiteGroupExponent(s));
          case 'GroupPrime': {
            const p = finiteGroupPrime(s);
            return p === undefined ? ce.Nothing : ce.number(p);
          }
          case 'GroupNilpotencyClass': {
            const series = s.series('lower-central');
            return series.at(-1)!.order === 1
              ? ce.number(series.length - 1)
              : ce.Nothing;
          }
          case 'GroupConjugacyClasses':
            return sets(s.conjugacyClasses());
          case 'GroupRationalClasses':
            return sets(finiteRationalClasses(s));
          case 'GroupSubgroups':
            return subs(s.subgroups());
          case 'GroupNormalSubgroups':
            return subs(s.normalSubgroups());
          case 'GroupMaximalSubgroups':
            return subs(s.maximalSubgroups());
          case 'GroupDerivedSeries':
            return subs(s.series('derived'));
          case 'GroupLowerCentralSeries':
            return subs(s.series('lower-central'));
          case 'GroupUpperCentralSeries':
            return subs(s.series('upper-central'));
          case 'GroupCompositionSeries':
            return subs(finiteGroupSeries(s, 'composition')!);
          case 'GroupChiefSeries':
            return subs(finiteGroupSeries(s, 'chief')!);
          case 'GroupSylowSubgroup':
            return sub(s.sylow(g, integer(ops[1])));
          case 'GroupPCore':
            return sub(s.pCore(g, integer(ops[1])));
          case 'GroupHallSubgroups':
            return subs(finiteHallSubgroups(s, g, list(ops[1]).map(integer)));
          case 'GroupPCentralSeries':
            return subs(finitePCentralSeries(s, g, integer(ops[1])));
          case 'GroupOmega':
            return sub(
              finitePowerSubgroup(
                s,
                g,
                integer(ops[1]),
                integer(ops[2]),
                'omega'
              )
            );
          case 'GroupAgemo':
            return sub(
              finitePowerSubgroup(
                s,
                g,
                integer(ops[1]),
                integer(ops[2]),
                'agemo'
              )
            );
          case 'GroupNthRoots':
            return elts(s.roots(g, member(ops[1], m, w), bigint(ops[2])));
          // Breadth-first traversal returns a shortest positive word in the
          // supplied generators. Letter positions are one-based; inverse letters
          // are not added to the alphabet.
          case 'GroupFactorization': {
            const gens = m.descriptor.generators.map((x) => m.indexOf(x)!),
              word = s.factorization(gens, member(ops[1], m, w));
            return word ? numbers(word) : ce.Nothing;
          }
        }
        const h = subgroup(ops[1], m, w);
        switch (name) {
          case 'GroupIndex':
            return ce.number(s.index(g, h));
          case 'GroupQuotient': {
            const q = s.quotient(g, h);
            const quotientModel = regularModel(q.group, w);
            const projection = encodeMap(
              {
                source: m,
                target: quotientModel,
                mapping: q.projectionMap,
              },
              w
            );
            return ce._fn('GroupQuotientValue', [
              encodeDescriptor(original),
              sub(h),
              projection,
            ]);
          }
          case 'GroupCentralizer':
            return sub(s.centralizer(g, h));
          case 'GroupNormalizer':
            return sub(s.normalizer(g, h));
          case 'GroupNormalClosure':
            return sub(s.normalClosure(g, h));
          case 'GroupCore':
            return sub(s.core(g, h));
          case 'GroupCommutatorSubgroup':
            return sub(s.commutatorSubgroup(g, h));
          case 'GroupIntersection':
            return sub(s.intersection(g, h));
          case 'GroupJoin':
            return sub(s.closure(g, h));
          case 'GroupRightCosets':
            return sets(s.rightCosets(g, h));
          case 'GroupRightTransversal':
            return elts(s.rightCosets(g, h).map((c) => c[0]));
          case 'GroupComplementRepresentatives':
            return subs(finiteComplementRepresentatives(s, g, h));
          case 'GroupDoubleCosets':
            return sets(s.doubleCosets(g, h, subgroup(ops[2], m, w)));
        }
        return invalid('unknown-finite-group-query');
      }
    );
  register(
    'GroupMatrix',
    '(integer, list<list<rational>>) -> GroupMatrix',
    2,
    (ops, w) => encodeMatrix(readMatrix(ce._fn('GroupMatrix', ops), w))
  );
  register(
    'MatrixGroup',
    '(integer, integer, list<GroupMatrix>) -> MatrixGroup',
    3,
    (ops, w) =>
      encodeMatrixGroup(readMatrixGroup(ce._fn('MatrixGroup', ops), w))
  );
  register('MatrixGroupDimension', '(MatrixGroup) -> integer', 1, (ops, w) =>
    ce.number(readMatrixGroup(ops[0], w).dimension)
  );
  register(
    'MatrixGroupCharacteristic',
    '(MatrixGroup) -> integer',
    1,
    (ops, w) => ce.number(readMatrixGroup(ops[0], w).field.characteristic)
  );
  for (const name of [
    'MatrixGroupOrder',
    'MatrixGroupElements',
    'MatrixGroupPcgs',
  ])
    register(
      name,
      '(MatrixGroup) -> ' +
        (name === 'MatrixGroupElements'
          ? 'list<GroupMatrix>'
          : name === 'MatrixGroupPcgs'
            ? 'GroupPcSequence | nothing'
            : 'integer'),
      1,
      (ops, w, limits) => {
        const g = readMatrixGroup(ops[0], w),
          max = limits.maxElements;
        if (name === 'MatrixGroupElements')
          return expressions(g.enumerate(max, w).map(encodeMatrix));
        if (name === 'MatrixGroupOrder') {
          if (fitsMatrixOrderAction(g, limits.maxPoints))
            return ce.number(
              primeFieldMatrixGroupOrder(g, limits.maxPoints, w)
            );
          return ce.number(g.enumerate(max, w).length);
        }
        return computePc(g, max, w);
      }
    );
  for (const name of [
    'MatrixGroupTranspose',
    'MatrixGroupIsSubgroupSL',
    'MatrixGroupIsIntegral',
    'MatrixGroupInvariantBilinearForms',
  ])
    register(
      name,
      '(MatrixGroup) -> ' +
        (name === 'MatrixGroupTranspose'
          ? 'MatrixGroup'
          : name === 'MatrixGroupInvariantBilinearForms'
            ? 'list<GroupMatrix>'
            : 'boolean'),
      1,
      (ops, w) => {
        const g = readMatrixGroup(ops[0], w);
        if (name === 'MatrixGroupTranspose')
          return encodeMatrixGroup(g.transpose(w));
        if (name === 'MatrixGroupIsSubgroupSL') return bool(g.isSubgroupSL(w));
        if (name === 'MatrixGroupIsIntegral') return bool(g.isIntegral(w));
        return expressions(g.invariantBilinearForms(w).map(encodeMatrix));
      }
    );
  for (const name of ['MatrixGroupVectorAction', 'MatrixGroupProjectiveAction'])
    register(
      name,
      '(MatrixGroup) -> tuple<PermutationGroup, list<list<integer>>, boolean | nothing>',
      1,
      (ops, w, limits) => {
        const g = readMatrixGroup(ops[0], w),
          a = g.action(
            name === 'MatrixGroupProjectiveAction',
            limits.maxPoints,
            w
          );
        return ce.function('Tuple', [
          bridge.encodeGroup(a.group),
          expressions(
            a.points.map((v) => {
              // Account for the returned coordinates and check cancellation
              // between points while constructing a potentially large action.
              w.tick(v.length + 1);
              return expressions(v.map((q) => ce.number(q.numerator)));
            })
          ),
          a.faithful === undefined ? ce.Nothing : bool(a.faithful),
        ]);
      }
    );
  for (const name of ['GeneralLinearGroup', 'SpecialLinearGroup'])
    register(name, '(integer, integer) -> MatrixGroup', 2, (ops, w) =>
      encodeMatrixGroup(
        naturalLinearGroup(
          integer(ops[0]),
          integer(ops[1]),
          name === 'SpecialLinearGroup',
          w
        )
      )
    );
  for (const name of [
    'GroupMatrixMultiply',
    'GroupMatrixInverse',
    'GroupMatrixTranspose',
    'GroupMatrixPower',
    'GroupMatrixDeterminant',
  ]) {
    const two = name === 'GroupMatrixMultiply' || name === 'GroupMatrixPower';
    register(
      name,
      `(GroupMatrix${two ? ', ' + (name === 'GroupMatrixMultiply' ? 'GroupMatrix' : 'integer') : ''}) -> ${name === 'GroupMatrixDeterminant' ? 'rational' : 'GroupMatrix'}`,
      two ? 2 : 1,
      (ops, w) => {
        const a = readMatrix(ops[0], w);
        if (name === 'GroupMatrixDeterminant') {
          const d = a.determinant(w);
          return ce.number([d.numerator, d.denominator]);
        }
        return encodeMatrix(
          name === 'GroupMatrixMultiply'
            ? a.multiply(readMatrix(ops[1], w), w)
            : name === 'GroupMatrixInverse'
              ? a.inverse(w)
              : name === 'GroupMatrixTranspose'
                ? a.transpose(w)
                : a.power(bigint(ops[1]), w)
        );
      }
    );
  }
  const encodePc = (pc: FinitePcgs, m: Model): Expression =>
    ce._fn('GroupPcSequence', [
      encodeDescriptor(m.descriptor),
      expressions(pc.sequence.map((x) => encodeElement(m.elements[x]))),
    ]);
  const computePc = (g: Descriptor, max: number, w: GroupWork): Expression => {
    const m = model(g, max, w),
      pc = FinitePcgs.compute(m.table, w);
    return pc ? encodePc(pc, m) : ce.Nothing;
  };
  const readPc = (x: Expression, w: GroupWork, max: number) => {
    if (!isFunction(x, 'GroupPcSequence')) return unresolved(x);
    if (x.ops.length !== 2) return invalid('unexpected-argument');
    const m = model(readDescriptor(x.ops[0], w), max, w),
      input = list(x.ops[1]);
    if (input.length > 256) return invalid('pc-sequence-length-limit');
    const pc = FinitePcgs.fromSequence(
      m.table,
      input.map((x) => member(x, m, w)),
      w
    );
    // Public sequences represent strict cyclic factors. Quotient kernels may
    // retain relative-order-one coordinates internally to preserve their indexing.
    if (pc.relativeOrders.some((order) => order <= 1))
      return invalid('redundant-pc-generator');
    return { pc, m };
  };
  register(
    'GroupPcgs',
    '(GroupDescriptor) -> GroupPcSequence | nothing',
    1,
    (ops, w, limits) => {
      return computePc(readDescriptor(ops[0], w), limits.maxElements, w);
    }
  );
  register(
    'GroupPcSequence',
    '(GroupDescriptor, list<GroupElement>) -> GroupPcSequence',
    2,
    (ops, w, limits) => {
      const { pc, m } = readPc(
        ce._fn('GroupPcSequence', ops),
        w,
        limits.maxElements
      );
      return encodePc(pc, m);
    }
  );
  // Coordinate positions are preserved by conversion; only the computational
  // representation changes from enumerated elements to checked cyclic relations.
  register(
    'GroupPcPresentation',
    '(GroupPcSequence) -> PcGroup',
    1,
    (ops, work, limits) => {
      const { pc } = readPc(ops[0], work, limits.maxElements);
      return encodeCollectedPcGroup(ce, fromFinitePcgs(pc, work));
    }
  );
  const pcOps: Record<string, readonly [string, string]> = {
    GroupPcRelativeOrders: ['', 'list<integer>'],
    GroupPcSeries: ['', 'list<GroupDescriptor>'],
    GroupPcExponents: ['GroupElement', 'list<integer>'],
    GroupPcElement: ['list<integer>', 'GroupElement'],
    GroupPcLinearCombination: ['list<integer>', 'GroupElement'],
    GroupPcDepth: ['GroupElement', 'integer'],
    GroupPcLeadingExponent: ['GroupElement', 'integer'],
    GroupPcRelativeOrder: ['GroupElement', 'integer'],
    GroupPcHead: ['GroupElement, integer', 'GroupElement'],
    GroupPcReduced: ['GroupElement, GroupElement', 'GroupElement'],
    GroupPcRelativePowerExponents: ['integer', 'list<integer>'],
    GroupPcConjugateExponents: ['integer, integer', 'list<integer>'],
    GroupPcCommutatorExponents: ['integer, integer', 'list<integer>'],
    GroupInducedPcSequence: ['GroupDescriptor', 'GroupPcSequence'],
  };
  for (const [name, [parameters, result]] of Object.entries(pcOps))
    register(
      name,
      `(GroupPcSequence${parameters ? ', ' + parameters : ''}) -> ${result}`,
      1 + (parameters ? parameters.split(',').length : 0),
      (ops, w, limits) => {
        const { pc, m } = readPc(ops[0], w, limits.maxElements);
        if (name === 'GroupPcRelativeOrders') return numbers(pc.relativeOrders);
        if (name === 'GroupPcSeries')
          return expressions(pc.series.map((h) => encodeSubgroup(h, m, w)));
        if (name === 'GroupPcElement')
          return encodeElement(
            m.elements[
              pc.element(
                coordinates(ops[1], pc.sequence.length, w).map(integer),
                w
              )
            ]
          );
        if (name === 'GroupPcLinearCombination')
          return encodeElement(
            m.elements[
              pc.linearCombination(
                coordinates(ops[1], pc.sequence.length, w).map(bigint),
                w
              )
            ]
          );
        if (name === 'GroupInducedPcSequence')
          return encodePc(pc.induced(subgroup(ops[1], m, w), w), m);
        if (name === 'GroupPcRelativePowerExponents')
          return numbers(
            pc.specialExponents('power', integer(ops[1]), undefined, w)
          );
        if (
          name === 'GroupPcConjugateExponents' ||
          name === 'GroupPcCommutatorExponents'
        )
          return numbers(
            pc.specialExponents(
              name === 'GroupPcConjugateExponents' ? 'conjugate' : 'commutator',
              integer(ops[1]),
              integer(ops[2]),
              w
            )
          );
        const x = member(ops[1], m, w);
        if (name === 'GroupPcExponents') return numbers(pc.exponents(x, w));
        if (name === 'GroupPcDepth') return ce.number(pc.depth(x, w));
        if (name === 'GroupPcLeadingExponent')
          return ce.number(pc.leadingExponent(x, w));
        if (name === 'GroupPcRelativeOrder')
          return ce.number(pc.relativeOrder(x, w));
        if (name === 'GroupPcHead')
          return encodeElement(m.elements[pc.head(x, integer(ops[2]), w)]);
        return encodeElement(
          m.elements[pc.reduced(x, member(ops[2], m, w), w)]
        );
      }
    );

  for (const name of [
    'MatrixGroupIsNaturalGL',
    'MatrixGroupIsNaturalSL',
    'MatrixGroupOrderByAction',
    'MatrixGroupInvariantLattice',
  ])
    register(
      name,
      '(MatrixGroup) -> ' +
        (name === 'MatrixGroupInvariantLattice'
          ? 'GroupMatrix'
          : name === 'MatrixGroupOrderByAction'
            ? 'integer'
            : 'boolean'),
      1,
      (ops, w, limits) => {
        const g = readMatrixGroup(ops[0], w),
          limit =
            name === 'MatrixGroupInvariantLattice'
              ? limits.maxElements
              : limits.maxPoints;
        if (name === 'MatrixGroupInvariantLattice')
          return encodeMatrix(invariantRationalGroupLattice(g, limit, w));
        if (name === 'MatrixGroupOrderByAction')
          return ce.number(primeFieldMatrixGroupOrder(g, limit, w));
        return bool(
          isNaturalLinearGroup(g, name === 'MatrixGroupIsNaturalSL', limit, w)
        );
      }
    );
  register(
    'MatrixGroupInvariantQuadraticForms',
    '(MatrixGroup) -> list<GroupMatrix>',
    1,
    (ops, w) => {
      return expressions(
        readMatrixGroup(ops[0], w).invariantQuadraticForms(w).map(encodeMatrix)
      );
    }
  );
  // Sifting preserves the right coset Hx and detects membership by an identity
  // residue. It is not a canonical coset representative; canonical reduction
  // scans Hx for its least parent coordinate vector.
  for (const name of ['GroupPcSift', 'GroupPcCanonicalElement'])
    register(
      name,
      '(GroupPcSequence, GroupDescriptor, GroupElement) -> GroupElement',
      3,
      (ops, w, limits) => {
        const { pc, m } = readPc(ops[0], w, limits.maxElements),
          induced = pc.induced(subgroup(ops[1], m, w), w),
          x = member(ops[2], m, w);
        return encodeElement(
          m.elements[
            name === 'GroupPcSift'
              ? induced.sift(x, w)
              : induced.canonical(x, w)
          ]
        );
      }
    );
  register(
    'GroupPcgsBySeries',
    '(GroupDescriptor, list<GroupDescriptor>) -> tuple<GroupPcSequence, list<integer>> | nothing',
    2,
    (ops, w, limits) => {
      const max = limits.maxElements,
        m = model(readDescriptor(ops[0], w), max, w),
        input = list(ops[1]);
      if (input.length > 257) return invalid('pc-series-length-limit');
      const result = finitePcgsBySeries(
        input.map((x) => subgroup(x, m, w)),
        w
      );
      return result
        ? ce.function('Tuple', [
            encodePc(result.pcgs, m),
            numbers(result.boundaries),
          ])
        : ce.Nothing;
    }
  );
  for (const name of ['GroupPcOrbit', 'GroupPcStabilizer'])
    register(
      name,
      '(GroupPcSequence, integer) -> ' +
        (name === 'GroupPcStabilizer'
          ? 'GroupPcSequence'
          : 'tuple<list<integer>, list<GroupElement>, GroupPcSequence>'),
      2,
      (ops, w, limits) => {
        const { pc, m } = readPc(ops[0], w, limits.maxElements);
        if (!isPermutationGroup(m.descriptor))
          return invalid('pc-point-action-requires-permutation-group');
        const result = finitePcOrbitStabilizer(
            pc,
            m.elements as readonly PermutationValue[],
            m.descriptor.action,
            integer(ops[1]),
            w
          ),
          stabilizer = encodePc(result.stabilizer, m);
        return name === 'GroupPcStabilizer'
          ? stabilizer
          : ce.function('Tuple', [
              numbers(result.points),
              expressions(
                result.representatives.map((x) => encodeElement(m.elements[x]))
              ),
              stabilizer,
            ]);
      }
    );
  for (const name of [
    'GroupModuloPcRelativeOrders',
    'GroupModuloPcExponents',
    'GroupModuloPcElement',
    'GroupPcLinearAction',
    'GroupPcAffineAction',
  ]) {
    const extra =
      name === 'GroupModuloPcRelativeOrders'
        ? 0
        : name === 'GroupPcAffineAction'
          ? 2
          : 1;
    register(
      name,
      `(GroupPcSequence, GroupDescriptor, GroupDescriptor${extra ? ', ' + (name === 'GroupModuloPcElement' ? 'list<integer>' : Array(extra).fill('GroupElement').join(', ')) : ''}) -> ${name === 'GroupModuloPcRelativeOrders' || name === 'GroupModuloPcExponents' ? 'list<integer>' : name === 'GroupModuloPcElement' ? 'GroupElement' : 'GroupMatrix'}`,
      3 + extra,
      (ops, w, limits) => {
        const { pc, m } = readPc(ops[0], w, limits.maxElements),
          mod = new FiniteModuloPcgs(
            pc,
            subgroup(ops[1], m, w),
            subgroup(ops[2], m, w),
            w
          );
        if (name === 'GroupModuloPcRelativeOrders')
          return numbers(mod.pcgs.relativeOrders);
        if (name === 'GroupModuloPcElement')
          return encodeElement(
            m.elements[
              mod.element(
                coordinates(ops[3], mod.pcgs.sequence.length, w).map(integer),
                w
              )
            ]
          );
        const x = member(ops[3], m, w);
        if (name === 'GroupModuloPcExponents')
          return numbers(mod.exponents(x, w));
        return encodeMatrix(
          name === 'GroupPcLinearAction'
            ? mod.linearAction(x, w)
            : mod.affineAction(x, member(ops[4], m, w), w)
        );
      }
    );
  }
  return defs;
}
