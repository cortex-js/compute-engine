import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Element-wise arithmetic over a collection whose WIDTH is known at compile
// time is emitted as one expression per component on the `javascript` target,
// instead of the `_SYS.bcast` run-time dispatch: a closure, a shape test and a
// call per element where the additions could simply be written out. The narrow
// widths are the ones covered — from `MIN_UNROLLED_WIDTH` (five) up, the
// collection keeps the run-time helper, which is then both the shorter and the
// faster lowering.
//
// The second half of the file covers the lane the same expressions used to
// take: a reduction over a REAL vector was classified as possibly complex, so
// the sum of a two-component real vector was wrapped in `_SYS.cplx` and its
// consumers emitted complex arithmetic (`_SYS.cneg`, a complex square).
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

/** What the interpreter answers for `latex` with `vars` assigned. */
function interpreted(
  latex: string,
  vars: Record<string, number | number[]>
): number | number[] {
  const ce = new ComputeEngine();
  for (const [name, value] of Object.entries(vars))
    ce.assign(
      name,
      Array.isArray(value) ? ce.box(['List', ...value]) : ce.number(value)
    );
  const v = ce.parse(latex).N();
  if (v.operator === 'List' && v.ops !== null)
    return v.ops.map((op) => op.re as number);
  return v.re as number;
}

describe('a static width is emitted component by component', () => {
  test('`W + 1` over a `list<number^4>` fans out behind a shape test', () => {
    // A declared type constrains what the ENGINE may assign, not what a caller
    // may put in the `vars` object, so the components are read only after a
    // run-time test that the operand really is a four-element array. The
    // `_SYS.bcast` call is the else branch, and nothing on the fast path
    // allocates it.
    const ce = newEngine({ W: 'list<number^4>' });
    const { code, run } = compiled(ce, 'W+1');
    expect(code).toBe(
      '((_tv3) => Array.isArray(_tv3) && _tv3.length === 4 ? ' +
        '[(_tv3[0] + 1), (_tv3[1] + 1), (_tv3[2] + 1), (_tv3[3] + 1)] : ' +
        '_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _tv3, 1))(_.W)'
    );
    expect(run({ W: [1, 2, 3, 4] })).toEqual([2, 3, 4, 5]);
    expect(run({ W: [1, 2, 3, 4] })).toEqual(
      interpreted('W+1', { W: [1, 2, 3, 4] })
    );
  });

  test('a NaN component propagates in that component only', () => {
    const ce = newEngine({ W: 'list<number^4>' });
    const { run } = compiled(ce, 'W+1');
    const out = run({ W: [1, NaN, 3, 4] }) as number[];
    expect(out[0]).toBe(2);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(4);
    expect(out[3]).toBe(5);
  });

  test('a chain of element-wise heads fans out at every hop', () => {
    const ce = newEngine({ W: 'list<number^4>', x: 'real' });
    const { code, run } = compiled(ce, '\\sin(W)\\cdot x');
    // Four `Math.sin` calls for the components, plus the one in the closure
    // the shape test falls back to.
    expect(code.split('Math.sin(').length - 1).toBe(5);
    expect(code).toContain('Array.isArray');
    const vars = { W: [0.25, 0.5, 0.75, 1], x: 3 };
    const out = run(vars) as number[];
    const expected = interpreted('\\sin(W)\\cdot x', vars) as number[];
    out.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
  });

  test('each operand is still evaluated exactly once', () => {
    // The two calls are bound to temporaries and read four times each. A
    // fan-out that spliced the call text instead would call `f` four times.
    const ce = newEngine({ x: 'real' });
    ce.parse('f(t):=[t, 2t]').evaluate();
    const { code, run } = compiled(ce, 'f(x)+f(2x)');
    expect(code.split('_fn_f(').length - 1).toBe(2);
    expect(run({ x: 3 })).toEqual([9, 18]);
  });

  test('a width of five or more keeps the run-time helper', () => {
    // `MIN_UNROLLED_WIDTH`: writing out the components stops paying there, and
    // a wide collection is the shape `_SYS.bcast` was written for.
    const ce = newEngine({ V: 'list<number^8>' });
    const { code, run } = compiled(ce, 'V+1');
    expect(code).toContain('_SYS.bcast');
    expect(run({ V: [1, 2, 3, 4, 5, 6, 7, 8] })).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  test('an unprovable width keeps the run-time helper', () => {
    // A bare `list<number>` states no width, so no component count exists.
    const ce = newEngine({ L: 'list<number>' });
    const { code, run } = compiled(ce, 'L+1');
    expect(code).toContain('_SYS.bcast');
    expect(run({ L: [1, 2] })).toEqual([2, 3]);
    expect(run({ L: [1, 2, 3, 4, 5] })).toEqual([2, 3, 4, 5, 6]);
  });

  test('a narrow reduction over a known width is folded term by term', () => {
    // The terms sit in the THEN branch of a shape test, for the same reason
    // the component fan-out carries one: a declared width constrains what the
    // ENGINE may assign, not what a caller may put in the `vars` object.
    const ce = newEngine({ V: 'list<real^3>' });
    const { code, run } = compiled(ce, '\\sum(V)');
    const then = code.slice(code.indexOf('? '), code.indexOf(' : '));
    expect(then).toContain('0 + _tv1[0] + _tv1[1] + _tv1[2]');
    expect(then).not.toContain('.reduce(');
    expect(code).toBe(
      '((_tv1) => Array.isArray(_tv1) && _tv1.length === 3 ? ' +
        '(0 + _tv1[0] + _tv1[1] + _tv1[2]) : ' +
        '(_tv1).reduce((_a, _b) => _a + _b, 0))(_.V)'
    );
    expect(run({ V: [2, 5, -1] })).toBe(6);
    expect(run({ V: [2, 5, -1] })).toBe(
      interpreted('\\sum(V)', { V: [2, 5, -1] })
    );
  });

  test('a run-time shape that contradicts the declared width folds anyway', () => {
    // The reference is the SAME reduction with the width dropped from the
    // declaration, which reaches the `reduce` fold with no term-by-term arm.
    const fixed = compiled(newEngine({ V: 'list<real^3>' }), '\\sum(V)').run;
    const wide = compiled(newEngine({ V: 'list<real>' }), '\\sum(V)').run;
    // An absent operand has no `reduce` method, on either lowering.
    expect(() => wide({})).toThrow();
    expect(() => fixed({})).toThrow();
    // A SHORTER list sums its own elements, not three of them.
    expect(fixed({ V: [1, 2] })).toBe(wide({ V: [1, 2] }));
    expect(fixed({ V: [1, 2] })).toBe(3);
    // A LONGER list sums all of them, not the first three.
    expect(fixed({ V: [1, 2, 3, 4, 5] })).toBe(wide({ V: [1, 2, 3, 4, 5] }));
    expect(fixed({ V: [1, 2, 3, 4, 5] })).toBe(15);
    // A plain number is not a collection on either lowering.
    expect(() => wide({ V: 2 })).toThrow();
    expect(() => fixed({ V: 2 })).toThrow();
  });

  test('a wide reduction keeps the `reduce` fold', () => {
    const ce = newEngine({ V: 'list<real^6>' });
    const { code, run } = compiled(ce, '\\sum(V)');
    expect(code).toContain('.reduce(');
    expect(run({ V: [1, 2, 3, 4, 5, 6] })).toBe(21);
  });
});

describe('a run-time shape that contradicts the declared width', () => {
  // The fan-out reads its operand by index. A declared type constrains what
  // the ENGINE may assign, not what a caller may put in the kernel's `vars`
  // object, so the operand can arrive absent, shorter, longer, or as a plain
  // number. Each of those must answer exactly what the `_SYS.bcast` lowering
  // answers — obtained here by compiling the same expression with the width
  // dropped from the declaration.

  /** `W+1` with `W` a four-wide list: the component fan-out. */
  const fixed = () => compiled(newEngine({ W: 'list<number^4>' }), 'W+1');
  /** `W+1` with `W` a list of unstated width: the `_SYS.bcast` lowering. */
  const wide = () => compiled(newEngine({ W: 'list<number>' }), 'W+1');

  test('an absent operand answers NaN, as the broadcast helper does', () => {
    const reference = wide().run({}) as number;
    expect(Number.isNaN(reference)).toBe(true);
    expect(Number.isNaN(fixed().run({}) as number)).toBe(true);
  });

  test('a SHORTER list answers the shorter result', () => {
    expect(fixed().run({ W: [1, 2] })).toEqual(wide().run({ W: [1, 2] }));
    expect(fixed().run({ W: [1, 2] })).toEqual([2, 3]);
  });

  test('a LONGER list answers the longer result', () => {
    const vars = { W: [1, 2, 3, 4, 5, 6] };
    expect(fixed().run(vars)).toEqual(wide().run(vars));
    expect(fixed().run(vars)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  test('a plain number answers a plain number', () => {
    expect(fixed().run({ W: 2 })).toEqual(wide().run({ W: 2 }));
    expect(fixed().run({ W: 2 })).toBe(3);
  });

  test('a well-shaped input still runs the component code', () => {
    const { code, run } = fixed();
    // The components sit in the THEN branch of the shape test, so the fast
    // path allocates neither the closure nor the result of a call per element.
    const then = code.slice(code.indexOf('? '), code.indexOf(' : '));
    expect(then).toContain('_tv3[0] + 1');
    expect(then).toContain('_tv3[3] + 1');
    expect(run({ W: [1, 2, 3, 4] })).toEqual([2, 3, 4, 5]);
  });

  test('an array LITERAL operand needs no shape test', () => {
    // A `List` node compiles to an array literal of exactly the declared
    // width, so its shape is settled by reading the emitted text.
    const ce = newEngine({ x: 'real' });
    const { code, run } = compiled(ce, '[1,2,3]+x');
    expect(code).not.toContain('Array.isArray');
    expect(code).not.toContain('_SYS.bcast');
    expect(run({ x: 1 })).toEqual([2, 3, 4]);
  });
});

describe('a real vector reduction stays on the real lane', () => {
  // `f(x, y) := [-y, x] / (x² + y²)` is a real two-vector, so the sum of its
  // components is a real number. The lane analysis used to stop at the
  // arithmetic and at the call — neither was "real by construction" — and the
  // whole row was then emitted with complex kernels.
  const row = '1-(\\sum(f(x+1,y+3)+f(x-1,y+3)))^2';
  const withF = () => {
    const ce = newEngine({ x: 'real', y: 'real' });
    ce.parse('f(x,y):=\\frac{[-y, x]}{x^2+y^2}').evaluate();
    return ce;
  };

  test('the row emits no complex kernel, and no run-time broadcast on the fast path', () => {
    const { code } = compiled(withF(), row);
    expect(code).not.toContain('_SYS.cneg');
    expect(code).not.toContain('_SYS.cplx');
    expect(code).not.toContain('_SYS.pow(');
    expect(code).not.toContain('_SYS.sadd');
    // The run-time broadcast survives only as the ELSE branch of a shape
    // test, which a correctly shaped input never reaches: every `_SYS.bcast`
    // in the emitted source is preceded by `: `.
    expect(code.split('_SYS.bcast(').length).toBe(
      code.split(' : _SYS.bcast(').length
    );
  });

  test('the row agrees with the interpreter at several points', () => {
    const { run } = compiled(withF(), row);
    for (const [x, y] of [
      [0.5, 1],
      [-2, 0.25],
      [3, -1.5],
      [0, 0.5],
    ]) {
      const ce = new ComputeEngine();
      ce.parse('f(x,y):=\\frac{[-y, x]}{x^2+y^2}').evaluate();
      ce.assign('x', x);
      ce.assign('y', y);
      expect(run({ x, y }) as number).toBeCloseTo(ce.parse(row).N().re, 10);
    }
  });

  test('the sum of a real two-vector is a plain number', () => {
    const ce = newEngine({ x: 'real', y: 'real' });
    const { code, run } = compiled(ce, '\\sum([x, -y] \\cdot 2)');
    expect(code).not.toContain('_SYS.cplx');
    expect(run({ x: 3, y: 1 })).toBe(4);
  });
});
