import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const evalStr = (e: any) => ce.box(e).evaluate().toString();

describe('ReplaceAll with a compound left side', () => {
  test('a compound part inside a list', () => {
    expect(
      evalStr(['ReplaceAll', ['List', 'x', ['Power', 'x', 2]], ['Rule', ['Power', 'x', 2], 'y']])
    ).toBe('[x,y]');
  });

  test('a compound part at depth', () => {
    expect(
      evalStr(['ReplaceAll', ['f', ['g', 'x']], ['Rule', ['g', 'x'], 'y']])
    ).toBe('f(y)');
    expect(
      evalStr(['ReplaceAll', ['f', ['h', ['g', 'x']]], ['Rule', ['g', 'x'], 'y']])
    ).toBe('f(h(y))');
  });

  test('a call in a sum', () => {
    expect(
      evalStr(['ReplaceAll', ['Add', ['Sin', 'x'], 1], ['Rule', ['Sin', 'x'], 'y']])
    ).toBe('y + 1');
  });

  test('wildcards capture in the replacement', () => {
    expect(
      evalStr(['ReplaceAll', ['List', ['g', 'a'], ['h', ['g', 'b']]], ['Rule', ['g', '_a'], ['k', '_a']]])
    ).toBe('[k(a),h(k(b))]');
  });

  test('the outer match wins and its replacement is not searched', () => {
    const rules = ['List', ['Rule', ['f', '_'], 1], ['Rule', ['g', 'x'], 2]];
    expect(evalStr(['ReplaceAll', ['f', ['g', 'x']], rules])).toBe('1');
  });

  test('a replacement is not matched again', () => {
    const rule = ['Rule', ['g', '_a'], ['g', ['g', '_a']]];
    expect(evalStr(['ReplaceAll', ['g', 'a'], rule])).toBe('g(g(a))');
    expect(
      evalStr(['ReplaceAll', ['List', ['g', 'a'], ['h', ['g', 'b']]], rule])
    ).toBe('[g(g(a)),h(g(g(b)))]');
  });

  test('one rule does not see the output of another', () => {
    const rules = ['List', ['Rule', ['g', '_a'], ['k', '_a']], ['Rule', ['k', '_a'], ['g', '_a']]];
    expect(
      evalStr(['ReplaceAll', ['List', ['g', 'a'], ['k', 'b']], rules])
    ).toBe('[k(a),g(b)]');
    // `f(2)` only exists after `g(x) -> 2`; the top-down pass never sees it.
    expect(
      evalStr(['ReplaceAll', ['f', ['g', 'x']], ['List', ['Rule', ['g', 'x'], 2], ['Rule', ['f', 2], 3]]])
    ).toBe('f(2)');
  });

  test('rules as extra arguments and as a List agree', () => {
    const target = ['List', ['g', 'a'], ['k', 'b']];
    const r1 = ['Rule', ['g', '_a'], ['k', '_a']];
    const r2 = ['Rule', ['k', '_a'], ['g', '_a']];
    expect(evalStr(['ReplaceAll', target, r1, r2])).toBe(
      evalStr(['ReplaceAll', target, ['List', r1, r2]])
    );
  });

  test('a symbol rule is unchanged', () => {
    expect(
      evalStr(['ReplaceAll', ['List', 'x', ['Power', 'x', 2]], ['Rule', 'x', 3]])
    ).toBe('[3,9]');
  });

  test('a binder is not disturbed', () => {
    expect(
      evalStr(['ReplaceAll', ['Add', ['Sin', 'x'], ['Sum', ['Power', 'i', 2], ['Triple', 'i', 1, 3]]], ['Rule', ['Sin', 'x'], 'y']])
    ).toBe('y + 14');
  });

  test('N() agrees with evaluate()', () => {
    const e = ce.box(['ReplaceAll', ['Add', ['Sin', 'x'], 1], ['Rule', ['Sin', 'x'], 2]]);
    expect(e.N().toString()).toBe(e.evaluate().toString());
    expect(e.N().re).toBe(3);
  });
});
