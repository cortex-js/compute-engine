import { ComputeEngine } from '../../src/compute-engine';
import {
  broadcastCellType,
  broadcastElementType,
  widenNumericCellsWithNan,
} from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';

//
// THE ALIAS POLICY OF THE BROADCAST LIFT (ruled 2026-09-02).
//
// A transparent alias (`ce.declareType(name, body, { alias: true })`) IS its
// definition. A symbol declared with an alias of a collection must therefore
// be a broadcast trigger exactly like a symbol declared with the body, and
// the lifted result is typed by the STRUCTURE it builds — `list<number>`,
// `vector<3>`, `tuple<real, real>` — never by the operand's alias name. The
// evaluated value carries the structure and no name either.
//
// Before the fix the lift read the raw reference node at every seam: a
// valueless `L: nums` made `Sin(L)` type the scalar `number` while the same
// expression evaluated to a list once `L` held one; a valued `L` made
// `Multiply(2, L)` type `list<nums>` (a list of lists the value contradicts);
// and `0.5 · L` for an alias of `list<integer>` typed the alias although its
// cells are reals.
//
// Each row below is stated against the DIRECT spelling as its control (the
// symbol `D`, declared with the body): the alias must type exactly like the
// type it names, valueless and valued alike. The explicit strings pin the
// answer itself so the pair cannot drift together. A NOMINAL type keeps
// refusing at the operand gate (nominal-types design D3).
//

type Row = [label: string, expr: any, type: string];

function survey(body: string, value: any, rows: Row[]) {
  for (const valued of [false, true]) {
    describe(`alias of ${body}, ${valued ? 'valued' : 'valueless'}`, () => {
      const ce = new ComputeEngine();
      ce.declareType('al', body, { alias: true });
      ce.declare('L', 'al');
      ce.declare('D', body);
      ce.assign('f', ce.parse('x \\mapsto x^2'));
      if (valued) {
        ce.assign('L', value);
        ce.assign('D', value);
      }
      for (const [label, expr, type] of rows) {
        test(`${label} types \`${type}\``, () => {
          const alias = ce.box(expr);
          const control = ce.box(
            JSON.parse(JSON.stringify(expr).replace(/"L"/g, '"D"'))
          );
          expect(alias.errors).toHaveLength(0);
          expect(alias.type.toString()).toBe(type);
          expect(alias.type.toString()).toBe(control.type.toString());
        });
      }
      test('the symbol itself keeps the alias name', () => {
        expect(ce.box('L').type.toString()).toBe('al');
      });
    });
  }
}

survey(
  'list<number>',
  ['List', 3, 4, 5],
  [
    ['Sin(L)', ['Sin', 'L'], 'list<number>'],
    ['Mod(L, 2)', ['Mod', 'L', 2], 'list<nan | real>'],
    ['Multiply(2, L)', ['Multiply', 2, 'L'], 'list<number>'],
    ['Add([1,2], L)', ['Add', ['List', 1, 2], 'L'], 'list<number>'],
    ['Negate(L)', ['Negate', 'L'], 'list<number>'],
    ['f(L)', ['f', 'L'], 'list<number>'],
  ]
);

survey(
  'vector<3>',
  ['List', 3, 4, 5],
  [
    ['Sin(L)', ['Sin', 'L'], 'vector<3>'],
    ['Mod(L, 2)', ['Mod', 'L', 2], 'list<nan | real^3>'],
    ['Multiply(2, L)', ['Multiply', 2, 'L'], 'vector<3>'],
    // A length mismatch stays an honest union of the two shapes, exactly as
    // for the direct spelling; the value is an `incompatible-dimensions` error.
    [
      'Add([1,2], L)',
      ['Add', ['List', 1, 2], 'L'],
      'vector<3> | vector<integer^2>',
    ],
    ['Add([1,2,3], L)', ['Add', ['List', 1, 2, 3], 'L'], 'vector<3>'],
    ['Negate(L)', ['Negate', 'L'], 'vector<3>'],
    ['f(L)', ['f', 'L'], 'vector<3>'],
  ]
);

survey(
  'matrix<2x2>',
  ['List', ['List', 1, 2], ['List', 3, 4]],
  [
    ['Sin(L)', ['Sin', 'L'], 'matrix<2x2>'],
    ['Mod(L, 2)', ['Mod', 'L', 2], 'list<nan | real^(2x2)>'],
    ['Multiply(2, L)', ['Multiply', 2, 'L'], 'matrix<2x2>'],
    [
      'Add([1,2], L)',
      ['Add', ['List', 1, 2], 'L'],
      'matrix<2x2> | vector<integer^2>',
    ],
    ['Negate(L)', ['Negate', 'L'], 'matrix<2x2>'],
    ['f(L)', ['f', 'L'], 'matrix<2x2>'],
  ]
);

survey(
  'indexed_collection<integer>',
  ['Range', 3, 5],
  [
    ['Sin(L)', ['Sin', 'L'], 'list<number>'],
    ['Mod(L, 2)', ['Mod', 'L', 2], 'list<integer>'],
    ['Multiply(2, L)', ['Multiply', 2, 'L'], 'list<integer>'],
    [
      'Add([1,2], L)',
      ['Add', ['List', 1, 2], 'L'],
      'indexed_collection<integer>',
    ],
    ['Negate(L)', ['Negate', 'L'], 'list<integer>'],
    ['f(L)', ['f', 'L'], 'list<number>'],
  ]
);

describe('alias lift: the value agrees with the static claim', () => {
  const ce = new ComputeEngine();
  ce.declareType('nums', 'list<number>', { alias: true });
  ce.declare('L', 'nums');
  ce.assign('L', ['List', 3, 4, 5]);
  ce.assign('f', ce.parse('x \\mapsto x^2'));

  test.each([
    [['Sin', 'L'], '[sin(3),sin(4),sin(5)]'],
    [['Mod', 'L', 2], '[1,0,1]'],
    [['Multiply', 2, 'L'], '[6,8,10]'],
    [['Add', ['List', 1, 2, 3], 'L'], '[4,6,8]'],
    [['Negate', 'L'], '[-3,-4,-5]'],
    [['f', 'L'], '[9,16,25]'],
  ])('%j evaluates to %s', (expr, value) => {
    const e = ce.box(expr as any);
    const v = e.evaluate();
    expect(v.toString()).toBe(value);
    // The evaluated value is a list, as the static `list<…>` claim says.
    expect(v.type.matches('list<number>')).toBe(true);
  });
});

describe('alias lift: cell-scaling handlers type the structure they build', () => {
  const ce = new ComputeEngine();
  ce.declareType('myints', 'list<integer>', { alias: true });
  ce.declare('L', 'myints');
  ce.declare('D', 'list<integer>');
  ce.declareType('ipt', 'tuple<integer, integer>', { alias: true });
  ce.declare('p', 'ipt');
  ce.declare('q', 'tuple<integer, integer>');

  test.each([
    // The cells change kind, so the alias name no longer describes them.
    [['Multiply', 0.5, 'L'], 'list<real>'],
    [['Divide', 'L', 2], 'list<rational>'],
    [['Subtract', 'L', 1], 'list<integer>'],
    [['Add', 'L', 'L'], 'list<integer>'],
    // The cells keep their kind; the result is still the structure.
    [['Multiply', 2, 'L'], 'list<integer>'],
    [['Negate', 'L'], 'list<integer>'],
    // Tuples: component-wise scaling and the component-wise broadcast.
    [['Multiply', 0.5, 'p'], 'tuple<real, real>'],
    [['Multiply', 2, 'p'], 'tuple<integer, integer>'],
    [['Negate', 'p'], 'tuple<integer, integer>'],
    [['Sin', 'p'], 'tuple<number, number>'],
    // Element access reads the alias body's element type.
    [['At', 'L', 1], 'integer | nan'],
    [['First', 'L'], 'integer | nan'],
    // Other lifted heads.
    [['Abs', 'L'], 'list<real<0..> | signed_infinity>'],
    [['Sqrt', 'L'], 'list<number>'],
  ])('%j', (expr, type) => {
    const alias = ce.box(expr as any);
    const control = ce.box(
      JSON.parse(
        JSON.stringify(expr).replace(/"L"/g, '"D"').replace(/"p"/g, '"q"')
      )
    );
    expect(alias.errors).toHaveLength(0);
    expect(alias.type.toString()).toBe(type);
    expect(control.type.toString()).toBe(type);
  });
});

describe('alias lift: a scalar alias is not a lift and keeps its name', () => {
  const ce = new ComputeEngine();
  ce.declareType('meters', 'number', { alias: true });
  ce.declare('m', 'meters');

  test('scalar arithmetic echoes the alias as before', () => {
    expect(ce.box(['Add', 'm', 1]).type.toString()).toBe('meters');
    expect(ce.box(['Negate', 'm']).type.toString()).toBe('meters');
  });
});

describe('alias lift: a NOMINAL collection type still refuses', () => {
  const ce = new ComputeEngine();
  ce.declareType('nlist', 'list<integer>');
  ce.declare('N', 'nlist');

  test.each([[['Sin', 'N']], [['Multiply', 2, 'N']], [['Negate', 'N']]])(
    '%j',
    (expr) => {
      const errors = ce.box(expr as any).errors;
      expect(errors).toHaveLength(1);
      expect(errors[0].toString()).toContain('incompatible-type');
    }
  );
});

//
// SELF-REFERENTIAL ALIASES. Unfolding an alias at every seam of the lift path
// made a self-referential alias (`type alias nest = list<nest>`, reached
// through a constructor; `type alias cyc = cyc | 0`, through a bare union
// arm) recurse forever in every structural walker — and the COULD-family
// admission predicates already did so before the fix (`2a` for `a: nest`
// overflowed the stack at HEAD). Every walker now runs under one descent
// guard (`unfoldAliasOnDescent`, `common/type/utils.ts`): a declaration may
// be unfolded twice on a path, so the non-recursive arms decide (the least
// fixed point), and the third occurrence contributes no members.
//

describe('alias lift: self-referential aliases terminate', () => {
  const ce = new ComputeEngine();
  ce.declareType('nest', 'list<nest>', { alias: true });
  ce.declare('a', 'nest');
  ce.declareType('json', 'list<json> | integer', { alias: true });
  ce.declare('j', 'json');
  ce.declareType('nz', '0 | list<nz>', { alias: true });
  ce.declare('z', 'nz');
  // The direct spelling of `json`'s shape, as the control.
  ce.declare('sl', 'number | list<number>');

  test('an alias with no numeric member is refused, not overflowed', () => {
    for (const expr of [
      ['Sin', 'a'],
      ['Multiply', 2, 'a'],
      ['Negate', 'a'],
    ]) {
      const errors = ce.box(expr as any).errors;
      expect(errors).toHaveLength(1);
      expect(errors[0].toString()).toContain('incompatible-type');
    }
  });

  test('a recursive alias with a scalar arm is admitted and lifted like the direct spelling', () => {
    // The `integer` arm is what makes `json` numeric; the element walk meets
    // it on the second unfold.
    expect(ce.box(['Sin', 'j']).errors).toHaveLength(0);
    expect(ce.box(['Sin', 'j']).type.toString()).toBe(
      ce.box(['Sin', 'sl']).type.toString()
    );
    expect(ce.box(['Multiply', 2, 'j']).type.toString()).toBe(
      ce.box(['Multiply', 2, 'sl']).type.toString()
    );
    expect(ce.box(['Sin', 'z']).errors).toHaveLength(0);
    expect(ce.box(['Multiply', 2, 'z']).errors).toHaveLength(0);
  });

  test('a recursive alias evaluates through the lift', () => {
    const ce2 = new ComputeEngine();
    ce2.declareType('json', 'list<json> | integer', { alias: true });
    ce2.declare('j', 'json');
    ce2.assign('j', ['List', 1, ['List', 2, 3]]);
    expect(ce2.box(['Multiply', 2, 'j']).evaluate().toString()).toBe(
      '[2,[4,6]]'
    );
    expect(ce2.box(['Negate', 'j']).evaluate().toString()).toBe('[-1,[-2,-3]]');
  });

  test('the cell readers terminate on a recursive alias', () => {
    const json = ce.type('json').type;
    expect(typeToString(broadcastCellType(json))).toBe('json');
    expect(broadcastElementType(ce.type('nest').type)).toBeDefined();
    expect(widenNumericCellsWithNan(json)).toBeDefined();
  });
});

describe('alias lift: a scalar alias survives the cell readers', () => {
  const ce = new ComputeEngine();
  ce.declareType('meters', 'number', { alias: true });
  ce.declareType('len', 'real', { alias: true });

  test('broadcastElementType hands a scalar alias back by reference', () => {
    const m = ce.type('meters').type;
    expect(broadcastElementType(m)).toBe(m);
    expect(typeToString(broadcastCellType(ce.type('list<meters>').type))).toBe(
      'meters'
    );
  });

  test('widenNumericCellsWithNan keeps the alias name in the cells', () => {
    // `meters` names `number`, which admits `nan` already, so it is unchanged;
    // `len` names `real`, which does not, so the cell becomes `len | nan`.
    expect(typeToString(widenNumericCellsWithNan(ce.type('meters').type))).toBe(
      'meters'
    );
    expect(
      typeToString(widenNumericCellsWithNan(ce.type('list<len>').type))
    ).toBe('list<len | nan>');
  });
});
