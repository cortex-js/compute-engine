import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil, parseEpsil, serializeEpsil } from '../../src/epsil';
import { validEpsil } from '../utils';

//
// The range `a..b` counts up from `a` to `b` by 1: it is `Range(a, b, 1)`,
// which has no element when `a > b`. The call `Range(a, b)` with no step
// counts toward `b` in either direction (`docs/COLLECTIONS-MODEL.md`).
//

/** The text of the value of a program, in a new engine, and the codes of its
 * diagnostics. */
function run(source: string): { value: string; codes: string[] } {
  const r = executeEpsil(new ComputeEngine(), source);
  return {
    value: r.value.toString(),
    codes: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? String(d.message[0]) : d.message
    ),
  };
}

describe('the range `a..b` is empty when `a > b`', () => {
  test.each([
    ['a `for` loop', 'let n = 0\nlet c = 0\nfor k in 1..n { c = c + 1 }\nc', '0'],
    ['`length`', 'let n = 0\nlength(1..n)', '0'],
    ['`sum`', 'let n = 0\nsum(1..n)', '0'],
    ['the elements', 'let n = 0\nlistFrom(1..n)', '[]'],
    ['a comprehension', 'let n = 0\n[k^2 for k in 1..n]', '[]'],
    ['a slice', 'let n = 0\nlet xs = [10, 20, 30]\nxs[1..n]', '[]'],
    ['`all`', 'let n = 0\nall(1..n, k => k > 5)', '"True"'],
    // The bounds of a sum agree with the range of the same bounds.
    ['the limits of `sum`', 'let n = 0\nsum(k, (k, 1, n)) == sum(1..n)', '"True"'],
  ])('%s', (_, source, expected) => {
    expect(run(source)).toEqual({ value: expected, codes: [] });
  });

  test('a range with equal bounds has one element', () => {
    expect(run('let n = 1\nlistFrom(1..n)').value).toBe('[1]');
  });

  test('an ascending range has the elements from `a` to `b`', () => {
    expect(run('let n = 4\nlistFrom(2..n)').value).toBe('[2,3,4]');
    expect(run('let xs = [10, 20, 30]\nxs[2..3]').value).toBe('[20,30]');
    expect(run('sum(1..100)').value).toBe('5050');
  });

  test('the call `Range` with no step counts toward its end in either direction', () => {
    expect(run('listFrom(Range(7, 4))').value).toBe('[7,6,5,4]');
    expect(run('let n = 0\nlistFrom(Range(1, n))').value).toBe('[1,0]');
    expect(run('listFrom(Range(7, 4, -1))').value).toBe('[7,6,5,4]');
  });

  test('the compiled loop over `1..n` runs zero times when `n` is 0', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const [program] = parseEpsil('do {\n  let c = 0\n  for k in 1..n { c = c + k }\n  c\n}');
    const result = compile(ce.expr(program));
    expect(result.success).toBe(true);
    expect(result.run!({ n: 0 })).toBe(0);
    expect(result.run!({ n: 3 })).toBe(6);
  });
});

describe('the forms of `a..b`', () => {
  test('`a..b` is `Range(a, b, 1)`', () => {
    expect(validEpsil('1..n')).toStrictEqual(['Range', 1, 'n', 1]);
    expect(validEpsil('for k in 1..n { k }')).toStrictEqual([
      'Loop',
      ['Block', 'k'],
      ['Element', 'k', ['Range', 1, 'n', 1]],
    ]);
    expect(validEpsil('xs[2..3]')).toStrictEqual([
      'At',
      'xs',
      ['Range', 2, 3, 1],
    ]);
  });

  test('a call of `Range` keeps its operands', () => {
    expect(validEpsil('Range(1, n)')).toStrictEqual(['Range', 1, 'n']);
    expect(validEpsil('Range(7, 4, -1)')).toStrictEqual(['Range', 7, 4, -1]);
  });

  test('a range pattern keeps its two bounds', () => {
    expect(
      validEpsil(
        'match x {\n  1..5 | (7..9) => "in"\n  [1..3, _] => "list"\n  _ => "out"\n}'
      )
    ).toEqual([
      'Match',
      'x',
      [
        'MatchCase',
        ['Alternatives', ['Range', 1, 5], ['Range', 7, 9]],
        { str: 'in' },
      ],
      ['MatchCase', ['List', ['Range', 1, 3], '_'], { str: 'list' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
  });

  test('a step written `1.0` is not the step of `a..b`', () => {
    expect(serializeEpsil(['Range', 1, 'n', { num: '1.0' }])).toBe(
      'Range(1, n, 1.0)'
    );
  });

  test.each([
    // [MathJSON, Epsil]
    [['Range', 1, 'n', 1], '1 .. n'],
    [['Range', 1, 'n'], 'Range(1, n)'],
    [['Range', 1, 'n', 2], 'Range(1, n, 2)'],
    [['Range', 7, 4, -1], 'Range(7, 4, -1)'],
    [['Range', 5], 'Range(5)'],
    [['Range', 1, ['Subtract', 'n', 1], 1], '1 .. n - 1'],
    // `..` binds less tightly than `+` and `[…]`.
    [['Add', ['Range', 1, 3, 1], 1], '(1 .. 3) + 1'],
    [['Add', ['Range', 1, 3], 1], 'Range(1, 3) + 1'],
    [['At', ['Range', 1, 3, 1], 2], '(1 .. 3)[2]'],
    [['Element', 'k', ['Range', 1, 5, 1]], 'k in 1 .. 5'],
    [['Range', 1, ['Range', 2, 10, 1], 1], '1 .. (2 .. 10)'],
    [['Range', -1, 5, 1], '-1 .. 5'],
    [['Range', -5, -1, 1], '-5 .. -1'],
  ])('%j is written `%s`, which parses to it', (json, epsil) => {
    expect(serializeEpsil(json)).toBe(epsil);
    expect(validEpsil(epsil)).toStrictEqual(json);
  });
});

describe('the warning `range-empty`', () => {
  /** The diagnostics of `source`: severity, message and replacement text. */
  function diagnostics(source: string): unknown[] {
    return parseEpsil(source)[1].map((d) => [
      d.severity,
      d.message,
      d.fixits?.map(([start, end, text]) => [source.slice(start, end), text]),
    ]);
  }

  test('two literal bounds with `a > b`, with the range that counts down as the fix', () => {
    expect(diagnostics('for k in 7..4 { k }')).toEqual([
      ['warning', ['range-empty', 7, 4], [['7..4', 'Range(7, 4, -1)']]],
    ]);
    expect(diagnostics('xs[3 .. -1]')).toEqual([
      ['warning', ['range-empty', 3, -1], [['3 .. -1', 'Range(3, -1, -1)']]],
    ]);
  });

  test.each([
    '[k for k in 7..4]',
    'f(x) = 7..4',
    'let v = (7..4)',
    'xs |> map(k => 7..4)',
    'let v = 7..4 if c else 2',
    'g(7..4, 1)',
  ])('one warning for the range in `%s`', (source) => {
    expect(diagnostics(source).map((d) => (d as unknown[])[1])).toEqual([
      ['range-empty', 7, 4],
    ]);
  });

  test('the program still runs, and the range is empty', () => {
    expect(run('listFrom(7..4)')).toEqual({ value: '[]', codes: ['range-empty'] });
  });

  test('the fix gives the elements in descending order', () => {
    expect(run('listFrom(Range(7, 4, -1))')).toEqual({
      value: '[7,6,5,4]',
      codes: [],
    });
  });

  test('no warning for bounds that are equal, ascending or not literals', () => {
    expect(diagnostics('4..4')).toEqual([]);
    expect(diagnostics('4..7')).toEqual([]);
    expect(diagnostics('7..n')).toEqual([]);
    expect(diagnostics('Range(7, 4)')).toEqual([]);
  });
});
