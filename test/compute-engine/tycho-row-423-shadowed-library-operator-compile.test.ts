import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Tycho ledger row 423: the compiler declined a call of a user function that
// shadows a library operator.
//
// Desmos has no built-in Gamma function, so a Desmos document defines its
// own, `\Gamma(x)=(x-1)!`. Tycho declares a document function with
// `ce.declare(name, 'function')` or `ce.declare(name, { signature })`, and
// then assigns its body. The interpreter then calls the user's `Gamma`, but
// the JavaScript and interval-js compiles of an expression that called it
// failed: "a user definition shadows the library operator `Gamma`, and the
// compiler lowers `Gamma` as the library operator". The same function under
// another name (`G`) compiled. The decline was safe (the interpreter ran the
// expression), but 3 to 15 times slower, and with no interval function.
//
// Cause: the compiler declined every head that a user definition shadows
// when the target lowers the head as the library operator
// (`shadowedLibraryLoweringError()`, `compilation/base-compiler.ts`). The
// route that compiles a call of a user function (`tryCompileUserFunction()`)
// came after the target's lowering of the head, so it was never reached for
// a library name.
//
// Fix: before the JavaScript, interval-js and shader targets compile an
// expression, each call that is BOUND to a user function with a library
// name is renamed to a private name, declared with a copy of the user
// function in a scope that exists only during the compilation
// (`withShadowingCallsRenamed()`, `compilation/shadowing-calls.ts`). The
// compiler then compiles it as it compiles `G(x)`. Many parts of the
// compiler read a head by its name and apply the library semantics: the
// angular-unit rewrite, the sign proofs, the scalar facts, the recurrences
// of the forward-mode derivative, the lazy streams. A first fix that only
// changed the call route still gave wrong values through each of these
// (the second group of tests below), and the rename hides the call from all
// of them.
//
// Not renamed, so still declined: a node bound to the LIBRARY operator
// while the current scope shadows the name; the arithmetic, comparison,
// logic and control-flow heads, which the canonical forms and the compiler
// build by name; a multi-clause function.
//

/** The two ways Tycho's document manager declares a document function. */
const DECLARATIONS: [string, (ce: ComputeEngine, body: string) => void][] = [
  [
    'declare "function", then assign',
    (ce, body) => {
      ce.declare('Gamma', 'function');
      ce.assign('Gamma', ce.parse(body));
    },
  ],
  [
    'declare a signature, then assign',
    (ce, body) => {
      ce.declare('Gamma', { signature: '(number) -> number' });
      ce.assign('Gamma', ce.parse(body));
    },
  ],
];

/** Compile `expr`, and collect the fallback messages of the compilation. */
function compiled(
  expr: any,
  to: string,
  mode?: 'complex'
): { result: any; warnings: string[] } {
  const warnings: string[] = [];
  const warn = jest
    .spyOn(console, 'warn')
    .mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  try {
    return { result: compile(expr, { to, mode } as any) as any, warnings };
  } finally {
    warn.mockRestore();
  }
}

/** The value of an interval-js result as a number: the bounds of a point
 * interval, or `NaN` when the result is not a non-empty interval. */
function intervalValue(r: any): [number, number] {
  if (r?.kind !== 'interval') return [NaN, NaN];
  return [r.value.lo, r.value.hi];
}

describe.each(DECLARATIONS)('a user Gamma (%s)', (_, define) => {
  test('the interpreter calls the user function', () => {
    const ce = new ComputeEngine();
    define(ce, 'x\\mapsto x+100');
    expect(ce.parse('\\Gamma(0.5)').N().re).toBe(100.5);
  });

  test('the JavaScript compile calls the user function', () => {
    const ce = new ComputeEngine();
    define(ce, 'x\\mapsto x+100');
    const expr = ce.parse('\\Gamma(\\frac{1}{2})+x');
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.run({ x: 1 })).toBe(101.5);
    expect(expr.subs({ x: 1 }).N().re).toBe(101.5);
  });

  test('the interval-js compile calls the user function', () => {
    const ce = new ComputeEngine();
    define(ce, 'x\\mapsto x+100');
    const expr = ce.parse('\\Gamma(\\frac{1}{2})+x');
    const { result, warnings } = compiled(expr, 'interval-js');
    expect(warnings).toEqual([]);
    expect(result.success).toBe(true);
    const [lo, hi] = intervalValue(result.run({ x: 1 }));
    expect(lo).toBeLessThanOrEqual(101.5);
    expect(hi).toBeGreaterThanOrEqual(101.5);
    expect(hi - lo).toBeLessThan(1e-9);
  });

  test("Tycho's definition, (x - 1)!, on both targets", () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    define(ce, 'x\\mapsto (x-1)!');
    const expr = ce.parse('\\Gamma(x)+1');
    const js = compiled(expr, 'javascript');
    const interval = compiled(expr, 'interval-js');
    expect(js.warnings).toEqual([]);
    expect(interval.warnings).toEqual([]);
    for (const x of [-1.5, 0.5, 3, 4]) {
      const expected = expr.subs({ x }).N().re;
      expect(js.result.run({ x })).toBeCloseTo(expected, 12);
      const [lo, hi] = intervalValue(interval.result.run({ x }));
      expect(lo).toBeLessThanOrEqual(expected + 1e-12);
      expect(hi).toBeGreaterThanOrEqual(expected - 1e-12);
    }
  });
});

describe('composed and recursive uses', () => {
  function engine(body: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse(body));
    return ce;
  }

  test('a call whose argument is a call', () => {
    const ce = engine('x\\mapsto x+100');
    const expr = ce.box(['Gamma', ['Gamma', 'x']]);
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.run({ x: 3 })).toBe(203);
    expect(expr.subs({ x: 3 }).N().re).toBe(203);
  });

  test('a call in the body of another user function', () => {
    const ce = engine('x\\mapsto x+100');
    ce.declare('G', 'function');
    ce.assign('G', ce.parse('t\\mapsto 2\\Gamma(t)'));
    const expr = ce.box(['G', 'x']);
    for (const to of ['javascript', 'interval-js']) {
      const { result, warnings } = compiled(expr, to);
      expect(warnings).toEqual([]);
      expect(result.success).toBe(true);
    }
    expect(compiled(expr, 'javascript').result.run({ x: 3 })).toBe(206);
    expect(expr.subs({ x: 3 }).N().re).toBe(206);
  });

  test('a recursive definition', () => {
    const ce = new ComputeEngine();
    ce.declare('Gamma', { signature: '(number) -> number' });
    ce.assign(
      'Gamma',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'x', 1],
          1,
          ['Multiply', ['Subtract', 'x', 1], ['Gamma', ['Subtract', 'x', 1]]],
        ],
        'x',
      ])
    );
    const expr = ce.box(['Gamma', 'x']);
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    for (const x of [0.5, 3, 4, 5])
      expect(result.run({ x })).toBe(expr.subs({ x }).N().re);
    expect(result.run({ x: 5 })).toBe(24);
  });

  test('the derivative of a user function that calls the user Gamma', () => {
    const ce = engine('x\\mapsto x^3+100');
    ce.declare('F', 'function');
    ce.assign('F', ce.parse('t\\mapsto \\Gamma(t)^2'));
    const expr = ce.parse("F'(x)");
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    // F(t) = (t^3 + 100)^2, so F'(t) = 6t^2 (t^3 + 100).
    for (const x of [0.5, 2])
      expect(result.run({ x })).toBeCloseTo(6 * x * x * (x ** 3 + 100), 9);
  });

  test('the derivative of a call of the user Gamma is symbolic', () => {
    // The renamed call is bound to the copy that holds the literal, so the
    // derivative reads the literal and not a function with no body.
    const ce = engine('x\\mapsto x^3+100');
    const expr = ce.parse('\\frac{d}{dx}\\Gamma(x)');
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.code).not.toContain('_SYS.nd');
    expect(result.run({ x: 2 })).toBe(12);
  });

  test('a complex-valued user function keeps its complex lane', () => {
    // The library `Gamma` of a real argument is real. The user function is
    // complex, so `Gamma(x) + 1` adds 1 to a complex value.
    const ce = engine('x\\mapsto x+i');
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.run({ x: 3 })).toEqual({ re: 4, im: 1 });
    const value = expr.subs({ x: 3 }).N();
    expect([value.re, value.im]).toEqual([4, 1]);
  });
});

//
// The parts of the compiler that read a head by its name. Each case gave a
// compiled value other than the interpreter's value when only the call
// route was changed. Each must now compile to the interpreter's value, or
// decline (the result then runs the interpreter).
//
describe('the parts of the compiler that read a head by its name', () => {
  /** An engine with the user functions `defs` (name, body in LaTeX). */
  function engine(defs: [string, string][]): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    for (const [name, body] of defs) {
      ce.declare(name, 'function');
      ce.assign(name, ce.parse(body));
    }
    return ce;
  }

  /** A list value as nested arrays of numbers. */
  function plain(e: any): unknown {
    return e.isCollection ? e.ops.map(plain) : e.re;
  }

  /** `expr` compiles, and its compiled value at `vars` is the value of the
   * interpreter. */
  function agrees(
    ce: ComputeEngine,
    expr: any,
    vars: Record<string, number>,
    to = 'javascript',
    mode?: 'complex'
  ): void {
    const boxed = ce.box(expr);
    const { result } = compiled(boxed, to, mode);
    expect(result.success).toBe(true);
    const value = result.run(vars);
    const expected = boxed.subs(vars).N();
    if (expected.isCollection) expect(value).toEqual(plain(expected));
    else if (expected.im !== 0)
      expect(value).toEqual({ re: expected.re, im: expected.im });
    else if (to === 'interval-js') {
      const [lo, hi] = intervalValue(value);
      expect(lo).toBeLessThanOrEqual(expected.re + 1e-9);
      expect(hi).toBeGreaterThanOrEqual(expected.re - 1e-9);
    } else expect(value).toBeCloseTo(expected.re, 9);
  }

  test.each(['javascript', 'interval-js'])(
    'the angular-unit rewrite does not scale a user Sin or Arcsin (%s)',
    (to) => {
      const ce = engine([
        ['Sin', 'x\\mapsto x+100'],
        ['Arcsin', 'x\\mapsto x+100'],
      ]);
      ce.angularUnit = 'deg';
      agrees(ce, ['Sin', 'x'], { x: 1 }, to);
      agrees(ce, ['Arcsin', 'x'], { x: 0.5 }, to);
      expect(compiled(ce.box(['Sin', 'x']), to).result.success).toBe(true);
    }
  );

  test('the angular-unit rewrite still scales the library sin in a user body', () => {
    const ce = engine([['G', 't\\mapsto \\sin(t)']]);
    ce.angularUnit = 'deg';
    agrees(ce, ['G', 'x'], { x: 30 });
  });

  test('no sign proof reads a user Square or Exp as non-negative', () => {
    const ce = engine([
      ['Square', 't\\mapsto t-100'],
      ['Exp', 't\\mapsto t-100'],
    ]);
    // √(0 − 100) = 10i, in the complex mode.
    agrees(ce, ['Sqrt', ['Square', 'x']], { x: 0 }, 'javascript', 'complex');
    agrees(ce, ['Sqrt', ['Exp', 'x']], { x: 0 }, 'javascript', 'complex');
    agrees(ce, ['Sqrt', ['Square', 'x']], { x: 200 }, 'javascript', 'complex');
  });

  test('the lazy streams do not lower a user Rest as the library Rest', () => {
    const ce = engine([['Rest', 'a\\mapsto [7,8,9]']]);
    const expr = ce.box([
      'Take',
      ['Rest', ['Range', 1, 'PositiveInfinity']],
      2,
    ]);
    const { result } = compiled(expr, 'javascript');
    // The interpreter maps the user `Rest` over the first two elements of
    // the range (the value is a lazy `Take` that prints its elements).
    expect(expr.N().toString()).toBe('[[7,8,9],[7,8,9]]');
    expect(result.run({})).toEqual([
      [7, 8, 9],
      [7, 8, 9],
    ]);
  });

  test('a node bound to a user Gamma whose scope has ended calls it', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('x\\mapsto x+100'));
    const bound = ce.box(['Add', ['Gamma', 0.5], 'y']);
    ce.popScope();
    expect(ce.box(['Add', ['Gamma', 0.5], 0]).N().re).toBeCloseTo(
      Math.sqrt(Math.PI),
      12
    );
    const { result, warnings } = compiled(bound, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.run({ y: 0 })).toBe(100.5);
  });
});

describe('a head that the compiler lowers by name', () => {
  test('a user Sqrt compiles as a call of the user function', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('Sqrt', 'function');
    ce.assign('Sqrt', ce.parse('x\\mapsto x+100'));
    const expr = ce.box(['Add', ['Sqrt', 'x'], 1]);
    for (const to of ['javascript', 'interval-js']) {
      const { result, warnings } = compiled(expr, to);
      expect(warnings).toEqual([]);
      expect(result.success).toBe(true);
    }
    expect(compiled(expr, 'javascript').result.run({ x: -2 })).toBe(99);
    expect(expr.subs({ x: -2 }).N().re).toBe(99);
  });
});

//
// The rename itself: what it keeps, what it does not copy, and what it
// leaves in the engine after the compilation.
//
describe('the rename of the shadowing calls', () => {
  /** An engine with a user `Gamma := x ↦ x + 100`. */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('x\\mapsto x+100'));
    return ce;
  }

  test('a rebuilt call keeps the binding of its own head', () => {
    // `Helper(Gamma(x))` is built while an inner `Helper` shadows the outer
    // one, and is compiled after the inner scope ends. The node still calls
    // the inner `Helper` (the interpreter gives 1 + 100 + 10 = 111). The
    // compiled code must not call the outer `Helper` (102): it calls the
    // inner one, or declines.
    const ce = engine();
    ce.declare('Helper', 'function');
    ce.assign('Helper', ce.parse('t\\mapsto t+1'));
    ce.pushScope();
    ce.declare('Helper', 'function');
    ce.assign('Helper', ce.parse('t\\mapsto t+10'));
    const expr = ce.box(['Helper', ['Gamma', 'x']]);
    ce.popScope();
    const { result } = compiled(expr, 'javascript');
    expect(result.run({ x: 1 })).toBe(111);
    ce.assign('x', 1);
    expect(expr.N().re).toBe(111);
  });

  test('a shadowing definition with its own derivative is not copied', () => {
    const ce = new ComputeEngine();
    ce.declare('Gamma', {
      signature: '(number) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'],
      derivative: [['Function', 5, 'x']],
    } as any);
    const expr = ce.parse("\\Gamma'(x)");
    expect(expr.subs({ x: 3 }).N().re).toBe(5);
    expect(compiled(expr, 'javascript').result.run({ x: 3 })).toBe(5);
  });

  test('the private name avoids a user symbol', () => {
    const ce = engine();
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    const withCallerFunction = compiled(expr, 'javascript');
    expect(withCallerFunction.result.run({ x: 1 })).toBe(102);

    const ce2 = engine();
    ce2.declare('Gamma_tmp1', 'real');
    const expr2 = ce2.box(['Add', ['Gamma', 'x'], 'Gamma_tmp1']);
    const { result } = compiled(expr2, 'javascript');
    expect(result.run({ x: 1, Gamma_tmp1: 5 })).toBe(106);
  });

  test('the dependencies name the user function, not its copy', () => {
    // A consumer that watches the dependencies of a compiled result must see
    // a change of the user's `Gamma`.
    const ce = engine();
    const deps = new Set<string>(['kept']);
    compile(ce.box(['Add', ['Gamma', 'x'], 1]), {
      to: 'javascript',
      symbolDeps: deps,
    } as any);
    expect([...deps].sort()).toEqual(['Gamma', 'kept']);
  });

  test('a compiled Map sees a change of the user function', () => {
    const ce = engine();
    ce.precision = 'machine';
    ce.jit = 'auto';
    ce.assign('f', ce.box(['Function', ['Gamma', 'x'], 'x']));
    // More than 100 elements: the Map stays lazy and its function is
    // compiled when it is drained.
    const m = ce.box(['f', ['Range', 1, 120]]).evaluate();
    const first = (): number[] =>
      [...m.N().each()].slice(0, 2).map((x) => x.re);
    expect(first()).toEqual([101, 102]);
    ce.assign('Gamma', ce.parse('x\\mapsto x+5'));
    expect(first()).toEqual([6, 7]);
  });

  test('the engine is unchanged after a compilation', () => {
    const ce = engine();
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    void expr.type;
    const engineState = ce as unknown as Record<string, number> & {
      contextStack: unknown[];
    };
    // Every cache version of the engine: the private copies are new names
    // declared in scratch scopes, which advance no axis, and the pops of
    // those scopes are then clean (`axisMaskOf()`,
    // `engine-configuration-lifecycle.ts`).
    const VERSIONS = [
      '_anyVersion',
      '_semanticVersion',
      '_worldVersion',
      '_callableVersion',
      '_definitionVersion',
      '_conformanceVersion',
    ];
    const versions = () => VERSIONS.map((name) => engineState[name]);
    expect(versions().every((v) => typeof v === 'number')).toBe(true);
    const before = versions();
    const depth = engineState.contextStack.length;
    const { result } = compiled(expr, 'javascript');
    expect(result.success).toBe(true);
    expect(versions()).toEqual(before);
    expect(engineState.contextStack.length).toBe(depth);
    expect(ce.lookupDefinition('Gamma_tmp1')).toBeUndefined();
    // The compiled code holds the definition it was compiled with, as for
    // a user function with any other name.
    ce.assign('Gamma', ce.parse('x\\mapsto x+5'));
    expect(result.run({ x: 1 })).toBe(102);
  });

  test('the cached type and sign of an expression stay correct', () => {
    // `G` calls the user `Gamma`, so the compile declares a copy of `G`
    // under its own name, which shadows the user's `G`. The type and sign
    // of the user's expressions, read before and after the compile, must be
    // those of an engine that did not compile.
    const setup = (): ComputeEngine => {
      const ce = engine();
      ce.declare('G', 'function');
      ce.assign('G', ce.parse('t\\mapsto 2\\Gamma(t)'));
      return ce;
    };
    const read = (ce: ComputeEngine) =>
      [ce.box(['G', 3]), ce.box(['Add', ['G', 'y'], 1])].map((e) => [
        e.type.toString(),
        e.isPositive,
        e.isNegative,
      ]);
    const reference = read(setup());
    const ce = setup();
    expect(read(ce)).toEqual(reference);
    const expr = ce.box(['Add', ['G', 'x'], 1]);
    const { result } = compiled(expr, 'javascript');
    expect(result.run({ x: 1 })).toBe(203);
    expect(read(ce)).toEqual(reference);
  });

  test('a definition with missingBehavior: reject gives its value', () => {
    // An explicit `missingBehavior: 'reject'` refuses an absent argument in
    // the interpreter. The value of compiled code for an absent input is not
    // specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
    const ce = new ComputeEngine();
    ce.declare('Gamma', {
      signature: '(number) -> number',
      missingBehavior: 'reject',
      evaluate: ['Function', 42, 'x'],
    } as any);
    expect(ce.box(['Gamma', 'Missing']).evaluate().operator).toBe('Error');
    const { result } = compiled(
      ce.box(['Add', ['Gamma', 'x'], 1]),
      'javascript'
    );
    expect(result.run({ x: 3 })).toBe(43);
  });

  test('an expression with no shadowing call leaves the cache versions', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'function');
    ce.assign('G', ce.parse('x\\mapsto x+100'));
    const expr = ce.box(['Add', ['G', 'x'], 1]);
    void expr.type;
    const engineState = ce as unknown as {
      _anyVersion: number;
      _semanticVersion: number;
    };
    const versions = [engineState._anyVersion, engineState._semanticVersion];
    compiled(expr, 'javascript');
    expect([engineState._anyVersion, engineState._semanticVersion]).toEqual(
      versions
    );
  });
});
