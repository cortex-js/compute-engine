// Records every read of `BigDecimal.precision` during a Jest run.
//
// Engine code passes its precision (`ce.precision`, or the `prec` of a
// kernel) to every `BigDecimal` and `NumericValue` operation that rounds or
// bounds a result. A read of the static is a call that omitted the argument:
// it computes at the library default, not at the precision of the engine.
// A grep does not find such a call; this setup file does, for the code that
// the tests reach.
//
// Each read is keyed by the first stack frame outside `src/big-decimal/` and
// by its caller: when the first frame is the default of a parameter
// (`prec = BigDecimal.precision`), the caller is the call that omitted the
// argument. Run from the root of the repository:
//
//   CE_PRECISION_TRACE=/tmp/trace npx jest -w 2 \
//     --setupFilesAfterEnv "$PWD/scripts/precision-trace-setup.ts" \
//     -- <test files>
//   node scripts/precision-trace-report.mjs /tmp/trace src/
//
// Each test file appends one line of JSON to `<dir>/reads-<pid>.jsonl`;
// delete the directory before a new run. Without `CE_PRECISION_TRACE` the
// file does nothing. The reads that remain legitimately are the public
// defaults, called by tests or by a host.
import * as fs from 'node:fs';
import * as path from 'node:path';

const outDir = process.env.CE_PRECISION_TRACE;
if (outDir) {
  // Resolve the BigDecimal of the checkout under test (module identity).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BigDecimal } = require(path.join(process.cwd(), 'src/big-decimal'));
  const root = process.cwd() + '/';
  const counts = new Map<string, number>();
  let value: number = BigDecimal.precision;
  Object.defineProperty(BigDecimal, 'precision', {
    configurable: true,
    get() {
      const saved = Error.stackTraceLimit;
      Error.stackTraceLimit = 40;
      const stack = new Error().stack ?? '';
      Error.stackTraceLimit = saved;
      // The first frame outside src/big-decimal, and its caller: when the
      // read is the default of a parameter, the caller omitted the argument.
      const frames: string[] = [];
      for (const line of stack.split('\n').slice(2)) {
        const m = /\(?([^()\s]+):(\d+):\d+\)?$/.exec(line.trim());
        if (!m) continue;
        const file = m[1].startsWith(root) ? m[1].slice(root.length) : m[1];
        if (frames.length === 0 && file.startsWith('src/big-decimal/'))
          continue;
        if (file.includes('precision-trace-setup')) continue;
        frames.push(`${file}:${m[2]}`);
        if (frames.length === 2) break;
      }
      const site = frames.length ? frames.join(' <- ') : '?';
      counts.set(site, (counts.get(site) ?? 0) + 1);
      return value;
    },
    set(v: number) {
      value = v;
    },
  });
  afterAll(() => {
    fs.mkdirSync(outDir, { recursive: true });
    const testFile = path.relative(
      root,
      (expect.getState().testPath as string) ?? '?'
    );
    fs.appendFileSync(
      path.join(outDir, `reads-${process.pid}.jsonl`),
      JSON.stringify({ testFile, reads: Object.fromEntries(counts) }) + '\n'
    );
  });
}
