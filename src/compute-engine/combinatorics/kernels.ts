// Optional TypeScript kernels, by head: a fast path that a test holds equal to
// the statistic's Epsil definition on every small element. The definition (in
// `sources/`) is the meaning; a head without a kernel runs the definition.

/** A kernel reads the integers of an element and gives the value. */
export type Kernel = (values: readonly number[]) => number;

export const KERNELS: Readonly<Record<string, Kernel>> = {
  Ascents(p) {
    let c = 0;
    for (let i = 0; i + 1 < p.length; i++) if (p[i] < p[i + 1]) c++;
    return c;
  },
  Descents(p) {
    let c = 0;
    for (let i = 0; i + 1 < p.length; i++) if (p[i] > p[i + 1]) c++;
    return c;
  },
  Excedances(p) {
    let c = 0;
    for (let i = 0; i < p.length; i++) if (p[i] > i + 1) c++;
    return c;
  },
  Inversions(p) {
    let c = 0;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) c++;
    return c;
  },
  Peaks(p) {
    let c = 0;
    for (let i = 1; i + 1 < p.length; i++)
      if (p[i - 1] < p[i] && p[i] > p[i + 1]) c++;
    return c;
  },
  Antiexcedances(p) {
    let c = 0;
    for (let i = 0; i < p.length; i++) if (p[i] < i + 1) c++;
    return c;
  },
  CycleCount(p) {
    const seen = new Uint8Array(p.length);
    let c = 0;
    for (let i = 0; i < p.length; i++) {
      if (seen[i]) continue;
      c++;
      for (let j = i; !seen[j]; j = p[j] - 1) seen[j] = 1;
    }
    return c;
  },
  FixedPoints(p) {
    let c = 0;
    for (let i = 0; i < p.length; i++) if (p[i] === i + 1) c++;
    return c;
  },
  MajorIndex(p) {
    let sum = 0;
    for (let i = 1; i < p.length; i++) if (p[i - 1] > p[i]) sum += i;
    return sum;
  },
  Valleys(p) {
    let c = 0;
    for (let i = 1; i + 1 < p.length; i++)
      if (p[i - 1] > p[i] && p[i] < p[i + 1]) c++;
    return c;
  },
  LargestPart: (p) => (p.length === 0 ? 0 : p[0]),
};
