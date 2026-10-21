import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPolynomialWasmBackend } from '../../src/compute-engine/polynomial/wasm-backend';
import {
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import { factorFiniteField } from '../../src/compute-engine/polynomial/finite-field';
import {
  factorRationalPolynomial,
  verifyModularFactors,
} from '../../src/compute-engine/polynomial/factor-rational';

const path = resolve(__dirname, '../../build/polynomial-wasm/factor.wasm');
const wasmSuite = existsSync(path) ? describe : describe.skip;
wasmSuite(
  'First-party polynomial WASM kernel (build-polynomial-wasm.mjs)',
  () => {
    test('matches TypeScript factors and independently verifies every modular output', async () => {
      const backend = await createPolynomialWasmBackend(
        Uint8Array.from(readFileSync(path)).buffer
      );
      const signature = (fs: bigint[][]) => fs.map((f) => f.join(',')).sort();
      for (const p of [2, 3, 5, 7, 11, 251]) {
        for (let c = 1; c < 8; c++) {
          const f = [BigInt(c % p), 1n, 0n, 1n];
          let expected: bigint[][];
          try {
            expected = factorFiniteField(f, p, new PolynomialWork());
          } catch (e) {
            if (e instanceof RangeError && e.message.includes('square-free'))
              continue;
            throw e;
          }
          const got = backend(f, p, new PolynomialWork());
          expect(signature(got)).toEqual(signature(expected));
          verifyModularFactors(f, got, p);
        }
      }
    });
    test('hybrid rational factorization agrees and a cancelled call does not poison the next', async () => {
      const backend = await createPolynomialWasmBackend(
        Uint8Array.from(readFileSync(path)).buffer
      );
      const input = [2n, 0n, 3n, 0n, 1n].map((x) => q(x));
      expect(() => backend([1n, 1n, 0n, 1n], 2, new PolynomialWork(0))).toThrow(
        'operation-limit'
      );
      const hybrid = factorRationalPolynomial(input, {
        modularBackend: backend,
      });
      const native = factorRationalPolynomial(input);
      expect(hybrid.status).toBe('complete');
      expect(hybrid.factors).toEqual(native.factors);
      expect(hybrid.coefficient).toEqual(native.coefficient);
      for (let i = 0; i < 100; i++)
        expect(
          factorRationalPolynomial(input, { modularBackend: backend }).factors
        ).toEqual(native.factors);
    });
  }
);
