import type {
  SymbolDefinitions,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { runWithEvaluationEffects } from '../effects-registry.js';
import { awaitedOperandOptions } from '../boxed-expression/utils.js';
import {
  isSymbol,
  isString,
  isFunction,
  isNumber,
} from '../boxed-expression/type-guards.js';
import {
  convertUnit,
  convertCompoundUnit,
  dimensionsEqual,
  parseUnitDSL,
  getExpressionDimension,
  getExpressionScale,
  findNamedUnit,
  type UnitExpression,
} from './unit-data.js';
import { isMeasurement, measurementAffine } from './measurement-arithmetic.js';

/**
 * Convert a boxed expression representing a unit into a plain
 * `UnitExpression` (string or JSON array) that `unit-data.ts` functions
 * can work with.
 */
export function boxedToUnitExpression(expr: Expression): UnitExpression | null {
  if (!expr) return null;

  // Simple symbol unit
  if (isSymbol(expr)) return expr.symbol;

  if (!isFunction(expr)) return null;

  const op = expr.operator;
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
    // A reciprocal unit such as `s^-1` is boxed as `Divide(1, s)`. The `1`
    // is not a unit, so read it as the unit with exponent -1.
    if (expr.op1.isSame(1)) {
      const b = boxedToUnitExpression(expr.op2);
      return b ? ['Power', b, -1] : null;
    }
    const a = boxedToUnitExpression(expr.op1);
    const b = boxedToUnitExpression(expr.op2);
    if (!a || !b) return null;
    return ['Divide', a, b];
  }

  if (op === 'Power') {
    const base = boxedToUnitExpression(expr.op1);
    const exp = expr.op2?.re;
    // A symbolic exponent (`m^n`) has no numeric value: `.re` is `NaN`.
    if (!base || exp === undefined || Number.isNaN(exp)) return null;
    return ['Power', base, exp];
  }

  return null;
}

/**
 * True when an operand or a magnitude of quantity arithmetic has no numeric
 * value, for example a free symbol `x` or a product `3x` that contains one.
 * Its `.re` is `NaN`, so numeric arithmetic cannot use it. Such a value goes
 * through the expression arithmetic of the `Measurement` branches instead,
 * which keeps it symbolic: `Quantity(3, m) · x` is `Quantity(3x, m)`. A
 * number literal `NaN` is a numeric value and stays on the numeric branch.
 */
export function isSymbolicValue(x: Expression): boolean {
  if (isMeasurement(x) || isFunction(x, 'Quantity') || isNumber(x))
    return false;
  return Number.isNaN(x.re);
}

/**
 * The conversion of the evaluated `quantity` to the unit `targetUnitExpr`,
 * shared by the synchronous and the asynchronous `UnitConvert` handlers.
 */
function convertQuantity(
  ce: ComputeEngine,
  quantity: Expression | undefined,
  targetUnitExpr: Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!quantity || !isFunction(quantity) || quantity.operator !== 'Quantity')
    return undefined;

  // A Measurement magnitude scales (nominal and error) by the conversion
  // factor; unit conversion is affine, so the linear factor is
  // `convert(1) − convert(0)` and the offset shifts the nominal only. A
  // symbolic magnitude is converted with the same expression arithmetic.
  const magExpr = quantity.op1;
  const magIsMeasurement = isMeasurement(magExpr) || isSymbolicValue(magExpr);
  const mag = magExpr.re;
  if (!magIsMeasurement && mag === undefined) return undefined;

  // Try simple symbol-based conversion first
  const fromUnit = quantity.op2;
  const fromSymbol = isSymbol(fromUnit) ? fromUnit.symbol : null;
  const toSymbol = isSymbol(targetUnitExpr) ? targetUnitExpr.symbol : null;

  if (fromSymbol && toSymbol) {
    if (magIsMeasurement) {
      const c0 = convertUnit(0, fromSymbol, toSymbol);
      const c1 = convertUnit(1, fromSymbol, toSymbol);
      if (c0 === null || c1 === null) return ce.error('incompatible-type');
      const convertedMag = measurementAffine(ce, magExpr, c1 - c0, c0);
      // A unit name is not a variable: it must not be declared in the
      // current scope.
      const r = ce._fn('Quantity', [
        convertedMag,
        ce.symbol(toSymbol, { autoDeclare: false }),
      ]);
      return numericApproximation ? r.N() : r;
    }
    const converted = convertUnit(mag!, fromSymbol, toSymbol);
    if (converted !== null)
      return ce._fn('Quantity', [
        ce.number(converted),
        ce.symbol(toSymbol, { autoDeclare: false }),
      ]);
    // If conversion returned null, units are incompatible
    return ce.error('incompatible-type');
  }

  // Fall back to compound unit conversion
  const fromUE = boxedToUnitExpression(fromUnit);
  const toUE = boxedToUnitExpression(targetUnitExpr);
  if (!fromUE || !toUE) return undefined;

  if (magIsMeasurement) {
    const c0 = convertCompoundUnit(0, fromUE, toUE);
    const c1 = convertCompoundUnit(1, fromUE, toUE);
    if (c0 === null || c1 === null) return ce.error('incompatible-type');
    const convertedMag = measurementAffine(ce, magExpr, c1 - c0, c0);
    const r = ce._fn('Quantity', [convertedMag, targetUnitExpr]);
    return numericApproximation ? r.N() : r;
  }

  const converted = convertCompoundUnit(mag!, fromUE, toUE);
  if (converted === null) return ce.error('incompatible-type');

  return ce._fn('Quantity', [ce.number(converted), targetUnitExpr]);
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

      // A unit name (`m`, `km`, `K`) is not a variable. The unit is boxed
      // resolve-only: a name binds to an existing definition, but a name
      // with no definition stays unbound and is not declared in the current
      // scope.
      //
      // A string second argument (e.g. "km/h", "km") is parsed into a
      // structured unit expression with the same DSL parser the LaTeX/text
      // path uses. A simple unit becomes a symbol; a compound unit becomes a
      // Multiply/Divide/Power expression — so the string form canonicalizes
      // identically to the symbolic-unit form `Quantity(30, km/h)`.
      const unitArg = args[1];
      if (isString(unitArg)) {
        const parsed = parseUnitDSL(unitArg.string);
        if (parsed === null)
          return ce._fn('Quantity', [
            mag,
            ce.error(['unexpected-argument', unitArg.string]),
          ]);
        const boxed = ce._resolveOnly(() =>
          typeof parsed === 'string'
            ? ce.symbol(parsed)
            : ce.expr(parsed as any)
        );
        return ce._fn('Quantity', [mag, boxed]);
      }

      return ce._fn('Quantity', [
        mag,
        ce._resolveOnly(() => unitArg.canonical),
      ]);
    },
    evaluate: (ops, { numericApproximation, engine: ce }) => {
      const mag = numericApproximation ? ops[0].N() : ops[0].evaluate();
      return ce._fn('Quantity', [mag, ops[1]]);
    },
    // Only the magnitude is evaluated, not the unit.
    evaluateAsync: async (ops, options) => {
      const { numericApproximation, engine: ce } = options;
      // A leaf keeps its own `N()`, which reads its value through the
      // ambient scope chain.
      const mag =
        numericApproximation && !isFunction(ops[0])
          ? runWithEvaluationEffects(
              ce,
              options.effects,
              () => ops[0].N(),
              options._contextStack,
              options._precisionWindow
            )
          : await ops[0].evaluateAsync(awaitedOperandOptions(options));
      return ce._fn('Quantity', [mag, ops[1]]);
    },
  },

  QuantityMagnitude: {
    description: 'Extract the numeric value from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (isFunction(arg, 'Quantity')) return arg.op1;
      return undefined;
    },
  },

  QuantityUnit: {
    description: 'Extract the unit from a quantity',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops) => {
      const arg = ops[0];
      if (isFunction(arg, 'Quantity')) return arg.op2;
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
      // Canonicalize the quantity (first arg) but leave the target unit as-is.
      // The target unit is boxed resolve-only, as the unit of a `Quantity`:
      // a unit name is not declared in the current scope.
      return ce._fn('UnitConvert', [
        args[0].canonical,
        ce._resolveOnly(() => args[1].canonical),
      ]);
    },
    evaluate: (ops, { numericApproximation, engine: ce }) => {
      if (!ce) return undefined;
      return convertQuantity(
        ce,
        ops[0]?.evaluate(),
        ops[1],
        numericApproximation
      );
    },
    // Only the quantity is evaluated, not the target unit.
    evaluateAsync: async (ops, options) => {
      const { numericApproximation, engine: ce } = options;
      if (!ce) return undefined;
      const quantity = await ops[0]?.evaluateAsync(
        awaitedOperandOptions(options, { numericApproximation: false })
      );
      return runWithEvaluationEffects(
        ce,
        options.effects,
        () => convertQuantity(ce, quantity, ops[1], numericApproximation),
        options._contextStack,
        options._precisionWindow
      );
    },
  },

  UnitSimplify: {
    description: 'Simplify a quantity unit to a named derived unit if possible',
    complexity: 1200,
    signature: '(value) -> value',
    evaluate: (ops, { engine: ce }) => {
      const arg = ops[0]?.evaluate();
      if (!isFunction(arg, 'Quantity')) return arg;

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

      // findNamedUnit only returns scale=1 units, so just multiply mag
      // by the compound unit's scale to get the magnitude in the named unit.
      const scale = getExpressionScale(ue);
      if (scale === null) return arg;

      // A Measurement or symbolic magnitude is scaled with expression
      // arithmetic: a numeric read of its value loses the error or gives
      // `NaN`.
      const magExpr = arg.op1;
      const scaled =
        isMeasurement(magExpr) || isSymbolicValue(magExpr)
          ? measurementAffine(ce, magExpr, scale, 0)
          : ce.number(mag * scale);
      return ce._fn('Quantity', [
        scaled,
        ce.symbol(match, { autoDeclare: false }),
      ]);
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

      return ce.symbol(dimensionsEqual(da, db) ? 'True' : 'False');
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

      return ce._fn(
        'List',
        dim.map((d) => ce.number(d))
      );
    },
  },
};
