import { Expression } from '../../math-json/math-json-format';
import {
  ancestors,
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from '../library/domains';
import { asFloat, asSmallInteger } from '../numerics/numeric';
import {
  BoxedDomain,
  BoxedExpression,
  BoxedSubstitution,
  DomainCompatibility,
  DomainConstructor,
  DomainExpression,
  DomainLiteral,
  IComputeEngine,
  Metadata,
  PatternMatchOptions,
  SemiBoxedExpression,
} from '../public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

/**
 * A `_BoxedDomain` is a wrapper around a boxed, canonical, domain expression.
 *
 * If could also be an error, in which case, `isValid` is `false`.
 *
 */
export class _BoxedDomain extends _BoxedExpression implements BoxedDomain {
  /** The value of a boxed domain is either a string if a domain literal, or a
   * domain constructor function.
   * Since the domains are alway canonicalized when boxed, their value can
   * be represented by a simple array, without the need for extra boxing.
   */
  _value: DomainExpression<BoxedExpression>;
  private _hash: number;

  constructor(ce: IComputeEngine, dom: DomainExpression, metadata?: Metadata) {
    super(ce, metadata);
    this._value = makeCanonical(ce, dom);
  }

  get isCanonical(): boolean {
    return true;
  }

  /** Boxed domains are always canonical. */
  get canonical(): _BoxedDomain {
    return this;
  }

  get isValid(): boolean {
    return this.ctor !== 'InvalidDomain';
  }

  get json(): Expression {
    return ['Domain', serialize(this.engine, this._value)];
  }

  get literal(): string | null {
    if (typeof this._value === 'string') return this._value;
    return null;
  }

  get ctor(): DomainConstructor | null {
    if (typeof this._value === 'string') return null;
    return this._value[0] as DomainConstructor;
  }

  get domainArgs():
    | (string | BoxedExpression | DomainExpression<BoxedExpression>)[]
    | null {
    if (typeof this._value === 'string') return null;
    return this._value.slice(1) as (
      | string
      | BoxedExpression
      | DomainExpression<BoxedExpression>
    )[];
  }

  get domainArg1():
    | string
    | BoxedExpression
    | DomainExpression<BoxedExpression>
    | null {
    if (typeof this._value === 'string') return null;
    return this._value[1] as
      | string
      | BoxedExpression
      | DomainExpression<BoxedExpression>;
  }

  get codomain(): BoxedDomain | null {
    if (typeof this._value === 'string') return null;
    //  The codomain is the last argument of the `['Function']` expression
    return this.engine.domain(this._value[this._value.length - 1]);
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(hash(this._value));
    return this._hash;
  }

  isEqual(rhs: BoxedExpression): boolean {
    return isEqual(this._value, rhs);
  }

  isSame(rhs: BoxedExpression): boolean {
    return isEqual(this._value, rhs);
  }

  is(rhs: any): boolean {
    return isEqual(this._value, rhs);
  }

  isCompatible(
    dom: BoxedDomain | DomainLiteral,
    compatibility: DomainCompatibility = 'covariant'
  ): boolean {
    const lhs = this._value;
    const rhs =
      dom instanceof _BoxedDomain ? dom._value : (dom as DomainLiteral);
    const rhsCtor = Array.isArray(rhs) ? rhs[0] : null;
    if (rhsCtor) {
      const rhsParam = rhs[1] as DomainExpression<BoxedExpression>;
      if (rhsCtor === 'Covariant') return isSubdomainOf1(lhs, rhsParam);
      if (rhsCtor === 'Contravariant') return isSubdomainOf1(rhsParam, lhs);
      if (rhsCtor === 'Invariant')
        return !isSubdomainOf1(rhsParam, lhs) && !isSubdomainOf1(lhs, rhsParam);
      if (rhsCtor === 'Bivariant')
        return isSubdomainOf1(lhs, rhsParam) && isSubdomainOf1(rhsParam, lhs);
    }

    if (compatibility === 'covariant') return isSubdomainOf1(lhs, rhs);
    if (compatibility === 'contravariant') return isSubdomainOf1(rhs, lhs);
    if (compatibility === 'bivariant')
      return isSubdomainOf1(rhs, lhs) && isSubdomainOf1(lhs, rhs);

    // Invariant
    return !isSubdomainOf1(rhs, lhs) && !isSubdomainOf1(lhs, rhs);
  }

  match(
    rhs: BoxedExpression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!(rhs instanceof _BoxedDomain)) return null;
    if (this.isSame(rhs)) return {};
    return null;
  }

  get head(): string {
    return 'Domain';
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Domain');
  }

  get isNothing(): boolean {
    // The Nothing domain is the domain of the `Nothing` symbol
    return this._value === 'Nothing';
  }

  get isFunction(): boolean {
    return this.ctor === 'Function' || this._value === 'Function';
  }

  // get isPredicate(): boolean {
  //   if (this.domainLiteral === 'Predicate') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   const resultDomain = this._value[this._value.length];
  //   if (!(resultDomain instanceof _Domain)) return false;
  //   return resultDomain.isBoolean;
  // }
  // get isNumericFunction(): boolean {
  //   if (this.domainLiteral === 'NumericFunction') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'Number')) return false;

  //   return true;
  // }
  // get isBoolean(): boolean {
  //   const dom = this.domainLiteral;
  //   return dom === 'Boolean' || dom === 'MaybeBoolean';
  // }

  // get isRealFunction(): boolean {
  //   if (this.domainLiteral === 'RealFunction') return true;
  //   if (this.domainConstructor !== 'Function') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'ExtendedRealNumber')) return false;
  //   return true;
  // }

  get isNumeric(): boolean {
    return this.isCompatible(this.engine.domain('Number'));
  }

  // get isLogicOperator(): boolean {
  //   if (this.domainLiteral === 'LogicOperator') return true;
  //   if (!this.codomain?.isBoolean) return false;

  //   const params = this.domainParams!;
  //   if (params.length < 1 || params.length > 2) return false;

  //   if (!params[0].isBoolean) return false;
  //   if (params.length === 1) return true;

  //   if (!params[1].isBoolean) return false;
  //   return true;
  // }

  get isRelationalOperator(): boolean {
    if (this._value === 'RelationalOperator') return true;
    if (this.ctor !== 'Function') return false;
    if (this.domainArgs!.length !== 2) return false;
    if (!this.codomain!.isCompatible('MaybeBoolean')) return false;

    return true;
  }
}

/**
 * Note that `boxDomain()` should only be called from `ComputeEngine`.
 * This gives a chance for `ComputeEngine` to substitute cached objects.
 */

export function boxDomain(
  ce: IComputeEngine,
  dom: BoxedExpression | DomainExpression,
  metadata?: Metadata
): BoxedDomain {
  if (Array.isArray(dom) && (dom[0] as string) === 'Domain')
    dom = dom[1] as DomainExpression;

  if (dom instanceof _BoxedDomain) return dom;
  if (dom instanceof _BoxedExpression) dom = dom.json as DomainExpression;

  if (typeof dom === 'string') {
    const expr = DOMAIN_ALIAS[dom];
    if (expr) return boxDomain(ce, expr);
    if (!isDomainLiteral(dom))
      throw Error('Expected a domain literal, got ' + dom);
    return new _BoxedDomain(ce, dom, metadata);
  }
  if (!Array.isArray(dom) || dom.length === 0)
    throw Error('Expected a valid domain');

  const constructor = dom[0];

  if (!DOMAIN_CONSTRUCTORS.includes(constructor))
    throw Error('Expected domain constructor, got ' + constructor);

  return new _BoxedDomain(ce, dom, metadata);
}

/** Turn a valid domain expression into a canonical domain expression.
 * If the domain expression is invalid, throw an error. We throw in this
 * case because the domain expression is unlikely to be a user input and
 * handling a bad domain expression would be burdensome.
 */
function makeCanonical(
  ce: IComputeEngine,
  dom: undefined | number | object | DomainExpression
): DomainExpression<BoxedExpression> {
  if (dom === undefined || typeof dom === 'number')
    throw Error('Expected a domain expression');

  if (dom instanceof _BoxedDomain) return dom._value;

  if (typeof dom === 'string') {
    if (!isDomainLiteral(dom)) throw Error(`Unknown domain literal "${dom}"`);
    return dom;
  }

  if (!Array.isArray(dom) && typeof dom === 'object')
    throw Error('Expected a domain expression');

  if (!dom) debugger;
  const ctor = dom[0];
  console.assert(ctor);

  //
  // Range
  //
  if (ctor === 'Range') {
    if (dom.length === 1) return 'Integer';
    let first: string | SemiBoxedExpression | DomainExpression = 1;
    let last: string | SemiBoxedExpression | DomainExpression = +Infinity;
    if (dom.length === 2) {
      last = dom[1];
    } else if (dom.length === 3) {
      first = dom[1];
      last = dom[2];
    }
    const firstNum = asRangeBound(ce, first);
    const lastNum = asRangeBound(ce, last);
    if (firstNum === null || lastNum === null)
      throw Error(`Invalid range [${firstNum}, ${lastNum}] `);
    if (lastNum < firstNum) [first, last] = [last, first];
    if (firstNum === -Infinity && lastNum === Infinity) return 'Integer';

    if (firstNum === 1 && lastNum === Infinity) return 'PositiveInteger';
    if (firstNum === 0 && lastNum === Infinity) return 'NonNegativeInteger';
    if (firstNum === -Infinity && lastNum === -1) return 'NegativeInteger';
    if (firstNum === -Infinity && lastNum === 0) return 'NonPositiveInteger';

    return ['Range', ce.number(firstNum), ce.number(lastNum)];
  }

  //
  // Interval
  //
  if (ctor === 'Interval') {
    if (dom.length !== 3) throw Error('Invalid range ' + dom);
    let [isLeftOpen, first] = maybeOpen(ce, dom[1]);
    let [isRightOpen, last] = maybeOpen(ce, dom[2]);

    if (first === null || last === null) throw Error('Invalid range ' + dom);
    if (last < first) {
      [first, last] = [last, first];
      [isLeftOpen, isRightOpen] = [isRightOpen, isLeftOpen];
    }

    if (first === 0 && last === Infinity)
      return isLeftOpen ? 'PositiveNumber' : 'NonNegativeNumber';
    if (first === -Infinity && last === 0)
      return isRightOpen ? 'NegativeNumber' : 'NonPositiveNumber';

    return [
      'Interval',
      isLeftOpen ? ['Open', ce.number(first)] : ce.number(first),
      isRightOpen ? ['Open', ce.number(last)] : ce.number(last),
    ] as DomainExpression<BoxedExpression>;
  }

  //
  // Function
  //
  if (ctor === 'Function') {
    // @todo:
    // Multiple `Maybe`, `Sequence` in arguments
    // Multiple Invariant, Covariant, Contravariant in argument
    // Normalize attributes: Open, Maybe, Invariant, Sequence, etc...
    // A rest argument (Sequence) must be the last one
    return ['Function', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
  }

  if (ctor === 'Dictionary') {
    return ['Dictionary', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'List') {
    return ['List', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'Tuple') {
    return ['Tuple', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
  }

  if (ctor === 'Union') {
    return ['Union', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
  }

  if (ctor === 'Intersection') {
    return ['Intersection', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
  }

  if (
    ctor === 'Covariant' ||
    ctor === 'Contravariant' ||
    ctor === 'Invariant'
  ) {
    return [ctor, makeCanonical(ce, dom[1])];
  }

  if (ctor === 'Maybe') {
    return ['Maybe', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'Sequence') {
    return ['Sequence', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'Head') {
    return ['Head', dom[1] as string];
  }

  if (ctor === 'Symbol') {
    return ['Symbol', dom[1] as string];
  }

  if (ctor === 'Value') {
    return ['Value', ce.box(dom[1])];
  }

  if (ctor === 'InvalidDomain') {
    return ['InvalidDomain', dom[1] as string];
  }

  throw Error('Unexpected domain constructor ' + ctor);
}

function asRangeBound(
  ce: IComputeEngine,
  expr: string | SemiBoxedExpression | DomainExpression
): number | null {
  if (typeof expr === 'number') return expr;

  const x = ce.box(expr).evaluate();
  return x.isInfinity
    ? x.isPositive
      ? +Infinity
      : -Infinity
    : asSmallInteger(x);
}

// function asIntervalBound(ce: IComputeEngine, expr: Expression): number | null {
//   const val = ce.box(open(expr) ?? expr).evaluate();

//   return (
//     val.asSmallInteger ??
//     (val.isInfinity ? (val.isPositive ? +Infinity : -Infinity) : null)
//   );
// }

function maybeOpen(
  ce: IComputeEngine,
  expr: string | SemiBoxedExpression | DomainExpression
): [open: boolean, value: number | null] {
  // @todo: Multiple Open
  if (Array.isArray(expr) && expr[0] === 'Open')
    return [true, asRangeBound(ce, expr[1])];
  return [false, asRangeBound(ce, expr)];
}

/** Validate that `expr` is a Domain */
export function isDomain(
  expr: Expression | BoxedExpression | BoxedDomain | DomainExpression
): expr is BoxedDomain | DomainExpression {
  if (expr instanceof _BoxedDomain) return true;

  if (expr instanceof _BoxedExpression) expr = expr.json;

  if (typeof expr === 'string') return isDomainLiteral(expr);

  if (Array.isArray(expr)) {
    if (expr.length <= 1) return false;
    // Could be a domain expression
    const ctor = expr[0];
    if (typeof ctor !== 'string' || !DOMAIN_CONSTRUCTORS.includes(ctor))
      return false;

    if (ctor === 'InvalidDomain') return false;

    if (ctor === 'List') return expr.length === 2 && isValidDomain(expr[1]);

    if (
      ctor === 'Tuple' ||
      ctor === 'Function' ||
      ctor === 'Maybe' ||
      ctor === 'Sequence' ||
      ctor === 'Intersection' ||
      ctor === 'Union'
    )
      return expr.slice(1, -1).every((x) => isValidDomain(x));

    return expr.every((x) => x !== null);
  }

  return false;
}

export function isValidDomain(
  expr: any
): expr is BoxedDomain | DomainExpression {
  if (expr instanceof _BoxedDomain) return expr.isValid;

  if (Array.isArray(expr) && expr[0] === 'InvalidDomain') return false;

  return isDomain(expr);
}

function isSubdomainOf1(
  lhs: DomainExpression<BoxedExpression>,
  rhs: DomainExpression<BoxedExpression>
): boolean {
  const [result, rest] = isSubdomainOf([lhs], rhs);
  if (result && rest.length === 0) return true;
  return false;
}

// Return `true` if `lhs` is a sub domain of, or equal to, `rhs`
// `lhs` is the "template" that `rhs` is checked against
function isSubdomainOf(
  xlhs: DomainExpression<BoxedExpression>[],
  rhs: DomainExpression<BoxedExpression>
): [boolean, DomainExpression<BoxedExpression>[]] {
  let lhs = xlhs.shift() as DomainExpression<BoxedExpression>;

  const rhsLiteral = typeof rhs === 'string' ? rhs : null;
  if (rhsLiteral === 'Anything') return [true, xlhs];

  const lhsLiteral = typeof lhs === 'string' ? lhs : null;

  //
  // 1/ Compare two domain literals
  //
  if (lhsLiteral && rhsLiteral) {
    if (lhsLiteral === rhsLiteral) return [true, xlhs];
    return [ancestors(lhsLiteral).includes(rhsLiteral), xlhs];
  }

  //
  // 2/ Is the lhs domain constructor a subdomain of the rhs domain literal?
  //
  if (rhsLiteral) {
    if (!lhs) debugger;
    const lhsConstructor = lhs[0];
    if (lhsConstructor === 'Function') return [rhsLiteral === 'Function', xlhs];
    if (lhsConstructor === 'Dictionary')
      return [rhsLiteral === 'Dictionary', xlhs];
    if (lhsConstructor === 'List') return [rhsLiteral === 'List', xlhs];
    if (lhsConstructor === 'Tuple') return [rhsLiteral === 'Tuple', xlhs];

    if (lhsConstructor === 'Intersection') {
    }
    // @todo handle domain constructors

    // 'Intersection',
    // 'Union',

    // 'Maybe',
    // 'Sequence',

    if (lhsConstructor === 'Interval')
      return [isSubdomainOf1('ExtendedRealNumber', rhsLiteral), xlhs];

    if (lhsConstructor === 'Range')
      return [isSubdomainOf1('Integer', rhsLiteral), xlhs];

    // 'Head',
    // 'Symbol',
    // 'Value',
    return [true, xlhs];
  }

  //
  // 3/ Compare a rhs domain expression with a domain literal or expression
  //
  const rhsConstructor = rhs[0]!;

  if (rhsConstructor === 'Function') {
    // See https://www.stephanboyer.com/post/132/what-are-covariance-and-contravariance
    if (lhsLiteral === 'Function') return [true, xlhs];
    if (lhsLiteral) return [false, xlhs];

    // Only a `Function` ctor can be a subdomain of a `Function`
    if (lhs[0] !== 'Function') return [false, xlhs];

    // Both constructors are 'Function':

    if (lhs.length === 1 && rhs.length === 1) return [true, xlhs];

    // Check that the values are compatible (covariant)
    if (
      !isSubdomainOf1(
        lhs[lhs.length - 1] as DomainExpression<BoxedExpression>,
        rhs[rhs.length - 1] as DomainExpression<BoxedExpression>
      )
    )
      return [false, xlhs];

    // Check that parameters are contravariant
    const lhsParams = lhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    let rhsParams = rhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    // let j = 0;
    for (let i = 0; i <= lhsParams.length - 1; i++) {
      // `rhs` is not expected to include a `Sequence`, `Contravariant`, etc... ctor, but `lhs` might
      if (rhsParams.length === 0) {
        // We have run out of rhs parameters
        const lhsCtor = Array.isArray(lhsParams[i]) ? lhsParams[i][0] : null;
        if (lhsCtor !== 'Maybe') return [false, xlhs];
        // Any remaining lhs parameters should be optional
        return [true, xlhs];
      } else {
        let match = false;
        [match, rhsParams] = isSubdomainOf(rhsParams, lhsParams[i]);
        if (!match) return [false, xlhs];
      }
    }

    // There should be no `rhs` parameters left to check
    return [rhsParams.length === 0, xlhs];
  }

  // @todo handle domain constructors
  // 'Dictionary',
  // 'List',
  // 'Tuple',

  if (rhsConstructor === 'Intersection') {
    return [
      (rhs as DomainExpression<BoxedExpression>[])
        .slice(1, -1)
        .every((x: DomainExpression<BoxedExpression>) =>
          isSubdomainOf1(lhs, x)
        ),
      xlhs,
    ];
  }

  if (rhsConstructor === 'Union') {
    return [
      (rhs as DomainExpression<BoxedExpression>[])
        .slice(1, -1)
        .some((x: DomainExpression<BoxedExpression>) => isSubdomainOf1(lhs, x)),
      xlhs,
    ];
  }

  if (rhsConstructor === 'Maybe') {
    if (lhsLiteral === 'Nothing') return [true, xlhs];
    return isSubdomainOf(
      [lhs, ...xlhs] as DomainExpression<BoxedExpression>[],
      rhs[1]! as DomainExpression<BoxedExpression>
    );
  }

  if (rhsConstructor === 'Sequence') {
    const seq = rhs[1] as DomainExpression<BoxedExpression>;

    if (!isSubdomainOf1(lhs, seq)) return [false, xlhs];
    lhs = xlhs.shift() as DomainExpression<BoxedExpression>;

    // Skip over all other parameters of domain `seq`
    let match = true;
    while (xlhs.length > 0 && match) {
      [match, xlhs] = isSubdomainOf(xlhs, seq);
      lhs = xlhs.shift() as DomainExpression<BoxedExpression>;
    }
    return [true, xlhs];
  }

  if (rhsConstructor === 'Tuple') {
    if (!Array.isArray(lhs) || lhs[0] !== 'Tuple') return [false, xlhs];
    if (lhs.length > rhs.length) return [false, xlhs];
    for (let i = 1; i <= rhs.length - 1; i++) {
      if (
        !lhs[i] ||
        !isSubdomainOf1(
          lhs[i] as DomainExpression<BoxedExpression>,
          rhs[i] as DomainExpression<BoxedExpression>
        )
      )
        return [false, xlhs];
    }
    return [true, xlhs];
  }

  // 'Head',
  // 'Symbol',
  // 'Value',

  if (rhsConstructor === 'Range') {
    if (!Array.isArray(lhs) || lhs[0] !== 'Range') return [false, xlhs];
    const lhsMin = asFloat(lhs[1] as BoxedExpression);
    const lhsMax = asFloat(lhs[2] as BoxedExpression);
    const rhsMin = asFloat(rhs[1] as BoxedExpression);
    const rhsMax = asFloat(rhs[2] as BoxedExpression);

    return [
      lhsMin !== null &&
        lhsMax !== null &&
        rhsMin !== null &&
        rhsMax !== null &&
        lhsMin >= rhsMin &&
        lhsMax <= rhsMax,
      xlhs,
    ];
  }

  if (rhsConstructor === 'Interval') {
    if (!Array.isArray(lhs) || lhs[0] !== 'Interval') return [false, xlhs];
    const lhsMin = asFloat(lhs[1] as BoxedExpression);
    const lhsMax = asFloat(lhs[2] as BoxedExpression);
    const rhsMin = asFloat(rhs[1] as BoxedExpression);
    const rhsMax = asFloat(rhs[2] as BoxedExpression);

    return [
      lhsMin !== null &&
        lhsMax !== null &&
        rhsMin !== null &&
        rhsMax !== null &&
        lhsMin >= rhsMin &&
        lhsMax <= rhsMax,
      xlhs,
    ];
  }

  console.error('Unexpected domain constructor ' + rhsConstructor);

  return [false, xlhs];
}

/** Return the ancestor domain that is shared by both `a` and `b` */
export function sharedAncestorDomain(
  a: BoxedDomain,
  b: BoxedDomain
): BoxedDomain {
  const aLiteral = domainLiteralAncestor(a);
  const bLiteral = domainLiteralAncestor(b);
  const aAncestors = [aLiteral, ...ancestors(aLiteral)];
  const bAncestors = [bLiteral, ...ancestors(bLiteral)];

  while (!bAncestors.includes(aAncestors[0])) aAncestors.shift();

  return a.engine.domain(aAncestors[0]);
}

// Return the domain literal that is the closest ancestor to `dom`
function domainLiteralAncestor(dom: BoxedDomain): string {
  let result = dom.literal;
  if (result) return result;

  result = dom.ctor!;

  if (result === 'Maybe') return 'Anything';
  if (result === 'Interval') return 'RealNumber';
  if (result === 'Range') return 'Integer';
  if (result === 'Head') return 'Function';

  if (result === 'Union') return 'Anything'; // @todo could be more narrow
  if (result === 'Intersection') return 'Anything'; // @todo could be more narrow

  return result;
}

function serialize(
  ce: IComputeEngine,
  dom: DomainExpression<BoxedExpression>
): Expression {
  if (dom instanceof _BoxedExpression) return dom.json;
  if (typeof dom === 'string') return dom;

  if (dom[0] === 'InvalidDomain') {
    return ['InvalidDomain', serialize(ce, dom[1] as string)];
  }

  const result: Expression = [serializeJsonSymbol(ce, dom[0])];
  if (dom.length > 1)
    for (let i = 1; i <= dom.length - 1; i++)
      result.push(serialize(ce, dom[i] as DomainExpression<BoxedExpression>));

  return result;
}

function hash(dom: DomainExpression<BoxedExpression>): string {
  if (typeof dom === 'string') return 'domain:' + dom;

  let s = 'domain:' + this.ctor!;
  for (const arg of this.domainArgs!) s += ':' + hash(arg);

  return s;
}

function isEqual(lhs: DomainExpression<BoxedExpression>, rhs: any): boolean {
  if (typeof rhs === 'string') return this._value === rhs;

  if (rhs instanceof _BoxedDomain) return isEqual(lhs, rhs._value);

  // Is it a domain literal?
  if (typeof lhs === 'string') return lhs === rhs;

  console.assert(Array.isArray(lhs));

  if (!Array.isArray(rhs)) return false;

  // It's not a domain literal
  if (lhs[0] !== rhs[0]) return false;

  if (rhs.length !== lhs.length) return false;
  for (let i = 1; i <= lhs.length - 1; i++) {
    if (lhs[i] instanceof _BoxedExpression) {
      if (!(rhs[i] instanceof _BoxedExpression)) return false;
      if (!rhs[i].isEqual(rhs[i])) return false;
    } else if (typeof lhs[i] === 'string') {
      if (typeof rhs[i] !== 'string') return false;
      if (lhs[i] !== rhs[i]) return false;
    } else if (!isEqual(lhs[i] as DomainExpression<BoxedExpression>, rhs[i]))
      return false;
  }
  return true;
}
