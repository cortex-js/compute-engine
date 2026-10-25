/**
 * An assignment to a typed parameter whose value is not of the type of the
 * parameter fails the compilation (CE-228). The interpreter types an
 * unannotated parameter of a range callback from the range elements
 * (`integer`) and gives an `incompatible-type` error for `q = 0/0`; the
 * compiled code emitted the assignment with no check and gave `[2, 2, 2]`
 * (and the string "1,21" for `q = [1, 2]`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function callback(body: unknown): unknown {
  return ['Map', ['Function', body, 'q'], ['Range', 1, 3]];
}

function both(json: unknown) {
  const interpreted = new ComputeEngine()
    .box(json as never)
    .evaluate()
    .toString();
  try {
    const result = compile(new ComputeEngine().box(json as never), {
      to: 'javascript',
      fallback: false,
    });
    return { interpreted, compiled: result.run!({} as never) };
  } catch (e) {
    return { interpreted, error: (e as Error).message };
  }
}

describe('COMPILE an assignment to a typed parameter', () => {
  it('declines `q = 0/0` in a range callback', () => {
    const r = both(
      callback([
        'Block',
        ['Assign', 'q', ['Divide', 0, 0]],
        ['If', ['Less', 'q', 0], 1, 2],
      ])
    );
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.error).toMatch(
      /assigns `Indeterminate`.*parameter `q` of type `integer`/
    );
  });

  it('declines a list assigned to the parameter', () => {
    const r = both(
      callback(['Block', ['Assign', 'q', ['List', 1, 2]], ['Add', 'q', 1]])
    );
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.error).toMatch(/parameter `q` of type `integer`/);
  });

  it('declines a value that is not an integer (folded under `.N()` before)', () => {
    const r = both(
      callback(['Block', ['Assign', 'q', ['Add', 'q', 0.5]], ['Add', 'q', 1]])
    );
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.error).toMatch(/assigns `q \+ 0\.5`/);
  });

  it('compiles a value of the type of the parameter', () => {
    const r = both(
      callback([
        'Block',
        ['Assign', 'q', ['Multiply', 'q', 2]],
        ['Add', 'q', 1],
      ])
    );
    expect(r.interpreted).toBe('[3,5,7]');
    expect(r.compiled).toEqual([3, 5, 7]);
  });

  it('declines the same write in an annotated Epsil function', () => {
    const source = 'function f(k: integer) { k = k + 0.5; k }\nf(2)';
    const box = (ce: ComputeEngine) =>
      ce.box(
        parseEpsil(source, {
          parseLatex: (l: string) => ce.parse(l).json,
        })[0] as never
      );
    expect(box(new ComputeEngine()).evaluate().toString()).toMatch(
      /incompatible-type/
    );
    expect(() =>
      compile(box(new ComputeEngine()), { to: 'javascript', fallback: false })
    ).toThrow(/parameter `k` of type `integer`/);
  });

  it('a bare parameter takes any value', () => {
    const source = 'function f(k) { k = [1, 2]; k }\nf(3)';
    const box = (ce: ComputeEngine) =>
      ce.box(
        parseEpsil(source, {
          parseLatex: (l: string) => ce.parse(l).json,
        })[0] as never
      );
    expect(box(new ComputeEngine()).evaluate().toString()).toBe('[1,2]');
    const result = compile(box(new ComputeEngine()), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.run!({} as never)).toEqual([1, 2]);
  });
});
