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

  // The aliases must bind their call like natively-spelled functions
  // (`\gcd`, `\sin`): the call binds before prefix minus, and a postfix
  // power applies to the call result, not the bare argument group.
  // Without `kind: 'function'` the alias parsed as a lone symbol, so
  // `-mod(x,1)` negated the Mod symbol (loud type error) and
  // `mod(-x,1)^2` parsed as `Mod · ((−x,1))²` (silently wrong, NaN).
  test('prefix minus binds after the call: -\\operatorname{mod}(x, 1)', () => {
    const expr = ce.parse('-\\operatorname{mod}\\left(x,1\\right)');
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(['Negate', ['Mod', 'x', 1]]);
  });

  test('postfix power applies to the call result: \\operatorname{mod}(-x, 1)^2', () => {
    const expr = ce.parse('\\operatorname{mod}\\left(-x,1\\right)^{2}');
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(['Power', ['Mod', ['Negate', 'x'], 1], 2]);
    expect(expr.subs({ x: 0.3 }).N().re).toBeCloseTo(0.49, 10);
  });

  // A `{...}` group after a dictionary-registered function head is an
  // argument list, exactly as if it were `(...)`: the braces render
  // invisibly, but the TeX-macro-style intent is unambiguous. Consecutive
  // groups are successive arguments (the `\frac{}{}` habit). Without this,
  // the head parsed as a bare symbol and the group multiplied against it —
  // silently wrong (`\gcd{a}` was `GCD · a`).
  test('a brace group after a function head is its argument list', () => {
    expect(ce.parse('\\gcd{a}').json).toEqual(['GCD', 'a']);
    expect(ce.parse('\\gcd{2,4}').json).toEqual(['GCD', 2, 4]);
    expect(ce.parse('\\operatorname{floor}{2.5}').json).toEqual([
      'Floor',
      2.5,
    ]);
    expect(ce.parse('-\\gcd{4,6}').json).toEqual(['Negate', ['GCD', 4, 6]]);
    expect(ce.parse('\\gcd{4,6}^2').json).toEqual([
      'Power',
      ['GCD', 4, 6],
      2,
    ]);
  });

  test('consecutive brace groups are successive arguments', () => {
    expect(ce.parse('\\gcd{a}{b}').json).toEqual(['GCD', 'a', 'b']);
    expect(ce.parse('\\mod{x}{2}').json).toEqual(['Mod', 'x', 2]);
    expect(ce.parse('\\operatorname{mod}{x}{1}').json).toEqual([
      'Mod',
      'x',
      1,
    ]);
  });

  // Brace-group arguments are scoped to dictionary-registered heads with
  // parenthesized (enclosure) argument style. Implicit-argument commands
  // keep the transparent-grouping convention (braces render invisibly, so
  // the argument reads the way the rendered formula does), and generic
  // declared or unknown heads keep the juxtaposition (multiply) reading.
  test('brace-argument scope boundaries are unchanged', () => {
    // Implicit-argument commands: transparent grouping
    expect(ce.parse('\\sin{x}y').json).toEqual([
      'Sin',
      ['Multiply', 'x', 'y'],
    ]);
    expect(ce.parse('\\sin{x}^2').json).toEqual(['Sin', ['Power', 'x', 2]]);
    // Unknown head: juxtaposition
    expect(ce.parse('\\operatorname{zzz}{x}').json).toEqual([
      'Multiply',
      'x',
      'zzz',
    ]);
  });

  test('call binding for the other function-style aliases', () => {
    expect(ce.parse('-\\operatorname{var}([1,2,3])').json).toEqual([
      'Negate',
      ['Variance', ['List', 1, 2, 3]],
    ]);
    expect(ce.parse('\\operatorname{nCr}\\left(5,2\\right)^{2}').json).toEqual([
      'Power',
      ['Choose', 5, 2],
      2,
    ]);
    expect(ce.parse('-\\operatorname{length}([1,2])').json).toEqual([
      'Negate',
      ['Length', ['List', 1, 2]],
    ]);
  });
});

describe('Function-style aliases for natively-commanded functions', () => {
  // Lowercase spelled-out names of the natively-commanded functions had no
  // alias entry, so `\operatorname{sin}(x)^2` parsed as `sin·x²` and
  // `-\operatorname{sin}(x)` negated the bare `sin` symbol — silently wrong
  // math with `isValid: true`. The `\operatorname{name}` alias now binds its
  // call exactly like the native `\sin`/`\ln`/... command.

  test('\\operatorname{sin}(x)^2 → Power(Sin(x), 2)', () => {
    const expr = ce.parse('\\operatorname{sin}(x)^{2}');
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(['Power', ['Sin', 'x'], 2]);
    expect(expr.subs({ x: 0.3 }).N().re).toBeCloseTo(0.0873322, 6);
  });

  test('-\\operatorname{sin}(x) → Negate(Sin(x))', () => {
    const expr = ce.parse('-\\operatorname{sin}(x)');
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(['Negate', ['Sin', 'x']]);
  });

  test('ln binds like the native command', () => {
    expect(ce.parse('\\operatorname{ln}(x)^{2}').json).toEqual([
      'Power',
      ['Ln', 'x'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{ln}(x)').json).toEqual([
      'Negate',
      ['Ln', 'x'],
    ]);
  });

  test('log carries the subscript base and binds its call', () => {
    expect(ce.parse('\\operatorname{log}_2(x)').json).toEqual(['Log', 'x', 2]);
    expect(ce.parse('\\operatorname{log}(x)^{2}').json).toEqual([
      'Power',
      ['Log', 'x'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{log}(x)').json).toEqual([
      'Negate',
      ['Log', 'x'],
    ]);
  });

  test('inverse-trig alias (arcsin) binds its call', () => {
    expect(ce.parse('\\operatorname{arcsin}(x)^{2}').json).toEqual([
      'Power',
      ['Arcsin', 'x'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{arcsin}(x)').json).toEqual([
      'Negate',
      ['Arcsin', 'x'],
    ]);
    // short `a-` spelling maps to the same operator
    expect(ce.parse('\\operatorname{asin}(x)').json).toEqual(['Arcsin', 'x']);
  });

  test('hyperbolic alias (cosh) binds its call', () => {
    expect(ce.parse('\\operatorname{cosh}(x)^{2}').json).toEqual([
      'Power',
      ['Cosh', 'x'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{cosh}(x)').json).toEqual([
      'Negate',
      ['Cosh', 'x'],
    ]);
  });

  test('arg alias maps to Argument and binds its call', () => {
    expect(ce.parse('\\operatorname{arg}(z)^{2}').json).toEqual([
      'Power',
      ['Argument', 'z'],
      2,
    ]);
    expect(ce.parse('-\\operatorname{arg}(z)').json).toEqual([
      'Negate',
      ['Argument', 'z'],
    ]);
  });

  test('already-covered name (max) is unchanged', () => {
    expect(ce.parse('\\operatorname{max}(1, 2)^{2}').json).toEqual([
      'Power',
      ['Max', 1, 2],
      2,
    ]);
    expect(ce.parse('-\\operatorname{max}(1, 2)').json).toEqual([
      'Negate',
      ['Max', 1, 2],
    ]);
  });

  test('bare multi-letter names are unaffected (no \\operatorname)', () => {
    // Bare `sin`/`ln` lex as letter-runs (a product of single-letter symbols),
    // which the alias entries must not change.
    expect(ce.parse('ln').json).toEqual(['Multiply', 'l', 'n']);
    expect(ce.parse('cos').json).toEqual(['Multiply', 'c', 'o', 's']);
  });

  test('serialization round-trips to the native command', () => {
    expect(ce.parse('\\operatorname{sin}(x)^{2}').toLatex()).toContain('\\sin');
    expect(ce.parse('\\operatorname{ln}(x)').toLatex()).toContain('\\ln');
    expect(ce.parse('\\operatorname{arg}(z)').toLatex()).toContain('\\arg');
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

describe('GeometricVector', () => {
  // Distinct head from the existing column-vector `Vector` operator. Routed
  // from `\operatorname{vector}` because Desmos uses `vector(p1, p2)` for
  // a directed segment between two points, which has different semantics
  // from CE's `Vector(x, y, z)` column construction.

  test('\\operatorname{vector}(p1, p2) parses to GeometricVector', () => {
    const expr = ce.parse(
      '\\operatorname{vector}((0, 0, 0), (1, 2, 3))'
    );
    expect(expr.operator).toBe('GeometricVector');
    expect(expr.ops!.length).toBe(2);
  });

  test('round-trips through LaTeX', () => {
    const expr = ce.parse('\\operatorname{vector}((0, 0), (3, 4))');
    expect(expr.operator).toBe('GeometricVector');
    expect(expr.toLatex()).toContain('\\operatorname{vector}');
  });

  test('does not collide with existing Vector operator', () => {
    // `Vector(x, y, z)` is the column-vector construction operator with a
    // (number+) -> vector signature; it canonicalizes to a Matrix. The
    // geometric form has its own head and stays a function call.
    const colVec = ce.expr(['Vector', 1, 2, 3]);
    expect(colVec.operator).toBe('Matrix'); // existing canonical form preserved
    const geom = ce.expr(['GeometricVector', ['Tuple', 0, 0], ['Tuple', 1, 1]]);
    expect(geom.operator).toBe('GeometricVector');
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
