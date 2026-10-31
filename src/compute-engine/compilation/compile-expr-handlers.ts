// The remaining compileExpr handlers: captured bodies, declared-top guards,
// element-wise broadcast, GPU relations and points, Declare, Coalesce, Assign,
// ApplyField, Typed and AssertPresent.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { lookupApplicable } from '../function-utils.js';
import {
  couldBeNumericTuple,
  isFiniteIndexedCollection,
  isNumericTuple,
  isTupleShapedType,
} from '../collection-utils.js';
import { provablyAdmits } from '../../common/type/subtype.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  isSymbol,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  protocolDispatchCandidates,
  protocolOfSymbol,
} from '../engine-protocols.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  CONTROL_FLOW_HEADS,
  DECLARED_TOP_GUARD_HEADS,
  LOGICAL_BROADCAST_HEADS,
  SCALAR_ARITHMETIC_HEADS,
} from './compiler-tables.js';
import { isCompileBoundName } from './compiler-names.js';
import {
  blockLocalFunction,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import { CompilerState } from './compiler-state.js';
import {
  collectDeclaredTopSymbols,
  compilationType,
  isBoundPossiblyCollectionTyped,
  isGatedIndexedCollection,
  isGatedPoint,
  isProvablyStringOperand,
  isRuntimePointShaped,
} from './compiler-type-facts.js';
import { core } from './compiler-core-hooks.js';
import {
  _codeAliases,
  _codeOverrides,
  isRealOnlyLowering,
  withPromotionSuppressed,
} from './compiler-mode.js';
import { ATOMIC_FRAGMENT, absenceAxisForType } from './compile-absence.js';
import { tempVar } from './compiler-naming.js';
import {
  compileOp,
  compileOpValue,
  operandCompiler,
  withCseIsolatedInstance,
} from './compile-cse.js';
import {
  tryCompileBroadcast,
  tryCompilePythonElementwise,
} from './compile-broadcast.js';
import { isArrayOperand } from './compile-real-analysis.js';
import {
  LANE_RECORD_LANGUAGES,
  ascriptionText,
  complexLoweringOf,
  isRealScalarAscription,
  realAscriptionError,
  realEntriesType,
  realGuardCandidate,
  realOnlyGuardOperands,
} from './compile-lanes.js';
import {
  isBroadcastExemptTupleOperand,
  isHypotPointLeg,
  realOnlyResultKind,
} from './compile-operators.js';
import { isNonScalarShape, isProvablyRealValued } from './compile-shapes.js';
import {
  declareValueOperand,
  promotionActive,
} from './compile-declarations.js';
import {
  assertAssignmentIsStatement,
  assertExpressionValue,
  compileValueOperand,
} from './compile-statements.js';
import { tryCompileProtocolDispatch } from './compile-protocol-dispatch.js';
import { readsAsScalarThroughFreeInputs } from './compile-user-calls.js';
import { removeDefinitionsAddedSince } from './compile-definitions.js';
import { assignLValue } from './compile-locals.js';
import { mayHoldComplexElement } from './compile-complexness.js';

/**
 * The call of a function whose body was captured, which an ambient function
 * of the same name cannot replace. A case of `compileExpr`: it returns the
 * code, or `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprCapturedBody(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (
    node !== undefined &&
    isFunction(node) &&
    node.operator === h &&
    !CONTROL_FLOW_HEADS.has(h) &&
    !isCompileBoundName(h) &&
    target.varsKeys?.has(h) !== true &&
    blockLocalFunction(h, target) === undefined
  ) {
    const value = node.valueDefinition;
    const operator = node.operatorDefinition;
    const held =
      value?.value ??
      (operator as { _lambdaLiteral?: Expression } | undefined)?._lambdaLiteral;
    const ambient =
      held !== undefined && isFunction(held, 'Function')
        ? lookupApplicable(h, engine.context.lexicalScope)
        : undefined;
    if (
      held !== undefined &&
      isFunction(held, 'Function') &&
      ((value !== undefined &&
        (!ambient || !isValueDef(ambient) || ambient.value !== value)) ||
        (operator !== undefined &&
          (!ambient ||
            !isOperatorDef(ambient) ||
            ambient.operator !== operator)))
    )
      throw new Error(
        ambient === undefined
          ? `Could not compile \`${h}\`: the captured callable definition is not in scope.`
          : `Could not compile \`${h}\`: the captured callable has a different binding from the ambient function.`
      );
  }
  return undefined;
}

/**
 * The JavaScript code of an arithmetic head, a comparison or another
 * element-wise head (`DECLARED_TOP_GUARD_HEADS`) with an operand whose
 * value may be a list although the compiled lanes read it as a number: a
 * symbol declared `any` or `value`, or a library application over one
 * (`isDeclaredTopOperand`). `undefined` when no operand is such an
 * operand, and the caller continues as before.
 *
 * The compiled lanes read such a symbol as a number, because a host that
 * declares every parameter `any` would otherwise pay for a broadcast at
 * every arithmetic site (`possiblyCollectionTypedForCompile`). But the
 * host can pass a list, and the JavaScript operators give a wrong value
 * for a list: `p + q` gave the string `"1,23,4"` for `[1, 2]` and
 * `[3, 4]`, where the interpreter gives `[4, 6]`. So the code checks the
 * values of the declared symbols at run time:
 *
 * `(!(Array.isArray(_.p) || ArrayBuffer.isView(_.p)) && … ? _.p + _.q :
 * <list code>)`
 *
 * The scalar branch is the code compiled before this check existed, so a
 * value that is not an array (a number, a complex number, an absent value)
 * gives the same result as before, and the cost for a number is one
 * `Array.isArray` and one `ArrayBuffer.isView` test per symbol. A plain
 * read such as `_.p` is repeated in the test; any other read is evaluated
 * once, into a temporary. Each operand is still evaluated once, in the
 * branch that runs. The list code is the code of an operand that may be
 * a number or a list at run time (`_SYS.bcast`, `_SYS.eq`). For `Multiply`
 * and `Power` it is the ENTRY-WISE code, not the matrix product or the
 * matrix power: an `any` value may hold a list of points, and compiled code
 * holds a list of points `[(1, 2), (3, 4)]` and the matrix
 * `[[1, 2], [3, 4]]` as the same array, so it cannot tell them apart. The
 * bare `list` type makes the same choice (ROADMAP CE-216).
 *
 * Only the outermost such site of an expression has the check: both
 * branches are compiled with `declaredTopMode` set, and no check is emitted
 * inside them. When the list code cannot be compiled, the scalar code is
 * returned, as before.
 */
export function declaredTopGuard(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (CompilerState.declaredTopMode !== undefined) return undefined;
  if (!DECLARED_TOP_GUARD_HEADS.has(h)) {
    const def = engine.lookupDefinition(h);
    if (!isOperatorDef(def) || def.operator.broadcastable !== true)
      return undefined;
  }
  const symbols = new Set<Expression>();
  const visited = new Set<Expression>();
  for (const a of args) collectDeclaredTopSymbols(a, symbols, visited);
  if (symbols.size === 0) return undefined;

  // The code that reads each symbol, grouped: two nodes of one symbol give
  // the same code, and are tested once. A node that already has a
  // replacement code (`_codeOverrides`, `_codeAliases`) is read through it
  // and is not given a second one.
  const nodesOfRead = new Map<string, Expression[]>();
  for (const s of symbols) {
    const read = core.compile(s, target);
    if (_codeOverrides.has(s) || _codeAliases.has(s)) continue;
    const nodes = nodesOfRead.get(read);
    if (nodes === undefined) nodesOfRead.set(read, [s]);
    else nodes.push(s);
  }

  // A read that is not a plain name or property access (a `vars` mapping
  // can be any source, such as `_.values.shift()`) is evaluated once, into
  // a temporary. The test and both branches then read the temporary, so
  // the value that is tested is the value that is used. A plain read such
  // as `_.p` stays inline, as the other run-time checks of this compiler
  // do (`ATOMIC_FRAGMENT`).
  const outer: Array<[string, TargetSource]> = [];
  const reads: Array<{ code: TargetSource; nodes: Expression[] }> = [];
  for (const [read, nodes] of nodesOfRead) {
    if (ATOMIC_FRAGMENT.test(read)) {
      reads.push({ code: read, nodes });
      continue;
    }
    const name = tempVar(target);
    outer.push([name, read]);
    reads.push({ code: name, nodes });
  }
  const bind = (
    bindings: Array<[string, TargetSource]>,
    body: TargetSource
  ): TargetSource =>
    bindings.length === 0
      ? body
      : (target.bindExpr?.(bindings, body) ??
        `((${bindings.map(([n]) => n).join(', ')}) => ${body})(${bindings.map(([, c]) => c).join(', ')})`);

  // Compile `h` with the mode set and the symbol nodes read through
  // `codes` (one code per entry of `reads`). Each compilation has its own
  // region of common subexpressions that cannot read a temporary bound
  // outside it (`withCseIsolatedInstance`): the same structure has scalar
  // code in one branch and list code in the other, so a temporary bound in
  // one branch must not be read in the other, or before the test.
  const compileIn = (
    mode: 'scalar' | 'list',
    codes: ReadonlyArray<TargetSource>
  ): TargetSource => {
    const installed: Expression[] = [];
    CompilerState.declaredTopMode = mode;
    try {
      reads.forEach(({ nodes }, i) => {
        for (const s of nodes) {
          _codeAliases.set(s, codes[i]);
          installed.push(s);
        }
      });
      return withCseIsolatedInstance(target, () =>
        core.compileExpr(engine, h, args, prec, target, node)
      );
    } finally {
      CompilerState.declaredTopMode = undefined;
      for (const s of installed) _codeAliases.delete(s);
    }
  };

  const scalar = compileIn(
    'scalar',
    reads.map(({ code }) => code)
  );
  // The list code reads each symbol through a second temporary that holds
  // a plain array: the list kernels (`_SYS.bcast`, `_SYS.eq`) test for a
  // plain `Array`, and a host can pass a numeric typed array
  // (`Float64Array`) for a symbol declared `any`. `_SYS.plainList` copies
  // such an array, and returns any other value as it is.
  const listNames = reads.map(() => tempVar(target));
  let list: TargetSource;
  try {
    list = compileIn('list', listNames);
  } catch {
    return bind(outer, scalar);
  }
  // When the list code is the scalar code with other names, the check
  // changes nothing. The names are fresh temporaries, so they occur in the
  // list code only where a symbol was read.
  let listAsScalar = list;
  listNames.forEach((name, i) => {
    listAsScalar = listAsScalar.replace(
      new RegExp(`\\b${name}\\b`, 'g'),
      () => reads[i].code
    );
  });
  if (listAsScalar === scalar) return bind(outer, scalar);
  const listCode = bind(
    listNames.map((name, i) => [name, `_SYS.plainList(${reads[i].code})`]),
    list
  );
  // A numeric typed array is a list too: it takes the list code.
  const test = reads
    .map(
      ({ code }) => `!(Array.isArray(${code}) || ArrayBuffer.isView(${code}))`
    )
    .join(' && ');
  return bind(outer, `(${test} ? ${scalar} : ${listCode})`);
}

/**
 * The element-wise JavaScript broadcast of a `broadcastable` head over list
 * operands. A case of `compileExpr`: it returns the code, or `undefined` when
 * `compileExpr` continues with its next case.
 */
export function compileExprElementwiseBroadcast(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (target.language === 'javascript') {
    const guarded = declaredTopGuard(engine, h, args, prec, target, node);
    if (guarded !== undefined) return guarded;
    const broadcast = tryCompileBroadcast(engine, h, args, target, node);
    if (broadcast !== null) return broadcast;
    // The broadcast closure declines a REAL-ONLY head (`Floor`, `Mod`,
    // `Erf`, …) whose array operand has a complex element lane, and the
    // list-arithmetic residue below would then fail the form closed before
    // the real-only gates further down (`isRealOnlyLowering`) ever see
    // it. Apply the element-wise run-time realness rule here: at each
    // position, the real lowering runs on the real part of an element whose
    // imaginary part is exactly zero, and any other element gives NaN (the
    // D2/D6 rule of `realOperandGuard`). The operands are projected onto
    // the real lane and the head is re-emitted, which re-enters the closure above with real element
    // lanes — `⌊√L⌋` at `L = [4, -1]` compiles to `[2, NaN]`.
    // (A form without an array operand is left to those gates, so its
    // scalar emission is unchanged.)
    if (isRealOnlyLowering(target, h) && args.some((a) => isArrayOperand(a))) {
      const guardArgs = realOnlyGuardOperands(h, args);
      if (guardArgs.some((a) => realGuardCandidate(a, engine, target))) {
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
        // The rule declined (a maybe-complex set or dictionary operand, an
        // undecided element lane): fail closed here rather than fall
        // through to the later gate, which would repeat the same analysis
        // before reaching the same decline.
        throw new Error(
          `Could not compile \`${h}\`: the target's lowering for this head is real-only and cannot represent a complex-valued argument.`
        );
      }
    }
  }
  return undefined;
}

/**
 * A relational or logical head over tuple operands on the GLSL and WGSL
 * targets. A case of `compileExpr`: it returns the code, or `undefined` when
 * `compileExpr` continues with its next case.
 */
export function compileExprGpuRelational(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (
    (target.language === 'glsl' || target.language === 'wgsl') &&
    (isRelationalOperator(h) || LOGICAL_BROADCAST_HEADS.has(h))
  ) {
    const isTupleShaped = (a: Expression): boolean => {
      if (isFunction(a, 'Tuple')) return true;
      const t = compilationType(a);
      return typeof t !== 'string' && t.kind === 'tuple';
    };
    const tupleEquality =
      target.language === 'glsl' && (h === 'Equal' || h === 'NotEqual');
    const offending = args.find(
      (a) =>
        !core.isComplexValued(a) &&
        isNonScalarShape(a) &&
        !(tupleEquality && isTupleShaped(a))
    );
    if (offending !== undefined)
      throw new Error(
        `Could not compile \`${h}\`: a comparison or logical connective over the ` +
          `non-scalar operand \`${offending.toString()}\` on the ` +
          `${target.language} target — the shader infix operators are ` +
          `scalar-only (element-wise conditions compile only inside a ` +
          `\`Which\`/\`If\` selection).`
      );
  }
  return undefined;
}

/**
 * The products and sums of points that the GLSL and WGSL targets refuse. A
 * case of `compileExpr`: it returns the code, or `undefined` when
 * `compileExpr` continues with its next case.
 */
export function compileExprGpuPoint(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.language === 'glsl' || target.language === 'wgsl') {
    const isPoint = (a: Expression): boolean =>
      isNumericTuple(a) || isGatedPoint(a);
    if (args.some(isPoint)) {
      let reason: string | undefined;
      if (h === 'Multiply' && args.filter(isPoint).length > 1)
        reason = 'two points have no product';
      else if (h === 'Divide' && args.slice(1).some(isPoint))
        reason = 'a point has no reciprocal';
      else if (
        (h === 'Add' || h === 'Subtract') &&
        args.some((a) => !isPoint(a) && !couldBeNumericTuple(a))
      )
        reason = 'a point does not add to a number';
      if (reason !== undefined)
        throw new Error(
          `Could not compile \`${h}\`: ${reason}, and the ` +
            `${target.language} vector operators would compute a ` +
            `component-wise value where the interpreter answers an error.`
        );
    }
    // A point beside a LIST: a shader lowers both to a `vecN`, so a point
    // and a list of the same length combine component-wise. The
    // interpreter does not: `[1, 2]·(x, 1)` is the list of points
    // `[(x, 1), (2x, 2)]`, which has no shader value, and `(3, 1) / [1, 2]`
    // stays unevaluated. Both compiled to a plausible `vec2`. The point is
    // read by the COULD-form here (`couldBeNumericTuple`), so a point whose
    // component types are only possibly numeric (`PointList(t, 1)` with
    // `t` free) is a point too. `Add` is not listed: a point beside a
    // list is refused above, as a point beside a non-point.
    if (h === 'Multiply' || h === 'Divide') {
      const isAnyPoint = (a: Expression): boolean =>
        isPoint(a) || couldBeNumericTuple(a);
      if (
        args.some(isAnyPoint) &&
        args.some(
          (a) =>
            !isAnyPoint(a) &&
            !isTupleShapedType(compilationType(a)) &&
            a.type.matches('list<any>')
        )
      )
        throw new Error(
          `Could not compile \`${h}\`: ` +
            (h === 'Multiply'
              ? 'a point times a list is a list of points in the interpreter'
              : 'a point divided by a list has no value in the interpreter') +
            `, and the ${target.language} vector operators would combine ` +
            `the point and the list component-wise.`
        );
    }
  }
  return undefined;
}

/**
 * A `Declare`. A case of `compileExpr`: it returns the code, or `undefined`
 * when `compileExpr` continues with its next case.
 */
export function compileExprDeclare(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'Declare') {
    // A destructuring declare (`let (x, y) = …`) is desugared at the block
    // level, into per-leaf declares; one reaching here is in value position
    // (or outside a block entirely) and would compile as `let _ = …`, its
    // pattern names silently reading as NaN — fail closed.
    if (isFunction(args[0], 'Tuple'))
      throw new Error(
        `Could not compile a destructuring declaration in value position. ` +
          `It is desugared to per-leaf declares only in STATEMENT ` +
          `position (a block's non-final statement, or a loop body).`
      );
    const name = isSymbol(args[0]) ? args[0].symbol : '_';
    // Targets with a `declare` hook handle any initial value at the block
    // level (as a separate assignment statement — see `compileBlock`). For
    // the default path (no hook), emit a combined initializer so a
    // value-carrying `Declare(sym, type, value)` isn't dropped.
    if (target.declare) return target.declare(name);
    const value = declareValueOperand(args);
    if (value === undefined) return `let ${name}`;
    // The value may not be an operand of `node` at all (it can come from a
    // trailing attributes dictionary), and `-1` is the WHOLE-NODE region
    // sentinel — compile it plainly rather than open the wrong region.
    const valueIndex = args.indexOf(value);
    const valueCode =
      valueIndex < 0
        ? core.compile(value, target)
        : compileOp(node, valueIndex, target, 0, value);
    return `let ${name} = ${valueCode}`;
  }
  return undefined;
}

/**
 * A `Coalesce`. A case of `compileExpr`: it returns the code, or `undefined`
 * when `compileExpr` continues with its next case.
 */
export function compileExprCoalesce(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'Coalesce') {
    if (args.length === 0)
      throw new Error(
        'Could not compile `Coalesce`: expected at least one argument'
      );
    if (
      args
        .slice(0, -1)
        .some((a) => provablyAdmits('nothing', compilationType(a)))
    )
      throw new Error(
        `Could not compile \`Coalesce\`: target '${target.language ?? 'unknown'}' ` +
          `cannot distinguish a possible 'Nothing' input from an absent datum.`
      );
    // Test the domain of each operand, not the result: a numeric marker
    // still needs a NaN check when the fallback is a string or a collection.
    const axes = args
      .slice(0, Math.max(1, args.length - 1))
      .map((a) => absenceAxisForType(compilationType(a), target, 'Coalesce'));
    if (axes.some((axis) => axis.coalesce === undefined))
      throw new Error(
        `Could not compile \`Coalesce\`: target '${target.language ?? 'unknown'}' cannot ` +
          `discharge absence (no 'coalesce' capability).`
      );
    // Compiled coalescing evaluates the defaults lazily, left to right: the
    // operands after the first are their own regions (§5.1(b)).
    const codes = args.map((a, i) =>
      i === 0
        ? compileValueOperand(a, target)
        : compileOpValue(node, i, target, 0, a)
    );
    // Fold right: coalesce(a0, coalesce(a1, … coalesce(a_{n-1}, a_n))).
    let acc = codes[codes.length - 1];
    for (let i = codes.length - 2; i >= 0; i--)
      acc = axes[i].coalesce!(codes[i], acc);
    return acc;
  }
  return undefined;
}

/**
 * An `Apply` of a `Field`. A case of `compileExpr`: it returns the code, or
 * `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprApplyField(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (h === 'Apply' && args.length >= 2 && isFunction(args[0], 'Field')) {
    const fieldOps = args[0].ops;
    const record = protocolOfSymbol(engine, fieldOps[0]);
    const member = isString(fieldOps[1]) ? fieldOps[1].string : undefined;
    if (record !== undefined && member !== undefined) {
      const code = tryCompileProtocolDispatch(
        engine,
        {
          implKey: member,
          member,
          protocol: record.name,
          args: args.slice(1),
        },
        target
      );
      if (code !== undefined) return code;
      throw new Error(
        `Could not compile \`${record.name}.${member}\`: this protocol call has no lowering on ` +
          `target '${target.language ?? 'javascript'}' (dynamic dispatch ` +
          `could not be proven compilable).`
      );
    }
  }
  return undefined;
}

/**
 * The JavaScript broadcast of a call whose operands may be collections. A
 * case of `compileExpr`: it returns the code, or `undefined` when
 * `compileExpr` continues with its next case.
 */
export function compileExprBroadcastJavaScript(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.language === 'javascript') {
    const def = engine.lookupDefinition(h);
    // A block-local function shadows an engine-level function with the
    // same name, so the engine definition does not tell how its call
    // broadcasts. The call of the local (`tryCompileLocalFunctionCall`)
    // decides that from the local literal.
    const isBroadcastableHead =
      SCALAR_ARITHMETIC_HEADS.has(h) ||
      (isOperatorDef(def) &&
        blockLocalFunction(h, target) === undefined &&
        def.operator.broadcastable === true &&
        !isRelationalOperator(h) &&
        !LOGICAL_BROADCAST_HEADS.has(h));
    // A head whose own codegen on this target accepts a possibly-collection
    // operand (`CompileTarget.collectionAwareHeads`) is not this gate's
    // business: that codegen owns the shape — it emits its own run-time
    // dispatch, or declines with its own diagnostic. The color-space
    // conversions are the case: their operand may be a list of colors at
    // any depth, and only their own color-aware map recurses to the leaves
    // and refuses a collection whose type does not prove a color there.
    const collectionAwareHead = target.collectionAwareHeads?.has(h) === true;
    // Whether this guard refuses the operand `a`: it is, or may be, a
    // collection at run time, and no exemption below applies. The same
    // test names the refused operand in the message.
    const listValuedOperand = (a: Expression): boolean =>
      // A STRING is not a list-valued operand FOR THIS PURPOSE. It
      // matches `collection`/`indexed_collection` in the lattice (its
      // elements are its grapheme clusters) but is ATOMIC under
      // broadcast on both sides — the interpreter's
      // `isFiniteBroadcastParticipant` excludes it, and it lowers to one
      // JS string, not an array — so a broadcastable head over it is
      // ordinary scalar code. Same exemption as the sibling gates
      // (`compilesToArray`, `isArrayOperand`) carry.
      !isProvablyStringOperand(a) &&
      // Nor is a `Hypot` point leg, for the same reason: the head's own
      // codegen consumes it whole, as one leg (`isHypotPointLeg`).
      !isHypotPointLeg(h, a) &&
      // Nor is a tuple at a head that declares the `'tuples'` broadcast
      // exemption: the head owns that shape and its own codegen
      // consumes the tuple whole, as the interpreter does. A color
      // conversion reads `AsRgb((1, 0, 0))` as one color in 0-1 sRGB.
      !isBroadcastExemptTupleOperand(engine, h, a) &&
      (a.isCollection ||
        // The COLLECTION shape top, not the list/indexed spellings: a
        // SET-typed operand matches neither `list<any>` nor
        // `indexed_collection<any>`, and with the narrower test it
        // escaped this guard entirely — `Add(T, 1)` for
        // `T: set<number>` emitted `_.T + 1` (string concatenation or
        // garbage at run time) where the interpreter answers an
        // `incompatible-type` error.
        a.type.matches('collection<any>') ||
        // A GATED collection (a restricted point or list, typed
        // `missing | C`) is an array at run time too, and the
        // `missing` arm hides it from the test above. Without this, a
        // shape `tryCompileBroadcast` declined for it — the product of
        // two restricted points — emitted `[…] * […]`, which runs to
        // NaN behind `success: true`.
        isGatedIndexedCollection(a) ||
        // An operand that MAY be a point at run time (a union with a
        // tuple arm, `integer | tuple<real, real>`: the type of the
        // sum of a list of points, which may be empty) is an array
        // when it holds a point. `tryCompileBroadcast` has a plan for
        // it under `Add` only; under any other head the scalar code
        // ran to NaN: `2·Sum(P)` gave `NaN` where the interpreter
        // answers the scaled point.
        isRuntimePointShaped(a) ||
        // Read WITH the target, as `tryCompileBroadcast` reads it:
        // this guard is reached after that lowering declined, and an
        // operand it proved a constructed scalar (a call of a user
        // function whose body is a scalar over its point argument)
        // must not be refused here on the conservative reading.
        isBoundPossiblyCollectionTyped(a, target)) &&
      // Nor, last, is an operand that the emitted code reads as one
      // scalar because its untyped free inputs are read as numbers:
      // `g(x)[1]` with `g := t ↦ [t, 2]` and `x` free is typed `unknown`
      // by the engine, and `number` under that reading, the one the code
      // around the call makes (`readsAsScalarThroughFreeInputs`; ROADMAP
      // CE-377). Tested last, so its type walk runs only for an operand
      // the readings above refuse.
      !readsAsScalarThroughFreeInputs(a, target);
    if (
      isBroadcastableHead &&
      !collectionAwareHead &&
      args.some(listValuedOperand)
    ) {
      const opMap = target.operators?.(h);
      const lowersToScalarInfix =
        opMap === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
      // Two wordings, because two different lowerings reach here. An
      // ARITHMETIC head (`SCALAR_ARITHMETIC_HEADS`) really does emit scalar
      // arithmetic — a `+` or a `*` the operand turns into string
      // concatenation or NaN. Any other broadcastable head emits its own
      // scalar codegen instead, so naming arithmetic there sent the reader
      // looking for a `+` that is not in the expression.
      if (lowersToScalarInfix) {
        // A call of a user function among the operands is compiled first,
        // so a decline of the call itself is reported instead of this
        // generic one: it names the cause (a point argument with a
        // complex-valued coordinate, which an emitted definition cannot
        // read) where this one only names the enclosing head. The probe
        // leaves no trace: the definitions it emitted are removed, since
        // the head declines below whatever the calls do. When several calls
        // decline, the error of a call that can itself be a list is
        // preferred, because that operand is the one this guard refused; a
        // call that fails for an unrelated reason is reported only when no
        // such call fails.
        const registry = target.userFunctions;
        const before =
          registry !== undefined ? new Set(registry.defs.keys()) : undefined;
        let specific: unknown = undefined;
        let fallback: unknown = undefined;
        for (const a of args) {
          if (
            !isFunction(a) ||
            userFunctionLiteral(engine, a.operator) === undefined
          )
            continue;
          try {
            core.compile(a, target, 0);
          } catch (e) {
            if (e instanceof Error && e.name === 'CancellationError') throw e;
            if (isBoundPossiblyCollectionTyped(a, target)) {
              specific = e;
              break;
            }
            fallback ??= e;
          }
        }
        if (registry !== undefined && before !== undefined)
          removeDefinitionsAddedSince(registry, before);
        if (specific !== undefined) throw specific;
        if (fallback !== undefined) throw fallback;
        if (!SCALAR_ARITHMETIC_HEADS.has(h))
          throw new Error(
            `Could not compile \`${h}\`: a broadcastable head over a possibly list-valued operand — the JavaScript compile target has no list-arithmetic support. Materialize the list with evaluate() and compile a scalar element function instead.`
          );
        // A refused operand that is PROVABLY a collection is list-valued.
        // When none is, the refused operand only may be a list at run
        // time (an operand of unknown type, `h(x)` for
        // `h: (unknown) -> unknown`): the message names it with its type,
        // and the remedy is a declaration that excludes a list.
        const refused = args.filter(listValuedOperand);
        if (
          refused.some(
            (a) =>
              a.isCollection ||
              a.type.matches('collection<any>') ||
              isGatedIndexedCollection(a)
          )
        )
          throw new Error(
            `Could not compile \`${h}\`: scalar arithmetic over a list-valued operand — the JavaScript compile target has no list-arithmetic support. Materialize the list with evaluate() and compile a scalar element function instead.`
          );
        const possible = refused[0];
        throw new Error(
          `Could not compile \`${h}\`: scalar arithmetic over a possibly list-valued operand (\`${possible.toString()}\`, of type \`${possible.type.toString()}\`) — the JavaScript compile target has no list-arithmetic support. Declare a type that excludes a list for the operand or its inputs, or materialize the list with evaluate() and compile a scalar element function instead.`
        );
      }
    }
  }
  return undefined;
}

/**
 * The Python broadcast of a call whose operands may be collections. A case of
 * `compileExpr`: it returns the code, or `undefined` when `compileExpr`
 * continues with its next case.
 */
export function compileExprBroadcastPython(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.language === 'python') {
    const def = engine.lookupDefinition(h);
    const isArithmeticInfixHead =
      SCALAR_ARITHMETIC_HEADS.has(h) ||
      (isOperatorDef(def) &&
        def.operator.broadcastable === true &&
        !isRelationalOperator(h) &&
        !LOGICAL_BROADCAST_HEADS.has(h));
    const opMap = target.operators?.(h);
    const lowersToInfix =
      opMap !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
    // One shape reaches its lowering WITHOUT going through the fan-out below:
    // a UNARY broadcastable head over a FINITE INDEXED collection
    // (`Negate([1,2,3])`), which the function-codegen path further down
    // already fans out through the target's `broadcastUnary` hook. The
    // predicate mirrors that dispatch site one for one, so the guard only
    // stands aside when the dispatch will actually fire; if the hook then
    // declines, that path fails closed on its own.
    const isUnaryBroadcastOverCollection =
      target.broadcastUnary !== undefined &&
      args.length === 1 &&
      isOperatorDef(def) &&
      def.operator.broadcastable === true &&
      isFiniteIndexedCollection(args[0]) &&
      !isBroadcastExemptTupleOperand(engine, h, args[0]) &&
      typeof target.functions?.(h) === 'function';
    if (
      isArithmeticInfixHead &&
      lowersToInfix &&
      !isUnaryBroadcastOverCollection &&
      args.some(
        (a) =>
          a.isCollection ||
          // The COLLECTION shape top, for the same reason as the JavaScript
          // guard above: a SET-typed operand matches neither `list<any>`
          // nor `indexed_collection<any>` and escaped the guard, emitting
          // `T + 1` where the interpreter answers `incompatible-type`.
          // The fan-out below keeps its own narrower participation test,
          // so a set never fans out (unordered — a comprehension has no
          // defined order); it declines here instead.
          a.type.matches('collection<any>') ||
          // A GATED collection (a restricted point or list, typed
          // `missing | C`): `t * ((t, 1) if c else None)` repeats a
          // tuple or raises in Python, for the same reason.
          isGatedIndexedCollection(a) ||
          isBoundPossiblyCollectionTyped(a)
      )
    ) {
      const elementwise = tryCompilePythonElementwise(engine, h, args, target);
      if (elementwise !== undefined) return elementwise;
      // A call of a block-local function has no static result type, so it
      // is possibly a collection here. Name it, since the general message
      // does not say why such an operand may be a collection. CE-237.2.
      const localCall = args.find(
        (a) =>
          isFunction(a) &&
          typeof a.operator === 'string' &&
          blockLocalFunction(a.operator, target) !== undefined
      );
      if (localCall !== undefined)
        throw new Error(
          `Could not compile \`${h}\`: an operand is a call of the block-local function \`${localCall.operator}\`, and the Python target does not prove that the value of such a call is not a collection. Python's arithmetic operators repeat/concatenate a list instead of broadcasting element-wise, diverging from the interpreter. The interpreter evaluates it instead.`
        );
      throw new Error(
        `Could not compile \`${h}\`: arithmetic over a possibly-collection-typed operand on the Python target — Python's arithmetic operators repeat/concatenate a list instead of broadcasting element-wise, diverging from the interpreter. Materialize the operand with evaluate() and compile a scalar element function instead.`
      );
    }
  }
  return undefined;
}

/**
 * An `Assign`. A case of `compileExpr`: it returns the code, or `undefined`
 * when `compileExpr` continues with its next case.
 */
export function compileExprAssign(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'Assign') {
    // A destructuring assignment (`(x, y) := …`) is desugared at the block
    // level, into temporaries + writes; a bare one reaching here has no
    // statement list to expand into and would compile as `_ = …`, leaving
    // every target at its old value — fail closed.
    if (isFunction(args[0], 'Tuple'))
      throw new Error(
        `Could not compile a destructuring assignment in value position. ` +
          `It is desugared to temporaries + writes only in STATEMENT ` +
          `position (a block's non-final statement, or a loop body).`
      );
    // A protocol property assignment — `p.name = v` where some protocol
    // declares `name` a property. The engine keeps the canonical form as
    // `Assign(Field(p, "name"), v)` (the receiver decides at evaluation
    // whether the slot or a `set` accessor takes the write), which the
    // generic lowering below would compile to the silent no-op `_ = v`.
    //
    // There is no lowering to emit in its place. Assigning to a property is a
    // store into a mutable object, and only an object can carry a settable
    // property at all (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Which
    // types can conform"), so every legal receiver here is an object — and
    // objects have no compiled representation yet. Fail closed rather
    // than emit the no-op; the ROADMAP.md entry for the mutability gate
    // schedules the compiled store with the object work.
    const storeTarget = args[0];
    const storedProperty = isFunction(storeTarget, 'Field')
      ? isString(storeTarget.ops[1]) &&
        protocolDispatchCandidates(
          engine,
          `__set__${storeTarget.ops[1].string}`
        ) !== null
        ? storeTarget.ops[1].string
        : undefined
      : // The QUALIFIED spelling `p.(P.name) = v` keeps its
        // `Assign(ProtocolProperty(P, name, p), v)` shape through
        // canonicalization — the fold to the four-operand operator happens at
        // evaluation, so this is the form the compiler sees.
        isFunction(storeTarget, 'ProtocolProperty') &&
          isString(storeTarget.ops[1])
        ? storeTarget.ops[1].string
        : undefined;
    if (storedProperty !== undefined)
      throw new Error(
        `Could not compile \`${storedProperty}\`: this protocol property assignment has no ` +
          `lowering on target '${target.language ?? 'javascript'}' ` +
          `(a property store writes a mutable object, and objects have no ` +
          `compiled representation).`
      );
    // Any other non-symbol target (a `Subscript` sequence definition, a
    // `Field` naming no protocol property, …) has no lowering: emitting
    // `_ = v` would silently leave the target at its old value (and, in
    // sloppy mode, write a stray global `_`) behind `success: true` —
    // fail closed.
    if (!isSymbol(args[0]))
      throw new Error(
        `Could not compile \`Assign\`: the assignment target ` +
          `'${args[0].operator}' is not a variable, and this target ` +
          `shape has no lowering.`
      );
    // The write must use the SAME spelling a READ of this name compiles to,
    // or the two halves of the variable disagree (`assignLValue`).
    const name = assignLValue(engine, args[0].symbol, target);
    const code = compileOp(node, 1, target, 0, args[1]);
    // On a target that writes a block as a bare statement sequence (Python,
    // the shader targets), a value that compiles to several statements, or
    // to a `return`, cannot be the right side of an assignment: splicing
    // `u = s\nreturn 2 * u` after `t = ` gave `t = u = s` and a `return`
    // that left the enclosing function with the value of the inner block.
    // The shader targets move such a block into the enclosing statement
    // list when they can (`valueBlock`), and its value then compiles to a
    // single temporary; where no statement list is available, and on
    // Python, which has no such lowering, the assignment declines.
    assertExpressionValue(code, target, 'Assign', args[0].symbol);
    const stored = target.assignmentValue?.(args[1], code, target) ?? code;
    // An assignment that is an operand of an operator (`(t ≔ 1) + 2`, whose
    // value is the assigned value) was emitted without parentheses:
    // `t = 1 + 2` assigns 3 to `t`, where the interpreter assigns 1. An
    // assignment is an expression in JavaScript and in GLSL, so it is
    // parenthesized there. In Python and in WGSL an assignment is a
    // statement, and it has no expression form: the compilation declines
    // (`assertAssignmentIsStatement`).
    if (prec > 0) {
      assertAssignmentIsStatement(args[0].symbol, target);
      return `(${name} = ${stored})`;
    }
    return `${name} = ${stored}`;
  }
  return undefined;
}

/**
 * A `Typed`. A case of `compileExpr`: it returns the code, or `undefined`
 * when `compileExpr` continues with its next case.
 */
export function compileExprTyped(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'Typed') {
    const value = args[0];
    if (!LANE_RECORD_LANGUAGES.has(target.language ?? ''))
      return core.compile(value, target);
    const typed = node ?? engine._fn('Typed', [...args]);
    // The real lane is selected only where it changes the lane of the
    // value: under a mode that promotes, for a value that is complex with
    // promotion on. Every other value compiles below as before, and so
    // does every value under `strict` and on the shader targets, which
    // never promote.
    if (promotionActive() && isRealScalarAscription(typed)) {
      // The analysis emits nothing, so it must not change the `promoted`
      // report: the record is restored after it. The compilation that
      // follows records the promotions of the code that it emits. A
      // decline emits nothing either.
      const promoted = CompilerState._promoted;
      const complexWithPromotion = core.isComplexValued(value);
      CompilerState._promoted = promoted;
      if (complexWithPromotion) {
        // One suppressed region for the analysis and the compilation, so
        // the compilation reads the complexness answers that the analysis
        // put in the memo layer of the region.
        return withPromotionSuppressed(() => {
          if (core.isComplexValued(value))
            throw realAscriptionError(value, args[1], typed);
          return withCseIsolatedInstance(target, () =>
            core.compile(value, target)
          );
        });
      }
    }
    const code = core.compile(value, target);
    // A collection ascription whose entry type is real (`matrix<real>`,
    // `list<real>`) over a collection that may hold a complex entry
    // contradicts the value, as a real ascription over a complex scalar
    // does below. A linear-algebra head over the value reads the lane of
    // its entries from the ascribed type, and would emit its real helper
    // over the complex entries.
    if (
      value.type.matches('collection<any>') &&
      realEntriesType(typed.type.type) &&
      mayHoldComplexElement(value)
    )
      throw new Error(
        `Could not compile \`Typed\`: the value \`${value.toString()}\` has a complex entry, ` +
          `but its ascribed type \`${typed.type.toString()}\` says every ` +
          `entry is real. The compiled code would read the complex entry ` +
          `as a real number. When the ascription comes from a declared ` +
          `signature, declare a result type that admits a complex entry, ` +
          `for example \`matrix<complex>\` instead of \`matrix<real>\`.`
      );
    const ascribedComplex = core.isComplexValued(typed);
    const valueComplex = core.isComplexValued(value);
    if (ascribedComplex === valueComplex) return code;
    const ascribed = ascriptionText(args[1], typed);
    if (!ascribedComplex) throw realAscriptionError(value, args[1], typed);
    if (
      isNonScalarShape(value) ||
      core.aggregateComponentCount(value) !== undefined ||
      value.type.matches('boolean')
    )
      throw new Error(
        `Could not compile \`Typed\`: the ascribed type \`${ascribed}\` says the value is ` +
          `complex, but the value \`${value.toString()}\` is not a ` +
          `number.`
      );
    if (target.language === 'javascript')
      return isProvablyRealValued(value, target)
        ? `({ re: ${code}, im: 0 })`
        : // Not provably real, and not complex-shaped either: the
          // idempotent `_SYS.cplx` settles the representation at run time
          // (see `branchComplexCoercion` for the same class).
          `_SYS.cplx(${code})`;
    const vec2 = target.language === 'wgsl' ? 'vec2f' : 'vec2';
    return `${vec2}(${code}, 0.0)`;
  }
  return undefined;
}

/**
 * The diagnostic for a head that reached the end of `compileExpr` with no
 * lowering. Three distinct causes, three distinct messages (Tycho item 109a
 * — bucketing a compile band by message is only possible if the message
 * names the actual cause):
 *
 * 1. A per-operator `compile` handler ran and DECLINED (returned
 *    `undefined`/`null`/`''`). The head IS lowerable — just not for these
 *    operand shapes on this target. The operand types are named, since the
 *    shape is what the handler rejected.
 * 2. The head has an operator definition (the engine knows it) but this
 *    target has no codegen for it — a target gap, not an unknown symbol.
 * 3. No definition at all: a genuinely unknown operator. ONLY this case
 *    keeps the historical `Unknown operator \`X\`` wording.
 */
export function noLoweringMessage(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  declinedByCustomHandler: boolean
): string {
  const lang = target.language ?? 'unknown';
  if (declinedByCustomHandler) {
    const types = args.map((a) => `\`${a.type.toString()}\``).join(', ');
    return (
      `Could not compile \`${h}\`: the operator's compile handler has no lowering ` +
      `for target '${lang}' with these operand types (${types || 'none'}). ` +
      `The head is known to the engine and lowers for other targets/operand ` +
      `shapes; this is not an unknown operator.`
    );
  }
  // "Known" = the engine has an OPERATOR definition. A head that was merely
  // auto-declared by boxing an application (`["zzz", 1]`) gets a *value*
  // definition, and is genuinely unknown.
  let known = false;
  try {
    known = isOperatorDef(engine.lookupDefinition(h));
  } catch {
    /* an unresolvable head is, by definition, unknown */
  }
  if (known)
    return (
      `Could not compile \`${h}\`: the operator is known to the engine but ` +
      `target '${lang}' has no lowering for it.`
    );
  return `Unknown operator \`${h}\``;
}
