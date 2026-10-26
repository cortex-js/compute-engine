import { PermutationChainLimitError } from '../group-theory/permutation/stabilizer-chain.js';
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
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { asRational, toBigint } from '../boxed-expression/numerics.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  GroupInputError,
  GroupLimitError,
  GroupWork,
  finitePermutationModel,
  type FiniteGroupTable,
  type FiniteSubgroup,
} from '../group-theory/finite-group.js';
import {
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
import {
  ExactMatrixField,
  ExactMatrixValue,
  ExactMatrixGroup,
  naturalLinearGroup,
  primeFieldMatrixGroupOrder,
  isNaturalLinearGroup,
  invariantRationalGroupLattice,
} from '../group-theory/matrix.js';
import {
  PermutationGroupValue,
  PermutationClosureLimitError,
} from '../group-theory/permutation/groups.js';
import {
  PermutationValue,
  PermutationAction,
  PermutationInputError,
} from '../group-theory/permutation/values.js';

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
    if (!x.isConstant) throw new UnresolvedGroupOperand();
    return invalid('invalid-group-operand');
  };
  const list = (x: Expression): readonly Expression[] =>
    isFunction(x, 'List') ? x.ops : unresolved(x);
  const integer = (x: Expression): number => {
    if (!isNumber(x)) return unresolved(x);
    if (x.isInteger !== true || !Number.isSafeInteger(x.re))
      return invalid('expected-safe-group-integer');
    return x.re;
  };
  const bigint = (x: Expression): bigint => {
    if (!isNumber(x)) return unresolved(x);
    if (x.isInteger !== true) return invalid('expected-group-integer');
    const n = toBigint(x);
    return n ?? invalid('expected-group-integer');
  };
  const bool = (x: boolean) => (x ? ce.True : ce.False);
  const numbers = (xs: readonly number[]) =>
    ce.function(
      'List',
      xs.map((x) => ce.number(x))
    );
  const expressions = (xs: readonly Expression[]) => ce.function('List', xs);
  const budget = (x: Expression) =>
    new GroupWork(integer(x), () => checkDeadline(ce._deadlineFrame));
  const register = (
    name: string,
    signature: string,
    count: number,
    body: (ops: readonly Expression[]) => Expression | undefined
  ) => {
    defs[name] = {
      signature,
      pure: true,
      evaluate: (ops) => {
        try {
          if (ops.length !== count) return invalid('invalid-group-arity');
          return body(ops);
        } catch (e) {
          if (e instanceof UnresolvedGroupOperand) return undefined;
          if (e instanceof GroupInputError || e instanceof GroupLimitError)
            return ce.error(e.message);
          if (
            e instanceof PermutationInputError ||
            e instanceof PermutationClosureLimitError ||
            e instanceof PermutationChainLimitError
          )
            return ce.error(e.code);
          throw e;
        }
      },
    };
  };
  const readMatrix = (x: Expression, w: GroupWork): ExactMatrixValue => {
    if (!isFunction(x, 'GroupMatrix')) return unresolved(x);
    if (x.ops.length !== 2) return invalid('invalid-matrix-arity');
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
        if (!cell.isExact)
          return invalid('expected-exact-rational-matrix-entry');
        const r = asRational(cell);
        if (!r) return invalid('expected-exact-rational-matrix-entry');
        return { numerator: BigInt(r[0]), denominator: BigInt(r[1]) };
      });
    });
    return new ExactMatrixValue(F, rows, w);
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
    if (x.ops.length !== 3) return invalid('invalid-matrix-group-arity');
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
    PermutationValue.is(x) ? bridge.encodePermutation(x) : encodeMatrix(x);
  const encodeDescriptor = (g: Descriptor): Expression =>
    PermutationGroupValue.is(g) ? bridge.encodeGroup(g) : encodeMatrixGroup(g);
  const readDescriptor = (x: Expression, w: GroupWork): Descriptor => {
    if (isFunction(x, 'PermutationGroup')) {
      const g = bridge.readGroup(x);
      if (!g) throw new UnresolvedGroupOperand();
      return g;
    }
    return readMatrixGroup(x, w);
  };
  const readElement = (x: Expression, g: Descriptor, w: GroupWork): Element => {
    if (PermutationGroupValue.is(g)) {
      const p = bridge.readPermutation(x);
      if (!p) throw new UnresolvedGroupOperand();
      if (p.supportDegree > g.action.degree)
        return invalid('incompatible-permutation-action');
      return p;
    }
    const m = readMatrix(x, w);
    g.identity.compatible(m);
    return m;
  };
  const model = (g: Descriptor, max: number, w: GroupWork): Model => {
    if (PermutationGroupValue.is(g)) {
      const m = finitePermutationModel(g, max, w);
      return {
        ...m,
        descriptor: g,
        indexOf: (x) =>
          PermutationValue.is(x)
            ? m.indexOf(x)
            : invalid('incompatible-group-element'),
      };
    }
    const m = g.finiteModel(max, w);
    return {
      ...m,
      descriptor: g,
      indexOf: (x) =>
        ExactMatrixValue.is(x)
          ? m.indexOf(x)
          : invalid('incompatible-group-element'),
    };
  };
  const member = (x: Expression, m: Model, w: GroupWork): number =>
    m.indexOf(readElement(x, m.descriptor, w)) ??
    invalid('element-outside-group');
  const subgroup = (x: Expression, m: Model, w: GroupWork): FiniteSubgroup => {
    const g = readDescriptor(x, w);
    if (PermutationGroupValue.is(g) !== PermutationGroupValue.is(m.descriptor))
      return invalid('incompatible-group-domains');
    if (
      PermutationGroupValue.is(g) &&
      PermutationGroupValue.is(m.descriptor) &&
      g.action.degree !== m.descriptor.action.degree
    )
      return invalid('incompatible-permutation-action');
    if (ExactMatrixGroup.is(g) && ExactMatrixGroup.is(m.descriptor))
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
      PermutationGroupValue.is(g)
        ? new PermutationGroupValue(
            gens.map((x) => m.elements[x]),
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
  const groupOps: Record<string, readonly [string, number]> = {
    GroupAbelianInvariants: ['list<integer>', 0],
    GroupMinimalGenerators: ['any', 0],
    GroupIndependentAbelianGenerators: ['any', 0],
    GroupEulerianFunction: ['integer', 1],
    GroupCommutatorLength: ['any', 1],
    GroupSubgroupConjugacyClasses: ['any', 0],
    GroupOrder: ['integer', 0],
    GroupIsAbelian: ['boolean', 0],
    GroupContains: ['boolean', 1],
    GroupIsSubgroup: ['boolean', 1],
    GroupEqual: ['boolean', 1],
    GroupIsNormal: ['boolean', 1],
    GroupIndex: ['integer', 1],
    GroupIsConjugate: ['boolean', 2],
    GroupQuotient: ['any', 1],
    GroupCenter: ['any', 0],
    GroupDerivedSubgroup: ['any', 0],
    GroupFrattiniSubgroup: ['any', 0],
    GroupFittingSubgroup: ['any', 0],
    GroupSolvableRadical: ['any', 0],
    GroupSocle: ['any', 0],
    GroupIsCyclic: ['boolean', 0],
    GroupIsSolvable: ['boolean', 0],
    GroupIsNilpotent: ['boolean', 0],
    GroupIsPerfect: ['boolean', 0],
    GroupIsSimple: ['boolean', 0],
    GroupIsElementaryAbelian: ['boolean', 0],
    GroupIsPGroup: ['boolean', 0],
    GroupIsSupersolvable: ['boolean', 0],
    GroupExponent: ['integer', 0],
    GroupNilpotencyClass: ['any', 0],
    GroupPrime: ['any', 0],
    GroupConjugacyClasses: ['any', 0],
    GroupRationalClasses: ['any', 0],
    GroupSubgroups: ['any', 0],
    GroupNormalSubgroups: ['any', 0],
    GroupMaximalSubgroups: ['any', 0],
    GroupDerivedSeries: ['any', 0],
    GroupLowerCentralSeries: ['any', 0],
    GroupUpperCentralSeries: ['any', 0],
    GroupCompositionSeries: ['any', 0],
    GroupChiefSeries: ['any', 0],
    GroupCentralizer: ['any', 1],
    GroupNormalizer: ['any', 1],
    GroupNormalClosure: ['any', 1],
    GroupCore: ['any', 1],
    GroupCommutatorSubgroup: ['any', 1],
    GroupIntersection: ['any', 1],
    GroupJoin: ['any', 1],
    GroupIsSubnormal: ['boolean', 1],
    GroupIsCharacteristic: ['boolean', 1],
    GroupRightCosets: ['any', 1],
    GroupRightTransversal: ['any', 1],
    GroupComplementRepresentatives: ['any', 1],
    GroupSylowSubgroup: ['any', 1],
    GroupPCore: ['any', 1],
    GroupHallSubgroups: ['any', 1],
    GroupPCentralSeries: ['any', 1],
    GroupFactorization: ['any', 1],
    GroupDoubleCosets: ['any', 2],
    GroupNthRoots: ['any', 2],
    GroupOmega: ['any', 2],
    GroupAgemo: ['any', 2],
  };
  for (const [name, [result, extra]] of Object.entries(groupOps))
    register(
      name,
      `(${Array(extra + 1)
        .fill('any')
        .join(', ')}, integer, integer) -> ${result}`,
      extra + 3,
      (ops) => {
        const w = budget(ops.at(-1)!);
        const original = readDescriptor(ops[0], w);
        const maxElements = integer(ops.at(-2)!);
        if (maxElements < 1 || maxElements > 256)
          return invalid('invalid-finite-group-element-limit');
        if (
          PermutationGroupValue.is(original) &&
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
          PermutationGroupValue.is(original) &&
          [
            'GroupIsSubgroup',
            'GroupEqual',
            'GroupIsNormal',
            'GroupIndex',
          ].includes(name)
        ) {
          const other = readDescriptor(ops[1], w);
          if (!PermutationGroupValue.is(other))
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
        if (name === 'GroupIsAbelian' && ExactMatrixGroup.is(original)) {
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
          ExactMatrixGroup.is(original) &&
          original.field.characteristic > 0
        ) {
          const points =
            BigInt(original.field.characteristic) ** BigInt(original.dimension);
          if (
            points <= 100000n &&
            points *
              BigInt(
                Math.max(original.dimension, original.generators.length)
              ) <=
              1000000n
          )
            return ce.number(primeFieldMatrixGroupOrder(original, 100000, w));
        }
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
          if (
            PermutationGroupValue.is(original) &&
            PermutationGroupValue.is(other)
          ) {
            if (original.action.degree !== other.action.degree)
              return invalid('incompatible-permutation-action');
            ambient = new PermutationGroupValue(
              [...original.generators, ...other.generators],
              original.action,
              { check: () => w.tick() }
            );
          } else if (
            ExactMatrixGroup.is(original) &&
            ExactMatrixGroup.is(other)
          ) {
            original.identity.compatible(other.identity);
            ambient = new ExactMatrixGroup(
              original.field,
              original.dimension,
              [...original.generators, ...other.generators],
              w
            );
          } else return invalid('incompatible-group-domains');
        }
        const m = model(ambient, integer(ops.at(-2)!), w),
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
            if (
              PermutationGroupValue.is(h) &&
              PermutationGroupValue.is(m.descriptor)
            ) {
              if (h.action.degree !== m.descriptor.action.degree)
                return invalid('incompatible-permutation-action');
            } else if (
              ExactMatrixGroup.is(h) &&
              ExactMatrixGroup.is(m.descriptor)
            )
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
            const q = s.quotient(g, h),
              qs = q.group.session(w);
            const images = Array.from(
              { length: q.group.order },
              (_, x) =>
                new PermutationValue(
                  Array.from(
                    { length: q.group.order },
                    (_, i) => qs.mul(i, x) + 1
                  ),
                  { check: () => w.tick() }
                )
            );
            const quotient = new PermutationGroupValue(
              images,
              new PermutationAction(q.group.order),
              { check: () => w.tick() }
            );
            return ce.function('Tuple', [
              bridge.encodeGroup(quotient),
              expressions(
                g.members.map((x) =>
                  ce.function('Tuple', [
                    encodeElement(m.elements[x]),
                    bridge.encodePermutation(images[q.projection[x]]),
                  ])
                )
              ),
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
  register('GroupMatrix', '(integer, any) -> GroupMatrix', 2, (ops) =>
    encodeMatrix(
      readMatrix(
        ce._fn('GroupMatrix', ops),
        new GroupWork(1000000, () => checkDeadline(ce._deadlineFrame))
      )
    )
  );
  register('MatrixGroup', '(integer, integer, any) -> MatrixGroup', 3, (ops) =>
    encodeMatrixGroup(
      readMatrixGroup(
        ce._fn('MatrixGroup', ops),
        new GroupWork(50000000, () => checkDeadline(ce._deadlineFrame))
      )
    )
  );
  register('MatrixGroupDimension', '(MatrixGroup) -> integer', 1, (ops) =>
    ce.number(
      readMatrixGroup(
        ops[0],
        new GroupWork(50000000, () => checkDeadline(ce._deadlineFrame))
      ).dimension
    )
  );
  register('MatrixGroupCharacteristic', '(MatrixGroup) -> integer', 1, (ops) =>
    ce.number(
      readMatrixGroup(
        ops[0],
        new GroupWork(50000000, () => checkDeadline(ce._deadlineFrame))
      ).field.characteristic
    )
  );
  for (const name of [
    'MatrixGroupOrder',
    'MatrixGroupElements',
    'MatrixGroupPcgs',
  ])
    register(name, '(MatrixGroup, integer, integer) -> any', 3, (ops) => {
      const w = budget(ops[2]),
        g = readMatrixGroup(ops[0], w),
        max = integer(ops[1]);
      if (name === 'MatrixGroupElements')
        return expressions(g.enumerate(max, w).map(encodeMatrix));
      if (name === 'MatrixGroupOrder')
        return ce.number(g.enumerate(max, w).length);
      return computePc(g, max, w, ops[2]);
    });
  for (const name of [
    'MatrixGroupTranspose',
    'MatrixGroupIsSubgroupSL',
    'MatrixGroupIsIntegral',
    'MatrixGroupInvariantBilinearForms',
  ])
    register(name, '(MatrixGroup, integer) -> any', 2, (ops) => {
      const w = budget(ops[1]),
        g = readMatrixGroup(ops[0], w);
      if (name === 'MatrixGroupTranspose')
        return encodeMatrixGroup(g.transpose(w));
      if (name === 'MatrixGroupIsSubgroupSL') return bool(g.isSubgroupSL(w));
      if (name === 'MatrixGroupIsIntegral') return bool(g.isIntegral(w));
      return expressions(g.invariantBilinearForms(w).map(encodeMatrix));
    });
  for (const name of ['MatrixGroupVectorAction', 'MatrixGroupProjectiveAction'])
    register(name, '(MatrixGroup, integer, integer) -> any', 3, (ops) => {
      const w = budget(ops[2]),
        g = readMatrixGroup(ops[0], w),
        a = g.action(
          name === 'MatrixGroupProjectiveAction',
          integer(ops[1]),
          w
        );
      return ce.function('Tuple', [
        bridge.encodeGroup(a.group),
        expressions(
          a.points.map((v) => expressions(v.map((q) => ce.number(q.numerator))))
        ),
        a.faithful === undefined ? ce.Nothing : bool(a.faithful),
      ]);
    });
  for (const name of ['GeneralLinearGroup', 'SpecialLinearGroup'])
    register(name, '(integer, integer, integer) -> MatrixGroup', 3, (ops) =>
      encodeMatrixGroup(
        naturalLinearGroup(
          integer(ops[0]),
          integer(ops[1]),
          name === 'SpecialLinearGroup',
          budget(ops[2])
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
      `(GroupMatrix, ${two ? 'any, ' : ''}integer) -> any`,
      two ? 3 : 2,
      (ops) => {
        const w = budget(ops.at(-1)!),
          a = readMatrix(ops[0], w);
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
  const encodePc = (
    pc: FinitePcgs,
    m: Model,
    max: number,
    bound: Expression
  ): Expression =>
    ce._fn('GroupPcSequence', [
      encodeDescriptor(m.descriptor),
      expressions(pc.sequence.map((x) => encodeElement(m.elements[x]))),
      ce.number(max),
      bound,
    ]);
  const computePc = (
    g: Descriptor,
    max: number,
    w: GroupWork,
    bound: Expression
  ): Expression => {
    const m = model(g, max, w),
      pc = FinitePcgs.compute(m.table, w);
    return pc ? encodePc(pc, m, max, bound) : ce.Nothing;
  };
  const readPc = (x: Expression, w: GroupWork) => {
    if (!isFunction(x, 'GroupPcSequence')) return unresolved(x);
    if (x.ops.length !== 4) return invalid('invalid-pc-sequence-arity');
    const max = integer(x.ops[2]);
    new GroupWork(integer(x.ops[3]));
    const m = model(readDescriptor(x.ops[0], w), max, w),
      input = list(x.ops[1]);
    if (input.length > 256) return invalid('pc-sequence-length-limit');
    const pc = FinitePcgs.fromSequence(
      m.table,
      input.map((x) => member(x, m, w)),
      w
    );
    return { pc, m, max };
  };
  register('GroupPcgs', '(any, integer, integer) -> any', 3, (ops) => {
    const w = budget(ops[2]);
    return computePc(readDescriptor(ops[0], w), integer(ops[1]), w, ops[2]);
  });
  register(
    'GroupPcSequence',
    '(any, any, integer, integer) -> GroupPcSequence',
    4,
    (ops) => {
      const w = budget(ops[3]),
        { pc, m, max } = readPc(ce._fn('GroupPcSequence', ops), w);
      return encodePc(pc, m, max, ops[3]);
    }
  );
  const pcOps: Record<string, number> = {
    GroupPcRelativeOrders: 0,
    GroupPcSeries: 0,
    GroupPcExponents: 1,
    GroupPcElement: 1,
    GroupPcLinearCombination: 1,
    GroupPcDepth: 1,
    GroupPcLeadingExponent: 1,
    GroupPcRelativeOrder: 1,
    GroupPcHead: 2,
    GroupPcReduced: 2,
    GroupPcRelativePowerExponents: 1,
    GroupPcConjugateExponents: 2,
    GroupPcCommutatorExponents: 2,
    GroupInducedPcSequence: 1,
  };
  for (const [name, extra] of Object.entries(pcOps))
    register(
      name,
      `(GroupPcSequence, ${Array(extra).fill('any, ').join('')}integer) -> any`,
      extra + 2,
      (ops) => {
        const w = budget(ops.at(-1)!),
          { pc, m, max } = readPc(ops[0], w);
        if (name === 'GroupPcRelativeOrders') return numbers(pc.relativeOrders);
        if (name === 'GroupPcSeries')
          return expressions(pc.series.map((h) => encodeSubgroup(h, m, w)));
        if (name === 'GroupPcElement')
          return encodeElement(
            m.elements[pc.element(list(ops[1]).map(integer), w)]
          );
        if (name === 'GroupPcLinearCombination')
          return encodeElement(
            m.elements[pc.linearCombination(list(ops[1]).map(bigint), w)]
          );
        if (name === 'GroupInducedPcSequence')
          return encodePc(
            pc.induced(subgroup(ops[1], m, w), w),
            m,
            max,
            ops.at(-1)!
          );
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
    register(name, '(MatrixGroup, integer, integer) -> any', 3, (ops) => {
      const w = budget(ops[2]),
        g = readMatrixGroup(ops[0], w),
        limit = integer(ops[1]);
      if (name === 'MatrixGroupInvariantLattice')
        return encodeMatrix(invariantRationalGroupLattice(g, limit, w));
      if (name === 'MatrixGroupOrderByAction')
        return ce.number(primeFieldMatrixGroupOrder(g, limit, w));
      return bool(
        isNaturalLinearGroup(g, name === 'MatrixGroupIsNaturalSL', limit, w)
      );
    });
  register(
    'MatrixGroupInvariantQuadraticForms',
    '(MatrixGroup, integer) -> any',
    2,
    (ops) => {
      const w = budget(ops[1]);
      return expressions(
        readMatrixGroup(ops[0], w).invariantQuadraticForms(w).map(encodeMatrix)
      );
    }
  );
  for (const name of ['GroupPcSift', 'GroupPcCanonicalElement'])
    register(name, '(GroupPcSequence, any, any, integer) -> any', 4, (ops) => {
      const w = budget(ops[3]),
        { pc, m } = readPc(ops[0], w),
        induced = pc.induced(subgroup(ops[1], m, w), w),
        x = member(ops[2], m, w);
      return encodeElement(
        m.elements[
          name === 'GroupPcSift' ? induced.sift(x, w) : induced.canonical(x, w)
        ]
      );
    });
  register(
    'GroupPcgsBySeries',
    '(any, any, integer, integer) -> any',
    4,
    (ops) => {
      const w = budget(ops[3]),
        max = integer(ops[2]),
        m = model(readDescriptor(ops[0], w), max, w),
        input = list(ops[1]);
      if (input.length > 257) return invalid('pc-series-length-limit');
      const result = finitePcgsBySeries(
        input.map((x) => subgroup(x, m, w)),
        w
      );
      return result
        ? ce.function('Tuple', [
            encodePc(result.pcgs, m, max, ops[3]),
            numbers(result.boundaries),
          ])
        : ce.Nothing;
    }
  );
  for (const name of ['GroupPcOrbit', 'GroupPcStabilizer'])
    register(name, '(GroupPcSequence, integer, integer) -> any', 3, (ops) => {
      const w = budget(ops[2]),
        { pc, m, max } = readPc(ops[0], w);
      if (!PermutationGroupValue.is(m.descriptor))
        return invalid('pc-point-action-requires-permutation-group');
      const result = finitePcOrbitStabilizer(
          pc,
          m.elements as readonly PermutationValue[],
          m.descriptor.action,
          integer(ops[1]),
          w
        ),
        stabilizer = encodePc(result.stabilizer, m, max, ops[2]);
      return name === 'GroupPcStabilizer'
        ? stabilizer
        : ce.function('Tuple', [
            numbers(result.points),
            expressions(
              result.representatives.map((x) => encodeElement(m.elements[x]))
            ),
            stabilizer,
          ]);
    });
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
      '(GroupPcSequence, ' +
        Array(2 + extra)
          .fill('any, ')
          .join('') +
        'integer) -> any',
      4 + extra,
      (ops) => {
        const w = budget(ops.at(-1)!),
          { pc, m } = readPc(ops[0], w),
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
            m.elements[mod.element(list(ops[3]).map(integer), w)]
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
