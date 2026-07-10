import { ComputeEngine } from '../../src/compute-engine';
import '../utils'; // For snapshot serializers

const ce = new ComputeEngine();
ce.declare('x', 'number');
ce.declare('a', 'number');
ce.declare('b', 'number');
ce.declare('f', 'function');

function parse(latex: string) {
  return ce.parse(latex).json;
}

describe('Parser: restriction braces', () => {
  describe('basic restriction', () => {
    test('`f(x)\\{0 < x < 2\\}` → When(f(x), 0 < x < 2)', () => {
      const ast = parse('f(x)\\left\\{0 < x < 2\\right\\}');
      expect(ast).toEqual([
        'When',
        ['f', 'x'],
        ['Less', 0, 'x', 2],
      ]);
    });

    test('bare symbol: `x\\{cond\\}` → When(x, cond)', () => {
      const ast = parse('x\\left\\{x > 0\\right\\}');
      // x > 0 canonicalizes to Less(0, x)
      expect(ast).toEqual(['When', 'x', ['Less', 0, 'x']]);
    });
  });

  describe('stacked restrictions canonicalize to And', () => {
    test('`e\\{c_1\\}\\{c_2\\}` → When(e, And(c_1, c_2))', () => {
      const ast = parse('x\\left\\{x>0\\right\\}\\left\\{x<10\\right\\}');
      // x > 0 canonicalizes to Less(0, x)
      expect(ast).toEqual([
        'When',
        'x',
        ['And', ['Less', 0, 'x'], ['Less', 'x', 10]],
      ]);
    });
  });

  describe('disambiguation from set literal', () => {
    test('standalone `\\{1, 2, 3\\}` is still a set literal', () => {
      const ast = parse('\\left\\{1, 2, 3\\right\\}');
      expect(Array.isArray(ast) && (ast as any[])[0]).toBe('Set');
    });
  });

  describe('evaluation', () => {
    test('When(5, True) evaluates to 5', () => {
      const result = ce.expr(['When', 5, 'True']).evaluate();
      expect(result.json).toBe(5);
    });

    test('When(5, False) evaluates to Undefined', () => {
      const result = ce.expr(['When', 5, 'False']).evaluate();
      expect(result.json).toBe('Undefined');
    });

    test('When(5, x > 0) holds when x has no value', () => {
      const ce2 = new ComputeEngine();
      const result = ce2.expr(['When', 5, ['Greater', 'x', 0]]).evaluate();
      expect(result.operator).toBe('When');
    });
  });

  describe('parser recovery on malformed input', () => {
    test('missing close: `f(x)\\{cond` does not corrupt subsequent parses', () => {
      // Missing \right\}. The When-restriction parse function should clean up
      // its boundary on the close-mismatch path; if it leaks, the next parse
      // would see a stray boundary on the parser stack.
      ce.parse('f(x)\\left\\{x > 0').json; // intentionally malformed
      // Subsequent parse must still produce a normal AST. Use a non-folding
      // expression so the assertion exercises the parser's structure, not
      // numeric constant folding.
      const after = parse('a + b');
      expect(after).toEqual(['Add', 'a', 'b']);
    });
  });

  describe('round-trip serialization', () => {
    test('When(e, And(c1, c2)) serializes to stacked braces', () => {
      const expr = ce.expr([
        'When',
        'x',
        ['And', ['Greater', 'x', 0], ['Less', 'x', 10]],
      ]);
      const latex = expr.toLatex();
      // Greater(x,0) canonicalizes to Less(0,x) → serializes as 0\lt x
      // Should emit stacked braces (not \wedge inside a single pair of braces)
      expect(latex).toMatch(/\\left\\\{.*\\right\\\}.*\\left\\\{.*\\right\\\}/);
      // Both conditions appear somewhere in the output
      expect(latex).toContain('0');
      expect(latex).toContain('10');
    });

    test('source and canonical forms round-trip to same AST', () => {
      const a = parse('x\\left\\{x>0\\right\\}\\left\\{x<10\\right\\}');
      const b = parse('x\\left\\{x>0 \\wedge x<10\\right\\}');
      expect(a).toEqual(b);
    });
  });

  // Desmos comma form: each element of `\{c1, c2\}` is piecewise shorthand
  // for `cond: 1` evaluated first-match — the expression is defined where ANY
  // condition holds. Comma = union (Or); stacked braces still AND-combine.
  // (Tycho 0.72.0 restriction-brace probe, issue 2. Corpus proof: under And,
  // `\{x>4, x<0\}` would be unsatisfiable; the Desmos graph shows segments.)
  describe('comma-separated conditions combine as Or', () => {
    test('`x^2\\{x\\ge0, x\\le3\\}` → When(x^2, Or(...))', () => {
      const ast = parse('x^2\\left\\{x\\ge0, x\\le3\\right\\}');
      expect(ast).toEqual([
        'When',
        ['Power', 'x', 2],
        ['Or', ['LessEqual', 0, 'x'], ['LessEqual', 'x', 3]],
      ]);
    });

    test('bare (non-\\left) braces parse the same', () => {
      expect(parse('x^2\\{x\\ge0, x\\le3\\}')).toEqual(
        parse('x^2\\left\\{x\\ge0, x\\le3\\right\\}')
      );
    });

    test('three disjoint segments stay satisfiable (corpus shape)', () => {
      const ast = parse('x\\left\\{x>4, x<0, |x-2|<0.5\\right\\}');
      expect(ast).toEqual([
        'When',
        'x',
        [
          'Or',
          ['Less', 4, 'x'],
          ['Less', 'x', 0],
          ['Less', ['Abs', ['Add', 'x', -2]], 0.5],
        ],
      ]);
    });

    test('comma-Or restriction compiles to a masking ternary', () => {
      const expr = ce.parse('x\\left\\{x>4, x<0\\right\\}');
      const run = ce.getCompilationTarget('javascript')!.compile(expr).run!;
      expect(run({ x: 5 })).toBe(5);
      expect(run({ x: -1 })).toBe(-1);
      expect(run({ x: 2 })).toBeNaN();
    });
  });

  // Desmos colon groups: `\{cond: val, …\}` is a piecewise *value selector* —
  // a brace group is a first-class value in Desmos ({cond} ≡ {cond: 1})
  // attached by juxtaposition, i.e. multiplication. Parses to
  // Multiply(lhs, Which(...)); a trailing bare value is the else branch.
  // (Tycho 0.72.0 restriction-brace probe, issue 3 — the previous parse
  // treated the cond:val pairs as a When *gate* for the body.)
  describe('colon groups parse to a Which value selector', () => {
    test('`x\\{x>0:1, x<0:-1\\}` → Multiply(x, Which(...))', () => {
      const ast = parse('x\\left\\{x>0:1, x<0:-1\\right\\}');
      expect(ast).toEqual([
        'Multiply',
        'x',
        ['Which', ['Less', 0, 'x'], 1, ['Less', 'x', 0], -1],
      ]);
    });

    test('trailing bare value is the else branch', () => {
      const ast = parse('x\\left\\{x>0:1, -1\\right\\}');
      expect(ast).toEqual([
        'Multiply',
        'x',
        ['Which', ['Less', 0, 'x'], 1, 'True', -1],
      ]);
    });

    test('a bare condition inside a colon group means cond: 1', () => {
      const ast = parse('x\\left\\{x>0:5, x<-1\\right\\}');
      expect(ast).toEqual([
        'Multiply',
        'x',
        ['Which', ['Less', 0, 'x'], 5, ['Less', 'x', -1], 1],
      ]);
    });

    test('single colon pair (no comma)', () => {
      const ast = parse('f(x)\\left\\{x>0:2\\right\\}');
      expect(ast).toEqual([
        'Multiply',
        ['f', 'x'],
        ['Which', ['Less', 0, 'x'], 2],
      ]);
    });

    test('colon group evaluates with Desmos multiplication semantics', () => {
      // x·{x>0:1, x<0:-1} = |x|
      const f = ce.parse('x\\left\\{x>0:1, x<0:-1\\right\\}');
      expect(f.subs({ x: 2 }).evaluate().toString()).toBe('2');
      expect(f.subs({ x: -3 }).evaluate().toString()).toBe('3');
    });

    test('colon group compiles to chained ternaries with NaN fallthrough', () => {
      const f = ce.parse('x\\left\\{x>0:1, x<0:-1\\right\\}');
      const run = ce.getCompilationTarget('javascript')!.compile(f).run!;
      expect(run({ x: 2 })).toBe(2);
      expect(run({ x: -3 })).toBe(3);
      expect(run({ x: 0 })).toBeNaN();
    });
  });
});
