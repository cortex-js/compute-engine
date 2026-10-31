// Function-call and tuple-call expressions.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { isFiniteIndexedCollection } from '../collection-utils.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import type { CompileTarget, CompiledFunction, TargetSource } from './types.js';
import { isRealOnlyLowering } from './compiler-mode.js';
import {
  complexLoweringOf,
  realGuardCandidate,
  realOnlyGuardOperands,
} from './compile-lanes.js';
import { operandCompiler } from './compile-cse.js';
import { core } from './compiler-core-hooks.js';
import {
  isBroadcastExemptTupleOperand,
  realOnlyResultKind,
} from './compile-operators.js';
import { compileBroadcastUnary } from './compile-broadcast.js';
import { declaredScalarTupleCall } from './compile-user-functions.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { compileValueOperand } from './compile-statements.js';
import { typedTemp } from './compile-declarations.js';
import { wholeTupleCall } from './compile-assignment-checks.js';

/**
 * The call of a function whose lowering is a function of the target. A case
 * of `compileExpr`: it returns the code, or `undefined` when `compileExpr`
 * continues with its next case.
 */
export function compileExprFunctionCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  fn: CompiledFunction<Expression> | undefined
): TargetSource | undefined {
  if (typeof fn === 'function') {
    // The same real-only rule the string-mapped branch below applies, for
    // the heads whose lowering is real-only but spelled as function codegen
    // (`Math.floor`, `sign(x)·round(|x|)`, `Math.max`, `np.floor`, …). See
    // `REAL_ONLY_BY_DEFINITION` for the families and the NaN each one was
    // measured producing behind `success: true`, and `isRealOnlyLowering`
    // for the heads each target declares real-only.
    if (isRealOnlyLowering(target, h)) {
      // The operands the gate scans and binds — the args themselves,
      // except `ColorFromColorspace`, whose maybe-complex scalars live
      // INSIDE its literal components tuple (`realOnlyGuardOperands`).
      const guardArgs = realOnlyGuardOperands(h, args);
      if (guardArgs.some((a) => realGuardCandidate(a, engine, target))) {
        // D2/D6 runtime rule (see `realOperandGuard`): each maybe-complex
        // scalar operand is bound once and the real lowering runs on its
        // real part when every imaginary part is exactly zero; otherwise
        // the failing branch has the SAME shape the head returns — scalar
        // NaN for the scalar heads, an equally-sized NaN-filled array for
        // the color constructors (`realOnlyResultKind`). An ARRAY operand
        // whose elements may be complex takes the element-wise form: the
        // real lowering broadcasts or reduces over the projected array.
        // A head the target also lowers for complex operands
        // (`complexLowering`: the mean and the variance of complex data)
        // takes that lowering instead.
        const complex = complexLoweringOf(target, h);
        if (complex !== undefined)
          return complex.lowering(args, operandCompiler(node, target), target);
        const guarded = core.realOperandGuard(
          engine,
          h,
          guardArgs,
          target,
          () => core.compileExpr(engine, h, args, prec, target, node),
          realOnlyResultKind(h)
        );
        if (guarded !== undefined) return guarded;
        throw new Error(
          `Could not compile \`${h}\`: the target's lowering for this head is real-only and cannot represent a complex-valued argument.`
        );
      }
    }

    // A `broadcastable` head over a single finite indexed collection:
    // apply the head's scalar element lowering across the collection. How
    // that is spelled is a property of the TARGET LANGUAGE, not of the base
    // compiler — Python fans out with a comprehension, the shader languages
    // are already componentwise on a `vecN` and do not fan out at all — so
    // it is delegated to the target's `broadcastUnary` hook. A target
    // without one fails closed; the base compiler used to emit a
    // JavaScript `.map((v) => …)` arrow here for EVERY target, which is not
    // valid GLSL, WGSL or Python.
    //
    // A tuple operand of a head that declares the `'tuples'` broadcast
    // exemption is NOT a source of cells here: the head owns that shape and
    // consumes it whole, so the fan-out stands aside and the head's own
    // codegen (`fn`, below) receives the tuple entire — see
    // `isBroadcastExemptTupleOperand`.
    //
    // A head named in `CompileTarget.collectionAwareHeads` stands the
    // fan-out down for the whole operand, for the same reason and with the
    // same consequence: its codegen dispatches on the collection itself, or
    // declines. A provably STRING operand is included: a string is a
    // finite indexed collection of its grapheme clusters, so the fan-out
    // used to intercept `AsRgb("red")` and decline for want of a
    // `broadcastUnary` lowering, while the head's own codegen reads that
    // string as ONE CSS color and compiles it.
    const def = engine.lookupDefinition(h);
    const collectionAwareHead =
      target.collectionAwareHeads?.has(h) === true && args.length === 1;
    if (
      isOperatorDef(def) &&
      def.operator.broadcastable &&
      args.length === 1 &&
      isFiniteIndexedCollection(args[0]) &&
      !collectionAwareHead &&
      !isBroadcastExemptTupleOperand(engine, h, args[0])
    ) {
      const broadcast = compileBroadcastUnary(engine, h, args[0], fn, target);
      if (broadcast !== undefined) return broadcast;
      throw new Error(
        `Could not compile \`${h}\`: an element-wise broadcast over the collection ` +
          `\`${args[0].toString()}\` on the ${
            target.language ?? 'javascript'
          } target has no \`broadcastUnary\` lowering for this shape. ` +
          `Materialize the collection with evaluate() and ` +
          `compile a scalar element function instead.`
      );
    }
    // The index-aware operand compiler (`OperandCompiler`): a handler that
    // lowers a construct with conditionally-evaluated operand positions
    // passes the index for those positions and gets the matching CSE region
    // instance. A handler that omits it compiles exactly as before.
    const code = fn(args, operandCompiler(node, target), target);
    // A target with a static type system gets to reject the emission for the
    // operand shapes it was given (`CompileTarget.checkOperandShapes`); it
    // throws to fail closed. No hook: unchanged.
    target.checkOperandShapes?.(h, args, code, target);
    // A head that ALSO has an infix spelling gets the same precedence
    // treatment its infix emission would have received. A function handler
    // takes over when the infix path declines — a collection operand, a
    // complex one — but it lowers the very same operator, so its emission
    // binds just as loosely: the GPU `Add` handler emits
    // `vec2(a, b) + vec2(c, d)` for a sum of two points, and splicing that
    // into an enclosing `s * …` without parentheses yielded
    // `s * vec2(a, b) + vec2(c, d)`, read as `(s * P) + Q`. Wrapping here on
    // `op[1] < prec` mirrors the infix path's own rule verbatim.
    const opPrec = target.operators?.(h)?.[1];
    if (opPrec !== undefined && opPrec < prec) return `(${code})`;
    return code;
  }
  return undefined;
}

/**
 * The call of a function whose scalar parameter receives a tuple, compiled as
 * the tuple of the calls at each component. A case of `compileExpr`: it
 * returns the code, or `undefined` when `compileExpr` continues with its next
 * case.
 */
export function compileExprTupleCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  {
    const mappedArgs = new Set<number>();
    let tupleCall = declaredScalarTupleCall(
      engine,
      h,
      args,
      target,
      mappedArgs
    );
    // The interpreter evaluates each argument once, then maps the call over
    // the components. The rewrite writes an argument that is not mapped
    // (`Random()` in `Apply((u: real, w: real) ↦ w, (1, 2), Random())`)
    // into each component call, which would evaluate it once per
    // component. Thus each argument with an effect is first bound to a
    // temporary of the same type, and the component calls read the
    // temporary. A `Tuple` or `List` literal that the rewrite maps over is
    // not bound whole: its parts are the mapped components, and each one is
    // read once. But each component call reads its part where the call is
    // emitted, after the temporaries of the other arguments, and the
    // interpreter evaluates all the arguments, in order, before any call.
    // Thus each part with an effect is bound to its own temporary too, in
    // the order of the arguments, and the literal is written again with
    // the temporaries. A part that is itself a `Tuple` or `List` literal
    // maps again, so its own parts are bound the same way.
    // `Apply((u: real, w: real) ↦ w - u, (Random(), Random()), Random())`
    // draws the two components before `w`, as the interpreter does. A
    // literal at a position that is not mapped (a parameter with no
    // declared type, or a `list<…>` parameter that receives the list whole)
    // is written whole into each component call, so it is bound like any
    // other argument. A target with no value binding (a shader) keeps the
    // rewrite as it is.
    const bindings: Array<[string, TargetSource]> = [];
    let inner = target;
    if (
      tupleCall !== undefined &&
      target.bindExpr !== undefined &&
      args.some((a) => a.isPure === false)
    ) {
      const names: string[] = [];
      const bind = (a: Expression): Expression => {
        const name = tempVar(target);
        names.push(name);
        bindings.push([name, compileValueOperand(a, target)]);
        return typedTemp(engine, name, a.type.type);
      };
      const bindParts = (a: Expression): Expression => {
        if (a.isPure !== false) return a;
        if (!isFunction(a, 'Tuple') && !isFunction(a, 'List')) return bind(a);
        return engine.function(a.operator, a.ops.map(bindParts));
      };
      const boundArgs = args.map((a, i) => {
        if ((h === 'Apply' && i === 0) || a.isPure !== false) return a;
        if (
          mappedArgs.has(i) &&
          (isFunction(a, 'Tuple') || isFunction(a, 'List'))
        )
          return bindParts(a);
        return bind(a);
      });
      if (names.length > 0) {
        tupleCall = declaredScalarTupleCall(engine, h, boundArgs, target);
        // The temporaries are parameters of the binding emitted below, so
        // they are read by their own names, not as keys of the variables
        // object.
        inner = {
          ...target,
          var: (id) => (names.includes(id) ? id : target.var(id)),
          ...withBoundScope(target, names),
        };
      }
    }
    if (tupleCall !== undefined) {
      // A shader writes a tuple as a float vector (`vec2`), which cannot
      // hold the booleans of a tuple of boolean results, as for
      // `Not((A, B))`.
      if (
        (target.language === 'glsl' || target.language === 'wgsl') &&
        isFunction(tupleCall) &&
        tupleCall.ops.some((x) => x.type.matches('boolean'))
      )
        throw new Error(
          `Could not compile a call over the tuple argument of \`${h}\`: ` +
            `the result is a tuple of booleans, which target ` +
            `'${target.language}' cannot represent as a vector.`
        );
      if (bindings.length > 0)
        return target.bindExpr!(bindings, core.compile(tupleCall, inner, 0));
      return core.compile(tupleCall, target, prec);
    }
    // On the JavaScript target, a tuple at a parameter with no declared
    // type is bound whole (`wholeTupleCall`).
    if (target.language === 'javascript') {
      const whole = wholeTupleCall(engine, h, args, target);
      if (whole !== undefined) return core.compile(whole, target, prec);
    }
  }
  return undefined;
}
