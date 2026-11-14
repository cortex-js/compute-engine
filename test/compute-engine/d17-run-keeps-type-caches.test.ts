import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

// A run keeps the cached types (decision D17 of
// `docs/plans/2026-11-11-bound-once-spec.md`, CE-1210): the pop of a scope
// moves the type version only when it reverts an assumption. See
// docs/TYPE-SYSTEM.md, "A static type does not depend on a value".

const find = (e: any, p: (x: any) => boolean): any => {
  if (p(e)) return e;
  for (const op of e.ops ?? []) {
    const r = find(op, p);
    if (r) return r;
  }
  return undefined;
};

// The shape of a board-game prelude: nested functions over a list of 64
// cells, with blocks, loops and a list built step by step.
const PRELUDE = `
function cell(B, r, c) {
  if r < 1 || r > 8 || c < 1 || c > 8 { 0 } else { B[(r - 1) * 8 + c] }
}
function run(B, r, c, dr, dc, p) {
  let k = 1
  while cell(B, r + k * dr, c + k * dc) == -p { k = k + 1 }
  if k > 1 && cell(B, r + k * dr, c + k * dc) == p { k - 1 } else { 0 }
}
function flips(B, i, p) {
  let r = floor((i - 1) / 8) + 1
  let c = i - (r - 1) * 8
  let t = 0
  for d in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)] {
    t = t + run(B, r, c, d[1], d[2], p)
  }
  t
}
function legal(B, p) {
  let out = []
  for i in 1..64 {
    if B[i] == 0 && flips(B, i, p) > 0 { out = [...out, i] }
  }
  out
}
`;

const BOARD = (() => {
  const b = new Array(64).fill(0);
  b[27] = 1;
  b[28] = -1;
  b[35] = -1;
  b[36] = 1;
  return `[${b.join(', ')}]`;
})();

/** The value of `run()` after a first run, the move of the type version
 * during the second run, and the number of types it computed. */
function measure(
  ce: ComputeEngine,
  run: () => string
): { value: string; typeVersionMoved: number; typeComputations: number } {
  run();
  const before = ce._typeVersion;
  ce._cacheStats.reset();
  ce._cacheStats.enabled = true;
  let value: string;
  try {
    value = run();
  } finally {
    ce._cacheStats.enabled = false;
  }
  const t = ce._cacheStats.snapshot().caches.type;
  return {
    value,
    typeVersionMoved: ce._typeVersion - before,
    typeComputations: t.missGeneration + t.missCold,
  };
}

describe('D17: a run keeps the cached types', () => {
  test('five calls of a literal whose body is a block with a local', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'y', "'integer'", ['Add', 'x', 1]],
        ['Multiply', 2, 'y'],
      ],
      'x',
    ]);
    const r = measure(ce, () =>
      [1, 2, 3, 4, 5]
        .map((n) =>
          ce
            .function('Apply', [f, ce.box(n)])
            .evaluate()
            .toString()
        )
        .join(',')
    );
    expect(r.value).toBe('4,6,8,10,12');
    expect(r.typeVersionMoved).toBe(0);
  });

  test('a loop of 200 steps in a block with two locals', () => {
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      ['Declare', 's', "'integer'", 0],
      ['Declare', 't', "'integer'", 1],
      [
        'Loop',
        [
          'Block',
          ['Assign', 's', ['Add', 's', 'i']],
          ['Assign', 't', ['Multiply', 't', -1]],
        ],
        ['Element', 'i', ['Range', 1, 200]],
      ],
      ['Add', 's', 't'],
    ]);
    const r = measure(ce, () => program.evaluate().toString());
    expect(r.value).toBe('20101');
    expect(r.typeVersionMoved).toBe(0);
  });

  test('an Epsil recursive function called 50 times', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function sumTo(n, a) { if n <= 0 { a } else { n + sumTo(n - 1, a) } }'
    );
    // A new argument at each run: the same call again is served by the memo
    // of shared evaluations.
    let k = 0;
    const r = measure(ce, () =>
      executeEpsil(ce, `sumTo(49, ${++k})`).value.toString()
    );
    expect(r.value).toBe('1227');
    expect(r.typeVersionMoved).toBe(0);
  });

  test('a prelude of nested functions over a list of 64 cells', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, `${PRELUDE}\nlet B = ${BOARD}`);
    const r = measure(ce, () =>
      executeEpsil(ce, 'legal(B, 1)').value.toString()
    );
    expect(r.value).toBe('[21,30,35,44]');
    expect(r.typeVersionMoved).toBe(0);
    // 8 computations measured; 13,184 when a pop moved the type version.
    expect(r.typeComputations).toBeLessThanOrEqual(8);
  });

  // A guard of behaviour that the change must keep: it holds before the
  // change too.
  test('a pop that reverts an assumption moves the type version', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.box(['Sqrt', 'x']);
    expect(e.type.toString()).toBe('complex');
    ce.pushScope();
    ce.assume(ce.box(['Greater', 'x', 0]));
    expect(e.type.toString()).toBe('real');
    const before = ce._typeVersion;
    ce.popScope();
    expect(ce._typeVersion).toBeGreaterThan(before);
    expect(e.type.toString()).toBe('complex');
  });

  test('the evaluation of a call that returns a closure leaves the type of the call', () => {
    // The result `x ↦ x + q` holds a copy of the argument `q`: the boxing of
    // the closure marks the names it captures, and a mark on the operand of
    // `f(q)` made the call `any` after the evaluation. The type is the
    // signature's result: a literal whose body adds `x` to a name with no
    // value, a number.
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Function', ['Add', 'x', 'y'], 'x'], 'y'])
    );
    const e = ce.box(['Apply', ['f', 'q'], 5]);
    const call = e.op1;
    expect(call.type.toString()).toBe('(x: unknown) -> number');
    expect(e.evaluate().toString()).toBe('q + 5');
    expect(call.type.toString()).toBe('(x: unknown) -> number');
    expect(ce.box(['f', 'q']).type.toString()).toBe('(x: unknown) -> number');
  });

  test('a constant local of a block is typed without its value, inside the run and after it', () => {
    // The value of `h` is the value of one run of the block: a type computed
    // in the run from that value was served after the run.
    const ce = new ComputeEngine();
    const types: string[] = [];
    ce.declare('TypeOfD17', {
      signature: '(any) -> nothing',
      lazy: true,
      canonical: (ops) =>
        ce._fn(
          'TypeOfD17',
          ops.map((op) => op.canonical)
        ),
      evaluate: (ops) => {
        types.push(ops[0].type.toString());
        return ce.Nothing;
      },
    });
    const block: any = ce.box(
      parseEpsil(
        'const h = (k) => k + 1\nTypeOfD17(Map(h, [1, 2]))\nMap(h, [1, 2])'
      )[0] as any
    );
    const probed = find(block, (x) => x.operator === 'TypeOfD17').op1;
    const map = block.ops[block.ops.length - 1];
    expect(probed.type.toString()).toBe('list<unknown^2>');
    expect(map.type.toString()).toBe('list<unknown^2>');
    expect(block.evaluate().toString()).toBe('[2,3]');
    expect(types).toEqual(['list<unknown^2>']);
    expect(probed.type.toString()).toBe('list<unknown^2>');
    expect(map.type.toString()).toBe('list<unknown^2>');
  });

  // A guard of behaviour that the change must keep: it holds before the
  // change too.
  test('a lazy map over a constant local function leaves its block', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'let r = do { const h = (k) => k + 1; map(h, [1, 2]) }\nr'
    );
    expect(r.diagnostics.map((d: any) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('[2,3]');
  });
});
