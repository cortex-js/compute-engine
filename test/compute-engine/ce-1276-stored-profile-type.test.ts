import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { StoredJavaScript } from '../../src/runtime';

// CE-1276: the `profile` field of a compile result and of the stored code
// that the runtime loads have one type, so a host can give a copy of a
// compile result to `load()`. The loaders refuse the code of the profile
// `'ir'` at run time. `scripts/typecheck.sh` checks the types of this file.

const ce = new ComputeEngine();

describe('a copy of a compile result is stored code', () => {
  test('a copy of a result of the default profile loads', () => {
    const result = compile(ce.parse('x + 1'), { to: 'javascript' });
    const copy = { ...result };
    const stored: StoredJavaScript = copy;
    const f = createJavaScriptRuntime().load(stored);
    expect(f({ x: 2 })).toBe(3);
  });

  test('a copy of a result of the profile ir is refused by each loader', () => {
    const rt = createJavaScriptRuntime();
    const result = compile(ce.parse('x + 1'), {
      to: 'javascript',
      profile: 'ir',
    });
    expect(result.profile).toBe('ir');
    // A host copy that sets the runtime version: the profile still refuses.
    const copy = { ...result, runtimeVersion: rt.runtimeVersion };
    expect(() => rt.load(copy)).toThrow(/profile 'ir'/);
    expect(() => rt.loadBroadcast(copy)).toThrow(/profile 'ir'/);
    expect(() => rt.loadBroadcastSlice(copy)).toThrow(/profile 'ir'/);
    expect(() => rt.loadBroadcastAsync(copy)).toThrow(/profile 'ir'/);
  });
});
