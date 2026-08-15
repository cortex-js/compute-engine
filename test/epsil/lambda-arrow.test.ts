import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { MathJsonExpression } from '../../src/math-json/types';

//
// The anonymous-function (mapsto) arrow is `=>`.
//
// It is the SAME glyph as the `match` case arrow (`pattern [if guard] =>
// body`) — one arrow meaning "yields", in both places, as in Scala. What keeps
// them apart is not the spelling but the position: while a case's pattern and
// guard are being parsed, `=>` is reserved for that case and every site that
// could consume it as a lambda arrow declines (the `mapstoStops` depth stack in
// `parser.ts`). A case BODY has no such reservation, so a lambda there is
// ordinary.
//
// Function TYPES and dictionary entries are untouched: they keep `->`
// (`(number) -> number`, `{k -> v}`).
//
// The retired spelling `|->` still parses AS the arrow, but reports
// `mapsto-arrow-legacy` with a fixit to `=>`.
//

/** Drop the parser's `sourceOffsets` decoration and the object spellings of
 * numbers and symbols, so an expected value can be written as plain
 * MathJSON. Strings keep their `{str}` wrapper (a bare string is a symbol). */
function strip(expr: any): any {
  if (Array.isArray(expr)) return expr.map(strip);
  if (expr !== null && typeof expr === 'object') {
    if ('fn' in expr) return expr.fn.map(strip);
    if ('sym' in expr) return expr.sym;
    if ('num' in expr) return Number(expr.num);
    if ('str' in expr) return { str: expr.str };
  }
  return expr;
}

/** The parsed MathJSON, asserting the program parsed cleanly. */
function parse(source: string): MathJsonExpression {
  const [expr, diagnostics] = parseEpsil(source);
  expect(diagnostics.map((d) => d.message[0])).toEqual([]);
  return strip(expr);
}

/** The diagnostic codes a program reports, in order. */
function codes(source: string): string[] {
  return parseEpsil(source)[1].map((d) => d.message[0] as string);
}

/** Run an Epsil program against a fresh engine. */
function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

describe('EPSIL LAMBDA ARROW `=>` — parsing', () => {
  test('a bare parameter', () => {
    expect(parse('x => x + 1')).toEqual(['Function', ['Add', 'x', 1], 'x']);
  });

  test('a parameter tuple', () => {
    expect(parse('(a, b) => a + b')).toEqual([
      'Function',
      ['Add', 'a', 'b'],
      'a',
      'b',
    ]);
  });

  test('a typed parameter', () => {
    expect(parse('(x: integer) => x')).toEqual([
      'Function',
      'x',
      ['Typed', 'x', { str: 'integer' }],
    ]);
  });

  test('an empty parameter list', () => {
    expect(parse('() => 1')).toEqual(['Function', 1]);
  });

  test('right-associates for currying', () => {
    // `x => y => x + y` is a function OF x returning a function of y.
    expect(parse('x => y => x + y')).toEqual([
      'Function',
      ['Function', ['Add', 'x', 'y'], 'y'],
      'x',
    ]);
  });

  test('binds looser than `:=`, so an assignment captures the whole lambda', () => {
    expect(parse('f := x => x + 1')).toEqual([
      'Assign',
      'f',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('binds looser than `??`, so the default lands inside the body', () => {
    expect(parse('x => x.a ?? 0')).toEqual([
      'Function',
      ['Coalesce', ['Field', 'x', { str: 'a' }], 0],
      'x',
    ]);
  });

  test('no whitespace around the arrow', () => {
    expect(parse('x=>x+1')).toEqual(['Function', ['Add', 'x', 1], 'x']);
  });

  test('a pipe stage lambda needs no parentheses', () => {
    expect(parse('xs |> x => x + 1')).toEqual([
      'Pipe',
      'xs',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('a lambda inside a pipe stage argument', () => {
    expect(parse('xs |> Map(_ => _^2, _)')).toEqual([
      'Pipe',
      'xs',
      ['Map', ['Function', ['Power', '_', 2], '_'], '_'],
    ]);
  });

  test('`->` still writes dictionary entries', () => {
    expect(parse('{k -> v}')).toEqual([
      'Dictionary',
      ['KeyValuePair', { str: 'k' }, 'v'],
    ]);
  });

  test('`->` still writes function types', () => {
    // The annotation keeps `->`; only the literal's arrow changed.
    expect(codes('let f: (number) -> number = x => x + 1')).toEqual([]);
  });
});

describe('EPSIL LAMBDA ARROW `=>` — Unicode spellings', () => {
  test('`↦` (U+21A6) is the arrow', () => {
    expect(parse('x ↦ x + 1')).toEqual(['Function', ['Add', 'x', 1], 'x']);
  });

  test('`⇒` (U+21D2) is the arrow', () => {
    expect(parse('x ⇒ x + 1')).toEqual(['Function', ['Add', 'x', 1], 'x']);
  });

  test('a typed parameter list before `↦`', () => {
    // The parenthesized-body reader recognizes the arrow through
    // `operatorText`, so the annotation is not reported as a stray `:`.
    expect(parse('(x: integer) ↦ x')).toEqual([
      'Function',
      'x',
      ['Typed', 'x', { str: 'integer' }],
    ]);
  });

  test('both glyphs are a `match` case arrow too', () => {
    // Both lex to the one `=>` token, so a case may be written with either.
    expect(parse('match n { 0 ↦ "zero"; otherwise ⇒ "other" }')).toEqual([
      'Match',
      'n',
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', '_', { str: 'other' }],
    ]);
  });
});

describe('EPSIL LAMBDA ARROW `=>` — sharing the glyph with `match`', () => {
  test('a guard is terminated by the case arrow', () => {
    // Without the reservation, `valid => n` would be read as a lambda guard
    // and the arm would be left bodiless.
    expect(parse('match n { n if valid => n; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', 'valid', 'n'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('a relational guard is terminated by the case arrow', () => {
    expect(parse('match n { n if n > 0 => n; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', ['Greater', 'n', 0], 'n'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('a PIPE guard is terminated by the case arrow', () => {
    // The pipe-stage lambda sugar (`xs |> x => …`) is the other site that can
    // swallow the arrow; in guard position it declines too.
    expect(parse('match n { n if xs |> Any => n; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', ['Pipe', 'xs', 'Any'], 'n'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('a bare pattern is terminated by the case arrow', () => {
    expect(parse('match n { m => m + 1 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_m', ['Add', 'm', 1]],
    ]);
  });

  test('an arm BODY may be a lambda', () => {
    // The body is parsed at full precedence, so the arrow after `x` is an
    // ordinary mapsto and the whole lambda is the body.
    expect(parse('match n { 0 => x => x + 1; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', 0, ['Function', ['Add', 'x', 1], 'x']],
      ['MatchCase', '_', 0],
    ]);
  });

  test('a `match` may be a lambda BODY', () => {
    expect(parse('x => match x { 0 => "z"; otherwise => "nz" }')).toEqual([
      'Function',
      [
        'Match',
        'x',
        ['MatchCase', 0, { str: 'z' }],
        ['MatchCase', '_', { str: 'nz' }],
      ],
      'x',
    ]);
  });

  test('a PARENTHESIZED lambda in a guard is an ordinary lambda', () => {
    // Parentheses put the arrow at a deeper bracket depth than the case, so
    // the reservation does not apply and a lambda is spellable there.
    expect(parse('match n { n if (f => f)(n) => n; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', ['Apply', ['Function', 'f', 'f'], 'n'], 'n'],
      ['MatchCase', '_', 0],
    ]);
  });

  test('an UNPARENTHESIZED lambda in a guard: the FIRST arrow is the case arrow', () => {
    // `n if f => f => n` is guard `f`, body `f => n` — not guard `f => f`.
    // The rule is positional and total: the first `=>` at the case's own
    // bracket depth ends the guard. No diagnostic, because the reading is a
    // legitimate program (a boolean guard and a lambda-valued arm); the
    // alternative reading is not, since a bare lambda as a guard is a function
    // value and therefore always truthy.
    expect(parse('match n { n if f => f => n; otherwise => 0 }')).toEqual([
      'Match',
      'n',
      ['MatchCase', '_n', 'f', ['Function', 'n', 'f']],
      ['MatchCase', '_', 0],
    ]);
  });

  test('an assignment in a guard is still diagnosed, not mis-parsed', () => {
    // Reserving the arrow by POSITION rather than by precedence is what keeps
    // this working: `:=` binds looser than the arrow, so a precedence floor
    // above the arrow would have ended the guard at the `:=` instead.
    expect(codes('match x { y if flag := true => 1 }')).toEqual([
      'assign-in-condition',
    ]);
  });
});

describe('EPSIL LAMBDA ARROW `=>` — evaluation', () => {
  test('a lambda applies', () => {
    expect(run('let f = x => x + 1\nf(3)').value.re).toBe(4);
  });

  test('a curried lambda applies', () => {
    expect(run('let f = x => y => x + y\nf(2)(3)').value.re).toBe(5);
  });

  test('a zero-parameter lambda applies', () => {
    expect(run('let t = () => 42\nt()').value.re).toBe(42);
  });

  test('a match with a lambda arm body applies', () => {
    expect(
      run('let g = match 0 { 0 => x => x + 1; otherwise => x => x }\ng(3)').value
        .re
    ).toBe(4);
  });
});

describe('EPSIL LAMBDA ARROW `=>` — serialization', () => {
  test('an annotated literal serializes with `=>`', () => {
    const expr: MathJsonExpression = [
      'Function',
      'x',
      ['Typed', 'x', { str: 'integer' }],
    ];
    expect(serializeEpsil(expr)).toBe('(x: integer) => x');
  });

  test('under `fancySymbols` it serializes with `⇒`', () => {
    // `⇒` is the emitted fancy glyph; `↦` is accepted as input but never
    // produced.
    const expr: MathJsonExpression = [
      'Function',
      'x',
      ['Typed', 'x', { str: 'integer' }],
    ];
    expect(serializeEpsil(expr, { fancySymbols: true })).toBe(
      '(x: integer) ⇒ x'
    );
  });

  test('a `match` case serializes with the SAME arrow as a lambda', () => {
    // Both roles are the one arrow, so a fancy-printed program uses `⇒`
    // throughout rather than mixing spellings.
    const expr: MathJsonExpression = [
      'Match',
      'n',
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', '_', { str: 'other' }],
    ];
    expect(serializeEpsil(expr)).toContain('0 => "zero"');
    expect(serializeEpsil(expr, { fancySymbols: true })).toContain(
      '0 ⇒ "zero"'
    );
  });

  test('a guarded `match` case keeps its guard before the fancy arrow', () => {
    const expr: MathJsonExpression = [
      'Match',
      'n',
      ['MatchCase', '_n', ['Greater', 'n', 0], 'n'],
    ];
    // Fancy mode spaces ordinary infix operators with U+2005 (`n > 0`), but
    // the arrow keeps plain spaces — the same spelling the lambda arrow uses,
    // since they are the one operator.
    const out = serializeEpsil(expr, { fancySymbols: true });
    expect(out).toContain(' if ');
    expect(out).toContain('0 ⇒ n');
    expect(out).not.toContain('=>');
  });

  test('both spellings read back to the same expression', () => {
    const expr: MathJsonExpression = [
      'Function',
      'x',
      ['Typed', 'x', { str: 'integer' }],
    ];
    expect(parse(serializeEpsil(expr))).toEqual(expr);
    expect(parse(serializeEpsil(expr, { fancySymbols: true }))).toEqual(expr);
  });
});

describe('EPSIL LAMBDA ARROW — the retired `|->` spelling', () => {
  test('`|->` reports `mapsto-arrow-legacy` with a fixit to `=>`', () => {
    const src = 'x |-> x + 1';
    const [expr, diagnostics] = parseEpsil(src);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-legacy',
    ]);
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(start, end)).toBe('|->');
    expect(src.slice(0, start) + replacement + src.slice(end)).toBe(
      'x => x + 1'
    );
    // Recovered AS the arrow: the program still yields the function it meant.
    expect(strip(expr)).toEqual(['Function', ['Add', 'x', 1], 'x']);
  });

  test('exactly one diagnostic per written arrow', () => {
    // `peekInfix` is speculative and may see the same token repeatedly; the
    // report happens where the arrow is CONSUMED.
    expect(codes('f := (x) |-> x^2')).toEqual(['mapsto-arrow-legacy']);
    expect(codes('x |-> y |-> x + y')).toEqual([
      'mapsto-arrow-legacy',
      'mapsto-arrow-legacy',
    ]);
  });

  test('`|->` in a pipe stage is diagnosed and recovered', () => {
    const [expr, diagnostics] = parseEpsil('xs |> x |-> x + 1');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-legacy',
    ]);
    expect(strip(expr)).toEqual(['Pipe', 'xs', ['Function', ['Add', 'x', 1], 'x']]);
  });

  test('`|->` is not read as a `match` or-alternative separator', () => {
    // A bare `|` separates pattern alternatives, and `|->` starts with one;
    // it stays the arrow so it can be diagnosed as the retired spelling.
    expect(codes('let f = x |-> x')).toEqual(['mapsto-arrow-legacy']);
  });

  test('the legacy arrow still recovers a zero-parameter lambda', () => {
    const { value, diagnostics } = run('let t = () |-> 42\nt()');
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-legacy',
    ]);
    expect(value.re).toBe(42);
  });

  test('the legacy arrow still recovers a typed parameter list', () => {
    expect(codes('let f = (x: integer) |-> x')).toEqual([
      'mapsto-arrow-legacy',
    ]);
  });
});

describe('EPSIL LAMBDA ARROW — the wrong-arrow `->` diagnostic', () => {
  test('`(x) -> x + 1` still reports `mapsto-arrow-expected`, fixed to `=>`', () => {
    const src = 'const f = (x) -> x + 1';
    const [, diagnostics] = parseEpsil(src);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'mapsto-arrow-expected',
    ]);
    const [start, end, replacement] = diagnostics[0].fixits![0];
    expect(src.slice(start, end)).toBe('->');
    expect(replacement).toBe('=>');
  });
});
