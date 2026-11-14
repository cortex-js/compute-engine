import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { StoredJavaScript } from '../../src/runtime';

// CE-1276: the `profile` field of a compile result and of the stored code
// that the runtime loads have one type, so a host can give a copy of a
// compile result to `load()`, also one of the profile `'ir'`.
// `scripts/typecheck.sh` checks the types of this file.

const ce = new ComputeEngine();

describe('a copy of a compile result is stored code', () => {
  test('a copy of a result of the default profile loads', () => {
    const result = compile(ce.parse('x + 1'), { to: 'javascript' });
    const copy = { ...result };
    const stored: StoredJavaScript = copy;
    const f = createJavaScriptRuntime().load(stored);
    expect(f({ x: 2 })).toBe(3);
  });

  test('a copy of a result of the profile ir loads in each loader', () => {
    const rt = createJavaScriptRuntime();
    const result = compile(ce.parse('x + 1'), {
      to: 'javascript',
      profile: 'ir',
    });
    expect(result.profile).toBe('ir');
    const copy: StoredJavaScript = { ...result };
    expect(rt.load(copy)({ x: 2 })).toBe(3);
    expect([
      ...rt.loadBroadcast(copy)({ x: new Float64Array([1, 2]) }),
    ]).toEqual([2, 3]);
    expect(rt.loadBroadcastAsync(copy).shippable).toBe(true);
  });
});
