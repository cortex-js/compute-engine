// compileBlock and the local function scopes of a block.

import {
  bindScalarFragmentBlock,
  scalarFragmentUnwrappedBlock,
} from './javascript-fragment-facts.js';
import type { Expression } from '../global-types.js';
import {
  recordBlockScalarLocals,
  recordScopeParent,
} from './javascript-value-facts.js';
import { discardedValueStatement } from './javascript-statements.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isSymbol, isFunction } from '../boxed-expression/type-guards.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  OWNED_LOCAL_DECLARATIONS,
  OWNED_LOCAL_UPDATE_OPS,
  copyingUpdateInLoop,
  noteCopyingUpdateInLoop,
  ownedLocalUpdateChains,
} from './in-place-update.js';
import {
  _freshLocalNames,
  _localValueFrames,
  _outerReadValues,
  assertLocalsAssignedBeforeRead,
  assertNoUseBeforeDeclare,
  blockLocalValueFrame,
  noteReservedDeclares,
  refuseEffectContractViolations,
  spellReservedLocals,
  withDefineFunctionDeclares,
  withFreshBlockLocals,
  nestedAssignmentsTo,
} from './compile-locals.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
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
  _compileParents,
  compileListStatement,
  joinShaderStatements,
  loopBodyTempTarget,
  statementBodyHead,
  statementLines,
  statementListDeclaredVarTypes,
} from './compile-statements.js';
import { core } from './compiler-core-hooks.js';
import { compilationType } from './compiler-type-facts.js';
import type { LocalValueFrame } from './compiler-types.js';
import { compileOp, withCseScope } from './compile-cse.js';
import {
  containsEarlyReturn,
  tailValueFor,
  withCseOperand,
  writesBlocksAsIife,
} from './compile-conditions.js';
import { LOCAL_UNSET, localShapeFrameOf } from './compile-shapes.js';
import {
  localComplexDefault,
  realLaneLocalBinding,
  withComplexEntryHidden,
} from './compile-complexness.js';
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
import { tempVar, withBoundScope } from './compiler-naming.js';
import { poolBlockCode, poolBlockMark, poolStatement } from './pool-async.js';
import {
  callOnlyLocalFunctionLiterals,
  markCheckedLiteralApplications,
  markScalarFedLiterals,
} from './compile-callbacks.js';

/**
 * Compile an expression as a statement list evaluated **for effect** — a
 * loop body — rather than for its value.
 *
 * The difference from `compile()` is what happens to the LAST statement:
 * compiled for a value it is wrapped/returned (`return <stmt>`, or the
 * target's `block` hook), which inside a loop returns from the enclosing
 * function on the first iteration. Compiled for effect it is just another
 * statement. It is also the position where a destructuring assign or a
 * destructuring declare lowers, since no statement's value is anyone's. A
 * bare destructuring declare compiles as a block of that one statement.
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
  // A lone destructuring declare (`Loop(Declare((a, b), "unknown", (k, 2)),
  // …)`) is a statement list of one statement. It compiles as a block of
  // that statement, which desugars it into per-leaf declares and declares
  // each local in the loop body. Without this step it reached the
  // value-position `Declare` handler, which fails closed.
  if (isFunction(expr, 'Declare') && isFunction(expr.ops[0], 'Tuple'))
    return compileBlock([expr], target, undefined, false);
  const stmts = desugarPatternAssign(expr, target);
  // On a shader target the lone statement gets a statement sink of its own
  // (see `compileListStatement`): a loop-form `Sum` on the right of the
  // assignment has nowhere else to put its loop. A selection whose branches
  // assign takes the statement form (`shaderSelectionStatement`).
  if (stmts === null)
    return target.bareStatementBlocks
      ? joinShaderStatements(
          compileListStatement(target, expr, (t) => [
            core.shaderSelectionStatement(expr, t) ?? core.compile(expr, t),
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
  // or spliced into it (`return float t;`, `return let t`).
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
  // A `Declare` whose value reads the enclosing binding of the name of its
  // local (`3z with z = z + Z`, a `Declare` of `z` whose value is `z + Z`):
  // the interpreter evaluates the value before the local exists. Its local
  // gets an emitted name of its own (see `spelled` below), and its value is
  // compiled against the enclosing binding (`outerReadTarget`).
  const outerReads = new Map<Expression, string>();
  assertLocalsAssignedBeforeRead(args, locals, outerReads);

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

  // A nested block that is a statement on the JavaScript targets (the
  // nested-block statement below) compiles its lone statement as a statement
  // of a longer list does: a loop becomes a block statement and an else-less
  // `If` an `if` statement. The unwrap below compiles it as a value.
  const jsStatementList =
    !valueUsed &&
    (target.language === 'javascript' ||
      target.language === 'interval-javascript');
  if (args.length === 1 && locals.length === 0 && !jsStatementList) {
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
          withCseScope(
            node,
            -1,
            t,
            () =>
              core.shaderSelectionStatement(args[0], t) ??
              compileOp(args[0], -1, t, prec, args[0])
          ),
        ])
      );
    // The value of a lone statement is the value of the block, so a
    // `Return` there gives its value (`tailValueFor`).
    const value = valueUsed ? tailValueFor(args[0], target) : args[0];
    const innerTarget = scalarFragmentUnwrappedBlock(target, node, args);
    return withCseScope(node, -1, innerTarget, () =>
      compileOp(args[0], -1, innerTarget, prec, value)
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
  // ARRAY constructor (`float[5](…)`), so the local's
  // declaration must be the matching array type — a `float` declaration with
  // an array assignment is the same mismatch, one width up.
  const vectorFrame = new Map<string, number>();
  // On a GPU target the width of a local is the width of its first binding
  // (a scalar or an aggregate); a later binding does not change it. Off GPU
  // it is the width of its first aggregate binding. On a GPU target this is
  // sound because
  // the GLSL fragment pass runs before any code is written, and it refuses a
  // block local that is not a scalar, a complex number or a point (a list,
  // a list of points, an empty list, a matrix), and a local whose bindings
  // have different types (`walkDeclare()` and `walkAssign()` in
  // `fragment.ts`). So every binding of a local that reaches this point has
  // the shape of the first one, and a local has one declared type, as GLSL
  // requires. A target object passed straight to `BaseCompiler.compile()`
  // skips the pass; on that route such a block gives code that no shader
  // compiler accepts (a known limitation in `docs/COMPILATION-MODEL.md`).
  const isGPUTarget = target.language === 'glsl';
  const declaredVarTypes = statementListDeclaredVarTypes(
    args,
    target.declaredVarTypes
  );
  const noteVectorWidth = (
    name: string,
    value: Expression,
    /** The value reads the enclosing binding of `name` (`outerReads`). */
    outerRead = false
  ) => {
    // Only declared locals get a declaration (and hence a type hint).
    const prev = vectorFrame.get(name);
    if (prev === undefined) return;
    // A shader color occupies three channels, even though its language
    // type is atomic and its JavaScript representation is an object.
    const width = () =>
      isGPUTarget &&
      (!isSymbol(value) || !localShapeFrameOf(value.symbol)) &&
      isSubtype(compilationType(value), 'color')
        ? 3
        : core.aggregateComponentCount(value);
    const count = outerRead ? withLocalHidden(name, width) : width();
    if (isGPUTarget) {
      // The first binding also records a scalar local as `LOCAL_SCALAR`:
      // the frame stays pushed while the statements of the block compile,
      // and `provablyScalarOrFramedScalar()` and `operandTypeInContext()`
      // read that entry to treat the local as a scalar, also when its stored
      // type still admits a collection.
      if (prev === LOCAL_UNSET) vectorFrame.set(name, count || LOCAL_SCALAR);
      return;
    }
    // Off GPU a local is untyped. A width of `0` is not recorded: it
    // produces no declaration.
    if (prev < 0 && count) vectorFrame.set(name, count);
  };
  for (const local of locals) {
    // Under the complex discipline a local that is neither declared real
    // nor typed real in the block's scope is complex-shaped from its
    // declaration (`localComplexDefault`); the strict default is real until
    // a complex first binding.
    complexFrame.set(local, localComplexDefault(node?.localScope, local));
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
  // Run `f` with no entry for `name` in the frames of this block, so that
  // a read of `name` in `f` finds the facts of the enclosing binding: the
  // value of a `Declare` of `outerReads`. An entry that `f` does not set
  // is put back when `f` ends.
  const withLocalHidden = <T>(name: string, f: () => T): T => {
    const width = vectorFrame.get(name);
    vectorFrame.delete(name);
    try {
      return withComplexEntryHidden(complexFrame, name, f);
    } finally {
      if (width !== undefined && !vectorFrame.has(name))
        vectorFrame.set(name, width);
    }
  };
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
  // Removes the marks of `markScalarFedLiterals`.
  let unmarkFed: (() => void) | undefined;
  // Removes the marks of `markCheckedLiteralApplications`.
  let unmarkChecked: (() => void) | undefined;
  // Removes the records of `noteReservedDeclares` when the block ends.
  let unnoteReserved: (() => void) | undefined;
  // The list updates of this block that write in place, and the
  // temporaries that hold the arrays the block owns
  // (`ownedLocalUpdateChains`).
  const ownedTemps: string[] = [];
  const ownedOps: ReadonlyArray<Expression>[] = [];
  // The declarations that copy the list of a local whose updates then write
  // it with no test (`ownedFromDeclaration`, `OWNED_LOCAL_DECLARATIONS`).
  const ownedDeclarations: Expression[] = [];
  // The fresh names that this block gave to its locals that shadow a name
  // bound outside it on a shader target (see `spelled` below). They are
  // removed from `_freshLocalNames` in the `finally` below.
  const shadowSpellings: string[] = [];
  // The records of `_outerReadValues` that this block replaced, put back in
  // the `finally` below.
  const previousOuterReads = new Map<
    Expression,
    ReturnType<typeof _outerReadValues.get>
  >();
  let localValueFrame: LocalValueFrame | undefined;
  try {
    for (const arg of args) {
      // The value of a `Declare` of `outerReads` reads the enclosing
      // binding of its name.
      const outerRead = outerReads.get(arg);
      if (outerRead !== undefined && isFunction(arg)) {
        withLocalHidden(outerRead, () =>
          core.noteLocalComplex(arg, complexFrame)
        );
        const value = declareValueOperand(arg.ops);
        if (value !== undefined) noteVectorWidth(outerRead, value, true);
        continue;
      }
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
    }

    // GPU type hints for block locals.
    //
    // GPU shader scalars are always `float`. We intentionally never
    // infer `int` for an integer-valued local: GPU number literals are
    // always emitted with a decimal point (`3` → `3.0`, see formatGPUNumber)
    // and scalar shader arithmetic is float, so an `int`-typed declaration
    // would disagree with its own float assignment (`int r; r = 3.0;` — not
    // valid GLSL) and poison every downstream use in float math. Only a
    // complex-valued local needs a non-default hint (`vec2`), as
    // does a vector-valued (point/tuple) one (`vec2`…`vec4`) or a color
    // (`vec3`); everything
    // else uses the `float` default in `target.declare`.
    const typeHints: Record<string, string | undefined> = {};
    if (target.declare && target.language) {
      const vecN = (n: number) => `vec${n}`;
      // A width with no `vecN` gets the array type the list compilers emit
      // for it, so declaration and assignment agree.
      const aggregateType = (n: number) =>
        n >= 2 && n <= 4 ? vecN(n) : `float[${n}]`;
      for (const local of locals) {
        if (complexFrame.get(local)) typeHints[local] = vecN(2);
        else {
          const n = vectorFrame.get(local);
          // Negative entries are the "not an aggregate" sentinels. A width
          // of `0` has no valid array type in GLSL, so this guard keeps a
          // `float[0]` declaration from being written.
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
    // runs: a call or an operand use of one declines (see
    // `reboundLocalNames`).
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
    // the parameters or the index, and GLSL does not let a
    // declaration have the name of a parameter of its scope
    // (`float f(float U) { float[10] U;` is a redeclaration). The check reads the name at the
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
    // A local with the name of an identifier that the emitted code uses
    // (`_SYS`, the runtime helper object of the JavaScript target) gets a
    // fresh name too. Otherwise its declaration hides that identifier in
    // the block, and each helper call in the block fails at run time.
    spellReservedLocals(locals, target, spelled, shadowSpellings);
    // A local whose `Declare` value reads the enclosing binding of its name
    // (`outerReads`) gets a fresh name too, so that the code of the value
    // reads the enclosing binding (JavaScript: `let z = z + Z` reads its
    // own uninitialized `z`).
    for (const local of outerReads.values()) {
      if (spelled.has(local)) continue;
      const fresh = tempVar(target);
      spelled.set(local, fresh);
      if (!_freshLocalNames.has(fresh)) {
        _freshLocalNames.add(fresh);
        shadowSpellings.push(fresh);
      }
    }
    const spellLocal = (name: string): string => spelled.get(name) ?? name;
    // The `Declare` of such a local declares its fresh name.
    unnoteReserved = noteReservedDeclares(args, target, spellLocal, outerReads);
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
    for (const [declaration, name] of outerReads) {
      if (!previousOuterReads.has(declaration))
        previousOuterReads.set(declaration, _outerReadValues.get(declaration));
      _outerReadValues.set(declaration, (compileValue, t) =>
        withLocalHidden(name, () =>
          compileValue(outerReadTarget(t, target, name, locals))
        )
      );
    }
    bindScalarFragmentBlock(target, localTarget, node, args);
    if (target.language === 'javascript')
      recordBlockScalarLocals(args, localTarget);

    // The statement LIST is one INERT region — no binding is placed at the
    // statement-list level, so early-exit reachability and inter-statement
    // ordering never interact with CSE. Each statement's own value
    // expressions are separate, bindable child regions (§5.1(c)).
    const stmts = args.filter((a) => !isSymbol(a, 'Nothing'));
    // The function literals that this list binds to a local that is only
    // ever called (`callOnlyLocalFunctionLiterals`) receive scalars at
    // every call, and their bodies read each parameter as a scalar: each
    // call site maps over a list argument by itself. The marks are removed
    // in the `finally` below.
    if (target.language === 'javascript')
      unmarkFed = markScalarFedLiterals(
        callOnlyLocalFunctionLiterals(args, locals, reboundLocals)
      );
    // On every target, each call of such a literal checks its arguments at
    // the call site (`tryCompileLocalFunctionCall`), so the literal is not
    // declined for a parameter declared `expression`
    // (`markCheckedLiteralApplications`). So is a literal whose other uses
    // are the callback of a consumer that passes no collection to such a
    // parameter (`Map(g, L)` with `L` declared `list<real>`; the argument
    // `true` of `callOnlyLocalFunctionLiterals`). The marks are removed in
    // the `finally` below, so they do not reach a later block; a nested
    // block marks its own literals, which are other nodes.
    unmarkChecked = markCheckedLiteralApplications(
      callOnlyLocalFunctionLiterals(args, locals, reboundLocals, true)
    );
    // A local that the list replaces element by element
    // (`xs = ReplaceAt(xs, i, v)`) and never hands out is copied once, at
    // its first update, and then written in place
    // (`ownedLocalUpdateChains`, CE-329). JavaScript only: the other
    // targets keep the copying form. A local whose updates keep the copying
    // form, and which a loop of the list updates, copies the list on each
    // pass: the compilation reports it in `CompilationResult.warnings`
    // (`copyingUpdateInLoop`).
    if (target.language === 'javascript')
      for (const local of locals) {
        const chains = ownedLocalUpdateChains(args, local);
        if (chains === undefined) {
          const update = copyingUpdateInLoop(args, local);
          if (update !== undefined)
            noteCopyingUpdateInLoop(target, local, update);
          continue;
        }
        // A local that holds its copy from its declaration to the end of the
        // block is copied at the declaration, and its updates test nothing
        // (`ownedFromDeclaration`). `null` in `OWNED_LOCAL_UPDATE_OPS` marks
        // such an update.
        const declaration = ownedFromDeclaration(args, local, chains);
        if (declaration !== undefined) {
          OWNED_LOCAL_DECLARATIONS.set(declaration, {
            levels: chains[0].length - 2,
            copied: false,
          });
          ownedDeclarations.push(declaration);
        }
        const temp = declaration === undefined ? tempVar(target) : null;
        if (temp !== null) ownedTemps.push(temp);
        for (const ops of chains) {
          OWNED_LOCAL_UPDATE_OPS.set(ops, temp);
          ownedOps.push(ops);
        }
      }
    // The locals of the block, for the reads that a comparison of a local
    // tests (`blockLocalValueFrame`).
    localValueFrame = blockLocalValueFrame(stmts, locals, node?.localScope);
    _localValueFrames.push(localValueFrame);
    // The count of waits of the asynchronous copy of the program before the
    // statements compile (`poolBlockMark()`, `pool-async.ts`).
    const poolMark = poolBlockMark();
    const result = withCseScope(node, -1, localTarget, () =>
      stmts
        .flatMap((arg, i) =>
          compileListStatement(localTarget, arg, (stmtTarget) => {
            // Bring this statement's own function-valued binding into scope
            // before compiling it (see `localFunctions` above).
            noteLocalFunction(arg, localFunctions, reboundLocals);
            // The positions of the statement where the asynchronous copy of
            // the program can wait (`poolStatement()`, `pool-async.ts`).
            poolStatement(node, arg);
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
            //  - INTERVAL JavaScript. `compileLoopBody` emits the condition as
            //    `_IA.decided(<verdict>)`, which throws for an undecided
            //    verdict, so a call whose input interval makes the condition
            //    true at some points and false at others gives `entire`. In a
            //    loop body that is the only sound answer, since one pass
            //    cannot run both branches. Outside a loop the else-ful
            //    lowering joins the two branches (`_IA.hull`) and keeps a
            //    bound, so this shape declines and the interpreter evaluates
            //    it.
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
            // An `If` with an else and a `Loop` in a branch, in statement
            // position, also takes the statement form. As a conditional
            // expression, each branch with several statements is an arrow
            // function that is called at once, and a loop in it that writes
            // a local of the block runs up to two times slower (V8 keeps
            // such a local in a heap context). A condition that is not a
            // boolean keeps the conditional expression: it can select a
            // branch for each element of a collection, which an `if`
            // statement cannot do. The statement form is for plain JavaScript
            // with no `If` function of the target: such a function compiles
            // the conditional, and on another target the loops stay arrow
            // functions in both forms. A branch whose block has a list local
            // that a loop writes in place also keeps the conditional
            // expression: the statement form compiles the branch as a loop
            // body, which copies such a list on each write
            // (`branchWritesListInPlace()`).
            const loopInBranch =
              isFunction(arg, 'If') &&
              isStatement &&
              target.language === 'javascript' &&
              target.functions?.('If') === undefined &&
              isSubtype(arg.ops[0].type.type, 'boolean') &&
              arg.ops.slice(1).some(containsLoop) &&
              !arg.ops.slice(1).some(branchWritesListInPlace);
            if (
              isFunction(arg, 'If') &&
              (arg.nops === 2 || returnsEarly || loopInBranch) &&
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
            // A `Which` has no statement form: as a conditional expression,
            // a `Return` in a block branch would end only the arrow function
            // of that branch, and the statements after the `Which` would
            // still run. Such a `Which` declines, as such an `If` does on a
            // target with no statement form for it.
            const whichReturnsEarly =
              isFunction(arg, 'Which') &&
              isStatement &&
              containsEarlyReturn(arg);
            if (
              (returnsEarly || whichReturnsEarly) &&
              writesBlocksAsIife(target)
            )
              throw new Error(
                `Could not compile \`${arg.operator}\`: a branch returns early ` +
                  `(\`Return\`) from a statement that is not the last ` +
                  `one of the block, and target '${target.language}' ` +
                  `has no statement form for a conditional with a ` +
                  `\`Return\` in a branch.`
              );
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
                const compileValue = (t: CompileTarget<Expression>) =>
                  valueIndex < 0
                    ? core.compile(value, t)
                    : compileOp(arg, valueIndex, t, 0, value);
                const outerRead = _outerReadValues.get(arg);
                const valueCode = realLaneLocalBinding(
                  name,
                  value,
                  outerRead !== undefined
                    ? outerRead(compileValue, stmtTarget)
                    : compileValue(stmtTarget),
                  stmtTarget
                );
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
            // that was then written as a statement (`_tv1;`).
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
            // A nested block in statement position on the JavaScript targets
            // (`do { let u = 2; t = t + u }` in Epsil) has no value that
            // anything reads either. It compiles for effect, as one block
            // statement, so its locals stay in its own scope. It is not an
            // arrow function that is called at once: V8 keeps a local of the
            // enclosing code that such a function writes (in a loop of the
            // block, for example) in a heap context, which is slower to read
            // and write. A `Return` in the block ends the code of the
            // enclosing block, as a `Return` in an `If` statement of that
            // block does. In an arrow function it would end only that
            // function, and the statements after the nested block would run.
            if (
              isStatement &&
              isFunction(arg, 'Block') &&
              (target.language === 'javascript' ||
                target.language === 'interval-javascript')
            ) {
              // The block is on the stack of the nodes being compiled while
              // its statements compile, as `core.compile` puts it there: a
              // raw `Match` case body is canonicalized in the scope of the
              // innermost node of that stack (`inCompiledScope()`), so that
              // it sees the locals of this block.
              _compileParents.push(arg);
              let inner: string;
              try {
                inner = compileBlock(arg.ops, stmtTarget, arg, false);
              } finally {
                _compileParents.pop();
              }
              if (inner === '') return [];
              const nl = target.ws('\n');
              return [`{${nl}${inner}${nl}}`];
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
            // A discarded value is kept as it is on a shader target. On
            // JavaScript, a loop whose
            // value is discarded is a block statement, not an arrow function
            // that is called at once (`discardedValueStatement()`).
            if (!isStatement) return [code];
            return [
              target.bareStatementBlocks
                ? code
                : discardedValueStatement(stmtTarget, code),
            ];
          })
        )
        .filter((s) => s !== '')
    );

    // The updates of a local in `ownedDeclarations` write its list with no
    // test, so the code of its declaration must copy the list. The JavaScript
    // lowering of `Declare` marks each declaration that it emits with the
    // copy. A declaration that another part of the compiler emitted would
    // leave the caller's array to the updates, so the block declines. The
    // JavaScript target has no `declare` hook, so each `Declare` statement
    // of the block compiles through `compileExprDeclare` and this check
    // never fails: a decline here is a defect of the compiler.
    for (const d of ownedDeclarations)
      if (OWNED_LOCAL_DECLARATIONS.get(d)?.copied !== true)
        throw new Error(
          'Could not compile `Block`: a list local whose updates write the ' +
            'list in place was declared without a copy of its value.'
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

    // The last statement is an assignment or a declaration, so the value of
    // the block is `Nothing`. This check runs only when the lowering uses
    // the value of the block (`valueUsed`). Where the admission search also
    // counts that value as used, the compilation declines after the code
    // is generated (`assertAdmitted()`, reason `'nothing-value'`), so it
    // declines here, before the code of the value is generated. A block
    // that the lowering compiles as a value but whose value the search
    // does not count as used (the branch of a conditional that is a
    // statement) compiles on only when the compilation has no other value
    // with no settled shape: on JavaScript and GLSL, where an assignment is
    // an expression, the code below returns the assignment. In Python an
    // assignment is a statement, with no form that the code below
    // can return, so the block declines.
    if (isFunction(lastArg, 'Assign') || isFunction(lastArg, 'Declare')) {
      core.throwPendingUnsettledShape();
      if (target.language === 'python')
        throw new Error(
          `Could not compile \`Block\`: the last statement of the block is ` +
            `an assignment or a declaration, so the value of the block is ` +
            `\`Nothing\`, which has no compiled representation. End the ` +
            `block with the value it should have.`
        );
    }

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
            ? target.valueBlock(assignedValue!, result, assignedName, target)
            : target.valueBlock(
                last,
                result.slice(0, -1),
                result[result.length - 1],
                target
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
    // In the asynchronous copy of the program, the function is `async` and
    // awaited when a statement waited (`poolBlockCode()`, `pool-async.ts`).
    return poolBlockCode(
      poolMark,
      `(() => {${target.ws('\n')}${result.join(
        `;${target.ws('\n')}`
      )}${target.ws('\n')}})()`
    );
  } finally {
    _popLocalComplex();
    CompilerState._localVector.pop();
    if (pushedEnforced) CompilerState._enforcedTargets.pop();
    if (localValueFrame !== undefined) _localValueFrames.pop();
    unmarkFed?.();
    unmarkChecked?.();
    unnoteReserved?.();
    for (const ops of ownedOps) OWNED_LOCAL_UPDATE_OPS.delete(ops);
    for (const d of ownedDeclarations) OWNED_LOCAL_DECLARATIONS.delete(d);
    for (const name of shadowSpellings) _freshLocalNames.delete(name);
    // A record that a statement had before is put back, as
    // `noteReservedDeclares` does.
    for (const [declaration, previous] of previousOuterReads)
      if (previous === undefined) _outerReadValues.delete(declaration);
      else _outerReadValues.set(declaration, previous);
  }
}

/**
 * The target `t` of a statement of a block, with the name `name` read as
 * the enclosing target `enclosing` reads it: the target of the value of a
 * `Declare` of `name` that reads the enclosing binding of `name`
 * (`outerReads` in `compileBlock`). The other locals of the block keep
 * their binding in `t`.
 */
function outerReadTarget(
  t: CompileTarget<Expression>,
  enclosing: CompileTarget<Expression>,
  name: string,
  /** The locals of the block. */
  locals: ReadonlyArray<string>
): CompileTarget<Expression> {
  // A new set of bound names: a fact keyed on the set of the block is about
  // the local. The set is linked to the enclosing set, so a fact of the
  // enclosing binding of `name` (a loop index range) stays readable. Every
  // other local of the block is a name that this set binds again, also one
  // that shadows an enclosing binding, so it does not read the facts of the
  // enclosing binding.
  const boundVars = new Set(t.boundVars);
  if (enclosing.boundVars?.has(name) === true) boundVars.add(name);
  else boundVars.delete(name);
  recordScopeParent(
    boundVars,
    enclosing.boundVars,
    [...boundVars].filter(
      (n) =>
        enclosing.boundVars?.has(n) !== true ||
        (n !== name && locals.includes(n))
    )
  );
  const declaredVarTypes = t.declaredVarTypes && { ...t.declaredVarTypes };
  if (declaredVarTypes !== undefined) {
    delete declaredVarTypes[name];
    const outer = enclosing.declaredVarTypes?.[name];
    if (outer !== undefined) declaredVarTypes[name] = outer;
  }
  // The function scopes of the block, with the entry of `name` of the
  // enclosing target.
  const withOuterEntry = <V>(
    inner: ReadonlyMap<string, V> | undefined,
    outer: ReadonlyMap<string, V> | undefined
  ): ReadonlyMap<string, V> | undefined => {
    if (inner === undefined || !inner.has(name)) return inner;
    const entries = new Map(inner);
    const entry = outer?.get(name);
    if (entry === undefined) entries.delete(name);
    else entries.set(name, entry);
    return entries;
  };
  const rebound = new Set(t.reboundFunctions);
  if (enclosing.reboundFunctions?.has(name) === true) rebound.add(name);
  else rebound.delete(name);
  return {
    ...t,
    var: (id) => (id === name ? enclosing.var(id) : t.var(id)),
    boundVars,
    declaredVarTypes,
    localFunctions: withOuterEntry(t.localFunctions, enclosing.localFunctions),
    lexicalFunctions: withOuterEntry(
      t.lexicalFunctions,
      enclosing.lexicalFunctions
    ),
    reboundFunctions:
      t.reboundFunctions === undefined && rebound.size === 0
        ? undefined
        : rebound,
  };
}

/**
 * True when `e` has a `Loop` that is not inside a nested function literal (a
 * loop inside a function literal belongs to the code of that function).
 */
function containsLoop(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'Loop') return true;
  if (e.operator === 'Function') return false;
  return e.ops.some(containsLoop);
}

/**
 * For a local `name` of the statement list `stmts` whose updates
 * `ownedLocalUpdateChains` accepts (`chains`), the statement that declares the
 * local with a value, when the block can copy the list once at that
 * declaration. Otherwise `undefined`.
 *
 * The usual form copies the list at the first update and keeps the copy in a
 * temporary, and each update tests that the local still holds that copy:
 *
 *     (_tv1 = _SYS.replaceAtInPlace(xs === _tv1 ? xs : (_tv1 = _SYS.ownedCopy(xs)), i, v))
 *
 * In a loop, this test and the call that the compiled code keeps for the
 * copy cost about 0.3 ns for each update, which is about 25 % of a loop that
 * only updates elements. When the local is declared with a value
 * (`let xs = L`) and every other write of the local is an update chain, the
 * local holds the copy from its declaration to the end of the block, so the
 * declaration copies the list and each update writes it with no test:
 *
 *     let xs = _SYS.ownedCopy(L); ... xs = _SYS.replaceAtInPlace(xs, i, v)
 *
 * The conditions:
 *
 * - The first statement of `stmts` that mentions `name` declares it with a
 *   value, and that value does not mention `name`.
 * - Every other `Assign` or `Declare` of `name` in `stmts` is the assignment
 *   of a chain in `chains`. `ownedLocalUpdateChains` has already refused
 *   every other way to give the local a value (a loop variable, a
 *   destructuring assignment) and every mention in a function literal.
 * - An update chain is in a loop (`copyingUpdateInLoop`). The declaration
 *   copies the list also when no update runs, so an update that runs at most
 *   once keeps the usual form, which copies only when an update runs.
 *
 * A string value is not copied by `ownedCopy`: the first update converts it
 * to a new array of its characters, which the local then holds, as in the
 * usual form.
 */
function ownedFromDeclaration(
  stmts: ReadonlyArray<Expression>,
  name: string,
  chains: ReadonlyArray<ReadonlyArray<Expression>>
): Expression | undefined {
  if (copyingUpdateInLoop(stmts, name) === undefined) return undefined;
  // True when `e` mentions `name`. A node can be an operand of several
  // nodes, so the answer for each node is kept.
  const memo = new Map<Expression, boolean>();
  const mentions = (e: Expression): boolean => {
    if (isSymbol(e, name)) return true;
    if (!isFunction(e)) return false;
    let result = memo.get(e);
    if (result === undefined) {
      result = e.ops.some(mentions);
      memo.set(e, result);
    }
    return result;
  };
  const first = stmts.findIndex((s) => mentions(s));
  if (first < 0) return undefined;
  const declaration = stmts[first];
  if (
    !isFunction(declaration, 'Declare') ||
    !isSymbol(declaration.ops[0], name)
  )
    return undefined;
  const value = declareValueOperand(declaration.ops);
  if (value === undefined || mentions(value)) return undefined;
  const chainOps = new Set(chains);
  // True when every write of `name` in `e` is the assignment of a chain.
  const seen = new Set<Expression>();
  const onlyChainWrites = (e: Expression): boolean => {
    if (!isFunction(e) || seen.has(e)) return true;
    seen.add(e);
    if (
      (e.operator === 'Assign' || e.operator === 'Declare') &&
      isSymbol(e.ops[0], name) &&
      !(
        e.operator === 'Assign' &&
        isFunction(e.ops[1], 'ReplaceAt') &&
        chainOps.has(e.ops[1].ops)
      )
    )
      return false;
    return e.ops.every(onlyChainWrites);
  };
  if (!declaration.ops.slice(1).every(onlyChainWrites)) return undefined;
  if (!stmts.slice(first + 1).every(onlyChainWrites)) return undefined;
  return declaration;
}

/**
 * True when `e`, a branch of an `If` statement, has a `Block` with a local
 * that `compileBlock` can write in place (`ownedLocalUpdateChains()`). The
 * statement form compiles such a block as a loop body, which does not write
 * its locals in place, so the branch keeps the conditional expression.
 *
 * The search does not go into a `Loop` or a function literal: their bodies
 * are compiled the same way in both forms. A destructuring declaration
 * (`let (xs, t) = …`) is split into one declaration for each name only when
 * `compileBlock` compiles the block, so the test cannot read its chains here:
 * a block that assigns again a name of such a declaration counts as a block
 * with an in-place write.
 */
function branchWritesListInPlace(e: Expression): boolean {
  if (!isFunction(e) || e.operator === 'Function' || e.operator === 'Loop')
    return false;
  if (
    e.operator === 'Block' &&
    e.ops.some((s) => {
      if (!isFunction(s, 'Declare')) return false;
      if (isSymbol(s.ops[0]))
        return ownedLocalUpdateChains(e.ops, s.ops[0].symbol) !== undefined;
      return (
        isFunction(s.ops[0], 'Tuple') &&
        nestedAssignmentsTo(e, new Set(tuplePatternNames(s.ops[0]))).length > 0
      );
    })
  )
    return true;
  return e.ops.some(branchWritesListInPlace);
}
