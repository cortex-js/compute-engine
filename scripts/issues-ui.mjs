#!/usr/bin/env node
/**
 * The Bug Review Board's web page for the `issues/` directory. It shows the
 * lists of `scripts/issues.mjs` (board, backlog, every file) as cards, and
 * each card has controls that edit the file at once. The process is
 * described in `docs/ISSUE_TRACKING.md`; the design is in
 * `docs/plans/2026-11-06-issues-webapp-spec.md`.
 *
 *   node scripts/issues-ui.mjs [--open] [--port <n>] [--dir <path>] [--today <yyyy-mm-dd>]
 *
 * The server reads the directory again on every request, so an edit by an
 * agent shows at the next refresh. Every write goes through the functions of
 * `scripts/issues.mjs`, with the same checks as its `set`, `flag` and
 * `close --all` commands; after each write the server checks the file as
 * `lint` does and the page shows the errors. The one write that the script
 * has no command for is the board's decision, which `recordDecision()`
 * appends to the body.
 *
 * The server runs no git command that changes anything: it reads
 * `git status` to show how many issue files changed since HEAD, and the user
 * stages and commits. It has no authentication, so it listens on 127.0.0.1
 * only, and it refuses a request whose `Host` or `Origin` is not that address
 * (another web page in the browser cannot send it an edit).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import {
  configure,
  issuesDir,
  today,
  loadAll,
  checkFile,
  boardSections,
  backlogSections,
  setField,
  flag,
  recordDecision,
  closeAll,
  IssueError,
  ROOT,
  STATES,
  PRIORITIES,
  FLAGS,
} from './issues.mjs';

// ---------------------------------------------------------------------------
// Arguments

const opts = { dir: undefined, today: undefined, port: 4719, open: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--dir', '--today', '--port'].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) exit(`${a} needs a value`);
      if (a === '--dir') opts.dir = path.resolve(v);
      else if (a === '--today') opts.today = v;
      else opts.port = Number(v);
    } else if (a === '--open') opts.open = true;
    else if (a === '--help' || a === '-h') exit();
    else exit(`unknown argument ${a}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535)
    exit('--port takes a number from 0 to 65535');
}

function exit(msg) {
  if (msg) console.error(`issues-ui: ${msg}`);
  console.log(
    'usage: node scripts/issues-ui.mjs [--open] [--port <n>] [--dir <path>] [--today <yyyy-mm-dd>]'
  );
  process.exit(msg ? 1 : 0);
}

/** Sets the directory and the date of `issues.mjs` for one request. */
function setup() {
  configure({ dir: opts.dir, today: opts.today });
}

// ---------------------------------------------------------------------------
// Reading

/** The fields of one issue that the page needs. */
function plain(i) {
  return {
    // The file name gives the id that the edits use, also when the `id`
    // field is wrong (a lint error that the card shows).
    id: i.name.slice(0, -3),
    name: i.name,
    fields: i.fields,
    title: i.title,
    body: i.body,
    table: i.table,
    errors: i.errors,
    warnings: i.warnings,
  };
}

const ref = ([i, note]) => ({ id: i.fields.id, note: note ?? '' });

/**
 * The web address of the repository on GitHub, from the URL of the `origin`
 * remote (`https://github.com/<owner>/<repo>.git` or
 * `git@github.com:<owner>/<repo>.git`), so that a card links `GitHub #<n>` to
 * the issue. Null when `origin` is not on GitHub.
 */
const GITHUB = (() => {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(url);
    return m ? `https://github.com/${m[1]}` : null;
  } catch {
    return null;
  }
})();

/**
 * The number of changed files in the issue directory, from
 * `git status --porcelain`. `--no-optional-locks` keeps git from refreshing
 * the index, which other sessions on the machine use. Null outside a git
 * repository.
 */
function gitChanges(dir) {
  try {
    const out = execFileSync(
      'git',
      ['--no-optional-locks', 'status', '--porcelain', '--', '.'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.split('\n').filter(Boolean).length;
  } catch {
    return null;
  }
}

function data() {
  setup();
  const all = loadAll();
  const board = boardSections(all);
  const backlog = backlogSections(all);
  const dir = issuesDir();
  const closedFile = path.join(dir, 'CLOSED.md');
  const releases = [
    ...new Set(all.issues.map((i) => i.fields.release).filter(Boolean)),
  ].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return {
    today: today(),
    dir,
    states: STATES,
    priorities: PRIORITIES,
    flags: FLAGS,
    issues: all.issues.map(plain),
    strays: all.strays,
    board: {
      leftOut: board.leftOut,
      sections: Object.fromEntries(
        Object.entries(board.sections).map(([k, v]) => [k, v.map(ref)])
      ),
    },
    backlog: {
      leftOut: backlog.leftOut,
      p0: backlog.p0.map((i) => ({ id: i.fields.id, note: i.fields.state })),
      release: backlog.release.map(ref),
      pool: backlog.pool.map(ref),
      p4Count: backlog.p4Count,
    },
    closed: fs.existsSync(closedFile)
      ? fs.readFileSync(closedFile, 'utf8')
      : '',
    releases,
    changed: gitChanges(dir),
    github: GITHUB,
  };
}

// ---------------------------------------------------------------------------
// Writing

const str = (v) => (typeof v === 'string' ? v : '');
const ID_RE = /^CE-\d+$/;

/** The fields of one file as they are on disk now. */
function fieldsOf(id) {
  return checkFile(`${id}.md`).fields;
}

/**
 * Applies one control of a card. Each operation is the sequence of `set` and
 * `flag` commands that the board would type, so the script's checks refuse
 * the same values. Returns the lines the commands print.
 */
function edit(req) {
  const id = str(req.id);
  if (!ID_RE.test(id)) throw new IssueError(`\`${id}\` is not an id CE-<n>`);
  // An agent can remove the file (a fix, `close`) after the page drew it.
  if (!fs.existsSync(path.join(issuesDir(), `${id}.md`)))
    throw new IssueError(`${id} has no file any more; refresh the page`);
  const value = str(req.value).trim();
  const out = [];
  const run = (lines) => out.push(...lines);
  switch (req.op) {
    case 'priority': {
      // A P0 is proposed (`needs-review`) until the board confirms it, so a
      // P0 chosen here gets the flag unless the item is already confirmed.
      // The flag goes first, so that `set` does not warn about a P0 without it.
      if (value === 'P0') {
        const f = fieldsOf(id);
        if (!f.confirmed && !(f.flags ?? []).includes('needs-review'))
          run(flag(id, '+needs-review'));
      }
      run(setField(id, 'priority', value));
      run(setField(id, 'reviewed', 'today'));
      break;
    }
    case 'state': {
      const current = fieldsOf(id);
      if (value === 'in-progress')
        throw new IssueError(
          '`in-progress` is set by an agent with `issues.mjs start`'
        );
      if (value === 'close') {
        const reason = str(req.reason).trim();
        if (!reason) throw new IssueError('closing needs a reason');
        run(setField(id, 'close-reason', reason));
      }
      if (value === 'fixed') {
        const fixedIn = str(req.reason).trim();
        if (!fixedIn)
          throw new IssueError('`fixed` needs the commit or the release');
        run(setField(id, 'fixed-in', fixedIn));
      }
      run(setField(id, 'state', value));
      // `fixed-in` is set only with `state: fixed`: a reopened item clears it.
      if (value !== 'fixed' && current['fixed-in'])
        run(setField(id, 'fixed-in', ''));
      break;
    }
    case 'flag': {
      const name = str(req.name);
      run(flag(id, `${req.on ? '+' : '-'}${name}`));
      if (name === 'needs-review' && !req.on)
        run(setField(id, 'reviewed', 'today'));
      break;
    }
    case 'confirm':
      run(setField(id, 'confirmed', 'today'));
      break;
    case 'release':
      run(setField(id, 'release', value));
      break;
    case 'ask':
      run(setField(id, 'ask', value));
      break;
    case 'decision':
      run(recordDecision(id, str(req.text)));
      break;
    case 'reviewed':
      run(setField(id, 'reviewed', 'today'));
      break;
    default:
      throw new IssueError(`unknown operation ${req.op}`);
  }
  return out;
}

/** The lint result of one file after a write; none for a value that is not an id. */
function lintOf(id) {
  if (!ID_RE.test(id)) return { errors: [], warnings: [] };
  const file = path.join(issuesDir(), `${id}.md`);
  if (!fs.existsSync(file)) return { errors: [], warnings: [] };
  const { errors, warnings } = checkFile(`${id}.md`);
  return { errors, warnings };
}

/**
 * `close --all`, after the page has shown the ids. The page sends the ids it
 * showed; when the files on disk name other ones, nothing is closed. A file
 * with lint errors is not in the board's lists, so the page cannot show it:
 * when such a file has `state: close`, nothing is closed and the message
 * names it.
 */
function closeShown(req, report) {
  const shown = (Array.isArray(req.ids) ? req.ids : []).map(String).sort();
  const { issues } = loadAll();
  const closing = issues.filter((i) => i.fields.state === 'close');
  const broken = closing.filter((i) => i.errors.length);
  if (broken.length)
    throw new IssueError(
      `fix the lint errors of ${broken.map((i) => i.name).join(', ')} first: the file has \`state: close\` and the board list leaves it out`
    );
  const now = closing.map((i) => i.fields.id).sort();
  if (now.length === 0) throw new IssueError('no item has `state: close`');
  if (now.join(',') !== shown.join(','))
    throw new IssueError(
      `the items to close changed (now ${now.join(', ')}); refresh the page`
    );
  return closeAll(issues, report);
}

// ---------------------------------------------------------------------------
// Server

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // Another site must not show the page in a frame: the requests of a
    // framed page are same-origin and pass the checks of `allowed()`.
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
  res.end(body);
}
const json = (res, status, value) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new IssueError('the request is too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return reject(new IssueError('the request is not JSON'));
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        return reject(new IssueError('the request is not a JSON object'));
      resolve(value);
    });
    req.on('error', reject);
  });
}

/**
 * Whether a request comes from this page. `Host` must be the loopback address
 * (a DNS name that points to 127.0.0.1 gives another host name), and a write
 * must have the JSON content type (which a page of another origin cannot send
 * without a CORS check that this server never answers) and, when the browser
 * sends one, the page's own `Origin`.
 */
function allowed(req, port, write) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) return false;
  if (!write) return true;
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? ''))
    return false;
  const origin = req.headers.origin;
  return origin === undefined || hosts.some((h) => origin === `http://${h}`);
}

const server = http.createServer(async (req, res) => {
  const port = server.address().port;
  const write = req.method === 'POST';
  if (!allowed(req, port, write)) return json(res, 403, { error: 'refused' });
  try {
    // A request target that is not a valid URL throws here and gets a 400.
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      throw new IssueError('the request target is not a valid URL');
    }
    if (req.method === 'GET' && url.pathname === '/')
      return send(res, 200, 'text/html; charset=utf-8', PAGE);
    if (req.method === 'GET' && url.pathname === '/api/data')
      return json(res, 200, data());
    if (write && url.pathname === '/api/edit') {
      const body = await readBody(req);
      setup();
      let messages = [];
      try {
        messages = edit(body);
      } catch (e) {
        if (!(e instanceof IssueError)) throw e;
        return json(res, 400, { error: e.message, lint: lintOf(str(body.id)) });
      }
      console.log(messages.join('\n'));
      return json(res, 200, { messages, lint: lintOf(str(body.id)) });
    }
    if (write && url.pathname === '/api/close-all') {
      const body = await readBody(req);
      setup();
      const messages = closeShown(body, (line) => console.log(line));
      return json(res, 200, { messages });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof IssueError) return json(res, 400, { error: e.message });
    console.error(e);
    return json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(opts.port, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${server.address().port}/`;
  setup();
  console.log(`issues-ui: ${address}  (files: ${issuesDir()})`);
  if (opts.open)
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [address]);
});
server.on('error', (e) => {
  console.error(`issues-ui: ${e.message}`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// The page: one HTML file with its CSS and script, no build step. It is a
// template string, so the page has no backtick (a regular expression writes
// it as \x60) and no dollar sign followed by a brace.

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Issue board</title>
<style>
:root {
  color-scheme: light dark;
  --bg: light-dark(#f6f6f4, #17181a);
  --card: light-dark(#ffffff, #222326);
  --text: light-dark(#1d1d1f, #e8e8ea);
  --muted: light-dark(#6b6b70, #9a9aa0);
  --line: light-dark(#e1e1dd, #34353a);
  --accent: light-dark(#2457c5, #7aa2ff);
  --on-accent: light-dark(#ffffff, #0e1424);
  --error: light-dark(#b3261e, #ff8a80);
  --warn: light-dark(#8a5a00, #e8b45a);
  --code: light-dark(#f0f0ec, #2b2c30);
  --p0: #d93025; --p1: #e8710a; --p2: #f2c200; --p3: #8d8d93; --p4: light-dark(#d6d6da, #55565c);
  font: 15px/1.45 system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); }
.bar { max-width: 1040px; margin: 0 auto; padding: 10px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.bar h1 { font-size: 17px; margin: 0; }
nav { display: flex; gap: 4px; }
nav button { border: 1px solid var(--line); background: var(--card); color: var(--text); padding: 5px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
nav button[aria-current="page"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.status { color: var(--muted); font-size: 13px; margin-left: auto; display: flex; gap: 12px; align-items: center; }
main { max-width: 1040px; margin: 0 auto; padding: 8px 16px 64px; }
h2 { font-size: 15px; margin: 26px 0 8px; color: var(--muted); font-weight: 600; }
h2 .count { font-weight: 400; }
.none { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 0 0 10px; }
.card.busy { opacity: .6; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13px; color: var(--muted); }
.meta .id { font-weight: 700; color: var(--text); font-family: ui-monospace, monospace; }
.badge { font-weight: 700; padding: 1px 7px; border-radius: 4px; color: #fff; font-size: 12px; }
.badge.P2, .badge.P4 { color: #1d1d1f; }
.badge.P0 { background: var(--p0); } .badge.P1 { background: var(--p1); } .badge.P2 { background: var(--p2); }
.badge.P3 { background: var(--p3); } .badge.P4 { background: var(--p4); }
.tag { border: 1px solid var(--line); border-radius: 10px; padding: 0 7px; font-size: 12px; }
.origin { font-weight: 700; font-size: 12px; padding: 1px 8px; border-radius: 4px; text-decoration: none; }
.origin.github { background: light-dark(#24292f, #e6edf3); color: light-dark(#ffffff, #1f2328); }
.origin.tycho { background: light-dark(#6f42c1, #c9a8ff); color: light-dark(#ffffff, #1f1530); }
a.origin:hover { text-decoration: underline; }
.note { color: var(--warn); font-weight: 600; }
.title { font-size: 18px; line-height: 1.35; margin: 6px 0 4px; font-weight: 500; }
.ask { font-weight: 700; margin: 4px 0; }
.lint { font-size: 13px; margin: 6px 0; padding: 0; list-style: none; }
.lint .e { color: var(--error); } .lint .w { color: var(--warn); }
.controls { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 10px 0 4px; font-size: 13px; }
.controls label { display: inline-flex; gap: 5px; align-items: center; color: var(--muted); }
select, input, textarea, button { font: inherit; font-size: 13px; color: var(--text); }
select, input[type=text], textarea { background: var(--bg); border: 1px solid var(--line); border-radius: 5px; padding: 3px 6px; }
input.ask-field { width: 30em; max-width: 100%; }
input.release-field { width: 7em; }
button.act { border: 1px solid var(--line); background: var(--bg); border-radius: 5px; padding: 3px 10px; cursor: pointer; }
button.act.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
button.act:disabled { opacity: .45; cursor: default; }
button.flag { border: 1px solid var(--line); background: transparent; border-radius: 10px; padding: 1px 9px; cursor: pointer; color: var(--muted); }
button.flag[aria-pressed="true"] { background: var(--text); border-color: var(--text); color: var(--card); }
.inline { display: none; gap: 6px; align-items: center; }
.inline.shown { display: inline-flex; }
.decision { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0 0; }
.decision textarea { flex: 1; min-height: 2.2em; max-height: 16em; resize: vertical; field-sizing: content; }
.msg { font-size: 13px; margin: 6px 0 0; min-height: 0; }
.msg.err { color: var(--error); } .msg.ok { color: var(--muted); }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--accent); font-size: 13px; }
.body { margin-top: 6px; }
.body h3, .body h4 { font-size: 14px; margin: 14px 0 4px; }
.body p { margin: 6px 0; }
.body pre { background: var(--code); padding: 8px 10px; border-radius: 5px; overflow-x: auto; font-size: 13px; }
code { font-family: ui-monospace, Menlo, monospace; font-size: .92em; background: var(--code); padding: 0 3px; border-radius: 3px; }
pre code { background: none; padding: 0; }
.body table { border-collapse: collapse; font-size: 13px; } .body td, .body th { border: 1px solid var(--line); padding: 3px 6px; }
.prio-line { font-size: 13px; color: var(--muted); }
.tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 14px 0 0; font-size: 13px; }
.tools input[type=search] { width: 24em; max-width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 5px; padding: 4px 8px; }
.closed { font-size: 13px; }
.banner { background: var(--card); border: 1px solid var(--error); color: var(--error); border-radius: 8px; padding: 8px 12px; margin: 14px 0; }
</style>
</head>
<body>
<header><div class="bar">
  <h1>Issues</h1>
  <nav id="tabs"></nav>
  <div class="status"><span id="git"></span><span id="today"></span><button class="act" id="refresh" title="Read the files again and sort the lists">Refresh</button></div>
</div></header>
<main id="main"><p class="none">Loading…</p></main>
<datalist id="releases"></datalist>
<script>
'use strict';
let data = null;
let view = 'board';
let filter = '';
const open = new Set();
const notes = new Map();

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byId = () => new Map(data.issues.map((i) => [i.id, i]));

// --- Markdown: the subset the issue files use. Every text is escaped first.
function inline(s) {
  return String(s).split(/(\x60[^\x60]*\x60)/).map((part, k) => {
    if (k % 2) return '<code>' + esc(part.slice(1, -1)) + '</code>';
    return esc(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }).join('');
}
function md(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  const out = [];
  const isFence = (l) => /^\s*\x60\x60\x60/.test(l);
  const isList = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isTable = (k) => /^\s*\|/.test(lines[k] ?? '') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[k + 1] ?? '');
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isFence(l)) {
      const code = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) code.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    } else if (/^#{1,6}\s/.test(l)) {
      const n = Math.min(6, l.match(/^#+/)[0].length + 1);
      out.push('<h' + n + '>' + inline(l.replace(/^#+\s*/, '')) + '</h' + n + '>');
      i++;
    } else if (isTable(i)) {
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>');
    } else if (isList(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (isList(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</' + tag + '>');
    } else if (!l.trim()) {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !isList(lines[i]) && !isTable(i)) para.push(lines[i++]);
      out.push('<p>' + inline(para.join(' ')) + '</p>');
    }
  }
  return out.join('\n');
}

// --- Cards

/**
 * Where an issue came from, when someone outside the team reported it: a
 * GitHub issue or Tycho. Many files record it only in source-ref (a converted
 * entry has source: agent and source-ref: GitHub #189), so both fields are
 * read. Returns { kind, label, url } (url only for a GitHub issue number when
 * the repository is on GitHub), or null.
 */
function origin(f) {
  const ref = String(f['source-ref'] ?? '');
  const gh = /\bGitHub #(\d+)/i.exec(ref) ?? (f.source === 'github' ? /#?(\d+)/.exec(ref) : null);
  if (gh || f.source === 'github')
    return { kind: 'github', label: 'GitHub' + (gh ? ' #' + gh[1] : ''), url: gh && data.github ? data.github + '/issues/' + gh[1] : null };
  if (f.source === 'tycho' || /\bTycho\b/i.test(ref)) return { kind: 'tycho', label: 'Tycho', url: null };
  return null;
}

function card(i, note) {
  const f = i.fields;
  const flags = f.flags ?? [];
  const id = i.id;
  const tags = flags.map((x) => '<span class="tag">' + esc(x) + '</span>').join('');
  const src = esc(f.source) + (f['source-ref'] ? ' (' + esc(f['source-ref']) + ')' : '');
  const o = origin(f);
  const originBadge = !o ? '' : o.url
    ? '<a class="origin ' + o.kind + '" href="' + esc(o.url) + '" target="_blank" rel="noreferrer" title="Open the report on GitHub">' + esc(o.label) + ' ↗</a>'
    : '<span class="origin ' + o.kind + '">' + esc(o.label) + '</span>';
  const lint = (i.errors.length || i.warnings.length)
    ? '<ul class="lint">' + i.errors.map((e) => '<li class="e">lint error: ' + inline(e) + '</li>').join('') +
      i.warnings.map((w) => '<li class="w">lint warning: ' + inline(w) + '</li>').join('') + '</ul>'
    : '';
  const prioOptions = data.priorities.map((p) => '<option' + (p === f.priority ? ' selected' : '') + '>' + p + '</option>').join('');
  const states = data.states.filter((s) => s !== 'in-progress' || f.state === 'in-progress');
  const stateOptions = states.map((s) => '<option value="' + s + '"' + (s === f.state ? ' selected' : '') + (s === 'in-progress' ? ' disabled' : '') + '>' + s + '</option>').join('');
  const flagButtons = data.flags.map((x) => '<button type="button" class="flag" data-flag="' + x + '" aria-pressed="' + flags.includes(x) + '">' + x + '</button>').join('');
  const showConfirm = f.priority === 'P0' && flags.includes('needs-review');
  const showReviewed = !f.reviewed || flags.includes('needs-review');
  const m = notes.get(id);
  const prio = 'Recorded ' + esc(f.priority) + (i.table ? ' · table value ' + esc(i.table) : '') +
    (f.reviewed ? ' · reviewed ' + esc(f.reviewed) : ' · not reviewed') + (f.confirmed ? ' · confirmed ' + esc(f.confirmed) : '') +
    (f.release ? ' · release ' + esc(f.release) : '') + ' · opened ' + esc(f.opened) + (f.updated ? ' · updated ' + esc(f.updated) : '') +
    (f.owner ? ' · owner ' + esc(f.owner) + ' since ' + esc(f.started) : '');
  return '<article class="card" data-id="' + esc(id) + '" data-note="' + esc(note ?? '') + '">' +
    '<div class="meta"><span class="id">' + esc(id) + '</span>' +
      '<span class="badge ' + esc(f.priority) + '">' + esc(f.priority ?? '?') + '</span>' + originBadge +
      '<span>' + esc(f.state) + '</span><span>size ' + esc(f.size) + '</span><span>' + src + '</span>' + tags +
      (note ? '<span class="note">' + inline(note) + '</span>' : '') + '</div>' +
    '<div class="title">' + inline(i.title) + '</div>' +
    (f.ask ? '<div class="ask">' + inline(f.ask) + '</div>' : '') + lint +
    '<div class="controls">' +
      '<label>Priority <select data-op="priority">' + prioOptions + '</select></label>' +
      '<label>State <select data-op="state">' + stateOptions + '</select></label>' +
      '<span class="inline" data-for="close"><input type="text" class="reason" placeholder="Why the board does not fix it" size="34" value="' + esc(f['close-reason'] ?? '') + '"><button type="button" class="act primary" data-act="close">Close</button><button type="button" class="act" data-act="cancel">Cancel</button></span>' +
      '<span class="inline" data-for="fixed"><input type="text" class="reason" placeholder="The commit or the release" size="22"><button type="button" class="act primary" data-act="fixed">Set fixed</button><button type="button" class="act" data-act="cancel">Cancel</button></span>' +
      '<span>' + flagButtons + '</span>' +
      (showConfirm ? '<button type="button" class="act primary" data-act="confirm">Confirm P0</button>' : '') +
      (showReviewed ? '<button type="button" class="act" data-act="reviewed">Mark reviewed</button>' : '') +
      '<label>Release <input type="text" class="release-field" data-op="release" list="releases" value="' + esc(f.release ?? '') + '" placeholder="pool"></label>' +
      '<label>Ask <input type="text" class="ask-field" data-op="ask" value="' + esc(f.ask ?? '') + '" placeholder="What the board must do"></label>' +
    '</div>' +
    '<div class="decision"><textarea rows="1" placeholder="Decision of the board (appended to the body as User decision ' + esc(data.today) + ': …)"></textarea><button type="button" class="act primary" data-act="decision">Record decision</button></div>' +
    '<div class="msg' + (m ? ' ' + m.kind : '') + '">' + (m ? esc(m.text) : '') + '</div>' +
    '<details' + (open.has(id) ? ' open' : '') + '><summary>details</summary>' +
      '<div class="prio-line">' + prio + '</div><div class="body">' + md(i.body) + '</div></details>' +
  '</article>';
}

function list(title, refs, map) {
  const cards = refs.map((r) => map.get(r.id) ? card(map.get(r.id), r.note) : '').join('');
  return '<h2>' + esc(title) + ' <span class="count">(' + refs.length + ')</span></h2>' + (refs.length ? cards : '<p class="none">none</p>');
}

const matches = (i) => {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return [i.id, i.title, i.fields.source, i.fields['source-ref']].some((s) => String(s ?? '').toLowerCase().includes(q));
};

const SECTIONS = [
  ['p0', '1. P0, proposed or confirmed'],
  ['review', '2. Needs review'],
  ['fresh', '3. New since the last review (no reviewed date)'],
  ['unanswered', '4. Tycho issues with no CE answer after 1 day'],
  ['decision', '5a. Needs a decision'],
  ['design', '5b. Needs a design'],
  ['stalled', '6. In progress for 3 days or more with no commit and no update'],
  ['aged', '7. P2 untouched for 60 days or more'],
  ['fixed', "Fixed, waiting for Tycho's check"],
  ['closing', 'To close at the end of the review (close --all)'],
];

function boardCount() {
  const ids = new Set(data.board.leftOut.map((n) => n.replace(/\.md$/, '')));
  for (const [k] of SECTIONS) for (const r of data.board.sections[k]) ids.add(r.id);
  return ids.size;
}

function renderHeader() {
  const backlogCount = data.backlog.p0.length || data.backlog.release.length + data.backlog.pool.length;
  const tabs = [['board', 'Board', boardCount()], ['backlog', 'Backlog', backlogCount], ['all', 'All', data.issues.length]];
  $('#tabs').innerHTML = tabs.map(([k, label, n]) => '<button type="button" data-view="' + k + '"' + (view === k ? ' aria-current="page"' : '') + '>' + label + ' (' + n + ')</button>').join('');
  $('#git').textContent = data.changed === null ? 'not in a git repository' : data.changed + ' file(s) in issues/ changed since HEAD';
  $('#today').textContent = data.today;
  $('#releases').innerHTML = data.releases.map((r) => '<option value="' + esc(r) + '">').join('');
}

function renderMain() {
  const map = byId();
  let html = '';
  if (data.strays.length) html += '<div class="banner">Not issue files (the name must be CE-&lt;n&gt;.md): ' + data.strays.map(esc).join(', ') + '</div>';
  if (view === 'board') {
    html += '<div class="tools" id="board-tools">' + boardTools() + '</div>';
    const bad = data.board.leftOut.map((n) => ({ id: n.replace(/\.md$/, ''), note: 'lint errors: left out of the lists' }));
    if (bad.length) html += list('Files with lint errors', bad, map);
    for (const [k, title] of SECTIONS) html += list(title, data.board.sections[k], map);
  } else if (view === 'backlog') {
    html += '<div class="tools"><input type="search" id="filter" placeholder="Filter on id, title or source" value="' + esc(filter) + '"></div>';
    const keep = (refs) => refs.filter((r) => map.get(r.id) && matches(map.get(r.id)));
    if (data.backlog.p0.length) {
      html += '<div class="banner">A confirmed P0 is open: no other work starts.</div>' + list('Confirmed P0', keep(data.backlog.p0), map);
    } else {
      const versions = [...new Set(data.backlog.release.map((r) => map.get(r.id)?.fields.release))].filter(Boolean);
      html += list('In the release scope' + (versions.length ? ' (' + versions.join(', ') + ')' : ''), keep(data.backlog.release), map);
      html += list('Pool, by priority, size and age', keep(data.backlog.pool), map);
      html += '<p class="none">P4 items not listed: ' + data.backlog.p4Count + '</p>';
    }
    if (data.backlog.leftOut.length) html += '<p class="none">Left out, with lint errors: ' + data.backlog.leftOut.map(esc).join(', ') + '</p>';
  } else {
    html += '<div class="tools"><input type="search" id="filter" placeholder="Filter on id, title or source" value="' + esc(filter) + '"></div>';
    const items = data.issues.filter(matches).map((i) => ({ id: i.id, note: '' }));
    html += list('Every file', items, map);
    html += '<h2>Closed (issues/CLOSED.md)</h2><div class="body closed">' + md(data.closed) + '</div>';
  }
  $('#main').innerHTML = html;
}

/**
 * The Close all button of the Board view, from the current data. The
 * confirmation line is built when the button is clicked, and it keeps the ids
 * it shows in data-ids: "Close them" sends those ids, so the server refuses
 * when the files name others. A redraw after an edit draws this part again,
 * which also hides an open confirmation.
 */
function boardTools(message) {
  const n = data.board.sections.closing.length;
  return '<button type="button" class="act" id="close-all"' + (n ? '' : ' disabled') + '>Close all (' + n + ')</button>' +
    '<span class="inline" id="close-confirm"></span>' +
    '<span class="msg' + (message ? ' ' + message.kind : '') + '" id="close-msg">' + (message ? esc(message.text) : '') + '</span>' +
    '<span class="none">Cards keep their place after an edit; Refresh sorts the lists again.</span>';
}

async function load() {
  const r = await fetch('/api/data');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.statusText);
  data = d;
}

async function refresh() {
  try {
    await load();
    renderHeader();
    renderMain();
  } catch (e) {
    $('#main').innerHTML = '<div class="banner">' + esc(e.message) + '</div>';
  }
}

// The text fields of a card whose typed text a redraw keeps.
const DRAFTS = ['.decision textarea', '[data-op="ask"]', '[data-op="release"]', '[data-for="close"] .reason', '[data-for="fixed"] .reason'];

/**
 * Redraws every card of one id from the files, in place, and the header and
 * the Close all button. Text typed and not yet written stays (a field whose
 * text differs from the file, or the field that has the focus), with the
 * focus, the selection and an open reason field. The argument written says
 * what the write just stored: sent maps the selector of each field it wrote to
 * the text sent, and closeReason closes the reason field after a state write.
 * A field in sent is drawn from the file, unless its text changed after the
 * text was sent (the board typed more while the write ran). That rule holds
 * only in the card where the edit was made, which carries the write's token
 * in data-writing; another copy of the card (an item can be in two sections)
 * keeps only its own typed text, so it shows the value just written.
 */
async function redraw(id, written = { sent: {}, closeReason: false, token: '' }) {
  await load();
  await pointerIdle();
  renderHeader();
  const tools = $('#board-tools');
  if (tools) tools.innerHTML = boardTools();
  const i = byId().get(id);
  for (const el of document.querySelectorAll('.card[data-id="' + CSS.escape(id) + '"]')) {
    if (!i) { el.outerHTML = '<p class="none">' + esc(id) + ' was removed.</p>'; continue; }
    const drafts = DRAFTS.map((s) => {
      const f = $(s, el);
      const focused = f === document.activeElement;
      const origin = written.token !== '' && el.dataset.writing === written.token;
      const keep = origin && s in written.sent ? f.value !== written.sent[s] : focused || f.value !== f.defaultValue;
      return { s, value: f.value, keep, focused, start: f.selectionStart, end: f.selectionEnd };
    });
    const shown = written.closeReason ? undefined : el.querySelector('.inline.shown')?.dataset.for;
    const t = document.createElement('template');
    t.innerHTML = card(i, el.dataset.note);
    const fresh = t.content.firstChild;
    // A later write of the same card set another token: the card keeps it.
    if (el.dataset.writing && el.dataset.writing !== written.token) fresh.dataset.writing = el.dataset.writing;
    if (shown) {
      fresh.querySelector('[data-for="' + shown + '"]').classList.add('shown');
      $('select[data-op="state"]', fresh).value = shown;
    }
    el.replaceWith(fresh);
    for (const d of drafts) {
      const f = $(d.s, fresh);
      if (d.keep) f.value = d.value;
      if (d.focused) { f.focus(); try { if (d.keep) f.setSelectionRange(d.start, d.end); } catch {} }
    }
  }
}

// A card is not replaced while a mouse button is down: the blur of a text
// field writes and redraws the card between the press and the release on
// another control, and a click whose target was replaced never fires.
let pointerDown = false;
let idleWaiters = [];
const pointerIdle = () => (pointerDown ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve());
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
const release = () => setTimeout(() => {
  pointerDown = false;
  const w = idleWaiters; idleWaiters = [];
  for (const r of w) r();
}, 0);
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);

// One write at a time, in the order of the events: the change of a text field
// (on blur) and the click that caused the blur must not overlap.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

/** A POST to the server; a failed connection gives { ok: false, error }. */
async function post(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({ error: r.statusText }));
    return { ...d, ok: r.ok };
  } catch (e) {
    return { ok: false, error: 'no answer from the server (' + e.message + '); is it still running?' };
  }
}

let writes = 0;
function editCard(el, body) {
  const id = el.dataset.id;
  const token = String(++writes);
  el.dataset.writing = token;
  // The decision text is read now, before an earlier write redraws the card.
  if (body.op === 'decision') body = { ...body, text: $('.decision textarea', el).value };
  const cards = () => document.querySelectorAll('.card[data-id="' + CSS.escape(id) + '"]');
  for (const c of cards()) c.classList.add('busy');
  return serial(async () => {
    const r = await post('/api/edit', { id, ...body });
    const lintErrors = r.lint?.errors ?? [];
    if (!r.ok) notes.set(id, { kind: 'err', text: 'Not written: ' + r.error });
    else if (lintErrors.length) notes.set(id, { kind: 'err', text: 'Written, but the file has lint errors (shown above).' });
    else notes.set(id, { kind: 'ok', text: (r.messages ?? []).join(' · ') });
    const sent = {};
    if (r.ok && body.op === 'decision') sent['.decision textarea'] = body.text;
    if (r.ok && (body.op === 'ask' || body.op === 'release')) sent['[data-op="' + body.op + '"]'] = body.value;
    if (r.ok && body.op === 'state' && body.reason !== undefined) sent['[data-for="' + body.value + '"] .reason'] = body.reason;
    const written = { sent, closeReason: r.ok && body.op === 'state', token };
    try {
      await redraw(id, written);
    } catch (e) {
      for (const c of cards()) {
        c.classList.remove('busy');
        const m = $('.msg', c);
        m.className = 'msg err';
        m.textContent = (r.ok ? 'Written, but ' : 'Not written: ' + r.error + '. And ') + 'the page could not read the files again: ' + e.message;
      }
    }
  });
}

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.view) { view = t.dataset.view; renderHeader(); renderMain(); return; }
  if (t.id === 'refresh') { notes.clear(); return refresh(); }
  if (t.id === 'close-all') {
    const ids = data.board.sections.closing.map((r) => r.id);
    const c = $('#close-confirm');
    c.dataset.ids = JSON.stringify(ids);
    const named = ids.map((id) => {
      const o = byId().get(id) && origin(byId().get(id).fields);
      return id + (o ? ' (' + o.label + ')' : '');
    });
    c.innerHTML = 'Remove ' + esc(named.join(', ')) + ' and write their lines to CLOSED.md? <button type="button" class="act primary" id="close-yes">Close them</button><button type="button" class="act" id="close-no">Cancel</button>';
    c.classList.add('shown');
    return;
  }
  if (t.id === 'close-no') { $('#close-confirm').classList.remove('shown'); return; }
  if (t.id === 'close-yes') {
    t.disabled = true;
    const ids = JSON.parse($('#close-confirm').dataset.ids);
    return serial(async () => {
      const r = await post('/api/close-all', { ids });
      await refresh();
      const message = r.ok ? { kind: 'ok', text: r.messages.join(' · ') } : { kind: 'err', text: 'Nothing closed: ' + r.error };
      const tools = $('#board-tools');
      if (tools) tools.innerHTML = boardTools(message);
    });
  }
  const el = t.closest('.card');
  if (!el) return;
  if (t.matches('summary')) return;
  if (t.dataset.flag) return editCard(el, { op: 'flag', name: t.dataset.flag, on: t.getAttribute('aria-pressed') !== 'true' });
  const act = t.dataset.act;
  if (act === 'confirm') return editCard(el, { op: 'confirm' });
  if (act === 'reviewed') return editCard(el, { op: 'reviewed' });
  if (act === 'decision') {
    if (!$('.decision textarea', el).value.trim()) { $('.decision textarea', el).focus(); return; }
    return editCard(el, { op: 'decision' });
  }
  if (act === 'close' || act === 'fixed') {
    const reason = $('[data-for="' + act + '"] .reason', el).value;
    if (!reason.trim()) { $('[data-for="' + act + '"] .reason', el).focus(); return; }
    return editCard(el, { op: 'state', value: act, reason });
  }
  if (act === 'cancel') {
    for (const s of el.querySelectorAll('.inline')) s.classList.remove('shown');
    const sel = $('select[data-op="state"]', el);
    sel.value = [...sel.options].find((o) => o.defaultSelected)?.value ?? sel.value;
    return;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  const el = t.closest?.('.card');
  if (!el || !t.dataset.op) return;
  if (t.dataset.op === 'state' && (t.value === 'close' || t.value === 'fixed')) {
    for (const s of el.querySelectorAll('.inline')) s.classList.toggle('shown', s.dataset.for === t.value);
    $('[data-for="' + t.value + '"] .reason', el).focus();
    return;
  }
  editCard(el, { op: t.dataset.op, value: t.value });
});

document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (ev.key === 'Enter' && t.classList?.contains('reason')) {
    ev.preventDefault();
    t.parentElement.querySelector('.primary').click();
  }
});

document.addEventListener('toggle', (ev) => {
  const el = ev.target.closest?.('.card');
  if (!el || ev.target.tagName !== 'DETAILS') return;
  if (ev.target.open) open.add(el.dataset.id); else open.delete(el.dataset.id);
}, true);

document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'filter') return;
  filter = ev.target.value;
  const pos = ev.target.selectionStart;
  renderMain();
  const f = $('#filter');
  f.focus();
  f.setSelectionRange(pos, pos);
});

refresh();
</script>
</body>
</html>
`;
