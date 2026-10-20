import { ComputeEngine } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ERROR_EXPLANATIONS } from '../../src/epsil/error-explanations';

//
// An assignment to a name that an earlier top-level `const` declaration
// bound. The engine refuses it: it throws a `ConstantAssignmentError` (code
// `constant-assignment`), and the binding keeps its value. The static check
// (`epsil check`) reports the assignment as a `static-type-error` that
// carries the engine code, with a note on the `const` declaration. The run
// does not report it a second time, and a run-time report (when the static
// check cannot see the constant) carries the same code.
//

const DESCRIPTION = (name: string) =>
  `cannot assign a value to the constant \`${name}\``;

function check(source: string) {
  return checkSource(source).diagnostics.map((d) => ({
    message: d.message,
    at: source.slice(d.range[0], d.range[1]),
    notes: (d.notes ?? []).map((n) => ({
      message: n.message,
      at:
        n.range === undefined
          ? undefined
          : source.slice(n.range[0], n.range[1]),
    })),
  }));
}

function run(source: string, ce = new ComputeEngine()) {
  return executeEpsil(ce, source);
}

describe('ENGINE: THE REFUSAL CARRIES A STABLE CODE', () => {
  test('ce.assign on a user constant throws, with the code', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { value: 5, isConstant: true });
    let thrown: unknown;
    try {
      ce.assign('c', 6);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const e = thrown as Error & { code?: string; constantName?: string };
    expect(e.message).toBe('Cannot assign a value to the constant "c"');
    expect(e.name).toBe('ConstantAssignmentError');
    expect(e.code).toBe('constant-assignment');
    expect(e.constantName).toBe('c');
    expect(ce.box('c').evaluate().re).toBe(5);
  });

  test('ce.assign of a function literal on a library constant', () => {
    const ce = new ComputeEngine();
    let thrown: unknown;
    try {
      ce.assign('Pi', ['Function', ['Multiply', 2, 'x'], 'x']);
    } catch (e) {
      thrown = e;
    }
    const e = thrown as Error & { code?: string };
    expect(e.message).toBe('Cannot assign a value to the constant "Pi"');
    expect(e.code).toBe('constant-assignment');
  });

  test('the Assign operator still throws to the host', () => {
    const ce = new ComputeEngine();
    expect(() => ce.box(['Assign', 'Pi', 3]).evaluate()).toThrow(
      'Cannot assign a value to the constant "Pi"'
    );
  });

  test('a sequence definition on a constant throws the same error', () => {
    const ce = new ComputeEngine();
    ce.declare('F', { value: 5, isConstant: true });
    let thrown: unknown;
    try {
      ce.parse('F_0 := 1').evaluate();
    } catch (e) {
      thrown = e;
    }
    const e = thrown as Error & { code?: string };
    expect(e.message).toBe('Cannot assign a value to the constant "F"');
    expect(e.code).toBe('constant-assignment');
  });

  test('`epsil doc constant-assignment` has an entry', () => {
    expect(ERROR_EXPLANATIONS['constant-assignment']).toBeDefined();
  });
});

describe('EPSIL CHECK: AN ASSIGNMENT TO A CONST BINDING', () => {
  test('a top-level assignment', () => {
    const source = 'const c = 1\nc = 2\nc';
    expect(check(source)).toEqual([
      {
        message: [
          'static-type-error',
          DESCRIPTION('c'),
          'c := 2',
          'constant-assignment',
        ],
        at: 'c = 2',
        notes: [
          { message: '`c` is declared constant here', at: 'const c = 1' },
        ],
      },
    ]);
  });

  test('an assignment with `:=`', () => {
    const d = check('const c = 1\nc := 2\nc');
    expect(d.map((x) => [x.message[3], x.at])).toEqual([
      ['constant-assignment', 'c := 2'],
    ]);
  });

  test('an assignment of a function literal to a const function', () => {
    const d = check('const k = (n) => n + 1\nk = (s) => s\nk(1)');
    expect(d.map((x) => [x.message[1], x.message[3], x.at])).toEqual([
      [DESCRIPTION('k'), 'constant-assignment', 'k = (s) => s'],
    ]);
  });

  test('a leaf of a destructuring assignment', () => {
    const d = check('const c = 1\n(a, c) := (3, 4)\nc');
    expect(d.map((x) => [x.message[3], x.at])).toEqual([
      ['constant-assignment', '(a, c) := (3, 4)'],
    ]);
  });

  test('an assignment in a block, a branch or a loop body', () => {
    for (const [body, at] of [
      ['if true { c = 2 }', 'c = 2'],
      ['do { c = 2; 5 }', 'c = 2'],
      ['for i in 1..3 { c = i }', 'c = i'],
      ['while false { c = 2 }', 'c = 2'],
    ]) {
      const d = check(`const c = 1\n${body}\nc`);
      expect(d.map((x) => [x.message[3], x.at])).toEqual([
        ['constant-assignment', at],
      ]);
    }
  });

  test('an assignment in a function body', () => {
    const source =
      'const c = 1\nfunction f(x) scope -> integer { c = x; x }\nf(2)\nc';
    const d = check(source);
    expect(d.map((x) => [x.message[3], x.at, x.notes[0].at])).toEqual([
      ['constant-assignment', 'c = x', 'const c = 1'],
    ]);
  });

  test('each assignment is reported', () => {
    const d = check('const c = 1\nc = 2\nc = 3\nc');
    expect(d.map((x) => x.at)).toEqual(['c = 2', 'c = 3']);
  });
});

describe('EPSIL CHECK: NO REPORT', () => {
  test('a `let` binding', () => {
    expect(check('let c = 1\nc = 2\nc')).toEqual([]);
  });

  test('a const of another name', () => {
    expect(check('const d = 1\nc = 2\nc + d')).toEqual([]);
  });

  test('a `let` in a function body shadows the constant', () => {
    const source = 'const c = 1\nfunction f(x) { let c = x; c = 3; c }\nf(1)';
    expect(check(source)).toEqual([]);
    expect(run(source).value.toString()).toBe('3');
  });

  test('a parameter shadows the constant', () => {
    const source = 'const c = 1\nfunction f(c) { c = 3; c }\nf(1)';
    expect(check(source)).toEqual([]);
    expect(run(source).value.toString()).toBe('3');
  });

  test('a `let` in a block shadows the constant', () => {
    const source = 'const c = 1\ndo { let c = 4; c = 2; c }';
    expect(check(source)).toEqual([]);
    expect(run(source).value.toString()).toBe('2');
  });

  test('a loop variable shadows the constant', () => {
    const source = 'const c = 1\nfor c in 1..3 { c = 7 }\nc';
    expect(check(source)).toEqual([]);
    expect(run(source).value.toString()).toBe('1');
  });

  test('a write before a `let` of the block is a read-before-declaration', () => {
    // The write targets the local of the block, not the constant.
    const source = 'const c = 1\ndo { c = 5; let c = 2; c }';
    expect(
      check(source).some((d) => d.message[3] === 'constant-assignment')
    ).toBe(false);
    expect(JSON.stringify(run(source).value.json)).toContain(
      'read-before-declaration'
    );
  });

  test('an indexed assignment does not replace the binding', () => {
    // The engine refuses an indexed assignment to any binding, with another
    // error; it is not an assignment to the constant.
    const d = check('const c = [1, 2]\nc[1] = 5\nc');
    expect(d.some((x) => x.message[3] === 'constant-assignment')).toBe(false);
  });

  test('a `const` that re-declares a `let` does not make a constant', () => {
    // The run time refuses the re-declaration, so `c` stays the `let`
    // binding, and the later assignment and `function` statement are valid.
    const d = check('let c = 1\nconst c = 2\nc = 3\nc');
    expect(d.map((x) => x.message[0])).toEqual(['variable-redeclaration']);
    expect(run('let c = 1\nconst c = 2\nc = 3\nc').value.toString()).toBe('3');
    const f = check('let c = 1\nconst c = 2\nfunction c(x) { x }\nc(5)');
    expect(f.some((x) => x.message[3] === 'invalid-clause-definition')).toBe(
      false
    );
  });
});

describe('RUN: ONE REPORT, WITH THE CODE', () => {
  test('a non-final assignment is reported once, by the static check', () => {
    const r = run('const c = 1\nc = 2\nc');
    expect(r.value.toString()).toBe('1');
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
    ]);
  });

  test('a final assignment: the value is the error, with the code', () => {
    const r = run('const c = 1\nc = 2');
    expect(r.value.json).toEqual([
      'Error',
      ['ErrorCode', "'constant-assignment'", "'c'"],
    ]);
    expect(r.diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
    ]);
  });

  test('a call of a function that assigns the constant', () => {
    const r = run(
      'const c = 1\nfunction f(x) scope -> integer { c = x; x }\nf(2)\nc'
    );
    expect(r.value.toString()).toBe('1');
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
    ]);
  });

  test('a library constant: the run-time report carries the code', () => {
    const r = run('Pi = 3\nPi');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['runtime-error', DESCRIPTION('Pi'), '', 'constant-assignment'],
    ]);
  });

  test('a constant of an earlier program: the run-time report has the code', () => {
    const ce = new ComputeEngine();
    expect(run('const c = 1', ce).diagnostics).toEqual([]);
    const r = run('c = 2\nc', ce);
    expect(r.value.toString()).toBe('1');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['runtime-error', DESCRIPTION('c'), '', 'constant-assignment'],
    ]);
  });
});

describe('EPSIL CHECK: A CONST IN A FUNCTION BODY OR A BLOCK', () => {
  test('an assignment to a local const of a function body', () => {
    const source = 'function f() { const c = 1; c = 2; c }\nf()\n5';
    expect(check(source)).toEqual([
      {
        message: [
          'static-type-error',
          DESCRIPTION('c'),
          'c := 2',
          'constant-assignment',
        ],
        at: 'c = 2',
        notes: [
          { message: '`c` is declared constant here', at: 'const c = 1' },
        ],
      },
    ]);
  });

  test('a local const in a block, a branch or a loop body', () => {
    for (const body of [
      'do { const c = 1; c = 2; c }',
      'if true { const c = 1; c = 2 }',
      'for i in 1..2 { const c = i; c = 2 }',
    ]) {
      const d = check(`${body}\n5`);
      expect(d.map((x) => [x.message[3], x.at, x.notes[0].at])).toEqual([
        [
          'constant-assignment',
          'c = 2',
          body.includes('= i') ? 'const c = i' : 'const c = 1',
        ],
      ]);
    }
  });

  test('a name of a destructuring const, top level and local', () => {
    expect(
      check('const (a, b) = (1, 2)\na = 3\na').map((x) => [x.message[3], x.at])
    ).toEqual([['constant-assignment', 'a = 3']]);
    expect(
      check('function f() { const (a, b) = (1, 2); b = 3 }\nf()\n5').map(
        (x) => [x.message[3], x.at, x.notes[0].at]
      )
    ).toEqual([['constant-assignment', 'b = 3', 'const (a, b) = (1, 2)']]);
  });

  test('a top-level const and a local const of the same name', () => {
    // Each assignment is reported once, with the note on its own `const`.
    const source =
      'const c = 1\nc = 2\nfunction f() { const c = 1; c = 2; c }\nf()\n5';
    const d = check(source);
    expect(d.map((x) => [x.message[3], x.at, x.notes[0].at])).toEqual([
      ['constant-assignment', 'c = 2', 'const c = 1'],
      ['constant-assignment', 'c = 2', 'const c = 1'],
    ]);
    // The two notes are on two different declarations.
    const notes = checkSource(source).diagnostics.map(
      (x) => x.notes![0].range[0]
    );
    expect(notes).toEqual([0, 33]);
  });

  test('a local const in a nested block of a lambda body', () => {
    const d = check(
      'let g = (c) => do { if true { const c = 1; c = 2 }; 3 }\ng(0)\n5'
    );
    expect(d.map((x) => [x.message[3], x.at])).toEqual([
      ['constant-assignment', 'c = 2'],
    ]);
  });
});

describe('EPSIL CHECK: A LOCAL CONST THAT THE RUN TIME REFUSES', () => {
  // A `const` that re-declares a name of its block, a parameter of its
  // function or the variable of its loop is `variable-redeclaration`: the
  // block does not run, so the name is not a constant.
  test.each([
    'function f(c) { const c = 1; c = 2; c }\nf(0)\n5',
    'for c in 1..2 { const c = 1; c = 2 }\n5',
    'do { const c = 1; let c = 2; c = 3; c }\n5',
    'do { let c = 0; const c = 1; c = 2; c }\n5',
  ])('%j', (source) => {
    const d = check(source);
    expect(d.some((x) => x.message[3] === 'constant-assignment')).toBe(false);
    expect(d.some((x) => x.message[3] === 'variable-redeclaration')).toBe(true);
  });
});

describe('RUN: LOCAL CONSTANTS ARE REPORTED ONCE', () => {
  test('a local const reassigned in a function that is called', () => {
    const r = run('function f() { const c = 1; c = 2; c }\nf()\n5');
    expect(r.value.toString()).toBe('5');
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
    ]);
  });

  test('a top-level const and a local const of the same name', () => {
    // Two static reports, one for each constant, and no run-time report.
    const r = run(
      'const c = 1\nc = 2\nfunction f() { const c = 1; c = 2; c }\nf()\n5'
    );
    expect(r.value.toString()).toBe('5');
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
      ['static-type-error', 'constant-assignment'],
    ]);
  });

  test('a local const with the name of a library constant', () => {
    // The static check reports the assignment to the local `Pi`. The
    // top-level `Pi = 4` assigns the library constant, which the static
    // check cannot see: the run reports it.
    const r = run('function f() { const Pi = 1; Pi = 2 }\nPi = 4\n5');
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
      ['runtime-error', 'constant-assignment'],
    ]);
  });

  test('a const of an earlier program, re-declared locally', () => {
    // The outer `c` is a constant of an earlier program, so a run-time
    // report for `c` can be for it: the run does not drop it.
    const ce = new ComputeEngine();
    run('const c = 1', ce);
    const r = run('function f() { const c = 1; c = 2 }\nc = 3\n5', ce);
    expect(r.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['static-type-error', 'constant-assignment'],
      ['runtime-error', 'constant-assignment'],
    ]);
  });
});

//
// The run matches a run-time error to a static report by the source range of
// the assignment, not by the name of the constant. The engine records on the
// error the range of the `Assign` node that made the write
// (`ConstantAssignmentError.sourceOffsets`).
//

/** The code and the line of each diagnostic, and the source text at it. */
function sites(
  source: string,
  diagnostics: { message: unknown; range: [number, number, number?] }[]
) {
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  return diagnostics.map((d) => {
    const message = d.message as string[];
    return [
      message[0],
      message[3],
      lineOf(d.range[0]),
      source.slice(d.range[0], d.range[1]),
    ];
  });
}

const CHECK = (source: string) =>
  sites(source, checkSource(source).diagnostics);
const RUN = (source: string, ce = new ComputeEngine()) => {
  const r = executeEpsil(ce, source);
  return {
    value: r.value.toString(),
    diagnostics: sites(source, r.diagnostics),
  };
};

describe('ONE REPORT FOR EACH ASSIGNMENT', () => {
  test('a function defined before a top-level `const` does not write it', () => {
    // The assignment `c = 2` makes a local of the body of `f`: no enclosing
    // scope declared `c` when `f` was defined. The constant keeps its value.
    const source =
      'function f() scope -> integer { c = 2; 0 }\nconst c = 1\nf()\nc';
    expect(CHECK(source)).toEqual([]);
    expect(RUN(source)).toEqual({ value: '1', diagnostics: [] });
  });

  test('two assignments to the same name', () => {
    // Only the top-level assignment writes the constant.
    const source =
      'function f() scope -> integer { c = 2; 0 }\nconst c = 1\nc = 3\nf()\n4';
    const expected = [['static-type-error', 'constant-assignment', 3, 'c = 3']];
    expect(CHECK(source)).toEqual(expected);
    expect(RUN(source)).toEqual({ value: '4', diagnostics: expected });
  });

  test('a local constant and a top-level constant of the same name', () => {
    const source =
      'function g() { const c = 5; c = 6 }\n' +
      'function f() scope -> integer { c = 2; 0 }\n' +
      'const c = 1\nf()\n4';
    const expected = [['static-type-error', 'constant-assignment', 1, 'c = 6']];
    expect(CHECK(source)).toEqual(expected);
    expect(RUN(source)).toEqual({ value: '4', diagnostics: expected });
  });

  test('a local constant with the name of a library constant', () => {
    const source = 'function f() { const Pi = 1; Pi = 2 }\nf()\n5';
    const expected = [
      ['static-type-error', 'constant-assignment', 1, 'Pi = 2'],
    ];
    expect(CHECK(source)).toEqual(expected);
    expect(RUN(source)).toEqual({ value: '5', diagnostics: expected });
  });

  test('a local constant with the name of a constant of an earlier program', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'const c = 1');
    const source = 'function f() { const c = 1; c = 2 }\nf()\n5';
    const expected = [['static-type-error', 'constant-assignment', 1, 'c = 2']];
    expect(CHECK(source)).toEqual(expected);
    expect(RUN(source, ce)).toEqual({ value: '5', diagnostics: expected });
  });

  test('a write to a constant of an earlier program is reported by the run', () => {
    // The static check reports the write to the local `c` of `g`. The write
    // in `f` is to the constant of the earlier program, which the static
    // check cannot see: the run reports it.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'const c = 1');
    const source =
      'function g() { const c = 5; c = 6 }\n' +
      'function f() scope -> integer { c = 2; 0 }\nf()\n4';
    expect(CHECK(source)).toEqual([
      ['static-type-error', 'constant-assignment', 1, 'c = 6'],
    ]);
    expect(RUN(source, ce)).toEqual({
      value: '4',
      diagnostics: [
        ['static-type-error', 'constant-assignment', 1, 'c = 6'],
        ['runtime-error', 'constant-assignment', 3, 'f()'],
      ],
    });
  });
});

describe('EPSIL CHECK: A FUNCTION DEFINED BEFORE THE CONST', () => {
  // A top-level `const` is not declared when an earlier statement defines a
  // function, so an assignment to the name in the body makes a local of the
  // body, with a new binding at each call: the constant is not written, and
  // nothing is reported. A `const` of a block is declared before the
  // functions of the block are defined, so a function defined before it in
  // the block writes it (the next test).
  test.each([
    // Each assignment of the body, in a block too.
    'function f() scope -> integer { if true { c = 2 }; c = 3; 0 }\n' +
      'const c = 1\nf()\nc',
    // A function literal.
    'let g = () => do { c = 2 }\nconst c = 1\ng()\nc',
    // A function called only before the `const`.
    'function f() scope -> integer { c = 2; 0 }\nf()\nconst c = 1\nc',
  ])('no report for a top-level const: %j', (source) => {
    expect(CHECK(source)).toEqual([]);
    expect(RUN(source)).toEqual({ value: '1', diagnostics: [] });
  });

  test('a local const of a function, written by a function defined before it', () => {
    const source =
      'function o() scope -> integer { let g = () => do { c = 2 }; const c = 1; g() }\n' +
      'o()\n5';
    const expected = [['static-type-error', 'constant-assignment', 1, 'c = 2']];
    expect(CHECK(source)).toEqual(expected);
    expect(RUN(source)).toEqual({ value: '5', diagnostics: expected });
  });

  test.each([
    // A `let` of the function body.
    'function f() scope -> integer { let c = 0; c = 2; 0 }\nconst c = 1\nf()\n4',
    // A parameter.
    'function f(c) scope -> integer { c = 2; 0 }\nconst c = 1\nf(0)\n4',
    // A loop variable.
    'function f() scope -> integer { for c in 1..2 { c = 5 }; 0 }\nconst c = 1\nf()\n4',
    // A `let` of an enclosing function.
    'function o() scope -> integer { let c = 0; let g = () => do { c = 2; 0 }; g(); c }\n' +
      'const c = 1\no()\n4',
    // A block of the top level runs before the `const`.
    'do { c = 2 }\nconst c = 1\n4',
  ])('no report when another binding takes the write: %j', (source) => {
    expect(CHECK(source)).toEqual([]);
    expect(RUN(source)).toEqual({ value: '4', diagnostics: [] });
  });

  test('a write before a `let` of the function body', () => {
    // At run time the write targets the local of the body, which is not yet
    // declared.
    const source =
      'function f() scope -> integer { c = 2; let c = 0; 0 }\nconst c = 1\nf()\n4';
    expect(CHECK(source)).toEqual([]);
    expect(RUN(source).diagnostics).toEqual([
      ['runtime-error', 'read-before-declaration', 3, 'f()'],
    ]);
  });
});

describe('ENGINE: THE ERROR CARRIES THE SITE OF THE ASSIGNMENT', () => {
  test('an `Assign` with source offsets', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { value: 5, isConstant: true });
    let thrown: unknown;
    try {
      ce.box({ fn: ['Assign', 'c', 6], sourceOffsets: [10, 15] }).evaluate();
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { sourceOffsets?: unknown }).sourceOffsets).toEqual([
      10, 15,
    ]);
  });

  test('ce.assign has no site', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { value: 5, isConstant: true });
    let thrown: unknown;
    try {
      ce.assign('c', 6);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error).name).toBe('ConstantAssignmentError');
    expect((thrown as { sourceOffsets?: unknown }).sourceOffsets).toBe(
      undefined
    );
  });
});

describe('PERFORMANCE: MANY CONSTANTS', () => {
  // The search for the assignments to a constant is made once for each
  // constant, and its cost is in proportion to the bindings of the same
  // name. A program of N constants is checked in about the time of the
  // same program with `let`: the earlier search was made again for each
  // pair of a statement and a constant, and took 70 times as long at
  // N = 800. The comparison with `let` does not depend much on the load of
  // the machine, because both programs are timed in the same run, each
  // three times. The limit on the time itself is asserted only in a
  // `CE_PERF=1` run.
  const program = (n: number, keyword: string) => {
    const lines: string[] = [];
    for (let i = 0; i < n; i++)
      lines.push(`${keyword} c${i} = ${i}`, `let v${i} = c${i} + 1`);
    return lines.join('\n');
  };
  const time = (source: string) => {
    const start = performance.now();
    expect(checkSource(source).diagnostics).toEqual([]);
    return performance.now() - start;
  };

  test('800 constants take about the time of 800 `let`', () => {
    const constants = program(800, 'const');
    const variables = program(800, 'let');
    let constantTime = Infinity;
    let variableTime = Infinity;
    for (let run = 0; run < 3; run++) {
      constantTime = Math.min(constantTime, time(constants));
      variableTime = Math.min(variableTime, time(variables));
    }
    expect(constantTime).toBeLessThan(5 * variableTime + 50);
    if (process.env.CE_PERF === '1') expect(constantTime).toBeLessThan(2000);
  }, 120_000);
});
