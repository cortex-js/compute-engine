import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `Root(z, n)` of a COMPLEX radicand. The JavaScript lowering chose its
// complex branch from the node's type only, and `Root(x + iy, 3)` types
// `number`, so it emitted `Math.cbrt({re, im})` and answered NaN at every
// point, `y = 0` included. The enclosing expression's analysis reads the
// operands and expected a `{re, im}` value from the node. The Python lowering
// emitted `np.sign(z) * np.power(np.abs(z), 1/3)`, which is wrong for a
// complex `z`: `np.sign(z)` is `z / |z|` and `np.abs(z)` drops the argument.
//
// The interpreter's convention: a radicand whose imaginary part is zero,
// under an odd integer degree, has the REAL root (`Root(-8, 3)` is `-2`); any
// other pair has the principal value `z^(1/n)`.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');
  return ce;
}

type Case = {
  latex: string;
  vars: Record<string, number | [number, number]>;
};

const CASES: Case[] = [
  { latex: '\\sqrt[3]{x+iy}', vars: { x: 0.5, y: 0.25 } },
  { latex: '\\sqrt[3]{x+iy}', vars: { x: -8, y: 0 } },
  { latex: '\\sqrt[3]{x+iy}', vars: { x: -0.5, y: -1.5 } },
  { latex: '\\sqrt[4]{x+iy}', vars: { x: -8, y: 0 } },
  { latex: '\\sqrt[4]{x+iy}', vars: { x: 0.5, y: 0.25 } },
  { latex: '\\sqrt[5]{x+iy}', vars: { x: 0.5, y: 0.25 } },
  { latex: '\\sqrt[5]{x+iy}', vars: { x: -32, y: 0 } },
  { latex: '\\sqrt[n]{x+iy}', vars: { x: 0.5, y: 0.25, n: 3 } },
  { latex: '\\sqrt[n]{x+iy}', vars: { x: -8, y: 0, n: 3 } },
  { latex: '\\sqrt[n]{x+iy}', vars: { x: -8, y: 0, n: 2 } },
  { latex: '\\sqrt[3]{x+iy}+1', vars: { x: 0.5, y: 0.25 } },
  { latex: '2\\sqrt[3]{x+iy}', vars: { x: -8, y: 0 } },
  { latex: '\\sqrt[3]{z}', vars: { z: [-8, 0] } },
  { latex: '\\sqrt[3]{z}', vars: { z: [1, 1] } },
  { latex: '\\sqrt[x]{2+i}', vars: { x: 2 } },
];

/** The interpreter's value at `vars`, as `[re, im]`. */
function interpreted(ce: ComputeEngine, c: Case): [number, number] {
  const subs: Record<string, any> = {};
  for (const [k, v] of Object.entries(c.vars))
    subs[k] = Array.isArray(v) ? ce.number(ce.complex(v[0], v[1])) : v;
  const n = ce.parse(c.latex).subs(subs).N();
  return [n.re, n.im];
}

describe('COMPILED ROOT OF A COMPLEX RADICAND', () => {
  for (const c of CASES)
    for (const mode of ['strict', 'auto', 'complex'] as const)
      it(`javascript ${mode}: ${c.latex} at ${JSON.stringify(c.vars)}`, () => {
        const ce = engine();
        const result = compile(ce.parse(c.latex), {
          to: 'javascript',
          mode,
          fallback: false,
        } as any) as any;
        expect(result.success).toBe(true);
        const vars: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c.vars))
          vars[k] = Array.isArray(v) ? { re: v[0], im: v[1] } : v;
        const out = result.run(vars);
        const re = typeof out === 'number' ? out : out.re;
        const im = typeof out === 'number' ? 0 : out.im;
        const [eRe, eIm] = interpreted(ce, c);
        expect(re).toBeCloseTo(eRe, 12);
        expect(im).toBeCloseTo(eIm, 12);
      });

  // The two reference values the fix was reported against.
  it('the interpreter values the cases rest on', () => {
    const ce = engine();
    const [re, im] = interpreted(ce, CASES[0]);
    expect(re).toBeCloseTo(0.8139559382747513, 14);
    expect(im).toBeCloseTo(0.1268074709786297, 14);
    expect(interpreted(ce, CASES[1])).toEqual([-2, 0]);
  });
});

const VENV_PYTHON =
  [
    path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
    path.join(process.cwd(), 'venv', 'bin', 'python3'),
  ].find((p) => fs.existsSync(p)) ??
  path.join(process.cwd(), 'venv', 'bin', 'python3');

function venvHasNumpy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeNumpy = venvHasNumpy() ? describe : describe.skip;

describeNumpy('COMPILED ROOT OF A COMPLEX RADICAND — Python (venv)', () => {
  it('answers the interpreter value', () => {
    const ce = engine();
    const python = new PythonTarget();
    let program = 'import numpy as np\nimport cmath, json\n\n';
    const params = CASES.map((c) => Object.keys(c.vars));
    CASES.forEach((c, i) => {
      program += `${python.compileFunction(ce.parse(c.latex), `fn_${i}`, params[i])}\n`;
    });
    program += 'out = []\n';
    CASES.forEach((c, i) => {
      const args = params[i]
        .map((k) => {
          const v = c.vars[k];
          return Array.isArray(v) ? `complex(${v[0]}, ${v[1]})` : String(v);
        })
        .join(', ');
      program += `r = complex(fn_${i}(${args}))\nout.append([r.real, r.imag])\n`;
    });
    program += 'print(json.dumps(out))\n';

    const file = path.join(os.tmpdir(), `ce-py-croot-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let stdout = '';
    try {
      stdout = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(stdout) as [number, number][];
    CASES.forEach((c, i) => {
      const [eRe, eIm] = interpreted(ce, c);
      expect([c.latex, i, actual[i][0]]).toEqual([
        c.latex,
        i,
        expect.closeTo(eRe, 12),
      ]);
      expect([c.latex, i, actual[i][1]]).toEqual([
        c.latex,
        i,
        expect.closeTo(eIm, 12),
      ]);
    });
  });
});
