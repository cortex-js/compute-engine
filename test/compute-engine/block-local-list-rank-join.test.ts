import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json';

// A local declared with a type that admits a vector and a matrix, assigned
// a vector, then a matrix. With no declared type, the type of the local is
// the type of its first value, widened (`list<number>`), and the second
// assignment is the static error `assignment-type-mismatch`.
function block(
  values: MathJsonExpression[],
  last: MathJsonExpression
): MathJsonExpression {
  const [first, ...rest] = values;
  return [
    'Block',
    ['Declare', 'L', "'list<integer | list<integer>>'", first],
    ...rest.map((v): MathJsonExpression => ['Assign', 'L', v]),
    last,
  ];
}

const double: MathJsonExpression = ['Function', ['Multiply', 2, 't'], 't'];
const doubleReal: MathJsonExpression = [
  'Function',
  ['Multiply', 2, 't'],
  ['Typed', 't', "'real'"],
];

describe('a block local assigned a vector, then a matrix', () => {
  const values: MathJsonExpression[] = [
    ['List', 1, 2],
    ['List', ['List', 1, 2]],
  ];

  test('with no declared type, the second value is a static error', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Block',
      ['Declare', 'L', "'unknown'", values[0]],
      ['Assign', 'L', values[1]],
      'L',
    ]);
    expect(e.toString()).toContain(
      'Error(ErrorCode("assignment-type-mismatch", "L", "list<number>", "matrix<integer^(1x2)>"))'
    );
  });

  test('the static type admits both values', () => {
    const ce = new ComputeEngine();
    const e = ce.box(block(values, 'L'));
    expect(e.type.toString()).toBe('list<integer | list<integer>>');
    const value = e.evaluate();
    expect(value.toString()).toBe('[[1,2]]');
    expect(value.type.matches(e.type)).toBe(true);
  });

  // The compiled code gives `L` one representation, and a vector and a
  // matrix are different shape classes, so the compilation declines
  // (CE-712.1, the simple rule for assignments). The interpreter fallback
  // gives the interpreter's value.
  test('Map applies an untyped callback to the current value', () => {
    const ce = new ComputeEngine();
    const e = ce.box(block(values, ['Map', double, 'L']));
    expect(e.evaluate().toString()).toBe('[[2,4]]');
    const compiled = compile(e, { to: 'javascript' });
    expect(compiled.success).toBe(false);
    expect(compiled.diagnostic?.code).toBe('outside-profile');
    expect(compiled.run!({})).toEqual([[2, 4]]);
  });

  test('a callback with a real parameter refuses the row, and the compiled code declines', () => {
    const ce = new ComputeEngine();
    const e = ce.box(block(values, ['Map', doubleReal, 'L']));
    expect(e.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "(vector<integer^2>) any -> unknown", "(t: real) -> real"), (t) => 2t)'
    );
    expect(() => compile(e, { to: 'javascript', fallback: false })).toThrow(
      /a local of type list<integer \| list<integer>>/
    );
  });
});
