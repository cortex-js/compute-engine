import { BoxedSymbol } from './boxed-expression/boxed-symbol';

import type {
  BoxedDefinition,
  BoxedExpression,
  IComputeEngine as ComputeEngine,
} from './global-types';

export type CommonSymbolTable = {
  [symbol: string]: null | BoxedExpression;
};

function lookupDefinition(
  engine: ComputeEngine,
  symbol: string
): BoxedDefinition | undefined {
  return engine.lookupDefinition(symbol);
}

export function initializeCommonSymbols(
  engine: ComputeEngine,
  commonSymbols: CommonSymbolTable
): void {
  for (const symbol of Object.keys(commonSymbols)) {
    commonSymbols[symbol] = new BoxedSymbol(engine, symbol, {
      def: lookupDefinition(engine, symbol),
    });
  }
}

export function resetCommonSymbols(commonSymbols: CommonSymbolTable): void {
  for (const symbol of Object.values(commonSymbols)) symbol?.reset();
}
