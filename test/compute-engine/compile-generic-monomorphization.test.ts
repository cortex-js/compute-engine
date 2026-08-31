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

describe('G3 lift — a collection bound reaches the BODY', () => {
  test('a `Length(xs)` body compiles and answers what the interpreter answers', () => {
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'Length',
      'xs',
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.preamble).toContain('const _fn_g = (xs) => (xs).length;');
    expect(r?.run?.({})).toBe(3);
    expect(ce.box(['g', LIST] as any).evaluate().re).toBe(3);
  });

  test('an `At(xs, 1)` body compiles', () => {
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'At',
      'xs',
      1,
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.preamble).toContain('const _fn_g = (xs) => _SYS.at(xs, 1);');
    expect(r?.run?.({})).toBe(4);
    expect(ce.box(['g', LIST] as any).evaluate().re).toBe(4);
  });

  test('a `Reduce(xs, Add)` body compiles', () => {
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'Reduce',
      'xs',
      'Add',
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.preamble).toContain('reduce');
    expect(r?.run?.({})).toBe(13);
    expect(ce.box(['g', LIST] as any).evaluate().re).toBe(13);
  });

  test('a `Filter` body compiles', () => {
    const ce = overList('(xs: T) -> list<number> where T: list<number>', [
      'Filter',
      'xs',
      ['Function', ['Greater', 'x', 4], 'x'],
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.preamble).toContain('filter');
    expect(r?.run?.({})).toEqual([5]);
    expect(
      ce
        .box(['g', LIST] as any)
        .evaluate()
        .toString()
    ).toBe('[5]');
  });

  test('a MIXED body — the collection parameter and a scalar together', () => {
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'Add',
      ['Length', 'xs'],
      1,
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.preamble).toContain('const _fn_g = (xs) => (xs).length + 1;');
    expect(r?.run?.({})).toBe(4);
    expect(ce.box(['g', LIST] as any).evaluate().re).toBe(4);
  });

  test('the call site passes the list WHOLE — a collection parameter is not broadcast over', () => {
    // A list argument to a `list<number>`-bounded parameter IS the value the
    // body reads, so the runtime broadcast dispatch (which would hand the body
    // one element per call) must not be emitted. `userFunctionParamsAreScalar`
    // reads the bound and answers `false`, exactly as it does for a ground
    // `(list<number>) -> number` declaration.
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'Length',
      'xs',
    ]);
    const r = build(ce, ['g', LIST]);
    expect(r?.code).toBe('_fn_g([4, 5, 4])');
    expect(r?.code).not.toContain('_SYS.bcastFn');
  });
});

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

  test('a `list<number>` bound emits the ground declaration’s definition, byte for byte', () => {
    const { concrete, generic } = bothWays('list<number>', 'number', [
      'Length',
      'xs',
    ]);
    const c = concrete();
    const g = generic();
    expect(g?.preamble).toBe(c?.preamble);
    expect(g?.code).toBe(c?.code);
    expect(g?.run?.({})).toBe(c?.run?.({}));
  });

  test('a bound too weak for the body fails closed, as the ground declaration does', () => {
    // `collection<number>` proves a collection but NOT indexed access, and
    // `At` lowers only over something array-shaped. Both declarations refuse
    // it, with the same diagnostic: the stamp carries the bound, it never
    // strengthens it.
    const { concrete, generic } = bothWays('collection<number>', 'number', [
      'At',
      'xs',
      1,
    ]);
    expect(concrete).toThrow(/At: cannot compile/);
    expect(generic).toThrow(/At: cannot compile/);
  });

  test('the VALUE position gets the same definition — there is no call site to read', () => {
    // `Map(g, …)` passes `g` by name, so nothing at that reference says what
    // the elements are. The emission is keyed by the function and shaped by
    // its declaration, so the value reference and a direct call share the one
    // definition the bound produced.
    const call = (sig: string) => {
      const ce = overList(sig, ['Length', 'xs']);
      return compile(
        ce.box([
          'Map',
          'g',
          ['List', ['List', 1, 2], ['List', 3]],
        ] as any),
        { constantFold: false, fallback: false } as any
      );
    };
    const c = call('(list<number>) -> number');
    const g = call('(xs: T) -> number where T: list<number>');
    expect(g?.preamble).toBe(c?.preamble);
    expect(g?.code).toBe(c?.code);
    expect(g?.run?.({})).toEqual([2, 1]);
  });

  test('a `collection<number>` bound refuses a `Length` body too', () => {
    const { concrete, generic } = bothWays('collection<number>', 'number', [
      'Length',
      'xs',
    ]);
    expect(concrete).toThrow(/Length: cannot compile/);
    expect(generic).toThrow(/Length: cannot compile/);
  });

  test('a SCALAR bound stamps nothing — the emission is what it was', () => {
    // Only a parameter that binds a collection WHOLE can be handed a value a
    // scalar-compiled body cannot read, so a scalar bound is left alone and
    // `where T: number` emits exactly the ground `(number) -> number` body.
    const ce = doubler('(x: T) -> T where T: number');
    const r = build(ce, ['gd', 5]);
    expect(r?.preamble).toBe('const _fn_gd = (x) => 2 * x;\n');
    expect(r?.code).toBe('_fn_gd(5)');
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

  test('a non-JavaScript target keeps the whole-function decline', () => {
    // Folding is off: a folded call site evaluates `g([4,5,4])` to `3.0` in
    // the interpreter and emits no definition at all, which would hide
    // whether the target declined.
    const ce = overList('(xs: T) -> number where T: list<number>', [
      'Length',
      'xs',
    ]);
    expect(() =>
      compile(ce.box(['g', LIST] as any), {
        to: 'glsl',
        constantFold: false,
        fallback: false,
      } as any)
    ).toThrow(/g/);
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

  test('a collection-bounded body emits the same call on all three routes', () => {
    // The body-side stamp happens at EMISSION, so it cannot depend on how the
    // call site was built. `ce.function(…)` hands the compiler pre-boxed
    // arguments, while the box and parse routes reach it through
    // canonicalization.
    const declared = (): ComputeEngine => {
      const ce = overList('(xs: T) -> number where T: list<number>', [
        'Length',
        'xs',
      ]);
      ce.declare('zs', 'list<number>');
      return ce;
    };
    const opts = { constantFold: false } as any;
    const rb = compile(declared().box(['g', 'zs'] as any), opts);
    const rp = compile(declared().parse('\\mathrm{g}(\\mathrm{zs})'), opts);
    const ce = declared();
    const rf = compile(ce.function('g', [ce.symbol('zs')]), opts);
    expect(rb?.preamble).toContain('const _fn_g = (xs) => (xs).length;');
    expect(rp?.code).toBe(rb?.code);
    expect(rp?.preamble).toBe(rb?.preamble);
    expect(rf?.code).toBe(rb?.code);
    expect(rf?.preamble).toBe(rb?.preamble);
    for (const r of [rb, rp, rf])
      expect(r?.run?.({ zs: [4, 5, 4] })).toBe(3);
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

describe('G3 lift — a BLOCK-LOCAL generic reads the same bounds', () => {
  test('a scalar instantiation compiles and agrees with both the interpreter and the engine-level spelling', () => {
    expect(localDoubler('(x: T) -> T where T: number', 5).evaluate().re).toBe(
      10
    );
    const r = buildLocal('(x: T) -> T where T: number', 5);
    expect(r.code).toContain('let gd = ((x) => 2 * x)');
    expect(r.run?.({})).toBe(10);
    // The engine-level spelling of the same function.
    const engineLevel = build(doubler('(x: T) -> T where T: number'), ['gd', 5]);
    expect(engineLevel?.run?.({})).toBe(10);
  });

  test('a collection instantiation broadcasts, agreeing with the interpreter', () => {
    expect(
      localDoubler('(x: T) -> T where T: number', ['List', 1, 2, 3])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
    const r = buildLocal('(x: T) -> T where T: number', ['List', 1, 2, 3]);
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.run?.({})).toEqual([2, 4, 6]);
  });

  test('a run()-supplied argument takes the runtime dispatch, both shapes', () => {
    // As at engine level: the free `y` types `number` by INFERENCE from the
    // bound, which is no proof the caller supplies a scalar.
    const r = buildLocal('(x: T) -> T where T: number', 'y');
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.run?.({ y: 21 })).toBe(42);
    expect(r.run?.({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});

describe('G3 lift — a BLOCK-LOCAL generic declines where the engine route declines', () => {
  test('an UNBOUNDED variable declines, and the interpreted fallback agrees', () => {
    expect(() =>
      compile(localDoubler('(x: T) -> T where T', 5), {
        constantFold: false,
        fallback: false,
      } as any)
    ).toThrow(/gd/);
    const list = localDoubler('(x: T) -> T where T', ['List', 1, 2, 3]);
    expect(list.evaluate().toString()).toBe('[2,4,6]');
    const r = compile(list, { constantFold: false });
    expect(r.success).toBe(false);
    expect(r.run?.({})).toEqual([2, 4, 6]);
  });

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
    const r = compile(localDoubler('(x: T) -> T where T: number', 5), {
      to: 'interval-js',
      constantFold: false,
      fallback: false,
    } as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/GENERIC/);
  });

});

describe('G3 lift — a BLOCK-LOCAL generic honours a NON-REAL NUMBER bound', () => {
  // This bound was the one place the block-local decline set was WIDER than the
  // engine route's. A quantified parameter is erased before the literal's body
  // canonicalizes (rule G1), and a local's body is emitted by the ordinary
  // function-literal lowering, which reads the parameter's own type — so the
  // arrow computed in the real lane while the call site coerced its argument to
  // `{ re, im }`, an object that body would have multiplied as a number. The
  // lowering now reads the same ground bound the call boundary reads: it puts
  // such a parameter in the complex lane and coerces at the value splice, so
  // both halves of the boundary agree and the local compiles.

  test('a real argument compiles and agrees with the interpreter', () => {
    const e = localDoubler('(x: T) -> T where T: complex', 3);
    expect(e.evaluate().re).toBe(6);
    const r = buildLocal('(x: T) -> T where T: complex', 3);
    // The body reads the `{ re, im }` parts, and the arrow lifts a plain
    // number into them — the same pairing the engine route emits.
    expect(r.code).toContain('.re');
    expect(r.code).toContain('_SYS.cplx');
    expect(r.run?.({})).toBe(6);
    // The engine-level spelling of the same function agrees.
    const engineLevel = build(doubler('(x: T) -> T where T: complex'), [
      'gd',
      3,
    ]);
    expect(engineLevel?.run?.({})).toBe(6);
  });

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
        ['Function', ['Multiply', 2, 'x'], { str: '(x: T) -> T where T: complex' }],
        ['List', 1, 2, 3],
      ] as any);
    expect(source().evaluate().toString()).toBe('[2,4,6]');
    const r = compile(source(), { constantFold: false });
    expect(r.run?.({})).toEqual([2, 4, 6]);
  });

  test('a non-JavaScript target still declines, on the JavaScript-only reading', () => {
    const r = compile(localDoubler('(x: T) -> T where T: complex', 3), {
      to: 'interval-js',
      constantFold: false,
      fallback: false,
    } as any);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/GENERIC/);
  });
});
