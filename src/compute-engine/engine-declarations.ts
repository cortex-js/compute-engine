import type { Type, TypeString } from '../common/type/types';
import { isValidType, isValidTypeName, widen } from '../common/type/utils';
import { parseType } from '../common/type/parse';
import { BoxedType } from '../common/type/boxed-type';

import { isValidSymbol, validateSymbol } from '../math-json/symbols';
import type { MathJsonSymbol } from '../math-json/types';

import type {
  ValueDefinition,
  OperatorDefinition,
  AssignValue,
  Expression,
  BoxedDefinition,
  SymbolDefinition,
  IComputeEngine,
  Scope,
} from './global-types';

import { _BoxedValueDefinition } from './boxed-expression/boxed-value-definition';
import {
  isValidOperatorDef,
  isValidValueDef,
  isValueDef,
  isOperatorDef,
  updateDef,
} from './boxed-expression/utils';
import { canonicalFunctionLiteral, lookup } from './function-utils';

export function lookupDefinition(
  ce: IComputeEngine,
  id: MathJsonSymbol
): undefined | BoxedDefinition {
  return lookup(id, ce.context.lexicalScope);
}

export function declareSymbolValue(
  ce: IComputeEngine,
  name: MathJsonSymbol,
  def: Partial<ValueDefinition>,
  scope?: Scope
): BoxedDefinition {
  scope ??= ce.context.lexicalScope;

  // Insert a placeholder in the bindings to handle recursive calls
  // (the value could be a function that references itself)
  scope.bindings.set(name, {
    value: new _BoxedValueDefinition(ce, name, {
      type: 'unknown',
      inferred: true,
    }),
  });

  const boxedDef = scope.bindings.get(name)!;
  updateDef(ce, name, boxedDef, def);

  ce._generation += 1;

  return boxedDef;
}

export function declareSymbolOperator(
  ce: IComputeEngine,
  name: string,
  def: OperatorDefinition,
  scope?: Scope
): BoxedDefinition {
  scope ??= ce.context.lexicalScope;
  // Insert a placeholder in the bindings to handle recursive calls
  // (the function is not yet defined)
  scope.bindings.set(name, {
    value: new _BoxedValueDefinition(ce, name, { type: 'function' }),
  });

  const boxedDef = scope.bindings.get(name)!;
  updateDef(ce, name, boxedDef, def);

  ce._generation += 1;

  return boxedDef;
}

export function getSymbolValue(
  ce: IComputeEngine,
  id: MathJsonSymbol
): Expression | undefined {
  const def = lookup(id, ce.context.lexicalScope);
  if (!def || !isValueDef(def)) return undefined;
  return def.value.value;
}

export function setSymbolValue(
  ce: IComputeEngine,
  id: MathJsonSymbol,
  value: Expression | boolean | number | undefined
): void {
  if (typeof value === 'number') value = ce.number(value);
  else if (typeof value === 'boolean') value = value ? ce.True : ce.False;

  const def = lookup(id, ce.context.lexicalScope);
  if (!def) throw new Error(`Unknown symbol "${id}"`);

  if (isValueDef(def)) {
    def.value.value = value;
    ce._generation += 1;
    return;
  }

  // Operator definition: cannot set a plain value on an operator symbol
  throw new Error(`Cannot assign a value to operator symbol "${id}"`);
}

export function declareType(
  ce: IComputeEngine,
  name: string,
  type: BoxedType | Type | TypeString,
  { alias }: { alias?: boolean } = {}
): void {
  if (!isValidTypeName(name)) throw Error(`The type name "${name}" is invalid`);

  // Is the type already defined in this scope?
  const scope = ce.context.lexicalScope;
  if (scope.types?.[name])
    throw Error(`The type "${name}" is already defined in the current scope`);

  scope.types ??= {};

  alias ??= false; // Nominal by default

  // First, add a placeholder record to allow recursive types
  scope.types[name] = { kind: 'reference', name, alias, def: undefined };

  // Parse the type (which may reference itself)
  const def =
    type instanceof BoxedType
      ? type.type
      : typeof type === 'string'
      ? parseType(type, ce._typeResolver)
      : type;

  // Adjust the definition (the type references in the type will point to
  // the placeholder record)
  scope.types[name].def = def;
}

export function declareFn(
  ce: IComputeEngine,
  arg1:
    | string
    | {
        [id: string]: Type | TypeString | Partial<SymbolDefinition>;
      },
  arg2?: Type | TypeString | Partial<SymbolDefinition>,
  scope?: Scope
): IComputeEngine {
  //
  // If the argument is an object literal, call `declare` for each entry
  //
  if (typeof arg1 !== 'string') {
    for (const [id, def] of Object.entries(arg1)) ce.declare(id, def);
    return ce;
  }

  const id = arg1;

  // The special id `Nothing` can never be redeclared.
  // It is also used to indicate that a symbol should be ignored,
  // so it's valid, but it doesn't do anything.
  if (id === 'Nothing') return ce;

  // Can't "undeclare" (set to `undefined`/`null`) a symbol either
  // (but its value can be set to `undefined` with `ce.assign()`)
  if (arg2 === undefined || arg2 === null)
    throw Error(`Expected a definition or type for "${id}"`);

  // Check the id is valid
  if (typeof id !== 'string' || id.length === 0 || !isValidSymbol(id)) {
    throw new Error(`Invalid symbol "${id}": ${validateSymbol(id)}`);
  }

  scope ??= ce.context.lexicalScope;

  //
  // Check the id is not already declared in the current scope
  //
  const bindings = scope.bindings;
  if (bindings.has(id))
    throw new Error(`The symbol "${id}" is already declared in this scope`);

  //
  // Declaring a symbol or function with a definition or type
  //

  const def = arg2;

  if (isValidValueDef(def)) {
    ce._declareSymbolValue(id, def, scope);
    return ce;
  }

  if (isValidOperatorDef(def)) {
    ce._declareSymbolOperator(id, def, scope);
    return ce;
  }

  //
  // Declaring a symbol with a type
  // `ce.declare("f", "number -> number")`
  // `ce.declare("z", "complex")`
  // `ce.declare("n", "integer")`
  //
  {
    const type = parseType(def, ce._typeResolver);
    if (!isValidType(type)) {
      throw Error(
        [
          `Invalid argument for "${id}"`,
          JSON.stringify(def, undefined, 4),
          `Use a type, a \`OperatorDefinition\` or a \`ValueDefinition\``,
        ].join('\n|   ')
      );
    }

    ce._declareSymbolValue(id, { type }, scope);
  }

  return ce;
}

export function assignFn(
  ce: IComputeEngine,
  arg1: string | { [id: string]: AssignValue },
  arg2?: AssignValue
): IComputeEngine {
  //
  // If the first argument is an object literal, call `assign()` for each key
  //
  if (typeof arg1 === 'object') {
    console.assert(arg2 === undefined);
    for (const [id, def] of Object.entries(arg1)) ce.assign(id, def);
    return ce;
  }

  const id = arg1;

  // Cannot set the value of 'Nothing'
  // @todo: could have a 'locked' attribute on the definition
  if (id === 'Nothing') return ce;

  const def = ce.lookupDefinition(id);

  if (isOperatorDef(def)) {
    const value = assignValueAsValue(ce, arg2);
    if (value !== undefined) {
      // Allow converting an operator to a value.
      // Existing expressions using this symbol as a function head (e.g.
      // ["g", 2]) will produce a type error at evaluation time if the
      // new value is not callable — which is the correct semantic.
      updateDef(ce, id, def, { value });
      ce._setSymbolValue(id, value);
      return ce;
    }

    // Update the operator definition.
    const fnDef = assignValueAsOperatorDef(ce, arg2);
    if (!fnDef) throw Error(`Invalid definition for symbol "${id}"`);
    updateDef(ce, id, def, fnDef);
    return ce;
  }

  //
  // 1/ We were given a value
  //
  const value = assignValueAsValue(ce, arg2);
  if (value !== undefined) {
    if (!def) {
      // No previous definition: create a new one
      ce._declareSymbolValue(id, { value });
      return ce;
    }
    if (def.value.isConstant)
      throw Error(`Cannot assign a value to the constant "${id}"`);

    // We have a value definition, update the inferred type...
    if (def.value.inferredType)
      def.value.type = ce.type(widen(def.value.type.type, value.type.type));

    // ... and set the value
    ce._setSymbolValue(id, value);

    return ce;
  }

  //
  // 2/ We were given an operator definition
  //
  const fnDef = assignValueAsOperatorDef(ce, arg2);
  if (fnDef === undefined) throw Error(`Invalid definition for symbol "${id}"`);

  if (def) {
    // If we get here, the previous definition was a value definition.
    // We can update it to an operator definition.
    console.assert(isValueDef(def));
    // updateDef removes def.value and sets def.operator — no separate
    // _setSymbolValue call needed to clear the old value.
    updateDef(ce, id, def, fnDef);
  } else {
    // No previous definition: create a new one
    ce.declare(id, fnDef);
  }

  return ce;
}

function assignValueAsValue(
  ce: IComputeEngine,
  value: AssignValue
): Expression | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'function') return undefined;

  if (typeof value === 'boolean') return value ? ce.True : ce.False;
  if (typeof value === 'number' || typeof value === 'bigint')
    return ce.number(value);
  const expr = ce.expr(value);
  // Explicit function expressions should always be treated as operator definitions
  if (expr.operator === 'Function') return undefined;
  if (expr.unknowns.some((s) => s.startsWith('_'))) {
    // If the expression has wildcards, it should be treated as a function
    // E.g. ["Add", "_", 1] or ["Add", "_x", 1]
    // Note: Regular unknowns (e.g., "x", "a", "b") are fine in values
    return undefined;
  }
  return expr;
}

function assignValueAsOperatorDef(
  ce: IComputeEngine,
  value: AssignValue
): OperatorDefinition | undefined {
  if (typeof value === 'function')
    return { evaluate: value, signature: 'function' };

  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return undefined;

  const body = canonicalFunctionLiteral(ce.expr(value));
  if (body === undefined) return undefined;

  // Don't set an explicit signature - let it be inferred from the body.
  // This ensures inferredSignature = true, which allows the return type
  // to be properly narrowed during type checking (e.g., in Add operands).
  return { evaluate: body };
}
