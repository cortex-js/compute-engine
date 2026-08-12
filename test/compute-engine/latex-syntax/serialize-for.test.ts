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
  // re-parses to a corrupt finite List). See Tycho item 22. The bracket
  // fence is unconditional (Tycho item 72): `[body for …]` re-parses to the
  // same Comprehension, and without the fence an operand-position
  // comprehension swallowed its surrounding operator on re-parse.
  test('canonical Comprehension serializes faithfully (not an elided List)', () => {
    expect(
      latex(['Comprehension', ['Power', 'n', 2], ['Element', 'n', ['Range', 1, 250]]])
    ).toMatchInlineSnapshot(
      `\\left[n^2 \\operatorname{for} n = 1..250\\right]`
    );
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

describe('COMPREHENSION with a Block body (Tycho item 172)', () => {
  // `["Comprehension", ["Block", …locals…, value], ["Element", n, …]]` — the
  // shape the `body with d = …` dialect produces when the local depends on
  // the loop index. The block body serializes as a `;`-separated statement
  // list, which binds LOOSER than the `for` clause: unfenced, the emitted
  // LaTeX re-parsed as a one-element list wrapping
  // `Block(d≔[n,2], Comprehension(Σd, …))` — the local no longer scoped over
  // the body and the value silently changed. The body is fenced with `(…)`.
  const blockComprehension = [
    'Comprehension',
    ['Block', ['Declare', 'd'], ['Assign', 'd', ['List', 'n', 2]], ['Sum', 'd']],
    ['Element', 'n', ['Range', 1, 3]],
  ] as any;

  test('box route: the block body is fenced', () => {
    const ce = new ComputeEngine();
    expect(ce.box(blockComprehension).latex).toMatchInlineSnapshot(
      `\\left[\\left(d\\coloneq\\bigl\\lbrack n, 2\\bigr\\rbrack; \\sum d\\right) \\operatorname{for} n = 1..3\\right]`
    );
  });

  test('box route: round-trips without changing the value', () => {
    const ce = new ComputeEngine();
    const original = ce.box(blockComprehension);
    const roundTripped = ce.parse(original.latex);
    expect(roundTripped.operator).toBe('Comprehension');
    expect(roundTripped.json).toEqual(original.json);
    // A `Comprehension` is a lazy collection: materialize to read the values.
    expect(
      roundTripped.evaluate({ materialization: true }).json
    ).toEqual(original.evaluate({ materialization: true }).json);
    expect([...roundTripped.each()].map((x) => x.json)).toEqual([3, 4, 5]);
  });

  test('parse route: the fenced spelling parses to a Block-bodied Comprehension', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse(
      '\\left[\\left(d\\coloneq\\bigl\\lbrack n, 2\\bigr\\rbrack; \\sum d\\right) \\operatorname{for} n = 1..3\\right]'
    );
    expect(parsed.json).toEqual(blockComprehension);
    expect([...parsed.each()].map((x) => x.json)).toEqual([3, 4, 5]);
  });

  test('a block-local shadows an outer symbol without leaking', () => {
    const ce = new ComputeEngine();
    ce.assign('d', ce.box(99));
    const e = ce.box([
      'Comprehension',
      [
        'Block',
        ['Declare', 'd'],
        ['Assign', 'd', ['Multiply', 'n', 10]],
        ['Add', 'd', 1],
      ],
      ['Element', 'n', ['Range', 1, 3]],
    ] as any);
    expect([...e.each()].map((x) => x.json)).toEqual([11, 21, 31]);
    expect(ce.box('d').evaluate().json).toEqual(99);
    // …and the round trip keeps that shape.
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('a comprehension WITHOUT a block body is not fenced', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Comprehension',
      ['Add', 'n', 1],
      ['Element', 'n', ['Range', 1, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\left[n+1 \\operatorname{for} n = 1..3\\right]`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });
});

describe('LOOP with a Block body (item 172 sibling)', () => {
  // The `Loop` serializer had the same latent hazard as the comprehension one:
  // a `Block` body emits a bare `;`-separated statement list, and `;` (19)
  // binds looser than the `do` clause. Unfenced, `for i from 1 to 3 do
  // s≔2i; s+1` re-parsed as `Tuple(Loop(s≔2i, …), s+1)` — only the first
  // statement stayed in the loop and the rest escaped both the loop and the
  // block's scope. The body is fenced with `(…)`.
  const blockLoop = [
    'Loop',
    [
      'Block',
      ['Declare', 's'],
      ['Assign', 's', ['Multiply', 'i', 2]],
      ['Add', 's', 1],
    ],
    ['Element', 'i', ['Range', 1, 3]],
  ] as any;

  test('box route: the block body is fenced', () => {
    const ce = new ComputeEngine();
    expect(ce.box(blockLoop).latex).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }\\left(s\\coloneq2i; s+1\\right)`
    );
  });

  test('box route: round-trips to the identical expression', () => {
    const ce = new ComputeEngine();
    const original = ce.box(blockLoop);
    const roundTripped = ce.parse(original.latex);
    expect(roundTripped.operator).toBe('Loop');
    expect(roundTripped.json).toEqual(original.json);
  });

  test('a loop WITHOUT a block body is not fenced', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Loop',
      ['Add', 'i', 1],
      ['Element', 'i', ['Range', 1, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }i+1`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  // The functional fallback spelling — used for loop shapes the `for … do`
  // syntax cannot express (a non-`Range` collection) — has the same hazard:
  // `;` binds looser than the argument-separating `,`, so an unfenced block
  // body swallowed the `Element` operand into its last statement.
  test('the \\operatorname{Loop}(...) fallback fences a block body too', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Loop',
      [
        'Block',
        ['Declare', 's'],
        ['Assign', 's', ['Multiply', 'k', 2]],
        ['Add', 's', 1],
      ],
      ['Element', 'k', ['List', 1, 2, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\operatorname{Loop}(\\left(s\\coloneq2k; s+1\\right), k\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('the fallback leaves a non-block body unfenced', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Loop',
      ['Add', 'k', 1],
      ['Element', 'k', ['List', 1, 2, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\operatorname{Loop}(k+1, k\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
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
