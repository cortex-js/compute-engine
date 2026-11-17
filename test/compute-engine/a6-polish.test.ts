import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

describe('A6 polish — lowercase count alias', () => {
  test('\\operatorname{count}(L) parses to Length', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{count}([1,2,3])');
    expect(expr.json).toEqual(['Length', ['List', 1, 2, 3]]);
  });
});

describe('A6 polish — 2-arg arctan → Arctan2', () => {
  test('single-arg \\arctan stays Arctan', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(0.5)');
    expect(expr.operator).toEqual('Arctan');
    expect(expr.ops?.length).toEqual(1);
  });

  test('two-arg \\arctan(y, x) lowers to Arctan2', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
  });

  test('two-arg \\arctan in expression context', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\frac{180\\arctan(y, x)}{\\pi}');
    expect(expr.isValid).toBe(true);
  });
});

describe('A6 polish — Repeat arity', () => {
  test('1-arg Repeat keeps infinite-list semantics', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5)');
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(1);
    expect(expr.isValid).toBe(true);
  });

  test('2-arg Repeat(value, count) returns a finite list', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 3)').evaluate();
    expect(expr.json).toEqual(['List', 5, 5, 5]);
  });

  test('2-arg Repeat parses without error', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 3)');
    expect(expr.isValid).toBe(true);
  });

  test('Repeat(value, 0) evaluates to empty list', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 0)').evaluate();
    expect(expr.json).toEqual(['List']);
  });

  test('Repeat with negative count clamps to empty', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, -2)').evaluate();
    expect(expr.json).toEqual(['List']);
  });

  test('Repeat with symbolic count remains unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse('\\operatorname{repeat}(5, n)').evaluate();
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(2);
  });

  test('Repeat with large count stays unevaluated (lazy access still works)', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Repeat', 5, 100000]).evaluate();
    // Did not materialize a huge list.
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(2);
  });

  test('Repeat with count at the cap still materializes', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Repeat', 5, 10000]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.ops?.length).toEqual(10000);
  });
});

describe('Repeat of a value that is not pure (CE-1396)', () => {
  // A value that is not pure is evaluated once per element, in order, in
  // every position, as the body of `Map(_ ↦ v, Range(1, n))`; a pure value
  // is evaluated once and copied.
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.assign('L', ce.box(['List', 1, 2, 3]));
  ce.declare('c', 'integer');
  ce.declare('g', 'function');
  ce.assign('g', ce.box(['Function', ['Random'], 'z']));
  const seeded = (json: unknown) =>
    JSON.stringify(
      ce
        .box(['WithRandomSeed', 3, json] as never)
        .evaluate()
        .N().json
    );
  /** The first `k` draws of the seed 3. */
  const draws = (k: number) =>
    seeded(['List', ...Array.from({ length: k }, () => ['Random'])]);
  const R = ['Repeat', ['Random'], 3];
  const M = ['Map', ['Function', ['Random'], 'k'], ['Range', 1, 3]];

  test('by itself: three draws, in order', () => {
    expect(seeded(R)).toBe(draws(3));
    expect(seeded(['Repeat', ['g', 1], 3])).toBe(draws(3));
    // Nested: six draws.
    expect(seeded(['Flatten', ['Repeat', R, 2]])).toBe(draws(6));
  });

  test('every consumer reads the list of the equivalent Map', () => {
    for (const f of [
      (x: unknown) => ['Max', x],
      (x: unknown) => ['Min', x],
      (x: unknown) => ['List', ['At', x, 2], ['Random']],
      (x: unknown) => ['ListJoin', x, ['List', 9]],
      (x: unknown) => ['Sum', x],
      (x: unknown) => ['Product', x],
      (x: unknown) => ['Add', x, ['List', 1, 2, 3]],
      (x: unknown) => ['Add', x, 'L'],
      (x: unknown) => ['Add', x, 1],
      (x: unknown) => ['Multiply', x, ['List', 1, 2, 3]],
      (x: unknown) => ['Multiply', x, 'L'],
      (x: unknown) => ['Multiply', x, 2],
      (x: unknown) => ['Sin', x],
      (x: unknown) => [
        'Sum',
        ['Map', ['Function', ['Multiply', 't', 10], 't'], x],
      ],
    ])
      expect([f('R'), seeded(f(R))]).toEqual([f('R'), seeded(f(M))]);
  });

  test('Length evaluates the list, as of a list literal; a count of 0 draws nothing', () => {
    expect(seeded(['List', ['Length', R], ['Random']])).toBe(
      seeded([
        'List',
        ['Length', ['List', ['Random'], ['Random'], ['Random']]],
        ['Random'],
      ])
    );
    expect(seeded(['List', ['Repeat', ['Random'], 0], ['Random']])).toBe(
      seeded(['List', ['List'], ['Random']])
    );
  });

  test('the unbounded list evaluates the value at each element read', () => {
    expect(
      seeded(['ListJoin', ['Take', ['Repeat', ['Random']], 3], ['List']])
    ).toBe(draws(3));
    expect(seeded(['At', ['Repeat', ['Random']], 2])).toBe(seeded(['Random']));
  });

  test('a write: once per element in every position', () => {
    const run = (f: (x: unknown) => unknown) => {
      ce.assign('c', 1);
      const v = ce
        .box(
          f([
            'Repeat',
            ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'c'],
            3,
          ]) as never
        )
        .evaluate().json;
      return [v, ce.box('c').evaluate().json];
    };
    expect(run((x) => x)).toEqual([['List', 2, 3, 4], 4]);
    expect(run((x) => ['Sum', x])).toEqual([9, 4]);
    expect(run((x) => ['Max', x])).toEqual([4, 4]);
    expect(run((x) => ['At', x, 2])).toEqual([3, 4]);
  });

  test('a pure value: evaluated once, the forms unchanged', () => {
    expect(ce.box(['Repeat', ['Add', 'x', 1], 3]).evaluate().json).toEqual([
      'List',
      ['Add', 'x', 1],
      ['Add', 'x', 1],
      ['Add', 'x', 1],
    ]);
    expect(ce.box(['Repeat', ['Add', 1, 2]]).evaluate().json).toEqual([
      'Repeat',
      3,
    ]);
    const r = ce.box(R as never);
    expect(r.json).toEqual(R);
    expect(r.latex).toBe('\\mathrm{Repeat}(\\mathrm{Random}(), 3)');
  });

  test('boxing, serializing, typing and compiling evaluate nothing', () => {
    // A host operator that is not pure counts its evaluations.
    let ticks = 0;
    const te = new ComputeEngine();
    te.declare('Tick', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => te.number(++ticks),
    });
    const json = ['Add', ['Repeat', ['Tick'], 3], 1];
    const count = (f: () => unknown) => {
      ticks = 0;
      f();
      return ticks;
    };
    const e = te.box(json as never);
    expect({
      box: count(() => te.box(json as never)),
      json: count(() => te.box(json as never).json),
      type: count(() => te.box(json as never).type.toString()),
      latex: count(() => te.box(json as never).latex),
      parse: count(() => te.parse(e.latex)),
      compileIr: count(() => {
        try {
          compile(te.box(json as never), { profile: 'ir', fallback: false });
        } catch {}
      }),
      compile: count(() => compile(te.box(json as never))),
    }).toEqual({
      box: 0,
      json: 0,
      type: 0,
      latex: 0,
      parse: 0,
      compileIr: 0,
      compile: 0,
    });
    expect([count(() => e.evaluate()), e.evaluate().json]).toEqual([
      3,
      ['List', 5, 6, 7],
    ]);
    // A symbolic count that has a value when the expression is boxed.
    te.declare('m', 'integer');
    te.assign('m', 3);
    ticks = 0;
    const s = te.box(['Add', ['Repeat', ['Tick'], 'm'], 1] as never);
    expect([ticks, s.evaluate().json, ticks]).toEqual([
      0,
      ['List', 2, 3, 4],
      3,
    ]);
  });

  test('a write in a numeric operand is not run by boxing', () => {
    ce.assign('c', 1);
    const e = ce.box([
      'Add',
      ['Repeat', ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'c'], 3],
      1,
    ] as never);
    expect(ce.box('c').evaluate().json).toBe(1);
    expect(e.evaluate().json).toEqual(['List', 3, 4, 5]);
    expect(ce.box('c').evaluate().json).toBe(4);
  });

  test('above maxCollectionSize: the values and evaluations of the lazy Map', () => {
    // `First(Sort(Map(…)))` and `Length(Unique(Map(…)))` of an impure body
    // are older defects of `Map` at this size: they are not pinned here.
    let ticks = 0;
    const te = new ComputeEngine();
    te.declare('Tick', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => te.number(++ticks),
    });
    const n = te.maxCollectionSize + 1;
    const die = ['Add', ['Floor', ['Multiply', 6, ['Random']]], 1];
    const run = (json: unknown) => {
      ticks = 0;
      const v = te
        .box(json as never)
        .evaluate()
        .N().json;
      return [JSON.stringify(v), ticks];
    };
    for (const [v, f] of [
      [['Tick'], (x: unknown) => ['Mean', x]],
      [['Tick'], (x: unknown) => ['Max', x]],
      [['Tick'], (x: unknown) => ['Min', x]],
      [['Tick'], (x: unknown) => ['Variance', x]],
      [['Tick'], (x: unknown) => ['Contains', x, 5]],
      [['Tick'], (x: unknown) => ['At', ['ListJoin', x, ['List', 9]], 1]],
      [die, (x: unknown) => ['WithRandomSeed', 3, ['Count', x, 6]]],
      [['Random'], (x: unknown) => ['WithRandomSeed', 3, ['Max', x]]],
    ] as [unknown, (x: unknown) => unknown][]) {
      const repeat = run(f(['Repeat', v, n]));
      const map = run(f(['Map', ['Function', v, 'k'], ['Range', 1, n]]));
      expect([f('R'), repeat]).toEqual([f('R'), map]);
    }
    // Sorted under a seed.
    const sorted = te
      .box(['WithRandomSeed', 3, ['Sort', ['Repeat', ['Random'], n]]] as never)
      .evaluate()
      .N().json as unknown[];
    const xs = sorted.slice(1).map(Number);
    expect(xs).toHaveLength(n);
    expect(xs.every((x, i) => i === 0 || xs[i - 1] <= x)).toBe(true);
    // A pure value stays a lazy `Repeat`.
    const pure = te.box(['Repeat', ['Add', 'x', 1], n] as never);
    expect(pure.evaluate().json).toEqual(['Repeat', ['Add', 'x', 1], n]);
    expect(pure.json).toEqual(['Repeat', ['Add', 'x', 1], n]);
  });

  test('under a seed, the draws of the literal list', () => {
    expect(seeded(['Add', R, 1])).toBe(
      seeded(['Add', ['List', ['Random'], ['Random'], ['Random']], 1])
    );
  });
});

describe('A6 polish — operatorInfo gaps', () => {
  test('operatorInfo returns entries for Length, Complex, Colon, Prime', () => {
    const ce = new ComputeEngine();
    expect(ce.operatorInfo('Length')).toBeDefined();
    expect(ce.operatorInfo('Complex')).toBeDefined();
    expect(ce.operatorInfo('Colon')).toBeDefined();
    expect(ce.operatorInfo('Prime')).toBeDefined();
  });

  test('L.count still parses to Length and resolves via operatorInfo', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('[1, 2, 3].\\operatorname{count}');
    expect(expr.operator).toEqual('Length');
    expect(ce.operatorInfo('Length')?.kind).toEqual('function');
  });

  test('Length on a decided non-collection is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Length', 5]).evaluate();
    // The number 5 refutes the collection contract, and a decided question
    // may not be answered by staying inert (docs/ERROR-MODEL.md §1), so the
    // answer is the same `incompatible-type` error `Count(5)` gives. It must
    // NOT be a finite integer result like 0, nor NaN, nor the inert form.
    expect(expr.operator).toEqual('Error');
    expect(expr.toString()).toContain('incompatible-type');
  });

  test('Length on an infinite collection is +oo', () => {
    // User decision 2026-09-27: `Length` answers `+oo` for every infinite
    // collection, as `Count` does.
    const ce = new ComputeEngine();
    const expr = ce
      .parse('\\operatorname{count}(\\operatorname{repeat}(5))')
      .evaluate();
    expect(expr.toString()).toBe('+oo');
  });

  test('Length on a value-bound symbol resolves through the binding', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.assign('L', ['List', 1, 2, 3]);
    const expr = ce.expr(['Length', 'L']).evaluate();
    expect(expr.json).toEqual(3);
  });
});

describe('A6 polish — symbolInfo API', () => {
  test('symbolInfo returns entries for transcendental constants', () => {
    const ce = new ComputeEngine();
    for (const name of [
      'Pi', 'ExponentialE', 'EulerGamma', 'CatalanConstant', 'GoldenRatio',
    ]) {
      const info = ce.symbolInfo(name);
      expect(info).toBeDefined();
      expect(info?.kind).toEqual('constant');
      expect(info?.type.toString()).toMatch(/real|number/);
    }
  });

  test('symbolInfo returns entries for boolean / special-value constants', () => {
    const ce = new ComputeEngine();
    expect(ce.symbolInfo('True')?.kind).toEqual('constant');
    expect(ce.symbolInfo('False')?.kind).toEqual('constant');
    // Infinity canonicalizes to PositiveInfinity; NaN and ImaginaryUnit are
    // registered as value definitions directly.
    expect(ce.symbolInfo('PositiveInfinity')).toBeDefined();
    expect(ce.symbolInfo('NaN')).toBeDefined();
    expect(ce.symbolInfo('ImaginaryUnit')).toBeDefined();
  });

  test('symbolInfo returns undefined for unknown symbols', () => {
    const ce = new ComputeEngine();
    expect(ce.symbolInfo('NotARealConstant')).toBeUndefined();
  });

  test('symbolInfo returns undefined for operator heads', () => {
    const ce = new ComputeEngine();
    // Operator heads should be queried via operatorInfo, not symbolInfo.
    expect(ce.symbolInfo('Add')).toBeUndefined();
  });

  test('symbolInfo returns kind: "variable" for user-declared variables', () => {
    const ce = new ComputeEngine();
    ce.declare('myVar', 'real');
    const info = ce.symbolInfo('myVar');
    expect(info).toBeDefined();
    expect(info?.kind).toEqual('variable');
    expect(info?.type.toString()).toMatch(/real/);
  });
});

describe('A6 polish — normalizeIdentifier', () => {
  test('strips LaTeX braces from subscripted names', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('R_{3}')).toEqual('R_3');
    expect(ce.normalizeIdentifier('f_{Bm}')).toEqual('f_Bm');
    expect(ce.normalizeIdentifier('C_{ustomizablecolor}')).toEqual('C_ustomizablecolor');
    expect(ce.normalizeIdentifier('S_{orry}')).toEqual('S_orry');
  });

  test('converts Greek command names', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('\\theta_x')).toEqual('theta_x');
    expect(ce.normalizeIdentifier('\\alpha')).toEqual('alpha');
  });

  test('leaves already-canonical names unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('R_3')).toEqual('R_3');
    expect(ce.normalizeIdentifier('c_1')).toEqual('c_1');
    expect(ce.normalizeIdentifier('theta_x')).toEqual('theta_x');
  });

  test('does NOT auto-declare the name', () => {
    const ce = new ComputeEngine();
    ce.normalizeIdentifier('R_{3}');
    // After normalize, declare should succeed without "already declared".
    expect(() =>
      ce.declare('R_3', '(number, number) -> number'),
    ).not.toThrow();
  });

  test('returns empty string for unparseable input', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('')).toEqual('');
    expect(ce.normalizeIdentifier('1 + 2')).toEqual(''); // not an identifier
  });
});

describe('Desmos compat — trailing stray backslash', () => {
  test('trailing bare \\ at end of input is tolerated', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('C_{x}=\\operatorname{hsv}\\left(1,1,1\\right)\\');
    expect(expr.json).toEqual(['Equal', 'C_x', ['Hsv', 1, 1, 1]]);
    expect(expr.isValid).toBe(true);
  });

  test('trailing \\ after a simple expression', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x+1\\');
    expect(expr.json).toEqual(['Add', 'x', 1]);
    expect(expr.isValid).toBe(true);
  });

  test('trailing \\ after a function call', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x)\\');
    expect(expr.json).toEqual(['Sin', 'x']);
    expect(expr.isValid).toBe(true);
  });

  test('named space commands still tolerated (regression)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x\\,').json).toEqual('x');
    expect(ce.parse('x\\quad').json).toEqual('x');
    expect(ce.parse('x\\;').json).toEqual('x');
  });

  test('trailing space command before bare \\ is also tolerated', () => {
    const ce = new ComputeEngine();
    // Verifies the order of operations: skipVisualSpace runs before the
    // bare-\ check, so `x\,\` (visual space + bare \ + EOF) is accepted.
    const expr = ce.parse('x\\,\\');
    expect(expr.json).toEqual('x');
    expect(expr.isValid).toBe(true);
  });
});

describe('Desmos compat — \\tan^{-1}(y, x) → Arctan2', () => {
  test('single-arg \\tan^{-1}(x) stays Arctan(x)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan^{-1}(x)');
    expect(expr.operator).toEqual('Arctan');
    expect(expr.ops?.length).toEqual(1);
  });

  test('two-arg \\tan^{-1}(y, x) lowers to Arctan2(y, x)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan^{-1}(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
    expect(expr.isValid).toBe(true);
  });

  test('two-arg \\tan^{-1} inside a larger expression', () => {
    const ce = new ComputeEngine();
    // Mirrors the Desmos "Domain coloring" row from the corpus:
    //   p + u\tan^{-1}(\operatorname{imag}(...), \operatorname{real}(...))
    const expr = ce.parse(
      '\\tan^{-1}(\\operatorname{imag}(z), \\operatorname{real}(z))'
    );
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.isValid).toBe(true);
  });

  test('\\arctan(y, x) still lowers to Arctan2 (regression)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
  });

  test('\\sin^{-1}(x) still parses as Arcsin (regression)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin^{-1}(x)');
    expect(expr.operator).toEqual('Arcsin');
    expect(expr.ops?.length).toEqual(1);
  });
});

describe('Desmos compat — tuples inside function-call arguments', () => {
  test('triangle with plain-paren tuples (3-component points)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{triangle}\\left((-3.3,1,1.2),(-2,1.9,1.3),(-2.5,2.5,1.4)\\right)'
    );
    expect(expr.operator).toEqual('Triangle');
    expect(expr.ops?.length).toEqual(3);
    expect(expr.isValid).toBe(true);
  });

  test('triangle with \\left(\\right) tuples (Gomoku-style)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{triangle}\\left(' +
        '\\left(1, 2, 3\\right),' +
        '\\left(4, 5, 6\\right),' +
        '\\left(7, 8, 9\\right)' +
      '\\right)'
    );
    expect(expr.operator).toEqual('Triangle');
    expect(expr.ops?.length).toEqual(3);
    expect(expr.isValid).toBe(true);
  });

  test('arbitrary function with tuple arguments', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f\\left(\\left(1, 2\\right), \\left(3, 4\\right)\\right)');
    expect(expr.operator).toEqual('f');
    expect(expr.ops?.length).toEqual(2);
    expect(expr.isValid).toBe(true);
  });
});

describe('Desmos compat — D_{...} subscripted identifiers vs Euler derivative', () => {
  test('D_{etectsize} alone parses as a symbol', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('D_{etectsize}').json).toEqual('D_etectsize');
  });

  test('D_{etectsize} followed by an operand stays a symbol', () => {
    // Previously the EulerDerivative parser engaged on `D` + subscript and
    // misread the multi-letter subscript as a differentiation variable,
    // swallowing the trailing term as the function to differentiate.
    const ce = new ComputeEngine();
    const expr = ce.parse('D_{etectsize}-7');
    expect(expr.json).toEqual(['Add', 'D_etectsize', -7]);
    expect(expr.isValid).toBe(true);
  });

  test('D_{etectsize} inside a larger expression is valid', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{floor}(x)-D_{etectsize}-7');
    expect(expr.isValid).toBe(true);
  });

  test('single-letter Euler notation D_x f still differentiates', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('D_x \\sin(x)');
    expect(expr.operator).toEqual('D');
    expect(expr.isValid).toBe(true);
  });

  test('second-order Euler notation D^2_x f still differentiates', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('D^2_x f');
    expect(expr.operator).toEqual('D');
    expect(expr.isValid).toBe(true);
  });
});

describe('Desmos compat — trailing visual space does not wrap in Tuple', () => {
  test('color constructor followed by \\, is not wrapped', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\operatorname{hsv}(1,1,1)\\,').json).toEqual([
      'Hsv',
      1,
      1,
      1,
    ]);
  });

  test('color constructor followed by \\quad is not wrapped', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\operatorname{rgb}(1,1,1)\\quad').json).toEqual([
      'Rgb',
      1,
      1,
      1,
    ]);
  });

  test('\\left(\\right) color constructor + trailing \\, is not wrapped', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\operatorname{hsv}\\left(1,1,1\\right)\\,').json
    ).toEqual(['Hsv', 1, 1, 1]);
  });

  test('unit quantity with visual space still parses (regression)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('12\\,\\mathrm{cm}').json).toEqual(['Quantity', 12, 'cm']);
  });

  test('number-space-symbol is still multiplication (regression)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('2\\,x').json).toEqual(['Multiply', 2, 'x']);
  });
});
