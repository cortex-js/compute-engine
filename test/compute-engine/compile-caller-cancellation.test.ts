import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { CancellationError } from '../../src/common/interruptible';

describe('a caller timeout in the evaluation of a derivative', () => {
  // An outer check of the compilation also catches this timeout, so these
  // pin the end-to-end behavior; the closed-form derivative's own catch
  // (`derivative-closed-form.ts`) is a second line of defense.
  const ce = new ComputeEngine();
  ce.declare('Slow', {
    signature: '(number) -> number',
    evaluate: () => {
      throw new CancellationError({ cause: 'timeout', message: 'late' });
    },
  });

  // The compiler declines `ND` and `Derivative` without evaluating them.
  test.each([
    ['D', ['D', ['Slow', 'x'], 'x']],
  ] as const)('%s', (_, json) => {
    let error: unknown;
    try {
      ce.withTimeLimit({ ms: 0, label: 'caller' }, () =>
        compile(ce.box(json as any))
      );
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ cause: 'timeout', attribution: 'caller' });
  });
});
