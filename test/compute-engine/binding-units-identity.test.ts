import { ComputeEngine } from '../../src/compute-engine';

// Phase E of slice 1 of binding units: the identity and the resolution of a
// free name made in a scope that another scope encloses (rules 3, 7 and 8 of
// `docs/plans/2026-11-09-binding-units-slice-1-spec.md`).

function engine(): ComputeEngine {
  return new ComputeEngine();
}

describe('BINDING UNITS: A FREE NAME MADE IN A SCOPE THAT AN OPERATION PUSHED', () => {
  test('explain("solve") is an operation: the root is the `x` of the equation', () => {
    const ce = engine();
    const ex = ce.parse('2x+1=5').explain('solve');
    // A root `x` made in the scope that the solver pushes is the same
    // binding as the `x` of the equation, so no step repeats the last one.
    expect(ex.steps.map((s) => s.id)).toEqual([
      'solve.move-terms',
      'solve.linear',
    ]);
    expect(ex.steps[1].value.isSame(ce.parse('x = 2'))).toBe(true);
  });
});

describe('BINDING UNITS: THE FREE NAME OF THE BODY OF A FUNCTION LITERAL', () => {
  test('an argument with the name of a free name of the body', () => {
    const ce = engine();
    const r = ce
      .box(['Apply', ['Function', ['Multiply', 'a', 'x'], 'x'], 'a'])
      .evaluate();
    expect(r.isSame(ce.parse('a^2'))).toBe(true);
  });

  test('a literal boxed before the free name of its body is declared', () => {
    // The copy of `z_9` in the scope of the body of `first` stands for the
    // outer name, which now resolves to the declaration: it is the same
    // binding as the `z_9` of the literal boxed after the declaration.
    const ce = engine();
    const T = ['Function', ['Add', 'z_9', 1], 'u_9'] as const;
    const first = ce.box(T as any);
    const again = ce.box(T as any);
    ce.declare('z_9', 'number');
    const second = ce.box(T as any);
    expect(first.isSame(second)).toBe(true);
    expect(second.isSame(first)).toBe(true);
    expect(again.isSame(second)).toBe(true);
    expect(first.isSame(again)).toBe(true);
  });

  test('a parameter or a block local of the name stays the binder variable', () => {
    // These occurrences are not copies of a free name: each literal boxed
    // before the declaration is the same as the one boxed after it, as the
    // variable of its own binder.
    const ce = engine();
    const param = ['Function', ['Add', 'z_9', 1], 'z_9'] as const;
    const local = [
      'Function',
      ['Block', ['Declare', 'z_9', "'integer'"], ['Add', 'z_9', 1]],
      'u_9',
    ] as const;
    const p1 = ce.box(param as any);
    const l1 = ce.box(local as any);
    ce.declare('z_9', 'number');
    expect(p1.isSame(ce.box(param as any))).toBe(true);
    expect(l1.isSame(ce.box(local as any))).toBe(true);
  });
});

describe('BINDING UNITS: A FREE NAME IN THE ARGUMENT OF A CALL IS NOT A PARAMETER', () => {
  test('D(x·y, x) at (3, x) is x', () => {
    const ce = engine();
    const literal = [
      'Function',
      ['D', ['Multiply', 'x', 'y'], 'x'],
      'x',
      'y',
    ] as const;
    // `y` holds the `x` of the caller, a free name: it does not vary with
    // the variable `x` of the `D`.
    expect(ce.box(['Apply', literal, 3, 'x']).evaluate().toString()).toBe('x');
    expect(
      ce
        .box(['EvaluateAt', literal, ['Tuple', 3, 'x']])
        .evaluate()
        .toString()
    ).toBe('x');
  });
});

describe('BINDING UNITS: A NAME DOES NOT READ THE LOCAL OF A BLOCK IT WAS NOT WRITTEN IN', () => {
  test('a free name of a stored value reads past a Block local', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    const block = () =>
      ce
        .box(['Block', ['Declare', 'x', "'real'", 7], ['Add', 'a', 5]])
        .evaluate()
        .toString();
    expect(block()).toBe('106');
    ce.box(['Assign', 'x', 200]).evaluate();
    expect(block()).toBe('206');
  });

  test('a free name of a stored value with no definition stays symbolic', () => {
    const ce = engine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    const r = ce
      .box(['Block', ['Declare', 'x', "'real'", 99], ['Add', 'a', 5]])
      .evaluate();
    expect(r.isSame(ce.parse('x + 6'))).toBe(true);
  });

  test('a free name boxed before a Block does not read its local', () => {
    // The host builds the block from boxed operands: the `b` of `h(b)` was
    // boxed outside the block and keeps that meaning (`docs/plans/2026-11-11-bound-once-spec.md`, section 11).
    const ce = engine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
    const block = ce.function('Block', [
      ce.box(['Declare', 'b', "'unknown'", 3]),
      ce.function('h', [ce.symbol('b')]),
    ]);
    expect(block.evaluate().json).toEqual(['Multiply', 2, 'b']);
  });

  test('the type of a free name of a stored value is not the type of a Block local', () => {
    // `k` has no definition when `a` is assigned. In the block, the value
    // of `a` reads the outer `k`, and its type is not the type of the
    // local `k`: `Abs` keeps its bars.
    const ce = engine();
    ce.box(['Assign', 'a', ['Abs', 'k']]).evaluate();
    const r = ce
      .box(['Block', ['Declare', 'k', "'real<0..>'", 3], ['Add', 'a', 1]])
      .evaluate();
    ce.box(['Assign', 'k', -5]).evaluate();
    expect(r.evaluate().json).toBe(6);
  });

  test('the type of the body of a function called in a Block', () => {
    // `p` reads the global `k`, which holds `i`. The local `k` of the block
    // is an integer: the call is read with the type of the global `k`.
    const ce = engine();
    ce.declare('x', 'real');
    ce.assign('k', ce.parse('\\imaginaryI'));
    ce.declare('p', { signature: '(unknown) -> unknown' });
    ce.assign('p', ce.parse('P \\mapsto P.x + k'));
    const block = ce.box([
      'Block',
      ['Declare', 'k', "'integer'", 2],
      ['Add', ['p', ['Tuple', 'x', 1]], 'k'],
    ]);
    const value = block.subs({ x: 2 }).N();
    expect(value.re).toBe(4);
    expect(value.im).toBe(1);
  });
});

describe('BINDING UNITS: THE COPY OF A FREE NAME OF A BODY', () => {
  test('the value of a call is the binding of the host name', () => {
    // The `x` of the value of `g(2)` is the free name `x` of the scope that
    // the literal is written in, not the copy in the scope of the body.
    const ce = engine();
    ce.parse('g(a) := a x').evaluate();
    const v = ce.parse('g(2)').evaluate();
    expect(v.isSame(ce.parse('2x'))).toBe(true);
    expect(ce.parse('g(2) - 2x').evaluate().json).toBe(0);
  });

  test('a copy under the Block of its literal is the free name of its home scope', () => {
    // `F(x)` gives a literal whose body holds the free name `x`; the literal
    // boxed at the top level holds the copy of `x` in the scope of its body.
    const ce = engine();
    const F = ['Function', ['Function', ['Power', 'y', 'x'], 'x'], 'y'];
    const value = ce.box([F, 'x'] as any).evaluate();
    const literal = ce.box(['Function', ['Power', 'x', 'x_1'], 'x_1']);
    expect(value.isSame(literal)).toBe(true);
    expect(literal.isSame(value)).toBe(true);
  });

  test('a free name taken out of its literal is the free name', () => {
    // The boxing declares no copy of `f` in the scope of the body.
    const ce = engine();
    const literal = ce.box(['Function', ['Block', 'f'], 'x']);
    expect(literal.op1!.op1!.isSame(ce.box('f'))).toBe(true);
  });

  test('a copy that became the parameter of a literal is a parameter', () => {
    // `Limit(sin(x)/x, 0)` boxes the body first and makes its `x` the
    // parameter of the literal: it is the parameter of the parsed limit.
    const ce = engine();
    const parsed = ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}');
    const inferred = ce.box(['Limit', ['Divide', ['Sin', 'x'], 'x'], 0]);
    expect(parsed.isSame(inferred)).toBe(true);
    expect(inferred.isSame(parsed)).toBe(true);
  });

  test('an integral that inlines the body of a function', () => {
    // `∫ g(k) dk` integrates the body of `g` with `k` renamed: the `x` of
    // the value is the host `x`.
    const ce = engine();
    ce.parse('g(a) := a k x').evaluate();
    ce.parse('k := 2').evaluate();
    const r = ce.parse('\\int g(k)\\,dk').evaluate();
    expect(r.isSame(ce.parse('x k^2'))).toBe(true);
  });

  // `h := x ↦ a·x`, with `a` a global with no value. A body that leaves its
  // literal without a call (the body of `h` that `D`, `Integrate` and `Limit`
  // inline, the body of the literal of `Limit`) and a copy of a free name
  // evaluated in a call give the host `a`: the terms with `a` are merged.
  const withH = (): ComputeEngine => {
    const ce = engine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 'a', 'x'], 'x']));
    return ce;
  };
  const sum: any = ['Add', ['h', 't'], ['Multiply', 'a', 't']];

  test('the derivative of a literal that calls a function with a free name', () => {
    const ce = withH();
    const product = ['Function', ['Multiply', 'a', ['h', 'a']], 'a'];
    const r = ce.box(['Apply', ['Derivative', product], 2] as any).evaluate();
    expect(r.toString()).toBe('4a');
    expect(ce.box(['D', sum, 't']).evaluate().toString()).toBe('2a');
  });

  test('an integral, a limit and a call that inline the body of a function', () => {
    const ce = withH();
    expect(ce.box(['Integrate', sum, 't']).evaluate().toString()).toBe(
      'a * t^2'
    );
    expect(
      ce.box(['Limit', ['Function', sum, 't'], 1]).evaluate().toString()
    ).toBe('2a');
    expect(
      ce.box(['Apply', ['Function', sum, 't'], 't']).evaluate().toString()
    ).toBe('2a * t');
  });

  test('control: a parameter with the name of the free name is another binding', () => {
    const ce = withH();
    // `a ↦ a + h(a)` at 2 is `2 + 2a`: the parameter is not the global.
    const r = ce
      .box(['Apply', ['Function', ['Add', 'a', ['h', 'a']], 'a'], 2])
      .evaluate();
    expect(r.isSame(ce.parse('2 + 2a'))).toBe(true);
  });
});

describe('BINDING UNITS: A GENERIC CLAUSE WITH NO DEFINITION', () => {
  test('a later clause of a generic function is not installed at canonicalization', () => {
    // The boxing of the generic clause declares no `f`; the second clause
    // is not installed either, so `f(2)` is not checked against
    // `(x: string) -> string`, a signature that the run never gives `f`.
    const ce = engine();
    ce.pushScope();
    ce.box([
      'DefineFunction',
      'f',
      ['Function', ['Typed', ['Block', 'x'], "'(x: T) -> T where T'"], 'x'],
    ] as any);
    ce.box([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], "'string'"],
        ['Typed', 'x', "'string'"],
      ],
    ] as any);
    expect(ce.lookupDefinition('f')).toBeUndefined();
    expect(ce.box(['f', 2]).isValid).toBe(true);
    ce.popScope();
  });
});
