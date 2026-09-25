import { ComputeEngine } from '../../src/compute-engine';

// `Map` takes the mapping function FIRST. A call with a collection first and a
// function last is a misuse. It must give the same `incompatible-type` error
// whether the collection is a literal or a declared symbol that holds one.
describe('MAP WITH ITS ARGUMENTS REVERSED', () => {
  const ce = new ComputeEngine();
  ce.assign('P', ce.parse('[1,2,3]'));
  ce.declare('Q', 'list<integer>');

  const norm = ['Function', ['Norm', 'u'], 'u'] as const;
  const error = (type: string, source: string) =>
    `Map(Error(ErrorCode("incompatible-type", "function", "${type}"), ${source}), (u) => ||u||)`;

  test('literal source', () => {
    const expr = ce.box(['Map', ['List', 1, 2, 3], norm as any]);
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().toString()).toBe(
      error('vector<integer^3>', '[1,2,3]')
    );
  });

  test('symbol with an assigned list value', () => {
    const expr = ce.box(['Map', 'P', norm as any]);
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().toString()).toBe(error('vector<integer^3>', 'P'));
  });

  test('symbol with an assigned list value, parse route', () => {
    const expr = ce.parse('\\operatorname{Map}(P, u \\mapsto \\Vert u\\Vert)');
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().toString()).toBe(error('vector<integer^3>', 'P'));
  });

  test('symbol declared as a list', () => {
    const expr = ce.box(['Map', 'Q', norm as any]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toBe(error('list<integer>', 'Q'));
  });

  test('an undeclared symbol is not declared and stays unevaluated', () => {
    const expr = ce.box(['Map', 'R', norm as any]);
    expect(expr.toString()).toBe('Map(R, (u) => ||u||)');
    expect(ce.lookupDefinition('R')).toBeUndefined();
  });

  test('the correct order still maps', () => {
    expect(
      ce
        .box(['Map', ['Function', ['Multiply', 2, 'u'], 'u'], 'P'])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });
});
