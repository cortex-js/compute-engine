import { Expression } from '../../math-json/math-json-format';
import {
  ancestors,
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from '../library/domains';
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
} from '../public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

/**
 * A `_BoxedDomain` is a wrapper around a boxed, canonical, domain
 * expression.
 *
 * If could also be an error, in which case, `isValid` is `false`.
 *
 * @todo: architectural improvements:
 * - when constructing, decomposose function signatures into a list of
 *  required parameters, a list of optional parameters,
 *  a vararg parameter, and a return type.
 *
 *
 */
export class _BoxedDomain extends _BoxedExpression implements BoxedDomain {
  /** The value of a boxed domain is either a string if a domain literal, or a
   * domain constructor function.
   * Since the domains are alway canonicalized when boxed, their value can
   * be represented by a simple array, without the need for extra boxing.
   */
  _value: DomainLiteral | DomainExpression<BoxedExpression>;
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

  get base(): DomainLiteral | null {
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

  get codomain(): BoxedDomain | null {
    if (typeof this._value === 'string') return null;
    //  The codomain is the last argument of the `['FunctionOf']` expression
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
    return this.engine.domain('Domains');
  }

  get isNothing(): boolean {
    // The domain NothingDomain is the domain of the `Nothing` symbol
    return this._value === 'NothingDomain';
  }

  get isFunction(): boolean {
    return this.ctor === 'FunctionOf' || this._value === 'Functions';
  }

  // get isPredicate(): boolean {
  //   if (this.domainLiteral === 'Predicate') return true;
  //   if (this.domainConstructor !== 'FunctionOf') return false;
  //   const resultDomain = this._value[this._value.length];
  //   if (!(resultDomain instanceof _Domain)) return false;
  //   return resultDomain.isBoolean;
  // }
  // get isNumericFunction(): boolean {
  //   if (this.domainLiteral === 'NumericFunctions') return true;
  //   if (this.domainConstructor !== 'FunctionOf') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'Numbers')) return false;

  //   return true;
  // }
  // get isBoolean(): boolean {
  //   const dom = this.domainLiteral;
  //   return dom === 'Booleans' || dom === 'MaybeBooleans';
  // }

  // get isRealFunction(): boolean {
  //   if (this.domainLiteral === 'RealFunctions') return true;
  //   if (this.domainConstructor !== 'FunctionOf') return false;
  //   for (const arg of this.domainParams!)
  //     if (!isNumericSubdomain(arg, 'ExtendedRealNumbers')) return false;
  //   return true;
  // }

  get isNumeric(): boolean {
    return this.isCompatible(this.engine.domain('Numbers'));
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
    if (this._value === 'RelationalOperators') return true;
    if (this.ctor !== 'FunctionOf') return false;
    if (this.domainArgs!.length !== 2) return false;
    if (!this.codomain!.isCompatible('MaybeBooleans')) return false;

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
  // Function
  //
  if (ctor === 'FunctionOf') {
    // @todo:
    // Multiple `Maybe`, `Sequence` in arguments
    // Multiple Invariant, Covariant, Contravariant in argument
    // Normalize attributes: Open, Maybe, Invariant, Sequence, etc...
    // A rest argument (Sequence) must be the last one
    return ['FunctionOf', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
  }

  if (ctor === 'DictionaryOf') {
    return ['DictionaryOf', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'ListOf') {
    return ['ListOf', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'TupleOf') {
    return ['TupleOf', ...dom.slice(1).map((x) => makeCanonical(ce, x))];
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

  if (ctor === 'OptArg') {
    return ['OptArg', makeCanonical(ce, dom[1])];
  }

  if (ctor === 'VarArg') {
    return ['VarArg', makeCanonical(ce, dom[1])];
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

// function maybeOpen(
//   ce: IComputeEngine,
//   expr: string | SemiBoxedExpression | DomainExpression
// ): [open: boolean, value: number | null] {
//   // @todo: Multiple Open
//   if (Array.isArray(expr) && expr[0] === 'Open')
//     return [true, asRangeBound(ce, expr[1])];
//   return [false, asRangeBound(ce, expr)];
// }

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
    const ctor = expr[0] as DomainConstructor;
    if (typeof ctor !== 'string' || !DOMAIN_CONSTRUCTORS.includes(ctor))
      return false;

    if (ctor === 'InvalidDomain') return false;

    if (ctor === 'ListOf') return expr.length === 2 && isValidDomain(expr[1]);

    if (
      ctor === 'TupleOf' ||
      ctor === 'FunctionOf' ||
      ctor === 'OptArg' ||
      ctor === 'VarArg' ||
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
    const lhsConstructor = lhs[0] as DomainConstructor;
    if (lhsConstructor === 'FunctionOf')
      return [rhsLiteral === 'Functions', xlhs];
    if (lhsConstructor === 'DictionaryOf')
      return [rhsLiteral === 'Dictionaries', xlhs];
    if (lhsConstructor === 'ListOf') return [rhsLiteral === 'Lists', xlhs];
    if (lhsConstructor === 'TupleOf') return [rhsLiteral === 'Tuples', xlhs];

    if (lhsConstructor === 'Intersection') {
    }
    // @todo handle domain constructors

    // 'Intersection',
    // 'Union',

    // 'Head',
    // 'Symbol',
    // 'Value',
    return [true, xlhs];
  }

  //
  // 3/ Compare a rhs domain expression with a domain literal or expression
  //
  const rhsConstructor = rhs[0]! as DomainConstructor;

  if (rhsConstructor === 'FunctionOf') {
    // See https://www.stephanboyer.com/post/132/what-are-covariance-and-contravariance
    if (lhsLiteral === 'Functions') return [true, xlhs];
    if (lhsLiteral) return [false, xlhs];

    // Only a `Functions` ctor can be a subdomain of a `Functions`
    if (lhs[0] !== 'FunctionOf') return [false, xlhs];

    // Both constructors are 'Functions':

    if (lhs.length === 1 && rhs.length === 1) return [true, xlhs];

    // Check that the result are compatible (**covariant**):
    // return types may be more speicific than expected (declare return to
    // be `Numbers`, but return `Integers`)
    if (
      !isSubdomainOf1(
        lhs[lhs.length - 1] as DomainExpression<BoxedExpression>,
        rhs[rhs.length - 1] as DomainExpression<BoxedExpression>
      )
    )
      return [false, xlhs];

    // Check that the parameters are compatible (***contravariant**)
    // input types may be more general than expected (ask for `Numbers`, but
    // accept `RealNumbers`)
    const lhsParams = lhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    let rhsParams = rhs.slice(1, -1) as DomainExpression<BoxedExpression>[];
    // let j = 0;
    for (let i = 0; i <= lhsParams.length - 1; i++) {
      // `rhs` is not expected to include a `Sequence`, `Contravariant`, etc... ctor, but `lhs` might
      if (rhsParams.length === 0) {
        // We have run out of rhs parameters
        const lhsCtor = Array.isArray(lhsParams[i]) ? lhsParams[i][0] : null;
        if (lhsCtor !== 'OptArg') return [false, xlhs];
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

  if (rhsConstructor === 'OptArg') {
    if (lhsLiteral === 'NothingDomain') return [true, xlhs];
    return isSubdomainOf(
      [lhs, ...xlhs] as DomainExpression<BoxedExpression>[],
      rhs[1]! as DomainExpression<BoxedExpression>
    );
  }

  if (rhsConstructor === 'VarArg') {
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

  if (rhsConstructor === 'TupleOf') {
    if (!Array.isArray(lhs) || lhs[0] !== 'TupleOf') return [false, xlhs];
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
  // 'Values',

  console.error('Unexpected domain constructor ' + rhsConstructor);

  return [false, xlhs];
}

/** Return the ancestor domain that is shared by both `a` and `b` */
export function widen(
  a: BoxedDomain | undefined | null,
  b: BoxedDomain | undefined | null
): BoxedDomain {
  if (a === undefined || a === null) return b!;
  if (b === undefined || b === null) return a;
  const aLiteral = domainLiteralAncestor(a);
  const bLiteral = domainLiteralAncestor(b);
  const aAncestors = [aLiteral, ...ancestors(aLiteral)];
  const bAncestors = [bLiteral, ...ancestors(bLiteral)];

  while (!bAncestors.includes(aAncestors[0])) aAncestors.shift();

  return a.engine.domain(aAncestors[0]);
}

function widestDomain(a: DomainLiteral, b: DomainLiteral): DomainLiteral {
  const aAncestors = [a, ...ancestors(a)];
  const bAncestors = [b, ...ancestors(b)];

  while (!bAncestors.includes(aAncestors[0])) aAncestors.shift();

  return aAncestors[0];
}

function narrowestDomain(a: DomainLiteral, b: DomainLiteral): DomainLiteral {
  const aAncestors = [a, ...ancestors(a)];
  const bAncestors = [b, ...ancestors(b)];

  while (!bAncestors.includes(aAncestors[0])) bAncestors.shift();

  return bAncestors[0];
}

export function narrow(
  a: BoxedDomain | undefined,
  b: BoxedDomain | undefined
): BoxedDomain {
  if (a === undefined) return b!;
  if (b === undefined) return a;
  const aLiteral = domainLiteralAncestor(a);
  const bLiteral = domainLiteralAncestor(b);
  if (isSubdomainOf1(aLiteral, bLiteral)) return a;
  if (isSubdomainOf1(bLiteral, aLiteral)) return b;
  return a.engine.domain('Void');
}

// Return the domain literal that is the closest ancestor to `dom`
function domainLiteralAncestor(dom: BoxedDomain): DomainLiteral {
  if (dom.base) return dom.base;

  const ctor = dom.ctor!;

  if (ctor === 'OptArg') return 'Anything';
  if (ctor === 'Head') return 'Functions';

  if (ctor === 'Union') {
    // Calculate the widest domain that is a subdomain of all the domains
    // in the union
    const args = dom.domainArgs!;
    let result = args[0] as DomainLiteral;
    for (let i = 1; i <= args.length - 1; i++) {
      result = widestDomain(result, args[i] as DomainLiteral);
    }
    return result;
  }
  if (ctor === 'Intersection') {
    // Calculate the narrowest domain that is a superdomain of all the domains
    // in the intersection
    const args = dom.domainArgs!;
    let result = args[0] as DomainLiteral;
    for (let i = 1; i <= args.length - 1; i++) {
      result = narrowestDomain(result, args[i] as DomainLiteral);
    }
    return result;
  }

  return 'Anything';
}

function serialize(
  ce: IComputeEngine,
  dom: DomainExpression<BoxedExpression>
): Expression {
  if (dom instanceof _BoxedExpression) return dom.json;
  if (typeof dom === 'string') return dom;

  if (dom[0] === 'InvalidDomain') {
    return ['InvalidDomain', serialize(ce, dom[1] as DomainLiteral)];
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
