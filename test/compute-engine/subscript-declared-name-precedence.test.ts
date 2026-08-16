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

/**
 * A trigger-spelled base (`\alpha`, `\theta`, …) followed by a subscript now
 * consults the same joined-name oracle the single-letter branch uses, so a
 * declared `alpha_1` can be a call head (`\alpha_1(x)`).
 *
 * Without a declaration nothing changes: the subscript keeps its default
 * reading (a `Subscript` expression, or a dictionary constant such as `\mu_0`).
 */
describe('SUBSCRIPT: trigger-spelled base with a declared joined name', () => {
  const json = (
    ce: ComputeEngine,
    latex: string,
    resolveSymbol?: (id: string) => any
  ) =>
    JSON.stringify(ce.parse(latex, { canonical: false, resolveSymbol }).json);

  // A per-call oracle that knows one joined name, and nothing else.
  const alpha1 = (id: string) =>
    id === 'alpha_1' ? { type: 'function' } : undefined;

  describe('current behavior without an oracle (pinned first)', () => {
    test('`\\alpha_1` and `\\alpha_1(x)` keep the Subscript reading', () => {
      const ce = new ComputeEngine();
      expect(json(ce, '\\alpha_1')).toBe('["Subscript","alpha",1]');
      expect(json(ce, '\\alpha_1(x)')).toBe(
        '["InvisibleOperator",["Subscript","alpha",1],["Delimiter","x"]]'
      );
      expect(json(ce, '\\alpha_{1}')).toBe('["Subscript","alpha",1]');
    });
  });

  describe('the delta: a declared joined name is a spellable call head', () => {
    test('per-call `resolveSymbol`', () => {
      const ce = new ComputeEngine();
      expect(json(ce, '\\alpha_1(x)', alpha1)).toBe('["alpha_1","x"]');
      expect(json(ce, '\\alpha_1', alpha1)).toBe('"alpha_1"');
      // Braced spelling, same rule
      expect(json(ce, '\\alpha_{1}(x)', alpha1)).toBe('["alpha_1","x"]');
    });

    test('scope fallback: the joined name declared in the current scope', () => {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('alpha_1', 'function');
      expect(json(ce, '\\alpha_1(x)')).toBe('["alpha_1","x"]');
      expect(json(ce, '\\alpha_1')).toBe('"alpha_1"');
      ce.popScope();
      // Out of scope again: the default reading is restored
      expect(json(ce, '\\alpha_1(x)')).toBe(
        '["InvisibleOperator",["Subscript","alpha",1],["Delimiter","x"]]'
      );
    });

    test('an undeclared sibling of a declared name is unaffected', () => {
      const ce = new ComputeEngine();
      expect(json(ce, '\\alpha_2', alpha1)).toBe('["Subscript","alpha",2]');
      expect(json(ce, '\\theta_1', alpha1)).toBe('["Subscript","theta",1]');
    });

    test('round-trip: the committed joined name re-parses', () => {
      const ce = new ComputeEngine();
      const call = ce.parse('\\alpha_1(x)', {
        canonical: false,
        resolveSymbol: alpha1,
      });
      expect(call.toLatex()).toBe('\\alpha_1(x)');
      expect(json(ce, call.toLatex(), alpha1)).toBe('["alpha_1","x"]');

      const sym = ce.box('alpha_1', { canonical: false });
      expect(sym.toLatex()).toBe('\\alpha_1');
      expect(json(ce, sym.toLatex(), alpha1)).toBe('"alpha_1"');
    });
  });

  describe('only the subscript shapes the single-letter branch absorbs', () => {
    test('an expression subscript is never absorbed', () => {
      const ce = new ComputeEngine();
      const oracle = (id: string) =>
        id.startsWith('alpha_') ? { type: 'function' } : undefined;
      expect(json(ce, '\\alpha_{n+1}', oracle)).toBe(
        '["Subscript","alpha",["Add","n",1]]'
      );
      expect(json(ce, '\\alpha_{1,2}', oracle)).toBe(
        '["Subscript","alpha",["Delimiter",["Sequence",1,2],"\',\'"]]'
      );
    });

    test('a `subscriptEvaluate` base still owns all its subscripts', () => {
      const ce = new ComputeEngine();
      ce.declare('alpha', {
        subscriptEvaluate: (subscript, { engine }) =>
          engine.number((subscript.re ?? 0) * 2),
      });
      ce.declare('alpha_5', 'function');
      expect(json(ce, '\\alpha_5')).toBe('["Subscript","alpha",5]');
      expect(ce.parse('\\alpha_5').evaluate().re).toBe(10);
    });
  });

  describe('dictionary resolutions are not preempted', () => {
    // `\mu_0` / `\varepsilon_0` are physics-constant LaTeX triggers
    // (DEFINITIONS_PHYSICS): the whole 3-token run is claimed by the
    // dictionary before any symbol parsing.
    test('`\\mu_0` is the vacuum-permeability constant, oracle or not', () => {
      const ce = new ComputeEngine();
      for (const resolve of [undefined, alpha1]) {
        expect(json(ce, '\\mu_0', resolve)).toBe('"Mu0"');
        expect(json(ce, '\\varepsilon_0', resolve)).toBe(
          '"VacuumPermittivity"'
        );
      }
    });

    test('a declared non-function joined name does not preempt `\\mu_0`', () => {
      const ce = new ComputeEngine();
      const oracle = (id: string) =>
        id === 'mu_0' ? { type: 'number' } : undefined;
      expect(json(ce, '\\mu_0', oracle)).toBe('"Mu0"');
      expect(json(ce, '\\mu_0(x)', oracle)).toBe(
        '["InvisibleOperator","Mu0",["Delimiter","x"]]'
      );
    });

    test('`\\delta_n` stays Kronecker delta', () => {
      const ce = new ComputeEngine();
      const oracle = (id: string) =>
        id === 'delta_n' ? { type: 'function' } : undefined;
      for (const resolve of [undefined, oracle])
        expect(json(ce, '\\delta_n', resolve)).toBe('["KroneckerDelta","n"]');
    });
  });

  describe('the single-letter (ASCII) branch is unchanged', () => {
    test('`a_1` absorbs with or without an oracle', () => {
      const ce = new ComputeEngine();
      for (const resolve of [undefined, alpha1]) {
        expect(json(ce, 'a_1', resolve)).toBe('"a_1"');
        expect(json(ce, 'a_1(x)', resolve)).toBe(
          '["InvisibleOperator","a_1",["Delimiter","x"]]'
        );
      }
    });

    test('a declared `a_1` is a call head, as before', () => {
      const ce = new ComputeEngine();
      const oracle = (id: string) =>
        id === 'a_1' ? { type: 'function' } : undefined;
      expect(json(ce, 'a_1(x)', oracle)).toBe('["a_1","x"]');
    });
  });
});

describe('SUBSCRIPT: trigger-spelled COLLECTION base with a declared non-function joined name (Tycho item 196)', () => {
  // A dictionary-spelled base (`\eta`) is claimed by its `symbol` dictionary
  // entry before the free `parseSymbol()` runs, so the joined-name absorption
  // used to be reachable only through the function-head path (`\alpha_1(x)`).
  // A declared NON-function `eta_w` on a collection base `eta` therefore read
  // as `At(eta, w)`, and the serializer's own spelling `\eta_{w}` did not
  // round-trip. Same rule as the ASCII branch: a declared joined name wins.
  const json = (ce: ComputeEngine, latex: string) =>
    JSON.stringify(ce.parse(latex, { canonical: false }).json);

  test('declared joined name wins over index capture on a collection base', () => {
    const ce = new ComputeEngine();
    ce.declare('eta', 'list<number>');
    ce.declare('eta_w', 'real');
    expect(json(ce, '\\eta_w')).toBe('"eta_w"');
    expect(json(ce, '\\eta_{w}')).toBe('"eta_w"');
    // An undeclared sibling is still an index
    expect(json(ce, '\\eta_1')).toBe('["At","eta",1]');
    expect(json(ce, '\\eta_{g}')).toBe('["At","eta","g"]');
  });

  test('the Desmos document order: `eta_w` assigned FIRST, then `eta` bound to a list', () => {
    const ce = new ComputeEngine();
    ce.assign('eta_w', 1.33);
    ce.assign('eta', ce.parse('\\frac{[0...20]}{20}').evaluate());
    expect(json(ce, '\\eta_w')).toBe('"eta_w"');
    expect(json(ce, '\\eta_{w}')).toBe('"eta_w"');
    expect(ce.parse('\\eta_w').evaluate().re).toBe(1.33);
    // 1-based: `eta_1` is 0/20, `eta_2` is 1/20
    expect(ce.parse('\\eta_w+\\eta_2').evaluate().re).toBeCloseTo(
      1.33 + 1 / 20
    );
  });

  test('round-trip: the serializer spelling of `eta_w` re-parses to itself', () => {
    const ce = new ComputeEngine();
    ce.assign('eta_w', 1.33);
    ce.assign('eta', ce.parse('\\frac{[0...20]}{20}').evaluate());
    const latex = ce.expr('eta_w').latex;
    expect(latex).toBe('\\eta_{w}');
    expect(json(ce, latex)).toBe('"eta_w"');
  });

  test('nothing declared: a collection base still captures the index', () => {
    const ce = new ComputeEngine();
    ce.declare('eta', 'list<number>');
    expect(json(ce, '\\eta_w')).toBe('["At","eta","w"]');
    expect(json(ce, '\\eta_{w}')).toBe('["At","eta","w"]');
  });

  test('the Unicode spelling of the base follows the same rule', () => {
    const ce = new ComputeEngine();
    ce.declare('eta', 'list<number>');
    ce.declare('eta_w', 'real');
    expect(json(ce, 'η_w')).toBe('"eta_w"');
    expect(json(ce, 'η_1')).toBe('["At","eta",1]');
  });

  test('a per-call `resolveSymbol` oracle can declare the joined name', () => {
    const ce = new ComputeEngine();
    ce.declare('eta', 'list<number>');
    const oracle = (id: string) =>
      id === 'eta_w' ? { type: 'real' } : undefined;
    expect(
      JSON.stringify(
        ce.parse('\\eta_w', { canonical: false, resolveSymbol: oracle }).json
      )
    ).toBe('"eta_w"');
    expect(json(ce, '\\eta_w')).toBe('["At","eta","w"]');
  });

  test('a `subscriptEvaluate` dictionary-spelled base never absorbs', () => {
    const ce = new ComputeEngine();
    ce.declare('eta', {
      subscriptEvaluate: (subscript, { engine }) =>
        engine.number((subscript.re ?? 0) * 2),
    });
    ce.declare('eta_5', 'real');
    expect(json(ce, '\\eta_5')).toBe('["Subscript","eta",5]');
    expect(ce.parse('\\eta_5').evaluate().re).toBe(10);
  });
});
