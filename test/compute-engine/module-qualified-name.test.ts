import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// `["Module", name]` names the definition of `name` in the system scope (the
// standard library), also in a scope where a local definition shadows the
// name. Its canonical form is the symbol bound to the library definition,
// and `["Apply", ["Module", "Floor"], x]` is the call `Floor(x)` bound to the
// library operator. The serializers write the form only where the bare name
// would read another definition (`hidesLibraryBinding()`,
// `library-shadowing.ts`). Design: `docs/plans/2026-11-07-ce1099-std-module.md`.
//

describe('the Module operator', () => {
  test('a constant is the library symbol', () => {
    const ce = new ComputeEngine();
    const pi = ce.box(['Module', 'Pi']);
    expect(pi).toBe(ce.Pi);
    expect(pi.json).toBe('Pi');
  });

  test('a function through Apply is the library call', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Apply', ['Module', 'Floor'], 2.5]);
    expect(call.json).toEqual(['Floor', 2.5]);
    expect(call.evaluate().toString()).toBe('2');
  });

  test('a qualified function is a function operand', () => {
    const ce = new ComputeEngine();
    const mapped = ce.box(['Map', ['Module', 'Floor'], ['List', 1.5, 2.5]]);
    expect(mapped.json).toEqual(['Map', 'Floor', ['List', 1.5, 2.5]]);
    expect(mapped.evaluate().toString()).toBe('[1,2]');
  });

  test('a name that is not in the library is an error', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Module', 'Floo']).json).toEqual([
      'Error',
      "'not-a-library-name'",
      'Floo',
    ]);
    // The name is not declared as a side effect.
    expect(ce.lookupDefinition('Floo')).toBeUndefined();
  });

  test('a second operand is reserved', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Module', 'Pi', "'mine'"]);
    expect(expr.isValid).toBe(false);
    expect(expr.operator).toBe('Module');
    expect(JSON.stringify(expr.json)).toContain('unexpected-argument');
  });

  test('a second operand is an error also when ce.strict is false', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    const expr = ce.box(['Module', 'Pi', "'mine'"]);
    expect(expr.isValid).toBe(false);
    expect(expr.operator).toBe('Module');
    expect(JSON.stringify(expr.json)).toContain('unexpected-argument');
  });

  test('an operand that is not a symbol is a type error', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Module', 2]);
    expect(expr.isValid).toBe(false);
    expect(expr.operator).toBe('Module');
  });

  test('the structural and raw forms keep the operator', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Module', 'Pi'], { form: 'structural' }).json).toEqual([
      'Module',
      'Pi',
    ]);
    expect(ce.box(['Module', 'Pi'], { form: 'raw' }).json).toEqual([
      'Module',
      'Pi',
    ]);
  });
});

describe('the serialized form of a library binding', () => {
  test('outside a scope that shadows the name, the bare name is written', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Add', 'Pi', ['Floor', 'x']]);
    expect(e.json).toEqual(['Add', ['Floor', 'x'], 'Pi']);
    expect(e.toMathJson()).toEqual(['Add', ['Floor', 'x'], 'Pi']);
  });

  test('CE-103: a JSON round trip in a scope that shadows Pi keeps π', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    let r;
    try {
      ce.declare('Pi', 'real');
      ce.assign('Pi', 3);
      r = ce
        .box(['Sum', ['Divide', 1, ['Power', 'n', 2]], ['Limits', 'n', 1, 'PositiveInfinity']])
        .evaluate();
      expect(r.json).toEqual(['Divide', ['Power', ['Module', 'Pi'], 2], 6]);
      expect(r.toMathJson()).toEqual([
        'Divide',
        ['Square', ['Module', 'Pi']],
        6,
      ]);
      // Boxed again in the scope, the JSON reads the library constant
      // (π²/6 = 1.6449…), not the local `Pi` (3²/6 = 1.5).
      expect(ce.box(r.json).N().re).toBeCloseTo(Math.PI ** 2 / 6, 12);
      expect(ce.box(r.toMathJson()).N().re).toBeCloseTo(Math.PI ** 2 / 6, 12);
      // The local `Pi` is written with its bare name.
      expect(ce.box('Pi').json).toBe('Pi');
      expect(ce.box('Pi').N().re).toBe(3);
      // LaTeX has no spelling of the qualifier.
      expect(r.latex).toBe('\\frac{\\pi^2}{6}');
    } finally {
      ce.popScope();
    }
    expect(r.json).toEqual(['Divide', ['Power', 'Pi', 2], 6]);
  });

  test('a library call made before a shadowing function keeps its binding', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Floor', 'x']);
    ce.pushScope();
    try {
      ce.assign('Floor', ce.box(['Function', 100, 'y']));
      ce.assign('x', 2.5);
      expect(call.json).toEqual(['Apply', ['Module', 'Floor'], 'x']);
      expect(call.toMathJson()).toEqual(['Apply', ['Module', 'Floor'], 'x']);
      expect(call.evaluate().toString()).toBe('2');
      // The round trip calls the library function: 2, not 100.
      expect(ce.box(call.json).evaluate().toString()).toBe('2');
      // Nested in another expression, as the `.json` of the parent writes
      // the structural form of the call.
      const sum = ce.box(['Add', call, 0.25]);
      expect(sum.json).toEqual(['Add', ['Apply', ['Module', 'Floor'], 'x'], 0.25]);
      expect(sum.evaluate().re).toBe(2.25);
      expect(ce.box(sum.json).evaluate().re).toBe(2.25);
      // A bare call in the scope reads the local function.
      expect(ce.box(['Floor', 'x']).evaluate().toString()).toBe('100');
      expect(
        ce.box(['Apply', ['Module', 'Floor'], 'x']).evaluate().toString()
      ).toBe('2');
      expect(sum.latex).toBe('\\lfloor x\\rfloor+0.25');
    } finally {
      ce.popScope();
    }
    expect(call.json).toEqual(['Floor', 'x']);
  });
});

describe('a definition that is not a shadow writes no qualifier', () => {
  test('an extension of the library operator', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Sin', 'x']);
    ce.declare('Sin', { description: 'the sine' }, { extend: true });
    expect(call.json).toEqual(['Sin', 'x']);
    expect(call.toMathJson()).toEqual(['Sin', 'x']);
  });

  test('a variable that cannot be applied, at a call head', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['N', ['Divide', 1, 3]]);
    ce.pushScope();
    try {
      ce.box(['Declare', 'N', 'integer']).evaluate();
      ce.box(['Assign', 'N', 85]).evaluate();
      // `["N", x]` calls the library operator here: the variable `N` is an
      // integer, which cannot be applied.
      expect(call.json).toEqual(['N', ['Rational', 1, 3]]);
      expect(call.toMathJson()).toEqual(['N', ['Rational', 1, 3]]);
      expect(ce.box(call.json).evaluate().re).toBeCloseTo(1 / 3, 12);
    } finally {
      ce.popScope();
    }
  });
});

describe('the serialization options apply to the qualifier', () => {
  test('without shorthands, the qualifier is written in the object forms', () => {
    const ce = new ComputeEngine();
    const call = ce.box(['Floor', 'x']);
    ce.pushScope();
    try {
      ce.declare('Pi', 'real');
      ce.assign('Pi', 3);
      ce.assign('Floor', ce.box(['Function', 100, 'y']));
      expect(ce.box(['Module', 'Pi']).toMathJson({ shorthands: [] })).toEqual({
        fn: ['Module', { sym: 'Pi' }],
      });
      expect(call.toMathJson({ shorthands: [] })).toEqual({
        fn: ['Apply', { fn: ['Module', { sym: 'Floor' }] }, { sym: 'x' }],
      });
    } finally {
      ce.popScope();
    }
  });
});

describe('the serialized form inside a scoped node', () => {
  test('a function literal with a parameter Pi keeps the library Pi', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['Module', 'Pi'], 'Pi'], 'Pi']);
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Add', 'Pi', ['Module', 'Pi']]],
      'Pi',
    ]);
    expect(f.toMathJson()).toEqual([
      'Function',
      ['Add', 'Pi', ['Module', 'Pi']],
      'Pi',
    ]);
    // π + 3, not 3 + 3.
    expect(ce.box(['Apply', f, 3]).N().re).toBeCloseTo(Math.PI + 3, 12);
    for (const json of [f.json, f.toMathJson()])
      expect(ce.box(['Apply', ce.box(json), 3]).N().re).toBeCloseTo(
        Math.PI + 3,
        12
      );
  });

  test('a block with a local Pi keeps the library Pi', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'Pi', 'real', 3],
      ['Add', ['Module', 'Pi'], 'Pi'],
    ]);
    expect(block.json).toEqual([
      'Block',
      ['Declare', 'Pi', 'real', 3],
      ['Add', 'Pi', ['Module', 'Pi']],
    ]);
    expect(block.evaluate().N().re).toBeCloseTo(Math.PI + 3, 12);
    expect(ce.box(block.json).evaluate().N().re).toBeCloseTo(Math.PI + 3, 12);
    // Outside the block, the library `Pi` is written with its bare name.
    expect(ce.box(['Add', ['Module', 'Pi'], 1]).json).toEqual(['Add', 1, 'Pi']);
  });
});

describe('the scope where the MathJSON is read again', () => {
  test('a function literal made at the top level, serialized in a scope that binds Pi', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 'Pi'], 'x']);
    ce.pushScope();
    try {
      ce.declare('Pi', 'real');
      ce.assign('Pi', 3);
      expect(f.json).toEqual([
        'Function',
        ['Block', ['Add', 'x', ['Module', 'Pi']]],
        'x',
      ]);
      expect(ce.box(['Apply', ce.box(f.json), 0]).N().re).toBe(Math.PI);
    } finally {
      ce.popScope();
    }
    expect(f.json).toEqual(['Function', ['Block', ['Add', 'x', 'Pi']], 'x']);
  });
});

describe('the head Module reads the library operator whatever is bound', () => {
  test('a Declare of Module in a block is not hoisted', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'Module', 'integer', 5],
      ['Module', 'Pi'],
    ]);
    expect(block.localScope?.bindings.has('Module')).toBe(false);
    expect(block.ops[1].N().re).toBe(Math.PI);
    expect(block.evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'module-binding'", "'Module'"],
    ]);
  });

  test('a Declare of Missing in a block is not hoisted', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'Missing', 'integer', 5],
      'Missing',
    ]);
    expect(block.localScope?.bindings.has('Missing')).toBe(false);
    expect(block.ops[1].type.toString()).toBe('missing');
  });

  test('a parameter named Module', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['Module', 'Pi'], 'Module'], 'Module']);
    expect(ce.box(['Apply', f, 2]).N().re).toBeCloseTo(Math.PI + 2, 12);
  });

  test('a Sum index named Module', () => {
    const ce = new ComputeEngine();
    const sum = ce.box([
      'Sum',
      ['Add', ['Module', 'Pi'], 'Module'],
      ['Limits', 'Module', 1, 2],
    ]);
    expect(sum.N().re).toBeCloseTo(2 * Math.PI + 3, 12);
  });
});

describe('a qualified call boxes its arguments as the library call does', () => {
  test('a held operand stays held', () => {
    const ce = new ComputeEngine();
    const plain = ce.box(['Head', ['Add', 1, 2]]).evaluate();
    const qualified = ce
      .box(['Apply', ['Module', 'Head'], ['Add', 1, 2]])
      .evaluate();
    expect(qualified.json).toEqual(plain.json);
  });
});

describe('a qualified call in a scope that shadows the name', () => {
  test('a library If with an Assign branch under a user If is an error', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('If', ce.box(['Function', 0, 'a', 'b', 'c']));
      ce.declare('y', 'integer');
      const e = ce.box(['Apply', ['Module', 'If'], 'True', ['Assign', 'y', 1], 2]);
      expect(e.json).toEqual(['Error', "'qualified-call-shadowed'", 'If']);
    } finally {
      ce.popScope();
    }
  });

  test('the outer call reads the library, the inner call the user function', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Floor', ce.box(['Function', 100, 'y']));
      ce.declare('x', 'real');
      const e = ce.box(['Apply', ['Module', 'Floor'], ['Floor', 'x']]);
      expect(e.json).toEqual(['Apply', ['Module', 'Floor'], ['Floor', 'x']]);
      // The user `Floor` gives 100 at x = 2.5, and the library floor of 100
      // is 100. Read as two library calls, it would be 2.
      expect(e.subs({ x: 2.5 }).evaluate().re).toBe(100);
      expect(ce.box(e.json).subs({ x: 2.5 }).evaluate().re).toBe(100);
    } finally {
      ce.popScope();
    }
  });

  test('a parameter with the name of a library-bound callee of Apply', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.assign('Floor', ce.box(['Function', ['Add', 'x', 100], 'x']));
      const q = ce.box(['Module', 'Floor']);
      const f = ce.box([
        'Function',
        ['Tuple', 'Floor', ['Apply', q, 2.5]],
        'Floor',
      ]);
      expect(ce.box(['Apply', f, 10]).evaluate().json).toEqual([
        'Tuple',
        10,
        2,
      ]);
    } finally {
      ce.popScope();
    }
  });
});

describe('Module cannot be rebound', () => {
  test('a declaration, an assignment or a definition of Module is an error', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      for (const statement of [
        ['Declare', 'Module', 'integer', 5],
        ['Assign', 'Module', 5],
        ['Assign', 'Module', ['Function', 0, 'x']],
      ] as const) {
        const r = ce.box(statement as any).evaluate();
        expect(r.json).toEqual([
          'Error',
          ['ErrorCode', "'module-binding'", "'Module'"],
        ]);
        expect(ce.box(['Module', 'Pi']).N().re).toBe(Math.PI);
        expect(ce.box(['Apply', ['Module', 'Floor'], 2.5]).evaluate().re).toBe(
          2
        );
      }
    } finally {
      ce.popScope();
    }
  });
});

describe('compilation (no lowering of its own)', () => {
  test('a qualified constant compiles to the library value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Pi', 'real');
      ce.assign('Pi', 3);
      const e = ce.box(['Add', ['Module', 'Pi'], 'Pi']);
      expect(e.N().re).toBeCloseTo(Math.PI + 3, 12);
      const f = compile(e);
      expect(f.success).toBe(true);
      expect(f.run!({})).toBeCloseTo(Math.PI + 3, 12);
    } finally {
      ce.popScope();
    }
  });

  test('an input of a union type named Pi, in a graph with many paths', () => {
    // A declared union of shapes compiles one body per member: the root is
    // boxed again in a scope that declares the input `Pi` with the member
    // type. With more than 10,000 paths, it is boxed again node by node, and
    // the library `Pi` keeps its binding there too.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Pi', 'real | list<real>');
      const small = ce.box(['Add', ['Module', 'Pi'], 'Pi']);
      let big = small;
      for (let i = 0; i < 16; i++)
        big = ce.function('Add', [big, ce.function('Sqrt', [big])]);
      let expected = Math.PI + 1;
      for (let i = 0; i < 16; i++) expected += Math.sqrt(expected);
      const f = compile(small, { fallback: false });
      expect(f.success).toBe(true);
      expect(f.run!({ Pi: 1 })).toBeCloseTo(Math.PI + 1, 12);
      const g = compile(big, { fallback: false });
      expect(g.success).toBe(true);
      expect(g.run!({ Pi: 1 })).toBeCloseTo(expected, 9);
    } finally {
      ce.popScope();
    }
  });

  test('a shadowed library call declines with the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ce.assign('Floor', ce.box(['Function', 100, 'y']));
      const call = ce.box(['Apply', ['Module', 'Floor'], 'x']);
      const f = compile(call);
      expect(f.success).toBe(false);
      expect(Number(f.run!({ x: 2.5 }))).toBe(2);
    } finally {
      warn.mockRestore();
      ce.popScope();
    }
  });
});

describe('qualified calls: review fixes of the option 2 design', () => {
  test('a qualified call before any other reference of a parameter of the same name reads the library', () => {
    // The parameter `Floor` gets its binding on its first reference, so the
    // qualified call is the first place where the body names it.
    const ce = new ComputeEngine();
    const f = ['Function', ['Apply', ['Module', 'Floor'], 2.5], 'Floor'];
    expect(ce.box(['Apply', f, 10] as any).evaluate().json).toBe(2);
  });

  test('the library `Not` of a user call `Not(p)` is not folded to `p`', () => {
    // The `Not(Not(x))` fold applies only when the inner call is bound to the
    // same definition as the outer call.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Not', 'function');
      ce.declare('p', 'boolean');
      const r = ce
        .box(['Apply', ['Module', 'Not'], ['Not', 'p']] as any)
        .evaluate();
      expect(r.symbol).toBeUndefined();
      expect(r.json).toEqual(['Apply', ['Module', 'Not'], ['Not', 'p']]);
    } finally {
      ce.popScope();
    }
    // With no shadow, the fold of the library operator still applies.
    expect(ce.box(['Not', ['Not', 'q']]).json).toBe('q');
    expect(ce.box(['Abs', ['Abs', 'x']]).json).toEqual(['Abs', 'x']);
  });
});
