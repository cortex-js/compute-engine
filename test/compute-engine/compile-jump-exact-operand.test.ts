/**
 * A function whose result jumps at a point (`Floor`, `Fract`, `Sign`, the
 * comparisons, …) applied to a closed exact operand compiles to the
 * interpreter's value, also when constant folding is off.
 *
 * The structural code computes the operand as a double, and the double can
 * be on the other side of the jump from the exact value: the double of
 * `(25! − 1)/24!` is 25.0, so `Math.floor` of it is 25, where the exact
 * value is 24. The interpreter reads the exact value (`.N()` promises a
 * correct result). Under `constantFold: false` and under a `symbolDeps`
 * capture (the implicit compilation of a `Map` body), the compiler now folds
 * such a node with the interpreter, as the default compilation does.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

const ce = new ComputeEngine();

// (25! − 1)/24! = 25 − 1/24!, a value just below 25 whose double is 25.0.
const nearInt = [
  'Divide',
  ['Subtract', ['Factorial', 25], 1],
  ['Factorial', 24],
];
const box = (json: unknown) => ce.box(json as Parameters<typeof ce.box>[0]);
const NO_FOLD = { constantFold: false } as const;

describe('Compiled jump function of a closed exact operand, no constant fold', () => {
  test('Floor gives the exact floor, not the floor of the double', () => {
    const e = box(['Floor', nearInt]);
    expect(e.N().re).toBe(24);
    const r = compile(e, NO_FOLD);
    expect(r.code).toBe('24');
    expect(r.run?.()).toBe(24);
  });

  test('Ceil gives the exact ceiling', () => {
    const e = box([
      'Ceil',
      ['Divide', ['Add', ['Factorial', 25], 1], ['Factorial', 24]],
    ]);
    expect(compile(e, NO_FOLD).run?.()).toBe(26);
  });

  test('Fract of a large exact value gives the interpreter value', () => {
    // The double of π·10³⁰ is an integer, so its fractional part was 0.
    const e = box(['Fract', ['Multiply', 'Pi', ['Power', 10, 30]]]);
    const expected = e.N().re;
    expect(expected).toBeCloseTo(0.502884197169399, 12);
    expect(compile(e, NO_FOLD).run?.()).toBeCloseTo(expected, 12);
  });

  test('Sign of an exact difference just below zero is -1', () => {
    const e = box(['Sign', ['Subtract', nearInt, 25]]);
    expect(compile(e, NO_FOLD).run?.()).toBe(-1);
  });

  test('a comparison of closed exact operands gives the exact answer', () => {
    const e = box(['Less', nearInt, 25]);
    expect(e.N().symbol).toBe('True');
    const r = compile(e, NO_FOLD);
    expect(r.code).toBe('true');
    expect(r.run?.()).toBe(true);
  });

  test('a jump inside an expression with a free variable folds alone', () => {
    const r = compile(box(['Add', 'x', ['Floor', nearInt]]), NO_FOLD);
    expect(r.code).toBe('_.x + 24');
    expect(r.run?.({ x: 0.5 })).toBe(24.5);
  });

  test('an assigned symbol holding the exact operand', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('a', ce2.box(nearInt as Parameters<typeof ce2.box>[0]));
    const r = compile(ce2.box(['Floor', 'a']), NO_FOLD);
    expect(r.run?.()).toBe(24);
  });

  describe('the structural code is kept', () => {
    test('for an operand with a free variable', () => {
      expect(compile(box(['Floor', 'x']), NO_FOLD).code).toBe(
        'Math.floor(_.x)'
      );
      expect(
        compile(box(['Floor', ['Divide', 'x', ['Factorial', 24]]]), NO_FOLD)
          .code
      ).toMatch(/^Math\.floor\(/);
    });

    test('for an operand with a float literal', () => {
      expect(compile(box(['Floor', 2.5]), NO_FOLD).code).toBe(
        'Math.floor(2.5)'
      );
    });

    test('for integer literal operands in the safe integer range', () => {
      expect(compile(box(['Sign', 3]), NO_FOLD).code).toBe('Math.sign(3)');
      expect(compile(box(['Mod', 7, 3]), NO_FOLD).code).toBe('((7) % (3))');
    });

    test('on the interval target, whose code computes an enclosure', () => {
      const r = compile(box(['Floor', nearInt]), {
        to: 'interval-js',
        ...NO_FOLD,
      });
      expect(String(r.code)).toMatch(/_IA\.floor\(/);
    });
  });
});

describe('Compiled jump function of a closed exact operand, other targets', () => {
  test('Python, no constant fold', () => {
    expect(
      compile(box(['Floor', nearInt]), { to: 'python', ...NO_FOLD }).code
    ).toBe('24');
  });

  test('Python comparison, default and no constant fold', () => {
    // The structural code was `25 < 25`, which is `False`.
    const e = box(['Less', nearInt, 25]);
    expect(compile(e, { to: 'python' }).code).toBe('True');
    expect(compile(e, { to: 'python', ...NO_FOLD }).code).toBe('True');
  });

  test('GLSL and WGSL, no constant fold', () => {
    const e = box(['Floor', nearInt]);
    expect(compile(e, { to: 'glsl', ...NO_FOLD }).code).toBe('24.0');
    expect(compile(e, { to: 'wgsl', ...NO_FOLD }).code).toBe('24.0');
  });
});

describe('Compiled jump function of a closed exact operand, symbolDeps capture', () => {
  test('the fold records the symbols the evaluation reads', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('a', ce2.box(nearInt as Parameters<typeof ce2.box>[0]));
    const deps = new Set<string>();
    const r = compile(ce2.box(['Add', 'x', ['Floor', 'a']]), {
      symbolDeps: deps,
    });
    expect(r.code).toBe('_.x + 24');
    expect(r.run?.({ x: 0 })).toBe(24);
    expect([...deps]).toContain('a');
  });

  test('a user function call in the operand keeps the structural code', () => {
    // The evaluation would read the body of `f`, which the capture set
    // cannot record, so the node is not folded.
    const ce2 = new ComputeEngine();
    ce2.declare('f', 'function');
    ce2.assign('f', ce2.parse('x \\mapsto x'));
    const deps = new Set<string>();
    const r = compile(ce2.box(['Floor', ['f', nearInt]]), {
      symbolDeps: deps,
    });
    expect(String(r.code)).toMatch(/Math\.floor\(/);
  });

  test('a compiled Map body gives the interpreter value', () => {
    const ce2 = new ComputeEngine();
    ce2.precision = 'machine';
    ce2.jit = 'auto';
    ce2.declare('L', {
      type: 'list<real>',
      value: ce2.box([
        'List',
        ...Array.from({ length: 200 }, (_, i) => i + 0.5),
      ]),
    });
    const hits = ce2._mapAutoCompileStats.compiledHits;
    const r = ce2
      .box([
        'Map',
        [
          'Function',
          ['N', ['Add', 'x', ['Floor', nearInt]]],
          'x',
        ] as Parameters<typeof ce2.box>[0],
        'L',
      ])
      .evaluate();
    const xs = [...r.each()].slice(0, 3).map((x) => x.re);
    expect(ce2._mapAutoCompileStats.compiledHits).toBeGreaterThan(hits);
    expect(xs).toEqual([24.5, 25.5, 26.5]);
  });
});

describe('Compiled jump function of a closed exact operand, shared subtrees', () => {
  // `Add(e, e)` applied n times to its own result has n + 1 distinct nodes
  // but 2ⁿ paths from the root. The checks that admit a jump node to the fold
  // must visit each node once: they run before the fold's cost estimate and
  // also under `constantFold: false`.
  const shared = (leaf: unknown, depth: number) => {
    let e = box(leaf);
    for (let i = 0; i < depth; i++)
      e = ce.function('Add', [e, e], { form: 'structural' });
    return e;
  };

  test('a shared exact operand gives the exact value', () => {
    // 2·((25! − 1)/24!) = 50 − 2/24!, so the floor is 49.
    const e = ce.function('Floor', [shared(nearInt, 1)], {
      form: 'structural',
    });
    const r = compile(e, NO_FOLD);
    expect(r.code).toBe('49');
    expect(r.run?.()).toBe(49);
  });

  test('a float in a shared subtree keeps the structural code', () => {
    const e = ce.function('Floor', [shared(['Add', nearInt, 0.5], 2)], {
      form: 'structural',
    });
    expect(String(compile(e, NO_FOLD).code)).toMatch(/Math\.floor\(/);
  });

  test('the checks visit each node of a shared operand once', () => {
    // The structural code generation of such an operand has its own cost,
    // so the two checks are called directly, at a depth where a walk of
    // every path (2⁴⁰ visits) could not finish.
    const e = ce.function('Floor', [shared(nearInt, 40)], {
      form: 'structural',
    });
    const closedExactJump = BaseCompiler['closedExactJump'];
    const recordJumpFoldReads = BaseCompiler['recordJumpFoldReads'];
    const target = { language: 'javascript' } as unknown as Parameters<
      typeof closedExactJump
    >[1];
    const start = Date.now();
    expect(closedExactJump(e, target)).toBe(true);
    expect(recordJumpFoldReads(e, new Set())).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
