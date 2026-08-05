import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * A canonical `Multiply` is FLAT: `Multiply` is associative, so no operand of
 * a canonical `Multiply` is itself a `Multiply`.
 *
 * The regression this file guards: `ce.parse('2f(ab)')` on a fresh engine
 * produced `Multiply(2, f, Multiply(a, b))` — the `InvisibleOperator`
 * canonical handler calls `canonicalMultiply()` directly, bypassing the
 * flattening that `ce.function('Multiply', …)` does in `checkNumericArgs`.
 *
 * Note the trap that hid this: the MathJSON serializer flattens on output, so
 * `.json` prints `['Multiply', 2, 'a', 'b', 'f']` for BOTH the nested and the
 * flat tree. Only `.ops` (or `.isSame`) reveals the defect — so these tests
 * assert on `.ops`, never on `.json`.
 */

/** Names of the operators of each operand — `['Multiply']` if any is nested */
function opOperators(expr: Expression): string[] {
  return (expr.ops ?? []).map((x) => x.operator);
}

function opStrings(expr: Expression): string[] {
  return (expr.ops ?? []).map((x) => x.toString());
}

function expectFlatProduct(expr: Expression): void {
  expect(expr.operator).toBe('Multiply');
  expect(expr.isCanonical).toBe(true);
  expect(opOperators(expr)).not.toContain('Multiply');
}

describe('CANONICAL MULTIPLY IS FLAT', () => {
  describe('parse route', () => {
    test('2f(ab) — undeclared call head, product argument (the repro)', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('2f(ab)');
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'a', 'b', 'f']);
    });

    test('2f(ab) matches the flat spelling 2abf operand for operand', () => {
      const ce = new ComputeEngine();
      const a = ce.parse('2f(ab)');
      const b = ce.parse('2abf');
      expect(opStrings(a)).toEqual(opStrings(b));
      expect(a.isSame(b)).toBe(true);
    });

    test('2f(ab) round-trips through its own serialization (same engine)', () => {
      const ce = new ComputeEngine();
      const a = ce.parse('2f(ab)');
      // The same-engine reparse is forced: cross-engine `isSame` is false for
      // every symbol.
      const b = ce.parse(a.toLatex());
      expect(a.isSame(b)).toBe(true);
    });

    test('a parenthesized product with more factors stays flat', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('2f(ab)c');
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'a', 'b', 'c', 'f']);
    });

    test('a parenthesized product of a number and a symbol folds', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('2(3x)');
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['6', 'x']);
    });

    test('plain products are unchanged', () => {
      const ce = new ComputeEngine();
      expect(opStrings(ce.parse('2xy'))).toEqual(['2', 'x', 'y']);
      expect(opStrings(ce.parse('2x'))).toEqual(['2', 'x']);
      expect(opStrings(ce.parse('xyz'))).toEqual(['x', 'y', 'z']);
    });

    test('a parenthesized sum is NOT distributed or flattened away', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('2(x+1)');
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'x + 1']);
    });

    test('a declared function head still applies (no product)', () => {
      const ce = new ComputeEngine();
      ce.declare('g', '(number) -> number');
      const expr = ce.parse('2g(ab)');
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'g(a * b)']);
    });
  });

  describe('box route', () => {
    test('an explicitly nested Multiply flattens', () => {
      const ce = new ComputeEngine();
      const expr = ce.box(['Multiply', 2, 'f', ['Multiply', 'a', 'b']]);
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'a', 'b', 'f']);
    });

    test('a deeply nested Multiply flattens', () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        'Multiply',
        'x',
        ['Multiply', 'y', ['Multiply', 'z', 'w']],
      ]);
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['w', 'x', 'y', 'z']);
    });

    test('a nested InvisibleOperator with a product operand flattens', () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        'InvisibleOperator',
        2,
        'f',
        ['Delimiter', ['InvisibleOperator', 'a', 'b']],
      ]);
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'a', 'b', 'f']);
    });

    test('ce.function builds a flat product', () => {
      const ce = new ComputeEngine();
      const expr = ce.function('Multiply', [
        ce.number(2),
        ce.function('Multiply', [ce.symbol('a'), ce.symbol('b')]),
      ]);
      expectFlatProduct(expr);
      expect(opStrings(expr)).toEqual(['2', 'a', 'b']);
    });
  });

  /**
   * The one exception to flatness: a nested product carrying a
   * `ContinuationPlaceholder` (an ellipsis) is a fold BARRIER — splicing its
   * operands into the enclosing product would let the surrounding factors fold
   * and sort across the ellipsis. `flatten()` is recursive, so the barrier
   * check has to be recursive too. Again: assert on `.ops`, never on `.json`.
   */
  describe('ellipsis fold barrier', () => {
    /** Operand tree, by operator, down to leaf `toString()`s */
    const tree = (expr: Expression): unknown =>
      (expr.ops?.length ?? 0) > 0
        ? [expr.operator, ...expr.ops!.map(tree)]
        : expr.toString();

    test('a barrier nested two levels deep is not spliced or folded across', () => {
      const ce = new ComputeEngine();
      // `2(4(2 · … · n))`: the inner `2` belongs to the elided pattern, so it
      // must not be folded with the outer `2` and `4` into `16`.
      const expr = ce.parse(
        '2\\left(4\\left(2 \\cdot \\dots \\cdot n\\right)\\right)'
      );
      expect(tree(expr)).toEqual([
        'Multiply',
        '2',
        ['Multiply', '4', ['Multiply', '2', '...', 'n']],
      ]);
      // The ellipsis never becomes a direct operand of the outer products
      expect(opStrings(expr)).not.toContain('...');
    });

    test('a barrier nested two levels deep survives the box route', () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        'InvisibleOperator',
        2,
        [
          'Delimiter',
          [
            'InvisibleOperator',
            4,
            ['Delimiter', ['Multiply', 2, 'ContinuationPlaceholder', 'n']],
          ],
        ],
      ]);
      expect(tree(expr)).toEqual([
        'Multiply',
        '2',
        ['Multiply', '4', ['Multiply', '2', '...', 'n']],
      ]);
    });

    test('an unrelated nested product still flattens next to a barrier', () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        'InvisibleOperator',
        ['Delimiter', ['Multiply', 'a', 'ContinuationPlaceholder']],
        ['Delimiter', ['InvisibleOperator', 'x', 'y']],
        'c',
      ]);
      // The barrier is held back; `x·y` — which has nothing to do with it —
      // is lifted, as the flat canonical form requires.
      expect(tree(expr)).toEqual([
        'Multiply',
        'c',
        'x',
        'y',
        ['Multiply', 'a', '...'],
      ]);
    });

    test('the parse route agrees: barrier held, sibling product lifted', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('(2 \\cdot \\dots \\cdot n)(xy)c');
      expect(tree(expr)).toEqual([
        'Multiply',
        'c',
        'x',
        'y',
        ['Multiply', '2', '...', 'n'],
      ]);
    });
  });
});
