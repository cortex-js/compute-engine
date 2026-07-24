import { ComputeEngine } from '../../src/compute-engine';

//
// `Declare` with a `Tuple` pattern in the name position — the engine form
// behind Cortex destructuring declarations (`let (x, y) = t`). The pattern is
// held raw (canonicalizing it would bind the about-to-be-declared names);
// each component declares in the current scope. Shape mismatches yield an
// incompatible-type error value and bind nothing else.
//

const attrs = (value: unknown, constant = false) =>
  [
    'Dictionary',
    ['KeyValuePair', { sym: 'value' }, value],
    ...(constant ? [['KeyValuePair', { sym: 'constant' }, 'True']] : []),
  ] as any;

describe('Declare with a Tuple pattern', () => {
  test('binds each component (box route)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], attrs(['Tuple', 3, 4])])
      .evaluate();
    expect(r.toString()).toBe('(3, 4)');
    expect(ce.parse('x + y').evaluate().isSame(7)).toBe(true);
  });

  test('a symbol value resolves to its tuple before splicing', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    ce.box(['Declare', ['Tuple', 'x', 'y'], attrs('p')]).evaluate();
    expect(ce.parse('10x + y').evaluate().isSame(34)).toBe(true);
  });

  test('nested patterns and `_` wildcards', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      ['Tuple', ['Tuple', 'a', 'b'], '_', 'c'],
      attrs(['Tuple', ['Tuple', 1, 2], 99, 5]),
    ]).evaluate();
    expect(ce.parse('a + b + c').evaluate().isSame(8)).toBe(true);
  });

  test('constant attribute freezes every binding', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      ['Tuple', 'x', 'y'],
      attrs(['Tuple', 3, 4], true),
    ]).evaluate();
    // Engine-level assignment to a constant throws (the Cortex runtime
    // surfaces this as a `runtime-error` diagnostic).
    expect(() => ce.box(['Assign', 'x', 9]).evaluate()).toThrow();
    expect(ce.symbol('x').evaluate().isSame(3)).toBe(true);
  });

  test('a length mismatch is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y', 'z'], attrs(['Tuple', 1, 2])])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a non-tuple value is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], attrs(5)])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a pattern without a value stays inert', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Declare', ['Tuple', 'x', 'y']]).evaluate();
    expect(r.operator).toBe('Declare');
  });
});
