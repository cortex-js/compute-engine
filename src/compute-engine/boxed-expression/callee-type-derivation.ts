import type {
  BoxedOperatorDefinition,
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
  if (op !== undefined)
    return deriveOperator?.(op.engine, op.head, args, op.definition);
  if (args.some((d) => d.type === 'never')) return 'never';
  return deriveAnonymous?.(fn, args, context);
}
