import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { validEpsil } from '../utils';

//
// Epsil `match` surface grammar (Phase 3 of the match design,
// docs/plans/2026-07-12-cortex-match-design.md §2–3): parse, serialize, and
// execute a keyword-led `match subject { case… }` block. The engine `Match`/
// `MatchCase`/`Pin`/`Alternatives` heads (Phases 1–2) are exercised in
// test/compute-engine/match-expression.test.ts; here we cover the Epsil
// syntax that lowers to them.
//

/** Run an Epsil program against a fresh engine (injecting the LaTeX parser). */
function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression => ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

/** The diagnostic codes reported when parsing `source`. */
function diagnostics(source: string): string[] {
  const [, diags] = parseEpsil(source);
  return diags.map((d) => (Array.isArray(d.message) ? d.message[0] : d.message));
}

describe('EPSIL MATCH — parse (each §2 form → MathJSON)', () => {
  test('literal case + wildcard fallback', () => {
    expect(validEpsil('match x {\n  0 => "zero"\n  _ => "other"\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', '_', { str: 'other' }],
    ]);
  });

  test('bare identifier binds (lowered to `_n`), body uses the bare name', () => {
    expect(validEpsil('match x {\n  n => n\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', '_n', 'n'],
    ]);
  });

  test('or-alternatives (top level) with a pin, lowered to Alternatives', () => {
    expect(
      validEpsil('match x {\n  1 | 2 | == Pi => "small"\n  _ => "big"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Alternatives', 1, 2, ['Pin', 'Pi']], { str: 'small' }],
      ['MatchCase', '_', { str: 'big' }],
    ]);
  });

  test('pin of a numeric constant (== Infinity) drops the Pin head (Infinity is a literal)', () => {
    // `Infinity` lexes as a numeric literal in Epsil (like `NaN`), so a pin of
    // it matches structurally — no `Pin` head — same as `== 5`.
    expect(validEpsil('match x {\n  == Infinity => "unbounded"\n  _ => "no"\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 'PositiveInfinity', { str: 'unbounded' }],
      ['MatchCase', '_', { str: 'no' }],
    ]);
  });

  test('pin of a computed expression → Pin(expr)', () => {
    expect(validEpsil('match x {\n  == f(2) => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Pin', ['f', 2]], 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('pin of a literal drops the Pin head (matches structurally)', () => {
    expect(validEpsil('match x {\n  == 5 => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'x',
      ['MatchCase', 5, 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('typed binding `n: integer` → binding + implicit Element guard', () => {
    expect(validEpsil('match n {\n  n: integer if n > 0 => "positive integer"\n  _ => "other"\n}')).toEqual([
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
    expect(validEpsil('match n {\n  n: integer => 1\n  _ => 0\n}')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', ['Element', 'n', 'integer'], 1],
      ['MatchCase', '_', 0],
    ]);
  });

  test('list-destructuring with a rest → List with `___rest`', () => {
    expect(validEpsil('match xs {\n  [first, ...rest] => first\n}')).toEqual([
      'Match',
      'xs',
      ['MatchCase', ['List', '_first', '___rest'], 'first'],
    ]);
  });

  test('dictionary pattern → literal keys, patternized values', () => {
    expect(validEpsil('match p {\n  {x -> px, y -> py} => px + py\n}')).toEqual([
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
    expect(validEpsil('match z {\n  a + b if a > 0 => a\n  _ => 0\n}')).toEqual([
      'Match',
      'z',
      ['MatchCase', ['Add', '_a', '_b'], ['Greater', 'a', 0], 'a'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('tuple pattern binds positionally', () => {
    expect(validEpsil('match p {\n  (x, y) => x\n}')).toEqual([
      'Match',
      'p',
      ['MatchCase', ['Tuple', '_x', '_y'], 'x'],
    ]);
  });

  test('call/constructor pattern keeps the head, patternizes operands', () => {
    expect(validEpsil('match z {\n  f(a, b) => a\n}')).toEqual([
      'Match',
      'z',
      ['MatchCase', ['f', '_a', '_b'], 'a'],
    ]);
  });

  test('cases may be `;`-separated as well as newline-separated', () => {
    expect(validEpsil('match x { 0 => "a"; _ => "b" }')).toEqual([
      'Match',
      'x',
      ['MatchCase', 0, { str: 'a' }],
      ['MatchCase', '_', { str: 'b' }],
    ]);
  });

  test('`match` is an expression (usable as an assignment RHS)', () => {
    expect(validEpsil('let r = match x {\n  0 => "z"\n  _ => "o"\n}')).toEqual([
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

describe('EPSIL MATCH — diagnostics', () => {
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

  test('a malformed pattern annotation costs only its type guard', () => {
    // The type subparse leaves the cursor at the offending token; the pattern
    // resynchronizes at its own element boundary (the `,`/closer/`=>`), so the
    // rest of the arm — and every later arm — still parses. (It used to
    // resynchronize at a STATEMENT boundary, dropping the remaining arms.)
    const source = 'match n {\n  a: nosuch => 1\n  b: integer => 2\n  _ => 3\n}';
    expect(diagnostics(source)).toEqual([
      'type-annotation-error',
      // `a` is a bare binding once its guard is gone — irrefutable, non-final.
      'match-irrefutable-case',
    ]);
    const [expr] = parseEpsil(source);
    expect(serializeEpsil(expr!)).toBe(
      'match n {\n  a => 1\n  b if b in integer => 2\n  _ => 3\n}'
    );
  });

  test('…and inside a list pattern, only its own element', () => {
    const source = 'match n {\n  [a: nosuch, c] => 1\n  _ => 3\n}';
    expect(diagnostics(source)).toEqual(['type-annotation-error']);
    const [expr] = parseEpsil(source);
    expect(serializeEpsil(expr!)).toBe('match n {\n  [a, c] => 1\n  _ => 3\n}');
  });
});

describe('EPSIL MATCH — round-trip (parse → serialize → parse fixpoint)', () => {
  const SOURCES = [
    'match x {\n  0 => "zero"\n  _ => "other"\n}',
    'match x {\n  1 | 2 | == Pi => "small"\n  _ => "big"\n}',
    'match xs {\n  [first, ...rest] => first\n}',
    'match n {\n  n if n > 0 => n\n  _ => 0\n}',
    'match x {\n  == limit => 1\n  _ => 0\n}',
    'match p {\n  (x, y) => x\n}',
    'match z {\n  a + b if a > 0 => a\n  _ => 0\n}',
    'match x {\n  1 .. 10 => "in"\n  _ => "out"\n}',
    'match x {\n  0 .. 9 | 100 .. 109 => "in"\n  _ => "out"\n}',
    'match x {\n  0 .. Infinity => "nonneg"\n  _ => "out"\n}',
    'match x {\n  -3 .. -1 => "neg"\n  _ => "out"\n}',
  ];

  test.each(SOURCES)('%s', (src) => {
    const [value, diags] = parseEpsil(src);
    expect(diags.map((d) => d.message)).toEqual([]);
    // Serialize the parsed MathJSON, re-parse, and re-serialize: the two
    // serializations must be identical (a MathJSON-level fixpoint).
    const round1 = serializeEpsil(value);
    const round2 = serializeEpsil(parseEpsil(round1)[0]);
    expect(round2).toBe(round1);
    // And the re-parse must be diagnostic-free.
    expect(parseEpsil(round1)[1].map((d) => d.message)).toEqual([]);
  });
});

describe('EPSIL MATCH — execute (end-to-end)', () => {
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

describe('EPSIL MATCH — reserved-word interaction', () => {
  test('`` `match` `` (verbatim) is usable as an ordinary symbol', () => {
    expect(validEpsil('`match` + 1')).toEqual(['Add', 'match', 1]);
  });

  test('a bare `match` used as a value (no block) is a diagnostic, not a symbol', () => {
    // `match` is now the keyword form; a bare `match` value is rejected like
    // any keyword head used out of position.
    const diags = diagnostics('y = match');
    expect(diags.length).toBeGreaterThan(0);
  });
});

//
// Range patterns (§8 of the design, 2026-07-31 addendum): `lo..hi` in pattern
// position is an inclusive numeric membership test.
//

describe('EPSIL MATCH — range patterns (parse)', () => {
  test('`lo..hi` lowers to a held two-operand Range pattern', () => {
    expect(
      validEpsil('match x {\n  1..10 => "in"\n  _ => "out"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Range', 1, 10], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
  });

  test('the call form `Range(lo, hi)` lowers identically (patternize keys on the operator)', () => {
    expect(
      validEpsil('match x {\n  Range(1, 10) => "in"\n  _ => "out"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Range', 1, 10], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
  });

  test('negated and infinite bounds are numeric literals', () => {
    expect(
      validEpsil('match x {\n  -3 .. -1 => "neg"\n  _ => "out"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Range', -3, -1], { str: 'neg' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
    expect(
      validEpsil('match x {\n  0..Infinity => "nonneg"\n  _ => "out"\n}')
    ).toEqual([
      'Match',
      'x',
      ['MatchCase', ['Range', 0, 'PositiveInfinity'], { str: 'nonneg' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
  });

  test('a range pattern serializes back to `lo .. hi` (call form in expression position)', () => {
    const [value] = parseEpsil('match x {\n  1..10 => "in"\n  _ => "out"\n}');
    expect(serializeEpsil(value)).toBe(
      'match x {\n  1 .. 10 => "in"\n  _ => "out"\n}'
    );
    // Expression position is unchanged: `Range` keeps its call spelling.
    expect(serializeEpsil(parseEpsil('let xs = 1..10')[0])).toContain(
      'Range(1, 10)'
    );
  });

  test('ranges are binding-free, so they are legal in or-alternatives', () => {
    expect(
      validEpsil('match x {\n  0..9 | 100..109 => "in"\n  _ => "out"\n}')
    ).toEqual([
      'Match',
      'x',
      [
        'MatchCase',
        ['Alternatives', ['Range', 0, 9], ['Range', 100, 109]],
        { str: 'in' },
      ],
      ['MatchCase', '_', { str: 'out' }],
    ]);
  });
});

describe('EPSIL MATCH — range-pattern diagnostics', () => {
  test('a bare-identifier bound is flagged (it would otherwise bind)', () => {
    expect(diagnostics('match x {\n  n..10 => 1\n  _ => 0\n}')).toContain(
      'range-pattern-bounds'
    );
  });

  test('a computed bound is flagged', () => {
    expect(diagnostics('match x {\n  (1+1)..10 => 1\n  _ => 0\n}')).toContain(
      'range-pattern-bounds'
    );
  });

  test('a NaN bound is flagged', () => {
    expect(diagnostics('match x {\n  NaN..10 => 1\n  _ => 0\n}')).toContain(
      'range-pattern-bounds'
    );
  });

  test('a stepped range is flagged (unsupported in v1)', () => {
    expect(
      diagnostics('match x {\n  Range(1, 10, 2) => 1\n  _ => 0\n}')
    ).toContain('range-pattern-step');
    // `1..10..2` parses as `Range(Range(1, 10), 2)` — also a stepped range.
    expect(diagnostics('match x {\n  1..10..2 => 1\n  _ => 0\n}')).toContain(
      'range-pattern-step'
    );
  });

  test('an empty range (lo > hi) is flagged as an always-dead case', () => {
    expect(diagnostics('match x {\n  10..1 => 1\n  _ => 0\n}')).toContain(
      'range-pattern-empty'
    );
  });

  test('a well-formed range is diagnostic-free (incl. lo == hi)', () => {
    expect(diagnostics('match x {\n  1..10 => 1\n  _ => 0\n}')).toEqual([]);
    expect(diagnostics('match x {\n  2..2 => 1\n  _ => 0\n}')).toEqual([]);
    expect(
      diagnostics('match x {\n  -Infinity..Infinity => 1\n  _ => 0\n}')
    ).toEqual([]);
  });

  test('a `Range` outside pattern position is untouched', () => {
    expect(diagnostics('let xs = n..10\nxs')).toEqual([]);
    // …including a pinned range value, whose operand is an ordinary expression.
    expect(diagnostics('match x {\n  == Range(1, 10) => 1\n  _ => 0\n}')).toEqual(
      []
    );
  });
});

describe('EPSIL MATCH — range patterns (execute)', () => {
  const inOut = (subject: string): string =>
    run(`match ${subject} {\n  1..10 => "in"\n  _ => "out"\n}`).value.toString();

  test('interior and endpoint subjects select; outside falls through', () => {
    expect(inOut('5')).toBe('"in"');
    expect(inOut('1')).toBe('"in"');
    expect(inOut('10')).toBe('"in"');
    expect(inOut('0')).toBe('"out"');
    expect(inOut('11')).toBe('"out"');
  });

  test('float and rational subjects work; non-numbers fall through', () => {
    expect(inOut('2.5')).toBe('"in"');
    expect(inOut('3/2')).toBe('"in"');
    expect(inOut('x')).toBe('"out"'); // symbolic
    expect(inOut('[1, 2]')).toBe('"out"'); // list
    expect(inOut('Range(1, 10)')).toBe('"out"'); // an actual Range value
    expect(inOut('NaN')).toBe('"out"');
    expect(inOut('"a"')).toBe('"out"');
  });

  test('negative and infinite bounds', () => {
    expect(
      run('match -2 {\n  -3 .. -1 => "neg"\n  _ => "out"\n}').value.toString()
    ).toBe('"neg"');
    expect(
      run('match 5 {\n  0..Infinity => "nonneg"\n  _ => "out"\n}').value.toString()
    ).toBe('"nonneg"');
    expect(
      run('match -5 {\n  0..Infinity => "nonneg"\n  _ => "out"\n}').value.toString()
    ).toBe('"out"');
  });

  test('or-alternatives of ranges', () => {
    const src = 'match SUBJ {\n  0..9 | 100..109 => "in"\n  _ => "out"\n}';
    expect(run(src.replace('SUBJ', '5')).value.toString()).toBe('"in"');
    expect(run(src.replace('SUBJ', '105')).value.toString()).toBe('"in"');
    expect(run(src.replace('SUBJ', '50')).value.toString()).toBe('"out"');
  });

  test('a guard after a range reads outer-scope names (a range binds nothing)', () => {
    expect(
      run(
        'let lim = 3\nmatch 5 {\n  0..100 if lim > 0 => "in"\n  _ => "out"\n}'
      ).value.toString()
    ).toBe('"in"');
    expect(
      run(
        'let lim = 3\nmatch 5 {\n  0..100 if lim > 10 => "in"\n  _ => "out"\n}'
      ).value.toString()
    ).toBe('"out"');
  });

  test('first-match order wins across overlapping ranges', () => {
    expect(
      run(
        'match 5 {\n  0..10 => "wide"\n  5..6 => "narrow"\n  _ => "out"\n}'
      ).value.toString()
    ).toBe('"wide"');
  });
});

/**
 * Rung 1 of the error-propagation design
 * (`docs/plans/2026-07-31-error-propagation-design.md`): `match` is the rescue
 * construct at the Epsil surface too. The MathJSON-level pins are in
 * `test/compute-engine/match-expression.test.ts`.
 */
describe('EPSIL MATCH — error subjects (rung 1)', () => {
  test('an error subject falls through literal cases to `_`', () => {
    expect(
      run('match ("a" + 1) {\n  0 => "zero"\n  _ => "rescued"\n}').value.toString()
    ).toBe('"rescued"');
  });

  test('a bare binding binds the error, and a guard can call `IsError`', () => {
    expect(
      run('match ("a" + 1) {\n  v if IsError(v) => "caught"\n  _ => "no"\n}').value.toString()
    ).toBe('"caught"');
    expect(
      run('match 5 {\n  v if IsError(v) => "caught"\n  _ => "no"\n}').value.toString()
    ).toBe('"no"');
  });

  test('an error subject does not match a SHAPE pattern', () => {
    // `"a" + 1` canonicalizes to an invalid `Add`, so `a + b` would otherwise
    // "successfully" destructure a failure. Only `_`, a bare binding, a
    // sequence wildcard, a typed pattern, and an explicit `Error(…)` pattern
    // may match an error subject.
    expect(
      run('match "a" + 1 {\n  a + b => "shape-matched"\n  _ => "wildcard"\n}').value.toString()
    ).toBe('"wildcard"');
    // A VALID `Add` subject still matches.
    expect(
      run('match x + y {\n  a + b => "shape-matched"\n  _ => "wildcard"\n}').value.toString()
    ).toBe('"shape-matched"');
  });

  test('an `Error(…)` pattern destructures the error deliberately', () => {
    expect(
      run('match Error("oops") {\n  Error(c) => c\n  _ => "wildcard"\n}').value.toString()
    ).toBe('"oops"');
  });

  test('a typed pattern does not bind an error subject', () => {
    expect(
      run('match ("a" + 1) {\n  v: number => "num"\n  _ => "fell"\n}').value.toString()
    ).toBe('"fell"');
    expect(
      run('match 5 {\n  v: number => "num"\n  _ => "fell"\n}').value.toString()
    ).toBe('"num"');
  });

  test('GAP: `v: !error` is not a resolvable type annotation yet', () => {
    // The design's §7 refutable-binding lowering wants `x: !error`. A negation
    // type is NOT among the annotations the typed-pattern path resolves (§3
    // Phase-3 note: "Only simple named types resolve"), so the guard stays
    // symbolic and the case falls through for EVERY subject — including a
    // non-error one. The FALLTHROUGH is still the pinned behavior (resolution
    // is the if-let prerequisite); what is fixed is the SILENCE: a non-simple
    // annotation now reports `type-pattern-unsupported` at parse time.
    expect(diagnostics('match 5 {\n  v: !error => "bound"\n  _ => "fell"\n}')).toEqual(
      ['type-pattern-unsupported']
    );
    // A compound (non-negation) annotation is diagnosed the same way; a simple
    // named type stays silent.
    expect(
      diagnostics('match 5 {\n  v: list<integer> => "L"\n  _ => "fell"\n}')
    ).toEqual(['type-pattern-unsupported']);
    expect(
      diagnostics('match 5 {\n  v: number => "num"\n  _ => "fell"\n}')
    ).toEqual([]);
    expect(
      run('match 5 {\n  v: !error => "bound"\n  _ => "fell"\n}').value.toString()
    ).toBe('"fell"');
    expect(
      run('match ("a" + 1) {\n  v: !error => "bound"\n  _ => "fell"\n}').value.toString()
    ).toBe('"fell"');
  });
});

describe('EPSIL MATCH — per-evaluation closures (regression, 2026-08-01)', () => {
  // Guard/body closures used to be cached on the dispatch plan at FIRST
  // evaluation, baking that call's frame into every later call: repeated
  // calls returned stale values, and a base-case-only first call made later
  // recursion descend past the base case forever.

  it('repeated calls of a match-bodied function see each frame', () => {
    const r = run(
      'function ff(n) { match n { 0 => 1; _ => n + 100 } }\n' +
        '[ff(5), ff(7), ff(9), ff(0)]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[105,107,109,1]');
  });

  it('recursive fib works after a base-case-only first call', () => {
    const r = run(
      'function fib(n: integer) -> integer { match n { 0 => 0; 1 => 1; _ => fib(n-1) + fib(n-2) } }\n' +
        'fib(0)\n' +
        'fib(10)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('55');
  });
});

//
// Phase 3 of the parameterized-nominal design
// (`docs/plans/2026-08-06-parameterized-nominal-types-design.md` §6 and the
// §10 "Recursion" obligation): `match` reads a parameterized nominal at its
// instantiated body. The `match` machinery itself is unchanged — a case binds
// VALUES, so the tagged application matches structurally exactly as a
// non-parameterized nominal does.
//
describe('EPSIL MATCH — parameterized nominal subjects (§6)', () => {
  /** `type tree<T> = tuple<value: T, children: list<tree<T>>>` — unannotated,
   * so `out` by the verified default (§4.4). */
  const TREE = 'type tree<T> = tuple<value: T, children: list<tree<T>>>\n';

  it('binds the payload of a tree<T>', () => {
    const r = run(
      TREE + 'let t = tree(1, [])\nmatch t { tree(v, cs) => v }'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('1');
  });

  it('binds and evaluates at every level of a 3-deep tree', () => {
    const r = run(
      TREE +
        'let t = tree(1, [tree(2, [tree(3, [])])])\n' +
        'match t { tree(v1, cs1) => [v1, ' +
        'match cs1[1] { tree(v2, cs2) => v2 }, ' +
        'match cs1[1] { tree(v2, cs2) => ' +
        'match cs2[1] { tree(v3, cs3) => v3 } }] }'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[1,2,3]');
  });

  it('the children capture is the nested applications, unexpanded', () => {
    const r = run(
      TREE +
        'let t = tree(1, [tree(2, []), tree(3, [])])\n' +
        'match t { tree(v, cs) => cs }'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[tree(2, []),tree(3, [])]');
  });

  // The §1 motivating program: a `map` over a recursive parametric container.
  it('a recursive map over a tree rebuilds it with f applied to each value', () => {
    const r = run(
      TREE +
        'function mapTree(t) { match t { tree(v, cs) => ' +
        'tree(v * 10, Map(cs, mapTree)) } }\n' +
        'let t = tree(1, [tree(2, [tree(3, [])]), tree(4, [])])\n' +
        'let m = mapTree(t)\n' +
        '[m.value, m.children[1].value, m.children[1].children[1].value, ' +
        'm.children[2].value]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[10,20,30,40]');
  });

  it('the map result is still a tree<T>', () => {
    const r = run(
      TREE +
        'function mapTree(t) { match t { tree(v, cs) => ' +
        'tree(v * 10, Map(cs, mapTree)) } }\n' +
        'mapTree(tree(1, [tree(2, [])]))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.type.toString()).toBe('tree<finite_integer>');
  });
});
