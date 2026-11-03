import { ComputeEngine } from '../../src/compute-engine';

//
// When the canonical handler of a lazy operator gives up (returns `null`)
// on a call with all its required operands, the call goes through the
// signature validation, as a call of an operator with no handler does, and
// is canonical: an operand left over is `Error("unexpected-argument")`.
// Before, the call was kept as written, not canonical, under a canonical
// parent. `1 + Tail(xs, 2)` then reached `toNumericValue()`, whose
// `console.assert` requires a canonical expression, and printed
// "Assertion failed".
//
// When the call has a number of operands that the signature admits, the
// handler refused an operand: the operands are canonicalized and checked
// against the signature, so the refused operand is a typed error
// (`Interval("'bad'", 1)`), and the invalid call has no collection facets.
//
// A handler that throws, and an operator with an inferred signature, still
// keep the call as written.
//

const F = ['Function', ['Multiply', 2, 'x'], 'x'];

let failedAssertions: string[] = [];
const originalAssert = console.assert;
beforeEach(() => {
  failedAssertions = [];
  console.assert = (condition?: boolean, ...data: unknown[]) => {
    if (!condition) failedAssertions.push(data.map(String).join(' '));
  };
});
afterEach(() => {
  console.assert = originalAssert;
});

describe('A LAZY HANDLER THAT GIVES UP', () => {
  const extraOperand: Array<[unknown[], string]> = [
    [['Tail', 'xs', 2], 'Error("unexpected-argument", "2")'],
    [['Head', 'xs', 'Sin'], 'Error("unexpected-argument", "sin")'],
  ];
  for (const [call, expected] of extraOperand) {
    test(`\`1 + ${call[0]}(…)\` with an operand left over is canonical and invalid`, () => {
      const ce = new ComputeEngine();
      const e = ce.box(['Add', 1, call] as Parameters<typeof ce.box>[0]);
      const inner = e.ops!.find((x) => x.operator === call[0])!;
      expect(inner.isCanonical).toBe(true);
      expect(inner.isValid).toBe(false);
      expect(e.evaluate().toString()).toBe(expected);
      expect(e.N().toString()).toBe(expected);
      e.simplify();
      expect(failedAssertions).toEqual([]);
    });
  }

  test('in the body of a function: `Apply(xs ↦ 1 + Tail(xs, 2), [1, 4])`', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box([
        'Apply',
        ['Function', ['Add', 1, ['Tail', 'xs', 2]], 'xs'],
        ['List', 1, 4],
      ])
      .evaluate();
    expect(v.toString()).toBe('Error("unexpected-argument", "2")');
    expect(failedAssertions).toEqual([]);
  });

  // A handler that refused an operand with a valid operand count: the call
  // is the operator over its operands checked against the signature, so the
  // refused operand is a typed error, and the call has no count.
  test('`Interval("bad", 1)` is canonical and invalid, with no count', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Interval', "'bad'", 1]);
    expect(e.isCanonical).toBe(true);
    expect(e.isValid).toBe(false);
    expect(e.count).toBeUndefined();
    expect(e.isCollection).toBe(false);
    // The call is inert; an enclosing operator reads the error operand.
    expect(e.evaluate()).toBe(e);
    expect(ce.box(['Add', 1, ['Interval', "'bad'", 1]]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"), "bad")'
    );
    expect(e.toString()).toBe(
      'Interval(Error(ErrorCode("incompatible-type", "number", "string"), "bad"), 1)'
    );
  });

  const refusedOperand: Array<[unknown[], string]> = [
    [
      ['Interval', 'Sin', 'xs'],
      'Interval(Error(ErrorCode("incompatible-type", "number", "(complex | quantity) -> number"), sin), "xs")',
    ],
    [
      ['Series', 'xs', F],
      'Series("xs", Error(ErrorCode("incompatible-type", "symbol", "(x: unknown) -> number"), (x) => 2x))',
    ],
    [
      ['ContourIntegrate', 'xs', 0, F],
      'ContourIntegrate("xs", Error(ErrorCode("incompatible-type", "symbol", "0"), 0), (x) => 2x)',
    ],
  ];
  for (const [call, expected] of refusedOperand) {
    test(`\`1 + ${call[0]}(…)\` with a refused operand is canonical and invalid`, () => {
      const ce = new ComputeEngine();
      const e = ce.box(['Add', 1, call] as Parameters<typeof ce.box>[0]);
      const inner = e.ops!.find((x) => x.operator === call[0])!;
      expect(inner.isCanonical).toBe(true);
      expect(inner.isValid).toBe(false);
      expect(inner.toString()).toBe(expected);
      e.evaluate();
      e.N();
      expect(failedAssertions).toEqual([]);
    });
  }
  // The check refuses no operand: `Series(1)` declines because it has no
  // variable, and the call is canonical and inert.
  test('`1 + Series(1)` is canonical and inert', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', 1, ['Series', 1]]);
    const inner = e.ops!.find((x) => x.operator === 'Series')!;
    expect(inner.isCanonical).toBe(true);
    expect(e.evaluate().toString()).toBe('1 + Series(1)');
    e.N();
    expect(failedAssertions).toEqual([]);
  });

  test('a declining `Limit` and `Integrate` inside a sum are canonical and invalid', () => {
    const ce = new ComputeEngine();
    for (const call of [
      ['Limit', "'s'", 0],
      ['Integrate', "'s'", 'x'],
    ]) {
      const e = ce.box(['Add', 1, call] as Parameters<typeof ce.box>[0]);
      const inner = e.ops!.find((x) => x.operator === call[0])!;
      expect(inner.isCanonical).toBe(true);
      expect(inner.isValid).toBe(false);
      expect(e.evaluate().toString()).toBe(
        'Error(ErrorCode("incompatible-type", "function", "string"), "s")'
      );
      e.N();
    }
    expect(failedAssertions).toEqual([]);
  });

  // When `ce.strict` is false, the signature validation skips the type
  // checks, so no operand is refused, and the call is canonical and inert.
  test('with `ce.strict` false, `1 + Interval("bad", 1)` and `1 + Interval(Sin, xs)` are canonical', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    for (const call of [
      ['Interval', "'bad'", 1],
      ['Interval', 'Sin', 'xs'],
    ]) {
      const e = ce.box(['Add', 1, call] as Parameters<typeof ce.box>[0]);
      const inner = e.ops!.find((x) => x.operator === 'Interval')!;
      expect(inner.isCanonical).toBe(true);
      e.evaluate();
      e.N();
    }
    expect(failedAssertions).toEqual([]);
  });

  test('in strict mode the refused `Interval` in a sum has no count', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', 1, ['Interval', "'bad'", 1]]);
    const inner = e.ops!.find((x) => x.operator === 'Interval')!;
    expect(inner.isCanonical).toBe(true);
    expect(inner.isValid).toBe(false);
    expect(inner.count).toBeUndefined();
  });
  test('a top-level `Sequence` operand supplies its elements: `1 + Interval(Sequence(1, 2))`', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', 1, ['Interval', ['Sequence', 1, 2]]]);
    const inner = e.ops!.find((x) => x.operator === 'Interval')!;
    expect(inner.isCanonical).toBe(true);
    expect(inner.toString()).toBe('Interval(1, 2)');
    expect(inner.ops!.some((x) => x.operator === 'Error')).toBe(false);
    e.evaluate();
    expect(failedAssertions).toEqual([]);
  });

  // With `ce.strict` false, a declined call is inert: its `evaluate`
  // handler is not run on operands that the canonical handler refused.
  for (const call of [
    ['Integrate', "'s'", 'x'],
    ['Limit', "'s'", 'x', 1],
  ]) {
    test(`with \`ce.strict\` false, \`${call[0]}("s", …)\` evaluates to itself`, async () => {
      const ce = new ComputeEngine();
      ce.strict = false;
      const e = ce.box(call as Parameters<typeof ce.box>[0]);
      expect(e.isCanonical).toBe(true);
      expect(e.evaluate()).toBe(e);
      expect(e.N()).toBe(e);
      expect(await e.evaluateAsync()).toBe(e);
      expect(failedAssertions).toEqual([]);
    });
  }
});
