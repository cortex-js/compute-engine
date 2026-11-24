import { ComputeEngine } from '../../../src/compute-engine';

// CE-1175: an invisible box (`\phantom{…}` and its variants) or a strut at
// the start of an expression has no operand, so a prefix operator after it,
// with or without visual space between them, applies as at the start of the
// expression. `\phantom{x}\,-b` was `Subtract(HorizontalSpacing(3), b)`,
// whose canonical form is `-b + Error(…)`, and `x = \phantom{x}-b` was
// `Subtract(Equal(x, Error("missing")), b)`.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const canonical = (s: string) => ce.parse(s).json;

describe('CE-1175 invisible box before a prefix operator', () => {
  test.each([
    ['\\phantom{x}\\,-b', '-b'],
    ['\\vphantom{x}\\,-b', '-b'],
    ['\\hphantom{x}\\,-b', '-b'],
    ['\\strut\\,-b', '-b'],
    ['\\phantom{x}\\,+b', '+b'],
    ['\\phantom{x}\\,-1', '-1'],
    ['\\phantom{x}-b^2+c', '-b^2+c'],
    ['\\phantom{x}\\,\\neg p', '\\neg p'],
    // Without visual space, not at the start of the whole input
    ['x=\\phantom{x}-b', 'x=-b'],
    ['a+\\phantom{x}-b', 'a+-b'],
    ['(\\phantom{x}-b)', '(-b)'],
    ['\\sqrt{\\phantom{x}-b}', '\\sqrt{-b}'],
    // With visual space, not at the start of the whole input
    ['x=\\phantom{x}\\,-b', 'x=-b'],
    ['a+\\phantom{x}\\,-b', 'a+-b'],
    ['f(\\phantom{x}\\,-b, c)', 'f(-b, c)'],
    // Several boxes, with visual space between them
    ['\\phantom{x}\\,\\phantom{y}\\,-b', '-b'],
    ['\\phantom{x}\\,\\strut\\,-b', '-b'],
  ])('%s is %s', (boxed, plain) => {
    expect(raw(boxed)).toEqual(raw(plain));
    expect(canonical(boxed)).toEqual(canonical(plain));
  });

  test('a style switch after the box keeps its style', () => {
    expect(raw('\\displaystyle\\phantom{x}\\,-b')).toEqual(
      raw('\\displaystyle -b')
    );
    expect(raw('\\phantom{x}\\,\\displaystyle -b')).toEqual(
      raw('\\displaystyle -b')
    );
  });

  test('after an operand, the sign is an infix operator', () => {
    expect(canonical('a\\phantom{x}\\,-b')).toEqual(canonical('a-b'));
    expect(canonical('2\\phantom{x}\\,-b')).toEqual(canonical('2-b'));
  });

  test('after an operand, an empty command does not make the sign a factor', () => {
    // `\placeholder{}` and `\smash{}` give `Nothing` but are not skipped as
    // decorations before an infix operator: the juxtaposition reads them as
    // its right operand. The sign after them is not a prefix operator.
    for (const s of [
      'a\\placeholder{}-b',
      'a\\smash{}-b',
      'a\\placeholder{}\\,-b',
      'a\\placeholder{}\\,\\phantom{x}\\,-b',
      // Several empty commands in a row
      'a\\placeholder{}\\phantom{x}-b',
      'a\\placeholder{}\\phantom{x}\\,-b',
      'a\\placeholder{}\\strut\\,-b',
      'a\\phantom{x}\\placeholder{}-b',
      'a\\smash{}\\strut-b',
    ]) {
      const json = JSON.stringify(raw(s));
      expect(json).not.toContain('["InvisibleOperator","a",["Negate","b"]]');
      expect(canonical(s)).not.toEqual(canonical('-ab'));
    }
    // The number reader does not read `-1` as a factor either.
    expect(canonical('a\\placeholder{}\\,-1')).toEqual(canonical('a-1'));
  });

  test('visual space with no prefix operator after it stays an operand', () => {
    expect(raw('\\phantom{x}\\,b')).toEqual([
      'InvisibleOperator',
      ['HorizontalSpacing', 3],
      'b',
    ]);
    expect(raw('\\phantom{x}\\,')).toEqual(['HorizontalSpacing', 3]);
  });

  test('an authored Nothing is an operand', () => {
    expect(raw('\\mathrm{Nothing}-b')).toEqual(['Subtract', 'Nothing', 'b']);
  });
});
