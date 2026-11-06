import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// An untyped `let` whose name is also a library name (`i`, `e`, `pi`) makes
// a local that shadows the library name, at run time and in the static check.
// The check read `i` as the imaginary unit after `let i = 1` and reported a
// type error that the run does not have (CE-831).

const codes = (source: string, ce = new ComputeEngine()) =>
  checkEpsil(ce, source).diagnostics.map((d) => d.message[0]);

describe('a `let` that shadows a library name, in the static check', () => {
  test('`let i = 1` makes `i` an integer for the later statements', () => {
    const source = 'let i = 1\nlet y: integer = i\ny';
    expect(codes(source)).toEqual([]);
    const run = executeEpsil(new ComputeEngine(), source);
    expect(run.diagnostics).toEqual([]);
    expect(run.value.toString()).toBe('1');
  });

  test('a loop with `i` as the position of an element assignment', () => {
    const source =
      'let xs = [0, 0, 0]\nlet i = 1\nwhile i <= 3 { xs[i] = 10 * i\ni = i + 1 }\nxs';
    expect(codes(source)).toEqual([]);
    expect(executeEpsil(new ComputeEngine(), source).value.toString()).toBe(
      '[10,20,30]'
    );
  });

  test('`e` and `pi` are shadowed the same way', () => {
    expect(codes('let e = 3\nlet y: integer = e + 1\ny')).toEqual([]);
    expect(codes('let pi = 3\nlet y: integer = pi\ny')).toEqual([]);
  });

  test('the type of the local is checked', () => {
    expect(codes('let i = "a"\nlet y: integer = i\ny')).toEqual([
      'static-type-error',
    ]);
  });

  test('with no `let`, `i` is still the imaginary unit', () => {
    expect(codes('let y: integer = i\ny')).toEqual(['static-type-error']);
    expect(executeEpsil(new ComputeEngine(), 'let z = i\nz^2').value.toString()).toBe(
      '-1'
    );
  });

  test('the check does not change `i` on the engine', () => {
    const ce = new ComputeEngine();
    expect(codes('let i = 1\ni + 1', ce)).toEqual([]);
    expect(ce.box('i').json).toEqual(['Complex', 0, 1]);
  });
});
