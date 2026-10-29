import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// CE-604 (Tycho ledger row 476), user decision 2026-10-28: an integral whose
// integrand calls a user function with a list argument,
// `∫_a^b y·c(y, L, E) dy` with `E` a list, is the list of the integrals
// `∫_a^b y·c(y, L, E_k) dy`. Each element keeps the call `c(…)`, as the
// integral with one element of `E` in place of the list does. Before, the
// list route evaluated the whole integrand to find the list, and wrote the
// body of `c` into each element.

const DEFINITIONS = [
  String.raw`d(x,r)\coloneq\max\left(0,\sqrt{x^2+r^2}-1\right)`,
  String.raw`n(x,r,e_{ps})\coloneq\frac{1}{\max\left(e_{ps},d\left(x,r\right)\right)}\begin{cases}\begin{cases}1&x<-\sqrt{1-r^2}\\0&\text{otherwise}\end{cases}&r\le1\\1&\text{otherwise}\end{cases}`,
  String.raw`c(y,D,e_{ps})\coloneq\int_{-D}^Dn\left(x,y,e_{ps}\right)dx`,
];
const E = [0.001, 0.005, 0.01, 0.05, 0.1, 0.2];
const BOUNDS = [
  ['0', '1'],
  ['.8', '1'],
  ['1', '1.2'],
  ['1', '2'],
];
const head = (lo: string, hi: string, eps: string): string =>
  String.raw`\int_{${lo}}^{${hi}}y\cdot c\left(y,L,${eps}\right)dy`;

function documentEngine(e: number[] = E): ComputeEngine {
  const ce = new ComputeEngine();
  for (const definition of DEFINITIONS) ce.parse(definition).evaluate();
  ce.assign('E', ce.parse(`[${e.join(',')}]`));
  ce.declare('L', 'real');
  return ce;
}

/**
 * The same engine with each function HELD AS A VALUE, as Tycho's document
 * manager stores it: the name is declared `function`, then the function
 * literal is assigned to it (no operator definition).
 */
function valueEngine(e: number[] = E): ComputeEngine {
  const ce = new ComputeEngine();
  for (const definition of DEFINITIONS) {
    const json = ce.parse(definition).json as [string, string, unknown];
    expect(json[0]).toBe('Assign');
    ce.declare(json[1], 'function');
    ce.assign(json[1], ce.expr(json[2] as any));
  }
  ce.assign('E', ce.parse(`[${e.join(',')}]`));
  ce.declare('L', 'real');
  return ce;
}

/** True when the MathJSON `json` has a call of the operator `name`. */
function hasCall(json: unknown, name: string): boolean {
  if (!Array.isArray(json)) return false;
  if (json[0] === name) return true;
  return json.some((x) => hasCall(x, name));
}

describe('CE-604: the list route keeps the call', () => {
  test('the four Tycho heads: one integral per element, with the call kept', () => {
    const ce = documentEngine();
    for (const [lo, hi] of BOUNDS) {
      const value = ce.parse(head(lo, hi, 'E')).evaluate();
      expect(value.operator).toBe('List');
      expect(value.nops).toBe(E.length);
      value.ops!.forEach((element, k) => {
        expect(element.operator).toBe('Integrate');
        const json = element.json;
        expect(hasCall(json, 'c')).toBe(true);
        // The body of `c` (the inner integral of `n`) is not written in.
        expect(hasCall(json, 'n')).toBe(false);
        expect(JSON.stringify(json)).toContain(
          JSON.stringify(['c', 'y', 'L', E[k]])
        );
        // The same form as the integral with one element of `E`.
        expect(json).toEqual(
          ce.parse(head(lo, hi, String(E[k]))).evaluate().json
        );
      });
    }
  });

  test('the four Tycho heads, with the functions held as values', () => {
    const ce = valueEngine();
    for (const [lo, hi] of BOUNDS) {
      const value = ce.parse(head(lo, hi, 'E')).evaluate();
      expect(value.operator).toBe('List');
      expect(value.nops).toBe(E.length);
      value.ops!.forEach((element, k) => {
        expect(element.operator).toBe('Integrate');
        expect(hasCall(element.json, 'n')).toBe(false);
        expect(JSON.stringify(element.json)).toContain(
          JSON.stringify(['c', 'y', 'L', E[k]])
        );
        expect(element.json).toEqual(
          ce.parse(head(lo, hi, String(E[k]))).evaluate().json
        );
      });
    }
  });

  test('functions held as values: the values equal those with one element', () => {
    const e = [0.001, 0.2];
    const ce = valueEngine(e);
    ce.assign('L', 0.5);
    const list = ce.parse(head('0', '1', 'E')).N();
    expect(list.operator).toBe('List');
    e.forEach((eps, k) => {
      const scalar = ce.parse(head('0', '1', String(eps))).N().re;
      expect(Number.isFinite(scalar)).toBe(true);
      expect(Math.abs(list.ops![k].re - scalar)).toBeLessThan(1e-9);
    });
  });

  test('a function held as a value, in a scope that declares another one', () => {
    // Each element is the integral with one element of `E`, evaluated in
    // the same scope. The values are not checked here: the integral with
    // one element reads the function of the inner scope under `evaluate()`
    // (its integrand is re-bound by name in the current scope by
    // `liftIntegrand()`, `boxed-expression/utils.ts`), which is a defect of
    // that route and not of the split.
    const e = [0.001, 0.2];
    const ce = valueEngine(e);
    ce.assign('L', 0.5);
    const integral = ce.parse(head('0', '1', 'E'));
    const scalars = e.map((eps) => ce.parse(head('0', '1', String(eps))));
    const outer = integral.N().ops!.map((x) => x.re);
    ce.pushScope();
    ce.declare('c', 'function');
    ce.assign('c', ce.parse(String.raw`(a,b,d)\mapsto 100`));
    const shadowed = integral.evaluate();
    const shadowedN = integral.N();
    const scalarJson = scalars.map((s) => s.evaluate().json);
    const scalarN = scalars.map((s) => s.N().json);
    ce.popScope();
    expect(shadowed.operator).toBe('List');
    shadowed.ops!.forEach((element, k) =>
      expect(element.json).toEqual(scalarJson[k])
    );
    shadowedN.ops!.forEach((element, k) =>
      expect(element.json).toEqual(scalarN[k])
    );
    // After the inner scope is popped, the values are those of the outer
    // `c` again.
    const after = integral.N().ops!.map((x) => x.re);
    expect(Number.isFinite(outer[0])).toBe(true);
    after.forEach((v, k) => expect(Math.abs(v - outer[k])).toBeLessThan(1e-9));
  });

  test('a function held as a value that the split declines', () => {
    // A parameter declared as a collection binds the list whole: the
    // integral is the integral of the evaluated call, `x + 3`.
    {
      const ce = new ComputeEngine();
      ce.assign('E', ce.parse('[1, 2, 3]'));
      ce.declare('f', '(real, real | list) -> real');
      ce.assign('f', ce.parse(String.raw`(t,a)\mapsto t+\max(a)`));
      const integral = ce.parse(String.raw`\int_0^1 f(x,E)\,dx`).evaluate();
      expect(integral.json).toEqual(['Rational', 7, 2]);
      const call = ce.parse(String.raw`f(x,E)`).evaluate();
      expect(
        ce
          .box(['Integrate', ['Function', call.json, 'x'], ['Limits', 'x', 0, 1]])
          .evaluate().json
      ).toEqual(integral.json);
    }
    // More arguments than parameters: the same error as the call, for each
    // element.
    {
      const ce = new ComputeEngine();
      ce.assign('E', ce.parse('[1, 2]'));
      ce.declare('f', 'function');
      ce.assign('f', ce.parse(String.raw`(t,a)\mapsto t^2+a`));
      const integral = ce.parse(String.raw`\int_0^1 f(x,E,1)\,dx`).evaluate();
      const call = ce.parse(String.raw`f(x,E,1)`).evaluate();
      expect(integral.operator).toBe('List');
      expect(call.operator).toBe('List');
      integral.ops!.forEach((element, k) => {
        expect(element.operator).toBe('Error');
        expect(element.ops![0].json).toEqual(call.ops![k].ops![0].json);
        expect(element.ops![0].string).toBe('unexpected-argument');
      });
    }
    // A literal that calls itself: the integral is the integral of the
    // evaluated integrand.
    {
      const ce = new ComputeEngine();
      ce.assign('E', ce.parse('[1, 2]'));
      ce.declare('r', 'function');
      ce.assign(
        'r',
        ce.parse(
          String.raw`(t,a)\mapsto\begin{cases}t & a\le1\\ r(t,a-1)+t & \text{otherwise}\end{cases}`
        )
      );
      const integral = ce.parse(String.raw`\int_0^1 r(x,E)\,dx`).evaluate();
      const call = ce.parse(String.raw`r(x,E)`).evaluate();
      expect(
        ce
          .box(['Integrate', ['Function', call.json, 'x'], ['Limits', 'x', 0, 1]])
          .evaluate().json
      ).toEqual(integral.json);
      expect(integral.ops![0].json).toEqual(['Rational', 1, 2]);
    }
  });

  test('a function held as a value with a whole-collection parameter', () => {
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2, 3]'));
    ce.declare('h', 'function');
    ce.assign('h', ce.parse(String.raw`(t,e)\mapsto t\cdot\operatorname{Length}(e)`));
    expect(
      ce.parse(String.raw`\int_0^1 h(x,E)\,dx`).evaluate().json
    ).toEqual(['Rational', 3, 2]);
    ce.declare('f', 'function');
    ce.assign('f', ce.parse(String.raw`(t,a)\mapsto t^2+a`));
    const value = ce.parse(String.raw`\int_0^1 f(x,E)\,dx`).evaluate();
    expect(value.json).toEqual([
      'List',
      ['Rational', 4, 3],
      ['Rational', 7, 3],
      ['Rational', 10, 3],
    ]);
  });

  test('box route', () => {
    const ce = documentEngine();
    const value = ce
      .box([
        'Integrate',
        ['Function', ['Multiply', 'y', ['c', 'y', 'L', 'E']], 'y'],
        ['Limits', 'y', 0, 1],
      ])
      .evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(E.length);
    for (const element of value.ops!) {
      expect(element.operator).toBe('Integrate');
      expect(hasCall(element.json, 'c')).toBe(true);
      expect(hasCall(element.json, 'n')).toBe(false);
    }
  });

  test('the values equal those of the integrals with one element', () => {
    const e = [0.001, 0.2];
    const ce = documentEngine(e);
    // The symbolic result, with `L` valueless, takes the value of `L` when
    // it is assigned afterwards.
    const symbolic = ce.parse(head('0', '1', 'E')).evaluate();
    ce.assign('L', 0.5);
    const list = ce.parse(head('0', '1', 'E')).N();
    expect(list.operator).toBe('List');
    e.forEach((eps, k) => {
      const scalar = ce.parse(head('0', '1', String(eps))).N().re;
      expect(Number.isFinite(scalar)).toBe(true);
      expect(Math.abs(list.ops![k].re - scalar)).toBeLessThan(1e-9);
      expect(Math.abs(symbolic.ops![k].N().re - scalar)).toBeLessThan(1e-9);
    });
  });

  test('ce.function route', () => {
    const ce = documentEngine();
    const y = ce.symbol('y');
    const value = ce
      .function('Integrate', [
        ce.function('Function', [
          ce.function('Multiply', [
            y,
            ce.function('c', [y, ce.symbol('L'), ce.symbol('E')]),
          ]),
          y,
        ]),
        ce.function('Limits', [y, ce.number(0), ce.number(1)]),
      ])
      .evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(E.length);
    for (const element of value.ops!) {
      expect(element.operator).toBe('Integrate');
      expect(hasCall(element.json, 'c')).toBe(true);
      expect(hasCall(element.json, 'n')).toBe(false);
    }
  });

  test('a scope that declares another function with the same name', () => {
    // Each element keeps the binding of `c` it was parsed with, as the
    // broadcast of the call does, and is the integral with one element of
    // `E` evaluated in the same scope. The function of the inner scope
    // (`c = 100`, whose integral would be 50) is never called.
    const e = [0.001, 0.2];
    const ce = documentEngine(e);
    ce.assign('L', 0.5);
    const integral = ce.parse(head('0', '1', 'E'));
    const scalars = e.map((eps) => ce.parse(head('0', '1', String(eps))));
    const outer = integral.N().ops!.map((x) => x.re);
    ce.pushScope();
    ce.declare('c', 'function');
    ce.assign('c', ce.parse(String.raw`(a,b,d)\mapsto 100`));
    const shadowed = integral.evaluate();
    const shadowedN = integral.N();
    const scalarJson = scalars.map((s) => s.evaluate().json);
    const scalarN = scalars.map((s) => s.N().json);
    ce.popScope();
    expect(shadowed.operator).toBe('List');
    shadowed.ops!.forEach((element, k) => {
      expect(hasCall(element.json, 'c')).toBe(true);
      expect(element.json).toEqual(scalarJson[k]);
    });
    shadowedN.ops!.forEach((element, k) => {
      expect(element.json).toEqual(scalarN[k]);
      expect(element.re).not.toBe(50);
    });
    // Outside the inner scope, the values are those of the outer `c`.
    expect(Number.isFinite(outer[0])).toBe(true);
    expect(outer[0]).not.toBe(50);
  });

  test('a Block-local argument', () => {
    const e = [0.001, 0.2];
    const ce = documentEngine(e);
    const value = ce
      .box([
        'Block',
        ['Assign', 'a', 0.5],
        [
          'Integrate',
          ['Function', ['Multiply', 'y', ['c', 'y', 'a', 'E']], 'y'],
          ['Limits', 'y', 0, 1],
        ],
      ])
      .N();
    expect(value.operator).toBe('List');
    e.forEach((eps, k) => {
      const scalar = ce.parse(head('0', '1', String(eps)).replace('L', '0.5'));
      expect(Math.abs(value.ops![k].re - scalar.N().re)).toBeLessThan(1e-9);
    });
  });

  test('an argument with an effect is evaluated once for all the elements', () => {
    // As the broadcast does: one draw of `Random()`, shared by the elements.
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2]'));
    ce.parse(String.raw`r(t,a)\coloneq t+a`).evaluate();
    const value = ce
      .box([
        'Integrate',
        ['Function', ['r', ['Random'], 'E'], 'x'],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    expect(value.operator).toBe('List');
    const [a, b] = value.ops!.map((x) => x.re);
    expect(Math.abs(b - a - 1)).toBeLessThan(1e-12);
  });

  test('a parameter that takes the whole collection is not mapped', () => {
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2, 3]'));
    ce.parse(String.raw`h(t,e)\coloneq t\cdot\operatorname{Length}(e)`).evaluate();
    expect(
      ce.parse(String.raw`\int_0^1 h(x,E)\,dx`).evaluate().json
    ).toEqual(['Rational', 3, 2]);
  });

  test('a function that returns a list gives a list of lists', () => {
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2]'));
    ce.parse(String.raw`g(t,a)\coloneq[t,a]`).evaluate();
    expect(
      ce.parse(String.raw`\int_0^1 g(x,E)\,dx`).evaluate().json
    ).toEqual([
      'List',
      ['List', ['Rational', 1, 2], 1],
      ['List', ['Rational', 1, 2], 2],
    ]);
  });

  test('a list integrand that is not a call of a user function', () => {
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2, 3]'));
    const integral = (src: string): Expression => ce.parse(src).evaluate();
    expect(integral(String.raw`\int_0^1 [x, 2x]\,dx`).json).toEqual([
      'List',
      ['Rational', 1, 2],
      1,
    ]);
    expect(integral(String.raw`\int_0^1 x E\,dx`).json).toEqual([
      'List',
      ['Rational', 1, 2],
      1,
      ['Rational', 3, 2],
    ]);
  });

  test('an integrand with no call of a user function is evaluated whole', () => {
    // The split is only for a list mapped through a call of a user
    // function. These integrands hold `Sum`, `D` and `Product`, which the
    // evaluation of the whole integrand computes; the results are those of
    // the route that evaluates the integrand.
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2]'));
    const integral = (body: unknown) =>
      ce
        .box(['Integrate', ['Function', body, 'x'], ['Limits', 'x', 0, 1]])
        .evaluate().json;
    expect(
      integral(['Multiply', ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]], 'E'])
    ).toEqual(['List', 3, 6]);
    expect(
      integral(['Multiply', ['D', ['Power', 'x', 3], 'x'], 'E'])
    ).toEqual(['List', 1, 2]);
    expect(
      integral(['Multiply', ['Product', 'x', ['Limits', 'k', 1, 2]], 'E'])
    ).toEqual(['List', ['Rational', 1, 3], ['Rational', 2, 3]]);
  });

  test('a call beside a held operator is evaluated whole', () => {
    // The integrand holds a `Sum`, which the integral with one element does
    // not evaluate: the split declines, and the whole integrand is
    // evaluated, as before the split existed.
    for (const valueHeld of [false, true]) {
      const ce = new ComputeEngine();
      ce.assign('E', ce.parse('[1, 2]'));
      if (valueHeld) {
        ce.declare('f', 'function');
        ce.assign('f', ce.parse(String.raw`(t,a)\mapsto t^2+a`));
      } else ce.parse(String.raw`f(t,a)\coloneq t^2+a`).evaluate();
      expect(
        ce
          .parse(String.raw`\int_0^1 \left(\sum_{k=1}^3 kx\right) f(x,E)\,dx`)
          .evaluate().json
      ).toEqual(['List', ['Rational', 9, 2], ['Rational', 15, 2]]);
    }
  });

  test('a list longer than the eager broadcast limit is not split', () => {
    // A broadcast over more than 100 elements is a lazy `Map`: the list
    // route keeps the results it gave before the split existed.
    const ce = new ComputeEngine();
    ce.assign(
      'B',
      ce.box(['List', ...Array.from({ length: 101 }, (_, i) => i + 1)])
    );
    ce.parse(String.raw`f(t,a)\coloneq t^2+a`).evaluate();
    expect(ce.parse(String.raw`\int_0^1 x B\,dx`).evaluate().operator).toBe(
      'Map'
    );
    const call = ce.parse(String.raw`\int_0^1 x f(x,B)\,dx`).evaluate();
    expect(call.operator).toBe('Integrate');
    expect(hasCall(call.json, 'f')).toBe(true);
  });

  test('which route runs', () => {
    const ce = documentEngine([0.001, 0.2]);
    // A list that comes from an operator the split does not map through
    // (`Reverse`) declines to the route that evaluates the whole integrand,
    // which writes the body of `c` in. This pins the decline, not a shape
    // that is wanted.
    const declined = ce
      .parse(String.raw`\int_0^1 y\,c(y,L,0.1)\operatorname{Reverse}(E)\,dy`)
      .evaluate();
    expect(declined.operator).toBe('List');
    expect(hasCall(declined.ops![0].json, 'c')).toBe(false);
    expect(hasCall(declined.ops![0].json, 'n')).toBe(true);
    // A list symbol beside a call maps without evaluating the call.
    const split = ce.parse(String.raw`\int_0^1 y\,c(y,L,0.1)E\,dy`).evaluate();
    expect(split.operator).toBe('List');
    expect(hasCall(split.ops![0].json, 'c')).toBe(true);
    expect(hasCall(split.ops![0].json, 'n')).toBe(false);
  });

  test('each element equals the integral with one element of the list', () => {
    // A call with a closed form is integrated, as it is with one element in
    // place of the list. The call of `c`, which has no closed form, is kept
    // in both (first test above).
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2]'));
    ce.parse(String.raw`f(t,a)\coloneq t^2+a`).evaluate();
    const value = ce.parse(String.raw`\int_0^1 f(x,E)\,dx`).evaluate();
    expect(value.json).toEqual(['List', ['Rational', 4, 3], ['Rational', 7, 3]]);
    [1, 2].forEach((a, k) =>
      expect(value.ops![k].json).toEqual(
        ce.parse(String.raw`\int_0^1 f(x,${a})\,dx`).evaluate().json
      )
    );
    const tycho = documentEngine([0.001, 0.2]);
    const heads = tycho.parse(head('0', '1', 'E')).evaluate();
    [0.001, 0.2].forEach((eps, k) =>
      expect(heads.ops![k].json).toEqual(
        tycho.parse(head('0', '1', String(eps))).evaluate().json
      )
    );
  });

  test('a call with a closed form, and lists of different lengths', () => {
    const ce = new ComputeEngine();
    ce.assign('E', ce.parse('[1, 2, 3]'));
    ce.parse(String.raw`f(t,a)\coloneq t^2+a`).evaluate();
    expect(
      ce.parse(String.raw`\int_0^1 x\,f(x, E)\,dx`).evaluate().json
    ).toEqual(['List', ['Rational', 3, 4], ['Rational', 5, 4], ['Rational', 7, 4]]);
    expect(
      ce.parse(String.raw`\int_0^{E} f(x, E)\,dx`).evaluate().json
    ).toEqual(['List', ['Rational', 4, 3], ['Rational', 20, 3], 18]);
    expect(
      ce.parse(String.raw`\int_0^1 f(x, [1,2,3,4]) E\,dx`).evaluate().operator
    ).toBe('Error');
  });
});
