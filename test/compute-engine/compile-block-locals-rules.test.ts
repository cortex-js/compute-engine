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
  ['Assign', 'b', ['Add', 'a', 1]],
  'b',
];

const ACCUMULATOR: MathJsonExpression = [
  'Block',
  ['Assign', 's', 0],
  ['Loop', ['Assign', 's', ['Add', 's', 'i']], ['Element', 'i', ['Range', 1, 4]]],
  's',
];

const REASSIGN_IN_BRANCH: MathJsonExpression = [
  'Block',
  ['Assign', 'a', 1],
  ['If', ['Greater', 'c', 0], ['Assign', 'a', 2]],
  'a',
];

describe('COMPILED BLOCK LOCALS: the programs that compile', () => {
  test.each(['javascript', 'glsl', 'python'])(
    'a declaration with a value, then a first assignment, on %s',
    (to) => {
      const r = compiled(DECLARE_THEN_READ, to);
      expect(r.success).toBe(true);
      if (to === 'javascript') expect(r.run({})).toBe(2);
    }
  );

  test.each(['javascript', 'glsl', 'python'])(
    'the accumulator loop, on %s',
    (to) => {
      const r = compiled(ACCUMULATOR, to);
      expect(r.success).toBe(true);
      if (to === 'javascript') expect(r.run({})).toBe(10);
    }
  );

  // Python declines this block today, for another reason: the `If` with no
  // `else` branch has no Python lowering ("wrong number of arguments").
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
  test.each(['javascript', 'glsl', 'python'])(
    'a write to a symbol declared in the engine declines, on %s',
    (to) => {
      const ce = engine();
      ce.declare('u', 'real');
      const r = compile(
        ce.box(['Block', ['Assign', 'u', ['Add', 'u', 1]], 'u']),
        { to } as any
      ) as any;
      expect(r.success).toBe(false);
      // The GLSL fragment refuses the write before the emitter runs.
      if (to === 'glsl') {
        expect(r.diagnostic?.code).toBe('outside-fragment');
        expect(r.error).toMatch(/`Assign` writes `u`, which is not a local/);
      } else
        expect(r.error).toMatch(/"u" is not a local of the compiled expression/);
    }
  );

  test('a write to an input declines, also at the root', () => {
    const r = compiled(['Assign', 'x', ['Add', 'x', 1]], 'javascript');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/"x" is not a local of the compiled expression/);
  });

  test.each(['javascript', 'glsl', 'python'])(
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

  test.each(['javascript', 'glsl', 'python'])(
    'a block that ends in an assignment, where its value is used, declines, on %s',
    (to) => {
      const root = compiled(['Block', ['Assign', 'b', ['Add', 'x', 2]]], to);
      expect(root.success).toBe(false);
      // The GLSL fragment words the refusal of a block with no value itself.
      if (to === 'glsl')
        expect(root.error).toMatch(/The block ends with an assignment/);
      else if (to !== 'python')
        expect(root.error).toMatch(/an assignment or a declaration is a statement/);
      // The JavaScript code gave `[1, 2]`, where the interpreter gives
      // `[1, Nothing]`.
      const element = compiled(['List', 1, ['Block', ['Assign', 'b', 2]]], to);
      expect(element.success).toBe(false);
    }
  );

  test.each(['javascript', 'glsl', 'python'])(
    'a block with an assignment as an operand declines, on %s',
    (to) => {
      const r = compiled(
        ['Add', 1, ['Block', ['Assign', 'b', ['Add', 'x', 2]], 'b']],
        to
      );
      expect(r.success).toBe(false);
      if (to !== 'python')
        expect(r.error).toMatch(/a block with a statement other than a declaration with a value is an operand/);
    }
  );

  test('a block with an assignment as the body of a binder compiles', () => {
    const r = compiled(
      [
        'Sum',
        ['Block', ['Assign', 'q', ['Multiply', 'i', 'x']], 'q'],
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
  const SCALAR = '1+\\left(a-\\lfloor a\\rfloor \\text{ where } a\\coloneq 3.7x\\right)';

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
        const value = expr
          .subs({ x, P: ce.box(['Tuple', 1, 2]) })
          .N()
          .json;
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

  test('a where block as an operand compiles, on glsl', () => {
    const ce = pointEngine();
    for (const src of [SCALAR, POINT]) {
      const r = compile(ce.parse(src), { to: 'glsl' } as any) as any;
      expect(r.success).toBe(true);
      expect(r.code).toContain('floor(a)');
    }
  });

  // The Python target has no statement sink for a block in an operand
  // position, and declines it with its own reason; the rule on block
  // values does not refuse it.
  test('python declines for its own reason, not for the block value', () => {
    const ce = pointEngine();
    const r = compile(ce.parse(SCALAR), { to: 'python' } as any) as any;
    expect(r.success).toBe(false);
    expect(r.error ?? '').not.toMatch(/a block with an assignment/);
  });

  test('the MathJSON form with Declare compiles; with Assign it declines', () => {
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
      ['Add', 1, ['Block', ['Assign', 'b', ['Add', 'x', 2]], ['Multiply', 2, 'b']]],
      'javascript'
    );
    expect(assigned.success).toBe(false);
    expect(assigned.error).toMatch(/a block with a statement other than a declaration with a value is an operand/);
  });

  test('a block of declarations with a reassignment in it declines as an operand', () => {
    const r = compiled(
      [
        'Add',
        1,
        [
          'Block',
          ['Declare', 'b', "'unknown'", 'x'],
          ['If', ['Greater', 'c', 0], ['Assign', 'b', 2], 'Nothing'],
          'b',
        ],
      ],
      'javascript'
    );
    expect(r.success).toBe(false);
  });
});

describe('COMPILED BLOCK LOCALS: the lane of a local follows its static type', () => {
  // The local `a` is assigned a real value, then a complex value in one
  // branch. Its static type is `number`.
  const SQRT: MathJsonExpression = [
    'Block',
    ['Assign', 'a', 1],
    ['If', ['Greater', 'c', 0], ['Assign', 'a', ['Sqrt', ['Multiply', -1, 'x']]]],
    'a',
  ];
  const LITERAL: MathJsonExpression = [
    'Block',
    ['Assign', 'a', 1],
    ['If', ['Greater', 'c', 0], ['Assign', 'a', ['Complex', 2, 3]]],
    'a',
  ];

  test.each([
    ['javascript', SQRT],
    ['glsl', SQRT],
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

  test('in mode complex, on javascript, it gives the values of the interpreter', () => {
    const ce = engine();
    for (const json of [SQRT, LITERAL]) {
      const expr = ce.box(json);
      const r = compile(expr, { to: 'javascript', mode: 'complex' } as any) as any;
      expect(r.success).toBe(true);
      for (const p of [
        { c: 1, x: 4 },
        { c: -1, x: 4 },
        { c: 1, x: -4 },
      ]) {
        const exact = expr.subs(p).N();
        const value = r.run(p);
        const re = typeof value === 'number' ? value : value.re;
        const im = typeof value === 'number' ? 0 : value.im;
        expect(re).toBeCloseTo(exact.re, 12);
        expect(im).toBeCloseTo(exact.im, 12);
      }
    }
  });
});

describe('A FUNCTION WHOSE DECLARED RESULT IS NOT NOTHING, WITH A BODY THAT ENDS IN AN ASSIGNMENT', () => {
  test('Epsil: the call is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'function f() -> integer { x = 2 }\nf()');
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
    const r = executeEpsil(ce, 'function m() -> nothing { x = 2 }\nm()');
    expect(r.value?.symbol).toBe('Nothing');
  });

  test('MathJSON: the call is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Typed', ['Block', ['Assign', 'x', 2]], "'integer'"],
    ]);
    const value = ce.box(['Apply', f]).evaluate();
    expect(value.toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type", "integer", "nothing"\)/
    );
  });
});

describe('THE TWO SPELLINGS OF A DECLARATION COMPILE THE SAME', () => {
  // The local `q` of the body of `point` holds a list. A call of `point` is
  // typed from its body with the local typed as its value, for the
  // three-operand `Declare` as for a first `Assign`, so the compiled `Dot`
  // reads a pair of lists.
  test.each([
    ['a first Assign', ['Assign', 'q', ['angle', 'P']]],
    ['Declare with the type unknown', ['Declare', 'q', "'unknown'", ['angle', 'P']]],
    ['Declare with a list type', ['Declare', 'q', "'list<real>'", ['angle', 'P']]],
  ] as [string, MathJsonExpression][])('%s', (_label, declaration) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('P', 'list<real>');
    ce.declare('angle', 'function');
    ce.assign('angle', ce.box(['Function', ['Block', 'P'], 't']));
    ce.declare('point', 'function');
    ce.assign(
      'point',
      ce.box([
        'Function',
        ['Block', declaration, ['Tuple', ['Cos', 'q'], ['Sin', 'q']]],
        'P',
      ])
    );
    const expr = ce.box(['Dot', ['point', 'x'], ['Tuple', 1, 2]]);
    const r = compile(expr, { fallback: false } as any) as any;
    expect(r.success).toBe(true);
    const value = r.run({ x: 0, P: [0, 1] });
    expect(value[0]).toBeCloseTo(1, 12);
    expect(value[1]).toBeCloseTo(Math.cos(1) + 2 * Math.sin(1), 12);
    // The interpreter gives the same values.
    ce.assign('x', 0);
    ce.assign('P', ce.box(['List', 0, 1]));
    // Read each element as a number from the boxed value: at the default
    // precision an element can be a decimal with more digits than a double,
    // and its MathJSON form is then an object `{ num: "…" }`, not a number.
    const interpreted = expr.N();
    expect(interpreted.operator).toBe('List');
    const elements = [...interpreted.each()].map((e) => e.re);
    expect(elements[0]).toBeCloseTo(1, 12);
    expect(elements[1]).toBeCloseTo(
      Math.cos(1) + 2 * Math.sin(1),
      12
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
    expect(r.error).toMatch(/"T" is not a local of the compiled expression/);
  });
});
