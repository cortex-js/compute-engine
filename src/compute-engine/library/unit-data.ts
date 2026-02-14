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
  getUnitDimension,
  getUnitScale,
  areCompatibleUnits,
  convertUnit,
  getExpressionDimension,
  getExpressionScale,
  parseUnitDSL,
  convertCompoundUnit,
} from '../numerics/unit-data';
