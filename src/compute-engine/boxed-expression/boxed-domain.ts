import { Expression } from '../../math-json/math-json-format';
import { head } from '../../math-json/utils';
import {
  ancestors,
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from '../library/domains';
import { asSmallInteger } from '../numerics/numeric';
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
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

/**
 * A `_BoxedDomain` is a wrapper around a boxed, canonical, domain expression.
 *
 * If could also be an error, in which case, `isValid` is `false`.
 *
 */
export class _BoxedDomain
  extends AbstractBoxedExpression
  implements BoxedDomain
{
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
    return this.ctor !== 'Error';
  }

  get json(): Expression {
    const s = serialize(this.engine, this._value);
    if (head(s) === 'Error') return s;
    return ['Domain', s];
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
      if (rhsCtor === 'Invariant')
        return !isSubdomainOf(rhsParam, lhs) && !isSubdomainOf(lhs, rhsParam);
      if (rhsCtor === 'Covariant') return isSubdomainOf(lhs, rhsParam);
      if (rhsCtor === 'Contravariant') return isSubdomainOf(rhsParam, lhs);
      if (rhsCtor === 'Bivariant')
        return isSubdomainOf(lhs, rhsParam) && isSubdomainOf(rhsParam, lhs);
    }

    if (compatibility === 'covariant') return isSubdomainOf(lhs, rhs);
    if (compatibility === 'contravariant') return isSubdomainOf(rhs, lhs);
    if (compatibility === 'bivariant')
      return isSubdomainOf(rhs, lhs) && isSubdomainOf(lhs, rhs);

    // Invariant
    return !isSubdomainOf(rhs, lhs) && !isSubdomainOf(lhs, rhs);
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
  dom: BoxedDomain | DomainExpression,
  metadata?: Metadata
): BoxedDomain {
  if (dom instanceof _BoxedDomain) return dom;

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

/** Turn a valid domain expression into a canonical domain expression */
function makeCanonical(
  ce: IComputeEngine,
  dom: DomainExpression
): DomainExpression<BoxedExpression> {
  if (typeof dom === 'string') {
    if (!isDomainLiteral(dom)) throw Error('Unknown domain literal');
    return dom;
  }
  if (dom instanceof _BoxedDomain) return dom._value;

  const ctor = dom[0];

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
    return [
      'Function',
      ...dom.slice(1).map((x) => makeCanonical(ce, x as DomainExpression)),
    ];
  }

  if (ctor === 'Dictionary') {
    return ['Dictionary', makeCanonical(ce, dom[1] as DomainExpression)];
  }

  if (ctor === 'List') {
    return ['List', makeCanonical(ce, dom[1] as DomainExpression)];
  }

  if (ctor === 'Tuple') {
    return [
      'Tuple',
      ...dom.slice(1).map((x) => makeCanonical(ce, x as DomainExpression)),
    ];
  }

  if (ctor === 'Union') {
    return [
      'Union',
      ...dom.slice(1).map((x) => makeCanonical(ce, x as DomainExpression)),
    ];
  }

  if (ctor === 'Intersection') {
    return [
      'Intersection',
      ...dom.slice(1).map((x) => makeCanonical(ce, x as DomainExpression)),
    ];
  }

  if (
    ctor === 'Covariant' ||
    ctor === 'Contravariant' ||
    ctor === 'Invariant'
  ) {
    return [ctor, makeCanonical(ce, dom[1] as DomainExpression)];
  }

  if (ctor === 'Maybe') {
    return ['Maybe', makeCanonical(ce, dom[1] as DomainExpression)];
  }

  if (ctor === 'Sequence') {
    return ['Sequence', makeCanonical(ce, dom[1] as DomainExpression)];
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

  if (ctor === 'Error') {
    return ['Error', ...dom.slice(1).map((x) => ce.box(x))];
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

  if (typeof expr === 'string') return isDomainLiteral(expr);

  if (Array.isArray(expr)) {
    if (expr.length <= 1) return false;
    // Could be a domain expression
    const fn = expr[0];
    if (typeof fn !== 'string' || !DOMAIN_CONSTRUCTORS.includes(fn))
      return false;

    return expr.every((x) => x !== null);
  }

  return false;
}

// Return `true` if `lhs` is a sub domain of, or equal to, `rhs`
// `lhs` is the "template" that `rhs` is checked against
export function isSubdomainOf(
  lhs: DomainExpression<BoxedExpression>,
  rhs: DomainExpression<BoxedExpression>
): boolean {
  const rhsLiteral = typeof rhs === 'string' ? rhs : null;
  if (rhsLiteral === 'Anything') return true;
  const lhsLiteral = typeof lhs === 'string' ? lhs : null;

  //
  // 1/ Compare two domain literals
  //
  if (lhsLiteral && rhsLiteral) {
    if (lhsLiteral === rhsLiteral) return true;
    return includesDomain(ancestors(lhsLiteral), rhsLiteral);
  }

  //
  // 2/ Is the lhs domain constructor a subdomain of the rhs domain literal?
  //
  if (rhsLiteral) {
    const lhsConstructor = lhs[0];
    if (lhsConstructor === 'Domain') {
      // debugger;
    }

    if (lhsConstructor === 'Function') return rhsLiteral === 'Function';
    if (lhsConstructor === 'Dictionary') return rhsLiteral === 'Dictionary';
    if (lhsConstructor === 'List') return rhsLiteral === 'List';
    if (lhsConstructor === 'Tuple') {
      // debugger;
      return rhsLiteral === 'Tuple';
    }
    if (lhsConstructor === 'Intersection') {
    }
    // @todo handle domain constructors

    // 'Intersection',
    // 'Union',

    // 'Maybe',
    // 'Sequence',

    if (lhsConstructor === 'Interval')
      return isSubdomainOf('ExtendedRealNumber', rhsLiteral);

    if (lhsConstructor === 'Range') return isSubdomainOf('Integer', rhsLiteral);

    // 'Head',
    // 'Symbol',
    // 'Value',
    return true;
  }

  //
  // 3/ Compare a rhs domain expression with a domain literal or expression
  //
  const rhsConstructor = rhs[0]!;

  if (rhsConstructor === 'Function') {
    // See https://www.stephanboyer.com/post/132/what-are-covariance-and-contravariance
    if (lhsLiteral === 'Function') return true;
    if (lhsLiteral) return false;

    // Only a `Function` ctor can be a subdomain of a `Function`
    if (lhs[0] !== 'Function') return false;

    // Both constructors are 'Function':

    // Check that the arguments and return values are compatible
    // Parameters should be contravariant, return values should be covariant

    const lhsReturnDomain = lhs[
      lhs.length - 1
    ] as DomainExpression<BoxedExpression>;
    const rhsReturnDomain = rhs[
      rhs.length - 1
    ] as DomainExpression<BoxedExpression>;
    if (!isSubdomainOf(lhsReturnDomain, rhsReturnDomain)) return false;

    const lhsParams = lhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    const rhsParams = rhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    for (let i = 0; i <= lhsParams.length - 1; i++) {
      // `rhs` is not expected to include a `Sequence`, `Contravariant`, etc... ctor, but `lhs` might
      const lhsCtor = Array.isArray(lhsParams[i]) ? lhsParams[i][0] : null;
      if (rhsParams[i] === undefined) {
        if (lhsCtor !== 'Maybe') return false;
        return true;
      }
      if (lhsCtor === 'Sequence') {
        const seq = lhsParams[i][1] as DomainExpression<BoxedExpression>;
        for (let j = i; j < rhsParams.length - 1; j++)
          if (!isSubdomainOf(rhsParams[j], seq)) return false;
        return true;
      }
      if (!isSubdomainOf(rhsParams[i], lhsParams[i])) return false;
    }
    if (rhsParams.length > lhsParams.length) return false;
    return true;
  }

  // @todo handle domain constructors
  // 'Dictionary',
  // 'List',
  // 'Tuple',

  if (rhsConstructor === 'Intersection') {
    return (rhs as DomainExpression<BoxedExpression>[])
      .slice(1, -1)
      .every((x: DomainExpression<BoxedExpression>) => isSubdomainOf(lhs, x));
  }

  if (rhsConstructor === 'Union') {
    return (rhs as DomainExpression<BoxedExpression>[])
      .slice(1, -1)
      .some((x: DomainExpression<BoxedExpression>) => isSubdomainOf(lhs, x));
  }

  if (rhsConstructor === 'Maybe') {
    if (lhsLiteral === 'Nothing') return true;
    return isSubdomainOf(lhs, rhs[1]! as DomainExpression<BoxedExpression>);
  }

  if (rhsConstructor === 'Sequence') {
    return isSubdomainOf(lhs, rhs[1]! as DomainExpression<BoxedExpression>);
  }

  // 'Interval',
  // 'Range',
  if (rhsConstructor === 'Range') {
    // @todo
  }

  // 'Head',
  // 'Symbol',
  // 'Value',

  return false;
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

  while (!includesDomain(bAncestors, aAncestors[0])) aAncestors.shift();

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

function includesDomain(xs: string[], y: string): boolean {
  for (const x of xs) if (x === y) return true;
  return false;
}

function serialize(
  ce: IComputeEngine,
  dom: DomainExpression<BoxedExpression>
): Expression {
  if (dom instanceof AbstractBoxedExpression)
    return (dom as BoxedExpression).json;
  if (typeof dom === 'string') return dom;

  if (dom[0] === 'Error') {
    if (dom[2])
      return [
        'Error',
        serialize(ce, dom[1] as DomainExpression<BoxedExpression>),
        serialize(ce, dom[2] as DomainExpression<BoxedExpression>),
      ];
    return [
      'Error',
      serialize(ce, dom[1] as DomainExpression<BoxedExpression>),
    ];
  }

  const result: Expression = [serializeJsonSymbol(ce, dom[0])];
  if (dom.length > 1)
    for (let i = 1; i <= dom.length - 1; i++)
      serialize(ce, dom[i] as DomainExpression<BoxedExpression>);

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
    if (lhs[i] instanceof AbstractBoxedExpression) {
      if (!(rhs[i] instanceof AbstractBoxedExpression)) return false;
      if (!rhs[i].isEqual(rhs[i])) return false;
    } else if (typeof lhs[i] === 'string') {
      if (typeof rhs[i] !== 'string') return false;
      if (lhs[i] !== rhs[i]) return false;
    } else if (!isEqual(lhs[i] as DomainExpression<BoxedExpression>, rhs[i]))
      return false;
  }
  return true;
}
