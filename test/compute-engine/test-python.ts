/**
 * The Python interpreter that the tests which run compiled Python code use.
 *
 * The environment variable `CE_PYTHON` comes first. A git worktree has no
 * `venv` directory of its own, so without `CE_PYTHON` these tests were
 * skipped in a worktree, with no message. Then the repo's
 * `./venv/bin/python3`, found from this directory or from the working
 * directory. The value is `undefined` when none of these files exists.
 *
 * A test file still checks the Python modules it needs (NumPy, SciPy) and
 * skips its Python tests when they are not available.
 */
import * as fs from 'fs';
import * as path from 'path';

export const TEST_PYTHON: string | undefined = [
  process.env.CE_PYTHON,
  path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
  path.join(process.cwd(), 'venv', 'bin', 'python3'),
].find((p) => p !== undefined && p !== '' && fs.existsSync(p));

// Make the skip visible in the test output: the Python tests of the file that
// imports this module will be skipped.
if (TEST_PYTHON === undefined)
  console.warn(
    'No Python found: the tests that run compiled Python code are skipped. Set CE_PYTHON to a python3 with NumPy and SciPy, or create ./venv.'
  );
