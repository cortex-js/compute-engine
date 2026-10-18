import { ComputeEngine } from '../../src/compute-engine';

// Under `.N()`, a parameter of a user function is bound to the float of the
// argument, and the activation records the written argument
// (`exact-argument-source.ts`): a function that jumps (`Floor`, a
// comparison) evaluated with the numeric request reads the exact argument
// again when the float is near the jump. A body of ONE statement took the
// request, but a body of several statements (a `Block`) ran exactly, so the
// jump read the float: `f((25! − 1)/24!).N()` for
// `f := x ↦ Block(z := 1, Floor(x))` was 25, where the correct value is 24.
// The LAST statement of such a body now takes the numeric request; the
// statements before it still run exactly, so a value a later statement reads
// (`a := √2; a^2`) is not rounded on the way (user decision 2026-10-18).

const Q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];
const QL = '\\frac{25!-1}{24!}';
const H = ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 10000]];

/** An engine where `f` is `x ↦ Block(…statements)`, built on the box route. */
function boxed(...statements: unknown[]): ComputeEngine {
  const ce = new ComputeEngine();
  const result = ce
    .box(['Assign', 'f', ['Function', ['Block', ...statements], 'x']] as any)
    .evaluate();
  expect(result.operator).not.toBe('Error');
  return ce;
}

/** An engine where `f` is defined by parsing `f(x) := (…)`. */
function parsed(body: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.parse(`f(x) := (${body})`).evaluate();
  return ce;
}

const n = (ce: ComputeEngine, x: unknown = Q): string =>
  ce
    .box(['f', x] as any)
    .N()
    .toString();

const nAsync = async (ce: ComputeEngine, x: unknown = Q): Promise<string> =>
  (
    await ce.box(['f', x] as any).evaluateAsync({ numericApproximation: true })
  ).toString();

const exact = (ce: ComputeEngine, x: unknown = Q): string =>
  ce
    .box(['f', x] as any)
    .evaluate()
    .toString();

describe('the last statement of a user-function body under .N()', () => {
  test('a Floor in the last statement, box route', async () => {
    const ce = boxed(['Declare', 'z'], ['Assign', 'z', 1], ['Floor', 'x']);
    expect(n(ce)).toBe('24');
    expect(await nAsync(ce)).toBe('24');
    expect(exact(ce)).toBe('24');
    // A float argument stays a float.
    expect(n(ce, 1.7)).toBe('1');
  });

  test('a Floor in the last statement, parse route', async () => {
    const ce = parsed('z := 1; \\lfloor x \\rfloor');
    expect(n(ce)).toBe('24');
    expect(await nAsync(ce)).toBe('24');
    expect(ce.parse(`f(${QL})`).N().toString()).toBe('24');
    expect(exact(ce)).toBe('24');
  });

  test('a comparison in the last statement', async () => {
    const ce = boxed(['Declare', 'z'], ['Assign', 'z', 1], ['Less', 'x', 25]);
    expect(n(ce)).toBe('"True"');
    expect(await nAsync(ce)).toBe('"True"');
    const p = parsed('z := 1; x < 25');
    expect(n(p)).toBe('"True"');
    expect(await nAsync(p)).toBe('"True"');
  });

  test('a Return as the last statement', async () => {
    const ce = boxed(
      ['Declare', 'z'],
      ['Assign', 'z', 1],
      ['Return', ['Floor', 'x']]
    );
    expect(n(ce)).toBe('24');
    expect(await nAsync(ce)).toBe('24');
  });

  test('an If as the last statement', async () => {
    const ce = boxed(
      ['Declare', 'z'],
      ['Assign', 'z', 1],
      ['If', ['Greater', 'x', 1], ['Floor', 'x'], 0]
    );
    expect(n(ce)).toBe('24');
    expect(await nAsync(ce)).toBe('24');
    const p = parsed(
      'z := 1; \\text{if } x > 1 \\text{ then } \\lfloor x \\rfloor \\text{ else } 0'
    );
    expect(n(p)).toBe(n(ce));
  });

  test('a numeric request does not leave an exact memo entry behind', () => {
    const ce = boxed(
      ['Declare', 'z'],
      ['Assign', 'z', 1],
      ['Multiply', 2, 'x']
    );
    const numeric = n(ce, ['Sqrt', 2]);
    expect(numeric).toMatch(/^2\.828/);
    // The exact request after the numeric one is answered exactly.
    expect(exact(ce, ['Sqrt', 2])).toBe('2sqrt(2)');
    expect(n(ce, ['Sqrt', 2])).toBe(numeric);
  });
});

describe('the statements before the last one stay exact', () => {
  test('a := √2; a^2', async () => {
    const ce = boxed(
      ['Declare', 'a'],
      ['Assign', 'a', ['Sqrt', 2]],
      ['Power', 'a', 2]
    );
    expect(n(ce, 3)).toBe('2');
    expect(await nAsync(ce, 3)).toBe('2');
    const p = parsed('a := \\sqrt{2}; a^2');
    expect(n(p, 3)).toBe('2');
    expect(await nAsync(p, 3)).toBe('2');
  });

  test('a value computed by an earlier statement', async () => {
    const ce = parsed('a := \\sqrt{3}; b := a^2; b - 3');
    expect(n(ce, 3)).toBe('0');
    expect(await nAsync(ce, 3)).toBe('0');
  });

  test('a block evaluated with the numeric request at the top level', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('(b := \\sqrt{2}; b^2)').N().toString()).toBe('2');
    expect(ce.parse(`(c := 1; \\lfloor ${QL} \\rfloor)`).N().toString()).toBe(
      '24'
    );
  });

  test('a float argument of a block body stays cheap', () => {
    const ce = boxed(['Declare', 'z'], ['Assign', 'z', 1], ['Floor', 'x']);
    const start = Date.now();
    expect(n(ce, H)).toBe('9');
    // The argument is approximated once; summing 10000 exact rationals
    // took about 27 s.
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('a stored expression read under a shadow, under a numeric request', () => {
  // `a := x + 1` is stored while `x` has no value, so `x` stays a name in
  // the stored value, and it means the global `x` (100), not the block's
  // own `x` (7). The value is `101` on every route; the numeric read of `a`
  // inside an arithmetic operation read `x` by name and gave `8`.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'a', ['Add', 'x', 1]]).evaluate();
    ce.box(['Assign', 'x', 100]).evaluate();
    return ce;
  }
  const block = (ce: ComputeEngine, op: unknown) =>
    ce.box([
      'Block',
      ['Declare', 'x', "'real'"],
      ['Assign', 'x', 7],
      op,
    ] as any);

  test('synchronous', () => {
    const ce = engine();
    expect(block(ce, ['N', 'a']).evaluate().toString()).toBe('101');
    expect(
      block(ce, ['Add', 'a', 5])
        .evaluate({ numericApproximation: true })
        .toString()
    ).toBe('106');
    expect(block(ce, ['Add', 'a', 5]).evaluate().toString()).toBe('106');
  });

  test('asynchronous', async () => {
    const ce = engine();
    expect((await block(ce, ['N', 'a']).evaluateAsync()).toString()).toBe(
      '101'
    );
    expect(
      (
        await block(ce, ['Add', 'a', 5]).evaluateAsync({
          numericApproximation: true,
        })
      ).toString()
    ).toBe('106');
  });
});
