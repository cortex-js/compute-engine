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

describe('DEFAULT function serializer with a Block operand (item 172)', () => {
  // The same mechanism as the comprehension/loop body fences, in the GENERIC
  // `\mathrm{Op}(arg, arg, …)` path (`Serializer.wrapArguments`): a `Block`
  // operand emits a bare `;`-separated statement list, and `;` (19) binds
  // looser than the `,` separating arguments. Unfenced,
  // `\mathrm{Repeat}(s≔2; s+1, 3)` re-parsed with the block swallowing the
  // `, 3` into its last statement — a VALUE-CHANGING round trip.
  const block = [
    'Block',
    ['Declare', 's'],
    ['Assign', 's', 2],
    ['Add', 's', 1],
  ] as any;

  test('witness: Repeat(Block, 3) fences the block operand', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Repeat', block, 3] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\mathrm{Repeat}(\\left(s\\coloneq2; s+1\\right), 3)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('block operand in FIRST position of a 3-operand call', () => {
    const ce = new ComputeEngine();
    ce.declare('g3', '(any, any, any) -> number');
    const e = ce.box(['g3', block, 1, 2] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\mathrm{g3}(\\left(s\\coloneq2; s+1\\right), 1, 2)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('block operand in MIDDLE position of a 3-operand call', () => {
    const ce = new ComputeEngine();
    ce.declare('g3', '(any, any, any) -> number');
    const e = ce.box(['g3', 1, block, 2] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\mathrm{g3}(1, \\left(s\\coloneq2; s+1\\right), 2)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('block operand in LAST position of a 3-operand call', () => {
    const ce = new ComputeEngine();
    ce.declare('g3', '(any, any, any) -> number');
    const e = ce.box(['g3', 1, 2, block] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\mathrm{g3}(1, 2, \\left(s\\coloneq2; s+1\\right))`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('non-block operands stay unfenced', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Repeat', ['Add', 's', 1], 3] as any);
    expect(e.latex).toMatchInlineSnapshot(`\\mathrm{Repeat}(s+1, 3)`);
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });
});

describe('SINGLE-STATEMENT Block round trip (item 172)', () => {
  // A one-statement block had NO spelling: `Block(Declare s, Assign s 2)`
  // serialized to the bare `s≔2` (a `Declare` emits nothing), which re-parses
  // as a naked `Assign` — the block, and with it the LOCAL SCOPE, is gone, so
  // the assignment leaks to the enclosing scope. The fences added above do not
  // help: `\left(s≔2\right)` is just a parenthesized assignment.
  //
  // Spelling (USER RULING 2026-08-12): a TRAILING SEMICOLON. `(s≔2;)` already
  // parsed as a block; the empty segment it left behind is now dropped as a
  // block MARKER rather than kept as a `Nothing` statement (which, being the
  // LAST statement, made the block answer `Nothing` instead of `2`).
  // Braces were considered and rejected: `\left\lbrace s≔2\right\rbrace`
  // parses as `Set(Assign(…))` — set notation wins the collision.
  const single = ['Block', ['Declare', 's'], ['Assign', 's', 2]] as any;
  const multi = [
    'Block',
    ['Declare', 's'],
    ['Assign', 's', 2],
    ['Add', 's', 1],
  ] as any;

  test('serializes with the trailing `;` marker', () => {
    const ce = new ComputeEngine();
    expect(ce.box(single).latex).toMatchInlineSnapshot(`s\\coloneq2;`);
  });

  test('parses back to the same block — with its VALUE, not `Nothing`', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(s\\coloneq2;)');
    expect(e.json).toEqual(['Block', ['Declare', 's'], ['Assign', 's', 2]]);
    expect(e.evaluate().json).toEqual(2);
  });

  test('top-level round trip', () => {
    const ce = new ComputeEngine();
    const e = ce.box(single);
    const back = ce.parse(e.latex);
    expect(back.json).toEqual(e.json);
    expect(back.evaluate().json).toEqual(2);
  });

  // A `Declare` emits nothing, so `Block(Assign s 2)` is also a ONE-statement
  // block. It re-parses with the `Declare` the `;` handler inserts in front of
  // every block-local `Assign` — the same expression the box route produces.
  test('a bare Assign block re-parses with its implicit Declare', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Block', ['Assign', 's', 2]] as any);
    expect(e.latex).toMatchInlineSnapshot(`s\\coloneq2;`);
    expect(ce.parse(e.latex).json).toEqual([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 2],
    ]);
  });

  // A single NON-assign statement gets the marker too, and the marker alone
  // (no `Assign` anywhere) is enough to rebuild the block.
  test('a single non-assign statement round trips as a Block', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Block', ['Add', 's', 1]] as any);
    expect(e.latex).toMatchInlineSnapshot(`s+1;`);
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('operand position (wrapArguments)', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Repeat', single, 3] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\mathrm{Repeat}(\\left(s\\coloneq2;\\right), 3)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
    expect(ce.parse(e.latex).evaluate().json).toEqual(['List', 2, 2, 2]);
  });

  test('Loop body, `for … do` spelling', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Loop',
      single,
      ['Element', 'i', ['Range', 1, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }\\left(s\\coloneq2;\\right)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('Loop body, \\operatorname{Loop}(...) fallback spelling', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Loop',
      single,
      ['Element', 'k', ['List', 1, 2, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\operatorname{Loop}(\\left(s\\coloneq2;\\right), k\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack)`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('Comprehension body', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Comprehension',
      single,
      ['Element', 'n', ['Range', 1, 3]],
    ] as any);
    expect(e.latex).toMatchInlineSnapshot(
      `\\left[\\left(s\\coloneq2;\\right) \\operatorname{for} n = 1..3\\right]`
    );
    expect(ce.parse(e.latex).json).toEqual(e.json);
    // A `Comprehension` is a LAZY collection — it stays itself under
    // `evaluate()`, so compare the materialized elements.
    expect(ce.parse(e.latex).evaluate().toString()).toEqual('[2,2,2]');
  });

  // The point of keeping the block: its statements run in a LOCAL scope, so a
  // block-local assignment must not reach the enclosing scope — before OR
  // after the round trip. The bare-`Assign` serialization DID leak (last
  // assertion), which is the defect the trailing `;` fixes.
  test('block-local assignment does not leak, before or after the round trip', () => {
    const original = new ComputeEngine();
    original.assign('s', 99);
    expect(original.box(single).evaluate().json).toEqual(2);
    expect(original.box('s').evaluate().json).toEqual(99);

    const reparsed = new ComputeEngine();
    reparsed.assign('s', 99);
    const back = reparsed.parse(new ComputeEngine().box(single).latex);
    expect(back.evaluate().json).toEqual(2);
    expect(reparsed.box('s').evaluate().json).toEqual(99);

    // Witness: without the block, the assignment leaks.
    const leaky = new ComputeEngine();
    leaky.assign('s', 99);
    leaky.parse('s\\coloneq2').evaluate();
    expect(leaky.box('s').evaluate().json).toEqual(2);
  });

  // MULTI-statement blocks already round-trip from the SEPARATING `;`, so
  // they take no trailing marker — their LaTeX is byte-identical to before.
  test('multi-statement blocks are unchanged (no trailing `;`)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(multi).latex).toMatchInlineSnapshot(`s\\coloneq2; s+1`);
    expect(ce.parse(ce.box(multi).latex).json).toEqual(ce.box(multi).json);
    expect(
      ce.box(['Repeat', multi, 3] as any).latex
    ).toMatchInlineSnapshot(
      `\\mathrm{Repeat}(\\left(s\\coloneq2; s+1\\right), 3)`
    );
  });

  // Edge probes, pinned as measured.
  test('edge: a trailing `;` after SEVERAL elements stays a sequence', () => {
    const ce = new ComputeEngine();
    // Only the trailing empty segment is dropped; the marker promotes to a
    // block only when it follows a LONE statement.
    expect(ce.parse('(1;2;)').json).toEqual(['Tuple', 1, 2]);
    // Interior empties are untouched.
    expect(ce.parse('(a;;b)').json).toEqual(['Tuple', 'a', 'b']);
  });

  test('edge: nested single-statement blocks', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('((s\\coloneq2;);)');
    expect(e.json).toEqual([
      'Block',
      ['Block', ['Declare', 's'], ['Assign', 's', 2]],
    ]);
    expect(e.evaluate().json).toEqual(2);
  });

  // The marker is a SPELLING fact — an EMPTY token segment between the last
  // `;` and the closing delimiter — never the parsed value being the symbol
  // `Nothing`. Inferring it from the value ate an AUTHORED trailing
  // `\mathrm{Nothing}`, changing the block's value from `Nothing` to its
  // second-to-last statement.
  test('an AUTHORED trailing `Nothing` is a statement, not the marker', () => {
    const ce = new ComputeEngine();
    // The raw parse keeps it (it used to be popped as the marker).
    expect(ce.parse('(a;\\mathrm{Nothing})', { canonical: false }).json).toEqual(
      ['Delimiter', ['Sequence', 'a', 'Nothing'], "'(;)'"]
    );
    // No `Assign` and no marker, so this is a `;` sequence, not a block —
    // exactly as it parsed before the marker existed.
    expect(ce.parse('(a;\\mathrm{Nothing})').json).toEqual(['Tuple', 'a']);
  });

  test('an authored trailing `Nothing` keeps a block VALUED `Nothing`', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(s\\coloneq2;\\mathrm{Nothing})');
    expect(e.json).toEqual([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 2],
      'Nothing',
    ]);
    expect(e.evaluate().json).toEqual('Nothing');

    // The synthetic marker is still dropped: same block, value `2`.
    const marked = ce.parse('(s\\coloneq2;)');
    expect(marked.json).toEqual(['Block', ['Declare', 's'], ['Assign', 's', 2]]);
    expect(marked.evaluate().json).toEqual(2);
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
