import { BoxedNumber } from './boxed-expression/boxed-number';
import {
  type CommonSymbolTable,
  initializeCommonSymbols,
} from './engine-common-symbols';
import {
  collectLibraryLatexEntries,
  loadLibraryDefinitions,
  resolveBootstrapLibraries,
} from './engine-library-bootstrap';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  LibraryDefinition,
} from './global-types';

export type CommonNumberBindings = {
  Zero: Expression;
  One: Expression;
  Half: Expression;
  NegativeOne: Expression;
  Two: Expression;
  I: Expression;
  NaN: Expression;
  PositiveInfinity: Expression;
  NegativeInfinity: Expression;
  ComplexInfinity: Expression;
};

export type CommonSymbolBindings = {
  True: Expression;
  False: Expression;
  Pi: Expression;
  E: Expression;
  Nothing: Expression;
};

function expectCommonSymbol(
  commonSymbols: CommonSymbolTable,
  name: string
): Expression {
  const result = commonSymbols[name];
  if (!result) throw new Error(`Common symbol "${name}" failed to initialize`);
  return result;
}

export class EngineStartupCoordinator {
  constructor(private readonly engine: ComputeEngine) {}

  initializeCommonNumbers(): CommonNumberBindings {
    return {
      Zero: new BoxedNumber(this.engine, 0),
      One: new BoxedNumber(this.engine, 1),
      Half: new BoxedNumber(this.engine, { rational: [1, 2] }),
      NegativeOne: new BoxedNumber(this.engine, -1),
      Two: new BoxedNumber(this.engine, 2),
      NaN: new BoxedNumber(this.engine, Number.NaN),
      PositiveInfinity: new BoxedNumber(this.engine, Number.POSITIVE_INFINITY),
      NegativeInfinity: new BoxedNumber(this.engine, Number.NEGATIVE_INFINITY),
      I: new BoxedNumber(this.engine, { im: 1 }),
      ComplexInfinity: new BoxedNumber(this.engine, {
        re: Infinity,
        im: Infinity,
      }),
    };
  }

  bootstrapLibraries(
    libraries?: readonly (string | LibraryDefinition)[]
  ): void {
    const resolved = resolveBootstrapLibraries(libraries);
    loadLibraryDefinitions(this.engine, resolved);

    const latexEntries = collectLibraryLatexEntries(resolved);
    if (latexEntries.length > 0) this.engine.latexDictionary = latexEntries;
  }

  initializeCommonSymbolBindings(
    commonSymbols: CommonSymbolTable
  ): CommonSymbolBindings {
    initializeCommonSymbols(this.engine, commonSymbols);
    return {
      True: expectCommonSymbol(commonSymbols, 'True'),
      False: expectCommonSymbol(commonSymbols, 'False'),
      Pi: expectCommonSymbol(commonSymbols, 'Pi'),
      E: expectCommonSymbol(commonSymbols, 'ExponentialE'),
      Nothing: expectCommonSymbol(commonSymbols, 'Nothing'),
    };
  }
}
