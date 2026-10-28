// MathJSON adapter and optional loader for group theory. The permutation kernel is in
// `src/compute-engine/group-theory/permutation/`. It is not part of the default
// library: a host calls `loadGroupTheory(ce)` (exported from the
// `@cortex-js/compute-engine/group-theory` subpath) to install it in one engine.
//
// The permutation definitions below register:
//
//  - three types, all declared with `mint: false`:
//    `Permutation` (`tuple<images: list<integer>>`),
//    `PermutationAction` (`tuple<degree: integer>`) and
//    `PermutationGroup` (`tuple<generators: list<Permutation>, action:
//    PermutationAction>`);
//  - three constructors with a `canonical` handler (`Permutation`,
//    `PermutationAction`, `PermutationGroup`);
//  - the element operators (compose, inverse, power, order, cycles, conjugate,
//    commutator, apply) and the group queries (order, membership, orbits,
//    transversal, stabilizer, subgroup relations, element list).
//
// The finite-group adapter also registers exact matrix descriptors, polycyclic
// sequences, checked homomorphisms and quotients, plus structural aliases for
// supported groups and elements. Its constructors validate on evaluation; its
// queries share a work ledger and bounded finite models. See finite-group-theory.ts.
//
// Conventions of the permutation values:
//
//  - A permutation is a bijection of the positive integers that moves only
//    finitely many points. `Permutation([2, 3, 1])` maps 1 to 2, 2 to 3 and
//    3 to 1. The kernel removes trailing fixed points, so `[2, 1, 3]` and
//    `[2, 1]` are the same value. Its "support degree" is the length of the
//    stored image list.
//  - Products use the right action: in `PermutationCompose(a, b)`, `a` acts
//    first, so the image of `i` is `b(a(i))`.
//  - A `PermutationAction(n)` names the finite set {1, …, n}. A permutation
//    fits an action when its support degree is at most `n`. Orbits, the point
//    of `PermutationApply` and the point of a stabilizer are read in that set.
//  - A `PermutationGroup` is the list of generators as given, plus the action.
//    Two groups with different generators can be the same subgroup, so the
//    constructor has no `eq` handler; `PermutationGroupEqual` is the query
//    that compares the subgroups.
//
// Loading:
//
//  - The load options are ceilings for every query in this engine. Each
//    option is checked against a fixed maximum of the kernel; a value above
//    that maximum makes `loadGroupTheory()` throw the kernel error (for
//    example a `PermutationInputError` with the code
//    `invalid-permutation-orbit-edge-limit`).
//  - A query operator takes an optional last operand, a dictionary of named
//    integer options. Each name must be a limit of that query, and each value
//    must be in the range 0 to the installed ceiling. A call can lower a
//    limit; it cannot raise one. The options control execution only and are
//    never part of a result value.
//  - Loading twice with equal effective options (the options after the
//    defaults are applied) returns the first report and changes nothing.
//    Loading again with different effective options throws. If a checkpoint
//    restore removed the definitions, the next call loads the library again.
//  - All types and operators are declared inside one engine checkpoint. If a
//    declaration fails, the checkpoint is restored, so a failed load leaves
//    no partial library.
//
// Validation happens once, when a MathJSON operand is read into a kernel
// value. The kernel functions that receive these values only check resource
// limits again; they do not check the values again. A `canonical` handler
// runs on raw input before the engine checks the operator signature, so the
// readers below check the operator heads and the integer literals
// themselves. They also check what a type cannot express: that the images
// are a bijection, that a point or a permutation is inside the action, and
// that the input is inside the resource limits.
//
// Operands that are not known yet (a symbol with no constant value, or an
// unevaluated function call) make a reader return `undefined`. The handler
// then returns `undefined` and the expression stays unevaluated.
//
// Errors: the kernel throws errors with a `code` string. `adapt()` converts
// them to `Error("<code>")` expressions, for example
// `Error("duplicate-permutation-image")` for `Permutation([1, 1])`. An
// `Error(...)` operand is returned unchanged. Any other exception, such as a
// cancellation from the engine deadline, is thrown again.
//
// Long loops call `work.check()`, which checks the engine deadline
// (`ce._deadlineFrame`), so a time limit set by the host also stops a
// permutation query.

import { collectedPcDefinitions } from './pc-group-theory.js';
import {
  exactGroupDefinitions,
  finiteGroupLimits,
} from './finite-group-theory.js';
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

/**
 * Recognize kernel errors across separate host/plugin copies of the module.
 *
 * The test reads `error.name` and `error.code`, not `instanceof`. A plugin
 * bundle can include its own copy of the kernel classes, and an error
 * created by one copy is not an instance of the class in the other copy.
 *
 * The four names are the kernel errors that carry a code meant for the
 * user. Other errors (for example the cancellation error of the engine
 * deadline check) do not match, so the caller throws them again.
 */
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

/**
 * Resource ceilings for all queries loaded into one engine. Per-call options may lower them.
 *
 * An omitted option takes the kernel default. Each option must be a safe
 * integer from 0 to the kernel maximum, otherwise `loadGroupTheory()`
 * throws.
 *
 * - `maxFiniteElements`, `maxFiniteWork`: finite-model size and work ceilings.
 * - `maxMatrixActionPoints`: point ceiling for finite-field vector actions.
 * - `maxDegree`: the largest action degree and image-list length.
 * - `maxGenerators`, `maxGeneratorImages`: the number of generators of one
 *   group, and the sum of their support degrees.
 * - `maxClosure*`: limits of `PermutationGroupElements`, which lists every
 *   element.
 * - `maxOrbitPoints`, `maxOrbitEdges`: limits of the orbit queries.
 * - `maxTransversal*`: limits of `PermutationTransversal`.
 * - `maxChain*`: limits of the stabilizer chain (Schreier-Sims), which the
 *   order, membership, stabilizer and subgroup queries use.
 */
export interface GroupTheoryLoadOptions {
  /** Bounded finite models and coordinate calculations, default 256 elements. */
  maxFiniteElements?: number;
  /** Shared work ceiling for finite, matrix, and polycyclic queries. */
  maxFiniteWork?: number;
  /** Maximum points in a full finite-field matrix action. */
  maxMatrixActionPoints?: number;
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
  maxChainOrbitEdges?: number;
  maxChainStoredImages?: number;
}
export interface GroupTheoryLoadReport {
  /** Number of registered group-theory operators. */
  operatorCount: number;
}
/**
 * The load state of each engine. `settings` is the JSON text of the
 * effective limits, used to compare a later load. `definitions` holds the
 * definition objects that were installed, used to detect that a checkpoint
 * restore removed them. A `WeakMap` lets a discarded engine be collected.
 */
const loaded = new WeakMap<
  IComputeEngine,
  {
    settings: string;
    report: GroupTheoryLoadReport;
    definitions: readonly { name: string; value: unknown }[];
  }
>();

/**
 * Register the optional group-theory library. Equal effective options are
 * idempotent; changing ceilings on an already-loaded engine is an error.
 * Definitions are installed atomically so a failed load leaves no partial types.
 *
 * Throws when an option is outside its kernel range, when the engine is
 * already loaded with different options, or when one of the operator names
 * is already defined in the engine.
 */
export function loadGroupTheory(
  ce: IComputeEngine,
  options: GroupTheoryLoadOptions = {}
): GroupTheoryLoadReport {
  // Normalize every limit. Each kernel function applies its default for an
  // omitted value and throws for a value outside its range. The results are
  // the ceilings of this engine and the defaults of a call with no options.
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
  // `maxProofSteps` limits only the diagnostic certificate of the chain. The
  // queries record no proof, so it is not an option of this library. Removing
  // it here also keeps it out of the per-call option names.
  const { maxProofSteps: _diagnosticProofLimit, ...chainLimits } =
    permutationChainLimits({
      maxWork: options.maxChainWork ?? 50_000_000,
      maxLevels: options.maxChainLevels,
      maxOrbitPoints: options.maxChainOrbitPoints,
      maxOrbitEdges: options.maxChainOrbitEdges,
      maxStoredImages: options.maxChainStoredImages,
    });
  const orbitLimits = permutationOrbitLimits({
    maxPoints: options.maxOrbitPoints ?? 100_000,
    maxEdges: options.maxOrbitEdges ?? 1_000_000,
  });
  const finiteLimits = finiteGroupLimits({
    maxElements: options.maxFiniteElements ?? 256,
    maxWork: options.maxFiniteWork ?? 50_000_000,
    maxPoints: options.maxMatrixActionPoints ?? 100_000,
  });
  const settings = JSON.stringify({
    finiteLimits,
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
  // The receiving limits that every kernel call of this engine gets. `check`
  // throws a cancellation when the engine deadline has passed.
  const work: PermutationGroupWork = {
    maxDegree,
    ...groupLimits,
    check: () => checkDeadline(ce._deadlineFrame),
  };
  // One cache of stabilizer chains for this engine. It lives as long as the
  // definitions that capture it.
  const queries = new PermutationQuerySession();
  // Report invalid input. `adapt()` converts the error to `Error("<code>")`.
  const fail = (code: string): never => {
    throw new PermutationInputError(code);
  };
  // Run a handler body and convert its failures to expressions:
  //  - an `Error(...)` expression thrown by a reader (an operand that was
  //    already an error) is returned unchanged;
  //  - a kernel error (see `isPermutationError()`) becomes
  //    `Error("<code>")`;
  //  - any other exception, for example a cancellation, is thrown again.
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
  // The readers below share one convention:
  //  - they return the kernel value when the operand is complete and valid;
  //  - they return `undefined` when the operand is not known yet, so the
  //    expression stays unevaluated;
  //  - they throw (through `fail()` or the kernel) when the operand is
  //    invalid.
  // `defer` is true when a `canonical` handler calls the reader. Boxing does
  // not evaluate, so in that case a function call of another head (such as
  // `ListFrom(...)`) is left for evaluation. `integer`, `readImages` and the
  // generator list also leave any symbol; `readPermutation` and `readAction`
  // refuse a constant symbol at once, because no constant symbol can be a
  // permutation or an action. With `defer` false, only a symbol or a
  // function call that is not constant is left; a constant one of the wrong
  // kind is an error.

  // Read an integer literal as a safe JavaScript integer. A float, a
  // rational, or an integer that is not a safe integer is
  // `incompatible-type`.
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
  // Read a `List` of integer images. The length is checked against
  // `maxDegree` before the elements are read, so a very long list does not
  // allocate first. The bijection check happens later, in
  // `PermutationValue.fromImages()`.
  const readImages = (
    value: Expression,
    defer = false
  ): number[] | undefined => {
    if (isSymbol(value))
      return defer || !value.isConstant ? undefined : fail('incompatible-type');
    // Boxing never executes a producer such as ListFrom; evaluation checks its result.
    if (
      isFunction(value) &&
      value.operator !== 'List' &&
      (defer || !value.isConstant)
    )
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
  // Read a `Permutation(List(...))` operand. Errors: `incompatible-type`
  // for another head or a constant symbol, the arity codes, and the image
  // errors of `PermutationValue.fromImages()`
  // (`invalid-permutation-image`, `duplicate-permutation-image`,
  // `permutation-degree-limit`).
  const readPermutation = (
    value: Expression,
    defer = false
  ): PermutationValue | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value))
      return !value.isConstant ? undefined : fail('incompatible-type');
    if (
      isFunction(value) &&
      value.operator !== 'Permutation' &&
      (defer || !value.isConstant)
    )
      return undefined;
    if (!isFunction(value, 'Permutation')) return fail('incompatible-type');
    constructorArity(value.ops, 1);

    const images = readImages(value.op1, defer);
    return images === undefined
      ? undefined
      : PermutationValue.fromImages(images, work);
  };
  // Read a `PermutationAction(n)` operand. Another head or a constant symbol
  // is `incompatible-permutation-domain`. The kernel refuses a negative `n`
  // (`invalid-permutation-action-degree`) and an `n` above `maxDegree`.
  const readAction = (
    value: Expression,
    defer = false
  ): PermutationAction | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value))
      return !value.isConstant
        ? undefined
        : fail('incompatible-permutation-domain');
    if (
      isFunction(value) &&
      value.operator !== 'PermutationAction' &&
      (defer || !value.isConstant)
    )
      return undefined;
    if (!isFunction(value, 'PermutationAction'))
      return fail('incompatible-permutation-domain');

    const n = integer(value.op1, defer);
    return n === undefined ? undefined : new PermutationAction(n, work);
  };
  // Write a kernel value back as MathJSON. The value is already valid, so
  // `ce._fn()` builds the `Permutation` expression without running its
  // `canonical` handler again. The images are the normalized ones, without
  // trailing fixed points.
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

  // Handlers of the three constructors. The `canonical` handler calls them
  // with `defer` true; the `evaluate` handler with `defer` false. A valid
  // literal gives the normalized expression, an invalid literal gives
  // `Error("<code>")`, and an operand that is not known yet gives
  // `undefined`.
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
  // Read the two operands of `PermutationGroup(List(generators), action)`.
  // The generator count and the sum of the support degrees are checked while
  // the list is read, before the kernel constructor checks them again, so an
  // oversized input stops early. Errors: `permutation-generator-limit`,
  // `permutation-generator-image-limit`, `permutation-outside-action` (a
  // generator moves a point above the action degree), and the errors of the
  // element and action readers. The generators keep their order and
  // repetitions.
  const groupFromOperands = (
    ops: readonly Expression[],
    defer = false
  ): PermutationGroupValue | undefined => {
    constructorArity(ops, 2);
    const action = readAction(ops[1], defer);
    const input = ops[0];
    if (isSymbol(input) && (defer || !input.isConstant)) return undefined;
    if (
      isFunction(input) &&
      input.operator !== 'List' &&
      (defer || !input.isConstant)
    )
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
  // Read a `PermutationGroup` operand of a query. The operand was
  // canonicalized and evaluated before, but its generators are read and
  // checked again, because a query can receive any expression with this
  // head.
  const readGroup = (value: Expression): PermutationGroupValue | undefined => {
    if (isFunction(value, 'Error')) throw value;
    if (isSymbol(value) && !value.isConstant) return undefined;
    if (
      isFunction(value) &&
      value.operator !== 'PermutationGroup' &&
      !value.isConstant
    )
      return undefined;
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
  //
  // Read the optional options dictionary at operand index `count`. `defaults`
  // holds the installed ceilings, and its keys are the only accepted names.
  // An absent operand or `Nothing` gives the ceilings. Errors: the arity
  // codes, `invalid-permutation-options` (not a dictionary),
  // `unknown-permutation-option`, `incompatible-type` (a value that is not
  // an integer) and `permutation-option-exceeds-limit` (a value below 0 or
  // above the ceiling). A non-constant symbol, as the dictionary or as a
  // value, gives `undefined`.
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
  // Orbit queries. They walk the generator graph of the points and do not
  // build a stabilizer chain.
  //  - `orbits`: the partition of {1, …, n} into orbits, fixed points
  //    included. One budget is shared by all the orbits.
  //  - `orbit`: the orbit of one point.
  //  - `transversal`: for each point `t` of the orbit of `p`, a group element
  //    that maps `p` to `t`, as `Tuple(t, element)`.
  // Options: `maxPoints` and `maxEdges`; the transversal also accepts
  // `maxProducts`, `maxImageWork` and `maxStoredImages`. Errors:
  // `point-outside-permutation-action`, `permutation-orbit-*-limit`.
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
      // `settings` holds the orbit and the transversal names together.
      // `permutationOrbitLimits()` above and `permutationTransversalLimits()`
      // here each keep only their own names.
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
  // Queries that use a stabilizer chain (Schreier-Sims). The chain gives the
  // group order as the product of the orbit lengths at each level, and a
  // membership test by sifting. The chains come from the per-engine cache
  // `queries`.
  //  - `order`: |G|.
  //  - `contains`: whether the element is in G.
  //  - `stabilizer`: the subgroup of G that fixes the point. The chain is
  //    built with the point first in the base, and the generators of its
  //    second level are the result.
  //  - `subgroup`: whether every generator of H is in G.
  //  - `index`: |G| / |H|. Error `not-a-permutation-subgroup` when H is not
  //    a subgroup of G.
  //  - `equal`: H is a subgroup of G and |G| = |H|.
  //  - `normal`: H is a subgroup of G and g⁻¹hg is in H for each generator g
  //    of G and h of H.
  //  - `abelian`: every pair of generators commutes. This does not use a
  //    chain, but it uses the chain work limit.
  // The two groups of a relation must have the same action degree, else
  // `incompatible-permutation-actions`. Options: `maxWork`, `maxLevels`,
  // `maxOrbitEdges`, `maxOrbitPoints`, `maxStoredImages`. Errors:
  // `permutation-chain-*-limit` when a limit is reached.
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
      // `index` gives a `bigint`; the other relations give a boolean.
      return typeof result === 'bigint'
        ? ce.number(result)
        : result
          ? ce.True
          : ce.False;
    });
  // Operations on one or two permutations. Products use the right action
  // (the left factor acts first).
  //  - `cycles`: the disjoint cycles of length 2 or more, each one starting
  //    at its least point, in order of that point.
  //  - `order`: the least common multiple of the cycle lengths.
  //  - `power`: aᵏ for an exact integer k, negative values included. Errors:
  //    `invalid-permutation-exponent` (k is not an integer),
  //    `permutation-exponent-limit` (|k| has more than 16384 bits).
  //  - `conjugate`: b⁻¹ab, where a is the first operand and b the second.
  //    With a = [2, 3, 1] and b = [2, 1] the result is [3, 1, 2].
  //  - `commutator`: a⁻¹b⁻¹ab. With the same a and b the result is
  //    [2, 3, 1].
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
        // A number that is not an integer is an error. Another expression
        // that does not convert to an exact integer stays unevaluated when
        // it is not constant, and is an error when it is constant.
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
  // The operator definitions. The signatures use the three types declared
  // below; the engine refuses an operand of the wrong type with
  // `incompatible-type` before a handler runs. Every operator is pure: the
  // result depends only on the operands.
  const definitions: Record<string, OperatorDefinition> = {
    // Element operations: see `elementQuery()`.
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
    // The generator list exactly as given, after validation.
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
    // The identity permutation, `Permutation([])`. The group operand is read
    // only to validate it.
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
    // Stabilizer-chain queries: see `chainQuery()`.
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
    // Orbit queries: see `orbitQuery()`.
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
    // Constructors. `invokes: false` because the operands are data, not
    // functions to call. The `canonical` handler validates literal operands
    // when the expression is boxed, so an invalid literal becomes an
    // `Error(...)` expression at once. When an operand is not known yet,
    // the handler keeps the expression as given.
    PermutationGroup: {
      signature: '(list<Permutation>, PermutationAction) -> PermutationGroup',
      pure: true,
      invokes: false,
      canonical: (ops) => group(ops, true) ?? ce._fn('PermutationGroup', ops),
      evaluate: (ops) => group(ops),
      // No injective-constructor equality: distinct generators may generate
      // the same subgroup; PermutationGroupEqual is the explicit mathematical query.
    },
    // List every element of the group, by a breadth-first closure over the
    // generators. The identity comes first. Options: `maxElements`,
    // `maxProducts`, `maxImageWork`, `maxStoredImages`. Errors:
    // `permutation-closure-*-limit`. A limit error gives no partial list.
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
      // Two permutations are equal when their normalized images are equal,
      // so `[2, 1, 3]` equals `[2, 1]`. An operand that is not known yet or
      // not valid gives `undefined` (not decided), not `false`.
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
      // Two actions are equal when their degrees are equal.
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
    // The product ab in the right action: the image of i is b(a(i)).
    // With a = [2, 3, 1] and b = [2, 1] the result is [1, 3, 2].
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
    // Return the permutation unchanged when it fits the action. Error
    // `permutation-outside-action` when it moves a point above the degree.
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
    // The image of a point. Errors: `permutation-outside-action`, and
    // `point-outside-permutation-action` when the point is not in
    // {1, …, n}.
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
  Object.assign(
    definitions,
    exactGroupDefinitions(ce, finiteLimits, {
      readPermutation,
      readGroup,
      encodePermutation: encode,
      encodeGroup: (value) => {
        // Representation conversions can increase degree or generator storage.
        // Enforce the receiving engine's ceilings before publishing a new value.
        const action = new PermutationAction(value.action.degree, work);
        return encodeGroup(
          new PermutationGroupValue(value.generators, action, work)
        );
      },
      queryPermutation: (group, kind, maxWork, element) => {
        const limits = {
          ...chainLimits,
          maxWork: Math.min(chainLimits.maxWork, maxWork),
        };
        if (kind === 'order') return queries.order(group, limits, work);
        if (kind === 'contains')
          return queries.contains(group, element!, limits, work);
        return permutationGroupIsAbelian(group, limits, work);
      },
      queryPermutationRelation: (group, other, kind, maxWork) =>
        queries.relation(
          group,
          other,
          kind,
          { ...chainLimits, maxWork: Math.min(chainLimits.maxWork, maxWork) },
          work
        ),
    })
  );
  Object.assign(definitions, collectedPcDefinitions(ce, finiteLimits.maxWork));
  // Do not replace a definition that the host or another library made.
  for (const name of Object.keys(definitions)) {
    if (ce.lookupDefinition(name)) throw new Error(`Already defined: ${name}`);
  }
  // Roll back both types and operators if any registration fails. Checkpoints
  // also own the installed definitions; no module-global registry is needed.
  const checkpoint = ce.checkpoint();
  try {
    // `mint: false`: the type declaration does not also declare a
    // constructor operator of the same name. The operators `Permutation`,
    // `PermutationAction` and `PermutationGroup` declared below are the
    // constructors, with the validation above.
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
    ce.declareType(
      'GroupMatrix',
      'tuple<characteristic: integer, rows: list<list<rational>>>',
      { mint: false }
    );
    ce.declareType(
      'MatrixGroup',
      'tuple<dimension: integer, characteristic: integer, generators: list<GroupMatrix>>',
      { mint: false }
    );
    // Union aliases allow representation-specific methods to share honest signatures.
    ce.declareType('GroupDescriptor', 'PermutationGroup | MatrixGroup', {
      alias: true,
    });
    ce.declareType('GroupElement', 'Permutation | GroupMatrix', {
      alias: true,
    });
    ce.declareType(
      'GroupPcSequence',
      'tuple<group: GroupDescriptor, sequence: list<GroupElement>>',
      { mint: false }
    );
    ce.declareType(
      'GroupHomomorphism',
      'tuple<source: GroupDescriptor, target: GroupDescriptor, images: list<tuple<GroupElement, GroupElement>>>',
      { mint: false }
    );
    ce.declareType(
      'GroupQuotientValue',
      'tuple<source: GroupDescriptor, kernel: GroupDescriptor, projection: GroupHomomorphism>',
      { mint: false }
    );
    ce.declareType(
      'PcGroup',
      'tuple<orders: list<integer>, powers: list<list<integer>>, conjugates: list<list<list<integer>>>, inverseConjugates: list<list<list<integer>>>>',
      { mint: false }
    );
    ce.declareType(
      'PcElement',
      'tuple<group: PcGroup, coordinates: list<integer>>',
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
