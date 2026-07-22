import { ComputeEngine } from '../../src/compute-engine';

/**
 * Declared-name precedence for subscripts on an indexed-collection base.
 *
 * A subscript on a collection-typed symbol normally reads as indexing
 * (`B_2` → `At(B, 2)`). But a subscripted spelling whose JOINED name is
 * declared in scope is a reference to that symbol: sibling names (a point `B`
 * alongside `B_2`, `B_3`, …) must outrank index capture, which would
 * otherwise make every such name unspellable — and, since `B_2` and `B[2]`
 * produce byte-identical `At` trees, indistinguishable from genuine indexing
 * after the parse.
 *
 * Declaration *presence* is the test, not type knowledge: a symbol declared
 * with an `unknown` type is still declared.
 */
describe('SUBSCRIPT: declared-name precedence over index capture', () => {
  const withPoint = (declare?: (ce: ComputeEngine) => void) => {
    const ce = new ComputeEngine();
    ce.assign('B', ce.parse('(-1,1)'));
    declare?.(ce);
    return ce;
  };

  const json = (ce: ComputeEngine, latex: string) =>
    JSON.stringify(ce.parse(latex, { canonical: false }).json);

  describe('a declared sibling name wins over index capture', () => {
    test('declared with an explicit type', () => {
      const ce = withPoint((ce) => ce.declare('B_2', 'number'));
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
      expect(json(ce, 'B_2')).toBe('"B_2"');
    });

    test('declared with an `unknown` type (declaration presence, not type)', () => {
      const ce = withPoint((ce) => ce.declare('B_2', 'unknown'));
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
      expect(json(ce, 'B_2')).toBe('"B_2"');
    });

    test('assigned rather than declared', () => {
      const ce = withPoint((ce) => ce.assign('B_2', 42));
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
    });

    test('multi-character and alphabetic subscripts', () => {
      const ce = withPoint((ce) => {
        ce.declare('B_m2', 'unknown');
        ce.declare('B_A', 'unknown');
      });
      // Without the precedence rule `B_{m2}` degrades to
      // `At(B, InvisibleOperator(m, 2))` — the intended name is destroyed.
      expect(json(ce, 'B_{m2}')).toBe('"B_m2"');
      expect(json(ce, 'B_{A}')).toBe('"B_A"');
    });

    test('the whole sibling family of a point base', () => {
      const ce = withPoint((ce) => {
        for (const n of ['B_2', 'B_3', 'B_4', 'B_m1', 'B_m2'])
          ce.declare(n, 'unknown');
      });
      for (const n of ['B_2', 'B_3', 'B_4', 'B_m1', 'B_m2'])
        expect(json(ce, n.replace('_', '_{') + '}')).toBe(`"${n}"`);
    });

    test('a list base, not just a tuple base', () => {
      const ce = new ComputeEngine();
      ce.assign('L', ce.parse('\\lbrack 1,2,3\\rbrack'));
      ce.declare('L_2', 'unknown');
      expect(json(ce, 'L_{2}')).toBe('"L_2"');
    });
  });

  describe('index capture is preserved where nothing is declared', () => {
    test('an undeclared join still indexes', () => {
      const ce = withPoint();
      expect(json(ce, 'B_{2}')).toBe('["At","B",2]');
      expect(json(ce, 'B_2')).toBe('["At","B",2]');
    });

    test('a variable index (undeclared join) still indexes', () => {
      const ce = withPoint();
      expect(json(ce, 'B_{A}')).toBe('["At","B","A"]');
    });

    test('a list base with an undeclared join still indexes', () => {
      const ce = new ComputeEngine();
      ce.assign('L', ce.parse('\\lbrack 1,2,3\\rbrack'));
      expect(json(ce, 'L_{2}')).toBe('["At","L",2]');
    });
  });

  describe('unrelated spellings are unaffected', () => {
    test('bracket indexing always stays `At`, declared sibling or not', () => {
      const bare = withPoint();
      const declared = withPoint((ce) => ce.declare('B_2', 'unknown'));
      for (const ce of [bare, declared])
        expect(json(ce, 'B\\left[2\\right]')).toBe('["At","B",2]');
    });

    test('a non-collection base absorbs subscripts as before', () => {
      const ce = new ComputeEngine();
      ce.assign('B', 5);
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
      expect(json(ce, 'B_{m2}')).toBe('"B_m2"');
    });

    test('a fresh engine absorbs subscripts as before', () => {
      const ce = new ComputeEngine();
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
      expect(json(ce, 'B_{A}')).toBe('"B_A"');
    });

    test('a `subscriptEvaluate` handler still owns all its subscripts', () => {
      const ce = new ComputeEngine();
      ce.declare('S', {
        subscriptEvaluate: (subscript, { engine }) =>
          engine.number((subscript.re ?? 0) * 2),
      });
      // Declaring the joined name must NOT steal the handler's subscript.
      ce.declare('S_5', 'unknown');
      expect(ce.parse('S_{5}').evaluate().re).toBe(10);
    });
  });

  describe('order dependence is narrowed to declaration order', () => {
    test('declaring the sibling before parsing restores the name', () => {
      const ce = withPoint();
      expect(json(ce, 'B_{2}')).toBe('["At","B",2]');
      ce.declare('B_2', 'unknown');
      expect(json(ce, 'B_{2}')).toBe('"B_2"');
    });
  });
});
