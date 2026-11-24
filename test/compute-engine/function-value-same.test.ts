import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';

// Two function values of one literal have the same operands; each reads the
// locals of the activation it keeps (`captureNestedLocals`,
// `function-utils.ts`). `isSame` compares them only when they keep the same
// activation and their bodies read it (`keptActivation`, `compare.ts`).

const F = 'let f = (k) => do { let y = k; x => x + y }';

function run(src: string): any {
  const result: any = executeEpsil(new ComputeEngine(), src);
  expect(result.diagnostics ?? []).toEqual([]);
  return result.value;
}

const isTrue = (src: string) => isSymbol(run(src), 'True');

describe('the sameness of two function values of one literal', () => {
  test('two values with different activations are not the same', () => {
    expect(isTrue(`${F}\nf(1) == f(2)`)).toBe(false);
    expect(isTrue(`${F}\nf(1) == f(1)`)).toBe(false);
  });

  test('dedup keeps the values of two activations', () => {
    expect(
      run(
        `${F}\nlet L = [f(1), f(2)]\nlistFrom(map(g => g(0), dedup(L)))`
      ).toString()
    ).toBe('[1,2]');
  });

  test('two values of two calls that read one shared local are the same', () => {
    const H =
      'let h = (k) => do { let y = k; let mk = () => (x => x + y); [mk(), mk()] }';
    expect(isTrue(`${H}\nlet L = h(1)\nL[1] == L[2]`)).toBe(true);
    expect(run(`${H}\nlength(dedup(h(1)))`).toString()).toBe('1');
  });

  test('a value is the same as itself', () => {
    expect(isTrue(`${F}\nlet g = f(1)\ng == g`)).toBe(true);
  });

  test('a rebuilt value keeps its activation and stays the same', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.expr([
        'Function',
        [
          'Block',
          ['Declare', 'y', "'unknown'", 'k'],
          ['Function', ['Add', ['Multiply', 'x', 'y'], 'z'], 'x'],
        ],
        'k',
      ])
    );
    const a = ce.expr(['f', 5]).evaluate();
    const b = ce.expr(['f', 6]).evaluate();
    expect(a.isSame(b)).toBe(false);
    expect(b.isSame(a)).toBe(false);
    const a1 = a.subs({ z: 1 });
    const a2 = a.subs({ z: 1 });
    expect(a1).not.toBe(a2);
    expect(a1.isSame(a2)).toBe(true);
    expect(a1.isSame(b.subs({ z: 1 }))).toBe(false);
  });

  test('a value whose body reads no activation compares by its body', () => {
    const P = 'let f = (k) => (x => x + k)';
    expect(isTrue(`${P}\nf(1) == f(1)`)).toBe(true);
    expect(isTrue(`${P}\nf(1) == f(2)`)).toBe(false);
    expect(
      run(
        `${P}\nlet L = [f(1), f(1), f(2)]\nlistFrom(map(g => g(0), dedup(L)))`
      ).toString()
    ).toBe('[1,2]');
  });
});
