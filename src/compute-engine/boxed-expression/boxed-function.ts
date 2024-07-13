import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import { _BoxedExpression } from './abstract-boxed-expression';

import {
  Expression,
  MathJsonFunction,
  MathJsonIdentifier,
} from '../../math-json/math-json-format';
import {
  BoxedFunctionDefinition,
  IComputeEngine,
  BoxedRuleSet,
  SimplifyOptions,
  Substitution,
  ReplaceOptions,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  RuntimeScope,
  BoxedSubstitution,
  EvaluateOptions,
  BoxedBaseDefinition,
  Hold,
  Rule,
  CanonicalOptions,
} from '../public';
import { findUnivariateRoots } from '../solve';
import { isRational } from '../numerics/rationals';
import { replace } from '../rules';
import { DEFAULT_COMPLEXITY, order } from './order';
import {
  complexAllowed,
  hashCode,
  bignumPreferred,
  normalizedUnknownsForSolve,
  isRelationalOperator,
} from './utils';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { checkNumericArgs, adjustArguments } from './validate';
import { expand } from '../symbolic/expand';
import { apply } from '../function-utils';
import { semiCanonical, shouldHold } from '../symbolic/utils';
import { at, isFiniteIndexableCollection } from '../collection-utils';
import { narrow } from './boxed-domain';
import { canonicalAdd } from '../library/arithmetic-add';
import { canonicalPower, isSqrt } from '../library/arithmetic-power';
import { canonicalDivide } from '../library/arithmetic-divide';
import { canonicalMultiply } from '../library/arithmetic-multiply';
import { BoxedExpression, SemiBoxedExpression } from './public';
import { signDiff } from './numerics';
import { match } from './match';
import { factor } from './factor';
import { negate } from '../symbolic/negate';
import { Terms } from '../numerics/terms';
import { Product } from '../symbolic/product';

/**
 * A boxed function represent an expression that can be
 * represented by a function call.
 *
 * It is composed of a head (the name of the function) and
 * a list of arguments.
 *
 * It has a definition associated with it, based
 * on the head. The definition contains the signature of the function,
 * and the implementation of the function.
 *
 * @noInheritDoc
 *
 */

export class BoxedFunction extends _BoxedExpression {
  // The head of the function
  private readonly _head: string | BoxedExpression;

  // The arguments of the function
  private readonly _ops: ReadonlyArray<BoxedExpression>;

  // The canonical representation of this expression.
  // If this expression is not canonical, this property is undefined.
  private _canonical: BoxedExpression | undefined;

  // The scope in which this function was defined/boxed
  private _scope: RuntimeScope | null;

  // Note: only canonical expressions have an associated def
  private _def: BoxedFunctionDefinition | undefined;

  private _isPure: boolean;

  // The domain of the value of the function applied to its arguments
  private _result: BoxedDomain | undefined = undefined;

  private _hash: number | undefined;

  constructor(
    ce: IComputeEngine,
    head: string | BoxedExpression,
    ops: ReadonlyArray<BoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    options = options ? { ...options } : {};
    options.canonical ??= false;

    super(ce, options.metadata);

    this._head = head;
    this._ops = ops;

    if (options.canonical) {
      this._canonical = this;
      this.bind();
    }

    ce._register(this);
  }

  //
  // NON-CANONICAL OR CANONICAL OPERATIONS
  //
  // Those operations/properties can be applied to a canonical or
  // non-canonical expression
  //
  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    if (typeof this._head === 'string') h = (h ^ hashCode(this._head)) | 0;
    else h = (h ^ this._head.hash) | 0;
    this._hash = h;
    return h;
  }

  // For function expressions, infer infers the result domain of the function
  infer(domain: BoxedDomain): boolean {
    const def = this._def;
    if (!def) return false;

    if (!def.signature.inferredSignature) return false;

    if (typeof def.signature.result !== 'function')
      def.signature.result = narrow(def.signature.result, domain);
    return true;
  }

  bind(): void {
    // Unbind
    this._def = undefined;

    this._scope = this.engine.context;

    const head = this._head;
    if (typeof head !== 'string') {
      head.bind();
      return;
    }

    this._def = this.engine.lookupFunction(head);
    for (const op of this._ops) op.bind();
  }

  reset(): void {
    // Note: a non-canonical expression is never bound
    // this._def = null;
  }

  get isExact(): boolean {
    return isSqrt(this) && this.op1.isExact;
  }

  get isCanonical(): boolean {
    return this._canonical === this;
  }

  set isCanonical(val: boolean) {
    this._canonical = val ? this : undefined;
  }

  get isPure(): boolean {
    if (this._isPure !== undefined) return this._isPure;
    if (!this.isCanonical) {
      this._isPure = false;
      return false;
    }
    let pure = this.functionDefinition?.pure ?? false;

    // The function might be pure. Let's check that all its arguments are pure.
    if (pure) pure = this._ops.every((x) => x.isPure);

    this._isPure = pure;
    return pure;
  }

  get json(): Expression {
    const head =
      typeof this._head === 'string'
        ? this._head
        : (this._head.json as MathJsonIdentifier | MathJsonFunction);
    return [head, ...this.ops.map((x) => x.json)];
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get head(): string | BoxedExpression {
    return this._head;
  }

  get ops(): ReadonlyArray<BoxedExpression> {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): BoxedExpression {
    return this._ops[0] ?? this.engine.Nothing;
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.Nothing;
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.Nothing;
  }

  get isValid(): boolean {
    if (this._head === 'Error') return false;

    if (typeof this._head !== 'string' && !this._head.isValid) return false;

    return this._ops.every((x) => x?.isValid);
  }

  get canonical(): BoxedExpression {
    this._canonical ??= this.isValid
      ? this.engine.function(this._head, this._ops)
      : this;

    return this._canonical;
  }

  // Note: the resulting expression is bound to the current scope, not
  // the scope of the original expression.
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    const ops = this._ops.map((x) => x.subs(sub, options));

    if (!ops.every((x) => x.isValid))
      return this.engine.function(this._head, ops, { canonical: false });

    return this.engine.function(this._head, ops, options);
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  has(x: string | string[]): boolean {
    if (typeof this._head === 'string') {
      if (typeof x === 'string') {
        if (this._head === x) return true;
      } else if (x.includes(this._head)) return true;
    }
    for (const arg of this._ops) if (arg.has(x)) return true;
    return false;
  }

  /** `isSame` is structural/symbolic equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedFunction)) return false;

    // Number of arguments must match
    if (this.nops !== rhs.nops) return false;

    // Head must match
    if (typeof this.head === 'string') {
      if (this.head !== rhs.head) return false;
    } else {
      if (typeof rhs.head === 'string') return false;
      if (
        !rhs.head ||
        !this.engine.box(this.head).isSame(this.engine.box(rhs.head))
      )
        return false;
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    for (let i = 0; i < lhsTail.length; i++)
      if (!lhsTail[i].isSame(rhsTail[i])) return false;

    return true;
  }

  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): BoxedExpression {
    return negate(this.canonical);
  }

  inv(): BoxedExpression {
    return this.engine.One.div(this.canonical);
  }

  abs(): BoxedExpression {
    if (!this.isCanonical) return this.canonical.abs();
    if (this.head === 'Abs' || this.head === 'Negate') return this;
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    if (!this.isCanonical) return this.canonical.add(...rhs);
    if (rhs.length === 0) return this;
    const ce = this.engine;

    return new Terms(ce, [
      this,
      ...rhs.map((x) => (typeof x === 'number' ? ce.number(x) : x)),
    ]).asExpression();
  }

  sub(rhs: BoxedExpression): BoxedExpression {
    return this.add(rhs.neg());
  }

  mul(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    if (!this.isCanonical) return this.canonical.mul(...rhs);
    if (rhs.length === 0) return this;

    const ce = this.engine;

    return new Product(ce, [
      this,
      ...rhs.map((x) => (typeof x === 'number' ? ce.number(x) : x)),
    ]).asExpression();
  }

  div(rhs: BoxedExpression): BoxedExpression {
    return canonicalDivide(this.canonical, rhs.canonical);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return canonicalPower(
      this.canonical,
      typeof exp === 'number' ? this.engine.number(exp) : exp.canonical
    );
  }

  sqrt(): BoxedExpression {
    return canonicalPower(this.canonical, this.engine.Half);
  }

  //
  // CANONICAL OPERATIONS
  //
  // These operations apply only to canonical expressions
  //

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    return this.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.functionDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this._def;
  }

  /** `isEqual` is mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    const lhs = this.simplify();
    rhs = rhs.simplify();

    const head = lhs.head;
    //
    // Handle relational operators
    //
    if (head === 'Equal' || head === 'NotEqual' || head === 'Unequal') {
      // @fixme: put lhs and rhs in canonical form, i.e. x + 1 = 2 -> x - 1 = 0
      if (rhs.head !== head) return false;
      // Equality is commutative
      if (
        (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) ||
        (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1))
      )
        return true;
    }
    if (head === 'Less') {
      if (rhs.head === 'Less') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'Greater') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'Greater') {
      if (rhs.head === 'Greater') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'Less') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'LessEqual') {
      if (rhs.head === 'LessEqual') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'GreaterEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'GreaterEqual') {
      if (rhs.head === 'GreaterEqual') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'LessEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (isRelationalOperator(head)) {
      if (rhs.head !== lhs.head) return false;
      if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
      return false;
    }

    // Not a relational operator. An algebraic expression?
    // Note: signDiff will attempt to subtract the two expressions to check
    // if the difference is zero.
    const s = signDiff(lhs, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;

    // Try to simplify the difference of the expressions
    const diff = this.engine.add(lhs, rhs.neg()).simplify();
    if (diff.isZero) return true;

    return lhs.isSame(rhs);
  }

  get isNumber(): boolean | undefined {
    return this.domain?.isCompatible('Numbers');
  }
  get isInteger(): boolean | undefined {
    return this.domain?.isCompatible('Integers');
  }
  get isRational(): boolean | undefined {
    return this.domain?.isCompatible('RationalNumbers');
  }
  get isAlgebraic(): boolean | undefined {
    return this.domain?.isCompatible('AlgebraicNumbers');
  }
  get isReal(): boolean | undefined {
    return this.domain?.isCompatible('RealNumbers');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain?.isCompatible('ExtendedRealNumbers');
  }
  get isComplex(): boolean | undefined {
    return this.domain?.isCompatible('ComplexNumbers');
  }
  get isImaginary(): boolean | undefined {
    return this.domain?.isCompatible('ImaginaryNumbers');
  }

  get domain(): BoxedDomain | undefined {
    if (this._result !== undefined) return this._result;
    if (!this.canonical) return undefined;

    const ce = this.engine;

    let result: BoxedDomain | undefined | null = undefined;

    if (typeof this._head !== 'string') {
      result = this._head.domain;
    } else if (this._def) {
      const sig = this._def.signature;
      if (typeof sig.result === 'function') result = sig.result(ce, this._ops);
      else result = sig.result;
    }

    result ??= undefined;

    this._result = result;
    return result;
  }

  // simplify(options?: SimplifyOptions): BoxedExpression {
  //   const result = this.simplifyAll(options);
  //   if (result.length === 1) return result[0];
  //   const ce = this.engine;
  //   result.sort((a, b) => {
  //     if (a === b) return 0;
  //     return ce.costFunction(a) - ce.costFunction(b);
  //   });
  //   return result[0];
  // }

  simplify(options?: SimplifyOptions): BoxedExpression {
    // @fixme: simplify logic, only use rules, including "core" rules (i.e. expand/distribute/factor)
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) {
      const canonical = this.canonical;
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.simplify(options);
    }

    //
    // 2/ Apply expand
    //
    const depth = options?.depth ?? 0;
    const maxDepth = options?.maxDepth ?? Infinity;
    const recursive = depth < maxDepth;

    let expr: BoxedExpression | undefined | null;
    if (recursive) {
      expr = expand(this) ?? this;
      if (expr?.ops) {
        expr = this.engine._fn(
          expr.head,
          expr.ops.map((x) =>
            x.simplify({ ...options, depth: depth + 1, maxDepth })
          )
        );
      }
      expr = expr.simplify({ ...options, depth: depth + 1, maxDepth: 0 });
    }

    //
    // 3/ Factor if a relational operator
    //    2x < 4t -> x < 2t
    if (isRelationalOperator(this.head)) {
      expr = factor(expr ?? this);
      expr = expr ?? this;
      console.assert(isRelationalOperator(expr.head));
      if (expr.nops === 2) {
        // Try f(x) < g(x) -> f(x) - g(x) < 0
        const ce = this.engine;
        const alt = ce._fn(expr.head, [
          ce.add(expr.op1, expr.op2.neg()),
          ce.Zero,
        ]);
        expr = cheapest(expr, alt);
      }
    }

    //
    // 4/ Simplify the applicable operands
    // @todo not clear if this is always the best strategy. Might be better to
    // defer to the handler.
    //
    const def = this.functionDefinition;
    const tail = recursive
      ? holdMap(
          this._ops,
          def?.hold ?? 'none',
          def?.associative ? def.name : '',
          (x) => x.simplify({ ...options, depth: depth + 1, maxDepth })
        )
      : this._ops;

    //
    // 5/ If a function expression, apply the arguments, and simplify the result
    //
    if (typeof this._head !== 'string') {
      expr = apply(this._head, tail);
      if (typeof expr.head !== 'string') return expr;
      return expr.simplify({ ...options, depth, maxDepth });
    }

    //
    // 6/ Apply `simplify` handler
    //

    if (def) {
      if (def.inert) expr = tail[0]?.canonical ?? this;
      else {
        const sig = def.signature;
        if (sig?.simplify) expr = sig.simplify(this.engine, tail);
      }
    }

    if (!expr) expr = this.engine.box([this._head, ...tail]);
    else expr = cheapest(this.engine.box([this._head, ...tail]), expr);

    expr = cheapest(this, expr);

    if (options?.rules === null) return expr;

    //
    // 7/ Apply rules, until no rules can be applied
    //
    const rules =
      options?.rules ?? this.engine.getRuleSet('standard-simplification')!;

    let iterationCount = 0;
    do {
      const newExpr = expr!.replace(rules);
      if (!newExpr) break;
      expr = newExpr.simplify({
        ...options,
        depth: depth + 1,
        maxDepth,
        rules: null,
      });

      iterationCount += 1;
    } while (iterationCount < this.engine.iterationLimit);
    return expr!; // cheapest(this, expr);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (options?.numericMode) {
      const h = this.head;

      //
      // Transform N(Integrate) into NIntegrate(), etc...
      //
      if (h === 'Integrate' || h === 'Limit')
        return this.engine
          .box(['N', this], { canonical: true })
          .evaluate(options);
    }
    if (!this.isCanonical) {
      this.engine.pushScope();
      const canonical = this.canonical;
      this.engine.popScope();
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.evaluate(options);
    }

    const def = this.functionDefinition;

    //
    // 2/ Thread if applicable
    //
    // If the function is threadable, iterate
    //
    if (
      def?.threadable &&
      this.ops!.some((x) => isFiniteIndexableCollection(x))
    ) {
      // If one of the arguments is an indexable collection, thread the function
      // Get the length of the longest sequence
      const length = Math.max(
        ...this._ops.map((x) => x.functionDefinition?.size?.(x) ?? 0)
      );

      // Zip
      const results: BoxedExpression[] = [];
      for (let i = 0; i <= length - 1; i++) {
        const args = this._ops.map((x) =>
          isFiniteIndexableCollection(x)
            ? at(x, (i % length) + 1) ?? this.engine.Nothing
            : x
        );
        results.push(this.engine._fn(this.head, args).evaluate(options));
      }

      if (results.length === 0) return this.engine.box(['Sequence']);
      if (results.length === 1) return results[0];
      return this.engine._fn('List', results);
    }

    //
    // 3/ Evaluate the applicable operands
    //
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.evaluate(options)
    );

    //
    // 4/ Inert? Just return the first argument.
    //
    if (def?.inert) return tail[0] ?? this;

    //
    // 5/ Is it an applied anonymous function?
    //    e.g. [["Add", "_", 1], 2]
    //
    let result: BoxedExpression | undefined | null = undefined;
    if (typeof this._head !== 'string') result = apply(this._head, tail);

    //
    // 6/ Call the `evaluate` or `N` handler
    //
    const sig = def?.signature;
    if (!result && sig) {
      const numericMode = options?.numericMode ?? false;
      const context = this.engine.swapScope(this.scope);
      if (numericMode && sig.N) result = sig.N!(this.engine, tail);
      if (!result && sig.evaluate) result = sig.evaluate!(this.engine, tail);
      this.engine.swapScope(context);
    }

    if (result) {
      const num = result.numericValue;
      if (num !== null) {
        if (!complexAllowed(this.engine) && num instanceof Complex)
          result = this.engine.NaN;
        else if (!bignumPreferred(this.engine) && num instanceof Decimal)
          result = this.engine.number(num.toNumber());
      }
    }
    return result ?? this.engine.box([this._head, ...tail]);
  }

  N(): BoxedExpression {
    return this.evaluate({ numericMode: true });
  }

  solve(
    vars:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression> {
    const varNames = normalizedUnknownsForSolve(vars);
    if (varNames.length !== 1) return null;
    return findUnivariateRoots(this.simplify(), varNames[0]);
  }
}

function makeNumericFunction(
  ce: IComputeEngine,
  head: string,
  semiOps: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression | null {
  let ops: ReadonlyArray<BoxedExpression> = [];
  if (head === 'Add' || head === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), { flatten: head });
  else if (
    head === 'Negate' ||
    head === 'Square' ||
    head === 'Sqrt' ||
    head === 'Exp' ||
    head === 'Ln'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 1);
  else if (head === 'Power')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 2);
  else if (head === 'Divide')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps));
  else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid)) return ce._fn(head, ops, metadata);

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (head === 'Add')
    return canonicalAdd(ce, flattenOps(flattenSequence(ops), 'Add'));
  if (head === 'Negate') return ops[0].neg();
  if (head === 'Multiply')
    return canonicalMultiply(ce, flattenOps(flattenSequence(ops), 'Multiply'));
  if (head === 'Divide')
    return ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]);
  if (head === 'Exp') return canonicalPower(ce.E, ops[0].canonical);
  if (head === 'Power')
    return canonicalPower(ops[0].canonical, ops[1].canonical);
  if (head === 'Square') return canonicalPower(ops[0].canonical, ce.number(2));
  if (head === 'Sqrt') {
    const op = ops[0].canonical;
    // We preserve square roots of rationals as "exact" values
    if (isRational(op.numericValue)) return ce._fn('Sqrt', [op], metadata);

    return canonicalPower(op, ce.Half);
  }
  if (head === 'Ln') return ce._fn('Ln', ops, metadata);

  return null;
}

export function makeCanonicalFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  ops: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression {
  //
  // Is the head an expression? For example, `['InverseFunction', 'Sin']`
  //
  if (typeof head !== 'string') {
    // We need a new scope to capture any locals that might get bound
    // while evaluating the head.
    ce.pushScope();
    head = head.evaluate().symbol ?? head;
    ce.popScope();
  }

  if (typeof head === 'string') {
    const result = makeNumericFunction(ce, head, ops, metadata);
    if (result) return result;
  } else {
    if (!head.isValid)
      return new BoxedFunction(
        ce,
        head,
        ops.map((x) => ce.box(x, { canonical: false })),
        { metadata, canonical: false }
      );
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupFunction(head);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    // @todo: should we create a def for it?
    return new BoxedFunction(
      ce,
      head,
      flattenSequence(ops.map((x) => ce.box(x))),
      { metadata, canonical: true }
    );
  }

  const xs: BoxedExpression[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (!shouldHold(def.hold, ops.length - 1, i)) {
      xs.push(ce.box(ops[i]));
    } else {
      const y = ce.box(ops[i], { canonical: false });
      if (y.head === 'ReleaseHold') xs.push(y.op1.canonical);
      else xs.push(y);
    }
  }

  const sig = def.signature;

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for validating
  // arguments, sorting them, applying involution and idempotent to
  // the expression, flatenning sequences and validating the signature
  // (domain and number of arguments)
  //
  // The arguments have been put in canonical form, as per hold rules.
  //
  if (sig.canonical) {
    try {
      const result = sig.canonical(ce, xs);
      if (result) return result;
    } catch (e) {
      console.error(e);
    }
    // The canonical handler gave up, return a non-canonical expression
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), d) -> f(a, b, c, d)
  //
  let args = flattenSequence(xs);
  if (def.associative) args = flattenOps(args, head as string);

  const adjustedArgs = adjustArguments(
    ce,
    args,
    def.hold,
    def.threadable,
    sig.params,
    sig.optParams,
    sig.restParam
  );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) return ce._fn(head, adjustedArgs, metadata);

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].head === head) {
    // f(f(x)) -> x
    if (def.involution) return args[0].op1;

    // f(f(x)) -> f(x)
    if (def.idempotent) args = xs[0].ops!;
  }

  //
  // 5/ Sort the arguments
  //
  if (args.length > 1 && def.commutative === true) args = [...args].sort(order);

  return ce._fn(head, args, metadata);
}

/** Apply the function `f` to elements of `xs`, except to the elements
 * described by `skip`:
 * - `all`: don't apply f to any elements
 * - `none`: apply `f` to all elements
 * - `first`: apply `f` to all elements except the first
 * - `rest`: apply `f` to the first element, skip the  others
 * - 'last': apply `f` to all elements except the last
 * - 'most': apply `f` to the last elements, skip the others
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  xs: ReadonlyArray<BoxedExpression>,
  skip: Hold,
  associativeHead: string,
  f: (x: BoxedExpression) => BoxedExpression | null
): ReadonlyArray<BoxedExpression> {
  if (xs.length === 0) return [];

  // f(a, f(b, c), d) -> f(a, b, c, d)
  xs = flattenOps(xs, associativeHead);

  //
  // Apply the hold as necessary
  //
  // @fastpath
  if (skip === 'all') return xs;
  if (skip === 'none') {
    const result: BoxedExpression[] = [];
    for (const x of xs) {
      const h = x.head;
      if (h === 'Hold') result.push(x);
      else {
        const op = h === 'ReleaseHold' ? x.op1 : x;
        if (op) {
          const y = f(op);
          if (y !== null) result.push(y);
        }
      }
    }
    return flattenOps(result, associativeHead);
  }

  const result: BoxedExpression[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].head === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].head === 'ReleaseHold') y = xs[i].op1;
      else if (!shouldHold(skip, xs.length - 1, i)) y = xs[i];
      else result.push(xs[i]);

      if (y) {
        const x = f(y);
        if (x !== null) result.push(x);
      }
    }
  }
  return flattenOps(result, associativeHead);
}

// @todo: allow selection of one signature amongst multiple
// function matchSignature(
//   ce: IComputeEngine,
//   def: BoxedFunctionDefinition,
//   tail: BoxedExpression[],
//   codomain?: BoxedExpression
// ): BoxedFunctionSignature | undefined {
//   return def.signature;
// }

/**
 * Considering an old (existing) expression and a new (simplified) one,
 * return the cheapest of the two, with a bias towards the new (which can
 * actually be a bit more expensive than the old one, and still be picked).
 */
function cheapest(
  oldExpr: BoxedExpression,
  newExpr: SemiBoxedExpression | null | undefined
): BoxedExpression {
  if (newExpr === null || newExpr === undefined) return oldExpr;
  if (oldExpr === newExpr) return oldExpr;

  const ce = oldExpr.engine;
  const boxedNewExpr = ce.box(newExpr);

  if (oldExpr.isSame(boxedNewExpr)) return oldExpr;

  if (ce.costFunction(boxedNewExpr) <= 1.2 * ce.costFunction(oldExpr)) {
    // console.log(
    //   'Picked new' + boxedNewExpr.toString() + ' over ' + oldExpr.toString()
    // );
    return boxedNewExpr;
  }

  // console.log(
  //   'Picked old ' + oldExpr.toString() + ' over ' + newExpr.toString()
  // );
  return oldExpr;
}
