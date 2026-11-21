import { ComputeEngine, isFunction } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

const A: MathJsonExpression = ['List', ['List', 1, 2], ['List', 3, 4]];
const B: MathJsonExpression = ['List', ['List', 2, 0], ['List', 0, 1]];
const sum: MathJsonExpression = ['List', ['List', 3, 2], ['List', 3, 5]];
const typeOf = (expr: Expression) => expr.type.toString();

function callNode(expr: Expression) {
  if (!isFunction(expr)) throw new Error(`Expected a call, got ${expr}`);
  return expr;
}

function engine(): ComputeEngine {
  return new ComputeEngine();
}

function stageMatrices(ce: ComputeEngine): void {
  ce.declare('A', 'matrix');
  ce.declare('B', 'matrix');
}

function assignMatrices(ce: ComputeEngine): void {
  ce.assign('A', A);
  ce.assign('B', B);
}

describe('BINDING UNITS: MATRIX EVIDENCE', () => {
  test('a saved determinant uses the matrix declarations before values arrive', () => {
    const ce = engine();
    const unspecified = ce.parse('\\det(A+2B)');
    expect(unspecified.isValid).toBe(false);
    expect(ce.lookupDefinition('A')).toBeUndefined();
    expect(ce.lookupDefinition('B')).toBeUndefined();

    stageMatrices(ce);
    const determinant = ce.parse('\\det(A+2B)');
    expect(determinant.isValid).toBe(true);
    expect(typeOf(determinant)).toBe('number');
    expect(typeOf(callNode(determinant).op1)).toBe('matrix');
    expect(determinant.evaluate().operator).toBe('Determinant');

    assignMatrices(ce);
    expect(determinant.evaluate().json).toBe(24);
    expect(determinant.N().json).toBe(24);
  });

  const operands: [MathJsonExpression, number][] = [
    [['Add', 'A', 'B'], 9],
    [['Subtract', 'A', 'B'], -9],
    [['Multiply', 2, 'A'], -8],
    [['Negate', 'A'], -2],
    [['Power', 'A', 2], 4],
    [['Add', 'A', ['Multiply', ['Cos', 't'], 'B']], 9],
  ];

  test.each(operands)(
    'determinant preserves known matrix shape for %j',
    (operand, result) => {
      const ce = engine();
      stageMatrices(ce);
      ce.assign('t', 0);
      const e = ce.box(['Determinant', operand]);
      expect(e.isValid).toBe(true);
      expect(callNode(e).op1.type.matches('matrix')).toBe(true);
      assignMatrices(ce);
      expect(e.evaluate().json).toBe(result);
      expect(e.N().json).toBe(result);
    }
  );

  test('a known matrix sum is accepted with an explicit polynomial variable', () => {
    const ce = engine();
    stageMatrices(ce);
    const e = ce.box(['CharacteristicPolynomial', ['Add', 'A', 'B'], 'x']);
    expect(e.isValid).toBe(true);
    expect(callNode(e).op1.type.matches('matrix')).toBe(true);
    assignMatrices(ce);
    expect(e.evaluate().subs({ x: 1 }).evaluate().json).toBe(2);
  });

  test('LinearSolve admits the matrix arm of its right-hand-side contract', () => {
    const ce = engine();
    stageMatrices(ce);
    ce.declare('M', 'matrix');
    const e = ce.box(['LinearSolve', 'M', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(callNode(callNode(e).op2).ops.map(typeOf)).toEqual(['matrix', 'matrix']);
    assignMatrices(ce);
    ce.assign('M', ['List', ['List', 1, 0], ['List', 0, 1]]);
    expect(e.evaluate().json).toEqual(sum);
  });

  test('a rejected quotient preserves its numeric occurrence types', () => {
    const ce = engine();
    const e = ce.parse('\\det(\\frac{A}{B})');
    expect(e.isValid).toBe(false);
    // The operand of the error keeps the numeric guess of its unit.
    const quotient = callNode(callNode(callNode(e).op1).op2);
    expect(quotient.toString()).toBe('A / B');
    expect(quotient.ops.map(typeOf)).toEqual(['number', 'number']);
  });

  test('an ambiguous product and a vector factor are not repaired', () => {
    let ce = engine();
    expect(ce.box(['Determinant', ['Multiply', 'a', 'A']]).isValid).toBe(false);
    ce = engine();
    ce.declare('v', 'vector');
    expect(ce.box(['Determinant', ['Multiply', 'A', 'v']]).isValid).toBe(
      false
    );
  });

  test('a non-strict engine keeps the numeric sum symbolic', () => {
    const ce = engine();
    ce.strict = false;
    const e = ce.box(['Determinant', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(callNode(callNode(e).op1).ops.map(typeOf)).toEqual(['number', 'number']);
  });

  test('an unknown binding remains unknown when the data shape is unspecified', () => {
    const ce = engine();
    ce.declare('P_0', 'unknown');
    const histogram: MathJsonExpression = [
      'Histogram', ['Add', 'P_0', 0.5], ['Divide', 1, 100],
    ];
    expect(ce.box(histogram).isValid).toBe(false);
    expect(typeOf(ce.box('P_0'))).toBe('unknown');

    const known = engine();
    known.declare('P_0', 'list<number>');
    const e = known.box(histogram);
    expect(e.isValid).toBe(true);
    expect(typeOf(callNode(callNode(e).op1).op1)).toBe('list<number>');
  });

  test('an entry that an earlier boxing wrote is not retyped', () => {
    // `ce.function()` with a boxed operand writes in the environment of the
    // operand (rule 6). The numeric requirement of `A + B` was written by its
    // own boxing: it is the evidence of that boxing, and `a` keeps its type.
    const ce = engine();
    const a = ce.box(['Add', 'A', 'B']);
    expect(typeOf(a)).toBe('number');
    const d = ce.function('Determinant', [a]);
    expect(d.isValid).toBe(false);
    expect(typeOf(a)).toBe('number');
    expect(callNode(a).ops.map(typeOf)).toEqual(['number', 'number']);
  });

  test('ce.infer commits evidence from a direct matrix parameter', () => {
    const ce = engine();
    const e = ce.parse('\\det(A)');
    expect(e.isValid).toBe(true);
    expect(typeOf(callNode(e).op1)).toBe('matrix');
    expect(ce.lookupDefinition('A')).toBeUndefined();
    const declared = ce.infer([e]).declared;
    expect(declared.map((d) => [d.name, ce.type(d.type).toString()])).toEqual([
      ['A', 'matrix'],
    ]);
    expect(typeOf(ce.box('A'))).toBe('matrix');
  });

  test('a substitution validates the determinant against known matrix shape', () => {
    const ce = engine();
    const host = ce.box(['Add', 'y', 1]);
    const replacement: MathJsonExpression = ['Determinant', ['Add', 'A', 'B']];
    expect(host.subs({ y: replacement }).isValid).toBe(false);
    expect(ce.lookupDefinition('A')).toBeUndefined();

    stageMatrices(ce);
    const result = host.subs({ y: replacement });
    expect(result.isValid).toBe(true);
    expect(typeOf(result)).toBe('number');
    assignMatrices(ce);
    expect(result.evaluate().json).toBe(10);
  });

  test('a matrix formal and independent collection evidence coexist', () => {
    const ce = engine();
    const body: MathJsonExpression = [
      'Block', ['Length', 'B'], ['Determinant', ['Multiply', 2, 'A']],
    ];
    const unspecified = ce.box(['Function', body, 'A', 'B']);
    expect(unspecified.isValid).toBe(false);
    const f = ce.box(['Function', body, ['Typed', 'A', "'matrix'"], 'B']);
    expect(f.isValid).toBe(true);
    expect(typeOf(f)).toBe('(A: matrix, B: collection) -> number');
    expect(ce.box(['Apply', f, A, ['List', 1, 2]]).evaluate().json).toBe(-8);
  });
});
