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
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { declaredTypeSource } from './compile-declarations.js';
import { userFunctionLiteral, userFunctionSignature } from './compile-assignment-checks.js';
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
} from './fragment.js';
import {
  attachScalarFragment,
  type ScalarRepresentation,
  type ScalarFragmentHelper,
} from './javascript-fragment-facts.js';

const numericRule = {
  walk: (node, scope, context, w) => {
    const lane = BaseCompiler.isComplexValued(node) ? 'complex' : 'real';
    return w.signatures(node, scope, context, [
      {
        operands: [lane],
        ...(node.operator === 'Add' ? { rest: lane } : {}),
        result: lane,
      },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;
const definition: FragmentDefinition<ScalarRepresentation> = {
  name: 'JS scalar',
  rules: {
    Add: numericRule,
    Negate: numericRule,
    Sqrt: numericRule,
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
    if (isFunction(prepared.expr, 'Function')) {
      attachBoundFunction(prepared.expr, prepared.target);
      return prepared;
    }
    let helper: ResolvedHelper | undefined;
    const calls = new Set<Expression>();
    const seen = new Set<Expression>();
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
        const resolved = resolveHelper(node, prepared.target);
        if (helper && (helper.name !== resolved.name || helper.binding !== resolved.binding ||
            helper.literal !== resolved.literal || helper.body !== resolved.body))
          throw new Error('JS scalar fragment: only one resolved helper is supported');
        helper ??= resolved;
        calls.add(node);
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
      for (const operand of node.ops) check(operand);
    };
    check(prepared.expr);
    attachScalarFragment(prepared.target, {
      root: prepared.expr,
      helper,
      annotate: () => {
        const namedDefinition: FragmentDefinition<ScalarRepresentation> = helper === undefined
          ? definition
          : {
              ...definition,
              rules: {
                ...definition.rules,
                Add: scopedNumericRule,
                Negate: scopedNumericRule,
                Block: { walk: walkBlock },
              },
              functionOf: call => calls.has(call) && isFunction(call)
                ? { ...helper!.fragment, arguments: call.ops }
                : undefined,
            };
        const annotation = typeFragment(prepared.expr, namedDefinition);
        if (annotation.refusal)
          throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
        if (helper) {
          const entry = annotation.functions.get(helper.name);
          if (!entry || entry.body !== helper.body || entry.type.kind !== 'function' ||
              representation(entry.type.result) !== helper.resultRepresentation)
            throw new Error('JS scalar fragment: helper return representation differs from its signature');
          for (const call of calls) {
            const facts = annotation.scope.facts.get(call);
            if (!facts || !('representation' in facts) ||
                facts.conversions?.some(conversion => conversion.kind !== 'none'))
              throw new Error('JS scalar fragment: helper arguments must preserve representation');
          }
        }
        return annotation;
      },
    });
    return prepared;
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
    for (const operand of node.ops) checkValue(operand);
  };
  checkValue(declaration.op3);
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
  }
  checkValue(body.ops[body.nops - 1]);
  const boundNumeric: FragmentRule<ScalarRepresentation> = {
    walk: (node, scope, context, w) => {
      const operands = isFunction(node) ? node.ops : [];
      const complex = operands.some(
        (operand) =>
          w.value(operand, scope, context).representation === 'complex'
      );
      const lane = complex ? 'complex' : 'real';
      return w.signatures(node, scope, context, [
        {
          operands: [lane],
          ...(node.operator === 'Add' ? { rest: lane } : {}),
          result: lane,
        },
      ]);
    },
  };
  const boundDefinition: FragmentDefinition<ScalarRepresentation> = {
    ...definition,
    rules: {
      Add: boundNumeric,
      Negate: boundNumeric,
      If: { walk: walkIf },
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
    },
  };
  attachScalarFragment(target, {
    root: body,
    functionRoot: fn,
    annotate: () => {
      const annotation = typeFragment(body, boundDefinition, { inputs });
      if (annotation.refusal)
        throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
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
    },
  });
}

/** Helper bodies have no captures or writes; scoped operand facts select lanes. */
const scopedNumericRule: FragmentRule<ScalarRepresentation> = {
  walk: (node, scope, context, w) => {
    if (context.fn === undefined) return numericRule.walk(node, scope, context, w);
    const operands = isFunction(node) ? node.ops : [];
    const lane = operands.some(operand => w.value(operand, scope, context).representation === 'complex')
      ? 'complex' : 'real';
    return w.signatures(node, scope, context, [{ operands: [lane],
      ...(node.operator === 'Add' ? { rest: lane } : {}), result: lane }]);
  },
};

type ResolvedHelper = ScalarFragmentHelper & {
  readonly binding: object;
  readonly resultRepresentation: ScalarRepresentation;
  readonly fragment: Omit<FragmentFunction, 'arguments'>;
};

function resolveHelper(call: Expression, target: CompileTarget<Expression>): ResolvedHelper {
  if (!isFunction(call)) throw new Error('JS scalar fragment: expected helper call');
  const binding = call.valueDefinition ?? call.operatorDefinition;
  const held = call.valueDefinition?.value ??
    (call.operatorDefinition as { _lambdaLiteral?: Expression } | undefined)?._lambdaLiteral;
  if (!binding || !held || !isFunction(held, 'Function'))
    throw new Error(`JS scalar fragment: unsupported head ${call.operator}`);
  BaseCompiler.assertCapturedCallableBindings(call, target);
  const literal = userFunctionLiteral(call.engine, call.operator);
  if (literal !== held)
    throw new Error('JS scalar fragment: helper definition identity differs');
  const signature = userFunctionSignature(call.engine, call.operator);
  const result = signature === undefined ? undefined : scalarType(signature.result);
  if (!signature || !result || signature.optArgs?.length || signature.variadicArg ||
      signature.typeParams?.length || signature.effects?.length)
    throw new Error('JS scalar fragment: helper requires one pure scalar signature');
  const parameters: string[] = [];
  const parameterTypes: NonNullable<ReturnType<typeof scalarType>>[] = [];
  const parameterSymbols: Expression[] = [];
  for (const parameter of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    const scalar = type === undefined ? undefined : scalarType(type);
    if (!isFunction(parameter, 'Typed') || parameter.nops !== 2 || !name || !scalar ||
        parameters.includes(name) || name === 'True' || name === 'False')
      throw new Error('JS scalar fragment: helper requires explicit scalar parameters');
    const declared = signature.args?.[parameters.length]?.type;
    const declaredScalar = declared === undefined ? undefined : scalarType(declared);
    if (!declaredScalar || representation(declaredScalar) !== representation(scalar))
      throw new Error('JS scalar fragment: helper parameter representation differs from signature');
    parameters.push(name);
    parameterTypes.push(scalar);
    parameterSymbols.push(parameter.op1);
  }
  if ((signature.args?.length ?? 0) !== parameters.length)
    throw new Error('JS scalar fragment: helper signature arity differs');
  const body = literal.op1.canonical;
  const check = (node: Expression, root = false): void => {
    if (!node.isValid || node.type.type === 'error')
      throw new Error('JS scalar fragment: invalid helper body');
    if (isNumber(node)) return;
    if (isSymbol(node)) {
      if (parameters.includes(node.symbol) || node.symbol === 'True' || node.symbol === 'False') return;
      throw new Error(`JS scalar fragment: unsupported helper capture ${node.symbol}`);
    }
    if (!isFunction(node) || !isLibraryOperator(node, node.operator) ||
        !(node.operator === 'Add' ||
          (node.operator === 'Negate' && node.nops === 1) ||
          (node.operator === 'If' && node.nops === 3) ||
          (root && node.operator === 'Block' && node.nops === 1)))
      throw new Error(`JS scalar fragment: unsupported helper body ${node.operator}`);
    for (const operand of node.ops) check(operand);
  };
  check(body, true);
  return {
    name: call.operator, literal, body, binding,
    resultRepresentation: representation(result)!,
    fragment: { key: call.operator, name: call.operator, body,
      parameters, parameterTypes, parameterSymbols },
  };
}
