import { ComputeEngine, compile } from '../../src/compute-engine';

// The lane of a linear-algebra head (`BaseCompiler.linearAlgebraLane`) selects
// the helper a target emits for it (a real one, or one that computes with
// complex entries) and is also the answer a parent expression reads for the
// value of the node. These tests check that every route agrees with that
// lane.

const MODES = ['strict', 'complex'] as const;

/** The value `v` as `[re, im]`: a number, a `{re, im}` object or a boxed
 * number. */
function parts(v: any): [number, number] {
  if (typeof v === 'number') return [v, 0];
  return [v.re, v.im];
}

describe('A USER FUNCTION THAT RETURNS A MATRIX', () => {
  const REAL_BODY = 't \\mapsto [[t, 1], [2, 3]]';

  // An undeclared function whose body is a literal matrix: its entries are
  // identified from the body, on the parse and the box routes.
  const UNDECLARED: Array<[string, (ce: ComputeEngine) => void]> = [
    ['parse', (ce) => ce.assign('g', ce.parse(REAL_BODY))],
    [
      'box',
      (ce) =>
        ce.assign(
          'g',
          ce.box(['Function', ['List', ['List', 't', 1], ['List', 2, 3]], 't'])
        ),
    ],
  ];
  for (const [route, assign] of UNDECLARED)
    for (const mode of MODES)
      it(`${mode}, ${route} route: Trace(g(x)) + 1 and Determinant(g(x)) + 1, g undeclared`, () => {
        const ce = new ComputeEngine();
        assign(ce);
        const trace = ce.box(['Add', ['Trace', ['g', 'x']], 1]);
        const det = ce.parse('\\operatorname{Determinant}(g(x)) + 1');
        // The signature of `g` says `(unknown) -> list<list<unknown>>` (its
        // parameter has no use that narrows it), so with a free `x` the
        // engine types the entries of `g(x)` as unknown. A free input with
        // no type is refused, so `x` is a parameter of the root function.
        const root = (e: any, type: string) =>
          ce.box(['Function', e.json, ['Typed', 'x', { str: type }]]);
        // With `x: any` the shape of the argument of `g(x)` is not settled,
        // and the compilation declines on every lane.
        for (const e of [trace, det]) {
          const r = compile(root(e, 'any'), { to: 'javascript', mode } as any);
          expect(r.success).toBe(false);
          expect(r.diagnostic?.code).toBe('unsettled-shape');
        }
      });
});

describe('A `Power` WHOSE BASE IS A MATRIX ONLY AFTER THE PARSE', () => {
  // Canonicalization writes `A^n` as `MatrixPower(A, n)` only when the type of
  // `A` is a matrix when the `Power` is built. `B^2` parsed before `B` holds a
  // matrix stays a `Power`, and `evaluate()` computes the matrix power for a
  // square matrix and an integer exponent (`isSquareMatrixPower()`).
  function assignedAfterParse(latex: string, value: string) {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    ce.assign('B', ce.parse(value));
    return expr;
  }

  it.each([
    ['B^2', '[[7,10],[15,22]]'],
    ['B^{3}', '[[37,54],[81,118]]'],
    ['B^{0}', '[[1,0],[0,1]]'],
    ['B^{-2}', '[[5.5,-2.5],[-3.75,1.75]]'],
  ])(
    '%s of a square matrix is the matrix power',
    (latex, value) => {
      const expr = assignedAfterParse(latex, '[[1, 2], [3, 4]]');
      expect(expr.N().toString()).toBe(value);
    }
  );
});

describe('THE GPU COMPLEX POWER AT ZERO', () => {
  // `_gpu_cpow(z, w)` is `exp(w · ln z)`, and at `z = 0` the product
  // `w · (−∞, 0)` has a NaN imaginary part. The interpreter answers 0 for a
  // positive real part of `w`: `Root(z, 4)` at `z = 0` is 0.
  it('the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    expect(parts(ce.parse('\\sqrt[4]{z}').subs({ z: 0 }).N())).toEqual([0, 0]);
  });
});
