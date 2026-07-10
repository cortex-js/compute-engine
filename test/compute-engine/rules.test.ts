import { ComputeEngine } from '../../src/compute-engine';
import { CONDITIONS } from '../../src/compute-engine/boxed-expression/rules';

import { engine as ce } from '../utils';

describe('RULES', () => {
  it('should handle rule with match and replace as expressions', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match and replace as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a; a > 0';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:>0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX that dont match', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:<0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`null`);
  });

  it('should handle rule with match, replace and inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:positive -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and inline sub condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a_{positive} -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should return the correct shorthand rule for the given expression', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });
});

// Test for issue #23: replace() with object rules should NOT auto-wildcard
// single-character symbols. Only string rules should auto-wildcard.
describe('OBJECT RULES LITERAL MATCHING', () => {
  it('should match literal symbol in object rule, not wildcard', () => {
    // {match: 'a', replace: 2} should replace literal 'a' with 2
    // NOT treat 'a' as a wildcard matching any expression
    const expr = ce.expr(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    // Expected: 2x + b (only 'a' replaced, not the whole expression)
    expect(result?.toString()).toBe('b + 2x');
  });

  it('should match literal symbol not present in expression', () => {
    const expr = ce.expr(['Add', ['Multiply', 'x', 'y'], 'z']);
    // 'a' is not in the expression, so no match
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    expect(result).toBeNull();
  });

  it('should still allow explicit wildcards in object rules', () => {
    const expr = ce.expr(['Add', ['Multiply', 3, 'x'], 5]);
    const result = expr.replace(
      { match: ['Multiply', '_a', 'x'], replace: ['Multiply', 10, 'x'] },
      { recursive: true }
    );
    expect(result?.toString()).toBe('10x + 5');
  });

  it('string rules should still auto-wildcard', () => {
    const expr = ce.expr(['Add', ['Multiply', 2, 'x'], 3]);
    const result = expr.replace('a*x -> 5*x', { recursive: true });
    expect(result?.toString()).toBe('5x + 3');
  });

  it('subs() should work the same as literal replace', () => {
    const expr = ce.expr(['Add', ['Multiply', 'a', 'x'], 'b']);
    const subsResult = expr.subs({ a: 2 });
    const replaceResult = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    expect(subsResult.toString()).toBe(replaceResult?.toString());
  });
});

describe('INVALID RULES', () => {
  // A single malformed rule is skipped (logged via console.error) rather than
  // aborting the whole pass — this keeps one bad rule from taking down an
  // otherwise valid ruleset (see boxRules / the replace() error contract).
  let errorSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('should skip (not throw on) a shorthand rule with no replace', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a';
    // Skipped: nothing matches, so the result is null.
    expect(expr.replace(rule)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain('Skipping rule');
  });

  it('should skip a shorthand rule with incorrect wildcards replace', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> b';
    expect(expr.replace(rule)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'wildcards not present in the match'
    );
  });

  it('should skip a redundant rule with simplify (leaving the expression unchanged)', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '0 + a -> a';
    // The only rule is skipped, so simplify() returns the canonical input.
    expect(expr.simplify({ rules: rule }).toString()).toBe('3 + pi');
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'match and replace expressions are the same'
    );
  });
});

describe('matchPermutations option', () => {
  it('default behavior tries permutations for commutative operators', () => {
    // Use non-canonical expression to test permutation matching
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Should match via permutation: pattern [1, _a] matches expr [x, 1]
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: true explicitly allows permutation matching', () => {
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    expect(
      expr.replace(rule, { matchPermutations: true })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: false disables permutation matching', () => {
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Without permutations, [1, _a] won't match [x, 1] since positions differ
    expect(expr.replace(rule, { matchPermutations: false })).toBeNull();
  });

  it('matchPermutations: false still matches exact order', () => {
    const expr = ce.expr(['Add', 1, 'x'], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Exact order matches even without permutations
    expect(
      expr.replace(rule, { matchPermutations: false })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });
});

// Regression tests for fixes cherry-picked from PR #301.
describe('PR #301 cherry-picked fixes', () => {
  it('applyRule preserves operand rewrites when function-replace returns undefined at top', () => {
    // Pattern matches at both inner and outer Add. Function-replace rewrites the
    // inner Add(y, z) but returns undefined for the outer (where _a is symbol x).
    // Before the fix: result is null (operand rewrites silently discarded).
    // After the fix: result is the operand-rewritten expression.
    const expr = ce.expr(['Add', 'x', ['Add', 'y', 'z']], { form: 'raw' });

    const rule = {
      match: ['Add', '_a', '_b'],
      replace: (_e, { _a, _b }) => {
        if (_a.symbol === 'x') return undefined;
        return ce.expr(['Multiply', _a, _b]);
      },
    };

    const result = expr.replace(rule, {
      recursive: true,
      matchPermutations: false,
    });
    expect(result).not.toBeNull();
    expect(result?.toString()).toBe('x + y * z');
  });

  it('applyRule swallows a throwing function-replace and preserves operand rewrites', () => {
    // Contract (rules.ts ~1180-1190): an exception thrown by a function
    // `replace` is caught — logged via console.error, NOT propagated — and if
    // recursive operand rewrites already succeeded they are preserved
    // (`return operandsMatched ? stepOf(expr) : null`). Only a CancellationError
    // (deadline) still propagates. This is the sibling of the `return undefined`
    // case tested above.
    const expr = ce.expr(['Add', 'x', ['Add', 'y', 'z']], { form: 'raw' });

    const rule = {
      match: ['Add', '_a', '_b'],
      replace: (_e, { _a, _b }) => {
        if (_a.symbol === 'x') throw new Error('boom'); // outer Add
        return ce.expr(['Multiply', _a, _b]); // inner Add(y, z) -> y * z
      },
    };

    // Silence (and observe) the expected console.error from the swallowed throw.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let result: ReturnType<typeof expr.replace> = null;
    // (a) the exception does not propagate out of replace()
    expect(() => {
      result = expr.replace(rule, {
        recursive: true,
        matchPermutations: false,
      });
    }).not.toThrow();

    // The throw was swallowed but logged.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // (b) the successful inner rewrite (y + z -> y * z) is preserved
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe('x + y * z');
  });

  it('object-rule condition string without $ delimiters is honored', () => {
    // Before the '$'-delimiter fix: the condition string was silently dropped,
    // so the rule applied unconditionally.
    const expr = ce.expr(['Add', 3, 'x']);

    const ruleAccept = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a > 0',
    };
    expect(expr.replace(ruleAccept)?.toString()).toBe('6');

    const ruleReject = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a < 0',
    };
    // 3 < 0 is false, so the rule should not apply.
    expect(expr.replace(ruleReject)).toBeNull();
  });

  it('object-rule condition string is canonicalized so it can evaluate', () => {
    // Before the canonicalization fix: a non-trivial condition (e.g. 'a^2 > 0')
    // was parsed as 'raw' and could not evaluate, so the rule never applied.
    const expr = ce.expr(['Add', 4, 'x']);

    const rule = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a^2 > 0',
    };
    // 4^2 = 16 > 0 → condition evaluates to True → rule applies.
    expect(expr.replace(rule)?.toString()).toBe('8');
  });
});

// Regression tests for PR #305: ReplaceOptions 'form' and 'direction'
describe('ReplaceOptions form', () => {
  const rule = { match: 'x', replace: ['Add', 1, 1] };

  it("form: 'canonical' canonicalizes replacements (and result)", () => {
    const expr = ce.parse('x + 1');
    const result = expr.replace(rule, { recursive: true, form: 'canonical' });
    expect(result?.isCanonical).toBe(true);
    // Replacement (1 + 1) is canonicalized to 2, then folded: 2 + 1 → 3
    expect(result?.toString()).toBe('3');
  });

  it("form: 'raw' preserves the replacement structure", () => {
    const expr = ce.expr(['Add', 'x', 5], { form: 'raw' });
    const result = expr.replace(rule, { recursive: true, form: 'raw' });
    expect(result?.isCanonical).toBe(false);
    expect(result?.json).toEqual(['Add', ['Add', 1, 1], 5]);
  });

  it('deprecated canonical: true behaves like form: canonical', () => {
    const expr = ce.parse('x + 1');
    const result = expr.replace(rule, { recursive: true, canonical: true });
    expect(result?.toString()).toBe('3');
  });

  it('deprecated canonical: false behaves like form: raw', () => {
    const expr = ce.expr(['Add', 'x', 5], { form: 'raw' });
    const result = expr.replace(rule, { recursive: true, canonical: false });
    expect(result?.json).toEqual(['Add', ['Add', 1, 1], 5]);
  });

  it('specifying both form and canonical throws', () => {
    const expr = ce.parse('x + 1');
    expect(() =>
      expr.replace(rule, { form: 'canonical', canonical: true })
    ).toThrow(/mutually exclusive/);
  });

  it('a replacement that only changes the form counts as a change', () => {
    // The rule returns the canonical variant of a raw expression: the value
    // is structurally the same, but the form differs. Before PR #305 this
    // was treated as "no change" and replace() returned null.
    const expr = ce.expr(['Multiply', 2, 'x'], { form: 'raw' });
    const rule = {
      match: ['Multiply', '_a', '_b'],
      replace: (e) => e.canonical,
    };
    const result = expr.replace(rule);
    expect(result).not.toBeNull();
    expect(result?.isCanonical).toBe(true);
  });
});

describe('ReplaceOptions direction', () => {
  // An order-sensitive rule: each matched symbol is replaced with an
  // incrementing counter, so the traversal order is observable.
  const makeRule = () => {
    let counter = 0;
    return (e) => {
      if (!e.symbol) return undefined;
      counter += 1;
      return { value: ce.number(counter), because: 'counter' };
    };
  };

  it('left-right (default) visits operands in order', () => {
    const expr = ce.expr(['List', 'a', 'b', 'c'], { form: 'raw' });
    const result = expr.replace(makeRule(), { recursive: true });
    expect(result?.json).toEqual(['List', 1, 2, 3]);
  });

  it('right-left visits operands in reverse order', () => {
    const expr = ce.expr(['List', 'a', 'b', 'c'], { form: 'raw' });
    const result = expr.replace(makeRule(), {
      recursive: true,
      direction: 'right-left',
    });
    expect(result?.json).toEqual(['List', 3, 2, 1]);
  });
});

// Regression tests for the SYMBOLIC "fail-open rule-condition" cluster
// (P1-1, P1-7, P1-8, P1-10). Guards must be fail-closed: an unprovable
// predicate must NOT discharge the rule.
describe('fail-open rule-condition guards', () => {
  describe('P1-1: predicate `≠` guards are fail-closed', () => {
    const rule = '\\lfloor z \\rfloor -> \\lceil z \\rceil; z \\ne 0';

    it('does not fire for an unconstrained symbol', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('\\lfloor z \\rfloor').replace([rule])).toBeNull();
    });

    it('fires under assume(z > 0) (bounds entail z ≠ 0)', () => {
      const engine = new ComputeEngine();
      engine.assume(engine.parse('z > 0'));
      expect(
        engine.parse('\\lfloor z \\rfloor').replace([rule])?.toString()
      ).toBe('ceil(z)');
    });

    it('fires when the symbol has a definite nonzero value', () => {
      const engine = new ComputeEngine();
      engine.assign('z', 3);
      expect(
        engine.parse('\\lfloor z \\rfloor').replace([rule])?.toString()
      ).toBe('ceil(z)');
    });

    it('does not fire when the value is zero', () => {
      const engine = new ComputeEngine();
      engine.assign('z', 0);
      expect(engine.parse('\\lfloor z \\rfloor').replace([rule])).toBeNull();
    });
  });

  describe('P1-7: shortcut wildcard conditions are fail-closed', () => {
    it(':notzero does not fire for an unknown symbol', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('q^2').replace(['x^2 -> 42; x:notzero'])).toBeNull();
    });

    it(':notzero fires for a nonzero value and not for zero', () => {
      const e1 = new ComputeEngine();
      e1.assign('q', 2);
      expect(e1.parse('q^2').replace(['x^2 -> 42; x:notzero'])?.toString()).toBe(
        '42'
      );
      const e0 = new ComputeEngine();
      e0.assign('q', 0);
      expect(e0.parse('q^2').replace(['x^2 -> 42; x:notzero'])).toBeNull();
    });

    it(':notone does not fire for an unknown symbol, fires only when ≠ 1', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('q^2').replace(['x^2 -> 42; x:notone'])).toBeNull();
      const e5 = new ComputeEngine();
      e5.assign('q', 5);
      expect(e5.parse('q^2').replace(['x^2 -> 42; x:notone'])?.toString()).toBe(
        '42'
      );
      const e1 = new ComputeEngine();
      e1.assign('q', 1);
      expect(e1.parse('q^2').replace(['x^2 -> 42; x:notone'])).toBeNull();
    });

    it(':notreal does not fire for an unknown symbol, fires for i', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('q^2').replace(['x^2 -> 42; x:notreal'])).toBeNull();
      const ei = new ComputeEngine();
      expect(ei.parse('i^2').replace(['x^2 -> 42; x:notreal'])?.toString()).toBe(
        '42'
      );
    });

    it(':composite does not classify 0 or 1 as composite', () => {
      const c1 = new ComputeEngine();
      expect((CONDITIONS as any).composite(c1.box(1))).toBe(false);
      expect((CONDITIONS as any).composite(c1.box(0))).toBe(false);
      expect((CONDITIONS as any).composite(c1.box(4))).toBe(true);
      expect((CONDITIONS as any).composite(c1.box(9))).toBe(true);
      expect((CONDITIONS as any).composite(c1.box(7))).toBe(false);
    });

    it(':positive control is unchanged (fail-closed)', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('q^2').replace(['x^2 -> 42; x:positive'])).toBeNull();
      const e3 = new ComputeEngine();
      e3.assign('q', 3);
      expect(
        e3.parse('q^2').replace(['x^2 -> 42; x:positive'])?.toString()
      ).toBe('42');
    });
  });

  describe('P1-8: an exception in a replace function skips only that rule', () => {
    it('a later rule still applies after an earlier replace-fn throws', () => {
      const engine = new ComputeEngine();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const r = engine.expr(['Sin', 'x']).replace([
        {
          match: ['Sin', '_x'],
          replace: (() => {
            throw new Error('boom-replace');
          }) as any,
        },
        { match: ['Sin', '_x'], replace: ['Tan', '_x'] },
      ]);
      expect(r?.toString()).toBe('tan(x)');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('a mid-ruleset throw does not discard earlier or later rewrites', () => {
      const engine = new ComputeEngine();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const r = engine.expr(['Sin', 'x']).replace([
        { match: ['Sin', '_x'], replace: ['Cos', '_x'] },
        {
          match: ['Cos', '_x'],
          replace: (() => {
            throw new Error('boom-2');
          }) as any,
        },
        { match: ['Cos', '_x'], replace: ['Tan', '_x'] },
      ]);
      expect(r?.toString()).toBe('tan(x)');
      spy.mockRestore();
    });
  });

  describe('condition must return exactly true (or boxed True) to fire', () => {
    // A rule condition is typed to return a boolean. A boxed `False` is a
    // truthy JS object: with the old `!condition(...)` check it satisfied
    // the condition and the rule fired.
    let warnSpy: ReturnType<typeof jest.spyOn>;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('a condition returning boxed False does not fire the rule', () => {
      const engine = new ComputeEngine();
      const r = engine.expr(['Sin', 'x']).replace({
        match: ['Sin', '_x'],
        replace: ['Cos', '_x'],
        condition: (() => engine.False) as any,
      });
      expect(r).toBeNull();
      // A one-time warning teaches the user their condition is malformed
      expect(warnSpy).toHaveBeenCalled();
      expect(String(warnSpy.mock.calls[0][0])).toContain('non-boolean');
    });

    it('a condition returning boxed True still fires the rule', () => {
      const engine = new ComputeEngine();
      const r = engine.expr(['Sin', 'x']).replace({
        match: ['Sin', '_x'],
        replace: ['Cos', '_x'],
        condition: (() => engine.True) as any,
      });
      expect(r?.toString()).toBe('cos(x)');
    });

    it('a condition returning true fires, false does not', () => {
      const engine = new ComputeEngine();
      const fire = engine.expr(['Sin', 'x']).replace({
        match: ['Sin', '_x'],
        replace: ['Cos', '_x'],
        condition: () => true,
      });
      expect(fire?.toString()).toBe('cos(x)');
      const noFire = engine.expr(['Sin', 'x']).replace({
        match: ['Sin', '_x'],
        replace: ['Cos', '_x'],
        condition: () => false,
      });
      expect(noFire).toBeNull();
    });

    it('other truthy non-boolean returns do not fire the rule', () => {
      const engine = new ComputeEngine();
      const r = engine.expr(['Sin', 'x']).replace({
        match: ['Sin', '_x'],
        replace: ['Cos', '_x'],
        condition: (() => 'yes') as any,
      });
      expect(r).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('a throwing condition skips the rule without losing operand rewrites', () => {
    it('operand-level rewrites survive a condition throw at the root', () => {
      const engine = new ComputeEngine();
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // One rule: matches the inner Add(y, z) (condition passes, rewritten to
      // Multiply) and the outer Add (condition throws). The throw must mean
      // "rule does not apply at this node", not "discard the subtree work".
      const expr = engine.expr(['Add', 'x', ['Add', 'y', 'z']], {
        form: 'raw',
      });
      const r = expr.replace(
        {
          match: ['Add', '_a', '_b'],
          replace: ['Multiply', '_a', '_b'],
          condition: (sub) => {
            if ((sub._a as any)?.symbol === 'x') throw new Error('boom');
            return true;
          },
        },
        { recursive: true, matchPermutations: false }
      );
      spy.mockRestore();
      expect(r).not.toBeNull();
      expect(r?.toString()).toBe('x + y * z');
    });
  });

  describe('single and sequence wildcards are distinct in condition substitutions', () => {
    it('_x and __x are distinct keys, with the single wildcard providing the bare alias', () => {
      const engine = new ComputeEngine();
      let seen: Record<string, string | undefined> | null = null;
      const r = engine.expr(['Add', 5, 7, 11], { form: 'raw' }).replace(
        {
          match: ['Add', '_x', '__x'],
          replace: 42,
          condition: (sub) => {
            seen = {
              single: (sub._x as any)?.toString(),
              seq: (sub.__x as any)?.toString(),
              bare: (sub.x as any)?.toString(),
            };
            return true;
          },
        },
        { matchPermutations: false }
      );
      expect(r?.toString()).toBe('42');
      expect(seen).not.toBeNull();
      expect(seen!.single).toBe('5');
      expect(seen!.seq).toBe('7 + 11');
      // Bare alias comes from the single wildcard (most specific binding)
      expect(seen!.bare).toBe('5');
    });

    it('a sequence wildcard __x does not create a phantom _x key', () => {
      const engine = new ComputeEngine();
      let keys: string[] = [];
      let phantom: unknown = 'unset';
      let bare: string | undefined;
      engine.expr(['Add', 5, 7, 11], { form: 'raw' }).replace(
        {
          match: ['Add', '_a', '__x'],
          replace: 42,
          condition: (sub) => {
            keys = Object.keys(sub).sort();
            phantom = sub._x;
            bare = (sub.x as any)?.toString();
            return true;
          },
        },
        { matchPermutations: false }
      );
      // Pre-fix: `k.slice(1)` turned '__x' into a phantom '_x' key
      expect(keys).toEqual(['__x', '_a', 'a', 'x']);
      expect(phantom).toBeUndefined();
      // The bare alias strips the full wildcard prefix
      expect(bare).toBe('7 + 11');
    });
  });

  describe('constants e and i in string rules', () => {
    it("string rule 'e^2 -> 7' matches the canonical ExponentialE power", () => {
      const engine = new ComputeEngine();
      expect(engine.parse('e^2').replace('e^2 -> 7')?.toString()).toBe('7');
    });

    it('e in a rule replacement produces the canonical constant', () => {
      const engine = new ComputeEngine();
      const r = engine.parse('\\pi').replace('\\pi -> e');
      expect(r?.canonical.symbol).toBe('ExponentialE');
    });

    it('i in a string rule matches the canonical imaginary unit', () => {
      const engine = new ComputeEngine();
      expect(engine.parse('i^2').replace('i^2 -> 42')?.toString()).toBe('42');
    });

    it('e/i in object-rule LaTeX match strings are normalized too', () => {
      const engine = new ComputeEngine();
      expect(
        engine.parse('e^2').replace({ match: 'e^2', replace: 7 })?.toString()
      ).toBe('7');
    });
  });

  describe('explicit wildcards in LaTeX match strings', () => {
    it("{match: '_a + 1'} treats _a as a wildcard", () => {
      const engine = new ComputeEngine();
      const r = engine
        .expr(['Add', 'y', 1], { form: 'raw' })
        .replace({ match: '_a + 1', replace: ['Multiply', 2, '_a'] });
      expect(r?.toString()).toBe('2y');
    });

    it("{match: '__a + 1'} treats __a as a sequence wildcard", () => {
      const engine = new ComputeEngine();
      const r = engine
        .expr(['Add', 'y', 'z', 1], { form: 'raw' })
        .replace({ match: '__a + 1', replace: 7 });
      expect(r?.toString()).toBe('7');
    });
  });

  describe('P1-10: multi-condition LaTeX shortcuts parse and are fail-closed', () => {
    const shortcuts = [
      '\\in\\Z^+',
      '\\in\\Z^-',
      '\\in\\Z^*',
      '\\in\\N',
      '\\in\\N^*',
      '\\in\\N_0',
      '\\in\\R^*',
    ];

    it('every shortcut parses without throwing and is fail-closed', () => {
      for (const sh of shortcuts) {
        const engine = new ComputeEngine();
        // Must not throw, and must not fire for an unconstrained symbol.
        expect(engine.parse('q^2').replace([`x^2 -> 42; x:${sh}`])).toBeNull();
      }
    });

    it('shortcuts fire only when the membership is provable', () => {
      const zplus = new ComputeEngine();
      zplus.assign('q', 3);
      expect(
        zplus.parse('q^2').replace(['x^2 -> 42; x:\\in\\Z^+'])?.toString()
      ).toBe('42');

      const zplusNonInt = new ComputeEngine();
      zplusNonInt.assign('q', 2.5);
      expect(
        zplusNonInt.parse('q^2').replace(['x^2 -> 42; x:\\in\\Z^+'])
      ).toBeNull();

      const zstar = new ComputeEngine();
      zstar.assign('q', 5);
      expect(
        zstar.parse('q^2').replace(['x^2 -> 42; x:\\in\\Z^*'])?.toString()
      ).toBe('42');

      const zstarZero = new ComputeEngine();
      zstarZero.assign('q', 0);
      expect(
        zstarZero.parse('q^2').replace(['x^2 -> 42; x:\\in\\Z^*'])
      ).toBeNull();

      const nat = new ComputeEngine();
      nat.assign('q', 0);
      expect(nat.parse('q^2').replace(['x^2 -> 42; x:\\in\\N'])?.toString()).toBe(
        '42'
      );
    });
  });
});
