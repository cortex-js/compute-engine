import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { assertGroundType } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';

//
// The argument check of a generic function must not give an open type
// variable to the type algebra (`docs/TYPE-SYSTEM.md` §4.2, the ground-type
// invariant).
//
// When an operand is a List or Tuple literal, the argument check of a
// generic function (`validateArguments()`, `validate.ts`) first asks
// `elementIsBareOrGround()` whether the element type of the declared
// parameter is ground or a bare type variable. For a tuple parameter such as
// `tuple<T, U>`, it read the join of the slots (`collectionElementType()`),
// and that join gave the open variables `T` and `U` to `widen()`. The
// production build has no message for this; the development build prints an
// `ASSERTION FAILURE` from `assertGroundType()`. Now each slot is tested by
// itself, and the algebra receives no open variable.
// (ROADMAP CE-704.)
//

/** The messages of the `console.assert` calls that fail while `f` runs. The
 * messages are kept and not printed: the positive control below fails an
 * assertion on purpose. */
function assertFailureMessages(f: () => void): string[] {
  const messages: string[] = [];
  const saved = console.assert;
  console.assert = ((condition: unknown, ...rest: unknown[]) => {
    if (!condition) messages.push(rest.map((x) => String(x)).join(' '));
  }) as typeof console.assert;
  try {
    f();
  } finally {
    console.assert = saved;
  }
  return messages;
}

function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return {
    diagnostics: r.diagnostics.map((d) => d.message),
    value: r.value?.toString(),
    type: r.value?.type?.toString(),
  };
}

describe('the argument check of a generic tuple parameter', () => {
  // The empty arrays below mean something only if the spy can see a failed
  // assertion.
  test('the spy captures a failed assertion (positive control)', () => {
    expect(
      assertFailureMessages(() =>
        assertGroundType('probe', { kind: 'variable', name: 'T' } as Type)
      )
    ).toEqual([expect.stringContaining('open type variable `T`')]);
  });

  test('tuple<T, U> applied to a tuple literal', () => {
    let result: ReturnType<typeof run> | undefined;
    expect(
      assertFailureMessages(() => {
        result = run(
          'function swap(p: tuple<T, U>) -> tuple<U, T> where T, U { (p[2], p[1]) }\nswap((1, "a"))'
        );
      })
    ).toEqual([]);
    expect(result).toMatchObject({
      diagnostics: [],
      value: '("a", 1)',
      type: 'tuple<string, integer>',
    });
  });

  test('tuple<T, U> with a bound applied to a tuple literal', () => {
    let result: ReturnType<typeof run> | undefined;
    expect(
      assertFailureMessages(() => {
        result = run(
          'function first(p: tuple<T, U>) -> T where T: number, U { p[1] }\nfirst((1, "a"))'
        );
      })
    ).toEqual([]);
    expect(result).toMatchObject({ diagnostics: [], value: '1' });
  });

  test('tuple<list<T>, U> applied to a tuple literal', () => {
    let result: ReturnType<typeof run> | undefined;
    expect(
      assertFailureMessages(() => {
        result = run(
          'function second(p: tuple<list<T>, U>) -> U where T, U { p[2] }\nsecond(([1, 2], "a"))'
        );
      })
    ).toEqual([]);
    expect(result).toMatchObject({ diagnostics: [], value: '"a"' });
  });

  test('tuple<T, integer> applied to a tuple literal', () => {
    let result: ReturnType<typeof run> | undefined;
    expect(
      assertFailureMessages(() => {
        result = run(
          'function first(p: tuple<T, integer>) -> T where T { p[1] }\nfirst(("a", 2))'
        );
      })
    ).toEqual([]);
    expect(result).toMatchObject({ diagnostics: [], value: '"a"' });
  });
});
