import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { validEpsil } from '../utils';

//
// Epsil `if let` — a refutable binding, surface sugar over `Match`
// (`parseIfLet` in src/epsil/parser.ts; `ifLetParts` in
// src/epsil/serialize-epsil.ts). `if let p = s { a } else { b }` lowers to
// `Match(s, MatchCase(p, Block(a)), MatchCase(_, Block(b)))`; without an
// `else` the wildcard arm's body is `Missing`, the value a false `if` without
// an `else` has. The serializer spells that shape back as `if let`. The
// pattern grammar and the runtime are those of `match` (test/epsil/match.test.ts).
//

/** Run an Epsil program against a fresh engine (injecting the LaTeX parser). */
function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression => ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

/** The `[severity, code]` pairs reported when parsing `source`. */
function diagnostics(source: string): [string, string][] {
  const [, diags] = parseEpsil(source);
  return diags.map((d) => [
    d.severity,
    Array.isArray(d.message) ? d.message[0] : d.message,
  ]);
}

/** Metadata-free structural view, for round-trip comparison. */
function strip(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(strip);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if ('fn' in o) return strip(o.fn);
    if ('sym' in o) return o.sym;
    if ('num' in o) return Number(o.num);
    if ('str' in o) return { str: o.str };
  }
  return e;
}

/** Serialize `source`, assert the output re-parses cleanly to the same
 * structure, and return the output. */
function roundTrip(source: string): string {
  const [parsed, diags] = parseEpsil(source);
  expect(diags).toEqual([]);
  const out = serializeEpsil(parsed!);
  const [reparsed, reDiags] = parseEpsil(out);
  expect(reDiags).toEqual([]);
  expect(strip(reparsed)).toEqual(strip(parsed));
  return out;
}

describe('EPSIL IF LET — parse (the lowering to Match)', () => {
  test('with an else: two cases, the second the wildcard', () => {
    expect(validEpsil('if let [x, y] = p { x + y } else { 0 }')).toEqual([
      'Match',
      'p',
      ['MatchCase', ['List', '_x', '_y'], ['Block', ['Add', 'x', 'y']]],
      ['MatchCase', '_', ['Block', 0]],
    ]);
  });

  test('without an else: the wildcard arm yields Missing', () => {
    expect(validEpsil('if let [x, y] = p { x + y }')).toEqual([
      'Match',
      'p',
      ['MatchCase', ['List', '_x', '_y'], ['Block', ['Add', 'x', 'y']]],
      ['MatchCase', '_', 'Missing'],
    ]);
  });

  test('a typed binding lands its MatchesType guard in the guard slot', () => {
    expect(validEpsil('if let v: !error = f(x) { v } else { 0 }')).toEqual([
      'Match',
      ['f', 'x'],
      [
        'MatchCase',
        '_v',
        ['MatchesType', 'v', ['TypeFrom', { str: '!error' }]],
        ['Block', 'v'],
      ],
      ['MatchCase', '_', ['Block', 0]],
    ]);
  });

  test('else if chains nest in the wildcard arm — plain and if-let alike', () => {
    expect(
      validEpsil(
        'if let [x] = p { x } else if p == 3 { 3 } else if let (a, b) = p { a } else { 9 }'
      )
    ).toEqual([
      'Match',
      'p',
      ['MatchCase', ['List', '_x'], ['Block', 'x']],
      [
        'MatchCase',
        '_',
        [
          'If',
          ['Equal', 'p', 3],
          ['Block', 3],
          [
            'Match',
            'p',
            ['MatchCase', ['Tuple', '_a', '_b'], ['Block', 'a']],
            ['MatchCase', '_', ['Block', 9]],
          ],
        ],
      ],
    ]);
  });

  test('an if-let can follow a plain else if', () => {
    expect(validEpsil('if p == 3 { 3 } else if let (a, b) = p { a }')).toEqual(
      [
        'If',
        ['Equal', 'p', 3],
        ['Block', 3],
        [
          'Match',
          'p',
          ['MatchCase', ['Tuple', '_a', '_b'], ['Block', 'a']],
          ['MatchCase', '_', 'Missing'],
        ],
      ]
    );
  });

  test('the full case-pattern grammar: alternatives, pins, ranges', () => {
    expect(validEpsil('if let 1 | 2 = n { "low" }')).toEqual([
      'Match',
      'n',
      ['MatchCase', ['Alternatives', 1, 2], ['Block', { str: 'low' }]],
      ['MatchCase', '_', 'Missing'],
    ]);
    expect(validEpsil('if let == limit = n { "at" }')).toEqual([
      'Match',
      'n',
      ['MatchCase', ['Pin', 'limit'], ['Block', { str: 'at' }]],
      ['MatchCase', '_', 'Missing'],
    ]);
    expect(validEpsil('if let 1..5 = n { "small" }')).toEqual([
      'Match',
      'n',
      ['MatchCase', ['Range', 1, 5], ['Block', { str: 'small' }]],
      ['MatchCase', '_', 'Missing'],
    ]);
  });

  test('a nested match or if-let inside a pin keeps the outer type guards', () => {
    // A pin operand is an ordinary expression, so it may contain a `match`
    // or an `if let`, each of which installs its own guard collector; the
    // outer pattern's `a: integer` guard must survive it.
    const guard = ['MatchesType', 'a', ['TypeFrom', { str: 'integer' }]];
    expect(
      validEpsil('if let [a: integer, == (match w { _ => 1 })] = s { a }')
    ).toEqual([
      'Match',
      's',
      [
        'MatchCase',
        ['List', '_a', ['Pin', ['Match', 'w', ['MatchCase', '_', 1]]]],
        guard,
        ['Block', 'a'],
      ],
      ['MatchCase', '_', 'Missing'],
    ]);
    expect(
      validEpsil('match s {\n  [a: integer, == (if let [y] = w { y })] => a\n}')
    ).toEqual([
      'Match',
      's',
      [
        'MatchCase',
        [
          'List',
          '_a',
          [
            'Pin',
            [
              'Match',
              'w',
              ['MatchCase', ['List', '_y'], ['Block', 'y']],
              ['MatchCase', '_', 'Missing'],
            ],
          ],
        ],
        guard,
        'a',
      ],
    ]);
  });

  test('the `=` ends the pattern; a `=` in the subject compares', () => {
    expect(validEpsil('if let (x, y) = (a = b) { x }')).toEqual([
      'Match',
      ['Equal', 'a', 'b'],
      ['MatchCase', ['Tuple', '_x', '_y'], ['Block', 'x']],
      ['MatchCase', '_', 'Missing'],
    ]);
  });
});

describe('EPSIL IF LET — diagnostics', () => {
  test('a missing `=` is if-let-equal-expected', () => {
    expect(diagnostics('if let [x] p { x }')).toEqual([
      ['error', 'if-let-equal-expected'],
    ]);
  });

  test('a pattern that cannot fail is an if-let-irrefutable warning', () => {
    const [, diags] = parseEpsil('if let x = p { x } else { 0 }');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toEqual(['if-let-irrefutable', 'x']);
    expect(diagnostics('if let _ = p { 1 }')).toEqual([
      ['warning', 'if-let-irrefutable'],
    ]);
  });

  test('a typed binding is refutable — no warning', () => {
    expect(diagnostics('if let x: integer = p { x }')).toEqual([]);
    expect(diagnostics('if let [x] = p { x }')).toEqual([]);
  });

  test('a missing block, and an else without a block', () => {
    expect(diagnostics('if let [x] = p x')).toEqual([
      ['error', 'opening-bracket-expected'],
    ]);
    // The stray `0` is then an unexpected statement, exactly as after a
    // plain `if` — the recovery is shared.
    expect(diagnostics('if let [x] = p { x } else 0')).toEqual(
      diagnostics('if c { x } else 0')
    );
    expect(diagnostics('if let [x] = p { x } else 0')[0]).toEqual([
      'error',
      'opening-bracket-expected',
    ]);
  });
});

describe('EPSIL IF LET — evaluation', () => {
  test('destructures on a match, takes the else on a refutation', () => {
    const hit = run('let p = [3, 4]\nif let [x, y] = p { x * y } else { 0 }');
    expect(hit.diagnostics).toEqual([]);
    expect(hit.value?.toString()).toBe('12');
    const miss = run(
      'let p = [3, 4, 5]\nif let [x, y] = p { x * y } else { 0 }'
    );
    expect(miss.diagnostics).toEqual([]);
    expect(miss.value?.toString()).toBe('0');
  });

  test('without an else, a refuted if-let is Missing (as a false if is)', () => {
    const r = run('if let [x, y] = [1] { x }');
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toBe('Missing');
    // The same program with a plain `if`, for comparison.
    expect(run('if 1 > 2 { 5 }').value?.json).toBe('Missing');
  });

  test('a typed `!error` binding refuses an error value (the roadmap case)', () => {
    // `head([])` has no matching case, so it evaluates to a `match-no-case`
    // error value; `h: !error` does not bind it. (The parameter is typed
    // `list` so the call is not broadcast over the list's elements.)
    const HEAD = 'function head(xs: list) { match xs { [h, ...] => h } }\n';
    const miss = run(HEAD + 'if let h: !error = head([]) { h } else { "empty" }');
    expect(miss.diagnostics).toEqual([]);
    expect(miss.value?.toString()).toBe('"empty"');
    const hit = run(
      HEAD + 'if let h: !error = head([4, 5]) { h * 10 } else { "empty" }'
    );
    expect(hit.diagnostics).toEqual([]);
    expect(hit.value?.toString()).toBe('40');
  });

  test('a typed `!missing` binding reads absence the same way', () => {
    expect(
      run('let xs = []\nif let v: !missing = First(xs) { v } else { "none" }')
        .value?.toString()
    ).toBe('"none"');
    expect(
      run(
        'let xs = [3, 1]\nif let v: !missing = First(xs) { v * 2 } else { "none" }'
      ).value?.toString()
    ).toBe('6');
  });

  test('a typed binding tests the value type', () => {
    expect(
      run('let s = 2.5\nif let n: integer = s { "int" } else { "not int" }')
        .value?.toString()
    ).toBe('"not int"');
    expect(
      run('let s = 2\nif let n: integer = s { "int" } else { "not int" }')
        .value?.toString()
    ).toBe('"int"');
  });

  test('bindings are scoped to the block', () => {
    // After the statement, `x` is the unbound symbol again.
    expect(run('if let [x] = [1] { x }\nx').value?.json).toBe('x');
  });

  test('the block is statement position: assignment and loop control work', () => {
    const r = run(
      'let acc = []\n' +
        'for x in [[1], [2, 3], [4]] {\n' +
        '  if let [v] = x { if v == 4 { break }; acc = Join(acc, [v]) }\n' +
        '}\n' +
        'acc'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('[1]');
  });

  test('else if chains select in order', () => {
    const r = run(
      'let v = [1]\nif let [] = v { "empty" } else if let [x] = v { x } else { "many" }'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('1');
  });

  test('as a function body', () => {
    const r = run(
      'function f(p: tuple) { if let (a, b) = p { a + b } else { 0 } }\nf((2, 3))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('5');
  });
});

describe('EPSIL IF LET — serialize (the lowering spells back as if let)', () => {
  test('inline, with and without an else', () => {
    expect(roundTrip('if let [x, y] = p { x + y } else { 0 }')).toBe(
      'if let [x, y] = p {x + y} else {0}'
    );
    expect(roundTrip('if let [x] = p { x }')).toBe('if let [x] = p {x}');
  });

  test('a typed binding folds its guard back into the annotation', () => {
    expect(roundTrip('if let v: !error = f(x) { v } else { 0 }')).toBe(
      'if let v: !error = f(x) {v} else {0}'
    );
    expect(roundTrip('if let v: number | string = s { v }')).toBe(
      'if let v: number | string = s {v}'
    );
    expect(roundTrip('if let (a, b: integer) = p { a }')).toBe(
      'if let (a, b: integer) = p {a}'
    );
  });

  test('chains: inline when they fit, else every `} else if` at one column', () => {
    expect(
      roundTrip(
        'if let [x] = p { x } else if p == 3 { 3 } else if let (a, b) = p { a } else { 9 }'
      )
    ).toBe(
      'if let [x] = p {x} else if p == 3 {3} else if let (a, b) = p {a} else {9}'
    );
    expect(
      roundTrip(
        'if let [x] = point { x } else if point == 3 { 3 } else if let (a, b: integer) = point { a } else { 9 }'
      )
    ).toBe(
      [
        'if let [x] = point {',
        '  x',
        '} else if point == 3 {',
        '  3',
        '} else if let (a, b: integer) = point {',
        '  a',
        '} else {',
        '  9',
        '}',
      ].join('\n')
    );
    expect(roundTrip('if p == 3 { 3 } else if let (a, b) = p { a }')).toBe(
      'if p == 3 {3} else if let (a, b) = p {a}'
    );
  });

  test('a multi-statement block', () => {
    expect(
      roundTrip('if let v: list = s {\n  let t = Length(v)\n  t + 1\n} else {\n  0\n}')
    ).toBe('if let v: list = s {let t = Length(v); t + 1} else {0}');
  });

  test('a hand-written match of the same shape takes the if-let spelling', () => {
    // Same expression, so the same spelling.
    expect(roundTrip('match p {\n  [x] => do { x }\n  _ => do { 0 }\n}')).toBe(
      'if let [x] = p {x} else {0}'
    );
  });

  test('a match that is not the lowering keeps the match spelling', () => {
    // An explicit guard has no if-let spelling.
    expect(roundTrip('match s {\n  v: integer if v > 0 => do { v }\n  _ => do { 0 }\n}')).toBe(
      'match s {\n  v if MatchesType(v, TypeFrom("integer")) && v > 0 => do {v}\n  _ => do {0}\n}'
    );
    // A typed binding inside an operator pattern cannot carry its annotation.
    expect(roundTrip('match s {\n  a: integer + b => do { a }\n  _ => do { 0 }\n}')).toBe(
      'match s {\n  a + b if MatchesType(a, TypeFrom("integer")) => do {a}\n  _ => do {0}\n}'
    );
    // Non-block bodies, or more than two cases.
    expect(roundTrip('match s {\n  [x] => x\n  _ => 0\n}')).toBe(
      'match s {\n  [x] => x\n  _ => 0\n}'
    );
    expect(roundTrip('match s {\n  [x] => do { x }\n  [x, y] => do { y }\n  _ => do { 0 }\n}')).toBe(
      'match s {\n  [x] => do {x}\n  [x, y] => do {y}\n  _ => do {0}\n}'
    );
  });

  test('a hand-written guard whose type text is not a type keeps match', () => {
    // Folded verbatim, `boolean = true` would rewrite the head's `=`.
    expect(
      roundTrip(
        'match s {\n  v if MatchesType(v, TypeFrom("boolean = true")) => do { v }\n  _ => do { 0 }\n}'
      )
    ).toBe(
      'match s {\n  v if MatchesType(v, TypeFrom("boolean = true")) => do {v}\n  _ => do {0}\n}'
    );
    // A user-declared type name is a type, so it folds (the declaration is
    // part of the program, so the re-parse knows the name).
    expect(
      roundTrip(
        'type Point = tuple<number, number>\nmatch s {\n  v if MatchesType(v, TypeFrom("Point")) => do { v }\n  _ => do { 0 }\n}'
      )
    ).toBe('type Point = tuple<number, number>\nif let v: Point = s {v} else {0}');
  });

  test('a symbol named `let` is spelled verbatim, so a plain if survives', () => {
    // Bare, `if let == x {…}` would re-parse as an `if let` head.
    expect(roundTrip('if `let` == x { 1 }')).toBe('if `let` == x {1}');
    expect(roundTrip('`let` = 5')).toBe('`let` := 5');
  });

  test('alternatives, pins and ranges round-trip', () => {
    expect(roundTrip('if let 1 | 2 = n { "low" } else { "other" }')).toBe(
      'if let 1 | 2 = n {"low"} else {"other"}'
    );
    expect(roundTrip('if let == limit = n { "at" }')).toBe(
      'if let == limit = n {"at"}'
    );
    expect(roundTrip('if let 1..5 = n { "small" }')).toBe(
      'if let 1 .. 5 = n {"small"}'
    );
  });
});
