import { PermutationQuerySession } from '../group-theory/permutation/query-session.js';
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
import { checkDeadline } from '../../common/interruptible.js';
import {
  PermutationValue,
  PermutationAction,
  PermutationInputError,
  degreeLimit,
  composePermutations,
  inversePermutation,
  applyPermutation,
  assertPermutationFits,
} from '../group-theory/permutation/values.js';

import {
  PermutationGroupValue,
  permutationGroupLimits,
  enumeratePermutationGroup,
  permutationClosureLimits,
  type PermutationGroupWork,
} from '../group-theory/permutation/groups.js';

import {
  PermutationOrbitTree,
  permutationOrbitLimits,
  permutationOrbits,
  permutationTransversalLimits,
} from '../group-theory/permutation/orbits.js';

import { toBigint } from '../boxed-expression/numerics.js';
import {
  permutationCycles,
  permutationElementOrder,
  permutationPower,
  conjugatePermutation,
  permutationCommutator,
} from '../group-theory/permutation/element-operations.js';
import {
  permutationChainLimits,
  permutationGroupIsAbelian,
} from '../group-theory/permutation/stabilizer-chain.js';

/** Recognize kernel errors across separate host/plugin copies of the module. */
export function isPermutationError(
  error: unknown
): error is { name: string; code: string } {
  if (
    !error ||
    typeof error !== 'object' ||
    !('name' in error) ||
    !('code' in error)
  )
    return false;
  return (
    typeof error.code === 'string' &&
    [
      'PermutationInputError',
      'PermutationClosureLimitError',
      'PermutationOrbitLimitError',
      'PermutationChainLimitError',
    ].includes(String(error.name))
  );
}

/** Resource ceilings for all queries loaded into one engine. Per-call options may lower them. */
export interface GroupTheoryLoadOptions {
  maxDegree?: number;
  maxClosureElements?: number;
  maxClosureProducts?: number;
  maxOrbitPoints?: number;
  maxOrbitEdges?: number;
  maxTransversalProducts?: number;
  maxChainWork?: number;
  maxGenerators?: number;
  maxGeneratorImages?: number;
  maxClosureImageWork?: number;
  maxClosureStoredImages?: number;
  maxTransversalImageWork?: number;
  maxTransversalStoredImages?: number;
  maxChainLevels?: number;
  maxChainOrbitPoints?: number;
  maxChainStoredImages?: number;
}
export interface GroupTheoryLoadReport {
  /** Number of registered permutation operators. */
  operatorCount: number;
}
const loaded = new WeakMap<
  IComputeEngine,
  {
    settings: string;
    report: GroupTheoryLoadReport;
    definitions: readonly { name: string; value: unknown }[];
  }
>();

/**
 * Register the optional permutation library. Equal effective options are
 * idempotent; changing ceilings on an already-loaded engine is an error.
 * Definitions are installed atomically so a failed load leaves no partial types.
 */
export function loadGroupTheory(
  ce: IComputeEngine,
  options: GroupTheoryLoadOptions = {}
): GroupTheoryLoadReport {
  const maxDegree = degreeLimit(options);
  const groupLimits = permutationGroupLimits(options);
  const closureLimits = permutationClosureLimits({
    maxElements: options.maxClosureElements ?? 10_000,
    maxProducts: options.maxClosureProducts ?? 100_000,
    maxImageWork: options.maxClosureImageWork,
    maxStoredImages: options.maxClosureStoredImages,
  });
  const transversalLimits = permutationTransversalLimits({
    maxProducts: options.maxTransversalProducts ?? 100_000,
    maxImageWork: options.maxTransversalImageWork,
    maxStoredImages: options.maxTransversalStoredImages,
  });
  const { maxProofSteps: _diagnosticProofLimit, ...chainLimits } =
    permutationChainLimits({
      maxWork: options.maxChainWork ?? 50_000_000,
      maxLevels: options.maxChainLevels,
      maxOrbitPoints: options.maxChainOrbitPoints,
      maxOrbitEdges: options.maxOrbitEdges,
      maxStoredImages: options.maxChainStoredImages,
    });
  const orbitLimits = permutationOrbitLimits({
    maxPoints: options.maxOrbitPoints ?? 100_000,
    maxEdges: options.maxOrbitEdges ?? 1_000_000,
  });
  const settings = JSON.stringify({
    maxDegree,
    groupLimits,
    closureLimits,
    transversalLimits,
    chainLimits,
    orbitLimits,
  });
  const previous = loaded.get(ce);
  // Checkpoint restoration can remove a library after loading. Check definitions
  // as well as the weak cache before claiming the engine is still configured.
  if (
    previous &&
    previous.definitions.every(
      ({ name, value }) => value === ce.lookupDefinition(name)
    )
  ) {
    if (previous.settings !== settings)
      throw new Error(
        'loadGroupTheory: this engine is already loaded with different options'
      );
    return { ...previous.report };
  }
  const work: PermutationGroupWork = {
    maxDegree,
    ...groupLimits,
    check: () => checkDeadline(ce._deadlineFrame),
  };
  const queries = new PermutationQuerySession();
  const fail = (code: string): never => {
    throw new PermutationInputError(code);
  };
  const adapt = (
    body: () => Expression | undefined
  ): Expression | undefined => {
    try {
      return body();
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        isFunction(error as Expression, 'Error')
      )
        return error as Expression;
      if (isPermutationError(error)) return ce.error(error.code);
      throw error;
    }
  };
  // Custom canonical constructors also run on raw calls, before the usual
  // signature checks. Use the engine's shared arity codes at that entry point.
  const constructorArity = (ops: readonly Expression[], count: number) => {
    if (ops.length !== count)
      fail(ops.length < count ? 'missing' : 'unexpected-argument');
  };
  const integer = (value: Expression, defer = false): number | undefined => {
    if (isNumber(value)) {
      if (value.isInteger !== true || !Number.isSafeInteger(value.re))
        fail('incompatible-type');
      return value.re;
    }
    if (isSymbol(value))
      return defer || !value.isConstant ? undefined : fail('incompatible-type');
    if (isFunction(value) && (defer || !value.isConstant)) return undefined;
    return fail('incompatible-type');
  };
  const readImages = (
    value: Expression,
    defer = false
  ): number[] | undefined => {
    if (isSymbol(value))
      return defer || !value.isConstant ? undefined : fail('incompatible-type');
    // Boxing never executes a producer such as ListFrom; evaluation checks its result.
    if (defer && isFunction(value) && value.operator !== 'List')
      return undefined;
    if (!isFunction(value, 'List')) return fail('incompatible-type');
    if (value.ops.length > maxDegree) return fail('permutation-degree-limit');
    const result: number[] = [];
    let unresolved = false;
    for (let i = 0; i < value.ops.length; i++) {
      if ((i & 1023) === 0) work.check?.();
      const point = integer(value.ops[i], defer);
      if (point === undefined) unresolved = true;
      else result.push(point);
    }
    return unresolved ? undefined : result;
  };
  const readPermutation = (
    value: Expression,
    defer = false
  ): PermutationValue | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value))
      return !value.isConstant ? undefined : fail('incompatible-type');
    if (defer && isFunction(value) && value.operator !== 'Permutation')
      return undefined;
    if (!isFunction(value, 'Permutation')) return fail('incompatible-type');
    constructorArity(value.ops, 1);

    const images = readImages(value.op1, defer);
    return images === undefined
      ? undefined
      : PermutationValue.fromImages(images, work);
  };
  const readAction = (
    value: Expression,
    defer = false
  ): PermutationAction | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value))
      return !value.isConstant
        ? undefined
        : fail('incompatible-permutation-domain');
    if (defer && isFunction(value) && value.operator !== 'PermutationAction')
      return undefined;
    if (!isFunction(value, 'PermutationAction'))
      return fail('incompatible-permutation-domain');

    const n = integer(value.op1, defer);
    return n === undefined ? undefined : new PermutationAction(n, work);
  };
  const encode = (value: PermutationValue): Expression =>
    ce._fn('Permutation', [
      ce.function(
        'List',
        value.images.map((x, i) => {
          if ((i & 1023) === 0) work.check?.();
          return ce.number(x);
        })
      ),
    ]);

  const permutation = (
    ops: readonly Expression[],
    defer = false
  ): Expression | undefined =>
    adapt(() => {
      constructorArity(ops, 1);
      const images = readImages(ops[0], defer);
      return images === undefined
        ? undefined
        : encode(PermutationValue.fromImages(images, work));
    });
  const action = (
    ops: readonly Expression[],
    defer = false
  ): Expression | undefined =>
    adapt(() => {
      constructorArity(ops, 1);
      const n = integer(ops[0], defer);
      if (n === undefined) return undefined;
      const value = new PermutationAction(n, work);
      return ce._fn('PermutationAction', [ce.number(value.degree)]);
    });
  const groupFromOperands = (
    ops: readonly Expression[],
    defer = false
  ): PermutationGroupValue | undefined => {
    constructorArity(ops, 2);
    const action = readAction(ops[1], defer);
    const input = ops[0];
    if (isSymbol(input) && (defer || !input.isConstant)) return undefined;
    if (defer && isFunction(input) && input.operator !== 'List')
      return undefined;
    if (!isFunction(input, 'List')) return fail('incompatible-type');
    if (input.ops.length > groupLimits.maxGenerators)
      return fail('permutation-generator-limit');
    const generators: PermutationValue[] = [];
    let unresolved = action === undefined,
      images = 0;
    for (const item of input.ops) {
      work.check?.();
      const generator = readPermutation(item, defer);
      if (!generator) {
        unresolved = true;
        continue;
      }
      images += generator.supportDegree;
      if (images > groupLimits.maxGeneratorImages)
        return fail('permutation-generator-image-limit');
      if (action) assertPermutationFits(generator, action, work);
      generators.push(generator);
    }
    return unresolved || !action
      ? undefined
      : new PermutationGroupValue(generators, action, work);
  };
  const encodeGroup = (value: PermutationGroupValue): Expression =>
    ce._fn('PermutationGroup', [
      ce.function(
        'List',
        value.generators.map((generator) => {
          work.check?.();
          return encode(generator);
        })
      ),
      ce._fn('PermutationAction', [ce.number(value.action.degree)]),
    ]);
  const group = (
    ops: readonly Expression[],
    defer = false
  ): Expression | undefined =>
    adapt(() => {
      const value = groupFromOperands(ops, defer);
      return value ? encodeGroup(value) : undefined;
    });
  const readGroup = (value: Expression): PermutationGroupValue | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value) && !value.isConstant) return undefined;
    if (!isFunction(value, 'PermutationGroup'))
      return fail('incompatible-type');
    return groupFromOperands(value.ops);
  };
  const encodePoints = (points: readonly number[]): Expression =>
    ce.function(
      'List',
      points.map((point) => {
        work.check?.();
        return ce.number(point);
      })
    );
  // A call may lower the installer's ceilings; execution settings never enter a value.
  const queryOptions = <T extends Record<string, number>>(
    ops: readonly Expression[],
    count: number,
    defaults: T
  ): T | undefined => {
    if (ops.length < count || ops.length > count + 1)
      fail(ops.length < count ? 'missing' : 'unexpected-argument');
    const input = ops[count];
    if (!input || isSymbol(input, 'Nothing')) return defaults;
    if (isSymbol(input) && !input.isConstant) return undefined;
    if (!isDictionary(input)) return fail('invalid-permutation-options');
    const result = { ...defaults };
    for (const key of input.keys) {
      work.check?.();
      if (!Object.hasOwn(defaults, key))
        return fail('unknown-permutation-option');
      const value = integer(input.get(key)!);
      if (value === undefined) return undefined;
      if (value < 0 || value > defaults[key])
        return fail('permutation-option-exceeds-limit');
      result[key as keyof T] = value as T[keyof T];
    }
    return result;
  };
  const orbitQuery = (
    ops: readonly Expression[],
    kind: 'orbit' | 'orbits' | 'transversal'
  ): Expression | undefined =>
    adapt(() => {
      const settings = queryOptions(
        ops,
        kind === 'orbits' ? 1 : 2,
        kind === 'transversal'
          ? { ...orbitLimits, ...transversalLimits }
          : orbitLimits
      );
      if (!settings) return undefined;
      const requested = permutationOrbitLimits(settings);
      const value = readGroup(ops[0]);
      if (!value) return undefined;
      if (kind === 'orbits') {
        return ce.function(
          'List',
          permutationOrbits(value, requested, work).map(encodePoints)
        );
      }
      const point = integer(ops[1]);
      if (point === undefined) return undefined;
      const products = permutationTransversalLimits({
        ...transversalLimits,
        ...settings,
      });
      const orbit = PermutationOrbitTree.compute(value, point, requested, work);
      if (kind === 'orbit') return encodePoints(orbit.points);
      return ce.function(
        'List',
        orbit.transversal(products, work).map(([target, representative]) => {
          work.check?.();
          return ce.function('Tuple', [
            ce.number(target),
            encode(representative),
          ]);
        })
      );
    });
  const chainQuery = (
    ops: readonly Expression[],
    kind:
      | 'order'
      | 'contains'
      | 'stabilizer'
      | 'subgroup'
      | 'index'
      | 'equal'
      | 'normal'
      | 'abelian'
  ): Expression | undefined =>
    adapt(() => {
      const settings = queryOptions(
        ops,
        kind === 'order' || kind === 'abelian' ? 1 : 2,
        chainLimits
      );
      if (!settings) return undefined;
      const requested = permutationChainLimits(settings);
      const value = readGroup(ops[0]);
      if (!value) return undefined;
      if (kind === 'order')
        return ce.number(queries.order(value, requested, work));
      if (kind === 'abelian')
        return permutationGroupIsAbelian(value, requested, work)
          ? ce.True
          : ce.False;
      if (kind === 'contains') {
        const element = readPermutation(ops[1]);
        if (!element) return undefined;
        return queries.contains(value, element, requested, work)
          ? ce.True
          : ce.False;
      }
      if (kind === 'stabilizer') {
        const point = integer(ops[1]);
        return point === undefined
          ? undefined
          : encodeGroup(queries.stabilizer(value, point, requested, work));
      }
      const other = readGroup(ops[1]);
      if (!other) return undefined;
      const result = queries.relation(value, other, kind, requested, work);
      return typeof result === 'bigint'
        ? ce.number(result)
        : result
          ? ce.True
          : ce.False;
    });
  const elementQuery = (
    ops: readonly Expression[],
    kind: 'cycles' | 'order' | 'power' | 'conjugate' | 'commutator'
  ): Expression | undefined =>
    adapt(() => {
      const value = readPermutation(ops[0]);
      if (!value) return undefined;
      if (kind === 'cycles')
        return ce.function(
          'List',
          permutationCycles(value, work).map(encodePoints)
        );
      if (kind === 'order')
        return ce.number(permutationElementOrder(value, work));
      if (kind === 'power') {
        if (isNumber(ops[1]) && ops[1].isInteger !== true)
          return fail('invalid-permutation-exponent');
        const exponent = toBigint(ops[1]);
        if (exponent === null) {
          if (!ops[1].isConstant) return undefined;
          return fail('invalid-permutation-exponent');
        }
        return encode(permutationPower(value, exponent, work));
      }
      const other = readPermutation(ops[1]);
      if (!other) return undefined;
      return encode(
        kind === 'conjugate'
          ? conjugatePermutation(value, other, work)
          : permutationCommutator(value, other, work)
      );
    });
  const definitions: Record<string, OperatorDefinition> = {
    PermutationCycles: {
      signature: '(Permutation) -> list<list<integer>>',
      pure: true,
      evaluate: (ops) => elementQuery(ops, 'cycles'),
    },
    PermutationOrder: {
      signature: '(Permutation) -> integer',
      pure: true,
      evaluate: (ops) => elementQuery(ops, 'order'),
    },
    PermutationPower: {
      signature: '(Permutation, integer) -> Permutation',
      pure: true,
      evaluate: (ops) => elementQuery(ops, 'power'),
    },
    PermutationConjugate: {
      signature: '(Permutation, Permutation) -> Permutation',
      pure: true,
      evaluate: (ops) => elementQuery(ops, 'conjugate'),
    },
    PermutationCommutator: {
      signature: '(Permutation, Permutation) -> Permutation',
      pure: true,
      evaluate: (ops) => elementQuery(ops, 'commutator'),
    },
    PermutationGroupGenerators: {
      signature: '(PermutationGroup) -> list<Permutation>',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const value = readGroup(ops[0]);
          return value
            ? ce.function(
                'List',
                value.generators.map((g) => {
                  work.check?.();
                  return encode(g);
                })
              )
            : undefined;
        }),
    },
    PermutationGroupIdentity: {
      signature: '(PermutationGroup) -> Permutation',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          return readGroup(ops[0])
            ? encode(PermutationValue.fromImages([], work))
            : undefined;
        }),
    },
    PermutationGroupOrder: {
      signature:
        '(group: PermutationGroup, options: dictionary<integer>?) -> integer',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'order'),
    },
    PermutationGroupContains: {
      signature:
        '(group: PermutationGroup, element: Permutation, options: dictionary<integer>?) -> boolean',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'contains'),
    },
    PermutationPointStabilizer: {
      signature:
        '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> PermutationGroup',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'stabilizer'),
    },
    PermutationIsSubgroup: {
      signature:
        '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> boolean',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'subgroup'),
    },
    PermutationSubgroupIndex: {
      signature:
        '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> integer',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'index'),
    },
    PermutationGroupEqual: {
      signature:
        '(left: PermutationGroup, right: PermutationGroup, options: dictionary<integer>?) -> boolean',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'equal'),
    },
    PermutationIsNormal: {
      signature:
        '(parent: PermutationGroup, candidate: PermutationGroup, options: dictionary<integer>?) -> boolean',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'normal'),
    },
    PermutationGroupIsAbelian: {
      signature:
        '(group: PermutationGroup, options: dictionary<integer>?) -> boolean',
      pure: true,
      evaluate: (ops) => chainQuery(ops, 'abelian'),
    },
    PermutationOrbit: {
      signature:
        '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> list<integer>',
      pure: true,
      evaluate: (ops) => orbitQuery(ops, 'orbit'),
    },
    PermutationOrbits: {
      signature:
        '(group: PermutationGroup, options: dictionary<integer>?) -> list<list<integer>>',
      pure: true,
      evaluate: (ops) => orbitQuery(ops, 'orbits'),
    },
    PermutationTransversal: {
      signature:
        '(group: PermutationGroup, point: integer, options: dictionary<integer>?) -> list<tuple<integer, Permutation>>',
      pure: true,
      evaluate: (ops) => orbitQuery(ops, 'transversal'),
    },
    PermutationGroup: {
      signature: '(list<Permutation>, PermutationAction) -> PermutationGroup',
      pure: true,
      invokes: false,
      canonical: (ops) => group(ops, true) ?? ce._fn('PermutationGroup', ops),
      evaluate: (ops) => group(ops),
      // No injective-constructor equality: distinct generators may generate
      // the same subgroup; PermutationGroupEqual is the explicit mathematical query.
    },
    PermutationGroupElements: {
      signature:
        '(group: PermutationGroup, options: dictionary<integer>?) -> list<Permutation>',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const settings = queryOptions(ops, 1, closureLimits);
          if (!settings) return undefined;
          const requested = permutationClosureLimits(settings);
          const value = readGroup(ops[0]);
          if (!value) return undefined;
          const elements = enumeratePermutationGroup(value, requested, work);
          return ce.function(
            'List',
            elements.map((element) => {
              work.check?.();
              return encode(element);
            })
          );
        }),
    },
    Permutation: {
      signature: '(list<integer>) -> Permutation',
      pure: true,
      invokes: false,
      canonical: (ops) => permutation(ops, true) ?? ce._fn('Permutation', ops),
      evaluate: (ops) => permutation(ops),
      eq: (a, b) => {
        if (!isFunction(a, 'Permutation') || !isFunction(b, 'Permutation'))
          return undefined;
        try {
          const left = readPermutation(a),
            right = readPermutation(b);
          if (!left || !right) return undefined;
          return (
            left.supportDegree === right.supportDegree &&
            left.images.every((x, i) => x === right.images[i])
          );
        } catch (error) {
          if (
            isPermutationError(error) &&
            error.name === 'PermutationInputError'
          )
            return undefined;
          throw error;
        }
      },
    },
    PermutationAction: {
      signature: '(integer) -> PermutationAction',
      pure: true,
      invokes: false,
      canonical: (ops) => action(ops, true) ?? ce._fn('PermutationAction', ops),
      evaluate: (ops) => action(ops),
      eq: (a, b) => {
        if (
          !isFunction(a, 'PermutationAction') ||
          !isFunction(b, 'PermutationAction')
        )
          return undefined;
        try {
          const left = readAction(a),
            right = readAction(b);
          return left && right ? left.degree === right.degree : undefined;
        } catch (error) {
          if (
            isPermutationError(error) &&
            error.name === 'PermutationInputError'
          )
            return undefined;
          throw error;
        }
      },
    },
    PermutationCompose: {
      signature: '(Permutation, Permutation) -> Permutation',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const left = readPermutation(ops[0]),
            right = readPermutation(ops[1]);
          return left && right
            ? encode(composePermutations(left, right, work))
            : undefined;
        }),
    },
    PermutationInverse: {
      signature: '(Permutation) -> Permutation',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const value = readPermutation(ops[0]);
          return value ? encode(inversePermutation(value, work)) : undefined;
        }),
    },
    PermutationInAction: {
      signature: '(Permutation, PermutationAction) -> Permutation',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const value = readPermutation(ops[0]),
            domain = readAction(ops[1]);
          if (!value || !domain) return undefined;
          assertPermutationFits(value, domain, work);
          return encode(value);
        }),
    },
    PermutationApply: {
      signature: '(Permutation, integer, PermutationAction) -> integer',
      pure: true,
      evaluate: (ops) =>
        adapt(() => {
          const value = readPermutation(ops[0]),
            point = integer(ops[1]),
            domain = readAction(ops[2]);
          if (!value || point === undefined || !domain) return undefined;
          return ce.number(applyPermutation(value, point, domain, work));
        }),
    },
  };
  for (const name of Object.keys(definitions)) {
    if (ce.lookupDefinition(name)) throw new Error(`Already defined: ${name}`);
  }
  // Roll back both types and operators if any registration fails. Checkpoints
  // also own the installed definitions; no module-global registry is needed.
  const checkpoint = ce.checkpoint();
  try {
    ce.declareType('Permutation', 'tuple<images: list<integer>>', {
      mint: false,
    });
    ce.declareType('PermutationAction', 'tuple<degree: integer>', {
      mint: false,
    });
    ce.declareType(
      'PermutationGroup',
      'tuple<generators: list<Permutation>, action: PermutationAction>',
      { mint: false }
    );
    for (const [name, definition] of Object.entries(definitions))
      ce.declare(name, definition);
  } catch (error) {
    ce.restore(checkpoint);
    throw error;
  } finally {
    ce.discard(checkpoint);
  }
  const report = { operatorCount: Object.keys(definitions).length };
  loaded.set(ce, {
    settings,
    report,
    definitions: Object.keys(definitions).map((name) => ({
      name,
      value: ce.lookupDefinition(name),
    })),
  });
  return { ...report };
}
