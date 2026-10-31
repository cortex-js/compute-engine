/**
 * A compilation that lowers an operator to a run-time broadcast
 * (`_SYS.bcast`) does not change the cache versions of the engine.
 *
 * The broadcast builds the scalar body of its closure with element
 * parameters (`_tv1`, `_tv2`). Boxing such a name auto-declares it, and
 * before the fix the declaration was made in the current scope of the
 * engine: compiling `L + 1` with `L` a `list<number>` advanced
 * `_anyVersion` (and `_callableVersion`) by 2, which made every cache keyed
 * on these versions recompute. The element parameters are now boxed in a
 * scratch scope (`withElementSymbols`,
 * `compilation/compile-broadcast.ts`).
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

type Json = any;

const VERSIONS = [
  '_anyVersion',
  '_semanticVersion',
  '_worldVersion',
  '_callableVersion',
  '_definitionVersion',
  '_conformanceVersion',
];

function versionsAround(
  ce: ComputeEngine,
  json: Json
): { before: unknown[]; after: unknown[]; code: string; value: unknown } {
  const expr = ce.box(json);
  void expr.type;
  const state = ce as unknown as Record<string, unknown>;
  const versions = () => VERSIONS.map((name) => state[name]);
  const before = versions();
  const result = compile(expr, { to: 'javascript', fallback: false } as any);
  const after = versions();
  return {
    before,
    after,
    code: (result as any).code,
    value: (result as any).run({ L: [1, 2, 3] }),
  };
}

describe('a compiled broadcast leaves the engine unchanged', () => {
  test('L + 1 with L a list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const { before, after, code, value } = versionsAround(ce, ['Add', 'L', 1]);
    expect(before.every((v) => typeof v === 'number')).toBe(true);
    expect(code).toContain('_SYS.bcast(');
    expect(after).toEqual(before);
    expect(value).toEqual([2, 3, 4]);
  });

  test('a unary function over a list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const { before, after, value } = versionsAround(ce, ['Sin', 'L']);
    expect(after).toEqual(before);
    expect(value).toEqual([1, 2, 3].map(Math.sin));
  });

  test('the element parameters are not declared in the engine', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    versionsAround(ce, ['Add', 'L', 1]);
    expect(ce.lookupDefinition('_tv1')).toBeUndefined();
    expect(ce.lookupDefinition('_tv2')).toBeUndefined();
  });
});
