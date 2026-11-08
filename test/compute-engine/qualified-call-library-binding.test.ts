import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A qualified call `["Apply", ["Module", f], …args]` (the Epsil
// `std::f(…)`) is the plain call `[f, …args]` bound to the definition of
// `f` in the system scope, also where a binding of the program shadows `f`.
// The call is boxed by `ce._libraryCall()`: the head reads the library
// definition, and the arguments are boxed in the current scope, so a call of
// the user function `f` in an argument stays a call of the user function.
// The library rules apply to the call (simplification), a lazy or binding
// library operator reads its operands as the library rules say, and a named
// argument is valid. In the shadowing scope, the MathJSON of the call is
// `["Apply", ["Module", f], …]`, and it boxes again to the same call.
// Design: `docs/plans/2026-11-07-ce1109-definition-identity.md` (CE-1109.5)
// and `docs/plans/2026-11-07-ce1099-std-module.md` §4.
//

/** The value of an Epsil program as MathJSON, and the codes of its
 * diagnostics. */
function run(source: string): [unknown, string[]] {
  const r = executeEpsil(new ComputeEngine(), source);
  return [
    r.value.json,
    r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    ),
  ];
}

/** True when `e` is a call bound to the system-scope definition of its
 * operator. */
function isLibraryCall(ce: ComputeEngine, e: Expression): boolean {
  const library = (ce as any)._evalContextStack[0].lexicalScope.bindings.get(
    e.operator
  );
  return (
    library !== undefined &&
    'operator' in library &&
    e.operatorDefinition === library.operator
  );
}

/**
 * Box `input` in a scope where `setup` binds the qualified name, and check:
 * the call is bound to the library, its value in the scope, the JSON round
 * trip in the scope, and its value after the scope ends.
 */
function check(
  input: any,
  setup: (ce: ComputeEngine) => void,
  expected: { operator: string; json: unknown; value: unknown }
): { ce: ComputeEngine; e: Expression } {
  const ce = new ComputeEngine();
  ce.pushScope();
  let e: Expression;
  try {
    setup(ce);
    e = ce.box(input);
    expect(e.operator).toBe(expected.operator);
    expect(isLibraryCall(ce, e)).toBe(true);
    expect(e.json).toEqual(expected.json);
    expect(e.evaluate().json).toEqual(expected.value);
    const again = ce.box(e.json);
    expect(again.isSame(e)).toBe(true);
    expect(isLibraryCall(ce, again)).toBe(true);
    expect(again.evaluate().json).toEqual(expected.value);
  } finally {
    ce.popScope();
  }
  expect(e.evaluate().json).toEqual(expected.value);
  return { ce, e };
}

describe('a shadowed qualified call is the library call', () => {
  test('an ordinary function', () => {
    expect(run('function Floor(x) { x }\nstd::floor(2.5)')).toEqual([2, []]);
    const { e } = check(
      ['Apply', ['Module', 'Floor'], 2.5],
      (ce) => ce.assign('Floor', ce.box(['Function', 'x', 'x'])),
      {
        operator: 'Floor',
        json: ['Apply', ['Module', 'Floor'], 2.5],
        value: 2,
      }
    );
    // Outside the shadowing scope, the bare name reads the library.
    expect(e.json).toEqual(['Floor', 2.5]);
  });

  test('the library rules simplify it', () => {
    // A user `Sqrt` shadows the name. The library `Sqrt(y^2)` of a real `y`
    // is `|y|`.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Sqrt', ce.box(['Function', 'x', 'x']));
      ce.declare('y', 'real');
      const e = ce.box(['Apply', ['Module', 'Sqrt'], ['Power', 'y', 2]]);
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.simplify().json).toEqual(['Abs', 'y']);
      expect(e.subs({ y: -3 }).evaluate().re).toBe(3);
      // A bare call reads the user function.
      expect(ce.box(['Sqrt', ['Power', 'y', 2]]).simplify().json).toEqual([
        'Sqrt',
        ['Power', 'y', 2],
      ]);
    } finally {
      ce.popScope();
    }
  });

  test('a user call of the same name in an argument is a call of the user function', () => {
    // The user `Not` gives `false`, and the library `Not` of it is `true`.
    // Read as two library calls, the fold `Not(Not(x)) = x` gives `false`.
    expect(run('function Not(x) { x }\nstd::Not(Not(false))')).toEqual([
      'True',
      [],
    ]);
    check(
      ['Apply', ['Module', 'Not'], ['Not', 'False']],
      (ce) => ce.assign('Not', ce.box(['Function', 'x', 'x'])),
      {
        operator: 'Not',
        json: ['Apply', ['Module', 'Not'], ['Not', 'False']],
        value: 'True',
      }
    );
  });

  test('a lazy operator', () => {
    expect(run('function If(c, a, b) { 0 }\nstd::If(true, 1, 2)')).toEqual([
      1,
      [],
    ]);
    check(
      ['Apply', ['Module', 'If'], 'True', 1, 2],
      (ce) => ce.assign('If', ce.box(['Function', 0, 'a', 'b', 'c'])),
      {
        operator: 'If',
        json: ['Apply', ['Module', 'If'], 'True', 1, 2],
        value: 1,
      }
    );
    // A branch that calls the user `If` calls it.
    expect(
      run('function If(c, a, b) { 7 }\nstd::If(true, If(1, 2, 3), 0)')
    ).toEqual([7, []]);
    expect(
      run('function If(c, a, b) { false }\nstd::If(If(1, 2, 3), 1, 2)')
    ).toEqual([2, []]);
  });

  test('a binding operator binds its own index', () => {
    expect(run('function Sum(x) { 0 }\nstd::sum(k, k in 1..3)')).toEqual([
      6,
      [],
    ]);
    // The user `Sum` in the body gives 10 for each of the three terms.
    expect(run('function Sum(x) { 10 }\nstd::sum(Sum(k), k in 1..3)')).toEqual(
      [30, []]
    );
    check(
      ['Apply', ['Module', 'Sum'], 'k', ['Limits', 'k', 1, 3]],
      (ce) => ce.assign('Sum', ce.box(['Function', 0, 'x'])),
      {
        operator: 'Sum',
        json: ['Apply', ['Module', 'Sum'], 'k', ['Limits', 'k', 1, 3]],
        value: 6,
      }
    );
    // The index is bound in the scope of the `Sum`, not declared in the
    // enclosing scope.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Sum', ce.box(['Function', 0, 'x']));
      ce.box(['Apply', ['Module', 'Sum'], 'k', ['Limits', 'k', 1, 3]]);
      expect(ce.context.lexicalScope.bindings.has('k')).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('a parameter with the name of a binding operator', () => {
    expect(
      run('function f(Sum) { std::sum(k, k in 1..3) + Sum }\nf(1)')
    ).toEqual([7, []]);
  });

  test('a named argument', () => {
    expect(run('function Log(x) { 0 }\nstd::log(8, base: 2)')).toEqual([3, []]);
    // A variable `base` of the program does not change the named argument.
    expect(
      run('function Log(x) { 0 }\nlet base = 10\nstd::log(8, base: 2) + base')
    ).toEqual([13, []]);
    check(
      ['Apply', ['Module', 'Log'], 8, ['NamedArgument', "'base'", 2]],
      (ce) => ce.assign('Log', ce.box(['Function', 0, 'x'])),
      {
        operator: 'Log',
        json: ['Apply', ['Module', 'Log'], 8, 2],
        value: 3,
      }
    );
  });

  test('an argument that names a variable of the program', () => {
    expect(
      run('function Max(a, b) { 0 }\nlet max = 3\nstd::max(max, 1)')
    ).toEqual([3, []]);
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Max', ce.box(['Function', 0, 'a', 'b']));
      ce.declare('max', 'integer');
      ce.assign('max', 3);
      const e = ce.box(['Apply', ['Module', 'Max'], 'max', 1]);
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.json).toEqual(['Apply', ['Module', 'Max'], 'max', 1]);
      expect(e.evaluate().re).toBe(3);
      expect(ce.box(e.json).evaluate().re).toBe(3);
    } finally {
      ce.popScope();
    }
  });

  test('a callee that is the boxed library symbol', () => {
    // The callee is already boxed (the canonical form of
    // `["Module", "Floor"]`).
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Floor', ce.box(['Function', ['Add', 'x', 100], 'x']));
      const q = ce.box(['Module', 'Floor']);
      const e = ce.box(['Apply', q, 2.5]);
      expect(e.operator).toBe('Floor');
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.evaluate().re).toBe(2);
    } finally {
      ce.popScope();
    }
  });

  test('the compiler declines a shadowed library call, with the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ce.assign('If', ce.box(['Function', 0, 'a', 'b', 'c']));
      ce.declare('x', 'real');
      const e = ce.box(['Apply', ['Module', 'If'], ['Greater', 'x', 0], 1, 2]);
      const f = compile(e);
      expect(f.success).toBe(false);
      expect(Number(f.run!({ x: 1 }))).toBe(1);
      expect(Number(f.run!({ x: -1 }))).toBe(2);
    } finally {
      warn.mockRestore();
      ce.popScope();
    }
  });
});

describe('a user function that calls the library function of its own name', () => {
  test('the qualified call in the body is not a recursive call', () => {
    expect(run('function Floor(x) { std::floor(x) + 1 }\nFloor(2.5)')).toEqual(
      [3, []]
    );
    expect(run('function Abs(x) { 2 * std::abs(x) }\nAbs(-3)')).toEqual([
      6,
      [],
    ]);
    expect(
      run('function Max(a, b) { std::max(a, b) + 1 }\nMax(2, 5)')
    ).toEqual([6, []]);
  });

  test('the same function made with ce.declare() and ce.assign()', () => {
    const ce = new ComputeEngine();
    ce.declare('Floor', 'function');
    ce.assign(
      'Floor',
      ce.box(['Function', ['Apply', ['Module', 'Floor'], 'x'], 'x'])
    );
    expect(ce.box(['Floor', 2.5]).evaluate().re).toBe(2);
  });

  test('the canonical form of the structural form keeps the library binding', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Floor', 'function');
      ce.assign('Floor', ce.box(['Function', ['Add', 'u', 100], 'u']));
      const e = ce.box(['Apply', ['Module', 'Floor'], 'z']);
      const c = e.structural.canonical;
      expect(isLibraryCall(ce, c)).toBe(true);
      expect(c.subs({ z: 2.5 }).evaluate().re).toBe(2);
    } finally {
      ce.popScope();
    }
  });

  test('a qualified call rebuilt by subs() or evaluate() keeps the library binding of its structural form', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Floor', 'function');
      ce.assign('Floor', ce.box(['Function', ['Add', 'u', 100], 'u']));
      const p = ce.box(['Add', ['Apply', ['Module', 'Floor'], 'z'], 1]);
      expect(p.structural.canonical.subs({ z: 2.5 }).evaluate().re).toBe(3);
      const q = p.subs({ z: 'w' }).structural.canonical;
      expect(q.subs({ w: 2.5 }).evaluate().re).toBe(3);
      ce.declare('y', 'real');
      ce.declare('t', 'real');
      const e = ce.box(['Apply', ['Module', 'Floor'], ['Add', 'y', 't']]);
      const v = e.evaluate().structural.canonical;
      expect(isLibraryCall(ce, v)).toBe(true);
      expect(v.subs({ y: 1.2, t: 1.3 }).evaluate().re).toBe(2);
    } finally {
      ce.popScope();
    }
  });

  test('the canonical form of the structural form of a plain call binds its name in the current scope', () => {
    // `docs/SCOPING-MODEL.md`: only a qualified call keeps the library
    // binding. `Floor(a)` was made where `Floor` is the library function,
    // and its canonical form is read where the user function `Floor` hides
    // it.
    const ce = new ComputeEngine();
    const e = ce.box(['Add', ['Floor', 'a'], 1]);
    ce.pushScope();
    try {
      ce.declare('Floor', 'function');
      ce.assign('Floor', ce.box(['Function', 100, 'u']));
      expect(e.structural.canonical.subs({}).evaluate().re).toBe(101);
    } finally {
      ce.popScope();
    }
  });
});

describe('a fold by name does not read a user call in an argument as a library call', () => {
  test('a double negation', () => {
    expect(run('function Negate(x) { 0 }\nstd::Negate(Negate(3))')).toEqual([
      0,
      [],
    ]);
    expect(
      run('function Negate(x) { 100 }\nstd::Negate(Negate(3))')
    ).toEqual([-100, []]);
  });

  test('a nested power', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Power', 'function');
      ce.assign('Power', ce.box(['Function', 1000, 'u', 'v']));
      const e = ce.box(['Apply', ['Module', 'Power'], ['Power', 'x', 2], 3]);
      expect(e.json).toEqual([
        'Apply',
        ['Module', 'Power'],
        ['Power', 'x', 2],
        3,
      ]);
      expect(e.subs({ x: 4 }).evaluate().re).toBe(1e9);
    } finally {
      ce.popScope();
    }
  });

  test('a nested quotient', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Divide', 'function');
      ce.assign('Divide', ce.box(['Function', 1000, 'u', 'v']));
      const e = ce.box(['Apply', ['Module', 'Divide'], ['Divide', 'x', 2], 3]);
      expect(e.subs({ x: 4 }).evaluate().json).toEqual(['Rational', 1000, 3]);
    } finally {
      ce.popScope();
    }
  });

  test('a nested product', () => {
    expect(
      run('function Multiply(a, b) { a + b }\nstd::Multiply(Multiply(2, 3), 4)')
    ).toEqual([20, []]);
  });

  test('a nested relational operator', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('TildeEqual', 'function');
      ce.assign('TildeEqual', ce.box(['Function', 'True', 'a']));
      const e = ce.box([
        'Apply',
        ['Module', 'TildeEqual'],
        ['TildeEqual', 'a'],
        'b',
      ]);
      expect(e.operator).toBe('TildeEqual');
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.json).toEqual([
        'Apply',
        ['Module', 'TildeEqual'],
        ['TildeEqual', 'a'],
        'b',
      ]);
    } finally {
      ce.popScope();
    }
  });

  test('a product made in another scope holds a user call of Multiply', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Multiply', 'function');
    ce.assign('Multiply', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const u = ce.box(['Multiply', 2, 3]);
    ce.popScope();
    expect(ce.function('Multiply', [u, 4]).evaluate().re).toBe(20);
  });

  test('a join made in another scope holds a user call of Join', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Join', 'function');
    ce.assign('Join', ce.box(['Function', 'a', 'a', 'b']));
    const j = ce.box(['Join', ['List', 1], ['List', 2]]);
    ce.popScope();
    expect(ce.function('Join', [j, ['List', 3]]).evaluate().json).toEqual([
      'List',
      1,
      3,
    ]);
  });
});

describe('the arguments of a qualified call are checked against the library signature', () => {
  test('a user And with a numeric signature', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('And', {
        signature: '(number, number) -> number',
        evaluate: ([a, b]) => a.add(b),
      });
      const e = ce.box(['Apply', ['Module', 'And'], 'True', 'False']);
      expect(e.isValid).toBe(true);
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.evaluate().json).toEqual('False');
    } finally {
      ce.popScope();
    }
  });
});

describe('a boxed library callee of a binding operator', () => {
  test('the index is not declared in the enclosing scope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Sum', ce.box(['Function', 0, 'a', 'b']));
      const e = ce.box([
        'Apply',
        ce.box(['Module', 'Sum']),
        'k',
        ['Limits', 'k', 1, 3],
      ]);
      expect(isLibraryCall(ce, e)).toBe(true);
      expect(e.evaluate().re).toBe(6);
      expect(ce.context.lexicalScope.bindings.has('k')).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('a callee in parentheses', () => {
    // With one operand, or with the parentheses written as the second
    // operand of the `Delimiter`.
    for (const callee of [
      ['Delimiter', ['Module', 'Sum']],
      ['Delimiter', ['Module', 'Sum'], "'()'"],
    ]) {
      const ce = new ComputeEngine();
      ce.pushScope();
      try {
        ce.assign('Sum', ce.box(['Function', 0, 'a', 'b']));
        const e = ce.box(['Apply', callee, 'k', ['Limits', 'k', 1, 3]]);
        expect(isLibraryCall(ce, e)).toBe(true);
        expect(e.evaluate().re).toBe(6);
        expect(ce.context.lexicalScope.bindings.has('k')).toBe(false);
      } finally {
        ce.popScope();
      }
    }
  });

  test('a callee in a Delimiter that the program defines is not read as parentheses', () => {
    // The canonical handler of the user `Delimiter` gives the callee `Ceil`.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Delimiter', {
        signature: '(any, any?) -> any',
        canonical: (_ops, { engine }) => engine.symbol('Ceil'),
      });
      const input = ['Apply', ['Delimiter', ['Module', 'Floor']], 2.5];
      expect(ce.box(input).evaluate().re).toBe(3);
      const raw = ce.box(['Delimiter', ['Module', 'Floor']], {
        canonical: false,
      });
      expect(ce.box(['Apply', raw, 2.5]).evaluate().re).toBe(3);
    } finally {
      ce.popScope();
    }
    expect(
      ce.box(['Apply', ['Delimiter', ['Module', 'Floor']], 2.5]).evaluate().re
    ).toBe(2);
  });

  test('a callee in parentheses of an operator whose operands are values', () => {
    // In the scope where the program binds `List`, the MathJSON of the
    // library list keeps the qualifier.
    for (const [name, args, value] of [
      ['Equal', [1, 1], 'True'],
      ['List', [1, 2], ['Apply', ['Module', 'List'], 1, 2]],
    ] as const) {
      const ce = new ComputeEngine();
      ce.pushScope();
      try {
        ce.declare(name, 'function');
        ce.assign(name, ce.box(['Function', 1000, 'u', 'v']));
        const e = ce.box(['Apply', ['Delimiter', ['Module', name]], ...args]);
        expect(isLibraryCall(ce, e)).toBe(true);
        expect(e.evaluate().json).toEqual(value);
      } finally {
        ce.popScope();
      }
    }
  });

  test('a callee of another form is an error for a binding operator', () => {
    // The callee canonicalizes to the library symbol only after the
    // arguments are canonical, so the binder cannot bind its index. An
    // operator whose operands are values accepts the canonical arguments.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Sum', ce.box(['Function', 0, 'a', 'b']));
      ce.assign('Equal', ce.box(['Function', 1000, 'a', 'b']));
      const eq = ce.box(['Apply', ['Sequence', ['Module', 'Equal']], 1, 1]);
      expect(isLibraryCall(ce, eq)).toBe(true);
      expect(eq.evaluate().json).toEqual('True');
      const e = ce.box([
        'Apply',
        ['Sequence', ['Module', 'Sum']],
        'k',
        ['Limits', 'k', 1, 3],
      ]);
      expect(e.json).toEqual([
        'Error',
        ['ErrorCode', "'qualified-call-arguments-canonical'", "'Sum'"],
      ]);
    } finally {
      ce.popScope();
    }
  });
});
