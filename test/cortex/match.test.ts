import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { validCortex } from '../utils';

//
// Cortex `match` surface grammar (Phase 3 of the match design,
// docs/plans/2026-07-12-cortex-match-design.md §2–3): parse, serialize, and
// execute a keyword-led `match subject { case… }` block. The engine `Match`/
// `MatchCase`/`Pin`/`Alternatives` heads (Phases 1–2) are exercised in
// test/compute-engine/match-expression.test.ts; here we cover the Cortex
// syntax that lowers to them.
//

/** Run a Cortex program against a fresh engine (injecting the LaTeX parser). */
function run(source: string): ReturnType<typeof executeCortex> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression => ce.parse(latex).json;
  return executeCortex(ce, source, { parseLatex });
}

/** The diagnostic codes reported when parsing `source`. */
function diagnostics(source: string): string[] {
  const [, diags] = parseCortex(source);
  return diags.map((d) => (Array.isArray(d.message) ? d.message[0] : d.message));
}

describe('CORTEX MATCH — parse (each §2 form → MathJSON)', () => {
  test('literal case + wildcard fallback', () => {
    expect(validCortex('match x {\n  0 => "zero"\n  _ => "other"\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', '_', { str: 'other' }],
    ]);
  });

  test('bare identifier binds (lowered to `_n`), body uses the bare name', () => {
    expect(validCortex('match x {\n  n => n\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', '_n', 'n'],
    ]);
  });

  test('or-alternatives (top level) with a pin, lowered to Alternatives', () => {
    expect(
      validCortex('match x {\n  1 | 2 | == Pi => "small"\n  _ => "big"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Alternatives', 1, 2, ['Pin', 'Pi']], { str: 'small' }],
      ['MatchCase', '_', { str: 'big' }],
    ]);
  });

  test('pin of a numeric constant (== Infinity) drops the Pin head (Infinity is a literal)', () => {
    // `Infinity` lexes as a numeric literal in Cortex (like `NaN`), so a pin of
    // it matches structurally — no `Pin` head — same as `== 5`.
    expect(validCortex('match x {\n  == Infinity => "unbounded"\n  _ => "no"\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 'PositiveInfinity', { str: 'unbounded' }],
      ['MatchCase', '_', { str: 'no' }],
    ]);
  });

  test('pin of a computed expression → Pin(expr)', () => {
    expect(validCortex('match x {\n  == f(2) => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Pin', ['f', 2]], 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('pin of a literal drops the Pin head (matches structurally)', () => {
    expect(validCortex('match x {\n  == 5 => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 5, 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('typed binding `n: integer` → binding + implicit Element guard', () => {
    expect(validCortex('match n {\n  n: integer if n > 0 => "positive integer"\n  _ => "other"\n}')).toEqual([
      'Match',
      'n',
      [
        'MatchCase',
        '_n',
        ['And', ['Element', 'n', 'integer'], ['Greater', 'n', 0]],
        { str: 'positive integer' },
      ],
      ['MatchCase', '_', { str: 'other' }],
    ]);
  });

  test('typed binding without an explicit guard emits just the type guard', () => {
    expect(validCortex('match n {\n  n: integer => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', ['Element', 'n', 'integer'], 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('list-destructuring with a rest → List with `___rest`', () => {
    expect(validCortex('match xs {\n  [first, ...rest] => first\n}')).toEqual([
      'Match',
      'xs',
      ['MatchCase', ['List', '_first', '___rest'], 'first'],
    ]);
  });

  test('dictionary pattern → literal keys, patternized values', () => {
    expect(validCortex('match p {\n  {x -> px, y -> py} => px + py\n}')).toEqual([
      'Match',
      'p',
      [
        'MatchCase',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'x' }, '_px'],
          ['KeyValuePair', { str: 'y' }, '_py'],
        ],
        ['Add', 'px', 'py'],
      ],
    ]);
  });

  test('operator/algebraic pattern with a guard (operands patternized)', () => {
    expect(validCortex('match z {\n  a + b if a > 0 => a\n  _ => 0\n}')).toEqual([
      'Match',
      'z',
      ['MatchCase', ['Add', '_a', '_b'], ['Greater', 'a', 0], 'a'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('tuple pattern binds positionally', () => {
    expect(validCortex('match p {\n  (x, y) => x\n}')).toEqual([
      'Match',
      'p',
      ['MatchCase', ['Tuple', '_x', '_y'], 'x'],
    ]);
  });

  test('call/constructor pattern keeps the head, patternizes operands', () => {
    expect(validCortex('match z {\n  f(a, b) => a\n}')).toEqual([
      'Match',
      'z',
      ['MatchCase', ['f', '_a', '_b'], 'a'],
    ]);
  });

  test('cases may be `;`-separated as well as newline-separated', () => {
    expect(validCortex('match x { 0 => "a"; _ => "b" }')).toEqual([
      'Match',
      'x',
      ['MatchCase', 0, { str: 'a' }],
      ['MatchCase', '_', { str: 'b' }],
    ]);
  });

  test('`match` is an expression (usable as an assignment RHS)', () => {
    expect(validCortex('let r = match x {\n  0 => "z"\n  _ => "o"\n}')).toEqual([
      'Declare',
      'r',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'value',
          [
            'Match',
            'x',
            ['MatchCase', 0, { str: 'z' }],
            ['MatchCase', '_', { str: 'o' }],
          ],
        ],
      ],
    ]);
  });
});

describe('CORTEX MATCH — diagnostics', () => {
  test('a non-final irrefutable case (bare binding) is flagged', () => {
    expect(diagnostics('match x {\n  Pi => 1\n  0 => 2\n}')).toContain(
      'match-irrefutable-case'
    );
  });

  test('a non-final `_` wildcard case is flagged', () => {
    expect(diagnostics('match x {\n  _ => 1\n  0 => 2\n}')).toContain(
      'match-irrefutable-case'
    );
  });

  test('a final irrefutable case is NOT flagged', () => {
    expect(diagnostics('match x {\n  0 => 1\n  _ => 2\n}')).not.toContain(
      'match-irrefutable-case'
    );
  });

  test('a named binding inside an or-alternative is flagged', () => {
    expect(diagnostics('match x {\n  a | 2 => 1\n  _ => 0\n}')).toContain(
      'match-alternative-binding'
    );
  });

  test('two rests in one list pattern are flagged', () => {
    expect(diagnostics('match xs {\n  [a, ...b, ...c] => a\n}')).toContain(
      'match-multiple-rest'
    );
  });

  test('a case missing its `=>` arrow is flagged', () => {
    expect(diagnostics('match x {\n  0 "zero"\n}')).toContain(
      'match-case-arrow-expected'
    );
  });

  test('an anonymous `_` inside an or-alternative is allowed (no binding diagnostic)', () => {
    expect(diagnostics('match p {\n  [0, _] | [_, 0] => "edge"\n  _ => "no"\n}')).not.toContain(
      'match-alternative-binding'
    );
  });
});

describe('CORTEX MATCH — round-trip (parse → serialize → parse fixpoint)', () => {
  const SOURCES = [
    'match x {\n  0 => "zero"\n  _ => "other"\n}',
    'match x {\n  1 | 2 | == Pi => "small"\n  _ => "big"\n}',
    'match xs {\n  [first, ...rest] => first\n}',
    'match n {\n  n if n > 0 => n\n  _ => 0\n}',
    'match x {\n  == limit => 1\n  _ => 0\n}',
    'match p {\n  (x, y) => x\n}',
    'match z {\n  a + b if a > 0 => a\n  _ => 0\n}',
  ];

  test.each(SOURCES)('%s', (src) => {
    const [value, diags] = parseCortex(src);
    expect(diags.map((d) => d.message)).toEqual([]);
    // Serialize the parsed MathJSON, re-parse, and re-serialize: the two
    // serializations must be identical (a MathJSON-level fixpoint).
    const round1 = serializeCortex(value);
    const round2 = serializeCortex(parseCortex(round1)[0]);
    expect(round2).toBe(round1);
    // And the re-parse must be diagnostic-free.
    expect(parseCortex(round1)[1].map((d) => d.message)).toEqual([]);
  });
});

describe('CORTEX MATCH — execute (end-to-end)', () => {
  test('constant dispatch (or-alternative + pin of a constant)', () => {
    const { value, diagnostics } = run(
      'match 2 {\n  1 | 2 | == Pi => "small"\n  _ => "big"\n}'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('"small"');
  });

  test('list destructuring binds and uses the captures', () => {
    const { value, diagnostics } = run('match [3, 4] {\n  [a, b] => a + b\n}');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(7);
  });

  test('a guard selects / falls through', () => {
    expect(
      run('match 5 {\n  n if n > 0 => "pos"\n  _ => "other"\n}').value.toString()
    ).toBe('"pos"');
    expect(
      run('match -5 {\n  n if n > 0 => "pos"\n  _ => "other"\n}').value.toString()
    ).toBe('"other"');
  });

  test('pin of a runtime variable matches its value', () => {
    const { value, diagnostics } = run(
      'let limit = 5\nmatch 5 {\n  == limit => "hit"\n  _ => "miss"\n}'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('"hit"');
  });

  test('first-match order wins', () => {
    expect(
      run('match 1 {\n  1 => "one"\n  _ => "other"\n}').value.toString()
    ).toBe('"one"');
  });

  test('a binding shadows a constant name (`e` binds the captured value)', () => {
    // `(x, e)` binds `e` to the second element, not ExponentialE.
    const { value, diagnostics } = run('match (2, 7) {\n  (x, e) => x + e\n}');
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(9);
  });

  test('dictionary pattern binds values by key (open match)', () => {
    const { value, diagnostics } = run(
      'let p = {x -> 3, y -> 4}\nmatch p {\n  {x -> px, y -> py} => px + py\n}'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(7);
  });

  test('a typed binding gates on the capture type', () => {
    expect(
      run('match 3 {\n  n: integer => "int"\n  _ => "no"\n}').value.toString()
    ).toBe('"int"');
    expect(
      run('match 3.5 {\n  n: integer => "int"\n  _ => "no"\n}').value.toString()
    ).toBe('"no"');
  });
});

describe('CORTEX MATCH — reserved-word interaction', () => {
  test('`` `match` `` (verbatim) is usable as an ordinary symbol', () => {
    expect(validCortex('`match` + 1')).toEqual(['Add', 'match', 1]);
  });

  test('a bare `match` used as a value (no block) is a diagnostic, not a symbol', () => {
    // `match` is now the keyword form; a bare `match` value is rejected like
    // any keyword head used out of position.
    const diags = diagnostics('y = match');
    expect(diags.length).toBeGreaterThan(0);
  });
});
