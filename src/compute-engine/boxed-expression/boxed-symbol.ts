import type {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../math-json/types.js';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols.js';

import type { Type, TypeString } from '../../common/type/types.js';
import {
  isSignatureType,
  isNonRealNumber,
  widen,
  narrow,
  containsSignatureArm,
  typeElementCount,
} from '../../common/type/utils.js';
import { reduceType } from '../../common/type/reduce.js';
import { isEmptyType } from '../../common/type/subtype.js';
import type { OneOf } from '../../common/one-of.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';

import type { BigNum } from '../numerics/types.js';
import { NumericValue } from '../numeric-value/types.js';

import type {
  Expression,
  SimplifyOptions,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  PatternMatchOptions,
  ReplaceOptions,
  BoxedValueDefinition,
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
  Metadata,
  CanonicalOptions,
  BoxedBaseDefinition,
  BoxedSubstitution,
  EvaluateOptions,
  Rule,
  BoxedRule,
  BoxedRuleSet,
  Substitution,
  Sign,
  BoxedDefinition,
  CollectionHandlers,
  ExpressionInput,
  SymbolInterface,
} from '../global-types.js';

import { activeRollbackFrame } from '../inference-rollback.js';

import { mul, div } from './arithmetic-mul-div.js';

import { replace } from './rules.js';
import { simplifyValueBlind } from './simplify.js';
import { explainExpression } from './explain.js';
import { negate } from './negate.js';

import { match } from './match.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { clearClauseProvenance } from '../clause-identity.js';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
  updateDef,
  defIsCallableShaped,
} from './utils.js';
import { pow } from './arithmetic-power.js';
import { add } from './arithmetic-add.js';
import {
  positiveSign,
  nonPositiveSign,
  negativeSign,
  nonNegativeSign,
} from './sgn.js';
import { matchesSymbol } from '../../math-json/utils.js';
import { getSignFromAssumptions } from '../assume.js';
import { getFactIndex, hasAssumptions } from './constraint-subject.js';
import { isNumber, isSymbol } from './type-guards.js';
import { checkDeadline } from '../../common/interruptible.js';
import { sameBinding } from './compare.js';
import { evaluateInOwnBindings, valueDefinitionInContext } from './binders.js';
import { assertLiveBinding } from './binding-tombstone.js';
import {
  CYCLE_DETECTED,
  CycleDepthQuery,
  CycleQuery,
  enterCycleDepthQuery,
  enterCycleQuery,
  exitCycleDepthQuery,
  exitCycleQuery,
} from './cycle-guard.js';

/**
 * The definition whose dereference a cycle has invalidated (`a = b + 1;
 * b = a + 1`), or `undefined` when no cycle is being unwound. Set at the
 * re-entry point and cleared by that definition's own frame — a flag rather
 * than a thrown sentinel, which the rule engine's blanket handlers would
 * absorb. See `BoxedSymbol._dereference`.
 */
let _dereferenceCycle: BoxedDefinition | undefined;

/** Nesting depth of `BoxedSymbol._dereference`. Identifies the frame at the TOP
 * of a dereference chain, which is the only one where a cycle's stored value is
 * the pinned residual rather than something to keep symbolic. */
let _dereferenceDepth = 0;

/**
 * ### BoxedSymbol
 *
 * A boxed symbol is a reference to a `BoxedDefinition`.
 *
 * A `BoxedDefinition` "owns" all the information about a symbol, its
 * type and various attributes (is it a constant?, etc...).
 *
 * Boxed symbols are bound to a definition during construction if they
 * are canonical.
 *
 * If a symbol is not canonical (and thus not bound to a definition),
 * some properties and methods will return `undefined`, for example
 * `isInteger`, `isRational`, `isReal`, etc...
 *
 * There is a single value definition for each symbol in each scope.
 * During recursion, fresh scopes are created per call so each
 * invocation has its own bindings (see `makeLambda` in function-utils.ts).
 *
 * The value of a symbol is stored in its `BoxedValueDefinition` — there
 * is no separate evaluation-context values map.
 *
 * The `value` property of a boxed symbol is the value found by walking
 * the scope chain from the current lexical scope. It is `undefined` if
 * the symbol is not bound to a definition or if the value is not known.
 *
 */
export class BoxedSymbol extends _BoxedExpression implements SymbolInterface {
  override readonly _kind = 'symbol';

  private _hash: number | undefined;

  /** The name of the symbol */
  protected _id: MathJsonSymbol;

  /**
   * The definition of the symbol, if the symbol is bound/canonical.
   */
  private readonly _def: BoxedDefinition | undefined;

  /** Note: to indicate that the symbol should be canonical, pass a def. */
  constructor(
    ce: ComputeEngine,
    name: MathJsonSymbol,
    options?: {
      metadata?: Metadata;
      def?: BoxedDefinition;
    }
  ) {
    super(ce, options?.metadata);

    console.assert(
      isValidSymbol(name),
      `Invalid symbol "${name}": ${validateSymbol(name)}`
    );
    this._id = name;
    this._def = options?.def;
  }

  get json(): MathJsonExpression {
    return matchesSymbol(this._id) ? this._id : { sym: this._id };
  }

  get hash(): number {
    this._hash ??= hashCode(this._id);
    return this._hash;
  }

  override _unshared(): BoxedSymbol {
    // Constants (`Pi`, `True`, …) and common symbols are interned; return a
    // fresh copy so parse-time metadata does not leak onto the shared instance.
    return new BoxedSymbol(this.engine, this._id, {
      metadata: {
        latex: this.verbatimLatex,
        sourceOffsets: this.sourceOffsets,
      },
      def: this._def,
    });
  }

  get isPure(): boolean {
    return true;
  }

  get isConstant(): boolean {
    const def = this._def;
    return (isValueDef(def) && def?.value.isConstant) ?? false;
  }

  _bind(): void {}

  _reset(): void {}

  get isCanonical(): boolean {
    return this._def !== undefined;
  }
  set isCanonical(val: boolean) {
    throw new Error(
      'Setting the isCanonical property is not allowed. Use the canonical() method instead.'
    );
  }

  get canonical(): Expression {
    // The symbol is canonical if it has a definition
    if (this._def) return this;

    // Return a new canonical symbol, scoped in the current context. The
    // source position rides along (a bare-symbol statement is the idiomatic
    // Epsil return value; the debugger pauses on it by its offsets).
    return this.engine.symbol(
      this._id,
      this.sourceOffsets !== undefined
        ? { metadata: { sourceOffsets: this.sourceOffsets } }
        : undefined
    );
  }

  is(
    other: Expression | number | bigint | boolean | string,
    tolerance?: number
  ): boolean {
    // Structural check (syntactic: `isSame` does NOT follow the binding)
    if (tolerance === undefined && this.isSame(other)) return true;

    // The structural check never follows the binding, so if we have a bound
    // value, try the smart check on it (it may be a function expression).
    // Guarded: with an indirect cycle (`a := b`, `b := a`) each value is
    // another symbol whose `is()` leads straight back here.
    const val = this.value;
    if (!val || val === (this as unknown)) return false;
    if (isNumber(val)) return val.is(other, tolerance);
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.Is);
    if (guard === CYCLE_DETECTED) return false;
    try {
      return val.is(other, tolerance);
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  isSame(other: Expression | number | bigint | boolean | string): boolean {
    if (this === (other as unknown)) return true;

    // The boolean primitives BOX to the `True`/`False` symbols, so they are
    // compared as symbols. This is a comparison of syntax, not of value: a
    // symbol whose assigned value happens to be `True` is not `True`.
    if (other === true) return this.symbol === 'True';
    if (other === false) return this.symbol === 'False';

    // Two symbols are the same symbol when they share a name AND denote the
    // same binding (see `sameBinding`). No binder can enclose this
    // comparison — it is the whole expression — so every occurrence here is
    // free and asks which binding it refers to.
    if (other instanceof _BoxedExpression && isSymbol(other))
      return this.symbol === other.symbol && sameBinding(this, other);

    // `other` is not a symbol: `isSame` is strictly syntactic, so this
    // symbol's value binding is NOT followed (`x := 5` leaves
    // `x.isSame(5)` false). Value equality is `.isEqual()`; identity in the
    // free variables is `.isIdenticallyEqual()`.
    return false;
  }

  toNumericValue(): [NumericValue, Expression] {
    // Structural symbols are bound and behave identically here; only raw
    // (unbound) expressions are excluded from arithmetic, matching
    // `BoxedFunction.toNumericValue()` and `Product.mul()`.
    console.assert(this.isCanonical || this.isStructural);
    const ce = this.engine;

    if (this.symbol === 'ImaginaryUnit')
      return [ce._numericValue({ re: 0, im: 1 }), ce.One];
    if (
      this.symbol === 'PositiveInfinity' ||
      (this.isInfinity && this.isPositive)
    )
      return [ce._numericValue(Infinity), ce.One];
    if (
      this.symbol === 'NegativeInfinity' ||
      (this.isInfinity && this.isNegative)
    )
      return [ce._numericValue(-Infinity), ce.One];
    if (this.symbol === 'NaN') return [ce._numericValue(NaN), ce.One];

    return [ce._numericValue(1), this];
  }

  neg(): Expression {
    return negate(this);
  }

  inv(): Expression {
    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): Expression {
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | Expression): Expression {
    if (rhs === 0) return this;
    return add(this, this.engine.expr(rhs));
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();

    // `x·0 = 0` only when `x` is finite. A symbol with a *known infinite*
    // value (or NaN) gives `∞·0 = NaN`; the fastpath used to short-circuit to
    // Zero. Free symbols (infinity unknown) keep the conventional `·0 → 0`.
    const isZeroRhs = rhs === 0 || (rhs instanceof NumericValue && rhs.isZero);
    if (isZeroRhs) {
      if (this.isNaN || this.isInfinity === true) return this.engine.NaN;
      return this.engine.Zero;
    }
    if (rhs instanceof NumericValue) {
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
    }
    return mul(this, this.engine.expr(rhs));
  }

  div(rhs: number | Expression): Expression {
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(n: number | Expression): Expression {
    const e = typeof n === 'number' ? n : n.im === 0 ? n.re : undefined;

    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (e === 0) return ce.NaN;
    if (e === 1) return this;
    if (e === 2) return this.sqrt();
    if (e === -1) return this.inv();

    // A negative root index denotes a reciprocal; normalize to
    // `1/Root(a, n)` rather than the nonstandard `Root(a, -n)` (#13).
    if (e !== undefined && e < 0 && Number.isInteger(e))
      return ce._fn('Divide', [ce.One, this.root(-e)]);

    return ce._fn('Root', [this, ce.expr(n)]);
  }

  sqrt(): Expression {
    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    // No value-following folds here (`.isSame(0|1|-1)` on a symbol follows
    // its value binding): a mutable symbol's transient value must not leak
    // into the structure this method builds. A number-valued symbol reduces
    // via BoxedNumber.sqrt() when it is evaluated.

    return ce._fn('Sqrt', [this]);
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.expr(semiBase) : undefined;

    // No value-following folds (see sqrt() above): `Ln(x)` while `x` happens
    // to hold `1` must remain `Ln(x)`; BoxedNumber.ln() does the exact
    // reductions once the symbol's value flows in at evaluation.

    // ln(e) = 1 (natural log)
    // ln_c(e) = 1/ln(c) (for other bases)
    if (this.symbol === 'ExponentialE') {
      if (!base || isSymbol(base, 'ExponentialE')) return this.engine.One;
      return this.engine.One.div(base.ln()); // log_c(e) = 1/ln(c)
    }

    if (base) {
      if (base.re === 10) return this.engine._fn('Log', [this]);
      return this.engine._fn('Log', [this, base]);
    }

    return this.engine._fn('Ln', [this]);
  }

  solve(
    vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ): null | ReadonlyArray<Expression> {
    const varNames = normalizedUnknownsForSolve(vars);
    if (varNames.length !== 1) return null;
    if (varNames.includes(this.symbol)) return [this.engine.Zero];
    return null;
  }

  get complexity(): number {
    return 7;
  }

  get operator(): MathJsonSymbol {
    return 'Symbol';
  }

  get symbol(): MathJsonSymbol {
    return this._id;
  }

  //  A base definition is the base class of both value and operator definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.valueDefinition ?? this.operatorDefinition;
  }

  get valueDefinition(): BoxedValueDefinition | undefined {
    if (isValueDef(this._def)) return this._def.value;
    return undefined;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    if (isOperatorDef(this._def)) return this._def.operator;
    return undefined;
  }

  /**
   *
   * Assuming the symbol is used as an argument, subsequent inferences will
   * narrow the domain of the symbol:
   *
   * ```
   * f: real -> number, g: integer -> number
   * f(x) => x: inferred to real
   * g(x) => x: narrowed to integer
   * ```
   *
   * If the symbol is used as a return value, its domain should be widened:
   *
   * ```
   * f: number -> integer, g: number -> real
   * x = f(2) => x: inferred to integer
   * x = g(2) => x: widened to real
   * ```
   *
   * Arguments accumulate constraints and narrow.
   * Return values accumulate possibilities and widen.
   *
   * @inheritdoc
   */
  _infer(
    t: Type,
    inferenceMode: 'narrow' | 'widen' | 'replace' = 'narrow'
  ): boolean {
    if (!this._def) return false;

    // Inside a resolve-only region (`ce._resolveOnly()`: partial forms,
    // serialization) a read must not write inference onto a definition —
    // every call site is fire-and-forget, so declining is safe.
    if (this.engine._resolveOnlyDepth > 0) return false;

    const def = this._def;

    if (isValueDef(def)) {
      // The type of a constant cannot be changed, so it is never inferred,
      // even if it is unknown (e.g. `ContinuationPlaceholder`)
      if (def.value.isConstant) return false;

      if (def.value.inferredType || def.value.type.isUnknown) {
        const previousType = def.value.type;
        // `replace` is LAST-WRITE-WINS — the Epsil static pre-pass uses it
        // to apply the type effect of a top-level assignment, whose runtime
        // counterpart replaces rather than merges (`x = f(); x = g()` leaves
        // `x` with `g`'s type, whatever `f`'s was).
        const inferred = this.engine.type(
          inferenceMode === 'replace'
            ? t
            : inferenceMode === 'widen'
              ? widen(def.value.type.type, t)
              : narrow(def.value.type.type, t)
        );
        // Inferring `unknown` adds no information — the argument's type is
        // still open. It is a no-op, so skip the write: assigning `unknown`
        // to the value definition's type triggers the value-reset in the type
        // setter, which would silently destroy an existing binding. This is
        // what un-assigned a value-holding symbol merely by *parsing* a call
        // that passes it as a bare argument to a callee with an `unknown`/`any`
        // parameter type (e.g. `f(S)` with `f: (unknown) -> unknown`).
        if (inferred.isUnknown) return false;
        // A re-inference that lands on the type already recorded is a no-op:
        // skip the write, which would replace the definition's `BoxedType`
        // with a fresh object (defeating caches keyed on its identity, such
        // as the R-D5 display projection) and bump `_writeVersion` on every
        // use of an already-inferred symbol. `narrow`/`widen` are
        // reference-preserving when nothing changes, so `===` is the test.
        if (inferred.type === def.value.type.type) return true;
        // State event: the zero-mask value-branch inference (design §2b) —
        // a binding can go `unknown` → effect-bearing signature here with
        // no counter advance; future axes subscribe to the event.
        this.engine._noteStateEvent({ kind: 'inference', valueType: true });
        // Rollback journal (family 1): snapshot the coupled type/value
        // slots BEFORE the write — the post-write channel below carries
        // only from/to types and cannot capture them. Restore is verbatim
        // and setter-bypassing (`_restoreTypeSlots`).
        const rollbackFrame = activeRollbackFrame(this.engine);
        if (rollbackFrame !== undefined) {
          const target = def.value;
          const slots = target._typeSlotSnapshot();
          rollbackFrame.record({ undo: () => target._restoreTypeSlots(slots) });
        }
        def.value.type = inferred;
        // A type this method writes is INFERRED, never a contract. Without
        // this the `type.isUnknown` arm of the guard above turned a guess
        // into a hard declaration: a binding created as
        // `ce.declare(x, 'unknown')` and then narrowed by a use (a loop or
        // comprehension index narrowed to the iterated collection's claimed
        // element type, say `integer`) kept `inferredType === false`, so a
        // later assignment of a wider value (`1/2`) was rejected by
        // `assertAssignableValueDef` (`engine-declarations.ts`) instead of
        // widening the type. On the inferred track the assignment widens, as
        // the provenance model requires — inferred means revisable, declared
        // means enforceable (`docs/EFFECTS-MODEL.md`, "Annotation
        // provenance"). A DECLARED concrete type is untouched: the guard
        // above only lets a write through when the type is already inferred
        // or still `unknown`.
        def.value.inferredType = true;
        // Single emission point for the write's passive observers: the
        // provenance history, the fresh-inference set (unknown → concrete
        // during a boxing, for the fresh-matrix-inference repair), and the
        // narrowing sink (`InspectableScope.narrowings()`).
        this.engine._noteInferenceWrite({
          name: this._id,
          binding: def,
          target: def.value,
          valueDef: def.value,
          from: previousType,
          to: inferred,
          kind: 'inferred',
        });
        return true;
      }
      return false;
    }

    if (isOperatorDef(def)) {
      const previousType = def.operator.signature;
      const newType = this.engine.type(
        inferenceMode === 'widen'
          ? widen(def.operator.signature.type, t)
          : narrow(def.operator.signature.type, t)
      );
      // An incompatible constraint (e.g. a symbol bound to an operator
      // definition used where a number is expected) narrows to `never`.
      // Since `never` matches any type, it would be written into the
      // shared definition below, corrupting it engine-wide. Leave the
      // definition unchanged instead.
      if (newType.matches('never')) return false;
      // Unchanged signature (reference-preserving `narrow`/`widen`): skip the
      // no-op write — it would bump `_semanticVersion`/`_worldVersion`
      // engine-wide on every use of the symbol.
      if (newType.type === def.operator.signature.type) return true;
      if (newType.matches('function')) {
        // Rollback journal (family 2): the previous signature `BoxedType`
        // is restored by identity, and `_resyncEffects()` keeps the arrow
        // and the cached effect set in lockstep across the restore.
        const rollbackFrame = activeRollbackFrame(this.engine);
        if (rollbackFrame !== undefined) {
          const target = def.operator;
          const signature = target.signature;
          rollbackFrame.record({
            undo: () => {
              target.signature = signature;
              target._resyncEffects();
            },
          });
        }
        // The function signature was modified
        def.operator.signature = newType;
        // Signature inference mutates a SHARED operator definition in place: a
        // semantic change other expressions may depend on.
        this.engine._noteStateEvent({
          kind: 'inference',
          symbolSignature: true,
        });
        this.engine._noteInferenceWrite({
          name: this._id,
          binding: def,
          target: def.operator,
          from: previousType,
          to: newType,
          kind: 'inferred',
        });
        return true;
      }
      // The type is no longer a function, use a value definition.
      // Zero-mask `type-write` (this caller bumps nothing today): an
      // inference-driven operator→value swap — callability leaves the
      // binding unless the narrowed type still carries an arm.
      updateDef(this.engine, this._id, def, { type: newType.type });
      this.engine._noteStateEvent({
        kind: 'type-write',
        callableBefore: true,
        callableAfter: containsSignatureArm(newType.type),
      });
      // `updateDef` swapped the binding's halves in place: the write landed
      // on the NEW value definition the swap installed, so provenance is
      // recorded there (falling back to the original operator half only if
      // the swap somehow left no value half). `valueDef` is deliberately NOT
      // passed: the fresh-inference set never tracked this swap path (the
      // pre-swap signature is never the `unknown` type), and the emission
      // must not change that.
      this.engine._noteInferenceWrite({
        name: this._id,
        binding: def,
        target: isValueDef(def) ? def.value : def.operator,
        from: previousType,
        to: newType,
        kind: 'inferred',
      });
      return true;
    }

    // The type was not modified
    return false;
  }

  /** Return the value of the symbol, undefined if an operator or not bound */
  get _value(): Expression | undefined {
    if (!this._def || isOperatorDef(this._def)) return undefined;

    // If the symbol is a constant, the definition has the value
    if (this._def.value.isConstant) return this._def.value.value;

    // Guard (static): a value that mentions this symbol by name (`a := a + 1`)
    // forms a cycle — following it would re-resolve this symbol forever.
    // Treat it as unbound so resolution stays symbolic instead of overflowing
    // the stack. Detected once, when the value is assigned.
    if (this._def.value.isSelfReferential) return undefined;

    // Lookup the value by walking the scope chain
    const result = this._contextValue();

    // Guard (dynamic): the resolved value IS this symbol (degenerate `a := a`,
    // or a function parameter bound in the call scope to an argument of the
    // same name — e.g. evaluating `f(x)` for `f(x) := 2x`). Such bindings are
    // created directly on the scope, bypassing the value setter, so the static
    // flag above does not see them; this O(1) check catches them.
    if (
      result !== undefined &&
      'symbol' in result &&
      result.symbol === this._id
    )
      return undefined;

    return result;
  }

  /**
   * The value this occurrence reads in the current runtime context: the
   * innermost binding of its name in the scope chain, except that a call
   * frame's parameter activation of some OTHER binding is skipped — inside a
   * function body whose parameter shares this symbol's name, that parameter
   * is not the symbol this node denotes. See `valueDefinitionInContext`.
   */
  private _contextValue(): Expression | undefined {
    const def = this._def;
    return valueDefinitionInContext(
      this.engine,
      this._id,
      def !== undefined && 'value' in def ? def.value : undefined
    )?.value;
  }

  get value(): Expression | undefined {
    // If the definition is an operator definition, return a special value
    // @todo:  not clear this is something useful... Could return a hash of the operator, and keep a map of hash to their definitions...
    if (isOperatorDef(this._def))
      return this.engine._fn('Operator', [this.engine.string(this._id)]);

    return this._value;
  }

  set value(
    value:
      | boolean
      | string
      | BigNum
      | number[]
      | OneOf<
          [
            { re: number; im: number },
            { num: number; denom: number },
            Expression,
          ]
        >
      | number
      | _BoxedExpression
      | undefined
  ) {
    if (!this._def)
      throw new Error(`Cannot set value of non-canonical ${this._id}`);

    const ce = this.engine;

    //
    // Clear assumptions about this symbol
    //
    ce.forget(this._id);

    //
    // Determine the new value
    //
    let v: Expression | undefined;
    if (typeof value === 'boolean') value = value ? ce.True : ce.False;
    if (typeof value === 'string') value = ce.string(value);
    if (typeof value === 'object' && value !== null) {
      // An already-boxed expression must be recognized BEFORE the
      // `{re, im}` sniff below: every BoxedExpression has `re`/`im`
      // getters, so the sniff used to convert a boxed non-numeric value
      // (a lambda, a symbol, a list) into a complex number whose parts
      // are NaN. `ce.expr()` below passes a boxed value through
      // unchanged.
      if (value instanceof _BoxedExpression) {
        // Handled by `ce.expr()` below.
      } else if (
        Array.isArray(value) &&
        value.every((x) => typeof x === 'number')
      )
        value = ce._fn(
          'List',
          value.map((x) => ce.expr(x))
        );
      else if (Array.isArray(value)) {
        // A MathJSON function expression such as `["Function", body, "x"]`
        // (an array of numbers is the List convenience above): boxed by
        // `ce.expr()` below.
      } else if ('re' in value && 'im' in value)
        value = ce.number(ce.complex(value.re ?? 0, value.im));
      else if ('num' in value && 'denom' in value)
        value = ce.number([value.num!, value.denom!]);
      // Any other object is a MathJSON object form (`{fn: …}`, `{num: …}`,
      // `{sym: …}`, `{str: …}`) handled by `ce.expr()` below. Note the two
      // deliberate consequences: `{num: 1}` WITHOUT `denom` is the MathJSON
      // number-object form and boxes to the plain number 1 (only the
      // `{num, denom}` pair is the rational shorthand), and an object
      // matching no MathJSON shape becomes an `unexpected-mathjson` error
      // EXPRESSION rather than a synchronous throw — `ce.expr()`'s
      // untrusted-input contract, which this setter now follows.
    }

    if (value !== undefined) {
      const boxedValue = ce.expr(value as Expression);
      v = boxedValue.evaluate();
    }

    //
    // Assign the value to the corresponding definition
    //
    // The constant guard runs BEFORE the function branch: both branches
    // replace the definition, and the setter's documented contract is that
    // writing a constant throws — for a lambda value as much as for `0`.
    if (isValueDef(this._def) && this._def.value.isConstant)
      throw new Error(
        `The value of the constant "${this._id}" cannot be changed`
      );

    if (v?.type.matches('function')) {
      // New operator definitions always completely replace an existing one.
      // This is assignment-shaped full replacement (design rule D6), so the
      // clause-provenance side channels keyed on the outer record must be
      // dropped first — a surviving origin stamp would read a later clause
      // as redefining a clause this replacement threw away.
      clearClauseProvenance(this._def);
      // Route the swap through `updateDef` so the operator half is a real
      // `_BoxedOperatorDefinition` — provenance carried over, rollback
      // journaling, provisional-dependent repair — rather than a raw object
      // literal missing the class entirely (which left the definition
      // without `_update`, effects derivation, or a `redefine` event).
      // No explicit `signature`: like `assignValueAsOperatorDef`'s untyped
      // branch (`engine-declarations.ts`), the signature is inferred from
      // the body (`inferredSignature = true`), so a later `ce.assign` can
      // full-replace it and no body-inferred effects specifier is promoted
      // to an author-declared contract.
      const callableBefore = defIsCallableShaped(this._def);
      updateDef(ce, this._id, this._def, {
        evaluate: v, // Evaluate as a lambda
      });
      // No value-setter write happens on this branch, so the `redefine`
      // event is the sole advance (semantic + world axes) — same discipline
      // as the `ce.assign` operator-install route in
      // `engine-declarations.ts`.
      ce._noteStateEvent({
        kind: 'redefine',
        callableBefore,
        callableAfter: true,
      });
      return;
    }

    ce._setSymbolValue(this._id, v);
  }

  /**
   * The type of the symbol.
   *
   * Note that the type of the value of the symbol may be more specific.'
   * For example, a symbol could have a type of 'number' but the value
   * could be 'integer'.
   *
   * If the symbol is not canonical (not bound to a definition), the type is
   * 'unknown'
   */
  get type(): BoxedType {
    const def = this._def;
    // The definition's own type, faithfully — Design E retired the R-D5
    // display projection with the `callback<S>` constructor: an honest arrow
    // slot displays as itself
    // (`docs/TYPE-SYSTEM.md`).
    if (isValueDef(def)) return def.value.type;
    if (isOperatorDef(def)) return def.operator.signature;
    return BoxedType.unknown;
  }

  set type(t: Type | TypeString | BoxedType) {
    if (!this._def)
      throw new Error(`Cannot set type of non-canonical symbol "${this._id}"`);

    if (this._id[0] === '_')
      throw new Error(
        `The type of the wildcard "${this._id}" cannot be changed`
      );

    // Clear assumptions about this symbol
    this.engine.forget(this._id);

    if (typeof t === 'string') t = parseType(t);
    else if (t instanceof BoxedType) t = t.type;

    if (t === 'function' || isSignatureType(t)) {
      if (isOperatorDef(this._def)) {
        // We are changing the signature of a function.
        // State event: an in-place signature write with no legacy bump — a
        // bare route like §2c's, callable on both sides.
        this.engine._noteStateEvent({
          kind: 'type-write',
          callableBefore: true,
          callableAfter: true,
        });
        // @ts-expect-error - signature is readonly but we need to update it
        this._def.operator.signature = t;
      } else {
        // We are changing a symbol to a function.
        // `type-write`, not `redefine`: this caller bumps NOTHING today (the
        // only legacy advance is `updateDef`'s internal G, emitted there as
        // `binding-repair`), so the event must carry a zero parity mask —
        // the callable axis selects `type-write{either side}` identically.
        const callableBefore = defIsCallableShaped(this._def);
        updateDef(this.engine, this._id, this._def, { signature: t });
        this.engine._noteStateEvent({
          kind: 'type-write',
          callableBefore,
          callableAfter: true,
        });
      }
    } else {
      if (isOperatorDef(this._def)) {
        // We are changing a function to a symbol — callability LEAVES the
        // binding (§2b). Zero-mask `type-write` for the same parity reason
        // as the symbol→function branch above.
        updateDef(this.engine, this._id, this._def, { type: t });
        this.engine._noteStateEvent({
          kind: 'type-write',
          callableBefore: true,
          callableAfter: containsSignatureArm(t as Type),
        });
      } else {
        // We are changing the type of a symbol — the bare route of §2c.
        const before = containsSignatureArm(this._def.value.type?.type);
        this.engine._noteStateEvent({
          kind: 'type-write',
          callableBefore: before,
          callableAfter: containsSignatureArm(t as Type),
        });
        this._def.value.type = this.engine.type(t);
        // An explicit retype through this public setter is a DECLARATION,
        // not a guess: clear the inferred marker so nothing downstream —
        // in particular the read-time revision of inferred types
        // (`_reviseInferredType`, boxed-value-definition.ts) — treats the
        // caller's stated type as revisable. Without this, a symbol whose
        // type was first inferred from an assignment kept `inferredType`
        // through an explicit `.type = …` write, and a later change to one
        // of its value's dependencies silently replaced the explicit type.
        this._def.value.inferredType = false;
      }
    }
  }

  has(x: MathJsonSymbol | MathJsonSymbol[]): boolean {
    if (typeof x === 'string') return this._id === x;
    return x.includes(this._id);
  }

  match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  /** The shape of the tensor (dimensions), derived from the type */
  get shape(): number[] {
    const t = this.type.type;
    if (typeof t === 'object' && t.kind === 'list' && t.dimensions)
      return t.dimensions;
    return [];
  }

  /** The rank of the tensor (number of dimensions), derived from the type */
  get rank(): number {
    return this.shape.length;
  }

  // The scalar predicates below all delegate to the symbol's value, and a
  // value that leads (indirectly) back to this symbol would recurse forever.
  // The delegation is therefore wrapped in a cycle guard — EXCEPT when the
  // value is a number literal, a leaf that cannot refer to anything: that
  // keeps the hot `x := 5` case free of any bookkeeping (see
  // `cycle-guard.ts`).

  // The sign of the value of the symbol
  //
  // Mixed binding semantics (SYMBOLIC P2-13, documented): type-backed
  // predicates (`type`, `isInteger`, …) read the definition captured in
  // `_def` at construction/binding time, while sign predicates resolve
  // *dynamically* by symbol name against the live assumptions. In the
  // common path both agree — `assume()` mutates the bound definition in
  // place — but a held instance whose symbol is re-declared in a new scope
  // keeps its construction-time type while its sign tracks the current
  // scope's assumptions.
  get sgn(): Sign | undefined {
    // First check if there's an assigned value
    const value = this.value;
    if (value !== undefined) {
      if (isNumber(value)) return value.sgn;
      const def = this._def!;
      const guard = enterCycleQuery(def, CycleQuery.Sgn);
      if (guard === CYCLE_DETECTED) return undefined;
      try {
        return value.sgn;
      } finally {
        exitCycleQuery(def, guard);
      }
    }

    // Otherwise, check if there are assumptions about this symbol's sign
    return getSignFromAssumptions(this.engine, this.symbol);
  }

  get isOdd(): boolean | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.isOdd;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.IsOdd);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.isOdd;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isEven(): boolean | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.isEven;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.IsEven);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.isEven;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isFinite(): boolean | undefined {
    const fromValue = this._valueIsFinite();
    if (fromValue !== undefined) return fromValue;
    // Type fallback (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1e): a
    // `finite_number` refinement — e.g. from `assume(|q| < 1)` — entails
    // finiteness even without a value. Symmetrically, a `non_finite_number`
    // type entails non-finiteness (see `get isInfinity`).
    const t = this.type;
    if (!t.isUnknown) {
      if (t.matches('finite_number')) return true;
      if (t.matches('non_finite_number')) return false;
    }
    return undefined;
  }

  private _valueIsFinite(): boolean | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.isFinite;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.IsFinite);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.isFinite;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isInfinity(): boolean | undefined {
    const fromValue = this._valueIsInfinity();
    if (fromValue !== undefined) return fromValue;
    // Type fallback, mirroring `BoxedFunction.isInfinity`: the static type can
    // prove non-finiteness where no value is available — e.g. a symbol
    // declared `non_finite_number`. That type is exactly the signed infinities
    // (PositiveInfinity, NegativeInfinity — no NaN member, and no
    // ComplexInfinity, which is typed `complex`), so it entails "is infinite".
    const t = this.type;
    if (!t.isUnknown && t.matches('non_finite_number')) return true;
    return undefined;
  }

  private _valueIsInfinity(): boolean | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.isInfinity;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.IsInfinity);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.isInfinity;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isNaN(): boolean | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.isNaN;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.IsNaN);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.isNaN;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  // x > 0
  get isPositive(): boolean | undefined {
    return positiveSign(this.sgn);
  }

  get isNonPositive(): boolean | undefined {
    return nonPositiveSign(this.sgn);
  }

  get isNegative(): boolean | undefined {
    return negativeSign(this.sgn);
  }

  get isNonNegative(): boolean | undefined {
    return nonNegativeSign(this.sgn);
  }

  get isNumber(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('number');
  }

  get isInteger(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    // Three-valued discipline (D3), mirroring the repaired `isReal`:
    //   entailed (`matches`) → true; overlap → undefined; disjoint → false.
    if (t.matches('integer')) return true;
    // A real-overlapping numeric type (`real`, `rational`, `finite_real`,
    // `finite_rational`, …) could be an integer → indeterminate. `real` is
    // checked before `complex` because `finite_real ⊑ complex` in this lattice.
    if (t.matches('real')) return undefined;
    // `number`/`finite_number` overlap the reals unless they are genuinely
    // complex (`complex`/`imaginary`/`finite_complex`, which are non-integer
    // by the same convention `isReal` uses).
    if (t.matches('number')) return isNonRealNumber(t.type) ? false : undefined;
    // Non-numeric / composite types (e.g. `!string`): definitely-not only when
    // provably disjoint from the integers.
    if (
      isEmptyType(
        reduceType({ kind: 'intersection', types: [t.type, 'integer'] })
      )
    )
      return false;
    return undefined;
  }

  get isRational(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    if (t.matches('rational')) return true;
    if (t.matches('real')) return undefined;
    if (t.matches('number')) return isNonRealNumber(t.type) ? false : undefined;
    if (
      isEmptyType(
        reduceType({ kind: 'intersection', types: [t.type, 'rational'] })
      )
    )
      return false;
    return undefined;
  }

  get isReal(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    if (t.matches('real')) return true;

    // The type cannot prove real-ness. A stored `NotElement(x, RealNumbers)`
    // fact — e.g. derived from `assume(Im(x) > 0)` — refutes it
    // (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1e): types cannot express negation.
    if (hasAssumptions(this.engine)) {
      const facts = getFactIndex(this.engine).membership.get(this._id);
      if (facts?.notIn.some((s) => isSymbol(s, 'RealNumbers'))) return false;
    }

    // `complex`/`imaginary`-typed symbols keep the historical definitive
    // `false`. Other number types (`number`, `finite_number`, ...) overlap
    // `real`, so without a refuting fact the answer is indeterminate
    // (three-valued discipline, design §5.2).
    if (t.matches('number') && !isNonRealNumber(t.type)) return undefined;
    return false;
  }

  get re(): number {
    const value = this.value;
    if (value === undefined) return NaN;
    if (isNumber(value)) return value.re;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.Re);
    if (guard === CYCLE_DETECTED) return NaN;
    try {
      return value.re;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get im(): number {
    const value = this.value;
    if (value === undefined) return NaN;
    if (isNumber(value)) return value.im;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.Im);
    if (guard === CYCLE_DETECTED) return NaN;
    try {
      return value.im;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get bignumRe(): BigNum | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.bignumRe;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.BignumRe);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.bignumRe;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get bignumIm(): BigNum | undefined {
    const value = this.value;
    if (value === undefined) return undefined;
    if (isNumber(value)) return value.bignumIm;
    const def = this._def!;
    const guard = enterCycleQuery(def, CycleQuery.BignumIm);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return value.bignumIm;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    return simplifyValueBlind(this, options).at(-1)?.value ?? this;
  }

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    return explainExpression(this, operation, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    const canonical = this._canonicalToEvaluate();
    if (canonical) return canonical.evaluate(options);

    const def = this.valueDefinition;
    if (!def) return this;
    // Debug invariant (§3 of the binder-mechanism design): a resolution site,
    // not the `valueDefinition` getter, which must stay a plain field read.
    if (this.engine._debugBindings) assertLiveBinding(def, this._id);
    const hold = def.holdUntil;

    if (def.isConstant) {
      if (options?.numericApproximation) {
        if (hold === 'never' || hold === 'evaluate' || hold === 'N')
          return this._dereference(def.value, { numericApproximation: true });
      } else if (hold === 'never' || hold === 'evaluate')
        return this._dereference(def.value, options);
    } else {
      if (
        hold === 'never' ||
        hold === 'evaluate' ||
        (hold === 'N' && options?.numericApproximation)
      ) {
        const expr = this._contextValue();
        if (expr === undefined) return this;
        if (expr.operator === 'Unevaluated')
          return expr.evaluate(options) ?? this;
        return this._dereference(expr, options);
      }
    }
    return this;
  }

  /**
   * `evaluate()` yields a canonical value, so a symbol that is not canonical
   * must evaluate to the same value as its canonical form — exactly as a raw
   * or structural function node does (see
   * `BoxedFunction._canonicalToEvaluate()`). An unbound symbol has no
   * definition to resolve, so evaluating it in place always answers with the
   * symbol itself, even when a value is assigned to that name; canonicalizing
   * binds it in the current scope instead.
   *
   * Unlike a function node, a symbol's `_def` is either a definition or
   * `undefined` (never `null`): `isCanonical` and "has a binding" coincide,
   * so a bound symbol — which is all a structural symbol can be — is always
   * evaluated directly, through the `evaluateInOwnBindings` dereference path.
   *
   * Canonicalization is not guaranteed to produce a canonical expression (an
   * invalid symbol canonicalizes to an error). Requiring `isCanonical` of the
   * result, not merely a different node, is what keeps this from recursing
   * forever.
   *
   * Returns the expression to evaluate in our place, or `undefined` to
   * evaluate this symbol directly.
   */
  private _canonicalToEvaluate(): Expression | undefined {
    if (this._def !== undefined) return undefined;
    const canonical = this.canonical;
    return canonical.isCanonical ? canonical : undefined;
  }

  /**
   * Resolve `value` — this symbol's stored value — in the environment its own
   * free symbols denote, rather than returning it verbatim (stale) or
   * re-resolving it by name in the current context (captured). See
   * `evaluateInOwnBindings`.
   *
   * `value` is `undefined` for a declared-but-unassigned symbol, in which case
   * the symbol stays itself.
   *
   * The guard is keyed on this symbol's DEFINITION. A cycle abandons the
   * dereference of the RE-ENTERED definition — not merely the re-entered step,
   * and not the whole chain either — and its stored value is returned only at
   * the TOP of the chain, where a raw residual is the pinned answer; deeper, the
   * symbol stays symbolic so no part of a cycle is substituted into an
   * enclosing expression. Every variant below was measured, and the residuals
   * are pinned in `symbol-value-scoping.test.ts`:
   *
   * | on re-entry | `s = s+1; s` | `a = b+1; b = a+1; a` | `a = p+5; p = q+1; q = p+1; a` |
   * |:--|:--|:--|:--|
   * | resolve one more level | `s + 2` | `b + 5` | — |
   * | return the bare symbol | `s + 1` | `a + 2` | — |
   * | abandon the whole chain | `s + 1` | `b + 1` | `p + 5` — loses a's dereference |
   * | abandon the re-entered def, always returning its value | `s + 1` | `b + 3` | `q + 8` |
   * | **…returning its value only at the top of the chain** | `s + 1` | `b + 1` | `q + 6` |
   *
   * The last row is implemented. Two distinctions only show up beyond the
   * one-hop case: `a` is not itself cyclic, so abandoning ITS dereference (row
   * 3) silently reinstates the staleness this repair removes; and because
   * assignment is EAGER, `b = a + 1` with `a = b + 1` actually stores `b + 2`, so
   * returning a cyclic definition's stored value to an enclosing expression
   * (row 4) substitutes that extra level.
   *
   * Signalled by a module-level flag naming the re-entered definition, NOT by a
   * throw. A thrown sentinel is absorbed by the rule engine's blanket `catch`
   * handlers (`rules.ts` re-throws only `CancellationError` and otherwise treats
   * an exception as "this rule failed"), so a cyclic definition dereferenced
   * during `simplify()` would silently truncate the whole pass. It would also
   * make `Dereference` the one cycle-guard kind that throws, against the
   * invariant stated at the top of `cycle-guard.ts`. Failing closed keeps both
   * properties: the guard already bounds the recursion, so the frames between
   * the re-entry point and the re-entered definition merely compute a result
   * that is then discarded.
   */
  private _dereference(
    value: Expression | undefined,
    options?: Partial<EvaluateOptions>
  ): Expression {
    if (value === undefined) return this;
    const def = this._def;
    if (def === undefined) return value;
    const guard = enterCycleQuery(def, CycleQuery.Dereference);
    if (guard === CYCLE_DETECTED) {
      // Name the definition whose dereference must be abandoned, and stay
      // symbolic here so nothing of the cycle is substituted in the meantime.
      _dereferenceCycle = def;
      return this;
    }
    const outermost = _dereferenceDepth === 0;
    _dereferenceDepth += 1;
    try {
      const result = evaluateInOwnBindings(this.engine, value, options);
      // Reached by a cycle: this definition's own dereference is the one to
      // abandon, so return the stored value unresolved. Any other definition's
      // cycle propagates — the caller decides — and `result` is discarded there.
      if (_dereferenceCycle === def) {
        _dereferenceCycle = undefined;
        // The stored value is the pinned residual only when this is the top of
        // the chain (`s = s + 1; s` → `s + 1`). Deeper, returning it would
        // substitute a level of the cycle into the enclosing expression
        // (`a = b + 1; b = a + 1; a` → `b + 3`), so stay symbolic.
        return outermost ? value : this;
      }
      // Another definition's cycle is unwinding past this frame: stay symbolic
      // rather than returning the stored value, which would substitute one more
      // level of the cycle on the way out (`a = b+1; b = a+1; a` → `b + 3`).
      return _dereferenceCycle === undefined ? result : this;
    } finally {
      _dereferenceDepth -= 1;
      exitCycleQuery(def, guard);
      // Safety net: a cycle whose definition never gets its own frame back (its
      // guard was already exited) must not leave the flag set for unrelated
      // later work. The frame that opened the chain clears it.
      if (outermost) _dereferenceCycle = undefined;
    }
  }

  N(): Expression {
    const canonical = this._canonicalToEvaluate();
    if (canonical) return canonical.N();

    // An indirect cycle (`a := b`, `b := a`) is invisible to the
    // self-reference guards below: each value mentions only the OTHER symbol.
    // Stay symbolic rather than recursing forever (see `cycle-guard.ts`).
    const binding = this._def;
    if (binding !== undefined) {
      const guard = enterCycleQuery(binding, CycleQuery.N);
      if (guard === CYCLE_DETECTED) return this;
      try {
        return this._N();
      } finally {
        exitCycleQuery(binding, guard);
      }
    }
    return this._N();
  }

  private _N(): Expression {
    const def = this.valueDefinition;
    if (def && this.engine._debugBindings) assertLiveBinding(def, this._id);
    // Note: `holdUntil: 'never'` means "substitute as early as possible" —
    // it never *prevents* numeric evaluation. (A previous version returned
    // `this` for 'never', which made `ImaginaryUnit.N()` a no-op and left
    // products like `0.25 * i` unfolded under N().)
    // For non-constants, resolve the scope-chain value via the guarded
    // `_value` (which returns `undefined` for a self-referential binding);
    // an unbound or self-referential symbol stays symbolic rather than
    // recursing forever.
    if (def && !def.isConstant) {
      const contextValue = this._value;
      if (!contextValue) return this;
      // Self-referential CONTEXT binding: a call-frame parameter bound to an
      // argument mentioning the parameter's own name (`a(t + 1)` for
      // `a(t) := …` with `t` unbound in the caller). When symbol values were
      // still resolved by NAME in the current frame, recursing with `.N()`
      // re-resolved the argument's `t` as the parameter forever (Tycho item
      // 46). The value walk now skips a call frame's parameter activation of
      // any other binding (`_contextValue`), so the `t` inside the value
      // reaches the caller's `t` and the recursion ends on its own; this
      // guard stays as the backstop for the by-name fallback that walk keeps
      // for an occurrence whose own binding is no longer reachable. It
      // substitutes the value ONCE, without numericizing
      // through it — mirroring what plain `evaluate()` does for symbol
      // values. The number-literal short-circuit keeps the hot path (loop
      // indices, numeric call arguments) O(1). The scan uses `symbols`, which
      // over-approximates: an occurrence BOUND inside the value (a nested
      // big-op index sharing this name) also suppresses the recursion,
      // degrading to a symbolic result — the same deliberate trade as
      // `isSelfReferentialValue` (boxed-value-definition.ts). `freeVariables`
      // cannot be used here: it resolves bindings against the CURRENT eval
      // context, where this very call-frame binding makes the name look
      // bound, so the guard would never fire.
      if (isNumber(contextValue)) return contextValue.N();
      if (contextValue.symbols.includes(this._id)) return contextValue;
      return contextValue.N();
    }
    return def?.value?.N() ?? this;
  }

  replace(
    rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    const canonical = options?.canonical ?? this.isCanonical;
    if (sub[this._id] === undefined) return canonical ? this.canonical : this;

    const form =
      canonical === true
        ? 'canonical'
        : canonical === false
          ? 'raw'
          : canonical;
    return this.engine.expr(sub[this._id], { form });
  }

  get _asCollection(): CollectionHandlers | undefined {
    if (isValueDef(this._def)) return this._def.value.collection;
    return undefined;
  }

  get isCollection(): boolean {
    if (this._asCollection?.iterator !== undefined) return true;
    const def = this._def;
    if (def === undefined) return false;
    const guard = enterCycleQuery(def, CycleQuery.IsCollection);
    if (guard === CYCLE_DETECTED) return false;
    try {
      return this._value?.isCollection ?? false;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isIndexedCollection(): boolean {
    if (this._asCollection?.at !== undefined) return true;
    const def = this._def;
    if (def === undefined) return false;
    const guard = enterCycleQuery(def, CycleQuery.IsIndexedCollection);
    if (guard === CYCLE_DETECTED) return false;
    try {
      return this._value?.isIndexedCollection ?? false;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isLazyCollection(): boolean {
    const def = this._def;
    if (def === undefined) return false;
    const guard = enterCycleQuery(def, CycleQuery.IsLazyCollection);
    if (guard === CYCLE_DETECTED) return false;
    try {
      return (
        this._asCollection?.isLazy?.(this._value ?? this) ??
        this._value?.isLazyCollection ??
        false
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  contains(rhs: Expression): boolean | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.Contains);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return (
        this._asCollection?.contains?.(this._value ?? this, rhs) ??
        this._value?.contains?.(rhs)
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  // For a non-collection symbol these return `undefined` (the abstract-class
  // contract), not 0 / true — a plain symbol is not an empty collection.
  get count(): number | undefined {
    // A declared collection type pins the size even with no value to walk
    // (`vector<2>` has 2 elements by declaration), so it is the fallback when
    // neither the collection handlers nor a value can answer. It is only a
    // FALLBACK: a value that disagrees with its declared size is a type error
    // reported elsewhere, and the value is the more specific answer regardless.
    const fromType = typeElementCount(this.type.type);
    const def = this._def;
    if (def === undefined) return fromType;
    const guard = enterCycleQuery(def, CycleQuery.Count);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return (
        this._asCollection?.count(this._value ?? this) ??
        this._value?.count ??
        fromType
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isEmptyCollection(): boolean | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.IsEmptyCollection);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      // Deliberately NO type-derived fallback here, unlike `count` above: see
      // the note on `_BoxedExpression.isEmptyCollection`. Library operators
      // treat a decided `isFiniteCollection`/`isEmptyCollection` as licence to
      // walk, and a valueless symbol's `each()` yields nothing, so answering
      // from the declared size turns an unresolved operand into a definite
      // empty result.
      return (
        this._asCollection?.isEmpty?.(this._value ?? this) ??
        this._value?.isEmptyCollection
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  get isFiniteCollection(): boolean | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.IsFiniteCollection);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return (
        this._asCollection?.isFinite?.(this._value ?? this) ??
        this._value?.isFiniteCollection
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  /**
   * A symbol can be walked only through something that holds the elements:
   * its own collection handlers (a built-in set such as `Integers`), or its
   * value. A DECLARED but valueless symbol (`ce.declare('xs', 'list<integer>')`)
   * is the canonical non-enumerable source — its walk yields nothing, and
   * reading that as "empty" is what made `Filter(xs, p)` answer `[]` for a
   * list that a later `xs := [1, 5]` contradicts. Answer a definite `false`
   * so callers stay inert without evaluating.
   *
   * Only the ABSENCE of a value is definite. A symbol that HAS one relays that
   * value's own verdict verbatim, `undefined` included: collapsing it (`?? false`)
   * would report `xs := Characters("aab")` as unwalkable and leave
   * `Filter(xs, p)` inert, where the un-aliased `Filter(Characters("aab"), p)`
   * answers `["a","a"]` — the alias must not change the result.
   */
  get isEnumerableCollection(): boolean | undefined {
    const def = this._def;
    if (def === undefined) return false;
    const guard = enterCycleQuery(def, CycleQuery.IsEnumerableCollection);
    // Fail closed: a binding that re-enters its own enumerability query
    // cannot be walked to a conclusion either.
    if (guard === CYCLE_DETECTED) return false;
    try {
      const handlers = this._asCollection;
      if (handlers !== undefined) {
        // A declared handler owns all three states (see `BoxedFunction`).
        if (handlers.isEnumerable === undefined) return true;
        return handlers.isEnumerable(this._value ?? this);
      }
      const value = this._value;
      if (value === undefined) return false;
      return value.isEnumerableCollection;
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  each(): Generator<Expression> {
    // The guard spans this method's SYNCHRONOUS body only — that is where the
    // delegation to another symbol's `each()` happens, so it is enough to
    // break a cycle — and not the consumption of the returned generator, which
    // would otherwise stay "in progress" for as long as the caller holds it.
    const def = this._def;
    if (def === undefined) return (function* () {})();
    const guard = enterCycleQuery(def, CycleQuery.Each);
    if (guard === CYCLE_DETECTED) return (function* () {})();
    try {
      return this._each();
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  private _each(): Generator<Expression> {
    const iter = this._asCollection?.iterator?.(this._value ?? this);
    if (iter) {
      const engine = this.engine;
      return (function* () {
        let result = iter.next();
        let i = 0;
        while (!result.done) {
          // Enumeration can be unbounded: respect the evaluation deadline.
          if ((++i & 0xff) === 0) checkDeadline(engine._deadlineFrame);
          yield result.value;
          result = iter.next();
        }
      })();
    }
    return this._value?.each() ?? (function* () {})();
  }

  at(index: number): Expression | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleDepthQuery(def, CycleDepthQuery.At);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return this._at(index);
    } finally {
      exitCycleDepthQuery(def, CycleDepthQuery.At, guard);
    }
  }

  private _at(index: number): Expression | undefined {
    // When dispatching to a value-def's own collection handler, centralize
    // negative-index normalization (mirroring `BoxedFunction.at`): the handler
    // gets a 1-based positive index. The `_value.at` fallback is left to
    // normalize itself (it dispatches to another expression's `at`).
    const handler = this._asCollection?.at;
    if (handler) {
      const target = this._value ?? this;
      if (index < 0) {
        if (this.isFiniteCollection !== true) return this._value?.at?.(index);
        const count = this.count;
        if (count !== undefined && Number.isFinite(count)) {
          const normalized = count + 1 + index;
          if (normalized >= 1) {
            const result = handler(target, normalized);
            if (result !== undefined) return result;
          }
          return this._value?.at?.(index);
        }
        return this._value?.at?.(index);
      }
      const result = handler(target, index);
      if (result !== undefined) return result;
    }
    return this._value?.at?.(index);
  }

  get(index: Expression | string): Expression | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.Get);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return this._value?.get?.(index);
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.IndexWhere);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      if (this._asCollection?.indexWhere)
        return this._asCollection.indexWhere(this._value ?? this, predicate);
      return this._value?.indexWhere(predicate);
    } finally {
      exitCycleQuery(def, guard);
    }
  }

  subsetOf(rhs: Expression, strict: boolean): boolean | undefined {
    // No definition, or a self-referential query: undecided rather than `no`
    // — an undeclared symbol may still be assigned a collection later.
    const def = this._def;
    if (def === undefined) return undefined;
    const guard = enterCycleQuery(def, CycleQuery.SubsetOf);
    if (guard === CYCLE_DETECTED) return undefined;
    try {
      return (
        this._asCollection?.subsetOf?.(this._value ?? this, rhs, strict) ??
        this._value?.subsetOf?.(rhs, strict)
      );
    } finally {
      exitCycleQuery(def, guard);
    }
  }
}
