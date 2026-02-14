import type { SymbolDefinitions } from '../global-types';

export const UNITS_LIBRARY: SymbolDefinitions = {
  Quantity: {
    description: 'A value paired with a physical unit',
    wikidata: 'Q309314',
    complexity: 1200,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');
      return ce._fn('Quantity', args);
    },
    evaluate: (ops, { engine: ce }) => {
      return ce._fn('Quantity', [...ops]);
    },
  },

  QuantityMagnitude: {
    description: 'Extract the numeric value from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (arg?.operator === 'Quantity') return arg.op1;
      return undefined;
    },
  },

  QuantityUnit: {
    description: 'Extract the unit from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (arg?.operator === 'Quantity') return arg.op2;
      return undefined;
    },
  },
};
