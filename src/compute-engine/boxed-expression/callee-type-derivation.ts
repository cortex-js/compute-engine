import type {
  BoxedOperatorDefinition,
  Expression,
  IComputeEngine,
  OperandDescriptor,
  TypeHandlerContext,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';

// Keep definitions private to the descriptor bridge; type handlers receive
// descriptors, never an operator definition or an expression to mutate.
const operators = new WeakMap<
  OperandDescriptor,
  {
    engine: IComputeEngine;
    head: string;
    definition: BoxedOperatorDefinition;
  }
>();
let deriveOperator:
  | ((
      engine: IComputeEngine,
      head: string,
      args: readonly OperandDescriptor[],
      definition: BoxedOperatorDefinition
    ) => Type | undefined)
  | undefined;
let deriveAnonymous:
  | ((
      fn: OperandDescriptor,
      args: readonly OperandDescriptor[],
      context: TypeHandlerContext
    ) => Type | undefined)
  | undefined;

// Installed by the defining modules to avoid import cycles through library
// initialization. Both callbacks perform the same pure derivation as calls.
export function installOperatorCalleeDerivation(
  fn: NonNullable<typeof deriveOperator>
): void {
  deriveOperator = fn;
}
export function installAnonymousCalleeDerivation(
  fn: NonNullable<typeof deriveAnonymous>
): void {
  deriveAnonymous = fn;
}

let deriveSignatureResult:
  | ((
      body: Expression,
      params: ReadonlyArray<Expression>,
      bodyType: Type
    ) => Type)
  | undefined;

// Installed by `derive-application-type.ts` when it loads. The modules that
// derive the signature of a function literal (`effects-inference.ts`,
// `boxed-operator-definition.ts`) cannot import the derivation: it reads
// operand descriptors, and an import of `operand-descriptor.ts` from them
// closes a cycle of imports.
export function installSignatureResultDerivation(
  fn: NonNullable<typeof deriveSignatureResult>
): void {
  deriveSignatureResult = fn;
}

/**
 * The result type that the signature of a function literal states, from
 * `body`, the expression whose type is the result, `params`, the parameter
 * operands of the literal, and `bodyType`, the type of `body`. A parameter
 * of type `unknown` in a cell of a list literal is a cell of unknown type,
 * not a number: `x ↦ [x]` has the result `list`, not `vector<1>`
 * (`deriveSignatureResultType`, `signature-result-type.ts`).
 *
 * Before the derivation is installed (only while the modules load), the
 * result is `bodyType`.
 */
export function signatureResultType(
  body: Expression,
  params: ReadonlyArray<Expression>,
  bodyType: Type
): Type {
  return deriveSignatureResult?.(body, params, bodyType) ?? bodyType;
}
export function retainOperatorCallee(
  descriptor: OperandDescriptor,
  engine: IComputeEngine,
  head: string,
  definition: BoxedOperatorDefinition
): OperandDescriptor {
  operators.set(descriptor, { engine, head, definition });
  return descriptor;
}
export function deriveCalleeType(
  fn: OperandDescriptor,
  args: readonly OperandDescriptor[],
  context: TypeHandlerContext
): Type | undefined {
  const op = operators.get(fn);
  if (op !== undefined) {
    if (
      fn.structureOf?.()?.kind === 'function-literal' &&
      args.some((d) => d.facts.indexed === true)
    )
      return (
        deriveAnonymous?.(fn, args, context) ??
        deriveOperator?.(op.engine, op.head, args, op.definition)
      );
    return deriveOperator?.(op.engine, op.head, args, op.definition);
  }
  if (args.some((d) => d.type === 'never')) return 'never';
  return deriveAnonymous?.(fn, args, context);
}

export function isOperatorCallee(descriptor: OperandDescriptor): boolean {
  return operators.has(descriptor);
}
