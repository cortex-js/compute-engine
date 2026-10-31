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
} from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import { descendantRegionAt } from './cse.js';
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
import {
  broadcastingWrapper,
  complexCoercingWrapper,
  declaredParamType,
  literalDeclaredParamTypes,
  scalarFedLiterals,
} from './compile-callbacks.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { signatureParamsLowerToScalars } from './compile-user-calls.js';
import { assignedNamesIn, withNestedCseHarvest } from './compile-cse.js';
import {
  LOCAL_UNSHAPED,
  framedLaneByOwnScope,
  isFramedByForeignScope,
} from './compile-shapes.js';
import { cseRegionOf, cseTop, withCseOperand } from './compile-conditions.js';
import { core } from './compiler-core-hooks.js';

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
    // Dispatch to target-specific handler if available (e.g. GPU throws)
    const fnFn = target.functions?.(h);
    if (typeof fnFn === 'function')
      return fnFn(args, (expr) => compileValueOperand(expr, target), target);
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
    const complexParam = annotated.map((own, i) => {
      const pt = own ?? signatureParamType(ground, i);
      return pt !== undefined && isNonRealNumber(pt);
    });

    // A consumer that knows every value this literal will receive is a
    // run-time scalar has said so (`withScalarFedLiteral`). The literal then
    // needs no broadcast wrapper (see below), and its body may read each
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
    // wrapper is still left out, because the arguments are what it tests.
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

    // The BROADCAST coercion, the second one a raw element needs. A literal
    // whose parameters are all scalar is applied element-wise by the
    // interpreter when an argument is a collection — `Map((x) ↦ 2x,
    // [[1, 2], [], [3]])` answers `[[2, 4], [], [6]]` — but the arrow's body
    // is emitted for scalars only, so the bare arrow multiplied a whole row
    // as a number and answered `[NaN, 0, 6]` behind `success: true`. The
    // wrapper is the one a NAMED scalar-parameter function is handed out
    // under (`ensureUserFunctionValueRef`), with the same `_SYS.bcastFn`
    // helper, so the two spellings of one function behave alike.
    //
    // The arrow is bound to a name FIRST, because the wrapper mentions its
    // callee twice: splicing the arrow text into both arms would construct a
    // fresh closure on every element. A statement sink flattens the binding
    // into a `const`; without one it stays an immediately applied arrow.
    //
    // A literal with a collection-typed parameter binds its argument whole
    // (the same `paramsAreScalar` reading `applyFunctionLiteral` makes) and
    // keeps the bare arrow, as does a parameterless one, which has no
    // argument that could be a collection. So does a literal whose consumer
    // proved that every argument it passes is a scalar (`fed`): the
    // wrapper's `Array.isArray` test can never be true there.
    if (
      fed === undefined &&
      target.language === 'javascript' &&
      params.length > 0 &&
      literal !== undefined &&
      paramsAreScalar(literal.type.type) &&
      signatureParamsLowerToScalars(literal.type.type)
    ) {
      const bound = tempVar(target);
      const wrapper = broadcastingWrapper(
        bound,
        params.length,
        target,
        'bcastFn'
      );
      return (
        javascriptStatements(target)?.parameters([[bound, callee]], wrapper) ??
        `((${bound}) => ${wrapper})(${callee})`
      );
    }
    return callee;
  }
  return undefined;
}
