import { BoxedType } from '../common/type/boxed-type';
import type { MathJsonSymbol } from '../math-json/types';

import { box, formToInternal } from './boxed-expression/box';
import { isOperatorDef, isValueDef } from './boxed-expression/utils';
import type {
  IComputeEngine as ComputeEngine,
  BoxedExpression,
} from './global-types';
import { parse } from './latex-syntax/parse';
import type { LatexString, ParseLatexOptions } from './latex-syntax/types';
import { asLatexString } from './latex-syntax/utils';
import type { FormOption } from './types-serialization';

export type ParseEntrypointOptions = Partial<ParseLatexOptions> & {
  form?: FormOption;
};

function symbolType(
  engine: ComputeEngine,
  id: MathJsonSymbol
): ReturnType<NonNullable<ParseLatexOptions['getSymbolType']>> {
  const def = engine.lookupDefinition(id);
  if (!def) return BoxedType.unknown;
  if (isOperatorDef(def)) return def.operator.signature;
  if (isValueDef(def)) return def.value.type;
  return BoxedType.unknown;
}

function hasSubscriptEvaluate(
  engine: ComputeEngine,
  id: MathJsonSymbol
): boolean {
  const def = engine.lookupDefinition(id);
  return !!(isValueDef(def) && def.value.subscriptEvaluate);
}

export function parseLatexEntrypoint(
  engine: ComputeEngine,
  latex: LatexString | null,
  options?: ParseEntrypointOptions
): BoxedExpression | null {
  if (latex === null || latex === undefined) return null;
  if (typeof latex !== 'string')
    throw Error('ce.parse(): expected a LaTeX string');

  const defaultOptions: ParseLatexOptions = {
    imaginaryUnit: '\\imaginaryI',

    positiveInfinity: '\\infty',
    negativeInfinity: '-\\infty',
    notANumber: '\\operatorname{NaN}',

    decimalSeparator: engine.decimalSeparator,

    digitGroup: 3,
    digitGroupSeparator: '\\,', // for thousands, etc...

    exponentProduct: '\\cdot',
    beginExponentMarker: '10^{', // could be 'e'
    endExponentMarker: '}',

    truncationMarker: '\\ldots',

    repeatingDecimal: 'auto', // auto will accept any notation

    strict: true,
    skipSpace: true,
    parseNumbers: 'auto',
    getSymbolType: (id) => symbolType(engine, id),
    hasSubscriptEvaluate: (id) => hasSubscriptEvaluate(engine, id),
    parseUnexpectedToken: (_lhs, _parser) => null,
    preserveLatex: false,
    quantifierScope: 'tight',
    timeDerivativeVariable: 't',
  };

  const result = parse(
    asLatexString(latex) ?? latex,
    engine._indexedLatexDictionary,
    { ...defaultOptions, ...options }
  );
  if (result === null) throw Error('Failed to parse LaTeX string');

  const { canonical } = formToInternal(options?.form);
  return box(engine, result, { canonical });
}
