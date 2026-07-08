import { ComputeEngine } from '../../src/compute-engine';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
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

const FLAT = new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'And', 'Or']);

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

  // Add / Subtract
  ['Add binary', ['Add', 'a', 'b']],
  ['Add n-ary', ['Add', 'a', 'b', 'c']],
  ['Subtract', ['Subtract', 'a', 'b']],
  ['Subtract chain', ['Subtract', 'a', 'b', 'c']],

  // Multiply / Divide
  ['Multiply binary (symbols)', ['Multiply', 'a', 'b']],
  ['Multiply n-ary', ['Multiply', 'a', 'b', 'c']],
  ['Divide', ['Divide', 'n', 4]],

  // Invisible multiply (documented `2x` normalization)
  ['invisible 2x', ['Multiply', 2, 'x']],
  ['symbol×number stays explicit', ['Multiply', 'x', 2]],
  ['number×group stays explicit', ['Multiply', 2, ['Add', 3, 4]]],

  // Power
  ['Power', ['Power', 'x', 2]],
  ['Power negative exponent', ['Power', 'x', -2]],
  ['Power right-assoc', ['Power', 'x', ['Power', 'y', 'z']]],
  ['Power of a sum', ['Power', ['Add', 'x', 1], 2]],

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
  ['If (generic function form)', ['If', 'c', 't', 'e']],

  // Interpolated string
  ['String interpolation', ['String', "'hello'", 'name']],

  // Nesting
  ['nested arithmetic', ['Add', ['Multiply', 2, 'x'], ['Power', 'y', 3]]],
  [
    'deep mixed',
    ['Equal', ['Add', 'a', ['Multiply', 'b', 'c']], ['Divide', 1, 2]],
  ],
];

describe('CORTEX ROUND-TRIP', () => {
  test.each(CORPUS)('%s', (_label, expr) => {
    const src = serializeCortex(expr);
    expect(typeof src).toBe('string');

    const [value, diagnostics] = parseCortex(src);

    // No corpus expression may re-parse with a diagnostic.
    expect(diagnostics.map((d) => d.message)).toEqual([]);

    expect(normalize(value)).toEqual(normalize(expr));
  });
});

//
// Loose-syntax compatibility spot-check (Phase 3, item 5).
//
// Cortex is a *programming-language* syntax; the engine's loose math parser
// (`ce.parse(src, { canonical: false })`) is a LaTeX/ASCII-math parser. They
// overlap on a handful of surface forms. This table records, for each overlap
// construct, whether the two agree — and where they diverge, the divergence is
// documented in `src/cortex/docs/syntax.md` ("Relationship to the loose math
// parser"). We assert the *documented* relationship so a change to either
// parser is caught here.
//
describe('CORTEX vs loose math parser', () => {
  const ce = new ComputeEngine();
  const cortex = (s: string) => normalize(parseCortex(s)[0]);
  const loose = (s: string) => normalize(ce.parse(s, { canonical: false }).json);

  test('[1, 2, 3] — SAME (List)', () => {
    expect(cortex('[1, 2, 3]')).toEqual(loose('[1, 2, 3]'));
  });

  test('x^2 — SAME (Power)', () => {
    expect(cortex('x^2')).toEqual(loose('x^2'));
  });

  // Documented divergences: Cortex assigns programming-language meaning; the
  // loose math parser does something else. These assert the divergence stands.
  test('** — DIVERGES (Power vs math-parser artifact)', () => {
    expect(cortex('2**3')).toEqual(['Power', { num: '2' }, { num: '3' }]);
    expect(cortex('2**3')).not.toEqual(loose('2**3'));
  });

  test('|> — DIVERGES (Pipe vs Apply)', () => {
    expect(cortex('a |> b')).toEqual(['Pipe', 'a', 'b']);
    expect(cortex('a |> b')).not.toEqual(loose('a |> b'));
  });

  test('f(x, y) — DIVERGES (call vs InvisibleOperator/Delimiter)', () => {
    expect(cortex('f(x, y)')).toEqual(['f', 'x', 'y']);
    expect(cortex('f(x, y)')).not.toEqual(loose('f(x, y)'));
  });

  test('bare function name — DIVERGES (symbol vs letter split)', () => {
    expect(cortex('sin')).toEqual('sin');
    expect(cortex('sin')).not.toEqual(loose('sin'));
  });

  test('2x — DIVERGES (Multiply vs InvisibleOperator)', () => {
    expect(cortex('2x')).toEqual(['Multiply', { num: '2' }, 'x']);
    expect(cortex('2x')).not.toEqual(loose('2x'));
  });
});
