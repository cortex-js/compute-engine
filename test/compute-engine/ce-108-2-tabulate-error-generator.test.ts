import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * CE-108.2. With `w` holding an error value, `Map(w, [1, 2, 3])` evaluates to
 * the error of `w`, but `Tabulate(w, 3)` was a list of three copies of it.
 * `Tabulate` holds its operands, and its generator parameter is typed with
 * the bare `function` on purpose (`effects-call-boundary.test.ts`), so the
 * check of a held callback that holds an error (`heldErrorCallback()`) did
 * not read it. It now does, and `Tabulate(w, 3)` is the error.
 */

const ERROR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

describe('CE-108.2: Tabulate with a generator that holds an error', () => {
  const ce = new ComputeEngine();
  ce.assign('w', ce.box(['Ln', { str: 'a' }]).evaluate());

  test('the box route', () => {
    expect(ce.box(['Tabulate', 'w', 3]).evaluate().toString()).toBe(ERROR);
    expect(ce.box(['Tabulate', 'w', 2, 2]).evaluate().toString()).toBe(ERROR);
    // The same answer as `Map`.
    expect(ce.box(['Map', 'w', ['List', 1, 2, 3]]).evaluate().toString()).toBe(
      ERROR
    );
  });

  test('the parse route', () => {
    expect(
      ce.parse('\\operatorname{Tabulate}(w, 3)').evaluate().toString()
    ).toBe(ERROR);
  });

  test('the function route', () => {
    expect(
      ce
        .function('Tabulate', [ce.symbol('w'), ce.number(3)])
        .evaluate()
        .toString()
    ).toBe(ERROR);
  });

  test('a generator that holds a function still tabulates', () => {
    ce.assign('h', ce.box(['Function', ['Multiply', 'i', 2], 'i']));
    expect(ce.box(['Tabulate', 'h', 3]).evaluate().toString()).toBe('[2,4,6]');
  });

  test('the Epsil route', () => {
    const ce2 = new ComputeEngine();
    const result = executeEpsil(ce2, 'let w = ln("a")\nTabulate(w, 3)');
    expect(result.value?.toString()).toBe(ERROR);
  });
});
