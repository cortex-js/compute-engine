/**
 * `deriveApplicationType` — the recursive entry point a `'types'`-shape
 * `type` handler reaches as `context.derive`: the type of applying an
 * operator to operands held only as descriptors.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describe as describeOperand,
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('r', 'real');
ce.declare('z', 'complex');

const derive = (op: string, ...types: string[]) => {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((s) => describeType(ce.type(s).type))
  );
  return t === undefined ? undefined : typeToString(t);
};

describe('deriveApplicationType', () => {
  test('an operator with a descriptor-shape handler answers through it', () => {
    // `Sin` derives its result from the operand's type alone, so the
    // descriptor route and the expression route must agree.
    expect(derive('Sin', 'integer')).toBe(ce.box(['Sin', 'n']).type.toString());
    expect(derive('Sin', 'real')).toBe(ce.box(['Sin', 'r']).type.toString());
    expect(derive('Sin', 'complex')).toBe(ce.box(['Sin', 'z']).type.toString());
  });

  test('a real operand described from an expression agrees too', () => {
    const t = deriveApplicationType(ce, 'Cosh', [describeOperand(ce.box('r'))]);
    expect(typeToString(t!)).toBe(ce.box(['Cosh', 'r']).type.toString());
  });

  test('an operand typed never makes the application never', () => {
    expect(derive('Sin', 'never')).toBe('never');
  });

  test('an unknown operator answers undefined', () => {
    expect(derive('NoSuchOperator_', 'integer')).toBeUndefined();
  });

  test('a declared function symbol answers its declared result type', () => {
    ce.declare('f', '(integer) -> real');
    expect(derive('f', 'integer')).toBe('real');
  });

  test('a polytype function symbol is instantiated against the operands', () => {
    ce.declare('idf', '(T) -> T where T');
    expect(derive('idf', 'integer')).toBe('integer');
    expect(derive('idf', 'string')).toBe('string');
  });

  test('a propagate operator absorbs an absent operand as the call site does', () => {
    // `Add` propagates absence: an `integer | missing` operand is handed to
    // the handler stripped, and the result admits the `NaN` an absent
    // numeric operand contributes — never the bare `integer` the handler
    // would claim for the present arm alone.
    const t = deriveApplicationType(ce, 'Add', [
      describeType(ce.type('integer | missing').type),
      describeType(ce.type('1').type),
    ]);
    expect(typeToString(t!)).toBe('number');
    expect(
      deriveApplicationType(ce, 'Add', [
        describeType('integer'),
        describeType(ce.type('1').type),
      ])
    ).toBe('integer');
  });

  test('closedness unknown is conservative at a circular pole; a bound variable is not closed', () => {
    // A type-only descriptor may stand for `π/2`, so `Tan` keeps `number`;
    // a bound variable's stand-in is a free symbol and keeps `real`.
    expect(derive('Tan', 'real')).toBe('number');
    expect(
      typeToString(deriveApplicationType(ce, 'Tan', [describeBoundSymbol('real')])!)
    ).toBe('real');
  });

  test('a purity violation in a nested derivation names the nested operator', () => {
    const e = new ComputeEngine();
    let n = 0;
    e.declare('LeakInner', {
      signature: '(any) -> unknown',
      type: (_ops, { engine }) => {
        (engine as unknown as ComputeEngine).declare(`leak${n++}`, 'number');
        return 'unknown';
      },
    });
    e.declare('Outer', {
      signature: '(any) -> unknown',
      type: (ops, { derive }) => derive('LeakInner', ops) ?? 'unknown',
    });
    expect(() => e.box(['Outer', 1]).type).toThrow(/"LeakInner" modified engine state/);
  });
});
