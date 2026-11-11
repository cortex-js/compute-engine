import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isFreeName } from '../../src/compute-engine/boxed-expression/type-guards';

// The fresh-matrix repair (`repairFreshMatrixInference()`, `validate.ts`)
// replaces the entry of
// the unit environment of a name that has no explicit type (rules 1, 2, 4, 6
// and 8 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`), not its
// definition. The type of each occurrence of the result reads the repaired
// entry.

function engine(): ComputeEngine {
  return new ComputeEngine();
}

const typeOf = (expr: Expression) => expr.type.toString();

describe('BINDING UNITS: THE FRESH-MATRIX REPAIR', () => {
  test('Det(A + 2B) retypes the free names in their unit', () => {
    const ce = engine();
    const e = ce.parse('\\det(A+2B)');
    expect(e.isValid).toBe(true);
    expect(typeOf(e)).toBe('number');
    const sum = e.op1;
    expect(typeOf(sum)).toBe('matrix');
    expect(isFreeName(sum.op1)).toBe(true);
    expect(typeOf(sum.op1)).toBe('matrix');
    expect(typeOf(sum.op2.op2)).toBe('matrix');
    // Boxing writes no definition (rule 1).
    expect(ce.lookupDefinition('A')).toBeUndefined();
    expect(ce.lookupDefinition('B')).toBeUndefined();
  });

  test('the forms of the plan are repaired', () => {
    for (const json of [
      ['Determinant', ['Add', 'A', 'B']],
      ['Determinant', ['Subtract', 'A', 'B']],
      ['Determinant', ['Multiply', 2, 'A']],
      ['Determinant', ['Negate', 'A']],
      ['Determinant', ['Power', 'A', 2]],
      ['Determinant', ['Add', 'A', ['Multiply', ['Cos', 't'], 'B']]],
      ['CharacteristicPolynomial', ['Add', 'A', 'B'], 'x'],
    ]) {
      const ce = engine();
      expect(ce.box(json as any).isValid).toBe(true);
    }
  });

  test('a union parameter that accepts a matrix is repaired (LinearSolve)', () => {
    const ce = engine();
    ce.declare('M', 'matrix');
    const e = ce.box(['LinearSolve', 'M', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(e.op2.ops.map(typeOf)).toEqual(['matrix', 'matrix']);
  });

  test('a failed repair puts back the entries of the unit', () => {
    const ce = engine();
    const e = ce.parse('\\det(\\frac{A}{B})');
    expect(e.isValid).toBe(false);
    // The operand of the error keeps the numeric guess of its unit.
    const quotient = e.op1.op2;
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

  test('a non-strict engine does not repair', () => {
    const ce = engine();
    ce.strict = false;
    const e = ce.box(['Determinant', ['Add', 'A', 'B']]);
    expect(e.isValid).toBe(true);
    expect(e.op1.ops.map(typeOf)).toEqual(['number', 'number']);
  });

  test('a name declared unknown is retyped in the unit, not on its definition', () => {
    const ce = engine();
    ce.declare('P_0', 'unknown');
    const e = ce.box(['Histogram', ['Add', 'P_0', 0.5], ['Divide', 1, 100]]);
    expect(e.isValid).toBe(true);
    expect(typeOf(e.op1.op1)).toBe('list<number>');
    expect((ce.lookupDefinition('P_0') as any).value.type.toString()).toBe(
      'unknown'
    );
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
    expect(a.ops.map(typeOf)).toEqual(['number', 'number']);
  });

  test('ce.infer() commits the repaired entries', () => {
    const ce = engine();
    const e = ce.parse('\\det(A+2B)');
    const result = ce.infer([e]);
    expect(
      result.declared.map((d) => [d.name, ce.type(d.type).toString()])
    ).toEqual([
      ['A', 'matrix'],
      ['B', 'matrix'],
    ]);
    expect(typeOf(ce.box('A'))).toBe('matrix');
  });

  test('inside an operation, the repair writes in the operation environment', () => {
    const ce = engine();
    const host = ce.box(['Add', 'y', 1]);
    const result = host.subs({ y: ['Determinant', ['Add', 'A', 'B']] });
    expect(result.isValid).toBe(true);
    expect(result.toString()).toBe('Determinant(A + B) + 1');
    expect(typeOf(result)).toBe('number');
  });

  test('a parameter of a function literal is repaired on its definition', () => {
    const ce = engine();
    const f = ce.box([
      'Function',
      ['Block', ['Length', 'B'], ['Determinant', ['Multiply', 2, 'A']]],
      'A',
      'B',
    ]);
    expect(f.isValid).toBe(true);
    expect(typeOf(f)).toBe('(A: matrix, B: collection) -> number');
  });
});
