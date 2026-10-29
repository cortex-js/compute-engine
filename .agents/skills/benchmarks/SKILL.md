---
name: benchmarks
description: Select, run, or change Compute Engine benchmark harnesses and interpret correctness or performance comparisons, including release-report generation.
---

# Compute Engine benchmarks

Read [benchmarks/README.md](../../../benchmarks/README.md) to choose the
smallest harness that answers the question. It owns harness commands, comparator
setup, reference baselines, and report locations; do not copy them into this
skill.

- State the behavior being measured, baseline, and expected observable result.
  Use an independent mathematical oracle where correctness is in question.
- Follow the
  [shared-machine measurement rules](../../../docs/COMPUTE-ENGINE-BOX-SPECIFICS.md)
  and shared protocol. Take the box lock for timing runs. Record runtime, build,
  precision, and warmup/repetition conditions that can affect the comparison.
- Confirm the baseline contains the relevant fixes and the instrument
  distinguishes a known control. Compare equivalent workloads and separate
  setup/startup costs from steady-state costs where the question requires it.
- Mark unavailable comparators and invalid or contended measurements explicitly.
  Do not present them as passing results or interpret their ratios.
- Run only the requested reports. Regenerate release tables when preparing or
  updating those tables, rather than after every benchmark experiment.
- When changing a harness, update its entry in the benchmark README and verify a
  representative case and control before starting a broad run.

Report the exact command, baseline and environment, correctness outcomes,
measurements, and limitations. Follow
[BUILD.md](../../../BUILD.md#completing-delegated-tasks) for delegated
validation and handoff responsibilities.
