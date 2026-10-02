import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A COPY of a library operator definition (`ce.declare('Sqrt', {
// ...ce.lookupDefinition('Sqrt').operator })`, the overloading idiom of
// `doc/06-guide-augmenting.md`) is the library operator for the derivative
// rules and for the compiled lowering when it keeps the library's own
// `evaluate`, `canonical`, `compile` and `derivative` handlers (user decision
// 2026-10-01). Before, any definition other than the system-scope one
// shadowed the library name (`shadowsLibraryName`, `library-shadowing.ts`):
// `D(sqrt(sin(x)), x)` gave `cos(x) * Apply(Derivative(sqrt, 1), sin(x))` and
// `compile()` failed closed. A copy that replaces one of these handlers still
// shadows: the interpreter would compute something other than the library
// rule.
//

/** A fresh engine where `name` is redeclared with a copy of its library
 * definition, with the fields of `patch` replaced. */
function engineWithCopy(
  name: string,
  patch: Record<string, unknown> = {}
): ComputeEngine {
  const ce = new ComputeEngine();
  const def = ce.lookupDefinition(name) as any;
  ce.declare(name, { ...def.operator, ...patch });
  return ce;
}

/** The value of `expr` at `x = 0.7`, as a JavaScript number. */
function at(ce: ComputeEngine, expr: any): number {
  return ce.box(expr).subs({ x: 0.7 }).N().re;
}

/** A compilation that is not allowed to fall back to the interpreter. */
function compiled(ce: ComputeEngine, expr: any) {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return compile(ce.box(expr)) as any;
  } finally {
    warn.mockRestore();
  }
}

// For each copied operator: an expression that uses it, and its derivative
// with respect to `x`, written with other operators.
const CASES: [string, any, any][] = [
  [
    'Sqrt',
    ['Sqrt', ['Sin', 'x']],
    ['Divide', ['Cos', 'x'], ['Multiply', 2, ['Sqrt', ['Sin', 'x']]]],
  ],
  [
    'Sin',
    ['Sin', ['Multiply', 3, 'x']],
    ['Multiply', 3, ['Cos', ['Multiply', 3, 'x']]],
  ],
  [
    'Add',
    ['Add', ['Sin', 'x'], ['Multiply', 'x', 'x']],
    ['Add', ['Cos', 'x'], ['Multiply', 2, 'x']],
  ],
  [
    'Power',
    ['Power', ['Sin', 'x'], 3],
    ['Multiply', 3, ['Cos', 'x'], ['Power', ['Sin', 'x'], 2]],
  ],
  [
    'Abs',
    ['Abs', ['Sin', 'x']],
    ['Multiply', ['Sign', ['Sin', 'x']], ['Cos', 'x']],
  ],
];

describe('an unchanged copy of a library definition is the library operator', () => {
  test.each(CASES)('%s: D gives the library derivative', (name, expr, d) => {
    const ce = engineWithCopy(name);
    const result = ce.box(['D', expr, 'x']).evaluate();
    expect(result.has('Derivative')).toBe(false);
    expect(result.has('Apply')).toBe(false);
    expect(at(ce, result)).toBeCloseTo(at(new ComputeEngine(), d), 10);
  });

  test.each(CASES)('%s: compile() succeeds and agrees', (name, expr) => {
    const ce = engineWithCopy(name);
    const f = compiled(ce, expr);
    expect(f.success).toBe(true);
    expect(f.run({ x: 0.7 })).toBeCloseTo(at(ce, expr), 10);
  });

  test('the D of sqrt(sin(x)) from the ROADMAP entry', () => {
    const ce = engineWithCopy('Sqrt');
    expect(
      ce.parse('\\frac{d}{dx}\\sqrt{\\sin(x)}').evaluate().toString()
    ).toBe('cos(x) / (2sqrt(sin(x)))');
  });

  test('Floor: compile() succeeds and agrees', () => {
    const ce = engineWithCopy('Floor');
    const f = compiled(ce, ['Floor', ['Multiply', 3, 'x']]);
    expect(f.success).toBe(true);
    expect(f.run({ x: 0.7 })).toBe(2);
  });

  test('a copy used as a compiled callback', () => {
    const ce = engineWithCopy('Sqrt');
    ce.declare('rs', 'list<real>');
    const f = compiled(ce, ['Map', 'Sqrt', 'rs']);
    expect(f.success).toBe(true);
    expect(f.run({ rs: [1, 4] })).toEqual([1, 2]);
  });

  test('a copy that changes only `description` counts too', () => {
    const ce = engineWithCopy('Sin', { description: 'my sine' });
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('cos(x)');
    expect(compiled(ce, ['Sin', 'x']).success).toBe(true);
  });

  test('a copy of a copy counts too', () => {
    const ce = engineWithCopy('Sin');
    ce.pushScope();
    ce.declare('Sin', { ...(ce.lookupDefinition('Sin') as any).operator });
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('cos(x)');
    expect(compiled(ce, ['Sin', 'x']).success).toBe(true);
  });
});

describe('a copy that replaces a handler shadows the library operator', () => {
  test('a copy that changes `evaluate`', () => {
    const ce = engineWithCopy('Sin', {
      evaluate: ([x]: any[]) => x.engine.number(100),
    });
    const d = ce.box(['D', ['Sin', 'x'], 'x']).evaluate();
    expect(d.toString()).toBe('0');
    const f = compiled(ce, ['Sin', 'x']);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBe(100);
  });

  test('a copy that changes `derivative`', () => {
    const ce = engineWithCopy('Sin', {
      derivative: [['Function', ['Cos', 'x'], 'x']],
    });
    // The library rule of `Sin` is not used: the stated derivative is.
    // Here it is the same function, so the result differs only in form.
    const d = ce.box(['D', ['Sin', ['Multiply', 2, 'x']], 'x']).evaluate();
    expect(at(ce, d)).toBeCloseTo(2 * Math.cos(1.4), 10);
    expect(compiled(ce, ['Sin', 'x']).success).toBe(false);
  });

  test('a copy that changes `compile`', () => {
    const ce = engineWithCopy('Sin', {
      compile: (args: any[], compileFn: any) =>
        `(42 + 0 * ${compileFn(args[0])})`,
    });
    // The compiler uses the handler of the copy.
    const f = compiled(ce, ['Sin', 'x']);
    expect(f.success).toBe(true);
    expect(f.run({ x: 0.7 })).toBe(42);
    // The derivative rule of the library is not used.
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .has('Derivative')
    ).toBe(true);
  });

  // `lazy`, `broadcastable` and `evaluateAsync` change how the arguments are
  // evaluated or compiled, or the value under `evaluateAsync()`: a copy that
  // changes one of them is a user definition too.
  test('a copy of `Sin` that changes `broadcastable`', () => {
    const ce = engineWithCopy('Sin', { broadcastable: false });
    const d = ce.box(['D', ['Sin', ['Multiply', 3, 'x']], 'x']).evaluate();
    expect(d.has('Derivative')).toBe(true);
    const f = compiled(ce, ['Sin', 'x']);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBeCloseTo(Math.sin(0.7), 10);
  });

  test('a copy of the lazy `Add` that changes `lazy`', () => {
    const ce = engineWithCopy('Add', { lazy: false });
    expect((ce.lookupDefinition('Add') as any).operator.lazy).toBe(false);
    const expr = ['Add', ['Sin', 'x'], ['Multiply', 'x', 'x']];
    const d = ce.box(['D', expr, 'x']).evaluate();
    expect(d.has('Derivative')).toBe(true);
    const f = compiled(ce, expr);
    expect(f.success).toBe(false);
    expect(f.run({ x: 0.7 })).toBeCloseTo(Math.sin(0.7) + 0.49, 10);
  });

  test('a copy that changes `evaluateAsync`', () => {
    const ce = engineWithCopy('Sin', {
      evaluateAsync: async ([x]: any[]) => x.engine.number(100),
    });
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .has('Derivative')
    ).toBe(true);
    expect(compiled(ce, ['Sin', 'x']).success).toBe(false);
  });

  test('an extension that changes `broadcastable` shadows', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', { broadcastable: false }, { extend: true });
    expect(compiled(ce, ['Sin', 'x']).success).toBe(false);
  });

  test('a user `function Sin(x)` still shadows', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'function Sin(x) { x + 100 }\nSin(2)'
    );
    expect(r.value.toString()).toBe('102');
  });

  test('a user definition of `Sin` still shadows for D and compile()', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'Sin',
      ['Function', ['Multiply', 3, 'x'], 'x'],
    ]).evaluate();
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('3');
    const f = compiled(ce, ['Sin', 'x']);
    expect(f.success).toBe(false);
    expect(f.run({ x: 2 })).toBe(6);
  });

  test('a parameter named `Sin` is still the argument', () => {
    const ce = engineWithCopy('Sin');
    const r = executeEpsil(ce, '((Sin) => Sin(2))(x => x + 100)');
    expect(r.value.toString()).toBe('102');
  });
});

describe('a copy under another name is not the library operator', () => {
  test('MySqrt', () => {
    // There is no library rule or target lowering for `MySqrt`: D
    // differentiates it as a user function, and compile() fails closed.
    const ce = new ComputeEngine();
    const { name: _name, ...sqrt } = (ce.lookupDefinition('Sqrt') as any)
      .operator;
    ce.declare('MySqrt', sqrt);
    const expr = ['MySqrt', ['Sin', 'x']];
    expect(ce.box(expr).toString()).toBe('MySqrt(sin(x))');
    // `MySqrt` keeps its head when its `evaluate` handler runs, so `D` does
    // not see a `Sqrt` (before, the library handler returned `Sqrt(t)` and
    // `D` used the rule of `Sqrt`).
    const d = ce.box(['D', expr, 'x']).evaluate();
    expect(d.toString()).toBe(
      'cos(x) * Apply(Derivative("MySqrt", 1), sin(x))'
    );
    const f = compiled(ce, ['MySqrt', 'x']);
    expect(f.success).toBe(false);
    expect(f.run({ x: 4 })).toBe(2);
  });
});

// A library `canonical` or `evaluate` handler builds its result with the
// name of its own operator: the handlers of `Sin` return `Sin(…)`. A copy
// under another name kept that head, so `MySin(x)` boxed to `sin(x)`.
describe('a copy under another name keeps its head', () => {
  function engineWithRenamedCopy(
    name: string,
    newName: string,
    patch: Record<string, unknown> = {}
  ): ComputeEngine {
    const ce = new ComputeEngine();
    const { name: _name, ...def } = (ce.lookupDefinition(name) as any).operator;
    ce.declare(newName, { ...def, ...patch });
    return ce;
  }

  test('MySin, a copy of Sin', () => {
    const ce = engineWithRenamedCopy('Sin', 'MySin');
    const expr = ce.box(['MySin', 'x']);
    expect(expr.operator).toBe('MySin');
    expect(expr.toString()).toBe('MySin(x)');
    // The library `evaluate` handler gives no value for `x`, and the head is
    // kept.
    expect(expr.evaluate().toString()).toBe('MySin(x)');
    expect(ce.box(['MySin', 1]).evaluate().toString()).toBe('MySin(1)');
    // The values are those of `Sin`.
    expect(ce.box(['MySin', 'Pi']).evaluate().toString()).toBe('0');
    expect(ce.box(['MySin', 1]).N().re).toBeCloseTo(Math.sin(1), 12);
    // The canonical rewrite of an angle in degrees keeps the head too.
    const deg = ce.box(['MySin', ['Degrees', 30]]);
    expect(deg.operator).toBe('MySin');
    expect(deg.evaluate().toString()).toBe('1/2');
  });

  test('a copy under another name runs its own `evaluate`', () => {
    const ce = engineWithRenamedCopy('Sin', 'MySin', {
      evaluate: ([x]: any[]) => x.engine.number(100),
    });
    const expr = ce.box(['MySin', 'x']);
    expect(expr.toString()).toBe('MySin(x)');
    expect(expr.evaluate().toString()).toBe('100');
  });

  test.each(['Cos', 'Tanh', 'Arcsin', 'Integrate', 'Matrix'])(
    'a copy of %s',
    (name) => {
      const ce = engineWithRenamedCopy(name, `My${name}`);
      expect(ce.box([`My${name}`, 'x']).operator).toBe(`My${name}`);
    }
  );

  // The `canonical` handler of `NotEqual` turns a chain into an `And` of
  // `NotEqual` nodes. The nodes that it builds get the name of the copy, so
  // the copy's handlers run on them. Before, `MyNotEqual(x, y, z)` boxed to
  // `x != y && y != z`, with library `NotEqual` nodes.
  test('a chain of MyNotEqual, a copy of NotEqual', () => {
    const ce = engineWithRenamedCopy('NotEqual', 'MyNotEqual');
    const expr = ce.box(['MyNotEqual', 'x', 'y', 'z']);
    expect(JSON.stringify(expr.json)).toBe(
      '["And",["MyNotEqual","x","y"],["MyNotEqual","y","z"]]'
    );
    expect(expr.has('NotEqual')).toBe(false);
    // The value is that of the chain: 1 ≠ 2 and 2 ≠ 1.
    expect(ce.box(['MyNotEqual', 1, 2, 1]).evaluate().json).toBe('True');
    expect(ce.box(['MyNotEqual', 1, 2, 2]).evaluate().json).toBe('False');
  });

  test('a chain of a copy with its own `evaluate`', () => {
    const ce = engineWithRenamedCopy('NotEqual', 'MyNotEqual', {
      evaluate: (_ops: any[], { engine }: any) => engine.True,
    });
    // The library `NotEqual` gives `False` for `1 ≠ 1`: the handler of the
    // copy runs on each node of the chain instead.
    expect(ce.box(['MyNotEqual', 1, 1, 1]).evaluate().json).toBe('True');
  });

  test('a library node in an operand keeps its name', () => {
    const ce = engineWithRenamedCopy('NotEqual', 'MyNotEqual');
    expect(
      JSON.stringify(ce.box(['MyNotEqual', ['NotEqual', 'a', 'b'], 'c']).json)
    ).toBe('["And",["NotEqual","a","b"],["MyNotEqual","b","c"]]');
  });

  // `DeclareType` is lazy: its handler does not canonicalize the expression
  // operand. Before, the renaming canonicalized the raw operands to compare
  // them with the result, which declared `kk` and `zz`.
  test('a copy of a lazy operator does not declare the free symbols', () => {
    const ce = engineWithRenamedCopy('DeclareType', 'MyDeclareType');
    ce.box(['MyDeclareType', ['Multiply', 'kk', 'zz'], 'kk']);
    expect(ce.lookupDefinition('kk')).toBeUndefined();
    expect(ce.lookupDefinition('zz')).toBeUndefined();
  });

  // The handler returns its single operand. Before, the library node `And(A,
  // B)` was renamed to `MyAnd(A, B)`.
  test('a library operand returned by the handler keeps its name', () => {
    const ce = engineWithRenamedCopy('And', 'MyAnd');
    expect(JSON.stringify(ce.box(['MyAnd', ['And', 'A', 'B']]).json)).toBe(
      '["And","A","B"]'
    );
    expect(JSON.stringify(ce.box(['MyAnd', 'A', 'B']).json)).toBe(
      '["MyAnd","A","B"]'
    );
  });

  // The `canonical` handler of `And` flattens a nested `And`. Before,
  // `Nand2(And(A, B), C)` boxed to `Nand2(A, B, C)`: the library `And(A, B)`
  // was evaluated by the handler of the copy.
  test('a library operand flattened by the handler is not renamed', () => {
    const ce = engineWithRenamedCopy('And', 'Nand2', {
      evaluate: (ops: any[], { engine }: any) =>
        engine.box(['Not', ['And', ...ops]]).evaluate(),
    });
    const expr = ce.box(['Nand2', ['And', 'A', 'B'], 'C']);
    expect(JSON.stringify(expr.json)).toBe('["Nand2",["And","A","B"],"C"]');
    ce.assign('A', true);
    ce.assign('B', false);
    ce.assign('C', true);
    // Nand(A ∧ B, C) = ¬(False ∧ True) = True
    expect(expr.evaluate().json).toBe('True');
  });

  test('the library operators keep their own canonical forms', () => {
    const ce = engineWithRenamedCopy('Sin', 'MySin');
    expect(ce.box(['Sin', 'x']).operator).toBe('Sin');
    expect(ce.box(['Rational', 1, 2]).toString()).toBe('1/2');
    expect(
      ce
        .box(['Sin', ['Degrees', 30]])
        .evaluate()
        .toString()
    ).toBe('1/2');
    const ce2 = engineWithRenamedCopy('NotEqual', 'MyNotEqual');
    expect(JSON.stringify(ce2.box(['NotEqual', 'x', 'y', 'z']).json)).toBe(
      '["And",["NotEqual","x","y"],["NotEqual","y","z"]]'
    );
  });
});

describe('the extend mode is unchanged', () => {
  test('an extension that keeps the handlers is the library operator', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', { description: 'my sine' }, { extend: true });
    expect(
      ce
        .box(['D', ['Sin', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('cos(x)');
    expect(compiled(ce, ['Sin', 'x']).success).toBe(true);
  });

  test('an extension that replaces `evaluate` shadows', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'Sin',
      { evaluate: ([x]: any[]) => x.engine.number(100) },
      { extend: true }
    );
    expect(compiled(ce, ['Sin', 'x']).success).toBe(false);
  });
});
