export class CancellationError<T = unknown> extends Error {
  cause: unknown;
  value: T;

  constructor({
    message,
    value,
    cause,
  }: { message?: string; value?: T; cause?: unknown } = {}) {
    super(message ?? 'Operation canceled');
    if (value) this.value = value;
    this.cause = cause;
    this.name = 'CancellationError';
  }
}

/**
 * Executes a generator asynchronously with timeout and abort signal support.
 *
 * @param gen - The generator to execute.
 * @param timeLimitMs - The maximum time (in milliseconds) allowed for execution.
 * @param signal - An AbortSignal to cancel execution prematurely.
 * @returns The final value produced by the generator.
 * @throws CancellationError if the operation is canceled or times out.
 */
export async function runAsync<T>(
  gen: Generator<T>,
  timeLimitMs: number,
  signal?: AbortSignal
): Promise<T> {
  const startTime = performance.now();

  while (true) {
    const chunkStart = performance.now();
    const chunkDurationMs = 16; // Maximum chunk duration in milliseconds

    // Process a chunk of iterations
    while (performance.now() - chunkStart < chunkDurationMs) {
      const { done, value } = gen.next();

      if (done) return value; // Exit successfully

      // Check for abort signal within the chunk
      if (signal?.aborted)
        throw new CancellationError({ value, cause: (signal as any).reason });

      // Check overall time limit
      if (performance.now() - startTime >= timeLimitMs)
        throw new CancellationError({
          value,
          cause: 'timeout',
          message: `Timeout exceeded (${timeLimitMs}ms)`,
        });
    }

    // Allow event loop to process other tasks
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function run<T>(gen: Generator<T>, timeLimitMs: number): T {
  const startTime = Date.now();

  while (true) {
    const { done, value } = gen.next();

    if (done) return value; // Return the result if generator is done

    // Check for timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeLimitMs) {
      throw new CancellationError({
        value,
        cause: 'timeout',
        message: `Timeout exceeded (${timeLimitMs}ms)`,
      });
    }
  }
}

// Example usage
/*
function* factorial(n: number): Generator<number> {
  if (n === 0) return 1;
  
  for (let i = n - 1; i > 1; i--) {
    n *= i;
    yield n;
  }
  return n;
}

const controller = new AbortController();
(async () => {
  const signal = controller.signal;

  try {
    const result = await runAsync(factorial(200), 300, signal);
    console.log('Result:', result);
  } catch (error) {
    if (error instanceof CancellationError) {
      console.error('Cancelled:', error.message);
      console.error('Reason:', error.cause);
      console.error('Partial result:', error.value);
    } else if (error instanceof Error) {
      console.error('Error:', error.message);
    }
  }
})();

// Simulate an interruption after 200ms (less than the 300ms timeout)
setTimeout(() => {
  controller.abort('user canceled');
}, 200);

// Wait for 2000ms
await new Promise((resolve) => setTimeout(resolve, 2000));



*/
