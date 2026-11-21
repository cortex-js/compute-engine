// Prepared Documents read the engine-wide type, protocol and value-kind registries.
// The profile keeps this lease until its last import and revision is released.
const readers = new WeakMap<object, number>();

export function retainDocumentRegistryReader(engine: object): () => void {
  readers.set(engine, (readers.get(engine) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = readers.get(engine)!;
    if (count === 1) readers.delete(engine);
    else readers.set(engine, count - 1);
  };
}

export function assertDocumentRegistryWritable(
  engine: object,
  subject = 'Type and protocol registries'
): void {
  if (readers.has(engine))
    throw new Error(
      `${subject} are read-only while a Document environment is live`
    );
}
