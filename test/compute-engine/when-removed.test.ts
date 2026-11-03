import { ComputeEngine } from '../../src/compute-engine';

// The `When` operator is removed: a restriction is the single-branch
// `If(c, e)`, and the LaTeX restriction `e\{c\}` parses to it.

describe('The When operator is removed', () => {
  const ce = new ComputeEngine();

  test('When has no library definition and evaluates to itself', () => {
    const e = ce.box(['When', 1, 'True']);
    expect(e.operatorDefinition).toBeUndefined();
    expect(e.evaluate().json).toEqual(['When', 1, 'True']);
  });

  test('\\mathrm{When} does not parse to a restriction', () => {
    const e = ce.parse('\\mathrm{When}(1, x>0)');
    expect(e.operator).toBe('When');
    expect(e.json).toEqual(['When', 1, ['Less', 0, 'x']]);
  });

  test('a LaTeX restriction parses to a single-branch If', () => {
    const e = ce.parse('x^2\\{x>0\\}');
    expect(e.json).toEqual(['If', ['Less', 0, 'x'], ['Power', 'x', 2]]);
    expect(e.latex).toBe('x^2\\text{ where }0\\lt x');
  });

  test('a conjunction decided by a second evaluation takes the decided route', () => {
    const c = new ComputeEngine();
    c.declare('C', 'boolean');
    expect(c.box(['If', ['And', 'C', ['Not', 'C']], 3]).evaluate().json).toBe(
      'NaN'
    );
    expect(
      c.box(['If', ['And', 'C', ['Not', 'C']], ['List', 1, 2]]).evaluate().json
    ).toBe('Missing');
    expect(
      c
        .box([
          'If',
          ['And', ['Less', 0, 't'], ['Less', 0, 't']],
          ['Subtract', 'x', 'x'],
        ])
        .evaluate().json
    ).toEqual(['If', ['Less', 0, 't'], ['Add', 'x', ['Negate', 'x']]]);
    expect(c.box(['If', ['And', 'True', 'True'], 3]).evaluate().json).toBe(3);
  });
});
