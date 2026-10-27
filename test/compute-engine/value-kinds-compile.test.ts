// The compiled form of a value kind (`docs/plans/2026-10-26-value-kinds.md`,
// section 4.8): the per-type `compile.type` contract (`lowered`, `add`,
// `multiply`, `apply`, `entry`, `shippable`), the per-head `compile.value`,
// and the declines of phase 1.
//
// The test kind is `G: (integer) -> gf8`, an element of GF(8) held as its
// 3-bit representative. Its JavaScript representation is `{ gf8: n }`: a
// sum is the XOR of the representatives, a number operand is promoted to
// the element with the same low 3 bits.

import {
  ComputeEngine,
  compile,
  createKernelPool,
} from '../../src/compute-engine';
import type {
  ArithmeticCompile,
  ArithmeticDefinition,
  Expression,
} from '../../src/compute-engine';
import { createJavaScriptRuntime } from '../../src/compute-engine/compilation/javascript-runtime';
import {
  declareMyMod,
  declareUserMeasurement,
  gfMul,
} from './value-kinds-helpers';

type TypeContract = NonNullable<ArithmeticCompile['type']>;

/** The source of the 3-bit representative of the value of `code`: a number
 * is promoted, an element is read. */
const rep = (code: string): string =>
  `(((v) => typeof v === 'number' ? v & 7 : v.gf8)(${code}))`;

/** The source of the product of two representatives (`gfMul`). */
const MUL = `((a, b) => { let r = 0; for (let i = 0; i < 3; i++) if (b & (1 << i)) r ^= a << i; for (let i = 4; i >= 3; i--) if (r & (1 << i)) r ^= 0b1011 << (i - 3); return r; })`;

const isElement = (v: unknown): boolean =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as { gf8?: unknown }).gf8);

/** A full JavaScript contract for `gf8`, with `overrides`. */
function gf8Contract(overrides: Partial<TypeContract> = {}): TypeContract {
  return {
    lowered: ({ language }) => (language === 'javascript' ? 'gf8' : undefined),
    add: (args, compile, { language }) =>
      language === 'javascript'
        ? `({ gf8: ${args.map((x) => rep(compile(x))).join(' ^ ')} })`
        : undefined,
    multiply: (args, compile, { language }) =>
      language === 'javascript'
        ? `({ gf8: ${args.map((x) => rep(compile(x))).reduce((a, b) => `${MUL}(${a}, ${b})`)} })`
        : undefined,
    apply: (operator, args, compile, { language }) => {
      if (language !== 'javascript') return undefined;
      if (operator === 'Equal')
        return `(${rep(compile(args[0]))} === ${rep(compile(args[1]))})`;
      if (operator === 'Negate') return compile(args[0]);
      return undefined;
    },
    entry: (value) => isElement(value),
    ...overrides,
  };
}

/** The source of a literal `G(k)`, for an integer literal `k`. */
const gValue: ArithmeticCompile['value'] = (value) => {
  const k = (value as Expression & { op1: Expression }).op1.re;
  return Number.isInteger(k) ? `({ gf8: ${k & 7} })` : undefined;
};

function gArithmetic(compile?: ArithmeticCompile): ArithmeticDefinition {
  return {
    // The evaluation of the kind is not under test here: the hooks fold
    // nothing.
    add: () => undefined,
    multiply: () => undefined,
    negate: (x) => x.evaluated,
    divide: () => undefined,
    ...(compile !== undefined ? { compile } : {}),
  };
}

/** An engine with the type `gf8`, the head `G` declared with `compile`, and
 * `g: gf8`. */
function engineWithG(compile?: ArithmeticCompile): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('gf8', 'value', { mint: false });
  ce.declare('G', {
    signature: '(integer) -> gf8',
    arithmetic: gArithmetic(compile),
  });
  ce.declare('g', 'gf8');
  return ce;
}

describe('VALUE KINDS: COMPILE CONTRACT', () => {
  test('the acceptance example: g + G(2)', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    const result = compile(ce.parse('g + G(2)'), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run({ g: { gf8: 1 } } as never)).toEqual({ gf8: 3 });
    expect(result.freeSymbolTypes?.g).toMatchObject({
      type: 'gf8',
      lowered: 'gf8',
    });
    expect(() => result.run({ g: 1 } as never)).toThrow(
      '"g" (type `gf8`) is compiled as a value of its kind type'
    );
    expect(result.shippable).toBe(false);
    expect(result.valueKinds).toEqual(['gf8']);
  });

  test('a product, a comparison and a negation lower through the contract', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    const product = compile(ce.box(['Multiply', 'g', ['G', 3]]), {
      fallback: false,
    });
    // x·(x + 1) = x² + x in GF(8).
    expect(product.run({ g: { gf8: 2 } } as never)).toEqual({
      gf8: gfMul(2, 3),
    });
    const equal = compile(ce.box(['Equal', 'g', ['G', 9]]), {
      fallback: false,
    });
    expect(equal.run({ g: { gf8: 1 } } as never)).toBe(true);
    expect(equal.run({ g: { gf8: 2 } } as never)).toBe(false);
    const negate = compile(ce.box(['Negate', 'g']), { fallback: false });
    expect(negate.run({ g: { gf8: 5 } } as never)).toEqual({ gf8: 5 });
  });

  test('a number operand beside a kind value is the hook’s to promote', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    ce.declare('n', 'integer');
    const result = compile(ce.box(['Add', 'g', 'n']), { fallback: false });
    expect(result.run({ g: { gf8: 1 }, n: 7 } as never)).toEqual({ gf8: 6 });
  });

  test('a structural operator treats the representation as opaque', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    ce.declare('x', 'real');
    const result = compile(ce.box(['If', ['Greater', 'x', 0], 'g', ['G', 3]]), {
      fallback: false,
    });
    expect(result.run({ x: 1, g: { gf8: 5 } } as never)).toEqual({ gf8: 5 });
    expect(result.run({ x: -1, g: { gf8: 5 } } as never)).toEqual({ gf8: 3 });
  });

  test('the result of a kind lowering is returned raw', () => {
    // A representation with `re` and `im` fields: `normalizeRunResult()`
    // would read `{ re: 2, im: 0 }` as the number 2.
    const ce = engineWithG({
      type: gf8Contract({
        lowered: () => 'gf8',
        add: (args, compile) =>
          `({ re: ${args.map((x) => `${compile(x)}.gf8`).join(' ^ ')}, im: 0, gf8: ${args.map((x) => `${compile(x)}.gf8`).join(' ^ ')} })`,
      }),
      value: (value) =>
        `({ re: ${(value as Expression & { op1: Expression }).op1.re}, im: 0, gf8: ${(value as Expression & { op1: Expression }).op1.re} })`,
    });
    const result = compile(ce.box(['Add', 'g', ['G', 2]]), {
      fallback: false,
    });
    expect(result.run({ g: { re: 1, im: 0, gf8: 1 } } as never)).toEqual({
      re: 3,
      im: 0,
      gf8: 3,
    });
  });

  test('a function literal with a parameter of the kind type checks it at entry', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    const result = compile(
      ce.box(['Function', ['Add', 'h', ['G', 2]], ['Typed', 'h', "'gf8'"]]),
      { fallback: false }
    );
    expect(result.run({ gf8: 1 } as never)).toEqual({ gf8: 3 });
    expect(() => result.run(1 as never)).toThrow(
      'argument 1 (type `gf8`) is compiled as a value of its kind type'
    );
    expect(result.valueKinds).toEqual(['gf8']);
  });

  test('an operation the contract does not define declines', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    expect(() =>
      compile(ce.box(['Divide', 'g', ['G', 3]]), { fallback: false })
    ).toThrow(
      "Could not compile `Divide` with an operand of the kind type 'gf8'"
    );
    const multiplyless = engineWithG({
      type: gf8Contract({ multiply: undefined }),
      value: gValue,
    });
    expect(() =>
      compile(multiplyless.box(['Multiply', 'g', ['G', 3]]), {
        fallback: false,
      })
    ).toThrow(
      "Could not compile `Multiply` with an operand of the kind type 'gf8'"
    );
  });

  test('a target the contract does not answer for declines', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    expect(() =>
      compile(ce.box(['Add', 'g', ['G', 2]]), {
        to: 'python',
        fallback: false,
      })
    ).toThrow("holds a value of the kind type 'gf8' to target 'python'");
  });

  test('a kind with only `compile.value` declines', () => {
    const ce = engineWithG({ value: gValue });
    expect(() =>
      compile(ce.box(['Add', 'g', ['G', 2]]), { fallback: false })
    ).toThrow("holds a value of the kind type 'gf8'");
    expect(() => compile(ce.box(['G', 2]), { fallback: false })).toThrow(
      "holds a value of the kind type 'gf8'"
    );
  });

  test('a literal of a head without `compile.value` declines', () => {
    const ce = engineWithG({ type: gf8Contract() });
    expect(() =>
      compile(ce.box(['Add', 'g', ['G', 2]]), { fallback: false })
    ).toThrow('Could not compile a value of `G`');
    // A free symbol of the type needs no head.
    const result = compile(ce.box(['Add', 'g', 'g']), { fallback: false });
    expect(result.run({ g: { gf8: 3 } } as never)).toEqual({ gf8: 0 });
  });

  test('a representation that the runner reads as a number is refused', () => {
    const ce = engineWithG({
      type: gf8Contract({ lowered: () => 'number' }),
      value: gValue,
    });
    expect(() =>
      compile(ce.box(['Add', 'g', ['G', 2]]), { fallback: false })
    ).toThrow('which is a value convention of the runner');
  });

  test('two live heads of one type with different `compile.type` are refused', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    expect(() =>
      ce.declare('G2', {
        signature: '(integer) -> gf8',
        arithmetic: gArithmetic({ type: gf8Contract(), value: gValue }),
      })
    ).toThrow('another `compile.type`');
  });

  test('a user head cannot add a `compile.type` to `residue`', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('MyMod', {
        signature: '(integer, integer) -> residue',
        arithmetic: {
          add: () => undefined,
          negate: () => undefined,
          compile: { type: gf8Contract() },
        },
      })
    ).toThrow('declared by the library without a `compile.type`');
  });

  test('a collection of kind values declines on every target', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    ce.declare('L', 'list<gf8>');
    expect(() =>
      compile(ce.box(['Add', 'L', 'L']), { fallback: false })
    ).toThrow("holds a collection of values of the kind type 'gf8'");
    expect(() =>
      compile(ce.box(['List', ['G', 1], ['G', 2]]), { fallback: false })
    ).toThrow("holds a collection of values of the kind type 'gf8'");
    // The type report of the fallback does not read a list as one value.
    const fallback = compile(ce.box(['Add', 'L', 'L']));
    expect(fallback.success).toBe(false);
    expect(fallback.freeSymbolTypes?.L?.lowered).not.toBe('gf8');
  });

  test('code from a kind lowering cannot be stored', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    const result = compile(ce.box(['Add', 'g', ['G', 2]]), {
      fallback: false,
    });
    const runtime = createJavaScriptRuntime();
    expect(() => runtime.load(result as never)).toThrow('cannot be loaded');
    // The entry plan alone does not carry the check either.
    expect(() =>
      runtime.load({ ...result, valueKinds: undefined } as never)
    ).toThrow('cannot be loaded');
    expect(() => runtime.loadBroadcast(result as never)).toThrow(
      'A value-kind result cannot be broadcast'
    );
  });

  test('the batch loaders refuse stored kind code, even when shippable', () => {
    // A pool whose workers are never created: no worker may get the code.
    const pool = createKernelPool({
      create: () => {
        throw new Error('no workers');
      },
      size: 1,
    });
    const ce = engineWithG({
      type: gf8Contract({ shippable: true }),
      value: gValue,
    });
    // No input of the kind and no helper of the host: marked shippable.
    const result = compile(ce.box(['Add', ['G', 1], ['G', 2]]), {
      fallback: false,
    });
    expect(result.shippable).toBe(true);
    expect(result.valueKinds).toEqual(['gf8']);
    const runtime = createJavaScriptRuntime();
    const message =
      "A value-kind result cannot be broadcast: the code reads or makes a value of the kind type 'gf8'";
    expect(() => runtime.loadBroadcast(result as never)).toThrow(message);
    expect(() => runtime.loadBroadcastSlice(result as never)).toThrow(message);
    // The asynchronous loader throws at load, so it never makes a
    // `willUsePool` or sends a batch to the pool.
    expect(() =>
      runtime.loadBroadcastAsync(result as never, { workers: pool })
    ).toThrow(message);
    pool.dispose();
  });

  test('`shippable` follows the contract', () => {
    const shippable = engineWithG({
      type: gf8Contract({ shippable: true }),
      value: gValue,
    });
    // No input of the kind: the code needs nothing of the host.
    const constant = compile(shippable.box(['Add', ['G', 1], ['G', 2]]), {
      fallback: false,
    });
    expect(constant.run()).toEqual({ gf8: 3 });
    expect(constant.shippable).toBe(true);
    // An input of the kind needs the entry check of the host.
    const input = compile(shippable.box(['Add', 'g', ['G', 2]]), {
      fallback: false,
    });
    expect(input.shippable).toBe(false);
    // A helper of the host cannot be carried to a worker.
    const helpers = engineWithG({
      type: gf8Contract({ shippable: true, hostNames: ['gf8Add'] }),
      value: gValue,
    });
    expect(
      compile(helpers.box(['Add', ['G', 1], ['G', 2]]), { fallback: false })
        .shippable
    ).toBe(false);
  });

  // ROADMAP CE-507.1, decided with CE-518 (2026-10-26): the `helpers` of a
  // contract are copied into the code, so the code stays shippable.
  test('the `helpers` of a contract travel with the code', () => {
    const ce = engineWithG({
      type: gf8Contract({
        shippable: true,
        helpers: { gf8Xor: (a: number, b: number) => a ^ b },
        add: (args, compile, { language }) =>
          language === 'javascript'
            ? `({ gf8: ${args
                .map((x) => rep(compile(x)))
                .reduce((a, b) => `gf8Xor(${a}, ${b})`)} })`
            : undefined,
      }),
      value: gValue,
    });
    const r = compile(ce.box(['Add', ['G', 1], ['G', 2]]), {
      fallback: false,
    });
    expect(r.preamble).toContain('const gf8Xor = (');
    expect(r.run()).toEqual({ gf8: 3 });
    expect(r.shippable).toBe(true);
  });

  test('a contract helper comes before a hoisted value that calls it', () => {
    const ce = engineWithG({
      type: gf8Contract({
        shippable: true,
        helpers: { gf8Of: (k: number) => ({ gf8: k & 7 }) },
      }),
      value: (value) => {
        const k = (value as Expression & { op1: Expression }).op1.re;
        return Number.isInteger(k) ? `gf8Of(${k})` : undefined;
      },
    });
    ce.declare('a', 'gf8');
    ce.assign('a', ce.box(['G', 3]));
    const r = compile(ce.box(['Add', 'a', ['G', 1]]), { fallback: false });
    const preamble = r.preamble!;
    expect(preamble.indexOf('const gf8Of')).toBeGreaterThanOrEqual(0);
    expect(preamble.indexOf('const gf8Of')).toBeLessThan(
      preamble.indexOf('const _val_a')
    );
    expect(r.run()).toEqual({ gf8: 2 });
  });

  test('a contract helper with no source is refused at declaration', () => {
    const ce = new ComputeEngine();
    ce.declareType('gf8', 'value', { mint: false });
    expect(() =>
      ce.declare('G', {
        signature: '(integer) -> gf8',
        arithmetic: gArithmetic({
          type: gf8Contract({ helpers: { gf8Xor: Math.max } }),
        }),
      })
    ).toThrow('arithmetic.compile.type.helpers');
  });

  test('a residue class declines, with the message that names `residue`', () => {
    const ce = new ComputeEngine();
    declareMyMod(ce);
    ce.declare('x', 'real');
    expect(() =>
      compile(ce.box(['Add', 'x', ['MyMod', 2, 5]]), { fallback: false })
    ).toThrow("holds a residue class (type 'residue')");
    expect(() =>
      compile(ce.box(['Add', 'x', ['ResidueClass', 2, 5]]), {
        fallback: false,
      })
    ).toThrow("holds a residue class (type 'residue')");
  });

  test('a kind with no `compile` declines, with the message that names it', () => {
    const ce = new ComputeEngine();
    declareUserMeasurement(ce);
    ce.declare('U', 'umeasurement');
    expect(() => compile(ce.box(['Sin', 'U']), { fallback: false })).toThrow(
      "holds a value of the kind type 'umeasurement'"
    );
  });

  test('a binding of a union of two kind types declines', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    // A second kind, `gf4`, with its own contract and entry check.
    ce.declareType('gf4', 'value', { mint: false });
    ce.declare('H', {
      signature: '(integer) -> gf4',
      arithmetic: gArithmetic({
        type: gf8Contract({
          lowered: ({ language }) =>
            language === 'javascript' ? 'gf4' : undefined,
          entry: (value) =>
            typeof value === 'object' &&
            value !== null &&
            Number.isInteger((value as { gf4?: unknown }).gf4),
        }),
        value: gValue,
      }),
    });
    ce.declare('u', 'gf8 | gf4');
    expect(() => compile(ce.box('u'), { fallback: false })).toThrow(
      `the symbol "u" of the type 'gf8' | 'gf4'`
    );
    expect(() =>
      compile(ce.box(['Add', 'u', ['G', 2]]), { fallback: false })
    ).toThrow(`the symbol "u" of the type 'gf8' | 'gf4'`);
    expect(() =>
      compile(ce.box(['Function', 'v', ['Typed', 'v', "'gf8 | gf4'"]]), {
        fallback: false,
      })
    ).toThrow(`the symbol "v" of the type 'gf8' | 'gf4'`);
  });

  test('a kind result cannot be broadcast', async () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    const result = compile(ce.box(['Add', 'g', ['G', 2]]), {
      fallback: false,
    });
    expect(() => result.broadcast!({ g: new Float64Array([1, 2]) })).toThrow(
      'A value-kind result cannot be broadcast'
    );
    await expect(
      result.broadcastAsync!({ g: new Float64Array([1, 2]) })
    ).rejects.toThrow('A value-kind result cannot be broadcast');
  });

  test('`willUsePool` is false for a kind result', () => {
    // A pool whose workers are never created: `willUsePool` only reads it.
    const pool = createKernelPool({
      create: () => {
        throw new Error('no workers');
      },
      size: 1,
    });
    const ce = engineWithG({
      type: gf8Contract({ shippable: true }),
      value: gValue,
    });
    ce.workers = pool;
    // Shippable code of a kind result: `broadcastAsync` rejects it, so it
    // never goes to the pool.
    const kind = compile(ce.box(['Add', ['G', 1], ['G', 2]]), {
      fallback: false,
    });
    expect(kind.shippable).toBe(true);
    expect(kind.willUsePool!(1_000_000)).toBe(false);
    // The same engine sends a large batch of a numeric result to the pool.
    ce.declare('x', 'real');
    const numeric = compile(ce.parse('x^2 + 1'), { fallback: false });
    expect(numeric.willUsePool!(1_000_000)).toBe(true);
    pool.dispose();
  });

  test('an expression that may be a number compiles as a number', () => {
    const ce = engineWithG({ type: gf8Contract(), value: gValue });
    ce.declare('p', 'number | gf8');
    const result = compile(ce.box(['Add', 'p', 1]), { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run({ p: 2 } as never)).toBe(3);
    expect(result.valueKinds).toBeUndefined();
  });
});
