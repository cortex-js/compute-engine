import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

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
  ce.declare('y', 'real | list<real>');
  ce.declare(name, signature);
  ce.assign(name, ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
  return ce;
}

/** Compile without constant folding — a folded call site emits no lowering at
 * all, so a fold would hide whether the definition was emitted. */
function build(ce: ComputeEngine, expr: any) {
  return compile(ce.box(expr), { constantFold: false });
}

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
});

//
// Body-side bound reading — a COLLECTION-bounded parameter.
//
// Reading the bound settled the CALL boundary, but the body was still
// compiled against an erased parameter: `(xs: T) -> number where T:
// list<number>` with a `Length(xs)` body declined on `Length`, because `xs`
// analyzed as `collection` (usage inference) rather than as the list the
// bound proves, and `collection` is not array-shaped.
//
// The bound now reaches the body through the channel a CONCRETE declaration
// already uses: the declared type is stamped onto each bare parameter as a
// `Typed` annotation and the literal re-boxed, so the body is canonicalized
// with its parameter references bound at that type. The emitted definition is
// therefore the one the equivalent ground declaration emits, byte for byte.
//

/** `f: ⟨signature⟩` declared, then assigned `xs ↦ ⟨body⟩`. */
function overList(signature: string, body: any, name = 'g') {
  const ce = fresh();
  ce.declare(name, signature);
  ce.assign(name, ce.box(['Function', body, 'xs'] as any));
  return ce;
}

/** The list every body below is applied to. */
const LIST = ['List', 4, 5, 4];

describe('G3 lift — the bound reading agrees with the ground declaration', () => {
  /** The compiled artifact of `xs ↦ ⟨body⟩` declared two ways: at the ground
   * signature, and as a generic bounded by that same signature's parameter. */
  function bothWays(
    bound: string,
    result: string,
    body: any
  ): { concrete: () => any; generic: () => any } {
    const call = (sig: string) => () =>
      compile(overList(sig, body).box(['g', LIST] as any), {
        constantFold: false,
        fallback: false,
      } as any);
    return {
      concrete: call(`(${bound}) -> ${result}`),
      generic: call(`(xs: T) -> ${result} where T: ${bound}`),
    };
  }

  test('an `At` body over a `collection<number>` bound compiles, as the ground declaration does', () => {
    // Both declarations compile, and give the interpreter's value.
    const { concrete, generic } = bothWays('collection<number>', 'number', [
      'At',
      'xs',
      1,
    ]);
    expect(concrete()?.run?.({})).toBe(4);
    expect(generic()?.run?.({})).toBe(4);
  });

  test('a `collection<number>` bound compiles a `Length` body, as the ground declaration does', () => {
    // Counting needs no indexed access, so `Length` over an abstract
    // collection compiles with a run-time read of the operand (`_SYS.elts`,
    // issue #385). Both declarations emit the same definition.
    const { concrete, generic } = bothWays('collection<number>', 'number', [
      'Length',
      'xs',
    ]);
    const c = concrete();
    const g = generic();
    expect(g?.preamble).toBe(c?.preamble);
    expect(g?.code).toBe(c?.code);
    expect(c?.run?.({})).toBe(3);
    expect(g?.run?.({})).toBe(3);
  });
});

describe('G3 lift — what a collection bound still declines', () => {
  test('an UNBOUNDED variable over a `Length` body: no ground reading, no emission', () => {
    const ce = overList('(xs: T) -> number where T', ['Length', 'xs']);
    expect(() =>
      compile(ce.box(['g', LIST] as any), {
        constantFold: false,
        fallback: false,
      } as any)
    ).toThrow(/g/);
  });

});

//
// The same function, written as a BLOCK LOCAL instead of an engine-level
// definition. The call route is `tryCompileLocalFunctionCall`, which reads the
// callee's signature from the declared literal rather than from an engine
// definition; it used to throw on any polymorphic signature, so the two
// spellings of one function disagreed — `gd(5)` compiled at engine level and
// declined inside a `Block`. It now reads the same declared bounds, and
// declines on exactly the same conditions as the engine route: an unbounded
// variable, and a non-JavaScript target.
//

/** The doubling literal, declared as a function-valued local of a `Block` that
 * then calls it. `signature` is carried by the LITERAL (the E1 spelling), the
 * only place the block-local call route can read it from. */
function localDoubler(signature: string, arg: any) {
  const ce = fresh();
  ce.declare('y', 'real | list<real>');
  return ce.box([
    'Block',
    [
      'Declare',
      'gd',
      "'unknown'",
      ['Function', ['Multiply', 2, 'x'], { str: signature }],
    ],
    ['gd', arg],
  ] as any);
}

/** The block of {@link localDoubler}, compiled without constant folding. */
function buildLocal(signature: string, arg: any) {
  return compile(localDoubler(signature, arg), { constantFold: false });
}

describe('G3 lift — a BLOCK-LOCAL generic declines where the engine route declines', () => {

  test('a declared `broadcastable<T>` parameter still fails closed', () => {
    expect(() =>
      compile(
        localDoubler('(x: broadcastable<T>) -> T where T: number', [
          'List',
          1,
          2,
          3,
        ]),
        { constantFold: false, fallback: false } as any
      )
    ).toThrow(/broadcastable/);
  });

  test('a non-JavaScript target keeps the decline', () => {
    let code: string | undefined;
    try {
      compile(localDoubler('(x: T) -> T where T: number', 5), {
        to: 'interval-js',
        constantFold: false,
        fallback: false,
      } as any);
    } catch (e) {
      code = compileDiagnosticOf(e).code;
    }
    expect(code).toBe('outside-profile');
  });
});

describe('G3 lift — a BLOCK-LOCAL generic honours a NON-REAL NUMBER bound', () => {

  test('a COMPLEX argument computes in the complex lane', () => {
    const e = localDoubler('(x: T) -> T where T: complex', ['Complex', 3, 4]);
    expect(e.evaluate().toString()).toBe('(6 + 8i)');
    const r = buildLocal('(x: T) -> T where T: complex', ['Complex', 3, 4]);
    expect(r.run?.({})).toEqual({ re: 6, im: 8 });
  });

  test('a run()-supplied argument takes the runtime dispatch, both shapes', () => {
    const r = buildLocal('(x: T) -> T where T: complex', 'y');
    expect(r.run?.({ y: 3 })).toBe(6);
    expect(r.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
  });

  test('the same bound on an inline function LITERAL still computes correctly', () => {
    // The regression that reverted an earlier attempt at this lift: putting the
    // literal's body in the complex lane without also coercing at the value
    // splice fed the arrow plain numbers.
    const source = () =>
      fresh().box([
        'Map',
        [
          'Function',
          ['Multiply', 2, 'x'],
          { str: '(x: T) -> T where T: complex' },
        ],
        ['List', 1, 2, 3],
      ] as any);
    expect(source().evaluate().toString()).toBe('[2,4,6]');
    const r = compile(source(), { constantFold: false });
    expect(r.run?.({})).toEqual([2, 4, 6]);
  });

  test('a non-JavaScript target still declines, on the JavaScript-only reading', () => {
    let code: string | undefined;
    try {
      compile(localDoubler('(x: T) -> T where T: complex', 3), {
        to: 'interval-js',
        constantFold: false,
        fallback: false,
      } as any);
    } catch (e) {
      code = compileDiagnosticOf(e).code;
    }
    expect(code).toBe('outside-profile');
  });
});
