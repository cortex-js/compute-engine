import { ComputeEngine } from '../../src/compute-engine';

//
// Regression tests for the `String` and `Type` core operators (2026-07-10).
//
// - `String(…)` joined its operands' *serialized* forms, so a string
//   operand's quotes leaked into the result value: `String("x = ", 3)`
//   produced the content `"x = "3` instead of `x = 3`. This broke Cortex
//   string interpolation (`"\(x)"` lowers to `String`).
// - `Type` is lazy (it must not evaluate its operand), but a lazy operand is
//   not canonical and a non-canonical expression has no type — so `Type(y)`
//   reported "unknown" even for a symbol bound to an integer.
//

describe('String operator joins values, not serialized forms', () => {
  test('string ++ number', () => {
    const ce = new ComputeEngine();
    const s = ce.box(['String', { str: 'x = ' }, 3]).evaluate();
    expect(s.string).toBe('x = 3');
  });

  test('string ++ string', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['String', { str: 'a' }, { str: 'b' }]).evaluate().string
    ).toBe('ab');
  });

  test('empty String() is the empty string', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['String']).evaluate().string).toBe('');
  });

  test('non-string operands use their default serialization', () => {
    const ce = new ComputeEngine();
    const s = ce
      .box(['String', { str: 'value: ' }, ['Rational', 1, 2]])
      .evaluate();
    expect(s.string).toBe('value: 1/2');
  });

  test('symbol operands contribute their value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 42);
    expect(
      ce.box(['String', { str: 'x is ' }, 'x']).evaluate().string
    ).toBe('x is 42');
  });
});

describe('StringJoin concatenates strings', () => {
  test('n-ary concatenation', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['StringJoin', { str: 'foo' }, { str: 'bar' }, { str: '!' }])
        .evaluate().string
    ).toBe('foobar!');
  });

  test('empty StringJoin() is the empty string', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['StringJoin']).evaluate().string).toBe('');
  });

  test('a non-string operand leaves it unevaluated (stays a StringJoin)', () => {
    const ce = new ComputeEngine();
    // Unlike `String`, `StringJoin` does not coerce: the operand `3` is not a
    // string, so the expression does not reduce to a string value.
    expect(ce.box(['StringJoin', { str: 'a' }, 3]).evaluate().operator).toBe(
      'StringJoin'
    );
  });

  test('a single list of strings is joined', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['StringJoin', ['List', { str: 'a' }, { str: 'b' }, { str: 'c' }]])
        .evaluate().string
    ).toBe('abc');
  });

  test('a single lazy collection (Map result) of strings is joined', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'StringJoin',
          ['Map', ['List', { str: 'a' }, { str: 'b' }], ['Function', 'c', 'c']],
        ])
        .evaluate().string
    ).toBe('ab');
  });

  test('reversing the characters of a string round-trips through StringJoin', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['StringJoin', ['Reverse', ['Characters', { str: 'hello' }]]])
        .evaluate().string
    ).toBe('olleh');
  });
});

describe('StringFrom joins a collection of code points', () => {
  // Regression: `StringFrom` was declared `broadcastable: true`, so a list
  // argument was mapped element-wise BEFORE the evaluate handler ran, defeating
  // the handler's collection-join branches (['List',100,101,102] became the
  // list ["d","e","f"] instead of the joined "def").
  test('unicode-scalars over a list joins the code points', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['StringFrom', ['List', 100, 101, 102], { str: 'unicode-scalars' }])
        .evaluate().string
    ).toBe('def');
  });

  test('unicode-scalars over a single integer (scalar path)', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['StringFrom', 100, { str: 'unicode-scalars' }]).evaluate().string
    ).toBe('d');
  });

  test('utf-8 round-trips through Utf8', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['StringFrom', ['Utf8', { str: 'héllo' }], { str: 'utf-8' }])
        .evaluate().string
    ).toBe('héllo');
  });
});

describe('Characters splits a string into grapheme clusters', () => {
  const chars = (ce: ComputeEngine, s: string): string[] =>
    ce
      .box(['Characters', { str: s }])
      .evaluate()
      .ops!.map((x) => x.string!);

  test('basic ASCII', () => {
    const ce = new ComputeEngine();
    expect(chars(ce, 'abc')).toEqual(['a', 'b', 'c']);
  });

  test('empty string yields an empty list', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Characters', { str: '' }]).evaluate().operator).toBe(
      'List'
    );
    expect(chars(ce, '')).toEqual([]);
  });

  test('astral (emoji) characters stay whole', () => {
    const ce = new ComputeEngine();
    expect(chars(ce, 'a😀b')).toEqual(['a', '😀', 'b']);
  });

  test('a combining-mark sequence is one character', () => {
    const ce = new ComputeEngine();
    // 'e' + U+0301 combining acute (NFD) is a single grapheme cluster.
    // Strings are NFC-normalized when boxed (boxed-string.ts), so the
    // cluster comes back as the precomposed U+00E9.
    expect(chars(ce, 'cafe\u0301')).toEqual(['c', 'a', 'f', '\u00e9']);
  });

  test('a ZWJ emoji sequence is one character', () => {
    const ce = new ComputeEngine();
    expect(chars(ce, 'a👨‍👩‍👧b')).toEqual(['a', '👨‍👩‍👧', 'b']);
  });

  test('matches GraphemeClusters (synonym)', () => {
    const ce = new ComputeEngine();
    const viaSynonym = ce
      .box(['GraphemeClusters', { str: 'a👨‍👩‍👧é' }])
      .evaluate()
      .ops!.map((x) => x.string!);
    expect(chars(ce, 'a👨‍👩‍👧é')).toEqual(viaSynonym);
  });

  test('a non-string operand leaves it unevaluated', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Characters', 3]).evaluate().operator).toBe('Characters');
  });
});

describe('StringSplit splits a string into substrings', () => {
  const split = (ce: ComputeEngine, ...ops: any[]): string[] =>
    ce
      .box(['StringSplit', ...ops])
      .evaluate()
      .ops!.map((x) => x.string!);

  test('no separator splits on runs of whitespace, dropping empty parts', () => {
    const ce = new ComputeEngine();
    expect(split(ce, { str: '  foo bar  baz ' })).toEqual([
      'foo',
      'bar',
      'baz',
    ]);
  });

  test('explicit separator uses JS split semantics (empty parts kept)', () => {
    const ce = new ComputeEngine();
    expect(split(ce, { str: 'a,b,,c' }, { str: ',' })).toEqual([
      'a',
      'b',
      '',
      'c',
    ]);
  });

  test('whitespace means the Unicode White_Space code points, not just ASCII', () => {
    const ce = new ComputeEngine();
    // NBSP, narrow no-break space, ideographic space, NEL
    expect(split(ce, { str: 'a\u00a0b\u202fc\u3000d\u0085e' })).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  test('a non-string operand leaves it unevaluated', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['StringSplit', 3]).evaluate().operator).toBe('StringSplit');
    expect(
      ce.box(['StringSplit', { str: 'a' }, 3]).evaluate().operator
    ).toBe('StringSplit');
  });
});

describe('Type operator reports the canonical type without evaluating', () => {
  test('symbol bound to an integer', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 2047);
    expect(ce.box(['Type', 'y']).evaluate().string).toBe('integer');
  });

  test('number literal', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', 2047]).evaluate().string).toBe('finite_integer');
  });

  test('string literal', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', { str: 'abc' }]).evaluate().string).toBe('string');
  });

  test('function expression with a free variable', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', ['Add', 1, 'x']]).evaluate().string).toBe('number');
  });
});
