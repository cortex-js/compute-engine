import { ComputeEngine } from '../../src/compute-engine';

// An operator declared with only an `evaluateAsync` handler, applied in a
// value of a dictionary: `evaluateAsync()` of the dictionary awaits it, as it
// does for an element of a list or a tuple.

function withAsyncOnly(): ComputeEngine & { calls: number } {
  const ce = new ComputeEngine() as ComputeEngine & { calls: number };
  ce.calls = 0;
  ce.declare('Next', {
    signature: '() -> integer',
    pure: false,
    evaluateAsync: async () => {
      ce.calls += 1;
      return ce.number(ce.calls);
    },
  } as never);
  ce.declare('Times10', {
    signature: '(integer) -> integer',
    evaluateAsync: async ([x]) => ce.number((x.re ?? 0) * 10),
  } as never);
  return ce;
}

describe('an asynchronous-only operator in a value of a dictionary', () => {
  test('the value is awaited', async () => {
    const ce = withAsyncOnly();
    const value = await ce
      .box(['Dictionary', ['Tuple', { str: 'a' }, ['Next']]])
      .evaluateAsync();
    expect(value.toString()).toBe('{"a" -> 1}');
    expect(ce.calls).toBe(1);
  });

  test('the values are awaited in the order of the entries', async () => {
    const ce = withAsyncOnly();
    const value = await ce
      .box([
        'Dictionary',
        ['Tuple', { str: 'a' }, ['Next']],
        ['Tuple', { str: 'b' }, ['Next']],
      ])
      .evaluateAsync();
    expect(value.toString()).toBe('{"a" -> 1, "b" -> 2}');
  });

  test('in a nested dictionary and in a list', async () => {
    const ce = withAsyncOnly();
    expect(
      (
        await ce
          .box([
            'Dictionary',
            [
              'Tuple',
              { str: 'a' },
              ['Dictionary', ['Tuple', { str: 'b' }, ['Times10', 2]]],
            ],
          ])
          .evaluateAsync()
      ).toString()
    ).toBe('{"a" -> {"b" -> 20}}');
    expect(
      (
        await ce
          .box([
            'List',
            ['Dictionary', ['Tuple', { str: 'a' }, ['Times10', 4]]],
          ])
          .evaluateAsync()
      ).toString()
    ).toBe('[{"a" -> 40}]');
  });

  test('the other values get the options of the evaluation', async () => {
    const ce = withAsyncOnly();
    const value = await ce
      .box([
        'Dictionary',
        ['Tuple', { str: 'a' }, ['Divide', 1, 4]],
        ['Tuple', { str: 'b' }, ['Times10', 1]],
      ])
      .evaluateAsync({ numericApproximation: true });
    expect(value.toString()).toBe('{"a" -> 0.25, "b" -> 10}');
  });

  test('a value after the first await keeps the transient precision', async () => {
    const ce = withAsyncOnly();
    const dict = ce.box([
      'Dictionary',
      ['Tuple', { str: 'a' }, ['Times10', 1]],
      ['Tuple', { str: 'b' }, 'Pi'],
    ]);
    const value = await (
      ce as unknown as {
        _withTransientPrecision<T>(p: number, fn: () => T): T;
      }
    )._withTransientPrecision(50, () =>
      dict.evaluateAsync({ numericApproximation: true })
    );
    const pi = value.toMathJson({ shorthands: [] }) as unknown;
    expect(JSON.stringify(pi)).toContain('3.14159265358979323846264338327950');
  });

  test('a dictionary with no such value is unchanged', async () => {
    const ce = withAsyncOnly();
    const value = await ce
      .box(['Dictionary', ['Tuple', { str: 'a' }, ['Sqrt', 2]]])
      .evaluateAsync();
    expect(value.toString()).toBe('{"a" -> sqrt(2)}');
  });
});
