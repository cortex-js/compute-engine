import { ComputeEngine } from '../../../src/compute-engine';

/**
 * A multi-statement `Block` with NO `Assign` round-trips through LaTeX spelled
 * as a ONE-COLUMN `cases` environment (USER RULING 2026-08-12).
 *
 * Before the ruling, such a block serialized as the bare `;`-separated list
 * `s+1; s+2`, which re-parses as `Tuple(s+1, s+2)` — the `;` parser builds a
 * `Block` only when one of the elements is an `Assign` — so the value changed
 * from the block's LAST statement to a 2-tuple.
 *
 * The one-column `cases` spelling is free: `Which` always serializes two
 * columns (`\begin{cases}x&0\lt x\\-x&\top\end{cases}`), so nothing else emits
 * it, and its only previous *reading* was a degenerate `Which` in which every
 * row's condition was `True` — i.e. every row after the first was a dead
 * branch (`Which` takes the first true condition).
 *
 * Deliberately NOT repurposed, and pinned below:
 *  - a single single-column row (`Which(True, e)` — value-equivalent either
 *    way, and a plausible authored spelling);
 *  - any environment with a `&` in ANY row, including the mixed pattern where
 *    a bare "otherwise" row sits among two-column rows;
 *  - all-equation/inequality single-column rows (a *system*, parsed to `List`
 *    — the `Solve` convention, which takes precedence).
 *
 * Because that last exclusion is load-bearing, the SERIALIZER diverts the
 * blocks it would swallow: a multi-statement, `Assign`-free `Block` whose
 * every statement is an equation or inequality is spelled with the explicit
 * `\operatorname{Block}(x=1, y=2)` call form instead (USER RULING
 * 2026-08-12). See the last describe below.
 *
 * A fresh engine is used per probe: CE narrows free-symbol types from usage
 * and that inference persists in an engine.
 */

const ce = () => new ComputeEngine();
const json = (s: string) => ce().parse(s).json;

/** Canonical-JSON round trip: box → toLatex → parse → canonical json. */
function roundtrip(mathjson: any): {
  latex: string;
  before: string;
  after: string;
} {
  const e = ce().box(mathjson);
  const latex = e.toLatex();
  const back = ce().parse(latex);
  return {
    latex,
    before: JSON.stringify(e.json),
    after: JSON.stringify(back.json),
  };
}

describe('Block → one-column `cases` (serializer)', () => {
  test('the witness: Block(s+1, s+2) round-trips (was Tuple, value changed)', () => {
    const r = roundtrip(['Block', ['Add', 's', 1], ['Add', 's', 2]]);
    expect(r.latex).toBe('\\begin{cases}s+1\\\\s+2\\end{cases}');
    expect(r.after).toBe(r.before);

    // ... and the VALUE survives (it used to become the tuple `(11, 12)`).
    const e = ce();
    e.assign('s', 10);
    expect(e.box(['Block', ['Add', 's', 1], ['Add', 's', 2]]).evaluate().json)
      .toMatchInlineSnapshot(`12`);
    expect(e.parse(r.latex).evaluate().json).toMatchInlineSnapshot(`12`);
  });

  test('three statements', () => {
    const r = roundtrip([
      'Block',
      ['Add', 's', 1],
      ['Add', 's', 2],
      ['Add', 's', 3],
    ]);
    expect(r.latex).toBe('\\begin{cases}s+1\\\\s+2\\\\s+3\\end{cases}');
    expect(r.after).toBe(r.before);
  });

  test('statements that are function calls', () => {
    const r = roundtrip([
      'Block',
      ['Sin', 'x'],
      ['Cos', 'x'],
      ['Add', 'x', 1],
    ]);
    expect(r.latex).toBe(
      '\\begin{cases}\\sin(x)\\\\\\cos(x)\\\\x+1\\end{cases}'
    );
    expect(r.after).toBe(r.before);
  });

  test('a nested `Which` (nested cases environment) round-trips', () => {
    const r = roundtrip([
      'Block',
      ['Add', 'x', 1],
      ['Which', ['Greater', 'x', 0], 'x', 'True', ['Negate', 'x']],
    ]);
    expect(r.latex).toBe(
      '\\begin{cases}x+1\\\\\\begin{cases}x&0\\lt x\\\\-x&\\top\\end{cases}\\end{cases}'
    );
    expect(r.after).toBe(r.before);
  });

  test('a nested Block WITH an Assign (a `;` list inside a cases row)', () => {
    const r = roundtrip([
      'Block',
      ['Block', ['Assign', 't', 2], ['Add', 't', 1]],
      ['Add', 'u', 1],
    ]);
    expect(r.latex).toBe('\\begin{cases}t\\coloneq2; t+1\\\\u+1\\end{cases}');
    // The inner block re-parses with the `Declare` the `Assign` implies —
    // pre-existing, value-faithful behavior of the `Assign` → `Block` rule.
    expect(r.after).toBe(
      JSON.stringify([
        'Block',
        ['Block', ['Declare', 't'], ['Assign', 't', 2], ['Add', 't', 1]],
        ['Add', 'u', 1],
      ])
    );
  });
});

describe('Block spellings left byte-identical', () => {
  test('multi-statement WITH an Assign keeps the `; ` list', () => {
    const r = roundtrip(['Block', ['Assign', 's', 2], ['Add', 's', 1]]);
    expect(r.latex).toBe('s\\coloneq2; s+1');
    // Faithful (modulo the implied `Declare`), so the `; ` spelling stays.
    expect(r.after).toBe(
      JSON.stringify([
        'Block',
        ['Declare', 's'],
        ['Assign', 's', 2],
        ['Add', 's', 1],
      ])
    );
  });

  test('a single emitted statement keeps the trailing `;`', () => {
    const r = roundtrip(['Block', ['Add', 's', 1]]);
    expect(r.latex).toBe('s+1;');
    expect(r.after).toBe(r.before);
  });

  test('`Declare` + `Assign` is ONE emitted statement → trailing `;`', () => {
    const r = roundtrip(['Block', ['Declare', 's', "'number'"], ['Assign', 's', 2]]);
    expect(r.latex).toBe('s\\coloneq2;');
  });

  test('`Which` still serializes two columns', () => {
    const r = roundtrip([
      'Which',
      ['Greater', 'x', 0],
      'x',
      'True',
      ['Negate', 'x'],
    ]);
    expect(r.latex).toBe('\\begin{cases}x&0\\lt x\\\\-x&\\top\\end{cases}');
    expect(r.after).toBe(r.before);
  });
});

describe('cases parser', () => {
  test('the repurposed degenerate: multi-row single column → Block', () => {
    // Previously `["Which","True",["Add","x",1],"True",["Subtract","x",1]]` —
    // a dead-branch `Which` (row 2 unreachable).
    expect(json('\\begin{cases} x+1 \\\\ x-1 \\end{cases}')).toEqual([
      'Block',
      ['Add', 'x', 1],
      ['Add', 'x', -1],
    ]);
  });

  test('ONE single-column row keeps its `Which(True, e)` reading', () => {
    expect(json('\\begin{cases} x+1 \\end{cases}')).toEqual([
      'Which',
      'True',
      ['Add', 'x', 1],
    ]);
  });

  test('two-column cases → Which (unchanged)', () => {
    expect(
      json('\\begin{cases} x & x>0 \\\\ -x & \\text{otherwise} \\end{cases}')
    ).toEqual(['Which', ['Less', 0, 'x'], 'x', 'True', ['Negate', 'x']]);
  });

  test('MIXED: a bare row among two-column rows → Which (unchanged)', () => {
    // The bare row is the default branch: its condition becomes `True`.
    expect(json('\\begin{cases} x & x>0 \\\\ -x \\end{cases}')).toEqual([
      'Which',
      ['Less', 0, 'x'],
      'x',
      'True',
      ['Negate', 'x'],
    ]);
  });

  test('a system of equations stays a `List` (Solve convention)', () => {
    expect(json('\\begin{cases} x+y=1 \\\\ x-y=2 \\end{cases}')).toEqual([
      'List',
      ['Equal', ['Add', 'x', 'y'], 1],
      ['Equal', ['Add', 'x', ['Negate', 'y']], 2],
    ]);
  });

  test('a system of inequalities stays a `List`', () => {
    expect(json('\\begin{cases} x>0 \\\\ y>0 \\end{cases}')).toEqual([
      'List',
      ['Less', 0, 'x'],
      ['Less', 0, 'y'],
    ]);
  });
});

describe('fence interplay — the cases block in operand/body position', () => {
  // A `Block` operand that serializes as a `cases` environment is
  // SELF-delimiting — `\begin{…}\end{…}` cannot leak into what follows — so
  // `wrapArguments`/the Loop and Comprehension body serializers emit it
  // UNFENCED. Only the `; `-spelled Block forms still take the
  // `\left(…\right)` fence (see the `;`-block operand test below). A fenced
  // cases block remains parseable (last test in this describe), so authored
  // parens stay harmless.
  test('operand position: Repeat(Block(…), 3)', () => {
    const r = roundtrip([
      'Repeat',
      ['Block', ['Add', 's', 1], ['Add', 's', 2]],
      3,
    ]);
    expect(r.latex).toBe(
      '\\mathrm{Repeat}(\\begin{cases}s+1\\\\s+2\\end{cases}, 3)'
    );
    expect(r.after).toBe(r.before);
  });

  test('Loop body position', () => {
    const r = roundtrip([
      'Loop',
      ['Block', ['Add', 's', 1], ['Add', 's', 2]],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(r.latex).toBe(
      '\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }\\begin{cases}s+1\\\\s+2\\end{cases}'
    );
    expect(r.after).toBe(r.before);
  });

  test('Comprehension body position', () => {
    const r = roundtrip([
      'Comprehension',
      ['Block', ['Add', 'n', 1], ['Add', 'n', 2]],
      ['Element', 'n', ['Range', 1, 3]],
    ]);
    expect(r.latex).toBe(
      '\\left[\\begin{cases}n+1\\\\n+2\\end{cases} \\operatorname{for} n = 1..3\\right]'
    );
    expect(r.after).toBe(r.before);
  });

  test('a `;`-list that STARTS and ENDS like a cases environment is still fenced', () => {
    // `Block(Block(a…), Assign(q, Block(c…)))` serializes as
    // `\begin{cases}…\end{cases}; q\coloneq\begin{cases}…\end{cases}` — a
    // prefix/suffix test would call that self-delimiting and skip the fence,
    // letting the `;` swallow the following operand (`, 3`). The
    // environment-depth walk in `isSelfDelimitingBlockLatex` catches it.
    const r = roundtrip([
      'Repeat',
      [
        'Block',
        ['Block', ['Add', 'a', 1], ['Add', 'a', 2]],
        ['Assign', 'q', ['Block', ['Add', 'c', 1], ['Add', 'c', 2]]],
      ],
      3,
    ]);
    expect(r.latex.startsWith('\\mathrm{Repeat}(\\left(')).toBe(true);
    // The reparse keeps `3` as Repeat's second operand — nothing swallowed.
    expect(JSON.parse(r.after)[0]).toBe('Repeat');
    expect(JSON.parse(r.after).length).toBe(3);
  });

  test('a `;`-spelled Block operand still takes the paren fence', () => {
    const r = roundtrip([
      'Repeat',
      ['Block', ['Declare', 'q'], ['Assign', 'q', 2], ['Add', 'q', 1]],
      3,
    ]);
    expect(r.latex).toBe(
      '\\mathrm{Repeat}(\\left(q\\coloneq2; q+1\\right), 3)'
    );
    expect(r.after).toBe(r.before);
  });

  test('a bare fenced cases block parses as Delimiter(Block)', () => {
    expect(
      ce().parse('\\left(\\begin{cases} x+1 \\\\ x-1 \\end{cases}\\right)', {
        canonical: false,
      }).json
    ).toEqual(['Delimiter', ['Block', ['Add', 'x', 1], ['Subtract', 'x', 1]]]);
  });
});

describe('fence skip requires the WHOLE string to be the environment', () => {
  // The self-delimiting test above must match the whole serialized string,
  // not just its start. Two shapes START with `\begin{cases}` and still
  // trail unfenced syntax:
  //
  //  - `Block(Block(a, b))`: the outer block has ONE emitted statement (the
  //    inner, `cases`-spelled block), so the single-statement rule appends
  //    the trailing `;` marker → `\begin{cases}…\end{cases};`
  //  - `Block(Block(a, b), q≔2)`: an `Assign` sibling keeps the `; ` list →
  //    `\begin{cases}…\end{cases}; q≔2`
  //
  // A `startsWith`-only test skipped the fence for both. The comprehension
  // witness then serialized to
  // `\left[\begin{cases}…\end{cases}; \operatorname{for} …\right]`, which
  // re-parses as a plain `List` — a VALUE-CHANGING round trip.
  const inner = ['Block', ['Add', 's', 1], ['Add', 's', 2]] as any;
  const nested = ['Block', inner] as any;
  const mixed = ['Block', inner, ['Assign', 'q', 2]] as any;

  // The `; `-spelled mixed block re-parses with the `Declare` its `Assign`
  // implies — pre-existing, value-faithful (see the `; ` list tests above).
  const withDeclare = [
    'Block',
    inner,
    ['Declare', 'q'],
    ['Assign', 'q', 2],
  ] as any;

  test('nested Block-in-Block at TOP level (no fence needed, no leak)', () => {
    const r = roundtrip(nested);
    expect(r.latex).toBe('\\begin{cases}s+1\\\\s+2\\end{cases};');
    expect(r.after).toBe(r.before);
  });

  test('the witness: nested Block as a Comprehension body', () => {
    const r = roundtrip([
      'Comprehension',
      nested,
      ['Element', 'n', ['Range', 1, 3]],
    ]);
    expect(r.latex).toBe(
      '\\left[\\left(\\begin{cases}s+1\\\\s+2\\end{cases};\\right) \\operatorname{for} n = 1..3\\right]'
    );
    expect(r.after).toBe(r.before);

    // Unfenced, this came back as a `List` of two lists.
    expect(ce().parse(r.latex).operator).toBe('Comprehension');
  });

  test('nested Block as a Repeat operand (wrapArguments)', () => {
    const r = roundtrip(['Repeat', nested, 3]);
    expect(r.latex).toBe(
      '\\mathrm{Repeat}(\\left(\\begin{cases}s+1\\\\s+2\\end{cases};\\right), 3)'
    );
    expect(r.after).toBe(r.before);
  });

  test('nested Block as a Loop body, `for … do` spelling', () => {
    const r = roundtrip(['Loop', nested, ['Element', 'i', ['Range', 1, 3]]]);
    expect(r.latex).toBe(
      '\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }\\left(\\begin{cases}s+1\\\\s+2\\end{cases};\\right)'
    );
    expect(r.after).toBe(r.before);
  });

  test('nested Block as a Loop body, `\\operatorname{Loop}(…)` spelling', () => {
    const r = roundtrip(['Loop', nested, ['Element', 'k', ['List', 1, 2, 3]]]);
    expect(r.latex).toBe(
      '\\operatorname{Loop}(\\left(\\begin{cases}s+1\\\\s+2\\end{cases};\\right), k\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack)'
    );
    expect(r.after).toBe(r.before);
  });

  test('the mixed sibling: cases block + an Assign statement', () => {
    // `startsWith` true, `endsWith` false — at top level nothing follows, so
    // the `; ` list is already faithful.
    const r = roundtrip(mixed);
    expect(r.latex).toBe('\\begin{cases}s+1\\\\s+2\\end{cases}; q\\coloneq2');
    expect(r.after).toBe(JSON.stringify(ce().box(withDeclare).json));
  });

  test('the mixed sibling in operand and body position IS fenced', () => {
    const r1 = roundtrip(['Repeat', mixed, 3]);
    expect(r1.latex).toBe(
      '\\mathrm{Repeat}(\\left(\\begin{cases}s+1\\\\s+2\\end{cases}; q\\coloneq2\\right), 3)'
    );
    expect(r1.after).toBe(JSON.stringify(ce().box(['Repeat', withDeclare, 3]).json));

    const r2 = roundtrip([
      'Comprehension',
      mixed,
      ['Element', 'n', ['Range', 1, 3]],
    ]);
    expect(r2.latex).toBe(
      '\\left[\\left(\\begin{cases}s+1\\\\s+2\\end{cases}; q\\coloneq2\\right) \\operatorname{for} n = 1..3\\right]'
    );
    expect(r2.after).toBe(
      JSON.stringify(
        ce().box([
          'Comprehension',
          withDeclare,
          ['Element', 'n', ['Range', 1, 3]],
        ]).json
      )
    );
  });
});

describe('all-relation Block → `\\operatorname{Block}(…)` (USER RULING 2026-08-12)', () => {
  // The one-column `cases` spelling collides with the system-of-equations
  // reading: branch 1 of `parseCasesEnvironment` (the `Solve` convention)
  // runs FIRST and captures any single-column environment whose every row is
  // an equation or inequality, so `Block(x=1, y=2)` came back as
  // `List(x=1, y=2)`. The Solve convention outranks, so such blocks divert to
  // the explicit function-call spelling, which the default function parser
  // already reads back as a `Block`.
  //
  // The diversion predicate is the exact DUAL of the system branch's row test
  // (`isEquationOperator || isInequalityOperator` on every statement), so the
  // ONLY shapes that divert are the ones that would be mis-read.
  const B2 = ['Block', ['Equal', 'x', 1], ['Equal', 'y', 2]] as any;

  test('the witness: Block(x=1, y=2) at top level (was `List`)', () => {
    const r = roundtrip(B2);
    expect(r.latex).toBe('\\operatorname{Block}(x=1, y=2)');
    expect(r.after).toBe(r.before);
    // ...and it is a Block, not a List/Tuple.
    expect(ce().parse(r.latex).operator).toBe('Block');
  });

  test('the call spelling parses back to a Block (parser side)', () => {
    expect(json('\\operatorname{Block}(x=1, y=2)')).toEqual([
      'Block',
      ['Equal', 'x', 1],
      ['Equal', 'y', 2],
    ]);
  });

  test('inequalities and NotEqual divert too', () => {
    const r = roundtrip([
      'Block',
      ['Less', 'x', 1],
      ['NotEqual', 'y', 2],
      ['GreaterEqual', 'z', 3],
    ]);
    // (canonicalization flips `z ≥ 3` to `3 ≤ z`)
    expect(r.latex).toBe('\\operatorname{Block}(x\\lt1, y\\ne2, 3\\le z)');
    expect(r.after).toBe(r.before);
    expect(ce().parse(r.latex).operator).toBe('Block');
  });

  test('`Declare` statements do not count: Declare + 2 relations diverts', () => {
    // `Declare` emits nothing, so the EMITTED statements are the two
    // relations — the same shape the system branch would swallow.
    const r = roundtrip(['Block', ['Declare', 'x'], ['Equal', 'x', 1], ['Equal', 'y', 2]]);
    expect(r.latex).toBe('\\operatorname{Block}(x=1, y=2)');
    expect(ce().parse(r.latex).operator).toBe('Block');
  });

  //
  // Controls: everything the system branch does NOT capture keeps `cases`.
  //
  test('CONTROL (Solve convention): an authored system still parses to `List`', () => {
    expect(json('\\begin{cases} x+y=1 \\\\ x-y=2 \\end{cases}')).toEqual([
      'List',
      ['Equal', ['Add', 'x', 'y'], 1],
      ['Equal', ['Add', 'x', ['Negate', 'y']], 2],
    ]);
  });

  test('CONTROL (mixed): one relation + one non-relation keeps `cases`', () => {
    // The system branch's `every` fails, so the environment falls through to
    // the `Block` branch and round-trips faithfully — no diversion needed.
    const r = roundtrip(['Block', ['Equal', 'x', 1], ['Add', 'y', 2]]);
    expect(r.latex).toBe('\\begin{cases}x=1\\\\y+2\\end{cases}');
    expect(r.after).toBe(r.before);
    expect(ce().parse(r.latex).operator).toBe('Block');
  });

  test('CONTROL (no relations): keeps `cases`', () => {
    const r = roundtrip(['Block', ['Add', 's', 1], ['Add', 's', 2]]);
    expect(r.latex).toBe('\\begin{cases}s+1\\\\s+2\\end{cases}');
    expect(r.after).toBe(r.before);
  });

  test('CONTROL (single statement): one relation keeps the trailing `;`', () => {
    // Not a diversion case: the single-statement rule runs first, and
    // `x=1;` already re-parses as a `Block`.
    const r = roundtrip(['Block', ['Equal', 'x', 1]]);
    expect(r.latex).toBe('x=1;');
    expect(r.after).toBe(r.before);
    expect(ce().parse(r.latex).operator).toBe('Block');
  });

  test('CONTROL (with an Assign): relations + an Assign keep the `; ` list', () => {
    const r = roundtrip(['Block', ['Assign', 'q', 2], ['Equal', 'x', 1]]);
    expect(r.latex).toBe('q\\coloneq2; x=1');
    expect(r.after).toBe(
      JSON.stringify(
        ce().box(['Block', ['Declare', 'q'], ['Assign', 'q', 2], ['Equal', 'x', 1]])
          .json
      )
    );
  });

  //
  // Fence interplay: the call form is self-delimiting, so it takes no fence.
  //
  test('operand position: Repeat(Block(x=1, y=2), 3) — unfenced', () => {
    const r = roundtrip(['Repeat', B2, 3]);
    expect(r.latex).toBe('\\mathrm{Repeat}(\\operatorname{Block}(x=1, y=2), 3)');
    expect(r.after).toBe(r.before);
    expect(ce().parse(r.latex).op1.operator).toBe('Block');
  });

  test('Loop body position, `for … do` spelling — unfenced', () => {
    const r = roundtrip(['Loop', B2, ['Element', 'i', ['Range', 1, 3]]]);
    expect(r.latex).toBe(
      '\\text{for }i\\text{ from }1\\text{ to }3\\text{ do }\\operatorname{Block}(x=1, y=2)'
    );
    expect(r.after).toBe(r.before);
  });

  test('Loop body position, `\\operatorname{Loop}(…)` spelling — unfenced', () => {
    const r = roundtrip(['Loop', B2, ['Element', 'k', ['List', 1, 2, 3]]]);
    expect(r.latex).toBe(
      '\\operatorname{Loop}(\\operatorname{Block}(x=1, y=2), k\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack)'
    );
    expect(r.after).toBe(r.before);
  });

  test('Comprehension body position — unfenced', () => {
    const r = roundtrip(['Comprehension', B2, ['Element', 'n', ['Range', 1, 3]]]);
    expect(r.latex).toBe(
      '\\left[\\operatorname{Block}(x=1, y=2) \\operatorname{for} n = 1..3\\right]'
    );
    expect(r.after).toBe(r.before);
    expect(ce().parse(r.latex).operator).toBe('Comprehension');
  });

  //
  // The self-delimiting test must match the WHOLE string, exactly as for the
  // `cases` prefix. Two shapes start with `\operatorname{Block}(` and still
  // trail unfenced syntax; one of them also ENDS with `)`, so a
  // `startsWith`+`endsWith(')')` test would wrongly skip the fence.
  //
  test('nested call-spelled Block, single statement → fenced', () => {
    const r = roundtrip(['Repeat', ['Block', B2], 3]);
    expect(r.latex).toBe(
      '\\mathrm{Repeat}(\\left(\\operatorname{Block}(x=1, y=2);\\right), 3)'
    );
    expect(r.after).toBe(r.before);
  });

  test('the `endsWith(")")` trap: call-spelled Block + an Assign ending in `)`', () => {
    // `\operatorname{Block}(x=1, y=2); q≔\sin(2)` starts with the prefix AND
    // ends with `)`, yet the paren the prefix opened closed long before.
    const mixed = ['Block', B2, ['Assign', 'q', ['Sin', 2]]] as any;
    const withDeclare = [
      'Block',
      B2,
      ['Declare', 'q'],
      ['Assign', 'q', ['Sin', 2]],
    ] as any;
    const r = roundtrip(['Repeat', mixed, 3]);
    expect(r.latex).toBe(
      '\\mathrm{Repeat}(\\left(\\operatorname{Block}(x=1, y=2); q\\coloneq\\sin(2)\\right), 3)'
    );
    expect(r.after).toBe(
      JSON.stringify(ce().box(['Repeat', withDeclare, 3]).json)
    );
  });
});
