import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

//
// Phase 2 of the function-polymorphism design
// (docs/TYPE-SYSTEM.md §4.5–§4.6): the
// Epsil surface of multi-clause function definitions.
//
// - Literal parameters (`f(0) = 1`, `f("yes") = …`, `f(true) = …`) in BOTH
//   definition forms, lowered to anonymous value-typed parameters
//   `["Typed", "literalParam_<n>", {str: "<value>"}]` (§4.5).
// - Definition statements lower to `DefineFunction` and ACCUMULATE clauses
//   (D6); a plain assignment still full-replaces.
// - `About(f)` lists the clause set with the two v1 annotations (§4.6).
// - Serialization renders the literal spelling back — generated parameter
//   names never surface.
//

function run(source: string): ReturnType<typeof executeEpsil> & {
  text: string;
} {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, source);
  return { ...result, text: result.value.toString() };
}

/** Parse (no diagnostics allowed) and return the MathJSON, offsets stripped. */
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

describe('EPSIL MULTI-CLAUSE — literal parameter lowering (§4.5)', () => {
  test('a number literal parameter (math form)', () => {
    expect(lowered('f(0) = 1')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 1, ['Typed', 'literalParam_1', { str: '0' }]],
    ]);
  });

  test('a negative decimal literal parameter', () => {
    expect(lowered('f(-2.5) = 0')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 0, ['Typed', 'literalParam_1', { str: '-2.5' }]],
    ]);
  });

  test('a string literal parameter, mixed with a symbol parameter', () => {
    expect(lowered('h("yes", x) = x')).toEqual([
      'DefineFunction',
      'h',
      ['Function', 'x', ['Typed', 'literalParam_1', { str: '"yes"' }], 'x'],
    ]);
  });

  test('a boolean literal parameter (block form)', () => {
    expect(lowered('function g(true) { 1 }')).toEqual([
      'DefineFunction',
      'g',
      ['Function', ['Block', 1], ['Typed', 'literalParam_1', { str: 'true' }]],
    ]);
  });

  test('repeated literal parameters get distinct generated names', () => {
    expect(lowered('f(0, 0) = 1')).toEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        1,
        ['Typed', 'literalParam_1', { str: '0' }],
        ['Typed', 'literalParam_2', { str: '0' }],
      ],
    ]);
  });

  test('an interpolated string is not a literal parameter', () => {
    const [, diags] = parseEpsil('f("a\\(x)b") = 1');
    expect(diags.map((d) => d.message[0] ?? d.message)).toContain(
      'literal-expected'
    );
  });

  test('Infinity and NaN are literal parameters (lowered to oo/NaN)', () => {
    // Both are numeric LITERALS in expression position, so the literal
    // reading is the consistent one — unlike `Pi`, a symbol everywhere,
    // which stays a parameter name.
    // NaN lowers to the CAPITALIZED `NaN`, the type grammar's value-literal
    // spelling. The lowercase `nan` names the not-a-number PRIMITIVE type, so
    // it would declare an ordinary typed parameter instead of a clause the
    // dispatcher matches against the NaN value.
    expect(lowered('f(Infinity) = 1')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 1, ['Typed', 'literalParam_1', { str: 'oo' }]],
    ]);
    expect(lowered('f(-Infinity) = 2')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 2, ['Typed', 'literalParam_1', { str: '-oo' }]],
    ]);
    expect(lowered('f(NaN) = 3')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 3, ['Typed', 'literalParam_1', { str: 'NaN' }]],
    ]);
  });

  test('`oo` is an input alias for Infinity (canonical output spelling)', () => {
    // Expression position: `oo` is the infinity literal.
    expect(lowered('x + oo')).toEqual(['Add', 'x', { num: '+Infinity' }]);
    // Parameter position: same lowering as `f(Infinity)`.
    expect(lowered('f(oo) = 1')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 1, ['Typed', 'literalParam_1', { str: 'oo' }]],
    ]);
    expect(lowered('f(-oo) = 2')).toEqual([
      'DefineFunction',
      'f',
      ['Function', 2, ['Typed', 'literalParam_1', { str: '-oo' }]],
    ]);
    // Serialization is canonical: `oo` in, `Infinity` out.
    const [e] = parseEpsil('f(oo) = 1');
    expect(serializeEpsil(e)).toBe('f(Infinity) = 1');
    // The CANONICAL type-text spellings (what `typeToString` emits for a
    // box-route marker) render the literal too — never the generated name.
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        ['Function', 1, ['Typed', 'literalParam_1', { str: 'Infinity' }]],
      ])
    ).toBe('f(Infinity) = 1');
    expect(
      serializeEpsil([
        'DefineFunction',
        'f',
        ['Function', 1, ['Typed', 'literalParam_1', { str: 'NaN' }]],
      ])
    ).toBe('f(NaN) = 1');
  });

  test('`oo` in match-pattern position is the Infinity literal, not a binding', () => {
    const { text, diagnostics } = run(`
match 5 {
  oo => 1
  _ => 3
}`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('3');
    // Note the subject must BE +Infinity — `1 / 0` is ComplexInfinity
    // (`~oo`), which the positive-infinity literal correctly refuses.
    const inf = run(`
match Infinity {
  oo => "infinite"
  _ => "finite"
}`);
    expect(inf.value.toString()).toContain('infinite');
  });

  test('the generated-name prefix is reserved for user parameters', () => {
    // A user parameter wearing the reserved prefix would be
    // indistinguishable from a generated one (serialization would drop
    // its name), so it is rejected at parse time.
    const [, diags] = parseEpsil('f(literalParam_1: integer) = 1');
    expect(diags.map((d) => d.message[0] ?? d.message)).toContain(
      'reserved-word'
    );
  });

  test('a string parameter with control characters round-trips', () => {
    const src = 'f("a\\nb") = 1';
    const [expr, diags] = parseEpsil(src);
    expect(diags).toEqual([]);
    const out = serializeEpsil(expr);
    expect(out).toBe(src);
    const [expr2, diags2] = parseEpsil(out);
    expect(diags2).toEqual([]);
    expect(strip(expr2)).toEqual(strip(expr));
  });
});

describe('EPSIL MULTI-CLAUSE — accumulation and dispatch', () => {
  test('the §1 acceptance case: fib from three clauses', () => {
    const { text, diagnostics } = run(`
fib(0) = 0
fib(1) = 1
fib(n: integer) = fib(n - 1) + fib(n - 2)
fib(10)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('55');
  });

  test('both definition forms accumulate onto the same function', () => {
    const { text, diagnostics } = run(`
function fact(0) { 1 }
fact(n: integer) = n * fact(n - 1)
fact(5)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('120');
  });

  test('most-specific wins regardless of declaration order', () => {
    const { text, diagnostics } = run(`
f(n: integer) = n + 1
f(0) = 100
f(0)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('100');
  });

  test('boolean literal clauses dispatch on an evaluated condition', () => {
    const { text, diagnostics } = run(`
b(true) = "yes"
b(false) = "no"
b(2 > 1)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('"yes"');
  });

  test('string literal clauses dispatch by value', () => {
    const { text, diagnostics } = run(`
mode("fast") = 1
mode("slow") = 2
mode(s: string) = 0
mode("slow")`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('2');
  });

  test('a same-signature redefinition within ONE program is refused', () => {
    // REDEFINITION DISCIPLINE (user ruling 2026-08-14). This test previously
    // asserted the opposite and called itself "notebook re-run", but a re-run
    // is a SEPARATE program — a third statement of the same program is not one
    // (see the next test for the real gesture). Within one program, a second
    // clause at an identical parameter list silently discarded the first, and
    // that is exactly the value-changing overwrite the ruling refuses.
    const { diagnostics } = run(`
g(0) = 100
g(x: integer) = x + 1
g(0) = 999
g(0)`);
    expect(
      diagnostics.some((d) =>
        JSON.stringify(d.message).includes('function-redefinition')
      )
    ).toBe(true);
  });

  test('the same redefinition ACROSS programs replaces the clause (notebook re-run)', () => {
    // The real notebook gesture: re-running an edited cell is its own
    // compilation unit, so it replaces last-wins with no diagnostic.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'g(0) = 100');
    executeEpsil(ce, 'g(x: integer) = x + 1');
    const edited = executeEpsil(ce, 'g(0) = 999');
    expect(edited.diagnostics).toEqual([]);
    expect(executeEpsil(ce, 'g(0)').value.toString()).toBe('999');
    // ...and the OTHER clause is untouched by the replacement.
    expect(executeEpsil(ce, 'g(5)').value.toString()).toBe('6');
  });

  test('clauses accumulate onto a DECLARED signature (declare-then-define)', () => {
    // The prescribed shape for a recursive definition: each clause is an ARM
    // of the declaration (`0 <: number`), never a function-subtype of it.
    const { text, diagnostics } = run(`
let fact: (number) -> number
fact(0) = 1
fact(n: integer) = n * fact(n - 1)
fact(5)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('120');
  });

  test('a clause parameter may be left BARE under a declaration', () => {
    // The declaration is authoritative for parameters, not only for the
    // result: a bare parameter takes the declared type at its position. Before
    // that held, this program failed outright — `n` inferred `unknown`, so
    // `n - 1` widened to `number` and the recursive self-call was rejected
    // against the very declaration written to make it check ("the clause
    // "(unknown) -> integer" is not an arm of the declared type"). Annotating
    // the parameter a second time was the only way through.
    const { text, diagnostics } = run(`
let fact: (integer) -> integer
fact(0) = 1
fact(n) = n * fact(n - 1)
fact(5)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('120');
  });

  test('a bare parameter does not weaken the declared domain', () => {
    // Ascribing the declared type onto a BARE parameter must not make the
    // symbol's own type wider than the declaration: a second bare clause is the
    // SAME clause, so it is refused as a redefinition rather than appended as
    // an `(unknown) -> …` arm. The shape to watch for is the nonsense
    // intersection `((n: integer) -> integer) & ((unknown) -> number)`.
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      'let f: (integer) -> integer\nf(n) = 1\nf(m) = 2'
    );
    expect(JSON.stringify(diagnostics)).toContain('function-redefinition');
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(executeEpsil(ce, 'f(1)').value.toString()).toBe('1');
  });

  test('an explicit `x: unknown` annotation is still checked, unlike a bare parameter', () => {
    // The bypass for an un-narrowed parameter keys on what the author WROTE,
    // not on the resulting type. Keying on the type would wave through an
    // author-written `unknown` annotation, which is a stated arm and is not a
    // subtype of the declared domain — the same hole the adjacent test closes
    // for `string`.
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      'let f: (integer) -> integer\nf(x: unknown) = 1\nf(1)'
    );
    expect(JSON.stringify(diagnostics)).toContain('invalid clause definition');
  });

  test('an ANNOTATED clause parameter is still checked against the declaration', () => {
    // The relaxation is only for a parameter that narrows NOTHING. A parameter
    // the author annotated states an arm, and an arm outside the declared
    // domain is still the loud `invalid-clause-definition` — otherwise the
    // check the declaration exists to perform would have become vacuous.
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      'let k: (integer) -> integer\nk(n) = 1\nk(s: string) = 2\nk(1)'
    );
    expect(JSON.stringify(diagnostics)).toContain('invalid clause definition');
  });

  test('a plain assignment full-replaces the whole clause set (D6)', () => {
    const { text, diagnostics } = run(`
f(0) = 1
f(n: integer) = n + 1
f = x => 42
f(0)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('42');
  });

  test('an ALIAS type’s same-name function accumulates clauses (nominal §4.5)', () => {
    // An alias's same-name function is an ordinary function — unlike a
    // nominal type, whose name means the smart constructor. The first
    // definition replaces the minted identity constructor; later ones
    // accumulate.
    const ce = new ComputeEngine();
    const r1 = executeEpsil(
      ce,
      `type alias flag = boolean
flag(true) = 1
flag(false) = 0
flag(true)`
    );
    expect(r1.diagnostics).toEqual([]);
    expect(r1.value.toString()).toBe('1');
    const r2 = executeEpsil(ce, 'flag(false)');
    expect(r2.diagnostics).toEqual([]);
    expect(r2.value.toString()).toBe('0');
  });

  test('a NOMINAL type’s same-name function stays the constructor (§4.7)', () => {
    const { value, diagnostics } = run(`
type point = tuple<integer, integer>
function point(a: integer) { (a, a) }
point(7)`);
    expect(diagnostics).toEqual([]);
    expect(value.type.toString()).toBe('point');
  });

  test('Infinity and NaN clauses dispatch — "match only themselves"', () => {
    const { text, diagnostics } = run(`
f(Infinity) = 1
f(-Infinity) = 2
f(NaN) = 3
f(x: number) = 0
f(Infinity) + 10 * f(-Infinity) + 100 * f(NaN) + 1000 * f(5)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('321');
  });

  test('a post-evaluation miss is the no-matching-clause error value (D7)', () => {
    // `Floor(2.5) + 3` is statically an integer — admission is undecidable
    // against the value clauses, so the call passes validation; evaluation
    // reveals `6`, which every clause refutes.
    const { text } = run(`
f(0) = 1
f(1) = 2
f(Floor(2.5) + 3)`);
    expect(text).toContain('no-matching-clause');
  });
});

describe('EPSIL MULTI-CLAUSE — clause effect uniformity (D5)', () => {
  test('a conflicting explicit specifier is incompatible-clause-effects', () => {
    const { text } = run(`
function f(x: integer) random -> integer { Random(Range(1, x)) }
function f(0) pure -> integer { 1 }`);
    expect(text).toContain('incompatible-clause-effects');
  });

  test('an omitted specifier adopts the established row', () => {
    const { text, diagnostics } = run(`
function f(x: integer) random -> integer { Random(Range(1, x)) }
f(0) = 1
f(0)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('1');
  });
});

describe('EPSIL MULTI-CLAUSE — About clause listing (§4.6)', () => {
  test('clauses list in declaration order, literal params by their spelling', () => {
    const { text, diagnostics } = run(`
f(0) = 100
f(n: integer) = n + 1
About(f)`);
    expect(diagnostics).toEqual([]);
    expect(text).toContain('multi-clause function (2 clauses)');
    expect(text).toContain('clause 1: (0) ->');
    expect(text).toContain('clause 2: (n: integer) ->');
    // The generated parameter name never surfaces.
    expect(text).not.toContain('literalParam');
  });

  test('finite coverage: a boolean clause covered by true/false clauses', () => {
    const { text } = run(`
f(true) = 1
f(false) = 0
function f(b: boolean) { 2 }
About(f)`);
    expect(text).toContain('unreachable (covered)');
  });

  test('tie overlap: incomparable clauses that share points', () => {
    const { text } = run(`
g(x: integer, y: number) = 1
g(x: number, y: integer) = 2
About(g)`);
    expect(text).toContain(
      'overlaps clause 1; declaration order decides in the overlap'
    );
  });

  test('a single-clause function keeps today’s About (no clause listing)', () => {
    const { text } = run(`
f(x) = x + 1
About(f)`);
    expect(text).not.toContain('multi-clause function');
  });
});

describe('EPSIL MULTI-CLAUSE — serialization round-trip (§4.5)', () => {
  test.each([
    'f(0) = 1',
    'k(-2.5) = 0',
    'h("yes", x) = x',
    'function g(true) {1}',
    'f(0, 0) = 1',
    'f(Infinity) = 1',
    'f(-Infinity) = 2',
    'f(NaN) = 3',
  ])('%s round-trips through serializeEpsil', (src) => {
    const [expr, diags] = parseEpsil(src);
    expect(diags).toEqual([]);
    const out = serializeEpsil(expr);
    expect(out).toBe(src);
    const [expr2, diags2] = parseEpsil(out);
    expect(diags2).toEqual([]);
    expect(strip(expr2)).toEqual(strip(expr));
  });
});

describe('EPSIL MULTI-CLAUSE — glyph aliases (π, ∞)', () => {
  test('∞ is the Infinity literal in every position', () => {
    const { text, diagnostics } = run(`
f(∞) = 1
f(-∞) = 2
f(x: number) = 0
f(∞) + 10 * f(-∞) + 100 * f(7)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('21');
    // Serialization is canonical.
    const [e] = parseEpsil('f(∞) = 1');
    expect(serializeEpsil(e)).toBe('f(Infinity) = 1');
    // Reserved like the ASCII spelling.
    const [, d] = parseEpsil('let ∞ = 5');
    expect(d.map((x) => x.message[0] ?? x.message)).toContain('reserved-word');
  });

  test('π resolves to the constant in expression position', () => {
    const { value, diagnostics } = run('N(π)');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBeCloseTo(Math.PI, 12);
  });
});

describe('EPSIL MULTI-CLAUSE — broadcast over collections', () => {
  test('a recursive clause set maps over a range through the pipe operator', () => {
    // The README-style program: an untyped general clause, a numeric range,
    // auto-mapping (`5..10 |> fib` maps `fib` over the range — it does not
    // bind the whole range to `n`, which would recurse forever) and a reducer.
    const { text, diagnostics } = run(`
// Fibonacci

// Multi-clause function definition
fib(0) = 0
fib(1) = 1
fib(n) = fib(n - 1) + fib(n - 2)

// Numeric range, auto-mapping, and pipe operators to chain operations
5..10 |> fib |> Sum
`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('136');
  });

  test('a list argument maps element-wise', () => {
    const { text, diagnostics } = run(`
fib(0) = 0
fib(1) = 1
fib(n) = fib(n - 1) + fib(n - 2)
fib([5, 6])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('[5,8]');
  });

  test('a clause taking a list binds it whole (no broadcast)', () => {
    const { text, diagnostics } = run(`
len(0) = 0
len(xs: list<number>) = Length(xs)
len([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('3');
  });

  test('a hold function receives a list expression whole', () => {
    // A hold definition's operands are unevaluated expressions — never
    // elements to map over — so it is exempt from the broadcast.
    const { text, diagnostics } = run(`
hold show(e) = Head(e)
show([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('"List"');
  });

  test('an untyped symbol argument stays inert and keeps its type', () => {
    const { text, diagnostics } = run(`
g(0) = 0
g(n) = n^2
g(x)`);
    expect(diagnostics).toEqual([]);
    expect(text).toBe('g(x)');
  });
});
