import { ComputeEngine } from '../../../src/compute-engine';

// CE-1173: visual space (`\,`, `\quad`, `\hspace{1em}`, …) between a prefix
// operator and its operand is skipped. A prefix operator parses its operand
// above the precedence of a juxtaposition, so the spacing command alone was
// the operand: `-\,b` was
// `InvisibleOperator(Negate(HorizontalSpacing(3)), b)`, whose canonical form
// is `(-Error(…), b)`.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const canonical = (s: string) => ce.parse(s).json;

describe('CE-1173 visual space after a prefix operator', () => {
  test.each([
    ['-\\,b', '-b'],
    ['x=-\\,b', 'x=-b'],
    ['x = -\\, b', 'x = -b'],
    ['-\\,\\frac12', '-\\frac12'],
    ['-\\,2b', '-2b'],
    ['-\\,b^2', '-b^2'],
    ['-\\,\\sin x', '-\\sin x'],
    ['-\\,1', '-1'],
    ['-\\,-b', '--b'],
    ['2\\cdot-\\,b', '2\\cdot-b'],
    // Each spacing command, and several in a row
    ['-\\quad b', '-b'],
    ['-\\;b', '-b'],
    ['-\\!b', '-b'],
    ['-\\hspace{1em}b', '-b'],
    ['-\\,\\,b', '-b'],
    // Visual space before and after the sign
    ['\\,-\\,b', '-b'],
    ['x = \\, - \\, b', 'x = -b'],
    // A prefix operator with the default handler
    ['\\neg\\,p', '\\neg p'],
    ['\\lnot\\,p', '\\lnot p'],
    ['\\neg\\,p\\land q', '\\neg p\\land q'],
  ])('%s is %s', (spaced, plain) => {
    expect(raw(spaced)).toEqual(raw(plain));
    expect(canonical(spaced)).toEqual(canonical(plain));
  });

  test('a value', () => {
    ce.assign('b', 5);
    try {
      expect(ce.parse('-\\,b').evaluate().json).toEqual(-5);
      expect(ce.parse('2-\\,-\\,b').evaluate().json).toEqual(7);
    } finally {
      ce.forget('b');
    }
  });

  test('visual space after an infix sign stays an operand in the raw form', () => {
    expect(raw('a-\\,b')).toEqual([
      'Subtract',
      'a',
      ['InvisibleOperator', ['HorizontalSpacing', 3], 'b'],
    ]);
    expect(canonical('a-\\,b')).toEqual(canonical('a-b'));
    expect(canonical('a\\,-\\,b')).toEqual(canonical('a-b'));
  });

  test('in the lenient grammar, a space between `-` and `+` keeps two signs', () => {
    // `-+x` with no space between the signs is a prefix `∓`.
    const lenient = (s: string) => ce.parse(s, { strict: false }).json;
    expect(lenient('-\\,+x')).toEqual(lenient('- +x'));
    expect(lenient('-\\,+x')).not.toEqual(lenient('-+x'));
  });
});
