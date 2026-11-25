import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// CE-1681: a local of a function body declared with `let` and an unannotated
// function literal, which no `Assign` of the body writes, takes named
// arguments, as the same `let` does at the top level of a program. A local
// that an `Assign` writes can hold a function with other parameter names, so
// a named call of it is still `argument-names-unavailable`.

function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return {
    codes: r.diagnostics.map((d) => d.code),
    value: r.value?.toString(),
  };
}

describe('CE-1681: a named call of a function held in a body local', () => {
  test('the witness: a `let` in a function body', () => {
    expect(
      run(`function m() -> number {
  let h = (x, y) => x - y
  h(y: 2, x: 10)
}
m()`)
    ).toEqual({ codes: [], value: '8' });
  });

  test('the same `let` at the top level', () => {
    expect(run('let h = (x, y) => x - y\nh(y: 2, x: 10)')).toEqual({
      codes: [],
      value: '8',
    });
  });

  test('an argument that is a parameter of the function', () => {
    expect(
      run(`function m(a) {
  let h = (x, y) => x - y
  h(y: a, x: 10)
}
m(2)`)
    ).toEqual({ codes: [], value: '8' });
  });

  test('an annotated literal and a parameter with a default', () => {
    expect(
      run(`function m() -> number {
  let h = (x: number, y: number) => x - y
  h(y: 2, x: 10)
}
m()`)
    ).toEqual({ codes: [], value: '8' });
    expect(
      run(`function m() -> number {
  let h = (x, y = 3) => x - y
  h(x: 10)
}
m()`)
    ).toEqual({ codes: [], value: '7' });
  });

  test('a call in a nested block and in a loop body', () => {
    expect(
      run(`function m() -> number {
  let h = (x, y) => x - y
  if (true) { h(y: 2, x: 10) } else { 0 }
}
m()`)
    ).toEqual({ codes: [], value: '8' });
    expect(
      run(`function m() {
  let s = 0
  for i in 1..3 {
    let h = (x, y) => x - y
    s = s + h(y: i, x: 10)
  }
  s
}
m()`)
    ).toEqual({ codes: [], value: '24' });
  });

  test('a name that the literal does not declare', () => {
    expect(
      run(`function m() -> number {
  let h = (x, y) => x - y
  h(z: 2, x: 10)
}
m()`).codes[0]
    ).toBe('argument-name-unknown');
  });

  test('a local that an `Assign` writes takes no names', () => {
    expect(
      run(`function m() -> number {
  let h = (x, y) => x - y
  h = (y, x) => x - y
  h(y: 2, x: 10)
}
m()`).codes[0]
    ).toBe('argument-names-unavailable');
    // An `Assign` in a nested function counts too.
    expect(
      run(`function m() -> number {
  let h = (x, y) => x - y
  function g() { h = (y, x) => x - y }
  h(y: 2, x: 10)
}
m()`).codes[0]
    ).toBe('argument-names-unavailable');
  });

  test('the MathJSON form puts the arguments in declaration order', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      [
        'Block',
        [
          'Declare',
          'h',
          [
            'Dictionary',
            [
              'KeyValuePair',
              { str: 'value' },
              ['Function', ['Subtract', 'x', 'y'], 'x', 'y'],
            ],
          ],
        ],
        [
          'h',
          ['NamedArgument', { str: 'y' }, 'a'],
          ['NamedArgument', { str: 'x' }, 10],
        ],
      ],
      'a',
    ]);
    expect(f.toString()).toContain('h(10, a)');
    expect(ce.box(['Apply', f, 2]).evaluate().re).toBe(8);
  });
});
