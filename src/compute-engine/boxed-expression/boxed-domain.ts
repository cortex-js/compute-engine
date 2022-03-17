import { BoxedSymbol } from './boxed-symbol';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';

export class Domain extends BoxedSymbol {
  constructor(ce: IComputeEngine, dom: string, metadata?: Metadata) {
    super(ce, dom, metadata);
  }
  get head(): string {
    return 'Domain';
  }
  get domain(): BoxedExpression {
    return this.engine.domain('Domain');
  }
  isSubsetOf(dom: BoxedExpression | string): boolean {
    return (
      isNumericSubdomain(
        this._name,
        typeof dom === 'string' ? dom : dom.symbol ?? ''
      ) ?? false
    );
  }
}

/** Return true if lhs is a numeric subdomain (or equal to) rhs
 */
function isNumericSubdomain(lhs: string, rhs: string): boolean | undefined {
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
