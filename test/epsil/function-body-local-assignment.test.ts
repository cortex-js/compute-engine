import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// A local of a function body is made only by a `let` (a `Declare`) at the
// top level of the body or of a nested block. An assignment writes the
// variable that is in scope and never makes one: an assignment to a name
// that no enclosing scope declares is the static error
// `assignment-to-undeclared-variable`. Each call gives a local a new
// binding, so a declaration of the same name made later is not written. A
// write to a local is not the `scope` effect, and the function needs no
// effect specifier.
//
// A write to a name that an enclosing scope declares when the function is
// defined (a top-level `let`, a parameter or a local of an enclosing
// function) is the `scope` effect.
//

const SCOPE_ERROR =
  'writes outside a function require a declared `scope` effect';

function run(source: string): {
  ce: ComputeEngine;
  value: unknown;
  diagnostics: string[];
} {
  const ce = new ComputeEngine();
  const { value, diagnostics } = executeEpsil(ce, source);
  return {
    ce,
    value: value.json,
    diagnostics: diagnostics.map((d) => d.message.map(String).join(' ')),
  };
}

/** The engine codes of the static errors that the run of `source` reports,
 * and the message of each other diagnostic. */
function staticCodes(source: string): string[] {
  return executeEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
    String(d.message[0] === 'static-type-error' ? d.message[3] : d.message[0])
  );
}

function expectScopeError(source: string): void {
  const { diagnostics } = run(source);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toContain('runtime-error');
  expect(diagnostics[0]).toContain(SCOPE_ERROR);
}

describe('A LOCAL OF A FUNCTION BODY IS DECLARED WITH `let`', () => {
  test('an assignment to a name that no scope declares is an error', () => {
    expect(
      staticCodes('function g(k) { t = k + 1; t }\n[g(1), g(2)]')
    ).toEqual(['assignment-to-undeclared-variable']);
    expect(staticCodes('g(k) = do { t = k + 1; t }\n[g(1), g(2)]')).toEqual([
      'assignment-to-undeclared-variable',
    ]);
  });

  test('a `let` makes a local', () => {
    const { ce, value, diagnostics } = run(
      'function g(k) { let t = k + 1; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('the local does not leave the function', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = k + 1; t }\ng(1)\nt'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe('t');
  });

  test('a one-step definition with a `do` block', () => {
    const { value, diagnostics } = run(
      'g(k) = do { let t = k + 1; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('an accumulator in a loop', () => {
    const { ce, value, diagnostics } = run(
      'function s(n) { let acc = 0; for i in 1..n { acc = acc + i }; acc }\n[s(3), s(4)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 6, 10]);
    expect(ce.box('s').type.toString()).not.toContain('scope');
  });

  test('a local assigned in each branch of an `if`', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = 0; if k > 1 { t = 1 } else { t = 2 }; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 1]);
  });

  test('an assignment in one branch of an `if` to an undeclared name', () => {
    // The name must be declared with a value before the branch.
    expect(
      staticCodes('function g(k) { if k > 1 { t = k }; k }\n[g(1), g(2)]')
    ).toEqual(['assignment-to-undeclared-variable']);
  });

  test('a local that holds a function', () => {
    const { value, diagnostics } = run(
      'function g(k) { let h = (z) => 2z; h(k) }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 4]);
  });

  test('a local that holds a function that draws', () => {
    // The call of the local gives its effects to the function: `random`, and
    // no `scope`.
    const { ce, diagnostics } = run(
      'function g(k) { let h = (z) => random(); h(k) }'
    );
    expect(diagnostics).toEqual([]);
    const type = ce.box('g').type.toString();
    expect(type).toContain('random');
    expect(type).not.toContain('scope');
  });

  test('a recursive function with a local', () => {
    const { value, diagnostics } = run(
      'function fact(n) { let t = n; if n <= 1 { 1 } else { t * fact(n - 1) } }\n[fact(1), fact(5)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 120]);
  });

  test('a local read by a closure that the function returns', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = k; () => t }\nlet a = g(1)\nlet b = g(2)\n[a(), b()]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 2]);
  });

  test('a local read by a closure that the function calls', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = k + 1; let h = () => t; h() }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('a function defined in a function body, with a local', () => {
    const { value, diagnostics } = run(
      'function f(n) { function g(k) { let t = k + 1; t }; g(n) }\n[f(1), f(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('the static check reports nothing, and infers no effect', () => {
    const { diagnostics, effects } = checkSource(
      'function g(k) { let t = k + 1; t }\n[g(1), g(2)]',
      undefined,
      { effects: true }
    );
    expect(diagnostics).toEqual([]);
    expect(effects).toEqual([
      { name: 'g', range: [9, 10], effects: [], declared: false },
    ]);
  });
});

describe('AN ASSIGNMENT TO A NAME DECLARED OUTSIDE IS THE `scope` EFFECT', () => {
  test('a top-level `let` before the function', () => {
    expectScopeError('let t = 0\nfunction g(k) { t = k + 1; t }\n[g(1), t]');
  });

  test('a top-level assignment before the function declares nothing', () => {
    // The top level of a program is a block: `t = 3` there is an error too.
    expect(
      staticCodes('t = 3\nfunction g(k) { t = k + 1; t }\n[g(1), t]')
    ).toEqual([
      'assignment-to-undeclared-variable',
      'assignment-to-undeclared-variable',
    ]);
  });

  test('with the `scope` specifier, the outer variable is written', () => {
    const { value, diagnostics } = run(
      'let t = 0\nfunction g(k) scope { t = k + 1; t }\n[g(1), g(2), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3, 3]);
  });

  test('a parameter of an enclosing function', () => {
    expectScopeError(
      'function f(t) { function g(k) { t = k + 1; t }; [g(1), t] }\nf(5)'
    );
    expectScopeError(
      'function f(t) { g(k) = do { t = k + 1; t }; g(1) }\nf(5)'
    );
    expectScopeError(
      'function f(t) { let g = (k) => do { t = k + 1; t }; [g(1), t] }\nf(5)'
    );
  });

  test('a local of an enclosing function', () => {
    expectScopeError(
      'function f(n) { let t = 0; g(k) = do { t = k + 1; t }; [g(n), t] }\nf(1)'
    );
  });

  test('a local written by a closure that the function calls', () => {
    // The closure can outlive the call and keep the binding, as with a
    // `let` local.
    expectScopeError(
      'function g(k) { let t = k; let inc = () => do { t = t + 1 }; inc(); t }\n[g(1), g(2)]'
    );
  });
});

describe('THE SCOPE OF A NAME IS DECIDED WHERE THE FUNCTION IS DEFINED', () => {
  test('a top-level `let` after the function is not written', () => {
    const { ce, value, diagnostics } = run(
      'function g(k) { let t = k + 1; t }\nlet t = 0\n[g(1), g(2), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3, 0]);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('a top-level `let` after the function does not declare its name in the body', () => {
    expect(
      staticCodes('function g(k) { t = k + 1; t }\nlet t = 0\n[g(1), g(2), t]')
    ).toEqual(['assignment-to-undeclared-variable']);
  });

  test('a top-level assignment after the function is not written', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = k + 1; t }\nlet t = 0\nt = 10\n[g(1), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 10]);
  });

  test('a later program on the same engine', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(k) { let t = k + 1; t }');
    executeEpsil(ce, 'let t = 10');
    expect(executeEpsil(ce, 'g(1)').value.json).toBe(2);
    expect(executeEpsil(ce, 't').value.json).toBe(10);
  });

  test('a later function with the name of a local called by a closure', () => {
    // The call of the local in the closure makes the function wait on the
    // name, so the later definition builds the function again. The name stays
    // a local of the function.
    const source =
      'function h(n) { let g = (z) => 0; (z) => g(z) + n }\n' +
      'function g(t) { 9 }\n' +
      '[h(1)(0), g(0)]';
    const { ce, value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 9]);
    expect(ce.box('h').type.toString()).not.toContain('scope');
  });

  test('a program read as one block, where a later function builds `h` again', () => {
    // The program block installs `other` while it is canonicalized, and `h`
    // is built again then, with the declaration of `t` on the declaration
    // stack. `t` stays a local of `h`.
    const ce = new ComputeEngine();
    const program = ce.box(
      parseEpsil(
        'function h(n) { let t = 1; t + other(n) }\n' +
          'let t = 10\n' +
          'function other(u) { 2u }\n' +
          '[h(2), t]'
      )[0] as never
    );
    expect(program.isValid).toBe(true);
    expect(ce._inScope(program.localScope, () => ce.box('h').type.toString())).not.toContain('scope');
    expect(program.evaluate().json).toEqual(['List', 5, 10]);
  });

  test('a local of a nested block', () => {
    for (const body of [
      '{ do { let t = k + 1 }; k }',
      '{ let u = do { let t = k + 1; t }; u }',
    ]) {
      const { value, diagnostics } = run(
        `function g(k) ${body}\nlet t = 10\n[g(1), t]`
      );
      expect(diagnostics).toEqual([]);
      expect((value as unknown[])[2]).toBe(10);
    }
  });

  test('a local written in a branch and read after it', () => {
    // The branch writes the local of the body, which is declared with a
    // value before the branch.
    const { value, diagnostics } = run(
      'function g(k) { let t = 0; if k > 1 { t = 5 }; t = t + 1; t }\ng(2)'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(6);
  });

  test('a function with the `scope` specifier: a `let` is still a local', () => {
    // `scope` permits a write to a binding outside the function; it does
    // not make a `let` refer to one, and it does not declare a name that
    // the body assigns.
    const { ce, value, diagnostics } = run(
      'function g(k) scope { let t = k + 1; t }\nlet t = 0\n[g(1), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 0]);
    expect(ce.box('g').type.toString()).toContain('scope');
    expect(
      staticCodes('function g(k) scope { t = k + 1; t }\nlet t = 0\n[g(1), t]')
    ).toEqual(['assignment-to-undeclared-variable']);
  });

  test('the host route: `Assign` and `ce.assign()`', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Function',
          ['Block', ['Assign', 't', ['Add', 'k', 1]], 't'],
          'k',
        ])
        .toString()
    ).toContain('Error(ErrorCode("assignment-to-undeclared-variable", "t"))');
    ce.box([
      'Assign',
      'g',
      [
        'Function',
        ['Block', ['Declare', 't', "'unknown'", ['Add', 'k', 1]], 't'],
        'k',
      ],
    ]).evaluate();
    expect(ce.box('g').type.toString()).toBe('(k: unknown) -> number');
    ce.assign('t', 10);
    expect(ce.box(['g', 1]).evaluate().json).toBe(2);
    expect(ce.box('t').evaluate().json).toBe(10);

    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Block', ['Declare', 'u', "'unknown'", ['Multiply', 'k', 2]], 'u'],
        'k',
      ])
    );
    ce.assign('u', 7);
    expect(ce.box(['h', 3]).evaluate().json).toBe(6);
    expect(ce.box('u').evaluate().json).toBe(7);
  });

  test('a const after the function is not written', () => {
    const { value, diagnostics } = run(
      'function g() { let c = 2; c }\nconst c = 1\n[g(), c]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 1]);
  });
});

describe('AN ANNOTATION ON THE FUNCTION DOES NOT CHANGE ITS LOCALS', () => {
  // A return type or an effect specifier moves onto the last statement of
  // the body as a `Typed` wrapper. The last statement is still an
  // assignment to a local, or a declaration of the block.
  test('a return type, the assignment is the last statement', () => {
    // A body whose last statement is an assignment has the value `Nothing`,
    // which is not an `integer`: the call is an `incompatible-type` error.
    const { ce, value, diagnostics } = run(
      'function f() -> integer { let x = 0; x = 2 }\nf()'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'integer'", "'nothing'"],
      ['Assign', 'x', 2],
    ]);
    expect(ce.box('f').type.toString()).not.toContain('scope');
  });

  test('a return type, a `let` after the function is not written', () => {
    const { value, diagnostics } = run(
      'function f() -> nothing { let y = 0; let x = 2 }\nlet x = 1\nf()\nx'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(1);
  });

  test('the `scope` specifier, a `let` after the function is not written', () => {
    const { value, diagnostics } = run(
      'function f() scope { let y = 0; let x = 2 }\nlet x = 1\nf()\nx'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(1);
  });

  test('a return type, the last statement re-declares a name', () => {
    for (const source of [
      'function f(x) -> integer { let x = 2 }\nf(1)',
      'function f() -> integer { let y = 1; let y = 2 }\nf()',
    ]) {
      const { diagnostics } = run(source);
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const d of diagnostics)
        expect(d).toContain('variable-redeclaration');
    }
  });
});

describe('THE COMPILED ROUTES AGREE WITH THE RUN', () => {
  // The compiler declares a local of a block as a local of the generated
  // function (`let t`), from the binding that the canonicalization made.
  // So the compiled function, like the run, has its own `t` at each
  // call, also when a `t` is assigned on the engine after the function was
  // boxed.
  const G = [
    'Function',
    ['Block', ['Declare', 't', "'unknown'", ['Add', 'k', 1]], 't'],
    'k',
  ];
  const IF_BRANCH = [
    'Function',
    [
      'Block',
      ['Declare', 't', "'unknown'", 0],
      ['If', ['Greater', 'k', 1], ['Block', ['Assign', 't', 5]]],
      ['Assign', 't', ['Add', 't', 1]],
      't',
    ],
    'k',
  ];

  test('a body that declares a local, with a `t` assigned after the function', () => {
    const [literal, value] = [G, 3];
    const ce = new ComputeEngine();
    const fn = ce.box(literal as never);
    ce.assign('t', 10);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/\blet t\b/);
    expect(result.run!(2 as never)).toBe(value);
    // The run gives the same value, and does not write the outer `t`.
    expect(ce.box(['Apply', fn, 2]).evaluate().json).toBe(value);
    expect(ce.box('t').evaluate().json).toBe(10);
  });

  test('a local written in a branch and read after it', () => {
    // The local is declared with a value before the branch, so every read
    // comes after an assignment.
    const ce = new ComputeEngine();
    const fn = ce.box(IF_BRANCH as never);
    ce.assign('t', 10);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.success).toBe(true);
    expect(result.run!(2 as never)).toBe(6);
    expect(result.run!(0 as never)).toBe(1);
    expect(ce.box(['Apply', fn, 2]).evaluate().json).toBe(6);
    expect(ce.box('t').evaluate().json).toBe(10);
  });

  test('interval-js declares the local too', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(G as never);
    ce.assign('t', 10);
    const result = compile(fn, {
      to: 'interval-js',
      fallback: false,
    } as never)!;
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/\blet t\b/);
  });

  test('a write to a name assigned before the function is refused', () => {
    // The compiled code reads an assigned value as a constant of the
    // generated source, so it cannot write it: the compilation fails, as
    // before the static rule.
    const ce = new ComputeEngine();
    ce.declare('t', 'integer');
    ce.assign('t', 10);
    const fn = ce.box([
      'Function',
      ['Block', ['Assign', 't', ['Add', 'k', 1]], 't'],
      'k',
    ] as never);
    expect(() =>
      compile(fn, { to: 'javascript', fallback: false } as never)
    ).toThrow(/has an assigned value/);
  });

  test('an Epsil program', () => {
    const source = 'function g(k) { let t = k + 1; t }\n[g(1), g(2)]';
    const ce = new ComputeEngine();
    const program = ce.box(parseEpsil(source)[0] as never);
    const result = compile(program, {
      to: 'javascript',
      fallback: false,
    } as never)!;
    expect(result.run!({} as never)).toEqual([2, 3]);
    expect(run(source).value).toEqual(['List', 2, 3]);
  });
});

/** True when `value` (MathJSON) is an `Error` whose code is `code`. */
function expectErrorCode(value: unknown, code: string): void {
  expect(Array.isArray(value)).toBe(true);
  expect((value as unknown[])[0]).toBe('Error');
  expect(((value as unknown[])[1] as unknown[])[1]).toBe(`'${code}'`);
}

describe('A USE OF A LOCAL BEFORE ITS DECLARATION IS A STATIC ERROR', () => {
  // A local of a block has its value from the `let` that declares it. A use
  // of the local in a statement before that one is the static error
  // `read-before-declaration`. The value of a `let` reads the name outside
  // the block. An assignment, also in a branch or in a loop body, to a name
  // that no scope declares is the static error
  // `assignment-to-undeclared-variable`. The static check reports each error
  // before the program runs. A use in the body of a function literal is not
  // a use: it runs when the function is called.
  const codes = (source: string): string[] =>
    executeEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
      String(d.message[0] === 'static-type-error' ? d.message[3] : d.message[0])
    );

  test.each([
    'function g(k) { let u = t; let t = k; u }\ng(1)',
    'function g(k) { let u = 0; u = t; let t = k; u }\ng(1)',
    'function g() { let u = sqrt(t) + t^2; let t = 1; u }\ng()',
    'function g() { let u = [t, 1]; let t = 1; u }\ng()',
    // A variable outside the function is not read.
    'function g(k) { let u = t; let t = k; u }\nlet t = 5\ng(1)',
    // In the initializer of a `let`, in a condition, in an operand.
    'function g() { let w = t + 1; let t = 1; w }\ng()',
    'function g() { if t > 0 { 1 }; let t = 1 }\ng()',
    'function g() { let u = sin(t) + [t, 1][1]; let t = 1; u }\ng()',
    // An assignment in a branch before the declaration.
    'function g(k) { if k > 1 { t = 5 }; let t = 0; t }\ng(2)',
    'function g(n, r) { let u = 0; if r { u = t }; let t = n; u }\ng(0, false)',
    // A function literal assigned to a name, a nested function.
    'let g = (k) => do { let u = t; let t = k; u }\ng(1)',
    'function f() { function g(k) { let u = t; let t = k; u }; g(1) }\nf()',
    // The collection of a loop.
    'function g() { let s = 0; for i in t { s = s + 1 }; let t = [1]; s }\ng()',
    // A call of a local.
    'function g() { let u = h(1); let h = (x) => x; u }\ng()',
    'function g() { let u = 0; u = h(1); let h = (x) => x; u }\ng()',
    // A call of a function statement of the block before its statement.
    'function g() { let u = h(1); function h(x) { x }; u }\ng()',
    // A block outside every function.
    'do { let u = t; let t = 1; u }',
    'do { let u = h(1); let h = (x) => x; u }',
    // The top level of a program is a block.
    'let u = t\nlet t = 1\nu',
    'let u = h(1)\nlet h = (x) => x\nu',
  ])('%j', (source) => {
    expect(codes(source)).toEqual(['read-before-declaration']);
  });

  test('the operand of `Hold` is quoted, and is not a use', () => {
    expect(
      codes('function g() { let u = Hold(t); let t = 1; u }\ng()')
    ).toEqual([]);
    const r = executeEpsil(new ComputeEngine(), 'do { Hold(k); let k = 2; k }');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('2');
  });

  test.each([
    ['function g(k) { t = t + 1; t }\ng(1)', 'function g(k) { let t = t + 1; t }\ng(1)'],
    ['function g(k) { (t, w) := (t, 1); t }\ng(1)', 'function g(k) { let (t, w) = (t, 1); t }\ng(1)'],
  ])('an assignment that reads the name is an error, a let reads the outer name: %j', (source, withLet) => {
    const run = (src: string) => executeEpsil(new ComputeEngine(), src);
    expect(codes(source)).toEqual(['assignment-to-undeclared-variable']);
    expect(run(withLet).diagnostics).toEqual([]);
  });

  test.each([
    [
      'function g(c) { if c { u = t }; t = 1; 0 }\ng(true)',
      [
        'assignment-to-undeclared-variable',
        'assignment-to-undeclared-variable',
      ],
    ],
    [
      'function g(c) { if c { t = 1 }; t }\ng(true)',
      ['assignment-to-undeclared-variable'],
    ],
    [
      'function g() { for i in t { s = i }; t = [1] }\ng()',
      [
        'assignment-to-undeclared-variable',
        'assignment-to-undeclared-variable',
      ],
    ],
  ])('an assignment in a branch to an undeclared name: %j', (source, expected) => {
    expect(codes(source)).toEqual(expected);
  });

  test('an assignment of two undeclared names in a loop body', () => {
    expect(
      codes('function g() { for i in [1, 2] { s = t; t = i }; 0 }\ng()')
    ).toEqual([
      'assignment-to-undeclared-variable',
      'assignment-to-undeclared-variable',
    ]);
  });

  test.each([
    // A closure called after the declaration.
    ['function g() { let f = () => t; let t = 1; f() }\ng()', 1],
    ['function g() { let h = (x) => 2x; h(3) }\ng()', 6],
    ['function g() { let f = () => h(3); let h = (x) => 2x; f() }\ng()', 6],
    // A function statement of a block declares a local, which is called
    // after its statement.
    ['let r = do { function h(x) { x }; let u = h(1); u }\nr', 1],
    // A function statement of the top level gives its name its value from
    // the start of the program.
    ['let u = h(1)\nfunction h(x) { x }\nu', 1],
    ['let s = 0\nfor i in tt { s = i }', 'Nothing'],
    ['let s = 0\nfor i in 5 { s = i }', 'Nothing'],
  ])('valid: %j', (source, value) => {
    const r = executeEpsil(new ComputeEngine(), source);
    expect(r.diagnostics).toEqual([]);
    expect(r.value.json).toEqual(value);
  });

  test('the host route', () => {
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'u', "'unknown'", 't'],
        ['Declare', 't', "'unknown'", 'k'],
        'u',
      ],
      'k',
    ]);
    expect(fn.toString()).toContain(
      'Error(ErrorCode("read-before-declaration", "t"))'
    );
    // The value of a declaration reads the name outside the block.
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'x', "'unknown'", ['Add', 'x', 1]],
          ['Multiply', 2, 'x'],
        ])
        .toString()
    ).not.toContain('Error');
  });
});

/** The value of the program `source` on the routes that read it as one
 * `Block`: the compiled JavaScript, and the evaluation of the block. */
function blockRoutes(source: string): {
  compiled: unknown;
  evaluated: unknown;
} {
  const compiled = compile(
    new ComputeEngine().box(parseEpsil(source)[0] as never),
    { to: 'javascript', fallback: false } as never
  )!.run!({} as never);
  const evaluated = new ComputeEngine()
    .box(parseEpsil(source)[0] as never)
    .evaluate().json;
  return { compiled, evaluated };
}

describe('A PROGRAM READ AS ONE BLOCK FOLLOWS THE ORDER OF ITS STATEMENTS', () => {
  // The top-level block of a program declares its names before it
  // canonicalizes its statements. A `let` in a function body makes a local
  // of the body also when a later statement declares the same name, as in
  // `executeEpsil`, which reads one top-level statement at a time.
  test.each([
    [
      'a `let` after the function',
      'function g(k) { let t = k + 1; t }\nlet t = 0\n[g(1), g(2), t]',
      [2, 3, 0],
    ],
    [
      'an assignment after the function',
      'function g(k) { let t = k + 1; t }\nlet t = 0\nt = 10\n[g(1), t]',
      [2, 10],
    ],
    [
      'a `scope` function, a `let` after it',
      'function g(k) scope { let t = k + 1; t }\nlet t = 0\n[g(1), t]',
      [2, 0],
    ],
    [
      'a function defined after the function',
      'function f() { let h = 1; h }\nfunction h() { 5 }\n[f(), h()]',
      [1, 5],
    ],
  ])('%s', (_name, source, value) => {
    expect(run(source)).toMatchObject({
      value: ['List', ...value],
      diagnostics: [],
    });
    expect(blockRoutes(source)).toEqual({
      compiled: value,
      evaluated: ['List', ...value],
    });
  });

  test('a read of a later name is not changed', () => {
    // The function reads the binding when it is called.
    const source = 'function g() { t }\nlet t = 5\ng()';
    expect(run(source).value).toBe(5);
    expect(blockRoutes(source)).toEqual({ compiled: 5, evaluated: 5 });
  });

  test('functions that call each other', () => {
    const source =
      'function ev(n) { if n == 0 { true } else { od(n - 1) } }\n' +
      'function od(n) { if n == 0 { false } else { ev(n - 1) } }\n' +
      '[ev(4), od(3), ev(3)]';
    expect(run(source).value).toEqual(['List', 'True', 'True', 'False']);
    expect(blockRoutes(source)).toEqual({
      compiled: [true, true, false],
      evaluated: ['List', 'True', 'True', 'False'],
    });
  });

  test('a `do` block declares its names when it starts', () => {
    // Only the top-level block of a program follows the order of its
    // statements: in a `do` block, the `let` is visible to the function. The
    // function statement declares a local of the block, a variable that
    // holds the function, so its write of `t` needs no `scope` specifier.
    // The compilation still refuses the write.
    const source =
      'do { function g(k) { t = k + 1; t }; let t = 0; [g(1), t] }';
    expect(run(source).value).toEqual(['List', 2, 2]);
    const ce = new ComputeEngine();
    expect(ce.box(parseEpsil(source)[0] as never).evaluate().json).toEqual([
      'List',
      2,
      2,
    ]);
    expect(() =>
      compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(/writes outside the function/);
  });
});

describe('THE COMPILED ROUTES CHECK THE EFFECTS OF A DEFINITION', () => {
  // The interpreter refuses to define a function whose body writes a
  // variable outside the function, unless the function declares the `scope`
  // effect, and a function whose body has effects that its stated effects
  // do not cover. The compilation of such a definition is refused too.
  const compileProgram = (source: string, to = 'javascript') =>
    compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
      to,
      fallback: false,
    } as never)!;

  test.each([
    ['a `function` statement', 'function g(k) { t = k + 1; t }'],
    ['a one-step definition', 'g(k) = do { t = k + 1; t }'],
  ])('%s that writes a `let` before it', (_name, definition) => {
    const source = `let t = 0\n${definition}\n[g(1), t]`;
    expectScopeError(source);
    expect(() => compileProgram(source)).toThrow(
      /Could not compile `(DefineFunction|Assign)`: .*writes outside the function/
    );
    const interval = compileProgram(source, 'interval-js');
    expect(interval.success).toBe(false);
    expect(String((interval as { error?: unknown }).error)).toMatch(
      /writes outside the function/
    );
  });

  test('a `let` of a function literal that writes a `let` before it', () => {
    // The compilation declines the stored function that assigns a name of
    // an enclosing scope.
    const source = 'let t = 0\nlet g = (k) => do { t = k + 1; t }\n[g(1), t]';
    expectScopeError(source);
    const stored =
      /a function \(stored, returned, or a user function that the code calls\) assigns a name of an enclosing scope/;
    expect(() => compileProgram(source)).toThrow(stored);
    const interval = compileProgram(source, 'interval-js');
    expect(interval.success).toBe(false);
    expect(String((interval as { error?: unknown }).error)).toMatch(stored);
  });

  test('a function defined in a function body', () => {
    const source =
      'function f(n) { let t = 0; function g(k) { t = k + 1; t }; [g(n), t] }\nf(1)';
    expectScopeError(source);
    expect(() => compileProgram(source)).toThrow(/writes outside the function/);
  });

  test('stated effects that do not cover the body', () => {
    const source = 'let t = 0\nfunction g(k) pure { t = k + 1; t }\n[g(1), t]';
    expect(run(source).diagnostics[0]).toContain('pure effects');
    expect(() => compileProgram(source)).toThrow(
      /the declared effects `pure` do not cover/
    );
  });

  test.each([
    [
      'the `scope` specifier',
      'let t = 0\nfunction g(k) scope { t = k + 1; t }\n[g(1), t]',
    ],
    [
      'a `let` of a function literal',
      'let t = 0\nlet g: (integer) scope -> integer = (k) => do { t = k + 1; t }\n[g(1), t]',
    ],
  ])('%s: the outer variable is written', (_name, source) => {
    expect(run(source)).toMatchObject({
      value: ['List', 2, 2],
      diagnostics: [],
    });
    // A stored or defined function that assigns a name outside it declines:
    // such a function can reach an operator that calls it (`Filter`), where
    // the interpreter and the compiled code do not agree on the write.
    expect(() => compileProgram(source)).toThrow(
      /a function \(stored, returned, or a user function that the code calls\) assigns a name of an enclosing scope/
    );
  });

  test('a declaration with the `scope` effect is the contract', () => {
    const source =
      'let t = 0\nlet g: (integer) scope -> integer\n' +
      'function g(k) { t = k + 1; t }\n[g(1), t]';
    expect(run(source)).toMatchObject({
      value: ['List', 2, 2],
      diagnostics: [],
    });
    // The compiled program is one block, where the declaration and the
    // function statement are two declarations of `g`.
    expect(() => compileProgram(source)).toThrow(/variable-redeclaration/);
  });
});

describe('A FUNCTION DECLARED WITH A TYPE, THEN DEFINED, COMPILES', () => {
  // At the top level of a program, `let g: (integer) -> integer` then
  // `function g(k) { … }` is one binding: the declaration gives the name and
  // its type, and the definition gives its function. The compiled program
  // is one block, where the function statement declares a local: the two
  // statements are two declarations of `g`. In a block, the type is given
  // with the value: `let g: (integer) -> integer = (k) => k + 1`.
  const compiled = (source: string, to = 'javascript'): unknown => {
    const result = compile(
      new ComputeEngine().box(parseEpsil(source)[0] as never),
      { to, fallback: false } as never
    )!;
    expect(result.success).toBe(true);
    return result.run!({} as never);
  };
  const refused = (source: string): void => {
    expect(() =>
      compile(
        new ComputeEngine().box(parseEpsil(source)[0] as never),
        { to: 'javascript', fallback: false } as never
      )
    ).toThrow(/variable-redeclaration/);
  };

  test.each([
    [
      'a `function` statement',
      'let g: (integer) -> integer\nfunction g(k) { k + 1 }\n[g(1), g(2)]',
      [2, 3],
    ],
    [
      'a one-step definition',
      'let g: (integer) -> integer\ng(k) = k + 1\n[g(1), g(2)]',
      [2, 3],
    ],
    [
      'a call before the declaration',
      'let a = g(3)\nlet g: (integer) -> integer\nfunction g(k) { k + 1 }\n[a]',
      [4],
    ],
  ])('%s', (_name, source, value) => {
    expect(run(source)).toMatchObject({
      value: ['List', ...value],
      diagnostics: [],
    });
    refused(source);
  });

  test('in a function body, two declarations', () => {
    const source =
      'function f(n) { let h: (integer) -> integer; function h(k) { k * 2 }; h(n) }\n[f(4)]';
    expect(staticCodes(source)).toContain('variable-redeclaration');
  });

  test('a declaration with a function value', () => {
    const source =
      'let g: (integer) -> integer = (k) => k + 1\n[g(1), g(2)]';
    expect(run(source)).toMatchObject({
      value: ['List', 2, 3],
      diagnostics: [],
    });
    expect(compiled(source)).toEqual([2, 3]);
    const interval = compiled(source, 'interval-js') as {
      value: { lo: number; hi: number };
    }[];
    expect(interval.map((x) => x.value.lo)).toEqual([2, 3]);
  });

  test('a declaration with no type is a declaration without a value', () => {
    // Only a function type pairs with a `function` statement of the same
    // name.
    expect(staticCodes('let g\nfunction g(k) { k + 1 }\n[g(1), g(2)]')).toEqual(
      ['declaration-without-value']
    );
  });

  test('a name that holds a value is not defined', () => {
    // The interpreter refuses the definition, and the compilation fails.
    const source = 'let g = 5\nfunction g(k) { k + 1 }\ng(1)';
    expect(JSON.stringify(run(source).diagnostics)).toContain(
      'already holds a non-function value'
    );
    expect(() =>
      compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow();
  });
});

//
// A local of a block is declared by a `let` at the own level of the block,
// in a function body as outside every function. An assignment in a branch
// of an `if` or in a loop body writes a name declared before the branch: an
// assignment to an undeclared name is the static error
// `assignment-to-undeclared-variable`.
//

/** The value of `source` on the three routes: the run, the program
 * evaluated as one block, and the compiled program. */
function threeRoutes(source: string): {
  run: unknown;
  evaluated: unknown;
  compiled: unknown;
} {
  return { run: run(source).value, ...blockRoutes(source) };
}

describe('THE STATIC CHECK READS THE NESTED BLOCKS OF A FUNCTION BODY', () => {
  // `epsil check` reports an assignment to an undeclared name in a branch or
  // a loop body, and a use before the declaration in a nested block. Each
  // statement with an error is reported, so the code can be reported more
  // than once.
  const codes = (source: string): string[] => [
    ...new Set(
      executeEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
        String(
          d.message[0] === 'static-type-error' ? d.message[3] : d.message[0]
        )
      )
    ),
  ];
  test.each([
    ['function g(c) { if c { u = t; t = 1 }; 0 }\ng(true)', 'assignment-to-undeclared-variable'],
    ['function g(c) { if c { let u = t; let t = 1 }; 0 }\ng(true)', 'read-before-declaration'],
    ['function g(c) { if c { t = 1 } else { u = t }; 0 }\ng(false)', 'assignment-to-undeclared-variable'],
    ['function g() { do { let u = t; let t = 1 }; 0 }\ng()', 'read-before-declaration'],
    ['function g() { for i in [1, 2] { s = t; t = i }; 0 }\ng()', 'assignment-to-undeclared-variable'],
    ['function g(c) { if c { t = 1 }; t }', 'assignment-to-undeclared-variable'],
    ['function g(c) { for i in [1, 2] { if c { u = t; t = 1 } }; 0 }', 'assignment-to-undeclared-variable'],
    ['function g(c) { for i in [1, 2] { if c { let u = t; let t = 1 } }; 0 }', 'read-before-declaration'],
    ['function g(xs) { for x in xs { t = x }; t }', 'assignment-to-undeclared-variable'],
    // A read of `t` in the condition makes a binding for the free symbol
    // `t`; that binding is not a declaration of the `t` that the branch
    // assigns.
    ['function g() { if t > 0 { t = 1 }; 0 }\ng()', 'assignment-to-undeclared-variable'],
  ])('%j', (source, code) => {
    expect(codes(source)).toEqual([code]);
  });
});

describe('A TOP-LEVEL `let` OF A LIBRARY CONSTANT SHADOWS IT FROM ITS STATEMENT ON', () => {
  // The top-level block of a program declares the `let` of a library
  // constant name (`i`, `e`, `Pi`, …) only when it reaches the `let`
  // (`canonicalBlock()`, `src/compute-engine/library/control-structures.ts`).
  // So a function defined before it reads the constant, as in the run,
  // which reads one statement at a time.
  test('`i` read by a function defined before the `let`', () => {
    const source = 'function g() { i + 1 }\nlet i = 2\n[g(), i + 1]';
    expect(threeRoutes(source)).toEqual({
      run: ['List', ['Complex', 1, 1], 3],
      evaluated: ['List', ['Complex', 1, 1], 3],
      compiled: [{ re: 1, im: 1 }, 3],
    });
  });

  test('`e` read by a function defined before the `let`', () => {
    const source = 'function g() { 2 * e }\nlet e = 3\n[g(), 2 * e]';
    const routes = threeRoutes(source);
    expect(routes.run).toEqual(['List', ['Multiply', 2, 'ExponentialE'], 6]);
    expect(routes.evaluated).toEqual(routes.run);
    expect((routes.compiled as number[])[0]).toBeCloseTo(2 * Math.E, 12);
    expect((routes.compiled as number[])[1]).toBe(6);
  });

  test('`Pi`: the block and the compiled program agree', () => {
    // The run refuses a top-level `let` of `Pi` (see `naming.md`).
    const source = 'function g() { Pi + 1 }\nlet Pi = 3\n[g(), Pi]';
    const { evaluated, compiled } = blockRoutes(source);
    expect(evaluated).toEqual(['List', ['Add', 1, 'Pi'], 3]);
    expect((compiled as number[])[0]).toBeCloseTo(Math.PI + 1, 12);
    expect((compiled as number[])[1]).toBe(3);
  });

  test('a `let` before the function', () => {
    expect(threeRoutes('let i = 2\nfunction g() { i + 1 }\ng()')).toEqual({
      run: 3,
      evaluated: 3,
      compiled: 3,
    });
  });

  test('a name that is not a constant is not changed', () => {
    // The function reads the binding of the later `let` when it is called.
    expect(threeRoutes('function g() { t }\nlet t = 5\ng()')).toEqual({
      run: 5,
      evaluated: 5,
      compiled: 5,
    });
  });

  test('a `do` block declares its names when it starts', () => {
    const source = 'do { function g() { i^2 }; let i = 2; [g(), i^2] }';
    expect(threeRoutes(source)).toEqual({
      run: ['List', 4, 4],
      evaluated: ['List', 4, 4],
      compiled: [4, 4],
    });
  });
});

/** The value of the program `source` evaluated as one block. */
function evaluatedAsBlock(source: string): unknown {
  return new ComputeEngine().box(parseEpsil(source)[0] as never).evaluate()
    .json;
}

describe('A CLOSURE MADE IN A NESTED BLOCK KEEPS THE LOCALS OF ITS BODY', () => {
  // A closure created in a branch or a loop body is rebuilt on the scopes it
  // captures (`captureClosures()`, `src/compute-engine/function-utils.ts`).
  // The rebuilt body keeps its locals, so a `let` in it is a local of the
  // closure, as for the same closure written as a statement of the body.
  test.each([
    // The names that a branch assigns are declared with a value before the
    // branch.
    [
      'a closure called in the branch',
      'function g(c) { let h = () => 0; let v = 0; if c { h = () => do { let u = 2; u }; v = h() }; v }\n' +
        '[g(true), g(false)]',
      ['List', 2, 0],
    ],
    [
      'the name of the closure local is not a local of the function',
      'function g(c) { let h = () => 0; let t = 0; if c { h = () => do { let u = 2; u }; t = h() }; [t, u] }\ng(true)',
      ['List', 2, 'u'],
    ],
    [
      'a closure returned from a branch',
      'function mk(n) { let f = (k) => 0; if n > 0 { f = (k) => do { let acc = k * n; acc + 1 } }; f }\n' +
        'let a = mk(2)\n[a(1), a(3)]',
      ['List', 3, 7],
    ],
  ])('%s', (_name, source, value) => {
    const { ce, value: result, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(result).toEqual(value);
    expect(evaluatedAsBlock(source)).toEqual(value);
    const fn = ce.box(source.startsWith('function mk') ? 'mk' : 'g');
    expect(fn.type.toString()).not.toContain('scope');
  });

  test('a read of the closure local before its assignment', () => {
    // A static error in the body of the closure.
    expect(
      staticCodes('function g(c) { let h = () => do { let u = t; let t = 2; u }; h() }\ng(true)')
    ).toEqual(['read-before-declaration']);
  });
});

describe('COMPILED CODE AND A LOCAL ASSIGNED IN A BRANCH', () => {
  // An assignment in a branch or in a loop body to an undeclared name is a
  // static error of the canonical form, so the compilation declines: the
  // input is not valid. A local declared with a value before the branch is
  // assigned before every read, and the body compiles.
  const literal = (body: unknown) =>
    new ComputeEngine().box(['Function', body, 'c'] as never);
  const BRANCH = ['Block', ['If', 'c', ['Block', ['Assign', 't', 1]]], 't'];
  const INVALID = /Could not compile invalid expression/;

  test('an assignment in one branch to an undeclared name: JavaScript and interval-js decline', () => {
    expect(() =>
      compile(literal(BRANCH), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(INVALID);
    const ia = compile(literal(BRANCH), {
      to: 'interval-js',
    } as never)!;
    expect(ia.success).toBe(false);
  });

  test('an Epsil program', () => {
    const g = 'function g(c) { if c { t = 1 }; t }\n';
    expect(() =>
      compile(new ComputeEngine().box(parseEpsil(`${g}g(true)`)[0] as never), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(INVALID);
    expect(staticCodes(`${g}g(true)`)).toEqual([
      'assignment-to-undeclared-variable',
    ]);
  });

  test('an assignment in a loop body to an undeclared name', () => {
    const body = [
      'Block',
      [
        'Loop',
        ['Block', ['Assign', 't', ['Multiply', 'k', 'c']]],
        ['Element', 'k', ['Range', 1, 0, 1]],
      ],
      't',
    ];
    const fn = literal(body);
    expectErrorCode(
      fn.engine.box(['Apply', fn, 3] as never).evaluate().json,
      'assignment-to-undeclared-variable'
    );
    expect(() =>
      compile(fn, { to: 'javascript', fallback: false } as never)
    ).toThrow(INVALID);
  });

  test('interval-js: a read after a loop that runs', () => {
    const fn = literal([
      'Block',
      ['Declare', 't', "'unknown'", 0],
      [
        'Loop',
        ['Block', ['Assign', 't', ['Multiply', 'k', 'c']]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      't',
    ]);
    const ia = compile(fn, { to: 'interval-js', fallback: false } as never)!;
    expect(ia.calling).toBe('lambda');
    expect(ia.run!({ lo: 3, hi: 3 } as never)).toEqual({
      kind: 'interval',
      value: { lo: 9, hi: 9 },
    });
  });

  test.each([
    [
      'a declaration before the read',
      ['Block', ['Declare', 't', "'unknown'", 'c'], 't'],
    ],
    [
      // `c > 0` compares a parameter, so it is always decided and one
      // branch runs.
      'an assignment in each branch of a decided condition',
      [
        'Block',
        ['Declare', 't', "'unknown'", 0],
        [
          'If',
          ['Greater', 'c', 0],
          ['Block', ['Assign', 't', 1]],
          ['Block', ['Assign', 't', 2]],
        ],
        't',
      ],
    ],
    [
      'a read in the branch after its assignment',
      [
        'Block',
        ['Declare', 't', "'unknown'", 0],
        ['Declare', 'u', "'unknown'", 0],
        [
          'If',
          'c',
          ['Block', ['Assign', 't', 1], ['Assign', 'u', ['Add', 't', 1]]],
        ],
        'c',
      ],
    ],
  ])('compiles: %s', (_name, body) => {
    const result = compile(literal(body), {
      to: 'javascript',
      fallback: false,
    } as never)!;
    expect(result.success).toBe(true);
  });

  test('declines: an assignment in each branch of a condition of type unknown', () => {
    // The parameter `c` has no declared type, so the condition can be a
    // value that is not a boolean. Compiled JavaScript does not test the
    // condition at run time, so the compilation declines
    // (`assertBooleanOrAbsentCondition()`), and the interpreter evaluates it.
    const fn = literal([
      'Block',
      ['Declare', 't', "'unknown'", 0],
      [
        'If',
        'c',
        ['Block', ['Assign', 't', 1]],
        ['Block', ['Assign', 't', 2]],
      ],
      't',
    ]);
    expect(() =>
      compile(fn, { to: 'javascript', fallback: false } as never)
    ).toThrow(/the condition can be a value that is not a boolean/);
    expect(fn.engine.box(['Apply', fn, 'True'] as never).evaluate().json).toBe(
      1
    );
    expect(
      fn.engine.box(['Apply', fn, 'False'] as never).evaluate().json
    ).toBe(2);
  });
});

describe('AN ASSIGNMENT TO THE LOOP INDEX WRITES THE INDEX OF THE LOOP', () => {
  // The index is a binding of the loop. An assignment to it in the body is
  // not the `scope` effect (`withBinderIndices()`,
  // `src/compute-engine/boxed-expression/effects-inference.ts`), and the
  // body does not own its name, so the name after the loop is read as
  // before the loop.
  test.each([
    [
      'the value is used in the iteration',
      'function g() { let s = 0; for k in 1..2 { k = k * 10; s = s + k }; s }\ng()',
      30,
    ],
    [
      'the name after the loop is a free symbol',
      'function g() { for k in [1, 2] { k = 5 }; k }\ng()',
      'k',
    ],
    [
      'the name after the loop is the imaginary unit',
      'function g() { for i in [1, 2] { i = 5 }; i }\ng()',
      ['Complex', 0, 1],
    ],
  ])('%s', (_name, source, value) => {
    const { ce, value: result, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(result).toEqual(value);
    expect(evaluatedAsBlock(source)).toEqual(value);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('the compiled loop is refused', () => {
    // The emitted loop cannot give the index the next element after an
    // assignment, so the interpreter evaluates the loop.
    expect(() =>
      compile(
        new ComputeEngine().box(
          parseEpsil(
            'function g() { for k in [1, 2] { k = 5 }; 0 }\ng()'
          )[0] as never
        ),
        { to: 'javascript', fallback: false } as never
      )
    ).toThrow(/assigns the loop index `k`/);
  });

  test('the compiled comprehension is refused (CE-226.1)', () => {
    const ce = new ComputeEngine();
    const comprehension = ce.box([
      'Comprehension',
      ['Block', ['Assign', 'k', 5], 'k'],
      ['Element', 'k', ['Range', 1, 3]],
    ] as never);
    expect(comprehension.evaluate().toString()).toBe('[5,5,5]');
    expect(() =>
      compile(comprehension, { to: 'javascript', fallback: false } as never)
    ).toThrow(/the term assigns the index `k`/);
  });
});

describe('A BLOCK BOXED BEFORE IT BECOMES A FUNCTION BODY', () => {
  // `ce.function('Function', [block])` with a block that the host boxed
  // first: the body has the same locals as when the `Function` is boxed in
  // one step.
  test('a name assigned in one branch', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 't', "'unknown'", 0],
      ['If', 'c', ['Block', ['Assign', 't', 1]]],
      't',
    ] as never);
    const fn = ce.function('Function', [block, ce.symbol('c')]);
    expect(ce.box(['Apply', fn, 'True'] as never).evaluate().json).toBe(1);
    expect(ce.box(['Apply', fn, 'False'] as never).evaluate().json).toBe(0);
  });

  test('a block with no nested assignment is kept as it is', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'w', "'unknown'", ['Multiply', 2, 'c']],
      ['Add', 'w', 1],
    ] as never);
    const fn = ce.function('Function', [block, ce.symbol('c')]);
    expect(fn.op1).toBe(block);
    expect(ce.box(['Apply', fn, 3] as never).evaluate().json).toBe(7);
  });
});

describe('AN OPERAND EVALUATED FOR EACH ELEMENT OWNS ITS NAMES', () => {
  // An operand that the operator applies as a function or evaluates when an
  // element is read (the term of a `Table`, the term and the condition of a
  // comprehension) owns the names that it declares, in a function body as at
  // the top level.

  /** The value of the last statement of `source`, materialized. */
  function materialized(source: string): unknown {
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(ce, source);
    expect(diagnostics).toEqual([]);
    return value.evaluate({ materialization: true }).json;
  }

  /** The value of the last statement of `source`, as it is displayed:
   * a comprehension whose term writes a variable outside it is not
   * materialized for the display. */
  function shown(source: string): string {
    const { value } = executeEpsil(new ComputeEngine(), source);
    return value.evaluate().toString();
  }

  test.each([
    [
      'the term of a comprehension',
      '[do { let t = k * 2; t } for k in 1..3]',
      ['List', 2, 4, 6],
      '[2,4,6]',
    ],
    [
      'the condition of a comprehension',
      '[k * 2 for k in 1..3 if do { let t = k; t > 1 }]',
      ['List', 4, 6],
      '[4,6]',
    ],
  ])('%s', (_name, expression, value, display) => {
    expect(shown(expression)).toBe(display);
    expect(shown(`function g() { ${expression} }\ng()`)).toBe(display);
    expect(materialized(expression)).toEqual(value);
    expect(materialized(`function g() { ${expression} }\ng()`)).toEqual(value);
    expect(materialized(`function g() { ${expression} }\ng()\nt`)).toBe('t');
  });

  const TABLE_ASSIGN = [
    'Table',
    ['Block', ['Declare', 'a', "'unknown'", 'k'], 'a'],
    ['Tuple', 'k', 1, 3],
  ];
  const TABLE_BRANCH = [
    'Table',
    [
      'Block',
      ['Declare', 'a', "'unknown'", 0],
      ['If', ['Equal', 'k', 2], ['Block', ['Assign', 'a', 5]]],
      'a',
    ],
    ['Tuple', 'k', 1, 3],
  ];

  test.each([
    ['a declaration in the term of a `Table`', TABLE_ASSIGN],
    ['an assignment in a branch of the term of a `Table`', TABLE_BRANCH],
  ])('%s', (_name, table) => {
    const ce = new ComputeEngine();
    const atTopLevel = ce
      .box(table as never)
      .evaluate({ materialization: true });
    const inBody = ce
      .box(['Apply', ['Function', ['Block', table]]] as never)
      .evaluate({ materialization: true });
    expect(inBody.operator).toBe('List');
    expect(inBody.json).toEqual(atTopLevel.json);
    expect(
      ce.box(['Function', ['Block', table]] as never).type.toString()
    ).not.toContain('scope');
  });

  test('the values of a `Table` term', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Apply', ['Function', ['Block', TABLE_ASSIGN]]] as never)
        .evaluate({ materialization: true }).json
    ).toEqual(['List', 1, 2, 3]);
    // Each evaluation of the term declares its own `a`.
    expect(
      ce
        .box(['Apply', ['Function', ['Block', TABLE_BRANCH]]] as never)
        .evaluate({ materialization: true }).json
    ).toEqual(['List', 0, 5, 0]);
  });

  test('the term of a `Sum` keeps a local of the body from one index to the next', () => {
    // A `Sum` term is evaluated again at each index while the statement is
    // evaluated, as a loop body is: the term writes the local `t` of the
    // function body.
    const source =
      'function g() { let t = 0; sum(do { t = t + k; t }, k, 1, 3) }\ng()';
    expect(run(source).value).toBe(10);
  });
});

describe('A READ OF A LOCAL NEXT TO ANOTHER BINDING OF ITS NAME', () => {
  // A read of a local before its declaration is the static error
  // `read-before-declaration`. A read of another binding with
  // the same name is not a read of the local, and the compilation
  // succeeds.

  test('a function defined in the engine with a parameter of the same name', () => {
    // The definition of `h` compiles while the body of the caller compiles.
    // Its parameter `t` is another binding than the local `t` of the
    // caller.
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'u', "'unknown'", ['Multiply', 2, 't']],
          ['Add', 'u', 't'],
        ],
        't',
      ] as never)
    );
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 't', "'unknown'", 0],
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Assign', 't', 1]],
          ['Block', ['Assign', 't', 3]],
        ],
        ['Add', 't', ['h', 'x']],
      ],
      'x',
    ] as never);
    expect(ce.box(['Apply', fn, 2] as never).evaluate().json).toBe(7);
    expect(ce.box(['Apply', fn, -1] as never).evaluate().json).toBe(0);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.run!(2 as never)).toBe(7);
    expect(result.run!(-1 as never)).toBe(0);
  });

  test('the same on the interval target', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'u', "'unknown'", ['Multiply', 2, 't']],
          ['Add', 'u', 't'],
        ],
        't',
      ] as never)
    );
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 't', "'unknown'", 0],
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Assign', 't', 1]],
          ['Block', ['Assign', 't', 2]],
        ],
        ['Add', 't', ['h', 'x']],
      ],
      'x',
    ] as never);
    const result = compile(fn, {
      to: 'interval-js',
      fallback: false,
    } as never) as unknown as { success: boolean; preamble: string };
    expect(result.success).toBe(true);
    expect(result.preamble).toContain('const _fn_h');
  });

  test('an assignment in a loop body is not a declaration of a name read in its collection', () => {
    // `t` is not declared: the assignment in the loop body is a static
    // error.
    expect(
      staticCodes('function g() { for k in 1..t { t = 2 }; 0 }\ng()')
    ).toEqual(['assignment-to-undeclared-variable']);
    expect(
      staticCodes(
        'function g(c) { if c { t = 3 }; for k in 1..t { t = 2 }; 0 }\ng(true)'
      )
    ).toEqual(['assignment-to-undeclared-variable']);
  });
});

describe('A LOCAL IN A LOOP DOMAIN, A PIPE STAGE', () => {
  test('a loop over a range with an undeclared name is a static error', () => {
    // `t` is not declared before the loop.
    expect(
      staticCodes('function g() { for k in 1..t { t = 2 }; 0 }\ng()')
    ).toEqual(['assignment-to-undeclared-variable']);
  });

  test('a loop over a range with a bound local still runs', () => {
    const { value, diagnostics } = run(
      'function g() { let t = 3; let s = 0; for k in 1..t { s = s + k }; s }\ng()'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(6);
  });

  test('a lambda of a pipe stage that declares a name has no scope effect', () => {
    const { diagnostics } = run(
      'function g() { (1..3) |> map((k) => do { let t = k * 2; t }) }\ng()'
    );
    expect(diagnostics).toEqual([]);
  });

  test('a lambda of a pipe stage that assigns an outer variable keeps the scope error', () => {
    const { diagnostics } = run(
      'let t = 1\nfunction g() { (1..3) |> map((k) => do { t = k * 2; t }) }\ng()'
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(SCOPE_ERROR);
  });
});
