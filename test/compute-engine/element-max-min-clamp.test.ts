import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

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
const run = (mj: any) => ce._getCompilationTarget('javascript')!.compile(ce.box(mj)).run!({});

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

// §D6.1 shape-aware lift: shape-known operands now yield dimensioned static types.
describe('ElementMax / ElementMin — type', () => {
  test('scalar⊗collection is typed as a list', () => {
    // At least `vector<3>`: the shape is the guard; the cell tier may refine
    // (integer cells would be honest here).
    expectTypeBetween(ce.box(['ElementMax', 0, ['List', 1, 2, 3]]), {
      atMost: 'vector<3>',
    });
  });
  test('scalar⊗scalar is a scalar type', () => {
    // The slim handler of the Contract B flip claims the operands' common
    // tier, and an extremum returns one of its operands, so two integer
    // literals give `integer` (it used to answer the looser `real`).
    expect(ce.box(['ElementMax', 2, 5]).type.toString()).toBe('integer');
  });
  test('a non-finite operand keeps the declared extended-real claim', () => {
    // `±∞` are ordinary values of the declared carrier
    // (`real | signed_infinity`), so the handler declines the finite-tier
    // claim and the declared result shows, lifted per cell by the
    // broadcast. It used to widen to the shape-only `vector<2>`.
    expect(
      ce.box(['ElementMax', ['List', 1, 2], 'PositiveInfinity']).type.toString()
    ).toBe('list<real | signed_infinity^2>');
  });
  test('a non-real operand is off-carrier — an error at boxing', () => {
    // An extremum is defined by the ORDER of the real line, so `i` and
    // `~oo` are outside the declared carrier. These used to be admitted
    // and stay inert forever.
    expect(ce.box(['ElementMax', 'ImaginaryUnit', 1]).isValid).toBe(false);
    expect(ce.box(['Clamp', 'ComplexInfinity', 0, 1]).isValid).toBe(false);
  });
  test('a valueless cell does not get a finite-tier claim', () => {
    // An empty range makes the CELL type the bottom type `never`, which is
    // a subtype of every type and so answers TRUE to every tier test. The
    // handler must decline for it, or it claims `list<integer>` for an
    // operand that cannot hold a value. A local engine keeps the
    // declaration out of the shared one.
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'list<integer<2<..<3>>');
    expect(ce2.box('v').type.toString()).toBe('list<never>');
    expect(ce2.box(['ElementMax', 'v', 5]).type.toString()).toBe(
      'list<real | signed_infinity>'
    );
    expect(ce2.box(['Clamp', 'v', 0, 1]).type.toString()).toBe(
      'list<real | signed_infinity>'
    );
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
  test('NaN inside a collection absorbs, matching top-level Max/Min (B5)', () => {
    // Max(NaN, 5) → NaN, so Max([1, NaN, 3]) must also be NaN (was 3).
    expect(evalStr(['Max', 'NaN', 5])).toBe('NaN');
    expect(evalStr(['Max', ['List', 1, 'NaN', 3]])).toBe('NaN');
    expect(evalStr(['Min', ['List', 1, 'NaN', 3]])).toBe('NaN');
    // Nested collection: the NaN still absorbs.
    expect(evalStr(['Max', ['List', ['List', 1, 'NaN'], 3]])).toBe('NaN');
  });
});

describe('cross-target compilation', () => {
  const compileOn = (target: string, mj: any) =>
    ce._getCompilationTarget(target as any)!.compile(ce.box(mj));

  test('interval-js: Clamp clamps an interval (restores break detection)', () => {
    const r = compileOn('interval-js', ['Clamp', 'x', 0, 1]);
    expect(r.success).toBe(true);
    expect(r.run!({ x: { lo: -0.5, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 1 },
    });
  });

  test('interval-js: ElementMax/ElementMin fold over intervals', () => {
    expect(
      compileOn('interval-js', ['ElementMax', 'x', 0]).run!({
        x: { lo: -1, hi: 0.5 },
      })
    ).toEqual({ kind: 'interval', value: { lo: 0, hi: 0.5 } });
  });

  test('glsl/wgsl: map to native clamp/max/min', () => {
    for (const t of ['glsl', 'wgsl']) {
      expect(compileOn(t, ['Clamp', 'x', 0, 1]).code).toContain('clamp(');
      expect(compileOn(t, ['ElementMax', 'x', 0]).code).toContain('max(');
      expect(compileOn(t, ['ElementMin', 'x', 0]).code).toContain('min(');
    }
  });

  test('python: map to np.clip / np.maximum / np.minimum', () => {
    expect(compileOn('python', ['Clamp', 'x', 0, 1]).code).toContain('np.clip');
    expect(compileOn('python', ['ElementMax', 'x', 0]).code).toContain(
      'np.maximum'
    );
    expect(compileOn('python', ['ElementMin', 'x', 0]).code).toContain(
      'np.minimum'
    );
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
