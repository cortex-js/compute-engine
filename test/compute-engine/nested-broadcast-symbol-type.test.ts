import { ComputeEngine } from '../../src/compute-engine';

/**
 * A numeric operator is threadable, so a collection operand is consumed by
 * BROADCAST rather than as a scalar. When the operand is a NESTED collection
 * (`[L, L]`), its elements are themselves broadcast, so the scalar numeric
 * context must not be inferred onto them either.
 *
 * Regression: `checkNumericArgs` walked the elements of a finite indexed
 * collection operand and ran `y._infer('real')` on each, with none of the
 * exclusion the top-level operand already had. With `L := [1, 2]` that
 * narrowed `L`'s value definition from `vector<integer^2>` to `real`
 * — at BOXING time, before any evaluation — while `2 * [L, L]` still
 * evaluated to the matrix `[[2, 4], [2, 4]]`. In a shared engine the next
 * broadcast over `L` then declared `vector<real^2>` for a result that is a
 * `matrix<...^(2x2)>`: an unsound declared type.
 */

describe('nested broadcast does not re-infer a value-bearing symbol', () => {
  test('Multiply(2, [L, L]) leaves L`s type intact', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    const before = ce.symbol('L').type.toString();
    expect(before).toBe('vector<integer^2>');

    const result = ce.box(['Multiply', 2, ['List', 'L', 'L']]).evaluate();
    expect(result.toString()).toBe('[[2,4],[2,4]]');
    expect(ce.symbol('L').type.toString()).toBe(before);
    expect(ce.symbol('L').value?.toString()).toBe('[1,2]');
  });

  test('Add(1, [K, K]) leaves K`s type intact', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['List', 1, 2]));
    const before = ce.symbol('K').type.toString();
    expect(before).toBe('vector<integer^2>');

    const result = ce.box(['Add', 1, ['List', 'K', 'K']]).evaluate();
    expect(result.toString()).toBe('[[2,3],[2,3]]');
    expect(ce.symbol('K').type.toString()).toBe(before);
    expect(ce.symbol('K').value?.toString()).toBe('[1,2]');
  });

  test('merely BOXING the nested broadcast must not write the type', () => {
    // The clobber happened during canonicalization, not evaluation, so pin
    // the boxing route on its own.
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.box(['Multiply', 2, ['List', 'L', 'L']]);
    expect(ce.symbol('L').type.toString()).toBe('vector<integer^2>');
  });

  test('a second broadcast over the same symbol stays sound', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.box(['Multiply', 2, ['List', 'L', 'L']]).evaluate();

    // The declared type of the re-boxed expression must be a supertype of
    // the type its own evaluation produces.
    const expr = ce.box(['Multiply', 2, ['List', 'L', 'L']]);
    const evaluated = expr.evaluate();
    expect(evaluated.type.toString()).toBe('matrix<integer^(2x2)>');
    expect(evaluated.type.matches(expr.type)).toBe(true);
  });

  test('a scalar element of a broadcast operand is still inferred', () => {
    // Non-vacuity of the exclusion: the element walk must keep inferring the
    // numeric context onto elements that are NOT collections.
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    ce.declare('v', 'unknown');
    ce.box(['Multiply', 2, ['List', 'u', 'v']]);
    expect(ce.symbol('u').type.toString()).toBe('real');
    expect(ce.symbol('v').type.toString()).toBe('real');
  });

  test('a FLAT broadcast over the symbol is unaffected', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    expect(ce.box(['Multiply', 2, 'L']).evaluate().toString()).toBe('[2,4]');
    expect(ce.symbol('L').type.toString()).toBe('vector<integer^2>');
    expect(ce.box(['Add', 2, 'L']).evaluate().toString()).toBe('[3,4]');
    expect(ce.symbol('L').type.toString()).toBe('vector<integer^2>');
  });
});
