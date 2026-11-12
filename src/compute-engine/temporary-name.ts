import type { Expression, IComputeEngine } from './global-types.js';
import { isValidSymbol } from '../math-json/symbols.js';
import {
  isDictionary,
  isExpression,
  isFunction,
  isObject,
  isSymbol,
} from './boxed-expression/type-guards.js';
import { recordObjectRead } from './boxed-expression/object-deps.js';

/**
 * The body of `ce.temporaryName()` (`docs/plans/2026-11-12-fresh-symbol-spec.md`,
 * section 2).
 *
 * Return `<hint>_tmp<n>`, with `n` the smallest integer from 1 such that the
 * name has no definition that `ce.lookupDefinition()` finds from the current
 * scope, and is not a name of `avoid`.
 *
 * The function keeps no state and writes nothing: the same call in the same
 * state gives the same name.
 */
export function temporaryName(
  ce: IComputeEngine,
  hint: string,
  avoid: ReadonlyArray<Expression | string | ReadonlySet<string>>
): string {
  const base = cleanHint(hint);

  // The names of `avoid` are collected once, so that each candidate costs a
  // set lookup and not a walk.
  const names = new Set<string>();
  const sets: ReadonlySet<string>[] = [];
  const visited = new Set<Expression>();
  for (const item of avoid) {
    if (typeof item === 'string') names.add(item);
    else if (Array.isArray(item))
      // An array of strings is also a MathJSON call: the caller passes the
      // set of its names, or boxes it.
      throw new Error(
        `temporaryName(): an array is not accepted in "avoid"; pass a Set of names or a boxed expression`
      );
    else if (isExpression(item)) collectNames(item, names, visited);
    else if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ReadonlySet<string>).has === 'function'
    )
      // Any object with the `has()` of a set: a `ReadonlySet` need not be an
      // instance of the `Set` of this realm.
      sets.push(item as ReadonlySet<string>);
    else
      throw new Error(
        `temporaryName(): "avoid" accepts boxed expressions, strings and sets of names`
      );
  }

  for (let n = 1; ; n++) {
    const name = `${base}_tmp${n}`;
    if (names.has(name)) continue;
    if (sets.some((s) => s.has(name))) continue;
    if (ce.lookupDefinition(name) !== undefined) continue;
    return name;
  }
}

/**
 * Remove the `_` at the start and at the end of the hint, make each `__` one
 * `_`, and use `tmp` if nothing is left. A hint that is not a valid symbol,
 * or for which `<hint>_tmp1` is not a valid symbol, throws.
 */
function cleanHint(hint: string): string {
  if (typeof hint !== 'string' || !isValidSymbol(hint))
    throw new Error(
      `temporaryName(): the hint ${JSON.stringify(hint)} is not a valid symbol name`
    );
  // A symbol name is in the Unicode NFC form (`createSymbolExpression()`):
  // a hint in another form would give a name that is compared as written
  // here, and that `ce.symbol()` then makes the name of another symbol.
  const base =
    hint.normalize().replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tmp';
  if (!isValidSymbol(`${base}_tmp1`))
    throw new Error(
      `temporaryName(): no valid symbol name can be made from the hint ${JSON.stringify(hint)}`
    );
  return base;
}

/**
 * Add to `result` every name that occurs in `root` as written: a symbol, free
 * or bound, or the operator of a call. Each node is visited once (a shared
 * subtree is not walked again), and the walk does not enter the values or the
 * bodies of the names that the expression reads.
 *
 * The nodes walked are those of `hasSymbolOrOperator()`
 * (`abstract-boxed-expression.ts`): function nodes, the values of a
 * dictionary and the field values of an object.
 */
function collectNames(
  root: Expression,
  result: Set<string>,
  visited: Set<Expression>
): void {
  const pending: Expression[] = [root];
  while (pending.length > 0) {
    const e = pending.pop()!;
    if (isSymbol(e)) {
      result.add(e.symbol);
      continue;
    }
    if (visited.has(e)) continue;
    if (isFunction(e)) {
      visited.add(e);
      result.add(e.operator);
      // A store-backed list has only number operands, which hold no name.
      if (e._numericStore !== undefined) continue;
      for (const op of e.ops) pending.push(op);
    } else if (isDictionary(e)) {
      visited.add(e);
      for (const value of e.values) pending.push(value);
    } else if (isObject(e)) {
      visited.add(e);
      // Reading the fields is an object read, as in `hasSymbolOrOperator()`:
      // a cached answer that depends on this walk records the version of
      // the object, because a store changes the fields without advancing a
      // cache generation of the engine.
      recordObjectRead(e, e._version);
      for (const value of e._slots.values()) pending.push(value);
    }
  }
}
