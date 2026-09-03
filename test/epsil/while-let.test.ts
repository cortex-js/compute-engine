import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { validEpsil } from '../utils';

//
// Epsil `while let` — the loop form of the refutable binding, surface sugar
// over `Loop` + `Match` (`parseWhileLet` in src/epsil/parser.ts;
// `whileLetParts` in src/epsil/serialize-epsil.ts). `while let p = s { a }`
// lowers to `Loop(Match(s, MatchCase(p, Block(a)), MatchCase(_, Break())))`:
// each turn matches the subject once, runs the body with the pattern's
// bindings when it matches, and the first refutation reaches the wildcard
// arm, whose `Break` ends the loop. The serializer spells that shape back as
// `while let`. The head is the `if let` head (test/epsil/if-let.test.ts) and
// the runtime is `match`'s (test/epsil/match.test.ts).
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

describe('EPSIL WHILE LET — parse (the lowering to Loop + Match)', () => {
  test('a Loop over a two-case Match whose wildcard arm breaks', () => {
    expect(validEpsil('while let [x, ...t] = xs { s = s + x }')).toEqual([
      'Loop',
      [
        'Match',
        'xs',
        [
          'MatchCase',
          ['List', '_x', '___t'],
          ['Block', ['Assign', 's', ['Add', 's', 'x']]],
        ],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
  });

  test('a typed binding lands its MatchesType guard in the guard slot', () => {
    expect(validEpsil('while let v: !error = f(x) { g(v) }')).toEqual([
      'Loop',
      [
        'Match',
        ['f', 'x'],
        [
          'MatchCase',
          '_v',
          ['MatchesType', 'v', ['TypeFrom', { str: '!error' }]],
          ['Block', ['g', 'v']],
        ],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
  });

  test('the full case-pattern grammar: ranges, alternatives, pins', () => {
    expect(validEpsil('while let 0..4 = k { k = k + 1 }')).toEqual([
      'Loop',
      [
        'Match',
        'k',
        ['MatchCase', ['Range', 0, 4], ['Block', ['Assign', 'k', ['Add', 'k', 1]]]],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
    expect(validEpsil('while let 1 | 2 = k { k = k + 1 }')).toEqual([
      'Loop',
      [
        'Match',
        'k',
        [
          'MatchCase',
          ['Alternatives', 1, 2],
          ['Block', ['Assign', 'k', ['Add', 'k', 1]]],
        ],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
    expect(validEpsil('while let == lo = k { k = k + 1 }')).toEqual([
      'Loop',
      [
        'Match',
        'k',
        ['MatchCase', ['Pin', 'lo'], ['Block', ['Assign', 'k', ['Add', 'k', 1]]]],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
  });

  test('the `=` ends the pattern; a `=` in the subject compares', () => {
    expect(validEpsil('while let (x, y) = (a = b) { x }')).toEqual([
      'Loop',
      [
        'Match',
        ['Equal', 'a', 'b'],
        ['MatchCase', ['Tuple', '_x', '_y'], ['Block', 'x']],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
  });

  test('a plain `while` is untouched', () => {
    expect(validEpsil('while k < 3 { k = k + 1 }')).toEqual([
      'Loop',
      [
        'Block',
        ['If', ['Not', ['Less', 'k', 3]], ['Break']],
        ['Block', ['Assign', 'k', ['Add', 'k', 1]]],
      ],
    ]);
  });
});

describe('EPSIL WHILE LET — diagnostics', () => {
  test('a missing `=` is while-let-equal-expected', () => {
    expect(diagnostics('while let [x] xs { x }')).toEqual([
      ['error', 'while-let-equal-expected'],
    ]);
  });

  test('a pattern that cannot fail is a while-let-irrefutable warning', () => {
    expect(diagnostics('while let x = next() { x }')).toEqual([
      ['warning', 'while-let-irrefutable'],
    ]);
    expect(diagnostics('while let _ = next() { 1 }')).toEqual([
      ['warning', 'while-let-irrefutable'],
    ]);
  });

  test('a typed binding is refutable — no warning', () => {
    expect(diagnostics('while let x: integer = next() { x }')).toEqual([]);
  });

  test('a missing block', () => {
    expect(diagnostics('while let [x] = xs x')).toEqual([
      ['error', 'opening-bracket-expected'],
    ]);
  });

  test('break and continue in the body target this loop', () => {
    expect(diagnostics('while let [x, ...] = xs { break }')).toEqual([]);
    expect(diagnostics('while let [x, ...] = xs { continue }')).toEqual([]);
  });

  test('a break in the subject belongs to the enclosing depth', () => {
    // The subject is read before the body's loop context opens — as a
    // `while` condition is — so at the top level it is outside every loop.
    expect(diagnostics('while let [x] = do { break } { x }')).toEqual([
      ['error', 'control-outside-loop'],
    ]);
  });
});

describe('EPSIL WHILE LET — evaluation', () => {
  test('consumes a list one element per turn, ends on the empty list', () => {
    const { value, diagnostics } = run(
      'let xs = [1, 2, 3]\nlet s = 0\nwhile let [h, ...t] = xs { s = s + h; xs = [t] }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });

  test('the subject may be a lazy list value (Rest, Drop)', () => {
    // `Rest(xs)` evaluates to a lazy collection whose operator is not `List`;
    // the case that holds the list pattern reads it as a list
    // (`lazyListLength` in match-dispatch.ts), so the loop sees every element
    // rather than ending after its first turn.
    const { value, diagnostics } = run(
      'let xs = [1, 2, 3]\nlet s = 0\nwhile let [h, ...] = xs { s = s + h; xs = Rest(xs) }\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
    expect(
      run(
        'let xs = [1, 2, 3]\nlet n = 0\nwhile let [_, ...] = xs { n = n + 1; xs = Drop(xs, 1) }\nn'
      ).value.re
    ).toBe(3);
  });

  test('a range pattern as the loop test', () => {
    const { value, diagnostics } = run(
      'let k = 0\nwhile let 0..4 = k { k = k + 1 }\nk'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(5);
  });

  test('a typed `!error` binding drains a partial function (the roadmap case)', () => {
    // `head([])` has no matching case, so it evaluates to a `match-no-case`
    // error value; the typed binding refuses it and the loop ends.
    const { value, diagnostics } = run(
      [
        'function head(xs: list) { match xs { [h, ...] => h } }',
        'let xs = [4, 5]',
        'let s = 0',
        'while let h: !error = head(xs) { s = s + h; xs = Rest(xs) }',
        's',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(9);
  });

  test('a subject that never matches runs the body zero times', () => {
    const { value } = run('let n = 0\nwhile let [x] = [1, 2] { n = n + 1 }\nn');
    expect(value.re).toBe(0);
  });

  test('break ends the loop early; continue skips to the next turn', () => {
    expect(
      run(
        'let k = 0\nlet n = 0\nwhile let 0..10 = k { k = k + 1; if k == 3 { break }; n = n + 1 }\n[k, n]'
      ).value.json
    ).toEqual(['List', 3, 2]);
    expect(
      run(
        'let k = 0\nlet n = 0\nwhile let 0..5 = k { k = k + 1; if k == 3 { continue }; n = n + 1 }\n[k, n]'
      ).value.json
    ).toEqual(['List', 6, 5]);
  });

  test('bindings are scoped to the body', () => {
    const { value } = run('let xs = [1]\nwhile let [h, ...] = xs { xs = [] }\nh');
    expect(value.json).toBe('h');
  });

  test('the loop is evaluated for effect: its value is Nothing', () => {
    const { value } = run('let k = 0\nwhile let 0..2 = k { k = k + 1 }');
    expect(value.json).toBe('Nothing');
  });

  test('nested in a for: break targets the innermost loop', () => {
    const { value, diagnostics } = run(
      [
        'let n = 0',
        'for i in [1, 2, 3] {',
        '  let k = 0',
        '  while let 0..5 = k { k = k + 1; n = n + 1; if k == 2 { break } }',
        '}',
        'n',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(6);
  });
});

describe('EPSIL WHILE LET — serialize (the lowering spells back as while let)', () => {
  test('inline when it fits', () => {
    expect(roundTrip('while let [x, ...t] = xs { s = s + x }')).toBe(
      'while let [x, ...t] = xs {s := s + x}'
    );
  });

  test('a typed binding folds its guard back into the annotation', () => {
    expect(roundTrip('while let v: !error = f(x) { g(v) }')).toBe(
      'while let v: !error = f(x) {g(v)}'
    );
  });

  test('ranges and alternatives round-trip', () => {
    expect(roundTrip('while let 0..4 = k { k = k + 1 }')).toBe(
      'while let 0 .. 4 = k {k := k + 1}'
    );
    expect(roundTrip('while let 1 | 2 = k { k = k + 1 }')).toBe(
      'while let 1 | 2 = k {k := k + 1}'
    );
  });

  test('a multi-statement body: inline when it fits, else stacked under the head', () => {
    expect(
      roundTrip(
        'while let [h, ...t] = xs {\n  s = s + h\n  xs = [t]\n  if s > 10 { break }\n}'
      )
    ).toBe('while let [h, ...t] = xs {s := s + h; xs := [t]; if s > 10 {break}}');
    expect(
      roundTrip(
        [
          'while let [head_element, ...tail_elements] = remaining_elements {',
          '  accumulated_total = accumulated_total + head_element',
          '  remaining_elements = [tail_elements]',
          '  if accumulated_total > 100 { break }',
          '}',
        ].join('\n')
      )
    ).toBe(
      [
        'while let [head_element, ...tail_elements] = remaining_elements {',
        '  accumulated_total := accumulated_total + head_element',
        '  remaining_elements := [tail_elements]',
        '  if accumulated_total > 100 {break}',
        '}',
      ].join('\n')
    );
  });

  test('a hand-written Loop of the same shape takes the while-let spelling', () => {
    expect(
      serializeEpsil([
        'Loop',
        [
          'Match',
          'k',
          ['MatchCase', 1, ['Block', ['Assign', 'k', 2]]],
          ['MatchCase', '_', ['Break']],
        ],
      ])
    ).toBe('while let 1 = k {k := 2}');
  });

  test('a Loop whose Match is not the lowering keeps the call spelling', () => {
    // A guard that is not a typed binding has no `while let` spelling; the
    // `Break` in the wildcard arm then sits outside any surface loop, so it
    // takes its call form, which re-parses to the same node.
    const out = serializeEpsil([
      'Loop',
      [
        'Match',
        'k',
        ['MatchCase', '_x', ['Greater', '_x', 0], ['Block', ['Assign', 'k', 2]]],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
    expect(out).toContain('Loop(match k {');
    expect(out).toContain('_ => Break()');
    const [reparsed, diags] = parseEpsil(out);
    expect(diags).toEqual([]);
    expect(strip(reparsed)).toEqual([
      'Loop',
      [
        'Match',
        'k',
        ['MatchCase', '_x', ['Greater', '_x', 0], ['Block', ['Assign', 'k', 2]]],
        ['MatchCase', '_', ['Break']],
      ],
    ]);
  });

  test('a stray Match with a breaking wildcard arm stays a match', () => {
    expect(
      serializeEpsil([
        'Match',
        'k',
        ['MatchCase', 1, ['Block', ['Assign', 'k', 2]]],
        ['MatchCase', '_', ['Break']],
      ])
    ).toBe('match k {\n  1 => do {k := 2}\n  _ => Break()\n}');
  });

  test('a plain while and an if let are unchanged', () => {
    expect(roundTrip('while k < 3 { k = k + 1 }')).toBe(
      'while k < 3 {k := k + 1}'
    );
    expect(roundTrip('if let [x] = xs { x } else { 0 }')).toBe(
      'if let [x] = xs {x} else {0}'
    );
  });
});

describe('EPSIL WHILE LET — compilation', () => {
  const source =
    'let k = 0\nlet s = 0\nwhile let 0..4 = k { s = s + k; k = k + 1 }\ns';

  test('the JavaScript target declines: a Match arm cannot break out of its arrow', () => {
    // `compileMatchJS` emits an arrow-IIFE, so the `Break` in the wildcard
    // arm has nowhere to go; the target names that cause and the fallback
    // runs the program through the interpreter.
    const ce = new ComputeEngine();
    const [ast, diags] = parseEpsil(source);
    expect(diags).toEqual([]);
    const result = compile(ce.box(ast!));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Match: a case body contains `Break`/);
    expect(String(result.run())).toBe('10');
  });

  test('a Return anywhere in an arm is declined; a nested loop owns its break', () => {
    // A `Loop` inside the arm owns the `Break` in it, so that shape compiles;
    // a `Return` passes through a `Loop` unchanged in the interpreter, so one
    // under a nested loop would still be swallowed by the arrow and is
    // declined.
    const ce = new ComputeEngine();
    const returning = ce.box([
      'Block',
      [
        'Loop',
        [
          'Match',
          'x',
          ['MatchCase', 1, ['Block', ['Loop', ['Block', ['Return', 9]]]]],
          ['MatchCase', '_', ['Block', ['Assign', 'x', ['Add', 'x', 1]]]],
        ],
      ],
      'x',
    ]);
    expect(compile(returning).success).toBe(false);
    expect(compile(returning).error).toMatch(
      /Match: a case body contains `Return`/
    );
    const owned = ce.box([
      'Loop',
      [
        'Match',
        'x',
        ['MatchCase', 1, ['Block', ['Loop', ['Block', ['Break']]]]],
        ['MatchCase', '_', ['Block', ['Assign', 'x', ['Add', 'x', 1]]]],
      ],
    ]);
    expect(compile(owned).success).toBe(true);
  });

  test('the Python target fails closed on the Match', () => {
    const ce = new ComputeEngine();
    const [ast, diags] = parseEpsil(source);
    expect(diags).toEqual([]);
    expect(() =>
      new PythonTarget().compileFunction(ce.box(ast!), 'g', [])
    ).toThrow(/Match: pattern matching is not supported/);
  });
});
