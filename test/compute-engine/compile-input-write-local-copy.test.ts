/**
 * A compiled body that assigns an input declines.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` writes a symbol of the engine. The interpreter changes the
 * engine's binding. Compiled code writes only the locals that it declares, so
 * the compilation declines on every target: the host can return the value and
 * assign it, or the body can declare a local with a value and read the local.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const range = ['Element', 'i', ['Range', 1, 3]];

/** [name, MathJSON]. Each one assigns `u`. */
const PROGRAMS: [string, any][] = [
  [
    'u ≔ u + 1, then a read',
    ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 'u', 2]],
  ],
  [
    'an accumulation in a loop',
    ['Block', ['Loop', ['Assign', 'u', ['Add', 'u', 'i']], range], 'u'],
  ],
];

const DECLINE = /"u" is not a local of the compiled expression/;

/** The interpreter's value with `u = 5`. */
function interpreted(src: any): number {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.assign('u', 5);
  return ce.box(src).evaluate().re;
}

describe('JAVASCRIPT: AN INPUT THAT THE BODY ASSIGNS', () => {
  // A write to a symbol declared in the engine declines.
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(() => compile(ce.box(src), { fallback: false })).toThrow(DECLINE);
    });

  test('a body that writes no input reads the caller object as before', () => {
    const ce = new ComputeEngine();
    const c = compile(ce.parse('x + 1'), { fallback: false }) as any;
    expect(c.code).toBe('_.x + 1');
  });
});

describe('INTERVAL-JS: AN INPUT THAT THE BODY ASSIGNS', () => {
  // A write to a symbol declared in the engine declines.
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const c = compile(ce.box(src), {
        to: 'interval-js',
        fallback: false,
      }) as any;
      expect(c.success).toBe(false);
      expect(c.error).toMatch(DECLINE);
    });
});

describe('PYTHON: AN INPUT THAT THE BODY ASSIGNS', () => {
  // A write to a symbol declared in the engine declines. A parameter of the
  // function is a local, so a write to a parameter `u` compiles.
  const py = new PythonTarget({ includeImports: true });
  for (const [name, src] of PROGRAMS)
    test(`compileFunction(): ${name}`, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(() => py.compileFunction(ce.box(src), 'g', ['x'])).toThrow(
        DECLINE
      );
    });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'compileFunction(): a write to a parameter u gives the interpreter value',
    () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      let program = 'import json\nout = []\n';
      PROGRAMS.forEach(([, src], k) => {
        program += py.compileFunction(ce.box(src), `p${k}`, ['u']) + '\n';
        program += `out.append(p${k}(5.0))\n`;
      });
      program += 'print(json.dumps(out))\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as number[];
      PROGRAMS.forEach(([name, src], k) => {
        expect([name, out[k]]).toEqual([name, interpreted(src)]);
      });
    }
  );

  test('compile(): u ≔ u + 1, then a read', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    expect(() => new PythonTarget().compile(ce.box(PROGRAMS[0][1]))).toThrow(
      DECLINE
    );
  });
});

describe('PYTHON: A SUM WHOSE BODY IS A STATEMENT', () => {
  // The Python lowering of `Sum`/`Product` is a generator expression, whose
  // element is an expression. A body with an assignment gave
  // `sum(_tv1 = k + _tv1 ⏎ return _tv1 for k in range(1, 4))`, a syntax
  // error. Such a body is now a `for` loop with an accumulator, written
  // ahead of the body's value (`compile-statement-forms.test.ts`).
  const py = new PythonTarget();
  const limits = ['Limits', 'k', 1, 3];

  test('a block that writes an input declines', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const src = [
      'Sum',
      ['Block', ['Assign', 'u', ['Add', 'u', 'k']], 'u'],
      limits,
    ];
    expect(() => py.compile(ce.box(src))).toThrow(DECLINE);
  });

  (TEST_PYTHON === undefined ? it.skip : it)('a block with a local', () => {
    const ce = new ComputeEngine();
    const src = [
      'Sum',
      [
        'Block',
        ['Declare', 't', "'unknown'", ['Add', 'k', 1]],
        ['Multiply', 't', 't'],
      ],
      limits,
    ];
    const code = py.compile(ce.box(src)).code;
    expect(code).toMatch(/^for _tv\d+ in range\(1, 4\):$/m);
    // The input `u` is read, never written.
    expect(code).not.toMatch(/(^|[^\w.])u\s*=[^=]/m);
    const indent = code
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
    const out = execFileSync(
      TEST_PYTHON!,
      [
        '-c',
        `import json\nu = 5.0\ndef g():\n${indent}\nprint(json.dumps([g(), u]))`,
      ],
      { encoding: 'utf8' }
    );
    expect(JSON.parse(out)).toEqual([interpreted(src), 5]);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'a block whose value is an expression still runs',
    () => {
      const ce = new ComputeEngine();
      const src = ['Sum', ['Block', ['Multiply', 'k', 'k']], limits];
      const code = py.compile(ce.box(src)).code;
      const out = execFileSync(
        TEST_PYTHON!,
        ['-c', `import json\nprint(json.dumps(${code}))`],
        { encoding: 'utf8' }
      );
      expect(JSON.parse(out)).toBe(ce.box(src).evaluate().re);
    }
  );
});
