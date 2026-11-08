import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isLibraryOperator } from '../../src/compute-engine/library-shadowing';

//
// A library rule (a simplification rule, a derivative table, an integration
// rule, a compiled lowering) applies to a call only when the call is bound to
// the library operator (`isLibraryOperator()`, `library-shadowing.ts`). The
// test reads the definition of the node, so it answers for the scope where
// the node was made, not for the current scope:
//
// - a call of a user function `Sqrt` made in a scope that is popped later is
//   still a call of the user function;
// - a call of the library `Sqrt` used in a scope that declares a user `Sqrt`
//   is still a call of the library function.
//
// Before, these sites asked `shadowsLibraryName()`, which reads the current
// scope, and gave the library rule to the first node, and no rule to the
// second. (`docs/SCOPING-MODEL.md`, "Symbol identity".)
//

/** Declare and assign a user function `name` in the current scope:
 * `x ↦ x + 100`. */
function defineUser(ce: ComputeEngine, name: string): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', ['Add', 'x', 100], 'x']));
}

/** The value of `f()` with a user function `name` declared in a pushed
 * scope, which is popped after `f()`. */
function inUserScope<T>(ce: ComputeEngine, name: string, f: () => T): T {
  ce.pushScope();
  try {
    defineUser(ce, name);
    return f();
  } finally {
    ce.popScope();
  }
}

describe('simplify() reads the definition of each call', () => {
  test('a user Sqrt made in a popped scope is not simplified as the library Sqrt', () => {
    const ce = new ComputeEngine();
    const u = inUserScope(ce, 'Sqrt', () =>
      ce.box(['Sqrt', ['Power', 'y', 2]])
    );
    // `√(y²) → |y|` is a rule of the library `Sqrt`.
    expect(u.simplify().json).toEqual(['Sqrt', ['Power', 'y', 2]]);
    expect(u.evaluate().json).toEqual(['Add', ['Power', 'y', 2], 100]);
  });

  test('a product of user Sqrt calls keeps the user function', () => {
    const ce = new ComputeEngine();
    const u2 = inUserScope(ce, 'Sqrt', () =>
      ce.box(['Multiply', ['Sqrt', 'y'], ['Sqrt', 'y']])
    );
    // `√y·√y → y` is a rule of the library `Sqrt`. The calls are still
    // collected as equal factors, and the result is still a call of the user
    // function.
    const s = u2.simplify();
    expect(s.json).toEqual(['Power', ['Sqrt', 'y'], 2]);
    expect(s.evaluate().json).toEqual(u2.evaluate().json);
    expect(u2.evaluate().json).toEqual(['Power', ['Add', 'y', 100], 2]);
  });

  test('a library Sqrt simplified in a scope with a user Sqrt is simplified', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Sqrt', ['Power', 'y', 2]]);
    expect(l.simplify().json).toEqual(['Abs', 'y']);
    const s = inUserScope(ce, 'Sqrt', () => l.simplify());
    expect(s.json).toEqual(['Abs', 'y']);
  });

  test('a rule result built in a scope with a user Sin calls the library Sin', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Power', ['Sin', ['Add', 'x', 'Pi']], 2]);
    const at = (e: typeof l) => e.subs({ x: 0.7 }).N().re;
    // `sin(x + π)² → sin(x)²` builds a new call of `Sin` by its name. The
    // simplification binds the name to the library function, not to the
    // user function of the current scope.
    const [s, value] = inUserScope(ce, 'Sin', () => {
      const s = l.simplify();
      return [s, at(s)] as const;
    });
    expect(s.json).toEqual(['Power', ['Sin', 'x'], 2]);
    expect(value).toBeCloseTo(Math.sin(0.7) ** 2, 12);
    expect(at(s)).toBeCloseTo(Math.sin(0.7) ** 2, 12);
  });

  test('the odd-function rule does not apply to a user Sinh of a popped scope', () => {
    const ce = new ComputeEngine();
    const e = inUserScope(ce, 'Sinh', () =>
      ce.box(['Add', ['Sinh', 1], ['Sinh', -1]])
    );
    // (1 + 100) + (−1 + 100) = 200, where the library rule
    // `sinh(−x) = −sinh(x)` would give 0.
    expect(e.evaluate().re).toBe(200);
    expect(e.simplify().evaluate().re).toBe(200);
  });
});

describe('D reads the definition of the call', () => {
  test('a user Sinh made in a popped scope is differentiated as the user function', () => {
    const ce = new ComputeEngine();
    const u = inUserScope(ce, 'Sinh', () => ce.box(['Sinh', 'x']));
    // d/dx (x + 100) = 1, not cosh(x)
    expect(ce.box(['D', u, 'x']).evaluate().json).toEqual(1);
  });

  test('a library Sinh differentiated in a scope with a user Sinh', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Sinh', 'x']);
    // The library rules of `D` build their result by name in the current
    // scope, so while the scope shadows `Sinh`, the `D` of a library `Sinh`
    // call stays unevaluated. A symbolic `Apply(Derivative(Sinh, 1), x)`
    // would be wrong there too: `Derivative` reads `Sinh` by name, and gave 1,
    // the derivative of the user function, where cosh(x) is right. After the
    // scope ends, its numeric value is cosh(x), and a new `D` of the library
    // call gives `Cosh(x)`.
    const d = inUserScope(ce, 'Sinh', () =>
      ce.box(['D', l, 'x']).evaluate()
    );
    expect(d.operator).toEqual('D');
    expect(d.subs({ x: 1 }).N().re).toBeCloseTo(Math.cosh(1), 6);
    expect(ce.box(['D', l, 'x']).evaluate().json).toEqual(['Cosh', 'x']);
  });
});

describe('Integrate reads the definition of the integrand calls', () => {
  test('a library Sin integrated in a scope with a user Sin', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Sin', 'x']);
    const r = inUserScope(ce, 'Sin', () =>
      ce.box(['Integrate', l, 'x']).evaluate()
    );
    // The library rules of `Integrate` build their result by name in the
    // current scope, so while the scope shadows `Sin`, the integral of a
    // library `Sin` call stays unevaluated (`libraryRuleBlocked()`).
    expect(r.operator).toEqual('Integrate');
  });

  test('a user Sin made in a popped scope is integrated as the user function', () => {
    const ce = new ComputeEngine();
    const u = inUserScope(ce, 'Sin', () => ce.box(['Sin', 'x']));
    // ∫ (x + 100) dx = x²/2 + 100x
    expect(ce.box(['Integrate', u, 'x']).evaluate().json).toEqual([
      'Add',
      ['Multiply', ['Rational', 1, 2], ['Power', 'x', 2]],
      ['Multiply', 100, 'x'],
    ]);
  });
});

describe('compile() reads the definition of the call', () => {
  test('a library Sqrt compiled in a scope with a user Sqrt uses the library lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const l = ce.box(['Sqrt', 'y']);
    const result = inUserScope(ce, 'Sqrt', () => compile(l)) as any;
    expect(result.success).toBe(true);
    expect(result.run({ y: 4 })).toBe(2);
  });

  test('a user Sqrt with an evaluate handler, made in a popped scope, is not lowered as the library Sqrt', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.pushScope();
    ce.declare('Sqrt', {
      signature: '(real) -> real',
      evaluate: ([x], { engine }) => engine.number(x.re + 100),
    });
    const u = ce.box(['Sqrt', 'y']);
    ce.popScope();
    expect(u.subs({ y: 4 }).evaluate().re).toBe(104);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(u) as any;
      // The compiler has no lowering for the handler: the call declines,
      // and the result falls back to the interpreter.
      expect(result.success).toBe(false);
      expect(result.run({ y: 4 })).toBe(104);
    } finally {
      warn.mockRestore();
    }
  });

  // The compiler reads the `compile` handler of `Sqrt` by its name in the
  // current scope. So a call bound to another definition than the one of
  // the current scope declines, or gives the interpreter's value.
  const declareUserSqrtWithCompile = (ce: ComputeEngine) =>
    ce.declare('Sqrt', {
      signature: '(real) -> real',
      evaluate: ([x], { engine }) => engine.number(x.re + 100),
      compile: ([x], compile) => `(${compile(x)} + 100)`,
    });

  test('a library Sqrt compiled in a scope with a user Sqrt that has a compile handler', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const l = ce.box(['Sqrt', 'y']);
    ce.pushScope();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      declareUserSqrtWithCompile(ce);
      expect(l.subs({ y: 4 }).evaluate().re).toBe(2);
      const result = compile(l) as any;
      expect(result.run({ y: 4 })).toBe(2);
    } finally {
      warn.mockRestore();
      ce.popScope();
    }
  });

  test('a user Sqrt with a compile handler, made in a popped scope, is not lowered as the library Sqrt', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.pushScope();
    declareUserSqrtWithCompile(ce);
    const u = ce.box(['Sqrt', 'y']);
    ce.popScope();
    expect(u.subs({ y: 4 }).evaluate().re).toBe(104);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(u) as any;
      expect(result.run({ y: 4 })).toBe(104);
    } finally {
      warn.mockRestore();
    }
  });

  test('a user Sqrt with a compile handler, compiled in its scope, uses the handler', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.pushScope();
    try {
      declareUserSqrtWithCompile(ce);
      const u = ce.box(['Sqrt', 'y']);
      const result = compile(u) as any;
      expect(result.success).toBe(true);
      expect(result.run({ y: 4 })).toBe(104);
    } finally {
      ce.popScope();
    }
  });

  test('a user Sqrt made in a popped scope compiles to the user function', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const u = inUserScope(ce, 'Sqrt', () => ce.box(['Sqrt', 'y']));
    const result = compile(u) as any;
    expect(u.subs({ y: 4 }).evaluate().re).toBe(104);
    if (result.success) expect(result.run({ y: 4 })).toBe(104);
  });
});

describe('simplify() masks a raw call of a user function', () => {
  // The operand of a lazy operator such as `ReleaseHold` stays raw: it has
  // no definition, and the current scope decides whether it is a call of the
  // library operator. The simplification binds each shadowed library name to
  // its library definition again, so the opaque names must replace the raw
  // calls before these bindings are set (`simplifyShadowedCallsMasked()`).
  test('a raw user Sin(-x) does not get the odd-function rewrite', () => {
    const ce = new ComputeEngine();
    const s = inUserScope(ce, 'Sin', () =>
      ce.box(['ReleaseHold', ['Sin', ['Negate', 'x']]]).simplify()
    );
    expect(s.json).toEqual(['ReleaseHold', ['Sin', ['Negate', 'x']]]);
  });

  test('a raw library Sin(-x) still gets the odd-function rewrite', () => {
    const ce = new ComputeEngine();
    const s = ce.box(['ReleaseHold', ['Sin', ['Negate', 'x']]]).simplify();
    expect(s.json).toEqual(['ReleaseHold', ['Negate', ['Sin', 'x']]]);
  });
});

describe('a library rule does not build its result in a scope that shadows the name', () => {
  // A library rule builds its result by name in the current scope. A call of
  // the library `Sin` used in a scope that declares a user `Sin` gets no
  // library rule, or the result would hold calls of the user `Sin`
  // (`libraryRuleBlocked()`, `library-shadowing.ts`).

  /** True when `e` holds no call of `Sin` bound to a user definition. */
  const noUserSin = (e: any): boolean =>
    (e.operator !== 'Sin' || isLibraryOperator(e)) &&
    (e.ops ?? []).every(noUserSin);

  test('the antiderivative of a library Sin² stays unevaluated', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Power', ['Sin', 'x'], 2]);
    // The rule gives x/2 − Sin(2x)/4; in this scope, that `Sin` would be the
    // user function.
    const r = inUserScope(ce, 'Sin', () =>
      ce.box(['Integrate', l, 'x']).evaluate()
    );
    expect(noUserSin(r)).toBe(true);
    expect(r.operator).toEqual('Integrate');
  });

  test('a definite integral of a library Sin² stays unevaluated under evaluate()', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Power', ['Sin', 'x'], 2]);
    const [r, n] = inUserScope(ce, 'Sin', () => {
      const i = ce.box(['Integrate', l, ['Limits', 'x', 0, 1]]);
      return [i.evaluate(), i.N()] as const;
    });
    expect(r.operator).toEqual('Integrate');
    // The numeric route reads the definition of the call:
    // ∫₀¹ sin² x dx = 1/2 − sin(2)/4
    expect(n.re).toBeCloseTo(0.5 - Math.sin(2) / 4, 8);
  });

  test('the discrete rule does not integrate a library Floor(Sin x)', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Floor', ['Sin', 'x']]);
    const limits = ['Limits', 'x', 0, ['Multiply', 2, 'Pi']];
    expect(ce.box(['Integrate', l, limits]).evaluate().json).toEqual([
      'Negate',
      'Pi',
    ]);
    const r = inUserScope(ce, 'Sin', () =>
      ce.box(['Integrate', l, limits]).evaluate()
    );
    expect(r.operator).toEqual('Integrate');
  });

  test('the piecewise rule does not integrate a library Sin in a Which', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Which', ['Less', 'x', 0], ['Sin', 'x'], 'True', 'x']);
    const limits = ['Limits', 'x', -1, 1];
    const r = inUserScope(ce, 'Sin', () =>
      ce.box(['Integrate', l, limits]).evaluate()
    );
    expect(noUserSin(r)).toBe(true);
    expect(r.operator).toEqual('Integrate');
  });
});

describe('a user value with a library name does not block the library rules', () => {
  // A call head skips a binding that cannot be applied, so a call `Gamma(…)`
  // built in a scope where `Gamma` is a number still calls the library
  // operator, and the rules that build their result by name stay correct.
  test('D(Gamma(x)) with Gamma := 1.4', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Gamma', 1.4);
      expect(ce.box(['D', ['Gamma', 'x'], 'x']).evaluate().json).toEqual([
        'Multiply',
        ['Gamma', 'x'],
        ['Digamma', 'x'],
      ]);
    } finally {
      ce.popScope();
    }
  });

  test('D and Integrate of Sin(x) with Sin := 2', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Sin', 2);
      expect(ce.box(['D', ['Sin', 'x'], 'x']).evaluate().json).toEqual([
        'Cos',
        'x',
      ]);
      expect(ce.box(['Integrate', ['Sin', 'x'], 'x']).evaluate().json).toEqual(
        ['Negate', ['Cos', 'x']]
      );
    } finally {
      ce.popScope();
    }
  });
});
