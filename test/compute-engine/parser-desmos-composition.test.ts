import { engine } from '../utils';

const ce = engine;

function parse(latex: string) {
  return ce.parse(latex).json;
}

describe('Desmos composition: multi-feature corpus rows', () => {
  beforeAll(() => {
    ce.declare('S', 'list<tuple<number, number, number>>');
    ce.declare('p', 'tuple<number, number>');
    ce.declare('L', 'list<number>');
  });

  test('component access on a When result', () => {
    const ast = parse('(p.x)\\left\\{p.x > 0\\right\\}');
    expect(Array.isArray(ast)).toBe(true);
    // Outer shape: When(First(p), Greater(First(p), 0))
    // Note: due to canonical inequality reordering, this may be ['When', ['First', 'p'], ['Less', 0, ['First', 'p']]]
    expect((ast as any[])[0]).toBe('When');
  });

  test('count on a for-comprehension result', () => {
    const ast = parse(
      '(x \\operatorname{for} x = \\left[1...10\\right]).\\operatorname{count}'
    );
    expect((ast as any[])[0]).toBe('Length');
  });

  test('list-range inside a for-comprehension', () => {
    const ast = parse('x \\operatorname{for} x = \\left[1...5\\right]');
    expect((ast as any[])[0]).toBe('Comprehension');
  });

  test('restriction on a list-range', () => {
    const ast = parse('\\left[1...10\\right]\\left\\{n > 3\\right\\}');
    expect((ast as any[])[0]).toBe('When');
  });

  test('component access composed: L.x.real', () => {
    expect(parse('L.x.\\operatorname{real}')).toEqual(['Real', ['First', 'L']]);
  });

  test('for-comp with dependent binding and component access in body', () => {
    // (p.x, p.y) for p = [..., ..., ...]
    ce.declare('P_list', 'list<tuple<number, number>>');
    const ast = parse(
      '(p.x, p.y) \\operatorname{for} p = P_{list}'
    );
    expect((ast as any[])[0]).toBe('Comprehension');
  });

  test('range with restriction and member access composition', () => {
    // [1...10]{n > 0}.count
    const ast = parse(
      '\\left[1...10\\right]\\left\\{n > 0\\right\\}.\\operatorname{count}'
    );
    expect((ast as any[])[0]).toBe('Length');
  });

  test('nested restriction', () => {
    const ast = parse(
      'x\\left\\{x>0\\right\\}\\left\\{x<10\\right\\}\\left\\{x \\ne 5\\right\\}'
    );
    // canonicalize-to-And: When(x, And(c1, c2, c3))
    expect((ast as any[])[0]).toBe('When');
    expect((ast as any[])[2][0]).toBe('And');
  });
});
