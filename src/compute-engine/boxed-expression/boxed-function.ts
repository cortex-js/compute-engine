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
  PatternMatchOption,
} from '../public';
import { boxRules, replace } from '../rules';
import { SIMPLIFY_RULES } from '../simplify-rules';
import { DEFAULT_COMPLEXITY, order } from './order';
import {
  serializeJsonCanonicalFunction,
  serializeJsonFunction,
} from './serialize';
import { complexAllowed, hashCode, useDecimal } from './utils';
import { flattenOps } from '../symbolic/flatten';

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
  private _head: string | BoxedExpression;
  private _ops: BoxedExpression[];
  private _def: BoxedFunctionDefinition | undefined;
  private _isCanonical: boolean;

  private _isPure: boolean;

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
    metadata?: Metadata
  ) {
    super(ce, metadata);

    this._head = typeof head === 'string' ? head : head.symbol ?? head;
    this._ops = ops;

    if (typeof this._head === 'string') {
      const def = ce.getFunctionDefinition(this._head, metadata?.wikidata);
      if (def === null)
        throw new Error(`Function \`${this._head}\` is not defined`);

      this._def = def;
    }

    this._isCanonical = false;

    // Note: _isPure is computed on demand and cached

    ce._register(this);
  }

  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    if (typeof this._head === 'string') h = (h ^ hashCode(this._head)) | 0;
    else h = (h ^ this._head.hash) | 0;
    this._hash = h;
    return h;
  }

  _purge(): undefined {
    if (typeof this._head !== 'string') this._head._purge();
    for (const arg of this._ops) arg._purge();
    if (this._value) this._value._purge();
    if (this._numericValue) this._numericValue._purge();
    return undefined;
  }

  get wikidata(): string {
    return this._wikidata ?? this._def?.wikidata ?? '';
  }

  get description(): string[] {
    if (!this._def) return [];
    if (!this._def.description) return [];
    if (typeof this._def.description === 'string')
      return [this._def.description];
    return this._def.description;
  }

  get url(): string {
    return this._def?.url ?? '';
  }

  get complexity(): number {
    return this._def?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get head(): string | BoxedExpression {
    return this._head;
  }

  get value(): BoxedExpression | undefined {
    if (!this.isPure) return undefined;
    // Use cached value if the function is pure
    if (this._value) return this._value;
    this._value = this.evaluate();
    return this._value;
  }

  get numericValue(): BoxedExpression | undefined {
    if (!this.isPure) return undefined;
    if (this._numericValue) return this._numericValue;
    const val = this.N();
    this._numericValue = val.isLiteral ? val : undefined;
    return this._numericValue;
  }

  get isPure(): boolean {
    if (this._isPure !== undefined) return this._isPure;
    let result: boolean | undefined = undefined;
    if (this._def?.pure !== undefined) result = this._def!.pure;
    if (result !== false) {
      // The function might be pure. Let's check that all its arguments are pure.
      result = this._ops.every((x) => x.isPure);
    }
    this._isPure = result;
    return result;
  }

  get isLiteral(): boolean {
    return false;
  }

  get ops(): BoxedExpression[] {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): BoxedExpression {
    return this._ops[0] ?? this.engine.symbol('Missing');
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.symbol('Missing');
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.symbol('Missing');
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this._def;
  }

  _repairDefinition(): void {
    if (typeof this._head === 'string') {
      // Function names that start with `_` are wildcards and never have a definition
      if (this._head[0] === '_') return;

      this._def = this.engine.getFunctionDefinition(this._head, this._wikidata);
      if (this._def) {
        // In case the def was found by the wikidata, and the name does not
        // match the one in our dictionary, make sure to update it.
        this._head = this._def.name;
      }
    }
  }

  /** Domain of the value of the function */
  get domain(): BoxedExpression {
    const def = this._def;
    if (!def) return this.engine.domain('Anything');

    if (typeof def.evalDomain === 'function') {
      const result = def.evalDomain(this.engine, this._ops);
      if (typeof result === 'string') return this.engine.domain(result);
      return result ?? this.engine.domain('Nothing');
    }

    console.assert(def.evalDomain === undefined);

    return (
      def.domain ??
      (def.numeric
        ? this.engine.domain('Number')
        : this.engine.domain('Nothing'))
    );
  }

  isLess(rhs: BoxedExpression): boolean | undefined {
    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s < 0;
    }
    // @todo: use this._def.range
    return undefined;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s <= 0;
    }
    return undefined;
    // @todo: use this._def.range
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s > 0;
    }

    return undefined;
    // @todo: use this._def.range
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s >= 0;
    }
    return undefined;
    // @todo: use this._def.range
  }

  get isZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s === 0;
    return undefined;
    // @todo: use this._def.range
  }

  get isNotZero(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s !== 0;
    return undefined;
    // @todo: use this._def.range
  }

  get isOne(): boolean | undefined {
    return undefined;
    // @todo: use this._def.range
  }

  get isNegativeOne(): boolean | undefined {
    return undefined;
    // @todo: use this._def.range
  }
  // x > 0
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s !== 0;
    return undefined;
    // @todo: use this._def.range
  }
  // x <= 0
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s <= 0;
    return undefined;
    // @todo: use this._def.range
  }
  // x < 0
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s < 0;
    return undefined;
    // @todo: use this._def.range
  }
  // x >= 0
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === null) return false;
    if (typeof s === 'number') return s >= 0;
    return undefined;
    // @todo: use this._def.range
  }

  get isNumber(): boolean | undefined {
    return this.domain.isSubsetOf('Number');
  }
  get isInteger(): boolean | undefined {
    return this.domain.isSubsetOf('Integer');
  }
  get isRational(): boolean | undefined {
    return this.domain.isSubsetOf('RationalNumber');
  }
  get isAlgebraic(): boolean | undefined {
    return this.domain.isSubsetOf('AlgebraicNumber');
  }
  get isReal(): boolean | undefined {
    return this.domain.isSubsetOf('RealNumber');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain.isSubsetOf('ExtendedRealNumber');
  }
  get isComplex(): boolean | undefined {
    return this.domain.isSubsetOf('ComplexNumber');
  }
  get isImaginary(): boolean | undefined {
    return this.domain.isSubsetOf('ImaginaryNumber');
  }

  get json(): Expression {
    if (this._isCanonical)
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
    options?: PatternMatchOption
  ): Substitution | null {
    if (!(rhs instanceof BoxedFunction)) return null;

    let result: Substitution = {};

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

  /** `isEqual` is mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (!this.isCanonical) return this.canonical.isEqual(rhs);
    rhs = rhs.canonical;
    if (rhs.isNumber && this.isNumber) {
      const ce = this.engine;

      // In general, it is impossible to always prove equality
      // (Richardson's theorem) but this works often...
      const diff = ce.add([this, ce.negate(rhs)]).N();

      if (diff.isZero) return true;

      if (diff.asFloat !== null && ce.chop(diff.asFloat) === 0) return true;

      return this.evaluate().isSame(rhs.evaluate());
    }

    if (
      this._def?.relationalOperator &&
      rhs.functionDefinition?.relationalOperator
    ) {
      return this.evaluate().isSame(rhs.evaluate());
    }

    return this.isSame(rhs);
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    // @todo: if there is a this._def.range, use it
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

    return null;
  }

  *map<T = BoxedExpression>(
    fn: (x: BoxedExpression) => T
  ): IterableIterator<T> {
    let i = 0;
    while (i < this._ops.length) yield fn(this._ops[i++]);
  }

  get isCanonical(): boolean {
    return this._isCanonical;
  }

  set isCanonical(val: boolean) {
    this._isCanonical = val;
  }

  get canonical(): BoxedExpression {
    if (this.isCanonical) return this;

    //
    // 1/ Get the canonical form of the arguments
    //
    let tail = this._def?.associative
      ? flattenOps(this._ops!, this.head as string) ?? this._ops!
      : this._ops!;
    tail = holdMap(tail, this._def?.hold ?? 'none', (arg) => {
      if (arg.symbol === 'Nothing') return null; // remove argument from list
      return arg.canonical;
    });

    if (this._def?.associative)
      tail = flattenOps(tail, this.head as string) ?? tail;

    //
    // 2/ Apply `canonical` handler
    //
    if (this._def?.canonical) {
      const result = this._def.canonical(this.engine, tail);
      // The `canonical` handler must ensure that all (non-held) arguments
      // of the returned expression are canonical
      // @debug-begin
      // if (result.ops) {
      //   holdMap(result.ops, result.functionDefinition?.hold ?? 'none', (x) => {
      //     if (!x.isCanonical) {
      //       console.error(
      //         `Canonical handler for "${
      //           result.functionDefinition!.name
      //         }" returned non-canonical argument ${x.toJSON()}`
      //       );
      //     }
      //     return x;
      //   });
      // }
      // @debug-end
      return result;
    }
    //
    // 3/ No canonical handler, use def attributes
    //

    // 3.1 / If no definition (i.e. function `g`...), we're done

    if (!this._def) return this.engine._fn(this._head, tail);

    //
    // 3.2/ Apply `idempotent` and `involution`
    //
    if (tail.length === 1 && tail[0].head === this._head) {
      // f(f(x)) -> f(x)
      if (this._def.idempotent) tail = tail[0].ops!;
      // f(f(x)) -> x
      else if (this._def.involution) return tail[0].op1;
    }

    //
    // 3.3/ Apply associativity
    //
    if (tail.length > 1 && this._def.associative) {
      // If there is a definition, the head must be a string, not a lambda
      console.assert(typeof this._head === 'string');
      // f(a, f(b, c), d) -> f(a, b, c, d)
      tail = flattenOps(tail, this._head as string) ?? tail;
    }

    //
    // 5/ Sort the arguments
    //
    if (tail.length > 1 && this._def.commutative === true)
      tail = tail.sort(order);

    return this.engine._fn(this._head, tail);
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

  simplify(options?: SimplifyOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isCanonical) return this.canonical.simplify(options);

    //
    // 2/  Hold  functions are not evaluated (or simplified)
    //
    if (this.head === 'Hold') return this;
    if (this.head === 'ReleaseHold') {
      const op1 = this.op1;
      if (op1.head !== 'Hold') return op1.simplify(options);
      return op1.op1.isMissing
        ? this.engine.symbol('Nothing')
        : op1.op1.simplify(options);
    }

    //
    // 3/ Does it have a definition?
    //    If not, we don't know how to simplify it
    //
    if (!this._def) return this;

    //
    // 4/ Simplify all the arguments (unless a Hold applies)
    //
    let tail = this._def?.associative
      ? flattenOps(this._ops!, this.head as string) ?? this._ops!
      : this._ops!;
    tail = holdMap(tail, this._def.hold, (x) => x.simplify(options).canonical);

    if (this._def?.associative)
      tail = flattenOps(tail, this.head as string) ?? tail;

    //
    // 5/ If a lambda, apply the arguments, and simplify the result
    //
    if (typeof this._head !== 'string')
      return lambda(this._head, tail).simplify(options);

    //
    // 6/ Apply `simplify` handler
    //
    let expr =
      this._def.simplify?.(this.engine, tail) ??
      this.engine.fn(this._head, tail).canonical;

    //
    // 7/ Apply rules, until no rules can be applied
    //
    const rules =
      options?.rules ??
      this.engine.cache<BoxedRuleSet>(
        'standard-simplification-rules',
        () => boxRules(this.engine, SIMPLIFY_RULES),
        (rules) => {
          for (const [lhs, rhs, _priority, _condition] of rules) {
            lhs._purge();
            rhs._purge();
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
    if (!this.isCanonical) return this.canonical.evaluate(options);

    //
    // 2/ Handle `Hold` and `ReleaseHold`
    //
    if (this.head === 'Hold') return this;
    if (this.head === 'ReleaseHold') {
      const op1 = this.op1;
      if (op1.head !== 'Hold') return op1.evaluate(options);
      return op1.op1.isMissing
        ? this.engine.symbol('Nothing')
        : op1.op1.evaluate(options);
    }

    //
    // 3/ Does it have a definition?
    //    If not, we don't know how to evaluate it
    //
    if (!this._def) return this;
    const def = this._def;

    //
    // 4/ Evaluate the applicable operands
    //
    let tail = holdMap(
      def.associative
        ? flattenOps(this._ops!, this.head as string) ?? this._ops!
        : this._ops!,
      def.hold,
      (arg) => arg.evaluate(options) ?? arg
    );

    if (def.associative) tail = flattenOps(tail, this.head as string) ?? tail;

    //
    // 5/ Is it a Lambda?
    //
    if (typeof this._head !== 'string')
      return lambda(this._head, tail).evaluate(options);

    //
    // 6/ Call the `evaluate` handler
    //

    // 6.1/ No evaluate handler, we're done
    if (def.evaluate === undefined)
      return this.engine.fn(this._head, tail).canonical;

    // 6.2/ A lambda-function handler
    if (typeof def.evaluate !== 'function')
      return lambda(def.evaluate, tail).canonical;

    // 6.3/ A regular function handler
    return (
      def.evaluate(this.engine, tail) ??
      this.engine.fn(this._head, tail).canonical
    );
  }

  N(options?: NOptions): BoxedExpression {
    //
    // 1/ Use canonical form
    //

    if (!this.isCanonical) return this.canonical.N(options);

    //
    // 2/ Handle `Hold` and `ReleaseHold`
    //
    if (this.head === 'Hold') return this;
    if (this.head === 'ReleaseHold') {
      const op1 = this.op1;
      if (op1.head !== 'Hold') return op1.N(options);
      return op1.op1.isMissing
        ? this.engine.symbol('Nothing')
        : op1.op1.N(options);
    }

    //
    // 3/ Does it have a definition?
    //    If not, we don't know how to evaluate it
    //
    if (!this._def) return this;
    const def = this._def;

    // 4/ Evaluate numerically all the arguments (unless a Hold applies)
    //
    let tail = def.associative
      ? flattenOps(this._ops!, this.head as string) ?? this._ops!
      : this._ops!;
    tail = holdMap(tail, this._def.hold, (arg) => arg.N(options));

    if (def.associative) tail = flattenOps(tail, this.head as string) ?? tail;

    //
    // 5/ Is it a Lambda?
    //
    if (typeof this._head !== 'string')
      return lambda(this._head, tail).N(options);

    //
    // 6/ Call `N` handler
    //

    const result = def.N?.(this.engine, tail) ?? this.evaluate();

    if (result.isLiteral) {
      if (!complexAllowed(this.engine) && result.complexValue)
        return this.engine.NAN;

      if (!useDecimal(this.engine) && result.decimalValue)
        return this.engine.number(result.decimalValue.toNumber());
    }
    return result;
  }

  solve(_vars: Iterable<string>): null | BoxedExpression[] {
    // @todo
    return null;
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  subs(sub: Substitution): BoxedExpression {
    // Call `fn().canonical` (and not `new BoxedFunction()`) so that the
    // function may be reconstructed as a canonical expression
    return this.engine.fn(
      this._head,
      this._ops.map((x) => x.subs(sub))
    ).canonical;
  }
}

export function lambda(
  fn: BoxedExpression,
  args: BoxedExpression[]
): BoxedExpression {
  // 'fn' is a lambda expression.

  const subs: Substitution = {
    '__': fn.engine.tuple(args),
    '_#': fn.engine.number(args.length),
  };
  let n = 1;
  for (const op of args) subs[`_${n++}`] = op;
  subs['_'] = subs['_1'];

  // Substitute the arguments in the lambda expression
  return fn.subs(subs);
}

export function ungroup(expr: BoxedExpression): BoxedExpression {
  if (!expr.ops) return expr;
  if (expr.head === 'Delimiter' && expr.nops >= 1) return ungroup(expr.op1);
  return expr.apply(ungroup);
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
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  xs: BoxedExpression[],
  skip: 'all' | 'none' | 'first' | 'rest' | 'last' | 'most',
  f: (BoxedExpression) => BoxedExpression | null
): BoxedExpression[] {
  if (xs.length === 0) return [];

  const result: BoxedExpression[] = [];

  if (skip === 'all') return xs;
  else if (skip === 'none')
    for (let i = 0; i < xs.length; i++) {
      const x = f(xs[i]);
      if (x !== null) result.push(x);
    }
  else if (skip === 'first') {
    result.push(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const x = f(xs[i]);
      if (x !== null) result.push(x);
    }
  } else if (skip === 'rest') {
    const x = f(xs[0]);
    if (x !== null) result.push(x);
    for (let i = 1; i < xs.length; i++) result.push(xs[i]);
  } else if (skip === 'last') {
    for (let i = 0; i < xs.length - 1; i++) {
      const x = f(xs[i]);
      if (x !== null) result.push(x);
    }
    result.push(xs[xs.length - 1]);
  } else if (skip === 'most') {
    for (let i = 0; i < xs.length - 1; i++) result.push(xs[i]);
    const x = f(xs[xs.length - 1]);
    if (x !== null) result.push(x);
  }
  return result;
}
