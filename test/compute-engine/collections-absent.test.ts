import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The five rules for `NaN`, `Missing` and `Undefined` in collection operators
// (user decisions of 2026-09-26, recorded in
// `docs/plans/2026-09-26-absent-values-in-collection-operators.md` and in
// `docs/ERROR-MODEL.md` §3, "Absent values in collection operators"):
//
// - A. Positional operators keep an absent cell in place.
// - B. Aggregates propagate: one absent cell makes the aggregate `NaN`.
// - C. Search is structural: a marker is found where the same marker sits.
// - D. Selection keeps only a decided `True`; `Any`/`All` are Kleene.
// - E. An absent collection makes the whole result absent.
//
// Each rule is probed on the box route and on the parse route, because a
// lazy operator with no `canonical` handler can behave differently on the
// two (`CLAUDE.md`, "Common API Traps").

const L = (...xs: unknown[]) => ['List', ...xs];
const gt0 = ['Function', ['Greater', 'x', 0], 'x'];
const gt2 = ['Function', ['Greater', 'x', 2], 'x'];
const isMissing = ['Function', ['IsMissing', 'x'], 'x'];

function value(json: unknown): string {
  return new ComputeEngine()
    .box(json as never)
    .evaluate()
    .toString();
}

function parsed(latex: string): string {
  return new ComputeEngine().parse(latex).evaluate().toString();
}

describe('Rule A: positional operators keep an absent cell', () => {
  test.each([
    [['Length', L(1, 'Missing', 3)], '3'],
    [['Length', L(1, 'NaN', 3)], '3'],
    [['Length', L(1, 'Undefined', 3)], '3'],
    [['Count', L(1, 'Missing', 3)], '3'],
    [['Join', L(1, 'Missing'), L(3)], '[1,"Missing",3]'],
    [['Join', L(1, 'NaN'), L(2)], '[1,NaN,2]'],
    [['Append', L(1), 'Missing'], '[1,"Missing"]'],
    [['Append', L(1), 'Undefined'], '[1,"Undefined"]'],
    [['Append', L(1), 'NaN'], '[1,NaN]'],
    [['Insert', L(1, 2), 2, 'Missing'], '[1,"Missing",2]'],
    [['Reverse', L(1, 'Missing')], '["Missing",1]'],
    [['Take', L(1, 'Missing', 3), 2], '[1,"Missing"]'],
    [['At', L(1, 'Missing', 3), 2], '"Missing"'],
    [['At', L(1, 'NaN', 3), 2], 'NaN'],
    [['Sort', L(3, 'Missing', 1)], '[1,3,"Missing"]'],
    [['Sort', L(3, 'NaN', 1)], '[1,3,NaN]'],
    [['Unique', L(1, 'Missing', 'Missing', 1)], '[1,"Missing"]'],
    [['Unique', L(1, 'NaN', 'NaN', 1)], '[1,NaN]'],
    // `Missing` and `Undefined` are different symbols under structural
    // identity, so deduplication keeps both.
    [['Unique', L('Missing', 'Undefined')], '["Missing","Undefined"]'],
    [['Tally', L(1, 'Missing', 'Missing')], '([1,"Missing"], [1,2])'],
    [['Zip', L(1, 'Missing'), L(3, 4)], '[(1, 3),("Missing", 4)]'],
    [
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], L(1, 'Missing', 3)],
      '[2,NaN,6]',
    ],
  ])('%j', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('the parse route', () => {
    expect(
      parsed('\\operatorname{Length}([1, \\operatorname{Missing}, 3])')
    ).toBe('3');
    expect(parsed('\\operatorname{Sort}([3, \\mathrm{NaN}, 1])')).toBe(
      '[1,3,NaN]'
    );
    expect(parsed('\\operatorname{Append}([1], \\operatorname{Missing})')).toBe(
      '[1,"Missing"]'
    );
  });

  test('a mapped absent cell widens the element type', () => {
    // The value holds `NaN`, so the type must admit it. Before, the ranged
    // fold typed `Map(x ↦ 2x, [1, Missing, 3])` as `list<integer<2..6>>`:
    // the absence absorption had no arm for a ranged numeric type and left
    // `integer<2..6>` as it was (`absorbNumericAbsence`,
    // `common/type/utils.ts`).
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Multiply', 2, 'x'], 'x'],
          L(1, 'Missing', 3),
        ])
        .type.toString()
    ).toBe('list<number>');
    ce.declare('q', 'integer<1..3> | missing');
    expect(ce.box(['Multiply', 2, 'q']).type.toString()).toBe('number');
    expect(ce.box(['Add', 'q', 1]).type.toString()).toBe('number');
    ce.declare('r', 'real<0..1> | missing');
    expect(ce.box(['Multiply', 2, 'r']).type.toString()).toBe('number');
  });
});

describe('Rule B: aggregates propagate an absent cell', () => {
  test.each([
    [['Sum', L(1, 'Missing', 3)], 'NaN'],
    [['Sum', L(1, 'NaN', 3)], 'NaN'],
    [['Sum', L(1, 'Undefined', 3)], 'NaN'],
    [['Product', L(1, 'Missing', 3)], 'NaN'],
    [['Mean', L(1, 'Missing', 3)], 'NaN'],
    [['Median', L(1, 'NaN', 3)], 'NaN'],
    [['Max', L(1, 'Missing', 3)], 'NaN'],
    [['Min', L(1, 'NaN', 3)], 'NaN'],
    [
      [
        'Reduce',
        L(1, 'Missing', 3),
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        0,
      ],
      'NaN',
    ],
    // The empty collection answers the identity, not a marker.
    [['Sum', L()], '0'],
    [['Product', L()], '1'],
    // `Nothing` is erased, not absent.
    [['Sum', L(1, 'Nothing', 3)], '4'],
  ])('%j', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('the parse route', () => {
    expect(parsed('\\operatorname{Sum}([1, \\operatorname{Missing}, 3])')).toBe(
      'NaN'
    );
    expect(parsed('\\operatorname{Max}([1, \\mathrm{NaN}, 3])')).toBe('NaN');
  });
});

describe('Rule C: search is structural', () => {
  test.each([
    [['IndexOf', L(1, 'NaN'), 'NaN'], '2'],
    [['IndexOf', L(1, 'Missing', 3), 'Missing'], '2'],
    [['IndexOf', L(1, 'Undefined', 3), 'Undefined'], '2'],
    [['IndexOf', L(1, 'Missing', 3), 3], '3'],
    [['IndexOf', L('Missing', 5), 5], '2'],
    [['IndexOf', L(1, 'Missing'), 5], '0'],
    [['IndexOf', L(1, 2), 'Missing'], '0'],
    [['IndexOf', L(1, 'NaN'), 'Missing'], '0'],
    [['IndexOf', L(1, 'Missing'), 'Undefined'], '0'],
    [['Contains', L(1, 'NaN'), 'NaN'], '"True"'],
    [['Contains', L(1, 'Missing'), 'Missing'], '"True"'],
    [['Contains', L(1, 'Missing'), 5], '"False"'],
    [['Contains', L('Missing', 5), 5], '"True"'],
    [['Contains', L(1, 2), 'NaN'], '"False"'],
    [['Count', L('NaN', 1, 'NaN'), 'NaN'], '2'],
    [['Count', L('Missing', 'Missing'), 'Missing'], '2'],
    [['Element', 'NaN', L(1, 'NaN')], '"True"'],
    [['Element', 'Missing', L(1, 'Missing')], '"True"'],
    [['Element', 3, L(1, 'Missing')], '"False"'],
    [['NotElement', 'NaN', L(1, 'NaN')], '"False"'],
    // A search never answers a marker for a marker CELL: the else branch of
    // a `Which` on a not-found search is taken.
    [['Which', ['Contains', L(1, 'Missing'), 5], 'a', 'True', 'b'], 'b'],
  ])('%j', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('the parse route', () => {
    expect(
      parsed('\\operatorname{IndexOf}([1, \\mathrm{NaN}], \\mathrm{NaN})')
    ).toBe('2');
    expect(
      parsed(
        '\\operatorname{Contains}([1, \\operatorname{Missing}], \\operatorname{Missing})'
      )
    ).toBe('"True"');
    expect(
      parsed('\\operatorname{Contains}([1, \\operatorname{Missing}], 5)')
    ).toBe('"False"');
    expect(
      parsed('\\operatorname{Element}(\\mathrm{NaN}, [1, \\mathrm{NaN}])')
    ).toBe('"True"');
  });

  test('the markers are found with a predicate too', () => {
    expect(value(['Position', L(1, 'Missing', 'NaN', 3), isMissing])).toBe(
      '[2,3]'
    );
    expect(value(['Count', L(1, 'Missing', 'NaN', 3), isMissing])).toBe('2');
    expect(value(['Filter', L(1, 'Missing', 3), isMissing])).toBe(
      '["Missing"]'
    );
  });

  test('membership and comparison are different questions', () => {
    // `NaN = NaN` is IEEE `False`; `NaN ∈ [NaN]` is structural `True`.
    expect(value(['Equal', 'NaN', 'NaN'])).toBe('"False"');
    expect(value(['Contains', L('NaN'), 'NaN'])).toBe('"True"');
    // `Missing = Missing` is Kleene `Missing`; `Missing ∈ [Missing]` is `True`.
    expect(value(['Equal', 'Missing', 'Missing'])).toBe('"Missing"');
    expect(value(['Contains', L('Missing'), 'Missing'])).toBe('"True"');
    // Whole-collection equality stays Kleene (ruling of 2026-09-21).
    expect(value(['Equal', L(1, 'Missing'), L(1, 5)])).toBe('"Missing"');
  });
});

describe('Rule D: selection keeps a decided True, quantifiers are Kleene', () => {
  test.each([
    // Selection: a `Missing` predicate answer is "not selected".
    [['Filter', L(1, 'Missing', 3), gt0], '[1,3]'],
    [['Filter', L(1, 'Undefined', 3), gt0], '[1,3]'],
    [['Filter', L(1, 'NaN', 3), gt0], '[1,3]'],
    [['Count', L(1, 'Missing', 3), gt0], '2'],
    [['Count', L(1, 'Undefined', 3), gt0], '2'],
    [['Count', L(1, 'NaN', 3), gt0], '2'],
    [['CountIf', L(1, 'Missing', 3), gt0], '2'],
    [['Position', L(1, 'Missing', 3), gt0], '[1,3]'],
    [['IndexWhere', L('Missing', 3), gt0], '2'],
    [['IndexWhere', L('Missing'), gt0], '0'],
    [['Find', L('Missing', 3), gt0], '3'],
    [['Find', L('Missing'), gt0], '"Nothing"'],
    [['Partition', L(1, 'Missing', -1), gt0], '[[1],["Missing",-1]]'],
    // Quantifiers: Kleene, the table of `Or` and `And`.
    [['Any', L(1, 'Missing', 3), gt2], '"True"'],
    [['Any', L(1, 'Missing'), gt2], '"Missing"'],
    [['Any', L('Undefined'), gt2], '"Missing"'],
    [['All', L(1, 'Missing', 3), gt0], '"Missing"'],
    [['All', L(1, 'Missing', -1), gt0], '"False"'],
    [['Any', L()], '"False"'],
    [['All', L()], '"True"'],
    // Without a predicate, the elements are the answers.
    [['Any', L('False', 'Missing')], '"Missing"'],
    [['Any', L('True', 'Missing')], '"True"'],
    [['All', L('True', 'Missing')], '"Missing"'],
    [['All', L('False', 'Missing')], '"False"'],
    // A `NaN` cell compares `False` by IEEE and never makes a quantifier
    // undecided.
    [['Any', L(1, 'NaN'), gt2], '"False"'],
    [['All', L(1, 'NaN', 3), gt0], '"False"'],
    // A predicate that answers `True` on the marker selects it.
    [['Any', L(1, 'Missing'), isMissing], '"True"'],
    [['All', L('Missing', 'Undefined'), isMissing], '"True"'],
  ])('%j', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('the parse route', () => {
    expect(
      parsed(
        '\\operatorname{Count}([1, \\operatorname{Missing}, 3], x \\mapsto x > 0)'
      )
    ).toBe('2');
    expect(
      parsed(
        '\\operatorname{Filter}([1, \\operatorname{Missing}, 3], x \\mapsto x > 0)'
      )
    ).toBe('[1,3]');
    expect(
      parsed(
        '\\operatorname{Any}([1, \\operatorname{Missing}], x \\mapsto x > 2)'
      )
    ).toBe('"Missing"');
    expect(
      parsed(
        '\\operatorname{All}([1, \\operatorname{Missing}, 3], x \\mapsto x > 0)'
      )
    ).toBe('"Missing"');
  });

  test('a symbolic predicate answer still keeps the quantifier inert', () => {
    // Inert outranks `Missing`: evidence may still arrive for `n`.
    const ce = new ComputeEngine();
    const e = ce.box([
      'Any',
      L(1, 'Missing'),
      ['Function', ['Greater', 'x', 'n'], 'x'],
    ]);
    expect(e.evaluate().toString()).toBe('Any([1,"Missing"], (x) => n < x)');
    ce.assign('n', 0);
    expect(e.evaluate().toString()).toBe('"True"');
    ce.assign('n', 5);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('a genuine non-boolean predicate is still rejected', () => {
    // The compatibility gate refuses it at boxing; only an absent answer is
    // read as "not selected".
    const e = new ComputeEngine()
      .box(['CountIf', L(1, 2), ['Function', ['Add', 'x', 1], 'x']])
      .evaluate();
    expect(e.isValid).toBe(false);
  });
});

describe('Rule E: an absent collection makes the result absent', () => {
  test.each([
    [['Length', 'Missing'], 'NaN'],
    [['Length', 'Undefined'], 'NaN'],
    [['Count', 'Missing'], 'NaN'],
    [['Sum', 'Missing'], 'NaN'],
    [['Reverse', 'Missing'], '"Missing"'],
    [['First', 'Missing'], '"Missing"'],
    [['Join', L(1), 'Missing'], '"Missing"'],
    [['Join', L(1), 'Undefined'], '"Missing"'],
    [['Contains', 'Missing', 3], '"Missing"'],
    [['IndexOf', 'Missing', 3], 'NaN'],
    [['Element', 3, 'Missing'], '"Missing"'],
    [['Filter', 'Missing', gt0], '"Missing"'],
    [['Any', 'Missing', gt0], '"Missing"'],
    [['All', 'Missing', gt0], '"Missing"'],
    // `NaN` in a collection slot is a number, not an absent collection.
    [['Join', L(1), 'NaN'], '[1,NaN]'],
  ])('%j', (json, expected) => {
    expect(value(json)).toBe(expected);
  });

  test('NaN is not a collection', () => {
    const e = new ComputeEngine().box(['Length', 'NaN']).evaluate();
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
  });
});

describe('compiled to JavaScript', () => {
  const ce = new ComputeEngine();
  const run = (json: unknown): unknown => {
    const r = compile(ce.box(json as never), { to: 'javascript' } as never);
    expect(r.success).toBe(true);
    return r.run!({} as never);
  };
  const refused = (json: unknown): boolean => {
    try {
      const r = compile(ce.box(json as never), {
        to: 'javascript',
        fallback: false,
      } as never);
      return r.success === false;
    } catch {
      return true;
    }
  };

  test('search (rule C)', () => {
    expect(run(['IndexOf', L(1, 'NaN'), 'NaN'])).toBe(2);
    expect(run(['Contains', L(1, 'NaN'), 'NaN'])).toBe(true);
    expect(run(['Element', 'NaN', L(1, 'NaN')])).toBe(true);
    expect(run(['IndexOf', L(1, 'NaN'), 'Missing'])).toBe(0);
    expect(run(['IndexOf', L(1, 2), 'Undefined'])).toBe(0);
    // A written `Missing` and a written `Undefined` both lower to
    // `undefined`, while the interpreter keeps them apart: a search for
    // either in a list that may hold an absent cell is not compiled.
    expect(refused(['IndexOf', L(1, 'Missing'), 'Missing'])).toBe(true);
    expect(refused(['IndexOf', L(1, 'Missing'), 'Undefined'])).toBe(true);
    expect(refused(['Contains', L(1, 'Undefined'), 'Missing'])).toBe(true);
    // `Contains` requires primitive elements on this target, and a
    // `missing` element arm is not one: it falls back to the interpreter.
    expect(refused(['Contains', L(1, 'Missing'), 5])).toBe(true);
    // A COMPUTED absence may be spelled `NaN` by this target, where the
    // interpreter keeps `Missing` apart from `NaN`: fail closed.
    expect(
      refused(['IndexOf', L(1, 'NaN'), ['Which', ['Less', 0, 't'], 1]])
    ).toBe(true);
  });

  test('selection (rule D)', () => {
    expect(run(['Filter', L(1, 'Missing', 3), gt0])).toEqual([1, 3]);
    expect(run(['CountIf', L(1, 'Missing', 3), gt0])).toBe(2);
    expect(run(['Position', L(1, 'Missing', 3), gt0])).toEqual([1, 3]);
    expect(run(['Filter', L(1, 'NaN', 3), gt0])).toEqual([1, 3]);
  });

  test('a quantifier over possibly absent elements fails closed', () => {
    // The compiled `some`/`every` cannot answer `Missing`.
    expect(refused(['Any', L(1, 'Missing'), gt2])).toBe(true);
    expect(refused(['All', L(1, 'Missing', 3), gt0])).toBe(true);
    // A predicate that may itself answer `Missing` for a present element is
    // refused too.
    expect(
      refused([
        'Any',
        L(1, 2),
        ['Function', ['If', ['Greater', 'x', 0], 'Missing', 'False'], 'x'],
      ])
    ).toBe(true);
    expect(
      refused([
        'All',
        L(1, 2),
        ['Function', ['If', ['Greater', 'x', 0], 'True', 'Missing'], 'x'],
      ])
    ).toBe(true);
    // A `NaN` element compares `False` on both routes, so it compiles.
    expect(run(['Any', L(1, 'NaN'), gt2])).toBe(false);
    expect(run(['All', L(1, 'NaN', 3), gt0])).toBe(false);
    expect(run(['Any', L(1, 'NaN', 3), gt2])).toBe(true);
  });
});
