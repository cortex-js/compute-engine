/**
 * An operator over a call of a user function that maps over a list argument.
 *
 * With `q(t) := 2t`, the JavaScript call `q(u)` maps `q` over a list
 * argument, as the interpreter does. An earlier version compiled the
 * operator around the call as scalar code: `1 + q(u)` was
 * `_SYS.bcastFn(_fn_q, _.u) + 1`, which ran to the string `"2,4,61"` at
 * `u = [1, 2, 3]`, where the interpreter gives `[3, 5, 7]`.
 *
 * The shape of the call is now settled at compile time from the static type
 * of `u` (`docs/plans/2026-10-31-static-shape-compilation.md`). Most tests
 * declare `u: real | list<real>`: the code tests `Array.isArray(_.u)` once,
 * at the input, and holds one body per shape. In the list body the call is a
 * static map (`_SYS.mapFn(_fn_q, [1], _.u)`) with a list type, so the
 * operator maps over its result (`_SYS.bcast`); in the scalar body the call
 * and the operator are scalar code. The code has no run-time test of the
 * value of the call. When a member body has no settled shape (an `If` whose
 * branches are a list and a number), the compilation declines.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

type Json = any;

function engine(types: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries({
    u: 'real | list<real>',
    ...types,
  }))
    ce.declare(name, type);
  ce.declare('q', 'function');
  ce.assign('q', ce.box(['Function', ['Multiply', 2, 't'], 't']));
  ce.declare('p', 'function');
  ce.assign('p', ce.box(['Function', ['Add', 't', 10], 't']));
  ce.declare('w', 'number');
  return ce;
}

/** The compiled value at `vars`, with no fallback to the interpreter. */
function run(
  json: Json,
  vars: Record<string, unknown>,
  types: Record<string, string> = {}
): unknown {
  const result = compile(engine(types).box(json), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  return result.run(vars);
}

/**
 * The compiled function `(params) => json`, whose parameters have no type.
 * An input with no type is refused, but a parameter with no type is not:
 * the root function is compiled with scalar parameters, and a list given
 * for one of them is a value outside that type.
 */
function compileFn(json: Json, params: string[]): any {
  return compile(engine().box(['Function', json, ...params]), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
}

/** The interpreter's value, as plain numbers or booleans. */
function interpret(json: Json, u: number[] | number): unknown {
  const ce = engine();
  ce.assign('u', ce.box(Array.isArray(u) ? ['List', ...u] : u));
  ce.assign('w', 1);
  const value = ce.box(json).N();
  const plain = (v: any): unknown => {
    if (v.operator === 'List') return v.ops.map(plain);
    if (v.symbol === 'True') return true;
    if (v.symbol === 'False') return false;
    return v.re;
  };
  return plain(value);
}

describe('an operator over a call that maps over a list argument', () => {
  test('1 + q(u) broadcasts the sum when the call gives a list', () => {
    // A parameter with no type is a scalar of the root function.
    const result = compileFn(['Add', 1, ['q', 'u']], ['u']);
    expect(result.run(2)).toBe(5);
    // An input declared as a list: the call maps, and the sum maps over the
    // list that the call gives.
    expect(run(['Add', 1, ['q', 'u']], { u: [1, 2, 3] }, { u: 'list<real>' })).toEqual(
      interpret(['Add', 1, ['q', 'u']], [1, 2, 3])
    );
  });

  test('a block with a Return of the call as an operand declines', () => {
    // A block with an assignment as the operand of an operator declines.
    const json = [
      'Add',
      1,
      [
        'Block',
        ['Declare', 'z', "'unknown'", ['q', 'u']],
        ['If', ['Greater', 'w', 0], ['Return', 'z']],
        0,
      ],
    ];
    for (const u of ['real | list<real>', 'real', 'list<real>']) {
      const result = compile(engine({ u }).box(json), {
        to: 'javascript',
      } as any) as any;
      expect(result.success).toBe(false);
    }
  });

  test('a complex-valued function: 1 + h(u) with h := t ↦ t + i', () => {
    // The complex element lane reads the result of the call by its shape at
    // run time (`_SYS.sadd`). Before, this declined, also for a `u` declared
    // `list<number>`. With no declaration, `u` is a parameter with no type:
    // an input with no type is refused. A parameter with no type is a scalar
    // of the root function, so only a number is given for it.
    for (const declared of [undefined, 'list<number>']) {
      const ce = new ComputeEngine();
      ce.declare('h', 'function');
      ce.assign('h', ce.parse('t\\mapsto t+i'));
      if (declared !== undefined) ce.declare('u', declared);
      const json = ['Add', 1, ['h', 'u']];
      const result = compile(
        ce.box(declared === undefined ? ['Function', json, 'u'] : json),
        { to: 'javascript', fallback: false } as any
      ) as any;
      const call = (u: unknown): unknown =>
        declared === undefined ? result.run(u) : result.run({ u });
      if (declared !== undefined)
        expect(call([1, 2])).toEqual([
          { re: 2, im: 1 },
          { re: 3, im: 1 },
        ]);
      if (declared === undefined) expect(call(3)).toEqual({ re: 4, im: 1 });
    }
  });

  test('an input declared a number keeps the scalar code', () => {
    // A list for `u` breaks the host's input contract here.
    const ce = engine({ u: 'number' });
    const result = compile(ce.box(['Add', 1, ['q', 'u']]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.code).not.toContain('_SYS.bcast(');
    expect(result.run({ u: 2 })).toBe(5);
  });
});
