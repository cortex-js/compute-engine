import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The top-level block of a program declares all its names before it
// canonicalizes its statements. A function body that assigns a name that
// only a LATER statement declares makes that name a local of the body, as
// `executeEpsil()` does when it canonicalizes one statement at a time
// (`LATER_DECLARATIONS`, `library/control-structures.ts`). The block reads,
// in one pass, the index of the first statement that declares each name.
//
// Each program is evaluated as one block (`ce.box()`), and the value is
// compared with the value of `executeEpsil()`.
//

function bothRoutes(source: string): { block: unknown; epsil: unknown } {
  const block = new ComputeEngine()
    .box(parseEpsil(source)[0] as never)
    .evaluate().json;
  const epsil = executeEpsil(new ComputeEngine(), source).value.json;
  return { block, epsil };
}

describe('A PROGRAM READ AS ONE BLOCK: NAMES DECLARED LATER', () => {
  test('one statement declares two names', () => {
    const source =
      'function g(k) { t = k + 1; u = k; [t, u] }\n' +
      'let (t, u) = (0, 5)\n[g(1), g(2), t, u]';
    const value = ['List', ['List', 2, 1], ['List', 3, 2], 0, 5];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });

  test('names declared at different statements', () => {
    const source =
      'function g(k) { t = k + 1; t }\nlet t = 0\n' +
      'function h(k) { v = k; v }\nlet v = 9\n[g(1), h(2), t, v]';
    const value = ['List', 2, 2, 0, 9];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });

  test('a function after the declaration writes the declared name', () => {
    const source =
      'function g(k) { t = k + 1; t }\nlet t = 0\n' +
      'function h(k) scope { t = k; t }\n[g(1), h(4), t]';
    const value = ['List', 2, 4, 4];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });
});

//
// A `let` of a library constant name (`i`, `e`, `Pi`, …) that a later
// statement of the top-level block declares is not hoisted: the block
// declares the name, and makes it shadow the constant, when it reaches that
// statement. A function defined before it reads the constant, as on the
// `executeEpsil()` route. The `let` of another name is hoisted as before.
//

describe('A PROGRAM READ AS ONE BLOCK: A LIBRARY CONSTANT DECLARED LATER', () => {
  test('a function defined before the `let` reads the constant', () => {
    const source = 'function g() { i^2 }\nlet i = 2\n[g(), i^2]';
    const value = ['List', -1, 4];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });

  test('a function defined after the `let` reads the local', () => {
    const source = 'let i = 2\nfunction g() { i^2 }\n[g(), i^2]';
    const value = ['List', 4, 4];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });

  test('a statement before the `let` reads the constant', () => {
    const source = 'let a = i^2\nlet i = 2\n[a, i^2]';
    const value = ['List', -1, 4];
    expect(bothRoutes(source)).toEqual({ block: value, epsil: value });
  });

  test('a name that is not a constant is read from the later `let`', () => {
    const source = 'function g() { t + 1 }\nlet t = 5\ng()';
    expect(bothRoutes(source)).toEqual({ block: 6, epsil: 6 });
  });

  test('a host block of MathJSON', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Block',
        ['Assign', 'h', ['Function', ['Power', 'i', 2]]],
        ['Declare', 'i', 'integer', 2],
        ['List', ['h'], ['Power', 'i', 2]],
      ] as never)
      .evaluate().json;
    expect(value).toEqual(['List', -1, 4]);
  });
});
