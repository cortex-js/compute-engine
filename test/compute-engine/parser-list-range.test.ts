import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

function operatorOf(expr: Expression): string | null {
  return Array.isArray(expr) ? (expr[0] as string) : null;
}

describe('Parser: list range ellipsis', () => {
  describe('endpoint-only form [a ... b]', () => {
    test('`[1...9]` parses to Range(1, 9)', () => {
      expect(parse('\\left[1...9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\ldots 9]` (\\ldots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\ldots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('`[1\\dots 9]` (\\dots variant) parses to Range(1, 9)', () => {
      expect(parse('\\left[1\\dots 9\\right]')).toEqual(['Range', 1, 9]);
    });

    test('symbolic endpoints', () => {
      expect(parse('\\left[a...b\\right]')).toEqual(['Range', 'a', 'b']);
    });
  });

  // The range infixes (`..`, `...`, `\ldots`, `\dots`) bind above `+` so that a
  // sign or coefficient attaches to the anchor. That makes a COMPOUND first
  // anchor mis-bind: `[m+n...m+n+4]` parses as `Add(m, Range(n, m+n+4))`. Inside
  // a bracket the single-element body is repaired back to the intended two
  // anchors (Tycho item 129).
  describe('endpoint-only form with a compound first anchor', () => {
    test('`[m+n...m+n+4]` → Range(m+n, m+n+4)', () => {
      expect(parse('\\left[m+n...m+n+4\\right]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 4],
      ]);
    });

    test('`[n+1...10]` → Range(n+1, 10)', () => {
      expect(parse('\\left[n+1...10\\right]')).toEqual([
        'Range',
        ['Add', 'n', 1],
        10,
      ]);
    });

    test('`[m-1...m+3]` (subtraction anchor) → Range(m-1, m+3)', () => {
      expect(parse('\\left[m-1...m+3\\right]')).toEqual([
        'Range',
        ['Add', 'm', -1],
        ['Add', 'm', 3],
      ]);
    });

    test('the `..` infix variant repairs the same way', () => {
      expect(parse('\\left[m+n..m+n+4\\right]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 4],
      ]);
    });

    // Provenance guard: an explicit `\operatorname{Range}(…)` in an additive
    // tail is a literal element, not a continuation — no repair.
    test('`[m+\\operatorname{Range}(1,5)]` stays a List', () => {
      expect(parse('\\left[m+\\operatorname{Range}(1,5)\\right]')).toEqual([
        'List',
        ['Add', 'm', ['Range', 1, 5]],
      ]);
    });

    // Unchanged: plain numeric anchors never went through the repair.
    test('`[2...8]` → Range(2, 8)', () => {
      expect(parse('\\left[2...8\\right]')).toEqual(['Range', 2, 8]);
    });

    test('`[-9...9]` → Range(-9, 9)', () => {
      expect(parse('[-9...9]')).toEqual(['Range', -9, 9]);
    });

    // Unchanged: a single-element bracket with no range at all stays a List.
    test('`[x+1]` stays a one-element List', () => {
      expect(parse('\\left[x+1\\right]')).toEqual(['List', ['Add', 'x', 1]]);
    });
  });

  // Comma-less forms with a compound first sample: the prose ellipsis binds
  // looser than a prefix sign or implicit multiplication, so `[-9...9]` is
  // Range(-9, 9), not List(Negate(Range(9, 9))). (Desmos emits these
  // comma-less; the comma forms were fixed in 0.75.0.)
  describe('comma-less form with signed/coefficiented first sample', () => {
    test('`[-9...9]` → Range(-9, 9)', () => {
      expect(parse('\\left[-9...9\\right]')).toEqual(['Range', -9, 9]);
    });

    test('`[-9...9]` enumerates 19 values', () => {
      const expr = ce.parse('\\left[-9...9\\right]').evaluate();
      const values = [...expr.each()].map((x) => x.valueOf());
      expect(values).toEqual([
        -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    test('`[-N...N]` → Range(-N, N)', () => {
      expect(parse('\\left[-N...N\\right]')).toEqual([
        'Range',
        ['Negate', 'N'],
        'N',
      ]);
    });

    test('`[-3N...3N]` → Range(-3N, 3N)', () => {
      expect(parse('\\left[-3N...3N\\right]')).toEqual([
        'Range',
        ['Multiply', -3, 'N'],
        ['Multiply', 3, 'N'],
      ]);
    });

    test('`[-0.5...5]` (signed decimal first sample) → Range(-0.5, 5)', () => {
      expect(parse('\\left[-0.5...5\\right]')).toEqual(['Range', -0.5, 5]);
    });

    test('`[0...kN]` (compound end) → Range(0, kN)', () => {
      expect(parse('\\left[0...kN\\right]')).toMatchObject([
        'Range',
        0,
        ['Multiply', 'N', 'k'],
      ]);
    });

    test('`[-9\\ldots 9]` (\\ldots variant) → Range(-9, 9)', () => {
      expect(parse('\\left[-9\\ldots 9\\right]')).toEqual(['Range', -9, 9]);
    });

    test('programmatic `..` unchanged: `1..5` and `1..3..9`', () => {
      expect(parse('1..5')).toEqual(['Range', 1, 5]);
      expect(parse('1..3..9')).toEqual(['Range', 1, 9, 2]);
    });

    test('ellipsis in an equation rhs: `x=1...5` → Equal(x, Range(1, 5))', () => {
      expect(parse('x=1...5')).toEqual(['Equal', 'x', ['Range', 1, 5]]);
    });

    test('additive continuation unchanged: `1+2+\\ldots+n`', () => {
      expect(parse('1+2+\\ldots+n')).toEqual([
        'Add',
        1,
        2,
        'ContinuationPlaceholder',
        'n',
      ]);
    });

    // Prose ellipses bind below implicit multiplication, so the lhs can be a
    // whole juxtaposition chain. When that chain includes a `\text{…}` run,
    // the ellipsis is prose, not a range: a string can never be a Range
    // endpoint. MathNet corpus regression (`… = k \text{ und } a_1 a_2
    // \ldots a_n = M`).
    test('juxtaposition chain with \\text{…} stays a continuation, not a Range', () => {
      const expr = ce.parse(
        'k \\quad \\text{ und } \\quad a_{1} a_{2} \\ldots a_{n}=M'
      );
      expect(expr.isValid).toBe(true);
      expect(JSON.stringify(expr.json)).not.toContain('"Range"');
      expect(JSON.stringify(expr.json)).toContain('ContinuationPlaceholder');
    });
  });

  // Single-anchor continuation `[1, ..., 10]`: one sample, so no step can be
  // inferred — it means the same as the endpoint-only `[1...10]`, i.e.
  // Range(1, 10). The internal `ContinuationPlaceholder` must never leak as a
  // list element.
  describe('single-anchor form [a, ..., b]', () => {
    test('`[1, \\ldots, 10]` → Range(1, 10)', () => {
      expect(parse('\\left[1, \\ldots, 10\\right]')).toEqual(['Range', 1, 10]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[1, \\ldots, 10\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });
  });

  describe('inferred-step form [a, b, ..., c]', () => {
    test('`[1, 3, ..., 9]` → Range(1, 9, 2)', () => {
      expect(parse('\\left[1, 3, \\ldots, 9\\right]')).toEqual(['Range', 1, 9, 2]);
    });

    test('`[0, 0.1, ..., 1]` (float idiom) → Range(0, 1, 0.1)', () => {
      const result = parse('\\left[0, 0.1, \\ldots, 1\\right]');
      expect(result).toMatchObject(['Range', 0, 1, 0.1]);
    });

    test('`[0, 0.1, 0.2, ..., 1]` (with intermediate sample, tolerance-validated)', () => {
      // 0.1 + 0.1 ≠ 0.2 exactly, but within ce.tolerance.
      expect(parse('\\left[0, 0.1, 0.2, \\ldots, 1\\right]')).toMatchObject([
        'Range', 0, 1, 0.1,
      ]);
    });

    test('negative step `[10, 8, ..., 0]` → Range(10, 0, -2)', () => {
      expect(parse('\\left[10, 8, \\ldots, 0\\right]')).toEqual([
        'Range', 10, 0, -2,
      ]);
    });
  });

  // At parse time a negative literal is raw `["Negate", n]`, not the number
  // `-n`, so a negative *leading* sample used to make `machineValue` return
  // `null` and the range inference bailed to a `ContinuationPlaceholder` list
  // that enumerated as NaN downstream (Tycho 2026-07-11).
  describe('inferred-step form with negative leading samples', () => {
    test('`[-9, -6, ..., 9]` → Range(-9, 9, 3)', () => {
      expect(parse('\\left[-9,-6,\\ldots,9\\right]')).toEqual([
        'Range', -9, 9, 3,
      ]);
    });

    test('`[0, -2, ..., -10]` → Range(0, -10, -2)', () => {
      expect(parse('\\left[0,-2,\\ldots,-10\\right]')).toEqual([
        'Range', 0, -10, -2,
      ]);
    });

    test('`[-1, -0.5, ..., 1]` → Range(-1, 1, 0.5)', () => {
      expect(parse('\\left[-1,-0.5,\\ldots,1\\right]')).toMatchObject([
        'Range', -1, 1, 0.5,
      ]);
    });

    test('`[10, 8, ..., -4]` (negative end only) → Range(10, -4, -2)', () => {
      expect(parse('\\left[10,8,\\ldots,-4\\right]')).toEqual([
        'Range', 10, -4, -2,
      ]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[-9,-6,\\ldots,9\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });

    test('inconsistent negative samples → parse error', () => {
      // samples [-9, -6, -4]: step = -4 - -6 = 2, but -6 - -9 = 3 ≠ 2
      const result = ce.parse('\\left[-9,-6,-4,\\ldots,9\\right]');
      expect(result.isValid).toBe(false);
    });

  });

  // Symbolic stepped samples: infer a step ONLY when every leading sample is a
  // numeric multiple of ONE common plain symbol (the Desmos-corpus idiom
  // `[-3N, -2N, ..., 3N]`). Generic-sequence notation (`[x_1, x_2, ..., x_n]`)
  // is NOT an arithmetic progression and must stay a placeholder List.
  describe('inferred-step form with symbolic leading samples', () => {
    test('`[-3N, -2N, ..., 3N]` → Range(-3N, 3N, N)', () => {
      expect(parse('\\left[-3N,-2N,\\ldots,3N\\right]')).toEqual([
        'Range',
        ['Multiply', -3, 'N'],
        ['Multiply', 3, 'N'],
        'N',
      ]);
    });

    test('`[N, 2N, ..., 10N]` → Range(N, 10N, N)', () => {
      expect(parse('\\left[N,2N,\\ldots,10N\\right]')).toEqual([
        'Range',
        'N',
        ['Multiply', 10, 'N'],
        'N',
      ]);
    });

    test('`[2N, 4N, ..., 20N]` → step Multiply(2, N)', () => {
      expect(parse('\\left[2N,4N,\\ldots,20N\\right]')).toEqual([
        'Range',
        ['Multiply', 2, 'N'],
        ['Multiply', 20, 'N'],
        ['Multiply', 2, 'N'],
      ]);
    });

    test('`[3N, 2N, ..., -3N]` (descending) → step Negate(N)', () => {
      expect(parse('\\left[3N,2N,\\ldots,-3N\\right]')).toEqual([
        'Range',
        ['Multiply', 3, 'N'],
        ['Multiply', -3, 'N'],
        ['Negate', 'N'],
      ]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      const json = JSON.stringify(parse('\\left[-3N,-2N,\\ldots,3N\\right]'));
      expect(json).not.toContain('ContinuationPlaceholder');
    });

    // Generic sequence: distinct symbols per sample → not a progression.
    test('`[x_1, x_2, ..., x_n]` stays a placeholder List', () => {
      expect(parse('\\left[x_1,x_2,\\ldots,x_n\\right]')).toEqual([
        'List',
        'x_1',
        'x_2',
        'ContinuationPlaceholder',
        'x_n',
      ]);
    });

    // Different symbols across samples → not a progression over one symbol.
    test('`[N, 2M, ..., 10N]` (mixed symbols) stays a placeholder List', () => {
      expect(parse('\\left[N,2M,\\ldots,10N\\right]')).toEqual([
        'List',
        'N',
        ['Multiply', 2, 'M'],
        'ContinuationPlaceholder',
        ['Multiply', 10, 'N'],
      ]);
    });

    // Coefficients 1, 2, 4 are not an arithmetic progression.
    test('`[N, 2N, 4N, ..., 10N]` (inconsistent) → parse error', () => {
      const result = ce.parse('\\left[N,2N,4N,\\ldots,10N\\right]');
      expect(result.isValid).toBe(false);
    });

    // End-to-end: once N is assigned, the symbolic Range enumerates concretely.
    test('`[-3N, -2N, ..., 3N]` with N=2 enumerates to -6..6 step 2', () => {
      const ceLocal = new ComputeEngine();
      ceLocal.assign('N', 2);
      const values = [
        ...ceLocal
          .parse('\\left[-3N,-2N,\\ldots,3N\\right]')
          .evaluate()
          .each(),
      ].map((x) => x.re);
      expect(values).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    });
  });

  // Desmos emits these ellipsis ranges with the comma AFTER the `\dots`
  // elided: `[0,...300]`, `[1,...N]`, `[0,15...210]`. Without a terminating
  // comma the placeholder is absorbed by the following endpoint (as a leading
  // factor or additive head) or the tail parses as a bare `Range`; the parser
  // recovers the intended stepped/endpoint range. (Tycho item 47 regression.)
  describe('elided comma after ellipsis (Desmos idiom)', () => {
    // Baseline: the comma-terminated forms these mirror (must stay correct).
    test('`[0,...,300]` → Range(0, 300)', () => {
      expect(parse('[0,...,300]')).toEqual(['Range', 0, 300]);
    });
    test('`[1...5]` → Range(1, 5)', () => {
      expect(parse('[1...5]')).toEqual(['Range', 1, 5]);
    });
    test('`[-3N...3N]` → Range(-3N, 3N)', () => {
      expect(parse('[-3N...3N]')).toEqual([
        'Range',
        ['Multiply', -3, 'N'],
        ['Multiply', 3, 'N'],
      ]);
    });
    test('`[0,15,...,210]` → Range(0, 210, 15)', () => {
      expect(parse('[0,15,...,210]')).toEqual(['Range', 0, 210, 15]);
    });

    // Elided-comma endpoint-only forms: `,...end` with no comma after.
    test('`[0,...300]` → Range(0, 300)', () => {
      expect(parse('[0,...300]')).toEqual(['Range', 0, 300]);
    });
    test('`[1,...N]` (symbolic endpoint) → Range(1, N)', () => {
      expect(parse('[1,...N]')).toEqual(['Range', 1, 'N']);
    });
    test('`[0,...3N^2-1]` (additive endpoint) → Range(0, 3N^2 - 1)', () => {
      expect(parse('[0,...3N^{2}-1]')).toEqual([
        'Range',
        0,
        ['Add', ['Multiply', 3, ['Power', 'N', 2]], -1],
      ]);
    });

    // Elided-comma stepped form: `a,b...end` — b is a second sample.
    test('`[0,15...210]` (stepped) → Range(0, 210, 15)', () => {
      expect(parse('[0,15...210]')).toEqual(['Range', 0, 210, 15]);
    });

    test('does not leak ContinuationPlaceholder', () => {
      for (const s of ['[0,...300]', '[1,...N]', '[0,15...210]']) {
        expect(JSON.stringify(parse(s))).not.toContain(
          'ContinuationPlaceholder'
        );
      }
    });

    // Nested-group commas must NOT be captured as sequence separators: the
    // comma-less `f(a,b)...5` keeps `f(a,b)` as the range start.
    test('`[f(a,b)...5]` keeps f(a,b) as the start anchor', () => {
      expect(parse('[f(a,b)...5]')).toEqual(['Range', ['f', 'a', 'b'], 5]);
    });

    // Compound-symbolic stepped anchor: all samples share a structurally
    // identical non-numeric additive base (`m+n`) and differ only by a numeric
    // offset (0, 15, …, 60). This narrow class is recognized structurally on
    // the raw MathJSON (no general symbolic differencing) → Range(m+n, m+n+60,
    // 15). The first sample is the bare base (offset 0).
    test('compound-symbolic stepped anchor → Range(m+n, m+n+60, 15)', () => {
      expect(parse('[m+n,m+n+15,...,m+n+60]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 60],
        15,
      ]);
    });

    test('additive-base with intermediate sample validates the progression', () => {
      expect(parse('[m+n,m+n+15,m+n+30,...,m+n+60]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 60],
        15,
      ]);
    });

    test('single-symbol base `[p, p+15, ..., p+60]` → Range(p, p+60, 15)', () => {
      expect(parse('[p, p+15, ..., p+60]')).toEqual([
        'Range',
        'p',
        ['Add', 'p', 60],
        15,
      ]);
    });

    // Negative: samples with differing bases (`m+n` vs `m+k`) are not a shared
    // progression → placeholder List.
    test('differing additive bases stay a placeholder List', () => {
      const result = parse('[m+n, m+k+15, ..., m+n+60]');
      expect(operatorOf(result)).toBe('List');
      expect(JSON.stringify(result)).toContain('ContinuationPlaceholder');
    });

    // FLIPPED (user ruling 2026-08-10, Tycho item 134): a SYMBOLIC offset is
    // still a progression — `[m+n, m+n+x, ..., m+n+60]` steps by `x`. The rule
    // it used to follow ("offsets must be numeric") contradicted the sibling
    // pass one describe-block down, which has emitted symbolic steps since
    // item 117. What still stays a List is an anchor pair that is not ONE
    // family — see the differing-bases test above.
    test('a non-numeric offset is a symbolic step', () => {
      expect(parse('[m+n, m+n+x, ..., m+n+60]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 60],
        'x',
      ]);
    });

    // Negative: a non-arithmetic offset progression (0, 15, 31, …) → List.
    test('inconsistent additive offsets stay a placeholder List', () => {
      const result = parse('[m+n,m+n+15,m+n+31,...,m+n+60]');
      expect(operatorOf(result)).toBe('List');
    });
  });

  // Two-sample fusion over a NUMERIC start with an exact symbolic second
  // anchor (item 117, the `tpalesypcc` class): the step is the second sample
  // itself (start 0) or `s1 - s0`. `Range`'s canonical handler folds that step
  // so a decimal progression stays exact — but ONLY when every symbol in it is
  // a CONSTANT. Folding dereferences an assigned symbol, which baked its value
  // into the canonical form: `[2a, 3a...9a]` with `a := 2` froze step `2`, so
  // re-assigning `a := 3` produced an 11-element range of spacing 2 instead of
  // the 8-element one of spacing 3 — the START moved with `a` while the STEP
  // did not. A step over a non-constant symbol therefore stays unevaluated and
  // re-reads its binding per use (`Range` has supported symbolic steps since
  // item 117); `Pi/4` folds exactly as before.
  describe('two-sample form with exact symbolic second anchor', () => {
    test('`[0, \\frac{\\pi}{4}...2\\pi]` → Range(0, 2π, π/4)', () => {
      expect(parse('\\left[0,\\frac{\\pi}{4}...2\\pi\\right]')).toEqual([
        'Range',
        0,
        ['Multiply', 2, 'Pi'],
        ['Multiply', ['Rational', 1, 4], 'Pi'],
      ]);
    });

    test('`[0, \\frac{2}{d}\\pi...(2-\\frac{2}{d})\\pi]` → Range with symbolic step', () => {
      // The step carries `d`, so it is canonicalized but NOT folded (see the
      // note above); the association differs from the folded form, the value
      // does not.
      expect(
        parse('\\left[0,\\frac{2}{d}\\pi...(2-\\frac{2}{d})\\pi\\right]')
      ).toEqual([
        'Range',
        0,
        ['Multiply', 'Pi', ['Add', ['Divide', -2, 'd'], 2]],
        ['Multiply', 'Pi', ['Divide', 2, 'd']],
      ]);
    });

    test('a step over a NON-constant symbol re-reads its binding', () => {
      const eng = new ComputeEngine();
      eng.assign('a', 2);
      const e = eng.parse('[2a, 3a...9a]');
      expect(e.json).toEqual([
        'Range',
        ['Multiply', 2, 'a'],
        ['Multiply', 9, 'a'],
        'a',
      ]);
      expect(e.evaluate().toString()).toBe('[4,6,8,10,12,14,16,18]');
      eng.assign('a', 3);
      expect(e.evaluate().toString()).toBe('[6,9,12,15,18,21,24,27]');
    });

    // Tycho item 134 / D-17. A SYMBOLIC first anchor fuses, and nothing about
    // the symbol's value is consulted — the parser cannot read one, and a
    // value read here would be frozen into the document's parse. Both anchors
    // and the step stay expressions, so re-assigning the constant re-evaluates
    // the range.
    describe('symbolic first anchor over a bound constant (item 134)', () => {
      const engineWithD = (v: number): ComputeEngine => {
        const eng = new ComputeEngine();
        eng.assign('d_iskdensity', v);
        return eng;
      };
      const WITNESS = '[1+4/d_{iskdensity}, 1+8/d_{iskdensity}...5]';

      test('the D-17 witness fuses to a 500-element range', () => {
        const e = engineWithD(500).parse(WITNESS);
        expect(operatorOf(e.json)).toBe('Range');
        const v = e.evaluate();
        expect(v.count).toBe(500);
        expect(v.at(1)!.toString()).toBe('1.008');
        expect(v.at(500)!.toString()).toBe('5');
      });

      test('the slash and \\frac spellings agree', () => {
        const eng = engineWithD(500);
        expect(eng.parse(WITNESS).json).toEqual(
          eng.parse(
            '[1+\\frac{4}{d_{iskdensity}}, 1+\\frac{8}{d_{iskdensity}}...5]'
          ).json
        );
      });

      test('nothing is baked: re-assigning the constant re-ranges', () => {
        const eng = engineWithD(500);
        const e = eng.parse(WITNESS);
        expect(e.evaluate().count).toBe(500);
        eng.assign('d_iskdensity', 250);
        expect(e.evaluate().count).toBe(250);
        expect(e.evaluate().at(1)!.toString()).toBe('1.016');
        eng.assign('d_iskdensity', 100);
        expect(e.evaluate().count).toBe(100);
      });

      test('an anchor pair that is not one family still stays a List', () => {
        // Drops `n`, picks up `k`: the "step" would be `k+15-n`.
        expect(operatorOf(parse('[m+n, m+k+15, ..., m+n+60]'))).toBe('List');
      });

      test('an application at ANY depth still stays a List', () => {
        expect(operatorOf(parse('[f(1), f(2), \\ldots, f(n)]'))).toBe('List');
        expect(operatorOf(parse('[1+f(1), 1+f(2), \\ldots, 1+f(n)]'))).toBe(
          'List'
        );
      });
    });

    test('`[0, \\frac{1}{1.5}...4]` (float-denominator fraction) fuses', () => {
      const result = parse('\\left[0,\\frac{1}{1.5}...4\\right]');
      expect(operatorOf(result)).toBe('Range');
    });

    test('non-zero numeric start: step is s1 - s0', () => {
      expect(parse('\\left[1,\\frac{3}{2}\\pi...9\\right]')).toEqual([
        'Range',
        1,
        9,
        ['Add', -1, ['Multiply', ['Rational', 3, 2], 'Pi']],
      ]);
    });

    // Negative: function applications are sequence notation, not a
    // progression — the raw apply shape (symbol followed by Delimiter
    // inside InvisibleOperator) is excluded.
    test('`[f(1), f(2), ..., f(n)]` stays a placeholder List', () => {
      const result = parse('\\left[f(1),f(2),\\ldots,f(n)\\right]');
      expect(operatorOf(result)).toBe('List');
    });

    // Negative: a bare-symbol second sample stays sequence notation.
    test('`[0, x_2, ..., x_n]` stays a placeholder List', () => {
      const result = parse('\\left[0,x_2,\\ldots,x_n\\right]');
      expect(operatorOf(result)).toBe('List');
    });
  });

  // The two-sample fusion accepts any numerically KNOWN first anchor, not just
  // a bare numeric literal: an unknowns-free arithmetic composition of numeric
  // literals (`2+1`, `1+0.008`, `1-0.1`, `2\cdot 2`) is a numeric anchor too.
  // The step stays symbolic (`s1 - s0`) and is evaluated exactly by the `Range`
  // canonical handler. (Tycho item 134.)
  describe('two-sample form with a compound NUMERIC first anchor', () => {
    test('`[2+1, 2+2...9]` → Range(3, 9, 1)', () => {
      expect(parse('[2+1, 2+2...9]')).toEqual(['Range', 3, 9, 1]);
      const value = ce.parse('[2+1, 2+2...9]').evaluate();
      expect(value.count).toBe(7);
      expect([...value.each()].map((x) => x.re)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    });

    test('`[2\\cdot 1, 2\\cdot 2...9]` → Range(2, 9, 2)', () => {
      expect(parse('[2\\cdot 1, 2\\cdot 2...9]')).toEqual(['Range', 2, 9, 2]);
      const value = ce.parse('[2\\cdot 1, 2\\cdot 2...9]').evaluate();
      expect(value.count).toBe(4);
      expect([...value.each()].map((x) => x.re)).toEqual([2, 4, 6, 8]);
    });

    // The step is emitted as `Subtract(1+0.016, 1+0.008)` and evaluated
    // exactly — no `1.016 - 1.008` float dust — so the range lands ON its end
    // anchor (500 samples, last one exactly 5).
    test('`[1+0.008, 1+0.016...5]` → exact 0.008 step', () => {
      expect(parse('[1+0.008, 1+0.016...5]')).toEqual([
        'Range',
        ['Add', 1, 0.008],
        5,
        0.008,
      ]);
      const value = ce.parse('[1+0.008, 1+0.016...5]').evaluate();
      expect(value.count).toBe(500);
      const elements = [...value.each()].map((x) => x.re);
      expect(elements[0]).toBe(1.008);
      expect(elements[1]).toBe(1.016);
      expect(elements[elements.length - 1]).toBe(5);
    });

    // Decreasing progression from a `Subtract`-shaped anchor pair.
    test('`[1-0.1, 1-0.2...0]` → Range(0.9, 0, -0.1)', () => {
      expect(parse('[1-0.1, 1-0.2...0]')).toEqual([
        'Range',
        ['Add', 1, -0.1],
        0,
        -0.1,
      ]);
      const value = ce.parse('[1-0.1, 1-0.2...0]').evaluate();
      expect(value.count).toBe(10);
      const elements = [...value.each()].map((x) => x.re);
      expect(elements[0]).toBe(0.9);
      expect(elements[1]).toBe(0.8);
      expect(elements[elements.length - 1]).toBe(0);
    });

    // Pin: plain decimal-literal anchors difference their step EXACTLY (via
    // the samples' decimal digits, not JS float subtraction), matching the
    // compound-anchor path: `1.016 - 1.008` in doubles is
    // 0.008000000000000007, which under-shot the range to 499 samples ending
    // at ~4.992 instead of landing on the 5 anchor.
    test('`[1.008, 1.016...5]` (plain literals) gets an exact step', () => {
      expect(parse('[1.008, 1.016...5]')).toEqual(['Range', 1.008, 5, 0.008]);
      const value = ce.parse('[1.008, 1.016...5]').evaluate();
      expect(value.count).toBe(500);
      const elements = [...value.each()].map((x) => x.re);
      expect(elements[0]).toBe(1.008);
      expect(elements[elements.length - 1]).toBe(5);
    });

    // Pin: a step that is genuinely a long-double artifact (no short decimal
    // form) falls back to float differencing unchanged.
    test('a 17-digit double sample keeps its float step', () => {
      expect(parse('[0.1, 0.30000000000000004...1]')).toEqual([
        'Range',
        0.1,
        1,
        0.20000000000000004,
      ]);
    });

    // Pin: exact rational literal anchors keep taking the exact numeric path.
    test('`[\\frac{1}{2}, \\frac{1}{3}...0]` → Range(1/2, 0, -1/6)', () => {
      expect(parse('[\\frac{1}{2}, \\frac{1}{3}...0]')).toEqual([
        'Range',
        ['Rational', 1, 2],
        0,
        ['Rational', -1, 6],
      ]);
      expect(ce.parse('[\\frac{1}{2}, \\frac{1}{3}...0]').evaluate().count).toBe(
        4
      );
    });

    // Pin: a symbolic multiplicative progression keeps taking the
    // coefficient-times-symbol path (never reaches the two-sample fusion).
    test('`[2a, 3a...9a]` → Range(2a, 9a, a)', () => {
      expect(parse('[2a, 3a...9a]')).toEqual([
        'Range',
        ['Multiply', 2, 'a'],
        ['Multiply', 9, 'a'],
        'a',
      ]);
    });

    // Negative (item 47): a first anchor with a free variable is NOT
    // numerically known — differing bases stay a placeholder List.
    test('`[m+n, m+k+15, ..., m+k+60]` stays a placeholder List', () => {
      const result = parse('[m+n, m+k+15, ..., m+k+60]');
      expect(operatorOf(result)).toBe('List');
      expect(JSON.stringify(result)).toContain('ContinuationPlaceholder');
    });

    // Negative (item 47): non-numeric offset stays a placeholder List.
    // FLIPPED with its sibling above (user ruling 2026-08-10).
    test('`[m+n, m+n+x, ..., m+n+60]` is a symbolic-step Range', () => {
      expect(parse('[m+n, m+n+x, ..., m+n+60]')).toEqual([
        'Range',
        ['Add', 'm', 'n'],
        ['Add', 'm', 'n', 60],
        'x',
      ]);
    });

    // Negative: the application shape is excluded at EVERY level of the
    // numeric reduction, so a compound anchor built from one stays a List.
    test('`[f(1), f(2), ..., f(n)]` stays a placeholder List', () => {
      expect(operatorOf(parse('[f(1), f(2), \\ldots, f(n)]'))).toBe('List');
      expect(operatorOf(parse('[1+f(1), 1+f(2), \\ldots, 1+f(n)]'))).toBe(
        'List'
      );
    });
  });

  // An explicit `\operatorname{Range}(a,b)` element is a literal list entry,
  // NOT an ellipsis/`..` continuation: the range-inference normalization must
  // fire only for infix-produced (`..`/`...`/`\ldots`/`\dots`) ranges.
  describe('explicit Range() element is not a continuation', () => {
    test('`[3, \\operatorname{Range}(1,5)]` → List(3, Range(1, 5))', () => {
      expect(parse('[3, \\operatorname{Range}(1,5)]')).toEqual([
        'List',
        3,
        ['Range', 1, 5],
      ]);
    });

    test('`[x, \\operatorname{Range}(2,9)]` → List(x, Range(2, 9))', () => {
      expect(parse('[x, \\operatorname{Range}(2,9)]')).toEqual([
        'List',
        'x',
        ['Range', 2, 9],
      ]);
    });

    // The programmatic `..` idiom IS a continuation and stays a Range.
    test('programmatic `[1, 3..10]` still infers Range(1, 10, 2)', () => {
      expect(parse('[1, 3..10]')).toEqual(['Range', 1, 10, 2]);
    });
  });

  describe('error cases', () => {
    test('inconsistent intermediate sample → parse error', () => {
      // step is 0.1 but third element is 0.5 (not 0.2)
      const result = ce.parse('\\left[0, 0.1, 0.5, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });

    test('degenerate step (b - a = 0) → parse error', () => {
      const result = ce.parse('\\left[1, 1, \\ldots, 5\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('custom ce.tolerance is respected', () => {
    test('loose tolerance (0.01) accepts slightly-off first gap', () => {
      // samples = [0, 0.1, 0.21]; step = last diff = 0.21 - 0.1 = 0.11
      // first gap: 0.1 - 0 - 0.11 = -0.01, abs = 0.01 ≤ tol (0.01) → accepted
      const ceLoose = new ComputeEngine();
      ceLoose.tolerance = 0.01;
      const result = ceLoose.parse(
        '\\left[0, 0.1, 0.21, \\ldots, 1\\right]'
      ).json;
      // step comes from the last two samples: 0.21 - 0.1
      expect(result).toMatchObject(['Range', 0, 1, expect.closeTo(0.11, 10)]);
    });

    test('tight tolerance (1e-12) rejects the same off step', () => {
      // same 0.01 discrepancy now exceeds tolerance → parse error
      const ceTight = new ComputeEngine();
      ceTight.tolerance = 1e-12;
      const result = ceTight.parse('\\left[0, 0.1, 0.21, \\ldots, 1\\right]');
      expect(result.isValid).toBe(false);
    });
  });

  describe('outside list literal: \\ldots stays ContinuationPlaceholder', () => {
    test('bare \\ldots parses as ContinuationPlaceholder symbol', () => {
      // Outside a list-range context \ldots must remain a plain symbol, not
      // trigger any Range parsing.  Use json directly (no boxing) to avoid the
      // pre-existing "cannot change type of constant" throw in Add.
      const raw = ce.parse('\\ldots').json;
      expect(raw).toEqual('ContinuationPlaceholder');
    });
  });

  // A scalar juxtaposed with a list/vector-*typed* operand is scaling
  // (`Multiply`), not a silent `Tuple`. This matters for a scaled `\frac`
  // whose numerator is a list/range: `2\frac{[…]}{8}` — the scaled numerator
  // has type `vector<N>`/`list<number>` but is not yet a concrete collection.
  // The two scalar factors fold: a canonical `Multiply` is flat, so the `2`
  // and the `1/8` contributed by the `\frac` are direct operands of the same
  // product and combine to `1/4`.
  describe('scalar · list scaling (not Tuple)', () => {
    test('`2\\frac{[0,...,8]}{8}` scales the range', () => {
      expect(parse('2\\frac{\\left[0,...,8\\right]}{8}')).toEqual([
        'Multiply',
        ['Rational', 1, 4],
        ['Range', 0, 8],
      ]);
    });

    test('`2\\frac{[1,2,3]}{8}` scales the list literal', () => {
      expect(parse('2\\frac{\\left[1,2,3\\right]}{8}')).toEqual([
        'Multiply',
        ['Rational', 1, 4],
        ['List', 1, 2, 3],
      ]);
    });

    test('scalar times a vector-typed symbol is a Multiply', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('v', 'vector<3>');
      expect(ce2.parse('2v').json).toEqual(['Multiply', 2, 'v']);
    });

    test('a genuine tuple is NOT turned into a Multiply', () => {
      // `(3,4)` is a heterogeneous tuple; scaling keeps the tuple intact.
      expect(parse('2\\left(3,4\\right)')).toEqual([
        'Multiply',
        2,
        ['Tuple', 3, 4],
      ]);
    });

    test('Desmos corpus row parses valid (P undeclared)', () => {
      const expr = ce.parse(
        '1>0\\ \\left\\{\\ P\\left(x,y\\right)\\le\\ 0.6\\cdot\\left(2\\frac{\\left[0,...,8\\right]}{8}-1\\right)\\right\\}'
      );
      expect(expr.isValid).toBe(true);
    });
  });

  // A brace-set ellipsis sequence denotes an integer range, exactly like the
  // bracket form: `{1, \dots, 9}` → Range(1, 9), NOT a 3-element Set with a
  // stray `ContinuationPlaceholder`. Non-progression brace sets are untouched.
  describe('brace-set ellipsis form {a, \\dots, b}', () => {
    test('`\\{1, \\dots, 9\\}` → Range(1, 9)', () => {
      expect(parse('\\{1, \\dots, 9\\}')).toEqual(['Range', 1, 9]);
    });

    test('`\\{0, 2, \\dots, 10\\}` (stepped) → Range(0, 10, 2)', () => {
      expect(parse('\\{0, 2, \\dots, 10\\}')).toEqual(['Range', 0, 10, 2]);
    });

    test('`\\{a, b, c\\}` stays a Set (non-numeric)', () => {
      expect(parse('\\{a, b, c\\}')).toEqual(['Set', 'a', 'b', 'c']);
    });

    test('`\\{1, 2, 3\\}` stays a Set (no ellipsis)', () => {
      expect(parse('\\{1, 2, 3\\}')).toEqual(['Set', 1, 2, 3]);
    });
  });

  // Gate 4 of the two-sample fusion: subscripted symbols name members of an
  // indexed family, and anchors that move through the family (`x_1` in the
  // first, `x_2` in the second) enumerate it, whatever arithmetic wraps the
  // members. The cumulative shape is the one the abandoned-symbol gate (gate
  // 3) lets through: the second anchor KEEPS `x_1` and adds `x_2`. The row is
  // from docs/mathnet/parser-test-cases.json, where it round-tripped as a
  // `Range` whose "step" was the difference of two unrelated fractions.
  describe('an indexed family with cumulative anchors is not a progression', () => {
    test('the corpus `\\max` set keeps its ContinuationPlaceholder', () => {
      expect(
        parse(
          '\\max\\left\\{\\frac{x_1}{1+x_1}, \\frac{x_2}{1+x_1+x_2}, \\dots, \\frac{x_n}{1+x_1+x_2+\\dots+x_n}\\right\\}'
        )
      ).toEqual([
        'Max',
        [
          'Set',
          ['Divide', 'x_1', ['Add', 'x_1', 1]],
          ['Divide', 'x_2', ['Add', 'x_1', 'x_2', 1]],
          'ContinuationPlaceholder',
          ['Divide', 'x_n', ['Add', 1, 'x_1', 'x_2', 'ContinuationPlaceholder', 'x_n']],
        ],
      ]);
    });

    // The two tests below read the NON-canonical parse: the step of a
    // symbolic-anchor range is emitted as `Subtract(s1, s0)`, and its
    // canonical spelling is not what is under test here.
    test('the bracket form is a placeholder List', () => {
      expect(
        ce.parse(
          '[1+\\frac{a_1}{2}, 1+\\frac{a_1}{2}+\\frac{a_2}{2}, ..., 9]',
          { canonical: false }
        ).json
      ).toEqual([
        'List',
        ['Add', 1, ['Divide', 'a_1', 2]],
        ['Add', 1, ['Divide', 'a_1', 2], ['Divide', 'a_2', 2]],
        'ContinuationPlaceholder',
        9,
      ]);
    });

    test('a gained PLAIN symbol is still a step', () => {
      // Both anchors mention exactly the member `a_1`; `h` is the step.
      const raw = ce.parse('[2a_1, 2a_1+h, ..., 2a_1+nh]', {
        canonical: false,
      }).json;
      expect(operatorOf(raw)).toBe('Range');
      expect((raw as Expression[])[3]).toEqual([
        'Subtract',
        ['Add', ['InvisibleOperator', 2, 'a_1'], 'h'],
        ['InvisibleOperator', 2, 'a_1'],
      ]);
    });

    test('a gained member of ANOTHER family is still a step', () => {
      // `h_2` is subscripted, but the first anchor mentions no `h_…`.
      const raw = ce.parse('[2a_1, 2a_1+h_2, ..., 2a_1+10h_2]', {
        canonical: false,
      }).json;
      expect(operatorOf(raw)).toBe('Range');
    });

    test('a gained member of the SAME family is an enumeration', () => {
      expect(
        ce.parse('[2x_1, 2x_1+x_2, ..., 2x_1+x_n]', { canonical: false }).json
      ).toEqual([
        'List',
        ['InvisibleOperator', 2, 'x_1'],
        ['Add', ['InvisibleOperator', 2, 'x_1'], 'x_2'],
        'ContinuationPlaceholder',
        ['Add', ['InvisibleOperator', 2, 'x_1'], 'x_n'],
      ]);
    });

    test('numeric offsets on one member are still a progression', () => {
      expect(parse('[a_1+1, a_1+2, ..., a_1+9]')).toEqual([
        'Range',
        ['Add', 'a_1', 1],
        ['Add', 'a_1', 9],
        1,
      ]);
    });
  });
});

describe('Range under arithmetic parents round-trips (Tycho item 48)', () => {
  // `..` parses its END operand at minPrec 270 (below Add), so a serialized
  // `Range` operand must be parenthesized under any tighter-binding parent —
  // `Add(Range(0, L-1), 3)` used to serialize as `0..(L-1)+3`, which
  // re-parses as `Range(0, L+2)`: WRONG values (8 elements instead of a
  // shifted 5). Item-12/21/37 precedence class, `..`-serializer side.
  it('Add(Range(0, L-1), 3) round-trips value-stable', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', ['Range', 0, ['Subtract', 'L', 1]], 3], {
      canonical: false,
    });
    const rt = ce.parse(e.latex);
    expect(rt.operator).toBe('Add');
    ce.assign('L', 5);
    expect(rt.evaluate().json).toEqual(['List', 3, 4, 5, 6, 7]);
  });

  it('Range wraps under Multiply, Power, and Subtract parents', () => {
    const ce = new ComputeEngine();
    const mul = ce.box(['Multiply', 2, ['Range', 1, 'n']], {
      canonical: false,
    });
    expect(ce.parse(mul.latex).operator).toBe('Multiply');
    const pow = ce.box(['Power', ['Range', 1, 'n'], 2], { canonical: false });
    expect(ce.parse(pow.latex).operator).toBe('Power');
    const sub = ce.box(['Subtract', ['Range', 0, 'L'], 3], {
      canonical: false,
    });
    const rtSub = ce.parse(sub.latex);
    expect(rtSub.operator === 'Subtract' || rtSub.operator === 'Add').toBe(
      true
    );
    expect(JSON.stringify(rtSub.json)).toContain('"Range",0,"L"');
  });

  it('bare and stepped Range serialization is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Range', 0, 210, 15], { canonical: false }).latex).toBe(
      '0..15..210'
    );
    expect(
      ce.parse(ce.box(['Range', 0, 210, 15], { canonical: false }).latex).json
    ).toEqual(['Range', 0, 210, 15]);
  });
});

// Fused stepped forms whose second anchor is a fraction or compound
// expression (Tycho item 47 residual). The fraction form needs an EXACT
// step (a float `0.1666…` drifts and can miss the end anchor); the additive
// form's continuation range is EMBEDDED in the additive tail (`...` binds
// its LHS tight, so `m+n+15...m+n+60` parses as
// `Add(m, n, Range(15, m+n+60))`).
describe('fused ranges with fraction/compound second anchor (Tycho item 47 residual)', () => {
  test('`[0,\\frac{1}{6}...1]` → Range(0, 1, 1/6), exact step', () => {
    expect(parse('\\left[0,\\frac{1}{6}...1\\right]')).toEqual([
      'Range',
      0,
      1,
      ['Rational', 1, 6],
    ]);
    // The exact step makes the end anchor land exactly: 7 elements, last = 1.
    const r = ce
      .parse('\\left[0,\\frac{1}{6}...1\\right]', { strict: false })
      .evaluate();
    expect(r.count).toBe(7);
    const els = [...r.each()];
    expect(els[els.length - 1].isSame(1)).toBe(true);
  });

  test('`[1,\\frac{3}{2}...4]` → Range(1, 4, 1/2)', () => {
    expect(parse('\\left[1,\\frac{3}{2}...4\\right]')).toEqual([
      'Range',
      1,
      4,
      ['Rational', 1, 2],
    ]);
  });

  test('`[m+n,m+n+15...m+n+60]` → Range(m+n, m+n+60, 15)', () => {
    expect(parse('\\left[m+n,m+n+15...m+n+60\\right]')).toEqual([
      'Range',
      ['Add', 'm', 'n'],
      ['Add', 'm', 'n', 60],
      15,
    ]);
  });

  test('inconsistent fraction samples → parse error', () => {
    const result = parse(
      '\\left[0,\\frac{1}{6},\\frac{1}{2}...1\\right]'
    ) as Expression[];
    expect(JSON.stringify(result)).toContain('inconsistent-range-samples');
  });

  test('an explicit Range() element still stays a literal List entry', () => {
    expect(parse('\\left[3,\\operatorname{Range}(1,5)\\right]')).toEqual([
      'List',
      3,
      ['Range', 1, 5],
    ]);
  });

  test('an embedded EXPLICIT Range in an additive tail stays a List', () => {
    // No ellipsis provenance → no continuation rewrite.
    const result = parse(
      '\\left[m+n,m+n+\\operatorname{Range}(15,60)\\right]'
    );
    expect(operatorOf(result)).toBe('List');
  });
});

// The range infixes bind above `+` (`..` also above implicit multiplication
// and the prefix minus), so a compound FIRST anchor is split by the parse:
// `n+1..n+10` → `Add(n, Range(1, n+10))`, `2n..3n` →
// `InvisibleOperator(2, Range(n, 3n))`. A provenance-tagged post-parse pass
// rebuilds the intended anchor. Unlike the bracket repair, this one runs on
// the whole parse tree, so the BARE and relation-embedded forms work too.
describe('compound first anchor outside a bracket', () => {
  test('`n+1..n+10` (bare additive anchor) → Range(n+1, n+10)', () => {
    expect(parse('n+1..n+10')).toEqual([
      'Range',
      ['Add', 'n', 1],
      ['Add', 'n', 10],
    ]);
  });

  test('`n+1...n+10` (`...` spelling) → Range(n+1, n+10)', () => {
    expect(parse('n+1...n+10')).toEqual([
      'Range',
      ['Add', 'n', 1],
      ['Add', 'n', 10],
    ]);
  });

  test('`x = n+1..n+10` (relation-embedded) → Equal(x, Range(n+1, n+10))', () => {
    expect(parse('x = n+1..n+10')).toEqual([
      'Equal',
      'x',
      ['Range', ['Add', 'n', 1], ['Add', 'n', 10]],
    ]);
  });

  test('`n+1..10` (compound start, plain end) → Range(n+1, 10)', () => {
    expect(parse('n+1..10')).toEqual(['Range', ['Add', 'n', 1], 10]);
  });

  test('`m-1..m+3` (subtractive anchor) → Range(m-1, m+3)', () => {
    expect(parse('m-1..m+3')).toEqual([
      'Range',
      ['Add', 'm', -1],
      ['Add', 'm', 3],
    ]);
  });

  test('`2n..3n` (bare multiplicative anchor) → Range(2n, 3n)', () => {
    expect(parse('2n..3n')).toEqual([
      'Range',
      ['Multiply', 2, 'n'],
      ['Multiply', 3, 'n'],
    ]);
  });

  test('`-3..9` (prefix minus anchor) → Range(-3, 9)', () => {
    expect(parse('-3..9')).toEqual(['Range', -3, 9]);
  });

  test('`-2n..3n` (signed coefficient anchor) → Range(-2n, 3n)', () => {
    expect(parse('-2n..3n')).toEqual([
      'Range',
      ['Multiply', -2, 'n'],
      ['Multiply', 3, 'n'],
    ]);
  });

  // Bracketed multiplicative anchors: the `...` spelling already worked
  // (it binds below implicit multiplication); `..` needed the repair.
  test('`[2n..3n]` → Range(2n, 3n)', () => {
    expect(parse('\\left[2n..3n\\right]')).toEqual([
      'Range',
      ['Multiply', 2, 'n'],
      ['Multiply', 3, 'n'],
    ]);
  });

  test('`[2n+1..3n+10]` (mixed anchor) → Range(2n+1, 3n+10)', () => {
    expect(parse('\\left[2n+1..3n+10\\right]')).toEqual([
      'Range',
      ['Add', ['Multiply', 2, 'n'], 1],
      ['Add', ['Multiply', 3, 'n'], 10],
    ]);
  });

  // Opt-out: an explicitly parenthesized range is a broadcast operation, not
  // a mis-bound anchor. The `Delimiter` blocks the shape match AND the
  // continuation provenance is cleared when the group is parsed.
  test('`n+(1..10)` stays a broadcast Add', () => {
    expect(parse('n+(1..10)')).toEqual(['Add', 'n', ['Range', 1, 10]]);
  });

  test('`2(1..5)` stays a broadcast Multiply', () => {
    expect(parse('2(1..5)')).toEqual(['Multiply', 2, ['Range', 1, 5]]);
  });

  // A BRACKET is a delimiter too: the range it yields is a list operand, not
  // a mis-split anchor. `\frac{2}{20}\cdot[0…20] - 1` must stay the scaled
  // list (21 rationals from -1 to 1), not `Range(0, 20) - 1`.
  test('a bracket-delimited range is a broadcast operand, not an anchor', () => {
    const e = ce.parse(
      '\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1'
    );
    expect(operatorOf(e.json)).not.toBe('Range');
    const v = e.evaluate();
    expect(v.count).toBe(21);
    expect(v.at(1)!.is(-1)).toBe(true);
    expect(v.at(21)!.is(1)).toBe(true);
  });

  // FLIPPED (Tycho item 134 / D-17). `Divide` used to be the one operator that
  // captured the ellipsis into its right operand: the prose ellipsis sat above
  // the `/` rhs floor, so the anchor of `1/2...5` was the DENOMINATOR alone.
  // Every other anchor shape — `+`, `*`, `^`, the implicit product, and
  // `\frac` (a primary) — already took the whole preceding element, which made
  // the same expression parse two ways depending on how the division was
  // spelled: `[1+\frac{8}{d}...5]` anchored on `1+8/d`, `[1+8/d...5]` on `d`.
  // The witness `[1+4/d_{iskdensity}, 1+8/d_{iskdensity}...5]` is exactly that
  // shape, and it parsed as `1 + 8/Range(d_iskdensity, 5)`.
  //
  // The constraint this replaces — "must stay above the `/` rhs so `1/(2...5)`
  // broadcast division is unchanged" — was about a PARENTHESIZED operand,
  // which no precedence can reach; both forms are pinned below.
  test('`1/2...5` anchors on the whole quotient', () => {
    expect(parse('1/2...5')).toEqual(['Range', ['Rational', 1, 2], 5]);
    // The slash and `\frac` spellings of one expression now agree.
    expect(parse('1/2...5')).toEqual(parse('\\frac{1}{2}...5'));
  });

  test('a PARENTHESIZED range still divides (broadcast)', () => {
    expect(parse('1/(2...5)')).toEqual(['Divide', 1, ['Range', 2, 5]]);
    expect(parse('2/(1...3)')).toEqual(['Divide', 2, ['Range', 1, 3]]);
  });

  // Round-trips: the TEXT `n+1..10` now means `Range(n+1, 10)`, so a genuine
  // `Add(n, Range(1, 10))` must serialize with explicit parens.
  test('Range(n+1, 10) → LaTeX → same Range', () => {
    const e = ce.box(['Range', ['Add', 'n', 1], 10]);
    expect(ce.parse(e.latex).json).toEqual(['Range', ['Add', 'n', 1], 10]);
  });

  test('Add(n, Range(1, 10)) → LaTeX → same Add', () => {
    const e = ce.box(['Add', 'n', ['Range', 1, 10]]);
    expect(e.latex).toBe('n+(1..10)');
    expect(ce.parse(e.latex).json).toEqual(['Add', 'n', ['Range', 1, 10]]);
  });

  test('Range(2n, 3n) and Multiply(2, Range(1, 5)) round-trip distinctly', () => {
    const r = ce.box(['Range', ['Multiply', 2, 'n'], ['Multiply', 3, 'n']]);
    expect(ce.parse(r.latex).json).toEqual([
      'Range',
      ['Multiply', 2, 'n'],
      ['Multiply', 3, 'n'],
    ]);
    const m = ce.box(['Multiply', 2, ['Range', 1, 5]]);
    expect(ce.parse(m.latex).json).toEqual(['Multiply', 2, ['Range', 1, 5]]);
  });
});
