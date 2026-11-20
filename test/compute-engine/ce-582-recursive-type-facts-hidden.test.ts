import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { typeToString } from '../../src/common/type/serialize';

//
// CE-582. A recursive function declared with the bare `function` type, read
// for the first time with the assumptions hidden (`ce._withoutFacts()`),
// overflowed the stack.
//
// The type of a node is cached in two cells: one for reads with the
// assumptions visible and one for reads with them hidden (`cachedValue`,
// `src/compute-engine/boxed-expression/cache.ts`). A recursive body reads
// the type of a node while the type of that node is computed. With the
// assumptions visible, that re-entrant read is answered with the cell's
// previous value, which exists because the node was typed when it was
// boxed. The cell for the hidden side was empty, and the other cell is
// served only when it was filled at the same engine version, so after a
// write (the assignment of `F`, or the signature derivation itself) each
// level typed the body again. A re-entrant read of an empty type cell is now
// answered `unknown`.
//

type Body = unknown;

const R = ['F', ['Subtract', 'n', 1]];

function engineWith(body: Body, assume = 'x > 0'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('F', 'function');
  if (assume) ce.assume(ce.parse(assume));
  ce.assign('F', ce.box(['Function', body, 'n'] as any));
  return ce;
}

function hidden<T>(ce: ComputeEngine, thunk: () => T): T {
  return (ce as any)._withoutFacts(thunk);
}

const GREATER_BODY = ['If', ['Equal', 'n', 0], ['Greater', 'x', 0], R];

describe('CE-582: the reproduction', () => {
  test('the type of F(m) read with the assumptions hidden, after a visible read', () => {
    const ce = engineWith(GREATER_BODY);
    expect(ce.box(['F', 'm']).type.toString()).toBe('boolean');
    expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
      'boolean'
    );
    // Reading it again on either side gives the same answer.
    expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
      'boolean'
    );
    expect(ce.box(['F', 'm']).type.toString()).toBe('boolean');
  });

  test('the type of F(m) read with the assumptions hidden, first', () => {
    const ce = engineWith(GREATER_BODY);
    expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
      'boolean'
    );
    expect(ce.box(['F', 'm']).type.toString()).toBe('boolean');
  });

  test('the value is True with the assumption, and stays symbolic without it', () => {
    const ce = engineWith(GREATER_BODY);
    expect(ce.box(['F', 2]).evaluate().toString()).toBe('"True"');
    // With the assumption hidden, `x > 0` is not known: the result is not
    // `True`, and its type stays `boolean`.
    const value = hidden(ce, () => ce.box(['F', 2]).evaluate());
    expect(value.toString()).not.toBe('"True"');
    expect(value.toString()).toBe('0 < x');
    expect(hidden(ce, () => value.type.toString())).toBe('boolean');
    expect(ce.box(['F', 2]).evaluate().toString()).toBe('"True"');
  });

  test('an assumption on another symbol is enough to hide facts', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('F', 'function');
    ce.assume(ce.parse('y > 0'));
    ce.assign('F', ce.box(['Function', GREATER_BODY, 'n'] as any));
    expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
      'boolean'
    );
  });

  test('two mutually recursive functions declared `function`', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.declare('G', 'function');
    ce.assume(ce.parse('x > 0'));
    ce.assign(
      'F',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], ['Greater', 'x', 0], ['G', ['Subtract', 'n', 1]]],
        'n',
      ] as any)
    );
    ce.assign('G', ce.box(['Function', ['F', 'n'], 'n'] as any));
    // The type is `unknown`, not `boolean`: `G(n − 1)` is `unknown` only
    // because it reads `F`, whose type is being computed, but the result
    // type of `G` is not, so the branch is read as a value of any type
    // (`docs/TYPE-SYSTEM.md`, the precision loss of a mutual recursion,
    // CE-836). This test guards that the read ends and that both sides give
    // the same answer.
    const hiddenType = hidden(ce, () => ce.box(['F', 'm']).type.toString());
    expect(ce.box(['F', 'm']).type.toString()).toBe(hiddenType);
  });

  test.each([
    { selfCall: false, result: 8 },
    { selfCall: true, result: 11 },
  ])(
    'CE-1515: typing a mutual cycle ends with a direct self-call set to $selfCall',
    ({ selfCall, result }) => {
      const ce = new ComputeEngine();
      const heads = ['a_2', 'b_2', 'c_2'] as const;
      for (const name of [...heads, 'd_2']) ce.declare(name, 'function');
      const call = (name: string): MathJsonExpression => [
        name,
        ['Subtract', 'n', 1],
      ];
      const steps: Record<(typeof heads)[number], MathJsonExpression> = {
        a_2: ['Add', call('c_2'), call('b_2')],
        b_2: selfCall
          ? ['Add', call('c_2'), call('b_2'), ['Square', 'n']]
          : ['Add', call('c_2'), ['Square', 'n']],
        c_2: call('a_2'),
      };
      for (const name of heads)
        ce.assign(name, [
          'Function',
          ['If', ['LessEqual', 'n', 0], 1, steps[name]],
          'n',
        ]);
      ce.assign('d_2', ['Function', ['Add', ['a_2', 3], ['Square', 'x']], 'x']);
      const caller = ce.box(['d_2', 1]);
      expect(caller.type.toString()).toBe('number');
      expect(caller.evaluate().re).toBe(result);
      expect(caller.N().re).toBe(result);
    }
  );

  test('CE-1515: a mutual scalar and vector result survives repeated type reads', () => {
    const ce = new ComputeEngine();
    for (const name of ['F', 'G']) ce.declare(name, 'function');
    const dec = ['Subtract', 'n', 1];
    ce.assign('F', [
      'Function',
      ['If', ['LessEqual', 'n', 0], 1, ['G', dec]],
      'n',
    ]);
    ce.assign('G', [
      'Function',
      ['If', ['LessEqual', 'n', 0], ['List', 1, 2], ['F', dec]],
      'n',
    ]);
    ce.declare('zz', 'real');
    void ce.lookupDefinition('F')!.value!.storedValue!.type;
    for (let i = 0; i < 2; i++) {
      const f = ce.box(['F', 1]);
      const g = ce.box(['G', 2]);
      for (const call of [f, g]) {
        expect([
          'integer | vector<integer^2>',
          'number | vector<integer^2>',
        ]).toContain(call.type.toString());
        expect(call.evaluate().json).toEqual(['List', 1, 2]);
      }
    }
  });

  // Each head is declared with an open signature, so each read of a head
  // derives its signature. Before CE-1516, the assignment of `d_2` did not
  // finish in 60 s.
  test('CE-1516: a mutual cycle of heads declared (unknown) -> unknown ends', () => {
    const ce = new ComputeEngine();
    const heads = ['a_2', 'b_2', 'c_2'] as const;
    for (const name of [...heads, 'd_2'])
      ce.declare(name, '(unknown) -> unknown');
    const call = (name: string): MathJsonExpression => [
      name,
      ['Subtract', 'n', 1],
    ];
    const steps: Record<(typeof heads)[number], MathJsonExpression> = {
      a_2: ['Add', call('c_2'), call('b_2')],
      b_2: ['Add', call('c_2'), ['Square', 'n']],
      c_2: call('a_2'),
    };
    for (const name of heads)
      ce.assign(name, [
        'Function',
        ['If', ['LessEqual', 'n', 0], 1, steps[name]],
        'n',
      ]);
    ce.assign('d_2', ['Function', ['Add', ['a_2', 3], ['Square', 'x']], 'x']);
    const caller = ce.box(['d_2', 1]);
    expect(caller.type.toString()).toBe('number');
    expect(caller.evaluate().re).toBe(8);
    expect(caller.N().re).toBe(8);
  });

  // `h_0` calls itself and `h_1`, and `h_1` calls `h_0` and itself. Before
  // CE-1516, the assignment of `d` did not finish in 60 s.
  test('CE-1516: two heads declared (unknown) -> unknown that call each other and themselves', () => {
    const ce = new ComputeEngine();
    for (const name of ['h_0', 'h_1', 'd'])
      ce.declare(name, '(unknown) -> unknown');
    const call = (name: string): MathJsonExpression => [
      name,
      ['Subtract', 'n', 1],
    ];
    for (const [name, other] of [
      ['h_0', 'h_1'],
      ['h_1', 'h_0'],
    ])
      ce.assign(name, [
        'Function',
        ['If', ['LessEqual', 'n', 0], 1, ['Add', call(other), call(name)]],
        'n',
      ]);
    ce.assign('d', ['Function', ['Add', ['h_0', 3], ['Square', 'x']], 'x']);
    const caller = ce.box(['d', 1]);
    expect(caller.type.toString()).toBe('number');
    expect(caller.evaluate().re).toBe(9);
  });

  test('CE-1515: reading the second head first preserves fractional result elements', () => {
    const ce = new ComputeEngine();
    const heads = ['a_2', 'b_2', 'c_2'] as const;
    for (const head of heads) ce.declare(head, 'function');
    const call = (head: string): MathJsonExpression => [
      head,
      ['Subtract', 'n', 1],
    ];
    const bodies: Record<(typeof heads)[number], MathJsonExpression> = {
      a_2: ['Add', call('c_2'), call('b_2')],
      b_2: ['Add', call('c_2'), ['Square', 'n']],
      c_2: call('a_2'),
    };
    for (const head of heads)
      ce.assign(head, [
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 0],
          head === 'c_2' ? ['List', 1, 2] : 1,
          'True',
          bodies[head],
        ],
        'n',
      ]);
    ce.assign('d_2', ['Function', ['Add', ['a_2', 3], ['Square', 'x']], 'x']);

    const readingOrder = ['b_2', 'a_2', 'c_2'];
    const types = readingOrder.map((head) => ce.box([head, 'm']).type);
    const value = ce.box(['c_2', 3.5]).evaluate();
    expect(value.ops?.map((entry) => entry.re)).toEqual([5.25, 6.25]);
    expect(value.type.matches(types[2])).toBe(true);
  });

  test('an object elsewhere leaves the recursive mixed result precise', () => {
    const ce = new ComputeEngine();
    ce._object('Pt', { a: 1 });
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.assume(ce.parse('x > 0'));
    ce.assign(
      'F',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], ['List', 1, 2], ['Multiply', 2, R]],
        'n',
      ] as MathJsonExpression)
    );
    const call = ce.box(['F', 'm']);
    const expected = 'number | vector<2>';
    expect(hidden(ce, () => call.type.toString())).toBe(expected);
    expect(call.type.toString()).toBe(expected);
  });

  test('a list result read with the assumptions hidden is cached and fact-free', () => {
    // Serving the other cell's value instead of `unknown` also ended the
    // recursion, but its answer is provisional, so nothing was cached in the
    // window and this read took about 3 s.
    const body = ['If', ['Equal', 'n', 0], ['List', 'x'], ['Append', R, 'x']];
    const ce = engineWith(body);
    expect(ce.box(['F', 'm']).type.toString()).toBe('list<real>');
    const read = countedHiddenRead(ce);
    expect(read.type).toBe('list<real>');
    expect(read.literalStored).toBe(true);
    expect(read.callStored).toBe(true);
    expect(read.derivations).toBeLessThan(20);
  });
});

/** Read the type of `F(m)` with the assumptions hidden, and report how many
 * signature derivations of `F` the read ran (`_deriveSignatureOnce`,
 * `boxed-value-definition.ts`) and whether the static type cells of
 * the stored literal and the call hold a value afterwards. A recursion whose computations are not cached derives the
 * signature again at each level. */
function countedHiddenRead(ce: ComputeEngine): {
  type: string;
  derivations: number;
  literalStored: boolean;
  callStored: boolean;
} {
  const def = ce.lookupDefinition('F')!.value as any;
  const literal = def.storedValue;
  // Boxed before the count starts: boxing types the call with the
  // assumptions visible.
  const call = ce.box(['F', 'm']);
  const proto = Object.getPrototypeOf(def);
  const original = proto._deriveSignatureOnce;
  let derivations = 0;
  proto._deriveSignatureOnce = function (...args: unknown[]) {
    derivations += 1;
    // Stop a recursion that is not cached before it runs for minutes.
    if (derivations > 2000) throw new Error('too many derivations');
    return original.apply(this, args);
  };
  let type: string;
  try {
    type = hidden(ce, () => call.type.toString());
  } finally {
    proto._deriveSignatureOnce = original;
  }
  return {
    type,
    derivations,
    literalStored: literal._type.value != null,
    callStored: (call as any)._type.value != null,
  };
}

describe('CE-582: an engine that has built an object', () => {
  // On such an engine a re-entrant answer is provisional, and a computation
  // that used one commits nothing. The outermost computation of the cell
  // whose empty-cell answer was used commits (`cachedValue`, `cache.ts`):
  // without that, each read typed the recursion again, and the list body
  // below did not finish.
  test.each([
    ['a boolean result', GREATER_BODY, 'boolean'],
    [
      'a list result',
      ['If', ['Equal', 'n', 0], ['List', 1, 2], ['Multiply', 2, R]],
      undefined,
    ],
  ])('with %s, the hidden read is cached', (_tag, body, expected) => {
    const plain = engineWith(body);
    const plainType = countedHiddenRead(plain).type;
    if (expected !== undefined) expect(plainType).toBe(expected);

    const ce = new ComputeEngine();
    (ce as any)._object('Pt', { a: 1 });
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.assume(ce.parse('x > 0'));
    ce.assign('F', ce.box(['Function', body, 'n'] as any));

    const first = countedHiddenRead(ce);
    expect(first.type).toBe(plainType);
    expect(first.literalStored).toBe(true);
    expect(first.callStored).toBe(true);
    expect(first.derivations).toBeLessThan(20);

    const second = countedHiddenRead(ce);
    expect(second.type).toBe(plainType);
    expect(second.derivations).toBeLessThan(20);
  });

  test('ce.assign(y, F(m))', () => {
    const ce = new ComputeEngine();
    (ce as any)._object('Pt', { a: 1 });
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.assume(ce.parse('x > 0'));
    ce.assign('F', ce.box(['Function', GREATER_BODY, 'n'] as any));
    ce.assign('y', ce.box(['F', 'm']));
    expect(ce.symbol('y').type.toString()).toBe('boolean');
  });
});

describe('CE-582: reachable from the public API', () => {
  // `ce.assign()` derives the type it writes with the assumptions hidden
  // (`deriveAndWriteAssignedType`, `engine-declarations.ts`), and the
  // value-definition constructor runs hidden too
  // (`boxed-value-definition.ts`). Each of these overflowed the stack.
  test('ce.assign(y, F(m))', () => {
    const ce = engineWith(GREATER_BODY);
    ce.assign('y', ce.box(['F', 'm']));
    expect(ce.symbol('y').type.toString()).toBe('boolean');
  });

  test('ce.assign(y, F(m)) when the assumption is made after F is assigned', () => {
    const ce = engineWith(GREATER_BODY, '');
    ce.assume(ce.parse('x > 0'));
    ce.assign('y', ce.box(['F', 'm']));
    expect(ce.symbol('y').type.toString()).toBe('boolean');
  });

  test('ce.declare(y, { value: F(m) })', () => {
    const ce = engineWith(GREATER_BODY);
    ce.declare('y', { type: 'unknown', value: ce.box(['F', 'm']) });
    expect(ce.symbol('y').type.toString()).toBe('boolean');
  });

  test('evaluating y := F(m)', () => {
    const ce = engineWith(GREATER_BODY);
    ce.box(['Assign', 'y', ['F', 'm']]).evaluate();
    expect(ce.symbol('y').type.toString()).toBe('boolean');
  });
});

describe('CE-582: the assumptions bit of the recursive-hypothesis key', () => {
  // `_definitionsKey()` (`boxed-value-definition.ts`) keys the reuse of an
  // earlier derivation's result as the type of the recursive calls. It must
  // differ between the two sides, so that a result derived with the
  // assumptions visible is not reused while they are hidden.
  test('the key differs with the assumptions hidden', () => {
    const ce = engineWith(GREATER_BODY);
    const def = ce.lookupDefinition('F')!.value as any;
    const visible = def._definitionsKey();
    const hiddenKey = hidden(ce, () => def._definitionsKey());
    expect(hiddenKey).not.toBe(visible);
    expect(def._definitionsKey()).toBe(visible);
  });

  // The answers that a visible derivation could carry into a hidden read.
  // Removing the bit from the key does NOT make these fail: the result that
  // a derivation stores is computed again with the recursive call reading
  // the skeleton (`resultUnderDeclaredParameters`), not the reused result, so
  // the reused result reaches only the cached types of the stored body.
  test.each([
    [
      'a tuple',
      ['If', ['Equal', 'n', 0], ['Tuple', 'x', 'x'], R],
      'tuple<real, real>',
    ],
    [
      'a list',
      ['If', ['Equal', 'n', 0], ['List', 'x'], ['Append', R, 'x']],
      'list<real>',
    ],
  ])(
    'with %s result, a hidden read after a visible one has no assumed range',
    (_tag, body, hiddenType) => {
      const ce = engineWith(body);
      const def = ce.lookupDefinition('F')!.value as any;
      const literal = def.storedValue;
      expect(ce.box(['F', 'm']).type.toString()).toBe(hiddenType);
      expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
        hiddenType
      );
      expect(
        hidden(ce, () => typeToString(def._wildcardRecursiveSignature()))
      ).toBe(`(unknown) -> ${hiddenType}`);
      // The types of the stored body nodes read with the assumptions
      // hidden carry no assumed range.
      const bodyTypes: string[] = hidden(ce, () => {
        const out: string[] = [];
        const walk = (e: any) => {
          if (!e.ops) return;
          out.push(e.type.toString());
          e.ops.forEach(walk);
        };
        walk(literal);
        return out;
      });
      for (const t of bodyTypes) expect(t).not.toContain('<0<');
    }
  );
});
