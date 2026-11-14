import type { Expression } from '../global-types.js';
import type { BoxedValueDefinition } from '../types-definitions.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
import { CompileDeclineError } from './diagnostics.js';
import {
  isDictionary,
  isFunction,
  isObject,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  contextAssumedValues,
  withDeclaredTypeOnly,
  withShieldedValues,
} from '../boxed-expression/constraint-subject.js';

/**
 * Run `fn` (one compilation) with the stored value of every DECLARED symbol
 * named in `vars` hidden, and restore the values when `fn` returns or throws.
 *
 * The definitions of a name of `vars` are the one that the current scope
 * gives it, and each one that an occurrence of the name reads in `expr`, in
 * the bodies of the functions that `expr` calls and in the values of the
 * names that it reads (`reachedInputDefinitions()`): an expression reads its
 * names from the scope it was boxed in, so these can differ. A host that
 * declares a slider again with no value in the scope of a compilation leaves
 * the outer definition, with its value, in the body of a stored function.
 *
 * A `vars` entry maps a symbol to a run-time input of the compiled code: the
 * code reads the input, never the engine value. But while the symbol holds a
 * value, every analysis the compiler runs on the expression sees that value:
 * with `a: real` and `a := 4`, `√a` saw a non-negative operand and compiled
 * to the real-only `Math.sqrt(_.a)`, which gives `NaN` when the input goes
 * negative, where the same symbol with no value compiles to the complex
 * `_SYS.csqrt`. Facts derived from the value (sign, integrality, a literal
 * type) must not reach the lane and type decisions, the constant folder or
 * the symbolic integration of an input. With the value hidden, the symbol
 * reads as the valueless input of its declared type for the whole
 * compilation, so the output is the same as for a symbol declared with no
 * value.
 *
 * Only a symbol with a declared type is hidden (`inferredType === false`). A
 * symbol whose type was inferred from its value (`ce.assign('u', 4)` with no
 * declaration) keeps its value: hiding it would leave a valueless inferred
 * binding, which a use inside the compilation could narrow, and that type
 * write would outlive the compilation. Constants cannot be written and are
 * skipped, and so is a symbol whose value is a function literal, whose body a
 * call inlines.
 *
 * The value is hidden and restored through the definition's `value` setter,
 * so each write moves the engine's cache generation: nothing cached while the
 * value was visible is served during the compilation, and nothing cached
 * during the compilation is served after it.
 *
 * A value put in force by an assumption (`assume(a = 4)`) is not stored on
 * the definition, so the setter cannot hide it. It is hidden with the value
 * shield of `assume()` (`withShieldedValues`), which makes the definition
 * read as valueless without a write, and an `assumption` state event on entry
 * and on exit moves the cache generation as the writes do. A shielded
 * definition is also marked with `withDeclaredTypeOnly`, so it takes its
 * declared type, without the facts the assumptions prove about it
 * (`BoxedValueDefinition.type`): `a = 4` would otherwise type `a` as an
 * integer. The value shield alone does not do this, because `assume()` uses
 * the same shield and needs the facts to apply. A symbol with only a stored value is not shielded: once
 * the value is hidden, the facts about it apply, as they do for a symbol
 * declared with no value.
 */
export function withVarsValuesHidden<T>(
  expr: Expression,
  vars: Readonly<Record<string, unknown>> | undefined,
  fn: () => T
): T {
  if (vars === undefined) return fn();
  let hidden: [BoxedValueDefinition, Expression][] | undefined;
  let shielded: Set<BoxedValueDefinition> | undefined;
  const ce = expr.engine;
  const assumed = contextAssumedValues(ce);
  for (const v of inputDefinitions(expr, Object.keys(vars)).keys()) {
    if (v.isConstant || v.inferredType) continue;
    // A value an assumption puts in force (`assume(a = 4)`): shielded.
    if (assumed.has(v)) (shielded ??= new Set()).add(v);
    const stored = v.storedValue;
    if (stored === undefined || stored.operator === 'Function') continue;
    (hidden ??= []).push([v, stored]);
  }
  if (hidden === undefined && shielded === undefined) return fn();
  const shield = shielded;
  const run =
    shield === undefined
      ? fn
      : () => {
          ce._noteStateEvent({ kind: 'assumption' });
          try {
            return withDeclaredTypeOnly(shield, () =>
              withShieldedValues(shield, fn)
            );
          } finally {
            ce._noteStateEvent({ kind: 'assumption' });
          }
        };
  if (hidden === undefined) return run();
  try {
    for (const [def] of hidden) def.value = undefined;
    return run();
  } finally {
    for (const [def, stored] of hidden) def.value = stored;
  }
}

/**
 * The value definitions, each with its name, that the occurrences of the
 * names `names` read in `expr`, in the bodies of the functions that `expr` calls and in the values
 * of the names that it reads. A node and a definition are visited once. The
 * value of a name of `names` is not followed, unless it is a function
 * literal: the compilation does not read it.
 */
function reachedInputDefinitions(
  expr: Expression,
  names: ReadonlySet<string>,
  namesRead?: Set<string>
): Map<BoxedValueDefinition, string> {
  const result = new Map<BoxedValueDefinition, string>();
  const seen = new Set<object>();
  const stack: Expression[] = [expr];
  const push = (e: unknown): void => {
    if (e !== undefined && e !== null) stack.push(e as Expression);
  };
  const followValue = (
    name: string,
    value: BoxedValueDefinition | undefined
  ): void => {
    if (value === undefined || value.isConstant || seen.has(value)) return;
    seen.add(value);
    const stored = value.storedValue;
    // The value of an input is hidden, and not read, when its type is
    // declared and it is not a function literal (`withVarsValuesHidden()`).
    if (
      names.has(name) &&
      !value.inferredType &&
      stored?.operator !== 'Function'
    )
      return;
    push(stored);
  };
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (seen.has(e)) continue;
    seen.add(e);
    if (isSymbol(e)) {
      // A held (not canonical) name is bound when it is evaluated: it counts
      // as read by its name.
      if (!e.isCanonical) {
        if (names.has(e.symbol)) namesRead?.add(e.symbol);
        continue;
      }
      // An occurrence that reads a parameter, the variable of a binder or
      // the local of a block is not the name of the option: it is bound
      // inside the expression or the body (`_resolutionScope()`).
      const local =
        (
          e as unknown as { _resolutionScope?(): unknown }
        )._resolutionScope?.() === undefined;
      if (local) continue;
      if (names.has(e.symbol)) namesRead?.add(e.symbol);
      // The definition that the occurrence reads, which is not its own for a
      // name that had none when it was boxed (`_readDefinition()`).
      const read = (
        e as unknown as { _readDefinition?(): unknown }
      )._readDefinition?.();
      // Its own definition counts too: a constant keeps reading it when a
      // later declaration of its home chain has its name.
      const own = e.valueDefinition;
      const value = isValueDef(read as never)
        ? (read as { value: BoxedValueDefinition }).value
        : own;
      for (const v of [value, own]) {
        if (v === undefined) continue;
        if (names.has(e.symbol) && !result.has(v)) result.set(v, e.symbol);
        followValue(e.symbol, v);
      }
      continue;
    }
    if (isDictionary(e)) {
      for (const v of e.values) push(v);
      continue;
    }
    if (isObject(e)) {
      for (const v of e._slots.values()) push(v);
      continue;
    }
    if (!isFunction(e)) continue;
    if (names.has(e.operator)) namesRead?.add(e.operator);
    const op = e.operatorDefinition;
    if (op !== undefined && !seen.has(op)) {
      seen.add(op);
      push(op._lambdaLiteral);
    }
    followValue(e.operator, e.valueDefinition);
    for (const x of e.ops) push(x);
  }
  return result;
}

/**
 * The names that the options of a compilation make inputs of the code: the
 * keys of `vars` and the names of `symbolic`, as the keys of one record, or
 * `undefined` when there is none.
 */
export function compileInputNames(
  options:
    | {
        vars?: Readonly<Record<string, unknown>>;
        symbolic?: readonly string[];
      }
    | undefined
): Readonly<Record<string, unknown>> | undefined {
  const symbolic = options?.symbolic;
  if (symbolic === undefined || symbolic.length === 0) return options?.vars;
  const names: Record<string, unknown> = { ...options?.vars };
  for (const name of symbolic) names[name] = true;
  return names;
}

/**
 * The names of `symbolic` that the compilation of `expr` reads, or the
 * `CompileDeclineError` of the first one whose value cannot be hidden: its
 * type was inferred from the value, it is a constant, or it holds a function
 * literal, which a call inlines. `option` is the option that the caller of
 * `compile()` gave the names with; the message names it.
 */
export function symbolicInputsRead(
  expr: Expression,
  symbolic: readonly string[],
  option: 'symbolic' | 'inputs' = 'symbolic'
): readonly string[] | CompileDeclineError {
  // A name of the option that the compilation does not read (in `expr`, in
  // the bodies it calls, in the values it reads) has no effect: a host can
  // list the names of its scopes without a refusal for one of them.
  const read = new Set<string>();
  const definitions = reachedInputDefinitions(expr, new Set(symbolic), read);
  const names = symbolic.filter((name) => read.has(name));
  if (names.length === 0) return names;
  for (const name of names) {
    const def = expr.engine.lookupDefinition(name);
    if (isValueDef(def) && !definitions.has(def.value))
      definitions.set(def.value, name);
  }
  // A name that is a function (`f(x) := …`) is not an input.
  for (const name of names) {
    const def = expr.engine.lookupDefinition(name);
    if (def !== undefined && !isValueDef(def))
      return new CompileDeclineError({
        code: 'compile-error',
        kind: 'correctness',
        binding: name,
        message:
          `Could not compile: the name "${name}" of the \`${option}\` option ` +
          `is a function, which compiled code cannot take as an input.`,
      });
  }
  for (const [v, name] of definitions) {
    if (!read.has(name)) continue;
    const stored = v.isConstant ? undefined : v.storedValue;
    const holdsFunction = stored?.operator === 'Function';
    if (!v.isConstant && !holdsFunction) {
      if (!v.inferredType || stored === undefined) continue;
    }
    return new CompileDeclineError({
      code: 'compile-error',
      kind: 'correctness',
      binding: name,
      message:
        `Could not compile: the name "${name}" of the \`${option}\` option ` +
        (v.isConstant
          ? `is a constant.`
          : holdsFunction
            ? `holds a function, which compiled code cannot take as an input.`
            : `has no declared type, so its value cannot be left out. ` +
              `Declare its type, for example with ` +
              `\`ce.declare("${name}", "real")\`.`),
    });
  }
  return names;
}

/**
 * Run `fn` (one compilation) with each name of `symbolic` read as an input:
 * its stored value is hidden as the value of a `vars` name is
 * (`withVarsValuesHidden()`). A name whose value cannot be hidden gives its
 * `CompileDeclineError` (`symbolicInputsRead()`), and `fn` is not run.
 */
export function withSymbolicInputs<T>(
  expr: Expression,
  symbolic: readonly string[] | undefined,
  fn: () => T
): T | CompileDeclineError {
  if (symbolic === undefined || symbolic.length === 0) return fn();
  const names = symbolicInputsRead(expr, symbolic);
  if (names instanceof CompileDeclineError) return names;
  if (names.length === 0) return fn();
  const hidden: Record<string, unknown> = {};
  for (const name of names) hidden[name] = true;
  return withVarsValuesHidden(expr, hidden, fn);
}

/**
 * Run `fn` (the compilation of one target) with the inputs that its options
 * name read as inputs: the names of `vars` (`withVarsValuesHidden()`) and
 * the names of `symbolic` (`withSymbolicInputs()`). A name of `symbolic`
 * whose value cannot be left out throws its `CompileDeclineError`.
 */
export function withInputValuesHidden<T>(
  expr: Expression,
  options: {
    vars?: Readonly<Record<string, unknown>>;
    symbolic?: readonly string[];
  },
  fn: () => T
): T {
  const result = withSymbolicInputs(expr, options.symbolic, () =>
    withVarsValuesHidden(expr, options.vars, fn)
  );
  if (result instanceof CompileDeclineError) throw result;
  return result;
}

/**
 * The value definitions of the names `names` in a compilation of `expr`,
 * each with its name: the one that the current scope gives a name, and each
 * one that an occurrence of the name reads (`reachedInputDefinitions()`).
 */
function inputDefinitions(
  expr: Expression,
  names: readonly string[]
): Map<BoxedValueDefinition, string> {
  const result = reachedInputDefinitions(expr, new Set(names));
  const ce = expr.engine;
  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (isValueDef(def) && !result.has(def.value)) result.set(def.value, name);
  }
  return result;
}
