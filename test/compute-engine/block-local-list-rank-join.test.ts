import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { joinEvidenceTypes } from '../../src/compute-engine/library/assignment-evidence';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { MathJsonExpression } from '../../src/math-json';

// The static type of a block local assigned more than once is the join of
// the types of its assigned values (`joinEvidenceTypes`). The `elements` of
// a list type with dimensions are its cells, so a join of two list types of
// different ranks must join what one index returns (a cell of a vector, a
// row of a matrix), not the cells. The join of `[1, 2]` and `[[1, 2]]` gave
// `list<integer>`, and `Map` then refused an untyped callback whose
// parameter was inferred `integer` from that type, while the compiled code
// mapped the row.

const join = (a: string, b: string): string =>
  typeToString(joinEvidenceTypes(parseType(a), parseType(b)));

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

describe('the join of list types of different shapes', () => {
  test('a vector and a matrix join on their rows', () => {
    expect(join('vector<integer^2>', 'matrix<integer^(1x2)>')).toBe(
      'list<integer | vector<integer^2>>'
    );
  });

  test('a plain list and a matrix join on their rows', () => {
    expect(join('list<integer>', 'matrix<integer>')).toBe(
      'list<integer | vector<integer>>'
    );
  });

  test('two vectors of different lengths keep the rank', () => {
    expect(join('vector<integer^2>', 'vector<real^3>')).toBe('vector<real>');
  });

  test('two matrices keep the axis on which they agree', () => {
    expect(join('matrix<integer^(2x2)>', 'matrix<integer^(1x2)>')).toBe(
      'matrix<integer^(?x2)>'
    );
  });

  test('two plain lists join their elements', () => {
    expect(join('list<integer>', 'list<string>')).toBe(
      'list<integer | string>'
    );
  });

  // One index of `tensor<U>` returns `U | tensor<U>`: a join of these values
  // joined the two tensors again, with no end (a stack overflow).
  test('two tensors of unknown rank join their cells', () => {
    expect(join('tensor<integer>', 'tensor<real>')).toBe('tensor<real>');
    expect(join('tensor<integer>', 'tensor<integer>')).toBe(
      'tensor<integer>'
    );
  });
});

describe('a block local assigned a vector, then a matrix', () => {
  const values: MathJsonExpression[] = [
    ['List', 1, 2],
    ['List', ['List', 1, 2]],
  ];

  test('with no declared type, the second value is a static error', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Block',
      ['Assign', 'L', values[0]],
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
    expect(compiled.diagnostic?.code).toBe('unsettled-shape');
    expect(compiled.run!({})).toEqual([[2, 4]]);
  });

  test('a callback with a real parameter refuses the row, and the compiled code declines', () => {
    const ce = new ComputeEngine();
    const e = ce.box(block(values, ['Map', doubleReal, 'L']));
    expect(e.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "(vector<integer^2>) any -> unknown", "(t: real) -> real"), (t) => 2t)'
    );
    expect(() => compile(e, { to: 'javascript', fallback: false })).toThrow(
      /callback parameter 't' is annotated 'real'/
    );
  });
});
