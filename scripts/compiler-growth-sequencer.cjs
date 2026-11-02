// The Jest test sequencer of `scripts/compiler-growth.mjs`: it runs the test
// files in the order of their paths, and the compile depth probe last, so
// that the probe's one compile is the first compile in a Jest worker that
// has already run the other files. Jest's own sequencer orders the files by
// their earlier run times, which would put the probe at a position that
// changes from run to run.
const Sequencer = require('@jest/test-sequencer').default;

module.exports = class CompilerGrowthSequencer extends Sequencer {
  sort(tests) {
    const key = (t) => (t.path.includes('compile-depth-probe') ? '￿' : t.path);
    return [...tests].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  }
};
