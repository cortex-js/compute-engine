/** Internal opt-in scalar slice; intentionally absent from target registration. */
import type { Type } from '../../common/type/types.js';
import type { Expression } from '../global-types.js';
import type { CompilationOptions, CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { JavaScriptTarget } from './javascript-target.js';
import { BaseCompiler } from './base-compiler.js';
import { CompilerState } from './compiler-state.js';
import { realOnlyLoweringOf } from './compiler-core.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { declaredTypeSource } from './compile-declarations.js';
import {
  userFunctionLiteral,
  userFunctionSignature,
} from './compile-assignment-checks.js';
import { isLibraryOperator } from './builtin-callback.js';
import {
  typeFragment,
  walkIf,
  walkBlock,
  walkAssign,
  type FragmentDeclaredInput,
  type FragmentDefinition,
  type FragmentRule,
  type FragmentFunction,
  type FragmentScope,
} from './fragment.js';
import {
  attachScalarFragment,
  type ScalarRepresentation,
  type ScalarFragmentHelper,
  type ScalarFragmentCapture,
} from './javascript-fragment-facts.js';

// Each operator states its own rule for a real or a complex result. There
// is no shared default: a rule that reads "a complex operand gives a complex
// result" is right for `Add` and `Negate`, and wrong for an operator whose
// result can be complex for real operands, or real for complex operands.

/** `Add`: the sum is complex when one of its operands is complex; each real
 *  operand of a complex sum is converted (`real-to-complex`). Otherwise the
 *  sum is real. Reads only the facts of the operands. */
const addRule = {
  walk: (node, scope, context, w) => {
    const lane = (isFunction(node) ? node.ops : []).some(
      (operand) => w.value(operand, scope, context).representation === 'complex'
    )
      ? 'complex'
      : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], rest: lane, result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/** `Negate`: complex when its one operand is complex, otherwise real. Reads
 *  only the facts of the operand. */
const negateRule = {
  walk: (node, scope, context, w) => {
    const operand = isFunction(node) ? node.ops[0] : undefined;
    const lane =
      operand !== undefined &&
      w.value(operand, scope, context).representation === 'complex'
        ? 'complex'
        : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * `Sqrt` is the one operator whose result is still decided by the reader of
 * the existing compiler, `isComplexValued()`. The square root of a real
 * operand is complex when the operand is provably negative, or, in the
 * `complex` mode, when its sign is not known; that domain and promotion
 * policy is not yet a rule of this pass (step 5 of
 * `docs/plans/2026-11-09-js-compiler-status-and-plan.md`). The reader
 * depends on the compiler state of the compilation, so the annotation of a
 * program with a `Sqrt` is built under that state
 * (`withOutermostCompilerState()`).
 */
const sqrtRule = {
  walk: (node, scope, context, w) => {
    const lane = BaseCompiler.isComplexValued(node) ? 'complex' : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

const definition: FragmentDefinition<ScalarRepresentation> = {
  name: 'JS scalar',
  rules: {
    Add: addRule,
    Negate: negateRule,
    Sqrt: sqrtRule,
    If: { walk: walkIf },
  },
  typeOfSymbol(node) {
    const type = node.type.type;
    if (isSubtype(type, 'boolean')) return { kind: 'boolean' };
    if (isSubtype(type, 'integer')) return { kind: 'integer' };
    if (isSubtype(type, 'real')) return { kind: 'real' };
    if (isSubtype(type, 'complex')) return { kind: 'complex' };
    return undefined;
  },
  representationOfBinding: representation,
  representationOfValue: representation,
  functionOf: () => undefined,
};
function representation(type: {
  kind: string;
}): ScalarRepresentation | undefined {
  if (type.kind === 'integer' || type.kind === 'real') return 'number';
  if (type.kind === 'boolean' || type.kind === 'complex') return type.kind;
  return undefined;
}

export class ScalarFragmentJavaScriptTarget extends JavaScriptTarget {
  protected prepareCompilation(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    if (
      batch !== undefined ||
      options.broadcast ||
      options.functions ||
      options.operators ||
      options.vars ||
      options.preamble ||
      options.imports?.length ||
      (options.mode !== undefined &&
        options.mode !== 'strict' &&
        options.mode !== 'complex')
    )
      throw new Error('JS scalar fragment: unsupported compile options');
    const prepared = super.prepareCompilation(expr, options);
    // The annotation, with the facts of the body of a root function and of
    // the helper definition, is built here, before any emission.
    if (isFunction(prepared.expr, 'Function')) {
      attachBoundFunction(prepared.expr, prepared.target);
      return prepared;
    }
    const named: NamedCalls = { calls: new Set() };
    const seen = new Set<Expression>();
    let readsSqrt = false;
    const check = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);
      if (!node.isValid || node.type.type === 'error')
        throw new Error('JS scalar fragment: invalid expression');
      if (isNumber(node)) return;
      if (isSymbol(node)) {
        if (node.symbol === 'True' || node.symbol === 'False') return;
        if (
          node.valueDefinition?.value !== undefined ||
          definition.typeOfSymbol(node) === undefined
        )
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}`
          );
        return;
      }
      if (isFunction(node) && !Object.hasOwn(definition.rules, node.operator)) {
        collectHelper(node, prepared.target, named);
        for (const operand of node.ops) check(operand);
        return;
      }
      if (
        !isFunction(node) ||
        !Object.hasOwn(definition.rules, node.operator) ||
        !isLibraryOperator(node, node.operator)
      )
        throw new Error(
          `JS scalar fragment: unsupported head ${node.operator}`
        );
      if (
        (node.operator === 'If' && node.nops !== 3) ||
        ((node.operator === 'Sqrt' || node.operator === 'Negate') &&
          node.nops !== 1)
      )
        throw new Error('JS scalar fragment: unsupported arity');
      checkCondition(node);
      if (node.operator === 'Sqrt') readsSqrt = true;
      for (const operand of node.ops) check(operand);
    };
    check(prepared.expr);
    const annotate = () => annotateCalls(prepared.expr, definition, named);
    attachScalarFragment(prepared.target, {
      root: prepared.expr,
      helper: named.helper,
      annotation: readsSqrt
        ? withOutermostCompilerState(prepared.target, annotate)
        : annotate(),
    });
    return prepared;
  }
}

/**
 * Refuse an `If` whose condition the fragment does not lower as a test of a
 * boolean at run time. A condition whose type is the value `true` or `false`
 * is decided by the existing emitter at compile time, which writes one
 * branch only and no test; the annotation has facts for the test and both
 * branches. A condition whose type is not `boolean` would need a guard.
 */
function checkCondition(node: Expression): void {
  if (!isFunction(node, 'If') || node.nops !== 3) return;
  const type = node.op1.type.type;
  if (
    typeof type === 'object' &&
    type.kind === 'value' &&
    typeof type.value === 'boolean'
  )
    throw new Error(
      `JS scalar fragment: the condition of If has the constant type ${type.value}`
    );
  if (!isSubtype(type, 'boolean'))
    throw new Error(
      'JS scalar fragment: the condition of If does not have the type boolean'
    );
}

/**
 * Run `analyze` with the compiler state that the outermost compilation of
 * `target` installs before it emits (`compileExpressionInFrame()` in
 * `compiler-core.ts`): the mode, the integer lane, the real-only lowerings,
 * the target whose constant folds decide a representation, the names that
 * the target binds, the target of the call site (which tells whether the
 * complex continuation lowerings of JavaScript apply), and an empty list of
 * unrolled index values. `isComplexValued()`, which the `Sqrt` rule calls,
 * reads this state, and the annotation is built in `prepareCompilation()`,
 * before the compilation installs it. The state is restored after.
 *
 * Inside another compilation the state belongs to that compilation, and its
 * memo of `isComplexValued()` answers would keep answers made under this
 * state: the fragment is refused there.
 */
function withOutermostCompilerState<T>(
  target: CompileTarget<Expression>,
  analyze: () => T
): T {
  if (CompilerState._compileDepth !== 0)
    throw new Error(
      'JS scalar fragment: a square root inside another compilation is not supported'
    );
  const mode = BaseCompiler.resolveCompileMode(target);
  const saved = {
    mode: CompilerState._mode,
    integerLane: CompilerState._integerLane,
    realOnlyLowering: CompilerState._realOnlyLowering,
    oracleFoldTarget: CompilerState._oracleFoldTarget,
    boundVarsCtx: CompilerState._boundVarsCtx,
    callSiteTarget: CompilerState._callSiteTarget,
    unrolledIndexValues: CompilerState._unrolledIndexValues,
  };
  CompilerState._mode = mode === 'bigint' ? 'strict' : mode;
  CompilerState._integerLane = mode === 'bigint' ? 'bigint' : 'double';
  CompilerState._realOnlyLowering = realOnlyLoweringOf(target);
  CompilerState._callSiteTarget = target;
  CompilerState._unrolledIndexValues = [];
  CompilerState._oracleFoldTarget =
    target.language === 'javascript' &&
    target.constantFold !== false &&
    target.symbolDeps === undefined
      ? target
      : undefined;
  CompilerState._boundVarsCtx = target.boundVars ?? saved.boundVarsCtx;
  try {
    return analyze();
  } finally {
    CompilerState._mode = saved.mode;
    CompilerState._integerLane = saved.integerLane;
    CompilerState._realOnlyLowering = saved.realOnlyLowering;
    CompilerState._oracleFoldTarget = saved.oracleFoldTarget;
    CompilerState._boundVarsCtx = saved.boundVarsCtx;
    CompilerState._callSiteTarget = saved.callSiteTarget;
    CompilerState._unrolledIndexValues = saved.unrolledIndexValues;
  }
}

/** Map a declared scalar type to the fragment type. */
function scalarType(type: Type) {
  if (isSubtype(type, 'boolean')) return { kind: 'boolean' } as const;
  if (isSubtype(type, 'integer')) return { kind: 'integer' } as const;
  if (isSubtype(type, 'real')) return { kind: 'real' } as const;
  if (isSubtype(type, 'complex')) return { kind: 'complex' } as const;
  return undefined;
}

function attachBoundFunction(
  fn: Expression,
  target: CompileTarget<Expression>
): void {
  if (!isFunction(fn, 'Function')) return;
  if (!isLibraryOperator(fn, 'Function'))
    throw new Error('JS scalar fragment: shadowed function constructor');
  const inputs: FragmentDeclaredInput[] = [];
  for (const parameter of fn.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const declared = functionLiteralParameterType(parameter);
    const type = declared === undefined ? undefined : scalarType(declared);
    if (
      !isFunction(parameter, 'Typed') ||
      parameter.nops !== 2 ||
      !name ||
      !type ||
      name === 'True' ||
      name === 'False' ||
      inputs.some((input) => input.name === name)
    )
      throw new Error(
        'JS scalar fragment: explicit distinct scalar parameters required'
      );
    inputs.push({ name, type, declared: type.kind });
  }
  const body = fn.op1.canonical;
  if (
    !isFunction(body, 'Block') ||
    body.nops < 2 ||
    !isLibraryOperator(body, 'Block')
  )
    throw new Error(
      'JS scalar fragment: a bound body requires one straight-line block'
    );
  const declaration = body.op1;
  if (
    !isFunction(declaration, 'Declare') ||
    !isLibraryOperator(declaration, 'Declare') ||
    declaration.nops !== 3 ||
    !isSymbol(declaration.op1)
  )
    throw new Error(
      'JS scalar fragment: one explicit initialized local required'
    );
  const local = declaration.op1.symbol;
  const declared = declaredTypeSource(declaration.op2);
  if (
    !declared ||
    !['real', 'integer', 'complex', 'boolean'].includes(declared) ||
    inputs.some((input) => input.name === local) ||
    local === 'True' ||
    local === 'False'
  )
    throw new Error('JS scalar fragment: unsupported local declaration');
  const names = new Set(inputs.map((input) => input.name));
  const bindings = new Set([...names, local]);
  const named: NamedCalls = { calls: new Set() };
  const checkValue = (node: Expression): void => {
    if (!node.isValid || node.type.type === 'error')
      throw new Error('JS scalar fragment: invalid bound expression');
    if (isNumber(node)) return;
    if (isSymbol(node)) {
      if (
        names.has(node.symbol) ||
        node.symbol === 'True' ||
        node.symbol === 'False'
      )
        return;
      throw new Error(`JS scalar fragment: unsupported capture ${node.symbol}`);
    }
    if (isFunction(node) && !['Add', 'Negate', 'If', 'Sqrt'].includes(node.operator)) {
      collectHelper(node, target, named);
      const helper = named.helper!;
      if (bindings.has(helper.name) || [...(helper.capture?.symbols ?? [])]
          .some(symbol => isSymbol(symbol) && bindings.has(symbol.symbol)))
        throw new Error('JS scalar fragment: helper bindings collide with the root function');
      for (const operand of node.ops) checkValue(operand);
      return;
    }
    // Sqrt is excluded here: a write can change the sign of a local, so its
    // initializer cannot determine whether a later square root is complex.
    if (
      !isFunction(node) ||
      !['Add', 'Negate', 'If'].includes(node.operator) ||
      !isLibraryOperator(node, node.operator) ||
      (node.operator === 'Negate' && node.nops !== 1) ||
      (node.operator === 'If' && node.nops !== 3)
    )
      throw new Error(
        `JS scalar fragment: unsupported bound head ${node.operator}`
      );
    checkCondition(node);
    for (const operand of node.ops) checkValue(operand);
  };
  // The representation of a local declared `integer` is `number`, as for a
  // `real`, so the check of the representation of a write does not refuse a
  // real value. The interpreter refuses it, so the type of each value that
  // is written must prove `integer`.
  const checkWrite = (value: Expression): void => {
    if (declared === 'integer' && !isSubtype(value.type.type, 'integer'))
      throw new Error(
        `JS scalar fragment: a value written to the integer local ${local} ` +
          `does not have the type integer`
      );
  };
  checkValue(declaration.op3);
  checkWrite(declaration.op3);
  names.add(local);
  for (const statement of body.ops.slice(1, -1)) {
    if (
      !isFunction(statement, 'Assign') ||
      !isLibraryOperator(statement, 'Assign') ||
      statement.nops !== 2 ||
      !isSymbol(statement.op1) ||
      statement.op1.symbol !== local
    )
      throw new Error(
        'JS scalar fragment: only writes to the declared local are supported'
      );
    checkValue(statement.op2);
    checkWrite(statement.op2);
  }
  checkValue(body.ops[body.nops - 1]);
  const boundDefinition: FragmentDefinition<ScalarRepresentation> = {
    ...definition,
    rules: {
      Add: addRule,
      Negate: negateRule,
      If: { walk: walkIf },
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
    },
  };
  attachScalarFragment(target, {
    root: body,
    functionRoot: fn,
    helper: named.helper,
    annotation: (() => {
      const annotation = annotateCalls(body, boundDefinition, named, inputs, body);
      const scope = annotation.scope.inner.get(body);
      const binding = scope?.bindings.get(local);
      if (!scope || !binding || !('representation' in binding))
        throw new Error('JS scalar fragment invariant: missing local binding');
      for (const statement of body.ops.slice(0, -1)) {
        if (!isFunction(statement)) continue;
        const value =
          statement.operator === 'Declare' ? statement.op3 : statement.op2;
        const valueFacts = scope.facts.get(value);
        if (
          !valueFacts ||
          !('representation' in valueFacts) ||
          valueFacts.representation !== binding.representation
        )
          throw new Error(
            'JS scalar fragment: local writes must preserve representation'
          );
      }
      return annotation;
    })(),
  });
}


type ResolvedHelper = ScalarFragmentHelper & {
  readonly binding: object;
  readonly resultRepresentation: ScalarRepresentation;
  readonly fragment: Omit<FragmentFunction, 'arguments'>;
};

type NamedCalls = { helper?: ResolvedHelper; calls: Set<Expression> };

function collectHelper(node: Expression, target: CompileTarget<Expression>, named: NamedCalls): void {
  const resolved = resolveHelper(node, target);
  const helper = named.helper;
  if (helper && (helper.name !== resolved.name || helper.binding !== resolved.binding ||
      helper.literal !== resolved.literal || helper.body !== resolved.body))
    throw new Error('JS scalar fragment: only one resolved helper is supported');
  named.helper ??= resolved;
  named.calls.add(node);
}

/**
 * Type the root and check the helper's return representation against its
 * signature. Check each call's argument conversions in its root or block scope.
 */
function annotateCalls(
  root: Expression,
  base: FragmentDefinition<ScalarRepresentation>,
  named: NamedCalls,
  inputs?: FragmentDeclaredInput[],
  block?: Expression
) {
  const { helper, calls } = named;
  const definition = helper === undefined ? base : {
    ...base,
    rules: { ...base.rules, Block: { walk: walkBlock } },
    storedValue: (node: Expression) => {
      const capture = helper.capture;
      if (!capture?.symbols.has(node)) return undefined;
      capture.assertCurrent();
      return capture.value;
    },
    functionOf: (call: Expression) => calls.has(call) && isFunction(call)
      ? { ...helper.fragment, arguments: call.ops } : undefined,
  };
  const annotation = typeFragment(root, definition, { inputs });
  if (annotation.refusal)
    throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
  refuseClosedComplex(annotation.scope);
  for (const fn of annotation.functions.values()) refuseClosedComplex(fn.scope);
  if (helper) {
    const entry = annotation.functions.get(helper.name);
    if (!entry || entry.body !== helper.body || entry.type.kind !== 'function' ||
        representation(entry.type.result) !== helper.resultRepresentation)
      throw new Error('JS scalar fragment: helper return representation differs from its signature');
    const scope: FragmentScope<ScalarRepresentation> | undefined = block === undefined
      ? annotation.scope : annotation.scope.inner.get(block);
    for (const call of calls) {
      const facts = scope?.facts.get(call);
      if (!facts || !('representation' in facts) ||
          facts.conversions?.some(conversion => conversion.kind !== 'none'))
        throw new Error('JS scalar fragment: helper arguments must preserve representation');
    }
  }
  return annotation;
}

/**
 * Refuse a function node of `scope` (and of the scopes it opens) whose fact
 * is `complex` and that reads no free symbol: no input, no parameter and no
 * local (`unknowns` lists each of them, also in the body of a function).
 * With `constantFold` on, the compiler replaces such a node with a real
 * literal when its value is real (`tryConstantFold()` in
 * `compile-folding.ts`, through `_withFoldedRealOverride()` in
 * `compiler-mode.ts`), whatever its operator. The fact of the node does not
 * come from that value: the fact of an `If` comes from its branches, and
 * the fact of a helper call from the declared result. The emitted code
 * would then be a number where the fact is complex, and a complex parent
 * would read that number as `{re, im}`. For example, with
 * `p: (boolean) -> boolean`, the `If` of `x + If(p(True), 1, Sqrt(-2))` is
 * written `1`. `Sqrt` is not refused: its fact comes from
 * `isComplexValued()`, the reader that the fold also reads.
 */
function refuseClosedComplex(scope: FragmentScope<ScalarRepresentation>) {
  for (const [node, facts] of scope.facts)
    if (
      isFunction(node) &&
      node.operator !== 'Sqrt' &&
      'representation' in facts &&
      facts.representation === 'complex' &&
      node.unknowns.length === 0
    )
      throw new Error(
        `JS scalar fragment: a closed ${node.operator} with a complex value is not supported`
      );
  for (const inner of scope.inner.values()) refuseClosedComplex(inner);
}

function resolveHelper(
  call: Expression,
  target: CompileTarget<Expression>
): ResolvedHelper {
  if (!isFunction(call))
    throw new Error('JS scalar fragment: expected helper call');
  const binding = call.valueDefinition ?? call.operatorDefinition;
  const held =
    call.valueDefinition?.value ??
    (call.operatorDefinition as { _lambdaLiteral?: Expression } | undefined)
      ?._lambdaLiteral;
  if (!binding || !held || !isFunction(held, 'Function'))
    throw new Error(`JS scalar fragment: unsupported head ${call.operator}`);
  BaseCompiler.assertCapturedCallableBindings(call, target);
  const literal = userFunctionLiteral(call.engine, call.operator);
  if (literal !== held)
    throw new Error('JS scalar fragment: helper definition identity differs');
  const signature = userFunctionSignature(call.engine, call.operator);
  const result =
    signature === undefined ? undefined : scalarType(signature.result);
  if (
    !signature ||
    !result ||
    signature.optArgs?.length ||
    signature.variadicArg ||
    signature.typeParams?.length ||
    signature.effects?.length
  )
    throw new Error(
      'JS scalar fragment: helper requires one pure scalar signature'
    );
  const parameters: string[] = [];
  const parameterTypes: NonNullable<ReturnType<typeof scalarType>>[] = [];
  const parameterSymbols: Expression[] = [];
  for (const parameter of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    const scalar = type === undefined ? undefined : scalarType(type);
    if (
      !isFunction(parameter, 'Typed') ||
      parameter.nops !== 2 ||
      !name ||
      !scalar ||
      parameters.includes(name) ||
      name === 'True' ||
      name === 'False'
    )
      throw new Error(
        'JS scalar fragment: helper requires explicit scalar parameters'
      );
    const declared = signature.args?.[parameters.length]?.type;
    const declaredScalar =
      declared === undefined ? undefined : scalarType(declared);
    if (
      !declaredScalar ||
      representation(declaredScalar) !== representation(scalar)
    )
      throw new Error(
        'JS scalar fragment: helper parameter representation differs from signature'
      );
    parameters.push(name);
    parameterTypes.push(scalar);
    parameterSymbols.push(parameter.op1);
  }
  if ((signature.args?.length ?? 0) !== parameters.length)
    throw new Error('JS scalar fragment: helper signature arity differs');
  const body = literal.op1.canonical;
  let capture: ScalarFragmentCapture | undefined;
  const captureSymbols = new Set<Expression>();
  const check = (node: Expression, root = false): void => {
    if (!node.isValid || node.type.type === 'error')
      throw new Error('JS scalar fragment: invalid helper body');
    if (isNumber(node)) return;
    if (isSymbol(node)) {
      if (
        parameters.includes(node.symbol) ||
        node.symbol === 'True' ||
        node.symbol === 'False'
      )
        return;
      const binding = node.valueDefinition;
      const value = binding?.value;
      const ambient = node.engine.lookupDefinition(node.symbol);
      if (
        !binding ||
        binding.inferredType ||
        !isSubtype(binding.type.type, 'real') ||
        !value ||
        !isNumber(value) ||
        !Number.isFinite(value.re) ||
        value.im !== 0 ||
        !ambient ||
        !('value' in ambient) ||
        ambient.value !== binding ||
        node.engine._getSymbolValue(node.symbol) !== value
      )
        throw new Error(
          `JS scalar fragment: unsupported helper capture ${node.symbol}`
        );
      if (
        capture &&
        !capture.symbols.has(node) &&
        [...capture.symbols][0].valueDefinition !== binding
      )
        throw new Error(
          'JS scalar fragment: only one numeric capture is supported'
        );
      const declaredType = binding.type.type;
      captureSymbols.add(node);
      capture ??= {
        symbols: captureSymbols,
        value,
        assertCurrent: () => {
          const current = node.engine.lookupDefinition(node.symbol);
          if (
            !current ||
            !('value' in current) ||
            current.value !== binding ||
            node.valueDefinition !== binding ||
            binding.inferredType ||
            binding.type.type !== declaredType ||
            binding.value !== value ||
            node.engine._getSymbolValue(node.symbol) !== value
          )
            throw new Error(
              'JS scalar fragment invariant: different captured binding or value'
            );
        },
      };
      return;
    }
    if (
      !isFunction(node) ||
      !isLibraryOperator(node, node.operator) ||
      !(
        node.operator === 'Add' ||
        (node.operator === 'Negate' && node.nops === 1) ||
        (node.operator === 'If' && node.nops === 3) ||
        (root && node.operator === 'Block' && node.nops === 1)
      )
    )
      throw new Error(
        `JS scalar fragment: unsupported helper body ${node.operator}`
      );
    checkCondition(node);
    for (const operand of node.ops) check(operand);
  };
  check(body, true);
  return {
    name: call.operator,
    literal,
    body,
    binding,
    capture,
    resultRepresentation: representation(result)!,
    fragment: {
      key: call.operator,
      name: call.operator,
      body,
      parameters,
      parameterTypes,
      parameterSymbols,
    },
  };
}
