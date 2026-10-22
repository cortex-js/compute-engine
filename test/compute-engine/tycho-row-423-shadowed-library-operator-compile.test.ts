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
// build by name; a multi-clause function; the Python target, which compiles
// no user function.
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
function compiled(expr: any, to: string): { result: any; warnings: string[] } {
  const warnings: string[] = [];
  const warn = jest
    .spyOn(console, 'warn')
    .mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  try {
    return { result: compile(expr, { to } as any) as any, warnings };
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

  test('a user function that calls the user Gamma, as a value and as a call', () => {
    // `G` keeps its own name in the compiled code: only `Gamma` is renamed.
    const ce = engine('x\\mapsto x+100');
    ce.declare('G', 'function');
    ce.assign('G', ce.parse('t\\mapsto 2\\Gamma(t)'));
    const expr = ce.box([
      'Add',
      ['At', ['Map', 'G', ['List', 1, 'x']], 2],
      ['G', 1],
    ]);
    const { result, warnings } = compiled(expr, 'javascript');
    expect(warnings).toEqual([]);
    expect(result.code).toContain('_fn_G');
    expect(result.run({ x: 3 })).toBe(408);
    expect(expr.subs({ x: 3 }).N().re).toBe(408);
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

describe('the library Gamma where no user function shadows it', () => {
  const SQRT_PI = Math.sqrt(Math.PI);

  test('in a fresh engine', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\Gamma(x)');
    const js = compiled(expr, 'javascript');
    expect(js.warnings).toEqual([]);
    expect(js.result.run({ x: 0.5 })).toBeCloseTo(SQRT_PI, 12);
    const interval = compiled(expr, 'interval-js');
    expect(interval.warnings).toEqual([]);
    const [lo, hi] = intervalValue(interval.result.run({ x: 0.5 }));
    expect(lo).toBeLessThanOrEqual(SQRT_PI);
    expect(hi).toBeGreaterThanOrEqual(SQRT_PI);
  });

  test('after the scope of the user function ends', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('x\\mapsto x+100'));
    const inner = compiled(ce.parse('\\Gamma(x)'), 'javascript');
    expect(inner.result.run({ x: 0.5 })).toBe(100.5);
    ce.popScope();
    const outer = compiled(ce.parse('\\Gamma(x)'), 'javascript');
    expect(outer.warnings).toEqual([]);
    expect(outer.result.run({ x: 0.5 })).toBeCloseTo(SQRT_PI, 12);
  });
});

describe('the other targets', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('x\\mapsto x+100'));
    return ce;
  }

  test.each(['glsl', 'wgsl'])('%s emits a call of the user function', (to) => {
    const ce = engine();
    const { result, warnings } = compiled(
      ce.box(['Add', ['Gamma', 'x'], 1]),
      to
    );
    expect(warnings).toEqual([]);
    expect(result.success).toBe(true);
    // The call is emitted under the private name of the user function, and
    // the library lowering of `Gamma` is not used.
    expect(result.code).toMatch(/_fn_Gamma\w*\(x\)/);
    expect(result.code).not.toMatch(/gamma\(/);
  });

  test('python declines, and the interpreter runs the user function', () => {
    // The Python target compiles no user function (a call of `G` declines
    // with "Unknown operator" too), so the call is not renamed for it.
    const ce = engine();
    const { result, warnings } = compiled(
      ce.box(['Add', ['Gamma', 'x'], 1]),
      'python'
    );
    expect(result.success).toBe(false);
    expect(warnings.join('\n')).toContain(
      'a user definition shadows the library operator `Gamma`'
    );
    expect(result.run({ x: 1 })).toBe(102);
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
    to = 'javascript'
  ): void {
    const boxed = ce.box(expr);
    const { result } = compiled(boxed, to);
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
    // √(0 − 100) = 10i.
    agrees(ce, ['Sqrt', ['Square', 'x']], { x: 0 });
    agrees(ce, ['Sqrt', ['Exp', 'x']], { x: 0 });
    agrees(ce, ['Sqrt', ['Square', 'x']], { x: 200 });
  });

  test('no scalar fact reads a list-valued user Floor or Sin as a scalar', () => {
    const ce = engine([
      ['Floor', 'x\\mapsto [x, x]'],
      ['Sin', 'x\\mapsto [x, 2x]'],
      ['g', 'y\\mapsto y+1'],
    ]);
    agrees(ce, ['g', ['Floor', 'x']], { x: 3 });
    agrees(ce, ['Sin', ['Sin', 'x']], { x: 3 });
  });

  test('the forward-mode derivative does not use the recurrence of Sin', () => {
    const ce = engine([
      ['Sin', 't\\mapsto t^2'],
      ['F', 'u\\mapsto 3\\sin(2u+1)+5\\sin(u-1)+u^3+\\frac{1}{u+7}'],
    ]);
    // With Sin(t) = t², F(u) = 3(2u+1)² + 5(u−1)² + u³ + 1/(u+7), so
    // F'''(u) = 6 − 6/(u+7)⁴.
    const { result, warnings } = compiled(ce.parse("F'''(x)"), 'javascript');
    expect(warnings).toEqual([]);
    expect(result.run({ x: 0.5 })).toBeCloseTo(6 - 6 / 7.5 ** 4, 9);
    expect(ce.parse("F'''(0.5)").N().re).toBeCloseTo(6 - 6 / 7.5 ** 4, 9);
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

  test('a node bound to the library Gamma before a user Gamma declines', () => {
    // The node keeps its binding: the interpreter computes the library
    // value. The current scope shadows the name, so the compiler cannot
    // lower it as the library operator either, and declines.
    const ce = new ComputeEngine();
    const early = ce.box(['Add', ['Gamma', 'y'], 0]);
    ce.pushScope();
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('x\\mapsto x+100'));
    for (const to of ['javascript', 'interval-js']) {
      const { result } = compiled(early, to);
      expect(result.success).toBe(false);
    }
    ce.assign('y', 0.5);
    expect(early.N().re).toBeCloseTo(Math.sqrt(Math.PI), 12);
    expect(compiled(early, 'javascript').result.run({ y: 0.5 })).toBeCloseTo(
      Math.sqrt(Math.PI),
      12
    );
    ce.popScope();
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

  test('a shadowing definition with its own compile handler uses it', () => {
    const ce = new ComputeEngine();
    ce.declare('Gamma', {
      signature: '(number) -> number',
      evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'],
      compile: (ops: any[], compile: (x: any) => string) =>
        `(${compile(ops[0])} * 1000)`,
    } as any);
    const { result } = compiled(
      ce.box(['Add', ['Gamma', 'x'], 1]),
      'javascript'
    );
    expect(result.success).toBe(true);
    expect(result.code).toContain('* 1000');
    expect(result.code).not.toContain('_fn_Gamma');
    expect(result.run({ x: 3 })).toBe(3001);
  });

  test('an operator of a library given to the engine is not renamed', () => {
    const ce = new ComputeEngine({
      libraries: [
        ...ComputeEngine.getStandardLibrary(),
        {
          name: 'mine',
          definitions: {
            Foo: {
              signature: '(number) -> number',
              evaluate: ['Function', ['Add', 'x', 7], 'x'],
              compile: (ops: any[], compile: (x: any) => string) =>
                `(${compile(ops[0])} + 7000)`,
            },
          },
        },
      ],
    } as any);
    const { result } = compiled(ce.box(['Add', ['Foo', 'x'], 1]), 'javascript');
    expect(result.success).toBe(true);
    expect(result.code).toContain('+ 7000');
    expect(result.code).not.toContain('_fn_Foo');
  });

  test('the private name avoids a caller function and a user symbol', () => {
    const ce = engine();
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    const withCallerFunction = compiled(expr, 'javascript');
    expect(withCallerFunction.result.run({ x: 1 })).toBe(102);
    const r = compile(expr, {
      to: 'javascript',
      functions: { GammaUser: '((t) => t * 1000)' },
    } as any) as any;
    expect(r.run({ x: 1 })).toBe(102);

    const ce2 = engine();
    ce2.declare('GammaUser', 'real');
    const expr2 = ce2.box(['Add', ['Gamma', 'x'], 'GammaUser']);
    const { result } = compiled(expr2, 'javascript');
    expect(result.run({ x: 1, GammaUser: 5 })).toBe(106);
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

  test('a name that a callback `operators` answers for is not renamed', () => {
    // The caller's lowering of `Gamma` is not skipped: the call keeps its
    // name, and the user definition then makes the compile decline (as with
    // the record form of the option). A private name is never a name that
    // the callback answers for.
    const ce = engine();
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gamma = compile(expr, {
        to: 'javascript',
        operators: (op: string) =>
          op === 'Gamma' ? ['MYGAMMA', 20] : undefined,
      } as any) as any;
      expect(gamma.success).toBe(false);
      expect(gamma.run({ x: 1 })).toBe(102);
      const claimed = compile(expr, {
        to: 'javascript',
        operators: (op: string) =>
          op === 'GammaUser' ? ['CLAIMED', 20] : undefined,
      } as any) as any;
      expect(claimed.success).toBe(true);
      expect(claimed.code).not.toContain('CLAIMED');
      expect(claimed.run({ x: 1 })).toBe(102);
    } finally {
      warn.mockRestore();
    }
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
    expect(ce.lookupDefinition('GammaUser')).toBeUndefined();
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

  test('a definition whose contract a copy would lose is not copied', () => {
    // An explicit `missingBehavior: 'reject'` refuses an absent argument in
    // the interpreter. A copy declared from the signature and the literal
    // would not have it, and its compiled call would return 42 for an
    // absent input. The call keeps its own route: the compile declines.
    const ce = new ComputeEngine();
    ce.declare('Gamma', {
      signature: '(number | missing) -> number',
      missingBehavior: 'reject',
      evaluate: ['Function', 42, 'x'],
    } as any);
    expect(ce.box(['Gamma', 'Missing']).evaluate().operator).toBe('Error');
    const { result } = compiled(
      ce.box(['Add', ['Gamma', 'x'], 1]),
      'javascript'
    );
    expect(result.success).toBe(false);
    expect(result.run({ x: 3 })).toBe(43);
  });

  test('the search for a private name is bounded', () => {
    // A caller's `operators` function that answers for every candidate name:
    // the rename is given up, and the compile declines, at once.
    const ce = engine();
    const expr = ce.box(['Add', ['Gamma', 'x'], 1]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const greedy = compile(expr, {
        to: 'javascript',
        operators: (op: string) =>
          op.startsWith('GammaUser') || op.startsWith('GammaCopy')
            ? ['G', 20]
            : undefined,
      } as any) as any;
      expect(greedy.success).toBe(false);
      expect(greedy.run({ x: 1 })).toBe(102);
      // When only the first suffix is taken, the second one is used.
      const partial = compile(expr, {
        to: 'javascript',
        operators: (op: string) =>
          op.startsWith('GammaUser') ? ['G', 20] : undefined,
      } as any) as any;
      expect(partial.success).toBe(true);
      expect(partial.run({ x: 1 })).toBe(102);
    } finally {
      warn.mockRestore();
    }
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

  test('a decline message names the user function, not its copy', () => {
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
          ['Multiply', 'x', ['Gamma', ['Subtract', 'x', 1]]],
        ],
        'x',
      ])
    );
    const { result, warnings } = compiled(ce.box(['Gamma', 'x']), 'glsl');
    expect(result.success).toBe(false);
    expect(warnings.join('\n')).toContain('Could not compile `Gamma`');
    expect(warnings.join('\n')).not.toContain('GammaUser');
  });

  test('a structural expression keeps its form', () => {
    // `x^(1/3)` stays a `Power` in a structural expression: it is not
    // canonicalized to a `Root` when its parent is rebuilt.
    const lowered = (name: string): string => {
      const ce = new ComputeEngine();
      ce.declare(name, 'function');
      ce.assign(name, ce.parse('x\\mapsto x+100'));
      const expr = ce.function(
        'Add',
        [
          ce.function('Power', [ce.symbol('x'), ce.number([1, 3])], {
            form: 'structural',
          }),
          ce.box([name, 'y']),
        ],
        { form: 'structural' }
      );
      return compiled(expr, 'javascript').result.code;
    };
    expect(lowered('Gamma').replace('_fn_GammaUser', '_fn_G')).toBe(
      lowered('G')
    );
  });
});
