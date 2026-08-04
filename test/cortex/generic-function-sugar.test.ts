import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';

//
// M2 of the generic-function-literals design
// (docs/plans/2026-08-04-generic-function-literals-design.md §3): the SUGARED
// generic definition form
//
//     function f<T: number, U>(x: T, k: (T) any -> U) -> list<U> { … }
//
// The clause between the name and the parameter list lowers to a
// `forall`-quantified full-signature ascription (E2), with the parameters it
// quantifies ERASED to bare symbols — the signature is the single source of
// truth for their types (§3.1/§3.2). Serialization decomposes that marker back
// into the clause (§3.3), losslessly.
//
// Everything the type grammar already validates about a `forall` clause —
// unused variables, result-only variables, non-ground bounds, duplicates —
// comes back as a PARSE-TIME diagnostic for free, because the assembled
// signature is validated by the shared type DSL.
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function parseDiagnostics(source: string) {
  const [, diagnostics] = parseCortex(source);
  return (diagnostics ?? []).map((d) => d.message);
}

/** Parse and return the MathJSON, source offsets stripped. */
function lowered(source: string): unknown {
  const [expr, diags] = parseCortex(source);
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

/** Execute a Cortex program on a fresh engine. */
function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeCortex(ce, source);
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
  const [ast, diags] = parseCortex(source);
  expect(diags).toEqual([]);
  const text = serializeCortex(ast as any);
  const [ast2] = parseCortex(text);
  return {
    text,
    stable: serializeCortex(ast2 as any) === text,
    sameAst: JSON.stringify(strip(ast)) === JSON.stringify(strip(ast2)),
  };
}

//
// (a) Lowering: the clause becomes a `forall` full-signature ascription and the
// quantified parameters lose their annotations.
//

describe('M2 SUGARED GENERICS — lowering (§3.1/§3.2)', () => {
  test('a quantified parameter lowers to a BARE symbol', () => {
    expect(lowered('function f<T>(x: T) -> T { x }')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: 'forall T. (x: T) -> T' }],
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
        ['Typed', ['Block', 'x'], { str: 'forall T. (x: T, n: integer) -> T' }],
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
          { str: 'forall T. (xs: list<T>) -> integer' },
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
          ['Typed', ['Block', 'x'], { str: 'forall T. (x: T, y: Tx) -> T' }],
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
        ['Typed', ['Block', 'x'], { str: 'forall T. (x: T) -> unknown' }],
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
        ['Typed', ['Block', 'x'], { str: 'forall T. (x: T) random -> T' }],
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
          { str: 'forall T: list<integer>. (x: T) -> T' },
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
          { str: 'forall T: (real) -> real. (k: T, x: real) -> real' },
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
      type: 'forall T. (x: T) -> T',
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
      'Error(ErrorCode("incompatible-type", "number", "string"))'
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
      'Error(ErrorCode("incompatible-type", "(real) -> real", "string"))'
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
      'Error(ErrorCode("incompatible-type", "integer", "string"))'
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
// `forall` clause is inherited by the assembled signature — no bespoke checks.
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
    // Bounds parse with the clause's own names NOT in scope (F-bounded bounds
    // are out of scope for this milestone), so `U` never resolves.
    expect(parseDiagnostics('function f<T: list<U>>(x: T) -> T { x }')).toEqual(
      [['type-annotation-error', 'Unknown type "U"']]
    );
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
    // clause dropped there is no `forall` ascription to carry `x`'s type, so
    // erasing it here would silently turn this into an ordinary `f(x, 0)`
    // clause. (An unresolvable `T` then reads as `unknown` in the engine; when
    // the clause name shadows a real type, it resolves to that type.)
    const [expr, diags] = parseCortex('function f<T>(x: T, 0) { x }');
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
    const [expr, diags] = parseCortex('f<T>(x) = x');
    expect(diags ?? []).toEqual([]);
    expect(strip(expr)).toEqual([
      'Assign',
      ['Greater', ['Less', 'f', 'T'], 'x'],
      'x',
    ]);
  });
});

//
// (d) G2 — the engine-side gate, reached through the Cortex channel.
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
    expect(String(r.diagnostics[0][1])).toContain('generic-clause-unsupported');
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
      serializeCortex([
        'DefineFunction',
        'f',
        [
          'Function',
          ['Typed', ['Block', 'y'], { str: 'forall T. (zz: T) -> T' }],
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
        ['Typed', ['Block', 'x'], { str: 'forall T. (x: T) -> T' }],
        'x',
      ],
    ];
    expect(serializeCortex(json as any)).toBe('function f<T>(x: T) -> T {x}');
    // …and it behaves identically to the parsed form.
    const ce = new ComputeEngine();
    ce.box(json as any).evaluate();
    expect(ce.box(['f', 5]).evaluate().toString()).toBe('5');
    expect(ce.symbol('f').type.toString()).toBe('forall T. (x: T) -> T');
  });

  test('a non-`Block` body still serializes in the `function` block form', () => {
    // The math form `f<T>(x) = …` is not a definition, so it must not be
    // emitted for a generic literal.
    expect(
      serializeCortex([
        'DefineFunction',
        'f',
        ['Function', ['Typed', 'x', { str: 'forall T. (x: T) -> T' }], 'x'],
      ] as any)
    ).toBe('function f<T>(x: T) -> T {x}');
  });
});
