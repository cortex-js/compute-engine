import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { CancellationError } from '../../src/common/interruptible';

//
// A CALLER'S CANCELLATION THROUGH THE CATCH BLOCKS OF THE COMPILER
//
// Some steps of a compilation catch any error and continue with a smaller
// result: the reference analysis that runs the compile handlers of custom
// operators as probes, the constant fold of a term, a closed-form
// derivative. A timeout of the caller's `withTimeLimit` span must go
// through them (`docs/TIMEOUT-MODEL.md` §2), not become a quiet decline.
//

describe('a caller timeout is not absorbed by the reference analysis', () => {
  test('a compile handler that times out in the analysis probe', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Probe', {
      signature: '(number) -> number',
      // The first call is the compilation itself. A later call is the probe
      // of the reference analysis, which here stands for a handler whose
      // own work reached the expired deadline.
      compile: (args, c) => {
        calls += 1;
        if (calls > 1)
          throw new CancellationError({ cause: 'timeout', message: 'late' });
        return `(${c(args[0])} + 1)`;
      },
    });
    let error: unknown;
    try {
      ce.withTimeLimit({ ms: 0, label: 'caller' }, () =>
        compile(ce.box(['Probe', 'x']))
      );
    } catch (e) {
      error = e;
    }
    expect(calls).toBeGreaterThan(1);
    expect(error).toMatchObject({ cause: 'timeout', attribution: 'caller' });
  });

  test('with no expired deadline, a failing probe is still a quiet decline', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Probe', {
      signature: '(number) -> number',
      compile: (args, c) => {
        calls += 1;
        if (calls > 1) throw new Error('not in the analysis');
        return `(${c(args[0])} + 1)`;
      },
    });
    const result = compile(ce.box(['Probe', 'x']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('(_.x + 1)');
  });
});

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

  test.each([
    ['ND', ['ND', ['Function', ['Slow', 'x'], 'x'], 1]],
    ['D', ['D', ['Slow', 'x'], 'x']],
    ['Derivative', ['Derivative', ['Function', ['Slow', 'x'], 'x']]],
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
