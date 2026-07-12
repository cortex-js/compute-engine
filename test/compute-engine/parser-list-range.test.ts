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

  // Comma-less forms with a compound first sample: the prose ellipsis binds
  // looser than a prefix sign or implicit multiplication, so `[-9...9]` is
  // Range(-9, 9), not List(Negate(Range(9, 9))). (Desmos emits these
  // comma-less; the comma forms were fixed in 0.75.0.)
  describe('comma-less form with signed/coefficiented first sample', () => {
    test('`[-9...9]` → Range(-9, 9)', () => {
      expect(parse('\\left[-9...9\\right]')).toEqual(['Range', -9, 9]);
    });

    test('`[-9...9]` enumerates 19 values', () => {
      const expr = ce.parse('\\left[-9...9\\right]').evaluate();
      const values = [...expr.each()].map((x) => x.valueOf());
      expect(values).toEqual([
        -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    test('`[-N...N]` → Range(-N, N)', () => {
      expect(parse('\\left[-N...N\\right]')).toEqual([
        'Range',
        ['Negate', 'N'],
        'N',
      ]);
    });

    test('`[-3N...3N]` → Range(-3N, 3N)', () => {
      expect(parse('\\left[-3N...3N\\right]')).toEqual([
        'Range',
        ['Multiply', -3, 'N'],
        ['Multiply', 3, 'N'],
      ]);
    });

    test('`[-0.5...5]` (signed decimal first sample) → Range(-0.5, 5)', () => {
      expect(parse('\\left[-0.5...5\\right]')).toEqual(['Range', -0.5, 5]);
    });

    test('`[0...kN]` (compound end) → Range(0, kN)', () => {
      expect(parse('\\left[0...kN\\right]')).toMatchObject([
        'Range',
        0,
        ['Multiply', 'N', 'k'],
      ]);
    });

    test('`[-9\\ldots 9]` (\\ldots variant) → Range(-9, 9)', () => {
      expect(parse('\\left[-9\\ldots 9\\right]')).toEqual(['Range', -9, 9]);
    });

    test('programmatic `..` unchanged: `1..5` and `1..3..9`', () => {
      expect(parse('1..5')).toEqual(['Range', 1, 5]);
      expect(parse('1..3..9')).toEqual(['Range', 1, 9, 2]);
    });

    test('ellipsis in an equation rhs: `x=1...5` → Equal(x, Range(1, 5))', () => {
      expect(parse('x=1...5')).toEqual(['Equal', 'x', ['Range', 1, 5]]);
    });

    test('additive continuation unchanged: `1+2+\\ldots+n`', () => {
      expect(parse('1+2+\\ldots+n')).toEqual([
        'Add',
        1,
        2,
        'ContinuationPlaceholder',
        'n',
      ]);
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

  // At parse time a negative literal is raw `["Negate", n]`, not the number
  // `-n`, so a negative *leading* sample used to make `machineValue` return
  // `null` and the range inference bailed to a `ContinuationPlaceholder` list
  // that enumerated as NaN downstream (Tycho 2026-07-11).
  describe('inferred-step form with negative leading samples', () => {
    test('`[-9, -6, ..., 9]` → Range(-9, 9, 3)', () => {
      expect(parse('\\left[-9,-6,\\ldots,9\\right]')).toEqual([
        'Range', -9, 9, 3,
      ]);
    });

    test('`[0, -2, ..., -10]` → Range(0, -10, -2)', () => {
      expect(parse('\\left[0,-2,\\ldots,-10\\right]')).toEqual([
        'Range', 0, -10, -2,
      ]);
    });

    test('`[-1, -0.5, ..., 1]` → Range(-1, 1, 0.5)', () => {
      expect(parse('\\left[-1,-0.5,\\ldots,1\\right]')).toMatchObject([
        'Range', -1, 1, 0.5,
      ]);
    });

    test('`[10, 8, ..., -4]` (negative end only) → Range(10, -4, -2)', () => {
      expect(parse('\\left[10,8,\\ldots,-4\\right]')).toEqual([
        'Range', 10, -4, -2,
      ]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[-9,-6,\\ldots,9\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });

    test('inconsistent negative samples → parse error', () => {
      // samples [-9, -6, -4]: step = -4 - -6 = 2, but -6 - -9 = 3 ≠ 2
      const result = ce.parse('\\left[-9,-6,-4,\\ldots,9\\right]');
      expect(result.isValid).toBe(false);
    });

  });

  // Symbolic stepped samples: infer a step ONLY when every leading sample is a
  // numeric multiple of ONE common plain symbol (the Desmos-corpus idiom
  // `[-3N, -2N, ..., 3N]`). Generic-sequence notation (`[x_1, x_2, ..., x_n]`)
  // is NOT an arithmetic progression and must stay a placeholder List.
  describe('inferred-step form with symbolic leading samples', () => {
    test('`[-3N, -2N, ..., 3N]` → Range(-3N, 3N, N)', () => {
      expect(parse('\\left[-3N,-2N,\\ldots,3N\\right]')).toEqual([
        'Range',
        ['Multiply', -3, 'N'],
        ['Multiply', 3, 'N'],
        'N',
      ]);
    });

    test('`[N, 2N, ..., 10N]` → Range(N, 10N, N)', () => {
      expect(parse('\\left[N,2N,\\ldots,10N\\right]')).toEqual([
        'Range',
        'N',
        ['Multiply', 10, 'N'],
        'N',
      ]);
    });

    test('`[2N, 4N, ..., 20N]` → step Multiply(2, N)', () => {
      expect(parse('\\left[2N,4N,\\ldots,20N\\right]')).toEqual([
        'Range',
        ['Multiply', 2, 'N'],
        ['Multiply', 20, 'N'],
        ['Multiply', 2, 'N'],
      ]);
    });

    test('`[3N, 2N, ..., -3N]` (descending) → step Negate(N)', () => {
      expect(parse('\\left[3N,2N,\\ldots,-3N\\right]')).toEqual([
        'Range',
        ['Multiply', 3, 'N'],
        ['Multiply', -3, 'N'],
        ['Negate', 'N'],
      ]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[-3N,-2N,\\ldots,3N\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });

    // Generic sequence: distinct symbols per sample → not a progression.
    test('`[x_1, x_2, ..., x_n]` stays a placeholder List', () => {
      expect(parse('\\left[x_1,x_2,\\ldots,x_n\\right]')).toEqual([
        'List',
        'x_1',
        'x_2',
        'ContinuationPlaceholder',
        'x_n',
      ]);
    });

    // Different symbols across samples → not a progression over one symbol.
    test('`[N, 2M, ..., 10N]` (mixed symbols) stays a placeholder List', () => {
      expect(parse('\\left[N,2M,\\ldots,10N\\right]')).toEqual([
        'List',
        'N',
        ['Multiply', 2, 'M'],
        'ContinuationPlaceholder',
        ['Multiply', 10, 'N'],
      ]);
    });

    // Coefficients 1, 2, 4 are not an arithmetic progression.
    test('`[N, 2N, 4N, ..., 10N]` (inconsistent) → parse error', () => {
      const result = ce.parse('\\left[N,2N,4N,\\ldots,10N\\right]');
      expect(result.isValid).toBe(false);
    });

    // End-to-end: once N is assigned, the symbolic Range enumerates concretely.
    test('`[-3N, -2N, ..., 3N]` with N=2 enumerates to -6..6 step 2', () => {
      const ceLocal = new ComputeEngine();
      ceLocal.assign('N', 2);
      const values = [
        ...ceLocal
          .parse('\\left[-3N,-2N,\\ldots,3N\\right]')
          .evaluate()
          .each(),
      ].map((x) => x.re);
      expect(values).toEqual([-6, -4, -2, 0, 2, 4, 6]);
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
