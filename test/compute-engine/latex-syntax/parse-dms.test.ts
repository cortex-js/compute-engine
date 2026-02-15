import { ComputeEngine } from '../../../src/compute-engine';
import type { SerializeLatexOptions } from '../../../src/compute-engine';

describe('DMS Serialization Configuration', () => {
  test('SerializeLatexOptions accepts dmsFormat', () => {
    const ce = new ComputeEngine();
    const options: SerializeLatexOptions = { dmsFormat: true };
    // Type check passes
    expect(options.dmsFormat).toBe(true);
  });

  test('SerializeLatexOptions accepts angleNormalization', () => {
    const ce = new ComputeEngine();
    const options: SerializeLatexOptions = {
      angleNormalization: '-180...180'
    };
    expect(options.angleNormalization).toBe('-180...180');
  });
});
