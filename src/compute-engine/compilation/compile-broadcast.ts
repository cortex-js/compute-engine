// Broadcasting of element-wise operations over collections: the fused
// broadcast, plain broadcasts, and the Python element-wise path.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { provenPointWidth } from './javascript-value-facts.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  couldBeNumericTuple,
  isTuple,
  isTupleShapedType,
} from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  isPointElementType,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  typeContainsMissing,
  numericMissingSlot,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { isTensorValue } from '../boxed-expression/tensor-view.js';
import type { CompileTarget, CompiledFunction, TargetSource } from './types.js';
import { isCallerMapped } from './cse.js';
import { COMPLEX_CONTINUATION_HEADS } from './complex-continuation.js';
import {
  compilationType,
  isBoundPossiblyCollectionTyped,
  isDeclaredTopListOperand,
  isFlatAllStringComparisonParticipant,
  isGatedIndexedCollection,
  isGatedPoint,
  isProvablyStringComparisonParticipant,
  isProvablyStringOperand,
  isRuntimePointShaped,
  objectAbsenceLevels,
  pointHasBroadcastComponent,
  presentCompilationType,
  runtimePointShapeIsUnambiguous,
  typeMayHoldTuple,
  unfaithfulComparisonAggregate,
} from './compiler-type-facts.js';
import {
  _broadcastRadicalVerdict,
  isArrayOperand as isArrayOperand__,
  piMultiple,
  realPowerExponent,
} from './compile-real-analysis.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { core } from './compiler-core-hooks.js';
import {
  LOGICAL_BROADCAST_HEADS,
  NAN_PROPAGATING_BROADCAST_HEADS,
  ORDERING_HEADS,
  PLAIN_BROADCASTS,
  PLAIN_BROADCAST_MEMO_LIMIT,
  REPEATABLE_SOURCE,
} from './compiler-tables.js';
import { hasAnyComplexElement, linearAlgebraLane } from './compile-lanes.js';
import {
  isHypotPointLeg,
  isScalarElementSource,
  rotationView,
} from './compile-operators.js';
import {
  arrayLiteralElements,
  arrayLiteralWidth,
  hoistedListLiteralText,
  mayHoldPoint,
  staticBroadcastWidth,
} from './compile-linear-algebra.js';
import {
  DISPATCHING_BROADCAST_HEADS,
  continuesToComplex,
  dispatchingScalarBody,
} from './compile-complexness.js';
import {
  PROMOTABLE_RADICAL_HEADS,
  isRealOnlyLowering,
} from './compiler-mode.js';
import { _popLocalComplex, _pushLocalComplex } from './compile-loops.js';
import { compileValueOperand } from './compile-statements.js';
import { cseAdmission } from './compile-cse.js';
import { guardConnectiveAbsence } from './compile-conditionals.js';

export function tryCompileBroadcast(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The node being lowered, when the caller has it: its type decides
   * whether the result can be an absent object (see `absentMode`). */
  node?: Expression
): string | null {
  const def = engine.lookupDefinition(h);
  if (!isOperatorDef(def) || def.operator.broadcastable !== true) return null;

  // `sin(πu)`, `cos(πu)` and `tan(πu)` over a collection `u` in JavaScript:
  // each element takes the half-turn kernel (`_SYS.sinpi`, `_SYS.cospi`,
  // `_SYS.tanpi`, see `piMultiple`), as a scalar `u` does, so `sin(πL)` at
  // an integer element is `0`. The generic closure below would multiply
  // the element by `Math.PI` first.
  if (
    target.language === 'javascript' &&
    args.length === 1 &&
    (h === 'Sin' || h === 'Cos' || h === 'Tan')
  ) {
    const u = piMultiple(args[0]);
    if (u !== undefined && u.type.matches('collection<any>')) {
      const kernel =
        h === 'Sin' ? '_SYS.sinpi' : h === 'Cos' ? '_SYS.cospi' : '_SYS.tanpi';
      const p = tempVar(target);
      return `_SYS.bcast((${p}) => ${kernel}(${p}), ${core.compile(u, target)})`;
    }
  }

  // A definition may EXEMPT operand shapes from generic broadcasting
  // (`broadcastExemptions`): the interpreter then gives those shapes
  // dedicated semantics instead of mapping element-wise. This method
  // reproduces the exemption semantics of a fixed set of built-in heads —
  // the `Equal`/`NotEqual` decline and the `Multiply` tensor/tuple analysis
  // below, plus the heads (`Add`, `Negate`, `Subtract`, `Divide`) whose
  // exempted shapes are value-equivalent under an element-wise lowering
  // (tensor addition and tuple arithmetic ARE element-wise). Any OTHER
  // definition that declares exemptions — a user-defined operator, or a
  // redefined head this method does not analyze — must fail closed to the
  // interpreted path: emitting a generic `_SYS.bcast` for it would produce
  // an element-wise value where the interpreter, honoring the declaration,
  // does not broadcast. (`String` is deliberately absent from the set: its
  // single-collection call JOINS the collection's elements, which no
  // element-wise lowering reproduces.) Extend the set only together with a
  // matching carve-out or a value-equivalence argument like `Multiply`'s.
  if (
    def.operator.broadcastExemptions.length > 0 &&
    ![
      'Add',
      'Multiply',
      'Negate',
      'Subtract',
      'Divide',
      'Equal',
      'NotEqual',
    ].includes(h)
  )
    return null;

  // The ordering relations and the logical connectives broadcast too (they
  // return booleans rather than numbers, which is immaterial to the closure
  // below — `_SYS.bcast` maps whatever the scalar codegen returns). Two
  // relational shapes are NOT element-wise and stay excluded:
  //
  //  - `Equal`/`NotEqual` over two collections is WHOLE-COLLECTION equality
  //    in the interpreter (`Equal([1,2,3],[1,9,3])` is the scalar `False`,
  //    not `[True,False,True]`). They lower to the interpreter-faithful
  //    `_SYS.eq`/`_SYS.neq` dispatch, which already handles the list-vs-
  //    scalar element-wise case; broadcasting here would replace that scalar
  //    with a list.
  //  - a CHAINED ordering (`a < b < c`) needs ONE closure over all three
  //    operands (`(a<b) && (b<c)`), not this method's per-head closure —
  //    `compileJSCollectionBoolean` emits it.
  //
  // Heads with no JavaScript codegen (`Xor`, `Nand`, `Implies`, …) decline
  // below at the `target.functions` lookup, so they are unaffected.
  if (h === 'Equal' || h === 'NotEqual') return null;
  if (isRelationalOperator(h) && args.length > 2) return null;

  // For the boolean heads only, this fast path requires every collection-ish
  // operand to PROVABLY compile to a JS array. This is a ROUTING choice, not
  // a soundness gate: an operand whose array-ness is unprovable — a user
  // function application `q(L)`, a `broadcastable<T>` node — falls through to
  // `compileJSCollectionBoolean`, which dispatches on the RUNTIME shape
  // through `_SYS.bcast` (relaxed 2026-07-27, Tycho item 86). Both lowerings
  // agree; this one emits the tighter code and keeps the tuple / whole-
  // collection carve-outs above in one place.
  //
  // (Historical note: this used to be a fail-closed gate, because a compiled
  // `q(L)` applied SCALAR callee code to an array and returned NaN, which a
  // comparison then turned into a plausible `false`. The application site now
  // dispatches through `_SYS.bcastFn`, so `q(L)` is an array at run time.)
  //
  // Array-ness is provable for a concrete collection, a list-typed SYMBOL
  // (a parameter, which the caller supplies as a JS array), and an
  // application of a BUILT-IN `broadcastable` head over such an operand —
  // that one re-enters this method and broadcasts through `_SYS.bcast`
  // itself, which is what makes the Desmos mask `|L-2| > 0` sound.
  if (isRelationalOperator(h) || LOGICAL_BROADCAST_HEADS.has(h)) {
    const compilesToArray = (a: Expression): boolean => {
      // A TUPLE is an atomic point/vector, never a broadcast source — the
      // interpreter excludes it (`isBroadcastParticipant`,
      // `skipBroadcastForVectorOps`) and leaves `Less(Tuple(1,2), 3)` inert.
      // It lowers to a JS array all the same, so admitting it here compiled
      // that inert comparison into `[true, true]`.
      //
      // This test MUST stay ahead of the two below, and `isTuple` must stay
      // TYPE-based: `tuple<real,real>` matches `indexed_collection`, so a
      // tuple-TYPED symbol (`p: tuple<real,real>`) would otherwise be admitted
      // by the symbol branch, and a concrete tuple by the `isCollection`
      // branch. Reordering these reintroduces the bug.
      if (isTuple(a)) return false;
      // A STRING is an indexed collection of its grapheme clusters in the
      // type lattice, but it does NOT lower to a JS array and is atomic
      // under broadcast — it must reach the scalar path, exactly as before
      // strings became collections. Same placement rule as `isTuple` above:
      // ahead of the `isCollection` and symbol branches, both of which a
      // string now matches.
      if (isProvablyStringOperand(a)) return false;
      if (a.isCollection) return true;
      if (isSymbol(a))
        return (
          a.type.matches('list<any>') ||
          a.type.matches('indexed_collection<any>')
        );
      if (isFunction(a)) {
        const d = engine.lookupDefinition(a.operator);
        // A USER function's body is compiled as scalar code; only a built-in
        // broadcastable head lowers through the element-wise path.
        if (!isOperatorDef(d) || d.operator.broadcastable !== true)
          return false;
        return (a.ops ?? []).some(compilesToArray);
      }
      return false;
    };
    // Nothing provably array: ordinary scalar code, or an operand whose
    // array-ness is unprovable — either way, leave it to the scalar /
    // runtime-dispatch path.
    if (!args.some(compilesToArray)) return null;
    // A collection-ish operand alongside a provable array (`q(L) < M`) would
    // be broadcast against as if it were a scalar here. Defer to
    // `compileJSCollectionBoolean`, whose `_SYS.bcast` call passes BOTH
    // operands and so zips them at run time.
    if (
      args.some(
        (a) =>
          !compilesToArray(a) &&
          !isProvablyStringOperand(a) &&
          (a.type.matches('collection<any>') ||
            isBoundPossiblyCollectionTyped(a))
      )
    )
      return null;

    // Past this point a `_SYS.bcast` WILL be emitted for this head, so the
    // gates on the JavaScript ordering codegen apply here too — over
    // PARTICIPANTS rather than operands, because the scalar closure below
    // sees elements, not arrays.
    //
    // First, an AGGREGATE participant: a keyed collection has no positional
    // JS-array lowering, so the scalar closure would be handed whole objects.
    // (These shapes were declining through the string test below, which used
    // to read a dictionary's synthesized `tuple<string, V>` entry as string
    // evidence — see `unfaithfulComparisonAggregate`. A NESTED tuple is
    // untouched: a point list keeps broadcasting exactly as before.)
    if (ORDERING_HEADS.has(h)) {
      for (const a of args) {
        const aggregate = unfaithfulComparisonAggregate(a);
        if (aggregate !== null)
          throw new Error(
            `Could not compile \`${h}\`: an element-wise ordering over a ` +
              `${aggregate} participant. It has no positional JavaScript ` +
              `lowering the broadcast closure could compare, so the result ` +
              `would silently disagree with interpretation. The interpreter evaluates it instead.`
          );
      }
    }

    // …then the string rule of `assertNoMixedStringOrdering`
    // (javascript-target.ts). The operand-level
    // test never saw this shape: `Less("a", [1, 2])` compiled to
    // `[false, false]` while the interpreter leaves BOTH comparisons INERT
    // (`["a" < 1, "a" < 2]`) — and inert is not `false`.
    //
    // ALL-string still compiles, verified against interpretation:
    // `Less("a", ["x","y"])` → `[true, true]` and
    // `Less(["a","b"], ["a","c"])` → `[false, true]` both agree, because the
    // emitted `<` is the same raw JavaScript `<` the interpreter uses on
    // strings (`compare.ts`). Pinned in `compile-string-fail-closed.test.ts`.
    // Only those all-string shapes and the tensors of strings are admitted
    // (`isFlatAllStringComparisonParticipant`, the narrower `every` side).
    //
    // `Equal`/`NotEqual` cannot reach this point — they return `null` above
    // and are gated by `assertNoStringOperand` on their own codegen — so only
    // the ORDERINGS are tested in both gates here.
    if (
      ORDERING_HEADS.has(h) &&
      args.some(isProvablyStringComparisonParticipant) &&
      !args.every(isFlatAllStringComparisonParticipant)
    )
      throw new Error(
        `Could not compile \`${h}\`: an element-wise ordering that mixes string ` +
          `evidence with a participant that is not provably a string. The ` +
          `interpreter leaves such a comparison symbolic (\`Less("a", [1, 2])\` ` +
          `broadcasts to two INERT comparisons), whereas the emitted ` +
          `JavaScript \`<\` coerces and answers a plausible-looking ` +
          `\`false\` for each element. An ordering whose participants are ALL ` +
          `provably strings does compile — the interpreter compares strings ` +
          `with the same \`<\`. The interpreter evaluates it instead.`
      );
  }

  // A user `operators` override that lowers the head to a *function call*
  // (an identifier like `add(...)`, not a symbolic infix `+`) takes
  // responsibility for list operands (Issue #240) — don't intercept it.
  const opMap = target.operators?.(h);
  if (opMap !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]))
    return null;

  // A genuinely complex *element* type (`list<complex>`) — a `list<number>`
  // is treated as real, mirroring the scalar `isComplexValued` convention
  // (`number` matches neither `complex` nor `real`). Hoisted here so the
  // `Multiply` ≥2-possibly-collection branch below can reuse it: the real-only
  // `_SYS.mul` runtime helper cannot carry complex elements, so a complex
  // operand there must defer to the fail-closed path.
  const hasComplexElement = (a: Expression): boolean => {
    // The ELEMENTS the emitter will actually lower, when they can be seen.
    // The type test below cannot stand alone: a list mixing a complex and a
    // real element unifies to a WIDE element type (`[i·t, 1]` is
    // `vector<number^2>`, which is neither complex nor real), so it
    // answered `false` and the real-only element closure below was emitted
    // over an array whose first element is a `{re, im}` object. Measured on
    // the DEFAULT path with `h(t) := [i·t, 1]`: `2·h(t)` ran to `[NaN, 2]`
    // where the interpreter answers `[0.6i, 2]`.
    if (hasAnyComplexElement(a)) return true;
    const elt = collectionElementType(compilationType(a));
    if (elt === undefined) return false;
    return isNonRealNumber(elt);
  };

  // A LIST OF POINTS by its static type: a rank-1 list whose element type
  // is a tuple (a declared `list<tuple<number, number>>` parameter, a
  // literal point list, a `PointList` application) or a union of tuple
  // spellings, which is what a list literal of two differently typed points
  // infers (see `isPointElementType`). The interpreter gives
  // a point list the arithmetic of its elements — a point plus a scalar or
  // a product of two points is an error at every element — so the shapes
  // that decline for a single point must decline for a list of them too.
  // A possibly-collection operand is not a point list: its shape is
  // unprovable.
  const isPointListShaped = (a: Expression): boolean => {
    // A gated collection (a restricted list, typed `C | missing`) has the
    // shape of its present arm: it is not a possibly-collection operand.
    if (!isGatedIndexedCollection(a) && isBoundPossiblyCollectionTyped(a))
      return false;
    const t = presentCompilationType(a);
    if (
      typeof t !== 'string' &&
      t.kind === 'list' &&
      (t.dimensions?.length ?? 0) > 1
    )
      return false;
    return isPointElementType(collectionElementType(t));
  };

  // A `broadcastable<T>`-typed operand is scalar OR an indexed collection at
  // run time (the static type of arithmetic over an unknown-return call, e.g.
  // `2·h(x)` with `h: (number) -> unknown`). Routing it through `_SYS.bcast`
  // is correct for BOTH runtime outcomes: `bcast` applies the scalar closure
  // directly when no argument is an array and recurses element-wise otherwise.
  // The array-operand admission below uses `isBoundPossiblyCollectionTyped`,
  // which matches both the `broadcastable` kind AND a bound top-typed
  // application (an `unknown`/`any`/`value` call whose collection-ness is
  // unknowable); the `Multiply` ≥2-arrayish matrix-divergence carve-out uses
  // the same predicate, so any operand whose shape is unprovable — a declared
  // `broadcastable<…>` OR a top-typed application that could be a matrix at
  // run time — makes the carve-out fail closed.

  // Mirror the interpreter's `skipBroadcastForVectorOps` carve-outs
  // (`boxed-function.ts`) for the compile target, but only where element-wise
  // broadcast would produce a *different value* than the interpreter's
  // dedicated tensor/tuple handling (`mulTensors`).
  //
  // After Issue #29, `mulTensors` computes the **element-wise** (Hadamard)
  // product for two rank-1 vectors — exactly what `_SYS.bcast` produces — so
  // pure vector·vector `Multiply` may broadcast-compile. Two cases involving
  // ≥2 tensor/tuple operands still diverge from a plain broadcast and must
  // fail closed to the interpreter:
  //
  //  - a **numeric tuple** operand: `tuple·tuple` is an interpreter error (no
  //    implicit dot/cross), so keep it failing closed rather than silently
  //    Hadamard-ing it;
  //  - a **rank-≥2 tensor** (matrix): `matrix·matrix`, `matrix·vector`,
  //    `vector·matrix` **contract** via the matrix product, which `_SYS.bcast`
  //    would not reproduce.
  //
  // Two rank-1 vectors of statically-known, differing lengths are also
  // declined: the interpreter stays inert (typically NaN in a real target)
  // whereas `_SYS.bcast` zips to the shorter length — a value divergence we
  // avoid where the mismatch is provable at compile time.
  //
  // Operands are counted by TYPE as well as by materialized value: a
  // `vector<n>`/`list`-typed *symbol* is not a tensor but lowers to a JS
  // array at run time, so it participates in the ≥2-operand test and a
  // `matrix`-typed symbol fails closed like a literal matrix (compiling it
  // through `_SYS.bcast` would Hadamard where the interpreter contracts).
  // The products of matrices whose ranks the types give are emitted
  // before this method runs (`compileMatrixProduct`); a matrix reaches
  // this point beside an operand that may hold a point, one that is
  // gated, or one that may be a number or a list at run time (the last
  // takes the run-time product `_SYS.mulChecked` below).
  // Equal- or unknown-length typed vectors still compile: for symbol
  // operands the interpreter broadcasts element-wise too.
  //
  // Single-operand cases (scalar·vector, scalar·tuple) are untouched: they
  // broadcast element-wise in both the interpreter and `_SYS.bcast` (see
  // `compile-fallback.test.ts`).
  // The one operand a nested emission keeps WHOLE while the others broadcast
  // — a numeric tuple multiplied by a list (set in the `Multiply` carve-out
  // below, consumed at the emission at the end of this method).
  let atomicTuple: Expression | undefined;
  // Set with `atomicTuple` when the OTHER operand is a list of POINTS (the
  // `Add` point-list shape below): the outer level must then map exactly
  // one level deep, where `_SYS.bcast` would descend into each point.
  let atomicTupleOverPoints: false | 'static' | 'runtime' | 'runtime-list' =
    false;
  // The operand whose shape the `'runtime'` lift tests when emitting.
  let runtimePointOperand: Expression | undefined;

  // A GATED POINT (`isGatedPoint`: a restricted point such as
  // `When((0, 1), c)`, a point or the absent value at run time) broadcasts
  // as a point does, but the point plans in this method test for a point
  // by its tuple type, which the `missing` arm hides. So only the shapes
  // the interpreter computes component-wise are admitted here: the gated
  // point is the one array operand and every other operand is a number,
  // with the gated point as the dividend of a `Divide`. Everything else
  // declines, and the fail-closed guard of the caller refuses the form:
  // two points have no product (`no-product-between-points`), a number
  // cannot be divided by a point (`no-division-by-point`), and a point
  // beside a list is a list of points in the interpreter, which a flat
  // broadcast would zip instead. A SUM keeps the point plans below: they
  // read a gated point beside another point as a point-or-list decided at
  // run time (`isRuntimePointShaped`), which is correct for it. But every
  // other term of the sum must then be a point or a list of points: a
  // point does not add to a number (`incompatible-type`), and `t + P` for
  // an undeclared `t` is not rejected at canonicalization.
  const gatedPoints = args.filter((a) => isGatedPoint(a));
  if (
    gatedPoints.length > 0 &&
    (h === 'Add' || h === 'Subtract') &&
    !args.every(
      (a) =>
        couldBeNumericTuple(a) ||
        isGatedPoint(a) ||
        isRuntimePointShaped(a) ||
        isPointListShaped(a)
    )
  )
    return null;
  if (gatedPoints.length > 0 && h !== 'Add' && h !== 'Subtract') {
    if (gatedPoints.length > 1) return null;
    const otherArrays = args.filter(
      (a) => a !== gatedPoints[0] && isArrayOperand__(a, target)
    );
    // One exception: a LIST OF NUMBERS times a gated point
    // (`[1,2,3]·P{c}`) is a list of scaled points in the interpreter, as it
    // is for a point without a condition. It takes the same nested
    // emission as the `Multiply` point-family shape below (`atomicTuple`):
    // the outer broadcast walks the list and the gated point is kept
    // whole. The other array operands must provably hold numbers
    // (`isScalarElementSource`), or the outer broadcast would descend into
    // a point. When the point is absent, every element is `undefined`, as
    // the interpreter answers `Missing` for each (`_SYS.bcastAbsent`).
    if (otherArrays.length > 0) {
      if (
        h !== 'Multiply' ||
        !otherArrays.every(
          (a) => !couldBeNumericTuple(a) && isScalarElementSource(a, target)
        )
      )
        return null;
      atomicTuple = gatedPoints[0];
    }
    if (h === 'Divide' && args[0] !== gatedPoints[0]) return null;
  }

  if (h === 'Multiply') {
    // A POINT operand is read by the COULD-form (`couldBeNumericTuple`):
    // a tuple whose component types are only possibly numeric is a point
    // too. `PointList(t, 1)` with `t` free types `tuple<unknown, integer>`.
    // (A tuple with a LIST coordinate never reaches this route: the LaTeX
    // `(-6, [4, 5, 6])` is a `PointList` of three points, and a code-built
    // `Tuple` with a list coordinate is declined before the lowerings run,
    // see `isTupleWithListCoordinate` in `compileExpr`.)
    // The strict `isNumericTuple` rejects it, so the point was not kept
    // atomic and the flat `_SYS.bcast` zipped its components against the
    // list: `[1, 2, 3]·PointList(t, 1)` ran to `NaN` where the
    // interpreter answers `[(t, 1), (2t, 2), (3t, 3)]`.
    const isPointOperand = (a: Expression): boolean => couldBeNumericTuple(a);
    const isArrayish = (a: Expression): boolean =>
      // A string matches `indexed_collection` but is not array-shaped — see
      // `compilesToArray` above.
      !isProvablyStringOperand(a) &&
      (isTensorValue(a) ||
        isPointOperand(a) ||
        a.type.matches('list<any>') ||
        a.type.matches('indexed_collection<any>') ||
        isBoundPossiblyCollectionTyped(a, target));
    const collection = args.filter(isArrayish);
    if (collection.length >= 2) {
      const isMatrix = (a: Expression): boolean =>
        (isTensorValue(a) && a.shape.length >= 2) || a.type.matches('matrix');
      const hasMatrix = args.some(isMatrix);
      // An operand that may be a number or a list at run time (a
      // `broadcastable<T>`, the fold `Sum(L)`) beside a matrix takes the
      // run-time product below (`_SYS.mulChecked`), which computes the
      // matrix product when a factor holds a matrix.
      // `compileMatrixProduct` leaves such an operand to this method, and
      // `Sum(L)·M` with `L: list<matrix<number>>` was refused. A matrix
      // beside no such operand is refused here, as before.
      const runtimeShaped = collection.some((a) =>
        isBoundPossiblyCollectionTyped(a, target)
      );
      if (hasMatrix && !runtimeShaped) return null;
      // Two POINT-SHAPED operands — a numeric tuple, or a list whose
      // elements are provably tuples — have no product: the interpreter
      // answers the `no-product-between-points` error (at every element,
      // for two point lists). A flat `_SYS.bcast` zipped two point lists
      // into the component-wise product `[(1,4),(9,16)]` behind
      // `success: true` (Tycho item 245). The single-tuple case is refined
      // below; two or more point-shaped operands decline here.
      if (
        collection.filter((a) => isPointOperand(a) || isPointListShaped(a))
          .length > 1
      )
        return null;
      // ONE numeric tuple among list operands is the point-family shape
      // `[1,2,3]·(cos a, sin a)`: the interpreter broadcasts over the LIST
      // and scales the point whole at every element, answering a list of
      // points. A flat `_SYS.bcast` over both arrays would zip the point
      // against the list instead, and the `_SYS.mul` runtime below would
      // Hadamard it. The point is kept ATOMIC — see the nested emission at
      // the end of this method (`atomicTuple`) — provided every other
      // array operand is a source of SCALARS: the outer broadcast descends
      // into whatever arrays it is handed, so a list of points
      // (`[(1,2),(3,4)]·(1,0)`, a `tuple·tuple` error per element in the
      // interpreter) or a source whose element kind is unprovable must
      // decline. A `broadcastable<number>` source is admitted: at run time
      // it is a scalar (the outer broadcast applies the closure once — a
      // point) or a list of numbers (a list of points), both what the
      // interpreter answers. Two or more tuples stay declined: `tuple·tuple`
      // is an interpreter error (no implicit dot/cross).
      const tuples = collection.filter((a) => isPointOperand(a));
      if (tuples.length > 1) return null;
      if (tuples.length === 1) {
        if (
          !collection.every(
            (a) => a === tuples[0] || isScalarElementSource(a, target)
          )
        )
          return null;
        atomicTuple = tuples[0];
      }
      // A possibly-collection operand (a declared `broadcastable<T>` OR a
      // top-typed application such as `h(x)`) could materialize as a scalar,
      // a vector, OR a MATRIX at run time — the shape is unprovable at compile
      // time. `_SYS.bcast` would Hadamard unconditionally, diverging from the
      // interpreter's matrix contraction; instead emit the interpreter-faithful
      // `_SYS.mul`, which dispatches on runtime rank (Hadamard for equal-length
      // rank-1 vectors, matrix product for rank-≥2), so no shape silently
      // diverges. Complex operands can't route through the real-only helper —
      // defer those to the fail-closed path. (With a point among the
      // operands this path is never taken: the point plan above either
      // admitted the shape or declined it.)
      //
      // Beside an operand whose type may hold points (a list of points, a
      // bare `list`), `_SYS.mul` would read a list of points as a matrix
      // and take a matrix product: `b·a` with `a` holding `[(1, 2), (3,
      // 4)]` and `b` holding `[2, 3]` gave `[11, 16]`, where the interpreter
      // scales each point, `[(2, 4), (9, 12)]`. The element-wise code below
      // pairs each number with a point, as the interpreter does.
      // An operand declared `any` read as a possible list by the run-time
      // check of `declaredTopGuard` may hold points too, so it takes the
      // entry-wise code, as a bare `list` does.
      const pointHolder = collection.some(
        (a) =>
          isDeclaredTopListOperand(a) ||
          (!isBoundPossiblyCollectionTyped(a, target) &&
            typeMayHoldTuple(a.type.type))
      );
      // A matrix beside an operand that may hold points at run time (the
      // sum of a list of lists of points, `At(L, 1)` over such a list, a
      // `list<any>`): `_SYS.mulChecked` would read a list of points as a
      // matrix and compute a matrix product, where the interpreter scales
      // the entries of the matrix by the points. `pointHolder` does not
      // test the operands that may be a number or a list, so this test
      // reads them all, as `compileMatrixProduct` does (`mayHoldPoint`).
      // An operand typed `unknown` or `any` (`Reduce(L, Add, 0)` over
      // `list<list<unknown>>`) states no shape, and keeps the run-time
      // product, as before.
      if (
        hasMatrix &&
        args.some(
          (a) =>
            !isMatrix(a) &&
            a.type.type !== 'unknown' &&
            a.type.type !== 'any' &&
            mayHoldPoint(engine, a)
        )
      )
        return null;
      if (atomicTuple === undefined && !pointHolder && runtimeShaped) {
        // An operand in the complex lane takes the complex form,
        // `_SYS.cmulChecked`: the real `_SYS.mulChecked` multiplies two
        // vectors or a scalar with `*`, which reads a `{re, im}` entry as
        // `NaN`. Its matrix product (`matrixProductShape`) reads complex
        // entries in both forms; a scalar result is always `{re, im}` in
        // the complex form, as the parent expects. `linearAlgebraLane`
        // also reads an operand whose type is a union with an absent arm
        // (`At(P, 1)` with `P: list<matrix<complex^(2x2)>>` is typed
        // `matrix<complex^2x2> | missing`), which the two other tests miss.
        const complex = args.some(
          (a) =>
            core.isComplexValued(a) ||
            hasComplexElement(a) ||
            linearAlgebraLane([a]) === 'complex'
        );
        const compiledArgs = args
          .map((a) => core.compile(a, target))
          .join(', ');
        return `_SYS.${complex ? 'cmulChecked' : 'mulChecked'}(${compiledArgs})`;
      }
      // A matrix beside a point, or beside an operand that may hold
      // points: the element-wise code below would not compute the matrix
      // product.
      if (hasMatrix) return null;
      // Statically-known mismatched rank-1 lengths: fail closed.
      const lengths = collection
        .filter((a) => isTensorValue(a) && a.shape.length === 1)
        .map((a) => a.shape[0]);
      if (lengths.length >= 2 && new Set(lengths).size > 1) return null;
    }
  }

  // A LIST OF POINTS times, or divided by, an array operand: the flat
  // `_SYS.bcast` below pairs the i-th point with the i-th element of the
  // other operand and, when that element is an array too, pairs the
  // components of the point with the entries of that array. The
  // interpreter applies the point whole to each entry instead: with
  // `p = [(1, 2), (3, 4)]` and `q = [[1, 2], [3, 4]]`, `p·q` is
  // `[[(1, 2), (2, 4)], [(9, 12), (12, 16)]]`, where the flat broadcast
  // gave `[[1, 4], [9, 16]]`. So an array operand beside a list of points
  // must be a flat list of scalars (a `list<number>`, a `vector<n>`;
  // `isScalarElementSource`), which the flat broadcast pairs correctly.
  // The run-time plan `pointListOverNumbers`, emitted below, takes exactly
  // one shape: TWO operands, a list of points and an operand typed
  // `broadcastable<E>`, `tensor<E>` or a nested list (`list<list<E>>`)
  // whose leaves are numbers (`numberLeaves`; for a `Divide`, the list of
  // points is the dividend). Each point is kept whole and applied to each
  // number of its element. Every other operand beside a list of points
  // that is not a flat list of scalars is refused on purpose, and the
  // fail-closed guard of the caller refuses the form: an operand whose
  // cells may be points or values of unknown kind (a `list<unknown>`, a
  // call typed `unknown`, a `broadcastable<tuple<…>>`), a union of a
  // number and a `broadcastable` (`number | broadcastable<real>`), and a
  // product of three or more operands (`2·p·b`). A declared `matrix<…>`
  // times a list of points is refused as well, by the matrix rule of the
  // `Multiply` carve-out above; a list of points divided by a declared
  // matrix takes the plan (each point divided by each number of its row).
  // Each refused shape compiled to a wrong value before (ROADMAP CE-504).
  let pointListOverNumbers: number | undefined;
  if (
    (h === 'Multiply' || h === 'Divide') &&
    atomicTuple === undefined &&
    args.some(isPointListShaped)
  ) {
    const flatScalars = (a: Expression): boolean => {
      const t = compilationType(a);
      if (typeof t !== 'string' && t.kind === 'broadcastable') return false;
      return isScalarElementSource(a, target);
    };
    const deep = args.filter(
      (a) =>
        !isPointListShaped(a) && isArrayOperand__(a, target) && !flatScalars(a)
    );
    if (deep.length > 0) {
      const numberCells = (a: Expression): boolean => {
        const t = compilationType(a);
        const broadcastable =
          typeof t !== 'string' && t.kind === 'broadcastable';
        if (!broadcastable && isBoundPossiblyCollectionTyped(a, target))
          return false;
        // The leaves are read through the list, tensor and broadcastable
        // constructors, and through unions. A tuple at any depth is
        // refused: `broadcastCellType` reads a tuple as its components, so
        // `broadcastable<tuple<integer, integer>>` would pass as numbers,
        // and the product of two points has no value
        // (`no-product-between-points`).
        const numberLeaves = (x: Type, depth = 0): boolean => {
          if (depth > 16) return false;
          const r = resolveTypeAlias(x);
          if (r === 'never') return false;
          if (typeof r === 'string') return isSubtype(r, 'number');
          if (r.kind === 'tuple') return false;
          if (r.kind === 'list' || r.kind === 'broadcastable')
            return numberLeaves(r.elements, depth + 1);
          // A union at the top (`number | broadcastable<real>`) is not
          // read; a union of cells below a constructor is.
          if (r.kind === 'union')
            return (
              depth > 0 && r.types.every((m) => numberLeaves(m, depth + 1))
            );
          return isSubtype(r, 'number');
        };
        return numberLeaves(t);
      };
      const pointList = args.findIndex(isPointListShaped);
      if (
        args.length !== 2 ||
        deep.length !== 1 ||
        !numberCells(deep[0]) ||
        (h === 'Divide' && pointList !== 0)
      )
        return null;
      pointListOverNumbers = 1 - pointList;
    }
  }

  // A head with NO codegen at all has nothing to broadcast — decline (the
  // caller's fail-closed guard covers it). A *string*-mapped head (a scalar
  // helper such as `Sign` → `Math.sign`, `Arctan2` → `Math.atan2`, `Hypot` →
  // `Math.hypot`, `Sinc` → `_SYS.sinc`) has no array codegen of its own, but
  // it does have a scalar call form — the closure below wraps that call the
  // same way it wraps function codegen, so those heads broadcast too instead
  // of failing closed.
  const fn = target.functions?.(h);
  if (fn === undefined) return null;

  // An operand lowers to a JS array at run time when it is a concrete
  // collection, is statically list/collection-typed (a symbolic list
  // parameter), or is possibly-collection-typed — a `broadcastable<T>` node
  // OR a top-typed application (`unknown`/`any`/`value` call such as `h(x)`),
  // both scalar OR array at run time, which `_SYS.bcast` handles either way.
  // If none is, this is ordinary scalar code — leave it be.
  // (A string matches `indexed_collection` but is not array-shaped — see
  // `compilesToArray` above; `isArrayOperand` excludes it.)
  // The target is passed: a value this emission proves scalar by
  // CONSTRUCTION — an explicitly declared scalar input, scalar arithmetic
  // over such values, or a call of a user function whose body yields a
  // scalar under scalar parameters — is never an array at run time, so the
  // head compiles as ordinary scalar code instead of dispatching through
  // `_SYS.bcast`. (The Tycho code-generation audit of 2026-09-08 measured
  // 496 such dispatches over user-function results.)
  const isArrayOperand = (a: Expression): boolean =>
    isArrayOperand__(a, target);
  if (!args.some(isArrayOperand)) return null;

  // A numeric tuple SUMMED with, or DIVIDED into, a list is not a
  // broadcast in the interpreter: `(1,2) + [3,4]` is a per-element
  // `incompatible-type` error (a point does not add to a scalar) and
  // `[1,2] / (1,2)` is a division by a point. A flat `_SYS.bcast` would zip
  // the two arrays into the plausible `[4, 6]` / `[1, 1]` behind
  // `success: true`. Decline, so the D6 guard fails closed and the
  // interpreter answers. (`Multiply` is the broadcast case, handled above;
  // a point DIVIDED BY a list of numbers is a list of points, handled in
  // the point plan below; `Power` over a tuple and a list is element-wise
  // in the interpreter too and keeps compiling.)
  // A possibly-collection operand (`broadcastable<T>`, a top-typed call)
  // counts as a list here even though it may be a scalar at run time — the
  // shape is unprovable, and declining an unprovable shape is the D6 rule.
  //
  // ONE exception is a broadcast in the interpreter and compiles: a point
  // SUMMED with a list of POINTS (`[(0,0),(3,4)] + (1,2)` is
  // `[(1,2),(4,6)]` — the point is added to every element). The point is
  // kept ATOMIC through the nested emission at the end of this method
  // (`atomicTuple`), exactly as the `Multiply` point-family shape above:
  // a flat `_SYS.bcast` would zip the point's components against the
  // list's elements instead. The list operands must PROVABLY hold points
  // (their element type is a tuple; a declared `list<tuple<number,
  // number>>` parameter qualifies, a bare `list` or a possibly-collection
  // operand does not), and there must be exactly one point: two points
  // in the same sum would need one nested level per point.
  //
  // The tuple test is the COULD-form (`couldBeNumericTuple`): a tuple whose
  // components are undeclared symbols types `tuple<unknown, unknown>`,
  // which the strict `isNumericTuple` rejects. Such a tuple used to escape
  // this decline and was zipped flat against the list: `4P + 0.3(t, 2t)`
  // over a list of points ran to `[(4x + 0.3t, 4y + 0.3t), …]` — the
  // SECOND component scaled by the first — behind `success: true` (Tycho
  // item 234).
  // A point is a single leg of a hypotenuse, not a set of legs to pair with
  // the other operand: it enters the sum of squares through its own norm, so
  // `Hypot((3, 4), 1)` is √(‖(3,4)‖² + 1²) = √26. The interpreter computes
  // it that way (`library/trigonometry.ts`, the `Hypot` handler). Pairing
  // each component with the other leg would instead produce the list
  // `[hypot(3,1), hypot(4,1)]` and report success. Leave the operand to the
  // target's own `Hypot` code, which takes the point as one leg, or refuses
  // the expression when the point's component is itself a list.
  // When something broadcasts — a list leg, or a point whose component is
  // a list — the point leg is rewritten to its NORM, `Hypot(Norm(P), y)`,
  // and the rewritten application is compiled in its place: a plain point
  // lowers through the `Norm` codegen to the scalar `_SYS.norm([3, 4])`,
  // and a point whose component is a list — one point per element in the
  // interpreter, so one norm per element — lowers to a LIST of norms, which
  // then broadcasts here like any list leg (`Hypot(([1, 2], 3), 4)` is
  // `[√26, √29]`, and with a list other leg `[4, 5]` it is `[√26, √38]`,
  // the interpreter's zip of the two lists). The rewrite is applied once —
  // a rewritten application has no point leg left — and the `Norm` codegen
  // owns the per-element emission. With only scalar legs beside a plain
  // point nothing broadcasts, and the target's own `Hypot` codegen takes
  // the point as one leg (`Math.hypot(_SYS.norm([3, 4]), 1)`).
  if (args.some((a) => isHypotPointLeg(h, a))) {
    const broadcasts = args.some((a) =>
      isHypotPointLeg(h, a) ? pointHasBroadcastComponent(a) : isArrayOperand(a)
    );
    if (!broadcasts) return null;
    const legs = args.map((a) =>
      isHypotPointLeg(h, a)
        ? engine.function('Norm', [a], { form: 'structural' })
        : a
    );
    return core.compile(
      engine.function('Hypot', legs, { form: 'structural' }),
      target
    );
  }

  // A list of POINTS summed with a SCALAR-shaped operand — a number, or a
  // list of numbers — is `point + scalar` at every element, which the
  // interpreter answers as an `incompatible-type` error per element. The
  // flat `_SYS.bcast` descended into each point and added the scalar to
  // both components (`[(1,2),(3,4)] + 10` ran to `[(11,12),(13,14)]`
  // behind `success: true`, Tycho item 245). Every co-operand of a point
  // list must itself be a point (broadcast over the list, handled below)
  // or a point list (zipped element-wise); anything else declines.
  // `Subtract` is listed for the structural spelling: the canonical form
  // is `Add(a, Negate(b))`, and `Negate` of a point list is a point list.
  if (
    (h === 'Add' || h === 'Subtract') &&
    args.some(isPointListShaped) &&
    args.some((a) => !isPointListShaped(a) && !couldBeNumericTuple(a))
  )
    return null;
  // Dividing BY a point list is `x / point` at every element: the
  // interpreter's `no-division-by-point` error. Only a point list in the
  // dividend position (`P / 2`, `P / L`) scales points.
  if (h === 'Divide' && args.length === 2 && isPointListShaped(args[1]))
    return null;

  // A point ADDED to an operand whose shape is only known at run time — a
  // parameter declared with the point-or-point-list union — is the `Add`
  // point-list shape below when the operand turns out to be a list of
  // points (the point is added to EVERY element) and a plain point sum
  // when it is a point. Neither is provable here, and
  // the flat `_SYS.bcast` zipped a list of points against the point's
  // components (`[(5,1),(4,2)] − (4,0)` gave `[(1,−3),(4,2)]`). The outer
  // level is therefore decided at run time (see the emission at the end
  // of this method): an array of arrays maps, anything else zips. Every
  // OTHER operand must be tuple-valued — one or more of them, since
  // canonicalization flattens a chain of point subtractions into ONE
  // n-ary `Add` (`P − (4, 0) − 2(H(i+.2), H(i+.4))` is a three-operand
  // sum) — so that the closure applied per element is the point sum in
  // both cases (Tycho item 253).
  // The point is read by the COULD-form (`couldBeNumericTuple`): a point
  // whose component types are only possibly numeric (`PointList(t, 1)`
  // with `t` free, typed `tuple<unknown, integer>`) is a point too. Read
  // by the strict `isNumericTuple`, `W + PointList(t, 1)` escaped this lift
  // and was zipped flat: `W = [(1, 1), (2, 2)]` ran to `[[3, 3], [3, 3]]`
  // where the interpreter answers `[(3, 2), (4, 3)]` at `t = 2`.
  if (h === 'Add' && atomicTuple === undefined) {
    const provable = args.filter(
      (a) => !isRuntimePointShaped(a) && couldBeNumericTuple(a)
    );
    const runtime = args.filter(
      (a) => !provable.includes(a) && isRuntimePointShaped(a)
    );
    if (
      provable.length >= 1 &&
      runtime.length === 1 &&
      args.every((a) => a === runtime[0] || couldBeNumericTuple(a))
    ) {
      atomicTuple = provable[0];
      atomicTupleOverPoints = 'runtime';
      runtimePointOperand = runtime[0];
    }
  }

  // The run-time lift above has already chosen the emission for this node.
  // The static point-list plan below can `return null` (it declines every
  // shape it does not prove), which would throw that plan away and fail
  // the form closed, so it must not run once the run-time plan is set.
  if (atomicTupleOverPoints !== 'runtime' && (h === 'Add' || h === 'Divide')) {
    const tuples = args.filter((a) => couldBeNumericTuple(a));
    const lists = args.filter(
      (a) => !couldBeNumericTuple(a) && isArrayOperand(a)
    );
    // A point DIVIDED by a list of numbers is a list of points in the
    // interpreter: `(1, 2) / [1, 2]` is `[(1, 2), (1/2, 1)]`, the point
    // divided by each element, as `(1, 2) · [1, 1/2]` is the point
    // scaled by each element. It takes the nested emission of the
    // `Multiply` point-family shape (`atomicTuple`): the outer broadcast
    // walks the list and the point is kept whole. The point must be the
    // dividend, and the divisor a source of SCALARS
    // (`isScalarElementSource`), or the outer broadcast would descend
    // into a point. A matrix divisor stays inert in the interpreter and
    // declines here.
    if (
      h === 'Divide' &&
      args.length === 2 &&
      tuples.length === 1 &&
      tuples[0] === args[0] &&
      lists[0] === args[1] &&
      !(
        (isTensorValue(args[1]) && args[1].shape.length >= 2) ||
        args[1].type.matches('matrix')
      ) &&
      isScalarElementSource(args[1], target)
    )
      atomicTuple = args[0];
    else if (tuples.length > 0 && lists.length > 0) {
      // The list must PROVABLY hold points: every element is a tuple whose
      // components are numeric, and its arity, when both are known,
      // matches the point's. The tuple is compared by its known component
      // count only: a `tuple<unknown, unknown>` point is admitted for its
      // arity, not for its component types. A COMPLEX component is
      // admitted: the element-lane analysis below sees it as a lane it
      // cannot decide, and `Add` then lowers to the run-time dispatching
      // `_SYS.sadd` (Tycho item 246: a Desmos polygon column carries
      // `√-1` as its "undefined vertex" separator).
      const isProvablyPointList = (a: Expression): boolean => {
        if (!isGatedIndexedCollection(a) && isBoundPossiblyCollectionTyped(a))
          return false;
        const elt = collectionElementType(presentCompilationType(a));
        if (elt === undefined || typeof elt === 'string') return false;
        if (elt.kind !== 'tuple') return false;
        if (!elt.elements.every((c) => isSubtype(c.type, 'number')))
          return false;
        const pt = resolveTypeAlias(tuples[0].type.type);
        return (
          typeof pt === 'string' ||
          pt.kind !== 'tuple' ||
          pt.elements.length === elt.elements.length
        );
      };
      // Exactly the two-operand shape: a third SCALAR operand mixed into a
      // point sum is a per-element `incompatible-type` error in the
      // interpreter, not a broadcast.
      if (
        h !== 'Add' ||
        args.length !== 2 ||
        tuples.length !== 1 ||
        lists.length !== 1 ||
        !isProvablyPointList(lists[0])
      )
        return null;
      atomicTuple = tuples[0];
      // An operand that may be a point OR a list of points at run time
      // (`isRuntimePointShaped`: the union a document helper declares for
      // its result) beside a list of points is decided by its shape at run
      // time (the `'runtime-list'` emission below): a list of points is
      // zipped against the list, a point is added to every point of the
      // list. Kept atomic in the static plan it was added whole to every
      // point, which answered NaN at every element when the value was a
      // list of four points (the audit document `njncrg9fkv`, `W(…) +
      // PointList(…)` with `W` declared to return a point or a list of
      // points).
      if (isRuntimePointShaped(tuples[0])) {
        // The run-time test reads the value's SHAPE: an array of arrays is
        // a list of points, a flat array a point. A union whose arms can
        // give both shapes to one kind of value — a point with a LIST
        // coordinate, or a collection arm that admits plain numbers, so
        // that a flat array of numbers looks like a point — cannot be
        // decided that way and fails closed, naming the declaration.
        if (!runtimePointShapeIsUnambiguous(tuples[0]))
          throw new Error(
            `Could not compile \`Add\`: the operand of type ` +
              `\`${typeToString(tuples[0].type.type)}\` may be a point ` +
              `or a list of points at run time, and its declaration also ` +
              `admits a value whose run-time shape is the same as a ` +
              `point's (a point with a collection coordinate, or a list ` +
              `of numbers), so the sum with a list of points cannot be ` +
              `decided by the value's shape. Declare the operand as a ` +
              `point, or as a list of points (\`list<tuple<…>> | ` +
              `tuple<…>\`).`
          );
        runtimePointOperand = tuples[0];
        atomicTupleOverPoints = 'runtime-list';
      } else atomicTupleOverPoints = 'static';
    }
  }

  // A point SUMMED with a scalar is a per-element `incompatible-type` error
  // in the interpreter: `(1, 2) + 3`, and `(x, y) + 3` whatever `x` and `y`
  // hold, since a tuple never adds to a number. The generic closure below
  // answered the plausible `[4, 5]` behind `success: true` (measured:
  // `(x, y) + 3` ran to `[3.3, 3.7]` at `x = 0.3, y = 0.7`), so the shape
  // declines and the D6 guard fails closed. Decided on PROVABLE evidence
  // only — a tuple-shaped operand type beside a provably numeric operand.
  // An operand whose type is open (an undeclared `z`) may hold a point at
  // run time, and the closure then sums component-wise as the interpreter
  // does.
  if (
    h === 'Add' &&
    atomicTuple === undefined &&
    args.some((a) => isTupleShapedType(compilationType(a))) &&
    args.some((a) => a.type.matches('number'))
  )
    return null;

  // What the closure's element parameter for each operand holds at run time:
  // `true` for a `{re, im}` object, `false` for a plain number, `'mixed'`
  // when the elements do not all share one shape or the shape cannot be
  // decided (`operandElementLane`). A closure built from the head's own
  // scalar codegen is emitted once for every position, so it needs one
  // shape per operand. A `'mixed'` operand can still be broadcast by a head
  // that has a RUN-TIME DISPATCHING scalar helper (`_SYS.sadd`/`_SYS.smul`
  // accept a number or a `{re, im}` object in either position); every other
  // head declines. Before the dispatching lowering, a `√(t−1)` beside a `1`
  // in one list, or a point list whose declared column type is `complex`,
  // failed closed here — measured with a real closure over such an array,
  // `2·[1+i, 2]` ran to `[{re: 2, im: 2}, {re: NaN, im: NaN}]` where the
  // interpreter answers `[2+2i, 4]`.
  const argLanes = args.map((a) => core.operandElementLane(a, engine, target));
  if (argLanes.some((l) => l === undefined)) return null;
  const anyMixed = argLanes.some((l) => l === 'mixed');
  const dispatch = anyMixed && DISPATCHING_BROADCAST_HEADS.has(h);
  // A head with no dispatching helper reads a `'mixed'` operand through a
  // NORMALIZED element: the closure coerces that element to a `{re, im}`
  // object on entry (`_SYS.cplx`: a plain number gets a zero imaginary part,
  // an object passes through), so the head's complex lowering sees one shape
  // at every position. This is what an element-wise `Which` with a complex
  // arm beside a real one needs — its cells are `{re, im}` where the complex
  // arm was selected and plain numbers elsewhere — and before it
  // `Abs(Which(0 < L, i·L, True, 0))` declined while the scalar form, which
  // promotes the real arm itself, compiled. The gates below then apply as
  // they do to a complex operand: a head with no complex lowering declines.
  // Only the JavaScript runtime has the coercion helper.
  const normalized = argLanes.map(
    (l) => l === 'mixed' && !dispatch && target.language === 'javascript'
  );
  if (anyMixed && !dispatch && !normalized.some((n) => n)) return null;
  const argIsComplex = argLanes.map((l, i) => l === true || normalized[i]);
  const anyComplex = argIsComplex.some((c) => c);

  // A STRING-mapped head is a real-only scalar helper (`Math.sign`,
  // `Math.hypot`, `_SYS.sinc`): it has no complex call form, so a complex
  // element has nowhere to go. Fail closed rather than hand a `{re, im}`
  // object to a real helper.
  if (typeof fn !== 'function' && anyComplex) return null;

  // …and the same rule for a head whose codegen is real-only despite being a
  // FUNCTION (`isRealOnlyLowering`). `compileExpr` gates those on its
  // scalar branch, which this method returns BEFORE reaching, so a broadcast
  // would slip past it: the closure below is built from the head's own scalar
  // codegen, and for these heads that codegen is `Math.floor`/`Math.max`/…
  // whatever the element parameter's declared complex-ness. Measured with
  // this decline absent: `Floor([1+i, 2+i])` emitted
  // `_SYS.bcast((_tv1) => Math.floor(_tv1), [{re, im}, {re, im}])` and ran to
  // `[NaN, NaN]` behind `success: true`, where the interpreter leaves the
  // elements inert at `[1+i, 2+i]`. Returning null hands the form to the
  // fail-closed D6 guard, which is where the scalar shape ends up too.
  if (anyComplex && isRealOnlyLowering(target, h)) return null;
  // Same decline for an ORDERING over a complex element lane: the scalar
  // body below is the target's raw comparison over the element
  // parameters, which has no realness guard — `√L < 1` compiled to
  // `_SYS.bcast((a, b) => a < b, …)` over `{re, im}` roots and ran to
  // `[false, false]` where the interpreter answers `[true, false]` at
  // `L = [0.5, 2]`, and `L < w` at `w = {re: 2, im: 0}` compared each
  // element against an object (`1 < 2` read as `1 < NaN`). The ordering
  // gate in `compileExpr` projects the operands element-wise
  // (`realOperandGuard`) and re-enters here on the real lane.
  if (ORDERING_HEADS.has(h) && anyComplex) return null;

  // The number of components this application has when every operand's
  // width is known at compile time — the run-time dispatch is then replaced
  // by one expression per component, further down.
  //
  // An operand that may hold an ABSENT OBJECT (`objectAbsenceLevels`: a
  // restricted point or list, or a list of possibly absent points) is read
  // by `_SYS.bcastAbsent` instead: the absent point is spelled `undefined`,
  // and arithmetic on it answers `undefined` for the whole point (for one
  // cell of a list of points), where the interpreter answers `Missing`
  // (`docs/ERROR-MODEL.md` §3, user decision of 2026-09-27). The component
  // fan-out and the rotation views would read the absent value as an
  // array, so neither is used then. When no operand can hold an absent
  // object, the emission is unchanged.
  //
  // The RESULT must be able to hold an absent object too. The interpreter
  // answers `Missing` for `t·P` with an absent point (typed
  // `missing | tuple<…>`), but `[1, 2] + L` with an absent list `L` is the
  // list `[NaN, NaN]` (typed `vector<2>`): the present list gives the
  // shape, and the absent operand is `NaN` in each numeric cell. The plain
  // `_SYS.bcast` already answers that. An element type that admits
  // `missing` counts as well: an ordering of a restricted list,
  // `L{c} < 3`, is typed `list<boolean | missing>`, and the interpreter
  // answers `Missing` for the whole list when `L` is absent.
  // Each entry is a bit set of levels (`objectAbsenceLevels`); `0` is an
  // operand that cannot hold an absent object.
  let absentLevels = args.map((a) => objectAbsenceLevels(a.type.type));
  // The type of the application, computed once and only when a test below
  // reads it: building the application to type it is not free.
  let resultType: Type | undefined;
  const applicationType = (): Type =>
    (resultType ??= node?.type.type ?? engine.function(h, [...args]).type.type);
  // A READ whose type states nothing (`any` or `unknown`: a coordinate
  // read off an operand whose shape is not known, `PointX(p)`, or the
  // result of a function declared `-> unknown`) can be absent, spelled
  // `undefined`. The interpreter answers the marker of the application's
  // codomain for such an absent operand: `NaN` when the application is
  // provably a number, and `Missing` otherwise (`absentScalarMarker`, the
  // missing-value gate of `BoxedFunction`). So when the application is not
  // provably a number, such a read keeps `undefined` through the
  // arithmetic: `s·PointX(p)` with `p` absent is absent, as in the
  // interpreter (ROADMAP CE-229, user decision 2026-10-23), unless an
  // operand is a collection at run time (`scalarAbsent` below).
  //
  // A symbol DECLARED `any` is not such a read: an absent value that it
  // holds is `NaN` in arithmetic on every route (`absentArithmeticMarker`,
  // `validate.ts`; ROADMAP CE-395). It reaches this code only in the list
  // branch of `declaredTopGuard`, where its value is an array; the scalar
  // branch reads it as a number, and `undefined + 1` is `NaN`.
  const statesNothing = (t: Type): boolean => {
    const r = resolveTypeForCompilation(t);
    return r === 'any' || r === 'unknown';
  };
  const unknownAbsent =
    NAN_PROPAGATING_BROADCAST_HEADS.has(h) &&
    args.some((a) => statesNothing(a.type.type)) &&
    !isSubtype(resolveTypeForCompilation(applicationType()), 'number')
      ? args.map((a) => statesNothing(a.type.type))
      : args.map(() => false);
  if (absentLevels.some((d) => d !== 0)) {
    const result = applicationType();
    const resolved = resolveTypeForCompilation(result);
    const elt =
      typeof resolved !== 'string' && resolved.kind === 'list'
        ? collectionElementType(resolved)
        : undefined;
    if (
      objectAbsenceLevels(result) === 0 &&
      !(
        elt !== undefined &&
        typeof elt !== 'string' &&
        elt.kind === 'union' &&
        elt.types.some((b) => resolveTypeForCompilation(b) === 'missing')
      )
    )
      absentLevels = absentLevels.map(() => 0);
  }
  const absentMode = absentLevels.some((d) => d !== 0);
  // The scalar absences of `unknownAbsent` are decided at run time
  // (`_SYS.bcastScalarAbsent`): the interpreter's gate stands aside when an
  // operand is a collection, and broadcasts the absence into its cells
  // (`[1, 2] + PointX(p)` with `p` absent is `[NaN, NaN]`). An operand
  // typed `any` or `unknown` may be a list or a number, so only the value
  // says which. When an operand may hold an absent object, the
  // object rules above (`_SYS.bcastAbsent`) apply instead.
  const scalarAbsent =
    !absentMode && unknownAbsent.some((x) => x) ? unknownAbsent : undefined;
  /** A `_SYS.bcast` call, or `_SYS.bcastAbsent` when one of the level sets
   * in `levels` is not empty. */
  const bcastCall = (
    fnText: string,
    levels: ReadonlyArray<number>,
    sources: ReadonlyArray<string>
  ): string =>
    levels.some((d) => d !== 0)
      ? `_SYS.bcastAbsent([${levels.join(', ')}], ${fnText}, ${sources.join(', ')})`
      : `_SYS.bcast(${fnText}, ${sources.join(', ')})`;
  const componentWidth =
    atomicTuple === undefined && !absentMode && scalarAbsent === undefined
      ? staticBroadcastWidth(h, args, isArrayOperand)
      : undefined;

  // Bind one element parameter per operand and build the scalar body by
  // re-invoking the head's own scalar codegen with those parameters (shadow
  // `target.var` so they compile bare, not as `_.<name>` lookups — same
  // pattern as the Sum/Product loop index).
  const params = args.map(() => tempVar(target));
  // The element parameters are bare symbols with no type of their own, so the
  // head's scalar codegen would read every one of them as REAL and emit
  // `_tv1 * _tv2` over a pair of `{re, im}` objects. Declaring their
  // complex-ness in a local frame — the same mechanism a `Block` local uses
  // (`_localComplex`) — makes that codegen pick the complex lowering, so the
  // closure agrees with the array it will actually be mapped over. This is
  // what lets an all-complex collection broadcast at all; before it, any
  // complex operand declined here and fell through to the fail-closed guard.
  const complexFrame = new Map<string, boolean>();
  params.forEach((p, i) => complexFrame.set(p, argIsComplex[i] === true));
  // For a promotable radical/`Power` head, the promotion verdict must be
  // decided on the NODE-LEVEL operands — the element temps the closure is
  // built from carry no sign or type evidence, so a verdict derived from
  // them promotes shapes whose operands are provably non-negative
  // (`√(x²+L²)` with a list `L`), diverging from the downstream
  // `isComplexValued` analysis that reads the real operands. Record the
  // node-level verdict for `promotesRadicalToComplex` to return when the
  // scalar codegen re-asks with exactly these temps. Decided strictly
  // inside the `_pushLocalComplex` frame so memoized analysis answers
  // stay in that frame's memo layer.
  _pushLocalComplex(complexFrame);
  let radicalFrame:
    | {
        head: string;
        params: Set<string>;
        promotes: boolean;
        realPower?: { value: number; oddNumerator: boolean };
      }
    | undefined;
  try {
    radicalFrame =
      h === 'Power' ||
      h === 'Root' ||
      COMPLEX_CONTINUATION_HEADS.has(h) ||
      PROMOTABLE_RADICAL_HEADS.has(h)
        ? {
            head: h,
            params: new Set(params),
            promotes: COMPLEX_CONTINUATION_HEADS.has(h)
              ? continuesToComplex(h, args)
              : core.promotesRadicalToComplex(h, args),
            realPower: h === 'Power' ? realPowerExponent(args) : undefined,
          }
        : undefined;
  } finally {
    _popLocalComplex();
  }
  /**
   * The head's own scalar lowering, with element parameter `i` standing for
   * the source text `sources[i]`.
   *
   * The closure of the run-time broadcast passes the parameter names
   * themselves; the component fan-out further down passes one component read
   * per operand instead, so the same codegen — and with it every complex,
   * constant-fold and precedence convention of the scalar lane — produces
   * both spellings. Every source must be an ATOMIC expression (a name, a
   * property or index read, a parenthesized expression), because the codegen
   * splices it into operator positions without parenthesizing it.
   *
   * Both frames are pushed around each build, in the order the verdict above
   * was decided in: the radical verdict strictly inside the local-complex
   * frame, so the memo layer a build writes is the frame's own.
   */
  const buildScalarBody = (rawSources: ReadonlyArray<string>): string => {
    // A normalized operand is read through the coercion at every mention;
    // a call is an atomic expression, as the contract above requires.
    const sources = rawSources.map((source, i) =>
      normalized[i] ? `_SYS.cplx(${source})` : source
    );
    const innerTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => {
        const i = params.indexOf(id);
        return i >= 0 ? sources[i] : target.var(id);
      },
      ...withBoundScope(target, params),
    };
    _pushLocalComplex(complexFrame);
    if (radicalFrame !== undefined) _broadcastRadicalVerdict.push(radicalFrame);
    try {
      return dispatch
        ? dispatchingScalarBody(h, sources)
        : typeof fn === 'function'
          ? fn(
              params.map((p) => engine.expr(p)),
              (expr) => compileValueOperand(expr, innerTarget),
              innerTarget
            )
          : `${fn}(${sources.join(', ')})`;
    } finally {
      if (radicalFrame !== undefined) _broadcastRadicalVerdict.pop();
      _popLocalComplex();
    }
  };
  const scalarBody = buildScalarBody(params);
  // A `RotateLeft`/`RotateRight` operand whose base provably holds scalars
  // is handed to the plain broadcast as an in-place VIEW (`_SYS.rotv`): the
  // element loop reads the base at a shifted index instead of first
  // allocating and copying the rotated list — one full-list copy per
  // rotation, eight per evaluation of a Life stencil (Tycho item 262). The
  // point-broadcast shapes below keep the materialized rotation: their
  // inner `_SYS.bcast` receives the outer closure's parameters, not the
  // operands themselves. Only for the JavaScript target, whose runtime
  // helpers implement the view. A view reads the base when the element
  // loop runs, after every operand has been evaluated, so it is used only
  // when nothing evaluated in between can mutate the base: every operand
  // is pure and neither the head nor an operand is caller-mapped (a
  // caller-supplied function may do anything to an array it receives).
  // `rotationView` adds the per-operand conditions.
  const admission =
    atomicTuple === undefined && target.cseBind !== undefined
      ? cseAdmission(target, new Set())
      : undefined;
  // A view is never used by the component fan-out below, which reads its
  // operands by INDEX: `_SYS.rotv` answers a `RotView` object rather than an
  // array, and only the element loop of `_SYS.bcast` knows how to read one.
  // Nothing is lost — a rotation whose width is small enough for the fan-out
  // copies four cells at most, which is the allocation the view exists to
  // avoid on a forty-thousand-element board.
  const viewsAllowed =
    componentWidth === undefined &&
    !absentMode &&
    scalarAbsent === undefined &&
    admission !== undefined &&
    admission.isOverriddenOperator?.(h) !== true &&
    args.every((a) => a.isPure === true && !isCallerMapped(a, admission));
  const compiledArgs = args.map(
    (a) =>
      (viewsAllowed ? rotationView(a, target, admission!) : undefined) ??
      core.compile(a, target)
  );
  // A comparison with an operand that may be absent is absent at each
  // position where that operand is the absent object (ROADMAP CE-93, the
  // broadcast form of `absentComparisonGuard`): `[1, 2] < w` is
  // `[Missing, Missing]` in the interpreter when `w` is absent.
  const object = target.absence?.object;
  const absentParams =
    object !== undefined &&
    (h === 'Less' ||
      h === 'LessEqual' ||
      h === 'Greater' ||
      h === 'GreaterEqual' ||
      h === 'Equal' ||
      h === 'NotEqual')
      ? params.filter((_p, i) => {
          const t = compilationType(args[i]);
          return typeContainsMissing(t) && numericMissingSlot(t);
        })
      : [];
  const connectiveBody = guardConnectiveAbsence(h, params, scalarBody);
  const body =
    absentParams.length === 0
      ? connectiveBody
      : `((${absentParams.map((p) => object!.isAbsent(p)).join(' || ')}) ? ${object!.nullLiteral} : (${connectiveBody}))`;
  const closure = `(${params.join(', ')}) => ${body}`;
  // Every operand's width is known: emit one expression per component and
  // drop the run-time dispatch altogether. An operand whose compiled source
  // cannot be repeated for free is bound once to a temporary, so each one is
  // still evaluated exactly once. The ORDER is not the operand order: an
  // operand read from its literal text is not bound to a temporary, so its
  // elements are evaluated inside the component expressions, after every
  // bound sibling was evaluated as an argument of the wrapping arrow
  // function. That is sound because `staticBroadcastWidth` admits PURE
  // operands only, so no operand can observe another's evaluation.
  if (componentWidth !== undefined) {
    const bindings: string[] = [];
    const bound: string[] = [];
    // A collection operand is read component by component, which trusts its
    // DECLARED width. A declared type constrains what the ENGINE may assign,
    // not what a caller may put in the kernel's `vars` object, so a
    // `list<number^4>` input can arrive absent, shorter, longer, or as a
    // plain number. Only a source that is provably an array of exactly the
    // right length may be read by index without checking; every other one
    // is tested at run time and, when the test fails, handed to the
    // broadcast helper below, which answers those shapes the way the
    // interpreter does (a missing operand gives NaN, a shorter list gives
    // the shorter result, a scalar gives a scalar).
    const guarded: string[] = [];
    // An operand whose emitted code is an array of the width BY
    // CONSTRUCTION — a constructor the common-subexpression pass has
    // named, a sum of points, a point-valued call — needs no test either
    // (`provenPointWidth`); a declared input read from `vars` keeps it.
    const needsGuard = compiledArgs.map(
      (code, i) =>
        isArrayOperand(args[i]) &&
        arrayLiteralWidth(hoistedListLiteralText(target, code)) !==
          componentWidth &&
        provenPointWidth(args[i], target) !== componentWidth
    );
    // When no source needs the run-time test, a source that is one array
    // literal of the right width is read component by component from its
    // TEXT: a `Tuple`/`List` node compiles to exactly that, so `(a, b) +
    // (c, d)` is written `[a + c, b + d]` rather than binding `[a, b]` to a
    // temporary only to index it. Under a test the literal is bound as
    // before: the fallback closure must receive it whole, and repeating a
    // component's text in both branches would double the emitted code.
    const anyGuard = needsGuard.some((g) => g);
    const literalParts = compiledArgs.map((code, i) =>
      !anyGuard && isArrayOperand(args[i])
        ? arrayLiteralElements(
            hoistedListLiteralText(target, code),
            componentWidth
          )
        : undefined
    );
    const sources = compiledArgs.map((code, i) => {
      if (literalParts[i] !== undefined) return code;
      if (!needsGuard[i] && REPEATABLE_SOURCE.test(code)) return code;
      const v = tempVar(target);
      bindings.push(v);
      bound.push(code);
      if (needsGuard[i]) guarded.push(v);
      return v;
    });
    const components: string[] = [];
    for (let k = 0; k < componentWidth; k++) {
      const cell = args.map((a, i) => {
        const parts = literalParts[i];
        if (parts !== undefined) return parts[k];
        return isArrayOperand(a) ? `${sources[i]}[${k}]` : sources[i];
      });
      components.push(guardConnectiveAbsence(h, cell, buildScalarBody(cell)));
    }
    const literal = `[${components.join(', ')}]`;
    if (guarded.length > 0) {
      // The test claims RANK 1 as well as the length, because a component
      // read is spliced into the head's SCALAR codegen. A declared width
      // constrains what the engine assigns, not what a caller supplies, so
      // a `tuple<number, number>` input may arrive as the matrix
      // `[[1, 2], [3, 4]]`, which has length two: `P + (1, 2)` then read
      // each ROW as a scalar and ran to the JavaScript string concatenation
      // `['1,21', '3,42']`, where `_SYS.bcast` maps over the nested arrays
      // and answers `[[2, 3], [5, 6]]`. The first element decides the rank,
      // the same test `_SYS.matmul` applies (`javascript-target.ts`), so a
      // shape this refuses falls to the helper that answered it before.
      const test = guarded
        .map(
          (v) =>
            `Array.isArray(${v}) && ${v}.length === ${componentWidth} && ` +
            `!Array.isArray(${v}[0])`
        )
        .join(' && ');
      const fallback = `_SYS.bcast(${closure}, ${sources.join(', ')})`;
      return (
        `((${bindings.join(', ')}) => ${test} ? ${literal} : ${fallback})` +
        `(${bound.join(', ')})`
      );
    }
    return bindings.length === 0
      ? literal
      : `((${bindings.join(', ')}) => ${literal})(${bound.join(', ')})`;
  }
  // A point multiplied by a list (`[1,2,3]·(cos a, sin a)`, Tycho item 214):
  // broadcast over the LIST operands first, and at each of their elements
  // broadcast the scalar closure over the point's components — so the point
  // is scaled whole per element and the result is a list of points, as the
  // interpreter's `mul()` answers. The outer closure's parameters stand in
  // for the list operands inside the inner call; the point and any scalar
  // operand are spliced in unchanged.
  //
  // Every operand is evaluated exactly ONCE, in operand order, by binding
  // it as a parameter of an immediately-applied arrow function — the
  // interpreter's `Multiply` handler evaluates each operand once before
  // broadcasting. Splicing the point's or a scalar's source text inside the
  // outer closure instead would re-run it per element: `[1,2]·(Random(), 0)`
  // must draw once and answer `[(r, 0), (2r, 0)]`, and `cos a` need not be
  // recomputed for every element. Handing those operands to the outer
  // `_SYS.bcast` as arguments is not an option either — it would zip the
  // point's array against the list, the very shape this emission avoids.
  // A list of points beside an operand that may be a scalar or a
  // collection of numbers at any depth (`pointListOverNumbers`, set above),
  // both evaluated once. A scalar is applied to every point. An array is
  // paired with the list, element by element, and unequal lengths are the
  // interpreter's `incompatible-dimensions` error, projected to NaN. An
  // element that is an array is walked to its numbers, and the point is
  // applied whole to each one: `f` keeps the point and descends into the
  // element, where the flat `_SYS.bcast` would pair the components of the
  // point with the entries of the element. A list operand that is not an
  // array at run time is NaN, as in the other point-list plans.
  if (
    pointListOverNumbers !== undefined &&
    !absentMode &&
    scalarAbsent === undefined
  ) {
    const bound = args.map(() => tempVar(target));
    const list = bound[1 - pointListOverNumbers];
    const other = bound[pointListOverNumbers];
    const f = tempVar(target);
    const p = tempVar(target);
    const x = tempVar(target);
    const y = tempVar(target);
    const k = tempVar(target);
    const ordered = pointListOverNumbers === 1 ? `${p}, ${x}` : `${x}, ${p}`;
    return (
      `((${bound.join(', ')}) => { ` +
      `const ${f} = (${p}, ${x}) => Array.isArray(${x}) ? ` +
      `${x}.map((${y}) => ${f}(${p}, ${y})) : _SYS.bcast(${closure}, ${ordered}); ` +
      `return !Array.isArray(${list}) ? NaN : ` +
      `!Array.isArray(${other}) ? ${list}.map((${p}) => ${f}(${p}, ${other})) : ` +
      `${list}.length !== ${other}.length ? NaN : ` +
      `${list}.map((${p}, ${k}) => ${f}(${p}, ${other}[${k}])); })` +
      `(${compiledArgs.join(', ')})`
    );
  }
  if (pointListOverNumbers !== undefined) return null;
  if (atomicTuple !== undefined) {
    const bound = args.map(() => tempVar(target));
    if (atomicTupleOverPoints === 'runtime-list') {
      // The run-time point-or-list operand beside a list of POINTS, both
      // evaluated once. A value that is an array of arrays (or empty) is a
      // list of points: it is zipped against the list, point by point,
      // and unequal lengths are the interpreter's `incompatible-dimensions`
      // error projected to NaN. A flat array is a point, added to every
      // point of the list. A number is the interpreter's per-element
      // `incompatible-type` error, NaN at every position. The list operand
      // that is not an array at run time is NaN, as in the static plan.
      const m = args.indexOf(runtimePointOperand!);
      const src = bound[m];
      const list = bound[1 - m];
      const p = tempVar(target);
      const k = tempVar(target);
      const q = tempVar(target);
      const zipped = bound.map((b, i) => (i === m ? p : `${list}[${k}]`));
      const mapped = bound.map((b, i) => (i === m ? b : q));
      // A flat point of another arity than the list's points is the
      // interpreter's dimension error, NaN; the arity is read from the
      // list's element type, which `isProvablyPointList` proved a tuple.
      const elt = collectionElementType(compilationType(args[1 - m]));
      const arity =
        elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple'
          ? elt.elements.length
          : undefined;
      const arityTest =
        arity === undefined ? '' : `${src}.length !== ${arity} ? NaN : `;
      return (
        `((${bound.join(', ')}) => ` +
        `(!Array.isArray(${list}) ? NaN : ` +
        `!Array.isArray(${src}) ? ${list}.map(() => NaN) : ` +
        `(${src}.length === 0 || Array.isArray(${src}[0])) ? ` +
        `(${src}.length !== ${list}.length ? NaN : ` +
        `${src}.map((${p}, ${k}) => _SYS.bcast(${closure}, ${zipped.join(', ')}))) : ` +
        `${arityTest}${list}.map((${q}) => _SYS.bcast(${closure}, ${mapped.join(', ')}))))` +
        `(${compiledArgs.join(', ')})`
      );
    }
    if (atomicTupleOverPoints === 'runtime') {
      const m = args.indexOf(runtimePointOperand!);
      const src = bound[m];
      const p = tempVar(target);
      const inner = bound.map((b, i) => (i === m ? p : b));
      // Each element of a list of points is one level below the list.
      const innerLevels = absentLevels.map((d, i) => (i === m ? d >> 1 : d));
      // An EMPTY array takes the point-list branch and maps to the empty
      // list, the answer the provable point-list lane below also gives:
      // a point of the declared arity is never an empty array at run
      // time, so an empty array can only be an empty list of points.
      return (
        `((${bound.join(', ')}) => ` +
        `(Array.isArray(${src}) && ` +
        `(${src}.length === 0 || Array.isArray(${src}[0])) ? ` +
        `${src}.map((${p}) => ${bcastCall(closure, innerLevels, inner)}) : ` +
        `${bcastCall(closure, absentLevels, bound)}))` +
        `(${compiledArgs.join(', ')})`
      );
    }
    const outerParams: string[] = [];
    const outerSources: string[] = [];
    // Whether each outer source can be absent itself (level `0`) — the
    // outer level only walks the list — and, for the inner call, the
    // levels of every operand as the inner call sees them: an element of a
    // walked list is one level below the list.
    const outerLevels: number[] = [];
    const innerLevels: number[] = [];
    const innerArgs = args.map((a, i) => {
      if (a === atomicTuple || !isArrayOperand(a)) {
        innerLevels.push(absentLevels[i]);
        return bound[i];
      }
      const p = tempVar(target);
      outerParams.push(p);
      outerSources.push(bound[i]);
      outerLevels.push(absentLevels[i] & 1);
      innerLevels.push(absentLevels[i] >> 1);
      return p;
    });
    const innerCall = bcastCall(closure, innerLevels, innerArgs);
    // A point added to a list of POINTS: the outer level walks the list
    // ONE level deep, handing each point whole to the inner `_SYS.bcast`,
    // which zips it against the atomic point (`[x, y] + [1, 2]` →
    // `[x + 1, y + 2]`). An outer `_SYS.bcast` — right for the scalar
    // sources of the `Multiply` shape — would recurse INTO each point and
    // add the whole atomic point to every COMPONENT (`[[1, 2], [1, 2]]`
    // for the element `(0, 0)`). Exactly one list source reaches here
    // (the decision above declines more). A non-array source is the
    // interpreter's inert result, projected to NaN as `_SYS.bcast` does.
    if (atomicTupleOverPoints === 'static') {
      return (
        `((${bound.join(', ')}) => ` +
        `(Array.isArray(${outerSources[0]}) ? ` +
        `${outerSources[0]}.map((${outerParams[0]}) => ${innerCall}) : ` +
        `${(outerLevels[0] & 1) !== 0 ? `${outerSources[0]} === undefined ? undefined : ` : ''}NaN))` +
        `(${compiledArgs.join(', ')})`
      );
    }
    return (
      `((${bound.join(', ')}) => ` +
      `${bcastCall(`(${outerParams.join(', ')}) => ${innerCall}`, outerLevels, outerSources)})` +
      `(${compiledArgs.join(', ')})`
    );
  }
  // Fusion moves the element reads of an absorbed operand after the
  // evaluation of every operand source of the call, where the nested form
  // read them before the later sources ran. That is the same value only
  // when no source has an effect and none is caller-supplied code
  // (`isCallerMapped`: an emitter this compiler does not see may hand a
  // mutable array on) — the admission the rotation views ask for.
  if (absentMode) return bcastCall(closure, absentLevels, compiledArgs);
  if (scalarAbsent !== undefined)
    return `_SYS.bcastScalarAbsent([${scalarAbsent.map((x) => (x ? 1 : 0)).join(', ')}], ${closure}, ${compiledArgs.join(', ')})`;
  const fusionAllowed =
    admission !== undefined &&
    args.every((a) => a.isPure === true && !isCallerMapped(a, admission));
  return emitFusedBroadcast(h, params, body, compiledArgs, fusionAllowed);
}

/**
 * One `_SYS.bcast` call for a broadcastable head whose OPERANDS may
 * themselves be plain broadcasts: each such operand is absorbed into the
 * closure as a `const` binding of its element parameter, its own element
 * parameters join the closure's, and its operand sources join the call.
 * `(a + [1, 2]) · c` over lists then runs ONE loop that computes the whole
 * scalar expression per element, where the nested form built an
 * intermediate array and dispatched a second loop over it (the 12-deep
 * nest of a 225-element implicit-surface row in the Tycho code-generation
 * audit cost 8× a single loop).
 *
 * Per position the value is the nested form's: the runtime helper zips its
 * operands position by position and applies the closure once per
 * position, and binding the inner result per position is what the
 * intermediate array held there. The two forms differ only when the inner
 * broadcast answers ONE scalar NaN for the whole operand — an empty list,
 * or lists of different lengths, the interpreter's error positions — where
 * the nested form hands that NaN to the outer head as a scalar and the
 * fused form answers NaN for the whole call. So an operand is absorbed
 * only under a head whose lowering propagates a NaN operand
 * ({@link NAN_PROPAGATING_BROADCAST_HEADS}; `Power` when the absorbed
 * operand is the exponent, or the base under a non-zero literal
 * exponent): the outer answer is NaN either way. Under a relational or
 * logical head the operand stays a nested call, because there a dominant
 * operand absorbs the error as the interpreter does (`And(False, error)`
 * is `False`), which the fused call could not answer.
 *
 * Absorbing also moves the element reads of the inner operands after the
 * evaluation of every source of the outer call, so it is done only when
 * every source of both calls is pure and emitted by this compiler
 * (`pure`, decided at the call site); a source with an effect or from
 * caller-supplied code keeps the nested order.
 *
 * An operand that is not a plain broadcast — a shared temporary the
 * common-subexpression pass bound (so a value used twice is still computed
 * once), a user-function dispatch, a rotation view, any scalar source — is
 * passed through as one operand. Operand sources are evaluated once, as
 * call arguments, in both forms; only the closure body, which is pure
 * scalar code over the parameters, is rearranged. When nothing is
 * absorbed the emission is the plain form, unchanged. When something is,
 * a repeatable source (`REPEATABLE_SOURCE`: a name, a property chain, a
 * literal) that several operands read is passed once and the later
 * parameters alias the first — the helper then reads the list once per
 * position instead of once per occurrence; a source that is not
 * repeatable is a call or an expression, evaluated per occurrence in the
 * nested form too, so it keeps its own position.
 */
export function emitFusedBroadcast(
  h: string,
  params: ReadonlyArray<string>,
  body: string,
  compiledArgs: ReadonlyArray<string>,
  pure: boolean
): string {
  const absorbable = (i: number): boolean => {
    const inner = PLAIN_BROADCASTS.get(compiledArgs[i]);
    if (inner === undefined || !pure || !inner.pure) return false;
    if (NAN_PROPAGATING_BROADCAST_HEADS.has(h)) return true;
    if (h === 'Power') {
      if (i === 1) return true;
      const exponent = compiledArgs[1];
      return /^-?\d+(?:\.\d+)?$/.test(exponent) && Number(exponent) !== 0;
    }
    return false;
  };
  const absorbed = compiledArgs.map((_, i) => absorbable(i));
  if (!absorbed.some((a) => a)) {
    const code = `_SYS.bcast((${params.join(', ')}) => ${body}, ${compiledArgs.join(', ')})`;
    rememberPlainBroadcast(
      code,
      [...params],
      [],
      body,
      [...compiledArgs],
      pure
    );
    return code;
  }
  const fusedParams: string[] = [];
  const statements: string[] = [];
  const sources: string[] = [];
  const firstParamOf = new Map<string, string>();
  const add = (param: string, source: string): void => {
    if (REPEATABLE_SOURCE.test(source)) {
      const first = firstParamOf.get(source);
      if (first !== undefined) {
        statements.push(`const ${param} = ${first};`);
        return;
      }
      firstParamOf.set(source, param);
    }
    fusedParams.push(param);
    sources.push(source);
  };
  compiledArgs.forEach((code, i) => {
    if (!absorbed[i]) {
      add(params[i], code);
      return;
    }
    const inner = PLAIN_BROADCASTS.get(code)!;
    // The absorbed closure's own statements may read its parameters, so
    // its parameters are bound before its statements are appended.
    inner.params.forEach((p, j) => add(p, inner.args[j]));
    statements.push(
      ...inner.statements,
      `const ${params[i]} = ${inner.result};`
    );
  });
  const closure = `(${fusedParams.join(', ')}) => { ${statements.join(' ')} return ${body}; }`;
  const code = `_SYS.bcast(${closure}, ${sources.join(', ')})`;
  rememberPlainBroadcast(code, fusedParams, statements, body, sources, pure);
  return code;
}

/** Record a plain broadcast emission in {@link PLAIN_BROADCASTS}. */
export function rememberPlainBroadcast(
  code: string,
  params: string[],
  statements: string[],
  result: string,
  args: string[],
  pure: boolean
): void {
  if (PLAIN_BROADCASTS.size >= PLAIN_BROADCAST_MEMO_LIMIT)
    PLAIN_BROADCASTS.clear();
  PLAIN_BROADCASTS.set(code, {
    params,
    statements,
    result,
    args,
    pure,
  });
}

/**
 * Ask the TARGET to apply a `broadcastable` head's scalar element lowering
 * across a single finite indexed collection operand — see
 * `CompileTarget.broadcastUnary`. Returns `undefined` when the target has no
 * such hook, or its hook declines; the caller then fails closed.
 *
 * `element(code)` splices already-compiled target source in as the element
 * operand: it binds a fresh placeholder name and shadows `target.var` so the
 * source emits BARE, never as a `_.<name>` vars-object lookup (the same
 * pattern as the Sum/Product loop index). A target that fans out therefore
 * gets its loop variable back verbatim; one that is natively componentwise
 * passes the whole compiled vector instead.
 */
export function compileBroadcastUnary(
  engine: ComputeEngine,
  h: string,
  operand: Expression,
  fn: Exclude<CompiledFunction<Expression>, string>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.broadcastUnary === undefined) return undefined;
  const element = (code: TargetSource): TargetSource => {
    const v = tempVar(target);
    const innerTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => (id === v ? code : target.var(id)),
      ...withBoundScope(target, [v]),
    };
    return fn(
      [engine.expr(v)],
      (expr) => compileValueOperand(expr, innerTarget),
      innerTarget
    );
  };
  const out = target.broadcastUnary(
    h,
    operand,
    { collection: () => core.compile(operand, target), element },
    target
  );
  return out === undefined || out === '' ? undefined : out;
}

/**
 * The Python target's element-wise lowering for an arithmetic head that has
 * exactly ONE collection operand — `Negate(L)`, `1 + L`, `2 * L`, `L ** 2`,
 * `2 / L` for an `L` typed `list<number>`, and the same shapes over a `List`
 * literal whose elements are not all constants (`[x, y] + 1`). Returns
 * `undefined` to decline, and the caller then fails closed.
 *
 * The map is spelled by the target through its `broadcastUnary` hook (Python
 * emits a list comprehension, `[1 + _tv1 for _tv1 in L]`), which iterates a
 * plain Python list, a tuple and a NumPy array alike — so the emission does
 * not depend on what container the caller binds, which is the reason the
 * infix lowering (`1 + L`, a TypeError for a list) cannot be used. The
 * element body is produced by re-entering `compileExpr` on the same head with
 * the collection position replaced by the loop variable, so every scalar
 * convention of this target — operator precedence, complex dispatch, the
 * `**`/`np.power` split — is the scalar lane's, not a second implementation
 * of it.
 *
 * The admission is deliberately narrow, because each restriction removes a
 * shape whose Python result would NOT match the interpreter's:
 *
 * - **Exactly one collection operand.** With two (`L + M`) the interpreter
 *   answers `Error("incompatible-dimensions")` on any length disagreement,
 *   while a fan-out would have to pick a length; NumPy would silently recycle
 *   a length-1 axis (`np.add([1], [3,4,5])` is `[4,5,6]`) and `zip` would
 *   truncate. Neither reproduces the error, so that shape keeps declining.
 * - **The collection is an ordered list of numbers.** A comprehension over a
 *   `set` has no defined order; a `list<string>` would concatenate per
 *   element; a list of TUPLES (a point list) combines component-wise in the
 *   interpreter (`[1,2] * (3,4)` is `[(3,4),(6,8)]`), not element-wise; and a
 *   list of LISTS is not necessarily rectangular, so a one-level fan-out
 *   would hand a row to a scalar operator.
 * - **Every other operand is provably a number.** An `unknown`-typed operand
 *   may bind to a list at run time, which is the very repeat/concatenate
 *   divergence this guard exists for.
 * - **A `Power` over a collection BASE has a safe scalar exponent.** This is
 *   the one head whose element lowering is container-dependent: Python's `**`
 *   answers a float for a negative integer exponent of an `int` (`2 ** -2` is
 *   `0.25`), while NumPy REFUSES the same operation on an integer array
 *   element — `np.int64(2) ** -2` raises `ValueError: Integers to negative
 *   integer powers are not allowed` (measured, NumPy 2.4.2). The comprehension
 *   would therefore answer for a plain Python list and throw for an integer
 *   ndarray, and the artifact cannot constrain which the caller binds.
 *   Admitted are the two exponents both containers agree on: one provably a
 *   NON-NEGATIVE INTEGER (`v ** 2`), and one provably NOT an integer
 *   (`v ** 0.5`, a float on either container). A collection in the EXPONENT
 *   position (`2 ** v`) is deliberately NOT gated by this rule — its
 *   elements carry no static proof, so gating would refuse the whole
 *   shape. The user accepted the residual divergence because it is LOUD:
 *   an integer ndarray holding a negative element raises the ValueError
 *   at run time rather than answering a wrong value, while lists, tuples
 *   and float ndarrays all answer correctly. (ROADMAP.md, the
 *   Python arithmetic-guard entry, records the decision.)
 *
 * The scalar operands are spliced into the comprehension BODY, so their code
 * runs once per element rather than once. That is a cost, not a semantic
 * difference, while this target has no impure lowering (`Random` and its
 * family decline); the `Equal` collection chain already relies on the same
 * property when it compiles a shared middle operand twice.
 */
export function tryCompilePythonElementwise(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.broadcastUnary === undefined) return undefined;

  // The operand shape gate: an ordered collection whose elements are numbers.
  // `list<any>` (not the bare `list`) is the absence-admitting shape top, and
  // the element test then excludes `list<string>`, a point list and a nested
  // list, none of which a one-level fan-out lowers faithfully.
  const isElementwiseSource = (a: Expression): boolean => {
    if (!a.type.matches('list<any>')) return false;
    const elt = collectionElementType(resolveTypeForCompilation(a.type.type));
    return elt !== undefined && isSubtype(elt, 'number');
  };
  // A scalar companion: provably a number, so it cannot be the list the
  // fan-out would otherwise splice into a scalar operator position.
  const isScalarCompanion = (a: Expression): boolean => {
    const t = resolveTypeForCompilation(a.type.type);
    return t !== 'never' && isSubtype(t, 'number');
  };

  let index = -1;
  for (let i = 0; i < args.length; i++) {
    if (isScalarCompanion(args[i])) continue;
    if (index >= 0 || !isElementwiseSource(args[i])) return undefined;
    index = i;
  }
  if (index < 0) return undefined;

  // The `Power` exponent gate described above: a negative integer exponent
  // over a collection BASE computes on a plain Python list and raises on an
  // integer ndarray, so it fails closed rather than emit a comprehension
  // whose result depends on the container the caller binds.
  if (h === 'Power' && args.length === 2 && index === 0) {
    const exponent = args[1];
    const uniform =
      isNumber(exponent) &&
      !exponent.isComplex &&
      (!Number.isInteger(exponent.re) || exponent.re >= 0);
    if (!uniform) return undefined;
  }

  const source = args[index];
  const element = (code: TargetSource): TargetSource => {
    const v = tempVar(target);
    const innerTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => (id === v ? code : target.var(id)),
      ...withBoundScope(target, [v]),
    };
    // The loop variable stands for ONE element, so it is not
    // collection-typed and the Python guard above does not fire again.
    const elementArgs = args.map((a, i) => (i === index ? engine.expr(v) : a));
    return core.compileExpr(engine, h, elementArgs, 0, innerTarget);
  };
  const out = target.broadcastUnary(
    h,
    source,
    { collection: () => core.compile(source, target), element },
    target
  );
  return out === undefined || out === '' ? undefined : out;
}
