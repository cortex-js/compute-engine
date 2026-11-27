import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// `checkEpsil` reports the diagnostics that `executeEpsil` reports before it
// runs a statement, and changes nothing on the engine.

const codes = (source: string, ce = new ComputeEngine()) =>
  checkEpsil(ce, source).diagnostics.map((d) => d.message[0]);

describe('checkEpsil', () => {
  test('a static type error and a redeclaration are reported', () => {
    expect(
      codes('let a = 3\nlet b = "x" + 1\nfunction f(x: number) { x + 1 }\nf("no")\nlet a = 4')
    ).toEqual(['static-type-error', 'static-type-error', 'static-type-error']);
  });

  test('a redeclaration retains its specific error code', () => {
    const result = checkEpsil(new ComputeEngine(), 'let a=1;let a=2');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['variable-redeclaration']);
  });

  test('a syntax error is reported, and the static pass is skipped', () => {
    expect(codes('let = (\nlet b = "x" + 1')).toEqual(['symbol-expected']);
  });

  test('a program with no error has no diagnostic', () => {
    expect(codes('let a = 3\nfunction f(x) { x + a }\nf(2)')).toEqual([]);
  });

  test('comparing a nominal array cell with a plain tuple warns at the tuple', () => {
    const tuple = '(255, 255, 255, 255)';
    const source = [
      'type Pixel = tuple<r: integer, g: integer, b: integer, a: integer>',
      `let px = arrayFrom([Pixel${tuple}], "Pixel")`,
      `let eq = (i: integer) => px[i] == ${tuple}`,
      `let ne = (i: integer) => ${tuple} != px[i]`,
      `[eq(1), ne(1), px[1] == Pixel${tuple}, ${tuple} == ${tuple}]`,
    ].join('\n');
    const { diagnostics } = checkEpsil(new ComputeEngine(), source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['nominal-tuple-comparison', 'Pixel', 'false'],
      ['nominal-tuple-comparison', 'Pixel', 'true'],
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe('warning');
      const [start, end] = diagnostic.range;
      expect(source.slice(start, end)).toBe(tuple);
    }
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.diagnostics).toEqual(diagnostics);
    expect(result.value.json).toEqual([
      'List',
      'False',
      'True',
      'True',
      'True',
    ]);
  });

  test('a structural tuple alias does not warn about the tuple comparison', () => {
    const source =
      'type alias Pair = tuple<integer, integer>\nfunction eq(p: Pair) { p == (1, 2) }\neq((1, 2))';
    expect(codes(source)).toEqual([]);
  });

  test('the check assigns no value, defines no function and declares no type', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = checkEpsil(
      ce,
      'let a = 3\nfunction f(x) { x + 1 }\ntype alias Pair = tuple<number, number>\nlet p: Pair = (1, 2)'
    );
    expect(diagnostics).toEqual([]);
    expect(ce.box('a').evaluate().toString()).toBe('a');
    expect(ce.box('f').type.toString()).toBe('unknown');
    expect(ce._typeResolver.names).not.toContain('Pair');
    // The program then runs on the same engine as if it had not been checked.
    const { value, diagnostics: run } = executeEpsil(ce, 'let a = 3\nfunction f(x) { x + 1 }\nf(a)');
    expect(run).toEqual([]);
    expect(value.toString()).toBe('4');
  });

  test('a type that the host declared is known to the parse', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type alias Pair = tuple<number, number>');
    expect(codes('let p: Pair = (1, 2)\np', ce)).toEqual([]);
  });

  test('the same diagnostics as executeEpsil reports before it runs', () => {
    const source = 'let b = "x" + 1\nlet a = 1\nlet a = 2';
    const before = codes(source);
    const ran = executeEpsil(new ComputeEngine(), source).diagnostics
      .map((d) => d.message[0])
      .filter((c) => c !== 'runtime-error');
    expect(before).toEqual(ran);
  });

  test('a second implementation of a protocol in the program is reported', () => {
    // The check runs under a batch id of its own, as executeEpsil does, so the
    // second block is a duplicate.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}'
    );
    const block = (r: string) =>
      `type string is Comparable {\n  function compare(self: Self, other: Self) -> string { ${r} }\n}`;
    expect(codes(block('"="'), ce)).toEqual([]);
    expect(
      checkEpsil(ce, `${block('"="')}\n${block('"<"')}`).diagnostics.map((d) =>
        Array.isArray(d.message) ? d.message : []
      )
    ).toContainEqual(expect.arrayContaining(['protocol-implementation-duplicate']));
    // The check installed no implementation: a run of one block is clean.
    expect(executeEpsil(ce, block('"="')).diagnostics).toEqual([]);
  });

  test('an #error directive is a diagnostic', () => {
    expect(codes('#error "stop"\nlet a = 1')).toEqual(['error-directive']);
  });

  // CE-1275: each assignment to an undeclared name is reported, in a block as
  // at the top level, also when two assignments are written the same.
  test('each assignment to an undeclared name is reported at its site', () => {
    const sites = (source: string) =>
      checkEpsil(new ComputeEngine(), source)
        .diagnostics.filter(
          (d) => d.message[3] === 'assignment-to-undeclared-variable'
        )
        .map((d) => source.slice(d.range[0], d.range[1]));
    expect(sites('t = 1\nu = 2\nt = 3')).toEqual(['t = 1', 'u = 2', 't = 3']);
    expect(sites('for k in 1..3 { t = 1; u = 2; t = 3 }')).toEqual([
      't = 1',
      'u = 2',
      't = 3',
    ]);
    expect(sites('while false { t = 1; t = 1 }')).toEqual(['t = 1', 't = 1']);
    const branches = 'do { if true { t = 1 } else { t = 1 }; 0 }';
    expect(
      checkEpsil(new ComputeEngine(), branches).diagnostics.map(
        (d) => d.range[0]
      )
    ).toEqual([15, 30]);
  });
});
