import { ComputeEngine } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A `function` statement (or a `name(params) = body` definition) for a name
// that an earlier top-level `const` declaration bound. The run time refuses
// to add a clause to a constant (`invalid-clause-definition`), and the
// binding keeps its value. The static check (`epsil check`) reports the
// refusal at the `function` statement, as a `static-type-error` that carries
// the engine's error code, with a note on the `const` declaration.
//

const DESCRIPTION = (name: string) =>
  `invalid clause definition — "${name}" is a constant; it cannot be redefined`;

function check(source: string) {
  return checkSource(source).diagnostics.map((d) => ({
    message: d.message,
    at: source.slice(d.range[0], d.range[1]),
    notes: (d.notes ?? []).map((n) => ({
      message: n.message,
      at: source.slice(n.range[0], n.range[1]),
    })),
  }));
}

describe('EPSIL CHECK: A FUNCTION STATEMENT ON A CONST BINDING', () => {
  test('a function statement after a const of a number', () => {
    const source = 'const c = 1\nfunction c(x) { x }\nc';
    expect(check(source)).toEqual([
      {
        message: [
          'static-type-error',
          DESCRIPTION('c'),
          'function c(x) {x}',
          'invalid-clause-definition',
        ],
        at: 'function c(x) { x }',
        notes: [
          { message: '`c` is declared constant here', at: 'const c = 1' },
        ],
      },
    ]);
  });

  test('a definition with `=` after a const of a function literal', () => {
    const source = 'const k = (n) => n\nk(x) = x * 2\nk(3)';
    const d = check(source);
    expect(d.length).toBe(1);
    expect(d[0].message[0]).toBe('static-type-error');
    expect(d[0].message[1]).toBe(DESCRIPTION('k'));
    expect(d[0].message[3]).toBe('invalid-clause-definition');
    expect(d[0].at).toBe('k(x) = x * 2');
    expect(d[0].notes[0].at).toBe('const k = (n) => n');
  });

  test('each refused statement is reported', () => {
    const source = 'const c = 1\nfunction c(x) { x }\nfunction c(x, y) { x }';
    expect(check(source).map((d) => d.at)).toEqual([
      'function c(x) { x }',
      'function c(x, y) { x }',
    ]);
  });

  test('the run time does not report the same problem a second time', () => {
    // As for a top-level re-declaration, the run drops its own report of a
    // refusal that the static check already reported at this statement.
    const source = 'const c = 1\nfunction c(x) { x }\nc';
    const r = executeEpsil(new ComputeEngine(), source);
    expect(r.value.toString()).toBe('1');
    expect(r.diagnostics.map((d) => d.message[0])).toEqual([
      'static-type-error',
    ]);
    const stat = r.diagnostics[0];
    expect(stat.message[1]).toBe(DESCRIPTION('c'));
    expect(stat.message[3]).toBe('invalid-clause-definition');
    expect(source.slice(stat.range[0], stat.range[1])).toBe(
      'function c(x) { x }'
    );
  });
});

describe('EPSIL CHECK: NO REPORT', () => {
  test('a const of another name', () => {
    expect(check('const d = 1\nfunction c(x) { x }\nc(d)')).toEqual([]);
  });

  test('a function statement in a function body shadows the constant', () => {
    const source =
      'const c = 1\nfunction f() {\n  function c(x) { x }\n  c(2)\n}\nf()';
    expect(check(source)).toEqual([]);
    expect(executeEpsil(new ComputeEngine(), source).value.toString()).toBe(
      '2'
    );
  });

  test('a const whose initializer does not match its type binds nothing', () => {
    // The run time refuses the `const`, so the `function` statement is then
    // the first definition of `c`.
    const d = check('const c: string = 1\nfunction c(x) { x }\nc(2)');
    expect(d.map((x) => x.message[3])).toEqual(['incompatible-type']);
  });
});
