/**
 * Jest port of the high-value slices of SymPy's Diophantine test suite,
 * exercising the pure-bigint kernel in
 * `src/compute-engine/numerics/diophantine.ts` DIRECTLY — no ComputeEngine.
 *
 * Provenance: SymPy 1.14.0,
 * `sympy/solvers/diophantine/tests/test_diophantine.py` (BSD-3-Clause),
 * specifically `test_linear` (L84-111), `test_DN` (L201-273), `test_bf_pell`
 * (L276-288), and the linear regressions `test_issue_9539` (L864-866) and
 * `test_issue_9538` (L975-978).
 *
 * ── Porting conventions (read before editing) ──────────────────────────────
 *
 * 1. SymPy asserts exact parametric forms, e.g.
 *    `diop_solve(3*y + 2*x - 5) == (3*t_0 - 5, -2*t_0 + 5)`. Our kernel's
 *    parametrization is derived independently (SymPy diophantine.py's
 *    `Linear.solve` term-accumulation order vs. our `solveReducedLinear`) and
 *    is only guaranteed to describe the SAME affine solution set, not the
 *    same parameter names/offsets/signs. So instead of literal-matching
 *    SymPy's formulas we:
 *      (a) match SymPy's solvable/None verdict exactly (gcd-divisibility is
 *          convention-independent),
 *      (b) substitute a range of parameter tuples into `{base, coef}` and
 *          check every generated point satisfies the original equation, and
 *      (c) completeness: brute-force every integer point in a small box and
 *          invert our kernel's affine map to confirm each brute-force point
 *          is reachable by SOME parameter assignment.
 *    This oracle-based approach verifies the solution SET is identical
 *    without depending on which parametrization the algorithm happens to
 *    produce.
 *
 * 2. SymPy's `0*x` terms vanish under symbolic simplification before
 *    `diop_solve` ever sees them (e.g. `diop_solve(0*x - y - 5) == (-5,)` is
 *    a univariate equation in `y` — `x` never appears). We mirror that by
 *    simply omitting zero-coefficient variables from the `a` array passed to
 *    `solveLinearDiophantine`, rather than passing a literal `0`.
 *
 * 3. For `solvePell`/`diop_DN`: SymPy's class representatives and ours can
 *    differ in the sign of the `y` component within a class (both are valid
 *    fundamental representatives of the same solution class). So instead of
 *    literal-matching SymPy's tuples we:
 *      (a) check the returned `PellResult.kind` corresponds to what SymPy's
 *          expected value implies (`[]` -> 'empty', a short finite list ->
 *          'finite', a Pell family -> 'family', a `t`-parametrized answer ->
 *          'linear-family'),
 *      (b) verify every returned class/solution satisfies
 *          `x² - D·y² = N` exactly, and
 *      (c) cross-check the COMPLETE solution set within a box against
 *          `bruteForcePell` (the independent oracle), applying the
 *          documented family-generation rule from `PellResult`'s doc comment
 *          (class reps × unit powers `t ∈ ℤ`, plus global negation).
 *    Famous fundamental-solution cases (and the huge-D cases from the SymPy
 *    file) are additionally asserted against EXACT transcribed bigints via
 *    `pellFundamental`, since those are convention-independent (there is only
 *    one minimal positive fundamental solution).
 *
 * 4. All bigint literals; no floating point anywhere in this file.
 */

import {
  extendedGcd,
  solveLinearDiophantine,
  solvePell,
  pellFundamental,
  bruteForcePell,
  sqrtMod,
  type LinearSolution,
  type PellResult,
} from '../../src/compute-engine/numerics/diophantine';

//
// ─── Linear Diophantine helpers ─────────────────────────────────────────────
//

/** `true` iff `Σ a[i]·x[i] === c`. */
function linearSatisfies(a: bigint[], c: bigint, x: bigint[]): boolean {
  let sum = 0n;
  for (let i = 0; i < a.length; i++) sum += a[i] * x[i];
  return sum === c;
}

/** `x_i = base[i] + Σ_j coef[i][j]·params[j]`. */
function substitute(sol: LinearSolution, params: bigint[]): bigint[] {
  return sol.base.map((b, i) => {
    let v = b;
    for (let j = 0; j < sol.nParams; j++) v += sol.coef[i][j] * params[j];
    return v;
  });
}

/** All `k`-tuples with every coordinate ranging over `[lo, hi]`. */
function cartesianRange(k: number, lo: bigint, hi: bigint): bigint[][] {
  if (k === 0) return [[]];
  const rest = cartesianRange(k - 1, lo, hi);
  const out: bigint[][] = [];
  for (let v = lo; v <= hi; v++) for (const r of rest) out.push([v, ...r]);
  return out;
}

/** Determinant of a square bigint matrix via cofactor expansion (n ≤ 4 here). */
function det(m: bigint[][]): bigint {
  const n = m.length;
  if (n === 0) return 1n;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let sum = 0n;
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((row) => row.filter((_, ci) => ci !== j));
    const sign = j % 2 === 0 ? 1n : -1n;
    sum += sign * m[0][j] * det(minor);
  }
  return sum;
}

function* combinations<T>(pool: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= pool.length - k; i++) {
    for (const rest of combinations(pool.slice(i + 1), k - 1)) {
      yield [pool[i], ...rest];
    }
  }
}

/**
 * Invert the affine map `x = base + coef·t`: find integer parameters `t`
 * reproducing the target point `x`, or `null` if none exist. Used to confirm
 * a brute-force point is reachable by the family (completeness oracle).
 * Selects an invertible `nParams × nParams` submatrix of `coef` (guaranteed
 * to exist for the full-rank families in this test set) and solves via
 * Cramer's rule in exact bigint arithmetic.
 */
function invertParams(sol: LinearSolution, x: bigint[]): bigint[] | null {
  const { base, coef, nParams } = sol;
  const n = base.length;
  if (nParams === 0) {
    for (let i = 0; i < n; i++) if (base[i] !== x[i]) return null;
    return [];
  }
  const rhs = x.map((xi, i) => xi - base[i]);
  const rows = [...Array(n).keys()];
  for (const idxSet of combinations(rows, nParams)) {
    const M = idxSet.map((r) => coef[r].slice(0, nParams));
    const d = det(M);
    if (d === 0n) continue;
    const t: bigint[] = [];
    let ok = true;
    for (let j = 0; j < nParams; j++) {
      const Mj = M.map((row, ri) =>
        row.map((val, ci) => (ci === j ? rhs[idxSet[ri]] : val))
      );
      const dj = det(Mj);
      if (dj % d !== 0n) {
        ok = false;
        break;
      }
      t.push(dj / d);
    }
    if (!ok) continue;
    let valid = true;
    for (let i = 0; i < n; i++) {
      let val = base[i];
      for (let j = 0; j < nParams; j++) val += coef[i][j] * t[j];
      if (val !== x[i]) {
        valid = false;
        break;
      }
    }
    if (valid) return t;
  }
  return null;
}

/**
 * All integer points of `Σ a[i]·x[i] = c` with the first `n − 1` coordinates
 * ranging over `[-bound, bound]` (the last coordinate is solved from the
 * equation, so it is NOT separately bounded — every a[i] here is nonzero).
 * The independent brute-force oracle for the completeness check.
 */
function bruteForceLinear(a: bigint[], c: bigint, bound: bigint): bigint[][] {
  const n = a.length;
  const results: bigint[][] = [];
  const cur: bigint[] = new Array(n).fill(0n);
  function rec(idx: number, acc: bigint) {
    if (idx === n - 1) {
      const rem = c - acc;
      if (rem % a[idx] === 0n) {
        cur[idx] = rem / a[idx];
        results.push([...cur]);
      }
      return;
    }
    for (let v = -bound; v <= bound; v++) {
      cur[idx] = v;
      rec(idx + 1, acc + a[idx] * v);
    }
  }
  rec(0, 0n);
  return results;
}

const PARAM_CHECK_RANGE = 5n;
const BRUTE_BOUND = 30n;

/**
 * Full oracle-based check for a solvable linear Diophantine equation: (b)
 * every substituted parameter tuple satisfies the equation, and (c) every
 * brute-force point in a box is reachable by SOME parameter assignment.
 */
function expectFullLinearFamily(
  a: bigint[],
  c: bigint,
  bruteBound: bigint = BRUTE_BOUND
): LinearSolution {
  const sol = solveLinearDiophantine(a, c);
  expect(sol).not.toBeNull();
  const s = sol as LinearSolution;

  for (const t of cartesianRange(s.nParams, -PARAM_CHECK_RANGE, PARAM_CHECK_RANGE)) {
    expect(linearSatisfies(a, c, substitute(s, t))).toBe(true);
  }

  const bf = bruteForceLinear(a, c, bruteBound);
  expect(bf.length).toBeGreaterThan(0);
  for (const x of bf) {
    const t = invertParams(s, x);
    expect(t).not.toBeNull();
    expect(linearSatisfies(a, c, substitute(s, t as bigint[]))).toBe(true);
  }
  return s;
}

function expectNoLinearSolution(a: bigint[], c: bigint) {
  expect(solveLinearDiophantine(a, c)).toBeNull();
}

//
// ─── test_linear (SymPy L84-111) ────────────────────────────────────────────
//

describe('solveLinearDiophantine (SymPy test_linear)', () => {
  it('diop_solve(x) == (0,)', () => {
    expectFullLinearFamily([1n], 0n);
  });

  it('diop_solve(1*x) == (0,)', () => {
    expectFullLinearFamily([1n], 0n);
  });

  it('diop_solve(3*x) == (0,)', () => {
    const s = expectFullLinearFamily([3n], 0n);
    expect(s.nParams).toBe(0);
    expect(s.base).toEqual([0n]);
  });

  it('diop_solve(x + 1) == (-1,)', () => {
    const s = expectFullLinearFamily([1n], -1n);
    expect(s.base).toEqual([-1n]);
  });

  it('diop_solve(2*x + 1) == (None,)  [gcd(2) does not divide 1]', () => {
    expectNoLinearSolution([2n], -1n);
  });

  it('diop_solve(2*x + 4) == (-2,)', () => {
    const s = expectFullLinearFamily([2n], -4n);
    expect(s.base).toEqual([-2n]);
  });

  it('diop_solve(y + x) == (t_0, -t_0)', () => {
    expectFullLinearFamily([1n, 1n], 0n);
  });

  it('diop_solve(y + x + 0) == (t_0, -t_0)', () => {
    expectFullLinearFamily([1n, 1n], 0n);
  });

  it('diop_solve(y + x - 0) == (t_0, -t_0)', () => {
    expectFullLinearFamily([1n, 1n], 0n);
  });

  it('diop_solve(0*x - y - 5) == (-5,)  [x vanishes; univariate in y]', () => {
    const s = expectFullLinearFamily([-1n], 5n);
    expect(s.base).toEqual([-5n]);
  });

  it('diop_solve(3*y + 2*x - 5) == (3*t_0 - 5, -2*t_0 + 5)', () => {
    expectFullLinearFamily([2n, 3n], 5n);
  });

  it('diop_solve(2*x - 3*y - 5) == (3*t_0 - 5, 2*t_0 - 5)', () => {
    expectFullLinearFamily([2n, -3n], 5n);
  });

  it('diop_solve(-2*x - 3*y - 5) == (3*t_0 + 5, -2*t_0 - 5)', () => {
    expectFullLinearFamily([-2n, -3n], 5n);
  });

  it('diop_solve(7*x + 5*y) == (5*t_0, -7*t_0)', () => {
    expectFullLinearFamily([7n, 5n], 0n);
  });

  it('diop_solve(2*x + 4*y) == (-2*t_0, t_0)', () => {
    expectFullLinearFamily([2n, 4n], 0n);
  });

  it('diop_solve(4*x + 6*y - 4) == (3*t_0 - 2, -2*t_0 + 2)', () => {
    expectFullLinearFamily([4n, 6n], 4n);
  });

  it('diop_solve(4*x + 6*y - 3) == (None, None)  [gcd(4,6)=2 does not divide 3]', () => {
    expectNoLinearSolution([4n, 6n], 3n);
  });

  it('diop_solve(0*x + 3*y - 4*z + 5) == (4*t_0 + 5, 3*t_0 + 5)  [x vanishes]', () => {
    expectFullLinearFamily([3n, -4n], -5n);
  });

  it('diop_solve(4*x + 3*y - 4*z + 5) == (t_0, 8*t_0 + 4*t_1 + 5, 7*t_0 + 3*t_1 + 5)', () => {
    expectFullLinearFamily([4n, 3n, -4n], -5n);
  });

  it('diop_solve(4*x + 2*y + 8*z - 5) == (None, None, None)  [gcd(4,2,8)=2 does not divide 5]', () => {
    expectNoLinearSolution([4n, 2n, 8n], 5n);
  });

  it('diop_solve(5*x + 7*y - 2*z - 6) == (t_0, -3*t_0 + 2*t_1 + 6, -8*t_0 + 7*t_1 + 18)', () => {
    expectFullLinearFamily([5n, 7n, -2n], 6n);
  });

  it('diop_solve(3*x - 6*y + 12*z - 9) == (2*t_0 + 3, t_0 + 2*t_1, t_1)', () => {
    expectFullLinearFamily([3n, -6n, 12n], 9n);
  });

  it('diop_solve(6*w + 9*x + 20*y - z) == (t_0, t_1, t_1 + t_2, 6*t_0 + 29*t_1 + 20*t_2)', () => {
    // 4 unknowns / 3 params: the brute-force box is 3-dimensional (the 4th
    // coordinate is solved from the equation), so a smaller bound keeps the
    // (2·bound+1)^3 enumeration fast while still covering a meaningful box.
    expectFullLinearFamily([6n, 9n, 20n, -1n], 0n, 15n);
  });
});

describe('linear Diophantine regressions (SymPy issue 9539, 9538)', () => {
  it('issue 9539: diophantine(6*w + 9*y + 20*x - z) == {(t_0, t_1, t_1+t_2, 6*t_0+29*t_1+9*t_2)}', () => {
    // Variables in alphabetical order w, x, y, z: coefficients 6, 20, 9, -1.
    expectFullLinearFamily([6n, 20n, 9n, -1n], 0n, 15n);
  });

  it('issue 9538: diophantine(x - 3*y + 2, syms=[y, x]) == {(t_0, 3*t_0 - 2)}', () => {
    // Explicit variable order [y, x]: coefficients -3, 1; constant +2.
    const s = expectFullLinearFamily([-3n, 1n], -2n);
    expect(s.nParams).toBe(1);
  });
});

//
// ─── Pell equation helpers ───────────────────────────────────────────────────
//

function pellSatisfies(D: bigint, N: bigint, x: bigint, y: bigint): boolean {
  return x * x - D * y * y === N;
}

/** `(x1,y1)·(x2,y2)` in `ℤ[√D]`. */
function pellMul(
  [x1, y1]: [bigint, bigint],
  [x2, y2]: [bigint, bigint],
  D: bigint
): [bigint, bigint] {
  return [x1 * x2 + D * y1 * y2, x1 * y2 + y1 * x2];
}

function pairKey([x, y]: [bigint, bigint]): string {
  return `${x},${y}`;
}

function dedupePairsLocal(pairs: [bigint, bigint][]): [bigint, bigint][] {
  const seen = new Set<string>();
  const out: [bigint, bigint][] = [];
  for (const p of pairs) {
    const k = pairKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

function pairSetEqual(a: [bigint, bigint][], b: [bigint, bigint][]): boolean {
  const as = new Set(dedupePairsLocal(a).map(pairKey));
  const bs = new Set(dedupePairsLocal(b).map(pairKey));
  if (as.size !== bs.size) return false;
  for (const k of as) if (!bs.has(k)) return false;
  return true;
}

/**
 * Applies the family-generation rule documented on `PellResult`: every class
 * rep times unit^t for `t` in `[-tRange, tRange]`, plus the global negation,
 * filtered down to the `|x|,|y| ≤ bound` box (to match a bounded
 * `bruteForcePell` oracle).
 */
function pellFamilyMembersInBox(
  classes: [bigint, bigint][],
  unit: [bigint, bigint],
  D: bigint,
  tRange: bigint,
  bound: bigint
): [bigint, bigint][] {
  const invUnit: [bigint, bigint] = [unit[0], -unit[1]];
  const all: [bigint, bigint][] = [];
  for (const cls of classes) {
    all.push(cls);
    let pos = cls;
    for (let t = 1n; t <= tRange; t++) {
      pos = pellMul(pos, unit, D);
      all.push(pos);
    }
    let neg = cls;
    for (let t = 1n; t <= tRange; t++) {
      neg = pellMul(neg, invUnit, D);
      all.push(neg);
    }
  }
  const withNegation = all.concat(all.map(([x, y]) => [-x, -y] as [bigint, bigint]));
  return dedupePairsLocal(withNegation).filter(
    ([x, y]) => x <= bound && x >= -bound && y <= bound && y >= -bound
  );
}

/**
 * Cross-checks a `'family'` `solvePell` result against the independent
 * `bruteForcePell` oracle within `[-bound, bound]`.
 */
function expectFamilyMatchesBruteForce(
  D: bigint,
  N: bigint,
  bound: bigint,
  tRange = 3n
) {
  const result = solvePell(D, N);
  expect(result.kind).toBe('family');
  const { classes, unit } = result as Extract<PellResult, { kind: 'family' }>;
  for (const [x, y] of classes) expect(pellSatisfies(D, N, x, y)).toBe(true);
  const generated = pellFamilyMembersInBox(classes, unit, D, tRange, bound);
  const brute = bruteForcePell(D, N, bound);
  expect(pairSetEqual(generated, brute)).toBe(true);
}

/** Cross-checks a `'finite'` result (D ≤ 0 branch) against `bruteForcePell`. */
function expectFiniteMatchesBruteForce(D: bigint, N: bigint, bound: bigint) {
  const result = solvePell(D, N);
  expect(result.kind).toBe('finite');
  const { solutions } = result as Extract<PellResult, { kind: 'finite' }>;
  for (const [x, y] of solutions) expect(pellSatisfies(D, N, x, y)).toBe(true);
  const brute = bruteForcePell(D, N, bound);
  expect(pairSetEqual(solutions, brute)).toBe(true);
}

function expectLinearFamilyMember(
  family: { xOfY: [bigint, bigint] },
  D: bigint,
  N: bigint,
  yRange: bigint
) {
  const [c0, c1] = family.xOfY;
  for (let y = -yRange; y <= yRange; y++) {
    const x = c0 + c1 * y;
    expect(x * x - D * y * y).toBe(N);
  }
}

//
// ─── test_DN (SymPy L201-273) ────────────────────────────────────────────────
//

describe('solvePell / pellFundamental (SymPy test_DN)', () => {
  describe('D ≤ 0, D square, or N = 0 (straightforward cases)', () => {
    it('diop_DN(3, 0) == [(0, 0)]', () => {
      expect(solvePell(3n, 0n)).toEqual({ kind: 'finite', solutions: [[0n, 0n]] });
    });

    it('diop_DN(-17, -5) == []', () => {
      expect(solvePell(-17n, -5n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(-19, 23) == [(2, 1)]', () => {
      expectFiniteMatchesBruteForce(-19n, 23n, 50n);
    });

    it('diop_DN(-13, 17) == [(2, 1)]', () => {
      expectFiniteMatchesBruteForce(-13n, 17n, 50n);
    });

    it('diop_DN(-15, 13) == []', () => {
      expect(solvePell(-15n, 13n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(0, 5) == []  [5 is not a perfect square]', () => {
      expect(solvePell(0n, 5n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(0, 9) == [(3, t)]', () => {
      const r = solvePell(0n, 9n);
      expect(r.kind).toBe('linear-family');
      const { families } = r as Extract<PellResult, { kind: 'linear-family' }>;
      expect(families.length).toBe(2);
      for (const f of families) expectLinearFamilyMember(f, 0n, 9n, 20n);
      // The two families are x = 3 and x = -3, y free.
      expect(new Set(families.map((f) => f.xOfY[0].toString()))).toEqual(
        new Set(['3', '-3'])
      );
    });

    it('diop_DN(9, 0) == [(3*t, t)]', () => {
      const r = solvePell(9n, 0n);
      expect(r.kind).toBe('linear-family');
      const { families } = r as Extract<PellResult, { kind: 'linear-family' }>;
      for (const f of families) expectLinearFamilyMember(f, 9n, 0n, 20n);
      // x = 3y and x = -3y.
      expect(new Set(families.map((f) => f.xOfY[1].toString()))).toEqual(
        new Set(['3', '-3'])
      );
    });

    it('diop_DN(16, 24) == []', () => {
      expect(solvePell(16n, 24n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(9, 180) == [(18, 4)]', () => {
      expectFiniteMatchesBruteForce(9n, 180n, 100n);
    });

    it('diop_DN(9, -180) == [(12, 6)]', () => {
      expectFiniteMatchesBruteForce(9n, -180n, 100n);
    });

    it('diop_DN(7, 0) == [(0, 0)]', () => {
      expect(solvePell(7n, 0n)).toEqual({ kind: 'finite', solutions: [[0n, 0n]] });
    });
  });

  describe('x² + y² = N (D = -1, interchangeable solutions)', () => {
    it('diop_DN(-1, 5) == [(2, 1), (1, 2)]', () => {
      expectFiniteMatchesBruteForce(-1n, 5n, 20n);
    });

    it('diop_DN(-1, 169) == [(12, 5), (5, 12), (13, 0), (0, 13)]', () => {
      expectFiniteMatchesBruteForce(-1n, 169n, 20n);
    });
  });

  describe('D > 0 non-square, N = 1 (exact fundamental solutions)', () => {
    it.each([
      [13n, [649n, 180n]],
      [980n, [51841n, 1656n]],
      [981n, [158070671986249n, 5046808151700n]],
      [986n, [49299n, 1570n]],
      [
        991n,
        [
          379516400906811930638014896080n,
          12055735790331359447442538767n,
        ],
      ],
      [17n, [33n, 8n]],
      [19n, [170n, 39n]],
    ] as [bigint, [bigint, bigint]][])(
      'pellFundamental(%s) matches SymPy',
      (D, expected) => {
        const u = pellFundamental(D);
        expect(u).toEqual(expected);
        expect(pellSatisfies(D, 1n, u![0], u![1])).toBe(true);
        expect(solvePell(D, 1n)).toEqual({
          kind: 'family',
          classes: [expected],
          unit: expected,
        });
      }
    );
  });

  describe('D > 0 non-square, N = -1', () => {
    it('diop_DN(13, -1) == [(18, 5)]', () => {
      const r = solvePell(13n, -1n);
      expect(r).toEqual({ kind: 'family', classes: [[18n, 5n]], unit: [649n, 180n] });
      expect(pellSatisfies(13n, -1n, 18n, 5n)).toBe(true);
    });

    it('diop_DN(991, -1) == []', () => {
      expect(solvePell(991n, -1n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(41, -1) == [(32, 5)]', () => {
      const r = solvePell(41n, -1n);
      expect(r.kind).toBe('family');
      const { classes } = r as Extract<PellResult, { kind: 'family' }>;
      expect(classes).toEqual([[32n, 5n]]);
      expect(pellSatisfies(41n, -1n, 32n, 5n)).toBe(true);
    });

    it('diop_DN(290, -1) == [(17, 1)]', () => {
      const r = solvePell(290n, -1n);
      expect(r.kind).toBe('family');
      const { classes } = r as Extract<PellResult, { kind: 'family' }>;
      expect(classes).toEqual([[17n, 1n]]);
      expect(pellSatisfies(290n, -1n, 17n, 1n)).toBe(true);
    });

    it('diop_DN(21257, -1) == [(13913102721304, 95427381109)]', () => {
      const r = solvePell(21257n, -1n);
      expect(r.kind).toBe('family');
      const { classes } = r as Extract<PellResult, { kind: 'family' }>;
      expect(classes).toEqual([[13913102721304n, 95427381109n]]);
      expect(pellSatisfies(21257n, -1n, 13913102721304n, 95427381109n)).toBe(true);
    });

    it('diop_DN(32, -1) == []', () => {
      expect(solvePell(32n, -1n)).toEqual({ kind: 'empty' });
    });
  });

  describe('|N| > 1', () => {
    it('diop_DN(13, -4) == [(3, 1), (393, 109), (36, 10)]', () => {
      expectFamilyMatchesBruteForce(13n, -4n, 1000n);
    });

    it('diop_DN(13, 27) == [(220, 61), (40, 11), (768, 213), (12, 3)]', () => {
      expectFamilyMatchesBruteForce(13n, 27n, 1000n);
    });

    it('diop_DN(157, 12) has 6 classes incl. huge terms (exact equation check only)', () => {
      const r = solvePell(157n, 12n);
      expect(r.kind).toBe('family');
      const { classes } = r as Extract<PellResult, { kind: 'family' }>;
      const expected: [bigint, bigint][] = [
        [13n, 1n],
        [10663n, 851n],
        [579160n, 46222n],
        [483790960n, 38610722n],
        [26277068347n, 2097138361n],
        [21950079635497n, 1751807067011n],
      ];
      for (const [x, y] of classes) expect(pellSatisfies(157n, 12n, x, y)).toBe(true);
      expect(pairSetEqual(classes, expected)).toBe(true);
    });

    it('diop_DN(13, 25) == [(3245, 900)]', () => {
      expectFamilyMatchesBruteForce(13n, 25n, 5000n);
    });

    it('diop_DN(192, 18) == []', () => {
      expect(solvePell(192n, 18n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(23, 13) == [(-6, 1), (6, 1)]', () => {
      expectFamilyMatchesBruteForce(23n, 13n, 200n);
    });

    it('diop_DN(167, 2) == [(13, 1)]', () => {
      expectFamilyMatchesBruteForce(167n, 2n, 200n);
    });

    it('diop_DN(167, -2) == []', () => {
      expect(solvePell(167n, -2n)).toEqual({ kind: 'empty' });
    });

    it('diop_DN(123, -2) == [(11, 1)]', () => {
      expectFamilyMatchesBruteForce(123n, -2n, 200n);
    });

    it('diop_DN(123, -23) == [(-10, 1), (10, 1)]', () => {
      expectFamilyMatchesBruteForce(123n, -23n, 200n);
    });
  });

  describe('degenerate D = 0, N = 0', () => {
    it('diop_DN(0, 0, t) == [(0, t)]', () => {
      const r = solvePell(0n, 0n);
      expect(r.kind).toBe('linear-family');
      const { families } = r as Extract<PellResult, { kind: 'linear-family' }>;
      expect(families.length).toBe(1);
      expectLinearFamilyMember(families[0], 0n, 0n, 20n);
      expect(families[0].xOfY).toEqual([0n, 0n]);
    });

    it('diop_DN(0, -1, t) == []', () => {
      expect(solvePell(0n, -1n)).toEqual({ kind: 'empty' });
    });
  });
});

//
// ─── test_bf_pell (SymPy L276-288) ───────────────────────────────────────────
//

describe('bruteForcePell cross-checks (SymPy test_bf_pell)', () => {
  it('diop_bf_DN(13, -4) == [(3, 1), (-3, 1), (36, 10)]', () => {
    expectFamilyMatchesBruteForce(13n, -4n, 1000n);
  });

  it('diop_bf_DN(13, 27) == [(12, 3), (-12, 3), (40, 11), (-40, 11)]', () => {
    expectFamilyMatchesBruteForce(13n, 27n, 1000n);
  });

  it('diop_bf_DN(167, -2) == []', () => {
    expect(solvePell(167n, -2n)).toEqual({ kind: 'empty' });
  });

  it('diop_bf_DN(1729, 1) == [(44611924489705, 1072885712316)]  [exact, no brute force]', () => {
    const u = pellFundamental(1729n);
    expect(u).toEqual([44611924489705n, 1072885712316n]);
    expect(pellSatisfies(1729n, 1n, u![0], u![1])).toBe(true);
    expect(solvePell(1729n, 1n)).toEqual({
      kind: 'family',
      classes: [[44611924489705n, 1072885712316n]],
      unit: [44611924489705n, 1072885712316n],
    });
  });

  it('diop_bf_DN(89, -8) == [(9, 1), (-9, 1)]  [minimal class within a small box]', () => {
    // SymPy's own diop_bf_DN only lists (9,1) and (-9,1) — its bounded search
    // does not sign-flip y for D > 0. The complete integer solution set in
    // this box also contains (9,-1) and (-9,-1) (both genuinely satisfy
    // x² - 89y² = -8); our bruteForcePell oracle enumerates ALL of them, so
    // we cross-check completeness against that oracle rather than literally
    // matching SymPy's shorter list. The second class ((216991, 23001), from
    // pellFamilyMembersInBox) lies far outside this box.
    const r = solvePell(89n, -8n);
    expect(r.kind).toBe('family');
    const { classes, unit } = r as Extract<PellResult, { kind: 'family' }>;
    for (const [x, y] of classes) expect(pellSatisfies(89n, -8n, x, y)).toBe(true);
    expect(classes[0]).toEqual([9n, 1n]);
    const bound = 300n;
    const generated = pellFamilyMembersInBox(classes, unit, 89n, 3n, bound);
    const brute = bruteForcePell(89n, -8n, bound);
    expect(pairSetEqual(generated, brute)).toBe(true);
    expect(pairSetEqual(brute, [
      [9n, 1n],
      [-9n, 1n],
      [9n, -1n],
      [-9n, -1n],
    ])).toBe(true);
  });

  it('diop_bf_DN(21257, -1) == [(13913102721304, 95427381109)]', () => {
    const r = solvePell(21257n, -1n);
    expect(r.kind).toBe('family');
    const { classes } = r as Extract<PellResult, { kind: 'family' }>;
    expect(classes).toEqual([[13913102721304n, 95427381109n]]);
  });

  it('diop_bf_DN(340, -4) == [(756, 41)]', () => {
    expectFamilyMatchesBruteForce(340n, -4n, 2000n);
  });

  it('diop_bf_DN(-1, 0, t) == [(0, 0)]', () => {
    expect(solvePell(-1n, 0n)).toEqual({ kind: 'finite', solutions: [[0n, 0n]] });
  });

  it('diop_bf_DN(0, 0, t) == [(0, t)]', () => {
    const r = solvePell(0n, 0n);
    expect(r.kind).toBe('linear-family');
    const { families } = r as Extract<PellResult, { kind: 'linear-family' }>;
    expect(families).toEqual([{ xOfY: [0n, 0n] }]);
  });

  it('diop_bf_DN(4, 0, t) == [(2*t, t), (-2*t, t)]', () => {
    const r = solvePell(4n, 0n);
    expect(r.kind).toBe('linear-family');
    const { families } = r as Extract<PellResult, { kind: 'linear-family' }>;
    for (const f of families) expectLinearFamilyMember(f, 4n, 0n, 20n);
    expect(new Set(families.map((f) => f.xOfY[1].toString()))).toEqual(
      new Set(['2', '-2'])
    );
  });

  it('diop_bf_DN(3, 0, t) == [(0, 0)]', () => {
    expect(solvePell(3n, 0n)).toEqual({ kind: 'finite', solutions: [[0n, 0n]] });
  });

  it('diop_bf_DN(1, -2, t) == []  [D = 1 perfect square, no factor pair works]', () => {
    expect(solvePell(1n, -2n)).toEqual({ kind: 'empty' });
  });
});

//
// ─── sqrtMod ─────────────────────────────────────────────────────────────────
//

describe('sqrtMod', () => {
  it('sqrtMod(1, 8) == [1, 3, 5, 7]', () => {
    expect(sqrtMod(1n, 8n)).toEqual([1n, 3n, 5n, 7n]);
  });

  it('sqrtMod(4, 12) == [2, 4, 8, 10]', () => {
    expect(sqrtMod(4n, 12n)).toEqual([2n, 4n, 8n, 10n]);
  });

  it('sqrtMod(0, 4) == [0, 2]', () => {
    expect(sqrtMod(0n, 4n)).toEqual([0n, 2n]);
  });

  it('sqrtMod(58, 101): all roots mod an odd prime, verified by squaring', () => {
    const roots = sqrtMod(58n, 101n);
    expect(roots.length).toBe(2);
    for (const r of roots) expect(((r * r) % 101n)).toBe(58n % 101n);
    // The two roots are negatives of each other mod p.
    expect((roots[0] + roots[1]) % 101n).toBe(0n);
  });

  it('sqrtMod(361, 840): composite modulus (2^3·3·5·7), verified by squaring', () => {
    const roots = sqrtMod(361n, 840n);
    // 4 roots mod 8 (361 ≡ 1 mod 8) × 2 mod 3 × 2 mod 5 × 2 mod 7 = 32.
    expect(roots.length).toBe(32);
    const seen = new Set<string>();
    for (const r of roots) {
      expect(r >= 0n && r < 840n).toBe(true);
      expect((r * r) % 840n).toBe(361n % 840n);
      expect(seen.has(r.toString())).toBe(false);
      seen.add(r.toString());
    }
  });

  it('sqrtMod(2, 5) == []  [2 is a quadratic non-residue mod 5]', () => {
    expect(sqrtMod(2n, 5n)).toEqual([]);
  });
});

//
// ─── extendedGcd sanity (used throughout the kernel) ────────────────────────
//

describe('extendedGcd', () => {
  it('satisfies a·x + b·y = g for a range of inputs', () => {
    const values = [-97n, -12n, -1n, 0n, 1n, 12n, 30n, 97n, 210n];
    for (const a of values) {
      for (const b of values) {
        const { g, x, y } = extendedGcd(a, b);
        expect(a * x + b * y).toBe(g);
        expect(g >= 0n).toBe(true);
      }
    }
  });
});
