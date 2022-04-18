import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  Domain,
  DomainExpression,
  IComputeEngine,
  Metadata,
  PatternMatchOption,
  Substitution,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { serializeJsonSymbol } from './serialize';
import { hashCode } from './utils';

export class _Domain extends AbstractBoxedExpression implements Domain {
  _value: DomainExpression;
  private _hash: number;

  constructor(ce: IComputeEngine, dom: DomainExpression, metadata?: Metadata) {
    super(ce, metadata);
    this._value = dom;
  }

  get domainExpression(): DomainExpression {
    return this._value;
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hash(this._value);
    return this._hash;
  }

  get isCanonical(): boolean {
    return true;
  }

  isEqual(rhs: BoxedExpression): boolean {
    return false; // @todo
  }

  isSame(rhs: BoxedExpression): boolean {
    return false; // @todo
  }

  isSubdomainOf(rhs: _Domain | string): boolean {
    return isSubdomainOf(this, rhs);
  }

  isMemberOf(expr: BoxedExpression): boolean {
    // @todo
    return false;
  }

  get json(): Expression {
    // @todo
    if (typeof this._value === 'string') {
      return serializeJsonSymbol(this.engine, this._value, {
        wikidata: this._wikidata,
      });
    }
    return ['Domain', this._value];
  }

  match(
    rhs: BoxedExpression,
    _options?: PatternMatchOption
  ): Substitution | null {
    if (rhs instanceof _Domain && this.isSame(rhs)) return {};
    return null;
  }

  get head(): string {
    return 'Domain';
  }
  get domain(): Domain {
    return this.engine.domain('Domain');
  }
  get codomain(): Domain | null {
    if (typeof this._value === 'string') return null;
    if (this._value[0] !== 'Function') return null;
    return this.engine.domain(this._value[this._value.length - 1]);
  }
  is(rhs: BoxedExpression): boolean {
    return this.isSame(rhs);
  }
  get isNothing(): boolean {
    return this._value === 'Nothing';
  }
  get isFunction(): boolean {
    if (typeof this._value === 'string') return false;
    return this._value[0] === 'Function';
  }
  get isPredicate(): boolean {
    if (typeof this._value === 'string') return false;
    if (this._value[0] !== 'Function') return false;
    const resultDomain = this._value[this._value.length];
    if (!(resultDomain instanceof _Domain)) return false;
    return resultDomain.isBoolean;
  }
  get isNumericFunction(): boolean {
    if (typeof this._value === 'string') return false;
    if (this._value[0] !== 'Function') return false;
    for (const arg of this._value) {
      if (!isNumericSubdomain(arg, 'Number')) return false;
    }
    return true;
  }
  get isBoolean(): boolean {
    return isBooleanDomain(this._value);
  }
  get isRealFunction(): boolean {
    if (typeof this._value === 'string') return false;
    if (this._value[0] !== 'Function') return false;
    for (const arg of this._value) {
      if (!isNumericSubdomain(arg, 'ExtendedRealNumber')) return false;
    }
    return true;
  }
  get isNumeric(): boolean {
    return this.isSubdomainOf('Number');
  }
  get isLogicOperator(): boolean {
    if (typeof this._value === 'string') return false;
    if (this._value[0] !== 'Function') return false;
    if (this._value.length < 2 || this._value.length > 3) return false;
    const resultDomain = this._value[this._value.length - 1];
    if (!isBooleanDomain(resultDomain)) return false;
    const op1 = this._value[1];
    if (!isBooleanDomain(op1)) return false;
    if (this._value.length !== 3) return true;

    const op2 = this._value[2];
    if (!isBooleanDomain(op2)) return false;
    return true;
  }
  get isRelationalOperator(): boolean {
    if (typeof this._value === 'string') return false;
    if (this._value[0] !== 'Function') return false;
    if (this._value.length !== 3) return false;
    const resultDomain = this._value[this._value.length - 1];
    if (!isBooleanDomain(resultDomain)) return false;

    return true;
  }
}

function isSubdomainOf(
  inLhs: _Domain | BoxedExpression,
  inRhs: _Domain | BoxedExpression | string
): boolean {
  const rhs = inRhs instanceof _Domain ? inRhs._value : inRhs;
  const lhs = inLhs instanceof _Domain ? inLhs._value : inLhs;

  if (typeof lhs === 'string' && typeof rhs === 'string') {
    const result = isNumericSubdomain(lhs, rhs);
    if (typeof result === 'boolean') return result;
  }

  return true; // @todo

  // // If inRhs is a signature or modifier...
  // if (typeof rhs !== 'string' && typeof rhs.head === 'string') {
  //   const h = rhs.head;

  //   if (h === 'Union') {
  //     // If any of the members of the union match, it's a match
  //     for (const arg of rhs.ops!) {
  //       if (arg instanceof _Domain) {
  //         if (this.isSubdomainOf(arg)) return true;
  //       } else if (this.isSame(arg)) return true;
  //     }
  //     return false;
  //   }

  //   if (
  //     [
  //       'FunctionSignature',
  //       'TupleSignature',
  //       'RecordSignature',
  //       'ListSignature',
  //     ].includes(h)
  //   ) {
  //     // Check if each argument matches
  //     let il = 0;
  //     let ir = 0;
  //     let match = true;
  //     while (match && il < this.nops && ir < rhs.nops) {
  //       const argl = this.ops![il];
  //       const argr = rhs.ops![ir];
  //       if (argl.head === 'Optional') {
  //         if (argl.op1.isSubdomainOf(argr)) ir += 1;
  //       } else if (argl.head === 'Some') {
  //         if (!argl.op1.isSubdomainOf(argr)) {
  //           match = false;
  //         } else {
  //           while (argl.op1.isSubdomainOf(argr)) {
  //             ir += 1;
  //           }
  //         }
  //       } else if (argl.head === 'Head') {
  //         match = (argl.op1.symbol ?? argl.op1.string) === argr.head;
  //         ir += 1;
  //       } else if (argl.head === 'Symbol') {
  //         match = (argl.op1.symbol ?? argl.op1.string) === argr.symbol;
  //         ir += 1;
  //       } else {
  //         if (argl instanceof _Domain) match = argl.isSubdomainOf(argr);
  //         else match = argl.isSame(argr);
  //         ir += 1;
  //       }
  //       il += 1;
  //     }
  //     return match && il === rhs.nops;
  //   }
  // }

  // // Check for structural equality...
  // if (typeof rhs === 'string') return this._value === rhs;
  // return this.isSame(rhs);

  // return false;
}

/**
 * Note that `boxDomain()` should only be called from `ComputeEngine`
 */

export function boxDomain(
  ce: IComputeEngine,
  dom: Domain | DomainExpression,
  metadata?: Metadata
): Domain {
  if (dom instanceof _Domain) return dom;
  let result: Domain | undefined;
  if (!result && typeof dom === 'string') {
    const expr = {
      Function: ['Function', ['Optional', ['Some', 'Anything']], 'Anything'],
      NumericFunction: ['Function', ['Optional', ['Some', 'Number']], 'Number'],
      RealFunction: [
        'Function',
        ['Optional', ['Some', 'ExtendedRealNumber']],
        'ExtendedRealNumber',
      ],
      TrigonometricFunction: ['Function', 'Number', 'Number'],
      HyperbolicFunction: ['Function', 'Number', 'Number'],
      LogicOperator: [
        'Function',
        'MaybeBoolean',
        ['Optional', 'MaybeBoolean'],
        'MaybeBoolean',
      ],
      Predicate: [
        'Function',
        ['Optional', ['Some', 'Anything']],
        'MaybeBoolean',
      ],
      RelationalOperator: ['Function', 'Anything', 'Anything', 'MaybeBoolean'],
    }[dom] as DomainExpression | undefined;
    if (expr) result = new _Domain(ce, expr, metadata);
  }
  if (!result) result = new _Domain(ce, dom as DomainExpression, metadata);
  return result;
}

/** Return true if `lhs` is a numeric subdomain (or equal to) `rhs`
 */
function isNumericSubdomain(
  lhs: DomainExpression,
  rhs: string
): boolean | undefined {
  if (typeof lhs !== 'string') return false;
  return (
    {
      Number: [
        'Number',
        'ExtendedComplexNumber',
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ExtendedComplexNumber: [
        'Number', // Since `Number` and `ComplexNumber` are synonyms
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ExtendedRealNumber: [
        'ExtendedRealNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ComplexNumber: ['ComplexNumber', 'ImaginaryNumber'],
      ImaginaryNumber: ['ImaginaryNumber'],
      RealNumber: [
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      TranscendentalNumber: ['TranscendentalNumber'],
      AlgebraicNumber: [
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      RationalNumber: [
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      Integer: [
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      NegativeNumber: ['NegativeNumber', 'NegativeInteger'],
      NonNegativeNumber: [
        'NonNegativeNumber',
        'PositiveNumber',
        'NonNegativeInteger',
        'PositiveInteger',
      ],
      NonPositiveNumber: [
        'NonPositiveNumber',
        'NegativeNumber',
        'NegativeInteger',
      ],
      PositiveNumber: ['PositiveNumber', 'PositiveInteger'],

      NegativeInteger: ['NegativeInteger'],
      PositiveInteger: ['PositiveInteger'],
      NonNegativeInteger: ['NonNegativeInteger', 'PositiveInteger'],
      NonPositiveInteger: ['NegativeInteger'],
    }[rhs]?.includes(lhs) ?? undefined
  );
}

function isBooleanDomain(dom: DomainExpression): boolean {
  if (typeof dom !== 'string') return false;
  return ['Boolean', 'MaybeBoolean', 'True', 'False', 'Maybe'].includes(dom);
}

function hash(dom: DomainExpression): number {
  if (typeof dom === 'string') return hashCode('domain:' + dom);
  let s = '';
  for (const arg of dom) s += '' + hash(arg);
  return hashCode(s);
}
