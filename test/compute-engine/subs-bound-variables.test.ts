import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// `subs()` replaces only the FREE occurrences of a name. A name that a
// binder binds (a `Sum` or `Comprehension` index, a `Function` parameter, a
// `Block` local) keeps denoting the binder's own binding where the binder
// binds it. Before this was fixed, the substitution reached the binding site
// too: the index of a `Sum` became an `Error`, and a list replaced the index
// of a `Comprehension` (Tycho ledger row 464).

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

function subs(
  json: Json,
  map: Record<string, Json>,
  form?: 'raw' | 'structural'
): Expression {
  const expr = ce.box(json, form ? { form } : undefined);
  const boxed: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(map)) boxed[k] = ce.box(v);
  return expr.subs(boxed);
}

describe('SUBS LEAVES A BOUND VARIABLE AND ITS BINDER UNCHANGED', () => {
  test('the index of a Comprehension', () => {
    const json: Json = [
      'Comprehension',
      ['Add', 'j', 1],
      ['Element', 'j', ['Range', 0, 2]],
    ];
    const result = subs(json, { j: ['List', 4, 4, 5] });
    expect(result.json).toEqual(json);
    // The value is a lazy collection, so it is compared by its elements.
    expect(result.evaluate().toString()).toBe('[1,2,3]');
  });

  test('the index of a Sum', () => {
    const json: Json = ['Sum', 'j', ['Limits', 'j', 1, 3]];
    const result = subs(json, { j: ['List', 4, 5] });
    expect(result.json).toEqual(json);
    expect(result.isValid).toBe(true);
    expect(result.evaluate().json).toEqual(6);
  });

  test('the parameter of a Function literal', () => {
    const result = subs(['Function', ['Add', 'j', 1], 'j'], { j: 7 });
    expect(result.json).toEqual(['Function', ['Block', ['Add', 'j', 1]], 'j']);
    expect(result.isValid).toBe(true);
  });

  test('a local of a Block, declared or assigned', () => {
    const declared: Json = [
      'Block',
      ['Declare', 'j', 'integer'],
      ['Assign', 'j', 2],
      ['Add', 'j', 1],
    ];
    const r1 = subs(declared, { j: 7 });
    expect(r1.json).toEqual(declared);
    expect(r1.evaluate().json).toEqual(3);

    const assigned: Json = ['Block', ['Assign', 'q', 2], ['Add', 'q', 1]];
    const r2 = subs(assigned, { q: 5 });
    expect(r2.json).toEqual(assigned);
    expect(r2.evaluate().json).toEqual(3);
  });

  test('a free symbol read in a Block is still replaced', () => {
    const result = subs(
      ['Block', ['Assign', 't', ['Add', 'k', 1]], ['Multiply', 2, 't']],
      { k: 3 }
    );
    expect(result.evaluate().json).toEqual(8);
  });

  test('the variable of a definite Integrate', () => {
    const integral = subs(
      ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 0, 1]],
      { x: 3, a: 2 }
    );
    expect(integral.evaluate().json).toEqual(1);
  });

  test('a coefficient of an integrand that lists it as a parameter', () => {
    // The parameter list of an integrand is not read: `a` is free, as the
    // free-variable walk reports it.
    const json: Json = [
      'Integrate',
      ['Function', ['Multiply', 'a', 'x'], 'x', 'a'],
      ['Limits', 'x', 0, 1],
    ];
    expect(ce.box(json).freeVariables).toEqual(['a']);
    expect(subs(json, { a: 2 }).evaluate().json).toEqual(1);
  });
});

describe('SUBS REPLACES THE VARIABLE OF AN INDEFINITE INTEGRAL', () => {
  // The value of an indefinite integral is a function of its variable
  // (`∫ a·x dx = a·x²/2`), as the value of `D(f, x)` is, so the variable is
  // free and is replaced: the result is the value of the integral at the
  // point, `EvaluateAt(Function(Integrate(a·x, x), x), 3)`.
  test('Integrate(a·x, x)', () => {
    const expr = ce.box(['Integrate', ['Multiply', 'a', 'x'], 'x']);
    expect(expr.freeVariables).toEqual(['a', 'x']);
    const result = subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], {
      x: 3,
    });
    expect(result.isValid).toBe(true);
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().toString()).toBe('9/2 * a');
  });

  test('Integrate(a·x, x) with only the coefficient replaced', () => {
    const result = subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], {
      a: 2,
    });
    expect(result.evaluate().isSame(ce.parse('x^2'))).toBe(true);
  });
});

describe('SUBS OF THE VARIABLE OF D, SERIES OR AN INDEFINITE INTEGRAL IS A VALUE AT A POINT', () => {
  // The value of `D(f, x)`, `Series(f, x, …)` and `Integrate(f, x)` is a
  // function of `x`. Replacing `x` by `3` gives the value at `x = 3`:
  // `EvaluateAt(Function(D(f, x), x), 3)`. The node keeps its own variable,
  // and the other entries of the substitution are applied inside it.
  const parseRoute = (latex: string, map: Record<string, Json>) => {
    const boxed: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(map)) boxed[k] = ce.box(v);
    return ce.parse(latex).subs(boxed);
  };

  test('D(x^2, x) with x = 3 (box route)', () => {
    const result = subs(['D', ['Power', 'x', 2], 'x'], { x: 3 });
    expect(result.json).toEqual([
      'EvaluateAt',
      ['Function', ['Block', ['D', ['Power', 'x', 2], 'x']], 'x'],
      3,
    ]);
    expect(result.latex).toBe(
      '\\left.\\left(\\frac{\\mathrm{d}x^2}{\\mathrm{d}x}\\right)\\right|_{x=3}'
    );
    expect(result.evaluate().json).toEqual(6);
    expect(result.N().json).toEqual(6);
  });

  test('D(x^2, x) with x = 3 (parse route)', () => {
    const result = parseRoute('\\frac{d}{dx}x^2', { x: 3 });
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().json).toEqual(6);
  });

  test('Integrate(a·x, x) with x = 3 and a = 2 (box route)', () => {
    const result = subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], {
      x: 3,
      a: 2,
    });
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().json).toEqual(9);
  });

  test('Integrate(a·x, x) with x = 3 and a = 2 (parse route)', () => {
    const result = parseRoute('\\int ax\\,dx', { x: 3, a: 2 });
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().json).toEqual(9);
  });

  test('an integral with no closed form stays symbolic at the point', () => {
    const result = subs(['Integrate', ['Sin', ['Sin', 'x']], 'x'], { x: 3 });
    expect(result.evaluate().operator).toBe('EvaluateAt');
  });

  test('Series(sin x, x, 0, 3) with x = 1/2 (box route)', () => {
    const result = subs(['Series', ['Sin', 'x'], 'x', 0, 3], {
      x: ['Rational', 1, 2],
    });
    expect(result.operator).toBe('EvaluateAt');
    // x - x³/6 at 1/2 is 23/48.
    expect(result.evaluate().toString()).toBe('23/48 + BigO(1/32)');
  });

  test('Series(sin x, x, 0, 3) with x = 1/2 (parse route)', () => {
    const result = parseRoute('\\operatorname{Series}(\\sin(x), x, 0, 3)', {
      x: ['Rational', 1, 2],
    });
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().toString()).toBe('23/48 + BigO(1/32)');
  });

  test('a substitution of another name only is applied inside', () => {
    const json: Json = ['D', ['Power', 'x', 2], 'x'];
    expect(subs(json, { y: 3 }).json).toEqual(json);
    const result = subs(['D', ['Multiply', ['Power', 'x', 2], 'y'], 'x'], {
      y: 3,
    });
    expect(result.json).toEqual(['D', ['Multiply', 3, ['Power', 'x', 2]], 'x']);
    expect(result.evaluate().toString()).toBe('6x');
    const parsed = parseRoute('\\frac{d}{dx}(x^2y)', { y: 3 });
    expect(parsed.operator).toBe('D');
    expect(parsed.evaluate().toString()).toBe('6x');
  });

  test('a replacement by the same symbol changes nothing', () => {
    const json: Json = ['D', ['Power', 'x', 2], 'x'];
    expect(subs(json, { x: 'x' }).json).toEqual(json);
  });

  test('D(f(x), x) with x = g is the derivative at g', () => {
    const result = subs(['D', ['f', 'x'], 'x'], { x: 'g' });
    expect(result.operator).toBe('EvaluateAt');
    expect(result.evaluate().toString()).toBe('Apply(Derivative(f, 1), g)');
  });

  test('a mixed partial derivative at a point', () => {
    const json: Json = ['D', ['Multiply', ['Power', 'x', 2], 'y'], 'x', 'y'];
    // ∂²(x²y)/∂x∂y = 2x, at x = 3.
    expect(subs(json, { x: 3, y: 5 }).evaluate().json).toEqual(6);
    // The points are applied at the same time: x = y and y = 5 is 2y, with
    // the y of the enclosing scope.
    const result = subs(json, { x: 'y', y: 5 });
    expect(result.json).toEqual([
      'EvaluateAt',
      [
        'Function',
        ['Block', ['D', ['Multiply', 'y', ['Power', 'x', 2]], 'x', 'y']],
        'x',
        'y',
      ],
      ['Tuple', 'y', 5],
    ]);
    expect(result.latex).toBe(
      '\\left.\\left(\\frac{\\partial^{2}(yx^2)}{\\partial x\\,\\partial y}\\right)\\right|_{x=y, y=5}'
    );
    expect(result.evaluate().toString()).toBe('2y');
  });

  test('a second derivative at a point', () => {
    const result = subs(['D', ['Power', 'x', 3], 'x', 'x'], { x: 2 });
    expect(result.evaluate().json).toEqual(12);
  });

  // The point can contain the variable: `D(x^2, x)` at `x + 1` is the
  // derivative `2x` at `x + 1`, where the `x` of `x + 1` is the `x` of the
  // enclosing scope. The `x` of `2x` was not replaced by the argument, and
  // the value was `2x`.
  test('a point that contains the variable (box route)', () => {
    const result = subs(['D', ['Power', 'x', 2], 'x'], {
      x: ['Add', 'x', 1],
    });
    expect(result.latex).toBe(
      '\\left.\\left(\\frac{\\mathrm{d}x^2}{\\mathrm{d}x}\\right)\\right|_{x=x+1}'
    );
    expect(result.evaluate().toString()).toBe('2(x + 1)');
    expect(
      subs(['D', ['Power', 'x', 2], 'x'], { x: ['Multiply', 2, 'x'] })
        .evaluate()
        .toString()
    ).toBe('4x');
    expect(
      subs(['Integrate', ['Multiply', 'a', 'x'], 'x'], { x: ['Add', 'x', 1] })
        .evaluate()
        .toString()
    ).toBe('1/2 * a * (x + 1)^2');
    expect(
      subs(['Series', ['Sin', 'x'], 'x', 0, 3], { x: ['Add', 'x', 1] })
        .evaluate()
        .toString()
    ).toBe('1 + x - 1/6 * (x + 1)^3 + BigO((x + 1)^5)');
  });

  // A replacement of another name is put in the node before the value is
  // computed, also when it contains the variable: `D(x·y, x)` with `y`
  // replaced by `x` is `D(x·x, x)`, whose value is `2x`. Only the variable
  // itself is applied at a point.
  test('a replacement of another name that contains the variable', () => {
    const json: Json = ['D', ['Multiply', 'x', 'y'], 'x'];
    const result = subs(json, { y: 'x' });
    expect(result.json).toEqual(['D', ['Multiply', 'x', 'x'], 'x']);
    expect(result.evaluate().toString()).toBe('2x');
    const atPoint = subs(json, { x: 3, y: 'x' });
    expect(atPoint.json).toEqual([
      'EvaluateAt',
      ['Function', ['Block', ['D', ['Multiply', 'x', 'x'], 'x']], 'x'],
      3,
    ]);
    expect(atPoint.evaluate().toString()).toBe('6');
    // ∂(x²·x)/∂x = 3x².
    const value = subs(['D', ['Multiply', ['Power', 'x', 2], 'y'], 'x'], {
      y: 'x',
    }).evaluate();
    for (const x of [0.5, 2, -3])
      expect(value.subs({ x: ce.number(x) }).N().re).toBeCloseTo(3 * x * x, 9);
  });

  // A name with an assigned value is replaced in the node as any other name:
  // with `y := 7`, `D(x·y, x)` with `y` replaced by `x` is `D(x·x, x)`.
  test('a replacement of a name that has an assigned value', () => {
    const engine = new ComputeEngine();
    engine.assign('y', 7);
    const result = engine
      .box(['D', ['Multiply', 'x', 'y'], 'x'])
      .subs({ y: engine.symbol('x') });
    expect(result.operator).toBe('D');
    expect(result.evaluate().toString()).toBe('2x');
  });

  // The replacements are simultaneous: `D(x·a·b, x)` with `a` replaced by
  // `b` and `b` by `x` is `D(b·x·x, x)`, whose value is `2bx`.
  test('simultaneous replacements of other names', () =>
    expect(
      subs(['D', ['Multiply', 'x', 'a', 'b'], 'x'], { a: 'b', b: 'x' })
        .evaluate()
        .toString()
    ).toBe('2b * x'));

  // Inside a scoped expression, the point is kept: the value of the
  // derivative is computed in the body of the literal and the literal is
  // built again with its parameters bound there.
  test('a point inside a Sum or a Block (box route)', () => {
    expect(
      subs(['Sum', ['D', ['Power', 'x', 'k'], 'x'], ['Limits', 'k', 1, 3]], {
        x: 2,
      }).evaluate().json
    ).toEqual(17);
    expect(
      subs(['Block', ['Add', 1, ['D', ['Power', 'x', 2], 'x']]], {
        x: 2,
      }).evaluate().json
    ).toEqual(5);
    expect(
      subs(
        [
          'Sum',
          ['D', ['Multiply', 'k', ['Power', 'x', 2]], 'x'],
          ['Limits', 'k', 1, 3],
        ],
        { x: 2 }
      ).evaluate().json
    ).toEqual(24);
    expect(
      subs(
        ['Sum', ['Integrate', ['Power', 'x', 'k'], 'x'], ['Limits', 'k', 1, 2]],
        {
          x: 2,
        }
      )
        .evaluate()
        .toString()
    ).toBe('14/3');
    // k·(x − x³/6) at 1/2 is 23k/48, and the sum for k = 1, 2 is 23/16.
    expect(
      subs(
        [
          'Sum',
          ['Series', ['Multiply', 'k', ['Sin', 'x']], 'x', 0, 3],
          ['Limits', 'k', 1, 2],
        ],
        { x: ['Rational', 1, 2] }
      )
        .evaluate()
        .toString()
    ).toBe('23/16 + 2BigO(1/32)');
  });

  test('a point inside a Sum (parse route)', () =>
    expect(
      parseRoute('\\sum_{k=1}^3 k\\frac{d}{dx} x^2', { x: 2 }).evaluate().json
    ).toEqual(24));

  // A wildcard is replaced inside the node: a rule instantiates `D(_f, x)`
  // with `subs()`.
  test('a wildcard is replaced inside the node', () => {
    const result = ce
      .box(['D', '_f', 'x'], { form: 'raw' })
      .subs({ _f: ce.box(['Power', 'x', 2]) });
    expect(result.json).toEqual(['D', ['Power', 'x', 2], 'x']);
    expect(result.evaluate().toString()).toBe('2x');
  });

  test('the value at the point under N()', () => {
    expect(subs(['D', ['Sin', 'x'], 'x'], { x: 1 }).N().re).toBeCloseTo(
      Math.cos(1),
      12
    );
    expect(subs(['Integrate', ['Sin', 'x'], 'x'], { x: 1 }).N().re).toBeCloseTo(
      -Math.cos(1),
      12
    );
  });

  // An expansion or a derivative with no closed form keeps the point: the
  // value is not the unevaluated `Series` in `x`.
  test('a value with no closed form stays at the point', () => {
    const series = subs(['Series', ['Exp', ['Divide', 1, 'x']], 'x', 0, 3], {
      x: 3,
    }).evaluate();
    expect(series.operator).toBe('EvaluateAt');
  });

  test('a replacement by the same symbol, in any spelling', () => {
    const engine = new ComputeEngine();
    engine.assign('x', 5);
    const json: Json = ['D', ['Power', 'x', 2], 'x'];
    const expr = engine.box(json);
    for (const same of ['x', { sym: 'x' }, engine.symbol('x')]) {
      const result = expr.subs({ x: same } as Parameters<typeof expr.subs>[0]);
      expect(result.json).toEqual(json);
      expect(result.evaluate().toString()).toBe('2x');
    }
  });

  test('a point that contains the variable (parse route)', () => {
    const result = parseRoute('\\frac{d}{dx}x^2', { x: ['Add', 'x', 1] });
    expect(result.evaluate().toString()).toBe('2(x + 1)');
  });

  test('a raw or structural receiver keeps its form', () => {
    const json: Json = ['D', ['Power', 'x', 2], 'x'];
    const raw = subs(json, { x: 3 }, 'raw');
    expect(raw.operator).toBe('EvaluateAt');
    expect(raw.isCanonical).toBe(false);
    const structural = subs(json, { x: 3 }, 'structural');
    expect(structural.operator).toBe('EvaluateAt');
    expect(structural.isStructural).toBe(true);
  });

  test('a wildcard variable is replaced in the node', () => {
    const result = ce
      .box(['D', ['Power', '_x', 2], '_x'], { form: 'raw' })
      .subs({ _x: ce.symbol('t') });
    expect(result.json).toEqual(['D', ['Power', 't', 2], 't']);
  });
});

describe('SUBS REPLACES A NAME THAT A NON-BINDER READS IN A CLAUSE', () => {
  // `Element` and `Limits` bind their symbol only in an operand of a binder
  // (`Sum`, `Integrate`, a quantifier, …), and `Assign` declares a local only
  // in a `Block`. In the other nodes the name is the name of the enclosing
  // scope, so it is free and is replaced.
  test('x ∈ ℤ ∧ x > 0', () => {
    const expr = ce.parse('x \\in \\Z \\land x > 0');
    expect(expr.freeVariables).toEqual(['x']);
    expect(expr.subs({ x: 3 }).evaluate().json).toEqual('True');
  });

  test('Which(x ∈ ℤ, 1, True, 0)', () => {
    const json: Json = ['Which', ['Element', 'x', 'Integers'], 1, 'True', 0];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    expect(subs(json, { x: 3 }).evaluate().json).toEqual(1);
    expect(subs(json, { x: 0.5 }).evaluate().json).toEqual(0);
  });

  test('If(x ∈ ℤ, x + 1, 0)', () => {
    const json: Json = [
      'If',
      ['Element', 'x', 'Integers'],
      ['Add', 'x', 1],
      0,
    ];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    expect(subs(json, { x: 3 }).evaluate().json).toEqual(4);
  });

  test('Boole(x ∈ ℤ) + x', () => {
    const json: Json = ['Add', ['Boole', ['Element', 'x', 'Integers']], 'x'];
    expect(ce.box(json).freeVariables).toEqual(['x']);
    const result = subs(json, { x: 3 });
    expect(JSON.stringify(result.json)).not.toMatch(/"x"/);
    expect(result.evaluate().json).toEqual(4);
  });

  test('If(z > 0, Assign(z, 5), Assign(z, 6))', () => {
    const json: Json = [
      'If',
      ['Greater', 'z', 0],
      ['Assign', 'z', 5],
      ['Assign', 'z', 6],
    ];
    expect(ce.box(json).freeVariables).toEqual(['z']);
    const result = subs(json, { z: 7 });
    expect(JSON.stringify(result.op1.json)).not.toMatch(/"z"/);
  });

  test('a quantifier still binds the symbol of its Element clause', () => {
    const json: Json = [
      'ForAll',
      ['Element', 'x', ['Set', 1, 2]],
      ['Greater', 'x', 'y'],
    ];
    expect(ce.box(json).freeVariables).toEqual(['y']);
    expect(subs(json, { x: 3, y: 0 }).evaluate().json).toEqual('True');
    expect(subs(json, { x: 3, y: 1 }).evaluate().json).toEqual('False');
    const raw = ce.box(json, { form: 'raw' });
    expect(raw.freeVariables).toEqual(['y']);
    expect(JSON.stringify(raw.subs({ x: ce.box(3) }).json)).not.toContain(
      '3'
    );
  });
});

describe('SUBS ON A SET-BUILDER', () => {
  test('{n ∈ ℕ | n > 1} binds n', () => {
    const expr = ce.parse('\\{n \\in \\N \\mid n > 1\\}');
    expect(expr.freeVariables).toEqual([]);
    expect(expr.subs({ n: ce.box(3) }).isSame(expr)).toBe(true);
  });

  test('the n of the tuple (m, n ∈ S) is free', () => {
    const expr = ce.box(['Tuple', 'm', ['Element', 'n', 'Integers']]);
    expect(expr.freeVariables).toEqual(['m', 'n']);
  });
});

describe('SUBS WITH A RAW RESULT', () => {
  test('the clause of a canonical Sum is rebuilt raw', () => {
    const expr = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'j', 1, 'k']]);
    const result = expr.subs({ k: ce.box(2) }, { canonical: false });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'j', 2],
      ['Limits', 'j', 1, 2],
    ]);
    expect(result.isCanonical).toBe(false);
    expect(result.ops![1].isCanonical).toBe(false);
  });
});

describe('SUBS REPLACES THE FREE OCCURRENCES NEXT TO A BINDER', () => {
  test('a free j beside a Sum over j', () => {
    const result = subs(['Add', 'j', ['Sum', 'j', ['Limits', 'j', 1, 3]]], {
      j: 10,
    });
    expect(
      result.isSame(ce.box(['Add', 10, ['Sum', 'j', ['Limits', 'j', 1, 3]]]))
    ).toBe(true);
    expect(result.evaluate().json).toEqual(16);
  });

  test('a free j beside a Sum over j, replaced by a list', () => {
    const result = subs(['Add', 'j', ['Sum', 'j', ['Limits', 'j', 1, 3]]], {
      j: ['List', 4, 4, 5],
    });
    expect(result.evaluate().json).toEqual(['List', 10, 10, 11]);
  });

  test('the parse route: j + sum over j', () => {
    const result = ce.parse('j+\\sum_{j=1}^{3} j').subs({ j: 10 });
    expect(result.evaluate().json).toEqual(16);
  });

  test('a name both bound and free in one list: [j[1], [j for j in [0, 1]]]', () => {
    const result = subs(
      [
        'List',
        ['At', 'j', 1],
        ['Comprehension', 'j', ['Element', 'j', ['List', 0, 1]]],
      ],
      { j: ['List', 7, 8] }
    );
    expect(result.json).toEqual([
      'List',
      ['At', ['List', 7, 8], 1],
      ['Comprehension', 'j', ['Element', 'j', ['List', 0, 1]]],
    ]);
    expect(result.evaluate().json).toEqual(['List', 7, ['List', 0, 1]]);
  });

  test('a binder that binds another name: Sum(j·k, k) with j = 2', () => {
    const result = subs(
      ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 3]],
      {
        j: 2,
      }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Multiply', 2, 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    expect(result.evaluate().json).toEqual(12);
  });

  test('the bound of a Limits clause reads the enclosing binding', () => {
    const result = subs(['Sum', 'j', ['Limits', 'j', 1, 'j']], { j: 4 });
    expect(result.json).toEqual(['Sum', 'j', ['Limits', 'j', 1, 4]]);
    expect(result.evaluate().json).toEqual(10);
  });

  test('an earlier clause reads the enclosing binding of a later index', () => {
    const result = subs(
      [
        'Comprehension',
        ['Add', 'i', 'j'],
        ['Element', 'i', ['List', 'j', ['Add', 'j', 1]]],
        ['Element', 'j', ['List', 10, 20]],
      ],
      { j: 100 }
    );
    expect(result.json).toEqual([
      'Comprehension',
      ['Add', 'i', 'j'],
      ['Element', 'i', ['List', 100, 101]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
  });

  test('nested binders', () => {
    const result = subs(
      [
        'Sum',
        ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, 'i']],
        ['Limits', 'i', 1, 3],
      ],
      { i: 9, j: 9, x: 2 }
    );
    expect(result.json).toEqual([
      'Sum',
      ['Sum', ['Multiply', 2, 'i', 'j'], ['Limits', 'j', 1, 'i']],
      ['Limits', 'i', 1, 3],
    ]);
    // 2 · Σ_{i=1}^{3} i · i(i+1)/2 = 1 + 6 + 18, times 2
    expect(result.evaluate().json).toEqual(50);
  });

  test('an inner binder shadows a name that is free in the outer one', () => {
    const result = subs(
      ['Function', ['Add', 'x', ['Sum', 'x', ['Limits', 'x', 1, 3]]], 'y'],
      { x: 5 }
    );
    expect(result.json).toEqual([
      'Function',
      ['Block', ['Add', ['Sum', 'x', ['Limits', 'x', 1, 3]], 5]],
      'y',
    ]);
  });
});

describe('SUBS ON A RAW OR STRUCTURAL BINDER', () => {
  for (const form of ['raw', 'structural'] as const) {
    test(`${form}: the index is kept, the free name is replaced`, () => {
      const json: Json = [
        'Add',
        'k',
        ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 'k']],
      ];
      const result = subs(json, { j: 2, k: 5 }, form);
      // A raw node has no operator definition, so the free-variable walk
      // reads its `Limits` clause by its spelling, with the index bound in the
      // whole clause: the upper bound `k` is not free there, and `subs()`
      // follows the walk. A structural node is bound to the definition of
      // `Sum`, whose bounds read the enclosing `k`.
      const bound = form === 'raw' ? 'k' : 5;
      expect(result.json).toEqual([
        'Add',
        5,
        ['Sum', ['Multiply', 2, 'k'], ['Limits', 'k', 1, bound]],
      ]);
      expect(
        ce.box(json[2] as Json, { form }).freeVariables.includes('k')
      ).toBe(form !== 'raw');
    });

    test(`${form}: a Function parameter and a Block local are kept`, () => {
      expect(
        subs(['Function', ['Add', 'x', 'w'], 'x'], { x: 5, w: 1 }, form).json
      ).toEqual(['Function', ['Add', 'x', 1], 'x']);
      expect(
        subs(
          ['Block', ['Assign', 'q', 2], ['Add', 'q', 'w']],
          { q: 5, w: 1 },
          form
        ).json
      ).toEqual(['Block', ['Assign', 'q', 2], ['Add', 'q', 1]]);
    });
  }

  test('a wildcard index of a rule pattern is still replaced', () => {
    const pattern = ce.box(['Sum', '_f', ['Limits', '_k', 1, 3]], {
      form: 'raw',
    });
    expect(
      pattern.subs({ _k: ce.symbol('n'), _f: ce.symbol('n') }).json
    ).toEqual(['Sum', 'n', ['Limits', 'n', 1, 3]]);
  });
});

describe('SUBS DOES NOT AVOID VARIABLE CAPTURE', () => {
  // A replacement that holds a name the binder binds is inserted as it is: the
  // index is not renamed. This is the documented behavior of `subs()`.
  test('Sum(j + k, k) with j replaced by k', () => {
    const result = subs(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]], {
      j: 'k',
    });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    expect(result.evaluate().json).toEqual(12);
  });

  test('renaming the index first with a recursive replace() avoids it', () => {
    const sum = ce.box(['Sum', ['Add', 'j', 'k'], ['Limits', 'k', 1, 3]]);
    const renamed = sum.replace(
      { match: ce.symbol('k'), replace: ce.symbol('m') },
      { recursive: true }
    )!;
    const result = renamed.subs({ j: ce.symbol('k') });
    expect(result.json).toEqual([
      'Sum',
      ['Add', 'k', 'm'],
      ['Limits', 'm', 1, 3],
    ]);
    expect(result.evaluate().toString()).toBe('3k + 6');
  });
});

describe('SUBS REPLACES EXACTLY THE NAMES THAT freeVariables REPORTS FREE', () => {
  // For each expression and each name written in it, `subs()` of that name by
  // a fresh symbol leaves the expression unchanged exactly when the
  // free-variable walk does not report the name free.
  const names = (json: unknown, out = new Set<string>()): Set<string> => {
    if (typeof json === 'string' && /^[a-z]$/.test(json)) out.add(json);
    else if (Array.isArray(json)) for (const x of json) names(x, out);
    return out;
  };
  // The variable of a `D` or a `Series`, or of an indefinite `Integrate`, in
  // the cases below (each has one variable, its second operand).
  const pointVariable = (json: Json): string | undefined => {
    if (!Array.isArray(json)) return undefined;
    const v = json[2];
    if (json[0] === 'D' || json[0] === 'Series')
      return typeof v === 'string' ? v : undefined;
    if (json[0] !== 'Integrate') return undefined;
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v[0] === 'Limits' && v[2] === 'Nothing')
      return v[1] as string;
    return undefined;
  };
  const cases: Json[] = [
    ['D', ['Power', 'x', 2], 'x'],
    ['D', ['Multiply', 'a', ['Power', 'x', 2]], 'x'],
    ['Series', ['Sin', ['Multiply', 'a', 'x']], 'x', 0, 3],
    ['Integrate', ['Multiply', 'a', 'x'], 'x'],
    ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 0, 'b']],
    ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 'n']],
    ['Add', 'k', ['Sum', 'k', ['Limits', 'k', 1, 'k']]],
    ['Product', ['Add', 'k', 'c'], ['Limits', 'k', 1, 3]],
    ['Comprehension', ['Add', 'j', 'k'], ['Element', 'k', ['Range', 0, 'n']]],
    [
      'Comprehension',
      ['Add', 'i', 'j'],
      ['Element', 'i', ['List', 'j', 1]],
      ['Element', 'j', ['List', 10, 20]],
    ],
    ['Loop', ['Add', 'j', 'k'], ['Element', 'k', ['Range', 0, 2]]],
    ['Function', ['Add', 'x', 'w'], 'x'],
    ['Block', ['Assign', 'q', 2], ['Add', 'q', 'w']],
    ['ForAll', ['Less', 'y', 'x'], ['Element', 'x', 'Integers']],
    ['And', ['Element', 'x', 'Integers'], ['Greater', 'x', 0]],
    ['Which', ['Element', 'x', 'Integers'], 1, 'True', 0],
    ['If', ['Element', 'x', 'Integers'], ['Add', 'x', 1], 0],
    ['Add', ['Boole', ['Element', 'x', 'Integers']], 'x'],
    ['If', ['Greater', 'z', 0], ['Assign', 'z', 5], ['Assign', 'z', 6]],
    [
      'Integrate',
      ['Function', ['Multiply', 'a', 'x'], 'x', 'a'],
      ['Limits', 'x', 0, 1],
    ],
    ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 'Nothing', 'Nothing']],
    ['Set', ['Element', 'n', 'Integers'], ['Condition', ['Greater', 'n', 'c']]],
  ];
  for (const json of cases) {
    test(JSON.stringify(json), () => {
      const expr = ce.box(json);
      const free = new Set(expr.freeVariables);
      const fresh = ce.symbol('Fresh_Name');
      for (const n of names(json)) {
        const result = expr.subs({ [n]: fresh });
        const replaced = JSON.stringify(result.json).includes('Fresh_Name');
        expect([n, replaced]).toEqual([n, free.has(n)]);
        // The variable of `D`, of `Series` and of an indefinite `Integrate`
        // is free, and it is replaced at a point: the node keeps its
        // variable, and the result is the value of the node at the point.
        expect([n, result.operator === 'EvaluateAt']).toEqual([
          n,
          pointVariable(json) === n,
        ]);
      }
    });
  }
});
