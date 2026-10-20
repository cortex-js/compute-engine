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
