/**
 * Two call-boundary defects on the JavaScript emission lane, both of which
 * answered a wrong value behind `success: true`.
 *
 * 1. A user-function call site whose arguments are all STATICALLY scalar used
 *    to emit a bare direct call. That static reading is usually an INFERENCE
 *    from the callee's own declared parameter, not a fact about the value:
 *    `f(x: number) = 2x + 1` types the free `y` in `f(y)` as `number`, and
 *    `run({ y: [1, 2, 3] })` hands the call an array all the same. The bare
 *    `_fn_f(_.y)` computed NaN where the interpreter broadcasts to `[3, 5, 7]`
 *    (auto-broadcast is documented, pinned design — `doc/08-guide-types.md`
 *    §Broadcasting). The call now emits a runtime `Array.isArray` guard that
 *    keeps the direct call in its taken branch and dispatches through
 *    `_SYS.bcastFn` otherwise. A LITERAL argument cannot be an array at run
 *    time and is neither tested nor bound.
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

describe('runtime broadcast guard at a user-function call site', () => {
  test('a run()-supplied argument answers BOTH shapes, agreeing with the interpreter', () => {
    const ce = incDoubler('(x: number) -> number');
    const r = build(ce, ['f', 'y']);
    // The guard, and the direct call it keeps in the taken branch.
    expect(r?.code).toContain('Array.isArray');
    expect(r?.code).toContain('_SYS.bcastFn');
    expect(r?.code).toContain('_fn_f(');
    expect(r?.run?.({ y: 21 })).toBe(43);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([3, 5, 7]);
    // The interpreter broadcasts the same call over the same collection.
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[3,5,7]');
    expect(ce.box(['f', 21] as any).evaluate().re).toBe(43);
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

  test('each argument of a MULTI-ARGUMENT call is tested independently', () => {
    const ce = fresh();
    ce.declare('g', '(a: number, b: number) -> number');
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    const r = build(ce, ['g', 'u', 'v']);
    expect(r?.code).toContain('Array.isArray');
    expect(r?.run?.({ u: 1, v: 2 })).toBe(3);
    // An array in EITHER position broadcasts; the scalar is reused.
    expect(r?.run?.({ u: [1, 2, 3], v: 10 })).toEqual([11, 12, 13]);
    expect(r?.run?.({ u: 10, v: [1, 2, 3] })).toEqual([11, 12, 13]);
    // …and both at once zip.
    expect(r?.run?.({ u: [1, 2, 3], v: [10, 20, 30] })).toEqual([11, 22, 33]);
    expect(
      ce
        .box(['g', ['List', 1, 2, 3], 10] as any)
        .evaluate()
        .toString()
    ).toBe('[11,12,13]');
  });

  test('a MIXED call tests only the non-literal argument', () => {
    const ce = fresh();
    ce.declare('g', '(a: number, b: number) -> number');
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    const r = build(ce, ['g', 'u', 10]);
    // One test, for `u` alone — the literal `10` is neither tested nor bound.
    expect(r?.code?.match(/Array\.isArray/g)?.length).toBe(1);
    expect(r?.run?.({ u: 1 })).toBe(11);
    expect(r?.run?.({ u: [1, 2, 3] })).toEqual([11, 12, 13]);
  });

  test('the guarded argument expression is evaluated exactly ONCE', () => {
    const ce = incDoubler('(x: number) -> number');
    const r = build(ce, ['f', ['Add', 'y', 1]]);
    // The argument is bound to a temporary and the branches read that
    // temporary, so the expression appears once in the emitted code.
    expect(r?.code).toContain('Array.isArray');
    expect(r?.code?.match(/_\.y/g)?.length).toBe(1);
    expect(r?.run?.({ y: 20 })).toBe(43);
  });

  test('a COMPLEX-declared parameter is coerced on both branches', () => {
    const ce = fresh();
    ce.declare('Q', '(x: complex) -> complex');
    ce.assign('Q', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['Q', 'y']);
    expect(r?.code).toContain('Array.isArray');
    expect(r?.run?.({ y: 3 })).toBe(6);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(r?.run?.({ y: { re: 3, im: 4 } })).toEqual({ re: 6, im: 8 });
    expect(
      ce
        .box(['Q', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a GENERIC callee keeps its unconditional dispatch — no double wrap', () => {
    // The generic lane already dispatches, because a generic parameter's
    // static type is inferred from the bound rather than declared by the
    // caller. The guard must not wrap that a second time.
    const ce = fresh();
    ce.declare('gd', '(x: T) -> T where T: number');
    ce.assign('gd', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['gd', 'y']);
    expect(r?.code).toContain('_SYS.bcastFn');
    expect(r?.code).not.toContain('Array.isArray');
    expect(r?.run?.({ y: 21 })).toBe(42);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
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

  test('a REAL-declared literal emits the bare arrow, unchanged', () => {
    const r = compile(mapOver('(x: real) -> real'), { constantFold: false });
    expect(r?.code).toBe(
      '((_f) => ([1, 2, 3]).map((_x) => _f(_x)))(((x) => 2 * x))'
    );
    expect(r?.run?.({})).toEqual([2, 4, 6]);
  });

  test('the NAMED path is unchanged: the coercion still rides on the `$v` shim', () => {
    const ce = fresh();
    ce.declare('Q', '(x: complex) -> complex');
    ce.assign('Q', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = compile(ce.box(['Map', 'Q', ['List', 1, 2, 3]] as any), {
      constantFold: false,
    });
    expect(r?.code).toBe(
      '((_f) => ([1, 2, 3]).map((_x) => _f(_x)))(_fn_Q$v)'
    );
    expect(r?.preamble).toContain(
      'const _fn_Q$v = (_tv1) => _fn_Q(_SYS.cplx(_tv1));'
    );
    expect(r?.run?.({})).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['Map', 'Q', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });
});
