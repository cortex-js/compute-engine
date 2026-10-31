// compileBlock and the local function scopes of a block.

import type { Expression } from '../global-types.js';
import {
  recordBlockScalarLocals,
  recordVariableLocals,
} from './javascript-value-facts.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { isSymbol, isFunction } from '../boxed-expression/type-guards.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  OWNED_LOCAL_UPDATE_OPS,
  ownedLocalUpdateChains,
} from './in-place-update.js';
import {
  _freshLocalNames,
  assertLocalsAssignedBeforeRead,
  assertNoUseBeforeDeclare,
  blockLocalValueFrame,
  chainedLocalDeclares,
  checkedLocalReads,
  classifyLocalReads,
  needsStartValue,
  nestedAssignmentsTo,
  nestedOnlyLocals,
  refuseEffectContractViolations,
  splitChainedAssignments,
  withDefineFunctionDeclares,
  withFreshBlockLocals,
  withImplicitLocalDeclares,
} from './compile-locals.js';
import {
  LOCAL_SCALAR,
  declareValueOperand,
  desugarPatternAssign,
  desugarPatternDeclare,
  enforcedLocalTargets,
} from './compile-declarations.js';
import {
  assertExpressionValue,
  canHoist,
  compileListStatement,
  joinShaderStatements,
  loopBodyTempTarget,
  shaderExpressionStatement,
  statementBodyHead,
  statementLines,
  statementListDeclaredVarTypes,
} from './compile-statements.js';
import { core } from './compiler-core-hooks.js';
import { compilationType } from './compiler-type-facts.js';
import type { CheckedLocalsFrame, LocalValueFrame } from './compiler-types.js';
import { compileOp, withCseScope } from './compile-cse.js';
import {
  containsEarlyReturn,
  tailValueFor,
  withCseOperand,
  writesBlocksAsIife,
} from './compile-conditions.js';
import {
  LOCAL_UNSET,
  isNonScalarShape,
  localShapeFrameOf,
} from './compile-shapes.js';
import { pointOrPointListUnion } from './compile-user-calls.js';
import { localComplexDefault } from './compile-complexness.js';
import {
  _popLocalComplex,
  _pushLocalComplex,
  lexicalFunctionScope,
  newLocalFunctionScope,
  noteLocalFunction,
  reboundFunctionScope,
  reboundLocalNames,
} from './compile-loops.js';
import { CompilerState } from './compiler-state.js';
import { _blockStatements } from './compile-user-functions.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import {
  callOnlyLocalFunctionLiterals,
  markScalarFedLiterals,
} from './compile-callbacks.js';
import { _localValueFrames } from './compile-absence.js';

/**
 * Compile an expression as a statement list evaluated **for effect** — a
 * loop body — rather than for its value.
 *
 * The difference from `compile()` is what happens to the LAST statement:
 * compiled for a value it is wrapped/returned (`return <stmt>`, or the
 * target's `block` hook), which inside a loop returns from the enclosing
 * function on the first iteration. Compiled for effect it is just another
 * statement. It is also the position where a destructuring assign lowers,
 * since no statement's value is anyone's.
 *
 * Used by targets whose loop bodies route through `compileExpr` (the shader
 * targets). The JavaScript and Python targets have their own statement
 * dispatchers (`compileLoopBody`, `compilePythonStatements`).
 */
export function compileStatementList(
  expr: Expression,
  target: CompileTarget<Expression>
): TargetSource {
  if (isFunction(expr, 'Block'))
    return compileBlock(expr.ops, target, expr, false);
  // A lone assignment whose value is another assignment is two statements
  // (`splitChainedAssignments`): `t = u = s;` is not valid WGSL.
  const split = splitChainedAssignments([expr]);
  const chained = split.args;
  // The interpreter declares the inner target in the scope of the loop
  // when no enclosing scope has the name. This route has no `Block` node
  // whose scope `withImplicitLocalDeclares` can read, so the test is on the
  // compilation instead: a name is bound outside when it is a parameter or
  // a loop index (`boundVars`), or a local of an enclosing compiled block
  // or function (`localShapeFrameOf`). Each other inner target gets a
  // declaration, and the statements then compile as a block, which
  // declares it in the loop body. Without the declaration, the shader
  // wrote an undeclared name.
  if (chained.length > 1) {
    const declares = chainedLocalDeclares(chained, split.chained, target);
    if (declares.length > 0)
      return compileBlock([...declares, ...chained], target, undefined, false);
  }
  const stmts =
    desugarPatternAssign(expr, target) ??
    (chained.length > 1 ? [...chained] : null);
  // On a shader target the lone statement gets a statement sink of its own
  // (see `compileListStatement`): a loop-form `Sum` on the right of the
  // assignment has nowhere else to put its loop. A selection whose branches
  // assign takes the statement form (`shaderSelectionStatement`), and a
  // value is written as a WGSL statement (`shaderExpressionStatement`).
  if (stmts === null)
    return target.bareStatementBlocks
      ? joinShaderStatements(
          compileListStatement(target, expr, (t) => [
            core.shaderSelectionStatement(expr, t) ??
              shaderExpressionStatement(expr, core.compile(expr, t), t),
          ])
        )
      : core.compile(expr, target);
  const stmtTarget = loopBodyTempTarget(stmts, target);
  if (target.bareStatementBlocks)
    return joinShaderStatements(
      stmts.flatMap((s) =>
        compileListStatement(stmtTarget, s, (t) => [core.compile(s, t)])
      )
    );
  return stmts
    .map((s) => core.compile(s, stmtTarget))
    .join(`;${target.ws('\n')}`);
}

/**
 * Compile a block expression
 */
export function compileBlock(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node?: Expression,
  valueUsed = true,
  prec = 0,
  /** The value of the block is consumed whole as a collection value: the
   * last statement is first offered to `target.compileCollectionValue`
   * (see `compileCollectionValueBlock`). */
  collectionValue = false
): TargetSource {
  // A block-local `Declare` is HELD, so a target's constness / declared type
  // is visible ONLY in this statement list. Harvest it up front: the
  // destructuring-assign desugar below fails closed on such a target (the
  // compiled per-leaf write enforces neither, where the interpreter's
  // destructuring `Assign` validates every leaf before writing any), and a
  // destructuring assign inside a nested LOOP BODY needs it too — that route
  // (`compileLoopBody`) sees only the body's statements, so the set is also
  // pushed for the compilation of the statements below.
  //
  // Harvested BEFORE the desugars, which only add `Declare(name, "unknown",
  // …)` statements — never an enforced one.
  const enforcedLocals = args.some((a) => isFunction(a, 'Declare'))
    ? enforcedLocalTargets(args)
    : undefined;

  // Desugar destructuring declares first, so the locals collection and the
  // inference below see only plain scalar declares. As with the assigns
  // below, a value-position one is left alone and fails closed: the rewrite
  // ends on the LAST leaf's declare, whose value is that leaf's, not the
  // tuple's. (It used to be desugared here too and fail closed only by
  // accident — `return let b = 4` is a syntax error, so the emitted source
  // failed to parse. An explicit refusal beats relying on that.)
  if (
    args.some((a) => isFunction(a, 'Declare') && isFunction(a.ops[0], 'Tuple'))
  ) {
    const n = args.length;
    args = args.flatMap((a, i) =>
      valueUsed && i === n - 1 ? [a] : (desugarPatternDeclare(a, target) ?? [a])
    );
  }

  // …then destructuring assigns, which lower to temporaries + writes.
  //
  // When the block's VALUE is used, the last statement is left alone: the
  // block's value is that statement's, and the rewrite ends on a write
  // (yielding one leaf, not the tuple). It falls through to `compileExpr`
  // and fails closed rather than silently returning the wrong thing.
  // In a statement list (`valueUsed: false`) there is no such position, so
  // every statement — including the last — lowers.
  if (
    args.some((a) => isFunction(a, 'Assign') && isFunction(a.ops[0], 'Tuple'))
  ) {
    const n = args.length;
    args = args.flatMap((a, i) =>
      valueUsed && i === n - 1
        ? [a]
        : (desugarPatternAssign(a, target, enforcedLocals) ?? [a])
    );
  }

  // …then `function` definitions, which are block-scoped exactly like a
  // `const` binding of the same literal and lower to the same value binding.
  // A definition that the interpreter refuses for its effects is refused
  // first.
  refuseEffectContractViolations(args, node?.localScope);
  args = withDefineFunctionDeclares(args, target, valueUsed);

  // …then the block-locals introduced by bare ASSIGNMENT, which carry no
  // `Declare` statement of their own. Synthesize the missing declaration so
  // everything below treats them exactly like a declared local.
  // An assignment whose value is another assignment is split into two
  // statements first, so the inner target can get its declaration too.
  const split = splitChainedAssignments(args);
  args = withImplicitLocalDeclares(split.args, target, node, split.chained);

  // Get all the Declare statements
  const locals: string[] = [];
  for (const arg of args) {
    if (isFunction(arg, 'Declare')) {
      const firstOp = arg.ops[0];
      if (isSymbol(firstOp)) locals.push(firstOp.symbol);
    }
  }

  // The value of a block whose last statement is a declaration with no
  // initial value is `Nothing` (the interpreter's value of
  // `Block(s ≔ x; Declare(t))`), the erasure marker, which has no compiled
  // representation. Without this check the declaration was dropped from the
  // value position (Python returned the value of the statement before it)
  // or spliced into it (`return var t: f32;`, `return let t`).
  const lastArg = args[args.length - 1];
  if (
    valueUsed &&
    isFunction(lastArg, 'Declare') &&
    declareValueOperand(lastArg.ops) === undefined
  )
    throw new Error(
      'Could not compile `Block`: the last statement of the block is a ' +
        'declaration with no initial value, so the value of the block is ' +
        '`Nothing`, the erasure marker, which has no compiled ' +
        'representation. End the block with the value it should have.'
    );

  assertNoUseBeforeDeclare(args);
  assertLocalsAssignedBeforeRead(args, locals);
  // The reads of a local that may have no value (`classifyLocalReads`).
  // A read with no assignment on any path before it is refused here.
  const readClasses = classifyLocalReads(args, locals, node, target);

  // A lone EMPTY block in a statement list evaluated for effect (a shader
  // loop body reaching `compileStatementList`) is an empty statement.
  // The unwrap below would recompile it through `compileOp`, which treats
  // every operand as a used value, and the empty-list exit further down
  // would then decline it.
  if (
    !valueUsed &&
    args.length === 1 &&
    isFunction(args[0], 'Block') &&
    args[0].nops === 0
  )
    return '';

  if (args.length === 1 && locals.length === 0) {
    // The single-statement block is UNWRAPPED here, but harvest still saw
    // the `Block` — so both its statement-list region and the statement's
    // own value region are pushed, or the statement's candidates would find
    // no instance to bind at. (A canonical `Function`-literal body is such a
    // block, so this is the common case, not an edge one.)
    // The lone statement inherits the ENCLOSING precedence: unwrapping the
    // block removes the grouping the braces carried, so compiling the
    // statement at precedence 0 spliced a loose infix body straight into its
    // parent — `Multiply(Block(Add(t, 1)), x)` emitted `x * t + 1`, read as
    // `(x * t) + 1`. Handing `prec` down makes the statement's own emission
    // parenthesize itself exactly as an unbracketed operand would.
    //
    // In EFFECT position on a shader target (a `Loop` body) the lone
    // statement still gets a statement sink of its own, exactly as a
    // member of a longer list does: a loop-form `Sum` on the right of the
    // assignment has nowhere else to put its loop.
    // A lone statement that is a nested `Block` compiles in statement
    // mode too, as a statement of a longer list does (see `isStatement`
    // below). Compiled through `compileOp`, it was a value, and its last
    // statement became a `return` (`Block(Block(Block(Declare(t, x); t));
    // x + 1)` returned `t`).
    const lone = args[0];
    if (!valueUsed && target.bareStatementBlocks && isFunction(lone, 'Block')) {
      if (target.language === 'python')
        return withFreshBlockLocals(() =>
          compileBlock(lone.ops, target, lone, false)
        );
      const inner = compileBlock(lone.ops, target, lone, false);
      if (inner === '') return '';
      return `{\n${inner
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')}\n}`;
    }
    // A Python statement has no terminator (`statementLines`).
    if (!valueUsed && target.bareStatementBlocks)
      return statementLines(
        target,
        compileListStatement(target, args[0], (t) => [
          withCseScope(node, -1, t, () =>
            compileOp(args[0], -1, t, prec, args[0])
          ),
        ])
      );
    // The value of a lone statement is the value of the block, so a
    // `Return` there gives its value (`tailValueFor`).
    const value = valueUsed ? tailValueFor(args[0], target) : args[0];
    return withCseScope(node, -1, target, () =>
      compileOp(args[0], -1, target, prec, value)
    );
  }

  // Infer each local's complex-ness, in statement order, so a later local
  // whose RHS reads an earlier complex local is itself recognized as
  // complex (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0` — Tycho item 58).
  // The frame is pushed while inferring AND while compiling the
  // statements, so `isComplexValued` — in every target — sees the locals
  // the emitter is about to bind. Sources, per local: an explicit
  // `complex` type on the `Declare`, a `Declare` initial value, or the
  // first `Assign` RHS.
  const complexFrame = new Map<string, boolean>();
  // Vector width (2–4) of a local bound to a vector-valued expression — a
  // point/tuple body such as `p ⩴ (x(t), y(t))`. On a GPU target such a
  // local must be declared `vec2`/`vec3`/`vec4`: the `float` default would
  // disagree with its own assignment AND with the declared return type when
  // the local is the block's value (`vec2 f(…) { float p; p = vec2(…);
  // return p; }` — "return type mismatch" on a real driver).
  // Widths outside 2–4 are tracked too: the list compilers lower those to an
  // ARRAY constructor (`float[5](…)` / `array<f32, 5>(…)`), so the local's
  // declaration must be the matching array type — a `float` declaration with
  // an array assignment is the same mismatch, one width up.
  const vectorFrame = new Map<string, number>();
  // A shader local gets ONE declared type, so every binding of it in the
  // block must agree on a shape. On a GPU target we therefore inspect every
  // binding, not just the first: "first assignment wins" reached the very
  // "declared `float`, assigned `vecN`" mismatch this inference exists to
  // prevent, by intra-block reassignment instead of aliasing.
  //
  // Disagreement FAILS CLOSED rather than widening to a union, because
  // neither GLSL nor WGSL has a type a scalar and a `vecN` (or a `vec2` and
  // a `vec3`) both fit: there is no variant type and no implicit
  // scalar↔vector assignment conversion. "Widening" could only mean
  // splatting the scalar binding (`p = vec2(cos(t))`), which silently
  // rewrites the program's meaning — every later scalar use of `p` becomes
  // vector arithmetic — and for two different vector widths not even that
  // exists. A diagnostic naming the two shapes beats source no driver
  // accepts (D6).
  const isGPUTarget = target.language === 'glsl' || target.language === 'wgsl';
  const declaredVarTypes = statementListDeclaredVarTypes(
    args,
    target.declaredVarTypes
  );
  const shapeName = (n: number) =>
    n === LOCAL_SCALAR ? 'scalar' : `${n}-component aggregate`;
  const noteVectorWidth = (name: string, value: Expression) => {
    // Only declared locals get a declaration (and hence a type hint).
    const prev = vectorFrame.get(name);
    if (prev === undefined) return;
    // A shader color occupies three channels, even though its language
    // type is atomic and its JavaScript representation is an object.
    // A written list of points lowers on a shader target as an ARRAY of
    // vectors, for which no local declaration is synthesized here (the
    // element count would declare a `vecN` over a `vecK[N]` initializer).
    // Fail closed rather than emit a declaration that contradicts
    // its own initializer.
    if (
      isGPUTarget &&
      (isFunction(value, 'List') || isFunction(value, 'Tuple')) &&
      value.nops > 0 &&
      value.ops.every((op) => isNonScalarShape(op))
    )
      throw new Error(
        `Could not compile \`${name}\`: a local holding a list of points has no static shader ` +
          `declaration — the value lowers as an array of vectors, and a ` +
          `local is declared as a vector or an array of scalars. Read the ` +
          `points where they are written instead.`
      );
    const count =
      isGPUTarget &&
      (!isSymbol(value) || !localShapeFrameOf(value.symbol)) &&
      isSubtype(compilationType(value), 'color')
        ? 3
        : core.aggregateComponentCount(value);
    if (!isGPUTarget) {
      // Off-GPU a local is untyped, so any shape may be rebound: keep the
      // historical "first aggregate binding wins". A width of `0` is not
      // recorded (it produces no declaration anywhere), which also keeps it
      // from reading back as an aggregate count off-GPU.
      if (prev < 0 && count) vectorFrame.set(name, count);
      return;
    }
    if (count === 0)
      throw new Error(
        `Could not compile the block local \`${name}\`: an empty tuple/list has no GPU lowering — ` +
          `neither GLSL nor WGSL has a zero-length array type, so there is ` +
          `no declaration its assignment could match.`
      );
    // Provably non-scalar, but with no single component count (a `Matrix`,
    // a multi-axis or unsized list): no declaration can be synthesized for
    // it, and the `float` default would disagree with its `matN` assignment.
    // A value whose type admits a point and a list of points (`2P` with
    // `P: list<tuple<number, number>> | tuple<number, number>`) has no
    // width that its type states, and its emission can be a vector: a
    // `float` declaration would disagree with it.
    if (
      count === undefined &&
      pointOrPointListUnion(compilationType(value)) !== undefined
    )
      throw new Error(
        `Could not compile the block local \`${name}\`: its value has the ` +
          `type \`${typeToString(compilationType(value))}\`, which admits ` +
          `a point and a list of points, so a shader local has no ` +
          `declared type for it.`
      );
    if (count === undefined && isNonScalarShape(value))
      throw new Error(
        `Could not compile the block local \`${name}\`: a matrix/tensor-valued local has no GPU ` +
          `declaration (its shape has no single component count), so a ` +
          `scalar declaration would disagree with its own assignment.`
      );
    const n = count ?? LOCAL_SCALAR;
    if (prev === LOCAL_UNSET) {
      vectorFrame.set(name, n);
      return;
    }
    if (n !== prev)
      throw new Error(
        `Could not compile the block local \`${name}\`: it is bound to values of disagreeing shapes ` +
          `(${shapeName(prev)}, then ${shapeName(n)}); a shader local has ` +
          `one declared type and neither GLSL nor WGSL can convert between ` +
          `these.`
      );
  };
  for (const local of locals) {
    // Under the complex discipline a local not declared real is
    // complex-shaped from its declaration (`localComplexDefault`); the
    // strict default is real until a complex first binding.
    complexFrame.set(local, localComplexDefault());
    // A typed color may first be assigned inside a loop or conditional,
    // outside the straight-line assignment scan below.
    const declared = declaredVarTypes?.[local];
    vectorFrame.set(
      local,
      isGPUTarget &&
        declared !== undefined &&
        isSubtype(resolveTypeForCompilation(declared), 'color')
        ? 3
        : LOCAL_UNSET
    );
  }
  _pushLocalComplex(complexFrame);
  // Pushed before inference AND kept for the compilation of the statements,
  // so a later local's RHS that merely references an earlier one (`q ⩴ p`)
  // resolves the width through the frame (Defect C).
  CompilerState._localVector.push(vectorFrame);
  // The enforced-target frame, so a destructuring assign in a nested LOOP
  // BODY still sees this block's declarations (see `enforcedLocals` above).
  // Only a non-empty frame is pushed, so the common block costs nothing.
  const pushedEnforced =
    enforcedLocals !== undefined && enforcedLocals.size > 0;
  if (pushedEnforced) CompilerState._enforcedTargets.push(enforcedLocals!);
  // The locals whose reads compile with a check (`checkedLocalReads`).
  let checkedFrame: CheckedLocalsFrame | undefined;
  // Removes the marks of `markScalarFedLiterals`.
  let unmarkFed: (() => void) | undefined;
  // The list updates of this block that write in place, and the
  // temporaries that hold the arrays the block owns
  // (`ownedLocalUpdateChains`).
  const ownedTemps: string[] = [];
  const ownedOps: ReadonlyArray<Expression>[] = [];
  // The fresh names that this block gave to its locals that shadow a name
  // bound outside it on a shader target (see `spelled` below). They are
  // removed from `_freshLocalNames` in the `finally` below.
  const shadowSpellings: string[] = [];
  // The statements of the block, for the proof of the type of a local by
  // its assignments (`assignmentsProveType`).
  const blockScope = node?.localScope;
  if (blockScope !== undefined)
    _blockStatements.push({ scope: blockScope, args });
  let localValueFrame: LocalValueFrame | undefined;
  try {
    // The locals that only an assignment in a nested block gives a value
    // (`nestedOnlyLocals`). Their shape is read from these assignments.
    const nestedLocals = nestedOnlyLocals(args, locals);
    for (const arg of args) {
      // Complex-ness first, then width — the width of a complex value is
      // read THROUGH the complex frame (`aggregateComponentCount`).
      core.noteLocalComplex(arg, complexFrame);
      if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0])) {
        const value = declareValueOperand(arg.ops);
        if (value !== undefined) noteVectorWidth(arg.ops[0].symbol, value);
      } else if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
        if (arg.ops[1] !== undefined)
          noteVectorWidth(arg.ops[0].symbol, arg.ops[1]);
      }
      if (nestedLocals.size > 0)
        for (const { assign, name, value } of nestedAssignmentsTo(
          arg,
          nestedLocals
        )) {
          core.noteLocalComplex(assign, complexFrame);
          noteVectorWidth(name, value);
        }
    }

    // GPU type hints for block locals.
    //
    // GPU shader scalars are always `float`/`f32`. We intentionally never
    // infer `int`/`i32` for an integer-valued local: GPU number literals are
    // always emitted with a decimal point (`3` → `3.0`, see formatGPUNumber)
    // and scalar shader arithmetic is float, so an `int`-typed declaration
    // would disagree with its own float assignment (`int r; r = 3.0;` — not
    // valid GLSL) and poison every downstream use in float math. Only a
    // complex-valued local needs a non-default hint (`vec2`/`vec2f`), as
    // does a vector-valued (point/tuple) one (`vec2`…`vec4`) or a color
    // (`vec3`); everything
    // else uses the `float` default in `target.declare`.
    const typeHints: Record<string, string | undefined> = {};
    if (target.declare && target.language) {
      const isWGSL = target.language === 'wgsl';
      const vecN = (n: number) => (isWGSL ? `vec${n}f` : `vec${n}`);
      // A width with no `vecN` gets the array type the list compilers emit
      // for it, so declaration and assignment agree.
      const aggregateType = (n: number) =>
        n >= 2 && n <= 4
          ? vecN(n)
          : isWGSL
            ? `array<f32, ${n}>`
            : `float[${n}]`;
      for (const local of locals) {
        if (complexFrame.get(local)) typeHints[local] = vecN(2);
        else {
          const n = vectorFrame.get(local);
          // Negative entries are the "not an aggregate" sentinels. A width
          // of `0` has no valid array type in either language; on a GPU
          // target `noteVectorWidth` has already failed closed on it, and
          // this guard keeps any other target from emitting `float[0]`.
          if (n !== undefined && n > 0) typeHints[local] = aggregateType(n);
        }
      }
    }

    // The function-valued locals of this list, so a call of one resolves to
    // its own binding (see `CompileTarget.localFunctions`). Filled IN
    // STATEMENT ORDER as the emission below walks the list, not up front:
    // a binding is in scope for its own statement (so a recursive lambda's
    // self-call resolves) and for every later one, but not for an earlier
    // one — where the emitted `let` has not run yet, so resolving there
    // would compile a read of a JavaScript temporal dead zone. `function`
    // definitions are already hoisted to the front of `args`, which is what
    // makes their forward references resolve.
    const localFunctions = newLocalFunctionScope(target);
    // The function-valued locals whose value can change while the list
    // runs, which a call reads at run time (see `reboundLocalNames`).
    const reboundLocals = reboundLocalNames(args);
    // …and the whole-list scope a function-literal BODY resolves against,
    // which is what makes mutually recursive definitions compile.
    const lexicalFunctions = lexicalFunctionScope(args, target, reboundLocals);

    // The spelling of each local: its name, or a fresh name while
    // `withFreshBlockLocals` runs.
    const spelled = new Map<string, string>();
    if (CompilerState._freshBlockLocals > 0)
      for (const local of locals) {
        const fresh = tempVar(target);
        spelled.set(local, fresh);
        _freshLocalNames.add(fresh);
      }
    // On a shader target, a local that has the name of a binding outside
    // the block (a parameter of the function, a loop index, a local of an
    // enclosing block) gets a fresh name too. The statements of the block
    // that is the body of a function or of a loop are in the same scope as
    // the parameters or the index, and GLSL and WGSL do not let a
    // declaration have the name of a parameter of its scope
    // (`float f(float U) { float[10] U;` is a redeclaration). WGSL also
    // refuses a write of a parameter, and its check reads the name at the
    // start of each emitted line, so a local of a nested block that hides
    // a parameter must not have its name either, even when a local of an
    // enclosing block has the same name.
    else if (isGPUTarget)
      for (const local of locals) {
        if (target.boundVars?.has(local) !== true) continue;
        const fresh = tempVar(target);
        spelled.set(local, fresh);
        if (!_freshLocalNames.has(fresh)) {
          _freshLocalNames.add(fresh);
          shadowSpellings.push(fresh);
        }
      }
    const spellLocal = (name: string): string => spelled.get(name) ?? name;
    const localTarget: CompileTarget<Expression> = {
      ...target,
      var: (id) => {
        if (locals.includes(id)) return spellLocal(id);
        return target.var(id);
      },
      ...withBoundScope(target, locals),
      declaredVarTypes,
      localFunctions,
      lexicalFunctions,
      reboundFunctions: reboundFunctionScope(args, target, reboundLocals),
    };
    checkedFrame = checkedLocalReads(readClasses, target, spellLocal);
    if (checkedFrame !== undefined)
      CompilerState._checkedLocals.push(checkedFrame);

    if (target.language === 'javascript')
      recordBlockScalarLocals(args, localTarget);
    // A shader target declares each local as a variable (`var U` in
    // WGSL), which an expression can index with a run-time index. A read
    // of a list local then indexes it as it is, with no copy
    // (`isVariableLocal` in `compileGPUAt`, `gpu-functions.ts`).
    if (isGPUTarget) recordVariableLocals(localTarget, locals);

    // The statement LIST is one INERT region — no binding is placed at the
    // statement-list level, so early-exit reachability and inter-statement
    // ordering never interact with CSE. Each statement's own value
    // expressions are separate, bindable child regions (§5.1(c)).
    const stmts = args.filter((a) => !isSymbol(a, 'Nothing'));
    // The function literals that this list binds to a local that is only
    // ever called (`callOnlyLocalFunctionLiterals`) are compiled without
    // the broadcast wrapper: each call site broadcasts by itself. The
    // marks are removed in the `finally` below.
    if (target.language === 'javascript')
      unmarkFed = markScalarFedLiterals(
        callOnlyLocalFunctionLiterals(args, locals, reboundLocals)
      );
    // A local that the list replaces element by element
    // (`xs = ReplaceAt(xs, i, v)`) and never hands out is copied once, at
    // its first update, and then written in place
    // (`ownedLocalUpdateChains`, CE-329). JavaScript only: the other
    // targets keep the copying form.
    if (target.language === 'javascript')
      for (const local of locals) {
        // The first update of a checked local reads it with no check.
        if (checkedFrame?.markers.has(local) === true) continue;
        const chains = ownedLocalUpdateChains(args, local);
        if (chains === undefined) continue;
        const temp = tempVar(target);
        ownedTemps.push(temp);
        for (const ops of chains) {
          OWNED_LOCAL_UPDATE_OPS.set(ops, temp);
          ownedOps.push(ops);
        }
      }
    // The locals of the block, for the reads that a comparison of a local
    // tests (`blockLocalValueFrame`).
    localValueFrame = blockLocalValueFrame(
      stmts,
      locals,
      spellLocal,
      node?.localScope,
      node
    );
    _localValueFrames.push(localValueFrame);
    const result = withCseScope(node, -1, localTarget, () =>
      stmts
        .flatMap((arg, i) =>
          compileListStatement(localTarget, arg, (stmtTarget) => {
            localValueFrame!.current = i;
            // Bring this statement's own function-valued binding into scope
            // before compiling it (see `localFunctions` above).
            noteLocalFunction(arg, localFunctions, reboundLocals);
            // An ELSE-LESS `If` in STATEMENT position. `if c { … }` with no
            // else has no value — the interpreter answers `Nothing`, which is
            // the erasure marker and deliberately has no lowering — so
            // `compileExpr`'s conditional, which needs all three operands,
            // threw `If: wrong number of arguments` on it. That closed every
            // function body containing a plain guard statement (the
            // `parseNumber` scanner in the Epsil examples: `if cs[j] == "-"
            // { sign = -1 … }`), even though the statement's value is
            // discarded here, which is exactly the position where an
            // else-less `if` IS expressible. Emit the statement form the
            // loop-body dispatcher already uses (`if (c) { … }`, no else).
            //
            // The LAST statement of a value-carrying block is NOT a statement
            // position — its value is the block's — so an else-less `If`
            // there keeps failing closed.
            //
            // PLAIN JavaScript ONLY. Every other target stays fail-closed, and
            // each for its own verified reason — the admission is deliberately
            // the narrowest one, since admitting is the direction that
            // miscompiles:
            //
            //  - PYTHON. `compilePythonStatements` does statement-form an
            //    else-less `If` correctly, but it is reached ONLY from a loop
            //    body: a plain function-body `Block` reaches THIS routine,
            //    whose emission is C-like and a syntax error in Python. Routing
            //    to the Python emission from here needs a target hook (the
            //    `block` hook receives already-COMPILED statements), which is a
            //    separate change. Until then the shape declines with `If: wrong
            //    number of arguments` and falls back to the interpreter.
            //  - INTERVAL JavaScript. `compileLoopBody` DOES emit syntactically
            //    valid code here, but not correct code: its
            //    `scalarConditionTarget` unwraps only a `_IA.point(…)` spelling
            //    (the plain-number loop counter it was written for), so a
            //    condition over a free variable or an interval-valued local
            //    emits `0 < _.x` against an `{lo, hi}` OBJECT — always `false`.
            //    Verified: the else-LESS shape answers `[1,1]` for `x = [3,3]`
            //    where the else-ful `_IA.piecewise` lowering answers the
            //    correct `[-1,-1]`. (The same defect already affects an
            //    else-less `If` inside an interval LOOP body — pre-existing,
            //    separate, and not to be widened here.)
            //  - The GPU targets: their own statement model, plus the above.
            //    An else-less `If` whose branch assigns takes the shader
            //    statement form below (`shaderSelectionStatement`).
            //
            // An `If` with a `Return` in a branch, in statement position,
            // takes the same statement form on plain JavaScript: the
            // conditional expression would put `return` inside an
            // expression (`c ? return 1 : return 5`), a syntax error. On
            // the interval target the statement form is not correct (see
            // above), so the shape declines there.
            const isStatement = !(valueUsed && i === stmts.length - 1);
            const returnsEarly =
              isFunction(arg, 'If') && isStatement && containsEarlyReturn(arg);
            if (
              isFunction(arg, 'If') &&
              (arg.nops === 2 || returnsEarly) &&
              isStatement &&
              (target.language === undefined ||
                target.language === 'javascript')
            )
              return [core.compileLoopBody(arg, stmtTarget)];
            // A selection whose branches assign, in statement position on
            // a shader target, is an `if` statement
            // (`shaderSelectionStatement`).
            if (isStatement) {
              const statement = core.shaderSelectionStatement(arg, stmtTarget);
              if (statement !== undefined) return [statement];
            }
            if (returnsEarly && writesBlocksAsIife(target))
              throw new Error(
                `Could not compile \`If\`: a branch returns early ` +
                  `(\`Return\`) from a statement that is not the last ` +
                  `one of the block, and target '${target.language}' ` +
                  `has no statement form for a conditional with a ` +
                  `\`Return\` in a branch.`
              );
            // A local whose read is checked starts with its own marker
            // of "no value" (`checkedLocalReads`). Only the JavaScript
            // targets have such locals.
            if (
              isFunction(arg, 'Declare') &&
              isSymbol(arg.ops[0]) &&
              declareValueOperand(arg.ops) === undefined
            ) {
              const marker = checkedFrame?.markers.get(arg.ops[0].symbol);
              if (marker !== undefined)
                return [
                  `const ${marker} = {}`,
                  `let ${spellLocal(arg.ops[0].symbol)} = ${marker}`,
                ];
            }
            // A Python local declared with no value starts with the value
            // `_ce_unset(name)`, as in `compilePythonStatements`
            // (`needsStartValue`). Python has no declaration, so without
            // it a read found the value of a previous pass of a loop, or
            // raised `UnboundLocalError`.
            if (
              target.language === 'python' &&
              isFunction(arg, 'Declare') &&
              isSymbol(arg.ops[0]) &&
              needsStartValue(stmts, i, readClasses)
            )
              return [
                `${spellLocal(arg.ops[0].symbol)} = _ce_unset(${JSON.stringify(arg.ops[0].symbol)})`,
              ];
            // For Declare, pass inferred type hint to the target hook
            if (
              isFunction(arg, 'Declare') &&
              isSymbol(arg.ops[0]) &&
              target.declare
            ) {
              const name = arg.ops[0].symbol;
              const decl = target.declare(spellLocal(name), typeHints[name]);
              // A `Declare` may carry an initial value (`Declare(sym, type, value)`
              // or a `value` key in a trailing attributes dictionary). Emit it as a
              // separate assignment statement, mirroring how a hoisted
              // `Declare`+`Assign` pair compiles. (Two statements — not a combined
              // initializer — so the declaration stays a plain `let`/`float`, which
              // is what the subsequent assignment requires.)
              const value = declareValueOperand(arg.ops);
              if (value !== undefined) {
                // `-1` is the whole-node region sentinel, so a value that is
                // NOT one of `arg`'s operands (it may come from a trailing
                // attributes dictionary) compiles plainly.
                const valueIndex = arg.ops.indexOf(value);
                const valueCode =
                  valueIndex < 0
                    ? core.compile(value, stmtTarget)
                    : compileOp(arg, valueIndex, stmtTarget, 0, value);
                assertExpressionValue(valueCode, stmtTarget, 'Declare', name);
                const stored =
                  stmtTarget.assignmentValue?.(value, valueCode, stmtTarget) ??
                  valueCode;
                return [decl, `${spellLocal(name)} = ${stored}`];
              }
              return [decl];
            }
            // An EMPTY block in effect position — not the last statement,
            // or any statement of a list whose own value is discarded — is
            // an empty statement with nothing to emit. (The last statement of
            // a value-carrying list is the list's value; an empty block there
            // declines through `compileOp`, since `Nothing` has no compiled
            // representation.)
            if (
              isFunction(arg, 'Block') &&
              arg.nops === 0 &&
              (!valueUsed || i < stmts.length - 1)
            )
              return [];
            // A nested block in statement position on a shader target has
            // no value that anything reads. It compiles for effect, as one
            // compound statement (`{ … }`), so its locals stay in its own
            // scope. Compiled as a value, the statements of a block whose
            // last statement is a list were put in the enclosing scope
            // with a `return` of that list (`return U; return x + 1.0;`),
            // and a block with a scalar value was stored in a temporary
            // that was then written as a statement (`_tv1;`, which is not
            // valid WGSL).
            //
            // Python has no compound statement and no block scope. Its
            // statements are put in the enclosing list, with no `return`,
            // and each local of the nested block gets a fresh name
            // (`withFreshBlockLocals`), so that a write of it does not
            // change a variable of the enclosing code with the same name.
            if (
              isStatement &&
              target.language === 'python' &&
              isFunction(arg, 'Block')
            ) {
              const inner = withFreshBlockLocals(() =>
                compileBlock(arg.ops, stmtTarget, arg, false)
              );
              return inner === '' ? [] : [inner];
            }
            if (
              isStatement &&
              isGPUTarget &&
              target.bareStatementBlocks &&
              isFunction(arg, 'Block')
            ) {
              const inner = compileBlock(arg.ops, stmtTarget, arg, false);
              if (inner === '') return [];
              const body = inner
                .split('\n')
                .map((line) => `  ${line}`)
                .join('\n');
              return [`{\n${body}\n}`];
            }
            // A bare expression statement is its own bindable region, keyed
            // `(statement, -1)`; every other statement head reaches its own
            // value edges from `compileExpr` (Assign RHS, Return value, …).
            // The last statement of a block whose value is consumed whole
            // (`compileCollectionValueBlock`) is offered to the spelling of
            // a collection value of the target first. It is compiled the
            // ordinary way when the target does not spell it (a scalar).
            // A `Return` in the last statement gives the value of the
            // block (`tailValueFor`), which the IIFE or the `block` hook
            // returns once.
            const value = isStatement ? arg : tailValueFor(arg, target);
            const spell = stmtTarget.compileCollectionValue;
            if (
              collectionValue &&
              valueUsed &&
              i === stmts.length - 1 &&
              spell !== undefined
            )
              return [
                withCseOperand(
                  arg,
                  -1,
                  stmtTarget,
                  () =>
                    spell(value, stmtTarget) ??
                    core.compile(value, stmtTarget, 0)
                ),
              ];
            const code = compileOp(arg, -1, stmtTarget, 0, value);
            // A discarded value is a WGSL phony assignment
            // (`shaderExpressionStatement`).
            return [
              isStatement && target.bareStatementBlocks
                ? shaderExpressionStatement(arg, code, stmtTarget)
                : code,
            ];
          })
        )
        .filter((s) => s !== '')
    );

    // An empty statement list evaluates to `Nothing`, the erasure marker,
    // which has no compiled representation. In VALUE position — a function
    // body, a block spliced into an operand — the block declines (D6): a
    // bare `''` spliced into the arrow-function template emitted `(x) => `,
    // a syntax error. In EFFECT position — a loop body, an else-less `if`
    // arm — an empty statement is exactly what `''` is.
    if (result.length === 0) {
      if (valueUsed)
        throw new Error(
          'Could not compile `Block`: an empty block evaluates to `Nothing`, the erasure ' +
            'marker, which has no compiled representation.'
        );
      return '';
    }

    // The temporaries of the in-place list updates (see `ownedTemps`
    // above), declared first so that each execution of the block starts
    // with no owned array.
    if (ownedTemps.length > 0)
      result.unshift(...ownedTemps.map((temp) => `let ${temp}`));

    // A statement list evaluated FOR EFFECT — a loop body — has no value,
    // so it is neither wrapped nor returned from: it is just its statements.
    // Going through the value paths below emitted `return <last statement>`
    // INSIDE the loop, which returns from the enclosing function on the
    // first iteration. (Reachable on any target whose loop bodies route
    // here — the shader targets — for any multi-statement body,
    // destructuring or not.)
    if (!valueUsed)
      return target.bareStatementBlocks
        ? statementLines(target, result)
        : result.join(`;${target.ws('\n')}`);

    // A multi-statement block that is a VALUE OPERAND on a shader target —
    // a `with` clause as a `Sum` term, or on one side of an addition — has
    // no expression form of its own. When the enclosing position can take
    // statements, the target's `valueBlock` hook moves the block's
    // statements there as one compound statement that stores the value in
    // a temporary, and the temporary stands in for the block. The block
    // that IS the enclosing statement position (`hoist.root`, a function
    // body) emits in place below; so does a block whose final statement has
    // no value (a declaration, an assignment, a `Loop`, a `Return`, a
    // `Break` or `Continue` — checked on the statement and on its emission,
    // which the `Loop` lowering spells as a `for` statement) or that
    // returns early, since neither can be stored in a temporary — those
    // keep the statement-sequence emission, which the operand position then
    // refuses (`compileValueOperand`, fail closed).
    if (
      target.bareStatementBlocks &&
      target.valueBlock !== undefined &&
      canHoist(target) &&
      target.hoist!.root !== node
    ) {
      const last = stmts[stmts.length - 1];
      const lastIsStatement =
        last === undefined ||
        statementBodyHead(last) !== undefined ||
        (isFunction(last) &&
          ['Loop', 'Return', 'Break', 'Continue'].includes(last.operator)) ||
        /^\s*(?:for|while|if|return|break|continue)\b/.test(
          result[result.length - 1]
        );
      // A last statement that is an assignment to a name (or a `Declare`
      // with an initial value) gives the block the value it stores, so the
      // statement is kept and the name it wrote is the value stored in the
      // temporary. Without this, the statements of the block reached the
      // `block` hook, and the enclosing block put its `return` in front of
      // the first of them (`return float t;`).
      const assignedValue = isFunction(last, 'Assign')
        ? last.ops[1]
        : isFunction(last, 'Declare')
          ? declareValueOperand(last.ops)
          : undefined;
      const assignedName =
        assignedValue !== undefined &&
        (isFunction(last, 'Assign') || isFunction(last, 'Declare')) &&
        isSymbol(last.ops[0])
          ? /^([^\s()[\]{}'"=,:;]+) = /.exec(result[result.length - 1])?.[1]
          : undefined;
      if (
        (!lastIsStatement || assignedName !== undefined) &&
        !args.some((a) => containsEarlyReturn(a))
      ) {
        const hoisted =
          assignedName !== undefined
            ? target.valueBlock(
                assignedValue!,
                result,
                assignedName,
                target,
                node
              )
            : target.valueBlock(
                last,
                result.slice(0, -1),
                result[result.length - 1],
                target,
                node
              );
        if (hoisted !== undefined) return hoisted;
      }
    }

    if (target.block) return target.block(result);

    // Default: JavaScript IIFE. A `Return` in the last statement was
    // compiled as its value (`tailValue`), so it is returned here once.
    // A last `Declare` with an initial value emits `let t = …`, a
    // statement (`return let t = …` does not parse), and the value of the
    // block is the initial value: keep the declaration and return the
    // name it binds.
    const declared =
      isFunction(lastArg, 'Declare') && isSymbol(lastArg.ops[0])
        ? /^let ([^\s=]+) = /.exec(result[result.length - 1])
        : null;
    if (declared !== null) result.push(declared[1]);
    result[result.length - 1] = `return ${result[result.length - 1]}`;
    return `(() => {${target.ws('\n')}${result.join(
      `;${target.ws('\n')}`
    )}${target.ws('\n')}})()`;
  } finally {
    _popLocalComplex();
    CompilerState._localVector.pop();
    if (pushedEnforced) CompilerState._enforcedTargets.pop();
    if (checkedFrame !== undefined) CompilerState._checkedLocals.pop();
    if (blockScope !== undefined) _blockStatements.pop();
    if (localValueFrame !== undefined) _localValueFrames.pop();
    unmarkFed?.();
    for (const ops of ownedOps) OWNED_LOCAL_UPDATE_OPS.delete(ops);
    for (const name of shadowSpellings) _freshLocalNames.delete(name);
  }
}
