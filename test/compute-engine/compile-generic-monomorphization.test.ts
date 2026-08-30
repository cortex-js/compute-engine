import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// G3 lift — a GENERIC user function compiles whole-fn on the JavaScript
// target, emitted once at its declared BOUNDS.
//
// A polytype has no ground parameter type, so a generic body used to take the
// standard whole-function decline in `ensureUserFunctionEmitted`: the emitted
// call boundary would have lost both its coercion wrap and its broadcast
// wrap, and `gd([1,2,3])` under `(x: T) -> T where T: number` compiled to a
// bare `_fn_gd([1, 2, 3])` that ran to a wrong value.
//
// Reading each quantified parameter at its declared bound is the reading the
// interpreter's own broadcast gate performs (`paramsAreScalar` calls
// `substituteDeclaredBounds` before asking whether a parameter is scalar), so
// the function is emitted once as the ground signature it is bounded by and
// every call site gets the wraps that signature earns. A variable with no
// ground bound (`where T`) has no such reading and keeps the decline, as does
// every target other than JavaScript.
//

function fresh(): ComputeEngine {
  return new ComputeEngine();
}

/** `f: ⟨signature⟩` declared, then assigned the doubling literal. */
function doubler(signature: string, name = 'gd'): ComputeEngine {
  const ce = fresh();
  ce.declare(name, signature);
  ce.assign(name, ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
  return ce;
}

/** Compile without constant folding — a folded call site emits no lowering at
 * all, so a fold would hide whether the definition was emitted. */
function build(ce: ComputeEngine, expr: any) {
  return compile(ce.box(expr), { constantFold: false });
}

describe('G3 lift — scalar-bounded generic, whole-fn emission', () => {
  test('a scalar instantiation calls the emitted definition directly', () => {
    const ce = doubler('(x: T) -> T where T: number');
    const r = build(ce, ['gd', 5]);
    expect(r?.code).toContain('_fn_gd');
    expect(r?.preamble).toContain('const _fn_gd = (x) => 2 * x;');
    expect(r?.run?.({})).toBe(10);
    expect(ce.box(['gd', 5] as any).evaluate().re).toBe(10);
  });

  test('a collection instantiation broadcasts, agreeing with the interpreter', () => {
    const ce = doubler('(x: T) -> T where T: number');
    const r = build(ce, ['gd', ['List', 1, 2, 3]]);
    expect(r?.code).toContain('_SYS.bcastFn');
    expect(r?.code).toContain('_fn_gd');
    expect(r?.run?.({})).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['gd', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a run()-supplied collection broadcasts too', () => {
    // The free `y` types `number` by INFERENCE from the bound, which is not
    // proof that the caller will supply a scalar: the runtime dispatch is
    // emitted anyway, so both shapes answer what the interpreter answers.
    const ce = doubler('(x: T) -> T where T: number');
    const r = build(ce, ['gd', 'y']);
    expect(r?.code).toContain('_SYS.bcastFn');
    expect(r?.code).toContain('_fn_gd');
    expect(r?.run?.({ y: 21 })).toBe(42);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
  });

  test('two parameters, one of them a collection at run time', () => {
    const ce = fresh();
    ce.declare('g2', '(x: T, y: U) -> T where T: number, U: number');
    ce.assign('g2', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y'] as any));
    const r = build(ce, ['g2', 'a', 'b']);
    expect(r?.preamble).toContain('const _fn_g2 = (x, y) => x + y;');
    expect(r?.run?.({ a: 2, b: 3 })).toBe(5);
    expect(r?.run?.({ a: [1, 2], b: 10 })).toEqual([11, 12]);
  });

  test('a boolean-literal argument takes the direct call, not the runtime broadcast dispatch', () => {
    // A generic callee always dispatches through `_SYS.bcastFn`
    // (`certainlyScalarArg`, since a bound-inferred parameter type is not
    // proof the caller supplies a scalar) EXCEPT when the argument is a
    // scalar by construction — a number/string/character literal, or now a
    // boolean literal (`True`/`False`), which can never be an array at run
    // time. `certainlyScalarArg` used to omit the boolean-literal case, so
    // this call took the dispatch branch needlessly.
    const ce = fresh();
    ce.declare('gb', '(x: T) -> T where T: boolean');
    ce.assign('gb', ce.box(['Function', 'x', 'x'] as any));
    const r = build(ce, ['gb', 'True']);
    expect(r?.code).not.toContain('_SYS.bcastFn');
    expect(r?.code).toContain('_fn_gb');
    expect(r?.run?.({})).toBe(true);
  });
});

describe('G3 lift — one emission, shared by every call site', () => {
  test('two call sites of different ground shapes share one definition', () => {
    const ce = doubler('(x: T) -> T where T: number');
    ce.declare('zs', 'list<number>');
    const r = build(ce, ['Add', ['gd', 'y'], ['First', ['gd', 'zs']]]);
    const preamble = r?.preamble ?? '';
    // ONE definition: the emission is keyed by the function, not by the call
    // site, so a second shape reuses it rather than emitting a specialization.
    expect(preamble.match(/const _fn_gd\b/g)?.length).toBe(1);
    expect(r?.run?.({ y: 1, zs: [1, 2, 3] })).toBe(4);
  });

  test('a recursive generic emits once and calls itself by name', () => {
    const ce = fresh();
    ce.declare('fact', '(n: T) -> T where T: number');
    ce.assign(
      'fact',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'n', 0],
          1,
          ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ],
        'n',
      ] as any)
    );
    const r = build(ce, ['fact', 'y']);
    const preamble = r?.preamble ?? '';
    expect(preamble.match(/const _fn_fact\b/g)?.length).toBe(1);
    expect(preamble).toContain('_fn_fact(');
    expect(r?.run?.({ y: 5 })).toBe(120);
    expect(ce.box(['fact', 5] as any).evaluate().re).toBe(120);
  });
});

describe('G3 lift — the bound is read, so a complex bound gets the complex lane', () => {
  test('a `T: complex` parameter is emitted complex and coerced at the call', () => {
    const ce = doubler('(x: T) -> T where T: complex');
    const r = build(ce, ['gd', 'y']);
    // The `{ re, im }` convention on both sides of the boundary: the body
    // reads the parts, the call site lifts a real argument into them.
    expect(r?.preamble).toContain('.re');
    expect(r?.code).toContain('_SYS.cplx');
    expect(r?.run?.({ y: 3 })).toBe(6);
    expect(ce.box(['gd', 3] as any).evaluate().re).toBe(6);
  });
});

describe('G3 lift — what still declines', () => {
  test('an UNBOUNDED variable has no ground reading: decline, fallback agrees', () => {
    const ce = doubler('(x: T) -> T where T');
    const r = build(ce, ['gd', 'y']);
    expect(r?.code ?? '').not.toContain('_fn_gd');
    expect(r?.run?.({ y: 21 })).toBe(42);
    expect(r?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['gd', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a non-JavaScript target keeps the whole-function decline', () => {
    const ce = doubler('(x: T) -> T where T: number');
    expect(() =>
      compile(ce.box(['gd', 'y'] as any), {
        to: 'glsl',
        fallback: false,
      } as any)
    ).toThrow(/gd/);
  });

  test('a declared `broadcastable<T>` parameter still fails closed', () => {
    // The elementwise contract maps exactly one rank down, which no emitted
    // call form expresses — the bound reading does not change that.
    const ce = doubler('(x: broadcastable<T>) -> T where T: number');
    ce.declare('zs', 'list<number>');
    expect(() =>
      compile(ce.box(['gd', 'zs'] as any), {
        constantFold: false,
        fallback: false,
      } as any)
    ).toThrow(/broadcastable/);
  });
});

describe('G3 lift — route parity', () => {
  test('the box route and the parse route emit the same call', () => {
    const boxed = doubler('(x: T) -> T where T: number');
    const parsed = doubler('(x: T) -> T where T: number');
    const rb = build(boxed, ['gd', 'y']);
    const rp = compile(parsed.parse('\\mathrm{gd}(y)'), {
      constantFold: false,
    });
    expect(rb?.code).toContain('_fn_gd');
    expect(rp?.code).toBe(rb?.code);
    expect(rp?.preamble).toContain('const _fn_gd');
    expect(rp?.preamble).toBe(rb?.preamble);
    expect(rp?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(rb?.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});
