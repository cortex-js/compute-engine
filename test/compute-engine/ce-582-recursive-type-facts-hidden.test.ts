import { ComputeEngine } from '../../src/compute-engine';
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
    expect(hidden(ce, () => ce.box(['F', 'm']).type.toString())).toBe(
      'boolean'
    );
    expect(ce.box(['F', 'm']).type.toString()).toBe('boolean');
  });

  test('a list result read with the assumptions hidden is cached and fact-free', () => {
    // Serving the other cell's value instead of `unknown` also ended the
    // recursion, but its answer is provisional, so nothing was cached in the
    // window and this read took about 3 s.
    const body = ['If', ['Equal', 'n', 0], ['List', 'x'], ['Append', R, 'x']];
    const ce = engineWith(body);
    expect(ce.box(['F', 'm']).type.toString()).toBe('list<real<0<..>>');
    const read = countedHiddenRead(ce);
    expect(read.type).toBe('list<real>');
    expect(read.literalStored).toBe(true);
    expect(read.callStored).toBe(true);
    expect(read.derivations).toBeLessThan(20);
  });
});

/** Read the type of `F(m)` with the assumptions hidden, and report how many
 * signature derivations of `F` the read ran (`_deriveSignatureOnce`,
 * `boxed-value-definition.ts`) and whether the cell for reads with the
 * assumptions hidden of the stored literal and of the call holds a value
 * afterwards. A recursion whose computations are not cached derives the
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
    literalStored: literal._type.suppressed?.value != null,
    callStored: (call as any)._type.suppressed?.value != null,
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
      'tuple<real<0<..>, real<0<..>>',
      'tuple<real, real>',
    ],
    [
      'a list',
      ['If', ['Equal', 'n', 0], ['List', 'x'], ['Append', R, 'x']],
      'list<real<0<..>>',
      'list<real>',
    ],
  ])(
    'with %s result, a hidden read after a visible one has no assumed range',
    (_tag, body, visibleType, hiddenType) => {
      const ce = engineWith(body);
      const def = ce.lookupDefinition('F')!.value as any;
      const literal = def.storedValue;
      expect(ce.box(['F', 'm']).type.toString()).toBe(visibleType);
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
