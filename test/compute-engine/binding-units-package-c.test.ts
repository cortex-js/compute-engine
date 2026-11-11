import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { lowerMapSpine } from '../../src/compute-engine/library/map-lowering';

// Defects that showed with the engine flag `_bindingUnits` on (phase E,
// package C of docs/plans/2026-11-10-binding-units-phase-e-handoff.md). Each
// test turns the flag on for its own engine. The rules are those of
// docs/plans/2026-11-09-binding-units-slice-1-spec.md.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

describe('BINDING UNITS: an assumption declares the names it constrains (rule 12)', () => {
  test('a fact about two names is recorded against both', () => {
    const ce = engine();
    expect(ce.assume(ce.box(['Greater', 'x', 'y']))).toBe('ok');
    expect(ce.lookupDefinition('x')).toBeDefined();
    expect(ce.lookupDefinition('y')).toBeDefined();
    expect(ce.assume(ce.box(['Equal', 'y', 5]))).toBe('ok');
    expect(ce.assume(ce.box(['Equal', 'x', 1]))).toBe('contradiction');
  });

  test('a conjunction that refutes a value through another name contradicts', () => {
    const ce = engine();
    expect(
      ce.assume(
        ce.box([
          'And',
          ['Greater', 'x', 'y'],
          ['Equal', 'y', 5],
          ['Equal', 'x', 1],
        ])
      )
    ).toBe('contradiction');
  });
});

describe('BINDING UNITS: a requirement that the unit excludes', () => {
  test.each([
    ['o\\cdot o(t)', 1],
    ['o(t)\\cdot o', 2],
  ])('the factor `o` of %s is a function, and an error', (latex, at) => {
    const ce = engine();
    const expr = ce.parse(latex);
    expect(expr.isValid).toBe(false);
    expect(expr.ops![at - 1].json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'function'"],
      'o',
    ]);
  });

  test('a later requirement that the entry excludes is not written', () => {
    const ce = engine();
    // `2q` requires a number, then `q(t)` reads `q` as a function.
    const expr = ce.box(['Add', ['Multiply', 2, 'q'], ['q', 't']]);
    const q = expr.ops![0].ops![1];
    expect(q.type.toString()).toBe('number');
  });
});

describe('BINDING UNITS: an occurrence whose definition is not on the scope chain', () => {
  test('the closed form of a compiled integral keeps a parameter named i', () => {
    const ce = engine();
    ce.declare('y', 'real');
    ce.parse(String.raw`r(y, i) := \int_0^1 i x\,dx`).evaluate();
    const result = compile(ce.parse('r(y, 2)'));
    expect(result.success).toBe(true);
    expect(result.run!({ y: 1 })).toBeCloseTo(1, 12);
  });

  test('the variable of a D is not a parameter of the same name', () => {
    const ce = engine();
    const fn = ce.box([
      'Function',
      ['D', ['Power', 'a', 2], 'a'],
      ['Typed', 'a', "'real'"],
    ]);
    expect(fn.type.toString()).toBe('(a: real) -> number');
  });

  test('a declaration in a pushed scope still hides a definition of the chain', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const a = ce.parse('x + 1');
    ce.pushScope();
    try {
      ce.declare('x', 'integer');
      expect(a.ops!.find((op) => op.symbol === 'x')!.type.toString()).toBe(
        'integer'
      );
    } finally {
      ce.popScope();
    }
    expect(a.ops!.find((op) => op.symbol === 'x')!.type.toString()).toBe(
      'real'
    );
  });
});

describe('BINDING UNITS: a free name of the body of a function literal', () => {
  test('a view made at the top level does not read a parameter of its reader', () => {
    const ce = engine();
    ce.assign('pass', ce.box(['Function', 'v', 'd', 'v']));
    ce.assign('readIn', ce.box(['Function', ['ListFrom', 'v'], 'd', 'v']));
    const view = ['Map', ['Function', ['Multiply', 'x', 'd'], 'x'], ['List', 1, 2]];
    const expected = ['List', 'd', ['Multiply', 2, 'd']];
    expect(ce.box(['readIn', 10, view]).evaluate().json).toEqual(expected);
    const passed = ce.box(['pass', 10, view]).evaluate();
    expect(ce.function('ListFrom', [passed]).evaluate().json).toEqual(expected);
  });
});

describe('BINDING UNITS: an operator lent to a call head', () => {
  test('a variable named like a library operator keeps its type in simplify()', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    ce.declare('N', 'real');
    const index = ['Add', ['Mod', ['Range', 0, ['Add', ['Length', 'L'], -1]], 3], 1];
    const expr = ce.box([
      'Add',
      ['Which', ['Equal', ['Mod', ['Range', 1, 'N'], 3], 0], 1, 'True', 0],
      ['At', ['List', 0, 1, 2], index],
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(JSON.stringify(expr.simplify().json)).not.toContain('"Error"');
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe('BINDING UNITS: a free name that is assigned a collection later', () => {
  test('the symbol answers the collection protocol through its definition', () => {
    const ce = engine();
    const ws = ce.box('ws');
    expect(ws.isCollection).toBe(false);
    expect([...ws.each()]).toEqual([]);
    ce.assign('ws', ce.box(['List', 1, 2, 3]));
    expect(ws.isCollection).toBe(true);
    expect(ws.isIndexedCollection).toBe(true);
    expect(ws.isFiniteCollection).toBe(true);
    expect(ws.isEmptyCollection).toBe(false);
    expect(ws.count).toBe(3);
    expect(ws.at(2)!.re).toBe(2);
    expect(ws.contains(ce.number(2))).toBe(true);
    expect([...ws.each()].map((x) => x.re)).toEqual([1, 2, 3]);
  });

  test('a Map over the name has the elements of the list', () => {
    const ce = engine();
    const m = ce.box(['Map', ['Function', ['Multiply', 'z', 2], 'z'], 'ws']);
    ce.assign('ws', ce.box(['List', 1, 2, 3]));
    expect(ce.function('ListFrom', [m]).evaluate().json).toEqual([
      'List',
      2,
      4,
      6,
    ]);
  });

  test('the assignment moves the semantic version, and a declined Map level is asked again', () => {
    const ce = engine();
    const m = ce.box([
      'Map',
      ['Function', ['Multiply', 'z', 2], 'z'],
      ['Map', ['Function', ['Add', 'y', 1], ['Typed', 'y', 'integer']], 'ws'],
    ]);
    expect(lowerMapSpine(m)!.levels).toHaveLength(1);
    const before = ce._semanticVersion;
    ce.assign('ws', ce.box(['List', 1, 2, 3]));
    expect(ce._semanticVersion).toBeGreaterThan(before);
    expect(lowerMapSpine(m)!.levels).toHaveLength(2);
  });
});

describe('The type of a derivative does not keep the range of its body', () => {
  // This does not depend on the flag: `Abs(x)` is `real<0..>`, and its
  // derivative is `-1` for a negative `x`.
  test.each([false, true])('D(Abs(x), x), flag %s', (flag) => {
    const ce = new ComputeEngine();
    ce._bindingUnits = flag;
    ce.declare('x', 'real');
    const d = ce.box(['D', ['Abs', 'x'], 'x']);
    expect(d.type.toString()).not.toContain('<0..>');
    expect(d.type.matches('number')).toBe(true);
  });
});
