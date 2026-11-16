import { ComputeEngine } from '../../src/compute-engine';
import { checkSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A `function` statement (or a `name(params) = body` definition) for a name
// that an earlier top-level `const` declaration bound. The later declaration
// is refused as `variable-redeclaration`, and the binding keeps its value.
// The static check (`epsil check`) reports the refusal at the later statement,
// as a `static-type-error` with a note on the first declaration.
//

const DESCRIPTION = (name: string) => `variable redeclaration: ${name}`;

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
          'variable-redeclaration',
        ],
        at: 'function c(x) { x }',
        notes: [
          { message: 'first declared here', at: 'const c = 1' },
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
    expect(d[0].message[3]).toBe('variable-redeclaration');
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
    expect(stat.message[3]).toBe('variable-redeclaration');
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
});

describe('EPSIL CHECK: A REFUSED FIRST DECLARATION', () => {
  test('a bad initializer does not free the name for a second declaration', () => {
    const source = 'const c: string = 1\nfunction c(x) { x }\nc(2)';
    const expectedCodes = ['variable-redeclaration', 'incompatible-type'];
    expect(check(source).map((d) => d.message[3])).toEqual(expectedCodes);
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.diagnostics.map((d) => d.message[3])).toEqual(expectedCodes);
    // Neither the invalid initializer nor the refused function installs a value.
    expect(result.value.json).toEqual(['c', 2]);
  });
});
