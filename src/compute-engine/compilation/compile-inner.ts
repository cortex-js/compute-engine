// The inner compilation of a symbol or node: held values, absent inputs, wide
// results, collection value blocks, and the decline of a possible `Nothing`.

import { provedAbsentDomainOf } from '../boxed-expression/proved-absent-domain.js';
import { isShadowedSymbol } from '../library-shadowing.js';
import type { SymbolInterface } from '../types-expression.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import {
  collectionElementType,
  functionResult,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype, hasNothingArm } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { presentedValueType } from '../boxed-expression/effects-inference.js';
import { isTestedAtRead } from '../boxed-expression/store-admission.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isAbsentSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  isHostOperatorCallback,
  isRefusableBuiltinCallback,
} from './builtin-callback.js';
import type { DeclineNote } from './compiler-types.js';
import {
  BINARY_INFIX_VALUE_OPERATORS,
  COMPLEX_PROPAGATING_HEADS,
  CONTROL_FLOW_HEADS,
} from './compiler-tables.js';
import {
  ensureBuiltinCallbackEmitted,
  ensureHostOperatorCallbackEmitted,
} from './compile-definitions.js';
import {
  _compileParents,
  builtinCallbackRefusal,
  isUserDefinedFunction,
  userFunctionValueRefRefusal,
} from './compile-statements.js';
import { libraryBoundConstantHidden } from './compile-real-analysis.js';
import { ensureUserFunctionValueRef } from './compile-callbacks.js';
import { liftWideReference } from './compile-lanes.js';
import { ABSENT_READS } from '../boxed-expression/conditional-value.js';
import { tryFoldKnownSymbol } from './compile-folded-values.js';
import { core } from './compiler-core-hooks.js';
import { complexDiscipline } from './compile-declarations.js';
import {
  PROMOTABLE_RADICAL_HEADS,
  typeHasComplexLeaf,
  wideNumericType,
} from './compiler-mode.js';
import { containsReturn } from './compile-conditions.js';
import { CompilerState } from './compiler-state.js';
import { compilationType } from './compiler-type-facts.js';
import {
  nothingOperandDecline,
  possibleNothingDecline,
} from './diagnostics.js';

/**
 * The refusal for the name of an operator or a function (`List`, `Sqrt`,
 * `Add`, a user function `f`) that the Python target reaches as a value: a
 * bare symbol, or the result of `Head` that canonicalization folds to that
 * symbol. A name that the compilation binds or that the caller supplies (a
 * parameter, a `vars` key) is an input, and this refusal does not apply to
 * it.
 *
 * The interpreter gives the symbol itself as the value. Python code has no
 * form for a symbol value. The callback operand of a higher-order operator
 * does not reach this refusal: the operator's own lowering compiles it. On
 * this target that lowering accepts a function literal (or a `Composition`,
 * which it rewrites as one) and only four operator names, `Add`,
 * `Subtract`, `Multiply` and `Divide`, which it writes as a two-argument
 * Python lambda (`pyCallbackArg()`, `python-target.ts`). That lambda runs
 * only where the operator calls its callback with two arguments, as the
 * combiner of `Reduce`; the `Reduce` lowering also writes `Add`,
 * `Multiply`, `Min` and `Max` as a native reduction. Another operator or
 * function name as a callback, such as `Map(Sqrt, v)` or `Map(f, v)`,
 * declines in that lowering. Without this
 * refusal, the target emitted the bare name, which raises a `NameError` at
 * run time, or the JavaScript lambda `(a,b) => a + b`, which is a Python
 * syntax error.
 */
function pythonOperatorValueRefusal(s: string): string {
  return (
    `Could not compile \`${s}\` on target 'python': the name of an operator ` +
    `or a function is used as a value, and Python code has no form for a ` +
    `symbol value. A caller using the default \`fallback: true\` falls back ` +
    `to interpreted evaluation.`
  );
}

/**
 * The code of a symbol. A case of `_compileInner`, in a function of its
 * own so that the stack frame of `_compileInner` stays small: each level of
 * a nested expression keeps one such frame on the stack, and a deep
 * expression overflowed it (ROADMAP CE-320.2).
 */
export function compileInnerSymbol(
  expr: Expression & SymbolInterface,
  target: CompileTarget<Expression>
): TargetSource {
  const s = expr.symbol;
  const op = target.operators?.(s);
  // On the Python target, a name that the compilation binds or that the
  // caller supplies (a `compileFunction` parameter, a `vars` key, a lambda
  // parameter or another bound name) is an input, also when it is spelled
  // like an operator (`Add`). It goes through the ordinary symbol
  // resolution below, which emits the input, and not through the operator
  // branch, which refuses an operator name used as a value on this target.
  // On the Python target every `var` resolver is a table lookup (constants,
  // `vars` entries, parameters and bound names). Unlike the JavaScript
  // resolver, it records nothing about which inputs the code reads, so
  // calling it here has no side effect. No Python constant has the name of
  // an operator, so `var` returns a value for an operator name only when
  // that name is an input.
  const isPythonInput =
    op !== undefined &&
    target.language === 'python' &&
    (target.boundVars?.has(s) === true ||
      target.varsKeys?.has(s) === true ||
      target.var?.(s) !== undefined);
  if (op !== undefined && !isPythonInput) {
    // A bare operator symbol used in value position (a first-class function
    // — e.g. a `Reduce` combiner or `Map` mapper). Only genuinely binary
    // arithmetic operators lower to a valid binary infix lambda; unary
    // (Negate/Not), relational, and logical operator symbols fail closed
    // (D6) so the engine falls back to the interpreter instead of emitting
    // wrong-arity, invalid, or silently-diverging source (finding: Reduce/
    // Map over-accepted any operator symbol as a combiner/mapper).
    if (!BINARY_INFIX_VALUE_OPERATORS.has(s)) {
      // …but a UNARY operator symbol (`Negate`, `Not`) is a perfectly good
      // callback: eta-expand it here, before failing closed, exactly as
      // the bare-symbol route below does for an unmapped built-in. Its
      // wrapper BODY is an ordinary application, so it lowers through this
      // very operator mapping (`_fn_Negate = (_tv1) => -_tv1`). Guarded
      // like the route below so a BOUND name or a `vars` key spelled
      // `Negate` keeps its current meaning (there, its current meaning is
      // the refusal below).
      const registry = target.userFunctions;
      const isBoundOrMapped =
        target.boundVars?.has(s) === true || target.varsKeys?.has(s) === true;
      if (registry && !isBoundOrMapped) {
        const etaFn = ensureBuiltinCallbackEmitted(expr.engine, s, target);
        if (etaFn !== undefined && registry.lowering)
          return registry.lowering.value({ id: s, name: etaFn, target });
        if (etaFn !== undefined) return etaFn;
      }
      throw new Error(builtinCallbackRefusal(s));
    }
    // The infix lambda below is JavaScript source. The Python target has no
    // other form for it here: see `pythonOperatorValueRefusal`.
    if (target.language === 'python')
      throw new Error(pythonOperatorValueRefusal(s));
    // We're compiling something like "Add"
    return `(a,b) => a ${op[0]} b`;
  }
  // A WRITTEN absence symbol (`Missing`) is a VALUE, not an
  // input the caller supplies (2026-09-22). Without this branch it fell
  // through to the free-symbol read `_.Missing`, so the artifact reported
  // `freeSymbols: ["Missing"]` and every absence test ran against whatever
  // the caller happened to bind: `IsMissing(Missing)` answered `false`,
  // `Coalesce(Missing, 2)` answered `undefined` and `Median([1, Missing,
  // 3])` answered `3`, where the interpreter answers `True`, `2` and
  // `NaN`.
  //
  // The lowering is the target's OBJECT-domain null (`undefined` on
  // JavaScript, `None` on Python). On a target with no object axis (the
  // shader targets, the interval target) the numeric marker is the only
  // spelling there is, and it is used. A target with no absence capability
  // at all fails closed.
  //
  // The guard reads `boundVars`/`varsKeys` only — it runs BEFORE
  // `target.var()` is consulted, so that resolving the name does not
  // record a vars-object reference the lambda route would then refuse. A
  // bound name or a caller `vars` key spelled `Missing` is a genuine
  // variable and keeps its meaning.
  if (
    isAbsentSymbol(expr) &&
    target.boundVars?.has(s) !== true &&
    target.varsKeys?.has(s) !== true
  ) {
    if (
      target.absence?.object !== undefined &&
      target.absence.writtenSymbol !== 'numeric'
    )
      return target.absence.object.nullLiteral;
    if (target.absence?.numeric !== undefined)
      return target.absence.numeric.make();
    throw new Error(
      `Could not compile \`${s}\`: target '${target.language ?? 'unknown'}' has no absence ` +
        `representation (no 'absence' capability), so the absence marker ` +
        `cannot be spelled.`
    );
  }
  // Resolving a free symbol RECORDS it as a vars-object reference (see
  // `CompileTarget.varsObjectRefs`), and the lambda route refuses a body
  // holding any. The two function-value routes below never emit that
  // reference, so the record has to be rolled back when one of them
  // answers — otherwise `t ↦ Sum(Map(Sin, xs))` is refused for a
  // "dangling" `Sin` the artifact does not contain. Only a record THIS
  // resolution introduced is removed.
  const hadVarsRef = target.varsObjectRefs?.has(s) === true;
  let resolved = target.var?.(s);
  // A target reads a library constant (`Pi`, `ExponentialE`,
  // `ImaginaryUnit`, …) from its constants table by NAME. When a user
  // binding gives the name another value (`ce.declare('Pi', { value: 1
  // })` in a nested scope, `isShadowedSymbol`), the symbol is not the
  // constant: it is read as any other symbol, so its value is folded
  // below, or it is a free symbol. Before, `Pi·x` compiled to
  // `Math.PI * x` there, where the interpreter computes `1·x`.
  if (
    resolved !== undefined &&
    resolved === target.constant?.(s) &&
    isShadowedSymbol(expr)
  )
    resolved = undefined;
  // The other direction. The `var` hook of a target can only see the
  // NAME, so it tests the scope chain at the compile site: a scope that
  // declares `Pi` makes it skip the constant. The interpreter reads the
  // definition the symbol is bound to, and a symbol boxed while `Pi` was
  // the library constant still denotes π inside such a scope. That
  // symbol is read from the constants table, and a vars-object reference
  // the hook recorded is rolled back.
  // A local of the compiled code with the same name hides the constant
  // too, when the symbol was boxed before the local was declared: in
  // `function g() { i + 1 }; let i = 2; g()`, the top-level block of the
  // program declares `i` only at its `let` (`canonicalBlock()`,
  // `library/control-structures.ts`), so the `i` of `g` is bound to the
  // library constant, as when the run reads one statement at a time.
  else if (
    resolved !== target.constant?.(s) &&
    (libraryBoundConstantHidden(expr, s, target) ||
      (target.constant?.(s) !== undefined &&
        target.boundVars?.has(s) === true &&
        target.varsKeys?.has(s) !== true &&
        expr.valueDefinition !== undefined &&
        !isShadowedSymbol(expr)))
  ) {
    resolved = target.constant!(s);
    if (!hadVarsRef) target.varsObjectRefs?.delete(s);
  }
  // A bare symbol naming a user-defined function, used in value position (a
  // higher-order operand such as `Map(f, list)` / `Filter(list, f)`),
  // resolves to the shared emitted local `_fn_f` — the same definition the
  // call-site path emits — rather than a dangling `_.f`. But two kinds of
  // symbol must NOT be captured this way, or a same-named user function
  // would silently shadow them:
  //   - a **bound** name (a parameter / block local / loop index): the
  //     enclosing binding form's `var` override resolves it to the bare
  //     identifier (`resolved === s`), whereas the base resolver only ever
  //     emits `_.<s>`, a constant, or a mapped literal — so `resolved === s`
  //     uniquely identifies a bound name;
  //   - a **`vars`-mapped** key: the caller's external-input contract, which
  //     always wins (see `CompileTarget.vars`).
  const registry = target.userFunctions;
  // A name is bound when an enclosing binding form recorded it in
  // `boundVars` (lambda param, Sum/Product/Loop index, Block local,
  // comprehension var, Match capture). `resolved === s` is kept as an
  // additional signal for binding forms that resolve a bound name to its
  // own bare identifier (the common loop path) and is harmless — the base
  // resolver never returns a bare identifier for a free user-function
  // symbol (it returns `_.<s>`). The explicit `boundVars` set covers the
  // cases where a binding form resolves the name to NON-identity code
  // (an unrolled-Sum numeric literal, an interval `_IA.point(i)` wrap, a
  // Match `subject[i]` accessor), which `resolved === s` misses (A2).
  const isBoundOrMapped =
    resolved === s ||
    target.boundVars?.has(s) === true ||
    target.varsKeys?.has(s) === true;
  // `Nothing` is the value of an empty block or of a statement with no
  // value, and compiled code has no representation of it as a value: a
  // literal `Nothing` outside a statement position (`[1, Nothing]`, a
  // branch `If(c, Nothing, 7)`) declines. Reaching this point means an
  // emitter is about to splice it in as an ordinary operand, and without
  // this decline every target's free-symbol plumbing produced something
  // that looks like success: the shader
  // targets emitted the undefined identifier `Nothing` (a driver-side
  // compile error behind `success: true`), the Python target the
  // undefined name `Nothing`, and the interval target a `_.Nothing`
  // vars-object read that is `undefined` at run time. Fail closed
  // for every target here, on the one route they share. The JavaScript
  // target's own `var` hook refuses it first with the same message, so
  // this guard is what the other targets rely on. A BOUND name or a
  // caller `vars` key spelled `Nothing` is a genuine variable and is
  // served above.
  if (s === 'Nothing' && !isBoundOrMapped) throw nothingOperandDecline();
  if (registry && !isBoundOrMapped && !registry.misses?.has(s)) {
    // The VALUE position, so a declared-complex parameter needs the
    // coercing shim: this reference may end up as `Map`'s callback, which
    // passes raw elements (see `ensureUserFunctionValueRef`).
    const decline: DeclineNote = {};
    const userFn = ensureUserFunctionValueRef(expr.engine, s, target, decline);
    // A target whose language has no function VALUES (the shader targets)
    // decides what this reference means — in practice, fails closed.
    if (userFn !== undefined && !hadVarsRef) target.varsObjectRefs?.delete(s);
    if (userFn !== undefined && registry.lowering)
      return registry.lowering.value({ id: s, name: userFn, target });
    if (userFn !== undefined) return userFn;
    // The symbol names a function the USER defined, and the target
    // declined to emit its definition. Falling through to the
    // free-symbol read `_.<s>` produced an artifact that reported
    // `success: true` and then threw `TypeError: _f is not a function`,
    // because nothing binds that key: with a nominal `type meters =
    // number`, the clause set `w(d: meters) := 2` / `w(x, y) := x + y`
    // has no faithful JavaScript guard for its first clause, and
    // `Map(w, [1, 2, 3])` compiled to
    // `((_f) => ([1, 2, 3]).map((_x) => _f(_x)))(_.w)`. Refuse instead,
    // the same answer a built-in operator name in this position gets
    // just below; with the default `fallback: true` the caller reads the
    // interpreter's value. A symbol that is NOT a user function keeps
    // the free-symbol read and the negative memo below.
    if (isUserDefinedFunction(expr.engine, s))
      throw new Error(userFunctionValueRefRefusal(s, target, decline.reason));
    // Memoize the negative lookup so a repeated free symbol doesn't re-hit
    // `lookupDefinition` on every occurrence during this compile.
    (registry.misses ??= new Set()).add(s);
  }
  // A bare BUILT-IN operator symbol in value position (`Map(Sin, xs)`,
  // `CountIf(xs, IsPrime)`) is eta-expanded into `(p) ↦ Sin(p)` and
  // emitted through the SAME shared-local machinery user functions use.
  // Without this it fell through to the free-symbol read `_.Sin` and the
  // artifact threw `_f is not a function` at RUN time — a broken artifact
  // where the fail-closed principle wants either working code or a
  // compile-time refusal. Tried AFTER the user-function route (a user
  // definition shadowing the name wins) and only from THIS path, so an
  // application HEAD (`Sin(x)` → `Math.sin(x)`) is untouched.
  if (registry && !isBoundOrMapped) {
    const etaFn = ensureBuiltinCallbackEmitted(expr.engine, s, target);
    // As for user functions: a target whose language has no function
    // VALUES (the shader targets) decides what this reference means — in
    // practice, fails closed.
    if (etaFn !== undefined && !hadVarsRef) target.varsObjectRefs?.delete(s);
    if (etaFn !== undefined && registry.lowering)
      return registry.lowering.value({ id: s, name: etaFn, target });
    if (etaFn !== undefined) return etaFn;
    // A BUILT-IN operator name that could not be expanded (variadic,
    // zero-required like `Random`, or a wrapper body that does not
    // canonicalize) must not fall through to `_.Random`: that artifact
    // compiles "successfully" and throws `_f is not a function` at run
    // time. Fail closed — with the default `fallback: true` route
    // this becomes an interpreter fallback. Scoped to a system-provenance
    // operator name that is not one the engine itself reads as a variable
    // (`isRefusableBuiltinCallback`): a plain free symbol, a value
    // definition, a `vars` key, or a bound name is not affected.
    if (isRefusableBuiltinCallback(expr.engine, s))
      throw new Error(builtinCallbackRefusal(s));
    // An operator the HOST declared with a JavaScript `evaluate` handler
    // (or a definition that shadows a built-in name) is neither a
    // function literal (the user-function route above) nor the built-in
    // (the eta-expansion above). When the compiled code can apply it
    // (a `compile` handler on its definition, or a lowering of the
    // target, such as the `functions` option of `compile()`), it is
    // eta-expanded into `(p) ↦ s(p)`, and the body compiles through that
    // lowering, as `Map(Function(MyOp(t), t), xs)` does. Otherwise it has
    // no function value the compiled code can call: fail closed, as for
    // a built-in that does not expand. `Map(MySqrt, xs)` fell through to
    // the free-symbol read `_.MySqrt`, and the artifact threw
    // `_f is not a function` at run time.
    if (isHostOperatorCallback(expr.engine, s)) {
      const hostFn = ensureHostOperatorCallbackEmitted(expr.engine, s, target);
      if (hostFn !== undefined && !hadVarsRef) target.varsObjectRefs?.delete(s);
      if (hostFn !== undefined && registry.lowering)
        return registry.lowering.value({ id: s, name: hostFn, target });
      if (hostFn !== undefined) return hostFn;
      throw new Error(
        `Could not compile \`${s}\` as a first-class function: the operator ` +
          `has no function value that the compiled code can call. A ` +
          `caller using the default \`fallback: true\` falls back to ` +
          `interpreted evaluation.`
      );
    }
  }
  // The Python target has no registry of emitted functions, so the routes
  // above do not run for it, and the name of an operator or a function
  // fell through to the free-symbol emission below: `Head(List(1))`, which
  // canonicalizes to the symbol `List`, compiled to the Python code `List`,
  // which raises a `NameError` at run time.
  if (
    target.language === 'python' &&
    !registry &&
    !isBoundOrMapped &&
    resolved === undefined &&
    (isRefusableBuiltinCallback(expr.engine, s) ||
      isHostOperatorCallback(expr.engine, s) ||
      isUserDefinedFunction(expr.engine, s))
  )
    throw new Error(pythonOperatorValueRefusal(s));
  if (resolved !== undefined) return liftWideReference(expr, resolved, target);
  // The target did not resolve the symbol (no `vars` mapping, constant, or
  // free-symbol plumbing). Before falling back to a bare reference — which
  // is a dangling identifier for a symbol the engine actually knows — fold
  // an assigned value / declared constant, matching `evaluate()`. This also
  // covers the direct-target `compile(expr, { target })` path, where the
  // raw target has no engine context of its own.
  // A `vars`-mapped symbol is a live input and its value is never folded.
  // It reaches this point only on a direct custom target, whose own `var`
  // hook knows nothing of `vars`: it is emitted by name below, like a free
  // symbol.
  // A symbol bound to a definition that a checkpoint restore marked
  // `_rewound` is inert: it has no value, also when a later definition of
  // the same name has one, so it is not folded either (ROADMAP CE-586).
  const folded =
    target.varsKeys?.has(s) === true ||
    (expr.valueDefinition as { _rewound?: true } | undefined)?._rewound
      ? undefined
      : tryFoldKnownSymbol(expr.engine, s, target);
  if (folded !== undefined) {
    // The code that reads the symbol was compiled for the type of the
    // symbol. A value of another type (a host wrote the value of the
    // definition directly) is refused here, as the interpreter refuses a
    // call of a function literal whose captured symbol holds such a value
    // (`capturedValueMismatch()`, `function-utils.ts`).
    // (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
    assertHeldValueType(expr);
    // A folded value is BAKED — there is no run-time binding, so the
    // "coerced at every entry" exemption that leaves a declared-complex
    // REFERENCE unlifted (see `liftWideReference`) does not apply here.
    // Consumers of a symbol whose analysis says complex read the
    // target's {re, im} encoding, but a real-valued assignment
    // (`z: complex` with `z := 5`) compiles to a bare real literal, and
    // reading `.re` off it yields NaN. Wrap the emission in the
    // target's idempotent `complexLift`. Only a provably scalar-numeric
    // value whose own emission is real-shaped is wrapped; a value
    // already complex-shaped (`isComplexValued`) or non-scalar stays as
    // emitted.
    // The gate is `isComplexValued`, NOT `complexDiscipline`: consumers
    // decide their {re, im} reads with that same predicate, and it is
    // true for a declared-complex symbol under every mode, including the
    // strict-lanes discipline. Gating on mode left a strict compilation
    // emitting `.re` reads against a bare folded literal.
    if (target.complexLift !== undefined && core.isComplexValued(expr)) {
      const value = expr.engine._getSymbolValue(s);
      if (
        value !== undefined &&
        !core.isComplexValued(value) &&
        isSubtype(value.type.type, 'number')
      )
        return target.complexLift(folded);
    }
    return folded;
  }
  // Genuinely free symbol: emit its bare identifier. Give the target a
  // chance to mangle it or fail closed — e.g. a GLSL reserved
  // keyword used as a variable name would emit invalid shader source.
  return liftWideReference(
    expr,
    target.mangleId ? target.mangleId(s) : s,
    target
  );
}

/**
 * Refuse the symbol `expr` when the value its definition holds has another
 * type than the one the expression was typed with. A host can write the
 * value of a definition directly, and the code that reads the symbol was
 * compiled for its type. The interpreter refuses a call of a function
 * literal whose captured symbol holds such a value
 * (`capturedValueMismatch()`, `function-utils.ts`). (User decision
 * 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
 *
 * Only the value of a definition that is not a constant is checked: a
 * constant (`i`, `Pi`) has a library value that no host writes, and its
 * name can also be the variable of a binder in the expression.
 *
 * The `missing` arms of the held type are removed before the comparison,
 * at the top and in every element or component. A declared type cannot
 * name `missing`, and a value can still hold the marker: a selection with
 * no match or a read out of range gives `Missing` whatever the type of the
 * collection is. So a symbol declared `list<color>` whose value is
 * `[Missing, Rgb(0, 1, 0)]` (type `list<color | missing>`) compiles, and a
 * value that is wrong where it is present (`[5, Missing]` for a
 * `list<string>` symbol) is still refused. This is the rule of the store
 * check `matchesOrAbsent()` in `effects-inference.ts`, which removes the
 * same arms before it compares. The type compared is the type the value
 * presents (`presentedValueType()`): a value typed `missing` alone passes,
 * and a number held through a restriction is read as the literal it holds.
 * Compiled code gives an unspecified value
 * for a `Missing` cell of a non-numeric collection (the caveats of
 * `docs/COMPILATION-MODEL.md`), so this check need not refuse it.
 * (`docs/ERROR-MODEL.md`, "`Missing` is a result only — user decision of
 * 2026-11-02", rule 5; ROADMAP CE-791.)
 *
 * A value that the store into a symbol with a declared type admitted
 * because its type OVERLAPS the declared type (`storeAdmission()` in
 * `effects-inference.ts`) is not refused when the compiler reads it at the
 * real lane (`heldOnComplexLane()` is false for it): the store accepted
 * it, and the interpreter tests its evaluated value at each read. The
 * condition is the one of that test (`isTestedAtRead()`), so a value
 * admitted on overlap into another symbol, or held by a symbol whose type
 * was inferred, is compared as any other held value. Compiled
 * code does not test it, and reads the symbol as a value of the declared
 * type; a value outside the declared type gives an unspecified result
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). Such a value
 * on the complex lane is refused: the code that reads the symbol was
 * compiled for the lane of the declared type, and would read the `{re, im}`
 * representation of the value as a number. Example: with `z: complex` and
 * `r: real`, `r := z` is admitted on overlap, and `r + 1` declines, so the
 * input `z = 2 + 0i` gives `3` in the interpreter, not the JavaScript
 * addition of an object and a number. The same holds for a collection with
 * complex elements: `L := zs` with `zs: list<complex>` and `L: list<real>`
 * declines. With `a: real`, the point
 * `P := (-sqrt(1 - a^2), a)` is on the real lane and compiles.
 */
export function assertHeldValueType(expr: Expression): void {
  if (!isSymbol(expr)) return;
  const s = expr.symbol;
  const ce = expr.engine;
  const heldDef = ce.lookupDefinition(s);
  const held =
    isValueDef(heldDef) && !heldDef.value.isConstant
      ? heldDef.value.value
      : undefined;
  if (
    held !== undefined &&
    !expr.type.isUnknown &&
    !held.type.isUnknown &&
    !(
      isValueDef(heldDef) &&
      isTestedAtRead(heldDef.value, held) &&
      !heldOnComplexLane(held)
    ) &&
    !presentedValueType(ce, held).matches(expr.type)
  )
    throw new Error(
      `Could not compile the symbol '${s}': its value has the type ` +
        `'${held.type.toString()}', which is not the type ` +
        `'${expr.type.toString()}' that the expression was typed with. ` +
        `The interpreter evaluates it instead.`
    );
}

/**
 * Whether the compiled code of the value `held` can hold a complex number
 * in the `{re, im}` representation, at the top or in an element or a
 * component. A literal `List` or `Tuple` is walked element by element, and
 * a scalar is answered by `core.isComplexValued()`, which follows the lane
 * that the compiler emits for it: `-sqrt(1 - a^2)` with `a: real` is typed
 * `complex` and is emitted on the real lane. A collection that is not a
 * literal (a symbol `zs: list<complex>`, a `Map`) is answered from its
 * type (`typeHasComplexLeaf()`), since `core.isComplexValued()` answers for
 * one scalar only and is false for such a collection outside the complex
 * discipline, while its elements are still emitted as `{re, im}` objects.
 * Because the type decides, a collection that is not a literal and whose
 * type has a complex leaf is counted as complex even when the compiler would
 * emit its elements on the real lane (a broadcast `Sqrt(1 - xs^2)` with
 * `xs: list<real>`): the read declines, and never gives a wrong value.
 *
 * A value typed as a record or a dictionary is always counted as complex.
 * The element type of a record that is not closed is `tuple<string, any>`,
 * which drops the declared field types, so `typeHasComplexLeaf()` cannot
 * see a complex field (`Q: record{a: complex}` held by
 * `R: record{a: real}`).
 */
function heldOnComplexLane(held: Expression): boolean {
  if (
    isFunction(held) &&
    (held.operator === 'List' || held.operator === 'Tuple')
  )
    return held.ops.some(heldOnComplexLane);
  if (core.isComplexValued(held)) return true;
  if (isSubtype(held.type.type, 'number')) return false;
  if (held.type.matches('record') || held.type.matches('dictionary'))
    return true;
  return typeHasComplexLeaf(held.type.type, undefined, complexDiscipline());
}

/**
 * COMPLEX discipline, the lift at use for a FUNCTION node's VALUE (design
 * §2): a node the analysis calls complex only because its TYPE is wide —
 * an element read of a `list<number>` (`At`), a user-function call whose
 * declared result is `number`/`unknown`, an `If` over wide arms — is
 * emitted by a lowering that hands back whatever it holds, a plain number
 * as often as not, while every complex-lane consumer reads `.re`/`.im` off
 * it. So the emitted value is wrapped in the target's idempotent
 * `complexLift` (an object passes through) exactly like a wide SYMBOL
 * reference (`liftWideReference`), and parent and child agree on the SHAPE.
 *
 * Skipped where the wrap is provably redundant: a node typed non-real (its
 * emission is complex-shaped by contract), and the arithmetic heads whose
 * complex-lane emission always builds a `{re, im}` object
 * (`COMPLEX_PROPAGATING_HEADS`, `Sqrt`/`Ln`/`Log`/`Power`) — every other
 * head pays the idempotent wrap in complex mode rather than a per-head
 * audit of its lowering. Outside the complex discipline: unchanged.
 */
export function liftWideResult(
  node: Expression & { ops: ReadonlyArray<Expression> },
  code: TargetSource,
  target: CompileTarget<Expression>
): TargetSource {
  if (!complexDiscipline() || !target.complexLift) return code;
  const h = node.operator;
  // A control-flow head may lower to STATEMENTS (a `Block` or `If` in a
  // function body, a `Loop`, an `Assign`) — not an expression a call can
  // wrap. Their VALUE positions lift their own arms and locals.
  if (CONTROL_FLOW_HEADS.has(h)) return code;
  if (
    COMPLEX_PROPAGATING_HEADS.has(h) ||
    PROMOTABLE_RADICAL_HEADS.has(h) ||
    h === 'Power'
  )
    return code;
  const t = node.type?.type;
  // A read (`At`, `First`, `Last`, `PointX`, …) gives the element that the
  // collection holds, and a collection can hold a plain number although its
  // element type is `complex`: a local first bound to `[(2, 0)]` and widened
  // by a later `xs = [...xs, (Sqrt(4d), 0)]` keeps its first elements as
  // plain numbers. So a read is lifted even when its type is non-real.
  if (t === undefined) return code;
  if (isNonRealNumber(t) && !ABSENT_READS.has(h)) return code;
  if (!wideNumericType(t)) return code;
  if (!core.isComplexValued(node)) return code;
  // A call to an emitted user function whose body returns a `{re, im}`
  // object by construction (`userFunctions.complexShaped`, recorded when
  // the definition was emitted in this compilation) is already
  // complex-shaped: the wrap would be idempotent, so it is skipped. A
  // function whose body's value position is real-valued (`x ↦ |x|`), a
  // control-flow body, or a multi-clause definition is not recorded, and
  // its call keeps the wrap.
  if (target.userFunctions?.complexShaped?.has(h)) return code;
  return target.complexLift(code);
}

/**
 * Whether the value `node` emits in the complex lane is a `{re, im}`
 * object by construction — the same decision `liftWideResult` makes for
 * one node, read on the VALUE position of a user function's body so its
 * call sites can skip the idempotent wrap (`userFunctions.complexShaped`).
 *
 * `true` for a complex number literal; for a node typed non-real (its
 * emission is complex-shaped by contract); for a complex-propagating head,
 * a promotable radical or `Power` that the analysis calls complex (its
 * complex-lane lowering builds the object); and for a wide-typed node the
 * analysis calls complex, which `liftWideResult` wrapped. A `Block` is read
 * at its last statement, the value the emitted function returns — unless
 * an earlier statement can `Return` first: that value is whatever the
 * `Return` carries, so such a block answers `false`. Every other shape —
 * a real-typed value, a bare parameter or local, another control-flow
 * head — answers `false`, and the call site keeps its wrap. Must be called
 * inside the shape frame the body was compiled under, so the analysis sees
 * the parameters as the body did.
 */
export function complexShapedEmission(node: Expression): boolean {
  if (!complexDiscipline()) return false;
  if (isNumber(node)) return node.isComplex && !node.isInfinity;
  if (!isFunction(node)) return false;
  const h = node.operator;
  if (h === 'Block') {
    const last = node.ops[node.ops.length - 1];
    if (last === undefined) return false;
    for (let i = 0; i < node.ops.length - 1; i++)
      if (containsReturn(node.ops[i])) return false;
    return complexShapedEmission(last);
  }
  if (CONTROL_FLOW_HEADS.has(h)) return false;
  const t = node.type?.type;
  if (t === undefined) return false;
  if (isNonRealNumber(t)) return true;
  if (
    COMPLEX_PROPAGATING_HEADS.has(h) ||
    PROMOTABLE_RADICAL_HEADS.has(h) ||
    h === 'Power'
  )
    return core.isComplexValued(node);
  return wideNumericType(t) && core.isComplexValued(node);
}

/** See `_cseParent`. */
export function cseParentNode(): Expression | undefined {
  return CompilerState._cseParent;
}

export const OMITTING_NUMERIC_AGGREGATES: ReadonlySet<string> = new Set([
  'Sum',
  'Product',
  'Min',
  'Max',
  'Infimum',
  'Supremum',
  'Mean',
  'Median',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
  'Kurtosis',
  'Skewness',
  'Mode',
  'Quartiles',
  'InterquartileRange',
]);

/**
 * Refuse a broadcastable head with an operand that is a read PROVED to
 * find no row or point (`provedAbsentDomainOf()`): `At(M, 7) + 1` for a
 * matrix `M` of two rows. Such a read is typed `missing`, and the
 * application is typed from the row it would read, so the interpreter
 * answers the marker of an absent row, `Missing`, where the scalar
 * lowering of the `missing` operand answers `NaN` (`undefined + 1`). The
 * compiled code fails closed and the interpreter evaluates the
 * expression (`docs/ERROR-MODEL.md` §6). A read whose domain is a number
 * is typed `nan`, not `missing`, and compiles as before.
 */
export function assertNoProvedAbsentObjectOperand(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  const def = engine.lookupDefinition(h);
  if (!isOperatorDef(def) || def.operator.broadcastable !== true) return;
  for (const a of args) {
    const domain = provedAbsentDomainOf(a);
    if (domain === undefined || isSubtype(domain, 'number')) continue;
    throw new Error(
      `Could not compile \`${h}\`: an operand is a read that finds no ` +
        `\`${typeToString(domain)}\`, which the interpreter answers as an ` +
        `absent \`${typeToString(domain)}\`. The interpreter evaluates it instead.`
    );
  }
}

/**
 * Decline an expression whose value can hold `Nothing` as an element or a
 * coordinate. `Nothing` is a value only of an empty block or of a statement
 * with no value, and the interpreter keeps it as an element where it
 * appears, but compiled code has no representation of it as an element.
 * The test reads only static types, and it adds no analysis to show that a
 * value cannot be `Nothing`:
 *
 * - a `Tuple` declines when the type of a coordinate, or a slot of the type
 *   of the tuple, admits `nothing`;
 * - a collection operation that reads elements one by one (an aggregate in
 *   `OMITTING_NUMERIC_AGGREGATES`, `Map`, `Tabulate`, `Scan`, `Zip`,
 *   `Filter`, `Count` with a predicate, a `Reduce` by `Multiply`, and the
 *   paired statistics) declines when the element type of a source
 *   collection admits `nothing`, and `Map`, `Tabulate` and `Scan` also when
 *   the result type of their callback admits it (for `Tabulate`, also an
 *   element of that result). The test reads the type of the callback, not
 *   the result type of the operation: the type of `Map` adds a `nothing`
 *   arm to its elements when the result type of the callback is `any`.
 *
 * A type admits `nothing` only when it has an explicit `nothing` arm
 * (`hasNothingArm()`): `nothing`, `nothing | real`. `any` and `unknown` do
 * not: compiled code produces `Nothing` only from the symbol `Nothing` or
 * from a statement read as a value, and both decline where they occur. A
 * `Nothing` that the host supplies for a value typed `any` is outside the
 * type, and the result is then unspecified. The decline has the code
 * `'possible-nothing'`
 * (`possibleNothingDecline()`), and the interpreter evaluates the
 * expression.
 */
export function assertNoNothingElement(
  h: string,
  args: ReadonlyArray<Expression>,
  node?: Expression
): void {
  if (h === 'Tuple') {
    const tupleType = node ? compilationType(node) : undefined;
    if (
      args.some((x) => hasNothingArm(compilationType(x))) ||
      (typeof tupleType === 'object' &&
        tupleType.kind === 'tuple' &&
        tupleType.elements.some((x) => hasNothingArm(x.type)))
    )
      throw possibleNothingDecline('`Tuple`', 'a coordinate can be `Nothing`');
    return;
  }
  const selects =
    h === 'Filter' ||
    (h === 'Count' && args.length === 2 && args[1].isFunction === true);
  // Product(collection) canonicalizes to a built-in multiplication fold.
  const rawProducer = h === 'Tabulate' || h === 'Scan';
  const numericFold = h === 'Reduce' && isSymbol(args[1], 'Multiply');
  const aggregate = OMITTING_NUMERIC_AGGREGATES.has(h);
  const paired =
    h === 'Covariance' || h === 'PopulationCovariance' || h === 'Correlation';
  if (!(
    aggregate ||
    numericFold ||
    h === 'Map' ||
    rawProducer ||
    h === 'Zip' ||
    selects ||
    paired
  ))
    return;
  // Limits/Element clauses are binding syntax, not collection operands.
  const iteratorFold = (h === 'Sum' || h === 'Product') && args.length > 1;
  const sources = iteratorFold
    ? args.slice(0, 1)
    : h === 'Tabulate'
      ? []
      : h === 'Map'
        ? args.slice(1)
        : selects || numericFold || h === 'Scan'
          ? args.slice(0, 1)
          : args;
  const pairMayHoldNothing = (
    type: Type,
    seen: ReadonlySet<Type> = new Set()
  ): boolean => {
    const t = resolveTypeForCompilation(type);
    if (seen.has(t)) return false;
    if (hasNothingArm(t)) return true;
    if (typeof t !== 'object') return false;
    if (t.kind === 'tuple')
      return t.elements.some((e) => hasNothingArm(e.type));
    if (t.kind === 'union') {
      const next = new Set(seen).add(t);
      return t.types.some((arm) => pairMayHoldNothing(arm, next));
    }
    return false;
  };
  const elementMayBeNothing = (
    type: Type,
    paired: boolean,
    seen: ReadonlySet<Type> = new Set()
  ): boolean => {
    const t = resolveTypeForCompilation(type);
    if (seen.has(t)) return false;
    if (typeof t === 'object' && t.kind === 'union') {
      const next = new Set(seen).add(t);
      return t.types.some((arm) => elementMayBeNothing(arm, paired, next));
    }
    // Joining tuple slot types can absorb nothing, so inspect each slot
    // before asking for the collection's common element type.
    if (
      typeof t === 'object' &&
      t.kind === 'tuple' &&
      t.elements.some((slot) => hasNothingArm(slot.type))
    )
      return true;
    const element = collectionElementType(t);
    return (
      element !== undefined &&
      (hasNothingArm(element) ||
        (paired && pairMayHoldNothing(element)) ||
        (h === 'Tabulate' &&
          elementMayBeNothing(element, false, new Set(seen).add(t))))
    );
  };
  // The callback of `Map` and `Tabulate` is the first operand, and the
  // callback of `Scan` is the second.
  const callbackResult =
    h === 'Map' || rawProducer
      ? functionResult(compilationType(args[h === 'Scan' ? 1 : 0]))
      : undefined;
  if (
    sources.some((source) =>
      elementMayBeNothing(compilationType(source), paired && args.length === 1)
    ) ||
    (callbackResult !== undefined &&
      (hasNothingArm(callbackResult) ||
        (h === 'Tabulate' && elementMayBeNothing(callbackResult, false))))
  )
    throw possibleNothingDecline(`\`${h}\``, 'an element can be `Nothing`');
}

/**
 * `Max`, `Min` and the four ordering comparisons lower to the target's
 * numeric `max`, `min` and `<`. An operand whose declared type is exactly a
 * value type that is not a number (`color`, `regexp`, `object`) has no
 * numeric reading, and the interpreter leaves the call unevaluated, so the
 * compiled code would be a wrong value. Decline: with a `fallback`, the
 * interpreter runs (CE-393). The test is the exact type, never `matches`,
 * because a declared type is routinely wider than the run-time value.
 */
export function assertOrderedOperandsAreNumbers(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  if (
    h !== 'Max' &&
    h !== 'Min' &&
    h !== 'Less' &&
    h !== 'LessEqual' &&
    h !== 'Greater' &&
    h !== 'GreaterEqual'
  )
    return;
  for (const arg of args) {
    const t = arg.type.toString();
    if (t === 'color' || t === 'regexp' || t === 'object')
      throw new Error(
        `Could not compile \`${h}\`: an operand of type '${t}' has no ` +
          `numeric reading on target '${target.language ?? 'unknown'}'.`
      );
  }
}
