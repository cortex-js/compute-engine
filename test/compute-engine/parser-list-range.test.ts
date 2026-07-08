import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Parser: list range ellipsis', () => {
  describe('endpoint-only form [a ... b]', () => {
    test('`[1...9]` parses to Range(1, 9)', () => {
      expect(parse('\\left[1...9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\ldots 9]` (\\ldots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\ldots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\dots 9]` (\\dots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\dots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('symbolic endpoints', () => {
      expect(parse('\\left[a...b\\right]')).toEqual(['Range', 'a', 'b']);
    });
  });

  // Single-anchor continuation `[1, ..., 10]`: one sample, so no step can be
  // inferred — it means the same as the endpoint-only `[1...10]`, i.e.
  // Range(1, 10). The internal `ContinuationPlaceholder` must never leak as a
  // list element.
  describe('single-anchor form [a, ..., b]', () => {
    test('`[1, \\ldots, 10]` → Range(1, 10)', () => {
      expect(parse('\\left[1, \\ldots, 10\\right]')).toEqual(['Range', 1, 10]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[1, \\ldots, 10\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });
  });

  describe('inferred-step form [a, b, ..., c]', () => {
    test('`[1, 3, ..., 9]` → Range(1, 9, 2)', () => {
      expect(parse('\\left[1, 3, \\ldots, 9\\right]')).toEqual(['Range', 1, 9, 2]);
    });

    test('`[0, 0.1, ..., 1]` (float idiom) → Range(0, 1, 0.1)', () => {
      const result = parse('\\left[0, 0.1, \\ldots, 1\\right]');
      expect(result).toMatchObject(['Range', 0, 1, 0.1]);
    });

    test('`[0, 0.1, 0.2, ..., 1]` (with intermediate sample, tolerance-validated)', () => {
      // 0.1 + 0.1 ≠ 0.2 exactly, but within ce.tolerance.
      expect(parse('\\left[0, 0.1, 0.2, \\ldots, 1\\right]')).toMatchObject([
        'Range', 0, 1, 0.1,
      ]);
    });

    test('negative step `[10, 8, ..., 0]` → Range(10, 0, -2)', () => {
      expect(parse('\\left[10, 8, \\ldots, 0\\right]')).toEqual([
        'Range', 10, 0, -2,
      ]);
    });
  });

  describe('error cases', () => {
    test('inconsistent intermediate sample → parse error', () => {
      // step is 0.1 but third element is 0.5 (not 0.2)
      const result = ce.parse('\\left[0, 0.1, 0.5, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });

    test('degenerate step (b - a = 0) → parse error', () => {
      const result = ce.parse('\\left[1, 1, \\ldots, 5\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('custom ce.tolerance is respected', () => {
    test('loose tolerance (0.01) accepts slightly-off first gap', () => {
      // samples = [0, 0.1, 0.21]; step = last diff = 0.21 - 0.1 = 0.11
      // first gap: 0.1 - 0 - 0.11 = -0.01, abs = 0.01 ≤ tol (0.01) → accepted
      const ceLoose = new ComputeEngine();
      ceLoose.tolerance = 0.01;
      const result = ceLoose.parse(
        '\\left[0, 0.1, 0.21, \\ldots, 1\\right]'
      ).json;
      // step comes from the last two samples: 0.21 - 0.1
      expect(result).toMatchObject(['Range', 0, 1, expect.closeTo(0.11, 10)]);
    });

    test('tight tolerance (1e-12) rejects the same off step', () => {
      // same 0.01 discrepancy now exceeds tolerance → parse error
      const ceTight = new ComputeEngine();
      ceTight.tolerance = 1e-12;
      const result = ceTight.parse('\\left[0, 0.1, 0.21, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('outside list literal: \\ldots stays ContinuationPlaceholder', () => {
    test('bare \\ldots parses as ContinuationPlaceholder symbol', () => {
      // Outside a list-range context \ldots must remain a plain symbol, not
      // trigger any Range parsing.  Use json directly (no boxing) to avoid the
      // pre-existing "cannot change type of constant" throw in Add.
      const raw = ce.parse('\\ldots').json;
      expect(raw).toEqual('ContinuationPlaceholder');
    });
  });

  // A scalar juxtaposed with a list/vector-*typed* operand is scaling
  // (`Multiply`), not a silent `Tuple`. This matters for a scaled `\frac`
  // whose numerator is a list/range: `2\frac{[…]}{8}` — the scaled numerator
  // has type `vector<N>`/`list<number>` but is not yet a concrete collection.
  describe('scalar · list scaling (not Tuple)', () => {
    test('`2\\frac{[0,...,8]}{8}` scales the range', () => {
      expect(parse('2\\frac{\\left[0,...,8\\right]}{8}')).toEqual([
        'Multiply',
        2,
        ['Rational', 1, 8],
        ['Range', 0, 8],
      ]);
    });

    test('`2\\frac{[1,2,3]}{8}` scales the list literal', () => {
      expect(parse('2\\frac{\\left[1,2,3\\right]}{8}')).toEqual([
        'Multiply',
        2,
        ['Rational', 1, 8],
        ['List', 1, 2, 3],
      ]);
    });

    test('scalar times a vector-typed symbol is a Multiply', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('v', 'vector<3>');
      expect(ce2.parse('2v').json).toEqual(['Multiply', 2, 'v']);
    });

    test('a genuine tuple is NOT turned into a Multiply', () => {
      // `(3,4)` is a heterogeneous tuple; scaling keeps the tuple intact.
      expect(parse('2\\left(3,4\\right)')).toEqual([
        'Multiply',
        2,
        ['Tuple', 3, 4],
      ]);
    });

    test('Desmos corpus row parses valid (P undeclared)', () => {
      const expr = ce.parse(
        '1>0\\ \\left\\{\\ P\\left(x,y\\right)\\le\\ 0.6\\cdot\\left(2\\frac{\\left[0,...,8\\right]}{8}-1\\right)\\right\\}'
      );
      expect(expr.isValid).toBe(true);
    });
  });
});
