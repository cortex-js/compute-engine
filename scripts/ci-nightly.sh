#!/usr/bin/env bash
#
# ci-nightly.sh — run the full test suite at the HEAD of the main tree once a
# night, in a worktree of its own, and record the result.
#
#   bash scripts/ci-nightly.sh install     start it every night at 02:30 (launchd)
#   bash scripts/ci-nightly.sh uninstall   stop it
#   bash scripts/ci-nightly.sh run         one run now (what launchd starts)
#   bash scripts/ci-nightly.sh run [--force] [--commit <sha>]
#                                          --force: run even when the commit
#                                          already passed; --commit: test that
#                                          commit, not the main tree's HEAD
#                                          (the publish check passes the HEAD
#                                          of the tree it publishes from)
#   bash scripts/ci-nightly.sh status      print the last recorded result
#
# Why (user decision 2026-10-28): a session no longer runs the full suite
# before each commit. It runs the typecheck and the tests of the area it
# changed, and this job runs the full suite once for all the commits of the
# day. A session also starts `run` by hand when 5 or more commits have
# landed since the last passing run
# (`node ~/.claude/scripts/suite-status.mjs train` says when), and the
# `prepublishOnly` check refuses a release unless the full suite passed at
# HEAD (`suite-status.mjs release-check`). The rules are in
# `~/.claude/SHARED-BOX-PROTOCOL.md`, section 5.7.
#
# `run`:
#   1. Reads the HEAD of the main tree. When the last COMPLETE run PASSED at
#      that same commit, it records an `unchanged` attempt and stops.
#      `run --force` runs anyway. A commit whose run failed runs again.
#   2. Takes the box lock, waiting at most WAIT_MINUTES for it, because a
#      full suite uses 12 workers.
#   3. Makes a detached worktree at that commit under STATE_DIR, links the
#      main tree's node_modules into it, and runs, in order: `npm run
#      typecheck`, the declaration build that the declaration test reads
#      (`dist/types/compute-engine.d.ts`), and `bash scripts/test.sh` (the
#      declaration test, the whole jest suite and the checkpoint canary).
#   4. Records the result in STATE_DIR, in the format of Tycho's nightly job
#      so that `~/.claude/scripts/suite-status.mjs` reads both:
#      - `last.json`: the last COMPLETE run: the commit, the times, the exit
#        code, `passed` or `failed`, and what failed (`typecheck`,
#        `declarations`, or the path of each failing test file).
#      - `attempt.json`: the last attempt of any kind. Its result can also
#        be `unchanged` (nothing to run), `skipped` (no box lock) or `error`
#        (the worktree could not be made, or the run was interrupted). Such
#        an attempt does not replace the last complete result.
#   5. Calls `suite-status.mjs notify`, which shows a macOS notification
#      when the run failed.
#
# STATE_DIR is `${XDG_STATE_HOME:-$HOME/.local/state}/compute-engine-ci-nightly`.
# It is outside the repository because the result belongs to this machine,
# not to a tree.
#
# launchd starts jobs with a minimal PATH, and the directory of a given Node
# version disappears when nvm removes that version. So `run` looks for
# `node` on PATH first, then in the nvm default version, then in the newest
# nvm version. A machine that sleeps at 02:30 runs the job when it wakes,
# and `caffeinate -i` keeps it awake until the run ends.

REPO_OF_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMMON_DIR="$(cd "$(git -C "$REPO_OF_SCRIPT" rev-parse --path-format=absolute --git-common-dir)" && pwd -P)"
REPO="$(dirname "$COMMON_DIR")"
export REPO

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/compute-engine-ci-nightly"
LABEL="local.compute-engine.ci-nightly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BOX_LOCK="$HOME/.claude/scripts/box-lock.mjs"
SUITE_STATUS="$HOME/.claude/scripts/suite-status.mjs"
# The box-lock owner. Started from a Claude session, the lock accepts only
# that session's name (or `<name>:<label>`), which `whoami` prints. Started
# by launchd there is no session, and the name is unique to the run: the
# lock admits a second acquire by the same owner, so a shared name would let
# two runs hold one lock.
if SESSION_NAME="$(node "$HOME/.claude/scripts/box-lock.mjs" whoami 2>/dev/null)" && [ -n "$SESSION_NAME" ]; then
  OWNER="$SESSION_NAME:nightly-$$"
else
  OWNER="ce-nightly-$$"
fi
# A full run without the nightly suites took 7 to 9 minutes on a loaded box
# (2026-10-28). The nightly suites (test/compute-engine/nightly/) are broad
# grids and add more. DEADLINE_MINUTES stops a run that hangs before its
# lock expires: box-lock voids a hold 10 minutes after HOLD_MINUTES even
# while the holder lives, and the next session would then load the box
# while this run still does.
WAIT_MINUTES=180
HOLD_MINUTES=60
DEADLINE_MINUTES=55
START_HOUR=2
START_MINUTE=30
LOGS_KEPT=14

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' \
    "${BASH_SOURCE[0]}"
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# write_state <file> <sha> <started> <ended> <exit> <result> <log> [failed...]
write_state() {
  mkdir -p "$STATE_DIR"
  node -e '
    const [file, sha, startedAt, endedAt, exit, result, log, ...failedJobs] = process.argv.slice(1);
    // `repo` lets suite-status.mjs find the repo of this state directory.
    const state = { sha, startedAt, endedAt, exit: Number(exit), result, failedJobs, log, leftOut: [], repo: process.env.REPO };
    require("node:fs").writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  ' "$@"
}

# covered <sha>: true when a passing full run already covers the commit, by
# the same rule as the release check: the run tested that commit, or every
# change since the tested commit is markdown outside src/ and test/ or a
# version number. A run queued behind another one that covers its commit
# (a publish of a version bump while the run of the commit before it is in
# progress) then does nothing. A commit whose latest run failed is not
# covered and runs again.
covered() {
  node "$SUITE_STATUS" release-check --repo "$REPO" --head "$1" >/dev/null 2>&1
}

find_node() {
  command -v node >/dev/null 2>&1 && return 0
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}" default dir
  default="$(cat "$nvm_dir/alias/default" 2>/dev/null)"
  dir="$nvm_dir/versions/node/v${default#v}/bin"
  if [ -z "$default" ] || [ ! -x "$dir/node" ]; then
    dir="$(ls -1d "$nvm_dir"/versions/node/v*/bin 2>/dev/null | sort -V | tail -1)"
  fi
  [ -n "$dir" ] && [ -x "$dir/node" ] || return 1
  PATH="$dir:$PATH"
  export PATH
}

# Every run uses the same worktree path. Jest names its transform cache
# after the project directory, so a new path per run would start each run
# with an empty cache and leave the old cache behind in the temporary
# directory. Only one run may use the path at a time. The box lock is not
# enough for that: it expires 10 minutes after its hold (HOLD_MINUTES), even
# while the run is alive. So the run also writes its pid to WT_OWNER, and a
# run that finds the pid of a live run there stops (see claim_worktree).
WT="$STATE_DIR/worktree"
WT_OWNER="$STATE_DIR/worktree.pid"

# claim_worktree: returns 1 when a live run still uses WT. Otherwise removes
# what an earlier run left (a run killed with no time to clean up) and the
# per-run worktrees (`wt-*`) of older versions of this script, and records
# this run as the owner of WT. Call it only while holding the box lock.
claim_worktree() {
  local owner wt
  owner="$(cat "$WT_OWNER" 2>/dev/null)"
  # A live pid counts only when it is still a run of this script: after a
  # crash, the system can give the same pid to an unrelated process.
  if [ -n "$owner" ] && [ "$owner" != "$$" ] && kill -0 "$owner" 2>/dev/null &&
    ps -p "$owner" -o command= 2>/dev/null | grep -q 'ci-nightly.sh'; then
    return 1
  fi
  for wt in "$WT" "$STATE_DIR"/wt-*; do
    [ -d "$wt" ] || continue
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
  done
  git -C "$REPO" worktree prune
  echo "$$" > "$WT_OWNER"
}

prune_logs() {
  ls -1t "$STATE_DIR"/logs/*.log 2>/dev/null | tail -n +$((LOGS_KEPT + 1)) | while read -r f; do rm -f "$f"; done
}

# The state of the run in progress, for finish_run and on_interrupt.
RUN_SHA=""
RUN_STARTED=""
RUN_LOG=""
RUN_WT=""
RUN_LOCKED=""
RUN_CHILD=""
RUN_DEADLINE=""

# stop_group <pid>: stop a background job and everything it started. With
# job control on (`set -m` in cmd_run), each background job is a process
# group of its own whose id is its pid, so one signal reaches npm, jest and
# the jest workers of this run, including a process started while the
# signal is sent, and never the jest processes of other sessions. It waits
# up to 15 s for the group to end, then kills it.
stop_group() {
  local n=0
  kill -TERM -- "-$1" 2>/dev/null
  while kill -0 -- "-$1" 2>/dev/null && [ "$n" -lt 30 ]; do
    sleep 0.5
    n=$((n + 1))
  done
  kill -KILL -- "-$1" 2>/dev/null
}

# finish_run: the end of every run that took the lock, in this order: stop
# the work, remove the worktree, then release the lock. Releasing first
# would let the next run make its worktree at the same path before this one
# removes it.
finish_run() {
  trap - INT TERM HUP
  if [ -n "$RUN_DEADLINE" ]; then
    kill -TERM -- "-$RUN_DEADLINE" 2>/dev/null
    RUN_DEADLINE=""
  fi
  if [ -n "$RUN_CHILD" ]; then
    stop_group "$RUN_CHILD"
    RUN_CHILD=""
  fi
  if [ -n "$RUN_WT" ]; then
    git -C "$REPO" worktree remove --force "$RUN_WT" >> "$RUN_LOG" 2>&1 || rm -rf "$RUN_WT"
    git -C "$REPO" worktree prune
    rm -f "$WT_OWNER"
    RUN_WT=""
  fi
  if [ -n "$RUN_LOCKED" ]; then
    node "$BOX_LOCK" release "$OWNER" >> "$RUN_LOG" 2>&1
    RUN_LOCKED=""
  fi
}

# on_interrupt: a signal (Ctrl-C, the time limit of a Claude Bash call,
# launchd stopping the job) ends the run. Without this, the box lock stays
# held until its hold expires and every session waits, and no state says
# that the run did not complete.
on_interrupt() {
  finish_run
  if [ -n "$RUN_SHA" ]; then
    echo "ci-nightly: interrupted" >> "$RUN_LOG"
    write_state "$STATE_DIR/attempt.json" "$RUN_SHA" "$RUN_STARTED" "$(now)" 130 error "$RUN_LOG"
  fi
  exit 130
}

cmd_run() {
  local force="" commit="" sha started log rc result failed=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force="--force" ;;
      --commit) commit="$2"; shift ;;
      *) echo "ci-nightly: unknown option $1" >&2; return 2 ;;
    esac
    shift
  done
  # Job control: each background job below gets a process group of its own,
  # so stop_group can stop all of it.
  set -m
  if ! find_node; then
    # write_state needs node: write the error attempt with printf, so that
    # suite-status.mjs (run by the hourly notifier, which finds its own node)
    # reports that the job could not start.
    mkdir -p "$STATE_DIR"
    printf '{\n  "sha": "%s",\n  "startedAt": "%s",\n  "endedAt": "%s",\n  "exit": 1,\n  "result": "error",\n  "failedJobs": ["node not found"],\n  "log": "",\n  "leftOut": [],\n  "repo": "%s"\n}\n' \
      "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" "$(now)" "$(now)" "$REPO" > "$STATE_DIR/attempt.json"
    echo "ci-nightly: no node on PATH and none under ${NVM_DIR:-$HOME/.nvm}/versions/node" >&2
    return 1
  fi
  sha="$(git -C "$REPO" rev-parse "${commit:-HEAD}^{commit}")" || return 1
  if [ "$force" != "--force" ] && covered "$sha"; then
    # Record that the job ran, so that suite-status.mjs does not report a
    # stopped job after days with no commit.
    write_state "$STATE_DIR/attempt.json" "$sha" "$(now)" "$(now)" 0 unchanged ""
    echo "ci-nightly: a passing full run already covers ${sha:0:9}; nothing to do (run --force to run anyway)"
    return 0
  fi
  started="$(now)"
  mkdir -p "$STATE_DIR/logs"
  # The pid makes the name unique: two runs started in the same second
  # would otherwise share a log and read each other's failures.
  log="$STATE_DIR/logs/$(date +%Y%m%d-%H%M%S)-$$.log"
  echo "ci-nightly: full suite; log $log"
  RUN_SHA="$sha" RUN_STARTED="$started" RUN_LOG="$log"
  trap on_interrupt INT TERM HUP

  # --pid lets the lock see that this run died, if it dies without the trap.
  # The wait runs in the background, so that a signal reaches on_interrupt
  # at once (bash runs a trap only after a foreground command ends), and
  # on_interrupt stops it, which removes this run from the lock's queue.
  node "$BOX_LOCK" acquire "$OWNER" "$HOLD_MINUTES" "compute-engine nightly full suite" --pid="$$" --wait="$WAIT_MINUTES" >> "$log" 2>&1 &
  RUN_CHILD=$!
  wait "$RUN_CHILD"
  rc=$?
  RUN_CHILD=""
  if [ "$rc" -ne 0 ]; then
    trap - INT TERM HUP
    write_state "$STATE_DIR/attempt.json" "$sha" "$started" "$(now)" 1 skipped "$log"
    echo "ci-nightly: could not get the box lock (see $log); skipped"
    node "$SUITE_STATUS" notify >/dev/null 2>&1
    return 1
  fi
  RUN_LOCKED=1
  # The wait can last hours: test the HEAD of now, not the one of before
  # (a commit given with --commit stays the same).
  sha="$(git -C "$REPO" rev-parse "${commit:-HEAD}^{commit}")" || { finish_run; return 1; }
  RUN_SHA="$sha"
  echo "ci-nightly: testing ${sha:0:9}" | tee -a "$log"
  if [ "$force" != "--force" ] && covered "$sha"; then
    finish_run
    echo "ci-nightly: a run that passed during the wait covers ${sha:0:9}; nothing to do"
    return 0
  fi

  if ! claim_worktree; then
    finish_run
    write_state "$STATE_DIR/attempt.json" "$sha" "$started" "$(now)" 1 skipped "$log"
    echo "ci-nightly: another run (pid $(cat "$WT_OWNER")) still uses $WT; skipped" | tee -a "$log"
    node "$SUITE_STATUS" notify >/dev/null 2>&1
    return 1
  fi
  RUN_WT="$WT"
  if ! git -C "$REPO" worktree add --detach "$WT" "$sha" >> "$log" 2>&1 ||
    ! ln -s "$REPO/node_modules" "$WT/node_modules"; then
    finish_run
    write_state "$STATE_DIR/attempt.json" "$sha" "$started" "$(now)" 1 error "$log"
    echo "ci-nightly: could not make the worktree (see $log)"
    node "$SUITE_STATUS" notify >/dev/null 2>&1
    return 1
  fi

  (
    cd "$WT" || { echo "ci-nightly: failed job: worktree"; exit 1; }
    echo "=== typecheck"
    npm run typecheck || echo "ci-nightly: failed job: typecheck"
    # The declaration test (test/public-ts-declarations/main.ts) imports
    # dist/types/compute-engine, refreshed by typecheck above.
    echo "=== declarations"
    bash scripts/test-types.sh || echo "ci-nightly: failed job: declarations"
    echo "=== test.sh"
    # test.sh stops at the first failing step (set -e); its exit code is
    # what tells a pass. CE_NIGHTLY=1 turns on the nightly suites
    # (test/compute-engine/nightly/README.md), which every other run skips.
    # The tests that run compiled Python code look for a venv in their own
    # checkout, and the worktree has none: point them at the main tree's.
    if [ -z "${CE_PYTHON:-}" ] && [ -x "$REPO/venv/bin/python3" ]; then
      export CE_PYTHON="$REPO/venv/bin/python3"
    fi
    npm run test:python || echo "ci-nightly: failed job: python"
    CE_NIGHTLY=1 bash scripts/test.sh || echo "ci-nightly: failed job: tests"
  ) >> "$log" 2>&1 &
  # In the background with `wait`: bash runs a trap only after a foreground
  # command ends, which would be after the whole suite.
  RUN_CHILD=$!
  # The deadline: a job of its own that stops the checks after
  # DEADLINE_MINUTES. It is stopped when the checks end first.
  (
    sleep $((DEADLINE_MINUTES * 60))
    echo "ci-nightly: the checks ran longer than $DEADLINE_MINUTES minutes; stopped" >> "$log"
    kill -TERM -- "-$RUN_CHILD" 2>/dev/null
  ) &
  RUN_DEADLINE=$!
  wait "$RUN_CHILD"
  rc=$?
  # The checks end with status 0 even when one fails (each failure writes a
  # "failed job" line instead). Any other status means the checks did not
  # all run, for example a signal sent to that process alone; its jest
  # processes may still run, and finish_run stops them. Otherwise the group
  # has ended, and there is nothing left to stop.
  [ "$rc" -eq 0 ] && RUN_CHILD=""
  finish_run

  if [ "$rc" -ne 0 ]; then
    echo "ci-nightly: the checks stopped with status $rc before they ended" >> "$log"
    write_state "$STATE_DIR/attempt.json" "$sha" "$started" "$(now)" "$rc" error "$log"
    echo "ci-nightly: ${sha:0:9} did not complete (status $rc; see $log)"
    node "$SUITE_STATUS" notify >/dev/null 2>&1
    return 1
  fi

  # What failed: the jobs, and each failing test file that jest names in
  # its "FAIL <path>" lines (colour codes removed first). Jest writes the
  # path relative to the directory of its configuration, `config/`, so it
  # starts with `../test/`; the `../` is removed.
  while IFS= read -r line; do failed+=("$line"); done < <(
    sed -n 's/^ci-nightly: failed job: //p' "$log" | grep -v '^tests$'
    sed -e $'s/\x1b\\[[0-9;]*m//g' "$log" | sed -n 's/^ *FAIL  *\(\.\.\/\)*\(test\/[^ ]*\).*/\2/p' | sort -u
  )
  if grep -q '^ci-nightly: failed job:' "$log"; then
    result=failed
    rc=1
    [ ${#failed[@]} -eq 0 ] && failed=(tests)
  else
    result=passed
    rc=0
  fi
  write_state "$STATE_DIR/last.json" "$sha" "$started" "$(now)" "$rc" "$result" "$log" "${failed[@]}"
  cp "$STATE_DIR/last.json" "$STATE_DIR/attempt.json"
  prune_logs
  echo "ci-nightly: ${sha:0:9} $result${failed:+ (${failed[*]})}"
  # `show` moves the green mark; `notify` tells the user of a failure.
  node "$SUITE_STATUS" show --repo "$REPO" >/dev/null 2>&1
  node "$SUITE_STATUS" notify >/dev/null 2>&1
  [ "$result" = passed ]
}

cmd_install() {
  local node_dir
  node_dir="$(dirname "$(command -v node)")" || { echo "ci-nightly: no node on PATH" >&2; return 1; }
  mkdir -p "$(dirname "$PLIST")" "$STATE_DIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>/bin/bash</string>
    <string>$REPO/scripts/ci-nightly.sh</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>XDG_STATE_HOME</key><string>${XDG_STATE_HOME:-$HOME/.local/state}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$START_HOUR</integer><key>Minute</key><integer>$START_MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$STATE_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "ci-nightly: installed $PLIST (every night at $START_HOUR:$START_MINUTE)"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST"
  echo "ci-nightly: uninstalled"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  status) find_node && node "$SUITE_STATUS" show --repo "$REPO" ;;
  *) usage; exit 2 ;;
esac
