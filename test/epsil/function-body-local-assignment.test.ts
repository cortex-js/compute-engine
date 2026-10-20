import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// An assignment in a function body to a name that no enclosing scope
// declares when the function is defined makes a local of the block
// (`canonicalBlock()`, `src/compute-engine/library/control-structures.ts`),
// as a `let` does. Each call gives the local a new binding
// (`declareAssignmentLocals()`, `src/compute-engine/function-utils.ts`), so
// a declaration of the same name made later is not written. The effect
// inference counts such a local as declared (`withBlockLocals()`,
// `src/compute-engine/boxed-expression/effects-inference.ts`), so the write
// is not the `scope` effect, and the function needs no effect specifier.
//
// A write to a name that an enclosing scope declares when the function is
// defined (a top-level `let`, a top-level assignment, a parameter or a local
// of an enclosing function) stays the `scope` effect.
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

function expectScopeError(source: string): void {
  const { diagnostics } = run(source);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toContain('runtime-error');
  expect(diagnostics[0]).toContain(SCOPE_ERROR);
}

describe('AN ASSIGNMENT TO A NEW NAME IN A FUNCTION BODY IS A LOCAL', () => {
  test('the reported case', () => {
    const { ce, value, diagnostics } = run(
      'function g(k) { t = k + 1; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('the same as with `let`', () => {
    const { value, diagnostics } = run(
      'function g(k) { let t = k + 1; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('the local does not leave the function', () => {
    const { value, diagnostics } = run(
      'function g(k) { t = k + 1; t }\ng(1)\nt'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe('t');
  });

  test('a one-step definition with a `do` block', () => {
    const { value, diagnostics } = run(
      'g(k) = do { t = k + 1; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('an accumulator in a loop', () => {
    const { ce, value, diagnostics } = run(
      'function s(n) { acc = 0; for i in 1..n { acc = acc + i }; acc }\n[s(3), s(4)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 6, 10]);
    expect(ce.box('s').type.toString()).not.toContain('scope');
  });

  test('a local assigned in each branch of an `if`', () => {
    const { value, diagnostics } = run(
      'function g(k) { t = 0; if k > 1 { t = 1 } else { t = 2 }; t }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 1]);
  });

  test('a local assigned in one branch of an `if` only', () => {
    // The local belongs to the block of the branch.
    const { value, diagnostics } = run(
      'function g(k) { if k > 1 { t = k }; k }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 2]);
  });

  test('a local that holds a function', () => {
    const { value, diagnostics } = run(
      'function g(k) { h = (z) => 2z; h(k) }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 4]);
  });

  test('a local that holds a function that draws', () => {
    // The call of the local gives its effects to the function: `random`, and
    // no `scope`.
    const { ce, diagnostics } = run(
      'function g(k) { h = (z) => random(); h(k) }'
    );
    expect(diagnostics).toEqual([]);
    const type = ce.box('g').type.toString();
    expect(type).toContain('random');
    expect(type).not.toContain('scope');
  });

  test('a recursive function with a local', () => {
    const { value, diagnostics } = run(
      'function fact(n) { t = n; if n <= 1 { 1 } else { t * fact(n - 1) } }\n[fact(1), fact(5)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 120]);
  });

  test('a local read by a closure that the function returns', () => {
    const { value, diagnostics } = run(
      'function g(k) { t = k; () => t }\nlet a = g(1)\nlet b = g(2)\n[a(), b()]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 1, 2]);
  });

  test('a local read by a closure that the function calls', () => {
    const { value, diagnostics } = run(
      'function g(k) { t = k + 1; h = () => t; h() }\n[g(1), g(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('a function defined in a function body, with a local', () => {
    const { value, diagnostics } = run(
      'function f(n) { function g(k) { t = k + 1; t }; g(n) }\n[f(1), f(2)]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3]);
  });

  test('the static check reports nothing, and infers no effect', () => {
    const { diagnostics, effects } = checkSource(
      'function g(k) { t = k + 1; t }\n[g(1), g(2)]',
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

  test('a top-level assignment before the function', () => {
    expectScopeError('t = 3\nfunction g(k) { t = k + 1; t }\n[g(1), t]');
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
      'function f(n) { t = 0; g(k) = do { t = k + 1; t }; [g(n), t] }\nf(1)'
    );
  });

  test('a local written by a closure that the function calls', () => {
    // The closure can outlive the call and keep the binding, as with a
    // `let` local.
    expectScopeError(
      'function g(k) { t = k; inc = () => do { t = t + 1 }; inc(); t }\n[g(1), g(2)]'
    );
  });
});

describe('THE SCOPE OF A NAME IS DECIDED WHERE THE FUNCTION IS DEFINED', () => {
  test('a top-level `let` after the function is not written', () => {
    const { ce, value, diagnostics } = run(
      'function g(k) { t = k + 1; t }\nlet t = 0\n[g(1), g(2), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 3, 0]);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('a top-level assignment after the function is not written', () => {
    const { value, diagnostics } = run(
      'function g(k) { t = k + 1; t }\nt = 10\n[g(1), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 10]);
  });

  test('a later program on the same engine', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(k) { t = k + 1; t }');
    executeEpsil(ce, 't = 10');
    expect(executeEpsil(ce, 'g(1)').value.json).toBe(2);
    expect(executeEpsil(ce, 't').value.json).toBe(10);
  });

  test('a local of a nested block', () => {
    for (const body of [
      '{ if true { t = k + 1 }; k }',
      '{ u = do { t = k + 1; t }; u }',
      '{ for i in [1] { t = k + i }; k }',
    ]) {
      const { value, diagnostics } = run(
        `function g(k) ${body}\nlet t = 10\n[g(1), t]`
      );
      expect(diagnostics).toEqual([]);
      expect((value as unknown[])[2]).toBe(10);
    }
  });

  test('a local written in a branch and read after it', () => {
    // The branch writes the local of the body, which is assigned in a
    // statement of the body.
    const { value, diagnostics } = run(
      'function g(k) { if k > 1 { t = 5 }; t = t + 1; t }\ng(2)'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(6);
  });

  test('a function with the `scope` specifier: a new name is still a local', () => {
    // `scope` permits a write to a binding outside the function; it does
    // not make a new name refer to one.
    const { ce, value, diagnostics } = run(
      'function g(k) scope { t = k + 1; t }\nlet t = 0\n[g(1), t]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 0]);
    expect(ce.box('g').type.toString()).toContain('scope');
  });

  test('the host route: `Assign` and `ce.assign()`', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'g',
      ['Function', ['Block', ['Assign', 't', ['Add', 'k', 1]], 't'], 'k'],
    ]).evaluate();
    expect(ce.box('g').type.toString()).toBe('(unknown) -> number');
    ce.assign('t', 10);
    expect(ce.box(['g', 1]).evaluate().json).toBe(2);
    expect(ce.box('t').evaluate().json).toBe(10);

    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Block', ['Assign', 'u', ['Multiply', 'k', 2]], 'u'],
        'k',
      ])
    );
    ce.assign('u', 7);
    expect(ce.box(['h', 3]).evaluate().json).toBe(6);
    expect(ce.box('u').evaluate().json).toBe(7);
  });

  test('a const after the function is not written', () => {
    const { value, diagnostics } = run(
      'function g() { c = 2; c }\nconst c = 1\n[g(), c]'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['List', 2, 1]);
  });
});

describe('AN ANNOTATION ON THE FUNCTION DOES NOT CHANGE ITS LOCALS', () => {
  // A return type or an effect specifier moves onto the last statement of
  // the body as a `Typed` wrapper. The last statement is still a local
  // assignment, or a declaration of the block.
  test('a return type, the assignment is the last statement', () => {
    const { ce, value, diagnostics } = run(
      'function f() -> integer { x = 2 }\nf()'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(2);
    expect(ce.box('f').type.toString()).not.toContain('scope');
  });

  test('a return type, a `let` after the function is not written', () => {
    const { value, diagnostics } = run(
      'function f() -> integer { y = 0; x = 2 }\nlet x = 1\nf()\nx'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(1);
  });

  test('the `scope` specifier, a `let` after the function is not written', () => {
    const { value, diagnostics } = run(
      'function f() scope { y = 0; x = 2 }\nlet x = 1\nf()\nx'
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
  // The compiler declares an assignment local of a block as a local of the
  // generated function (`let t`), from the binding that the canonicalization
  // made. So the compiled function, like the run, has its own `t` at each
  // call, also when a `t` is assigned on the engine after the function was
  // boxed.
  const G = ['Function', ['Block', ['Assign', 't', ['Add', 'k', 1]], 't'], 'k'];
  const IF_BRANCH = [
    'Function',
    [
      'Block',
      ['If', ['Greater', 'k', 1], ['Block', ['Assign', 't', 5]]],
      ['Assign', 't', ['Add', 't', 1]],
      't',
    ],
    'k',
  ];

  test.each([
    ['a body that assigns a new name', G, 3],
    ['a local written in a branch and read after it', IF_BRANCH, 6],
  ])('%s, with a `t` assigned after the function', (_name, literal, value) => {
    const ce = new ComputeEngine();
    const fn = ce.box(literal as never);
    ce.assign('t', 10);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.success).toBe(true);
    expect(result.code).toContain('let t;');
    expect(result.run!(2 as never)).toBe(value);
    // The run gives the same value, and does not write the outer `t`.
    expect(ce.box(['Apply', fn, 2]).evaluate().json).toBe(value);
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
    expect(result.code).toContain('let t;');
  });

  test('a write to a name assigned before the function is refused', () => {
    // The compiled code reads an assigned value as a constant of the
    // generated source, so it cannot write it: the compilation fails, as
    // before the static rule.
    const ce = new ComputeEngine();
    ce.declare('t', 'integer');
    ce.assign('t', 10);
    const fn = ce.box(G as never);
    expect(() =>
      compile(fn, { to: 'javascript', fallback: false } as never)
    ).toThrow(/has an assigned value/);
  });

  test('an Epsil program', () => {
    const source = 'function g(k) { t = k + 1; t }\n[g(1), g(2)]';
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
