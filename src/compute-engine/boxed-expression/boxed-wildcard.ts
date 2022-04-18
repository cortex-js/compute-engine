import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  SimplifyOptions,
  Metadata,
  Substitution,
  PatternMatchOption,
  Domain,
} from '../public';
import { serializeJsonSymbol } from './serialize';
import { BoxedSymbol } from './boxed-symbol';

/**
 * BoxedWildcard
 *
 * A boxed is a symbol that is used as a wildcard. The name of the
 * symbol begins with a `_`.
 */

export class BoxedWildcard extends BoxedSymbol {
  private _conditions: string[];
  private _head: string;
  private _minValue: number; //  an integer
  private _maxValue: number; // an integer
  private _repeatMin: number;
  private _repeatMax: number;

  constructor(ce: IComputeEngine, name: string, metadata?: Metadata) {
    const segments = name.split(':');
    super(ce, segments[0], metadata);
    if (name.startsWith('___')) {
      this._repeatMin = 0;
      this._repeatMax = +Infinity;
    } else if (name.startsWith('__')) {
      this._repeatMin = 1;
      this._repeatMax = +Infinity;
    } else {
      this._repeatMin = 1;
      this._repeatMax = 1;
    }
    for (let segment of segments) {
      segment =
        {
          '>0': 'positive',
          '<=0': 'nonPositive',
          '<0': 'negative',
          '>=0': 'nonNegative',
          '=0': 'zero',
          '!=0': 'notZero',
          '=1': 'one',
          '=-1': 'negativeOne',
          'Z': 'integer',
          'Q': 'rational',
          'R': 'real',
          'C': 'complex',
        }[segment] ?? segment;
      if (
        [
          'number',
          'integer',
          'rational',
          'algebraic',
          'real',
          'extendedReal',
          'complex',
          'extendedComplex',
          'imaginary',
          'positive',
          'nonPositive',
          'negative',
          'nonNegative',
          'zero',
          'notZero',
          'one',
          'negativeOne',
          'infinity',
          'NaN',
          'finite',
          'odd',
          'even',
          'prime',
          'composite',
        ].includes(segment)
      ) {
        this._conditions.push(segment);
      } else {
        this._head = segment;
      }
    }
  }

  get head(): string {
    return 'Wildcard';
  }

  get domain(): Domain {
    return this.engine.domain('Anything'); // @todo
  }

  get json(): Expression {
    return serializeJsonSymbol(this.engine, this._name, {
      wikidata: this._wikidata,
    });
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    if (this._conditions.includes('positive')) return +1;
    if (this._conditions.includes('negative')) return -1;
    if (this._conditions.includes('zero')) return 0;

    return undefined;
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOption
  ): Substitution | null {
    return null; // @todo
  }

  isSame(rhs: BoxedExpression): boolean {
    if (!(rhs instanceof BoxedWildcard)) return false;
    return this._name === rhs._name;
  }

  isEqual(rhs: BoxedExpression): boolean {
    return this.isSame(rhs);
  }

  isLess(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s < 0;
    }

    // @todo: could check additional conditions

    return undefined;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s <= 0;
    }
    //  @todo Check assumptions, use range

    return this.isLess(rhs) || this.isEqual(rhs);
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s > 0;
    }

    // @todo: could check additional conditions
    //  let x = assumeSymbolValue(this._engine, this._symbol, 'Less');

    return undefined;
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s >= 0;
    }
    // @todo: could check additional conditions

    return this.isGreater(rhs) || this.isEqual(rhs);
  }

  get isZero(): boolean | undefined {
    return (
      this._conditions.includes('zero') || !this._conditions.includes('notZero')
    );
  }

  get isNotZero(): boolean | undefined {
    return (
      this._conditions.includes('notZero') || !this._conditions.includes('zero')
    );
  }

  get isOne(): boolean | undefined {
    return this._conditions.includes('one');
  }

  get isNegativeOne(): boolean | undefined {
    return this._conditions.includes('negativeOne');
  }

  get isOdd(): boolean | undefined {
    return this._conditions.includes('odd');
  }

  get isEven(): boolean | undefined {
    return this._conditions.includes('even');
  }

  get isPrime(): boolean | undefined {
    return this._conditions.includes('prime');
  }

  get isComposite(): boolean | undefined {
    return this._conditions.includes('composite');
  }

  get isInfinity(): boolean | undefined {
    return this._conditions.includes('infinity');
  }
  get isNaN(): boolean | undefined {
    return this._conditions.includes('NaN');
  }
  // x > 0
  get isPositive(): boolean | undefined {
    return this._conditions.includes('positive');
  }
  get isNonPositive(): boolean | undefined {
    return this._conditions.includes('nonPositive');
  }
  get isNegative(): boolean | undefined {
    return this._conditions.includes('negative');
  }
  get isNonNegative(): boolean | undefined {
    return this._conditions.includes('nonNegative');
  }
  get isNumber(): boolean | undefined {
    return this._conditions.includes('number');
  }
  get isInteger(): boolean | undefined {
    return this._conditions.includes('integer');
  }
  get isRational(): boolean | undefined {
    return this._conditions.includes('rational');
  }
  get isAlgebraic(): boolean | undefined {
    return this._conditions.includes('algebraic');
  }
  get isReal(): boolean | undefined {
    return this._conditions.includes('real');
  }
  get isExtendedReal(): boolean | undefined {
    return this._conditions.includes('extendedReal');
  }
  get isComplex(): boolean | undefined {
    return this._conditions.includes('complex');
  }
  get isImaginary(): boolean | undefined {
    return this._conditions.includes('imaginary');
  }

  get canonical(): BoxedExpression {
    return this;
  }

  simplify(_options?: SimplifyOptions): BoxedExpression {
    return this;
  }

  evaluate(_options?: EvaluateOptions): BoxedExpression {
    return this;
  }

  N(_options?: NOptions): BoxedExpression {
    return this;
  }
}
