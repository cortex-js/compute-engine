import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A POINT — a numeric tuple — states its width in its type, so arithmetic
// over points whose every operand is a point of that width, or a scalar
// where the interpreter admits one, is emitted component by component on the
// `javascript` target, and the inner product of two such points is written
// out as the sum of the component products. Before this, a tuple-typed CALL
// (a user function returning a point) plus a literal point went through the
// `_SYS.bcast` run-time dispatch, and every `Dot` through `_SYS.matmul`.
//
// The point rules follow the interpreter: a point summed with a scalar is an
// `incompatible-type` error there, so that shape fails closed instead of
// answering a plausible array.
//
// Every block checks the emitted TEXT and the VALUE the compiled function
// returns against what the interpreter answers for the same input.

/** A fresh engine per block: a declaration must not leak between blocks. */
function newEngine(declarations: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(declarations))
    ce.declare(name, type as any);
  return ce;
}

function compiled(ce: ComputeEngine, latex: string) {
  const r = compile(ce.parse(latex), { fallback: false });
  if (!r.success || r.run === undefined)
    throw new Error(`did not compile: ${latex} — ${r.error}`);
  return { code: (r.preamble ?? '') + r.code, run: r.run };
}

/** The user function `S(x, y) = (-mod(x, 1), -mod(y, 1))` in the spelling
 * the Tycho importer uses: an open arrow, refined at assignment to a numeric
 * tuple result. */
function withPointFunction(ce: ComputeEngine): void {
  ce.declare('S', {
    type: '(unknown, unknown) -> unknown',
    value: ce.parse(
      '(x,y)\\mapsto (-\\operatorname{mod}(x,1), -\\operatorname{mod}(y,1))'
    ),
  } as any);
  expect(ce.box('S').type.toString()).toBe(
    '(unknown, unknown) -> tuple<real, real>'
  );
}

describe('point arithmetic fans out by the width of the tuple type', () => {
  test('a point-returning call plus a literal point', () => {
    const ce = newEngine({ x: 'real', y: 'real' });
    withPointFunction(ce);
    const { code, run } = compiled(ce, 'S(x,y)+(0,0)');
    // The call's result is read component by component. Its static type
    // `tuple<real, real>` is the shape of the value (the compiler assumes
    // that every value holds its static type, ROADMAP CE-712.1), so there is
    // no shape test and no `_SYS.bcast` fallback.
    expect(code).toContain(
      '((_tv3) => [(_tv3[0] + 0), (_tv3[1] + 0)])(_fn_S(_.x, _.y))'
    );
    expect(code).not.toContain('_SYS.bcast(');
    expect(run({ x: 0.3, y: 0.7 })).toEqual([-0.3, -0.7]);
  });

  test('scalar times point, point over scalar, negated point', () => {
    const ce = newEngine({ x: 'real', y: 'real' });
    withPointFunction(ce);
    for (const [latex, expected] of [
      ['2S(x,y)', [-0.6, -1.4]],
      ['S(x,y)/2', [-0.15, -0.35]],
      ['-S(x,y)', [0.3, 0.7]],
      ['S(x,y)-(1,2)', [-1.3, -2.7]],
      ['S(x,y)+(1,0)+(2,2)', [2.7, 1.3]],
    ] as const) {
      const { code, run } = compiled(ce, latex);
      // Component by component, with no shape test of the call's result.
      expect(code).toMatch(/\[\(.*_tv\d+\[0\].*\), \(.*_tv\d+\[1\].*\)\]/);
      expect(code).not.toContain('_SYS.bcast(');
      const out = run({ x: 0.3, y: 0.7 }) as number[];
      out.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
    }
  });

  test('two literal points are written out with no temporary', () => {
    const ce = newEngine({ a: 'real', b: 'real', c: 'real', d: 'real' });
    const { code, run } = compiled(ce, '(a,b)+(c,d)');
    expect(code).toBe('[(_.a + _.c), (_.b + _.d)]');
    expect(run({ a: 1, b: 2, c: 10, d: 20 })).toEqual([11, 22]);
  });

  test('a declared point input fans out with no shape test', () => {
    // The host supplies `P` with a value of its declared type, so the code
    // reads its components with no run-time test of its shape.
    const ce = newEngine({ P: 'tuple<number, number>' });
    const { code, run } = compiled(ce, 'P+(1,2)');
    expect(code).toBe('[(_.P[0] + 1), (_.P[1] + 2)]');
    expect(run({ P: [1, 2] })).toEqual([2, 4]);
  });

  test('a point summed with a scalar fails closed', () => {
    // `(x, y) + 3` is an `incompatible-type` error in the interpreter for
    // whatever `x` and `y` hold. It used to compile to `_SYS.bcast` and run to
    // `[3.3, 3.7]`.
    const ce = newEngine();
    // Once the types of `x` and `y` are up to date, the sum is found invalid
    // before its lowering ("Cannot compile invalid expression: …
    // incompatible-type").
    expect(() => compile(ce.parse('(x,y)+3'), { fallback: false })).toThrow(
      /could not compile/i
    );
    expect(compile(ce.parse('(x,y)+3')).success).toBe(false);
    expect(ce.parse('(x,y)+3').subs({ x: 0.3, y: 0.7 }).N().operator).toBe(
      'Error'
    );
  });

  test('a sum over a declared point is folded term by term', () => {
    const ce = newEngine({ P: 'tuple<number, number>' });
    const { code, run } = compiled(ce, '\\operatorname{Sum}(P)');
    expect(code).toContain('(0 + _tv1[0] + _tv1[1])');
    expect(run({ P: [1, 2] })).toBe(3);
  });
});

describe('the inner product of two static-width points is written out', () => {
  test('a declared point against a literal point', () => {
    const ce = newEngine({ P: 'tuple<number, number>' });
    const { code, run } = compiled(ce, '\\operatorname{Dot}(P,(1,2))');
    expect(code).toBe(
      '((_tv1, _tv2) => Array.isArray(_tv1) && _tv1.length === 2 && ' +
        '!Array.isArray(_tv1[0]) ? ' +
        '(_tv1[0] * _tv2[0] + _tv1[1] * _tv2[1]) : ' +
        '_SYS.matmul(_tv1, _tv2))(_.P, [1, 2])'
    );
    expect(run({ P: [1, 2] })).toBe(5);
    // The fallback answers a shape the type did not promise as `_SYS.matmul`
    // does: two vectors of differing length have no inner product.
    expect(run({ P: [1, 2, 3] })).toBeNaN();
  });

  test('two literal points need no temporary at all', () => {
    const ce = newEngine({ a: 'real', b: 'real', c: 'real', d: 'real' });
    const { code, run } = compiled(ce, '\\operatorname{Dot}((a,b),(c,d))');
    expect(code).toBe('(_.a * _.c + _.b * _.d)');
    expect(run({ a: 1, b: 2, c: 3, d: 4 })).toBe(11);
  });

  test('a point-returning call against a literal point', () => {
    const ce = newEngine({ x: 'real', y: 'real' });
    withPointFunction(ce);
    const { code, run } = compiled(ce, '\\operatorname{Dot}(S(x,y),(1,2))');
    expect(code).not.toContain('_SYS.bcast(');
    // Written out, with no shape test of the call's result.
    expect(code).toContain(
      '((_tv1) => (_tv1[0] * 1 + _tv1[1] * 2))(_fn_S(_.x, _.y))'
    );
    expect(run({ x: 0.3, y: 0.7 })).toBeCloseTo(-1.7, 12);
  });

  test('a literal point of floors inside a user-function body', () => {
    // The shape of Tycho's `p_rand` hash, inlined: no `_SYS.matmul`, no
    // array built only to be read back.
    const ce = newEngine({ s: 'real' });
    ce.assign('s', 2.41);
    const { code, run } = compiled(
      ce,
      '\\operatorname{Dot}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s),(12.9898,78.233,45.164))'
    );
    expect(code).toBe(
      '(Math.floor(_.x) * 12.9898 + Math.floor(_.y) * 78.233 + 2.41 * 45.164)'
    );
    expect(run({ x: 0.3, y: 1.7 })).toBeCloseTo(78.233 + 2.41 * 45.164, 9);
  });

  test('two declared vectors of one width', () => {
    const ce = newEngine({ V: 'vector<3>', W: 'vector<3>' });
    const { code, run } = compiled(ce, '\\operatorname{Dot}(V, W)');
    expect(code).toContain(
      '_tv1[0] * _tv2[0] + _tv1[1] * _tv2[1] + _tv1[2] * _tv2[2]'
    );
    expect(run({ V: [1, 2, 3], W: [4, 5, 6] })).toBe(32);
  });

  test('shapes that keep the run-time dispatch', () => {
    // An input with no type is refused (ROADMAP CE-712.1); a width of five
    // or more and a complex component are not written out. The
    // run-time dispatch is the real-only `_SYS.matmul` when the entries are
    // real: a `vector<real^5>` is real by its type. A `vector<5>` (whose entries are
    // `number`) is read as real in the default mode too. The runner does not
    // read the entries of a list input (user decision of 2026-10-13: the
    // compiled `run()` requires inputs of the shape the compiled code reads;
    // a per-call walk of the entries was the whole cost of the kernel of
    // Tycho ledger row 371), so a complex entry is not refused, and the value
    // the real `_SYS.matmul` computes with it is not specified.
    const ce = newEngine({
      V: 'vector<5>',
      W: 'vector<5>',
      A: 'vector<real^5>',
      B: 'vector<real^5>',
    });
    const untyped = compile(ce.parse('\\operatorname{Dot}((x,y),(1,2))'));
    expect(untyped.success).toBe(false);
    expect(untyped.diagnostic?.code).toBe('untyped-input');
    expect(untyped.unsupported).toEqual(expect.arrayContaining(['x', 'y']));
    const vw = compiled(ce, '\\operatorname{Dot}(V, W)');
    expect(vw.code).toBe('_SYS.matmul(_.V, _.W)');
    expect(vw.run({ V: [1, 2, 3, 4, 5], W: [1, 1, 1, 1, 2] })).toBe(20);
    expect(() =>
      vw.run({ V: [1, 2, 3, 4, { re: 0, im: 1 }], W: [1, 1, 1, 1, 1] })
    ).not.toThrow();
    expect(compiled(ce, '\\operatorname{Dot}(A, B)').code).toBe(
      '_SYS.matmul(_.A, _.B)'
    );
    // A complex component is not written out. The run-time dispatch takes
    // the complex form of `_SYS.matmul`, so at `Q = (i, 1)` it answers
    // `2 + i`, as the interpreter does.
    const cplx = newEngine({ Q: 'tuple<complex, complex>' });
    const dot = compiled(cplx, '\\operatorname{Dot}(Q, (1, 2))');
    expect(dot.code).toBe('_SYS.complexMatmul(_.Q, [1, 2])');
    expect(dot.run({ Q: [{ re: 0, im: 1 }, 1] })).toEqual({ re: 2, im: 1 });
    expect(
      cplx
        .parse('\\operatorname{Dot}((\\imaginaryI, 1), (1, 2))')
        .N()
        .toString()
    ).toBe('(2 + i)');
  });
});

describe('a component read is spliced only where it stays sound', () => {
  test('a compound component keeps its parentheses', () => {
    // An element of an emitted array literal is compiled at precedence zero,
    // so `a + b` arrives with no parentheses of its own. Spliced bare into a
    // product, it lost the sum: `Dot((a+b,c),(d,e))` emitted
    // `(_.a + _.b * _.d + _.c * _.e)` and ran to 24.
    const ce = newEngine({
      a: 'real',
      b: 'real',
      c: 'real',
      d: 'real',
      e: 'real',
    });
    const vars = { a: 1, b: 2, c: 3, d: 4, e: 5 };

    const dot = compiled(ce, '\\operatorname{Dot}((a+b,c),(d,e))');
    expect(dot.code).toBe('((_.a + _.b) * _.d + _.c * _.e)');
    expect(dot.run(vars)).toBe(27);
    expect(
      ce.parse('\\operatorname{Dot}((a+b,c),(d,e))').subs(vars).N().re
    ).toBe(27);

    // The same splice in the component fan-out: `2(a+b,c)` emitted
    // `[(2 * _.a + _.b), (2 * _.c)]` and ran to `[4, 6]`.
    const scaled = compiled(ce, '2(a+b,c)');
    expect(scaled.code).toBe('[(2 * (_.a + _.b)), (2 * _.c)]');
    expect(scaled.run(vars)).toEqual([6, 6]);
    expect(
      ce
        .parse('2(a+b,c)')
        .subs(vars)
        .N()
        .ops!.map((op) => op.re)
    ).toEqual([6, 6]);
  });

  test('an atomic component gains no parentheses', () => {
    const ce = newEngine({ s: 'real' });
    ce.assign('s', 2.41);
    // A call and a name are already atomic, so they are spliced as they are.
    expect(
      compiled(
        ce,
        '\\operatorname{Dot}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s),(1,2,3))'
      ).code
    ).toBe('(Math.floor(_.x) * 1 + Math.floor(_.y) * 2 + 2.41 * 3)');
  });
});

describe('a caller may put a shape the declared type did not promise in `vars`', () => {
  // A declared type constrains what the ENGINE assigns, never what a caller
  // supplies. A MATRIX passes a length test, so both fast paths must claim
  // the rank as well and hand every other shape to the run-time helper.
  test('a matrix reaches `_SYS.matmul`, not the written-out inner product', () => {
    const ce = newEngine({ P: 'tuple<number, number>' });
    const { code, run } = compiled(ce, '\\operatorname{Dot}(P,(1,2))');
    expect(code).toContain('!Array.isArray(_tv1[0])');
    // The inner product read each row as a scalar and answered NaN.
    expect(run({ P: [[1, 2] as any, [3, 4] as any] })).toEqual([5, 11]);
    const interpreted = ce
      .box(['Dot', ['List', ['List', 1, 2], ['List', 3, 4]], ['List', 1, 2]])
      .N();
    expect(interpreted.ops!.map((op) => op.re)).toEqual([5, 11]);
  });
});
