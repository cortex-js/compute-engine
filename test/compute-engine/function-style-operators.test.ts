import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('Function-style aliases for existing operators', () => {
  test('\\operatorname{mod}(a, b) parses to Mod and evaluates', () => {
    const expr = ce.parse('\\operatorname{mod}(7, 3)');
    expect(expr.operator).toBe('Mod');
    expect(expr.evaluate().re).toBe(1);
  });

  test('\\operatorname{var}(L) parses to Variance', () => {
    const expr = ce.parse('\\operatorname{var}([1, 2, 3, 4])');
    expect(expr.operator).toBe('Variance');
    expect(expr.evaluate().re).toBeCloseTo(5 / 3, 6);
  });

  test('\\operatorname{shuffle}(L) parses to Shuffle', () => {
    const expr = ce.parse('\\operatorname{shuffle}([1, 2, 3])');
    expect(expr.operator).toBe('Shuffle');
    const out = expr.evaluate();
    expect(out.operator).toBe('List');
    expect(out.ops!.length).toBe(3);
  });

  test('\\operatorname{join}(L, M) parses to Join', () => {
    const expr = ce.parse('\\operatorname{join}([1, 2], [3, 4])');
    expect(expr.operator).toBe('Join');
  });

  test('\\operatorname{repeat}(x) parses to Repeat', () => {
    const expr = ce.parse('\\operatorname{repeat}(7)');
    expect(expr.operator).toBe('Repeat');
  });

  test('\\operatorname{random}() parses to Random', () => {
    const expr = ce.parse('\\operatorname{random}()');
    expect(expr.operator).toBe('Random');
    const v = expr.evaluate().re;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('Distance', () => {
  test('2D Euclidean distance', () => {
    const expr = ce.expr(['Distance', ['Tuple', 0, 0], ['Tuple', 3, 4]]);
    expect(expr.evaluate().re).toBe(5);
  });

  test('3D Euclidean distance', () => {
    const expr = ce.expr([
      'Distance',
      ['Tuple', 1, 2, 3],
      ['Tuple', 4, 6, 3],
    ]);
    expect(expr.evaluate().re).toBe(5);
  });

  test('zero distance', () => {
    const expr = ce.expr(['Distance', ['Tuple', 1, 2], ['Tuple', 1, 2]]);
    expect(expr.evaluate().re).toBe(0);
  });

  test('mismatched dimensions returns error', () => {
    const expr = ce.expr([
      'Distance',
      ['Tuple', 1, 2],
      ['Tuple', 1, 2, 3],
    ]);
    expect(expr.evaluate().operator).toBe('Error');
  });

  test('LaTeX round-trips', () => {
    const expr = ce.parse('\\operatorname{distance}((0, 0), (3, 4))');
    expect(expr.operator).toBe('Distance');
    expect(expr.evaluate().re).toBe(5);
    expect(expr.toLatex()).toContain('\\operatorname{distance}');
  });
});

describe('Geometric primitive heads (opaque)', () => {
  test('Triangle is recognized but not evaluated', () => {
    const expr = ce.expr(['Triangle', 1, 2, 3]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Triangle');
    expect(result.ops!.length).toBe(3);
  });

  test('Sphere is recognized', () => {
    const expr = ce.parse('\\operatorname{sphere}((0, 0, 0), 1)');
    expect(expr.operator).toBe('Sphere');
  });

  test('Segment is recognized', () => {
    const expr = ce.parse('\\operatorname{segment}((0, 0), (1, 1))');
    expect(expr.operator).toBe('Segment');
  });

  test('Triangle round-trips through LaTeX', () => {
    const expr = ce.parse('\\operatorname{triangle}(1, 2, 3)');
    expect(expr.operator).toBe('Triangle');
    expect(expr.toLatex()).toContain('\\operatorname{triangle}');
  });
});

describe('Action arrow `To`', () => {
  test('a \\to b parses to To', () => {
    const expr = ce.parse('a \\to 5');
    expect(expr.operator).toBe('To');
    expect(expr.ops!.length).toBe(2);
  });

  test('To is recognized as a known typed head (not unsupported)', () => {
    // Before this work, `["To", ...]` had no library entry, which left
    // corpus rows like `q \to q + 1` in the `unsupported-operator` bucket.
    // The library entry now declares the head's signature so consumers can
    // identify it as a known action node.
    const expr = ce.expr(['To', 'a', 5]);
    const def = ce.lookupDefinition('To');
    expect(def).toBeDefined();
  });
});
