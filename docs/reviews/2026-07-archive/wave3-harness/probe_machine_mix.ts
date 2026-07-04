import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
import { MachineNumericValue } from '/Users/arno/dev/compute-engine/src/compute-engine/numeric-value/machine-numeric-value';
const ce = new ComputeEngine();
ce.precision = 50;
// Box a machine numeric value inside a bignum-preferred engine, then mix
const m = ce.number(new MachineNumericValue(0.2459357644513484));
console.log('boxed:', m.toString(), '| ctor:', (m as any).numericValue?.constructor?.name, '| type:', m.type.toString());
const sum = m.add(ce.number(1)).N();
console.log('m + 1 =', sum.toString());
const prod = m.mul(ce.box('Pi')).N();
console.log('m * pi =', prod.toString());
const viaExpr = ce.function('Add', [m, ce.parse('\\sqrt{2}')]).N();
console.log('m + sqrt2 =', viaExpr.toString());
console.log('isSame roundtrip:', m.isSame(ce.number(0.2459357644513484)));
ce.precision = 21;
