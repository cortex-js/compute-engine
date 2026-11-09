# Browser Buddhabrot worker correctness experiment

Current CE source `916aff07c` runs the full 90001-element Buddhabrot histogram through its public `createKernelPool` and `runAsync` path in Chromium, with a dedicated coordinator worker creating two nested kernel workers. The original serial function, the adapted serial function, the asynchronous results and the independent prior JavaScript reference agree exactly for every element of the tested histograms.

This is a private integration prototype, not an implemented Tycho feature. The separate product control bundles the actual Tycho `installPreludeWorker` implementation and its prelude runner with installed CE 0.184.0. It does not replace Tycho dependencies or change the product worker entry.

## Provenance and transformation

Tycho source: `/tmp/wt-tycho-browser-profile`, `0e6482e1f`. CE source: `/tmp/wt-js-contract`, `916aff07c`. Node v26.13.0; Chromium 156.0.8078.4. `provenance.json` derives the full HEAD and porcelain status directly from both private worktrees at run start, records all three bundle hashes, and the `*-meta.json` files record their source dependencies. There were no page errors. Browser was not cross-origin isolated and `SharedArrayBuffer` was unavailable.

The experiment extracts the actual `function step` from the Buddhabrot showcase. It preserves the 150×200 grid, three planes, 5000/500/50 ceilings and low-discrepancy coefficients. `original.epsil`, `parallel.epsil` and `adaptation.diff` retain the exact change: mark the outer loop `parallel for`, and rewrite its six `L = replaceAt(L, i, L[i] + 1)` histogram updates to `L[i] += 1`. The cursor write remains after the loop. The adaptation is validated against the original serial function, not assumed equivalent.

The current-source compile omits `iterationBudget`. The first browser probe inherited `iterationBudget: Infinity` from the earlier installed Tycho instrument and declined pool routing: current `pool-loop.ts:842` treats any defined budget as an in-order route. Omitting it follows the current contract. The actual Tycho worker control retains the product's `Infinity` option. This is an integration consideration, not a compiler defect.

## Observations

Inputs start with cursor 137 and nonzero bins (value 2 at every 997th index). The input array is checked unchanged after each result and after cancellation.

| Case | Samples | Cursor | Histogram sum | Observed route | Sent call messages |
|---|---:|---:|---:|---|---:|
| Original serial, adapted serial, independent reference | 100 | 237 | 1940 | calling coordinator | — |
| Original serial, adapted serial, independent reference | 25000 | 25137 | 440026 | calling coordinator | — |
| runAsync without a pool | 100 | 237 | 1940 | calling-thread / no-pool | — |
| runAsync with minPasses 20000 | 100 | 237 | 1940 | calling-thread / below-threshold | 0 |
| runAsync with minPasses 1 | 100 | 237 | 1940 | pool | 2 |
| runAsync with minPasses 20000 | 25000 | 25137 | 440026 | pool | 2 |
| Replacement job following abort | 100 | 237 | 1940 | public async route | 2 |

Every comparison checks all 90001 values exactly, including the cursor. Pool routing is established by the static `parallelLoops` report, public `onLoop` reports and wrapped real browser Worker message traffic. `browser-result.json` retains the complete send/receive message log, including eight total `call` messages (two belong to the aborted job).

Zero work is an untested host-policy requirement, explicitly recorded as `zeroPolicy.tested: false`; it is not an execution control in this experiment. Raw `1..0` is a descending inclusive range; the instrument makes no claim that calling the raw step with zero is an identity. The reference is scoped to positive counts.

A signal aborted before invocation rejects with its reason and is asserted to send zero `call` messages. A second job of ten million samples is aborted after dispatch is observed; its promise rejects with the supplied supersession reason and publishes no result. The original input remains unchanged. A subsequent 100-sample job succeeds exactly and is asserted to dispatch exactly two calls to replacement worker IDs greater than 2 (observed IDs 3 and 4). Four workers were created in total; four `terminate()` invocations were recorded, including replacement and explicit disposal. These counts observe termination requests, not browser exit acknowledgments. The abort observation is after dispatch, not proof that a worker had begun arithmetic. The browser and loopback server are closed by the runner. No duplicate-delivery, stale-result-injection, page-navigation or parent-worker-forced-termination test was performed.

## Actual product worker control

The separate worker uses the actual Tycho `installPreludeWorker` body and installed CE 0.184.0. It checks the unmodified step with a zeroed 90001-element histogram and 100 samples. The resulting `answer` MathJSON list is compared exactly with the independent reference. The check is valid, its `answer.route` is asserted to be `compiled`, and the instrumentation records two compile calls and zero runAsync calls. This confirms the current synchronous prelude execution inside a dedicated browser worker for this input. It does not demonstrate that the product creates a nested pool, that the document manager applies the result, or that its page timeout service is integrated with that pool.

## Reproduction and validation

From `/tmp/wt-tycho-browser-profile`, under the parent-owned box lock:

```sh
node ~/.claude/scripts/box-lock.mjs check codex-js-contract && timeout -k 10 180 node scripts/profile-browser-run.mjs > /tmp/js-contract-browser/run.log 2>&1
```

Final command exit after review fixes: 0. The five review gaps were strengthened without changing measured results: replacement-worker routing, pre-aborted zero-dispatch, actual worktree provenance, compiled product answer, and explicit untested status of zero-work policy. `before-review/` preserves the original artifacts; `review-fix.diff` preserves the instrument delta. Runner syntax check `node --check scripts/profile-browser-run.mjs`: exit 0. The initial sandbox denied loopback listen with EPERM; the authorized local server/browser execution was escalated. The first escalated run failed the static-pool assertion due to the explicit budget option above; the corrected run passed. No performance measurements or claims, whole-app build, broad test suite, package install, shared dependency substitution, production edit, git mutation or staging occurred. All computation runs off the page in workers; this follows the retrieved modern-web-guidance performance rule, “DO separate UI updates from heavy computations.”

## Implications

The current CE public parallel-loop route can run the actual grid and ceilings in nested Chromium workers; a custom histogram scheduler is unnecessary for this adapted reduction. Future Tycho integration still needs an explicit async prelude execution point, a decision about iteration-budget versus pool admission, pool ownership and disposal across the real prelude service's supersession/deadline/restart lifecycle, and browser lifecycle tests in that product path. Pool eligibility and execution requirements remain separate from the numeric vocabulary profile.

## Plane observations

The final instrument records each plane separately. These are observed sums and increments relative to the seeded input, not just a combined histogram count.

| Samples | Plane 1 sum / increments | Plane 2 sum / increments | Plane 3 sum / increments |
|---|---|---|---|
| 100 | 648 / 586 | 646 / 586 | 646 / 586 |
| 25000 | 192080 / 192018 | 148246 / 148186 | 99700 / 99640 |

The browser lifecycle reference is the [HTML worker specification](https://html.spec.whatwg.org/multipage/workers.html). Its termination semantics do not turn this harness's invocation counter into an exit observation.
