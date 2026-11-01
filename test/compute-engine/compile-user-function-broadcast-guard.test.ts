/**
 * Two call-boundary defects on the JavaScript emission lane, both of which
 * answered a wrong value behind `success: true`.
 *
 * 1. The form of a user-function call follows the static type of each
 *    argument. An argument with a scalar static type (declared, or inferred:
 *    `f(x: number) = 2x + 1` types the free `y` in `f(y)` as `number`) gives a
 *    direct call `_fn_f(_.y)`, with no run-time test of its shape. A host
 *    that gives a list to an input whose type is a scalar gives a value
 *    outside the type of the input, and the result is not specified. An
 *    argument declared as a list gives a static map of the scalar function,
 *    `_SYS.mapFn(_fn_f, [1], _.y)`, which agrees with the interpreter's
 *    broadcast (`doc/08-guide-types.md` §Broadcasting). The rule is in
 *    `docs/plans/2026-10-31-static-shape-compilation.md` (R3 and R5).
 *
 * 2. A function LITERAL with a complex-declared parameter, spliced in VALUE
 *    position (`Map((x: complex) ↦ 2x, [1, 2, 3])`), compiles its body in the
 *    complex lane — it reads `.re`/`.im` — while `_SYS.map` hands it plain
 *    numbers, so it answered `[{re: null, im: null}, …]` where the interpreter
 *    answers `[2, 4, 6]`. A NAMED function is protected by the `$v` coercion
 *    shim; a literal has no name to bind one under and now takes the same
 *    wrapper inline.
 *
 * Every expected value below is the interpreter's own result for the same
 * expression, re-asserted here by the parity checks.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function fresh(): ComputeEngine {
  return new ComputeEngine();
}

/** `f: ⟨signature⟩` declared, then assigned `x ↦ 2x + 1`. */
function incDoubler(signature: string, name = 'f'): ComputeEngine {
  const ce = fresh();
  ce.declare(name, signature);
  ce.assign(
    name,
    ce.box(['Function', ['Add', ['Multiply', 2, 'x'], 1], 'x'] as any)
  );
  return ce;
}

/** Compile without constant folding — a folded call site emits no call at all,
 * so a fold would hide the very emission under test. */
function build(ce: ComputeEngine, expr: any) {
  return compile(ce.box(expr), { constantFold: false });
}

describe('the call form at a user-function call site follows the static type', () => {
  test('an argument with a scalar static type is a direct call; a declared list maps', () => {
    const ce = incDoubler('(x: number) -> number');
    const r = build(ce, ['f', 'y']);
    // `y` is not declared: its type is inferred from the parameter of `f`
    // (`number`). The call is a direct call of the scalar function, with no
    // run-time test of the shape of `y`.
    expect(r?.code).toBe('_fn_f(_.y)');
    expect(r?.run?.({ y: 21 })).toBe(43);
    expect(ce.box(['f', 21] as any).evaluate().re).toBe(43);
    // A list is given only to an input that is declared as a list. The call
    // then maps the scalar function over the list, as the interpreter does.
    const ce2 = incDoubler('(x: number) -> number');
    ce2.declare('y', 'list<number>');
    const r2 = build(ce2, ['f', 'y']);
    expect(r2?.code).toBe('_SYS.mapFn(_fn_f, [1], _.y)');
    expect(r2?.run?.({ y: [1, 2, 3] })).toEqual([3, 5, 7]);
    expect(
      ce2
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[3,5,7]');
  });

  test('a LITERAL argument keeps the bare direct call', () => {
    const ce = incDoubler('(x: number) -> number');
    const r = build(ce, ['f', 3]);
    expect(r?.code).toBe('_fn_f(3)');
    expect(r?.code).not.toContain('Array.isArray');
    expect(r?.run?.({})).toBe(7);
    expect(ce.box(['f', 3] as any).evaluate().re).toBe(7);
  });

  test('a boolean literal is scalar by construction too', () => {
    const ce = fresh();
    ce.declare('nb', '(p: boolean) -> boolean');
    ce.assign('nb', ce.box(['Function', ['Not', 'p'], 'p'] as any));
    const r = build(ce, ['nb', 'True']);
    expect(r?.code).toBe('_fn_nb(true)');
    expect(r?.run?.({})).toBe(false);
  });

  test('each argument of a MULTI-ARGUMENT call has its own map rank', () => {
    const declared = (u: string, v: string) => {
      const ce = fresh();
      ce.declare('g', '(a: number, b: number) -> number');
      ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
      ce.declare('u', u);
      ce.declare('v', v);
      return build(ce, ['g', 'u', 'v']);
    };
    const r = declared('number', 'number');
    expect(r?.code).toBe('_fn_g(_.u, _.v)');
    expect(r?.run?.({ u: 1, v: 2 })).toBe(3);
    // A list in EITHER position maps (rank 1); the scalar is reused (rank 0).
    const r1 = declared('list<number>', 'number');
    expect(r1?.code).toBe('_SYS.mapFn(_fn_g, [1, 0], _.u, _.v)');
    expect(r1?.run?.({ u: [1, 2, 3], v: 10 })).toEqual([11, 12, 13]);
    const r2 = declared('number', 'list<number>');
    expect(r2?.code).toBe('_SYS.mapFn(_fn_g, [0, 1], _.u, _.v)');
    expect(r2?.run?.({ u: 10, v: [1, 2, 3] })).toEqual([11, 12, 13]);
    // …and both at once zip.
    const r3 = declared('list<number>', 'list<number>');
    expect(r3?.code).toBe('_SYS.mapFn(_fn_g, [1, 1], _.u, _.v)');
    expect(r3?.run?.({ u: [1, 2, 3], v: [10, 20, 30] })).toEqual([
      11, 22, 33,
    ]);
    const ce = fresh();
    ce.declare('g', '(a: number, b: number) -> number');
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    expect(
      ce
        .box(['g', ['List', 1, 2, 3], 10] as any)
        .evaluate()
        .toString()
    ).toBe('[11,12,13]');
    expect(
      ce
        .box(['g', 10, ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[11,12,13]');
    expect(
      ce
        .box(['g', ['List', 1, 2, 3], ['List', 10, 20, 30]] as any)
        .evaluate()
        .toString()
    ).toBe('[11,22,33]');
  });

  test('a MIXED call reuses the literal at rank 0', () => {
    const ce = fresh();
    ce.declare('g', '(a: number, b: number) -> number');
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    ce.declare('u', 'list<number>');
    const r = build(ce, ['g', 'u', 10]);
    expect(r?.code).toBe('_SYS.mapFn(_fn_g, [1, 0], _.u, 10)');
    expect(r?.run?.({ u: [1, 2, 3] })).toEqual([11, 12, 13]);
  });

  test('the mapped argument expression is evaluated exactly ONCE', () => {
    const ce = incDoubler('(x: number) -> number');
    ce.declare('y', 'list<number>');
    const r = build(ce, ['f', ['Add', 'y', 1]]);
    // The argument is computed once and passed to the map, so the
    // expression appears once in the emitted code.
    expect(r?.code).toContain('_SYS.mapFn(_fn_f, [1], ');
    expect(r?.code?.match(/_\.y/g)?.length).toBe(1);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([5, 7, 9]);
    expect(
      ce
        .box(['f', ['Add', ['List', 1, 2, 3], 1]] as any)
        .evaluate()
        .toString()
    ).toBe('[5,7,9]');
  });

  test('a COMPLEX-declared parameter is coerced, for a scalar and for each element', () => {
    const ce = fresh();
    ce.declare('Q', '(x: complex) -> complex');
    ce.assign('Q', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['Q', 'y']);
    expect(r?.code).toBe('_fn_Q(_SYS.cplx(_.y))');
    expect(r?.run?.({ y: 3 })).toBe(6);
    expect(r?.run?.({ y: { re: 3, im: 4 } })).toEqual({ re: 6, im: 8 });
    const ce2 = fresh();
    ce2.declare('Q', '(x: complex) -> complex');
    ce2.assign('Q', ce2.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce2.declare('y', 'list<number>');
    const r2 = build(ce2, ['Q', 'y']);
    // The coercion is inside the mapped closure, around the element.
    expect(r2?.code).toMatch(
      /^_SYS\.mapFn\(\(\((\w+)\) => _fn_Q\(_SYS\.cplx\(\1\)\)\), \[1\], _\.y\)$/
    );
    expect(r2?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(
      ce2
        .box(['Q', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a GENERIC callee takes the same call forms at its bound', () => {
    // A scalar-bounded generic is compiled at its bound (`number`), so it
    // takes the same call forms as a non-generic function.
    const ce = fresh();
    ce.declare('gd', '(x: T) -> T where T: number');
    ce.assign('gd', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['gd', 'y']);
    expect(r?.code).toBe('_fn_gd(_.y)');
    expect(r?.run?.({ y: 21 })).toBe(42);
    const ce2 = fresh();
    ce2.declare('gd', '(x: T) -> T where T: number');
    ce2.assign('gd', ce2.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce2.declare('y', 'list<number>');
    const r2 = build(ce2, ['gd', 'y']);
    expect(r2?.code).toBe('_SYS.mapFn(_fn_gd, [1], _.y)');
    expect(r2?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(
      ce2
        .box(['gd', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });
});

describe('the guard is NOT emitted where a broadcast would be wrong', () => {
  test('a TUPLE argument is atomic: bare direct call', () => {
    const ce = fresh();
    ce.declare('n2', '(p: tuple<number, number>) -> number');
    ce.assign(
      'n2',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], ['At', 'p', 2]],
        'p',
      ] as any)
    );
    const r = build(ce, ['n2', ['Tuple', 3, 4]]);
    expect(r?.code).not.toContain('Array.isArray');
    expect(r?.run?.({})).toBe(7);
  });

  test('a COLLECTION-typed parameter binds its argument whole: bare direct call', () => {
    const ce = fresh();
    ce.declare('sz', '(xs: list<number>) -> number');
    ce.assign('sz', ce.box(['Function', ['Length', 'xs'], 'xs'] as any));
    ce.declare('zs', 'list<number>');
    const r = build(ce, ['sz', 'zs']);
    expect(r?.code).toBe('_fn_sz(_.zs)');
    expect(r?.run?.({ zs: [1, 2, 3] })).toBe(3);
  });

  test('a POINT-typed parameter fed a point computes the point result', () => {
    // A point lowers to a JS array, so `Array.isArray` is true for the value
    // this callee EXPECTS. Broadcasting there would call the body once per
    // coordinate and answer a list of results where the interpreter answers
    // one. The guard cannot reach it: a tuple-typed parameter is not scalar,
    // so no broadcast form is emitted at all.
    const ce = fresh();
    ce.declare('mid', '(v: tuple<number, number>) -> number');
    ce.assign(
      'mid',
      ce.box([
        'Function',
        ['Divide', ['Add', ['At', 'v', 1], ['At', 'v', 2]], 2],
        'v',
      ] as any)
    );
    expect(ce.box(['mid', ['Tuple', 3, 5]] as any).evaluate().re).toBe(4);
    // The point arrives at `run()` time, under both spellings of the argument:
    // a symbol declared the point type, and an undeclared one.
    ce.declare('p', 'tuple<number, number>');
    for (const arg of ['p', 'q']) {
      const r = build(ce, ['mid', arg]);
      // The undeclared `q` has the type that the engine infers from the
      // call, the point type of the parameter. The static type is the
      // contract (rules R1 and R5 of
      // `docs/plans/2026-10-31-static-shape-compilation.md`), so neither
      // call is tested: the host supplies a point for `q`.
      expect(r?.code).toBe(`_fn_mid(_.${arg})`);
      expect(r?.code).not.toContain('Array.isArray');
      expect(r?.code).not.toContain('_SYS.bcastFn');
      expect(r?.run?.({ [arg]: [3, 5] })).toBe(4);
    }
  });

  test('a non-JavaScript target emits the bare direct call', () => {
    // `_SYS.bcastFn` and `Array.isArray` are both JavaScript spellings.
    const ce = incDoubler('(x: number) -> number');
    const r = compile(ce.box(['f', 'y'] as any), {
      to: 'interval-js',
      constantFold: false,
    } as any);
    expect(r?.code).toBe('_fn_f(_.y)');
  });
});

describe('a complex-declared function LITERAL spliced in value position', () => {
  /** `Map(⟨literal⟩, [1, 2, 3])` over a literal declared `signature`. */
  function mapOver(signature: string) {
    return fresh().box([
      'Map',
      ['Function', ['Multiply', 2, 'x'], { str: signature }],
      ['List', 1, 2, 3],
    ] as any);
  }

  test('a COMPLEX-declared literal computes the interpreter’s values', () => {
    expect(mapOver('(x: complex) -> complex').evaluate().toString()).toBe(
      '[2,4,6]'
    );
    const r = compile(mapOver('(x: complex) -> complex'), {
      constantFold: false,
    });
    // The body reads the parts; the inline wrapper lifts a raw element into
    // them, exactly as the named path's `$v` shim does.
    expect(r?.code).toContain('.re');
    expect(r?.code).toContain('_SYS.cplx');
    expect(r?.run?.({})).toEqual([2, 4, 6]);
  });

  test('a REAL-declared literal takes no complex coercion', () => {
    const r = compile(mapOver('(x: real) -> real'), { constantFold: false });
    // The arrow itself is unwrapped — no `_SYS.cplx`, no `.re` — and the
    // elements of the source are scalars, so the literal is passed as it is.
    expect(r?.code).toBe(
      '((_f) => (_lit_1).map((_x) => _f(_x)))(((x = NaN) => 2 * x))'
    );
    expect(r?.code).not.toContain('_SYS.cplx');
    expect(r?.run?.({})).toEqual([2, 4, 6]);
  });

  test('the NAMED path: the coercion rides on the `$v` shim, under the static map', () => {
    const ce = fresh();
    ce.declare('Q', '(x: complex) -> complex');
    ce.assign('Q', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = compile(ce.box(['Map', 'Q', ['List', 1, 2, 3]] as any), {
      constantFold: false,
    });
    // The elements of the source are scalars, so the value reference is the
    // coercing shim `$v`, which lifts each element into a complex value.
    expect(r?.code).toBe('((_f) => (_lit_1).map((_x) => _f(_x)))(_fn_Q$v)');
    // The shim temporaries are numbered after the two the complex product in
    // `Q`'s own body takes (`2x` binds each factor to a hygienic temporary).
    expect(r?.preamble).toContain(
      // An absent argument is read as `NaN` before the complex coercion, as
      // the interpreter reads an absent value at a numeric parameter.
      'const _fn_Q$v = (_tv3) => _fn_Q(_SYS.cplx(_tv3 === undefined ? NaN : _tv3));'
    );
    expect(r?.run?.({})).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['Map', 'Q', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');

    // `complex` is a DECLARED scalar parameter, and the interpreter maps such
    // a callback over an element that is a list (`Map(Q, [[1, 2], [3, 4]])`
    // maps `Q` over each row). Over a source of rows the reference is a
    // static map of the coercing shim, so each entry of a row reaches the
    // body coerced.
    const rows = ['Map', 'Q', ['List', ['List', 1, 2], ['List', 3, 4]]];
    const m = compile(ce.box(rows as any), { constantFold: false });
    expect(m?.code).toBe('((_f) => (_lit_1).map((_x) => _f(_x)))(_fn_Q$m1)');
    expect(m?.preamble).toContain(
      'const _fn_Q$m1 = ((_tv4) => _SYS.mapFn(_fn_Q$v, [1], _tv4));'
    );
    expect(m?.run?.({})).toEqual([
      [2, 4],
      [6, 8],
    ]);
    expect(
      ce
        .box(rows as any)
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
  });
});
