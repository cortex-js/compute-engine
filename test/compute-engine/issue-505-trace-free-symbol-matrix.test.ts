/**
 * GitHub issue #505: `Trace` of a matrix of free symbols must not change the
 * type of the symbols.
 *
 * The parameter of `Trace` is `number | tensor`. The element type of a
 * tensor of unknown rank is `number | tensor`, because a cell can be a
 * number or a tensor. Before the fix, boxing `Trace([[a, b], [c, d]])` gave
 * each free cell that type. A cell typed `number | tensor` can be a list, so
 * the literal `[[a, b], [c, d]]` was then typed
 * `list<list<number | tensor>>` and not `matrix<2x2>`, for the rest of the
 * session. `Trace`, `Determinant` and `Inverse` refuse an operand that is not
 * a matrix, and they stayed unevaluated. Now a tensor parameter of unknown
 * rank gives no type to the cells of a literal (`distributeLiteralElementInference()`,
 * `src/compute-engine/boxed-expression/validate.ts`), as the parameter
 * `matrix | vector` of `MatrixMultiply` does.
 */
import { ComputeEngine } from '../../src/compute-engine';

const M = ['List', ['List', 'a', 'b'], ['List', 'c', 'd']] as const;

describe('ISSUE #505: TRACE OF A MATRIX OF FREE SYMBOLS', () => {
  test('Trace does not give the free cells a type', () => {
    const ce = new ComputeEngine();
    const trace = ce.box(['Trace', M as any]);
    expect(ce.box('a').type.toString()).toBe('unknown');
    expect(trace.op1.type.toString()).toBe('matrix<2x2>');
    expect(trace.evaluate().json).toEqual(['Add', 'a', 'd']);
  });

  test('Determinant and Inverse evaluate after Trace, in the same engine', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Trace', M as any]).evaluate().json).toEqual([
      'Add',
      'a',
      'd',
    ]);
    expect(ce.box(['Determinant', M as any]).evaluate().json).toEqual([
      'Add',
      ['Negate', ['Multiply', 'b', 'c']],
      ['Multiply', 'a', 'd'],
    ]);
    const det = [
      'Add',
      ['Negate', ['Multiply', 'b', 'c']],
      ['Multiply', 'a', 'd'],
    ];
    expect(ce.box(['Inverse', M as any]).evaluate().json).toEqual([
      'List',
      ['List', ['Divide', 'd', det], ['Divide', ['Negate', 'b'], det]],
      ['List', ['Divide', ['Negate', 'c'], det], ['Divide', 'a', det]],
    ]);
    expect(ce.box(M as any).type.toString()).toBe('matrix<2x2>');
  });

  test('Trace of a matrix of numbers is unchanged', () => {
    const ce = new ComputeEngine();
    const N = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['Trace', N]).evaluate().json).toBe(5);
  });
});
