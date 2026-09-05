import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Library loops whose length scales with an operand VALUE (not with the size
// of a collection) must carry a step backstop of their own: with only a
// deadline poll inside, a call made with no deadline armed — a plain
// `evaluate()`, the compile-time constant fold — runs unbounded. The audit of
// 2026-09-04 (ROADMAP, "Standing audit — value-scaled library loops") found
// the loops below with a deadline poll and no budget; each now stops at its
// budget, and the small values are unchanged.

const ce = new ComputeEngine();

function ev(json: unknown): string {
  return ce.box(json as any).evaluate().toString();
}

describe('the small values are unchanged', () => {
  test('number-theory recurrences', () => {
    expect(ev(['Eulerian', 5, 2])).toBe('66');
    expect(ev(['Eulerian', 9, 4])).toBe('156190');
    expect(ev(['Eulerian', 4, 0])).toBe('1');
    expect(ev(['Eulerian', 4, 3])).toBe('1');
    expect(ev(['Eulerian', 60, 30])).toBe(
      '1433390608671821228969675919258773164493394050515364070292771746922431378457940792'
    );
    expect(ev(['Stirling', 5, 2])).toBe('15');
    expect(ev(['Stirling', 10, 4])).toBe('34105');
    expect(ev(['Stirling', 0, 0])).toBe('1');
    expect(ev(['Stirling', 5, 0])).toBe('0');
    expect(ev(['Stirling', 5, 5])).toBe('1');
    expect(ev(['Stirling', 20, 1])).toBe('1');
    expect(ev(['StirlingS1', 5, 2])).toBe('-50');
    expect(ev(['NPartition', 10])).toBe('42');
    expect(ev(['NPartition', 100])).toBe('190569292');
    expect(ce.box(['IsAbundant', 12]).evaluate().symbol).toBe('True');
    expect(ce.box(['IsAbundant', 13]).evaluate().symbol).toBe('False');
    expect(ev(['Divisors', 28])).toBe('[1,2,4,7,14,28]');
    expect(ev(['BernoulliB', 4])).toBe('-1/30');
    expect(ev(['BernoulliB', 12])).toBe('-691/2730');
  });

  test('matrix power by squaring gives the repeated-multiplication values', () => {
    const A = ['List', ['List', 1, 1], ['List', 0, 1]];
    expect(ev(['MatrixPower', A, 1])).toBe('[[1,1],[0,1]]');
    expect(ev(['MatrixPower', A, 2])).toBe('[[1,2],[0,1]]');
    expect(ev(['MatrixPower', A, 7])).toBe('[[1,7],[0,1]]');
    expect(ev(['MatrixPower', A, 30])).toBe('[[1,30],[0,1]]');
    expect(ev(['MatrixPower', A, -3])).toBe('[[1,-3],[0,1]]');
    const F = ['List', ['List', 1, 1], ['List', 1, 0]];
    // Fibonacci: F^10 = [[F11, F10], [F10, F9]]
    expect(ev(['MatrixPower', F, 10])).toBe('[[89,55],[55,34]]');
  });

  test('a large matrix power is fast', () => {
    const A = ['List', ['List', 1, 1], ['List', 0, 1]];
    const t0 = Date.now();
    expect(ev(['MatrixPower', A, 100000])).toBe('[[1,100000],[0,1]]');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('roots, colormap samples, chunks and derivative orders under the caps', () => {
    expect(ce.box(['ComplexRoots', 1, 4]).evaluate().nops).toBe(4);
    expect(ce.box(['Chunk', ['List', 1, 2, 3, 4], 2]).evaluate().json).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(
      ce.box(['D', ['Power', 'x', 5], ['Set', 'x', 3]]).evaluate().json
    ).toEqual(['Multiply', 60, ['Power', 'x', 2]]);
  });
});

describe('past the budget the loop stops', () => {
  test('IsAbundant over a 40-digit integer throws iteration-limit-exceeded', () => {
    const t0 = Date.now();
    expect(() =>
      ce.box(['IsAbundant', { num: '1' + '0'.repeat(39) + '1' }]).evaluate()
    ).toThrow(/exceeded/);
    expect(Date.now() - t0).toBeLessThan(15000);
  });

  test('a recurrence too large to materialize stays symbolic, at once', () => {
    // `Stirling(4000, 2000)` used to exhaust the heap: millions of memo
    // entries holding ten-thousand-digit integers, all under the step budget.
    for (const json of [
      ['Stirling', 4000, 2000],
      ['Stirling', 100000, 50000],
      ['Eulerian', 100000, 50000],
      ['StirlingS1', 100000, 50000],
      ['NPartition', 10000000],
      ['BernoulliB', 20000],
    ]) {
      const t0 = Date.now();
      const v = ce.box(json as any).evaluate();
      expect(v.operator).toBe(json[0]);
      expect(Date.now() - t0).toBeLessThan(500);
    }
  });

  test('a mid-size recurrence still computes', () => {
    const t0 = Date.now();
    expect(ce.box(['Stirling', 1000, 500]).evaluate().isNumber).toBe(true);
    expect(ce.box(['BernoulliB', 400]).evaluate().isNumber).toBe(true);
    expect(Date.now() - t0).toBeLessThan(15000);
  });

  test('past the result-count caps the call stays symbolic', () => {
    const A = ['List', ['List', 1, 1], ['List', 0, 1]];
    expect(ce.box(['MatrixPower', A, 2000000]).evaluate().operator).toBe(
      'MatrixPower'
    );
    expect(ce.box(['ComplexRoots', 1, 20000]).evaluate().operator).toBe(
      'ComplexRoots'
    );
    expect(
      ce.box(['Chunk', ['List', 1, 2, 3], 20000]).evaluate().operator
    ).toBe('Chunk');
    const d = ce.box(['D', ['Power', 'x', 5], ['Set', 'x', 5000]]).evaluate();
    expect(d.operator).toBe('D');
  });
});

describe('the constant columns are answered before the work estimate', () => {
  test('boundary identities for large n', () => {
    expect(ev(['Eulerian', 100000, 0])).toBe('1');
    expect(ev(['Stirling', 100000, 0])).toBe('0');
    expect(ev(['Stirling', 100000, 1])).toBe('1');
    expect(ev(['Stirling', 100000, 100000])).toBe('1');
    expect(ev(['Stirling', 0, 0])).toBe('1');
    expect(ev(['StirlingS1', 100000, 0])).toBe('0');
    expect(ev(['StirlingS1', 100000, 100000])).toBe('1');
    expect(ev(['StirlingS1', 0, 0])).toBe('1');
  });

  test('an operand too large for a number stays symbolic, at once', () => {
    const huge = { num: '1' + '0'.repeat(400) };
    for (const json of [
      ['Stirling', huge, 5],
      ['Stirling', huge, huge],
      ['Eulerian', huge, 5],
      ['StirlingS1', huge, 5],
      ['NPartition', huge],
      ['BernoulliB', huge],
    ]) {
      const v = ce.box(json as any).evaluate();
      expect(v.isNumber || v.operator === json[0]).toBe(true);
    }
    expect(ce.box(['Stirling', huge, 5]).evaluate().operator).toBe('Stirling');
    // Near the diagonal the walk is quadratic in n; the estimate counts it.
    expect(ce.box(['Stirling', 10000, 9999]).evaluate().operator).toBe(
      'Stirling'
    );
  });
});

describe('the enumerability promises follow the caps', () => {
  test('Chunk past the cap is not enumerable and has no count', () => {
    const e = ce.box(['Chunk', ['List', 1, 2, 3], 20000]);
    expect(e.isEnumerableCollection).not.toBe(true);
    expect(e.count).toBeUndefined();
    expect(ce.box(['Chunk', ['List', 1, 2, 3], 5]).count).toBe(5);
  });

  test('ComplexRoots past the cap is not enumerable', () => {
    expect(ce.box(['ComplexRoots', 1, 20000]).isEnumerableCollection).not.toBe(
      true
    );
    expect(ce.box(['ComplexRoots', 1, 4]).isEnumerableCollection).toBe(true);
  });

  test('Divisors of an operand past the scan budget stays symbolic and is not enumerable', () => {
    const big = { num: '1' + '0'.repeat(40) + '1' };
    const e = ce.box(['Divisors', big]);
    expect(e.isEnumerableCollection).not.toBe(true);
    expect(e.evaluate().operator).toBe('Divisors');
    expect(ce.box(['Divisors', 28]).isEnumerableCollection).toBe(true);
  });
});

describe('the compiled lane is bounded by the same caps', () => {
  const A = ['List', ['List', 1, 1], ['List', 0, 1]];

  test('a literal past the cap fails closed', () => {
    for (const json of [
      ['MatrixPower', A, 2000000],
      ['Chunk', ['List', 1, 2, 3], 20000],
      ['Colormap', { str: 'viridis' }, 20000],
    ]) {
      expect(() =>
        compile(ce.box(json as any), { fallback: false, constantFold: false })
      ).toThrow(/Fail closed/);
    }
  });

  test('a run-time operand past the cap answers NaN', () => {
    const local = new ComputeEngine();
    local.declare('k', 'integer');
    const chunk = compile(local.box(['Chunk', ['List', 1, 2, 3], 'k']), {
      fallback: false,
      constantFold: false,
    });
    expect(chunk?.run!({ k: 2 })).toEqual([[1, 2], [3]]);
    expect(Number.isNaN(chunk?.run!({ k: 20000 }))).toBe(true);
    const pow = compile(local.box(['MatrixPower', A, 'k']), {
      fallback: false,
      constantFold: false,
    });
    expect(pow?.run!({ k: 100000 })).toEqual([
      [1, 100000],
      [0, 1],
    ]);
    expect(Number.isNaN(pow?.run!({ k: 2000000 }))).toBe(true);
    const cmap = compile(local.box(['Colormap', { str: 'viridis' }, 'k']), {
      fallback: false,
      constantFold: false,
    });
    expect((cmap?.run!({ k: 3 }) as unknown[]).length).toBe(3);
    expect(Number.isNaN(cmap?.run!({ k: 20000 }))).toBe(true);
  });
});
