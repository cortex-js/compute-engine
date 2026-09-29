import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Tycho item 330 (filed 2026-09-28): a loop variable was not private to the
// application of a recursive function.
//
// A scoped construct inside a function body (a `for` loop, a `Sum`, a nested
// `Block` with `let` locals) owns a scope that is created once, when the body
// is canonicalized. Every application of the function evaluates the same body,
// so a recursive application wrote its own values into the scope of the
// enclosing application. When the inner call returned, the caller read the
// callee's last values: in `for c in [10, 11] { … f(2) …; c }` the caller's
// `c` read 21 after the call.
//
// The fix (`enterNestedBodyScopes`, `src/compute-engine/function-utils.ts`)
// saves the bindings of those nested scopes when an application starts while
// another application that uses them is still running, and puts them back
// when it ends.
//

function run(source: string): unknown {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return r.value?.json;
}

describe('Tycho item 330: nested scopes are private to each recursive application', () => {
  test('for loop variable is restored after a recursive call (the reported case)', () => {
    expect(
      run(`function f(n) {
  let out = []
  for c in [n * 10, n * 10 + 1] {
    out = [...out, c]
    if n < 2 { out = [...out, ...f(n + 1)] }
    out = [...out, c]
  }
  out
}
f(1)`)
    ).toEqual(['List', 10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11]);
  });

  test('nested for loops inside a recursive function', () => {
    expect(
      run(`function f(n) {
  let out = []
  for a in [n] {
    for b in [n * 10, n * 10 + 1] {
      out = [...out, a, b]
      if n < 2 { out = [...out, ...f(n + 1)] }
      out = [...out, a, b]
    }
  }
  out
}
f(1)`)
    ).toEqual([
      'List',
      ...[1, 10],
      ...[2, 20, 2, 20, 2, 21, 2, 21],
      ...[1, 10, 1, 11],
      ...[2, 20, 2, 20, 2, 21, 2, 21],
      ...[1, 11],
    ]);
  });

  test('let local of a nested block is restored after a recursive call', () => {
    expect(
      run(`function f(n) {
  let out = []
  if true {
    let t = n * 10
    if n < 2 { out = f(n + 1) }
    out = [...out, t]
  }
  out
}
f(1)`)
    ).toEqual(['List', 20, 10]);
  });

  test('while loop: a let local of the loop body is restored', () => {
    // The loop counter `i` is a local of the function body (already private
    // to each application); `v` is a local of the loop body block.
    expect(
      run(`function f(n) {
  let out = []
  let i = 0
  while i < 2 {
    let v = n * 10 + i
    if n < 2 { out = [...out, ...f(n + 1)] }
    out = [...out, v]
    i = i + 1
  }
  out
}
f(1)`)
    ).toEqual(['List', 20, 21, 10, 20, 21, 11]);
  });

  test('while loop reading a body-level counter (was already correct)', () => {
    expect(
      run(`function f(n) {
  let out = []
  let i = 0
  while i < 2 {
    out = [...out, n * 10 + i]
    if n < 2 { out = [...out, ...f(n + 1)] }
    out = [...out, n * 10 + i]
    i = i + 1
  }
  out
}
f(1)`)
    ).toEqual(['List', 10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11]);
  });

  test('comprehension index inside a recursive function (was already correct)', () => {
    expect(
      run(`function f(n) {
  flatten([ (if n < 2 { [c, ...f(n + 1), c] } else { [c, c] }) for c in [n * 10, n * 10 + 1] ])
}
f(1)`)
    ).toEqual(['List', 10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11]);
  });

  test('let local of a block in a comprehension body, with a recursive call', () => {
    // The comprehension is lazy: it is walked when `flatten` reads it, which
    // can be after the application that built it has returned.
    expect(
      run(`function f(n) {
  let xs = [ do { let a = c; let r = (if n < 2 { f(n + 1) } else { [] }); [a, ...r, c] } for c in [n * 10, n * 10 + 1] ]
  flatten(xs)
}
f(1)`)
    ).toEqual(['List', 10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11]);
  });

  test('Sum index inside a recursive function', () => {
    // f(2) = (0 + 100) + (0 + 200) = 300; f(1) = (300 + 10) + (300 + 20).
    expect(
      run(`function f(n) {
  if n >= 3 { 0 } else { sum(do { let r = f(n + 1); r + k * 10^n }, (k, 1, 2)) }
}
f(1)`)
    ).toEqual(630);
    expect(
      run(`function f(n) {
  if n >= 3 { 0 } else { sum(f(n + 1) + k * 10^n, (k, 1, 2)) }
}
f(1)`)
    ).toEqual(630);
  });

  test('Product index inside a recursive function', () => {
    // f(2) = (1 + 2)(2 + 2) = 12; f(1) = (12 · 2)(12 · 3) = 864.
    expect(
      run(`function f(n) {
  if n >= 3 { 1 } else { product(do { let r = f(n + 1); r * (k + n) }, (k, 1, 2)) }
}
f(1)`)
    ).toEqual(864);
  });

  test('mutual recursion through a second function', () => {
    expect(
      run(`function g(n) { f(n) }
function f(n) {
  let out = []
  for c in [n * 10, n * 10 + 1] {
    out = [...out, c]
    if n < 2 { out = [...out, ...g(n + 1)] }
    out = [...out, c]
  }
  out
}
f(1)`)
    ).toEqual(['List', 10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11]);
  });

  test('a non-recursive helper with the same loop variable name (unchanged)', () => {
    expect(
      run(`function h(n) {
  let s = 0
  for c in [n, n + 1] { s = s + c }
  s
}
function f(n) {
  let out = []
  for c in [n, n + 1] { out = [...out, c, h(c * 10), c] }
  out
}
f(1)`)
    ).toEqual(['List', 1, 21, 1, 2, 41, 2]);
  });
});

describe('Tycho item 330: box route', () => {
  test('Function/Loop built with ce.box', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'out'],
          ['Assign', 'out', ['List']],
          [
            'Loop',
            [
              'Block',
              ['Assign', 'out', ['Append', 'out', 'c']],
              [
                'If',
                ['Less', 'n', 2],
                ['Assign', 'out', ['Join', 'out', ['f', ['Add', 'n', 1]]]],
                'Nothing',
              ],
              ['Assign', 'out', ['Append', 'out', 'c']],
            ],
            [
              'Element',
              'c',
              [
                'List',
                ['Multiply', 'n', 10],
                ['Add', ['Multiply', 'n', 10], 1],
              ],
            ],
          ],
          'out',
        ],
        'n',
      ])
    );
    expect(ce.box(['f', 1]).evaluate().json).toEqual([
      'List',
      ...[10, 20, 20, 21, 21, 10, 11, 20, 20, 21, 21, 11],
    ]);
  });

  test('Sum index with a Block body built with ce.box', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'If',
          ['GreaterEqual', 'n', 3],
          0,
          [
            'Sum',
            [
              'Block',
              ['Declare', 'r'],
              ['Assign', 'r', ['h', ['Add', 'n', 1]]],
              ['Add', 'r', ['Multiply', 'k', ['Power', 10, 'n']]],
            ],
            ['Limits', 'k', 1, 2],
          ],
        ],
        'n',
      ])
    );
    expect(ce.box(['h', 1]).evaluate().json).toEqual(630);
  });

  test('Product index with a Block body built with ce.box', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'If',
          ['GreaterEqual', 'n', 3],
          1,
          [
            'Product',
            [
              'Block',
              ['Declare', 'r'],
              ['Assign', 'r', ['g', ['Add', 'n', 1]]],
              ['Multiply', 'r', ['Add', 'k', 'n']],
            ],
            ['Limits', 'k', 1, 2],
          ],
        ],
        'n',
      ])
    );
    expect(ce.box(['g', 1]).evaluate().json).toEqual(864);
  });
});

//
// A closure created in a nested block (an `if` branch, a loop body) must
// capture the bindings of that block when it is created: the scope of a
// nested block is shared by every application of the enclosing function and
// by every iteration of a loop (`captureNestedLocals`,
// `src/compute-engine/function-utils.ts`). A closure captures the BINDING,
// not a snapshot of its value (`src/epsil/docs/evaluation.md`), so a write
// made later in the same run of the block is visible; a loop index gets a
// binding per iteration, like a comprehension index.
//
describe('closure over a nested-block local', () => {
  test('let local of an if branch (the reported case)', () => {
    expect(
      run(`function mk(n) { if n > 0 { let k = n * 10; () => k } else { 0 } }
let a = mk(1)
let b = mk(2)
function mk2(n) { let k = n * 10; () => k }
let a2 = mk2(1)
let b2 = mk2(2)
(a(), b(), a2(), b2())`)
    ).toEqual(['Tuple', 10, 20, 10, 20]);
  });

  test('for loop index captured per iteration, at top level', () => {
    expect(
      run(`let fs = []
for i in [1, 2] { fs = [...fs, () => i] }
(fs[1](), fs[2]())`)
    ).toEqual(['Tuple', 1, 2]);
  });

  test('for loop index captured per iteration, in a function', () => {
    // Before the fix the escaped `i` fell through to the imaginary unit.
    expect(
      run(`function mk() { let fs = []; for i in [1, 2] { fs = [...fs, () => i] }; fs }
let fs = mk()
(fs[1](), fs[2]())`)
    ).toEqual(['Tuple', 1, 2]);
  });

  test('nested closures created in a loop body', () => {
    expect(
      run(`function mk() { let fs = []; for i in [1, 2] { fs = [...fs, x => (y => x + y + i)] }; fs }
let fs = mk()
(fs[1](10)(100), fs[2](10)(100))`)
    ).toEqual(['Tuple', 111, 112]);
  });

  test('let local of a while body', () => {
    expect(
      run(`function mk() { let fs = []; let j = 0; while j < 2 { j = j + 1; let v = j * 10; fs = [...fs, () => v] }; fs }
let fs = mk()
(fs[1](), fs[2]())`)
    ).toEqual(['Tuple', 10, 20]);
  });

  test('counter factory with the counter in a nested block', () => {
    expect(
      run(`function mk() { if true { let n = 0; () => do { n = n + 1; n } } else { 0 } }
let c1 = mk()
let c2 = mk()
(c1(), c1(), c2(), c1(), c2())`)
    ).toEqual(['Tuple', 1, 2, 1, 3, 2]);
  });

  test('counter factory with the counter at the top of the body (was already correct)', () => {
    expect(
      run(`function mk() { let n = 0; () => do { n = n + 1; n } }
let c1 = mk()
let c2 = mk()
(c1(), c1(), c2(), c1(), c2())`)
    ).toEqual(['Tuple', 1, 2, 1, 3, 2]);
  });

  test('two closures of the same block run share the local', () => {
    expect(
      run(`function mk() { if true { let n = 0; [() => do { n = n + 1; n }, () => n] } else { [] } }
let p = mk()
(p[1](), p[1](), p[2]())`)
    ).toEqual(['Tuple', 1, 2, 2]);
  });

  test('a write after the closure is created is visible (binding, not value)', () => {
    expect(
      run(`function mk() { if true { let n = 1; let g = () => n; n = 5; g } else { 0 } }
mk()()`)
    ).toEqual(5);
  });

  test('a named helper defined in a nested block escapes with its locals', () => {
    expect(
      run(`function mk(n) { if n > 0 { let k = n * 10; function h() { k }; h } else { 0 } }
let a = mk(1)
let b = mk(2)
(a(), b())`)
    ).toEqual(['Tuple', 10, 20]);
  });

  test('recursive factory: each level keeps its own local', () => {
    // mk(3)() = 30 + mk(2)() = 30 + (20 + mk(1)()) = 30 + 20 + 10.
    expect(
      run(`function mk(n) { if n > 0 { let k = n; let inner = mk(n - 1); () => k * 10 + (if n > 1 { inner() } else { 0 }) } else { 0 } }
mk(3)()`)
    ).toEqual(60);
  });

  test('box route: Function over a Block local in an If branch', () => {
    const ce = new ComputeEngine();
    ce.declare('mk', 'function');
    ce.assign(
      'mk',
      ce.box([
        'Function',
        [
          'If',
          ['Greater', 'n', 0],
          [
            'Block',
            [
              'Declare',
              'k',
              [
                'Dictionary',
                ['KeyValuePair', { str: 'value' }, ['Multiply', 'n', 10]],
              ],
            ],
            ['Function', 'k'],
          ],
          0,
        ],
        'n',
      ])
    );
    const a = ce.box(['mk', 1]).evaluate();
    const b = ce.box(['mk', 2]).evaluate();
    expect(ce.box(['Apply', a]).evaluate().json).toEqual(10);
    expect(ce.box(['Apply', b]).evaluate().json).toEqual(20);
  });
});
