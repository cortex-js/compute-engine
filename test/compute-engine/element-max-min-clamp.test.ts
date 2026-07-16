import { ComputeEngine } from '../../src/compute-engine';

/**
 * Element-wise `ElementMax` / `ElementMin` (the NumPy `maximum`/`minimum`
 * primitive) and `Clamp`. Unlike `Max`/`Min`, which REDUCE all operands
 * (including a collection's elements) to a single scalar, these broadcast: a
 * scalar over a collection → a collection, two collections zip, two scalars →
 * a scalar. Also covers the `Max`/`Min` scalar+collection compile fix (it used
 * to mis-compile to `Math.max(0, <array>)` → NaN).
 */

const ce = new ComputeEngine();

const evalStr = (mj: any) => ce.box(mj).evaluate().toString();
const run = (mj: any) => ce.getCompilationTarget('javascript')!.compile(ce.box(mj)).run!({});

describe('ElementMax / ElementMin — evaluate', () => {
  test('broadcasts a scalar over a collection', () => {
    expect(evalStr(['ElementMax', 0, ['List', 1, -2, 3]])).toBe('[1,0,3]');
    expect(evalStr(['ElementMin', 0, ['List', 1, -2, 3]])).toBe('[0,-2,0]');
  });

  test('two scalars give a scalar', () => {
    expect(evalStr(['ElementMax', 2, 5])).toBe('5');
    expect(evalStr(['ElementMin', 2, 5])).toBe('2');
  });

  test('two collections zip element-wise', () => {
    expect(evalStr(['ElementMax', ['List', 1, 2], ['List', 3, 0]])).toBe('[3,2]');
  });

  test('variadic (n-ary) — folds over all operands element-wise', () => {
    expect(evalStr(['ElementMax', 0, ['List', 1, -2, 3], 2])).toBe('[2,2,3]');
    expect(evalStr(['ElementMin', 4, ['List', 1, 9], 2])).toBe('[1,2]');
    // all-scalar variadic reduces to the scalar extremum
    expect(evalStr(['ElementMax', 1, 5, 3])).toBe('5');
  });

  test('requires at least two arguments', () => {
    expect(ce.box(['ElementMax', ['List', 1, 2, 3]]).isValid).toBe(false);
  });

  test('preserves exactness (returns the winning operand, not a float)', () => {
    expect(evalStr(['ElementMax', ['Sqrt', 2], 1])).toBe('sqrt(2)');
    expect(evalStr(['ElementMin', ['Sqrt', 2], 1])).toBe('1');
  });

  test('stays symbolic when the ordering is undecidable', () => {
    // `x` free → cannot decide max(x, 0)
    expect(ce.box(['ElementMax', 'x', 0]).evaluate().operator).toBe('ElementMax');
  });

  test('.N() numericizes through the broadcast', () => {
    expect(ce.box(['ElementMax', ['Sqrt', 2], ['List', 1, 2]]).N().toString()).toBe(
      '[1.4142135623730950488,2]'
    );
  });
});

describe('ElementMax / ElementMin — type', () => {
  test('scalar⊗collection is typed as a list', () => {
    expect(ce.box(['ElementMax', 0, ['List', 1, 2, 3]]).type.toString()).toBe(
      'list<finite_number>'
    );
  });
  test('scalar⊗scalar is a scalar type', () => {
    expect(ce.box(['ElementMax', 2, 5]).type.toString()).toBe('finite_real');
  });
  test('a non-finite operand widens to number (non-finite convention)', () => {
    expect(
      ce.box(['ElementMax', ['List', 1, 2], 'PositiveInfinity']).type.toString()
    ).toBe('list<number>');
  });
});

describe('Clamp — evaluate', () => {
  test('clamps each element of a collection to [lo, hi]', () => {
    expect(evalStr(['Clamp', ['List', -1, '0.5', 2], 0, 1])).toBe('[0,0.5,1]');
  });
  test('scalar clamp', () => {
    expect(evalStr(['Clamp', 5, 0, 10])).toBe('5');
    expect(evalStr(['Clamp', -3, 0, 10])).toBe('0');
    expect(evalStr(['Clamp', 42, 0, 10])).toBe('10');
  });
});

describe('ElementMax / ElementMin / Clamp — compile', () => {
  test('scalar⊗collection compiles to a broadcast and runs', () => {
    expect(run(['ElementMax', 0, ['List', 1, -2, 3]])).toEqual([1, 0, 3]);
    expect(run(['ElementMin', 0, ['List', 1, -2, 3]])).toEqual([0, -2, 0]);
  });
  test('Clamp (3-ary) compiles to a broadcast and runs', () => {
    expect(run(['Clamp', ['List', -1, 0.5, 2], 0, 1])).toEqual([0, 0.5, 1]);
  });
  test('scalar⊗scalar compiles to a plain call', () => {
    expect(run(['ElementMax', 2, 5])).toBe(5);
    expect(run(['Clamp', 5, 0, 10])).toBe(5);
  });

  test('variadic (n-ary) compiles to a broadcast and runs', () => {
    expect(run(['ElementMax', 0, ['List', 1, -2, 3], 2])).toEqual([2, 2, 3]);
    expect(run(['ElementMax', 1, 5, 3])).toBe(5);
  });
});

describe('Max / Min — scalar+collection compile fix (reduction, was NaN)', () => {
  test('Max(scalar, collection) reduces to the overall max at run time', () => {
    // evaluate and compile now agree (both reduce to the scalar maximum).
    expect(evalStr(['Max', 0, ['List', 1, -2, 3]])).toBe('3');
    expect(run(['Max', 0, ['List', 1, -2, 3]])).toBe(3);
  });
  test('Min(scalar, collection) reduces to the overall min', () => {
    expect(run(['Min', 5, ['List', 1, -2, 3]])).toBe(-2);
  });
  test('Max of a single collection is unchanged', () => {
    expect(run(['Max', ['List', 1, 2, 3]])).toBe(3);
  });
});

describe('LaTeX round-trip', () => {
  test('ElementMax / Clamp serialize and re-parse', () => {
    for (const mj of [
      ['ElementMax', 0, ['List', 1, 2]],
      ['ElementMin', ['List', 1, 2], 0],
      ['Clamp', 'x', 0, 1],
    ]) {
      const latex = ce.box(mj).latex;
      expect(ce.parse(latex).json).toEqual(mj);
    }
  });
});
