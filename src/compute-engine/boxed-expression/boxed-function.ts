import Complex from 'complex.js';
import Decimal from 'decimal.js';

import { AbstractBoxedExpression } from './abstract-boxed-expression';

import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  BoxedFunctionDefinition,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  BoxedRuleSet,
  SemiBoxedExpression,
  SimplifyOptions,
  Substitution,
  ReplaceOptions,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  BoxedLambdaExpression,
  RuntimeScope,
  BoxedSubstitution,
} from '../public';
import { findUnivariateRoots } from '../solve';
import { asFloat } from '../numerics/numeric';
import { signDiff } from '../numerics/rationals';
import { boxRules, replace } from '../rules';
import { SIMPLIFY_RULES } from '../simplify-rules';
import { DEFAULT_COMPLEXITY, order } from './order';
import {
  serializeJsonCanonicalFunction,
  serializeJsonFunction,
} from './serialize';
import { complexAllowed, hashCode, bignumPreferred } from './utils';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { validateNumericArgs, validateSignature } from './validate';

/**
 * Considering an old (existing) expression and a new (simplified) one,
 * return the cheapest of the two, with a bias towards the new (which can
 * actually be a bit mor expensive than the old one, and still be picked).
 */
function cheapest(
  oldExpr: BoxedExpression,
  newExpr: SemiBoxedExpression | null | undefined
): BoxedExpression {
  if (newExpr === null || newExpr === undefined) return oldExpr;
  if (oldExpr === newExpr) return oldExpr;

  const ce = oldExpr.engine;
  const boxedNewExpr = ce.box(newExpr);
  if (ce.costFunction(boxedNewExpr) <= 1.7 * ce.costFunction(oldExpr)) {
    return boxedNewExpr;
  }
  console.log(
    'Cheapest: Rejected ',
    boxedNewExpr.toString(),
    'in favor of ',
    oldExpr.toString()
  ); // @debug
  return oldExpr;
}

/**
 * BoxedFunction
 */

export class BoxedFunction extends AbstractBoxedExpression {
  private _scope: RuntimeScope | null;
  private readonly _head: string | BoxedLambdaExpression;
  private readonly _ops: BoxedExpression[];

  // The canonical representation of this expression
  private _canonical: BoxedExpression | undefined;

  // Note: only canonical expressions have an associated def
  // A `null` def indicate it has not been fetched yet, `undefined` indicate
  // it was not found.
  private _def: BoxedFunctionDefinition | null | undefined;

  private _isPure: boolean;

  /** The domain of the value of the function applied to its arguments */
  private _codomain: BoxedDomain | null;

  /** The cached values of applying the tail to the head.
   * If the function is not pure, it is never cached.
   */
  private _value: BoxedExpression | undefined;
  private _numericValue: BoxedExpression | undefined;

  private _hash: number | undefined;

  constructor(
    ce: IComputeEngine,
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      def?: BoxedFunctionDefinition;
    }
  ) {
    options ??= {};
    options.canonical ??= false;

    super(ce, options.metadata);

    this._scope = ce.context;

    this._head = head;
    this._ops = ops;

    this._def = options.def ?? null; // Mark the def as not yet cached if none is provided

    if (options.canonical) {
      if (!this._def) this._def = ce.lookupFunction(head, ce.context);
      this._canonical = this;
    }

    this._codomain = null;
    if (!options.canonical) {
      this._codomain = ce.domain('Anything');
    } else {
      if (typeof this._head !== 'string')
        this._codomain = this._head.domain.codomain;
      else if (this._def) {
        const sig = this._def.signature;
        if (typeof sig.codomain === 'function') {
          this._codomain = sig.codomain(ce, this._ops) ?? null;
        } else {
          this._codomain = sig.codomain ?? null;
        }
      }
      if (!this._codomain)
        this._codomain = ce.defaultDomain ?? ce.domain('Void');
    }
    // Note: _isPure is computed on demand and cached

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

  get isCanonical(): boolean {
    return this._canonical === this;
  }

  set isCanonical(val: boolean) {
    this._canonical = val ? this : undefined;
  }

  get isLiteral(): boolean {
    return false;
  }

  get isPure(): boolean {
    if (!this.isCanonical) return false;
    if (this._isPure !== undefined) return this._isPure;
    let result: boolean | undefined = undefined;
    if (this.functionDefinition?.pure !== undefined)
      result = this.functionDefinition!.pure;
    // The function might be pure. Let's check that all its arguments are pure.
    if (result !== false) result = this._ops.every((x) => x.isPure);

    this._isPure = result;
    return result;
  }

  get json(): Expression {
    // If this expression is canonical, apply some transformations to the
    // JSON serialization to "reverse" some of the effects of canonicalization.
    if (this.isValid && this._canonical === this)
      return serializeJsonCanonicalFunction(
        this.engine,
        this._head,
        this._ops,
        { latex: this._latex, wikidata: this._wikidata }
      );
    return serializeJsonFunction(this.engine, this._head, this._ops, {
      latex: this._latex,
      wikidata: this._wikidata,
    });
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get head(): string | BoxedExpression {
    return this._head;
  }

  get ops(): BoxedExpression[] {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): BoxedExpression {
    return this._ops[0] ?? this.engine.symbol('Nothing');
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.symbol('Nothing');
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.symbol('Nothing');
  }

  get isValid(): boolean {
    if (typeof this._head !== 'string') {
      if (this._head.isValid === false) return false;
      return this._ops.every((x) => x.isValid);
    }
    if (this._head === 'Error') return false;

    // If this expression is not canonical, just check the arguments
    if (this._canonical !== this) return this._ops.every((x) => x.isValid);

    // Need to check function definition before arguments: binding
    // as the side effect of normalizing arguments
    if (this.functionDefinition === undefined) return false;
    return this._ops.every((x) => x.isValid);
  }

  get canonical(): BoxedExpression {
    if (this._canonical) return this._canonical;

    this._canonical = this.isValid
      ? makeCanonicalFunction(this.engine, this._head, this._ops)
      : this;

    return this._canonical;
  }

  *map<T = BoxedExpression>(
    fn: (x: BoxedExpression) => T
  ): IterableIterator<T> {
    let i = 0;
    while (i < this._ops.length) yield fn(this._ops[i++]);
  }

  apply(
    fn: (x: BoxedExpression) => SemiBoxedExpression,
    head?: string
  ): BoxedExpression {
    const newHead = head ?? this.head;
    let opsChanged = false;
    const ops: BoxedExpression[] = [];
    for (const arg of this._ops) {
      const newArg = fn(arg);
      if (arg !== newArg) opsChanged = true;
      ops.push(this.engine.box(newArg));
    }

    if (!opsChanged && this.head === newHead) return this;

    return this.engine.fn(newHead, ops);
  }

  subs(sub: Substitution, options?: { canonical?: boolean }): BoxedExpression {
    options ??= {};
    if (!('canonical' in options)) options.canonical = true;

    const ops = this._ops.map((x) => x.subs(sub, options));

    if (options.canonical && ops.every((x) => x.isValid))
      return makeCanonicalFunction(this.engine, this._head, ops);

    return new BoxedFunction(this.engine, this._head, ops, {
      canonical: false,
    });
  }

  replace(
    rules: BoxedRuleSet,
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
      else if (!rhs.head || !this.head.isSame(rhs.head)) return false;
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    for (let i = 0; i < lhsTail.length; i++)
      if (!lhsTail[i].isSame(rhsTail[i])) return false;

    return true;
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!(rhs instanceof BoxedFunction)) return null;

    let result: BoxedSubstitution = {};

    // Head must match
    if (typeof this.head === 'string') {
      if (this.head !== rhs.head) return null;
    } else {
      if (typeof rhs.head === 'string') return null;
      else {
        if (!rhs.head) return null;
        const m = this.head.match(rhs.head, options);
        if (m === null) return null;
        result = { ...result, ...m };
      }
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    for (let i = 0; i < lhsTail.length; i++) {
      const m = lhsTail[i].match(rhsTail[i], options);
      if (m === null) return null;
      result = { ...result, ...m };
    }
    return result;
  }

  //
  // CANONICAL OPERATIONS
  //
  // These operations apply only to canonical expressions
  //

  unbind(): void {
    // Note: a non-canonical expression is never bound
    this._value = undefined;
    this._numericValue = undefined;
    // this._def = null;
  }

  get wikidata(): string | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    return this._wikidata ?? this.functionDefinition?.wikidata ?? undefined;
  }

  get description(): string[] | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    const def = this.functionDefinition;
    if (!def) return [];
    if (!def.description) return undefined;
    if (typeof def.description === 'string') return [def.description];
    return def.description;
  }

  get url(): string | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return '';
    return this.functionDefinition?.url ?? undefined;
  }

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    return this.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    if (!this.isCanonical) return undefined;
    if (this._def !== null) return this._def;
    return undefined;
  }

  bind(_scope: RuntimeScope | null): void {
    debugger;
  }

  get value(): BoxedExpression | undefined {
    if (!this.isCanonical) return undefined;
    if (!this.isPure) return undefined;
    // Use cached value if the function is pure
    if (!this._value) this._value = this.evaluate();
    return this._value;
  }

  /** `isEqual` is mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    const s = signDiff(this, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;
    return this.isSame(rhs);
  }

  isLess(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s < 0;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s <= 0;
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s > 0;
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    const s = signDiff(this, rhs);
    if (s === undefined) return undefined;
    return s >= 0;
  }

  get isZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s === 0;
    return undefined;
    // @todo: use this.functionDefinition.range
  }

  get isNotZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s !== 0;
    return undefined;
    // @todo: use this.functionDefinition.range
  }

  get isOne(): boolean | undefined {
    return this.isEqual(this.engine._ONE);
  }

  get isNegativeOne(): boolean | undefined {
    return this.isEqual(this.engine._NEGATIVE_ONE);
  }

  // x > 0
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s > 0;
    return undefined;
  }
  // x <= 0
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s <= 0;
    return undefined;
  }
  // x < 0
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s < 0;
    return undefined;
  }
  // x >= 0
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s >= 0;
    return undefined;
  }

  get isNumber(): boolean | undefined {
    return this.domain.isCompatible('Number');
  }
  get isInteger(): boolean | undefined {
    return this.domain.isCompatible('Integer');
  }
  get isRational(): boolean | undefined {
    return this.domain.isCompatible('RationalNumber');
  }
  get isAlgebraic(): boolean | undefined {
    return this.domain.isCompatible('AlgebraicNumber');
  }
  get isReal(): boolean | undefined {
    return this.domain.isCompatible('RealNumber');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain.isCompatible('ExtendedRealNumber');
  }
  get isComplex(): boolean | undefined {
    return this.domain.isCompatible('ComplexNumber');
  }
  get isImaginary(): boolean | undefined {
    return this.domain.isCompatible('ImaginaryNumber');
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    if (!this.isCanonical) return undefined;
    // @todo: if there is a this.functionDefinition.range, use it
    // @todo if inconclusive, and there is a this.def._sgn, call it

    // @todo: add sgn() function to FunctionDefinition
    const head = this.head;
    if (head === 'Negate') {
      const s = this._ops[0]?.sgn;
      if (s === undefined) return undefined;
      if (s === null) return null;
      return s === 0 ? 0 : s > 0 ? -1 : +1;
    }
    if (head === 'Multiply') {
      const total = this._ops.reduce((acc, x) => acc * (x.sgn ?? NaN), 1);
      if (isNaN(total)) return null;
      if (total > 0) return 1;
      if (total < 0) return -1;
      return 0;
    }
    if (head === 'Add') {
      let posCount = 0;
      let negCount = 0;
      let zeroCount = 0;
      const count = this._ops.length;
      for (const op of this._ops) {
        const s = op.sgn;
        if (s === null || s === undefined) break;
        if (s === 0) zeroCount += 1;
        if (s > 0) posCount += 1;
        if (s < 0) negCount += 1;
      }
      if (zeroCount === count) return 0;
      if (posCount === count) return 1;
      if (negCount === count) return -1;
      return null;
    }
    if (head === 'Divide') {
      const n = this._ops[0]?.sgn;
      const d = this._ops[1]?.sgn;
      if (n === null || d === null || n === undefined || d === undefined)
        return null;
      if (n === 0) return 0;
      if ((n > 0 && d > 0) || (n < 0 && d < 0)) return +1;
      return -1;
    }
    if (head === 'Square') {
      if (this._ops[0]?.isImaginary) return -1;
      if (this._ops[0]?.isZero) return 0;
      return +1;
    }
    if (head === 'Abs') {
      if (this._ops[0]?.isZero) return 0;
      return +1;
    }
    if (head === 'Sqrt') {
      if (this._ops[0]?.isZero) return 0;
      if (this._ops[0]?.isImaginary) return null;
      return +1;
    }
    // @todo: more functions...
    if (head === 'Power') {
    }
    if (head === 'Root') {
    }
    if (head === 'Ln') {
    }
    if (head === 'Floor') {
    }
    if (head === 'Ceil') {
    }
    if (head === 'Round') {
    }
    // @todo: trig functions, geometric functions

    const v = asFloat(this.N());
    if (v === null) return undefined;
    if (v === 0) return 0;
    if (v < 0) return -1;
    return +1;
  }

  //
  // AUTO-CANONICAL OPERATIONS
  //
  // The operations are automatically done on the canonical form of the
  // expression
  //

  get domain(): BoxedDomain {
    return this._codomain!;
  }

  simplify(options?: SimplifyOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) return this.canonical.simplify(options);

    //
    // 2/ Simplify the applicable operands
    //
    const def = this.functionDefinition;
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.simplify(options)
    );

    //
    // 3/ If a lambda, apply the arguments, and simplify the result
    //
    if (typeof this._head !== 'string')
      return lambda(this.engine, this._head, tail).simplify(options);

    //
    // 4/ Apply `simplify` handler
    //
    let expr: BoxedExpression | undefined;

    if (def) {
      if (def.inert) expr = tail[0]?.canonical ?? this;
      else {
        const sig = def.signature;
        if (sig?.simplify) expr = sig.simplify(this.engine, tail);
      }
    }

    if (!expr) expr = this.engine.fn(this._head, tail);

    //
    // 5/ Apply rules, until no rules can be applied
    //
    const rules =
      options?.rules ??
      this.engine.cache<BoxedRuleSet>(
        'standard-simplification-rules',
        () => boxRules(this.engine, SIMPLIFY_RULES),
        (rules) => {
          for (const [lhs, rhs, _priority, _condition] of rules) {
            lhs.unbind();
            rhs.unbind();
          }
          return rules;
        }
      );

    let iterationCount = 0;
    let done = false;
    do {
      const newExpr = expr.replace(rules);
      if (newExpr !== null) {
        expr = cheapest(newExpr, expr);
        if (expr === newExpr) done = true;
      } else done = true; // no rules applied

      iterationCount += 1;
      // @debug-begin
      // if (iterationCount > 100) {
      //   console.log('Iterating... ', newExpr?.toJSON() ?? '()', expr.toJSON());
      // }
      // @debug-end
    } while (!done && iterationCount < this.engine.iterationLimit);

    // @debug-begin
    // if (iterationCount >= this.engine.iterationLimit) {
    //   console.error('Iteration Limit reached simplifying', this.toJSON());
    // }
    // @debug-end

    return expr;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) return this.canonical.evaluate(options);

    //
    // 2/ Evaluate the applicable operands
    //
    const def = this.functionDefinition;
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.evaluate(options)
    );

    //
    // 3/ Is it a Lambda?
    //
    if (typeof this._head !== 'string')
      return lambda(this.engine, this._head, tail).evaluate(options);

    //
    // 4/ No def? Inert? We're done.
    //
    if (!def) return this.engine.fn(this._head, tail);

    if (def.inert) return tail[0] ?? this;

    //
    // 5/ Use the signature associated with his definition
    //
    const sig = def.signature;

    //
    // 6/ Call the `evaluate` handler
    //

    // 5.1/ No evaluate handler, we're done
    if (!sig || !sig.evaluate) return this.engine.fn(this._head, tail);

    // 5.2/ A lambda-function handler
    if (typeof sig.evaluate !== 'function')
      return lambda(this.engine, sig.evaluate, tail).evaluate(options);

    // 5.3/ A regular function handler
    return sig.evaluate(this.engine, tail) ?? this.engine.fn(this._head, tail);
  }

  N(options?: NOptions): BoxedExpression {
    //
    // 1/ Use canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) return this.canonical.N(options);
    if (this._numericValue) return this._numericValue;

    //
    // 2/ Evaluate the applicable operands
    //
    const def = this.functionDefinition;
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.N(options)
    );

    //
    // 3/ Is it a Lambda?
    //
    if (typeof this._head !== 'string')
      return lambda(this.engine, this._head, tail).N(options);

    //
    // 4/ No def? Inert? We're done.
    //
    if (!def) return this.engine.fn(this._head, tail);

    if (def.inert) return tail[0] ?? this;

    //
    // 5/ Call `N` handler or fallback to `evaluate`
    //
    const sig = def.signature;

    let result =
      sig?.N?.(this.engine, tail) ??
      this.engine.fn(this._head, tail).evaluate();

    const num = result.numericValue;
    if (num !== null) {
      if (!complexAllowed(this.engine) && num instanceof Complex)
        result = this.engine._NAN;
      else if (!bignumPreferred(this.engine) && num instanceof Decimal)
        result = this.engine.number(num.toNumber());
    }

    if (this.isPure) this._numericValue = result;

    return result;
  }

  solve(vars: string[]): null | BoxedExpression[] {
    if (vars.length !== 1) return null;
    const roots = findUnivariateRoots(this.simplify(), vars[0]);
    return roots;
  }
}

function makeNumericFunction(
  ce: IComputeEngine,
  head: string,
  semiOps: SemiBoxedExpression[],
  metadata?: Metadata
): BoxedExpression | null {
  let ops: BoxedExpression[] = [];
  if (head === 'Add' || head === 'Multiply')
    ops = validateNumericArgs(ce, semiOps);
  else if (head === 'Negate' || head === 'Square' || head === 'Sqrt')
    ops = validateNumericArgs(ce, semiOps, 1);
  else if (head === 'Divide' || head === 'Power')
    ops = validateNumericArgs(ce, semiOps, 2);
  else return null;

  // If some of the arguments are not valid, make a non-canonical expression
  if (!ops.every((x) => x.isValid))
    return new BoxedFunction(ce, head, ops, { metadata, canonical: false });

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (head === 'Add') return ce.add(ops, metadata);
  if (head === 'Negate')
    return ce.negate(ops[0] ?? ce.error('missing'), metadata);
  if (head === 'Multiply') return ce.mul(ops, metadata);
  if (head === 'Divide') return ce.divide(ops[0], ops[1], metadata);
  if (head === 'Power') return ce.power(ops[0], ops[1], metadata);
  if (head === 'Square') return ce.power(ops[0], ce.number(2), metadata);
  if (head === 'Sqrt') {
    const op = ops[0].canonical;
    if (op.isLiteral && op.isRational)
      return new BoxedFunction(ce, 'Sqrt', [op], { metadata, canonical: true });

    return ce.power(op, ce.number([1, 2]), metadata);
  }

  if (head === 'Pair') return ce.pair(ops[0], ops[1], metadata);
  if (head === 'Tuple') return ce.tuple(ops, metadata);

  return null;
}

export function makeCanonicalFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  ops: SemiBoxedExpression[],
  metadata?: Metadata
): BoxedExpression {
  //
  // Is the head an expression? For example, `['InverseFunction', 'Sin']`
  //
  if (typeof head !== 'string') head = head.evaluate().symbol ?? head;

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
  const def = ce.lookupFunction(head, ce.context);
  if (typeof head !== 'string' || !def) {
    return new BoxedFunction(
      ce,
      head,
      flattenSequence(ops.map((x) => ce.box(x))),
      { metadata, canonical: true }
    );
  }

  let xs: BoxedExpression[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (applicable(def.hold, ops.length - 1, i)) {
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
  // the expression.
  //
  if (sig.canonical) {
    const result = sig.canonical(ce, xs);
    if (result) return result;
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), d) -> f(a, b, c, d)
  //
  xs = flattenSequence(xs);
  if (def.associative) xs = flattenOps(xs, head) ?? xs;

  // If some of the arguments are not valid, can't make a canonical expression
  if (!xs.every((x) => x.isValid))
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });

  xs = validateSignature(sig.domain, xs) ?? xs;

  if (!xs.every((x) => x.isValid))
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (ops.length === 1 && xs[0].head === head) {
    // f(f(x)) -> x
    if (def.involution) return xs[0].op1;

    // f(f(x)) -> f(x)
    if (def.idempotent) xs = xs[0].ops!;
  }

  //
  // 5/ Sort the arguments
  //
  if (xs.length > 1 && def.commutative === true) xs = xs.sort(order);

  return new BoxedFunction(ce, head, xs, { metadata, def, canonical: true });
}

export function lambda(
  ce: IComputeEngine,
  fn: BoxedLambdaExpression,
  args: BoxedExpression[]
): BoxedExpression {
  // 'fn' is a lambda expression.

  const subs: BoxedSubstitution = {
    '__': fn.engine.tuple(args),
    '_#': fn.engine.number(args.length),
  };
  let n = 1;
  for (const op of args) subs[`_${n++}`] = op;
  subs['_'] = subs['_1'];

  // Substitute the arguments in the lambda expression
  return fn.subs(subs);
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
  xs: BoxedExpression[],
  skip: 'all' | 'none' | 'first' | 'rest' | 'last' | 'most',
  associativeHead: string,
  f: (x: BoxedExpression) => BoxedExpression | null
): BoxedExpression[] {
  if (xs.length === 0) return [];

  // f(a, f(b, c), d) -> f(a, b, c, d)
  if (associativeHead) xs = flattenOps(xs, associativeHead) ?? xs;

  const result: BoxedExpression[] = [];

  //
  // Apply the hold as necessary
  //
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].head === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].head === 'ReleaseHold') y = xs[i].op1;
      else if (applicable(skip, xs.length - 1, i)) y = xs[i];
      else result.push(xs[i]);

      if (y) {
        const x = f(y);
        if (x !== null) result.push(x);
      }
    }
  }
  if (associativeHead) return flattenOps(result, associativeHead) ?? result;

  return result;
}

function applicable(
  skip: 'all' | 'none' | 'first' | 'rest' | 'last' | 'most',
  count: number,
  index: number
): boolean {
  if (skip === 'all') return false;

  if (skip === 'none') return true;

  if (skip === 'first') return index !== 0;

  if (skip === 'rest') return index === 0;

  if (skip === 'last') return index !== count;

  if (skip === 'most') return index === count;

  return false;
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
