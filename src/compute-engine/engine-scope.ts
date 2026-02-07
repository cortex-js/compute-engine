import {
  BLUE,
  BOLD,
  CYAN,
  GREY,
  INVERSE_RED,
  RESET,
  YELLOW,
} from '../common/ansi-codes';

import { isValidSymbol, validateSymbol } from '../math-json/symbols';
import type { MathJsonSymbol } from '../math-json/types';

import type {
  BoxedExpression,
  BoxedDefinition,
  ComputeEngine as IComputeEngine,
  Scope,
  EvalContext,
} from './global-types';

import { ExpressionMap } from './boxed-expression/expression-map';
import { isValueDef, isOperatorDef } from './boxed-expression/utils';

export function pushScope(
  ce: IComputeEngine,
  scope?: Scope,
  name?: string
): void {
  pushEvalContext(
    ce,
    scope ?? {
      parent: ce.context?.lexicalScope,
      bindings: new Map(),
    },
    name
  );
}

export function popScope(ce: IComputeEngine): void {
  popEvalContext(ce);
}

export function pushEvalContext(
  ce: IComputeEngine,
  scope: Scope,
  name?: string
): void {
  if (!name) {
    const l = ce._evalContextStack.length;
    if (l === 0) name = 'system';
    if (l === 1) name = 'global';
    name ??= `anonymous_${l - 1}`;
  }

  //
  // The values in the evaluation context are all the non-constant symbols
  // in the scope.
  //
  const values: { [id: string]: BoxedExpression | undefined } = {};
  for (const [id, def] of scope.bindings.entries()) {
    if (isValueDef(def) && !def.value.isConstant) values[id] = def.value.value;
  }

  ce._evalContextStack.push({
    lexicalScope: scope,
    name,
    assumptions: new ExpressionMap(ce.context?.assumptions ?? []),
    values,
  });
}

export function popEvalContext(ce: IComputeEngine): void {
  ce._evalContextStack.pop();
}

export function inScope<T>(
  ce: IComputeEngine,
  scope: Scope | undefined,
  f: () => T
): T {
  if (!scope) return f();

  // Push a dummy context (@todo: we could just have a lexical scope chain instead)
  ce._evalContextStack.push({
    lexicalScope: scope,
    name: '',
    assumptions: new ExpressionMap([]),
    values: {},
  });

  try {
    return f();
  } finally {
    ce._evalContextStack.pop();
  }
}

export function printStack(
  ce: IComputeEngine,
  options?: { details?: boolean; maxDepth?: number }
): void {
  if (options) {
    options = { ...options };
    options.maxDepth ??= 1;
    options.details ??= false;
  } else options = { details: false, maxDepth: -2 };

  if (options.maxDepth !== undefined && options.maxDepth < 0)
    options.maxDepth = ce._evalContextStack.length + options.maxDepth;

  options.maxDepth = Math.min(
    ce._evalContextStack.length - 1,
    options.maxDepth!
  );

  let depth = 0;

  while (depth <= options.maxDepth) {
    const context =
      ce._evalContextStack[ce._evalContextStack.length - 1 - depth];
    if (depth === 0) console.group(`${BOLD}${BLUE}${context.name}${RESET}`);
    else
      console.groupCollapsed(
        `${BOLD}${BLUE}${context.name}${RESET} ${GREY}(${depth})${RESET}`
      );

    //
    // Display assumptions
    //
    const assumptions = [...context.assumptions.entries()].map(
      ([k, v]) => `${k}: ${v}`
    );
    if (assumptions.length > 0) {
      console.groupCollapsed(
        `${BOLD}${assumptions.length} assumptions${RESET}`
      );
      for (const a of assumptions) console.info(a);
      console.groupEnd();
    }

    //
    // Display values
    //

    const bindings = Object.entries(context.values);

    if (bindings.length + context.lexicalScope.bindings.size === 0) {
      console.groupEnd();
      depth += 1;
      continue;
    }

    for (const [k, b] of bindings) {
      if (context.lexicalScope.bindings.has(k)) {
        console.info(defToString(k, context.lexicalScope.bindings.get(k)!, b));
      } else if (b === undefined) {
        console.info(`${CYAN}${k}${RESET}: ${GREY}undefined${RESET}`);
      } else {
        console.info(`${CYAN}${k}${RESET}: ${GREY}${b.toString()}${RESET}`);
      }
    }

    //
    // Display the lexical scope entries without a matching value
    //
    for (const [k, def] of context.lexicalScope.bindings)
      if (!(k in context.values)) console.info(defToString(k, def));

    console.groupEnd();

    // Next execution context
    depth += 1;
  }
}

export function lookupContext(
  ce: IComputeEngine,
  id: MathJsonSymbol
): EvalContext | undefined {
  if (id.length === 0 || !isValidSymbol(id))
    throw Error(`Invalid symbol "${id}": ${validateSymbol(id)}}`);

  // Iterate over all the frames, starting with the most recent
  // and going back to the root frame
  const l = ce._evalContextStack.length - 1;
  if (l < 0) return undefined;
  for (let j = l; j >= 0; j--) {
    const context = ce._evalContextStack[j];
    if (context.lexicalScope.bindings.has(id)) return context;
  }

  return undefined;
}

export function swapContext(ce: IComputeEngine, context: EvalContext): void {
  while (
    ce._evalContextStack.length > 0 &&
    ce._evalContextStack[ce._evalContextStack.length - 1] !== context
  )
    ce._evalContextStack.pop();

  // This is unlikely to happen, but just in case...
  if (ce._evalContextStack.length === 0) ce._evalContextStack = [context];
}

function defToString(
  name: string,
  def: BoxedDefinition,
  v?: BoxedExpression
): string {
  let result = '';
  if (isValueDef(def)) {
    const tags: string[] = [];
    if (def.value.holdUntil === 'never') tags.push('(hold never)');
    if (def.value.holdUntil === 'N') tags.push('(hold until N)');

    if (def.value.inferredType) tags.push('inferred');

    const allTags = tags.length > 0 ? ` ${tags.join(' ')}` : '';

    result = `${CYAN}${name}${RESET}:${allTags}`;

    if (def.value.isConstant) {
      result += ` const ${def.value.type.toString()}`;
      if (def.value.value !== undefined)
        result += ` = ${def.value.value?.toString()}`;
      console.assert(v === undefined);
    } else result += ` ${def.value.type.toString()}`;
  } else if (isOperatorDef(def)) {
    const tags: string[] = [];
    if (def.operator.inferredSignature) tags.push('(inferred)');

    const allTags = tags.length > 0 ? ` (${tags.join(' ')})` : '';

    result = `${CYAN}${name}${RESET}:${allTags} ${def.operator.signature.toString()}`;

    const details: string[] = [];

    if (def.operator.lazy) details.push('lazy');
    if (def.operator.scoped) details.push('scoped');
    if (def.operator.broadcastable) details.push('broadcastable');
    if (def.operator.associative) details.push('associative');
    if (def.operator.commutative) details.push('commutative');
    if (def.operator.idempotent) details.push('idempotent');
    if (def.operator.involution) details.push('involution');
    if (!def.operator.pure) details.push('not pure');

    const allDetails = details.map((x) => `${GREY}${x}${RESET}`).join(' ');
    if (allDetails.length > 0) result += `\n   \u2514 ${allDetails}`;
  } else result = 'unknown';

  if (v) {
    if (!v.isValid) {
      result += ` = ${INVERSE_RED}${v.toString()}${RESET} (not valid)`;
    } else if (!v.isCanonical) {
      result += ` = ${YELLOW}${v.toString()}${RESET} (not canonical)`;
    } else {
      result += ` = ${GREY}${v.toString()}${RESET}`;
    }
  }

  return result;
}
