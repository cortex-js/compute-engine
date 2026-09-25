import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

//
// THE POLES OF `Tan`, `Cot`, `Sec` AND `Csc` IN COMPILED CODE
//
// The interpreter answers the unsigned pole `~oo` when the argument `x` of
// one of these functions is within its rounding error of a pole: when the
// machine value `y` is infinite or `|y|·min(|x|, 2⁴⁰)·100·2⁻⁵³ ≥ 1`
// (`isMachineTrigPole`, `numerics/numeric.ts`). Compiled JavaScript and
// Python answer `Infinity` (`np.inf`) at the same arguments, the double that
// stands for `~oo`. Without the rule, `Math.tan(π/2)` gives
// `16331239353195370`.
//

const HEADS = ['Tan', 'Cot', 'Sec', 'Csc'] as const;

/** Arguments near every pole of the four functions, and ordinary ones. */
const ANGLES: number[] = [];
for (let k = -12; k <= 12; k++) {
  const a = (k * Math.PI) / 12;
  ANGLES.push(a, a + 1e-13, a - 1e-13, a + 1e-7, a + 1e-3);
}
ANGLES.push(1e-13, -1e-13, 5e-324, -5e-324, 0.5, -2.5, 100, 1e18, 1e22, -1e22);
// The double nearest to `kπ` and to `(2k + 1)π/2` for a large `k`: a pole,
// as the allowed error is relative to the argument.
for (const k of [100, 200, 500, 1000, 1e4, 1e6, 1e9, -1000])
  ANGLES.push(k * Math.PI, ((2 * k + 1) * Math.PI) / 2);

/** Is `v` the unsigned pole `~oo`? At machine precision `N()` spells it as
 * the complex number with two infinite parts. */
function isPole(v: Expression): boolean {
  return (
    v.symbol === 'ComplexInfinity' || (v.re === Infinity && v.im === Infinity)
  );
}

function machineEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  return ce;
}

describe('compiled JavaScript answers the pole where the interpreter does', () => {
  const ce = machineEngine();

  test.each(HEADS)('%s', (head) => {
    const f = compile(ce.box([head, 'x']));
    expect(f.success).toBe(true);
    for (const x of ANGLES) {
      const expected = ce.box([head, x]).N();
      const actual = f.run!({ x }) as number;
      if (isPole(expected))
        expect([head, x, actual]).toEqual([head, x, Infinity]);
      else expect([head, x, actual]).toEqual([head, x, expected.re]);
    }
  });

  test('the four poles, spelled out', () => {
    const at = (head: string, x: number) =>
      compile(ce.box([head, 'x'])).run!({ x });
    expect(at('Tan', 1.5707963267948966)).toBe(Infinity);
    // The pole at 0 is exact, and `1e-13` is far from it relative to its
    // own rounding error: the value is the double, not the pole.
    expect(at('Cot', 1e-13)).toBe(1 / Math.tan(1e-13));
    expect(at('Cot', -1e-13)).toBe(1 / Math.tan(-1e-13));
    expect(at('Tan', 1.5707954)).toBe(Math.tan(1.5707954));
    expect(at('Sec', 1.5707963267948966)).toBe(Infinity);
    expect(at('Csc', 0)).toBe(Infinity);
    expect(at('Csc', Math.PI)).toBe(Infinity);
    // An overflow at a nonzero angle below `π/2` is not a pole but `csc` or
    // `cot` of a tiny angle, above the largest double: the value keeps the
    // sign of the angle, `-Infinity` being the compiled `-oo` (the
    // interpreter answers `-oo` at machine precision).
    expect(at('Csc', 5e-324)).toBe(Infinity);
    expect(at('Csc', -5e-324)).toBe(-Infinity);
    expect(at('Cot', 5e-324)).toBe(Infinity);
    expect(at('Cot', -5e-324)).toBe(-Infinity);
    expect(ce.box(['Csc', -5e-324]).N().toString()).toBe('-oo');
    expect(at('Tan', 1)).toBe(Math.tan(1));
    expect(at('Cot', 500 * Math.PI)).toBe(Infinity);
    expect(at('Cot', 1000 * Math.PI)).toBe(Infinity);
    expect(at('Cot', 1e4 * Math.PI)).toBe(Infinity);
    expect(at('Tan', (401 * Math.PI) / 2)).toBe(Infinity);
    expect(at('Cot', 1e22)).toBe(1 / Math.tan(1e22));
  });

  test('a literal argument folds', () => {
    expect(compile(ce.box(['Tan', 1])).code).toBe(String(Math.tan(1)));
    expect(compile(ce.box(['Add', ['Tan', 'x'], ['Tan', 1]])).code).toBe(
      `_SYS.tan(_.x) + ${Math.tan(1)}`
    );
    expect(compile(ce.box(['Tan', 1.5707963267948966])).code).toBe('Infinity');
  });
});

describe('a lazy Map over a list with a pole', () => {
  // Above a hundred elements `Tan(L).N()` is a lazy `Map` whose function is
  // compiled. A real double cannot tell `+oo` from `~oo`, so an infinite
  // compiled value is computed again by the interpreter.
  const ce = machineEngine();
  const xs = Array.from({ length: 200 }, (_, i) => 0.1 + i * 0.01);
  xs[0] = 1.5707963267948966;
  xs[1] = 1e-13;
  ce.declare('L', { value: ce.box(['List', ...xs]) });

  test.each(HEADS)('%s', (head) => {
    const lazy = ce.box([head, 'L']).N();
    const actual = [...lazy.each()].slice(0, 4).map((x) => x.json);
    const expected = xs.slice(0, 4).map((x) => ce.box([head, x]).N().json);
    expect(actual).toEqual(expected);
  });

  test('`1/x` at zero is `~oo`, as in the interpreter', () => {
    ce.declare('Z', { value: ce.box(['List', 0, ...xs]) });
    const lazy = ce.box(['Divide', 1, ['Sin', 'Z']]).N();
    expect([...lazy.each()][0].json).toEqual(
      ce.box(['Divide', 1, ['Sin', 0]]).N().json
    );
  });
});

describe('an operand used twice in the emitted code is computed once', () => {
  const ce = new ComputeEngine();
  const draws = (code: string) =>
    code.split('_SYS.drawNextRandomNumber()').length - 1;

  test.each(['Coth', 'Round', 'Fract', 'Haversine'])('%s', (head) => {
    const code = compile(ce.box([head, ['Random']])).code;
    expect(draws(code)).toBe(1);
  });

  test('an odd real root', () => {
    const code = compile(ce.box(['Root', ['Random'], 5])).code;
    expect(draws(code)).toBe(1);
  });

  test('a composite operand is bound to a temporary and read from it', () => {
    expect(compile(ce.box(['Coth', ['Add', 'x', 1]])).code).toBe(
      '(() => { const _tv1 = _.x + 1; return (Math.cosh(_tv1) / Math.sinh(_tv1)); })()'
    );
    expect(compile(ce.box(['Coth', 'n'])).code).toBe(
      '(() => { const _tv1 = _.n; return (Math.cosh(_tv1) / Math.sinh(_tv1)); })()'
    );
  });
});

describe('compiled Python answers the pole', () => {
  const py = new PythonTarget();
  const ce = machineEngine();

  test('a complex argument does not get the pole rule', () => {
    const z = ce.box(['Complex', 0, 1e-7]);
    for (const head of ['Cot', 'Csc', 'Sec'])
      expect(
        py.compile(ce.box([head, ['Multiply', z, 'x']])).code
      ).not.toContain('np.where');
  });

  test('the emitted code', () => {
    // An infinite value at a nonzero angle below `π/2` keeps its sign (an
    // overflow of `csc` or `cot` of a tiny angle, not a pole); the inner
    // `np.where` is the pole rule itself.
    const rule =
      '(lambda _y: np.where(np.isinf(_y) & (_x != 0) & ' +
      '(np.abs(_x) < 1.5707963267948966), _y, ' +
      'np.where(np.isinf(_y) | (np.abs(_y) * ' +
      'np.minimum(np.abs(_x), 1099511627776.0) * 1.1102230246251565e-14 ' +
      '>= 1), np.inf, _y))[()])';
    expect(py.compileFunction(ce.box(['Tan', 'x']), 'f', ['x'])).toContain(
      `(lambda _x: ${rule}(np.tan(_x)))(x)`
    );
    // No module-level helper, so a bare lambda can hold it.
    expect(py.compileLambda(ce.box(['Cot', 'x']), ['x'])).toBe(
      `lambda x: (lambda _x: ${rule}(1 / np.tan(_x)))(x)`
    );
  });

  const venvPython = [
    path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
    path.join(process.cwd(), 'venv', 'bin', 'python3'),
  ].find((p) => fs.existsSync(p));
  const hasNumpy = (() => {
    if (!venvPython) return false;
    try {
      execFileSync(venvPython, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  const testMaybe = hasNumpy ? test : test.skip;

  testMaybe('the values, run by numpy', () => {
    let src = 'import numpy as np\nimport json\n\n';
    for (const head of HEADS)
      src += py.compileFunction(ce.box([head, 'x']), `f_${head}`, ['x']) + '\n';
    // A signed infinity (`csc` of `±5·10⁻³²⁴`) is `'inf'`/`'-inf'`, the
    // unsigned pole `'inf'`.
    const spell = (v: Expression): number | 'inf' | '-inf' =>
      isPole(v) || v.re === Infinity
        ? 'inf'
        : v.re === -Infinity
          ? '-inf'
          : v.re;
    const expected: Array<number | 'inf' | '-inf'> = [];
    src += 'r = []\n';
    for (const head of HEADS) {
      for (const x of ANGLES) {
        expected.push(spell(ce.box([head, x]).N()));
        src += `r.append(f_${head}(${x}))\n`;
      }
      // An array argument: the rule applies to each element.
      src += `r.extend(f_${head}(np.array([${ANGLES.join(', ')}])).tolist())\n`;
      for (const x of ANGLES) expected.push(spell(ce.box([head, x]).N()));
    }
    src +=
      'print(json.dumps([("inf" if v > 0 else "-inf") if np.isinf(v) ' +
      'else float(v) for v in r]))\n';
    const file = path.join(os.tmpdir(), `ce-py-poles-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(venvPython!, ['-W', 'ignore', file], {
        encoding: 'utf8',
      });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Array<number | 'inf' | '-inf'>;
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i];
      const a = actual[i];
      if (e === 'inf' || e === '-inf') expect([i, a]).toEqual([i, e]);
      // Relative: a value near a pole that is not a pole is large (`cot` of
      // `π/12·k + 10⁻⁷` is about `10⁷`), and numpy and V8 can differ in the
      // last bit of it.
      else if (
        !(Math.abs((a as number) - e) <= 1e-9 * Math.max(1, Math.abs(e)))
      )
        expect([i, a]).toEqual([i, e]);
    }
  });
});
