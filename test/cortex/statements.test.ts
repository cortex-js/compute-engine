import { parseCortex } from '../../src/cortex/parse-cortex';
import { validCortex } from '../utils';

//
// Cortex statement grammar (Phase 4, Stage 1 — PARSE side only). Declarations,
// function definitions (math + block + anonymous), control flow (`if`/`else`,
// `while`, `for … in`), and statement blocks are dispatched in statement
// position and lowered to engine-aligned MathJSON. See
// `roadmap/cortex/phase-4-semantics.md`.
//

describe('CORTEX DECLARATIONS', () => {
  // Declarations lower to the enhanced engine `Declare` (Phase 4): the type is
  // positional when present; `value` (and `constant` for `const`) live in a
  // trailing attributes `Dictionary`, omitted entirely when it would be empty.
  test('untyped let', () => {
    expect(validCortex('let x = 5')).toStrictEqual([
      'Declare',
      'x',
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('untyped const', () => {
    expect(validCortex('const c = 6.28')).toStrictEqual([
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
    expect(validCortex('let x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('typed let, declaration only (no initializer)', () => {
    expect(validCortex('let x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('untyped let, declaration only', () => {
    expect(validCortex('let x')).toStrictEqual(['Declare', 'x']);
  });

  test('typed const with initializer', () => {
    expect(validCortex('const c: integer = 3')).toStrictEqual([
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
    expect(validCortex('let x = 2 + 3')).toStrictEqual([
      'Declare',
      'x',
      ['Dictionary', ['KeyValuePair', 'value', ['Add', 2, 3]]],
    ]);
  });
});

describe('CORTEX REASSIGNMENT VS DECLARATION', () => {
  test('bare `x = 5` (no keyword, no annotation) is a reassignment', () => {
    expect(validCortex('x = 5')).toStrictEqual(['Assign', 'x', 5]);
  });

  test('a bare annotation `x: T = e` implies a declaration (Declare)', () => {
    // Phase-2 reconciliation: an annotation without `let`/`const` now declares.
    expect(validCortex('x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('a bare annotation without an initializer is a Declare', () => {
    expect(validCortex('x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });
});

describe('CORTEX FUNCTION DEFINITIONS', () => {
  test('math-style `f(x) = expr`', () => {
    expect(validCortex('f(x) = x + 1')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('math-style with multiple params', () => {
    expect(validCortex('f(x, y) = x + y')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Add', 'x', 'y'], 'x', 'y'],
    ]);
  });

  test('math-style with typed params (enforced via Declare signature)', () => {
    expect(validCortex('f(x: real) = x + 1')).toStrictEqual([
      'Declare',
      'f',
      { str: '(real) -> any' },
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('block-style `function f(x) { … }`', () => {
    expect(validCortex('function f(x) { x + 1 }')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Block', ['Add', 'x', 1]], 'x'],
    ]);
  });

  test('block-style with a return type (dropped for v0)', () => {
    expect(validCortex('function f(x) -> real { x + 1 }')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Block', ['Add', 'x', 1]], 'x'],
    ]);
  });

  test('anonymous mapsto `x |-> expr`', () => {
    expect(validCortex('x |-> x + 1')).toStrictEqual([
      'Function',
      ['Add', 'x', 1],
      'x',
    ]);
  });

  test('anonymous mapsto with a parameter list `(x, y) |-> expr`', () => {
    expect(validCortex('(x, y) |-> x + y')).toStrictEqual([
      'Function',
      ['Add', 'x', 'y'],
      'x',
      'y',
    ]);
  });

  test('a mapsto binds loosely enough to be a Let/Assign RHS', () => {
    expect(validCortex('f = x |-> x + 1')).toStrictEqual([
      'Assign',
      'f',
      ['Function', ['Add', 'x', 1], 'x'],
    ]);
  });

  test('a non-symbol mapsto parameter is a diagnostic', () => {
    const [, diags] = parseCortex('1 |-> x');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message[0]).toBe('symbol-expected');
  });
});

describe('CORTEX CONTROL FLOW', () => {
  test('if / else', () => {
    expect(validCortex('if x > 0 { 1 } else { 2 }')).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('if with no else', () => {
    expect(validCortex('if x > 0 { 1 }')).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
    ]);
  });

  test('else-if chains into a nested If', () => {
    expect(
      validCortex('if x > 0 { 1 } else if x < 0 { 2 } else { 3 }')
    ).toStrictEqual([
      'If',
      ['Greater', 'x', 0],
      ['Block', 1],
      ['If', ['Less', 'x', 0], ['Block', 2], ['Block', 3]],
    ]);
  });

  test('a dangling else binds across a linebreak', () => {
    expect(validCortex('if a {\n 1\n}\nelse {\n 2\n}')).toStrictEqual([
      'If',
      'a',
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('while lowers to Loop(Block(If(Not(cond), Break), body))', () => {
    expect(validCortex('while x > 0 { x }')).toStrictEqual([
      'Loop',
      [
        'Block',
        ['If', ['Not', ['Greater', 'x', 0]], ['Break']],
        ['Block', 'x'],
      ],
    ]);
  });

  test('for … in (the iterator clause is Element)', () => {
    expect(validCortex('for x in xs { x }')).toStrictEqual([
      'Loop',
      ['Block', 'x'],
      ['Element', 'x', 'xs'],
    ]);
  });

  test('`in` inside the for-collection still parses as the Element operator', () => {
    // Only the loop-variable `in` is contextual; a second `in` in the
    // collection expression is the ordinary Element infix operator.
    expect(validCortex('for x in a in b { x }')).toStrictEqual([
      'Loop',
      ['Block', 'x'],
      ['Element', 'x', ['Element', 'a', 'b']],
    ]);
  });

  test('`if` is an expression (usable as an assignment RHS)', () => {
    expect(validCortex('let a = if c { 1 } else { 2 }')).toStrictEqual([
      'Declare',
      'a',
      [
        'Dictionary',
        ['KeyValuePair', 'value', ['If', 'c', ['Block', 1], ['Block', 2]]],
      ],
    ]);
  });

  test('`if` is an expression (usable as an operand)', () => {
    expect(validCortex('x + if c { 1 } else { 2 }')).toStrictEqual([
      'Add',
      'x',
      ['If', 'c', ['Block', 1], ['Block', 2]],
    ]);
  });
});

describe('CORTEX BLOCKS', () => {
  test('empty block', () => {
    expect(validCortex('if a { }')).toStrictEqual(['If', 'a', ['Block']]);
  });

  test('multi-statement block (value is the last expression)', () => {
    expect(validCortex('while c { let x = 1\n x + 1 }')).toStrictEqual([
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
    expect(validCortex('if a { 1; 2; 3 }')).toStrictEqual([
      'If',
      'a',
      ['Block', 1, 2, 3],
    ]);
  });

  test('nested blocks', () => {
    expect(validCortex('if a { if b { 1 } }')).toStrictEqual([
      'If',
      'a',
      ['Block', ['If', 'b', ['Block', 1]]],
    ]);
  });

  test('a bare top-level `{…}` is the collection grammar, not a block', () => {
    // Blocks are keyword-introduced only; a bare brace is a Set (Phase 2).
    expect(validCortex('{ 1, 2 }')).toStrictEqual(['Set', 1, 2]);
  });
});

describe('CORTEX STATEMENT KEYWORDS STAY RESERVED IN EXPRESSION POSITION', () => {
  // `if` is an expression (see above), but the for-effect loop keywords are
  // statement-only and remain reserved in expression position.
  test('a bare `while` used as a value is a diagnostic', () => {
    const [, diags] = parseCortex('y = while');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['reserved-word', 'while']);
  });

  test('a bare `for` used as a value is a diagnostic', () => {
    const [, diags] = parseCortex('y = for');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['reserved-word', 'for']);
  });
});

describe('CORTEX MULTI-STATEMENT PROGRAM', () => {
  test('declarations and control flow sequence into a Block', () => {
    expect(
      validCortex('let x = 5\nif x > 0 { 1 } else { 2 }')
    ).toStrictEqual([
      'Block',
      ['Declare', 'x', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['If', ['Greater', 'x', 0], ['Block', 1], ['Block', 2]],
    ]);
  });
});
