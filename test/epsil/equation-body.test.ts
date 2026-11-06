import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';
import { formatDiagnostics } from '../../src/cli/format';

//
// The `equation-not-assignment` warning (`equationBodyDiagnostics()` in
// `src/epsil/static-diagnostics.ts`): in expression position `=` is an
// equation, so a body that is only `name = value`, with `name` a declared
// variable and the value of the body unread, compares and discards. The program
// keeps its meaning and gets a warning. A body whose value is read, a `==`, a
// free name, a constant, a parameter and a pattern variable get none.
//

const CODE = 'equation-not-assignment';

function run(source: string) {
  const result = executeEpsil(new ComputeEngine(), source);
  return {
    value: result.value?.json,
    codes: result.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    ),
    diagnostics: result.diagnostics,
  };
}

/**
 * The warnings of this check that `epsil check` and a program run report. The
 * two must agree. A program run can add a run-time error of the program.
 */
function codes(source: string): string[] {
  const check = checkSource(source).diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message[0] : d.message
  );
  const warnings = run(source).codes.filter((code) => code === CODE);
  expect(check.filter((code) => code === CODE)).toEqual(warnings);
  return warnings;
}

describe('a body that is only `name = value`, with its value unread', () => {
  test('a case body gets the warning, and the program keeps its value', () => {
    const source = 'let a = 0; match 1 { 1 => a = 2 }; a';
    expect(codes(source)).toEqual([CODE]);
    expect(run(source).value).toBe(0);
  });

  test('the warning names the equation and the two ways to write it', () => {
    const source = 'let a = 0; match 1 { 1 => a = 2 }; a';
    const [diagnostic] = run(source).diagnostics;
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.message).toEqual([CODE, 'a = 2']);
    const text = formatDiagnostics([diagnostic], source);
    expect(text).toContain(CODE);
    expect(text).toContain('do { a = 2 }');
    expect(text).toContain('"scope"');
    expect(text).toContain('"=="');
  });

  test('no fixit, because each repair gives the program a new meaning', () => {
    const source = 'let a = 0; match 1 { 1 => a = 2 }; a';
    expect(run(source).diagnostics[0].fixits).toBeUndefined();
    const assigned = 'let a = 0; match 1 { 1 => do { a = 2 } }; a';
    expect(codes(assigned)).toEqual([]);
    expect(run(assigned).value).toBe(2);
  });

  test('each case body is reported', () => {
    expect(
      codes(`let a = 0
        match 2 {
          1 => a = 1
          2 => a = 2
          _ => 0
        }
        a`)
    ).toEqual([CODE, CODE]);
  });

  test('a variable that a bare assignment declares counts', () => {
    expect(codes('a = 0; match 1 { 1 => a = 2 }; a')).toEqual([CODE]);
  });

  test('a variable of an enclosing block counts', () => {
    expect(codes('do { let a = 0; match 1 { 1 => a = 2 }; a }')).toEqual([
      CODE,
    ]);
  });

  test('a set that holds the equation, the block body of another language', () => {
    expect(codes('let a = 0; match 1 { 1 => { a = 2 } }; a')).toEqual([CODE]);
  });

  test('a parenthesized equation', () => {
    const source = 'let a = 0; match 1 { 1 => (a = 2) }; a';
    expect(codes(source)).toEqual([CODE]);
  });

  test('a branch of a conditional expression', () => {
    expect(codes('let a = 0; (a = 2) if true else 3; a')).toEqual([CODE]);
    expect(codes('let a = 0; 3 if false else a = 2; a')).toEqual([CODE]);
  });

  test('a statement of a loop body, also the last one', () => {
    expect(
      codes('let a = 0; for i in 1..2 { match i { 1 => a = i; _ => 0 } }; a')
    ).toEqual([CODE]);
  });

  test('a `match` in a branch of a statement', () => {
    expect(codes('let a = 0; if true { match 1 { 1 => a = 2 } }; a')).toEqual([
      CODE,
    ]);
  });

  test('a lambda whose only reads are calls in discarded positions', () => {
    const source = 'let a = 0; let f = x => a = 2; f(1); a';
    expect(codes(source)).toEqual([CODE]);
    expect(run(source).value).toBe(0);
    expect(codes('let a = 0; f = x => a = 2; f(1); f(2); a')).toEqual([CODE]);
    expect(
      codes('let a = 0; let f = x => a = 2; for i in 1..2 { f(i) }; a')
    ).toEqual([CODE]);
  });

  test('a function whose last statement is the `match`', () => {
    expect(
      codes(`let a = 0
        function f(x) { match x { 1 => a = 2 } }
        f(1)
        a`)
    ).toEqual([CODE]);
  });

  test('a function that states its effect or its result type', () => {
    expect(
      codes(`let a = 0
        function f(x) scope -> nothing { match x { 1 => a = 2 } }
        f(1)
        a`)
    ).toEqual([CODE]);
    expect(
      codes(`let a = 0
        function f(x) -> boolean { match x { 1 => a = 2; _ => false } }
        f(1)
        a`)
    ).toEqual([CODE]);
  });

  test('a call before the definition of the function', () => {
    expect(
      codes(`let a = 0
        f(1)
        function f(x) { match x { 1 => a = 2 } }
        a`)
    ).toEqual([CODE]);
  });
});

describe('a body with no warning', () => {
  test.each([
    // The assignment that was meant.
    'let a = 0; match 1 { 1 => do { a = 2 } }; a',
    'let a = 0; if true { a = 2 }; a',
    // The explicit spelling of the comparison.
    'let a = 0; match 1 { 1 => a == 2 }; a',
    'let a = 0; let f = x => a == 2; f(1); a',
    // The value of the body is read.
    'let a = 0; let r = match 1 { 1 => a = 2 }; r',
    'let a = 0; a = 1; let r = 3 if false else a = 1; r',
    'let a = 0; print(match 1 { 1 => a = 2 }); a',
    'let a = 0; [match 1 { 1 => a = 2 }]',
    // The last statement of the program is the result for the host.
    'let a = 0; match 1 { 1 => a = 2 }',
    'let a = 0; let f = x => a = 2; f(1)',
    // A lambda that is passed on, or read in another way.
    'let a = 0; map(x => a = x, [1, 2]); a',
    'let a = 0; filter([1, 2], x => a = x)',
    'let a = 0; let p = x => a = 2; map(p, [1]); a',
    'let a = 0; let p = x => a = 2; let r = p(1); r',
    'let a = 0; let p = x => a = 2; p(1); let r = p(2); r',
    // No read in this program: the host or a later unit can read the name.
    'let a = 0; let p = x => a = 2',
    'let a = 0; function f(x) { match x { 1 => a = 2 } }; a',
    // A recursive call in the last position of the function counts as a read.
    'let a = 0; function f(x) { match x { 0 => a = 2; _ => f(x - 1) } }; f(1); a',
    // A free name is an unknown of the equation.
    'match 1 { 1 => b = 2 }; 3',
    'let f = x => b = 2; f(1); 3',
    // A use before the `let` binds outward: the name is free there.
    'match 1 { 1 => a = 2 }; let a = 0; a',
    // A constant cannot be assigned.
    'const a = 0; match 1 { 1 => a = 2 }; a',
    // A parameter or a pattern variable of the body itself.
    'let f = x => x = 2; f(1); 3',
    'match 1 { x => x = 2 }; 3',
    // A left side that is not a name.
    'let a = 0; match 1 { 1 => a + 1 = 2 }; a',
    // Not the whole body.
    'let a = 0; match 1 { 1 => (a = 2) && true }; a',
    'let a = 0; match 1 { 1 => [a = 2] }; a',
    'let a = 0; match 1 { 1 => { a = 2, a = 3 } }; a',
    // A guard and a condition compare by design.
    'let a = 0; match 1 { 1 if a = 2 => 3; _ => 4 }; a',
    'let a = 0; if a = 2 { 1 }; a',
  ])('%s', (source) => {
    expect(codes(source)).toEqual([]);
  });
});
