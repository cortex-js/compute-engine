import type { SymbolDefinitions, Expression } from '../global-types';
import { isSymbol, isString, isFunction } from '../boxed-expression/type-guards';
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
export function boxedToUnitExpression(expr: Expression): UnitExpression | null {
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
    lazy: true,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');

      // Canonicalize the magnitude (first arg) but leave the unit as-is
      const mag = args[0].canonical;

      // If the second argument is a string containing DSL operators,
      // parse it into a structured MathJSON unit expression.
      const unitArg = args[1];
      if (isString(unitArg) && /[/*^()]/.test(unitArg.string)) {
        const parsed = parseUnitDSL(unitArg.string);
        if (typeof parsed !== 'string') {
          const boxed = ce.box(parsed as any);
          return ce._fn('Quantity', [mag, boxed]);
        }
      }

      return ce._fn('Quantity', [mag, unitArg.canonical]);
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
    lazy: true,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');
      // Canonicalize the quantity (first arg) but leave the target unit as-is
      return ce._fn('UnitConvert', [args[0].canonical, args[1].canonical]);
    },
    evaluate: (ops, { engine: ce }) => {
      if (!ce) return undefined;
      const quantity = ops[0]?.evaluate();
      const targetUnitExpr = ops[1];
      if (!quantity || !isFunction(quantity) || quantity.operator !== 'Quantity')
        return undefined;

      const mag = quantity.op1.re;
      if (mag === undefined) return undefined;

      // Try simple symbol-based conversion first
      const fromUnit = quantity.op2;
      const fromSymbol = isSymbol(fromUnit) ? fromUnit.symbol : null;
      const toSymbol = isSymbol(targetUnitExpr) ? targetUnitExpr.symbol : null;

      if (fromSymbol && toSymbol) {
        const converted = convertUnit(mag, fromSymbol, toSymbol);
        if (converted !== null)
          return ce._fn('Quantity', [
            ce.number(converted),
            ce.symbol(toSymbol),
          ]);
        // If conversion returned null, units are incompatible
        return ce.error('incompatible-type');
      }

      // Fall back to compound unit conversion
      const fromUE = boxedToUnitExpression(fromUnit);
      const toUE = boxedToUnitExpression(targetUnitExpr);
      if (!fromUE || !toUE) return undefined;

      const converted = convertCompoundUnit(mag, fromUE, toUE);
      if (converted === null) return ce.error('incompatible-type');

      return ce._fn('Quantity', [ce.number(converted), targetUnitExpr]);
    },
  },

  UnitSimplify: {
    description: 'Simplify a quantity unit to a named derived unit if possible',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0]?.evaluate();
      if (!arg || !isFunction(arg) || arg.operator !== 'Quantity') return arg;

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

  IsCompatibleUnit: {
    description: 'Check if two units have the same dimension',
    complexity: 1200,
    lazy: true,
    signature: '(value, value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce.error('incompatible-type');
      // Don't canonicalize unit arguments — they may be symbols like 'N'
      // that conflict with function definitions
      return ce._fn('IsCompatibleUnit', args);
    },
    evaluate: (ops, { engine: ce }) => {
      // Support both simple symbols and compound unit expressions
      const aUE = boxedToUnitExpression(ops[0]);
      const bUE = boxedToUnitExpression(ops[1]);
      if (!aUE || !bUE) return undefined;

      const da = getExpressionDimension(aUE);
      const db = getExpressionDimension(bUE);
      if (!da || !db) return undefined;

      const compatible = da.every((v, i) => v === db[i]);
      return ce.symbol(compatible ? 'True' : 'False');
    },
  },

  UnitDimension: {
    description: 'Return the dimension vector of a unit',
    complexity: 1200,
    lazy: true,
    signature: '(value) -> value',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 1) return ce.error('incompatible-type');
      // Don't canonicalize unit argument — same reason as IsCompatibleUnit
      return ce._fn('UnitDimension', args);
    },
    evaluate: (ops, { engine: ce }) => {
      // Support both simple symbols and compound unit expressions
      const ue = boxedToUnitExpression(ops[0]);
      if (!ue) return undefined;

      const dim = getExpressionDimension(ue);
      if (!dim) return undefined;

      return ce._fn('List', dim.map((d) => ce.number(d)));
    },
  },
};
