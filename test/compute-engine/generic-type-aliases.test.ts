import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Transparent generic type aliases — `type alias Pair<T> = tuple<T, T>`
// (`docs/plans/2026-08-04-generic-type-aliases-design.md`).
//
// An applied reference is EAGERLY EXPANDED at type resolution into the
// substituted alias body: no applied-reference node exists in the `Type`
// representation, so `.type`, `typeToString`, `matches()` and every downstream
// consumer only ever see the expansion. That asymmetry with the SOURCE text
// (which keeps the applied spelling) is A4, and it is what "transparent" means.
//
// Three routes reach the declaration and each is exercised below: the host
// `ce.declareType(…, { typeParams })`, the `DeclareType` operator (box route),
// and the Epsil `type alias` statement.
//

/** The error code of a thrown type-layer failure (`generic-alias-…`). */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const m = /(generic-alias-[a-z-]+|unsupported-variable-position|reserved-type-name|unsolvable-type-variable)/.exec(
      e instanceof Error ? e.message : String(e)
    );
    return m ? m[1] : `<no code: ${e instanceof Error ? e.message : e}>`;
  }
  return '<no error>';
}

/** An engine with `Pair<T>` and `Keyed<T: number>` already declared. */
function engineWithAliases(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
  ce.declareType('Keyed', 'tuple<string, T>', {
    alias: true,
    typeParams: ['T: number'],
  });
  return ce;
}

describe('GENERIC TYPE ALIASES — host route', () => {
  test('an applied reference expands into the substituted body', () => {
    const ce = engineWithAliases();
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('nested ground applications', () => {
    const ce = engineWithAliases();
    expect(ce.type('list<Pair<integer>>').toString()).toBe(
      'list<tuple<integer, integer>>'
    );
    expect(ce.type('Pair<Pair<integer>>').toString()).toBe(
      'tuple<tuple<integer, integer>, tuple<integer, integer>>'
    );
  });

  test('a value validates against the EXPANSION', () => {
    const ce = engineWithAliases();
    expect(ce.box(['Tuple', 1, 2]).type.matches(ce.type('Pair<integer>'))).toBe(
      true
    );
    expect(
      ce.box(['Tuple', 1, 'x']).type.matches(ce.type('Pair<integer>'))
    ).toBe(false);
  });

  test('a named-tuple body substitutes too', () => {
    const ce = new ComputeEngine();
    ce.declareType('Boxed', 'tuple<label: string, value: T>', {
      alias: true,
      typeParams: ['T'],
    });
    expect(ce.type('Boxed<integer>').toString()).toBe(
      'tuple<label: string, value: integer>'
    );
  });

  test('the clause may be given as pre-built parameters', () => {
    const ce = new ComputeEngine();
    ce.declareType('P2', 'tuple<T, T>', {
      alias: true,
      typeParams: [{ name: 'T', bound: 'number' }],
    });
    expect(ce.type('P2<integer>').toString()).toBe('tuple<integer, integer>');
    expect(codeOf(() => ce.type('P2<string>'))).toBe('generic-alias-bound');
  });

  test('…and as one clause STRING', () => {
    const ce = new ComputeEngine();
    ce.declareType('P3', 'tuple<T, U>', {
      alias: true,
      typeParams: 'T, U: number',
    });
    expect(ce.type('P3<string, integer>').toString()).toBe(
      'tuple<string, integer>'
    );
  });
});

describe('GENERIC TYPE ALIASES — bounds at ground use', () => {
  test('an argument inside the bound is accepted', () => {
    const ce = engineWithAliases();
    expect(ce.type('Keyed<integer>').toString()).toBe(
      'tuple<string, integer>'
    );
  });

  test('an argument outside the bound names BOTH the argument and the bound', () => {
    const ce = engineWithAliases();
    let message = '';
    try {
      ce.type('Keyed<string>');
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('generic-alias-bound');
    expect(message).toContain('`string`');
    expect(message).toContain('`number`');
  });
});

describe('GENERIC TYPE ALIASES — A7 open-argument admission', () => {
  test('unbounded into unbounded: `Wrap<T> = list<Pair<T>>`', () => {
    const ce = engineWithAliases();
    ce.declareType('Wrap', 'list<Pair<T>>', {
      alias: true,
      typeParams: ['T'],
    });
    expect(ce.type('Wrap<integer>').toString()).toBe(
      'list<tuple<integer, integer>>'
    );
  });

  test('`K<U: number> = Keyed<U>` with `Keyed<T: number>` — bound satisfies bound', () => {
    const ce = engineWithAliases();
    ce.declareType('K', 'Keyed<U>', {
      alias: true,
      typeParams: ['U: integer'],
    });
    expect(ce.type('K<integer>').toString()).toBe('tuple<string, integer>');
  });

  test('an UNBOUNDED variable does not satisfy a BOUNDED parameter', () => {
    const ce = engineWithAliases();
    // A bare `where T` gives `T` the implicit bound `any`, which is not a
    // subtype of `Keyed`'s `number`.
    expect(codeOf(() => ce.type('(Keyed<T>) -> T where T'))).toBe(
      'generic-alias-bound'
    );
    // …and the same, one level in, for an alias declaration.
    expect(
      codeOf(() =>
        ce.declareType('Bad', 'Keyed<T>', { alias: true, typeParams: ['T'] })
      )
    ).toBe('generic-alias-bound');
  });

  test('a `where` clause whose bound satisfies the parameter is accepted', () => {
    const ce = engineWithAliases();
    expect(ce.type('(Keyed<T>) -> T where T: integer').toString()).toBe(
      '(tuple<string, T>) -> T where T: integer'
    );
  });

  test('end-to-end through a generic function', () => {
    const ce = engineWithAliases();
    ce.declare('label', {
      signature: '(Keyed<T>) -> T where T: integer',
      evaluate: (ops) => ops[0].ops?.[1],
    });
    const r = ce.box(['label', ['Tuple', { str: 'k' }, 7]]);
    expect(r.type.toString()).toBe('finite_integer');
    expect(r.evaluate().toString()).toBe('7');
  });

  test('a composite open argument is admitted pointwise', () => {
    const ce = engineWithAliases();
    // `list<T>` with `T: any` is not a `number`.
    expect(codeOf(() => ce.type('(Keyed<list<T>>) -> T where T'))).toBe(
      'generic-alias-bound'
    );
  });
});

describe('GENERIC TYPE ALIASES — error matrix (host route)', () => {
  test('bare use of a generic alias', () => {
    const ce = engineWithAliases();
    expect(codeOf(() => ce.type('Pair'))).toBe('generic-alias-arity');
  });

  test('under- and over-arity', () => {
    const ce = new ComputeEngine();
    ce.declareType('Two', 'tuple<T, U>', { alias: true, typeParams: ['T', 'U'] });
    expect(codeOf(() => ce.type('Two<integer>'))).toBe('generic-alias-arity');
    expect(codeOf(() => ce.type('Two<integer, string, boolean>'))).toBe(
      'generic-alias-arity'
    );
  });

  test('an empty argument list', () => {
    const ce = engineWithAliases();
    expect(codeOf(() => ce.type('Pair<>'))).toBe('generic-alias-arity');
  });

  test('arguments on a NON-generic alias, and on a nominal type', () => {
    const ce = new ComputeEngine();
    ce.declareType('Plain', 'integer', { alias: true });
    ce.declareType('Nom', 'tuple<number, number>');
    expect(codeOf(() => ce.type('Plain<integer>'))).toBe('generic-alias-arity');
    expect(codeOf(() => ce.type('Nom<integer>'))).toBe('generic-alias-arity');
  });

  test('direct self-reference', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() =>
        ce.declareType('Rec', 'tuple<Rec<T>, T>', {
          alias: true,
          typeParams: ['T'],
        })
      )
    ).toBe('generic-alias-self-reference');
    // …and the failed declaration declared NOTHING.
    expect(() => ce.type('Rec')).toThrow();
  });

  // An APPLIED forward reference is legal since the parameterized-nominal work
  // (design §4.2): it records its argument count on the placeholder, and the
  // declaration that fulfills it is checked against every recorded use.
  test('a forward reference applied at the arity it is later declared with', () => {
    const ce = new ComputeEngine();
    expect(codeOf(() => ce.type('type Later<integer>'))).toBe('<no error>');
    ce.declareType('Later', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    expect(ce.type('Later<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('a forward reference applied at the WRONG arity', () => {
    const ce = new ComputeEngine();
    expect(codeOf(() => ce.type('type Later<integer, string>'))).toBe(
      '<no error>'
    );
    expect(
      codeOf(() =>
        ce.declareType('Later', 'tuple<T, T>', {
          alias: true,
          typeParams: ['T'],
        })
      )
    ).toBe('generic-alias-arity');
  });

  test('an unused clause parameter', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() =>
        ce.declareType('Phantom', 'integer', { alias: true, typeParams: ['T'] })
      )
    ).toBe('generic-alias-unused-parameter');
    expect(
      codeOf(() =>
        ce.declareType('Half', 'tuple<T, T>', {
          alias: true,
          typeParams: ['T', 'U'],
        })
      )
    ).toBe('generic-alias-unused-parameter');
  });

  test('a duplicate clause name', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() =>
        ce.declareType('Dup', 'tuple<T, T>', {
          alias: true,
          typeParams: ['T, T'],
        })
      )
    ).toBe('unsupported-variable-position');
  });

  test('a reserved clause name', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() =>
        ce.declareType('Res', 'tuple<where, where>', {
          alias: true,
          typeParams: ['where'],
        })
      )
    ).toBe('reserved-type-name');
  });

  test('malformed clause text', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() =>
        ce.declareType('Bad', 'tuple<T, T>', {
          alias: true,
          typeParams: ['T,'],
        })
      )
    ).toBe('unsupported-variable-position');
    expect(
      codeOf(() =>
        ce.declareType('Bad2', 'tuple<T, T>', {
          alias: true,
          typeParams: ['1T'],
        })
      )
    ).toBe('unsupported-variable-position');
  });

  test('a malformed applied reference is a type-grammar syntax error', () => {
    const ce = engineWithAliases();
    expect(() => ce.type('Pair<integer')).toThrow(/Expected `>`/);
    expect(() => ce.type('Pair<integer,>')).toThrow();
  });

  test('a non-ground bound', () => {
    const ce = engineWithAliases();
    // `T` is not a declared type name, so the bound does not even parse.
    expect(
      codeOf(() =>
        ce.declareType('NG', 'tuple<U, U>', {
          alias: true,
          typeParams: ['U: list<T>'],
        })
      )
    ).toBe('unsupported-variable-position');
  });
});

describe('GENERIC TYPE ALIASES — atomic rollback (§3.9)', () => {
  /** A scope holding a PLAIN alias `P` (and its minted constructor). */
  function withPlainAlias(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('P', 'tuple<number, number>', {
      alias: true,
      fromStatement: true,
    });
    return ce;
  }

  /** Both namespaces still hold the ORIGINAL plain alias. */
  function expectUntouched(ce: ComputeEngine): void {
    expect(ce.type('P').toString()).toBe('P');
    expect(ce.type('tuple<number, number>').matches(ce.type('P'))).toBe(true);
    // The minted identity constructor is still there.
    expect(ce.box(['P', 1, 2]).evaluate().toString()).toBe('(1, 2)');
  }

  test('a failed CLAUSE parse leaves both namespaces unchanged', () => {
    const ce = withPlainAlias();
    expect(
      codeOf(() =>
        ce.declareType('P', 'tuple<T, T>', {
          alias: true,
          fromStatement: true,
          typeParams: ['T, T'],
        })
      )
    ).toBe('unsupported-variable-position');
    expectUntouched(ce);
  });

  test('a failed BODY parse leaves both namespaces unchanged', () => {
    const ce = withPlainAlias();
    expect(() =>
      ce.declareType('P', 'tuple<T, nosuchtype>', {
        alias: true,
        fromStatement: true,
        typeParams: ['T'],
      })
    ).toThrow();
    expectUntouched(ce);
  });

  test('a failed BOUND check leaves both namespaces unchanged', () => {
    const ce = withPlainAlias();
    ce.declareType('Keyed', 'tuple<string, T>', {
      alias: true,
      typeParams: ['T: number'],
    });
    expect(
      codeOf(() =>
        ce.declareType('P', 'Keyed<T>', {
          alias: true,
          fromStatement: true,
          typeParams: ['T'],
        })
      )
    ).toBe('generic-alias-bound');
    expectUntouched(ce);
  });

  test('a failed UNUSED-PARAMETER check leaves both namespaces unchanged', () => {
    const ce = withPlainAlias();
    expect(
      codeOf(() =>
        ce.declareType('P', 'tuple<number, number>', {
          alias: true,
          fromStatement: true,
          typeParams: ['T'],
        })
      )
    ).toBe('generic-alias-unused-parameter');
    expectUntouched(ce);
  });
});

describe('GENERIC TYPE ALIASES — no mint, no value-namespace claim', () => {
  test('a generic alias mints NO constructor', () => {
    const ce = new ComputeEngine();
    // NOT `Pair`: that one is a builtin `Tuple` spelling, which would mask the
    // question. `Duo` claims nothing in the value namespace at all.
    ce.declareType('Duo', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    expect(ce.lookupDefinition('Duo')).toBeUndefined();
    // The call stays an inert application.
    expect(ce.box(['Duo', 1, 2]).evaluate().operator).toBe('Duo');
  });

  test('a user function of the same name is legal after the alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    const r = executeEpsil(ce, 'function Pair(x) { x }\nPair(5)');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('5');
  });

  test('a plain→generic redeclaration DROPS the old constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('P', 'tuple<number, number>', {
      alias: true,
      fromStatement: true,
    });
    expect(ce.box(['P', 1, 2]).evaluate().toString()).toBe('(1, 2)');
    ce.declareType('P', 'tuple<T, T>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    // No longer a checked identity: the application is inert.
    expect(ce.box(['P', 1, 2]).evaluate().operator).toBe('P');
  });

  // The corollary of "no mint": the value-namespace PRE-CHECK must not run
  // either. It is the plain declaration's atomicity guard (§4.1/D5) and a
  // generic alias makes no claim for it to protect, so an existing same-named
  // value or function is no obstacle — in EITHER order.
  test('an existing user function does not block the generic alias', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function Duo(x) { x }\ntype alias Duo<T> = tuple<T, T>\nlet p: Duo<integer> = (1, 2)\np'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('…and neither does an existing host value (host route)', () => {
    const ce = new ComputeEngine();
    ce.assign('Duo', ce.box(['Function', 'x', 'x']));
    expect(() =>
      ce.declareType('Duo', 'tuple<T, T>', { alias: true, typeParams: ['T'] })
    ).not.toThrow();
    expect(ce.type('Duo<integer>').toString()).toBe('tuple<integer, integer>');
  });
});

// BOTH forms take a type-parameter clause since the parameterized-nominal
// work: an ALIAS is expanded eagerly, a NOMINAL type keeps its application.
// The two must not be confused — the alias expands, the nominal one does not.
describe('GENERIC TYPE ALIASES — a clause on the nominal form', () => {
  test('the host route declares a parameterized NOMINAL type', () => {
    const ce = new ComputeEngine();
    ce.declareType('Nom', 'tuple<T, T>', { typeParams: ['T'] });
    // Opaque: the application survives, where an alias would have expanded.
    expect(ce.type('Nom<integer>').toString()).toBe('Nom<integer>');
  });

  test('the box route registers it too', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareType',
        'Nom',
        { str: 'tuple<T, T>' },
        ['Dictionary', ['KeyValuePair', 'typeParams', { str: 'T' }]],
      ])
      .evaluate();
    expect(r.toString()).toBe('"Nothing"');
    expect(ce.type('Nom<integer>').toString()).toBe('Nom<integer>');
  });

  test('the Epsil statement route agrees', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'type Nom<T> = tuple<T, T>');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('Nom<integer>').toString()).toBe('Nom<integer>');
  });
});

describe('GENERIC TYPE ALIASES — A8 snapshot / A5 generation', () => {
  test('A8: a dependent alias SNAPSHOTS its dependency', () => {
    const ce = new ComputeEngine();
    ce.declareType('Pair', 'tuple<T, T>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    ce.declareType('Wrap', 'list<Pair<T>>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    expect(ce.type('Wrap<integer>').toString()).toBe(
      'list<tuple<integer, integer>>'
    );

    // Redeclaring `Pair` does NOT rewrite `Wrap` — the body was baked in.
    ce.declareType('Pair', 'tuple<T, T, T>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    expect(ce.type('Wrap<integer>').toString()).toBe(
      'list<tuple<integer, integer>>'
    );

    // Re-declaring `Wrap` picks up the new one.
    ce.declareType('Wrap', 'list<Pair<T>>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    expect(ce.type('Wrap<integer>').toString()).toBe(
      'list<tuple<integer, integer, integer>>'
    );
  });

  test('A5: a NEWLY PARSED expression after a redeclaration sees the new body', () => {
    const ce = new ComputeEngine();
    ce.declareType('Pair', 'tuple<T, T>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    const before = ce._anyVersion;
    ce.declareType('Pair', 'tuple<T, T, T>', {
      alias: true,
      fromStatement: true,
      typeParams: ['T'],
    });
    expect(ce._anyVersion).toBeGreaterThan(before);
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer, integer>'
    );
    expect(
      ce.box(['Tuple', 1, 2, 3]).type.matches(ce.type('Pair<integer>'))
    ).toBe(true);
  });
});

describe('GENERIC TYPE ALIASES — parse cache (A2)', () => {
  // The pre-seeded parse is UNCACHEABLE: the same text means different things
  // under different seeds. Every order must give the same answers.
  const body = 'tuple<T, T>';

  test('no seed / seed T / no seed', () => {
    expect(() => parseType(body)).toThrow(/Unknown type "T"/);
    expect(parseType(body, undefined, [{ name: 'T' }])).toEqual({
      kind: 'tuple',
      elements: [
        { type: { kind: 'variable', name: 'T' } },
        { type: { kind: 'variable', name: 'T' } },
      ],
    });
    expect(() => parseType(body)).toThrow(/Unknown type "T"/);
  });

  test('seed T / no seed / seed T', () => {
    const a = parseType(body, undefined, [{ name: 'T' }]);
    expect(() => parseType(body)).toThrow(/Unknown type "T"/);
    expect(parseType(body, undefined, [{ name: 'T' }])).toEqual(a);
  });

  test('a differently-seeded parse of the same text is not shared', () => {
    const withT = parseType('list<T>', undefined, [{ name: 'T' }]);
    expect(withT).toEqual({ kind: 'list', elements: { kind: 'variable', name: 'T' } });
    expect(() => parseType('list<T>', undefined, [{ name: 'U' }])).toThrow(
      /Unknown type "T"/
    );
  });

  test('substitution never mutates the shared (frozen) body', () => {
    const ce = new ComputeEngine();
    ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    const before = JSON.stringify(ce.type('Pair<integer>').type);
    // A second, different application must not have rewritten the stored body.
    ce.type('Pair<string>');
    expect(JSON.stringify(ce.type('Pair<integer>').type)).toBe(before);
  });
});

describe('GENERIC TYPE ALIASES — hostile parameter names', () => {
  test('`__proto__` and `toString` are ordinary parameter names (host route)', () => {
    const ce = new ComputeEngine();
    ce.declareType('Proto', 'tuple<__proto__, __proto__>', {
      alias: true,
      typeParams: ['__proto__'],
    });
    expect(ce.type('Proto<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
    ce.declareType('Str', 'list<toString>', {
      alias: true,
      typeParams: ['toString'],
    });
    expect(ce.type('Str<string>').toString()).toBe('list<string>');
  });

  test('…on the box route', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'Proto',
      { str: 'tuple<__proto__, __proto__>' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True'], ['KeyValuePair', 'typeParams', { str: '__proto__' }]],
    ]).evaluate();
    expect(ce.type('Proto<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('…and on the Epsil route', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Proto<__proto__> = tuple<__proto__, __proto__>\nlet p: Proto<integer> = (1, 2)\np'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });
});

describe('GENERIC TYPE ALIASES — box route (`DeclareType`) parity', () => {
  /** Declare `Pair<T>` through the raw-MathJSON route (both encodings). */
  function boxDeclare(ce: ComputeEngine, shorthand: boolean) {
    const attrs = shorthand
      ? ({ dict: { alias: 'True', typeParams: { str: 'T' } } } as any)
      : ([
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'T' }],
        ] as any);
    return ce.box(['DeclareType', 'Pair', { str: 'tuple<T, T>' }, attrs]);
  }

  test('the operator Dictionary encoding declares a generic alias', () => {
    const ce = new ComputeEngine();
    expect(boxDeclare(ce, false).evaluate().toString()).toBe('"Nothing"');
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('the `{dict: …}` shorthand does too', () => {
    const ce = new ComputeEngine();
    expect(boxDeclare(ce, true).evaluate().toString()).toBe('"Nothing"');
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('registration happens at CANONICALIZATION, before evaluation', () => {
    const ce = new ComputeEngine();
    boxDeclare(ce, false); // boxing alone canonicalizes
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });

  test('errors are VALUES on this route, never throws', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareType',
        'Phantom',
        { str: 'integer' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'T' }],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('generic-alias-unused-parameter');
  });

  test('a malformed clause is an error VALUE', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareType',
        'Bad',
        { str: 'tuple<T, T>' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'T, T' }],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('declared more than once');
  });

  test('an arity error at a USE site surfaces as the declared-type parse throw', () => {
    const ce = new ComputeEngine();
    boxDeclare(ce, false);
    // `Declare` parses its declared type eagerly and lets a malformed one
    // throw — pre-existing behavior, shared with `{str: 'nosuchtype'}`.
    expect(() => ce.box(['Declare', 'p', { str: 'Pair' }]).evaluate()).toThrow(
      /generic-alias-arity/
    );
  });
});

describe('GENERIC TYPE ALIASES — A4: SOURCE keeps the spelling, TYPE shows the expansion', () => {
  test('Epsil round-trips the applied spelling verbatim', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Pair<T> = tuple<T, T>\nlet p: Pair<integer> = (1, 2)\np'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    // The declaration's `{str}` node holds the raw source text…
    expect(JSON.stringify(r.value.json)).not.toContain('Pair<integer>');
    // …and the TYPE is the expansion.
    expect(ce.type('Pair<integer>').toString()).toBe(
      'tuple<integer, integer>'
    );
  });
});

describe('GENERIC TYPE ALIASES — Epsil statement route', () => {
  test('declare, then annotate a `let`', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Pair<T> = tuple<T, T>\nlet p: Pair<integer> = (1, 2)\np'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('annotate a function parameter', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Pair<T> = tuple<T, T>\nfunction f(a: Pair<integer>) { a }\nf((1, 2))'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('a bounded clause, applied inside the bound', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Keyed<T: number> = tuple<string, T>\nlet k: Keyed<integer> = ("a", 1)\nk'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('("a", 1)');
  });

  test('an argument outside the bound is a runtime error value', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Keyed<T: number> = tuple<string, T>\nlet k: Keyed<string> = ("a", "b")\nk'
    );
    expect(JSON.stringify(r.diagnostics)).toContain('generic-alias-bound');
  });

  test('the value validates against the EXPANSION', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias Pair<T> = tuple<T, T>\nlet p: Pair<integer> = (1, "x")\np'
    );
    expect(JSON.stringify(r.diagnostics)).toContain('incompatible-type');
  });

  test('a generic alias declared in a block is a hard error', () => {
    // Types are engine-global (ruled 2026-08-10): the block-local declaration
    // is rejected and declares nothing — same rule as a plain `type`.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let start = 0\ndo {\n  type alias Inner<T> = tuple<T, T>\n  let q: Inner<integer> = (3, 4)\n  q\n}'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-declaration-not-top-level', 'Inner'],
      ['type-annotation-error', 'Unknown type "Inner"'],
    ]);
    expect(() => ce.type('Inner<integer>')).toThrow();
    const r2 = executeEpsil(ce, 'let z: Inner<integer> = (3, 4)\nz');
    expect(r2.diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "Inner"'],
    ]);
  });

  test('a NOMINAL type with a clause declares an opaque parameterized type', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'type gen<T> = tuple<T, T>\nlet a = 1\na');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('1');
    expect(ce.type('gen<integer>').toString()).toBe('gen<integer>');
  });
});
