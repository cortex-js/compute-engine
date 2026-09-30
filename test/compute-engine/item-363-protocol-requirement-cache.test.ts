/**
 * A protocol member call keeps its parsed requirement — cortex-js/compute-engine#363.
 *
 * A requirement's signature names `Self`, which the type parser's shared cache
 * never admits, so every dispatched call used to parse it again. The parsed
 * signature is now kept per protocol, member and `Self`, and dropped when a
 * declaration advances the engine's `any` version. Every test below makes the
 * same call more than once: a cached requirement must answer exactly what a
 * fresh parse answers, for every receiver type, and a declaration made after
 * a call must be seen by the next one.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function run(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

function engineFor(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  expect(run(ce, source)).toEqual([]);
  return ce;
}

function call(ce: ComputeEngine, member: string, ...args: unknown[]): string {
  return ce
    .box([member, ...args] as any)
    .evaluate()
    .toString();
}

function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

const DESCRIBABLE = `protocol Describable {
  function describe(self: Self) -> string
}
type number is Describable {
  function describe(self: Self) -> string { "number" }
}
type integer is Describable {
  function describe(self: Self) -> string { "integer" }
}`;

const COMPARABLE = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
type real is Comparable {
  function compare(self: Self, other: Self) -> string { "real" }
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "string" }
}`;

describe('A cached requirement answers what a fresh parse answers', () => {
  // Interleaved receivers: each call's `Self` differs from the previous one,
  // so a requirement cached for one receiver type must not serve another.
  const describeCalls: [unknown, string][] = [
    [3, '"integer"'],
    [3.5, '"number"'],
    [3, '"integer"'],
    [['Rational', 1, 2], '"number"'],
    [3.5, '"number"'],
  ];
  test('describe(x) over interleaved receivers = the most specific conformance', () => {
    const ce = engineFor(DESCRIBABLE);
    for (const [arg, expected] of describeCalls)
      expect(call(ce, 'describe', arg)).toBe(expected);
  });

  const compareCalls: [unknown, unknown, string][] = [
    [3, 4, '"real"'],
    [{ str: 'a' }, { str: 'b' }, '"string"'],
    [['Rational', 1, 2], ['Rational', 3, 2], '"real"'],
    [3, 4, '"real"'],
    [{ str: 'a' }, { str: 'b' }, '"string"'],
  ];
  test('compare(x, y) with Self in two positions, repeated = the same conformance', () => {
    const ce = engineFor(COMPARABLE);
    for (const [x, y, expected] of compareCalls)
      expect(call(ce, 'compare', x, y)).toBe(expected);
  });

  test('a rejected call is rejected the same way every time', () => {
    const ce = engineFor(COMPARABLE);
    const first = call(ce, 'compare', 3, { str: 'b' });
    expect(first).toContain('Error');
    for (let i = 0; i < 3; i++)
      expect(call(ce, 'compare', 3, { str: 'b' })).toBe(first);
  });
});

describe('A declaration made after a call is seen by the next call', () => {
  test('a conformance added after a call serves the next call', () => {
    const ce = engineFor(`protocol Describable {
  function describe(self: Self) -> string
}
type string is Describable {
  function describe(self: Self) -> string { "string" }
}`);
    expect(errorCode(call(ce, 'describe', 3))).toBe(
      'protocol-implementation-missing'
    );
    expect(
      run(
        ce,
        `type integer is Describable {
  function describe(self: Self) -> string { "integer" }
}`
      )
    ).toEqual([]);
    expect(call(ce, 'describe', 3)).toBe('"integer"');
  });
});

describe('The cache stays bounded', () => {
  test('describe over many distinct receiver types keeps answering', () => {
    // Each list length is a distinct `Self` (`list<integer^n>`), more of them
    // than the cache keeps for one protocol.
    const ce = engineFor(`protocol Sized {
  function size(self: Self) -> integer
}
type list<integer> is Sized {
  function size(self: Self) -> integer { Length(self) }
}`);
    for (let n = 1; n <= 300; n++) {
      const xs = ['List', ...Array.from({ length: n }, (_, i) => i)];
      expect(call(ce, 'size', xs)).toBe(String(n));
    }
  });
});
