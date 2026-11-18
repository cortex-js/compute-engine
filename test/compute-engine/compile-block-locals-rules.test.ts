import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

// The rules of block locals in compiled code (`docs/COMPILATION-MODEL.md`,
// "Block locals"): a declaration has a value, an assignment is a statement,
// a compiled block writes only its own locals, a block with an assignment
// is a statement or a whole body, and a loop has no value.

function engine() {
  const ce = new ComputeEngine();
  ce.declare('c', 'real');
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  return ce;
}

function compiled(json: MathJsonExpression, to: string, mode?: string) {
  const ce = engine();
  return compile(ce.box(json), { to, mode } as any) as any;
}

const DECLARE_THEN_READ: MathJsonExpression = [
  'Block',
  ['Declare', 'a', "'integer'", 1],
  ['Declare', 'b', "'unknown'", ['Add', 'a', 1]],
  'b',
];

const ACCUMULATOR: MathJsonExpression = [
  'Block',
  ['Declare', 's', "'unknown'", 0],
  [
    'Loop',
    ['Assign', 's', ['Add', 's', 'i']],
    ['Element', 'i', ['Range', 1, 4]],
  ],
  's',
];

const REASSIGN_IN_BRANCH: MathJsonExpression = [
  'Block',
  ['Declare', 'a', "'unknown'", 1],
  ['If', ['Greater', 'c', 0], ['Assign', 'a', 2]],
  'a',
];

describe('COMPILED BLOCK LOCALS: the programs that compile', () => {
  test.each(['javascript', 'glsl'])(
    'a declaration with a value, then a declaration that reads it, on %s',
    (to) => {
      const r = compiled(DECLARE_THEN_READ, to);
      expect(r.success).toBe(true);
      if (to === 'javascript') expect(r.run({})).toBe(2);
    }
  );

  test.each(['javascript', 'glsl'])('the accumulator loop, on %s', (to) => {
    const r = compiled(ACCUMULATOR, to);
    expect(r.success).toBe(true);
    if (to === 'javascript') expect(r.run({})).toBe(10);
  });

  test.each(['javascript', 'glsl'])(
    'a reassignment in a branch, on %s',
    (to) => {
      const r = compiled(REASSIGN_IN_BRANCH, to);
      expect(r.success).toBe(true);
      if (to === 'javascript') {
        expect(r.run({ c: 1 })).toBe(2);
        expect(r.run({ c: -1 })).toBe(1);
      }
    }
  );
});

describe('COMPILED BLOCK LOCALS: the programs that decline', () => {
  // An `Assign` to a name with no binding in a block is the error
  // `assignment-to-undeclared-variable`, and an invalid expression declines.
  test.each(['javascript', 'glsl'])(
    'an assignment to an undeclared name declines, on %s',
    (to) => {
      const r = compiled(
        ['Block', ['Assign', 'b', ['Add', 'x', 2]], ['Multiply', 2, 'b']],
        to
      );
      expect(r.success).toBe(false);
    }
  );

  test.each(['javascript', 'glsl'])(
    'a write to a symbol declared in the engine declines, on %s',
    (to) => {
      const ce = engine();
      ce.declare('u', 'real');
      const r = compile(
        ce.box(['Block', ['Assign', 'u', ['Add', 'u', 1]], 'u']),
        { to } as any
      ) as any;
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(r.error).toMatch(/a write to a name that is not a local/);
    }
  );

  test('a write to an input declines, also at the root', () => {
    const r = compiled(['Assign', 'x', ['Add', 'x', 1]], 'javascript');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/a write to a name that is not a local/);
  });

  test.each(['javascript', 'glsl'])(
    'the value of a loop assigned to a local declines, on %s',
    (to) => {
      const r = compiled(
        [
          'Block',
          [
            'Assign',
            'y',
            ['Loop', ['Add', 'i', 1], ['Element', 'i', ['Range', 1, 3]]],
          ],
          'y',
        ],
        to
      );
      expect(r.success).toBe(false);
    }
  );

  // A block that ends in an assignment is `Nothing` in the interpreter: at
  // the root, and as a list element (`[1, Nothing]`). The pipeline declines
  // it where its value is used.
  test('a block that ends in an assignment, where its value is used, gives no finite value', () => {
    const root = compiled(
      [
        'Block',
        ['Declare', 'b', "'unknown'", 'x'],
        ['Assign', 'b', ['Add', 'x', 2]],
      ],
      'javascript'
    );
    expect(root.success).toBe(false);
    const element = compiled(
      [
        'List',
        1,
        ['Block', ['Declare', 'b', "'unknown'", 1], ['Assign', 'b', 2]],
      ],
      'javascript'
    );
    expect(element.success).toBe(false);
  });

  test('a block with an assignment as the body of a binder compiles', () => {
    const r = compiled(
      [
        'Sum',
        [
          'Block',
          ['Declare', 'q', "'unknown'", 0],
          ['Assign', 'q', ['Multiply', 'i', 'x']],
          'q',
        ],
        ['Limits', 'i', 1, 3],
      ],
      'javascript'
    );
    expect(r.success).toBe(true);
    expect(r.run({ x: 2 })).toBe(12);
  });
});

// A `where` clause gives a block whose statements before the last are only
// declarations with a value. Such a block is a value expression: it
// compiles in an operand position, with the value of the interpreter.
describe('COMPILED BLOCK LOCALS: a block of declarations is a value', () => {
  // A reduced form of the Tycho corpus document art/wccrhnzn2q:
  // `P + PointList((a - ⌊a⌋ where a ≔ 3.7x), 0)`.
  const POINT =
    'P+\\operatorname{PointList}(\\left(a-\\lfloor a\\rfloor \\text{ where } a\\coloneq 3.7x\\right), 0)';
  const SCALAR =
    '1+\\left(a-\\lfloor a\\rfloor \\text{ where } a\\coloneq 3.7x\\right)';

  function pointEngine() {
    const ce = engine();
    ce.declare('P', 'tuple<real, real>');
    return ce;
  }

  test('the where clause parses to a block of declarations', () => {
    const ce = pointEngine();
    expect(ce.parse(SCALAR).json).toEqual([
      'Add',
      [
        'Block',
        ['Declare', 'a', "'unknown'", ['Multiply', 3.7, 'x']],
        ['Add', 'a', ['Negate', ['Floor', 'a']]],
      ],
      1,
    ]);
  });

  test('a where block as an operand gives the interpreter value, on javascript', () => {
    const ce = pointEngine();
    for (const [src, point] of [
      [SCALAR, false],
      [POINT, true],
    ] as const) {
      const expr = ce.parse(src);
      const r = compile(expr, { to: 'javascript' } as any) as any;
      expect(r.success).toBe(true);
      for (const x of [1.3, -2.25, 0.4]) {
        const value = expr.subs({ x, P: ce.box(['Tuple', 1, 2]) }).N().json;
        const actual = r.run({ x, P: [1, 2] });
        if (point) {
          expect(Array.isArray(value)).toBe(true);
          const [, vx, vy] = value as [string, number, number];
          expect(actual[0]).toBeCloseTo(vx, 12);
          expect(actual[1]).toBeCloseTo(vy, 12);
        } else expect(actual).toBeCloseTo(value as number, 12);
      }
    }
  });

  test('the MathJSON form with Declare compiles; with Assign it is invalid and declines', () => {
    const declared = compiled(
      [
        'Add',
        1,
        [
          'Block',
          ['Declare', 'b', "'unknown'", ['Add', 'x', 2]],
          ['Multiply', 2, 'b'],
        ],
      ],
      'javascript'
    );
    expect(declared.success).toBe(true);
    expect(declared.run({ x: 1 })).toBe(7);
    const assigned = compiled(
      [
        'Add',
        1,
        ['Block', ['Assign', 'b', ['Add', 'x', 2]], ['Multiply', 2, 'b']],
      ],
      'javascript'
    );
    expect(assigned.success).toBe(false);
    expect(assigned.error).toMatch(/assignment-to-undeclared-variable/);
  });
});

describe('COMPILED BLOCK LOCALS: the lane of a local follows its static type', () => {
  // The local `a` is declared with a real value, then assigned a complex
  // literal in one branch. Its static type is `number`. (With the value
  // `Sqrt(-x)` in that branch the pipeline compiles on the real lane, and the
  // branch gives NaN, the value of a complex result on the real lane.)
  const LITERAL: MathJsonExpression = [
    'Block',
    ['Declare', 'a', "'unknown'", 1],
    ['If', ['Greater', 'c', 0], ['Assign', 'a', ['Complex', 2, 3]]],
    'a',
  ];

  test.each([
    ['javascript', LITERAL],
    ['glsl', LITERAL],
  ] as const)('in mode strict, on %s, it declines', (to, json) => {
    const r = compiled(json as MathJsonExpression, to, 'strict');
    expect(r.success).toBe(false);
    // The two shapes of the local (`unsettled-shape`), or the complex
    // literal in the real lane (`lane-mismatch`).
    // On GLSL the fragment can refuse the form first (`outside-fragment`).
    expect(r.diagnostic?.code).toMatch(
      to === 'glsl'
        ? /^(unsettled-shape|lane-mismatch|outside-fragment)$/
        : /^(unsettled-shape|lane-mismatch)$/
    );
  });
});

describe('A FUNCTION WHOSE DECLARED RESULT IS NOT NOTHING, WITH A BODY THAT ENDS IN AN ASSIGNMENT', () => {
  test('Epsil: the call is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function f() -> integer { let x = 1; x = 2 }\nf()'
    );
    expect(r.value?.toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type", "integer", "nothing"\)/
    );
  });

  test('Epsil: a body that ends in a declaration is the same error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'function h() -> integer { let x = 2 }\nh()');
    expect(r.value?.toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type", "integer", "nothing"\)/
    );
  });

  test('Epsil: a declared result `nothing` gives Nothing', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function m() -> nothing { let x = 1; x = 2 }\nm()'
    );
    expect(r.value?.symbol).toBe('Nothing');
  });

  test('MathJSON: the call is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      [
        'Typed',
        ['Block', ['Declare', 'x', "'unknown'", 1], ['Assign', 'x', 2]],
        "'integer'",
      ],
    ]);
    const value = ce.box(['Apply', f]).evaluate();
    expect(value.toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type", "integer", "nothing"\)/
    );
  });
});

describe('AN ASSIGN IN PLACE OF THE DECLARATION OF A FUNCTION-BODY LOCAL', () => {
  test('the function literal is invalid', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<real>');
    ce.declare('angle', 'function');
    const fn = ce.box([
      'Function',
      [
        'Block',
        ['Assign', 'q', ['angle', 'P']],
        ['Tuple', ['Cos', 'q'], ['Sin', 'q']],
      ],
      'P',
    ]);
    expect(fn.isValid).toBe(false);
    expect(JSON.stringify(fn.json)).toContain(
      'assignment-to-undeclared-variable'
    );
  });
});

describe('A WRITE TO A `vars` INPUT DECLINES', () => {
  test('a JavaScript `vars` mapping that spells the name as itself', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'real');
    const r = compile(
      ce.box(['Block', ['Assign', 'T', ['Add', 'T', 1]], 'T']),
      { to: 'javascript', vars: { T: 'T' }, hideValues: ['T'] } as any
    ) as any;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/a write to a name that is not a local/);
  });
});
