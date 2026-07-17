import { ComputeEngine } from '../../../src/compute-engine';
import { latex, engine } from '../../utils';

describe('FOR LOOP - SERIALIZATION', () => {
  test('Loop with Element/Range', () => {
    expect(
      latex(['Loop', ['Square', 'i'], ['Element', 'i', ['Range', 0, 9]]])
    ).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }0\\text{ to }9\\text{ do }i^2`
    );
  });

  test('Loop with expression bounds', () => {
    expect(
      latex([
        'Loop',
        ['Add', 'k', 1],
        ['Element', 'k', ['Range', 'n', ['Multiply', 2, 'n']]],
      ])
    ).toMatchInlineSnapshot(
      `\\text{for }k\\text{ from }n\\text{ to }2n\\text{ do }k+1`
    );
  });
});

describe('COMPREHENSION - SERIALIZATION', () => {
  // A canonical Comprehension is a lazy collection. Its `.latex` must be the
  // faithful comprehension form (not a materialized, elided preview List that
  // re-parses to a corrupt finite List). See Tycho item 22.
  test('canonical Comprehension serializes faithfully (not an elided List)', () => {
    expect(
      latex(['Comprehension', ['Power', 'n', 2], ['Element', 'n', ['Range', 1, 250]]])
    ).toMatchInlineSnapshot(`n^2 \\operatorname{for} n = 1..250`);
  });

  // Round-trip contract: parse(serialize(x)) structurally equals x.
  test.each([
    ['simple body', '\\lbrack n^2 \\operatorname{for} n = 1..250\\rbrack'],
    ['tuple body', '\\lbrack (n, n^2) \\operatorname{for} n = 1..10\\rbrack'],
    [
      'multiple Element clauses',
      '\\lbrack i+j \\operatorname{for} i = 1..3, j = 1..3\\rbrack',
    ],
    [
      'dependent domain',
      '\\lbrack (i,j) \\operatorname{for} i = 1..3, j = 1..i\\rbrack',
    ],
    ['infinite domain', '\\lbrack n^2 \\operatorname{for} n = 1..\\infty\\rbrack'],
  ])('round-trips: %s', (_label, src) => {
    const original = engine.parse(src);
    expect(original.operator).toBe('Comprehension');
    const roundTripped = engine.parse(original.latex);
    expect(roundTripped.operator).toBe('Comprehension');
    expect(roundTripped.isSame(original)).toBe(true);
  });
});

describe('MAP / FILTER - SERIALIZATION (Tycho item 26)', () => {
  // A canonical `Map`/`Filter` is a lazy collection. Its `.latex` must be the
  // faithful operator form, not a materialized preview List. Materializing is
  // corrupt when the body cannot fully evaluate (the lazy stream leaks
  // unsubstituted lambda bodies) and lossy when it can (value-baking / dropped
  // operator identity). See Tycho item 26.

  test('Map over a bound-symbol collection with an undetermined body serializes faithfully', () => {
    const ce = new ComputeEngine();
    ce.assign('d', ce.box(['List', 1, 2, 3]));
    ce.declare('m', 'number'); // no value: the body can't fully evaluate
    const e = ce.box([
      'Map',
      'd',
      ['Function', ['Which', ['Equal', 'k', 'm'], 1e9, 'True', 'k'], 'k'],
    ]);
    const lx = e.latex;

    // Faithful operator form, not a materialized preview of raw lambda bodies.
    expect(lx).toMatchInlineSnapshot(
      `\\mathrm{Map}(d, k\\mapsto\\begin{cases}1\\,000\\,000\\,000&k=m\\\\k&\\top\\end{cases})`
    );

    // Round-trips to the same expression.
    expect(ce.parse(lx).json).toEqual(e.json);

    // The lambda parameter `k` must be bound by the `\mapsto`, not leaked as a
    // free preview element (the pre-fix bug emitted three identical `\bigl\lbrack
    // {cases …}, …\bigr\rbrack` copies with `k` never substituted).
    expect(lx).toContain('k\\mapsto');
    expect(lx.startsWith('\\bigl\\lbrack')).toBe(false);
  });

  test('Map does not bake in assigned symbol values at serialization time', () => {
    const ce = new ComputeEngine();
    ce.assign('d', ce.box(['List', 1, 2, 3]));
    ce.assign('m', ce.box(2)); // every referenced symbol has a value
    const e = ce.box([
      'Map',
      'd',
      ['Function', ['Which', ['Equal', 'k', 'm'], 1e9, 'True', 'k'], 'k'],
    ]);
    const lx = e.latex;

    // Still the operator form (no evaluated-result list baked in).
    expect(lx).toContain('\\mathrm{Map}(d,');
    expect(ce.parse(lx).json).toEqual(e.json);
  });

  test('Filter over a bound-symbol collection serializes faithfully', () => {
    const ce = new ComputeEngine();
    ce.assign('d', ce.box(['List', 1, 2, 3]));
    const e = ce.box([
      'Filter',
      'd',
      ['Function', ['Greater', 'k', 1], 'k'],
    ]);
    const lx = e.latex;

    expect(lx).toMatchInlineSnapshot(`\\mathrm{Filter}(d, k\\mapsto1\\lt k)`);
    expect(ce.parse(lx).json).toEqual(e.json);
    expect(lx.startsWith('\\bigl\\lbrack')).toBe(false);
  });
});

describe('BREAK / CONTINUE / RETURN - SERIALIZATION', () => {
  test('Break', () => {
    expect(latex(['Break'])).toMatchInlineSnapshot(`\\text{break}`);
  });

  test('Continue', () => {
    expect(latex(['Continue'])).toMatchInlineSnapshot(`\\text{continue}`);
  });

  test('Return with expression', () => {
    expect(latex(['Return', ['Add', 'x', 1]])).toMatchInlineSnapshot(
      `\\text{return }x+1`
    );
  });

  test('Return without expression', () => {
    expect(latex(['Return', 'Nothing'])).toMatchInlineSnapshot(
      `\\text{return}`
    );
  });
});
