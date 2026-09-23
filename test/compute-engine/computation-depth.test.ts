import { asComputation, runWhenIdle } from '../../src/common/computation-depth';

//
// `runWhenIdle` runs a callback at once when no computation is running, and
// otherwise when the outermost `asComputation` ends. The lifecycle uses it to
// advance the type caches after a value-type inference
// (`engine-configuration-lifecycle.ts`).
//

describe('runWhenIdle', () => {
  test('runs at once outside a computation', () => {
    const log: string[] = [];
    runWhenIdle(() => log.push('now'));
    expect(log).toEqual(['now']);
  });

  test('waits for the outermost computation to end', () => {
    const log: string[] = [];
    asComputation(() => {
      asComputation(() => {
        runWhenIdle(() => log.push('idle'));
        log.push('inner');
      });
      log.push('outer');
    });
    expect(log).toEqual(['inner', 'outer', 'idle']);
  });

  test('runs after a computation that throws', () => {
    const log: string[] = [];
    expect(() =>
      asComputation(() => {
        runWhenIdle(() => log.push('idle'));
        throw new Error('fails');
      })
    ).toThrow('fails');
    expect(log).toEqual(['idle']);
  });

  test('a callback that throws does not stop the others', () => {
    const log: string[] = [];
    expect(() =>
      asComputation(() => {
        runWhenIdle(() => {
          throw new Error('first');
        });
        runWhenIdle(() => log.push('second'));
      })
    ).toThrow('first');
    expect(log).toEqual(['second']);
    // The queue is empty again.
    runWhenIdle(() => log.push('later'));
    expect(log).toEqual(['second', 'later']);
  });
});
