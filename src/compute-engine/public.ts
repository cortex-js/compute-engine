/**
 *
 * The Compute Engine is a symbolic computation engine that can be used to
 * manipulate and evaluate mathematical expressions.
 *
 * Use an instance of {@linkcode ComputeEngine} to create boxed expressions
 * with {@linkcode ComputeEngine.parse} and {@linkcode ComputeEngine.box}.
 *
 * Use a {@linkcode BoxedExpression} object to manipulate and evaluate
 * mathematical expressions.
 *
 * @module "compute-engine"
 *
 */

import {
  BoxedExpression,
  FunctionDefinition,
  SemiBoxedExpression,
  SymbolDefinition,
} from './boxed-expression/public';

export * from './boxed-expression/public';

/**
 * A table mapping identifiers to their definition.
 *
 * Identifiers should be valid MathJSON identifiers. In addition, the
 * following rules are recommended:
 *
 * - Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 * If a semi boxed expression
 * @category Definitions
 *
 */

export type IdentifierDefinition =
  | SymbolDefinition
  | FunctionDefinition
  | SemiBoxedExpression;

/**
 * @category Definitions
 *
 */
export type IdentifierDefinitions = Readonly<{
  [id: string]: IdentifierDefinition;
}>;
