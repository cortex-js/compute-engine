import type { SymbolDefinitions, Expression } from '../global-types';
import { isSymbol, isFunction } from '../boxed-expression/type-guards';
import {
  convertUnit,
  convertCompoundUnit,
  parseUnitDSL,
  getUnitDimension,
  getUnitScale,
  areCompatibleUnits,
  getExpressionDimension,
  getExpressionScale,
  findNamedUnit,
  type UnitExpression,
} from './unit-data';

/**
 * Convert a boxed expression representing a unit into a plain
 * `UnitExpression` (string or JSON array) that `unit-data.ts` functions
 * can work with.
 */
function boxedToUnitExpression(expr: Expression): UnitExpression | null {
  if (!expr) return null;

  // Simple symbol unit
  if (isSymbol(expr)) return expr.symbol;

  const op = expr.operator;
  if (!op || !isFunction(expr)) return null;

  if (op === 'Multiply') {
    const parts: UnitExpression[] = [];
    for (const child of expr.ops) {
      const c = boxedToUnitExpression(child);
      if (!c) return null;
      parts.push(c);
    }
    return ['Multiply', ...parts];
  }

  if (op === 'Divide') {
    const a = boxedToUnitExpression(expr.op1);
    const b = boxedToUnitExpression(expr.op2);
    if (!a || !b) return null;
    return ['Divide', a, b];
  }

  if (op === 'Power') {
    const base = boxedToUnitExpression(expr.op1);
    const exp = expr.op2?.re;
    if (!base || exp === undefined) return null;
    return ['Power', base, exp];
  }

  return null;
}

export const UNITS_LIBRARY: SymbolDefinitions = {
  // Internal marker produced by the \mathrm/\text expression handler in
  // definitions-units.ts.  When juxtaposed with a number the
  // InvisibleOperator canonical detects this wrapper and produces
  // ['Quantity', number, unit].  If the marker reaches canonicalization
  // without InvisibleOperator (e.g. standalone `\mathrm{cm}`), unwrap it
  // to just the unit expression.
  __unit__: {
    signature: '(value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length === 1) return args[0].canonical;
      return ce.error('incompatible-type');
    },
  },

  Quantity: {
    description: 'A value paired with a physical unit',
    wikidata: 'Q309314',
    complexity: 1200,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');

      // If the second argument is a string containing DSL operators,
      // parse it into a structured MathJSON unit expression.
      const unitArg = args[1];
      if (unitArg.string && /[/*^]/.test(unitArg.string)) {
        const parsed = parseUnitDSL(unitArg.string);
        if (typeof parsed !== 'string') {
          const boxed = ce.box(parsed as any);
          return ce._fn('Quantity', [args[0], boxed]);
        }
      }

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

  UnitConvert: {
    description: 'Convert a quantity to a different compatible unit',
    complexity: 1200,
    signature: '(value, value) -> value',
    evaluate: (ops, { engine: ce }) => {
      if (!ce) return undefined;
      const quantity = ops[0]?.evaluate();
      const targetUnitExpr = ops[1];
      if (!quantity || quantity.operator !== 'Quantity') return undefined;

      const mag = quantity.op1.re;
      if (mag === undefined) return undefined;

      // Try simple symbol-based conversion first
      const fromSymbol = quantity.op2?.symbol;
      const toSymbol = targetUnitExpr?.symbol;

      if (fromSymbol && toSymbol) {
        const converted = convertUnit(mag, fromSymbol, toSymbol);
        if (converted !== null)
          return ce._fn('Quantity', [
            ce.number(converted),
            ce.symbol(toSymbol),
          ]);
      }

      // Fall back to compound unit conversion
      const fromUE = boxedToUnitExpression(quantity.op2);
      const toUE = boxedToUnitExpression(targetUnitExpr);
      if (!fromUE || !toUE) return undefined;

      const converted = convertCompoundUnit(mag, fromUE, toUE);
      if (converted === null) return undefined;

      return ce._fn('Quantity', [ce.number(converted), targetUnitExpr]);
    },
  },

  UnitSimplify: {
    description: 'Simplify a quantity unit to a named derived unit if possible',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0]?.evaluate();
      if (!arg || arg.operator !== 'Quantity') return arg;

      const mag = arg.op1.re;
      const unitExpr = arg.op2;

      // Get the unit expression as a UnitExpression for dimension calculation
      const ue = boxedToUnitExpression(unitExpr);
      if (!ue) return arg;

      // Compute dimension vector of the compound unit
      const dim = getExpressionDimension(ue);
      if (!dim) return arg;

      // Search named derived units for a matching dimension with scale=1
      const match = findNamedUnit(dim);
      if (!match) return arg;

      // Adjust magnitude for scale difference
      const scale = getExpressionScale(ue);
      if (scale === null) return arg;
      const matchScale = getUnitScale(match);
      if (matchScale === null) return arg;
      const newMag = (mag * scale) / matchScale;

      return ce._fn('Quantity', [ce.number(newMag), ce.symbol(match)]);
    },
  },

  CompatibleUnitQ: {
    description: 'Check if two units have the same dimension',
    complexity: 1200,
    signature: '(value, value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const a = ops[0]?.symbol;
      const b = ops[1]?.symbol;
      if (!a || !b) return undefined;

      const result = areCompatibleUnits(a, b);
      return ce.symbol(result ? 'True' : 'False');
    },
  },

  UnitDimension: {
    description: 'Return the dimension vector of a unit',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const sym = ops[0]?.symbol;
      if (!sym) return undefined;

      const dim = getUnitDimension(sym);
      if (!dim) return undefined;

      return ce._fn('List', dim.map((d) => ce.number(d)));
    },
  },
};
