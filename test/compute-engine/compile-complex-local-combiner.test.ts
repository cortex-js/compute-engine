/**
 * A block-local function that receives complex numbers.
 *
 * The block binds a local function once (`g = (a, b) => a + b`), and the
 * body of that binding is compiled in the lane of the parameter types of
 * its literal. A parameter with no complex type is a real number there, so
 * a call with `{re, im}` arguments used the real `+`, which joins two
 * objects as strings: `Reduce(L, g, 0)` over `[1 + i, 2]` gave the string
 * "[object Object][object Object][object Object]", where the interpreter
 * gives `3 + i`. Such a call is now a lane mismatch, as for an
 * engine-level function. In `mode: 'auto'` (the default) the compilation
 * starts again in `mode: 'complex'`, where the local compiles in the
 * complex lane. In `mode: 'strict'` the compilation declines.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('h', ce.box(['Function', ['Multiply', 3, 'p'], 'p'] as any));
ce.assign('k', ce.box(['Function', ['Add', 'p', 'q'], 'p', 'q'] as any));

const L = ['List', ['Complex', 1, 1], ['Complex', 2, 0]];
const jsL = [
  { re: 1, im: 1 },
  { re: 2, im: 0 },
];

const local = (value: unknown, type = "'function'") => [
  ['Declare', 'g', type],
  ['Assign', 'g', value],
];
const add = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

/** The function of `L: list<complex>` whose body is the block `stmts`. */
function fn(...stmts: unknown[]) {
  return ['Function', ['Block', ...stmts], ['Typed', 'L', "'list<complex>'"]];
}

/** A complex value of the interpreter or of the compiled code. */
function parts(v: unknown): [number, number] {
  if (typeof v === 'number') return [v, 0];
  const z = v as { re: number; im: number };
  return [z.re, z.im];
}

function expectSameValue(json: unknown, options: Record<string, unknown> = {}) {
  const interp = ce.box(['Apply', json, L] as any).evaluate();
  const expected = interp.isCollection ? [...interp.each()] : [interp];
  const r = compile(ce.box(json as any), { fallback: false, ...options })!;
  expect(r.success).toBe(true);
  const out = r.run!(jsL);
  const actual = Array.isArray(out) ? out : [out];
  expect(actual.length).toBe(expected.length);
  expected.forEach((x, i) => {
    const [re, im] = parts(actual[i]);
    expect(re).toBeCloseTo(x.re, 12);
    expect(im).toBeCloseTo(x.im, 12);
  });
}

describe('A block-local function called with complex arguments', () => {
  test('Reduce with a local combiner', () => {
    expectSameValue(fn(...local(add), ['Reduce', 'L', 'g', 0]));
  });

  test('Reduce with a local combiner with complex parameters', () => {
    const typed = [
      'Function',
      ['Add', 'a', 'b'],
      ['Typed', 'a', "'complex'"],
      ['Typed', 'b', "'complex'"],
    ];
    expectSameValue(fn(...local(typed), ['Reduce', 'L', 'g', 0]));
    expectSameValue(fn(...local(typed), ['Reduce', 'L', 'g', 0]), {
      mode: 'strict',
    });
  });

  test('Reduce with a declared signature and a captured local', () => {
    expectSameValue(
      fn(
        ['Declare', 'w', "'integer'"],
        ['Assign', 'w', 10],
        ...local(
          ['Function', ['Add', 'p', 'q', 'w'], 'p', 'q'],
          "'(complex, complex) -> complex'"
        ),
        ['Reduce', 'L', 'g', 0]
      )
    );
  });

  test('Fold and Scan with a local combiner', () => {
    expectSameValue(fn(...local(add), ['Fold', 'g', 0, 'L']));
    expectSameValue(fn(...local(add), ['Scan', 'L', 'g', 0]));
  });

  test('Map with a local function', () => {
    expectSameValue(
      fn(...local(['Function', ['Multiply', 2, 'a'], 'a']), ['Map', 'g', 'L'])
    );
  });

  test('a direct call with complex arguments', () => {
    expectSameValue(
      fn(...local(add), ['g', ['At', 'L', 1], ['At', 'L', 2]])
    );
  });

  test('an engine-level function as combiner and callback', () => {
    expectSameValue(fn(['Reduce', 'L', 'k', 0]));
    expectSameValue(fn(['Map', 'h', 'L']));
  });

  test('strict mode declines a parameter that is not complex', () => {
    for (const body of [
      ['Reduce', 'L', 'g', 0],
      ['Map', 'g', 'L'],
      ['g', ['At', 'L', 1], ['At', 'L', 2]],
    ]) {
      const value =
        body[0] === 'Map' ? ['Function', ['Multiply', 2, 'a'], 'a'] : add;
      expect(() =>
        compile(ce.box(fn(...local(value), body) as any), {
          fallback: false,
          mode: 'strict',
        } as any)
      ).toThrow(/Lane mismatch at block-local function/);
    }
  });

  test('Map with a local function with a parameter with a default', () => {
    const scaled = ['Function', ['Multiply', 'a', 'k'], 'a', ['Optional', 'k', 2]];
    expectSameValue(fn(...local(scaled), ['Map', 'g', 'L']));
    expect(() =>
      compile(ce.box(fn(...local(scaled), ['Map', 'g', 'L']) as any), {
        fallback: false,
        mode: 'strict',
      } as any)
    ).toThrow(/Lane mismatch at block-local function value position/);
  });

  test('strict mode: a complex tuple at a parameter with no type', () => {
    // The call is written with the body of the function, which binds the
    // tuple whole, so the compilation is sound in strict mode.
    const json = [
      'Function',
      [
        'Block',
        ...local(['Function', ['Multiply', 2, 'v'], 'v']),
        ['g', 'p'],
      ],
      ['Typed', 'p', "'tuple<complex, complex>'"],
    ];
    const interp = ce
      .box(['Apply', json, ['Tuple', ['Complex', 1, 1], 2]] as any)
      .evaluate();
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    } as any)!;
    expect(r.success).toBe(true);
    const out = r.run!([
      { re: 1, im: 1 },
      { re: 2, im: 0 },
    ]) as unknown[];
    expect(out.length).toBe(2);
    interp.ops!.forEach((x, i) => {
      const [re, im] = parts(out[i]);
      expect(re).toBeCloseTo(x.re, 12);
      expect(im).toBeCloseTo(x.im, 12);
    });
  });

  test('strict mode: a declared signature does not set the lane', () => {
    // The literal has no parameter types, and the `Declare` signature does
    // not change the lane of its body. The message says so, and names the
    // accumulator, not a name that the compiler made.
    const json = fn(
      ...local(add, "'(complex, complex) -> complex'"),
      ['Reduce', 'L', 'g', 0]
    );
    let message = '';
    try {
      compile(ce.box(json as any), { fallback: false, mode: 'strict' } as any);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/the complex accumulator of the fold/);
    expect(message).toMatch(/a signature declared with `Declare`/);
    expect(message).not.toMatch(/_a/);
    // The default mode compiles it in the complex lane.
    expectSameValue(json);
  });

  test('strict mode: an element of the collection is named', () => {
    const accTyped = [
      'Function',
      ['Add', 'a', 'b'],
      ['Typed', 'a', "'complex'"],
      'b',
    ];
    const json = fn(...local(accTyped), ['Reduce', 'L', 'g', 0]);
    expect(() =>
      compile(ce.box(json as any), { fallback: false, mode: 'strict' } as any)
    ).toThrow(/an element of `L` reaches the parameter `b` of `g`/);
    expectSameValue(json);
  });

  test('a point with a complex coordinate at a parameter that is not a scalar', () => {
    // The parameter `p` is inferred as a point from `p[1]`, so the call is
    // not written with the body of the function, and the body reads the
    // coordinates as real numbers in strict mode.
    const first = ['Function', ['Add', ['At', 'p', 1], 1], 'p'];
    for (const point of [
      ['Tuple', ['At', 'L', 1], 2],
      ['Tuple', ['At', 'L', 1], ['At', 'L', 2]],
    ]) {
      const json = fn(...local(first), ['g', point]);
      expectSameValue(json);
      expect(() =>
        compile(ce.box(json as any), { fallback: false, mode: 'strict' } as any)
      ).toThrow(/Lane mismatch at block-local function parameter/);
    }
  });

  test('Map and Reduce over a list of points with complex coordinates', () => {
    const P = [
      'List',
      ['Tuple', ['Complex', 1, 1], 2],
      ['Tuple', ['Complex', 2, 0], 3],
    ];
    const jsP = [
      [{ re: 1, im: 1 }, 2],
      [{ re: 2, im: 0 }, 3],
    ];
    const ofP = (...stmts: unknown[]) => [
      'Function',
      ['Block', ...stmts],
      ['Typed', 'P', "'list<tuple<complex, real>>'"],
    ];
    const cases = [
      ofP(
        ...local(['Function', ['Add', ['At', 'p', 1], 1], 'p']),
        ['Map', 'g', 'P']
      ),
      ofP(
        ...local(['Function', ['Add', 'a', ['At', 'v', 1]], 'a', 'v']),
        ['Reduce', 'P', 'g', 0]
      ),
    ];
    for (const json of cases) {
      const interp = ce.box(['Apply', json, P] as any).evaluate();
      const expected = interp.isCollection ? [...interp.each()] : [interp];
      const r = compile(ce.box(json as any), { fallback: false })!;
      expect(r.success).toBe(true);
      const out = r.run!(jsP);
      const actual = Array.isArray(out) ? out : [out];
      expect(actual.length).toBe(expected.length);
      expected.forEach((x, i) => {
        const [re, im] = parts(actual[i]);
        expect(re).toBeCloseTo(x.re, 12);
        expect(im).toBeCloseTo(x.im, 12);
      });
      expect(() =>
        compile(ce.box(json as any), { fallback: false, mode: 'strict' } as any)
      ).toThrow(/Lane mismatch at block-local function/);
    }
  });

  test('strict mode: a parameter typed as a point with a complex coordinate', () => {
    // The type of `p` holds a complex type in a component of the tuple, so
    // the body reads that coordinate in the complex lane.
    const first = [
      'Function',
      ['Add', ['At', 'p', 1], 1],
      ['Typed', 'p', "'tuple<complex, number>'"],
    ];
    const json = fn(...local(first), ['g', ['Tuple', ['At', 'L', 1], 2]]);
    expectSameValue(json, { mode: 'strict' });
  });

  test('a recursive type alias does not make the lane test loop', () => {
    // `typeHasComplexLeaf()` walks the type of the elements, and the alias
    // `jsonv` meets itself at each level.
    const ce2 = new ComputeEngine();
    ce2.declareType('jsonv', 'integer | list<jsonv>', { alias: true });
    const J = ['List', ['List', 1, 2], ['List', 3]];
    const ofJ = (...stmts: unknown[]) => [
      'Function',
      ['Block', ...stmts],
      ['Typed', 'J', "'list<jsonv>'"],
    ];
    const cases = [
      ofJ(
        ...local(['Function', ['Add', ['At', 'p', 1], 1], 'p']),
        ['Map', 'g', 'J']
      ),
      ofJ(
        ...local(['Function', ['Add', 'a', ['At', 'v', 1]], 'a', 'v']),
        ['Reduce', 'J', 'g', 0]
      ),
    ];
    for (const json of cases) {
      for (const mode of ['auto', 'strict']) {
        const interp = ce2.box(['Apply', json, J] as any).evaluate();
        const expected = interp.isCollection
          ? [...interp.each()].map((x) => x.re)
          : interp.re;
        const r = compile(ce2.box(json as any), {
          fallback: false,
          mode,
        } as any)!;
        expect(r.success).toBe(true);
        expect(r.run!([[1, 2], [3]])).toEqual(expected);
      }
    }
  });

  test('a real list keeps the real lane', () => {
    const json = [
      'Function',
      ['Block', ...local(add), ['Reduce', 'R', 'g', 0]],
      ['Typed', 'R', "'list<real>'"],
    ];
    const r = compile(ce.box(json as any), { fallback: false })!;
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('cplx');
    expect(r.run!([1, 2])).toBe(3);
  });
});
