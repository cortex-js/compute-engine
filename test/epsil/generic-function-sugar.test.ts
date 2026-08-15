import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

//
// M2 of the generic-function-literals design
// (docs/plans/2026-08-04-generic-function-literals-design.md §3): the SUGARED
// generic definition form
//
//     function f<T: number, U>(x: T, k: (T) any -> U) -> list<U> { … }
//
// The clause between the name and the parameter list lowers to a
// full-signature ascription carrying a trailing `where` clause (E2), with the
// parameters it quantifies ERASED to bare symbols — the signature is the
// single source of truth for their types (§3.1/§3.2). Serialization
// decomposes that marker back into the clause (§3.3), losslessly.
//
// Section (f) covers the SECOND binder spelling: the same clause written as a
// trailing `where` on the definition head
// (`docs/plans/2026-08-11-where-clause-type-constraints.md`). The two are
// synonyms — and writing both is an error.
//
// Everything the type grammar already validates about a `where` clause —
// unused variables, result-only variables, non-ground bounds, duplicates —
// comes back as a PARSE-TIME diagnostic for free, because the assembled
// signature is validated by the shared type DSL.
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function parseDiagnostics(source: string) {
  const [, diagnostics] = parseEpsil(source);
  return (diagnostics ?? []).map((d) => d.message);
}

/** Parse and return the MathJSON, source offsets stripped. */
function lowered(source: string): unknown {
  const [expr, diags] = parseEpsil(source);
  expect(diags).toEqual([]);
  return strip(expr);
}

function strip(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(strip);
  if (typeof e === 'object' && e !== null) {
    const o = e as Record<string, unknown>;
    if ('fn' in o) return (o.fn as unknown[]).map(strip);
    if ('sym' in o) return o.sym;
    if ('str' in o) return { str: o.str };
    if ('num' in o) {
      const n = Number(o.num);
      return Number.isFinite(n) ? n : { num: o.num };
    }
    return o;
  }
  return e;
}

/** Execute an Epsil program on a fresh engine. */
function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return {
    diagnostics: r.diagnostics.map((d) => d.message),
    value: r.value?.toString(),
    type: r.value?.type?.toString(),
  };
}

/** Serialize, re-parse, re-serialize: the round-trip is lossless when the two
 * serializations agree and the two parses produce the same MathJSON. */
function roundTrip(source: string): {
  text: string;
  stable: boolean;
  sameAst: boolean;
} {
  const [ast, diags] = parseEpsil(source);
  expect(diags).toEqual([]);
  const text = serializeEpsil(ast as any);
  const [ast2] = parseEpsil(text);
  return {
    text,
    stable: serializeEpsil(ast2 as any) === text,
    sameAst: JSON.stringify(strip(ast)) === JSON.stringify(strip(ast2)),
  };
}

//
// (a) Lowering: the clause becomes a `where`-quantified full-signature
// ascription and the quantified parameters lose their annotations.
//

describe('M2 SUGARED GENERICS — lowering (§3.1/§3.2)', () => {
  test('a quantified parameter lowers to a BARE symbol', () => {
    expect(lowered('function f<T>(x: T) -> T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) -> T where T' }],
        'x',
      ],
    ]);
  });

  test('a GROUND annotation keeps its `Typed` marker; the clause carries both', () => {
    expect(lowered('function f<T>(x: T, n: integer) -> T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T, n: integer) -> T where T' }],
        'x',
        ['Typed', 'n', { str: 'integer' }],
      ],
    ]);
  });

  test('an annotation that MENTIONS a variable is quantified — `list<T>` counts', () => {
    expect(
      lowered('function len<T>(xs: list<T>) -> integer { Length(xs) }')
    ).toEqual([
      'DefineFunction',
      'len',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Length', 'xs']],
          { str: '(xs: list<T>) -> integer where T' },
        ],
        'xs',
      ],
    ]);
  });

  test('a ground name that merely LOOKS like a variable is not quantified', () => {
    // `Tx` is not `T`: detection reads the type parser's own resolution of
    // identifiers, not a substring scan of the annotation text.
    expect(
      lowered('type Tx = integer\nfunction f<T>(x: T, y: Tx) -> T { x }')
    ).toEqual([
      'Block',
      ['DeclareType', 'Tx', { str: 'integer' }],
      [
        'DefineFunction',
        'f',
        [
          'Function',
          ['Typed', ['Block', 'x'], { str: '(x: T, y: Tx) -> T where T' }],
          'x',
          ['Typed', 'y', { str: 'Tx' }],
        ],
      ],
    ]);
  });

  test('with no `->` the result is the wide-result `unknown`', () => {
    expect(lowered('function f<T>(x: T) { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) -> unknown where T' }],
        'x',
      ],
    ]);
  });

  test('the effects slot composes with the clause', () => {
    expect(lowered('function tick<T>(x: T) random -> T { x }')).toEqual([
      'DefineFunction',
      'tick',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) random -> T where T' }],
        'x',
      ],
    ]);
  });

  test('a bound is preserved verbatim, including a MUNCHED `>>` close', () => {
    // `<T: list<integer>>` lexes its two closing angles as ONE `>>` operator
    // token — the clause is parsed from the raw source for exactly this
    // reason.
    expect(lowered('function f<T: list<integer>>(x: T) -> T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        [
          'Typed',
          ['Block', 'x'],
          { str: '(x: T) -> T where T: list<integer>' },
        ],
        'x',
      ],
    ]);
  });

  test('a SIGNATURE bound puts a `>` inside an `->` token and still parses', () => {
    expect(
      lowered('function h<T: (real) -> real>(k: T, x: real) -> real { k(x) }')
    ).toEqual([
      'DefineFunction',
      'h',
      [
        'Function',
        [
          'Typed',
          ['Block', ['k', 'x']],
          { str: '(k: T, x: real) -> real where T: (real) -> real' },
        ],
        'k',
        ['Typed', 'x', { str: 'real' }],
      ],
    ]);
  });
});

//
// (b) End to end: values and INSTANTIATED types.
//

describe('M2 SUGARED GENERICS — end to end', () => {
  test('identity instantiates per call, on one engine', () => {
    const def = 'function f<T>(x: T) -> T { x }';
    expect(run(`${def}\nf(5)`)).toMatchObject({
      diagnostics: [],
      value: '5',
      type: 'finite_integer',
    });
    expect(run(`${def}\nf("a")`)).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
    // No cross-call pollution: both instantiations in ONE program.
    expect(run(`${def}\nf(5)\nf("a")`)).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
  });

  test('the function value keeps its polytype', () => {
    expect(run('function f<T>(x: T) -> T { x }\nf')).toMatchObject({
      diagnostics: [],
      type: '(x: T) -> T where T',
    });
  });

  test('a bound is enforced at the call', () => {
    const def = 'function g<T: number>(x: T) -> T { x + x }';
    expect(run(`${def}\ng(3)`)).toMatchObject({
      diagnostics: [],
      value: '6',
      type: 'finite_integer',
    });
    expect(run(`${def}\ng("a")`).value).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"), "a")'
    );
  });

  test('two variables — swap', () => {
    const r = run(
      'function swap<T, U>(x: T, y: U) -> tuple<U, T> { (y, x) }\nswap(1, "a")'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('("a", 1)');
    expect(r.type).toBe('tuple<string, finite_integer>');
  });

  test('the effects slot works with the clause', () => {
    expect(
      run('function tick<T>(x: T) random -> T { x }\ntick(4)')
    ).toMatchObject({ diagnostics: [], value: '4', type: 'finite_integer' });
  });

  test('a SIGNATURE bound admits a matching function and refuses others', () => {
    const def =
      'function h<T: (real) -> real>(k: T, x: real) -> real { k(x) }\n' +
      'function dbl(y: real) -> real { y * 2 }\n';
    expect(run(`${def}h(dbl, 3)`)).toMatchObject({
      diagnostics: [],
      value: '6',
    });
    expect(run(`${def}h("a", 3)`).value).toBe(
      'Error(ErrorCode("incompatible-type", "(real) -> real", "string"), "a")'
    );
  });

  test('a GROUND parameter is still enforced; the erased one is not', () => {
    const def = 'function f<T>(x: T, n: integer) -> T { x }';
    expect(run(`${def}\nf("a", 2)`)).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
    expect(run(`${def}\nf(1, "a")`).value).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "string"), "a")'
    );
  });

  test('recursion through the statement form (the knot ties)', () => {
    const r = run(
      'function fact<T: number>(n: T) -> number { if n <= 1 { 1 } else { n * fact(n - 1) } }\nfact(5)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('120');
  });
});

//
// (c) Grammar diagnostics. Everything the type grammar validates about a
// `where` clause is inherited by the assembled signature — no bespoke checks.
//

describe('M2 SUGARED GENERICS — grammar diagnostics (§3.1/§3.2)', () => {
  test('an EMPTY clause has a dedicated diagnostic', () => {
    expect(parseDiagnostics('function f<>(x) { 1 }')).toEqual([
      ['empty-type-parameter-clause', 'f'],
    ]);
  });

  test('a DUPLICATE name has a dedicated diagnostic, reported once', () => {
    expect(parseDiagnostics('function f<T, T>(x: T) -> T { x }')).toEqual([
      ['duplicate-type-parameter', 'T'],
    ]);
  });

  test('an UNUSED variable is diagnosed by the assembled signature', () => {
    const diags = parseDiagnostics(
      'function f<T>(x: integer) -> integer { x }'
    );
    expect(diags.map((d) => d[0])).toEqual(['type-annotation-error']);
    expect(String(diags[0][1])).toContain(
      'The type variable `T` is quantified but never used'
    );
  });

  test('a RESULT-ONLY variable is diagnosed by the assembled signature', () => {
    const diags = parseDiagnostics('function f<T>() -> list<T> { 1 }');
    expect(diags.map((d) => d[0])).toEqual(['type-annotation-error']);
    expect(String(diags[0][1])).toContain(
      'occurs only in the result of its signature'
    );
  });

  test('an F-BOUNDED bound is an ordinary unknown-type error', () => {
    // The clause declares only `T`, so the `U` its bound names resolves to
    // nothing at all.
    expect(parseDiagnostics('function f<T: list<U>>(x: T) -> T { x }')).toEqual(
      [['type-annotation-error', 'Unknown type "U"']]
    );
  });

  test('a bound naming a SIBLING clause variable gets the ground-bound rule', () => {
    // All the clause's names are seeded before ANY bound is parsed (the rule
    // shared with the type layer's clause reader and the trailing `where`
    // clause), so `U` resolves and the assembled signature reports the real
    // problem — a bound must be ground — instead of `Unknown type "U"`.
    const diags = parseDiagnostics(
      'function f<T: list<U>, U>(x: T, y: U) -> T { x }'
    );
    expect(diags.map((d) => d[0])).toEqual(['type-annotation-error']);
    expect(String(diags[0][1])).toContain(
      'The bound of the type variable `T` must be a ground type'
    );
    // …and the same for a SELF-referential bound.
    expect(
      String(parseDiagnostics('function f<T: list<T>>(x: T) -> T { x }')[0][1])
    ).toContain('The bound of the type variable `T` must be a ground type');
  });

  test('G2 — a clause plus a LITERAL parameter is rejected at the parser', () => {
    // Checked BEFORE signature assembly, so the rejection names the real
    // problem instead of reporting an unused type variable.
    expect(parseDiagnostics('function f<T>(0) { 1 }')).toEqual([
      ['generic-clause-unsupported', 'f'],
    ]);
  });

  test('a REJECTED clause leaves the parameter annotations untouched', () => {
    // The erased lowering keys off the POST-rejection clause state: with the
    // clause dropped there is no quantified ascription to carry `x`'s type, so
    // erasing it here would silently turn this into an ordinary `f(x, 0)`
    // clause. (An unresolvable `T` then reads as `unknown` in the engine; when
    // the clause name shadows a real type, it resolves to that type.)
    const [expr, diags] = parseEpsil('function f<T>(x: T, 0) { x }');
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['generic-clause-unsupported', 'f'],
    ]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Block', 'x'],
        ['Typed', 'x', { str: 'T' }],
        ['Typed', 'literalParam_2', { str: '0' }],
      ],
    ]);
  });

  test('G7 — the clause scopes over the HEAD only; a body-local `T` errors', () => {
    expect(
      parseDiagnostics('function f<T>(x: T) -> T { let y: T = x; y }')
    ).toEqual([['type-annotation-error', 'Unknown type "T"']]);
  });

  test('G7 — a clause name shadows a user type for the head span only', () => {
    // Inside the head, `T` is the VARIABLE (so `f("a")` is admitted). After
    // the definition, the user's `T` is a type again.
    const source =
      'type T = integer\nfunction f<T>(x: T) -> T { x }\nlet y: T = 3\nf("a")';
    expect(parseDiagnostics(source)).toEqual([]);
    expect(run(source)).toMatchObject({ value: '"a"', type: 'string' });
  });

  test('`f<T>(x) = x` is NOT a definition', () => {
    // `f<T>(x)` is genuinely ambiguous with a relational/invisible-multiply
    // expression, so the math form does not claim the clause (§3.1).
    const [expr, diags] = parseEpsil('f<T>(x) = x');
    expect(diags ?? []).toEqual([]);
    expect(strip(expr)).toEqual([
      'Equal',
      ['Greater', ['Less', 'f', 'T'], 'x'],
      'x',
    ]);
  });
});

//
// (d) G2 — the engine-side gate, reached through the Epsil channel.
//

describe('M2 SUGARED GENERICS — G2 multi-clause rejection (§2.6)', () => {
  test('a ground clause onto a generic definition is refused', () => {
    const r = run(
      'function f<T>(x: T) -> T { x }\nfunction f(x: string) -> string { x }'
    );
    expect(r.value).toContain('generic-clause-unsupported');
  });

  test('a generic clause onto an existing definition is refused', () => {
    const r = run(
      'function f(x: string) -> string { x }\nfunction f<T>(x: T) -> T { x }'
    );
    expect(r.value).toContain('generic-clause-unsupported');
  });

  test('a non-final rejection surfaces as a runtime-error diagnostic', () => {
    const r = run(
      'function f<T>(x: T) -> T { x }\nfunction f(x: string) -> string { x }\nf(2)'
    );
    expect(r.diagnostics.map((d) => d[0])).toEqual(['runtime-error']);
    expect(String(r.diagnostics[0][1])).toContain(
      'generic clause unsupported'
    );
    // The first (generic) definition survives.
    expect(r.value).toBe('2');
  });
});

//
// (e) Serialization (§3.3). The decomposition predicate mirrors the engine's
// (`boxed-expression/function-literal.ts`): effects OR a non-empty clause.
//

describe('M2 SUGARED GENERICS — serialization (§3.3)', () => {
  test.each([
    ['function f<T: number>(x: T) -> T {x}'],
    ['function f<T>(x: T) -> T {x}'],
    ['function f<T>(x: T) {x}'],
    ['function tick<T>(x: T) random -> T {x}'],
    ['function swap<T, U>(x: T, y: U) -> tuple<U, T> {(y, x)}'],
    ['function h<T: (real) -> real>(k: T, x: real) -> real {k(x)}'],
    ['function f<T>(x: T, n: integer) -> T {x}'],
    ['function f<T: list<integer>>(x: T) -> T {x}'],
  ])('%s round-trips losslessly', (source) => {
    const r = roundTrip(source);
    expect(r.text).toBe(source);
    expect(r.stable).toBe(true);
    expect(r.sameAst).toBe(true);
  });

  test('a signature naming a USER-DECLARED type still decomposes', () => {
    // The marker is re-parsed to decompose it; a resolver-less parse throws
    // `Unknown type "Tx"` and the definition would silently lose its sugared
    // form. The serializer only needs names to round-trip TEXTUALLY, so the
    // re-parse uses a permissive resolver.
    const source = 'type Tx = integer\nfunction f<T>(x: T, y: Tx) -> T { x }';
    const r = roundTrip(source);
    expect(r.text).toBe(
      'type Tx = integer\nfunction f<T>(x: T, y: Tx) -> T {x}'
    );
    expect(r.stable).toBe(true);
    expect(r.sameAst).toBe(true);
  });

  test('parameter NAMES come from the operands, types from the marker', () => {
    // The marker's argument names are cosmetic (§2.3); the literal's operands
    // are the names of record. A marker name must never be serialized as a
    // parameter name.
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        [
          'Function',
          ['Typed', ['Block', 'y'], { str: '(zz: T) -> T where T' }],
          'y',
        ],
      ] as any)
    ).toBe('function f<T>(y: T) -> T {y}');
  });

  test('route parity — a hand-authored box-route E2 renders in sugared form', () => {
    const json = [
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) -> T where T' }],
        'x',
      ],
    ];
    expect(serializeEpsil(json as any)).toBe('function f<T>(x: T) -> T {x}');
    // …and it behaves identically to the parsed form.
    const ce = new ComputeEngine();
    ce.box(json as any).evaluate();
    expect(ce.box(['f', 5]).evaluate().toString()).toBe('5');
    expect(ce.symbol('f').type.toString()).toBe('(x: T) -> T where T');
  });

  test('a non-`Block` body still serializes in the `function` block form', () => {
    // The math form `f<T>(x) = …` is not a definition, so it must not be
    // emitted for a generic literal.
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        ['Function', ['Typed', 'x', { str: '(x: T) -> T where T' }], 'x'],
      ] as any)
    ).toBe('function f<T>(x: T) -> T {x}');
  });
});

//
// (f) The SECOND binder spelling: a trailing `where` clause on the definition
// head (`docs/plans/2026-08-11-where-clause-type-constraints.md`). The clause
// is always LAST — after the effects slot and after the return type — in every
// declaration form, and its names must nevertheless be in scope from the FIRST
// parameter annotation, which is what the lexical pre-scan buys.
//

describe('WHERE-CLAUSE BINDER — the five declaration spellings', () => {
  test('block form, annotated return', () => {
    expect(lowered('function f(x: T) -> T where T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) -> T where T' }],
        'x',
      ],
    ]);
    expect(run('function f(x: T) -> T where T { x }\nf(5)')).toMatchObject({
      diagnostics: [],
      value: '5',
      type: 'finite_integer',
    });
  });

  test('block form, return inferred — the wide-result `unknown`', () => {
    expect(lowered('function f(x: T) where T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) -> unknown where T' }],
        'x',
      ],
    ]);
    expect(run('function f(x: T) where T { x }\nf("a")')).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
  });

  test('block form with an effects slot — the clause still comes last', () => {
    expect(lowered('function tick(x: T) random -> T where T { x }')).toEqual([
      'DefineFunction',
      'tick',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: '(x: T) random -> T where T' }],
        'x',
      ],
    ]);
    expect(
      run('function tick(x: T) random -> T where T { x }\ntick(3)')
    ).toMatchObject({
      diagnostics: [],
      value: '3',
    });
  });

  test('math form (with `->`)', () => {
    expect(lowered('f(x: T) -> T where T = x + x')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Add', 'x', 'x'], { str: '(x: T) -> T where T' }],
        'x',
      ],
    ]);
    expect(run('f(x: T) -> T where T = x + x\nf(7)')).toMatchObject({
      diagnostics: [],
      value: '14',
    });
  });

  test('…and the math form WITHOUT `->` is NOT claimed', () => {
    // Same rule as the bare effect specifier (`f(x) random = 5`): the
    // definition lookahead claims `f( … ) = …` and `f( … ) -> T = …` only, so
    // `f(x) where T = 5` stays an ORDINARY expression statement — the `where`
    // is an unexpected symbol, not a clause.
    const [expr, diags] = parseEpsil('f(x) where T = 5');
    expect(strip(expr)).toEqual(['f', 'x']);
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['unexpected-symbol', 'where'],
    ]);
  });

  test('anonymous type — the clause has nowhere else to go', () => {
    expect(run('let f: (T) -> T where T = x => x\nf(5)')).toMatchObject({
      diagnostics: [],
      value: '5',
      type: 'finite_integer',
    });
  });
});

describe('WHERE-CLAUSE BINDER — binding, bounds and generic behavior', () => {
  test('a `where`-bound parameter is generic: two calls, two types', () => {
    // The pre-scan is what makes this work: `x: T` is parsed BEFORE the clause
    // is reached, so `T` has to be seeded from a lexical scan.
    expect(run('function id(x: T) -> T where T { x }\nid(5)')).toMatchObject({
      value: '5',
      type: 'finite_integer',
    });
    expect(run('function id(x: T) -> T where T { x }\nid("a")')).toMatchObject({
      value: '"a"',
      type: 'string',
    });
  });

  test('…and both instantiations live on ONE engine', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function id(x: T) -> T where T { x }');
    expect(ce.box(['id', 5]).evaluate().toString()).toBe('5');
    expect(
      ce
        .box(['id', { str: 'a' }])
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  test('two variables, structural positions', () => {
    expect(
      run(
        'function swap(p: tuple<T, U>) -> tuple<U, T> where T, U { (p[2], p[1]) }\nswap((1, "a"))'
      )
    ).toMatchObject({
      diagnostics: [],
      value: '("a", 1)',
      type: 'tuple<string, finite_integer>',
    });
  });

  test('a bound is enforced at the call', () => {
    expect(
      run('function f(x: T) -> T where T: number { x }\nf("a")').value
    ).toBe('Error(ErrorCode("incompatible-type", "number", "string"), "a")');
  });

  test('a BOUND containing `->` and brackets keeps the clause extent right', () => {
    expect(
      lowered(
        'function h(k: T, x: real) -> real where T: (real) -> real { k(x) }'
      )
    ).toEqual([
      'DefineFunction',
      'h',
      [
        'Function',
        [
          'Typed',
          ['Block', ['k', 'x']],
          { str: '(k: T, x: real) -> real where T: (real) -> real' },
        ],
        'k',
        ['Typed', 'x', { str: 'real' }],
      ],
    ]);
  });

  test('the clause names are OUT of scope in the BODY', () => {
    // G7: the clause scopes over the HEAD only.
    expect(
      parseDiagnostics('function f(x: T) -> T where T { let y: T = x\ny }')
    ).toEqual([['type-annotation-error', 'Unknown type "T"']]);
  });

  test('the type grammar’s own validations come back for free', () => {
    expect(parseDiagnostics('function f(x: T) -> T where T, U { x }')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `U` is quantified but never used',
      ],
    ]);
    expect(
      parseDiagnostics('function f(x: integer) -> T where T { x }')
    ).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `T` occurs only in the result of its signature, so it can never be solved. Write the ground type directly',
      ],
    ]);
    expect(parseDiagnostics('function f(x: T) -> T where T, T { x }')).toEqual([
      [
        'type-annotation-error',
        'The type variable `T` is declared more than once',
      ],
    ]);
  });

  // The `is` slot is ACTIVE since phase 4 of the protocols design (P19): the
  // parser admits it (conformance is not a syntactic property — it has no
  // registry), and the engine checks the constraint at each call site.
  test('the `is` slot parses with no diagnostic', () => {
    expect(
      parseDiagnostics('function f(x: T) -> T where T is Hashable { x }')
    ).toEqual([]);
  });

  test('…and the constraint is checked at the call site', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {});
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Hashable'],
    ] as any).evaluate();
    const conforming = executeEpsil(
      ce,
      'function f(x: T) -> T where T is Hashable { x }\nf("a")'
    );
    expect(String(conforming.value)).toBe('"a"');
    expect(String(executeEpsil(ce, 'f(1)').value)).toContain(
      'protocol-constraint-unsatisfied'
    );
  });
});

describe('WHERE-CLAUSE BINDER — one binding site per declaration', () => {
  test('`<T>` and `where` on the same definition is an error', () => {
    const source = 'function f<T>(x: T) -> T where T: number { x }';
    const [, diags] = parseEpsil(source);
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['duplicate-type-parameter-clause', 'f'],
    ]);
    // …and the diagnostic spans the `where` clause, not the `<T>` binder.
    expect(diags![0].range[0]).toBe(source.indexOf('where'));
  });

  test('…and the `<T>` clause wins: the definition still works', () => {
    expect(
      run('function f<T>(x: T) -> T where T: number { x }\nf(5)').value
    ).toBe('5');
  });
});

//
// A clause that does not survive — syntactically (it never parsed) or
// semantically (the assembled signature was refused) — must leave the
// definition with NO ascription (one naming a variable nothing declares) and
// with its parameter annotations INTACT: a definition that failed to parse
// must not end up more permissive than its source. Same recovery as the G2
// literal-parameter rejection.
//

describe('WHERE-CLAUSE BINDER — clause-failure recovery', () => {
  test('a SYNTACTICALLY malformed clause leaves no dangling ascription (block form)', () => {
    // `is` with no protocol name: the clause never parses, so nothing
    // quantifies `T` and the body must not be ascribed `-> T`.
    const [expr, diags] = parseEpsil('function f(x: T) -> T where T is { x }');
    expect((diags ?? []).map((d) => d.message)).toEqual([['symbol-expected']]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      ['Function', ['Block', 'x'], ['Typed', 'x', { str: 'T' }]],
    ]);
  });

  test('…a bound-less `where T:` too', () => {
    const [expr, diags] = parseEpsil('function f(x: T) -> T where T: { x }');
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      ['Function', ['Block', 'x'], ['Typed', 'x', { str: 'T' }]],
    ]);
  });

  test('…and a NAMELESS `where` is diagnosed, not silently quantified', () => {
    // Nothing is seeded (the pre-scan finds no name), so the annotation is an
    // ordinary unknown type and the head never completes.
    expect(parseDiagnostics('function f(x: T) -> T where { x }')).toEqual([
      ['type-annotation-error', 'Unknown type "T"'],
      ['opening-bracket-expected', '{'],
    ]);
  });

  test('a SYNTACTICALLY malformed clause, math form', () => {
    const [expr, diags] = parseEpsil('f(x: T) -> T where T is = x');
    expect((diags ?? []).map((d) => d.message)).toEqual([['symbol-expected']]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      ['Function', 'x', ['Typed', 'x', { str: 'T' }]],
    ]);
  });

  test('a SEMANTICALLY rejected clause keeps the parameter annotations (block form)', () => {
    // `U` is quantified but never used, so the assembled signature is refused
    // — and with no signature to carry `x`'s type, erasing its annotation
    // would make the definition MORE permissive than what was written.
    const [expr, diags] = parseEpsil(
      'function f(x: T, n: integer) -> T where T, U { x }'
    );
    expect((diags ?? []).map((d) => d.message)).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `U` is quantified but never used',
      ],
    ]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Block', 'x'],
        ['Typed', 'x', { str: 'T' }],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ]);
    // The pre-existing fallback semantics: the definition still runs (`T` is
    // an unresolved — hence `unknown` — name).
    expect(
      run('function f(x: T, n: integer) -> T where T, U { x }\nf(1, 2)').value
    ).toBe('1');
  });

  test('a SEMANTICALLY rejected clause keeps the parameter annotations (math form)', () => {
    const [expr, diags] = parseEpsil('f(x: T) -> T where T, U = x');
    expect((diags ?? []).map((d) => d.message)).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `U` is quantified but never used',
      ],
    ]);
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      ['Function', 'x', ['Typed', 'x', { str: 'T' }]],
    ]);
  });
});

describe('WHERE-CLAUSE BINDER — a clause in a comma-delimited annotation', () => {
  const NESTED =
    'A `where` clause can only quantify a top-level signature (or one arm of an overload set), not a nested one. Parenthesize a nested clause: `((A) -> B where A, B)`';

  test('a clause in a PARAMETER annotation errors at the `where`', () => {
    const source = 'function f(x: (T) -> T where T) { 1 }';
    const [, diags] = parseEpsil(source);
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['type-annotation-error', NESTED],
    ]);
    expect(diags![0].range[0]).toBe(source.indexOf('where'));
  });

  test('…and it does not EAT the following parameter', () => {
    // The sharp case: `where T, y: real` is simultaneously a well-formed
    // `<var_decl>` list and a well-formed next parameter. `y` must survive.
    const source = 'function f(x: (integer) -> integer where T, y: real) { y }';
    const [expr, diags] = parseEpsil(source);
    expect((diags ?? []).map((d) => d.message)).toEqual([
      ['type-annotation-error', NESTED],
    ]);
    expect(diags![0].range[0]).toBe(source.indexOf('where'));
    expect(strip(expr)).toEqual([
      'DefineFunction',
      'f',
      ['Function', ['Block', 'y'], 'x', ['Typed', 'y', { str: 'real' }]],
    ]);
  });

  test('a COMMENTED-OUT `where` is not a clause', () => {
    // The pre-scan reads raw source, so it has to skip comments (and string
    // literals) itself — otherwise a commented-out clause silently seeds its
    // names and swallows the `Unknown type` the annotation deserves.
    expect(
      parseDiagnostics('function f(x: T) /* where T */ -> T { x }')
    ).toEqual([
      ['type-annotation-error', 'Unknown type "T"'],
      ['opening-bracket-expected', '{'],
    ]);
  });

  test('a `where` inside a STRING literal is not a clause either', () => {
    expect(lowered('f("where T", x) = 1')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 1, ['Typed', 'literalParam_1', { str: '"where T"' }], 'x'],
    ]);
  });

  test('`where` stays an ordinary identifier everywhere else', () => {
    expect(run('let where = 5\nwhere + 1').value).toBe('6');
    expect(run('f(where) = where + 1\nf(3)').value).toBe('4');
  });

  test('a PARENTHESIZED clause is admitted anywhere', () => {
    expect(lowered('f(x: ((T) -> T where T)) = x')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 'x', ['Typed', 'x', { str: '((T) -> T where T)' }]],
    ]);
  });
});
