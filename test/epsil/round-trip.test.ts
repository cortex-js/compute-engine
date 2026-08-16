import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { MathJsonExpression } from '../../src/math-json/types';

//
// Round-trip coherence (Phase 3).
//
// For every construct the Phase 2 grammar can produce, assert that
// `parse(serialize(expr))` is *structurally* equal to `expr`, modulo a small
// set of documented normalizations:
//
//   1. Number formatting        `2` ≡ `{num:"2"}` ≡ `"2"`.
//   2. Negate of a literal       `["Negate", 3]` folds to `{num:"-3"}`,
//                                `["Negate", -1]` folds to `{num:"1"}`.
//   3. `Rational` ≡ `Divide`     the grammar has no rational literal, so
//                                `["Rational", 1, 2]` re-parses as `Divide`.
//   4. Associative flattening    the parser emits left-nested binary trees for
//                                `Add`/`Subtract`/`Multiply`/`Divide`/`And`/
//                                `Or`; a flat n-ary and its nesting are the
//                                same expression.
//
// `normalize()` applies all four to both sides before comparing, and the
// harness additionally asserts that nothing in the corpus re-parses with a
// diagnostic.
//

// `Coalesce` joins the associative-flattening set for a different reason than
// the arithmetic heads: it is variadic in MathJSON but right-associative in
// Epsil, and the two shapes are observationally equal (an undecided operand
// leaves the tail unevaluated), so the serializer spells both as one `??`
// chain.
const FLAT = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'And',
  'Or',
  'Coalesce',
]);

function toNum(s: string): string {
  let t = s.replace(/_/g, '');
  if (t.startsWith('+')) t = t.slice(1);
  return t;
}
function negNum(n: string): string {
  return n.startsWith('-') ? n.slice(1) : '-' + n;
}

/** Canonical, metadata-free view used for structural comparison. */
function normalize(e: any): any {
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    if ('num' in e) return { num: toNum(String(e.num)) };
    if ('sym' in e) return e.sym;
    if ('str' in e) return { str: e.str };
    if ('fn' in e) return normalize(e.fn);
  }
  if (typeof e === 'number' || typeof e === 'bigint')
    return { num: toNum(String(e)) };
  if (typeof e === 'string') {
    // A single-quoted MathJSON string literal, else a symbol.
    if (/^'[\s\S]*'$/.test(e)) return { str: e.slice(1, -1) };
    return e;
  }
  if (Array.isArray(e)) {
    let op = e[0];
    let args = e.slice(1).map(normalize);
    if (op === 'Rational') op = 'Divide'; // documented normalization (3)
    if (
      op === 'Negate' &&
      args.length === 1 &&
      args[0] &&
      typeof args[0] === 'object' &&
      'num' in args[0]
    )
      return { num: negNum(args[0].num) }; // documented normalization (2)
    if (FLAT.has(op)) {
      // documented normalization (4)
      const flat: any[] = [];
      for (const a of args) {
        if (Array.isArray(a) && a[0] === op) flat.push(...a.slice(1));
        else flat.push(a);
      }
      args = flat;
    }
    return [op, ...args];
  }
  return e;
}

// A hand-picked corpus covering every operator row, every collection / call /
// index form, the documented normalizations, and nesting. `label` names the
// construct so a failure points at it directly.
const CORPUS: [label: string, expr: MathJsonExpression][] = [
  // Numbers & number formatting
  ['integer', 42],
  ['negative literal', -7],
  ['decimal', 3.5],
  ['num object', { num: '123' }],

  // Symbols
  ['symbol', 'x'],
  ['reserved-word symbol', 'new'],

  // String literal
  ['string literal', { str: 'hello world' }],
  // A string whose value holds real control characters must round-trip: the
  // serializer emits `\t`/`\n`, and re-parsing cooks them back to the same
  // characters (regression: the parser used to double-escape a plain string).
  ['string with control chars', { str: 'a\tb\nc' }],

  // Add / Subtract
  ['Add binary', ['Add', 'a', 'b']],
  ['Add n-ary', ['Add', 'a', 'b', 'c']],
  ['Subtract', ['Subtract', 'a', 'b']],
  ['Subtract chain', ['Subtract', 'a', 'b', 'c']],

  // Multiply / Divide / Mod
  ['Multiply binary (symbols)', ['Multiply', 'a', 'b']],
  ['Multiply n-ary', ['Multiply', 'a', 'b', 'c']],
  ['Divide', ['Divide', 'n', 4]],
  ['Mod', ['Mod', 'a', 'b']],
  ['Mod in Add', ['Add', 'a', ['Mod', 'b', 'c']]],
  ['Mod of a sum', ['Mod', ['Add', 'a', 'b'], 'c']],

  // Invisible multiply (documented `2x` normalization)
  ['invisible 2x', ['Multiply', 2, 'x']],
  ['symbol×number stays explicit', ['Multiply', 'x', 2]],
  ['number×group stays explicit', ['Multiply', 2, ['Add', 3, 4]]],

  // Power
  ['Power', ['Power', 'x', 2]],
  ['Power negative exponent', ['Power', 'x', -2]],
  ['Power right-assoc', ['Power', 'x', ['Power', 'y', 'z']]],
  ['Power of a sum', ['Power', ['Add', 'x', 1], 2]],

  // Factorial (postfix)
  ['Factorial literal', ['Factorial', 5]],
  ['Factorial symbol', ['Factorial', 'n']],
  ['Factorial of a sum', ['Factorial', ['Add', 'a', 'b']]],
  ['Factorial nested', ['Factorial', ['Factorial', 'n']]],
  ['Factorial in Power exponent', ['Power', 2, ['Factorial', 3]]],
  ['Factorial of a Power', ['Factorial', ['Power', 'x', 2]]],
  ['Factorial of a call', ['Factorial', ['f', 'x']]],

  // Rational (documented `Rational ≡ Divide` normalization)
  ['Rational', ['Rational', 1, 2]],
  ['Rational in Add', ['Add', 2, ['Rational', 1, 2]]],

  // Relational
  ['Equal', ['Equal', 'a', 'b']],
  ['Same', ['Same', 'a', 'b']],
  ['NotEqual', ['NotEqual', 'a', 'b']],
  ['Less', ['Less', 'a', 'b']],
  ['Greater', ['Greater', 'a', 'b']],
  ['LessEqual', ['LessEqual', 'a', 'b']],
  ['GreaterEqual', ['GreaterEqual', 'a', 'b']],
  ['Element', ['Element', 'x', 'S']],
  ['NotElement', ['NotElement', 'x', 'S']],
  ['relational chain', ['Equal', 'a', 'b', 'c']],

  // Logical
  ['And', ['And', 'A', 'B']],
  ['Or', ['Or', 'A', 'B']],
  ['And/Or nesting', ['And', ['And', 'A', 'B'], ['Or', 'C', 'D']]],
  ['Not', ['Not', 'A']],

  // KeyValuePair / Assign / Pipe
  ['KeyValuePair', ['KeyValuePair', 'a', 'b']],
  ['Assign', ['Assign', 'x', 2]],
  ['Pipe', ['Pipe', 'a', 'b']],
  ['Coalesce', ['Coalesce', 'a', 'b']],
  // A variadic `Coalesce` serializes as the `??` chain and re-parses nested;
  // normalization (4) flattens both. The two shapes are observationally equal
  // — see the lazy-tail rule in `library/core.ts`.
  ['Coalesce variadic', ['Coalesce', 'a', 'b', 'c']],
  ['Coalesce nested', ['Coalesce', 'a', ['Coalesce', 'b', 'c']]],

  // Negate (documented sign-folding normalization)
  ['Negate symbol', ['Negate', 'x']],
  ['Negate literal', ['Negate', 3]],
  ['Negate negative literal', ['Negate', -1]],
  ['Negate of a sum', ['Negate', ['Add', 2, 3]]],

  // Collections
  ['List', ['List', 1, 2, 3]],
  ['List empty', ['List']],
  ['List nested', ['List', ['List', 1, 2], 3]],
  ['Set', ['Set', 1, 2, 3]],
  ['Set empty', ['Set']],
  ['Tuple', ['Tuple', 'a', 'b']],
  ['Tuple 3', ['Tuple', 'a', 'b', 'c']],
  ['Tuple nested', ['Tuple', 'a', ['Tuple', 1, 2]]],

  // Dictionary
  [
    'Dictionary',
    [
      'Dictionary',
      ['KeyValuePair', { str: 'one' }, 1],
      ['KeyValuePair', { str: 'two' }, 2],
    ],
  ],
  ['Dictionary empty', ['Dictionary']],

  // Call / Apply / Index
  ['call (bare symbol)', ['f', 'x', 'y']],
  ['call (no args)', ['f']],
  ['Apply (non-symbol callee)', ['Apply', ['getF'], 'x']],
  ['At', ['At', 'xs', 'i']],
  ['At multi-index', ['At', 'm', 'i', 'j']],
  ['At of a call', ['At', ['f', 'x'], 1]],

  // Block / If
  ['Block', ['Block', 'a', 2]],
  ['Block (3 statements)', ['Block', 'a', 'b', 'c']],
  ['Block empty', ['Block']],
  ['Block single statement', ['Block', 'a']],
  ['Block nested in expression', ['Add', ['Block', 'a', 'b'], 1]],
  ['Function with do-block body', ['Function', ['Block', 'a', 'b'], 'x']],

  // Typed function literals (Phase 4): typed params + return ascriptions
  // reconstruct their Epsil syntax (`f(x: integer) -> real = …`,
  // `(x: integer) => …`).
  [
    'typed math-style def',
    ['DefineFunction', 'f', ['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'integer' }]]],
  ],
  [
    'typed math-style def with return type',
    [
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Add', 'x', 1], { str: 'real' }],
        ['Typed', 'x', { str: 'integer' }],
      ],
    ],
  ],
  [
    'typed block def with return type',
    [
      'DefineFunction',
      'f',
      ['Function', ['Typed', ['Block', ['Add', 'x', 1]], { str: 'real' }], 'x'],
    ],
  ],
  [
    'literal-parameter def (multi-clause clause)',
    [
      'DefineFunction',
      'f',
      ['Function', 1, ['Typed', 'literalParam_1', { str: '0' }]],
    ],
  ],
  [
    'typed mapsto (single param)',
    ['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'integer' }]],
  ],
  [
    'typed mapsto (multiple params)',
    [
      'Function',
      ['Add', 'x', 'y'],
      ['Typed', 'x', { str: 'integer' }],
      ['Typed', 'y', { str: 'real' }],
    ],
  ],
  ['If (generic function form)', ['If', 'c', 't', 'e']],

  // Loops. `for` carries an `Element` iterator clause; `while` is an
  // unconditional `Loop` whose body opens with the break guard. A shape the
  // surface grammar cannot spell (several clauses, no guard) keeps the generic
  // `Loop(…)` call form, which re-parses to itself.
  ['for loop', ['Loop', ['Block', 'a'], ['Element', 'x', 'xs']]],
  [
    'for loop (tuple pattern)',
    [
      'Loop',
      ['Block', ['Add', 'p', 'q']],
      ['Element', ['Tuple', 'p', 'q'], 'pairs'],
    ],
  ],
  [
    'for loop (several statements)',
    ['Loop', ['Block', 'a', 'b', 'c'], ['Element', 'x', 'xs']],
  ],
  ['for loop (empty body)', ['Loop', ['Block'], ['Element', 'x', 'xs']]],
  [
    'for loop containing break',
    ['Loop', ['Block', ['Break']], ['Element', 'x', 'xs']],
  ],
  [
    'while loop',
    ['Loop', ['Block', ['If', ['Not', 'c'], ['Break']], ['Block', 'a']]],
  ],
  [
    'while loop (several statements)',
    ['Loop', ['Block', ['If', ['Not', 'c'], ['Break']], ['Block', 'a', 'b']]],
  ],
  // Outside any loop there is no keyword spelling: a bare `break` would
  // re-parse as the `control-outside-loop` diagnostic, which the harness
  // rejects, so this row also guards the call-form fallback.
  ['top-level Break', ['Break']],
  ['top-level Continue', ['Continue']],
  [
    'for loop containing continue',
    ['Loop', ['Block', ['Continue']], ['Element', 'x', 'xs']],
  ],
  // `break`/`continue` take their keyword spelling only inside a serialized
  // loop body, so the round trip has to survive both sides of that boundary:
  // the keyword in the body, and the call form in a function literal defined
  // in the body (the parser resets its loop context there, so a keyword would
  // re-parse as `control-outside-loop` instead of as this node).
  [
    'break inside a nested if in a loop',
    [
      'Loop',
      ['Block', ['If', ['Greater', 'x', 2], ['Block', ['Break']]], ['f', 'x']],
      ['Element', 'x', 'xs'],
    ],
  ],
  [
    'break inside a match arm in a loop',
    [
      'Loop',
      ['Block', ['Match', 'x', ['MatchCase', 1, ['Break']]]],
      ['Element', 'x', 'xs'],
    ],
  ],
  [
    'valued Break in a loop (no keyword spelling)',
    ['Loop', ['Block', ['Break', 3]], ['Element', 'x', 'xs']],
  ],
  [
    'Break in a function literal in a loop',
    [
      'Loop',
      ['Block', ['g', ['Function', ['Break'], 'y']]],
      ['Element', 'x', 'xs'],
    ],
  ],
  [
    'loop in a function literal in a loop',
    [
      'Loop',
      [
        'Block',
        [
          'Function',
          [
            'Block',
            ['Loop', ['Block', ['Break']], ['Element', 'z', 'zs']],
            ['Break'],
          ],
          'y',
        ],
      ],
      ['Element', 'x', 'xs'],
    ],
  ],
  [
    'Break in a generic Loop nested in a loop',
    [
      'Loop',
      [
        'Block',
        [
          'Loop',
          ['Block', ['Break']],
          ['Element', 'y', 'ys'],
          ['Element', 'z', 'zs'],
        ],
      ],
      ['Element', 'x', 'xs'],
    ],
  ],
  ['infinite Loop (no surface spelling)', ['Loop', ['Block', 'a']]],
  [
    'Loop with several iterator clauses (no surface spelling)',
    ['Loop', ['Block', 'a'], ['Element', 'x', 'xs'], ['Element', 'y', 'ys']],
  ],

  // Destructuring assignment: a `Tuple` in the target position of `Assign`.
  // Nothing special in the serializer — the generic infix `:=` form already
  // spells a tuple target — but it must keep round-tripping as an `Assign`
  // rather than degrading to `Equal`.
  [
    'destructuring assign',
    ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']],
  ],
  [
    'destructuring assign (nested, wildcard)',
    ['Assign', ['Tuple', 'a', ['Tuple', 'b', 'c'], '_'], 'p'],
  ],

  // Interpolated string
  ['String interpolation', ['String', "'hello'", 'name']],

  // Nesting
  ['nested arithmetic', ['Add', ['Multiply', 2, 'x'], ['Power', 'y', 3]]],
  [
    'deep mixed',
    ['Equal', ['Add', 'a', ['Multiply', 'b', 'c']], ['Divide', 1, 2]],
  ],
];

describe('EPSIL ROUND-TRIP', () => {
  test.each(CORPUS)('%s', (_label, expr) => {
    const src = serializeEpsil(expr);
    expect(typeof src).toBe('string');

    const [value, diagnostics] = parseEpsil(src);

    // No corpus expression may re-parse with a diagnostic.
    expect(diagnostics.map((d) => d.message)).toEqual([]);

    expect(normalize(value)).toEqual(normalize(expr));
  });
});

//
// Loop statements: the keyword spelling, not the `Loop(…)` call form.
//
// The corpus above pins the round-trip; these pin the SURFACE form the
// serializer emits, so a `for`/`while` that was parsed comes back spelled the
// way it was written (modulo the inline-block spacing every brace block uses,
// `if c {1}`).
//
describe('EPSIL LOOP SPELLING', () => {
  const spell = (src: string): string => serializeEpsil(parseEpsil(src)[0]!);

  test.each([
    ['for x in xs { x }', 'for x in xs {x}'],
    ['for (p, q) in pairs { p + q }', 'for (p, q) in pairs {p + q}'],
    // A nested pattern, and a collection that is itself an expression.
    ['for (a, (b, c)) in zip(u, v) { a }', 'for (a, (b, c)) in zip(u, v) {a}'],
    ['while c { x }', 'while c {x}'],
    ['while x > 0 { x - 1 }', 'while x > 0 {x - 1}'],
    // A negated condition survives the guard's own `Not`.
    ['while !done { step() }', 'while !done {step()}'],
    ['for x in xs { }', 'for x in xs {}'],
    ['while c { }', 'while c {}'],
    // Several statements, inline: `;`-separated, as in any brace block.
    ['for x in xs { f(x)\n g(x) }', 'for x in xs {f(x); g(x)}'],
    ['while c { f()\n g()\n h() }', 'while c {f(); g(); h()}'],
    // `break`/`continue` take their KEYWORD spelling inside a serialized loop
    // body — including nested in an `if`, a `match` arm, or a `do` block,
    // none of which is a loop boundary for the parser either. Outside a loop
    // they keep the call form `Break()` / `Continue()` (pinned in
    // statements.test.ts), which is the only spelling that re-parses there.
    ['for x in xs { break }', 'for x in xs {break}'],
    ['while c { continue }', 'while c {continue}'],
    ['for x in xs { if x > 2 { break } }', 'for x in xs {if x > 2 {break}}'],
    ['for x in xs { do { break } }', 'for x in xs {do {break}}'],
    ['while c { if d { continue } }', 'while c {if d {continue}}'],
    // The valued form has no keyword spelling (`break value` is not surface
    // syntax), so it stays a call even inside the loop.
    ['for x in xs { Break(3) }', 'for x in xs {Break(3)}'],
    // Nesting.
    [
      'for x in xs { for y in ys { f(x, y) } }',
      'for x in xs {for y in ys {f(x, y)}}',
    ],
    // A FUNCTION LITERAL resets the loop context, exactly as in the parser: a
    // `break` written inside a lambda defined in a loop is outside that loop,
    // so the node keeps its call form there. Both literal spellings — the
    // annotated arrow and the generic `Function(…)` call — are boundaries.
    [
      'for x in xs { g((y: integer) => Break()) }',
      'for x in xs {g((y: integer) => Break())}',
    ],
    [
      'for x in xs { g(Function(Break())) }',
      'for x in xs {g(Function(Break()))}',
    ],
    [
      'for x in xs { function h(y) { Break() } }',
      'for x in xs {function h(y) {Break()}}',
    ],
    ['for x in xs { h(y) = Break() }', 'for x in xs {h(y) = Break()}'],
    // …and a loop INSIDE that literal starts a fresh context, so its own body
    // gets the keyword again.
    [
      'for x in xs { function h(y) { for z in zs { break } } }',
      'for x in xs {function h(y) {for z in zs {break}}}',
    ],
  ])('%s', (src, expected) => {
    expect(spell(src)).toBe(expected);
    // …and the spelling re-parses to what the source parsed to.
    const [reparsed, diagnostics] = parseEpsil(expected);
    expect(diagnostics.map((d) => d.message)).toEqual([]);
    expect(normalize(reparsed)).toEqual(normalize(parseEpsil(src)[0]));
  });

  test('a multi-statement body stacks like a parsed one', () => {
    const src = 'for x in xs { let y = x + 1\n if y > 2 { break }\n g(y) }';
    const out = serializeEpsil(parseEpsil(src)[0]!, {
      margin: 30,
      softMargin: 24,
    } as any);
    expect(out).toBe(
      [
        'for x in xs {',
        '  let y = x + 1',
        '  if y > 2 {break}',
        '  g(y)',
        '}',
      ].join('\n')
    );
    expect(parseEpsil(out)[1].map((d) => d.message)).toEqual([]);
  });
});

//
// A parameter list that cannot be spelled at all takes the generic
// `Function(…)` call form — including when an annotation elsewhere in the list
// would otherwise force the arrow spelling. A `Tuple` pattern with a non-name
// leaf (raw MathJSON; the parser never builds one) has no source spelling, and
// emitting it as an empty slot — `(x: integer, ) => body` — does not re-parse.
//
describe('EPSIL UNSPELLABLE PARAMETER PATTERN', () => {
  const literal: MathJsonExpression = [
    'Function',
    'body',
    ['Typed', 'x', { str: 'integer' }],
    ['Tuple', 1, 'q'],
  ];

  test('an annotated literal with an unspellable pattern takes the call form', () => {
    const out = serializeEpsil(literal);
    expect(out).toBe('Function(body, x, (1, q))');
    const [value, diagnostics] = parseEpsil(out);
    expect(diagnostics.map((d) => d.message)).toEqual([]);
    // Re-parses as a `Function` literal with the pattern intact. (The stray
    // `Typed` is transparent in the generic form, as everywhere else — the
    // annotation, not the structure, is what is dropped.)
    expect(normalize(value)).toEqual([
      'Function',
      'body',
      'x',
      ['Tuple', { num: '1' }, 'q'],
    ]);
  });

  test('the same pattern in a named definition takes the call form too', () => {
    const out = serializeEpsil(['DefineFunction', 'f', literal]);
    expect(out).toBe('DefineFunction(f, Function(body, x, (1, q)))');
    expect(parseEpsil(out)[1].map((d) => d.message)).toEqual([]);
  });
});

//
// Loose-syntax compatibility spot-check (Phase 3, item 5).
//
// Epsil is a *programming-language* syntax; the engine's loose math parser
// (`ce.parse(src, { canonical: false })`) is a LaTeX/ASCII-math parser. They
// overlap on a handful of surface forms. This table records, for each overlap
// construct, whether the two agree — and where they diverge, the divergence is
// documented in `src/epsil/docs/syntax.md` ("Relationship to the loose math
// parser"). We assert the *documented* relationship so a change to either
// parser is caught here.
//
describe('EPSIL vs loose math parser', () => {
  const ce = new ComputeEngine();
  const epsil = (s: string) => normalize(parseEpsil(s)[0]);
  const loose = (s: string) => normalize(ce.parse(s, { canonical: false }).json);

  test('[1, 2, 3] — SAME (List)', () => {
    expect(epsil('[1, 2, 3]')).toEqual(loose('[1, 2, 3]'));
  });

  test('x^2 — SAME (Power)', () => {
    expect(epsil('x^2')).toEqual(loose('x^2'));
  });

  test('|> — SAME (Pipe)', () => {
    expect(epsil('a |> b')).toEqual(['Pipe', 'a', 'b']);
    expect(epsil('a |> b')).toEqual(loose('a |> b'));
  });

  // Documented divergences: Epsil assigns programming-language meaning; the
  // loose math parser does something else. These assert the divergence stands.
  test('** — DIVERGES (Power vs math-parser artifact)', () => {
    expect(epsil('2**3')).toEqual(['Power', { num: '2' }, { num: '3' }]);
    expect(epsil('2**3')).not.toEqual(loose('2**3'));
  });

  test('f(x, y) — DIVERGES (call vs InvisibleOperator/Delimiter)', () => {
    expect(epsil('f(x, y)')).toEqual(['f', 'x', 'y']);
    expect(epsil('f(x, y)')).not.toEqual(loose('f(x, y)'));
  });

  test('bare function name — DIVERGES (symbol vs letter split)', () => {
    expect(epsil('sin')).toEqual('sin');
    expect(epsil('sin')).not.toEqual(loose('sin'));
  });

  test('2x — DIVERGES (Multiply vs InvisibleOperator)', () => {
    expect(epsil('2x')).toEqual(['Multiply', { num: '2' }, 'x']);
    expect(epsil('2x')).not.toEqual(loose('2x'));
  });
});
