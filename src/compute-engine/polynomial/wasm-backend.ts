import { PolynomialBudgetExceeded } from './exact-field.js';
import { primeField, type ModularFactorBackend } from './finite-field.js';

interface PolynomialWasmExports {
  memory: WebAssembly.Memory;
  inputPointer(): number;
  outputPointer(): number;
  factor(degree: number, prime: number, budget: number): number;
  operations(): number;
  errorCode(): number;
  __collect(): void;
}

/**
 * Instantiate the optional first-party kernel from caller-supplied bytes.
 * No network request, Node dependency or WASM initialization enters Factor's
 * default path. The rational factorizer verifies this backend's output.
 */
export async function createPolynomialWasmBackend(
  bytes: BufferSource
): Promise<ModularFactorBackend> {
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => {
        throw new Error('Polynomial WASM aborted');
      },
    },
  });
  const e = instance.exports as unknown as PolynomialWasmExports;
  return (f, prime, work) => {
    const K = primeField(prime);
    if (f.length < 2 || f.length > 129 || f[f.length - 1] !== 1n)
      throw new RangeError('WASM requires monic degree 1 to 128');
    work.tick(0);
    const budget = Math.min(
      2_000_000_000,
      Math.max(0, work.limit - work.operations)
    );
    const input = new Int32Array(e.memory.buffer, e.inputPointer(), f.length);
    for (let i = 0; i < f.length; i++) input[i] = Number(K.fromInteger(f[i]));
    try {
      const count = e.factor(f.length - 1, prime, budget);
      const output = new Int32Array(e.memory.buffer, e.outputPointer(), 16641);
      if (count < 1 || count > f.length - 1)
        throw new Error('Invalid WASM factor count');
      const factors: bigint[][] = [];
      let offset = 0;
      for (let i = 0; i < count; i++) {
        const length = output[offset++];
        if (length < 2 || length > f.length || offset + length > output.length)
          throw new Error('Invalid WASM factor length');
        factors.push(
          Array.from(output.subarray(offset, offset + length), BigInt)
        );
        offset += length;
      }
      return factors;
    } catch (error) {
      if (e.errorCode() === 1)
        throw new PolynomialBudgetExceeded('operation-limit');
      throw error;
    } finally {
      const operations = e.operations();
      e.__collect();
      work.tick(operations);
    }
  };
}
