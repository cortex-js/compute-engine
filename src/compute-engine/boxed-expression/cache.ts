export type CachedValue<T> = {
  value: T | null;
  generation: number | undefined;
};

/** The cache v will get updated if necessary */
export function cachedValue<T>(
  v: CachedValue<T>,
  generation: number | undefined,
  fn: () => T
): T {
  if (v.generation === undefined || v.generation === generation) {
    if (v.value === null) v.value = fn();
    return v.value;
  }

  // If the generation is different, we need to update the value
  v.generation = generation;
  v.value = fn();
  return v.value;
}
