// Function-literal expressions and the bindings of their parameters.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  recordDecidedLoopIndex,
  recordScalarParams,
} from './javascript-value-facts.js';
import { javascriptStatements } from './javascript-statements.js';
import { paramsAreScalar } from '../boxed-expression/boxed-function.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  functionLiteralDeclaredSignature,
  functionLiteralParameterName,
  optionalParameterDefault,
} from '../boxed-expression/function-literal.js';
import {
  argumentMayBeAbsent,
  declineIntervalAbsentDefault,
  defaultFillingWrapper,
  literalDefaultFills,
  mayBeAbsentAtRunTime,
  targetCoalesce,
} from './compile-parameter-defaults.js';
import type { CompileTarget, TargetSource } from './types.js';
import { descendantRegionAt } from './cse.js';
import { isScalarShaped } from './static-shape.js';
import { compileValueOperand } from './compile-statements.js';
import {
  assertParameterWritesMatchTypes,
  groundSignature,
  signatureParamType,
} from './compile-assignment-checks.js';
import { literalAtGroundSignature } from './compile-user-specialization.js';
import {
  LOCAL_SCALAR,
  assertNoDestructuringParams,
  assertNoRestParams,
} from './compile-declarations.js';
import {
  compileDefinitionBody,
  lambdaParamBinding,
} from './compile-definitions.js';
import { strictLanes } from './compiler-mode.js';
import { laneMismatch } from './compile-lanes.js';
import {
  appliedLiteralLaneMismatchAt,
  callbackArgumentRanks,
  callbackArgumentsOf,
  checkedLiteralApplications,
  expressionParameterVariantTypes,
  literalWithParameterTypes,
  staticMapCallback,
  withCallbackArgumentTypes,
  complexCoercingWrapper,
  markCheckedLiteralApplications,
  declaredParamType,
  literalDeclaredParamTypes,
  scalarFedLiterals,
  absentPointType,
  absentArgumentFork,
  withoutCallbackArguments,
} from './compile-callbacks.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import {
  collectionAtExpressionParameter,
  expressionParameterDecline,
  expressionParameterReadAt,
  signatureParamsLowerToScalars,
} from './compile-user-calls.js';
import { assignedNamesIn, withNestedCseHarvest } from './compile-cse.js';
import {
  LOCAL_UNSHAPED,
  framedLaneByOwnScope,
  isFramedByForeignScope,
} from './compile-shapes.js';
import { cseRegionOf, cseTop, withCseOperand } from './compile-conditions.js';
import { core } from './compiler-core-hooks.js';

/**
 * Check an application of the `Function` literal `literal` to `args`, and
 * return the `compile` callback that the `Apply` handler of a target uses
 * for the rest of the application.
 *
 * An argument that can be a collection, at a parameter declared
 * `expression` that the body reads, is declined
 * (`collectionAtExpressionParameter`): the interpreter binds the collection
 * whole, and the body maps over it, while compiled code reads the parameter
 * as a scalar. Otherwise the returned callback compiles `literal` marked as
 * checked, and the lowering of the literal does not decline it for its
 * parameter declared `expression` (see `compileExprFunctionLiteral`). Any
 * other expression is compiled as `compile` compiles it.
 */
export function checkedAppliedLiteralCompile<T>(
  literal: Expression,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => T
): (e: Expression) => T {
  const at = collectionAtExpressionParameter(
    literal,
    args.map((a) => a.type.type)
  );
  if (at >= 0)
    throw expressionParameterDecline('`Apply`', at, args[at].type.type);
  return (e) => {
    if (e !== literal) return compile(e);
    const unmark = markCheckedLiteralApplications([literal]);
    const outerArgs = appliedLiteralArguments.get(literal);
    appliedLiteralArguments.set(literal, args);
    try {
      return compile(e);
    } finally {
      if (outerArgs === undefined) appliedLiteralArguments.delete(literal);
      else appliedLiteralArguments.set(literal, outerArgs);
      unmark();
    }
  };
}

/**
 * The arguments of the application whose callee is the `Function` literal
 * being compiled (`checkedAppliedLiteralCompile`). The lowering of the
 * literal reads them to check, in strict mode, that no complex-shaped
 * argument reaches a parameter that it compiles in the real lane
 * (`appliedLiteralLaneMismatchAt`).
 */
const appliedLiteralArguments = new WeakMap<
  Expression,
  ReadonlyArray<Expression>
>();

/**
 * A `Function` literal. A case of `compileExpr`: it returns the code, or
 * `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprFunctionLiteral(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'Function') {
    // A callback consumer that passes collections to a parameter declared
    // `expression` that the body reads gets the literal with these
    // parameters typed by the values (`expressionParameterVariantTypes()`):
    // the interpreter binds a collection whole there, and the body maps
    // over it. With `rows: list<list<real>>`, `Map((t: expression) ↦ 2t,
    // rows)` compiles the literal `(t: list<real>) ↦ 2t`.
    const passed = node === undefined ? undefined : callbackArgumentsOf(node);
    if (passed !== undefined && isFunction(node, 'Function')) {
      const variant = expressionParameterVariantTypes(node, passed.types);
      if (variant !== undefined && variant.some((t) => t !== undefined)) {
        const typed = literalWithParameterTypes(engine, node, variant);
        if (typed === undefined)
          throw expressionParameterDecline(
            'a `Function` literal',
            variant.findIndex((t) => t !== undefined)
          );
        return withCallbackArgumentTypes(typed, passed, () =>
          compileExprFunctionLiteral(engine, h, typed.ops, target, typed)
        );
      }
      // A consumer that passes a point or an absent value
      // (`tuple<real, real> | missing`, the element type of
      // `list<tuple<real, real> | missing>`) to a parameter with no
      // declared type. The interpreter binds the point whole, and binds
      // `Missing` to the parameter and runs the body for the absent value.
      // The canonical
      // form types such a parameter as the point only when the element type
      // is a point, so the literal was compiled for a scalar
      // (`(t) => 2 * t`) and gave `[NaN, NaN]`. The literal is compiled
      // with the parameter typed as the point.
      //
      // When the point may be absent, the interpreter binds `Missing` to the
      // parameter and runs the body. The value it gives then depends on the
      // body, and can differ from the literal compiled for any argument:
      // `Map(t ↦ 2t, [(1, 2), Missing])` is `[(2, 4), Missing]` for the
      // literal (the compiled `2 * undefined` is `NaN`), where the named
      // `f2 := t ↦ 2t` gives `[(2, 4), NaN]`, and `Map(t ↦ Length(t), …)`
      // gives `NaN` (the compiled `Length` of `undefined` throws). So the
      // absent point goes to the literal compiled for any argument
      // (`absentArgumentFork()`) only when the body does not read the
      // parameter (`t ↦ 7`), and the literal declines otherwise.
      const params = node.ops.slice(1);
      const points = passed.types.map((t, i) => {
        if (t === undefined || params[i] === undefined) return undefined;
        const declared = declaredParamType(params[i]);
        if (declared !== undefined && declared !== 'unknown') return undefined;
        return absentPointType(t)?.point;
      });
      // A consumer that fills fewer parameters than the literal has (a
      // trailing parameter with a default value): the parameters that
      // receive an absent point are not known here, so the literal
      // declines.
      if (
        passed.types.length !== params.length &&
        passed.types.some((t) => t !== undefined && absentPointType(t)?.absent)
      )
        throw new Error(
          'Could not compile a `Function` literal: its consumer passes it ' +
            'points that may be absent, and fills fewer parameters than ' +
            'the literal has.'
        );
      if (
        passed.types.length === params.length &&
        points.some((t) => t !== undefined)
      ) {
        const typed = literalWithParameterTypes(engine, node, points);
        if (typed === undefined)
          throw new Error(
            'Could not compile a `Function` literal: its consumer passes ' +
              'it points that may be absent, and the literal with the ' +
              'parameter typed as the point is not valid.'
          );
        const code = compileExprFunctionLiteral(
          engine,
          h,
          typed.ops,
          target,
          typed
        );
        if (code === undefined) return undefined;
        const absent = passed.types.map(
          (t, i) =>
            points[i] !== undefined && absentPointType(t!)?.absent === true
        );
        if (!absent.some((a) => a)) return code;
        // The literal for any argument receives every argument, so another
        // argument that may hold a point declines (`pointListValueRef()`).
        if (
          passed.types.some(
            (t, i) => !absent[i] && (t === undefined || !isScalarShaped(t))
          )
        )
          throw new Error(
            'Could not compile a `Function` literal: its consumer passes ' +
              'it a point that may be absent beside an argument that is ' +
              'not a scalar.'
          );
        const body = node.ops[0];
        if (
          absent.some((a, i) => {
            if (!a) return false;
            const name = functionLiteralParameterName(params[i]);
            return name === '' || body.symbols.includes(name);
          })
        )
          throw new Error(
            'Could not compile a `Function` literal: its consumer passes ' +
              'it points that may be absent, at a parameter with no ' +
              'declared type that the body reads, and the value that the ' +
              'interpreter gives for an absent point depends on the body.'
          );
        const generic = withoutCallbackArguments(node, () =>
          compileExprFunctionLiteral(engine, h, node.ops, target, node)
        );
        if (generic === undefined) return undefined;
        return absentArgumentFork(code, generic, absent, target);
      }
    }
    // A literal with a parameter declared `expression` that the body reads
    // is declined when it is compiled as a function value: its arguments
    // are not known at compile time, and one of them can be a collection.
    // The interpreter binds a collection whole to such a parameter and the
    // body maps over it, while compiled code reads the parameter as a
    // scalar: `(t: expression) ↦ 2t` compiles to `(t) => 2 * t`, which
    // gives `NaN` for `[1, 2]` where the interpreter gives `[2, 4]`. The
    // literal is compiled when each of its calls checks its arguments (an
    // `Apply` handler, `checkedAppliedLiteralCompile`, the calls of a
    // block local that is only called, `markCheckedLiteralApplications`, or
    // a callback consumer whose elements cannot be collections,
    // `withCheckedCallback`), or when its consumer passes it run-time
    // scalars only (`withScalarFedLiteral`).
    if (
      node === undefined ||
      (!checkedLiteralApplications.has(node) &&
        scalarFedLiterals.get(node) === undefined)
    ) {
      const at = expressionParameterReadAt(
        node ?? engine.function('Function', [...args])
      );
      if (at >= 0) throw expressionParameterDecline('a `Function` literal', at);
    }
    // Dispatch to target-specific handler if available (e.g. GPU throws)
    const fnFn = target.functions?.(h);
    if (typeof fnFn === 'function') {
      const code = fnFn(
        args,
        (expr) => compileValueOperand(expr, target),
        target
      );
      // The map over list values, as for the arrow below. The map takes as
      // many values as the consumer passes, not one per parameter: the
      // target's lambda fills a parameter with a default value that the
      // consumer does not pass (`lambda x, k=2: k` on Python), and a map
      // with one parameter per parameter of the literal would require it.
      const lowered =
        passed !== undefined &&
        isFunction(node, 'Function') &&
        node.nops > 1 &&
        paramsAreScalar(node.type.type) &&
        signatureParamsLowerToScalars(node.type.type)
          ? callbackArgumentRanks(
              'a `Function` literal',
              passed,
              passed.types.length
            )
          : undefined;
      if (lowered === undefined || !lowered.some((r) => r > 0)) return code;
      const mapped = staticMapCallback(code, lowered, target, passed?.types);
      if (mapped === undefined)
        throw new Error(
          'Could not compile a `Function` literal: its consumer passes it ' +
            'list values, and the target has no map of a function over a list.'
        );
      return mapped;
    }
    // A GENERIC literal is lowered at its GROUND BOUND reading, the same
    // repair the engine-defined route performs in
    // `ensureUserFunctionEmitted`. Reading the bound settles what the CALL
    // boundary does with each argument, but the BODY still canonicalizes
    // against an ERASED parameter (rule G1), so a parameter bounded by a
    // COLLECTION analyzed as a scalar: a block-local
    // `(x: T) -> T where T: list<number>` with a `2x` body emitted `2 * x`,
    // which multiplies the whole array as a number and answers NaN at run
    // time, where the interpreter broadcasts to `[2, 4, 6]`.
    // `literalAtGroundSignature` stamps the ground parameter types onto the
    // literal and re-boxes it, so the body canonicalizes at the type the
    // bound proves. It leaves a SCALAR bound unstamped, so a `where T:
    // number` or `where T: complex` literal is unchanged by it and still
    // reaches the complex shape frame below. JavaScript only, as on the
    // engine route: the coercion and broadcast an emitted call boundary
    // relies on are both JavaScript conventions, and a target with its own
    // definition lowering was never validated against this reading.
    let literal = node;
    let ops = args;
    if (target.language === 'javascript' && isFunction(node, 'Function')) {
      const declared = functionLiteralDeclaredSignature(node);
      const bound =
        declared !== undefined && isPolymorphicType(declared)
          ? groundSignature(declared)
          : undefined;
      if (bound !== undefined) {
        const grounded = literalAtGroundSignature(engine, node, bound);
        literal = grounded;
        ops = grounded.ops;
      }
    }

    // Default: JavaScript arrow function
    assertNoDestructuringParams(ops.slice(1));
    assertNoRestParams(ops.slice(1));
    const params = ops
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    assertParameterWritesMatchTypes(literal, ops, params);
    // A parameter that would shadow the vars object is emitted under a
    // generated name (see `lambdaParamBinding`); `boundVars` keeps the
    // literal's OWN parameter names, which are what the expression binds.
    const binding = lambdaParamBinding(params, ops[0], target);
    // Preserve captured contracts, but an untyped parameter shadows an
    // enclosing declaration of the same name just as a typed one does.
    const declaredVarTypes = { ...target.declaredVarTypes };
    for (const name of params) delete declaredVarTypes[name];
    if (isFunction(literal, 'Function'))
      Object.assign(declaredVarTypes, literalDeclaredParamTypes(literal));
    // A callback runs later, so sibling functions come from the whole
    // enclosing statement list. Its parameters still shadow those siblings.
    const lambdaScope = withBoundScope(
      {
        ...target,
        localFunctions: target.lexicalFunctions ?? target.localFunctions,
      },
      params
    );
    const lambdaTarget: CompileTarget<Expression> = {
      ...target,
      var: binding.varOf,
      renamedWritables: binding.renamedWritables,
      ...lambdaScope,
      declaredVarTypes,
    };
    // Which parameters are declared a NON-REAL NUMBER type, and so make the
    // body compute in the `{ re, im }` complex lane? A parameter's own
    // annotation answers first. Failing that, the literal's declared
    // SIGNATURE does, read at its bounds: a quantified parameter is erased
    // before the literal canonicalizes (rule G1), so for a generic literal
    // such as `(x: T) -> T where T: complex` the bound is the only place the
    // parameter's type survives at all. That is the same ground reading the
    // call boundary performs, so a literal and its call sites agree on which
    // arguments carry the complex convention.
    const ground =
      literal === undefined
        ? undefined
        : groundSignature(functionLiteralDeclaredSignature(literal));
    const annotated = ops.slice(1).map(declaredParamType);
    const declaredType = annotated.map(
      (own, i) => own ?? signatureParamType(ground, i)
    );
    const complexParam = declaredType.map(
      (pt) => pt !== undefined && isNonRealNumber(pt)
    );

    // A consumer that knows every value this literal will receive is a
    // run-time scalar has said so (`withScalarFedLiteral`). The literal then
    // needs no static map (see below), and its body may read each
    // parameter as a scalar: a nested call of a scalar-parameter function
    // takes the direct call form. When the values are also finite numbers
    // by construction (the elements of a range with a finite literal start
    // and step), a comparison against a parameter needs no NaN or
    // `undefined` test either, exactly as for an emitted loop index. A
    // literal with a complex parameter is left as it was, because its
    // parameters hold `{ re, im }` objects in the body.
    //
    // The claim is about the ARGUMENTS only. A parameter is a binding of its
    // own and the body may reassign it (`q = NaN`, `q = [1, 2]`), and after
    // such a write it holds whatever was assigned. So a parameter the body
    // assigns anywhere, a nested function included, gets neither fact. The
    // static map is still left out, because it reads only the arguments.
    const fed =
      target.language === 'javascript' &&
      node !== undefined &&
      literal !== undefined &&
      params.length > 0 &&
      !complexParam.some((c) => c) &&
      paramsAreScalar(literal.type.type) &&
      signatureParamsLowerToScalars(literal.type.type)
        ? scalarFedLiterals.get(node)
        : undefined;
    // A literal whose parameters are all scalar, and that no consumer marks
    // as fed with scalars, is applied to one element at a time: the static
    // map below maps it over a list value that its consumer passes, and a
    // literal with no consumer is the scalar variant. Its parameters hold
    // scalars in the body too, so a
    // nested call of a function with scalar parameters is a direct call
    // (`callArgumentMapRank()`), not a decline for an argument of type
    // `unknown`.
    const elementFed =
      fed === undefined &&
      literal !== undefined &&
      params.length > 0 &&
      !complexParam.some((c) => c) &&
      paramsAreScalar(literal.type.type) &&
      signatureParamsLowerToScalars(literal.type.type);
    if (elementFed) {
      const written = assignedNamesIn(ops[0]);
      recordScalarParams(
        lambdaTarget,
        new Set(params.filter((name) => name !== '_' && !written.has(name)))
      );
    }
    if (fed !== undefined) {
      const written = assignedNamesIn(ops[0]);
      const names = new Set(
        params.filter((name) => name !== '_' && !written.has(name))
      );
      recordScalarParams(lambdaTarget, names);
      if (fed === 'finite')
        for (const name of names) recordDecidedLoopIndex(lambdaTarget, name);
    }

    // A parameter whose complexness comes from the BOUND rather than from its
    // own annotation carries it nowhere the body can read — the parameter
    // symbol's type is the erased one — so the body would compile in the real
    // lane and multiply the `{ re, im }` object it is handed as a number.
    // Enter those parameters in a shape frame, the channel
    // `addDeclaredComplexParams` already uses to put an engine-defined
    // function's declared-complex parameters in the complex lane, so both
    // spellings of one function emit the same body.
    //
    // When such a frame is pushed, EVERY parameter of the literal is entered
    // in it, not only the complex ones. A shape query answers from the
    // innermost frame that MENTIONS the name (`isComplexValued`,
    // `localShapeFrameOf`), and this frame stacks on the enclosing ones, so a
    // parameter left out of its own literal's frame would be answered by an
    // outer frame that happens to bind the same name — a nested literal's
    // REAL `z` would compile in the complex lane under an enclosing complex
    // `z`. Entering every bound name is the discipline `compileBlock` and
    // `withBinderMask` already follow for the names they bind. A non-complex
    // parameter is entered `LOCAL_UNSHAPED`, not `LOCAL_SCALAR`: the entry
    // records that the name is bound here without claiming a shape the
    // declaration does not prove, since a collection-bounded parameter holds
    // an array and `LOCAL_SCALAR` would let a nested call skip its broadcast.
    //
    // The same leak reaches a literal with NO complex parameter at all, which
    // is why the frame is also pushed whenever an enclosing frame describing
    // some other scope already mentions one of these parameter names
    // (`isFramedByForeignScope`). `Map((z) ↦ 2z, [1, 2, 3])` inside a
    // function whose own parameter is a declared-complex `z` compiled its
    // real `z` in the complex lane and answered `[{re: NaN, im: NaN}, …]`
    // behind `success: true`, where the interpreter answers `[2, 4, 6]`.
    // A frame pushed FOR this literal is not a foreign scope and is left in
    // place: `compileCombinerLiteral` frames a fold's combiner in the lanes
    // the fold passes, and shadowing that frame would discard them.
    const framedComplex = new Map<string, boolean>();
    const framedVector = new Map<string, number>();
    if (target.language === 'javascript') {
      const boundDerived = complexParam.some(
        (isComplex, i) => isComplex && annotated[i] === undefined
      );
      const leaked = params.some((name) => isFramedByForeignScope(name, node));
      // A frame already pushed FOR this literal describes every one of its
      // parameters, and that description WINS over the declaration: a fold
      // frames its combiner in the lanes `combinerPlan` chose, and the same
      // plan decides whether the fold's own wrapper lifts the accumulator and
      // the element to `{ re, im }`. A generic combiner such as
      // `(a: T, x: T) -> T where T: complex` makes `boundDerived` true even
      // where the plan keeps the accumulator real, so the declaration is the
      // half that must give way.
      //
      // Deferring means taking the frame's lanes for the WHOLE lowering, not
      // just skipping the second frame: `complexParam` also selects which
      // arguments the literal's own coercing wrapper lifts, and a body left
      // in the frame's real lane behind a wrapper that lifts anyway received
      // `{ re, im }` where it added a number — `Reduce([1+2i, i], (a, x) ↦
      // a + |x|, 0)` under that signature answered the string
      // `"[object Object]2.236…"`, where the interpreter answers `1 + √5`.
      const ownLane = params.map((name) => framedLaneByOwnScope(name, node));
      const selfFramed = ownLane.every((lane) => lane !== undefined);
      if (selfFramed) ownLane.forEach((lane, i) => (complexParam[i] = lane!));
      if (leaked || (boundDerived && !selfFramed))
        params.forEach((name, i) => {
          // The parameter's own lane, from its annotation or from the
          // signature's bound (`complexParam`) — not merely the
          // bound-derived part of it: a parameter the author annotated
          // `complex` is complex here too, and entering it `false` would put
          // the body's reads of it in the real lane.
          framedComplex.set(name, complexParam[i]);
          framedVector.set(
            name,
            complexParam[i] ? LOCAL_SCALAR : LOCAL_UNSHAPED
          );
        });
    }

    // An `Apply` of this literal in strict mode (and in the first attempt of
    // `auto`): a complex-shaped argument at a parameter that `complexParam`
    // puts in the real lane is a `LaneMismatch` decline, as for a call of a
    // named function (`laneMismatchAt`). The body is not compiled again for
    // the lanes of each call: `auto` compiles the whole expression again
    // under `'complex'`, and `strict` declines. Without this check, the
    // `{ re, im }` object of `Apply(x ↦ 2x, √y)` reached a body that
    // multiplies it as a number, and the result was `NaN`.
    const appliedArgs =
      node === undefined ? undefined : appliedLiteralArguments.get(node);
    if (
      appliedArgs !== undefined &&
      strictLanes() &&
      target.language === 'javascript' &&
      isFunction(literal, 'Function')
    ) {
      const i = appliedLiteralLaneMismatchAt(
        literal,
        appliedArgs,
        complexParam,
        declaredType,
        target
      );
      if (i >= 0)
        laneMismatch(
          'applied function-literal parameter',
          params[i] === '_'
            ? `parameter ${i + 1} of the function literal`
            : `the parameter \`${params[i]}\` of the function literal`,
          appliedArgs[i]
        );
    }

    // The body is a bindable region of its own (§5.1(a)); pushed under the
    // lambda's target, so its temporaries land inside the arrow function.
    //
    // That region exists only when the literal is part of the tree the
    // harvest walked. A literal a handler SYNTHESIZES at emission time — the
    // numeric derivative fallback builds `Function(body, x)` around its
    // operand and compiles that (`compileNumericDerivativeFallback`,
    // `library/calculus.ts`) — is not, so its body compiled with no
    // candidates at all, and a subexpression repeated in the body was
    // emitted, and evaluated, once per occurrence: the stencil callback of
    // one corpus row spelled the same minimum of twenty squared distances
    // twenty-one times (Tycho corpus document `lwuwgb9ic5`, 2026-09-16). Such
    // a body gets its own nested harvest, with the parameters shadowed, the
    // way an emitted definition body does. The enclosing instances'
    // temporaries are out of its reach on purpose: a shared node that
    // mentions a parameter denotes a different value inside the lambda.
    // Every name bound around the literal is shadowed too, not only its own
    // parameters: the harvest's admission lookups are engine-global, so a
    // captured outer callback parameter `f` would otherwise be validated
    // against a pure global `f` and two `Map(f, …)` reads merged, where the
    // callback the caller passes may count its calls. (Today such a body
    // computes in the complex lane, whose candidates the harvest refuses
    // anyway; the shadow keeps the rule true when that changes.)
    // One object for the harvest and the emission: `.canonical` builds a
    // fresh expression when the operand is not canonical yet, and a harvest
    // keyed on one object is invisible to the emission of another.
    const bodyNode = ops[0].canonical;
    const top = cseTop(target);
    const harvested =
      top === undefined ||
      literal === undefined ||
      descendantRegionAt(cseRegionOf(top), literal, 0) !== undefined;
    // The value of the body is returned whole to the callers, as the body
    // of an emitted definition is: a target that spells collection values
    // only in consuming positions (`CompileTarget.compileCollectionValue`)
    // gets the body offered to that spelling first
    // (`compileDefinitionBody`). On a target without that spelling, this
    // is `compileOp(literal, 0, …)`.
    const emitBody = () =>
      withCseOperand(literal, 0, lambdaTarget, () =>
        compileDefinitionBody(bodyNode, lambdaTarget)
      );
    const compileBody = () =>
      harvested
        ? emitBody()
        : withNestedCseHarvest(
            bodyNode,
            lambdaTarget,
            [...(lambdaTarget.boundVars ?? params)],
            emitBody
          );
    // An absent argument (`undefined`) at a parameter ANNOTATED with a
    // numeric type is read as `NaN`, as the interpreter reads it
    // (`makeLambda`, `function-utils.ts`). An inferred type does not
    // select the default; only the annotation does. The reading is a
    // JavaScript default value, which applies exactly when the argument is
    // `undefined`. The literal is also a function VALUE, and a consumer of
    // a function value (`Map`, `Filter`, …) hands it the elements as they
    // are, so the call sites cannot do it (`absentArgumentChecks`). A
    // complex-lane parameter is left out: its wrapper
    // (`complexCoercingWrapper`) converts the argument, and reads an absent
    // one as `NaN`, before the arrow receives it.
    // A parameter with a default value (`(x, k = 2) => x * k`) is filled
    // when its argument is absent: left out, or supplied absent. The default
    // is compiled as an operand written at the call site, by this target,
    // so that a value default is the target's spelling of the value (an
    // interval constant on the interval target) and a symbol default is
    // read at each call, as the interpreter reads it. A consumer of the
    // function value (`Map`, …) calls it with the arguments it has, so the
    // fill is in the emitted function, not at the call sites.
    //
    // The fill is an outer wrapper (`defaultFillingWrapper`), outside the
    // complex-coercing wrapper and the static map, so they receive every
    // argument. Its parameter names are fresh: a symbol default can be
    // spelled with the name of a parameter of the arrow.
    const literalParams = ops.slice(1);
    // An application that supplies every argument still reads a default
    // for an argument that is absent (`f(At(L, 100))`).
    const fills = literalDefaultFills(literalParams, (e) =>
      compileValueOperand(e, target)
    );
    // The interval target fills only an argument that is left out, and
    // declines an argument that can be absent at run time
    // (`declineIntervalAbsentDefault`): one of the application of the
    // literal, or one that the consumer of the literal passes (`Map`).
    if (fills.some((f) => f !== undefined)) {
      const defaults = literalParams.map((p) => optionalParameterDefault(p));
      if (appliedArgs !== undefined)
        declineIntervalAbsentDefault(
          target,
          defaults,
          appliedArgs.length,
          (i) => argumentMayBeAbsent(appliedArgs[i], defaults[i]!),
          'a `Function` literal'
        );
      const passedTypes = passed?.types;
      if (passedTypes !== undefined)
        declineIntervalAbsentDefault(
          target,
          defaults,
          passedTypes.length,
          (i) =>
            passedTypes[i] === undefined ||
            mayBeAbsentAtRunTime(passedTypes[i]!),
          'a `Function` literal'
        );
    }
    const emittedParams = binding.emitted.map((name, i) =>
      target.language === 'javascript' &&
      !complexParam[i] &&
      annotated[i] !== undefined &&
      isSubtype(annotated[i]!, 'number')
        ? `${name} = NaN`
        : name
    );
    const arrow = `((${emittedParams.join(', ')}) => ${
      framedComplex.size > 0
        ? // Owned by the node being lowered: the frame describes THIS
          // literal's parameters, so a re-entrant emission of the same
          // literal keeps it, while a nested literal binding the same name
          // sees a foreign frame and shadows it.
          core.withLocalShapeFrame(
            framedComplex,
            framedVector,
            compileBody,
            false,
            node
          )
        : compileBody()
    })`;

    // A complex-lane body reads `.re`/`.im` off its parameter, while every
    // consumer of a function VALUE hands the callee a RAW element:
    // `Map((x: complex) ↦ 2x, [1, 2, 3])` fed the arrow plain numbers and
    // answered `[{re: null, im: null}, …]` behind `success: true`, where the
    // interpreter answers `[2, 4, 6]`. A NAMED function is protected by the
    // `$v` shim (`ensureUserFunctionValueRef`); a literal has no name to bind
    // one under, so it takes the same wrapper inline, at the same positions.
    // The `{ re, im }` convention is a JavaScript one, so a target that never
    // wraps its arguments emits the bare arrow as before.
    const callee =
      target.language === 'javascript' && complexParam.some((c) => c)
        ? `(${complexCoercingWrapper(arrow, complexParam, target)})`
        : arrow;

    // The MAP over list values, the second coercion a raw element needs. A
    // literal whose parameters are all scalar is applied element-wise by the
    // interpreter when an argument is a collection, but the arrow's body is
    // emitted for scalars only. The static types of the values that the
    // consumer passes (`callbackArgumentsOf()`) select the variant: the
    // arrow itself over scalar values, and a static map of it over list
    // values (`((_tv1) => (_tv2) => _SYS.mapFn(_tv1, [1], _tv2))(arrow)`,
    // `_IA.mapFn` on interval-js, a comprehension on Python). A value whose
    // shape is not settled declines (`callbackArgumentRanks()`). A literal
    // with no consumer (the root `compile(f)`, a local that a block stores
    // or returns, an argument of a call) is the scalar variant, the arrow.
    //
    // A literal with a collection-typed parameter binds its argument whole
    // (the same `paramsAreScalar` reading `applyFunctionLiteral` makes) and
    // keeps the bare arrow, as does a parameterless one, which has no
    // argument that could be a collection. So does a literal whose consumer
    // proved that every argument it passes is a scalar (`fed`).
    const ranks =
      fed === undefined &&
      passed !== undefined &&
      params.length > 0 &&
      literal !== undefined &&
      paramsAreScalar(literal.type.type) &&
      signatureParamsLowerToScalars(literal.type.type)
        ? callbackArgumentRanks(`a \`Function\` literal`, passed, params.length)
        : undefined;
    const maps = ranks !== undefined && ranks.some((r) => r > 0);
    // The wrapper that fills the parameters with a default value (see
    // `fills` above), around `value`. `only` limits it to the parameters
    // from that position on.
    const withDefaults = (value: string, only = 0): string => {
      const these = fills.map((f, i) => (i < only ? undefined : f));
      if (!these.some((f) => f !== undefined)) return value;
      const bound = tempVar(target);
      const wrapper = defaultFillingWrapper(
        bound,
        these,
        () => tempVar(target),
        targetCoalesce(target)
      );
      return (
        javascriptStatements(target)?.parameters([[bound, value]], wrapper) ??
        `((${bound}) => ${wrapper})(${value})`
      );
    };
    if (maps) {
      // The map hands the callee one element per call, and each element
      // that is absent takes the default: the fill is inside the map. A
      // parameter that the consumer leaves out is filled outside the map
      // too, so that the map receives a value for it.
      const mapped = staticMapCallback(
        withDefaults(callee),
        ranks!,
        target,
        passed?.types
      );
      if (mapped === undefined)
        throw new Error(
          'Could not compile a `Function` literal: its consumer passes it ' +
            'list values, and the target has no map of a function over a list.'
        );
      return withDefaults(mapped, passed?.types.length ?? 0);
    }
    return withDefaults(callee);
  }
  return undefined;
}
