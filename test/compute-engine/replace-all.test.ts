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

  test('a rule for a name and a rule for a part are applied in one pass', () => {
    const target = ['Add', 'x', ['Power', 'x', 2]];
    const r1 = ['Rule', 'x', 2];
    const r2 = ['Rule', ['Power', 'x', 2], 'y'];
    expect(evalStr(['ReplaceAll', target, ['List', r1, r2]])).toBe('y + 2');
    expect(evalStr(['ReplaceAll', target, ['List', r2, r1]])).toBe('y + 2');
  });

  test('a rule for a name does not see the replacement of a part', () => {
    expect(
      evalStr(['ReplaceAll', ['Add', 'x', ['Power', 'x', 2]], ['List', ['Rule', 'x', 2], ['Rule', ['Power', 'x', 2], 'x']]])
    ).toBe('x + 2');
    expect(
      evalStr(['ReplaceAll', ['f', 'x', ['g', 'x']], ['List', ['Rule', 'x', 'a'], ['Rule', ['g', '_u'], ['h', '_u']]]])
    ).toBe('f(a, h(x))');
  });

  test('the first rule for a name wins', () => {
    expect(
      evalStr(['ReplaceAll', ['Add', 'x', ['Sin', 'x']], ['List', ['Rule', 'x', 1], ['Rule', 'x', 2], ['Rule', ['Sin', 'x'], 0]]])
    ).toBe('1');
  });

  test('a rule for a name keeps the index of a binder', () => {
    // `x` in the sum is its index: the rule for `x` does not replace it.
    expect(
      evalStr(['ReplaceAll', ['Add', 'x', ['Sin', 'x'], ['Sum', ['Power', 'x', 2], ['Limits', 'x', 1, 3]]], ['List', ['Rule', 'x', 2], ['Rule', ['Sin', 'x'], 'y']]])
    ).toBe('y + 16');
    // A pattern rule replaces a part in the body of the sum.
    expect(
      evalStr(['ReplaceAll', ['Add', 'k', ['Sum', ['Multiply', ['Sin', 'x'], 'x'], ['Limits', 'x', 1, 3]]], ['List', ['Rule', 'k', 2], ['Rule', ['Sin', '_a'], 1]]])
    ).toBe('8');
    // A sum over one point keeps its index.
    expect(
      evalStr(['ReplaceAll', ['Sum', ['Sin', 'x'], ['Limits', 'x', 1, 1]], ['List', ['Rule', 'k', 2], ['Rule', ['Sin', '_a'], ['Power', '_a', 2]]]])
    ).toBe('1');
  });

  test('a binder with a match inside that binds a name of a rule stays unevaluated', () => {
    const unevaluated = (target: any, rules: any) =>
      ce.box(['ReplaceAll', target, rules]).evaluate().operator;
    // `k → x` under the sum over `x` would need a rename of the index.
    expect(
      unevaluated(['Sum', ['Multiply', 'k', ['Sin', 'x']], ['Limits', 'x', 1, 3]], ['List', ['Rule', 'k', 'x'], ['Rule', ['Sin', '_a'], ['Power', '_a', 2]]])
    ).toBe('ReplaceAll');
    // A rule for the index of the sum.
    expect(
      unevaluated(['Sum', ['Multiply', 'x', ['Sin', 'x']], ['Limits', 'x', 1, 3]], ['List', ['Rule', 'x', 2], ['Rule', ['Sin', '_a'], 1]])
    ).toBe('ReplaceAll');
    // A set builder binds `x`, and no scope lists it.
    expect(
      unevaluated(['Set', ['Power', 'x', 2], ['Element', 'x', ['Range', 1, 'x']]], ['List', ['Rule', 'x', 3], ['Rule', ['Power', '_a', 2], ['Sin', '_a']]])
    ).toBe('ReplaceAll');
    // A held sum has no scope.
    expect(
      unevaluated(['Hold', ['Sum', ['Multiply', 'x', ['Sin', 'x']], ['Limits', 'x', 1, 3]]], ['List', ['Rule', 'x', 2], ['Rule', ['Sin', '_a'], 1]])
    ).toBe('ReplaceAll');
  });

  test('a rule for a name that is a property of an object', () => {
    for (const name of ['constructor', '__proto__'])
      expect(
        evalStr(['ReplaceAll', ['Add', name, ['Sin', 'x']], ['List', ['Rule', name, 2], ['Rule', ['Sin', 'x'], 1]]])
      ).toBe('3');
  });

  test('the first rule for a name wins with no pattern rule', () => {
    expect(
      evalStr(['ReplaceAll', ['Add', 'x', 1], ['List', ['Rule', 'x', 1], ['Rule', 'x', 2]]])
    ).toBe('2');
  });

  test('N() agrees with evaluate()', () => {
    const e = ce.box(['ReplaceAll', ['Add', ['Sin', 'x'], 1], ['Rule', ['Sin', 'x'], 2]]);
    expect(e.N().toString()).toBe(e.evaluate().toString());
    expect(e.N().re).toBe(3);
  });
});
