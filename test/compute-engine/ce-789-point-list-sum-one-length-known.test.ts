import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-789 (Tycho row 489): an element-wise operation of two lists of
// points, when only one list has a known length, was typed as a list of
// lists of points. Its value is a flat list of points. With
// `P: list<tuple<real, real, real>>` and
// `Q: list<tuple<real, real, real>^10>`, `P + Q` was typed
// `list<list<tuple<real, real, real>>>`. The same happened for the
// difference, and for the product of a `range` and a list of points.
//
// The cell of the sum of two lists of points is the component-wise sum of
// their point types, not the union of the two point types.

const LITERAL = String.raw`[1,2,3,4,5,6,7,8,9,10]`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', 'list<tuple<real, real, real>>');
  ce.declare('Q', 'list<tuple<real, real, real>^10>');
  ce.declare('R', 'list<tuple<real, real, real>^10>');
  ce.declare('n', 'list<real>');
  return ce;
}

describe('element-wise operations on two lists of points', () => {
  test.each([
    ['P+Q', 'list<tuple<real, real, real>>'],
    ['Q+P', 'list<tuple<real, real, real>>'],
    ['P-Q', 'list<tuple<real, real, real>>'],
    ['Q-P', 'list<tuple<real, real, real>>'],
    ['2P+Q', 'list<tuple<real, real, real>>'],
    ['P+Q+P', 'list<tuple<real, real, real>>'],
    ['P+P', 'list<tuple<real, real, real>>'],
    ['Q+R', 'list<tuple<real, real, real>^10>'],
    ['n\\cdot Q', 'list<tuple<real, real, real>>'],
  ])('%s is typed %s', (latex, expected) => {
    expect(engine().parse(latex).type.toString()).toBe(expected);
  });

  test('the sum with a range has the type of its value', () => {
    const ce = new ComputeEngine();
    ce.declare('n', { value: ce.parse(String.raw`[1...10]`) } as never);
    ce.declare('m', { value: ce.parse(LITERAL) } as never);
    const sum = ce.parse(
      String.raw`\operatorname{PointList}(n, n, 0)+\operatorname{PointList}(m, m, 0)`
    );
    expect(sum.type.toString()).toBe('list<tuple<integer, integer, integer>>');
    const value = sum.evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(10);
    expect(value.ops!.every((x) => x.operator === 'Tuple')).toBe(true);
  });

  test('the product of a range and a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('n', { value: ce.parse(String.raw`[1...10]`) } as never);
    ce.declare('m', { value: ce.parse(LITERAL) } as never);
    ce.declare('v', 'real');
    const product = ce.parse(
      String.raw`n\cdot\operatorname{PointList}(m, m, v)`
    );
    expect(product.type.toString()).toBe(
      'list<tuple<integer, integer, real>>'
    );
  });

  test('the cell is the component-wise sum of the point types', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'list<tuple<integer, integer, real>>');
    ce.declare('C', 'list<tuple<real, real, integer>^2>');
    expect(ce.parse('A+C').type.toString()).toBe(
      'list<tuple<real, real, real>>'
    );
  });
});
