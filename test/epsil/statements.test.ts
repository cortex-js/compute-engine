import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

//
// Epsil statement grammar (Phase 4, Stage 1 — PARSE side only). Declarations,
// function definitions (math + block + anonymous), control flow (`if`/`else`,
// `while`, `for … in`), and statement blocks are dispatched in statement
// position and lowered to engine-aligned MathJSON. See
// `docs/LANGUAGE-MODEL.md`.
//

describe('EPSIL DECLARATIONS', () => {
  // Declarations lower to the enhanced engine `Declare` (Phase 4): the type is
  // positional when present; `value` (and `constant` for `const`) live in a
  // trailing attributes `Dictionary`, omitted entirely when it would be empty.
  test('untyped let', () => {
    expect(validEpsil('let x = 5')).toStrictEqual([
      'Declare',
      'x',
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('untyped const', () => {
    expect(validEpsil('const c = 6.28')).toStrictEqual([
      'Declare',
      'c',
      [
        'Dictionary',
        ['KeyValuePair', 'value', 6.28],
        ['KeyValuePair', 'constant', 'True'],
      ],
    ]);
  });

  test('typed let with initializer', () => {
    expect(validEpsil('let x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('typed let, declaration only (no initializer)', () => {
    expect(validEpsil('let x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('untyped let, declaration only', () => {
    expect(validEpsil('let x')).toStrictEqual(['Declare', 'x']);
  });

  test('typed const with initializer', () => {
    expect(validEpsil('const c: integer = 3')).toStrictEqual([
      'Declare',
      'c',
      { str: 'integer' },
      [
        'Dictionary',
        ['KeyValuePair', 'value', 3],
        ['KeyValuePair', 'constant', 'True'],
      ],
    ]);
  });

  test('a let initializer may be an expression', () => {
    expect(validEpsil('let x = 2 + 3')).toStrictEqual([
      'Declare',
      'x',
      ['Dictionary', ['KeyValuePair', 'value', ['Add', 2, 3]]],
    ]);
  });
});

describe('EPSIL REASSIGNMENT VS DECLARATION', () => {
  test('bare `x = 5` (no keyword, no annotation) is a reassignment', () => {
    expect(validEpsil('x = 5')).toStrictEqual(['Assign', 'x', 5]);
  });

  test('a bare annotation `x: T = e` implies a declaration (Declare)', () => {
    // Phase-2 reconciliation: an annotation without `let`/`const` now declares.
    expect(validEpsil('x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('a bare annotation without an initializer is a Declare', () => {
    expect(validEpsil('x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });
});

describe('EPSIL FUNCTION DEFINITIONS', () => {
  test('math-style `f(x) = expr`', () => {
    expect(validEpsil('f(x) = x + 1')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('math-style with multiple params', () => {
    expect(validEpsil('f(x, y) = x + y')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Add', 'x', 'y'], 'x', 'y'],
    ]);
  });

  test('math-style with typed params (annotated function literal)', () => {
    // A typed parameter is carried inline as a `["Typed", sym, {str}]` node,
    // so the def is a `DefineFunction` of an annotated `Function` literal (the
    // engine enforces the parameter types).
    expect(validEpsil('f(x: real) = x + 1')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'real' }]],
    ]);
  });

  test('math-style with a return type (ascribed onto the body)', () => {
    expect(validEpsil('f(x: integer) -> real = x + 1')).toStrictEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Typed', ['Add', 'x', 1], { str: 'real' }],
        ['Typed', 'x', { str: 'integer' }],
      ],
    ]);
  });

  test('block-style `function f(x) { … }`', () => {
    expect(validEpsil('function f(x) { x + 1 }')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Block', ['Add', 'x', 1]], 'x'],
    ]);
  });

  test('block-style with a return type (ascribed onto the body)', () => {
    expect(validEpsil('function f(x) -> real { x + 1 }')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Typed', ['Block', ['Add', 'x', 1]], { str: 'real' }], 'x'],
    ]);
  });

  test('anonymous mapsto with a typed parameter `(x: integer) => …`', () => {
    expect(validEpsil('(x: integer) => x + 1')).toStrictEqual([
      'Function',
      ['Add', 'x', 1],
      ['Typed', 'x', { str: 'integer' }],
    ]);
  });

  test('anonymous mapsto with typed parameters `(x: integer, y: real) => …`', () => {
    expect(validEpsil('(x: integer, y: real) => x + y')).toStrictEqual([
      'Function',
      ['Add', 'x', 'y'],
      ['Typed', 'x', { str: 'integer' }],
      ['Typed', 'y', { str: 'real' }],
    ]);
  });

  test('a typed parenthesized group not followed by `=>` is a diagnostic', () => {
    const [, diags] = parseEpsil('(x: integer)');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('anonymous mapsto `x => expr`', () => {
    expect(validEpsil('x => x + 1')).toStrictEqual([
      'Function',
      ['Add', 'x', 1],
      'x',
    ]);
  });

  test('anonymous mapsto with a parameter list `(x, y) => expr`', () => {
    expect(validEpsil('(x, y) => x + y')).toStrictEqual([
      'Function',
      ['Add', 'x', 'y'],
      'x',
      'y',
    ]);
  });

  test('a mapsto binds loosely enough to be a Let/Assign RHS', () => {
    expect(validEpsil('f = x => x + 1')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('a non-symbol mapsto parameter is a diagnostic', () => {
    const [, diags] = parseEpsil('1 => x');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message[0]).toBe('symbol-expected');
  });
});

describe('EPSIL CONTROL FLOW', () => {
  test('if / else', () => {
    expect(validEpsil('if x > 0 { 1 } else { 2 }')).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('if with no else', () => {
    expect(validEpsil('if x > 0 { 1 }')).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
    ]);
  });

  test('else-if chains into a nested If', () => {
    expect(
      validEpsil('if x > 0 { 1 } else if x < 0 { 2 } else { 3 }')
    ).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
      ['If', ['Less', 'x', 0], ['Block', 2], ['Block', 3]],
    ]);
  });

  test('a dangling else binds across a linebreak', () => {
    expect(validEpsil('if a {\n 1\n}\nelse {\n 2\n}')).toStrictEqual([
      'If',
      'a',
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('while lowers to Loop(Block(If(Not(cond), Break), body))', () => {
    expect(validEpsil('while x > 0 { x }')).toStrictEqual([
      'Loop',
      [
        'Block',
        ['If', ['Not', ['Greater', 'x', 0]], ['Break']],
        ['Block', 'x'],
      ],
    ]);
  });

  test('for … in (the iterator clause is Element)', () => {
    expect(validEpsil('for x in xs { x }')).toStrictEqual([
      'Loop',
      ['Block', 'x'],
      ['Element', 'x', 'xs'],
    ]);
  });

  test('`in` inside the for-collection still parses as the Element operator', () => {
    // Only the loop-variable `in` is contextual; a second `in` in the
    // collection expression is the ordinary Element infix operator.
    expect(validEpsil('for x in a in b { x }')).toStrictEqual([
      'Loop',
      ['Block', 'x'],
      ['Element', 'x', ['Element', 'a', 'b']],
    ]);
  });

  test('`if` is an expression (usable as an assignment RHS)', () => {
    expect(validEpsil('let a = if c { 1 } else { 2 }')).toStrictEqual([
      'Declare',
      'a',
      [
        'Dictionary',
        ['KeyValuePair', 'value', ['If', 'c', ['Block', 1], ['Block', 2]]],
      ],
    ]);
  });

  test('`if` is an expression (usable as an operand)', () => {
    expect(validEpsil('x + if c { 1 } else { 2 }')).toStrictEqual([
      'Add',
      'x',
      ['If', 'c', ['Block', 1], ['Block', 2]],
    ]);
  });
});

//
// The conditional expression `a if c else b` — the same `If` the block form
// builds, but with plain expression branches (no `Block`, so no scope). It
// binds looser than every ordinary operator and tighter than `=` and `=>`.
//
describe('EPSIL CONDITIONAL EXPRESSION', () => {
  test('lowers to If(cond, consequent, alternative) — no Block branches', () => {
    expect(validEpsil('1 if c else 2')).toStrictEqual(['If', 'c', 1, 2]);
  });

  test('binds looser than the ordinary operators', () => {
    expect(validEpsil('a + b if c else d')).toStrictEqual([
      'If',
      'c',
      ['Add', 'a', 'b'],
      'd',
    ]);
    expect(validEpsil('1 if x > 0 else 2')).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      1,
      2,
    ]);
  });

  test('binds tighter than `=`: the whole conditional is the RHS', () => {
    expect(validEpsil('x = 1 if c else 2')).toStrictEqual([
      'Assign',
      'x',
      ['If', 'c', 1, 2],
    ]);
  });

  test('binds tighter than `=>`: the whole conditional is the body', () => {
    expect(validEpsil('x => x + 1 if c else 2')).toStrictEqual([
      'Function',
      ['If', 'c', ['Add', 'x', 1], 2],
      'x',
    ]);
  });

  test('binds tighter than `|>`: the whole conditional is the piped value', () => {
    expect(validEpsil('xs |> f if c else g')).toStrictEqual([
      'Pipe',
      'xs',
      ['If', 'c', 'f', 'g'],
    ]);
  });

  // The load-bearing case for the conditional's precedence. Below
  // `KeyValuePair` the conditional swallows the pair, and the entry stops
  // being a `KeyValuePair` — so the dictionary reader skips it and the entry
  // is silently DROPPED, not merely misparsed.
  test('binds tighter than `->`: a dictionary value can be conditional', () => {
    expect(validEpsil('{ "k" -> 1 if c else 2 }')).toStrictEqual([
      'Dictionary',
      ['KeyValuePair', { str: 'k' }, ['If', 'c', 1, 2]],
    ]);
    expect(validEpsil('{ "a" -> 1, "b" -> 2 if c else 3 }')).toStrictEqual([
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, 1],
      ['KeyValuePair', { str: 'b' }, ['If', 'c', 2, 3]],
    ]);
  });

  test('binds looser than `||` (as in Python)', () => {
    expect(validEpsil('a || b if c else d')).toStrictEqual([
      'If',
      'c',
      ['Or', 'a', 'b'],
      'd',
    ]);
  });

  test('chains right-nested (no `else if` spelling needed)', () => {
    expect(validEpsil('1 if c else 2 if d else 3')).toStrictEqual([
      'If',
      'c',
      1,
      ['If', 'd', 2, 3],
    ]);
  });

  test('usable as an argument and a list element', () => {
    expect(validEpsil('f(1 if c else 2, 3)')).toStrictEqual([
      'f',
      ['If', 'c', 1, 2],
      3,
    ]);
    expect(validEpsil('[1 if c else 2]')).toStrictEqual([
      'List',
      ['If', 'c', 1, 2],
    ]);
  });

  test('the `else` is mandatory', () => {
    const [, diags] = parseEpsil('1 if c');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message[0]).toBe('conditional-else-expected');
  });

  // The guard rail that keeps the conditional from swallowing the next
  // statement: a linebreak is a statement separator, so an `if` that starts a
  // line is a new `if`-statement, never a conditional tail.
  test('an `if` on the next line is a statement, not a conditional tail', () => {
    expect(validEpsil('let y = 3\nif c { 1 } else { 2 }')).toStrictEqual([
      'Block',
      ['Declare', 'y', ['Dictionary', ['KeyValuePair', 'value', 3]]],
      ['If', 'c', ['Block', 1], ['Block', 2]],
    ]);
  });

  // The flip side of that guard rail: a conditional TAIL accidentally placed
  // at the start of a line parses as an if-statement whose condition is
  // followed by `else` — impossible for a statement, so it gets a targeted
  // diagnostic instead of the misleading "opening bracket expected".
  test('a line-start conditional tail gets the targeted diagnostic', () => {
    const [, diags] = parseEpsil('f(x) =\n  x + 1\n    if x > 0 else 0');
    expect(diags.map((d) => d.message[0])).toContain(
      'conditional-if-line-start'
    );
  });

  // A case-leading `if` introduces a match guard. Patterns use their own
  // grammar (`parsePatternInfix`), which has no conditional rule, so the guard
  // is never mistaken for a conditional tail on the pattern.
  test('does not capture a match-case guard', () => {
    expect(validEpsil('match x { n if n > 0 => a\n _ => b }')).toStrictEqual([
      'Match',
      'x',
      ['MatchCase', '_n', ['Greater', 'n', 0], 'a'],
      ['MatchCase', '_', 'b'],
    ]);
  });
});

describe('EPSIL BLOCKS', () => {
  test('empty block', () => {
    expect(validEpsil('if a { }')).toStrictEqual(['If', 'a', ['Block']]);
  });

  test('multi-statement block (value is the last expression)', () => {
    expect(validEpsil('while c { let x = 1\n x + 1 }')).toStrictEqual([
      'Loop',
      [
        'Block',
        ['If', ['Not', 'c'], ['Break']],
        [
          'Block',
          ['Declare', 'x', ['Dictionary', ['KeyValuePair', 'value', 1]]],
          ['Add', 'x', 1],
        ],
      ],
    ]);
  });

  test('semicolon-separated statements in a block', () => {
    expect(validEpsil('if a { 1; 2; 3 }')).toStrictEqual([
      'If',
      'a',
      ['Block', 1, 2, 3],
    ]);
  });

  test('nested blocks', () => {
    expect(validEpsil('if a { if b { 1 } }')).toStrictEqual([
      'If',
      'a',
      ['Block', ['If', 'b', ['Block', 1]]],
    ]);
  });

  test('a bare top-level `{…}` is the collection grammar, not a block', () => {
    // Blocks are keyword-introduced only; a bare brace is a Set (Phase 2).
    expect(validEpsil('{ 1, 2 }')).toStrictEqual(['Set', 1, 2]);
  });
});

describe('EPSIL STATEMENT KEYWORDS STAY RESERVED IN EXPRESSION POSITION', () => {
  // `if` is an expression (see above), but the for-effect loop keywords are
  // statement-only and remain reserved in expression position.
  test('a bare `while` used as a value is a diagnostic', () => {
    const [, diags] = parseEpsil('y = while');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['reserved-word', 'while']);
  });

  test('a bare `for` used as a value is a diagnostic', () => {
    const [, diags] = parseEpsil('y = for');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['reserved-word', 'for']);
  });
});

describe('EPSIL MULTI-STATEMENT PROGRAM', () => {
  test('declarations and control flow sequence into a Block', () => {
    expect(validEpsil('let x = 5\nif x > 0 { 1 } else { 2 }')).toStrictEqual([
      'Block',
      ['Declare', 'x', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['If', ['Greater', 'x', 0], ['Block', 1], ['Block', 2]],
    ]);
  });
});

// `let (x, y) = value` — tuple destructuring declarations. The pattern is
// irrefutable in FORM (bare symbols, `_`, nested tuple patterns); it lowers to
// `["Declare", ["Tuple", …], {value -> …}]` and requires an initializer.
describe('EPSIL STATEMENTS — destructuring declarations', () => {
  test('`let (x, y) = p` lowers to Declare of a Tuple pattern', () => {
    expect(validEpsil('let (x, y) = p')).toStrictEqual([
      'Declare',
      ['Tuple', 'x', 'y'],
      ['Dictionary', ['KeyValuePair', 'value', 'p']],
    ]);
  });

  test('`const` adds the constant attribute', () => {
    expect(validEpsil('const (x, y) = p')).toStrictEqual([
      'Declare',
      ['Tuple', 'x', 'y'],
      [
        'Dictionary',
        ['KeyValuePair', 'value', 'p'],
        ['KeyValuePair', 'constant', 'True'],
      ],
    ]);
  });

  test('nested patterns and `_` wildcards parse', () => {
    expect(validEpsil('let ((a, b), _) = p')).toStrictEqual([
      'Declare',
      ['Tuple', ['Tuple', 'a', 'b'], '_'],
      ['Dictionary', ['KeyValuePair', 'value', 'p']],
    ]);
  });

  test('a missing initializer is a diagnostic', () => {
    const [, diags] = parseEpsil('let (x, y)');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['expression-expected']);
  });

  test('a type annotation on a pattern is a diagnostic', () => {
    const [, diags] = parseEpsil('let (x, y): real = p');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['unexpected-symbol', ':']);
  });

  test('a duplicate name anywhere in the pattern is a diagnostic', () => {
    const [, flat] = parseEpsil('let (x, x) = p');
    expect(flat[0].message).toStrictEqual(['unexpected-symbol', 'x']);
    const [, nested] = parseEpsil('let (x, (y, x)) = p');
    expect(nested[0].message).toStrictEqual(['unexpected-symbol', 'x']);
  });

  test('a single-element pattern is a diagnostic (parenthesized name)', () => {
    const [, diags] = parseEpsil('let (x) = p');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['symbol-expected']);
  });

  test('a non-symbol pattern element is a diagnostic', () => {
    const [, diags] = parseEpsil('let (x, 5) = p');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['symbol-expected']);
  });

  // `(x, y) := v` — a destructuring ASSIGNMENT. No new parser rule: the
  // pattern is an ordinary parenthesized tuple expression, and `:=` is the
  // ordinary assignment operator. What makes it work is the engine `Assign`
  // accepting a `Tuple` target.
  test('`(x, y) := v` lowers to Assign of a Tuple target', () => {
    expect(validEpsil('(x, y) := p')).toStrictEqual([
      'Assign',
      ['Tuple', 'x', 'y'],
      'p',
    ]);
  });

  test('nested patterns and `_` wildcards parse in a target', () => {
    expect(validEpsil('(a, (b, c), _) := p')).toStrictEqual([
      'Assign',
      ['Tuple', 'a', ['Tuple', 'b', 'c'], '_'],
      'p',
    ]);
  });

  // A parenthesized left side is not a binding target, so the positional `=`
  // resolves to `Equal` — the intended write would silently vanish. `:=` is
  // the only assignment spelling for a pattern, and the bare `=` is
  // diagnosed. The node stays `Equal`: the diagnostic reports, it does not
  // reinterpret.
  const codesOf = (src: string): string[] =>
    parseEpsil(src)[1].map((d) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );

  test('a statement-leading `(x, y) = v` is diagnosed, and COMPARES', () => {
    const [value, diags] = parseEpsil('(x, y) = p');
    expect(diags.map((d) => d.message)).toStrictEqual([
      ['destructuring-bare-equal'],
    ]);
    // The reported node is still the comparison.
    expect(serializeEpsil(value!)).toBe('(x, y) == p');
  });

  test.each([
    ['a swap', '(a, b) = (b, a)'],
    ['a wildcard position', '(a, _, c) = (1, 2, 3)'],
    ['a nested pattern', '(a, (b, c)) = t'],
  ])('the bare-`=` diagnostic fires for %s', (_label, src) => {
    expect(codesOf(src)).toContain('destructuring-bare-equal');
  });

  test.each([
    // The correct spelling, and the explicit comparison.
    ['`:=`', '(a, b) := (b, a)'],
    ['`==`', '(a, b) == (b, a)'],
    // A computed component is a plausible tuple equation, not a mistyped
    // destructuring.
    ['a computed component', '(x + 1, y) = t'],
    // Not statement-leading: expression position never assigns anyway, so
    // there is nothing to mistake.
    ['an argument', 'Solve((a, b) = (b, a), a)'],
    ['a condition', 'if (a, b) = (b, a) { 1 }'],
    ['a list element', '[(a, b) = (b, a)]'],
    // Redundant parentheses around a NAME still assign (documented).
    ['a parenthesized name', '(x) = 5'],
  ])('it stays silent for %s', (_label, src) => {
    expect(codesOf(src)).not.toContain('destructuring-bare-equal');
  });
});

describe('EPSIL `break` AND `continue`', () => {
  const codes = (src: string): string[] =>
    parseEpsil(src)[1].map((d) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );

  test('they lower to the engine `Break()` / `Continue()` FUNCTION forms', () => {
    // The function form is what the engine dispatches on: a bare `Break`
    // SYMBOL canonicalizes to an error, precisely so the two cannot be
    // confused (`canonicalStatement`, library/control-structures.ts).
    expect(validEpsil('for x in xs { break }')).toStrictEqual([
      'Loop',
      ['Block', ['Break']],
      ['Element', 'x', 'xs'],
    ]);
    expect(validEpsil('for x in xs { continue }')).toStrictEqual([
      'Loop',
      ['Block', ['Continue']],
      ['Element', 'x', 'xs'],
    ]);
  });

  test.each([
    'for x in xs { break }',
    'for x in xs { continue }',
    'while c { break }',
    'for x in xs { if x > 2 { break } }',
    'for x in xs { do { break } }',
    'for x in xs { match x { 1 => break \n _ => 0 } }',
    'for x in xs { for y in ys { break } }',
  ])('accepted inside a loop: `%s`', (src) => {
    expect(codes(src)).toEqual([]);
  });

  test.each([
    ['at top level', 'break'],
    ['at top level', 'continue'],
    ['in a bare `if`', 'if x > 1 { break }'],
    ['in a bare `match`', 'match x { 1 => break }'],
    // The loop context resets at every function/lambda boundary: a `break`
    // there must not escape to the enclosing loop.
    ['in a lambda inside a loop', 'for x in xs { g(y => break) }'],
    ['in a `do` lambda inside a loop', 'for x in xs { g(y => do { break }) }'],
    ['in a function inside a loop', 'for x in xs { function h() { break } }'],
    ['in a definition RHS inside a loop', 'for x in xs { f(x) = break }'],
    // The explicit `Function(…)` literal is a boundary too. A call argument
    // is otherwise parsed in the ENCLOSING loop context, so this parsed clean
    // and the lambda could later emit `Break()` into an unrelated loop.
    [
      'in an explicit `Function()` literal',
      'for x in xs { let f = Function(break) }',
    ],
    [
      'in an explicit `Function()` literal',
      'for x in xs { let f = Function(continue) }',
    ],
  ])('rejected %s: `%s`', (_where, src) => {
    expect(codes(src)).toContain('control-outside-loop');
  });

  test('they round-trip in call form outside a loop', () => {
    // Outside a loop the call form is the only faithful spelling: a bare
    // `break` reached at the top level, or inside a function literal defined
    // in a loop, has no enclosing loop and re-parses as the
    // `control-outside-loop` error above rather than as this node.
    expect(serializeEpsil(['Break'])).toBe('Break()');
    expect(serializeEpsil(['Continue'])).toBe('Continue()');
    expect(validEpsil('Break()')).toStrictEqual(['Break']);
    expect(validEpsil('Continue()')).toStrictEqual(['Continue']);
    // A function literal is a boundary for the serializer exactly as it is
    // for the parser, so the literal's body keeps the call form even though
    // the literal itself sits in a loop body.
    expect(
      serializeEpsil(validEpsil('for x in xs { g(Function(Break())) }'))
    ).toBe('for x in xs {g(Function(Break()))}');
  });

  test('they serialize as the keyword inside a loop body', () => {
    // The serializer tracks the same loop depth the parser does, so a
    // `["Break"]` sitting in a body that is itself printing as `for`/`while`
    // gets the keyword — the spelling the source used.
    expect(serializeEpsil(validEpsil('for x in xs { break }'))).toBe(
      'for x in xs {break}'
    );
    expect(serializeEpsil(validEpsil('while c { continue }'))).toBe(
      'while c {continue}'
    );
    // An `if`, a `match` arm and a `do` block are not loop boundaries.
    expect(
      serializeEpsil(validEpsil('for x in xs { if x > 2 { break } }'))
    ).toBe('for x in xs {if x > 2 {break}}');
    expect(serializeEpsil(validEpsil('for x in xs { do { continue } }'))).toBe(
      'for x in xs {do {continue}}'
    );
  });
});
