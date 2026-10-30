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
    // The local belongs to the function body.
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
    expect(ce.box('g').type.toString()).toBe('(k: unknown) -> number');
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
    // A local that a read can find with no value starts with a marker
    // (`let t = _tv1`): see the block about `g(false)` below.
    expect(result.code).toMatch(/\blet t\b/);
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

//
// A read of an assignment local of a function body before its first
// assignment is the `read-before-declaration` error, as a read of a `let`
// local before its `let` (`_readBeforeDeclaration()`,
// `src/compute-engine/boxed-expression/boxed-symbol.ts`). Each call starts
// with no value for the local. The error has a second operand,
// `"assignment"`. `epsil check` reports the read when the order is certain
// from the source (`readsBeforeAssignment()`,
// `src/epsil/read-before-assignment.ts`).
//

const READ_BEFORE_ASSIGNMENT = (name: string) => [
  'ErrorCode',
  "'read-before-declaration'",
  `'${name}'`,
  "'assignment'",
];

function expectReadBeforeAssignment(value: unknown, name: string): void {
  expect(Array.isArray(value)).toBe(true);
  expect((value as unknown[])[0]).toBe('Error');
  expect((value as unknown[])[1]).toEqual(READ_BEFORE_ASSIGNMENT(name));
}

/** The static reports of `source`: the engine code and the source text of
 * the range. */
function staticReports(source: string): [unknown, string][] {
  return checkSource(source).diagnostics.map((d) => [
    d.message[3],
    source.slice(d.range[0], d.range[1]),
  ]);
}

describe('A READ OF A LOCAL BEFORE ITS FIRST ASSIGNMENT', () => {
  test('the reported case', () => {
    const source = 'function g(k) { u = t; t = k; u }\ng(1)';
    const { value } = run(source);
    expectReadBeforeAssignment(value, 't');
    expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
  });

  test('the same error as for a `let` local, with a second operand', () => {
    const { value } = run('function g(k) { u = t; let t = k; u }\ng(1)');
    expect(value).toEqual([
      'Error',
      ['ErrorCode', "'read-before-declaration'", "'t'"],
    ]);
  });

  test('the message, reported once', () => {
    // The static check reports the read in the definition. The error value
    // of the call `g(1)` keeps the source range of the read
    // (`readBeforeDeclarationSite()`), so the run does not report it a
    // second time.
    const { diagnostics } = run('function g(k) { u = t; t = k; u }\ng(1)\n0');
    expect(diagnostics).toEqual([
      'static-type-error `t` is read before its first assignment: the assignment makes `t` a local of the block, which has no value yet u = t read-before-declaration',
    ]);
  });

  test('the run reports a read that the static check does not', () => {
    const { diagnostics } = run(
      'function g() { f = () => t; v = f(); t = 1; v }\ng()\n0'
    );
    expect(diagnostics).toEqual([
      'runtime-error `t` is read before its first assignment: the assignment makes `t` a local of the block, which has no value yet  read-before-declaration',
    ]);
  });

  test('reported once when the first read evaluated is not the first written', () => {
    // The canonical sum puts `t^2` first, and the run reads it first: the
    // static report is at that read.
    const source = 'function g() { u = sqrt(t) + t^2; t = 1; u }\ng()\n0';
    const { diagnostics } = run(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('static-type-error');
  });

  test('a nested statement with the error is reported once', () => {
    const { diagnostics } = run(
      'function g() { u = [t, 1]; t = 1; u }\ng()\n0'
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('static-type-error');
  });

  test('a variable outside the function is not read', () => {
    const { value } = run('function g(k) { u = t; t = k; u }\nlet t = 5\ng(1)');
    expectReadBeforeAssignment(value, 't');
  });

  test('a read in the value of the first assignment', () => {
    for (const source of [
      'function g(k) { t = t + 1; t }\ng(1)',
      'function g(k) { (t, w) := (t, 1); t }\ng(1)',
    ]) {
      expectReadBeforeAssignment(run(source).value, 't');
      expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
    }
  });

  test('a read in the initializer of a `let`, or in a condition', () => {
    for (const source of [
      'function g() { let w = t + 1; t = 1; w }\ng()',
      'function g() { if t > 0 { 1 }; t = 1 }\ng()',
      'function g() { u = sin(t) + [t, 1][1]; t = 1; u }\ng()',
    ]) {
      expectReadBeforeAssignment(run(source).value, 't');
      expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
    }
  });

  test('a local assigned in a branch, read after it', () => {
    // The run reports the read when the branch did not run. The order is
    // not certain from the source, and the static check reports nothing.
    const source =
      'function g(k) { if k > 1 { t = 5 }; t = t + 1; t }\n[g(2), g(1)]';
    const { value } = run(source);
    expect((value as unknown[])[1]).toBe(6);
    expectReadBeforeAssignment((value as unknown[])[2], 't');
    expect(staticReports(source)).toEqual([]);
  });

  test('a read in a branch before every assignment', () => {
    // When the branch runs, no assignment ran before it.
    const source =
      'function g(c) { if c { u = t }; t = 1; 0 }\n[g(false), g(true)]';
    const { value } = run(source);
    expect((value as unknown[])[1]).toBe(0);
    expectReadBeforeAssignment((value as unknown[])[2], 't');
    expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
  });

  test('a name assigned in one branch only is a local of the body', () => {
    // The function body owns `t`. When the branch does not run, the read
    // after the `if` comes before every assignment. The order is not certain
    // from the source, so the static check reports nothing.
    const source = 'function g(c) { if c { t = 1 }; t }\n[g(true), g(false)]';
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect((value as unknown[])[1]).toBe(1);
    expectReadBeforeAssignment((value as unknown[])[2], 't');
    expect(staticReports(source)).toEqual([]);
  });

  test('a loop body keeps its local from one iteration to the next', () => {
    const source =
      'function g() { s = 0; for i in [1, 2] { if i > 1 { s = s + t }; t = i }; s }\ng()';
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value).toBe(1);
    expect(staticReports(source)).toEqual([]);
  });

  test('a loop body that reads its local in the first iteration', () => {
    const source = 'function g() { for i in [1, 2] { s = t; t = i }; 0 }\ng()';
    expectReadBeforeAssignment(run(source).value, 't');
    expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
  });

  test('a closure called after the assignment', () => {
    const source = 'function g() { f = () => t; t = 1; f() }\ng()';
    const { value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect(value).toBe(1);
    expect(staticReports(source)).toEqual([]);
  });

  test('a closure called before the assignment', () => {
    // The run reports the read. The static check does not follow the call.
    const source = 'function g() { f = () => t; v = f(); t = 1; v }\ng()';
    expectReadBeforeAssignment(run(source).value, 't');
    expect(staticReports(source)).toEqual([]);
  });

  test('a read that is not evaluated', () => {
    const { value, diagnostics } = run(
      'function g() { u = Hold(t); t = 1; u }\ng()'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toEqual(['Hold', 't']);
  });

  test('each call starts with no value, also a recursive call', () => {
    // The first call assigns `t`, and the recursive call, with `r` true,
    // reads its own `t` before it assigns it.
    const source =
      'function g(n, r) { u = 0; if r { u = t }; t = n; if n > 0 { g(n - 1, true) } else { u } }';
    expect(run(`${source}\ng(0, false)`).value).toBe(0);
    expectReadBeforeAssignment(run(`${source}\ng(2, false)`).value, 't');
    const { value } = run(`${source}\n[g(0, false), g(0, true)]`);
    expect((value as unknown[])[1]).toBe(0);
    expectReadBeforeAssignment((value as unknown[])[2], 't');
  });

  test('the top level is not changed', () => {
    // Top-level statements are not a block, and a block outside every
    // function keeps the bare symbol.
    for (const source of [
      'u = t\nt = 1\nu',
      'do { u = t; t = 1; u }',
      'r = do { u = t; t = 1; u }\nr',
    ]) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toBe(1);
      expect(staticReports(source)).toEqual([]);
    }
  });

  test('a function literal assigned to a name, and a nested function', () => {
    for (const source of [
      'g = (k) => do { u = t; t = k; u }\ng(1)',
      'function f() { function g(k) { u = t; t = k; u }; g(1) }\nf()',
    ]) {
      expectReadBeforeAssignment(run(source).value, 't');
      expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
    }
  });

  test('the host route', () => {
    // A `Function` boxed by the host gives the same error value, as a read
    // of a `let` local before its `Declare` does. A block outside every
    // function keeps the bare symbol.
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      ['Block', ['Assign', 'u', 't'], ['Assign', 't', 'k'], 'u'],
      'k',
    ]);
    expectReadBeforeAssignment(ce.box(['Apply', fn, 2]).evaluate().json, 't');
    expectReadBeforeAssignment(ce.box(['Apply', fn, 2]).N().json, 't');
    const letFn = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'u', 'unknown'],
        ['Assign', 'u', 't'],
        ['Declare', 't', 'unknown'],
        ['Assign', 't', 'k'],
        'u',
      ],
      'k',
    ]);
    expect(ce.box(['Apply', letFn, 2]).evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'read-before-declaration'", "'t'"],
    ]);
    expect(
      ce
        .box(['Block', ['Assign', 'x', ['Add', 'x', 1]], ['Multiply', 2, 'x']])
        .evaluate()
        .toString()
    ).toBe('2(x + 1)');
  });

  test('a loop over a local with no value', () => {
    // The collection is the read. Its error stops the loop, and is the
    // value of the loop. Before, the error was not a collection, so the
    // loop ran no iteration and the error was lost.
    for (const [source, kind] of [
      ['function g() { for i in t { s = i }; t = [1] }\ng()', 'assignment'],
      ['function g() { for i in t { s = i }; let t = [1] }\ng()', 'let'],
      [
        'function g() { s = 0; for i in t { s = s + 1 }; t = [1]; s }\ng()',
        'assignment',
      ],
    ]) {
      const { value } = run(source);
      if (kind === 'assignment') expectReadBeforeAssignment(value, 't');
      else
        expect(value).toEqual([
          'Error',
          ['ErrorCode', "'read-before-declaration'", "'t'"],
        ]);
      expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
    }
  });

  test('a loop over a name that is not a collection, at the top level', () => {
    // Not changed: a loop over a value that is not a collection (`5`, or a
    // name with no value) runs no iteration.
    for (const source of ['for i in tt { s = i }', 'for i in 5 { s = i }']) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toBe('Nothing');
    }
  });

  test('a call of a local with no value', () => {
    // A call of the function that the local holds is a use of the local,
    // as a read is. Before, `u` held the call `h(1)`, which gave `1` when
    // it was read after the assignment.
    const assignment = 'function g() { u = h(1); h = (x) => x; u }\ng()';
    expectReadBeforeAssignment(run(assignment).value, 'h');
    expect(staticReports(assignment)).toEqual([
      ['read-before-declaration', 'h(1)'],
    ]);
    const declared = 'function g() { u = h(1); let h = (x) => x; u }\ng()';
    expect(run(declared).value).toEqual([
      'Error',
      ['ErrorCode', "'read-before-declaration'", "'h'"],
    ]);
    expect(staticReports(declared)).toEqual([
      ['read-before-declaration', 'h(1)'],
    ]);
  });

  test('a call of a local after it has a value', () => {
    for (const source of [
      'function g() { h = (x) => 2x; h(3) }\ng()',
      'function g() { f = () => h(3); h = (x) => 2x; f() }\ng()',
    ]) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toBe(6);
      expect(staticReports(source)).toEqual([]);
    }
  });

  test('a call at the top level is not changed', () => {
    // `h` has no value when `u = h(1)` runs, so `u` holds the evaluated,
    // unresolved call `h(1)`. The assignment of a function literal to `h`
    // takes effect when it executes. Each top-level statement is its own
    // top-level evaluation, so the read of `u` in the last statement
    // resolves `h(1)` again and gives `1`.
    {
      const { value, diagnostics } = run('u = h(1)\nh = (x) => x\nu');
      expect(diagnostics).toEqual([]);
      expect(value).toBe(1);
    }
    // Inside a `do` block, the statements run in the top-level evaluation of
    // the statement that holds the block, and a call evaluated while its
    // head had no value stays unresolved for the rest of that evaluation
    // (the sticky rule of `docs/SCOPING-MODEL.md`, "Callable resolution"):
    // the read of `u` in the block gives `h(1)`. When the value of the block
    // is stored (`r = do { … }`), the read of `r` in the next statement is a
    // later top-level evaluation, and resolves it.
    for (const [source, expected] of [
      ['do { u = h(1); h = (x) => x; u }', ['h', 1]],
      ['r = String(do { u = h(1); h = (x) => x; u })\nr', "'h(1)'"],
      ['r = do { u = h(1); h = (x) => x; u }\nr', 1],
    ] as const) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toEqual(expected);
    }
    // A `function h(x) { x }` statement, which is a declaration, is
    // available throughout its statement list and gives `1`.
    for (const source of [
      'u = h(1)\nfunction h(x) { x }\nu',
      'r = do { u = h(1); function h(x) { x }; u }\nr',
    ]) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toBe(1);
    }
  });

  test('a call on the host route', () => {
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['Assign', 'u', ['h', 1]],
        ['Assign', 'h', ['Function', 'x', 'x']],
        'u',
      ],
      'k',
    ]);
    expectReadBeforeAssignment(ce.box(['Apply', fn, 2]).evaluate().json, 'h');
  });

  test('the asynchronous route', async () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(k) { u = t; t = k; u }');
    expectReadBeforeAssignment(
      (await ce.box(['g', 1]).evaluateAsync()).json,
      't'
    );
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
  // canonicalizes its statements. A name that a later statement declares
  // does not count when a function body decides which names it owns, as in
  // `executeEpsil`, which reads one top-level statement at a time.
  test.each([
    [
      'a `let` after the function',
      'function g(k) { t = k + 1; t }\nlet t = 0\n[g(1), g(2), t]',
      [2, 3, 0],
    ],
    [
      'an assignment after the function',
      'function g(k) { t = k + 1; t }\nt = 10\n[g(1), t]',
      [2, 10],
    ],
    [
      'a `scope` function, a `let` after it',
      'function g(k) scope { t = k + 1; t }\nlet t = 0\n[g(1), t]',
      [2, 0],
    ],
    [
      'a function defined after the function',
      'function f() { h = 1; h }\nfunction h() { 5 }\n[f(), h()]',
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
    // statements: in a `do` block, the `let` is visible to the function,
    // whose write is then the `scope` effect.
    const source =
      'do { function g(k) { t = k + 1; t }; let t = 0; [g(1), t] }';
    expect(JSON.stringify(run(source).value)).toContain(SCOPE_ERROR);
    const ce = new ComputeEngine();
    expect(
      JSON.stringify(ce.box(parseEpsil(source)[0] as never).evaluate().json)
    ).toContain(SCOPE_ERROR);
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
    ['an assignment of a function literal', 'g = (k) => do { t = k + 1; t }'],
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
      'let t = 0\nlet g = (k) => do { t = k + 1; t }\n[g(1), t]',
    ],
  ])('%s: the outer variable is written', (_name, source) => {
    expect(run(source)).toMatchObject({
      value: ['List', 2, 2],
      diagnostics: [],
    });
    expect(compileProgram(source).run!({} as never)).toEqual([2, 2]);
  });

  test('a declaration with the `scope` effect is the contract', () => {
    const source =
      'let t = 0\nlet g: (integer) scope -> integer\n' +
      'function g(k) { t = k + 1; t }\n[g(1), t]';
    expect(run(source)).toMatchObject({
      value: ['List', 2, 2],
      diagnostics: [],
    });
    // The compilation does not refuse the definition for its effects. (A
    // function declared with a type and then defined does not compile
    // today, for another reason.)
    expect(() => compileProgram(source)).not.toThrow(
      /writes outside the function/
    );
  });
});

describe('A FUNCTION DECLARED WITH A TYPE, THEN DEFINED, COMPILES', () => {
  // `let g: (integer) -> integer` then `function g(k) { … }` is one binding:
  // the declaration gives the name and its type, and the definition gives
  // its function. The compiled program binds the function once.
  const compiled = (source: string, to = 'javascript'): unknown => {
    const result = compile(
      new ComputeEngine().box(parseEpsil(source)[0] as never),
      { to, fallback: false } as never
    )!;
    expect(result.success).toBe(true);
    return result.run!({} as never);
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
      'a declaration with no type',
      'let g\nfunction g(k) { k + 1 }\n[g(1), g(2)]',
      [2, 3],
    ],
    [
      'a declaration with the `scope` effect',
      'let t = 0\nlet g: (integer) scope -> integer\n' +
        'function g(k) { t = k + 1; t }\n[g(1), t]',
      [2, 2],
    ],
    [
      'a call before the declaration',
      'let a = g(3)\nlet g: (integer) -> integer\nfunction g(k) { k + 1 }\n[a]',
      [4],
    ],
    [
      'in a function body',
      'function f(n) { let h: (integer) -> integer; function h(k) { k * 2 }; h(n) }\n[f(4)]',
      [8],
    ],
  ])('%s', (_name, source, value) => {
    expect(run(source)).toMatchObject({
      value: ['List', ...value],
      diagnostics: [],
    });
    expect(compiled(source)).toEqual(value);
    const interval = compiled(source, 'interval-js') as {
      value: { lo: number; hi: number };
    }[];
    expect(interval.map((x) => x.value.lo)).toEqual(value);
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
// A function body owns each name that an assignment in one of its nested
// blocks writes (a branch of an `if`, a loop body, a `do` block), as in
// Python (`nestedAssignmentNames()`,
// `src/compute-engine/library/control-structures.ts`). A `let` in a nested
// block declares a local of that block only, and a function literal in the
// body owns the names of its own body. A block outside every function keeps
// the rule of a block: it owns the names that its own statements assign.
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

describe('A FUNCTION BODY OWNS THE NAMES THAT ITS NESTED BLOCKS ASSIGN', () => {
  test('a name assigned in one branch of an `if`', () => {
    const source = 'function g(c) { if c { t = 1 }; t }\n[g(true), g(false)]';
    const { ce, value, diagnostics } = run(source);
    expect(diagnostics).toEqual([]);
    expect((value as unknown[])[1]).toBe(1);
    expectReadBeforeAssignment((value as unknown[])[2], 't');
    expect(ce.box('g').type.toString()).not.toContain('scope');
    // The program evaluated as one block gives the same values.
    const evaluated = new ComputeEngine()
      .box(parseEpsil(source)[0] as never)
      .evaluate().json as unknown[];
    expect(evaluated[1]).toBe(1);
    expectReadBeforeAssignment(evaluated[2], 't');
  });

  test.each([
    ['a loop body', 'function g() { for i in [1, 2] { t = i }; t }\ng()', 2],
    [
      'a `while` loop body',
      'function g() { n = 0; while n < 3 { n = n + 1; t = n * 2 }; t }\ng()',
      6,
    ],
    ['a `do` block', 'function g() { do { t = 3 }; t + 1 }\ng()', 4],
    [
      'nested `if`s',
      'function g(c, d) { if c { if d { t = 1 } else { t = 2 } }; t }\n' +
        '[g(true, true), g(true, false)]',
      [1, 2],
    ],
    [
      'a first assignment in a branch of a loop body',
      'function g(n) { for i in 1..n { if i == 1 { s = 0 }; s = s + i }; s }\n' +
        '[g(3), g(4)]',
      [6, 10],
    ],
    [
      'a top-level `let` after the function is not written',
      'function g(c) { if c { t = 5 }; t }\nlet t = 10\n[g(true), t]',
      [5, 10],
    ],
  ])('%s: every route agrees', (_name, source, value) => {
    const list = Array.isArray(value) ? ['List', ...value] : value;
    expect(run(source).diagnostics).toEqual([]);
    expect(threeRoutes(source)).toEqual({
      run: list,
      evaluated: list,
      compiled: value,
    });
  });

  test('a nested assignment is not the `scope` effect', () => {
    const { ce, diagnostics } = run(
      'function g() { for i in [1, 2] { if i > 1 { t = i } }; 0 }'
    );
    expect(diagnostics).toEqual([]);
    expect(ce.box('g').type.toString()).not.toContain('scope');
  });

  test('a `let` in a branch declares a local of the branch only', () => {
    // The assignments in the branch write the `let` local, so the body does
    // not own `t`, and the `t` after the `if` is a free symbol.
    for (const [source, value] of [
      ['function g(c) { if c { let t = 1; t = 2 }; t }\ng(true)', 't'],
      ['function g(c) { if c { let t = 1; t = t + 1; u = t }; u }\ng(true)', 2],
    ] as const) {
      const routes = threeRoutes(source);
      expect(routes.run).toEqual(value);
      expect(routes.evaluated).toEqual(value);
    }
  });

  test('a function literal in a branch owns the names of its body', () => {
    const source =
      'function g(c) { if c { u = ((k) => do { t = k; t })(2) }; [u, t] }\ng(true)';
    const routes = threeRoutes(source);
    expect(routes.run).toEqual(['List', 2, 't']);
    expect(routes.evaluated).toEqual(['List', 2, 't']);
  });

  test('the compiled function declares the local in its body', () => {
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      ['Block', ['If', 'c', ['Block', ['Assign', 't', 1]]], 't'],
      'c',
    ] as never);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.success).toBe(true);
    // The declaration comes before the `if`, so the read after it sees the
    // write in the branch.
    expect(result.code.indexOf('let t')).toBeGreaterThan(-1);
    expect(result.code.indexOf('let t')).toBeLessThan(
      result.code.indexOf('if (')
    );
    expect(result.run!(true as never)).toBe(1);
    expect(ce.box(['Apply', fn, 'True']).evaluate().json).toBe(1);
  });

  test('the top level is not changed', () => {
    // A block outside every function owns only the names that its own
    // statements assign: a nested block owns its own, and the `t` after it
    // is a free symbol.
    for (const source of [
      'do { if true { t = 1 }; t }',
      'for i in [1, 2] { t = i }\nt',
    ]) {
      const { value, diagnostics } = run(source);
      expect(diagnostics).toEqual([]);
      expect(value).toBe('t');
      expect(staticReports(source)).toEqual([]);
    }
  });
});

describe('THE STATIC CHECK READS THE NESTED BLOCKS OF A FUNCTION BODY', () => {
  // `epsil check` reports a read that runs before every assignment of the
  // local, also when the first assignment is in a nested block
  // (`readsBeforeFirstWrite()`, `src/epsil/read-before-assignment.ts`).
  test.each([
    [
      'a read in a branch before the assignment of the branch',
      'function g(c) { if c { u = t; t = 1 }; 0 }\ng(true)',
    ],
    [
      'a read in the other branch',
      'function g(c) { if c { t = 1 } else { u = t }; 0 }\ng(false)',
    ],
    ['a read in a `do` block', 'function g() { do { u = t; t = 1 }; 0 }\ng()'],
    [
      'a read in the first iteration of a loop body',
      'function g() { for i in [1, 2] { s = t; t = i }; 0 }\ng()',
    ],
    [
      'a read in the condition of the `if` that assigns',
      'function g() { if t > 0 { t = 1 }; 0 }\ng()',
    ],
  ])('%s', (_name, source) => {
    expect(staticReports(source)).toEqual([['read-before-declaration', 't']]);
    // The program evaluated as one block gives the error too.
    const ce = new ComputeEngine();
    const value = ce.box(parseEpsil(source)[0] as never).evaluate().json;
    expect(JSON.stringify(value)).toContain("'read-before-declaration'");
  });

  test.each([
    [
      'a read after an `if` that assigns in one branch',
      'function g(c) { if c { t = 1 }; t }',
    ],
    [
      'a read in a branch of a loop body, after an earlier iteration',
      'function g(c) { for i in [1, 2] { if c { u = t; t = 1 } }; 0 }',
    ],
    ['a read after the loop', 'function g(xs) { for x in xs { t = x }; t }'],
  ])('not certain: %s', (_name, source) => {
    expect(staticReports(source)).toEqual([]);
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
  // The rebuilt body keeps the record of its assignment locals
  // (`copyAssignmentLocals()`), so an assignment in it is a local of the
  // closure, as for the same closure written as a statement of the body.
  test.each([
    [
      'a closure called in the branch',
      'function g(c) { if c { h = () => do { u = 2; u }; v = h() } else { v = 0 }; v }\n' +
        '[g(true), g(false)]',
      ['List', 2, 0],
    ],
    [
      'the name of the closure local is not a local of the function',
      'function g(c) { if c { h = () => do { u = 2; u }; t = h() }; [t, u] }\ng(true)',
      ['List', 2, 'u'],
    ],
    [
      'a closure returned from a branch',
      'function mk(n) { if n > 0 { f = (k) => do { acc = k * n; acc + 1 } } else { f = (k) => 0 }; f }\n' +
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
    const source =
      'function g(c) { if c { h = () => do { u = t; t = 2; u }; v = h() }; v }\ng(true)';
    expectReadBeforeAssignment(evaluatedAsBlock(source), 't');
  });
});

describe('COMPILED CODE CHECKS A READ THAT CAN COME BEFORE EVERY ASSIGNMENT', () => {
  // A read of a function-body local that the compiler cannot prove to come
  // after an assignment compiles with a check, which throws the
  // `read-before-declaration` error when the local has no value
  // (`checkedLocalReads()`, `src/compute-engine/compilation/base-compiler.ts`).
  const literal = (body: unknown) =>
    new ComputeEngine().box(['Function', body, 'c'] as never);
  const BRANCH = ['Block', ['If', 'c', ['Block', ['Assign', 't', 1]]], 't'];

  test('JavaScript: `g(false)` throws, `g(true)` answers', () => {
    const result = compile(literal(BRANCH), {
      to: 'javascript',
      fallback: false,
    } as never)!;
    expect(result.success).toBe(true);
    expect(result.run!(true as never)).toBe(1);
    expect(() => result.run!(false as never)).toThrow(
      /read-before-declaration: "t"/
    );
  });

  test('an Epsil program', () => {
    const compiled = (source: string) =>
      compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
        to: 'javascript',
        fallback: false,
      } as never)!;
    const g = 'function g(c) { if c { t = 1 }; t }\n';
    expect(compiled(`${g}g(true)`).run!({} as never)).toBe(1);
    expect(() => compiled(`${g}g(false)`).run!({} as never)).toThrow(
      /read-before-declaration/
    );
    // The run gives the error too.
    expectReadBeforeAssignment(run(`${g}g(false)`).value, 't');
  });

  test('a loop that runs no time', () => {
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
    expectReadBeforeAssignment(
      fn.engine.box(['Apply', fn, 3] as never).evaluate().json,
      't'
    );
    const js = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(() => js.run!(3 as never)).toThrow(/read-before-declaration/);
    const ia = compile(fn, { to: 'interval-js', fallback: false } as never)!;
    const iaFn = (ia.run as unknown as () => (x: unknown) => unknown)();
    expect(() => iaFn({ lo: 3, hi: 3 })).toThrow(/read-before-declaration/);
  });

  test('interval-js: a read after a loop that runs', () => {
    const fn = literal([
      'Block',
      [
        'Loop',
        ['Block', ['Assign', 't', ['Multiply', 'k', 'c']]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      't',
    ]);
    const ia = compile(fn, { to: 'interval-js', fallback: false } as never)!;
    const iaFn = (ia.run as unknown as () => (x: unknown) => unknown)();
    expect(iaFn({ lo: 3, hi: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 9, hi: 9 },
    });
  });

  test.each([
    ['an assignment before the read', ['Block', ['Assign', 't', 'c'], 't']],
    [
      // `c > 0` compares a parameter, so it is always decided and one
      // branch runs.
      'an assignment in each branch of a decided condition',
      [
        'Block',
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
        [
          'If',
          'c',
          ['Block', ['Assign', 't', 1], ['Assign', 'u', ['Add', 't', 1]]],
        ],
        'c',
      ],
    ],
  ])('no check: %s', (_name, body) => {
    const result = compile(literal(body), {
      to: 'javascript',
      fallback: false,
    } as never)!;
    expect(result.code).not.toContain('read-before-declaration');
  });

  test('a check: an assignment in each branch of a condition read by its value', () => {
    // The condition `c` selects a branch only when it is `true` or `false`.
    // Any other value runs no branch (CE-636), so the read is checked.
    const result = compile(
      literal([
        'Block',
        [
          'If',
          'c',
          ['Block', ['Assign', 't', 1]],
          ['Block', ['Assign', 't', 2]],
        ],
        't',
      ]),
      { to: 'javascript', fallback: false } as never
    )!;
    expect(result.code).toContain('read-before-declaration');
    expect(result.run!(true as never)).toBe(1);
    expect(result.run!(false as never)).toBe(2);
    expect(() => result.run!(3 as never)).toThrow(
      /read-before-declaration: "t"/
    );
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
      'function g() { s = 0; for k in 1..2 { k = k * 10; s = s + k }; s }\ng()',
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
  // first: the body owns the names that its nested blocks assign, as when
  // the `Function` is boxed in one step (`hasNestedAssignmentLocals()`,
  // `src/compute-engine/function-utils.ts`).
  test('a name assigned in one branch', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['If', 'c', ['Block', ['Assign', 't', 1]]],
      't',
    ] as never);
    const fn = ce.function('Function', [block, ce.symbol('c')]);
    expect(ce.box(['Apply', fn, 'True'] as never).evaluate().json).toBe(1);
    expectReadBeforeAssignment(
      ce.box(['Apply', fn, 'False'] as never).evaluate().json,
      't'
    );
  });

  test('a block with no nested assignment is kept as it is', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Assign', 'w', ['Multiply', 2, 'c']],
      ['Add', 'w', 1],
    ] as never);
    const fn = ce.function('Function', [block, ce.symbol('c')]);
    expect(fn.op1).toBe(block);
    expect(ce.box(['Apply', fn, 3] as never).evaluate().json).toBe(7);
  });
});

describe('AN OPERAND EVALUATED FOR EACH ELEMENT OWNS ITS NAMES', () => {
  // A function body owns the names that its nested blocks assign, except in
  // an operand that the operator applies as a function or evaluates when an
  // element is read: the term of a `Table`, the term and the condition of a
  // comprehension (`deferredOperands()`,
  // `src/compute-engine/library/control-structures.ts`). Such an operand
  // owns its names, in a function body as at the top level. Before this,
  // the term wrote a local of the function body, and the result stayed
  // unevaluated.

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
      '[do { t = k * 2; t } for k in 1..3]',
      ['List', 2, 4, 6],
      '[2,4,6]',
    ],
    [
      'the condition of a comprehension',
      '[k * 2 for k in 1..3 if do { t = k; t > 1 }]',
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
    ['Block', ['Assign', 'a', 'k'], 'a'],
    ['Tuple', 'k', 1, 3],
  ];
  const TABLE_BRANCH = [
    'Table',
    ['Block', ['If', ['Equal', 'k', 2], ['Block', ['Assign', 'a', 5]]], 'a'],
    ['Tuple', 'k', 1, 3],
  ];

  test.each([
    ['an assignment in the term of a `Table`', TABLE_ASSIGN],
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
    // The term is a function body: a read of `a` when the branch did not
    // run is a read before the first assignment.
    const value = ce
      .box(['Apply', ['Function', ['Block', TABLE_BRANCH]]] as never)
      .evaluate({ materialization: true }).json as unknown[];
    expect(value[2]).toBe(5);
    expectReadBeforeAssignment(value[1], 'a');
    expectReadBeforeAssignment(value[3], 'a');
  });

  test('the term of a `Sum` keeps its local from one index to the next', () => {
    // A `Sum` term is evaluated again at each index while the statement is
    // evaluated, as a loop body is: the function body owns `t`.
    const source =
      'function g() { sum(do { if k == 1 { t = 0 }; t = t + k; t }, k, 1, 3) }\ng()';
    expect(run(source).value).toBe(10);
  });
});

describe('THE COMPILED CHECK OF A READ BEFORE THE FIRST ASSIGNMENT', () => {
  // A read of an assignment local that can come before its first
  // assignment compiles with a check (`checkedLocalReads()`,
  // `src/compute-engine/compilation/base-compiler.ts`).

  test('a function defined in the engine with a parameter of the same name', () => {
    // The definition of `h` compiles while the body of the caller compiles.
    // Its parameter `t` is another binding: its reads are not checked, and
    // the marker of the caller is not visible in the definition. Before,
    // the definition read the marker of the caller, which is not declared
    // there: `ReferenceError: _tv1 is not defined`.
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Block', ['Assign', 'u', ['Multiply', 2, 't']], ['Add', 'u', 't']],
        't',
      ] as never)
    );
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['If', ['Greater', 'x', 0], ['Block', ['Assign', 't', 1]]],
        ['Add', 't', ['h', 'x']],
      ],
      'x',
    ] as never);
    expect(ce.box(['Apply', fn, 2] as never).evaluate().json).toBe(7);
    expectReadBeforeAssignment(
      ce.box(['Apply', fn, -1] as never).evaluate().json,
      't'
    );
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.run!(2 as never)).toBe(7);
    expect(() => result.run!(-1 as never)).toThrow(/read-before-declaration/);
  });

  test('the same on the interval target', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Block', ['Assign', 'u', ['Multiply', 2, 't']], ['Add', 'u', 't']],
        't',
      ] as never)
    );
    const fn = ce.box([
      'Function',
      [
        'Block',
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Assign', 't', 1]],
          ['Block', ['Assign', 'w', 2]],
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
    // The definition of `h` does not test its parameter `t`.
    expect(result.preamble).toContain('const _fn_h');
    expect(result.preamble).not.toContain('read-before-declaration');
  });

  test('an assignment in a loop body does not prove a read in its collection', () => {
    // The collection `1..t` is evaluated before the body: the read of `t`
    // there comes before every assignment. Before, the assignment in the
    // body, which `Loop` stores first, proved the read. No path gives `t` a
    // value before the read, so the compilation fails (CE-636).
    const compiled = (source: string) =>
      compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
        to: 'javascript',
        fallback: false,
      } as never)!;
    expect(() =>
      compiled('function g() { for k in 1..t { t = 2 }; 0 }\ng()')
    ).toThrow(/no path to that read gives "t" a value/);
    // An earlier statement that may assign `t`: the read is checked.
    const g = 'function g(c) { if c { t = 3 }; for k in 1..t { t = 2 }; 0 }\n';
    expect(compiled(`${g}g(true)`).run!({} as never)).toBe(0);
    expect(() => compiled(`${g}g(false)`).run!({} as never)).toThrow(
      /read-before-declaration/
    );
  });

  test('a node read before and after an assignment is checked', () => {
    // The body holds the node `t + 1` twice: once before the assignment
    // `t = 5` and once after it. Before, the read after the assignment
    // proved the node, and the read before it was not checked: the call
    // with `c` false computed `NaN` from the marker of `t`.
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      [
        'Block',
        ['If', 'c', ['Block', ['Assign', 't', 3]]],
        ['Assign', 'w', ['Add', 't', 1]],
        ['Assign', 't', 5],
        ['Add', 't', 'w'],
      ],
      'c',
    ] as never);
    const body = literal.op1;
    const shared = body.ops![1].op2;
    const block = ce._fn(
      'Block',
      [
        body.ops![0],
        body.ops![1],
        body.ops![2],
        ce._fn('Multiply', [shared, body.ops![3]]),
      ],
      { scope: body.localScope }
    );
    const fn = ce._fn('Function', [block, ...literal.ops!.slice(1)]);
    const result = compile(fn, { to: 'javascript', fallback: false } as never)!;
    expect(result.run!(true as never)).toBe(54);
    expect(() => result.run!(false as never)).toThrow(
      /read-before-declaration/
    );
  });
});

describe('AN ASSIGNMENT LOCAL IN A LOOP DOMAIN, A PIPE STAGE', () => {
  test('a loop over a range with an unset local gives the read error', () => {
    // `Range(1, t)` keeps the failed operand in place and is not a
    // collection; the loop took it for an empty domain and answered `0`.
    const { value } = run('function g() { for k in 1..t { t = 2 }; 0 }\ng()');
    expect(JSON.stringify(value)).toContain('read-before-declaration');
  });

  test('a loop over a range with a bound local still runs', () => {
    const { value, diagnostics } = run(
      'function g() { t = 3; s = 0; for k in 1..t { s = s + k }; s }\ng()'
    );
    expect(diagnostics).toEqual([]);
    expect(value).toBe(6);
  });

  test('a lambda of a pipe stage that assigns a name has no scope effect', () => {
    const { diagnostics } = run(
      'function g() { (1..3) |> map((k) => do { t = k * 2; t }) }\ng()'
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
