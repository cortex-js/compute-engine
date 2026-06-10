/**
 * M2 unit tests for the operator-indexed rule dispatch
 * (FUNGRIM-PLAN-2-RULES.md §2.1, §3 M2).
 *
 * Covers:
 * - classification of rules into `byHead` / `alwaysTry` (plain and
 *   variations indexes), including the `operators` dispatch hint;
 * - cross-head compatibility (`HEAD_COMPAT`, number-literal → `Divide`)
 *   through the indexed `replace()` path;
 * - declaration-order semantics, including the mid-pass re-seed when a rule
 *   changes the expression's operator;
 * - `once` / `iterationLimit` / loop-detection parity with the linear scan;
 * - the `recursive: true` index bypass;
 * - the differential invariant: over the shared corpus, every rule EXCLUDED
 *   by `candidateRules()` returns `null` from `applyRule()` (the index never
 *   skips a rule that would have fired).
 *
 * NOTE: the indexed path only engages for rule sets with >= 8 rules
 * (DEFAULT_MIN_INDEX_SIZE); several tests pad rule sets with inert rules to
 * cross that threshold, and use 7-rule variants to compare against the
 * linear-scan behavior.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Rule, BoxedRuleSet } from '../../src/compute-engine';

import {
  getRuleIndex,
  candidateRules,
  DEFAULT_MIN_INDEX_SIZE,
} from '../../src/compute-engine/boxed-expression/rule-index';
import {
  applyRule,
  replace as replaceRules,
} from '../../src/compute-engine/boxed-expression/rules';

import {
  SIMPLIFY_CORPUS_FLAT,
  declareSyntheticHeads,
  makeSyntheticRules,
} from './rule-dispatch-corpus';

/** Inert pad rules (distinct, never-matching heads) used to push rule sets
 * over the index threshold. */
function pads(count: number, prefix = 'Pad'): Rule[] {
  const result: Rule[] = [];
  for (let i = 0; i < count; i++)
    result.push({
      match: [`${prefix}${i}`, '_a', i],
      replace: '_a',
      id: `pad-${i}`,
    });
  return result;
}

function ordinalsOf(
  bucket: ReadonlyArray<{ ordinal: number }> | undefined
): number[] {
  return (bucket ?? []).map((x) => x.ordinal);
}

describe('rule classification (getRuleIndex)', () => {
  const ce = new ComputeEngine();

  // prettier-ignore
  const rules: Rule[] = [
    /* 0 */ (_expr) => undefined,                                      // bare functional
    /* 1 */ { replace: () => undefined, operators: ['Sin', 'Cos'], id: 'hinted' },
    /* 2 */ { match: ['_f', '_a'], replace: '_a', id: 'wildcard-head' },
    /* 3 */ { match: ['Add', '_a', 1], replace: '_a', useVariations: true, id: 'add-var' },
    /* 4 */ { match: ['Add', '_a', 2], replace: '_a', id: 'add-novar' },
    /* 5 */ { match: ['Ln', '_a'], replace: '_a', useVariations: true, id: 'ln-var' },
    /* 6 */ { match: ['Divide', '_a', '_b'], replace: '_a', id: 'div' },
    /* 7 */ { match: 42, replace: 43, id: 'num-pattern' },
  ];

  const boxed = ce.rules(rules).rules;
  const plain = getRuleIndex(boxed, false)!;
  const variations = getRuleIndex(boxed, true)!;

  test('index builds for both plain and variations', () => {
    expect(plain).toBeDefined();
    expect(variations).toBeDefined();
    expect(plain.count).toBe(8);
    expect(variations.count).toBe(8);
  });

  test('plain index: functional, wildcard-head, number-pattern and rule-level-variations VARIANT_CAPABLE rules are alwaysTry', () => {
    expect(ordinalsOf(plain.alwaysTry)).toEqual([0, 2, 3, 7]);
  });

  test('plain index: head-faithful patterns are bucketed', () => {
    expect(ordinalsOf(plain.byHead.get('Add'))).toEqual([4]);
    expect(ordinalsOf(plain.byHead.get('Ln'))).toEqual([5]);
    expect(ordinalsOf(plain.byHead.get('Divide'))).toEqual([6]);
  });

  test('hinted functional rule is bucketed under each hinted head', () => {
    expect(ordinalsOf(plain.byHead.get('Sin'))).toEqual([1]);
    expect(ordinalsOf(plain.byHead.get('Cos'))).toEqual([1]);
    expect(ordinalsOf(variations.byHead.get('Sin'))).toEqual([1]);
  });

  test('variations index: VARIANT_CAPABLE heads become alwaysTry; Ln stays bucketed', () => {
    // r4 ('Add', no rule-level useVariations) and r6 ('Divide') become
    // alwaysTry under call-level variations.
    expect(ordinalsOf(variations.alwaysTry)).toEqual([0, 2, 3, 4, 6, 7]);
    // Ln is not variant-capable: indexable even under variations.
    expect(ordinalsOf(variations.byHead.get('Ln'))).toEqual([5]);
    expect(variations.byHead.get('Add')).toBeUndefined();
    expect(variations.byHead.get('Divide')).toBeUndefined();
  });

  test('below the min-size threshold no index is built', () => {
    const seven = boxed.slice(0, 7);
    expect(seven.length).toBeLessThan(DEFAULT_MIN_INDEX_SIZE);
    expect(getRuleIndex(seven, false)).toBeUndefined();
    // ... unless the threshold is explicitly lowered
    expect(getRuleIndex(seven, false, 0)).toBeDefined();
  });

  test('candidateRules merges buckets in declaration (ordinal) order', () => {
    const sinExpr = ce.parse('\\sin(x)');
    expect(
      [...candidateRules(plain, sinExpr, -1)].map((x) => x.ordinal)
    ).toEqual([0, 1, 2, 3, 7]);

    // fromOrdinal filters already-visited rules
    expect(
      [...candidateRules(plain, sinExpr, 1)].map((x) => x.ordinal)
    ).toEqual([2, 3, 7]);
  });

  test('candidateRules deduplicates a rule hinted into several consulted buckets', () => {
    const multiHint = ce.rules([
      ...pads(7),
      {
        replace: () => undefined,
        operators: ['Multiply', 'Divide'],
        id: 'multi-hint',
      },
    ]).rules;
    const index = getRuleIndex(multiHint, false)!;
    // Multiply consults both the Multiply bucket and (HEAD_COMPAT) the
    // Divide bucket; the hinted rule is in both but must be yielded once.
    const candidates = [
      ...candidateRules(index, ce.parse('2\\cdot x'), -1),
    ].map((x) => x.ordinal);
    expect(candidates).toEqual([7]);
  });
});

describe('cross-head compatibility through the indexed path', () => {
  const ce = new ComputeEngine();

  const divSet = ce.rules([
    ...pads(7),
    {
      match: ['Divide', '_a', '_b'],
      replace: ['Tuple', '_a', '_b'],
      id: 'div-rule',
    },
  ]);

  const powSet = ce.rules([
    ...pads(7),
    {
      match: ['Power', '_b', '_e'],
      replace: ['Pair', '_b', '_e'],
      id: 'pow-rule',
    },
  ]);

  test('rule sets are large enough to engage the index', () => {
    expect(getRuleIndex(divSet.rules, false)).toBeDefined();
    expect(getRuleIndex(powSet.rules, false)).toBeDefined();
    // ... and the Divide/Power rules are bucketed, not alwaysTry
    expect(
      ordinalsOf(getRuleIndex(divSet.rules, false)!.byHead.get('Divide'))
    ).toEqual([7]);
    expect(
      ordinalsOf(getRuleIndex(powSet.rules, false)!.byHead.get('Power'))
    ).toEqual([7]);
  });

  test('Divide pattern fires on a rational number literal (match.ts:142-156)', () => {
    const expr = ce.box(['Rational', 3, 2]);
    const steps = replaceRules(expr, divSet);
    expect(steps.length).toBe(1);
    expect(steps[0].because).toBe('div-rule');
    expect(steps[0].value.isSame(ce.box(['Tuple', 3, 2]))).toBe(true);
  });

  test('Divide pattern fires on Multiply(1/2, x) (match.ts:158-197)', () => {
    const expr = ce.parse('\\frac{x}{2}'); // canonicalized to (1/2) * x
    expect(expr.operator).toBe('Multiply');
    const steps = replaceRules(expr, divSet);
    expect(steps.length).toBe(1);
    expect(steps[0].because).toBe('div-rule');
    expect(steps[0].value.isSame(ce.box(['Tuple', 'x', 2]))).toBe(true);
  });

  test('Power pattern fires on Divide(1, x) (match.ts:199-218)', () => {
    const expr = ce.parse('\\frac{1}{x}');
    expect(expr.operator).toBe('Divide');
    const steps = replaceRules(expr, powSet);
    expect(steps.length).toBe(1);
    expect(steps[0].because).toBe('pow-rule');
    expect(steps[0].value.isSame(ce.box(['Pair', 'x', -1]))).toBe(true);
  });

  test('Power pattern fires on Root(x, 3) (match.ts:220-236)', () => {
    const expr = ce.parse('\\sqrt[3]{x}');
    expect(expr.operator).toBe('Root');
    const steps = replaceRules(expr, powSet);
    expect(steps.length).toBe(1);
    expect(steps[0].because).toBe('pow-rule');
    expect(steps[0].value.isSame(ce.box(['Pair', 'x', ['Divide', 1, 3]]))).toBe(
      true
    );
  });

  test('hinted functional rule is invoked on hinted heads only', () => {
    const seen: string[] = [];
    const set = ce.rules([
      ...pads(7),
      {
        replace: (expr) => {
          seen.push(expr.operator);
          return undefined;
        },
        operators: ['Sin'],
        id: 'spy',
      },
    ]);
    replaceRules(ce.parse('\\tan(x)'), set);
    expect(seen).toEqual([]);
    replaceRules(ce.parse('\\sin(x)'), set);
    expect(seen).toEqual(['Sin']);
  });
});

describe('declaration-order semantics', () => {
  const ce = new ComputeEngine();

  test('once: the lowest-ordinal matching rule wins, regardless of bucket', () => {
    const set = ce.rules([
      ...pads(3),
      { match: ['Foo', '_a'], replace: 1, id: 'first' },
      ...pads(3, 'Qad'),
      { match: ['Foo', '_a'], replace: 2, id: 'second' },
    ]);
    const expr = ce.box(['Foo', 'x']);
    const steps = replaceRules(expr, set, { once: true });
    expect(steps.length).toBe(1);
    expect(steps[0].because).toBe('first');
    expect(steps[0].value.isSame(1)).toBe(true);
  });

  test('chained rewrites across buckets and alwaysTry fire in one pass, in ordinal order', () => {
    const set = ce.rules([
      ...pads(5),
      { match: ['Foo', '_a'], replace: ['Bar', '_a'], id: 'foo->bar' },
      {
        // Functional rule (alwaysTry), after 'foo->bar' in declaration order
        replace: (expr) =>
          expr.operator === 'Bar'
            ? expr.engine.box(['Baz', expr.ops![0]])
            : undefined,
        id: 'bar->baz',
      },
      { match: ['Baz', '_a'], replace: 99, id: 'baz->99' },
    ]);
    const steps = replaceRules(ce.box(['Foo', 'x']), set);
    expect(steps.map((s) => s.because)).toEqual([
      'foo->bar',
      'bar->baz',
      'baz->99',
    ]);
    expect(steps.at(-1)!.value.isSame(99)).toBe(true);
  });
});

describe('mid-pass operator change (re-seed semantics)', () => {
  const ce = new ComputeEngine();

  const sinToCos: Rule = {
    match: ['Sin', '_a'],
    replace: ['Cos', '_a'],
    id: 'sin->cos',
  };
  const cosToTan: Rule = {
    match: ['Cos', '_a'],
    replace: ['Tan', '_a'],
    id: 'cos->tan',
  };

  test('a Cos rule with ordinal > k fires in the same pass after Sin->Cos', () => {
    // Indexed (8 rules) and linear (7 rules) variants must produce the same
    // trace: ['sin->cos', 'cos->tan'] within a single pass.
    const indexed = ce.rules([...pads(6), sinToCos, cosToTan]);
    const linear = ce.rules([...pads(5), sinToCos, cosToTan]);
    expect(getRuleIndex(indexed.rules, false)).toBeDefined();
    expect(getRuleIndex(linear.rules, false)).toBeUndefined();

    for (const set of [indexed, linear]) {
      const steps = replaceRules(ce.parse('\\sin(x)'), set);
      expect(steps.map((s) => s.because)).toEqual(['sin->cos', 'cos->tan']);
      expect(steps.at(-1)!.value.isSame(ce.parse('\\tan(x)'))).toBe(true);
    }
  });

  test('a Cos rule with ordinal < k does NOT fire in the same pass (waits for the next pass)', () => {
    const indexed = ce.rules([cosToTan, ...pads(6), sinToCos]);
    const linear = ce.rules([cosToTan, ...pads(5), sinToCos]);
    expect(getRuleIndex(indexed.rules, false)).toBeDefined();
    expect(getRuleIndex(linear.rules, false)).toBeUndefined();

    for (const set of [indexed, linear]) {
      // Default iterationLimit is 1: only the Sin->Cos rewrite happens.
      const onePass = replaceRules(ce.parse('\\sin(x)'), set);
      expect(onePass.map((s) => s.because)).toEqual(['sin->cos']);
      expect(onePass.at(-1)!.value.isSame(ce.parse('\\cos(x)'))).toBe(true);

      // With a second pass, the Cos rule gets its turn.
      const twoPasses = replaceRules(ce.parse('\\sin(x)'), set, {
        iterationLimit: 2,
      });
      expect(twoPasses.map((s) => s.because)).toEqual(['sin->cos', 'cos->tan']);
      expect(twoPasses.at(-1)!.value.isSame(ce.parse('\\tan(x)'))).toBe(true);
    }
  });
});

describe('once / iterationLimit / loop-detection parity', () => {
  const ce = new ComputeEngine();

  test('loop detection: indexed and linear scans stop at the same steps', () => {
    const sinToCos: Rule = {
      match: ['Sin', '_a'],
      replace: ['Cos', '_a'],
      id: 's>c',
    };
    const cosToSin: Rule = {
      match: ['Cos', '_a'],
      replace: ['Sin', '_a'],
      id: 'c>s',
    };
    const indexed = ce.rules([...pads(6), sinToCos, cosToSin]);
    const linear = ce.rules([...pads(5), sinToCos, cosToSin]);

    for (const set of [indexed, linear]) {
      const steps = replaceRules(ce.parse('\\sin(x)'), set, {
        iterationLimit: 10,
      });
      expect(steps.map((s) => s.because)).toEqual(['s>c', 'c>s']);
    }
  });

  test('iterationLimit: one fixed-point pass per iteration', () => {
    const inc: Rule = {
      match: ['G', '_a'],
      replace: ['G', ['Add', '_a', 1]],
      id: 'inc',
    };
    const indexed = ce.rules([...pads(7), inc]);
    const linear = ce.rules([...pads(6), inc]);

    for (const set of [indexed, linear]) {
      const steps = replaceRules(ce.box(['G', 'x']), set, {
        iterationLimit: 3,
      });
      expect(steps.map((s) => s.because)).toEqual(['inc', 'inc', 'inc']);
      expect(steps.at(-1)!.value.isSame(ce.box(['G', ['Add', 'x', 3]]))).toBe(
        true
      );
    }
  });

  test('recursive: true bypasses the index and still rewrites subexpressions', () => {
    const set = ce.rules([
      ...pads(7),
      { match: ['Sin', '_a'], replace: ['Cos', '_a'], id: 'sin->cos' },
    ]);
    const expr = ce.parse('\\sin(x)+2');
    const steps = replaceRules(expr, set, { recursive: true });
    expect(steps.length).toBe(1);
    expect(steps[0].value.isSame(ce.parse('\\cos(x)+2'))).toBe(true);

    // Non-recursive: the nested Sin is not visited (indexed or not),
    // so no rule fires.
    expect(replaceRules(expr, set).length).toBe(0);
  });
});

describe('differential invariant', () => {
  jest.setTimeout(300_000);

  test('over the corpus, every rule excluded by candidateRules returns null from applyRule', () => {
    const ce = new ComputeEngine();
    declareSyntheticHeads(ce);
    ce.simplificationRules.push(...makeSyntheticRules());

    const ruleSet: BoxedRuleSet = ce.getRuleSet('standard-simplification')!;
    const rules = ruleSet.rules;
    expect(rules.length).toBeGreaterThan(1500);

    const failures: string[] = [];

    for (const variations of [false, true]) {
      const index = getRuleIndex(rules, variations)!;
      expect(index).toBeDefined();

      for (const src of SIMPLIFY_CORPUS_FLAT) {
        const expr = ce.parse(src);

        const included = new Set<number>();
        for (const { ordinal } of candidateRules(index, expr, -1))
          included.add(ordinal);

        for (let i = 0; i < rules.length; i++) {
          if (included.has(i)) continue;
          const result = applyRule(
            rules[i],
            expr,
            {},
            {
              useVariations: variations,
              form: 'canonical',
            }
          );
          if (result !== null)
            failures.push(
              `"${src}" [variations=${variations}] skipped rule #${i} (${rules[i].id}) would have fired`
            );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
