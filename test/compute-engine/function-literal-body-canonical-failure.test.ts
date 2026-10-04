import { ComputeEngine } from '../../src/compute-engine';

/**
 * When the `canonical` handler of the body `Block` of a function literal
 * throws, the engine logs the exception and boxes the block non-canonical,
 * with no scope. The literal then read the missing scope to declare its
 * parameters and failed with `Cannot read properties of undefined (reading
 * 'bindings')`, and the original exception was lost. The literal now throws
 * the original exception again (`canonicalFunctionLiteralArguments()`,
 * `function-utils.ts`; `canonical-failure.ts`).
 *
 * The failure is forced with a collection operator whose `isEmpty` handler
 * throws: the argument checks of `Add`, which run while the block is
 * canonicalized, read that flag.
 */
const MESSAGE = 'boom: the size of this collection is not known';

function engineWithBoom(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Boom', {
    signature: '(any) -> list<integer>',
    collection: {
      isFinite: () => true,
      isEnumerable: () => false,
      isEmpty: () => {
        throw new Error(MESSAGE);
      },
      count: () => 3,
      at: () => undefined,
      iterator: () => ({ next: () => ({ done: true, value: undefined }) }),
    },
  } as any);
  return ce;
}

const literal = ['Function', ['Block', ['Add', ['Boom', 'n'], 1]], 'n'];

describe('a function literal whose body fails to canonicalize', () => {
  let errors: jest.SpyInstance;
  beforeEach(() => {
    errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  test('an assignment gives the original exception to the caller', () => {
    const ce = engineWithBoom();
    expect(() => ce.expr(['Assign', 's', literal] as any).evaluate()).toThrow(
      MESSAGE
    );
  });

  test('a parsed definition gives the original exception to the caller', () => {
    const ce = engineWithBoom();
    expect(() =>
      ce.parse('s(n) := \\operatorname{Boom}(n) + 1').evaluate()
    ).toThrow(MESSAGE);
  });

  test('a boxed literal logs the original exception, not the missing scope', () => {
    const ce = engineWithBoom();
    const expr = ce.expr(literal as any);
    expect(expr.isCanonical).toBe(false);
    const logged = errors.mock.calls.map((args) => args.join(' '));
    expect(
      logged.some((m) => m.includes('`Function`') && m.includes(MESSAGE))
    ).toBe(true);
    expect(logged.some((m) => m.includes("reading 'bindings'"))).toBe(false);
  });
});
