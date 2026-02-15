/**
 * Re-export the unit registry from its canonical location in numerics/.
 *
 * The unit registry lives in numerics/ so that lower layers (like
 * latex-syntax/) can access it without violating the layered dependency
 * rules.
 */
export {
  type DimensionVector,
  type UnitExpression,
  dimensionsEqual,
  isDimensionless,
  getUnitDimension,
  getUnitScale,
  areCompatibleUnits,
  convertUnit,
  getExpressionDimension,
  getExpressionScale,
  parseUnitDSL,
  convertCompoundUnit,
  findNamedUnit,
} from '../numerics/unit-data';
