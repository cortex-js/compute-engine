import { BoxedSymbol } from './boxed-expression/boxed-symbol.js';

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from './global-types.js';

export type CommonSymbolTable = {
  [symbol: string]: null | Expression;
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
    // No environment: an interned symbol is shared by all expressions, and
    // its type is explicit, so no use writes a requirement on it.
    commonSymbols[symbol] = new BoxedSymbol(engine, symbol, {
      def: lookupDefinition(engine, symbol),
      env: undefined,
    });
  }
}

export function resetCommonSymbols(commonSymbols: CommonSymbolTable): void {
  for (const symbol of Object.values(commonSymbols)) symbol?._reset();
}
