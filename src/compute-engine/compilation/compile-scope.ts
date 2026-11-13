import type {
  BoxedBaseDefinition,
  BoxedDefinition,
  BoxedValueDefinition,
  Expression,
  Scope,
} from '../global-types.js';
import {
  isDictionary,
  isFunction,
  isObject,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { readsActivation } from '../boxed-expression/binders.js';
import { lookup } from '../function-utils.js';
import { CompileDeclineError } from './diagnostics.js';

/**
 * The scope that a compilation of `expr` reads names from.
 *
 * An expression reads each name from the scope it was boxed in, for its type
 * and its value (`docs/plans/2026-11-11-bound-once-spec.md`, section 2), and
 * the compiler looks a name up by its spelling from the current scope. So a
 * compilation runs with a scope current in which each name of `expr` is
 * looked up as it is from the scope of its occurrence:
 *
 * - `undefined` when the current scope is such a scope: the compilation
 *   runs as it is called;
 * - otherwise the first such scope among the scopes of the occurrences of
 *   `expr` (`BoxedSymbol._resolutionScope()`), the outermost first, other
 *   than the scopes of the binders, blocks and function literals of `expr`
 *   and their descendants. A scope
 *   that was popped qualifies: it keeps its definitions;
 * - a `CompileDeclineError` when there is none: `expr` was built from
 *   operands boxed in scopes that read a name differently
 *   (`ce.function('Add', [a, b])`). The interpreter reads each operand from
 *   its own scope, and the decline falls back to it.
 *
 * A name is looked up as it is from the scope of its occurrence when the
 * lookup from the scope gives the same definition (`lookup()`). An
 * occurrence that reads an activation (a parameter, the variable of a
 * binder, the local of a block) is not looked up.
 *
 * The head of a function expression that is bound to a definition other
 * than that of the standard library only steers the choice: a scope whose
 * lookup of the head gives that definition is preferred. The compiler
 * compares the binding of a call with the definition that it looks up, and
 * gives two functions of one name two private names or declines
 * (`shadowing-calls.ts`), so a head never makes the compilation decline here.
 *
 * `inputs` is the `vars` option of the compilation: the stored value of a
 * name it maps is hidden, so the walk does not read that value.
 */
export function compilationScope(
  expr: Expression,
  inputs?: Readonly<Record<string, unknown>>
): Scope | undefined | CompileDeclineError {
  const ce = expr.engine;
  const current = ce.context.lexicalScope;
  const library = ce.contextStack[0]?.lexicalScope;
  // Each occurrence, with the scope that it is read from: the scope of its
  // definition (`bound`), the home scope of a free name (`free`), or, for a
  // held (not canonical) name, which an evaluation binds where it runs, the
  // scope that `compile()` is called in (`held`).
  const found: {
    kind: 'bound' | 'free' | 'held';
    symbol: Expression & { symbol: string };
    scope: Scope;
  }[] = [];
  const heads = new Map<string, Set<BoxedBaseDefinition>>();
  // A definition is followed once (a recursive function).
  const seen = new Set<object>();
  // A node shared by several operands is visited once, with the names that
  // the first path to it binds. A path that binds other names visits it one
  // more time, with no name bound: a held name of a shared node is then
  // recorded, which can only decline.
  const visited = new Map<Expression, ReadonlySet<string> | undefined>();
  // The scopes of the binders, blocks and function literals of `expr` and
  // of the bodies that it reaches.
  const local = new Set<Scope>();
  // Each node to visit, with the names that the binders, blocks and
  // function literals on its path bind.
  const stack: [Expression, ReadonlySet<string> | undefined][] = [
    [expr, undefined],
  ];
  // The body of a function that `expr` calls, and the value of a name that
  // it reads, are read as `expr` is (`buildInterpreterFallback()`).
  const follow = (def: object | undefined, body: () => unknown): void => {
    if (def === undefined || seen.has(def)) return;
    seen.add(def);
    const e = body();
    if (e !== undefined && e !== null) stack.push([e as Expression, undefined]);
  };
  // A name that `inputs` (the `vars` option) maps is an input of the code
  // wherever it is read by its name, in `expr` and in the bodies that `expr`
  // calls: the host supplies its value. Its occurrences take no part in the
  // choice of the scope, and a scope other than the current one is chosen
  // only when it reads each such name as the current scope does.
  const isInput = (name: string): boolean =>
    inputs !== undefined && Object.prototype.hasOwnProperty.call(inputs, name);
  // The value of a name: not followed for a name that `inputs` (the `vars`
  // option) makes an input, whose stored value the compilation hides
  // (`withVarsValuesHidden()`), unless the value is a function literal.
  const followValue = (
    name: string,
    value: BoxedValueDefinition | undefined
  ): void => {
    if (value === undefined || value.isConstant) return;
    if (
      isInput(name) &&
      !value.inferredType &&
      value.storedValue?.operator !== 'Function'
    )
      return;
    follow(value, () => value.value);
  };
  while (stack.length > 0) {
    const [e, path] = stack.pop()!;
    let bound = path;
    if (visited.has(e)) {
      const first = visited.get(e);
      if (first === undefined || first === bound) continue;
      bound = undefined;
    }
    visited.set(e, bound);
    if (isSymbol(e)) {
      // A held name that a binder on its path binds reads the binder's
      // variable when it is evaluated.
      if (!e.isCanonical) {
        if (!bound?.has(e.symbol) && !isInput(e.symbol))
          found.push({ kind: 'held', symbol: e, scope: current });
        continue;
      }
      const scope = (
        e as unknown as { _resolutionScope?(): Scope | undefined }
      )._resolutionScope?.();
      if (scope === undefined) continue;
      const def = e.valueDefinition ?? e.operatorDefinition;
      // A symbol bound to the definition of the standard library reads it
      // wherever it is compiled (`["Module", "Pi"]`, `hidesLibraryBinding()`).
      if (def !== undefined && halfOf(library?.bindings.get(e.symbol)) === def)
        continue;
      const free = (e as unknown as { _isFreeName?: boolean })._isFreeName;
      if (!isInput(e.symbol))
        found.push({ kind: free ? 'free' : 'bound', symbol: e, scope });
      followValue(e.symbol, e.valueDefinition);
      continue;
    }
    if (isDictionary(e)) {
      for (const v of e.values) stack.push([v, bound]);
      continue;
    }
    if (isObject(e)) {
      for (const v of e._slots.values()) stack.push([v, bound]);
      continue;
    }
    if (!isFunction(e)) continue;
    // A qualified name (`["Module", "Pi"]`) reads the standard library
    // wherever it is compiled.
    if (e.operator === 'Module') continue;
    let inner = bound;
    if (e.localScope !== undefined) {
      local.add(e.localScope);
      inner = new Set([...(bound ?? []), ...e.localScope.bindings.keys()]);
    }
    const name = e.operator;
    const def = e.operatorDefinition ?? e.valueDefinition;
    if (
      def !== undefined &&
      !readsActivation(
        (e.operatorDefinition !== undefined
          ? { operator: def }
          : { value: def }) as BoxedDefinition
      ) &&
      halfOf(library?.bindings.get(name)) !== def
    ) {
      let defs = heads.get(name);
      if (defs === undefined) heads.set(name, (defs = new Set()));
      defs.add(def);
    }
    const op = e.operatorDefinition;
    follow(op, () => op?._lambdaLiteral);
    followValue(name, e.valueDefinition);
    for (const x of e.ops) stack.push([x, inner]);
  }

  // A function that a scope of `expr` defines (a `Declare` in a block) is
  // not read by name from outside.
  const localDefs = new Set<BoxedBaseDefinition | undefined>();
  for (const s of local)
    for (const b of s.bindings.values()) localDefs.add(halfOf(b));
  for (const defs of heads.values())
    for (const d of defs) if (localDefs.has(d)) defs.delete(d);
  for (const [name, defs] of heads) if (defs.size === 0) heads.delete(name);

  // An occurrence boxed inside a scope of `expr` that reads a name of an
  // enclosing scope (the bound of a later clause) reads it as the scope
  // around `expr` gives it. The names by the scope they are read from: a
  // free name with one of its occurrences.
  const named = new Map<Scope, Set<string>>();
  const free = new Map<Scope, Map<string, Expression & { symbol: string }>>();
  for (const { kind, symbol, scope } of found) {
    const home = outside(scope, local);
    if (kind === 'free') {
      let names = free.get(home);
      if (names === undefined) free.set(home, (names = new Map()));
      if (!names.has(symbol.symbol)) names.set(symbol.symbol, symbol);
    } else {
      let names = named.get(home);
      if (names === undefined) named.set(home, (names = new Set()));
      names.add(symbol.symbol);
    }
  }

  // The names boxed in a scope are looked up from it as they are from
  // their scope: the common case, where every occurrence was boxed in the
  // current scope, needs no lookup. A free name is resolved from the scope
  // as its own resolution is, and compared with what it reads.
  const misread = (scope: Scope): string | undefined => {
    for (const [home, names] of named) {
      if (home === scope) continue;
      for (const name of names)
        if (lookup(name, scope) !== lookup(name, home)) return name;
    }
    for (const [home, names] of free) {
      if (home === scope) continue;
      for (const [name, symbol] of names) {
        const s = symbol as unknown as {
          _freeNameBindingFrom(scope: Scope): BoxedDefinition | undefined;
          _resolvedDefinition(): BoxedDefinition | undefined;
        };
        if (s._freeNameBindingFrom(scope) !== s._resolvedDefinition())
          return name;
      }
    }
    return undefined;
  };
  const readsHeads = (scope: Scope): boolean => {
    for (const [name, defs] of heads) {
      const found = halfOf(lookup(name, scope));
      if (found === undefined || !defs.has(found)) return false;
    }
    return true;
  };

  const readsInputs = (scope: Scope): boolean => {
    if (inputs === undefined) return true;
    for (const name of Object.keys(inputs))
      if (lookup(name, scope) !== lookup(name, current)) return false;
    return true;
  };

  const first = misread(current);
  if (first === undefined && readsHeads(current)) return undefined;
  // A scope of `expr` itself (the body of a function literal, a `Sum`)
  // binds the names of `expr`, and the compiler binds them by itself.
  const others = [...new Set([...named.keys(), ...free.keys()])]
    .filter((s) => s !== current && !insideAny(s, local))
    .sort((a, b) => depthOf(a) - depthOf(b));
  for (const scope of others)
    if (misread(scope) === undefined && readsHeads(scope) && readsInputs(scope))
      return scope;
  if (first === undefined) return undefined;
  for (const scope of others)
    if (misread(scope) === undefined && readsInputs(scope)) return scope;
  return new CompileDeclineError({
    code: 'compile-error',
    kind: 'correctness',
    binding: first,
    message:
      `Could not compile: the name "${first}" is read from scopes that ` +
      `give it different definitions (the expression was built from ` +
      `operands boxed in different scopes). Box the expression in one ` +
      `scope, or bind it again in the current scope with \`ce.rebind()\`.`,
  });
}

/**
 * The scopes that `compile()` was called in, innermost last, for the
 * compilations in progress (`inCallerScope()`).
 */
const callerScopes: { engine: object; scope: Scope }[] = [];

/**
 * Run `f`, a compilation of `expr` that `compile()` was called for, with the
 * current scope recorded as the scope of the call. The interpreter fallback
 * of the compilation is built for that scope (`callerScopeOf()`), also when
 * the compilation runs in the scope of `expr`.
 */
export function inCallerScope<T>(expr: Expression, f: () => T): T {
  const ce = expr.engine;
  callerScopes.push({ engine: ce, scope: ce.context.lexicalScope });
  try {
    return f();
  } finally {
    callerScopes.pop();
  }
}

/**
 * The scope that the innermost compilation in progress on `ce` was called
 * in (`inCallerScope()`), or the current scope.
 */
export function callerScopeOf(ce: { context: { lexicalScope: Scope } }): Scope {
  for (let i = callerScopes.length - 1; i >= 0; i--)
    if (callerScopes[i].engine === ce) return callerScopes[i].scope;
  return ce.context.lexicalScope;
}

/** The half of `def` that a function expression keeps (its operator or its
 * value definition). */
function halfOf(
  def: BoxedDefinition | undefined
): BoxedBaseDefinition | undefined {
  if (def === undefined) return undefined;
  return 'operator' in def ? def.operator : def.value;
}

/** The parent of the outermost of `scopes` that is `scope` or an ancestor
 * of it, or `scope` when there is none. */
function outside(scope: Scope, scopes: Set<Scope>): Scope {
  let result = scope;
  for (let s: Scope | null | undefined = scope; s; s = s.parent)
    if (scopes.has(s)) result = s.parent ?? s;
  return result;
}

/** Whether `scope` is one of `scopes` or a descendant of one of them. */
function insideAny(scope: Scope, scopes: Set<Scope>): boolean {
  for (let s: Scope | null | undefined = scope; s; s = s.parent)
    if (scopes.has(s)) return true;
  return false;
}

/** The number of ancestors of `scope`. */
function depthOf(scope: Scope): number {
  let n = 0;
  for (let s = scope.parent; s; s = s.parent) n += 1;
  return n;
}
