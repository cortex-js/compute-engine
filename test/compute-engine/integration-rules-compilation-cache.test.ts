import { ComputeEngine } from '../../src/compute-engine';
import {
  compileRule,
  compileRuleDocs,
} from '../../src/compute-engine/rubi/compile';
import type { RubiRuleDoc } from '../../src/compute-engine/rubi/types';
import type { Pat } from '../../src/compute-engine/rubi/match';
import { loadIntegrationRules } from '../../src/integration-rules';

const docs: RubiRuleDoc[] = [
  {
    file: 'duplicate-patterns',
    rules: [
      {
        index: 1,
        scoped: null,
        variable: 'x',
        lhs: ['Power', ['Blank', 'x'], 2],
        bindings: [],
        condition: ['EqQ', 'a', 1],
        innerCondition: null,
        rhs: ['Power', 'x', 3],
        source: 'first',
      },
      {
        index: 2,
        scoped: null,
        variable: 'x',
        lhs: ['Power', ['Blank', 'x'], 2],
        bindings: [],
        condition: ['EqQ', 'a', 2],
        innerCondition: ['NeQ', 'b', 0],
        rhs: ['Power', 'x', 4],
        source: 'second',
      },
      {
        index: 3,
        scoped: null,
        variable: 'x',
        lhs: ['Power', ['Blank', 'a'], 0],
        bindings: [],
        condition: null,
        innerCondition: null,
        rhs: 1,
      },
      {
        index: 4,
        scoped: null,
        variable: 'x',
        lhs: ['Power', ['Blank', 'a'], 0],
        bindings: [],
        condition: null,
        innerCondition: null,
        rhs: 2,
      },
    ],
  },
];

describe('Rubi compilation pattern reuse', () => {
  test('the real provider falls back for beta-half and remains installed', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const provider = ce._integrationProvider;
    const result = ce
      .box([
        'Integrate',
        ['Divide', 1, ['Sqrt', ['Multiply', 'x', ['Subtract', 1, 'x']]]],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    expect(result.isSame(ce.Pi)).toBe(true);
    expect(ce._integrationProvider).toBe(provider);
  });
  test('invalid step budgets are rejected before any rule is boxed', () => {
    const ce = new ComputeEngine();
    const boxing = jest.spyOn(ce, 'expr');
    expect(() => loadIntegrationRules(ce, { stepBudget: -1 })).toThrow(
      RangeError
    );
    expect(boxing).not.toHaveBeenCalled();
    expect(ce._integrationProvider).toBeUndefined();
  });
  test('reuses only the pattern, preserving rule order, guards, RHS and skip identities', () => {
    const ce = new ComputeEngine();
    const actual = compileRuleDocs(ce, docs);
    expect(actual.rules).toHaveLength(2);
    expect(actual.rules[0].pat).toBe(actual.rules[1].pat);
    for (let i = 0; i < 2; i++) {
      const expected = compileRule(
        ce,
        docs[0].rules[i],
        `duplicate-patterns#${i + 1}`,
        i
      ).rule!;
      expect(actual.rules[i]).toEqual(expected);
    }
    expect(actual.skipped.map((x) => x.id)).toEqual([
      'duplicate-patterns#3',
      'duplicate-patterns#4',
    ]);
    expect(actual.skipped[0].reason).toBe(actual.skipped[1].reason);
  });
  test('constants never retain another engine', () => {
    const a = new ComputeEngine(),
      b = new ComputeEngine();
    const pa = compileRuleDocs(a, docs).rules[0].pat;
    const pb = compileRuleDocs(b, docs).rules[0].pat;
    expect(pa).not.toBe(pb);
    const check = (p: Pat, ce: ComputeEngine) => {
      if (p.kind === 'const') expect(p.value.engine).toBe(ce);
      if (p.kind === 'optslot') expect(p.default.engine).toBe(ce);
      if (p.kind === 'node') p.ops.forEach((x) => check(x, ce));
    };
    check(pa, a);
    check(pb, b);
  });
});
