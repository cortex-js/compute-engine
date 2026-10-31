// User-defined functions: literals, declared signatures, arity and parameter
// checks, captured bindings, and tryCompileUserFunction.

import { isIndexReadTuple } from '../boxed-expression/index-read-tuple.js';
import type {
  BoxedDefinition,
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isOperatorDef,
  isValueDef,
  collectBinderNames,
  freeSymbolNames,
} from '../boxed-expression/utils.js';
import {
  broadcastableParamSlots,
  declaredScalarParams,
  declaresBroadcastableParam,
  paramsAreScalar,
} from '../boxed-expression/boxed-function.js';
import { lookupApplicable } from '../function-utils.js';
import {
  isTuple,
  isTupleShapedType,
  isPointListArgumentType,
} from '../collection-utils.js';
import {
  collectionElementType,
  functionResult,
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  boundVariableNames,
  boundVariableNamesInOperand,
  callableBindingInContext,
} from '../boxed-expression/binders.js';
import {
  clauseOperandShadow,
  declaredBinders,
  ownIndexClauseAt,
} from '../boxed-expression/binding-sites.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
  isDestructuringParameter,
  isRestParameter,
  isScalarType,
} from '../boxed-expression/function-literal.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
import { multiClauseState } from '../multi-clause.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  builtinCallbackArity,
  builtinOperatorDefinition,
} from './builtin-callback.js';
import { isCompileBoundName } from './compiler-names.js';
import {
  blockLocalFunction,
  declaredUserSignature,
  groundSignature,
  provablyScalarArg,
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
  wholeTupleCall,
} from './compile-assignment-checks.js';
import {
  assignedNamesIn,
  registryLocalName,
  userFunctionIsGeneric,
} from './compile-cse.js';
import { countMayBeNaN, gatedCollectionArms } from './compiler-type-facts.js';
import {
  ABSENCE_DISCHARGING_HEADS,
  CONTROL_FLOW_HEADS,
  FOLD_OPERAND_PREC,
} from './compiler-tables.js';
import {
  _codeAliases,
  _codeOverrides,
  _prefixCallOverrides,
  strictLanes,
} from './compiler-mode.js';
import { core } from './compiler-core-hooks.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { compileValueOperand } from './compile-statements.js';
import {
  collectionElementTypeOf,
  declareValueOperand,
  typedTemp,
} from './compile-declarations.js';
import { CompilerState } from './compiler-state.js';
import { resetCompilationMemos, tryConstantFold } from './compile-folding.js';
import {
  appliedArgumentTypeMismatch,
  checkedParameterType,
  checkingShimName,
  failedCheckMarker,
  hasUniformComplexScalarElements,
  jsParameterGuard,
  laneMismatchAt,
  laneRequestParamType,
} from './compile-callbacks.js';
import { laneMismatch, userParamBinding } from './compile-lanes.js';
import {
  checkListCoordinateTupleArgs,
  checkPointListAtMatrixUnionArgs,
  checkPointParamCollectionUnionArgs,
  checkScalarListAtContractPointParam,
  tryCompilePointListCall,
} from './compile-point-calls.js';
import {
  absentArgumentChecks,
  checkDeclaredBroadcast,
  checkDeclaredBroadcastAgainst,
  complexCoordinateArgumentAt,
  emitUserFunctionCall,
  ensureUserFunctionVariantEmitted,
  isRealListArg,
  listArgumentAtOpenWholeParameter,
  multiClauseLaneMismatchAt,
  multiClauseParamIsComplex,
  pointArgumentAtUntypedParameter,
  presentCheckedCode,
  tryInlineUserFunctionCall,
  userFunctionParamType,
} from './compile-user-calls.js';
import { trySpecializedUserCall } from './compile-user-specialization.js';
import { removeDefinitionsAddedSince } from './compile-definitions.js';
import { userFunctionSignature } from './compile-absence.js';

/**
 * Compile an expression to target language source code
 */
export function assertCapturedCallableBindings(
  root: Expression,
  target: CompileTarget<Expression>
): void {
  const seen = new WeakMap<Expression, Set<ReadonlySet<string>>>();
  const walk = (node: Expression, bound: ReadonlySet<string>): void => {
    const contexts = seen.get(node);
    if (contexts?.has(bound)) return;
    if (contexts) contexts.add(bound);
    else seen.set(node, new Set([bound]));
    const name = isSymbol(node)
      ? node.symbol
      : isFunction(node)
        ? node.operator
        : undefined;
    if (
      name !== undefined &&
      !bound.has(name) &&
      !isCompileBoundName(name) &&
      target.varsKeys?.has(name) !== true &&
      blockLocalFunction(name, target) === undefined
    ) {
      const value = node.valueDefinition;
      const operator = node.operatorDefinition;
      const held =
        value?.value ??
        (operator as { _lambdaLiteral?: Expression } | undefined)
          ?._lambdaLiteral;
      if (held !== undefined && isFunction(held, 'Function')) {
        const ambient = lookupApplicable(
          name,
          node.engine.context.lexicalScope
        );
        if (
          (value !== undefined &&
            (!ambient || !isValueDef(ambient) || ambient.value !== value)) ||
          (operator !== undefined &&
            (!ambient ||
              !isOperatorDef(ambient) ||
              ambient.operator !== operator))
        )
          throw new Error(
            ambient === undefined
              ? `Could not compile \`${name}\`: the captured callable definition is not in scope.`
              : `Could not compile \`${name}\`: the captured callable has a different binding from the ambient function.`
          );
      } else if (
        isFunction(node) &&
        (value !== undefined || operator !== undefined)
      ) {
        // A call parsed before its function was defined is bound to a
        // forward-call placeholder that holds no function. The function
        // it calls is the binding that the placeholder resolves to
        // (`callableBindingInContext()`), which the compiler must read
        // too, not a declaration of the same name in a later scope.
        const own: BoxedDefinition =
          value !== undefined ? { value } : { operator: operator! };
        const binding = callableBindingInContext(node.engine, name, own);
        const resolved =
          binding === undefined
            ? undefined
            : 'value' in binding
              ? binding.value
              : binding.operator;
        const literal =
          binding === undefined
            ? undefined
            : 'value' in binding
              ? binding.value.value
              : (binding.operator as { _lambdaLiteral?: Expression })
                  ._lambdaLiteral;
        if (resolved !== undefined && isFunction(literal, 'Function')) {
          const ambient = lookupApplicable(
            name,
            node.engine.context.lexicalScope
          );
          const ambientHalf =
            ambient === undefined
              ? undefined
              : isValueDef(ambient)
                ? ambient.value
                : isOperatorDef(ambient)
                  ? ambient.operator
                  : undefined;
          if (ambientHalf !== resolved)
            throw new Error(
              `Could not compile \`${name}\`: the captured callable has a different binding from the ambient function.`
            );
        }
      }
    }
    if (!isFunction(node)) return;
    const binders = declaredBinders(node, 'post');
    node.ops.forEach((arg, i) => {
      const names = boundVariableNamesInOperand(node, i, binders);
      const inner = names.length === 0 ? bound : new Set([...bound, ...names]);
      // The bounds of a `Limits` clause and the collection of an
      // `Element` clause are outside the scope of the clause's own index
      // (`ownIndexClause()`, `binding-sites.ts`).
      const own = ownIndexClauseAt(node, i, binders);
      if (own !== undefined && isFunction(arg))
        arg.ops.forEach((child, j) =>
          walk(child, clauseOperandShadow(bound, inner, own, j) ?? inner)
        );
      else walk(arg, inner);
    });
  };
  walk(root, new Set());
}

/**
 * Decline when the body of a user function that the compiled code reaches
 * by name reads a free name that resolves, in the scope where the
 * compilation runs, to a definition other than the one the body is bound
 * to.
 *
 * The compiler resolves every name it reads by name, in the current scope
 * (`_getSymbolValue`, `lookupDefinition`). The interpreter reads the
 * definition that each symbol of the body was bound to where the function
 * was defined. With a global `a := 2` and `G := x ↦ x + a`, a compilation
 * of `G(x)` inside a scope that declares its own `a := 1000` read the inner
 * `a` and gave 1001 at x = 1, where the interpreter gives 3.
 *
 * A name is free in a body when no binder inside the body binds it (a
 * parameter, the index of a `Sum`) and the body does not declare or assign
 * it. A name that the caller maps through `vars`, a function or operator
 * that the caller replaces (`options.functions`, a record-form
 * `options.operators`), and a block-local function of this compilation,
 * are skipped: the compiler resolves them by its own rules, not through
 * the engine scope, and the emitted call of a replaced function never
 * reads the engine body. The bodies of the user functions that a body
 * calls are checked as well. CE-217.
 *
 * A body can share one subtree between several branches (a DAG). The walk
 * remembers each node with the set of names bound around it, by the
 * content of that set: every binder builds a new set object, so a key by
 * object identity would walk a shared subtree once for each path to it,
 * which grows exponentially with the depth of the nesting.
 */
export function assertUserFunctionFreeBindings(
  root: Expression,
  target: CompileTarget<Expression>
): void {
  const engine = root.engine;
  const scope = engine.context.lexicalScope;
  const skipped = (name: string): boolean =>
    isCompileBoundName(name) ||
    target.varsKeys?.has(name) === true ||
    target.foldExcludedOps?.has(name) === true ||
    blockLocalFunction(name, target) !== undefined;
  // The key of a set of bound names: the sorted names. It is computed
  // once for each set object.
  const boundKeys = new WeakMap<ReadonlySet<string>, string>();
  const boundKey = (bound: ReadonlySet<string>): string => {
    let key = boundKeys.get(bound);
    if (key === undefined) {
      key = JSON.stringify([...bound].sort());
      boundKeys.set(bound, key);
    }
    return key;
  };
  const visitedNames = new Set<string>();
  const pending: string[] = [];
  const reach = (name: string): void => {
    if (visitedNames.has(name) || skipped(name)) return;
    visitedNames.add(name);
    pending.push(name);
  };

  // The names the root reaches. The root itself is compiled in the
  // current scope, as the interpreter evaluates it, so its own bindings
  // are not compared.
  const rootSeen = new WeakSet<Expression>();
  const collect = (node: Expression): void => {
    if (rootSeen.has(node)) return;
    rootSeen.add(node);
    if (isSymbol(node)) reach(node.symbol);
    if (!isFunction(node)) return;
    reach(node.operator);
    for (const op of node.ops) collect(op);
  };
  collect(root);

  while (pending.length > 0) {
    const name = pending.pop()!;
    const literal = userFunctionLiteral(engine, name);
    const bodies =
      literal !== undefined
        ? [literal]
        : (multiClauseState(engine.lookupDefinition(name))?.clauses ?? []).map(
            (clause) => clause.literal
          );
    for (const body of bodies) {
      const local = assignedNamesIn(body);
      const seen = new WeakMap<Expression, Set<string>>();
      const walk = (node: Expression, bound: ReadonlySet<string>): void => {
        const key = boundKey(bound);
        const contexts = seen.get(node);
        if (contexts?.has(key)) return;
        if (contexts) contexts.add(key);
        else seen.set(node, new Set([key]));
        const free = isSymbol(node)
          ? node.symbol
          : isFunction(node)
            ? node.operator
            : undefined;
        if (free !== undefined && !bound.has(free) && !local.has(free)) {
          if (!skipped(free)) {
            const own = isSymbol(node)
              ? (node.valueDefinition ?? node.operatorDefinition)
              : node.operatorDefinition;
            const ambient = isSymbol(node)
              ? engine.lookupDefinition(free)
              : lookupApplicable(free, scope);
            const current = isValueDef(ambient)
              ? ambient.value
              : isOperatorDef(ambient)
                ? ambient.operator
                : undefined;
            // A definition that holds no value and no function (a
            // declaration with only a type or a signature) is skipped.
            // Its symbol stays symbolic in the interpreter, which no
            // compiled value matches anyway, and such a declaration is
            // how a temporary scope of the compiler gives a renamed call
            // its type, under a copy that holds the function
            // (`withShadowingCallsRenamed`, `shadowing-calls.ts`).
            const holds =
              own !== undefined &&
              ('value' in own
                ? own.value !== undefined
                : 'evaluate' in own &&
                  (own.evaluate !== undefined ||
                    (own as { _lambdaLiteral?: Expression })._lambdaLiteral !==
                      undefined));
            if (holds && own !== current)
              throw new Error(
                `Could not compile a call of \`${name}\`: its body reads ` +
                  `\`${free}\`, and \`${free}\` names a different ` +
                  `definition in the scope where the compilation runs ` +
                  `than in the scope where \`${name}\` is defined. The ` +
                  `interpreter reads the definition of \`${free}\` where ` +
                  `\`${name}\` is defined, and the compiled code would ` +
                  `read the other one.`
              );
          }
          reach(free);
        }
        if (!isFunction(node)) return;
        const binders = declaredBinders(node, 'post');
        node.ops.forEach((arg, i) => {
          const names = boundVariableNamesInOperand(node, i, binders);
          const inner =
            names.length === 0 ? bound : new Set([...bound, ...names]);
          const own = ownIndexClauseAt(node, i, binders);
          if (own !== undefined && isFunction(arg))
            arg.ops.forEach((child, j) =>
              walk(child, clauseOperandShadow(bound, inner, own, j) ?? inner)
            );
          else walk(arg, inner);
        });
      };
      walk(body, new Set());
    }
  }
}

/**
 * The lowering of `h(args)` when a collection operand can be ABSENT AS A
 * WHOLE, or `undefined` when the rule does not apply and the ordinary
 * lowering of the head runs.
 *
 * An operand typed `missing | C`, where `C` is a list or another indexed
 * collection (`gatedCollectionArms`), is a JavaScript array or the absent
 * value `undefined` at run time. Three sources give this type: a row read
 * of a list of lists whose length is not known (`At(x, 1)` with
 * `x: list<list<integer>>` is typed `list<integer> | missing`, because the
 * index can be past the end), a restricted list (`[1, 2, 3]{c}`), and a
 * symbol declared with a `missing` arm.
 *
 * The interpreter answers the absence marker of the application's codomain
 * when such an operand is absent, for every operator whose missing-value
 * behavior is `propagate` (the absence test in `BoxedFunction.evaluate`,
 * `absentScalarMarker` in `boxed-expression/validate.ts`): `Length` of an
 * absent list is `NaN`, `Reverse` of an absent list is `Missing`. The
 * collection lowerings of the target read an array (`.length`, `.slice()`,
 * a loop), so they refuse an operand whose type has a `missing` arm, and
 * `Length(At(x, 1))` did not compile.
 *
 * The lowering emitted here follows the interpreter's rule. Each operand
 * that can be absent is compiled once and bound to a temporary. When a
 * temporary holds the absent value, the result is the marker: the numeric
 * marker (`NaN`) when the application's type, without its `missing` arm, is
 * a number, and the absent object (`undefined`) otherwise. When every
 * temporary holds a collection, the result is the ordinary lowering of the
 * head, compiled with each of these operands replaced by a symbol that
 * carries the PRESENT type and reads the temporary. The present type has no
 * `missing` arm, so the rule does not apply again to the inner application.
 *
 *     Length(At(x, i))
 *       ⟶  ((_tv1) => (_tv1 === undefined) ? Number.NaN : _tv1.length)(…)
 *
 * An operator with its own `compile` handler (`ListFrom`) takes the rule
 * too: the handler lowers the inner application on the present collection.
 *
 * The rule does not apply in these cases:
 * - the target is not JavaScript. The other targets keep their existing
 *   decline: the lowering was verified against the interpreter on this
 *   target only.
 * - the head binds a variable (`Sum` with an indexing set, `Integrate`), or
 *   is a control-flow head. The operand is evaluated before the head here,
 *   which would move it out of the scope of the bound variable. The
 *   one-operand forms `Sum(xs)` and `Product(xs)` bind nothing and are
 *   admitted, although their missing-value behavior is not `propagate`:
 *   the interpreter answers `NaN` for the sum of an absent collection from
 *   the evaluate handler, and their array lowering returned a non-array
 *   operand unchanged, so the compiled sum of an absent collection was
 *   `undefined`.
 * - the operator is broadcastable. Its element-wise lowering already
 *   answers the absent value for an absent operand (`_SYS.bcastAbsent`).
 *
 * An operand that is not pure (a `Random` draw) is bound to a temporary
 * too, and tested for absence like a guarded one. The interpreter
 * evaluates every operand once, in order, before it tests for an absent
 * one, and the bindings are evaluated in operand order before the test,
 * so the effects run the same number of times and in the same order.
 */
export function absentCollectionOperandGuard(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (target.language !== 'javascript') return undefined;
  const absence = target.absence;
  if (absence?.object === undefined || target.bindExpr === undefined)
    return undefined;
  const reduction = (h === 'Sum' || h === 'Product') && args.length === 1;
  if (CONTROL_FLOW_HEADS.has(h) && !reduction) return undefined;
  const def = lookupApplicable(h, engine.context.lexicalScope);
  if (!isOperatorDef(def)) return undefined;
  const operator = def.operator;
  // An operator that handles a `missing` operand itself, or passes it
  // through (`First`, `Max`, `At`, `Mean`, `Flatten`), still reads an
  // absent WHOLE collection as an array (`undefined[0]`,
  // `undefined.length`, `undefined.flat()` throw), where the interpreter
  // has no value. For it, only an operand that is absent at run time
  // although its type has no `missing` arm (`mayBeAbsentCollection`:
  // `Take(xs, k)` with `k` unsupplied) is guarded.
  // Not an operator that discharges an absent value (`Coalesce`,
  // `IsMissing`, `AssertPresent`) or a lazy one (`If`, `Which`, `When`):
  // they read the operand themselves (`ABSENCE_DISCHARGING_HEADS`).
  const handles =
    (operator.resolvedMissingBehavior === 'handle' ||
      operator.resolvedMissingBehavior === 'pass-through') &&
    !operator.lazy &&
    !ABSENCE_DISCHARGING_HEADS.has(h);
  if (
    !reduction &&
    (operator.broadcastable ||
      (operator.resolvedMissingBehavior !== 'propagate' && !handles))
  )
    return undefined;
  // An operand is guarded when its type has a `missing` arm, or when it
  // is a checked call of a user function with a collection result
  // (`checkedCallMayBeAbsent`), or another operand that can be the absent
  // collection at run time (`mayBeAbsentCollection`): the checking shim
  // gives `undefined` when
  // an argument fails its test, while the type of the call is the
  // collection type.
  const presentArms = args.map((a) =>
    _codeOverrides.has(a) ? undefined : gatedCollectionArms(a)
  );
  const checkedCalls = args.map(
    (a, i) =>
      presentArms[i] === undefined &&
      !core.hasCodeOverride(a) &&
      mayBeAbsentCollection(engine, a, target)
  );
  const guarded = args.map((_a, i) =>
    handles && !reduction
      ? checkedCalls[i]
      : (reduction || operator.stripsMissingAt(i)) &&
        (presentArms[i] !== undefined || checkedCalls[i])
  );
  if (!guarded.some((x) => x)) return undefined;
  // An impure operand that is not guarded is bound too (see above). A
  // node with a code override is emitted as its override and is not bound.
  const bound = args.map(
    (a, i) => guarded[i] || (a.isPure !== true && !core.hasCodeOverride(a))
  );
  // An impure node that is used at two positions is read through a copy of
  // the node at each later position (below). Only a function application
  // can be copied.
  if (
    args.some(
      (a, i) =>
        bound[i] &&
        !(guarded[i] && !checkedCalls[i]) &&
        a.isPure !== true &&
        args.indexOf(a) !== i &&
        !isFunction(a)
    )
  )
    return undefined;
  const application = node ?? engine._fn(h, [...args]);
  if (declaredBinders(application, 'post') !== undefined) return undefined;

  // The marker of the application's codomain, as `absentScalarMarker`
  // decides it: the numeric marker when the type, without its `missing`
  // arm, is a number. A type with nothing but the `missing` arm says nothing
  // about the codomain, and the declared result of the operator is read
  // instead.
  const present = stripMissingFromType(
    resolveTypeForCompilation(application.type.type)
  );
  const codomain =
    present === 'never'
      ? (functionResult(operator.signature.type) ?? 'unknown')
      : present;
  // The sum or the product of an absent collection is `NaN` in the
  // interpreter (the evaluate handler answers it), whatever the type: a
  // collection whose elements may be rows sums to a row
  // (`number | vector<2>`), and its absent value still sums to `NaN`.
  const marker =
    reduction || (codomain !== 'never' && isSubtype(codomain, 'number'))
      ? absence.numeric.make()
      : absence.object.nullLiteral;

  const names: string[] = [];
  const bindings: Array<[string, TargetSource]> = [];
  // A checked call, and an impure operand that is not guarded, keep their
  // node, read through an alias of the temporary (`_codeAliases`): the
  // type of the node is already the present type, and the analyses of the
  // node (the element lane of a recursive call, for example) must still
  // read it as they do without the guard. The aliases are installed only
  // after every initializer has compiled, so that no initializer reads a
  // temporary of the binding (the arguments of the binding cannot see its
  // parameters), and they are removed on every exit, a failed compilation
  // included: a node left in `_codeAliases` would compile to an unbound
  // temporary at its next use.
  //
  // A node that occurs at two positions: when it is pure, it is bound
  // once, and both operands read its temporary. When it is impure, each
  // position has its own binding, evaluated in operand order as the
  // interpreter evaluates each operand, and each later position reads a
  // copy of the node aliased to its own temporary (an alias is keyed by
  // the node, so one node cannot read two temporaries).
  const aliases = new Map<Expression, string>();
  const presentArgs = args.map((a, i) => {
    if (!bound[i]) return a;
    const aliasedNode = !guarded[i] || checkedCalls[i];
    if (aliasedNode && aliases.has(a) && a.isPure === true) return a;
    const name = tempVar(target);
    names.push(name);
    bindings.push([name, compileValueOperand(a, target)]);
    if (aliasedNode) {
      const operand =
        aliases.has(a) && isFunction(a)
          ? engine._fn(a.operator, [...a.ops])
          : a;
      aliases.set(operand, name);
      return operand;
    }
    const arms = presentArms[i]!;
    return typedTemp(
      engine,
      name,
      arms.length === 1 ? arms[0] : { kind: 'union', types: arms }
    );
  });
  // The temporaries are parameters of the binding emitted below, so they
  // are read by their own names, not as keys of the variables object.
  const inner: CompileTarget<Expression> = {
    ...target,
    var: (id) => (names.includes(id) ? id : target.var(id)),
    ...withBoundScope(target, names),
  };
  let body: TargetSource;
  const previous = new Map<Expression, string | undefined>();
  try {
    for (const [a, name] of aliases) {
      previous.set(a, _codeAliases.get(a));
      _codeAliases.set(a, name);
    }
    body = core.compile(engine._fn(h, presentArgs), inner);
  } finally {
    for (const [a, old] of previous) {
      if (old === undefined) _codeAliases.delete(a);
      else _codeAliases.set(a, old);
    }
  }
  const absent = names.map((n) => absence.object!.isAbsent(n)).join(' || ');
  return target.bindExpr(bindings, `(${absent} ? ${marker} : ${body})`);
}

/**
 * The evaluated VALUE of a constant subtree, behind every fold gate except
 * the target's `constantFold` opt-out — shared by `tryConstantFold` (the
 * emission entry, which respects the opt-out) and by the shape analyses
 * (`isProvablyRealValued`), which need the runtime value's shape whether or
 * not the caller wants folded output. `elements` is the materialized
 * element list when the value is a foldable constant COLLECTION (see
 * `foldableCollectionElements`), computed inside the evaluation budget
 * since walking a lazy collection is real work.
 *
 * Every OTHER gate applies unchanged — in particular `symbolDeps` (an
 * implicit-compilation caller's capture set cannot record the engine state
 * an evaluation reads, and an analysis answer bakes into the cached kernel
 * just as folded code does) and the purity/unknowns/cost gates.
 */
/**
 * The start of the passes that a target runs on an expression BEFORE it
 * calls `compile()` on it (the GPU inlining of point calls, of
 * collection-valued calls and of shared calls). Called only for an
 * outermost compilation (`_compileDepth` 0); a pass that runs while a
 * compilation is in progress does nothing here.
 *
 * - The memos are emptied, as `compile()` empties them when it starts
 *   and ends. A pass that throws (the inlining budget, the size limit)
 *   ends the compilation before `compile()` runs, and the memos that the
 *   pass filled would otherwise be read by the next compilation, made
 *   with other engine values (`r` recorded as pure, then `r := Random()`).
 * - The definitions that the calls of `expr` captured are checked, as
 *   `compile()` checks them (`assertCapturedCallableBindings`,
 *   `assertUserFunctionFreeBindings`). The passes replace a call by the
 *   body of its function, and the check of `compile()` then no longer
 *   sees the call: with `f(t) := t·P` defined where `P` is `(1, 2)`, and a
 *   scope that declares another `P`, the inlined body read the inner `P`.
 */
export function beginRootPreprocessing(
  expr: Expression,
  target: CompileTarget<Expression>
): void {
  if (CompilerState._compileDepth !== 0) return;
  resetCompilationMemos();
  assertCapturedCallableBindings(expr, target);
  assertUserFunctionFreeBindings(expr, target);
}

/**
 * The body of the block-local function `literal` (named `h`) with the
 * arguments `args` in place of its parameters, for a call that cannot go
 * through the compiled function (`tryCompileLocalFunctionCall`). The
 * caller compiles the result in place of the call.
 *
 * `undefined` when the call cannot be written this way: a parameter is a
 * rest or destructuring parameter, or an argument is not made only of
 * symbols, numbers and pure expressions with no symbols (an argument
 * written several times in the body must not be evaluated several times). The compilation is declined, with the
 * reason, when the body binds the name of a parameter or of a symbol of an
 * argument, which would capture it, and when a binder that encloses the
 * call binds a name that the body reads.
 */
export function bodyWithArguments(
  h: string,
  literal: Expression & FunctionInterface,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Expression | undefined {
  const params = literal.ops.slice(1);
  if (
    params.length !== args.length ||
    params.some((p) => isRestParameter(p) || isDestructuringParameter(p))
  )
    return undefined;
  // A pure expression with no symbols (`Sin(1)`) gives the same value
  // each time it is evaluated, so it can be written several times.
  const simple = (x: Expression): boolean =>
    isSymbol(x) ||
    isNumber(x) ||
    (x.isPure && x.symbols.length === 0) ||
    ((isFunction(x, 'List') || isFunction(x, 'Tuple')) && x.ops.every(simple));
  if (!args.every(simple)) return undefined;
  const substitutions: Record<string, Expression> = {};
  for (const [i, p] of params.entries()) {
    const name = functionLiteralParameterName(p);
    if (!name) return undefined;
    substitutions[name] = args[i];
  }
  const reason =
    `Could not compile \`${h}\`: the call is written with the body of the ` +
    `function, `;
  // `subs` does not avoid capture (see the same check in
  // `wholeTupleCall`).
  const body = literal.op1;
  const statements = isFunction(body, 'Block') ? body.ops : [body];
  const binders = new Set<string>();
  for (const s of statements) {
    collectBinderNames(s, binders);
    if (
      (isFunction(s, 'Declare') || isFunction(s, 'Assign')) &&
      isSymbol(s.op1)
    )
      binders.add(s.op1.symbol);
  }
  if (isFunction(body, 'Block'))
    for (const n of boundVariableNames(body))
      if (!(n in substitutions)) binders.add(n);
  for (const [param, arg] of Object.entries(substitutions)) {
    const captured = binders.has(param)
      ? param
      : arg.symbols.find((x) => binders.has(x));
    if (captured !== undefined)
      throw new Error(
        `${reason}and the body binds \`${captured}\`, which is the name ` +
          `of a parameter or of a symbol of an argument.`
      );
  }
  const captured = [...freeSymbolNames(literal)].find(
    (n) => n !== h && target.boundVars?.has(n) === true
  );
  if (captured !== undefined)
    throw new Error(
      `${reason}which reads \`${captured}\`, and a binding at the call ` +
        `can be a different \`${captured}\`.`
    );
  return body.subs(substitutions);
}

/**
 * A call `h(…args)` of a user function, or `Apply(literal, …args)`, with a
 * TUPLE argument at a parameter declared as a scalar, written as the
 * tuple of the calls at each component. The interpreter maps such a call
 * over the components (`declaredScalarTupleCells`,
 * `boxed-expression/boxed-function.ts`, user decision 2026-10-03):
 * `Apply((u: real) ↦ 7, (a, b))` is `(7, 7)`. Each target then compiles
 * the tuple with its own lowering: an array in JavaScript, an array of
 * enclosures on the interval target, a `vecN` on a shader. A component
 * that is itself a tuple maps again when its call is compiled.
 *
 * A list LITERAL of tuples at such a parameter is written as the list of
 * the calls at each tuple, so that each tuple maps too.
 *
 * `undefined` when no such argument is a tuple (or a list literal of
 * tuples). The compilation is declined, with the reason, when the
 * tuple has no static length, when two tuples have different lengths
 * (the interpreter gives an `incompatible-dimensions` error), when a
 * component is a list (an `incompatible-type` error), when another
 * argument is a collection and the function maps over a list (the
 * interpreter maps the call over its cells first; a list at a collection
 * parameter is bound whole in each cell instead), or when the tuple is
 * neither a `Tuple` literal nor a symbol
 * (its components cannot be read without computing it again for each
 * one).
 *
 * When `mappedArgs` is given, it receives the index in `args` of each
 * argument that the rewrite maps over: a tuple at a scalar parameter, or
 * the list literal of tuples. The rewrite reads each part of such an
 * argument once. It writes every other argument whole into each
 * component call.
 */
export function declaredScalarTupleCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  mappedArgs?: Set<number>
): Expression | undefined {
  let literal: Expression | undefined;
  let declared: Type | undefined;
  let callArgs: ReadonlyArray<Expression> = args;
  let call: (cell: Expression[]) => Expression;
  let name: string;
  // A block-local function `h` shadows an engine-level function with the
  // same name, so its own literal gives the parameter types. It has no
  // declared signature.
  const local = h === 'Apply' ? undefined : blockLocalFunction(h, target);
  if (local === null) return undefined;
  if (h === 'Apply') {
    const fn = args[0];
    if (!isFunction(fn, 'Function')) return undefined;
    literal = fn;
    callArgs = args.slice(1);
    call = (cell) => engine.function('Apply', [fn, ...cell]);
    name = '`Apply`';
  } else {
    literal = local ?? userFunctionLiteral(engine, h);
    if (literal === undefined) return undefined;
    declared =
      local === undefined ? declaredUserSignature(engine, h) : undefined;
    // In the current scope, `engine.function()` checks the arguments
    // against the ENGINE-level definition of `h`, and declares `h` in the
    // engine when it has no definition. A block local is not that
    // function: with an engine-level `h: (string) -> number`, each
    // component of the call of the local `(u: real) ↦ 2u` became an
    // `incompatible-type` error. Thus the component call of a block local
    // is boxed in a new scope whose parent is the scope that defines the
    // local (the lexical parent of its body). There, `h` is the local, and
    // a declaration made while boxing goes into the new scope, not into
    // the engine. The compilation of the call reads the local
    // (`tryCompileLocalFunctionCall`).
    const parent = local?.op1.localScope?.parent;
    call =
      parent === undefined || parent === null
        ? (cell) => engine.function(h, cell)
        : (cell) => {
            engine.pushScope({ parent, bindings: new Map() });
            try {
              return engine.function(h, cell);
            } finally {
              engine.popScope();
            }
          };
    name = `a call of \`${h}\``;
  }
  const isScalarParam = declaredScalarParams(literal, declared);
  if (isScalarParam === undefined) return undefined;
  // Whether the function maps over a list argument (all its parameters are
  // scalars). When it does not, a list argument is bound whole in each
  // cell of the tuple map.
  const listsMap =
    h === 'Apply' || local !== undefined
      ? paramsAreScalar(literal.type.type)
      : userFunctionParamsAreScalar(engine, h);
  const tupleTypeOf = (x: Expression) => {
    const t = resolveTypeAlias(x.type.type);
    return typeof t === 'object' && t.kind === 'tuple' ? t : undefined;
  };
  const decline = (why: string): never => {
    throw new Error(`Could not compile ${name}: ${why}`);
  };
  const isListOfTuples = (x: Expression) =>
    isFunction(x, 'List') &&
    x.nops > 0 &&
    x.ops.every((e) => tupleTypeOf(e) !== undefined || isFunction(e, 'Tuple'));
  const isOtherCollection = (x: Expression) =>
    tupleTypeOf(x) === undefined &&
    !isTupleShapedType(resolveTypeAlias(x.type.type)) &&
    (x.isCollection === true || x.type.matches('collection<any>'));

  // A list literal of tuples: the list of the calls at each tuple.
  const listAt = callArgs.findIndex(
    (x, i) => listsMap && isScalarParam(i) && isListOfTuples(x)
  );
  if (listAt >= 0) {
    if (callArgs.some((x, i) => i !== listAt && isOtherCollection(x)))
      return undefined;
    const list = callArgs[listAt];
    if (!isFunction(list, 'List')) return undefined;
    mappedArgs?.add(listAt + args.length - callArgs.length);
    return engine.function(
      'List',
      list.ops.map((e) => call(callArgs.map((x, i) => (i === listAt ? e : x))))
    );
  }

  // A list of tuples that is not a literal (a symbol), the one argument of
  // a function assigned with no declaration (an operator definition): the
  // map `Map(x ↦ h(x), list)`, whose element call maps over the tuple as
  // above. The JavaScript target refused the call `h(list)` itself as a
  // broadcast over a possibly list-valued operand. A function held as a
  // value and `Apply` already compile such a call.
  if (
    h !== 'Apply' &&
    local === undefined &&
    listsMap &&
    callArgs.length === 1 &&
    isScalarParam(0) &&
    !isFunction(callArgs[0], 'List') &&
    isOperatorDef(engine.lookupDefinition(h)!)
  ) {
    const arg = callArgs[0];
    const t = resolveTypeAlias(arg.type.type);
    if (
      typeof t === 'object' &&
      t.kind === 'list' &&
      isTupleShapedType(resolveTypeAlias(t.elements))
    ) {
      let element = '_point';
      while (arg.symbols.includes(element)) element = `_${element}`;
      // The argument is kept boxed: boxed again from MathJSON, a symbol
      // named `e`, `i` or `Pi` would read as the constant of that name.
      return engine.box([
        'Map',
        ['Function', [h, element], element],
        arg,
      ] as never);
    }
  }

  const mapped = callArgs.map(
    (x, i) =>
      isScalarParam(i) &&
      (tupleTypeOf(x) !== undefined || isFunction(x, 'Tuple'))
  );
  if (!mapped.some((m) => m)) return undefined;
  if (listsMap && callArgs.some((x, i) => !mapped[i] && isOtherCollection(x)))
    decline(
      'a tuple argument maps over its components at a parameter ' +
        'declared as a scalar, and another argument is a collection.'
    );
  let length: number | undefined;
  const components: (Expression[] | undefined)[] = callArgs.map((x, i) => {
    if (!mapped[i]) return undefined;
    const n = isFunction(x, 'Tuple')
      ? x.nops
      : (tupleTypeOf(x)?.elements.length ?? 0);
    if (length === undefined) length = n;
    else if (n !== length)
      decline(
        `the tuple arguments have different lengths (${length} and ` +
          `${n}). The interpreter gives an \`incompatible-dimensions\` ` +
          `error for this application.`
      );
    const parts = isFunction(x, 'Tuple')
      ? [...x.ops]
      : isSymbol(x)
        ? Array.from({ length: n }, (_, k) =>
            engine.function('At', [x, engine.number(k + 1)])
          )
        : decline(
            `the tuple argument \`${x.toString()}\` maps over its ` +
              `components, and its components cannot be read without ` +
              `computing it again for each one.`
          );
    for (const c of parts) {
      const t = resolveTypeAlias(c.type.type);
      if (
        !isTupleShapedType(t) &&
        (c.isCollection === true || c.type.matches('collection<any>'))
      )
        decline(
          `the tuple argument \`${x.toString()}\` has a component that ` +
            `is a collection. The interpreter gives an ` +
            `\`incompatible-type\` error for this application.`
        );
    }
    return parts;
  });
  if (length === undefined || length === 0) return undefined;
  mapped.forEach((m, i) => {
    if (m) mappedArgs?.add(i + args.length - callArgs.length);
  });
  return engine.function(
    'Tuple',
    Array.from({ length }, (_, k) =>
      call(callArgs.map((x, i) => components[i]?.[k] ?? x))
    )
  );
}

/**
 * The emitted name of a helper that a target adds to the registry beside
 * the user functions (for example the element-wise wrapper of a shader
 * call). The name comes from the same allocator as the user functions, so
 * it never collides with another emitted definition or with a name the
 * expression uses. `key` must not be the id of a user function: build it
 * from the function id and a separator that no symbol name contains (`#`).
 */
export function registryHelperName(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  key: string
): string {
  return registryLocalName(registry, '_fn_', key);
}

/**
 * STRICT discipline (design §3, "user-function VALUE position" row): a
 * bare user-function symbol `callback` used as an ELEMENT callback over a
 * `source` whose elements are complex scalars, when the function's single
 * parameter is WIDE, is a `LaneMismatch` decline — the value-position
 * emission is the one real-shaped `_fn_f`, and complex elements would be
 * consumed as numbers. Under `auto` the engine-level `compile()` escalates
 * this to complex mode, where the one emission lifts its parameter at use.
 * A parameter DECLARED complex is not a mismatch (the call coerces into
 * it). No-op outside the strict-shaped disciplines, or when `callback` is
 * not a unary user function.
 */
export function assertCallbackLaneMatch(
  callback: Expression | undefined,
  source: Expression | undefined
): void {
  if (!strictLanes()) return;
  if (callback === undefined || source === undefined) return;
  if (!isSymbol(callback)) return;
  const engine = callback.engine;
  const literal = userFunctionLiteral(engine, callback.symbol);
  if (literal === undefined || literal.ops.length !== 2) return;
  if (!hasUniformComplexScalarElements(source)) return;
  // `laneRequestParamType`, not the raw param type — see its comment.
  const pt = laneRequestParamType(engine, callback.symbol, 0);
  if (pt === undefined || !isNonRealNumber(pt))
    laneMismatch(
      'user-function value position',
      userParamBinding(callback.symbol, literal, 0),
      source
    );
}

/**
 * The complex-lane eta-expansion of a bare BUILT-IN operator symbol used as
 * a unary ELEMENT callback over a `source` whose elements are complex
 * scalars — `(x: complex) ↦ Abs(x)` for `Map(Abs, zs)` — or `undefined`
 * when nothing needs to change.
 *
 * Without it the built-in reference took the shared value-position
 * emission, whose synthesized parameter carries no type and is therefore
 * compiled in the REAL lane: `const _fn_Abs = (_tv1) => Math.abs(_tv1)`
 * received the `{ re, im }` element and answered `NaN` behind
 * `success: true`, where the interpreter answers 5. Compiling an annotated
 * literal instead routes the body through the same per-application
 * parameter typing an INLINE `x ↦ Abs(x)` callback already gets, so the
 * emitted body is `_SYS.cabs(x)` and the compiled value matches the
 * interpreter. This mirrors what `combinerPlan` does for the
 * accumulator/element pair of a `Reduce`-shaped callback.
 *
 * Restricted to a callback the engine can expand at a FIXED unary arity
 * (`builtinCallbackArity`): a user definition shadowing the name takes the
 * user-function route (and its own `assertCallbackLaneMatch` decline), and
 * a variadic or optional-tail operator has no single wrapper arity and is
 * already refused.
 *
 * A source whose element type is merely `number` is NOT rewritten. `number`
 * is a supertype of both the real and the complex numbers, so no static
 * classification is possible; annotating the parameter `complex` there
 * would force every element into the `{ re, im }` encoding and change the
 * RESULT shape of the ordinary real case, and declining would send every
 * `number`-typed source to the interpreter. Such a source keeps the real
 * lane — the same posture an inline `x ↦ Abs(x)` callback and a direct
 * `Abs(n)` on a `number`-typed operand already take.
 */
export function complexElementCallbackEta(
  callback: Expression | undefined,
  source: Expression | undefined
): Expression | undefined {
  if (callback === undefined || source === undefined) return undefined;
  if (!isSymbol(callback)) return undefined;
  const engine = callback.engine;
  if (builtinCallbackArity(engine, callback.symbol) !== 1) return undefined;
  if (!hasUniformComplexScalarElements(source)) return undefined;

  // Annotate with the source's own element type when that type is itself
  // provably non-real, so a narrower spelling (`imaginary`) survives; the
  // uniform-elements evidence that admitted a looser type says `complex`.
  const eltType = collectionElementTypeOf(source);
  const eltTypeText =
    eltType !== undefined && isNonRealNumber(eltType)
      ? typeToString(eltType)
      : 'complex';
  const x = engine.symbol('_x');
  const eta = engine.function('Function', [
    engine.function(callback.symbol, [x]),
    engine.function('Typed', [x, engine.box({ str: eltTypeText })]),
  ]);
  // A built-in whose canonicalization refuses a complex argument would
  // yield an error body: leave the previous route alone rather than emit it.
  if (!isFunction(eta, 'Function') || !eta.isValid) return undefined;
  return eta;
}

/**
 * Fail closed when `callback` is a single-uppercase-letter symbol that
 * names a built-in OPERATOR the engine cannot eta-expand (`D`).
 *
 * `isRefusableBuiltinCallback` deliberately exempts single-uppercase names,
 * because an UN-APPLIED one reads as a caller-supplied variable by
 * convention — the `D` of `\int D x^2 dx` is a coefficient, not a broken
 * callback. That exemption is right for a free-symbol position and wrong
 * here: a CALLBACK operand is applied, so `Map(D, xs)` emitted the
 * free-symbol read `_.D` and threw `_f is not a function` at run time. The
 * refusal is therefore position-aware — it lives at the callback splice,
 * not in the shared value-position predicate.
 *
 * A caller symbol that merely happens to be named `D` is untouched:
 * `builtinOperatorDefinition` answers `undefined` for any binding that is
 * not the engine's own system-scope operator record, so a declared variable
 * or an assigned function literal keeps its route. A caller who genuinely
 * wants to supply `D` through the vars object declares it first.
 */
export function assertBuiltinCallbackUsable(
  kind: string,
  callback: Expression | undefined
): void {
  if (callback === undefined || !isSymbol(callback)) return;
  const s = callback.symbol;
  if (!/^[A-Z]$/.test(s)) return;
  const engine = callback.engine;
  if (builtinOperatorDefinition(engine, s) === undefined) return;
  // An expandable arity takes the eta-expansion route, which emits a real
  // function value (and declines on its own if the body has no lowering).
  if (builtinCallbackArity(engine, s) !== undefined) return;
  throw new Error(
    `Could not compile \`${kind}\`: the built-in operator '${s}' has no fixed arity, so it ` +
      `cannot be used as a callback value — the artifact would read '${s}' ` +
      `from the vars object and throw at run time. Declare '${s}' as a ` +
      `variable if it names caller-supplied data.`
  );
}

/**
 * Fail closed on a call of the user function `h` whose number of arguments
 * does not match the parameters of its literal. The interpreter answers
 * such a call with a value that the compiled call cannot reproduce: with
 * fewer arguments than parameters it makes a partial application, whose
 * value is a function (`a(3, 4)` for `a := (x, y, z) ↦ x + y + z` is
 * `(_) => _ + 7`), and with more arguments it answers an error
 * (`a(1, 2, 3, 4)` is `Error("unexpected-argument", "4")`). The compiled
 * call passed `undefined` for each missing argument and computed `NaN`, or
 * ignored the extra arguments and computed `6`. The arity is known when the
 * call is compiled, so the call declines and the interpreter answers it.
 *
 * The rules are the interpreter's (`makeLambda`, `function-utils.ts`): a
 * REST parameter (`(a, ...r) ↦ …`) takes any number of arguments after the
 * fixed parameters before it, so only a call with fewer arguments than
 * those fixed parameters is a mismatch; and a literal with NO parameter
 * ignores its arguments, so any call of it is accepted. A multi-clause
 * function (no single literal) is not checked here.
 */
export function checkUserCallArity(
  h: string,
  literal: (Expression & FunctionInterface) | undefined,
  args: ReadonlyArray<Expression>
): void {
  if (literal === undefined) return;
  const params = literal.ops.slice(1);
  if (params.length === 0) return;
  const rest = params.findIndex((p) => isRestParameter(p));
  const fixed = rest < 0 ? params.length : rest;
  if (args.length < fixed)
    throw new Error(
      `Could not compile a call of \`${h}\`: the function is declared with ` +
        `${fixed} parameter${fixed === 1 ? '' : 's'} but called with ` +
        `${args.length}. The interpreter reads a call with fewer arguments ` +
        `than parameters as a partial application, whose value is a ` +
        `function, and the compiled call does not build that value.`
    );
  if (rest < 0 && args.length > fixed)
    throw new Error(
      `Could not compile a call of \`${h}\`: the function is declared with ` +
        `${fixed} parameter${fixed === 1 ? '' : 's'} but called with ` +
        `${args.length}. The interpreter reports an error for a call with ` +
        `more arguments than parameters.`
    );
}

/**
 * If head `h` names a user-defined function (see `userFunctionLiteral`),
 * ensure its definition is emitted once into `target.userFunctions.defs` as a
 * named local function and return the call-site source `_fn_h(arg, …)`.
 * Returns `undefined` when `h` is a genuinely unknown operator (no such
 * definition — the caller then throws), or when the target opts out of user
 * functions by not providing a `userFunctions` registry.
 *
 * Recursion (including mutual recursion) compiles to true self/cross
 * reference by emitted name: while a definition's body is being compiled its
 * name sits in `compiling`, and a re-entrant reference emits a call to that
 * name rather than re-emitting (or looping on) the definition. Termination
 * is not guaranteed by the emitted code — runaway recursion surfaces as the
 * host's stack-exhaustion error (a catchable `RangeError` in JS), matching
 * the contract of compiled unbounded `Loop`.
 *
 * Capture semantics: the body is compiled once, at compile time, through the
 * *same* `target` var/fold rules as the surrounding expression (only the
 * parameters are shadowed). Free symbols and constants the body references are
 * therefore snapshotted exactly like the constant-baking `tryFoldKnownSymbol`
 * performs elsewhere — a later reassignment of a captured outer symbol does
 * not affect an already-compiled function.
 */
export function tryCompileUserFunction(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The call node itself, when the caller has it. A repetition site that
   * hoisted an invariant prefix of the callee out of the repetitions keys
   * its rewrite on this node (`_prefixCallOverrides`); without it the call
   * compiles as the ordinary call. */
  node?: Expression
): TargetSource | undefined {
  // The callee's `Function` literal, when it has a single one (a
  // multi-clause function does not). Read once here: the arity check just
  // below, the strict-lane gate and the generic broadcast decision at the
  // end all need it.
  const literal = userFunctionLiteral(engine, h);
  checkUserCallArity(h, literal, args);

  // A list of points at a parameter declared as a point maps over the
  // points, as the interpreter does (`pointListParamSlots`).
  const pointList = tryCompilePointListCall(engine, h, args, target);
  if (pointList !== undefined) return pointList;
  checkListCoordinateTupleArgs(engine, h, args);
  checkPointListAtMatrixUnionArgs(engine, h, args);
  checkPointParamCollectionUnionArgs(engine, h, args);
  checkScalarListAtContractPointParam(engine, h, args);

  // Fail closed BEFORE emission: whether the callee can be emitted at
  // all is irrelevant to whether an emitted call would be sound, and the
  // caller's generic "no lowering" message hides the real reason.
  checkDeclaredBroadcast(engine, h, args, provablyScalarArg, target);

  // The complex lanes are a JavaScript-convention matter (`{re, im}`
  // objects flowing through parameters). A target with its own definition
  // lowering (the shader targets) synthesizes a STATIC signature from the
  // declared parameter types and checks the call's argument shapes against
  // it, so a complex argument to a real-typed parameter fails closed there
  // rather than needing a specialization; hand those targets the real lane.
  // STRICT discipline (design §3, "user-function parameter" row): a
  // complex-shaped scalar argument bound to a parameter the function does
  // not declare complex is a LaneMismatch DECLINE — the body was shaped
  // real for that parameter, and neither a per-call-site specialization
  // nor a real-lane emission is the strict answer (`auto` escalates it to
  // complex mode). Checked before emission, like the broadcast gate above:
  // whether the callee can be emitted is irrelevant to whether this call
  // is sound. A target with its own definition lowering (the shader
  // targets) checks the argument shapes against its static signature.
  if (strictLanes() && !target.userFunctions?.lowering) {
    if (literal !== undefined) {
      const i = laneMismatchAt(engine, h, literal, args);
      if (i >= 0)
        laneMismatch(
          'user-function parameter',
          userParamBinding(h, literal, i),
          args[i]
        );
    } else {
      // A multi-clause function (no single literal): each clause's
      // parameter is a binding of its own. A complex-shaped scalar argument
      // at a position where some clause's parameter is WIDE — a type that
      // admits the value at dispatch (its JS guard accepts a `{re, im}`)
      // while its body was shaped real — is the same mismatch. A clause
      // parameter typed real-only rejects the value at dispatch (faithful),
      // and one typed complex is coerced per clause in the dispatcher.
      const i = multiClauseLaneMismatchAt(engine, h, args);
      if (i >= 0)
        laneMismatch(
          'multi-clause clause parameter',
          `parameter ${i + 1} of the multi-clause function \`${h}\``,
          args[i]
        );
    }
  }
  // A point argument with a complex-shaped coordinate — `(x / 1, y / √(1 −
  // e²))`, where the second coordinate lowers through the complex kernels
  // — cannot reach an emitted definition: the definition reads a point
  // parameter's coordinates as plain numbers in every discipline (`V[1]`,
  // `_SYS.pow2`), so a `{re, im}` coordinate computes `NaN` there, behind
  // `success: true`. The call is inlined instead, which reads each
  // coordinate at its own lane (`PointY(PointList(a, b))` folds to `b`);
  // when it cannot be inlined, the call fails closed. Measured on the
  // Tycho corpus (`neyret/hpr2q4kles`, 2026-09-15): `P_0` answered `NaN`
  // where the interpreter answers 1.024. A target with its own definition
  // lowering (the shader targets) synthesizes a static signature and checks
  // its argument shapes itself, as the strict lane check above leaves it
  // to; the gate is JavaScript's.
  if (literal !== undefined && !target.userFunctions?.lowering) {
    const at = complexCoordinateArgumentAt(engine, args, target);
    if (at >= 0) {
      // The arguments are handed to the substitution as they are: an
      // inlined helper leaves its point wrapped in a return-type
      // ascription (`Typed(PointList(…), '…')`), which the substitution
      // does not read through, so such a call declines. Removing the
      // wrapper here was measured to be unsound: the inlined body then
      // emits a complex-shaped value where the enclosing arithmetic had
      // analyzed the CALL node as real (its declared result type), and
      // `-0.39 + {re, im}` concatenated a string at run time.
      const inlined = tryInlineUserFunctionCall(engine, h, args, target);
      if (inlined !== undefined) return inlined;
      throw new Error(
        `Could not compile a call of \`${h}\`: argument ${at + 1} is a point ` +
          `with a complex-valued coordinate, and the emitted definition ` +
          `reads a point parameter's coordinates as real numbers, so it ` +
          `would compute a different value than the interpreter does. The ` +
          `call could not be inlined instead.`
      );
    }
  }

  // An argument whose type, or element type, cannot match the declared type
  // of its parameter (`u: real` given the point `(a, b)`) is declined, as
  // the `Apply` of a function literal is: in a strict engine the
  // interpreter gives an `incompatible-type` error for this call, while the
  // emitted code gives a value (a specialization that maps over the
  // point, or a scalar body that computes `NaN` from the array of the
  // point).
  if (literal !== undefined) {
    const mismatch = appliedArgumentTypeMismatch(
      literal,
      args,
      userFunctionParamsAreScalar(engine, h)
    );
    if (mismatch !== undefined)
      throw new Error(`Could not compile a call of \`${h}\`: ${mismatch}`);
  }

  // An argument whose static type does not prove the declared type of its
  // parameter is tested at run time where the target has a test
  // (`declaredParameterCheck`): on JavaScript by the checking shim of the
  // function (`checkingShimName`), on the interval target by
  // `_IA.checkedCall`. Where the target has no test for a type that admits
  // only some real numbers (`integer`, `real<0..>`, `rational`), the
  // compilation fails: the interpreter gives an `incompatible-type` error
  // for a value outside the type, and the compiled call would give a value.
  const intervalChecks = args.map((a, i) => {
    const declared = userFunctionParamType(engine, h, i);
    const check = declaredParameterCheck(declared, a, target);
    if (check === 'refuse')
      throw uncheckedParameterError(
        h,
        (literal === undefined
          ? ''
          : functionLiteralParameterName(literal.ops[i + 1])) || `#${i + 1}`,
        declared!,
        a,
        target
      );
    return check === 'guard' &&
      declared !== undefined &&
      target.language === 'interval-javascript'
      ? [declared]
      : [];
  });

  // A LIST OF POINTS at a parameter with no declared type, whose type the
  // engine inferred from the body as one point (`g := p ↦ h(p)`, with `h`
  // taking a point). The interpreter binds the list whole and runs the
  // body with it, so the call of `h` maps over the points. The emitted
  // definition of `g` was compiled for one point, and the call answered
  // the string "1,21" for `g([(1, 2), (3, 4)])`. The call is inlined
  // instead, which compiles the body with the list in place of the
  // parameter; when it cannot be inlined, the call fails closed. CE-238.
  const listAt =
    literal === undefined
      ? -1
      : args.findIndex((a, i) => {
          if (isTuple(a)) return false;
          if (functionLiteralParameterType(literal.ops[i + 1]) !== undefined)
            return false;
          const declared = userFunctionParamType(engine, h, i);
          if (
            declared !== undefined &&
            declared !== 'unknown' &&
            declared !== 'any'
          )
            return false;
          const inferred = signatureParamType(literal.type.type, i);
          return (
            inferred !== undefined &&
            isPointListArgumentType(a.type.type, inferred)
          );
        });
  if (listAt >= 0) {
    // The list is substituted whole: a symbol is read once per use and a
    // list literal of points is pure, so neither is evaluated twice in a
    // way that changes a value.
    const inlined = tryInlineUserFunctionCall(
      engine,
      h,
      args,
      target,
      (a) => a === args[listAt] && a.isPure === true
    );
    if (inlined !== undefined) return inlined;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${listAt + 1} is a ` +
        `list of points at a parameter with no declared type, whose type ` +
        `is inferred as one point from the body. The emitted definition ` +
        `reads one point, and the interpreter runs the body with the ` +
        `whole list. The call could not be inlined instead.`
    );
  }

  // A copy typed by the arguments has no run-time test of a declared
  // parameter type. On interval-js the test is `_IA.checkedCall`, emitted
  // only on the ordinary route below, so a call that needs it does not
  // take a copy.
  //
  // On interval-js, a copy whose body does not compile with the parameter
  // typed by the argument does not end the compilation of the call: the
  // definitions added by the attempt are removed, and the call takes the
  // routes below, which can inline it (the substitution folds `[a, b][1]`
  // to `a`). A cancellation propagates.
  let specialized: TargetSource | undefined;
  if (
    literal !== undefined &&
    !intervalChecks.some((checks) => checks.length > 0)
  ) {
    const registry = target.userFunctions;
    const definedBefore =
      target.language === 'interval-javascript' && registry !== undefined
        ? new Set(registry.defs.keys())
        : undefined;
    try {
      specialized = trySpecializedUserCall(
        engine,
        h,
        literal,
        args,
        target,
        node === undefined ? undefined : _prefixCallOverrides.get(node)
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      if (definedBefore === undefined || registry === undefined) throw e;
      removeDefinitionsAddedSince(registry, definedBefore);
      specialized = undefined;
    }
  }
  if (specialized !== undefined) return specialized;

  // A POINT bound to an UNTYPED parameter never goes by reference: the
  // emitted body treats that parameter as a scalar and answers NaN over the
  // array a point lowers to (`pointArgumentAtUntypedParameter` says why).
  // The call is inlined, which hands the point itself to the body's
  // arithmetic, where every target has its own point lowering. When the
  // inlining is not sound — an impure argument, a recursive or multi-clause
  // callee — the call fails closed: with `fallback: true` the caller falls
  // back to the interpreter, which answers the point correctly.
  const pointAt = pointArgumentAtUntypedParameter(engine, h, args);
  if (pointAt >= 0) {
    const inlined = tryInlineUserFunctionCall(engine, h, args, target);
    if (inlined !== undefined) return inlined;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${pointAt + 1} is a ` +
        `point, and the parameter that receives it has no declared or ` +
        `inferred type. The emitted definition treats that parameter as a ` +
        `scalar and would compute a different value than the interpreter ` +
        `does over a point, and the call could not be inlined instead. ` +
        `Declare the parameter's type (for example ` +
        `\`tuple<real, real>\`), or read it as a point in the body.`
    );
  }

  // A LIST bound WHOLE to a parameter whose element type is open (the
  // `collection<any> | value` slot that a body consuming the parameter
  // whole infers) never goes by reference either, when no specialization
  // took the call above. The emitted definition compiles the body against
  // the scalar arm of the slot: `R(V, θ) := [Σ V·[cos θ, -sin θ], …]`
  // becomes `V·cos θ - V·sin θ`, which answers `NaN` (JavaScript) or an
  // empty interval (interval-js) over the array a list lowers to, while
  // the interpreter multiplies the list element by element and sums. The
  // call is inlined, which hands the list itself to the body; when that
  // is not sound, the call fails closed.
  const wholeListAt = listArgumentAtOpenWholeParameter(engine, h, args);
  if (wholeListAt >= 0) {
    // A pure list argument is substituted whole: it is not evaluated
    // twice in a way that changes a value.
    const inlined = tryInlineUserFunctionCall(
      engine,
      h,
      args,
      target,
      (a) => a === args[wholeListAt] && a.isPure === true
    );
    if (inlined !== undefined) return inlined;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${wholeListAt + 1} ` +
        `is a list, which the interpreter binds whole to a parameter with ` +
        `no declared element type. The emitted definition reads that ` +
        `parameter as a scalar, and the call could not be inlined ` +
        `instead. Declare the parameter's type (for example ` +
        `\`list<real>\`).`
    );
  }

  // A real-analyzed argument bound to a complex-typed parameter is coerced
  // to the `{ re, im }` convention (the call-boundary face of the Tycho
  // item-60 convention-mismatch class): the body consumes such a parameter
  // through complex slots, so a plain number argument — e.g. the seed `0`
  // in `M(10, 0)`, after `Complex(0, 0)` canonicalizes to a real literal —
  // would NaN-poison the whole call. The coercion is PER PARAMETER: on the
  // broadcast path below it is applied inside the scalar closure, to the
  // element, not to the whole argument.
  // Gated on the PARAMETER's declared type alone, never on the argument's:
  // the callee's body is compiled in the complex lane for a declared-complex
  // parameter whatever the call site passes, so every call owes it a
  // `{ re, im }`. Restricting this to a provably-REAL argument left the
  // other arguments unwrapped against a complex-lane body — the
  // `'[object Object]0'` class. `emitUserFunctionCall` picks the static wrap
  // or the runtime `_SYS.cplx` per argument from its realness.
  const coerceToComplex = args.map((_a, i) => {
    if (target.language !== 'javascript') return false;
    const pt = userFunctionParamType(engine, h, i);
    if (pt !== undefined) return isNonRealNumber(pt);
    // A multi-clause function has an INTERSECTION signature, from which
    // `userFunctionParamType` reads no single parameter type — ask the
    // clause set instead.
    return multiClauseParamIsComplex(engine, h, i);
  });
  // A GENERIC callee always takes the runtime broadcast dispatch (when its
  // parameters are scalar at their bounds), never the provably-scalar fast
  // path. At a generic parameter the argument's static type is INFERRED
  // FROM THE BOUND rather than declared by the caller — `gd(y)` under
  // `(x: T) -> T where T: number` types the free `y` as `number` — so
  // "provably not a collection" is not proof there: `run({ y: [1,2,3] })`
  // still hands the call an array, which the interpreter broadcasts. The
  // dispatch applies the closure directly when no argument is an array, so
  // the only cost is one closure on the scalar path.
  //
  // No `literal !== undefined` pre-gate: `userFunctionIsGeneric` itself
  // accepts an absent literal (a multi-clause callee) and can still
  // answer from the operator/value definition's declared polymorphic
  // signature. Gating on `literal` here would silently drop that
  // definition-sourced answer for any literal-less callee, which is
  // harmless today only because a literal-less function currently routes
  // to the multi-clause emitter before this generic-bound dispatch is
  // ever reached.
  const generic = userFunctionIsGeneric(engine, h, literal);
  const paramsAreScalar = userFunctionParamsAreScalar(engine, h);

  // A call a repetition site rewrote to the callee's INVARIANT-PREFIX
  // VARIANT (`hoistLoopInvariants`): the prefix values are bound once
  // before the repetitions, each value node carries the binding's name as
  // its code override, and the variant takes them as extra parameters
  // after the ordinary ones. The ordinary arguments go through the same
  // call emitter as before, so the call keeps every convention of an
  // ordinary call (the broadcast dispatch, the `Array.isArray` guard); the
  // prefix values are HELD arguments, appended to every call form and
  // never broadcast over, because the body reads a prefix value whole — a
  // hoisted list the body indexes must reach it as that list. Falls
  // through to the ordinary call when the site discarded
  // a value's binding (its node has no override), or when the variant
  // cannot be emitted — the ordinary definition then declines or inlines
  // exactly as it would have.
  const prefixed =
    node === undefined ? undefined : _prefixCallOverrides.get(node);
  // Whether an argument must be checked against its parameter's declared
  // type at run time (`parameterCheckNeeded`): the call is then emitted
  // through the checking shim of the function, in every form the call
  // takes (the direct call, the broadcast dispatch over a list argument).
  // The invariant-prefix variant below has no shim (its extra parameters
  // are held values): a checked call takes the ordinary definition.
  const checked =
    args.some((a, i) => parameterCheckNeeded(engine, h, a, i, target)) ||
    intervalChecks.some((t) => t.length > 0);
  if (
    prefixed !== undefined &&
    !checked &&
    prefixed.values.every((v) => _codeOverrides.has(v))
  ) {
    let variant: string | undefined;
    try {
      variant = ensureUserFunctionVariantEmitted(
        engine,
        h,
        prefixed.prefixes,
        target
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      variant = undefined;
    }
    // A target with its own call-site lowering (the shader targets)
    // receives the prefix values as HELD arguments and checks their
    // static shape against the variant's signature; a mismatch it fails
    // closed on sends the call back to the ordinary definition.
    const variantLowering = target.userFunctions?.lowering;
    if (variant !== undefined && variantLowering) {
      try {
        return variantLowering.call({
          id: h,
          name: variant,
          args,
          target,
          held: prefixed.values,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'CancellationError') throw e;
        variant = undefined;
      }
    }
    if (variant !== undefined)
      return emitUserFunctionCall(
        variant,
        args,
        target,
        coerceToComplex,
        paramsAreScalar,
        generic,
        prefixed.values.map((v) => core.compile(v, target)),
        absentArgumentChecks(h, literal, args, target)
      );
  }

  // A callee the target cannot emit as a definition — a shader target
  // given a point-typed parameter it has no static type for, the interval
  // target given a body with a head it has no lowering for — is compiled
  // INLINED at this call site when that is sound (`tryInlineUserFunctionCall`);
  // the definition's own decline is rethrown when it is not.
  let name: string | undefined;
  try {
    name = core.ensureUserFunctionEmitted(engine, h, target);
  } catch (e) {
    // A cancellation (deadline, abort, iteration limit) must propagate;
    // identified by NAME, never `instanceof` — a plugin bundle re-bundles
    // the engine, so a `CancellationError` crossing a bundle boundary is
    // not an instance of the host's class (the `box.ts` convention).
    if (e instanceof Error && e.name === 'CancellationError') throw e;
    // An inlined call does not test the declared parameter types.
    if (checked) throw e;
    // A list of real numbers at a parameter typed as a tuple only by
    // index reads in the body is substituted whole too. Such a tuple is
    // not a contract (`isIndexReadTuple()`, index-read-tuple.ts): the
    // interpreter binds the list whole and runs the body with it, which
    // is what the substituted body computes. The definition could not be
    // emitted against the tuple (example: `r(p) := Floor(p[1]) · l(f(p))`
    // with `f(q) := Mod(q, 1) - 0.5`, where `f` of a point is refused).
    // The argument must be pure, so that reading it once per use computes
    // the same value.
    const inlined = tryInlineUserFunctionCall(
      engine,
      h,
      args,
      target,
      (a) =>
        a.isPure === true &&
        isRealListArg(a) &&
        isIndexReadTuple(
          userFunctionParamType(engine, h, args.indexOf(a)) ?? 'unknown'
        )
    );
    if (inlined !== undefined) return inlined;
    throw e;
  }
  if (name === undefined) return undefined;

  // A target with its own call-site lowering (the shader targets, which must
  // check the argument shapes against the statically synthesized signature)
  // owns the whole call site: none of the JS convention handling below —
  // complex `{re, im}` coercion, the `_SYS.bcastFn` runtime broadcast — has
  // an analog there.
  const lowering = target.userFunctions?.lowering;
  if (lowering) return lowering.call({ id: h, name, args, target });

  const callee = !checked
    ? name
    : target.language === 'interval-javascript'
      ? intervalCheckingCallee(name, intervalChecks, target)
      : (checkingShimName(engine, h, name, target) ?? name);
  return emitUserFunctionCall(
    callee,
    args,
    target,
    coerceToComplex,
    paramsAreScalar,
    generic,
    [],
    absentArgumentChecks(h, literal, args, target)
  );
}

/**
 * Whether the argument `a` at position `i` of a call of `h` must be
 * checked against the parameter's declared type at run time: the type is
 * one `checkedParameterType` tests, and the argument's static type does
 * not prove it. A list argument is checked through its ELEMENT type, since
 * the call maps over it and each element reaches the body; an element
 * type that is not known counts as unproven.
 *
 * The interpreter checks an argument against the parameter's annotation
 * at every application: `h(2.5)` with `h` declared `(x: integer) -> …` is
 * an `incompatible-type` error, and so is the second element of
 * `h([1, 2.5])` and of `Map(k ↦ h(k), [1, 2.5])`. The compiled call ran
 * the body on the value (`5`).
 */
export function parameterCheckNeeded(
  engine: ComputeEngine,
  h: string,
  a: Expression,
  i: number,
  target: CompileTarget<Expression>
): boolean {
  const declared = checkedParameterType(engine, h, i, target);
  if (declared === undefined) return false;
  return !argumentProvesParameterType(a, declared, target);
}

/**
 * How a compiled call treats the declared type `declared` of a parameter
 * whose argument is `a`:
 *
 * - `'none'`: no test. There is no declared type; the type is `number` or
 *   a complex type (whose argument is coerced, `coerceToComplex`); the
 *   static type of the argument proves it
 *   (`argumentProvesParameterType`); or the target does not test it, as
 *   before: a type that admits every real number (`real`, a union with a
 *   non-numeric member) on a target other than JavaScript. So on GLSL,
 *   WGSL, Python and interval-js, an infinite argument at a `real`
 *   parameter gives a value, where the interpreter refuses `±∞`. This is
 *   intended: it is part of the rule that a float target writes `~oo` as
 *   `Infinity`, and a test would refuse many shader programs.
 * - `'guard'`: the call tests the argument at run time. On JavaScript, a
 *   type with a test (`jsClauseParamGuard`). On the interval target, an
 *   integer type or a real type with bounds (`intervalParameterDomain`).
 * - `'refuse'`: the compilation fails. The type admits only some real
 *   numbers (an integer type, a bounded real type, `rational`), the
 *   argument can be a real number outside of it, and the target has no
 *   test for it. The interpreter gives an `incompatible-type` error for
 *   such a value, and compiled code with no test would give a value.
 */
export function declaredParameterCheck(
  declared: Type | undefined,
  a: Expression,
  target: CompileTarget<Expression>
): 'none' | 'guard' | 'refuse' {
  if (declared === undefined) return 'none';
  if (declared === 'number' || isNonRealNumber(declared)) return 'none';
  if (argumentProvesParameterType(a, declared, target)) return 'none';
  const restrictsReals =
    isSubtype(declared, 'real') && !isSubtype('real', declared);
  if (target.language === 'javascript') {
    const test = jsParameterGuard(declared, '_');
    if (test === null) return 'none';
    if (test !== undefined) return 'guard';
  } else if (target.language === 'interval-javascript') {
    if (intervalParameterDomain(declared) !== undefined) return 'guard';
  }
  return restrictsReals ? 'refuse' : 'none';
}

/**
 * The error of a call of `h` whose argument `a` can break the declared
 * type `declared` of the parameter `param` (`declaredParameterCheck`
 * answers `'refuse'`).
 */
export function uncheckedParameterError(
  h: string,
  param: string,
  declared: Type,
  a: Expression,
  target: CompileTarget<Expression>
): Error {
  return new Error(
    `Could not compile a call of \`${h}\`: the argument ` +
      `\`${a.toString()}\` can have a value that is not of the type ` +
      `\`${typeToString(declared)}\` declared for the parameter ` +
      `\`${param}\`. The interpreter gives an \`incompatible-type\` error ` +
      `for such a value, and target '${target.language ?? 'unknown'}' ` +
      `has no run-time test for this type.`
  );
}

/**
 * The source of the `ParameterDomain` (`interval/util.ts`) of the
 * declared parameter type `t` on the interval target, or `undefined` when
 * the target has no test for `t`: an integer type, or a real type with
 * bounds. A bound that the type excludes (`real<0<..>`) is marked as
 * excluded, so a point interval at the bound is refused, as the
 * interpreter refuses `g(0)` for `g: (real<0<..>) -> real`.
 */
export function intervalParameterDomain(t: Type): string | undefined {
  if (t === 'integer') return '{ integer: true }';
  if (typeof t !== 'object' || t.kind !== 'numeric') return undefined;
  if (t.type !== 'integer' && t.type !== 'real') return undefined;
  const parts: string[] = [];
  if (t.type === 'integer') parts.push('integer: true');
  if (typeof t.lower === 'number' && Number.isFinite(t.lower)) {
    parts.push(`lower: ${String(t.lower)}`);
    if (t.lowerOpen === true) parts.push('lowerOpen: true');
  }
  if (typeof t.upper === 'number' && Number.isFinite(t.upper)) {
    parts.push(`upper: ${String(t.upper)}`);
    if (t.upperOpen === true) parts.push('upperOpen: true');
  }
  return `{ ${parts.join(', ')} }`;
}

/**
 * Per argument of a call of the block-local function `h` (its literal
 * `literal`), the declared parameter types that the call tests at run
 * time (`declaredParameterCheck`).
 *
 * A parameter is declared by an annotation of the literal (`function g(k:
 * integer) { … }`) and by a `Declare` statement of the name in an
 * enclosing statement list (`let g: (integer) -> integer`, read from
 * `CompileTarget.declaredVarTypes`). The interpreter checks the argument
 * against both at each call: `g(1.5)` is an `incompatible-type` error.
 *
 * Throws when a number literal argument is not a value of a declared
 * type (`g(1.5)`), and when the call would need a test that the target
 * does not have.
 */
export function localParameterChecks(
  h: string,
  literal: Expression & FunctionInterface,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Type[][] {
  const declaredSignature = target.declaredVarTypes?.[h];
  return args.map((a, i) => {
    const param = literal.ops[i + 1];
    const declared = [
      param === undefined ? undefined : functionLiteralParameterType(param),
      signatureParamType(declaredSignature, i),
    ].filter((t): t is Type => t !== undefined);
    const name =
      (param === undefined ? '' : functionLiteralParameterName(param)) ||
      `#${i + 1}`;
    const tested: Type[] = [];
    for (const t of declared) {
      // Only a number literal is refused here: the type of any other
      // argument can rest on an inference from its use, and the run-time
      // test below decides it.
      if (isNumber(a) && !couldMatch(a.type.type, t))
        throw new Error(
          `Could not compile a call of \`${h}\`: the argument ` +
            `\`${a.toString()}\` has the type ` +
            `\`${typeToString(a.type.type)}\`, which does not match the ` +
            `type \`${typeToString(t)}\` of the parameter \`${name}\`. ` +
            `The interpreter gives an \`incompatible-type\` error for ` +
            `this call.`
        );
      const check = declaredParameterCheck(t, a, target);
      if (check === 'refuse')
        throw uncheckedParameterError(h, name, t, a, target);
      if (check === 'guard') tested.push(t);
    }
    return tested;
  });
}

/**
 * The JavaScript call `Apply(literal, …args)` of an annotated function
 * literal, compiled by `code`, with the arguments tested against the
 * annotations at run time, or `undefined` when no argument needs a test
 * (`localParameterChecks`). A failed test answers `NaN`, as a checked
 * call of a block-local function does (`localCheckingCallee`).
 *
 * The interpreter checks the argument of such an application against
 * the annotation: `Apply((k: integer) ↦ k + 1, v)` is an
 * `incompatible-type` error for `v = 1.5`. The compiled application gave
 * 2.5: only an argument whose static type cannot match was refused
 * (`appliedArgumentTypeMismatch`). CE-226.3.
 *
 * `code` compiles the literal. It is called only when an argument needs a
 * test, so that the caller does not compile the literal twice and does
 * not register temporaries that the emitted code never reads.
 */
export function appliedLiteralCheckedCall(
  literal: Expression & FunctionInterface,
  code: () => string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (target.language !== 'javascript') return undefined;
  const checks = localParameterChecks('(function)', literal, args, target);
  if (checks.every((t) => t.length === 0)) return undefined;
  const literalCode = code();
  const signature = literal.type.type;
  // The checking callee is bound once: the call form can name its callee
  // twice (the broadcast and the direct call).
  const callee = tempVar(target);
  const call = emitUserFunctionCall(
    callee,
    args,
    target,
    args.map((_a, i) => {
      const pt = signatureParamType(signature, i);
      return pt !== undefined && isNonRealNumber(pt);
    }),
    paramsAreScalar(signature),
    false,
    [],
    absentArgumentChecks('(function)', literal, args, target)
  );
  return (
    `((${callee}) => ${call})` +
    `(${localCheckingCallee(`(${literalCode})`, checks, target, signature)})`
  );
}

/**
 * The callee that tests the arguments of a call of `callee` on the
 * interval target before the call (`_IA.checkedCall`): `domains[i]` lists
 * the declared types of parameter `i` that the call tests, empty for a
 * parameter with no test. `callee` itself when no parameter is tested.
 */
export function intervalCheckingCallee(
  callee: string,
  domains: ReadonlyArray<ReadonlyArray<Type>>,
  target: CompileTarget<Expression>
): string {
  if (domains.every((d) => d.length === 0)) return callee;
  const specs = domains.map((ds) =>
    ds.length === 0
      ? 'null'
      : `[${ds.map((t) => intervalParameterDomain(t)!).join(', ')}]`
  );
  const rest = tempVar(target);
  return (
    `((...${rest}) => _IA.checkedCall(${callee}, ` +
    `[${specs.join(', ')}], ...${rest}))`
  );
}

/**
 * The callee that tests the arguments of a call of the block-local
 * function `callee` on the JavaScript target: `types[i]` lists the
 * declared types of parameter `i` that the call tests. As the checking
 * shim of an engine-level function (`checkingShimName`), the test reads
 * the real projection of the argument, the function receives that
 * projection, and the call answers the marker of the declared result
 * type of `signature` when a test fails (`failedCheckMarker`: `undefined`
 * for a collection result, `NaN` otherwise), the value compiled code has
 * where the interpreter answers an error. The shim is written at the
 * call, since the value of a block local is read where the call runs.
 * `callee` itself when no parameter is tested.
 */
export function localCheckingCallee(
  callee: string,
  types: ReadonlyArray<ReadonlyArray<Type>>,
  target: CompileTarget<Expression>,
  signature: Type | undefined
): string {
  if (types.every((t) => t.length === 0)) return callee;
  const params = types.map(() => tempVar(target));
  const tests: string[] = [];
  const passed = params.map((p, i) => {
    if (types[i].length === 0) return p;
    const projected = `_SYS.creal(${p})`;
    for (const t of types[i]) tests.push(jsParameterGuard(t, projected)!);
    return projected;
  });
  return (
    `((${params.join(', ')}) => (${tests.join(' && ')}) ? ` +
    `${callee}(${passed.join(', ')}) : ` +
    `${failedCheckMarker(signature)})`
  );
}

/**
 * Whether the static type of the argument `a` proves that every value it
 * gives at run time is in the declared parameter type `declared`. A list
 * argument at a SCALAR parameter is read through its ELEMENT type, since
 * the call maps over it and each element reaches the body; an element
 * type that is not known is no proof.
 *
 * The static type is a proof only when it does not rest on a type that
 * the engine inferred from a USE of a symbol
 * (`staticTypeIsEvidence`). A symbol with no value takes the type of
 * the first parameter it is passed to: in `h(x)` with `h` declared
 * `(integer) -> integer`, the free `x` is typed `integer` because of this
 * call, and `run({ x: 2.5 })` still hands the call `2.5`, where the
 * interpreter, given `x = 2.5`, answers an `incompatible-type` error.
 */
export function argumentProvesParameterType(
  a: Expression,
  declared: Type,
  target: CompileTarget<Expression>
): boolean {
  // An absent value is the business of the absent-argument check
  // (`absentArgumentChecks`), which runs first.
  const t = stripMissingFromType(a.type.type);
  // A list of points at a parameter declared as a point: the call maps
  // over the list (`tryCompilePointListCall`), and each point reaches the
  // body, so the points are read against the declared type, as the
  // elements of a list at a scalar parameter are.
  if (isPointListArgumentType(t, declared)) {
    if (!staticTypeIsEvidence(a, { kind: 'list', elements: declared }, target))
      return false;
    const element = collectionElementType(resolveTypeForCompilation(t));
    return (
      element !== undefined &&
      isSubtype(stripMissingFromType(element), declared)
    );
  }
  if (!staticTypeIsEvidence(a, declared, target)) return false;
  if (isSubtype(t, declared)) return true;
  if (provablyScalarArg(a) || !isScalarType(declared)) return false;
  const element = collectionElementType(resolveTypeForCompilation(t));
  if (element === undefined) return false;
  return isSubtype(stripMissingFromType(element), declared);
}

/**
 * Whether the static type of `a` is a fact about its run-time values, for
 * a test against the parameter type `declared`: it does not rest on the
 * type of a symbol that the engine inferred from the use of the symbol.
 *
 * - A symbol whose type is inferred (`inferredType`: a free input with no
 *   declaration, a function parameter with no annotation, a block local
 *   with no stated type) is no evidence. A block local whose `Declare`
 *   states a type (`CompileTarget.declaredVarTypes`) is evidence: the
 *   canonical form types it before its `Declare` runs, so its own
 *   definition still reads as inferred. A block local with no stated type
 *   is evidence when each value that the compiled code assigns to it is
 *   evidence, and is in `declared` (`assignmentsProveType`): `let a = 3`
 *   then `f(a)`.
 * - A constant, a symbol with a declared type, and a function literal
 *   (whose parameters it binds itself) are evidence.
 * - An application is evidence when the result type that its operator
 *   DECLARES is in `declared` (`Floor(x)` is an integer whatever `x`
 *   is), or when each of its operands is evidence.
 */
export function staticTypeIsEvidence(
  a: Expression,
  declared: Type,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(a)) {
    if (a.isConstant) return true;
    if (a.valueDefinition?.inferredType !== true) return true;
    if (target.declaredVarTypes?.[a.symbol] !== undefined) return true;
    return assignmentsProveType(a, declared, target);
  }
  // The parameters of a function literal operand (the predicate of
  // `Filter`) are bound by it: their types are not the type of a value
  // of `a`.
  if (!isFunction(a)) return true;
  if (a.operator === 'Function') return true;
  const def = a.operatorDefinition;
  if (def !== undefined && !def.inferredSignature) {
    const result = functionResult(def.signature.type);
    if (result !== undefined && isSubtype(result, declared)) return true;
  }
  return a.ops.every((op) => staticTypeIsEvidence(op, declared, target));
}

/**
 * The statement list of each `Block` that is being compiled, with the
 * scope of the block, innermost last (`assignmentsProveType`).
 */
export const _blockStatements: {
  scope: NonNullable<Expression['localScope']>;
  args: ReadonlyArray<Expression>;
}[] = [];

/**
 * The value definitions of the locals whose assignments
 * `assignmentsProveType` reads now: a value that reads one of them again
 * (`a = a + 1`, or `a = b` and `b = a`) is no proof.
 */
export const _provingLocals = new Set<object>();

/**
 * Whether the symbol `a` is a local of a block that is being compiled,
 * and each value that the block assigns to it is in the type `declared`,
 * with a static type that is evidence (`staticTypeIsEvidence`). Only the
 * compiled code writes a block local, so these values are all the values
 * that the local can hold: in `let a = 3; f(a)`, `a` is an integer.
 *
 * The assignments are read in all the statements of the block, at any
 * depth (a branch, a loop body, a function literal). An assignment to a
 * name of a nested scope with the same name is read too: it can only
 * make the proof fail. A destructuring assignment of the name, and an
 * assignment to a part of it, are no proof. A local with no assigned
 * value is no proof: a read before its first assignment is checked in
 * another way (`checkedLocalReads`).
 */
export function assignmentsProveType(
  a: Expression,
  declared: Type,
  target: CompileTarget<Expression>
): boolean {
  if (!isSymbol(a)) return false;
  const def = a.valueDefinition;
  if (def === undefined) return false;
  const name = a.symbol;
  const frames = _blockStatements;
  let frame: (typeof frames)[number] | undefined;
  for (let i = frames.length - 1; i >= 0 && frame === undefined; i--) {
    const binding = frames[i].scope.bindings.get(name);
    if (binding !== undefined && 'value' in binding && binding.value === def)
      frame = frames[i];
  }
  if (frame === undefined || _provingLocals.has(def)) return false;
  const values: Expression[] = [];
  let unknown = false;
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (unknown || seen.has(e)) return;
    seen.add(e);
    if (isDictionary(e)) {
      for (const value of e.values) visit(value);
      return;
    }
    if (!isFunction(e)) return;
    if (e.operator === 'Assign' || e.operator === 'Declare') {
      const lhs = e.ops[0];
      if (isSymbol(lhs, name)) {
        const value =
          e.operator === 'Assign' ? e.ops[1] : declareValueOperand(e.ops);
        if (value === undefined) {
          if (e.operator === 'Assign') unknown = true;
        } else values.push(value);
      } else if (
        lhs !== undefined &&
        !isSymbol(lhs) &&
        (isFunction(lhs, 'Tuple')
          ? tuplePatternNames(lhs).includes(name)
          : lhs.has(name))
      )
        unknown = true;
    }
    for (const op of e.ops) visit(op);
  };
  for (const statement of frame.args) visit(statement);
  if (unknown || values.length === 0) return false;
  _provingLocals.add(def);
  try {
    return values.every(
      (v) =>
        isSubtype(stripMissingFromType(v.type.type), declared) &&
        staticTypeIsEvidence(v, declared, target)
    );
  } finally {
    _provingLocals.delete(def);
  }
}

export function mayBeAbsentCollection(
  engine: ComputeEngine,
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  // Each node once: a collection built from shared subtrees
  // (`Reverse(Join(e, e))` nested) has few distinct nodes but
  // exponentially many paths.
  const memo = new Map<Expression, boolean>();
  const test = (x: Expression): boolean => {
    const known = memo.get(x);
    if (known !== undefined) return known;
    memo.set(x, false);
    const answer = mayBeAbsentCollectionNode(engine, x, target, test);
    memo.set(x, answer);
    return answer;
  };
  return test(a);
}

/** One node of `mayBeAbsentCollection`; `operand` answers for an
 * operand. */
export function mayBeAbsentCollectionNode(
  engine: ComputeEngine,
  a: Expression,
  target: CompileTarget<Expression>,
  operand: (x: Expression) => boolean
): boolean {
  if (checkedCallMayBeAbsent(engine, a, target)) return true;
  if (target.language !== 'javascript' || !isFunction(a)) return false;
  // A `Take` or `Drop` over an infinite source compiles to a lazy stream,
  // not to the slice, and cannot be bound as an array.
  if (
    (a.operator === 'Take' || a.operator === 'Drop') &&
    a.nops === 2 &&
    a.ops[0].isFiniteCollection !== false &&
    countMayBeNaN(a.ops[1], target)
  )
    return true;
  const result = stripMissingFromType(resolveTypeForCompilation(a.type.type));
  if (
    result === 'never' ||
    result === 'unknown' ||
    result === 'any' ||
    !isSubtype(result, 'collection')
  )
    return false;
  if (CONTROL_FLOW_HEADS.has(a.operator)) return false;
  const def = lookupApplicable(a.operator, engine.context.lexicalScope);
  if (!isOperatorDef(def)) return false;
  const operator = def.operator;
  if (operator.broadcastable) return false;
  // As in `absentCollectionOperandGuard`: an operator that handles or
  // passes through a `missing` operand is the absent collection only for
  // an operand absent at run time.
  const behavior = operator.resolvedMissingBehavior;
  if (behavior === 'handle' || behavior === 'pass-through')
    return (
      !operator.lazy &&
      !ABSENCE_DISCHARGING_HEADS.has(a.operator) &&
      a.ops.some((x) => !core.hasCodeOverride(x) && operand(x))
    );
  if (behavior !== 'propagate') return false;
  return a.ops.some(
    (x, i) =>
      operator.stripsMissingAt(i) &&
      !core.hasCodeOverride(x) &&
      (gatedCollectionArms(x) !== undefined || operand(x))
  );
}

/**
 * True when the operand `a` compiles to a call through the checking shim
 * of an engine-defined user function whose failed check gives `undefined`
 * (`failedCheckMarker`): a call on the JavaScript target with an argument
 * that `parameterCheckNeeded` must test, of a function whose declared
 * result is a collection. The call then has no value at run time when the
 * test fails, although its type is the collection type, so a consumer
 * that reads it as an array must test it first
 * (`absentCollectionOperandGuard`). A call whose arguments are all proven
 * has no shim and is not affected.
 */
export function checkedCallMayBeAbsent(
  engine: ComputeEngine,
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (target.language !== 'javascript' || !isFunction(a)) return false;
  const h = a.operator;
  // A block-local function (`tryCompileLocalFunctionCall`) is tested by
  // `localCheckingCallee`, with the marker of the signature of its
  // literal, read at the ground bounds of a generic signature as there.
  const local = target.localFunctions?.get(h);
  if (local !== undefined) {
    if (!isFunction(local, 'Function')) return false;
    const declared = local.type?.type;
    const signature =
      declared !== undefined && isPolymorphicType(declared)
        ? groundSignature(declared)
        : declared;
    if (failedCheckMarker(signature) !== 'undefined') return false;
    try {
      return localParameterChecks(h, local, a.ops, target).some(
        (t) => t.length > 0
      );
    } catch (e) {
      // The call compiles to its own error (a number literal that cannot
      // be of the declared type), which is not this guard's business.
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      return false;
    }
  }
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return false;
  if (
    failedCheckMarker(userFunctionSignature(engine, h), literal.type.type) !==
    'undefined'
  )
    return false;
  return a.ops.some((x, i) => parameterCheckNeeded(engine, h, x, i, target));
}

/**
 * If head `h` names a FUNCTION-VALUED BLOCK LOCAL of an enclosing statement
 * list (`target.localFunctions` — `const g = (k) => …` earlier in the same
 * block), compile the call site as an ordinary call of that binding.
 *
 * The declaration itself already lowers to a value binding (`let g = ((k) =>
 * …)`) — only the CALL had no resolution: head lookup consults the engine's
 * definitions (`userFunctionLiteral`), which a block-local declaration never
 * enters (compiling must not mutate the engine), so `g(3)` reported
 * ``Unknown operator `g` `` even though the block bound `g` two lines above.
 *
 * The callee's signature is read from the declared LITERAL rather than from
 * an engine definition; everything downstream of that — complex `{re, im}`
 * coercion, the `_SYS.bcastFn` runtime broadcast — is the shared
 * `emitUserFunctionCall`, so a local and an engine-level function of the
 * same shape compile to the same call. A GENERIC literal is read at its
 * declared bounds, the same reading the engine route performs, so the two
 * spellings of one bounded generic no longer disagree about whether it
 * compiles at all.
 *
 * Returns `undefined` when `h` is not such a local, leaving the caller's
 * fail-closed throw in place. An ARITY mismatch fails closed here instead.
 * With fewer arguments than parameters, the interpreter makes a partial
 * application, whose value is a function, and the compiled call does not
 * build that value (JavaScript would pass `undefined` for each missing
 * argument and compute `NaN`). With more arguments than parameters, the
 * interpreter reports an error.
 *
 * A local whose value can change while its block runs
 * (`target.reboundFunctions`) is called through its run-time binding and is
 * never folded: the literal in the scope only gives its signature.
 */
export function tryCompileLocalFunctionCall(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  const rebound = target.reboundFunctions?.get(h);
  if (rebound?.decline !== undefined) throw new Error(rebound.decline);
  // The types of the arguments, read before the constant fold below. The
  // fold builds `Apply(literal, …args)`, and that canonicalization narrows
  // a valueless block local used as an argument to the parameter's type:
  // a list of points at a point parameter is narrowed to `never`.
  const argTypes = args.map((a) => a.type.type);
  const literal = target.localFunctions?.get(h);
  // Re-narrowed rather than typed on the map: `CompileTarget` is generic in
  // its expression type, so the map's value type carries no operand access.
  if (literal === undefined || !isFunction(literal, 'Function'))
    return undefined;

  // A rebound local is compiled on the JavaScript target only. The interval
  // target also binds a local function as a value, but it keeps the
  // narrower contract (a function assigned once): a reassignment is often
  // inside a statement-form `if`, and the interval lowering of an
  // assignment inside a branch is not correct (see the else-less `If` note
  // in `compileBlock`).
  if (
    rebound !== undefined &&
    target.language !== undefined &&
    target.language !== 'javascript'
  )
    throw new Error(
      `Could not compile a call of \`${h}\`: the block-local function ` +
        `\`${h}\` is assigned more than once or inside a nested statement, ` +
        `or from the result of a call, so the call must read its value at ` +
        `run time, and target ` +
        `'${target.language}' compiles a call of a block-local function ` +
        `only when the function is assigned once.`
    );

  // `["Function", body, ...params]` — one operand per declared parameter
  // after the body.
  const arity = literal.ops.length - 1;
  if (args.length !== arity)
    throw new Error(
      `Could not compile \`${h}\`: the block-local function is declared with ` +
        `${arity} parameter${arity === 1 ? '' : 's'} but called with ` +
        `${args.length}. ` +
        (args.length < arity
          ? `The interpreter reads a call with fewer arguments than ` +
            `parameters as a partial application, whose value is a ` +
            `function, and the compiled call does not build that value.`
          : `The interpreter reports an error for a call with more ` +
            `arguments than parameters.`)
    );

  // A call of a CLOSED local with constant arguments is itself constant, so
  // it folds — `g(3)` to `14` — exactly as the same call of an engine-level
  // function does. Without this the two Epsil spellings of one definition
  // compiled differently: `function g(k) { … }` DECLARES `g` in the engine
  // as it canonicalizes, so `["g", 3]` reached the folder with no unknown
  // head and folded, while the `const g = (k) => …` binding declares
  // nothing and left the call unfolded.
  //
  // The fold runs on `Apply(literal, …args)` — the call written in a form
  // that carries its own callee — and is decided by the ordinary
  // `tryConstantFold` gates, not by a second copy of them: a non-constant
  // argument, an impure body, an unbounded big-op, a caller-overridden name
  // and a `constantFold: false` all decline there. In particular a body that
  // references ANOTHER compile-bound name — a sibling local, or the local's
  // own name in a recursive definition — declines on
  // `mentionsCompileBoundName`, since those names have no engine value the
  // fold could evaluate through.
  //
  // A rebound local does not fold: the literal in the scope is one of its
  // values, not necessarily the one it holds at this call.
  //
  // A call that tests a declared parameter type at run time does not fold
  // either: the fold applies the literal, which does not carry a type
  // declared by a `Declare` statement, so `g(√2)` with `g` declared
  // `(integer) -> integer` would fold to a value where the interpreter
  // gives an error. An argument that cannot be of the declared type
  // (`g(1.5)`) fails the compilation here.
  const parameterChecks = localParameterChecks(h, literal, args, target);
  const checked = parameterChecks.some((t) => t.length > 0);
  const folded =
    rebound === undefined && !checked
      ? tryConstantFold(
          literal.engine.function('Apply', [literal, ...args]),
          target,
          FOLD_OPERAND_PREC
        )
      : undefined;
  if (folded !== undefined) return folded;

  const declared = literal.type?.type;

  // A LIST OF POINTS at a parameter ANNOTATED as a point
  // (`isPointListArgumentType`). The interpreter applies the function to
  // each point and answers the list of the results, and the compiled call
  // does the same, with the map the engine-defined route emits
  // (`tryCompilePointListCall`): `list.map((p) => f(p, …))`, every other
  // argument evaluated once, before the map, and passed whole. The
  // ordinary call passed the list whole: with
  // `function f(p: tuple<number, number>) { p[1] + 1 }` and `xs` a list of
  // two points, `f(xs)` read the first POINT as the first coordinate and
  // answered the string `"1,21"`, where the interpreter answers `[2, 4]`.
  //
  // Only an annotation is mapped. The type the literal reports for a bare
  // parameter is inferred from the body (`(p) => h(p)` with `h` taking a
  // point), and the interpreter binds a list whole at a bare parameter
  // (the map then happens inside the body, at the call of `h`). The
  // compiled body was typed for ONE point, so its inner call is an
  // ordinary call and would receive the list whole: that call fails
  // closed below.
  //
  // The call fails closed where the engine-defined route does: on a target
  // other than JavaScript, when two arguments are lists of points, and
  // when another parameter is annotated with a complex type. A call with
  // constant arguments never reaches this: it folded above.
  const annotations = args.map((_a, i) =>
    functionLiteralParameterType(literal.ops[i + 1])
  );
  const mapped = args.map((a, i) => {
    const pt = annotations[i];
    return (
      pt !== undefined &&
      !isTuple(a) &&
      isPointListArgumentType(argTypes[i], pt)
    );
  });
  const bareListAt = args.findIndex((a, i) => {
    if (annotations[i] !== undefined || isTuple(a)) return false;
    const inferred = signatureParamType(declared, i);
    return (
      inferred !== undefined && isPointListArgumentType(argTypes[i], inferred)
    );
  });
  if (bareListAt >= 0) {
    // The interpreter binds the list whole at the bare parameter and runs
    // the body with it, so the call is written as the body with the
    // arguments in place of the parameters: in the body of
    // `const g = (p) => h(p)`, `h(xs)` is then compiled for a list of
    // points. CE-238.
    const inlined =
      rebound === undefined && !checked
        ? bodyWithArguments(h, literal, args, target)
        : undefined;
    if (inlined !== undefined) return `(${core.compile(inlined, target)})`;
    throw new Error(
      `Could not compile \`${h}\`: argument ${bareListAt + 1} is a list of ` +
        `points at a parameter with no annotation, whose type is inferred ` +
        `as one point from the body. The compiled body reads one point, so ` +
        `it cannot receive the list, and the call could not be written ` +
        `with the body of the function. Annotate the parameter as a point ` +
        `to apply the function to each point, or as a list of points.`
    );
  }
  const at = mapped.indexOf(true);
  // The two calls written below without the ordinary call form (the map
  // over a list of points, and the call written with the body of the
  // function) do not test the declared parameter types.
  if (checked && at >= 0)
    throw new Error(
      `Could not compile \`${h}\`: argument ${at + 1} is a list of points, ` +
        `and the compiled call over it does not test the declared ` +
        `parameter types at run time.`
    );
  if (at >= 0) {
    const reason =
      `Could not compile \`${h}\`: argument ${at + 1} is a list of points ` +
      `at a parameter declared as a point, and the interpreter applies the ` +
      `block-local function to each point.`;
    if (target.language !== 'javascript')
      throw new Error(
        `${reason} A list of points is not a value the ` +
          `'${target.language ?? 'unknown'}' target can map a function over.`
      );
    if (mapped.lastIndexOf(true) !== at)
      throw new Error(
        `${reason} More than one argument is a list of points, and the ` +
          `compiled call maps over one list only.`
      );
    if (
      annotations.some(
        (pt, i) => i !== at && pt !== undefined && isNonRealNumber(pt)
      )
    )
      throw new Error(
        `${reason} Another argument is bound to a complex-typed parameter, ` +
          `which the compiled map does not convert.`
      );
    const callee = target.var(h) ?? h;
    // The mapped list is exempt from the absent-argument check (an absent
    // point is an absent cell); every other argument is checked inside the
    // map, when a point is given to the function, as in
    // `tryCompilePointListCall`.
    const checks = absentArgumentChecks(h, literal, args, target);
    const codes = args.map((a) => compileValueOperand(a, target));
    const temps = args.map(() => tempVar(target));
    const point = tempVar(target);
    const callArgs = temps.map((t, i) =>
      i === at ? point : presentCheckedCode(t, checks[i])
    );
    // A list that may be absent, or whose points may be absent: `Missing`
    // lowers to `undefined`, and the interpreter answers `Missing` for an
    // absent list and for the cell of an absent point, so the map does
    // the same.
    const absent = typeContainsMissing(argTypes[at]);
    const listGuard = absent ? `${temps[at]} === undefined ? undefined : ` : '';
    const pointGuard = absent ? `${point} === undefined ? undefined : ` : '';
    return (
      `((${temps.join(', ')}) => ${listGuard}${temps[at]}.map((${point}) => ` +
      `${pointGuard}${callee}(${callArgs.join(', ')})))(${codes.join(', ')})`
    );
  }

  // The signature gates the ENGINE-defined route enforces, applied to the
  // declared LITERAL's signature. They are about what the emitted call would
  // COMPUTE, not about whether the callee can be emitted, so a local is no
  // more exempt from them than a definition is.
  //
  // DECLARED `broadcastable<T>`. An elementwise contract that maps exactly
  // one rank down, which neither emitted call form expresses — see
  // `checkDeclaredBroadcast` for the full rule. Without this,
  // `const pair = (x: broadcastable<value>) => (x, x)` applied to a list
  // emitted a direct call and answered `[[1,2,3],[1,2,3]]` where the
  // interpreter answers `[(1,1),(2,2),(3,3)]`. Read from the DECLARED
  // signature, generic or not, and checked before the generic reading below
  // so that a `broadcastable<T>` parameter of a generic local reports the
  // broadcast reason the engine route reports for the same declaration.
  checkDeclaredBroadcastAgainst(
    h,
    args,
    provablyScalarArg,
    broadcastableParamSlots(declared),
    () => declaresBroadcastableParam(declared)
  );

  // GENERIC. A polytype's parameter is a type VARIABLE, which the compiler
  // can neither coerce nor decide a broadcast against, so it is read at its
  // DECLARED BOUND — the same reading the engine-defined route performs in
  // `ensureUserFunctionEmitted` and `userFunctionSignature`, and the one the
  // interpreter's own broadcast gate already performs. A local declared
  // `(x: T) -> T where T: number` therefore compiles exactly as the ground
  // `(x: number) -> number` local does, and its call sites earn the coercion
  // and broadcast wraps that ground signature earns.
  //
  // Two conditions gate it, matching the engine route. The target must be
  // JAVASCRIPT, since the coercion and the `_SYS.bcastFn` broadcast the
  // emitted call boundary relies on are both JavaScript conventions; and the
  // bound reading must be GROUND, which an unbounded `where T` is not — it
  // names no type to compile against. Either way the call fails closed here
  // and the interpreted fallback answers.
  let signature: Type | undefined = declared;
  const generic = declared !== undefined && isPolymorphicType(declared);
  if (generic) {
    if (target.language !== 'javascript')
      throw new Error(
        `Could not compile \`${h}\`: the block-local function has a GENERIC ` +
          `signature, and reading its type variables at their declared ` +
          `bounds is a JavaScript-only convention: the argument coercion ` +
          `and the runtime broadcast an emitted call would rely on are ` +
          `both spelled in JavaScript (rule G3). ` +
          `Evaluate this expression with evaluate() instead, or annotate ` +
          `the parameters with ground types.`
      );
    signature = groundSignature(declared);
    if (signature === undefined)
      throw new Error(
        `Could not compile \`${h}\`: the block-local function has a GENERIC ` +
          `signature whose type variables have no ground declared bound, ` +
          `so there is no type to compile the parameters against (rule ` +
          `G3). Evaluate this expression with evaluate() ` +
          `instead, bound the type variables (\`where T: number\`), or ` +
          `annotate the parameters with ground types.`
      );
  }

  // A TUPLE argument, or a list of tuples, at a parameter with no
  // annotation. The interpreter binds a tuple whole at such a parameter,
  // and applies the function to each tuple of a list of tuples. But the
  // binding of a local whose parameters read as scalars is wrapped in the
  // run-time broadcast (`_SYS.bcastFn`), which maps into any array, a point
  // included: `const g = (v) => 7` then `g((5, 6))` gave `[7, 7]` where the
  // interpreter gives `7`. Thus the call is written as the `Apply` of the
  // literal is on the engine route (`wholeTupleCall`): the body with the
  // tuple in place of the parameter, or the map of that over the list.
  if (
    target.language === 'javascript' &&
    (signature === undefined || paramsAreScalar(signature))
  ) {
    const isListOfTuples = (a: Expression) => {
      const t = resolveTypeAlias(a.type.type);
      return (
        typeof t === 'object' &&
        t.kind === 'list' &&
        isTupleShapedType(resolveTypeAlias(t.elements))
      );
    };
    const whole = args.map(
      (a, i) =>
        annotations[i] === undefined &&
        (isTupleShapedType(resolveTypeAlias(a.type.type)) || isListOfTuples(a))
    );
    if (whole.some((x) => x)) {
      const reason =
        `Could not compile \`${h}\`: a tuple argument at a parameter of ` +
        `the block-local function with no declared type is bound whole, ` +
        `and the compiled function maps over any array at run time`;
      if (checked)
        throw new Error(
          `${reason}. The call is written with the body of the function, ` +
            `which does not test the declared parameter types at run time.`
        );
      // The value of a rebound local is known only at run time, so its
      // body cannot be written at the call.
      if (rebound !== undefined)
        throw new Error(
          `${reason}. The function is assigned more than once or inside ` +
            `a nested statement, so its value is known only at run time, ` +
            `and the call cannot be written with the body of that value. ` +
            `Declare the type of the parameter.`
        );
      // The body is written at the call, not where the local is defined.
      // A binder that encloses the call can bind a name that the body
      // reads, and it would capture that name. Each bound name that the
      // body reads is refused, except the name of the function itself (a
      // recursive call is compiled as a call of the local again).
      const captured = [...freeSymbolNames(literal)].find(
        (n) => n !== h && target.boundVars?.has(n) === true
      );
      if (captured !== undefined)
        throw new Error(
          `${reason}. The call is written with the body of the function, ` +
            `which reads \`${captured}\`, and a binding at the call can ` +
            `be a different \`${captured}\`.`
        );
      const engine = literal.engine;
      const applied = (xs: ReadonlyArray<Expression>) =>
        wholeTupleCall(engine, 'Apply', [literal, ...xs], target);
      // A list literal of tuples is the list of the applications to each
      // tuple. `wholeTupleCall` maps over a list that is not a literal.
      const list = args[0];
      const cells =
        args.length === 1 && isFunction(list, 'List')
          ? list.ops.map((t) => applied([t]))
          : undefined;
      const rewritten =
        cells === undefined
          ? applied(args)
          : cells.every((c) => c !== undefined)
            ? engine.function('List', cells as Expression[])
            : undefined;
      if (rewritten === undefined)
        throw new Error(
          `${reason}. The call is written with the body of the function ` +
            `only when each argument is a tuple of symbols and numbers, ` +
            `or the one argument is a list of such tuples.`
        );
      return `(${core.compile(rewritten, target)})`;
    }
  }

  // PYTHON. The block binds the local as a Python value
  // (`h = lambda k: k + 1`), and a call is compiled as a direct call of it,
  // `h(n)`. A direct call agrees with the interpreter only when no argument
  // can be a collection: the interpreter maps a function over a list
  // argument (and binds it whole at a collection parameter), and this
  // target has no run-time dispatch that tells the two apart, as
  // `_SYS.bcastFn` does on JavaScript. The run-time tests of the
  // JavaScript call are not spelled on Python either: a test of a
  // declared parameter type and a test that an argument is present. Each
  // of these shapes fails closed, and the interpreter evaluates the call.
  // CE-237.
  if (target.language === 'python') {
    const reason = (why: string): Error =>
      new Error(
        `Could not compile a call of the block-local function \`${h}\` ` +
          `on the Python target: ${why} The interpreter evaluates it instead.`
      );
    if (checked)
      throw reason(
        `a declared parameter type is not proved by the type of its ` +
          `argument, and the Python call does not test it at run time.`
      );
    const notScalar = args.findIndex((a) => {
      const t = resolveTypeForCompilation(a.type.type);
      return !(
        t !== 'never' &&
        (isSubtype(t, 'number') ||
          isSubtype(t, 'boolean') ||
          isSubtype(t, 'string'))
      );
    });
    if (notScalar >= 0)
      throw reason(
        `argument ${notScalar + 1} has the type ` +
          `\`${typeToString(args[notScalar].type.type)}\`, which is not ` +
          `provably a number, a boolean or a string. The interpreter maps ` +
          `a function over a list argument, and the Python call passes ` +
          `the argument whole.`
      );
    if (
      absentArgumentChecks(h, literal, args, target).some(
        (c) => c !== undefined
      )
    )
      throw reason(
        `an argument may be absent at a parameter whose declared type ` +
          `refuses an absent value, and the Python call does not test it ` +
          `at run time.`
      );
    const callee = target.var(h) ?? h;
    return `${callee}(${args
      .map((a) => compileValueOperand(a, target))
      .join(', ')})`;
  }

  // Parameter-typed, not argument-typed — see the sibling computation in
  // `ensureUserFunctionEmitted` for why.
  //
  // A bound that is a NON-REAL NUMBER type used to decline here, and no
  // longer does. A quantified parameter is ERASED before the literal's body
  // canonicalizes (rule G1), so the parameter symbol's own type says nothing
  // about the bound: the local's body — emitted by the ordinary
  // function-literal lowering — computed in the REAL lane while this
  // coercion handed it a `{ re, im }` object it multiplied as a number. That
  // lowering now reads the same ground bound this route reads, puts such a
  // parameter in the complex lane through a shape frame, and coerces at the
  // value splice (see the `Function` case of `compileExpr`), so the two
  // halves of the boundary agree and the local compiles as the engine-level
  // spelling of the same function does.
  const coerceToComplex = args.map((_a, i) => {
    if (target.language !== 'javascript') return false;
    const pt = signatureParamType(signature, i);
    return pt !== undefined && isNonRealNumber(pt);
  });

  // A declared parameter type that the static type of its argument does
  // not prove is tested at run time (`localParameterChecks`), by a callee
  // that tests the arguments and then calls the local.
  const local = target.var(h) ?? h;
  return emitUserFunctionCall(
    !checked
      ? local
      : target.language === 'interval-javascript'
        ? intervalCheckingCallee(local, parameterChecks, target)
        : localCheckingCallee(local, parameterChecks, target, signature),
    args,
    target,
    coerceToComplex,
    signature === undefined ? true : paramsAreScalar(signature),
    // A GENERIC callee always takes the runtime broadcast dispatch: at a
    // generic parameter the argument's static type is INFERRED FROM THE
    // BOUND rather than declared by the caller, so "provably not a
    // collection" is no proof there. Same reasoning as the engine route —
    // see the call in `tryCompileUserFunction`.
    generic,
    [],
    absentArgumentChecks(h, literal, args, target)
  );
}
