/** List the ROADMAP.md entries that an agent can implement without a user
 * decision, and write them as a queue for a batch of sessions.
 *
 * An entry is a candidate when all of these are true:
 * - its state is `ready` (the header of ROADMAP.md defines the states);
 * - its kind is `defect` or `wrong value`, or it is another kind that the
 *   user approved (the status says "approved <date>" or "user decision");
 * - its kind is not `design`, and its size is not `L` or `large`: those
 *   need a plan document or more than one session;
 * - it names no other entry that must be committed first ("Starts after
 *   CE-<n>") that is still in ROADMAP.md. When that entry is gone, its work
 *   was committed, and the dependency no longer holds.
 *
 * An entry that passes but has one of these signs is listed with a flag, so
 * that a person can remove it from the queue: "low priority", no Witness
 * line, a link to a plan document, a link to an open issue or pull request.
 *
 * Each candidate has an area, the `##` section of ROADMAP.md that holds it,
 * and the source files that its text names. Two sessions that run at the
 * same time should take candidates of different areas, so that they do not
 * edit the same files.
 *
 * Options:
 *   --json <file>   Also write the candidates as a JSON queue to <file>.
 *   --rejected      Also list each `ready` entry that is not a candidate,
 *                   with the reason.
 *
 * Example:
 *   npx tsx scripts/roadmap-candidates.ts --rejected
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Entry = {
  id: string;
  title: string;
  area: string;
  status: string;
  witness: string | undefined;
  body: string;
};

type Candidate = {
  id: string;
  title: string;
  area: string;
  kind: string;
  size: string | undefined;
  witness: string | undefined;
  files: string[];
  flags: string[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let area = '';
  let current: { id: string; title: string; area: string; lines: string[] } | undefined;

  const finish = () => {
    if (!current) return;
    const body = current.lines.join('\n');
    // The status line can wrap: it ends at the Witness line or a blank line.
    const status = /^\*\*Status:\*\*([\s\S]*?)(?=\n\*\*Witness:\*\*|\n\s*\n|$)/m.exec(body)?.[1];
    const witness = /^\*\*Witness:\*\*([\s\S]*?)(?=\n\s*\n|$)/m.exec(body)?.[1];
    if (status !== undefined)
      entries.push({
        id: current.id,
        title: current.title,
        area: current.area,
        status: status.replace(/\s+/g, ' ').trim(),
        witness: witness?.replace(/\s+/g, ' ').trim(),
        body,
      });
    current = undefined;
  };

  for (const line of text.split('\n')) {
    const section = /^## (.+)$/.exec(line);
    if (section) {
      finish();
      area = section[1].trim();
      continue;
    }
    const heading = /^### (CE-\d+)\. (.+)$/.exec(line);
    if (heading) {
      finish();
      current = { id: heading[1], title: heading[2].trim(), area, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  finish();
  return entries;
}

/** The kind and the size of a status such as "ready; wrong value, S.". */
function kindAndSize(status: string): { kind: string; size: string | undefined } {
  const afterState = status.split(';')[1] ?? '';
  const head = afterState.split('.')[0].trim();
  const [kind, size] = head.split(',').map((s) => s.trim());
  // "defect (wrong value)" is a wrong value.
  const normalized = /\(wrong value\)/.test(kind) ? 'wrong value' : kind.replace(/\s*\(.*\)$/, '');
  return { kind: normalized, size: size || undefined };
}

function classify(entry: Entry, present: Set<string>): { candidate?: Candidate; reason?: string } {
  const { kind, size } = kindAndSize(entry.status);
  const approved = /approved \d{4}-\d{2}-\d{2}|user decision/i.test(entry.status);

  if (kind === 'design') return { reason: 'kind is design' };
  if (kind !== 'defect' && kind !== 'wrong value' && !approved)
    return { reason: `kind is ${kind} with no recorded approval` };
  if (size && /^(L|large)$/i.test(size)) return { reason: 'size is L' };

  // A dependency holds only while the entry it names is still in the file.
  // "CE-712.2" is in the file when its parent "CE-712" is.
  const blocking: string[] = [];
  for (const m of entry.status.matchAll(/Starts after (CE-\d+)(\.\d+)?/g))
    if (present.has(m[1])) blocking.push(m[1] + (m[2] ?? ''));
  if (blocking.length > 0) return { reason: `starts after ${blocking.join(', ')}` };

  const flags: string[] = [];
  if (/low priority/i.test(entry.status)) flags.push('low priority');
  if (!entry.witness) flags.push('no witness');
  if (/\bPlan:/.test(entry.status)) flags.push('plan document');
  if (/\b(Issue|PR) #\d+/.test(entry.status)) flags.push('linked issue or PR');
  // A crafted witness of a compiled-code difference belongs in the
  // known-limitations list of docs/COMPILATION-MODEL.md, not in a session.
  if (/^crafted\b/.test(entry.witness ?? '')) flags.push('crafted witness');
  // An entry with sub-items is done one sub-item per session.
  const subItems = [...entry.body.matchAll(/^- \*\*CE-\d+\.\d+\*\*/gm)].length;
  if (subItems > 0) flags.push(`${subItems} sub-items`);
  // Two entries with one cause share one fix: one session takes both.
  for (const m of entry.status.matchAll(/[Ss]ame cause as (CE-\d+)/g))
    if (present.has(m[1])) flags.push(`same cause as ${m[1]}`);

  const files = [
    ...new Set(
      [...entry.body.matchAll(/`?((?:[\w.-]+\/)*[\w.-]+\.(?:ts|mjs|md))`?/g)]
        .map((m) => m[1])
        .filter((f) => f.includes('/') || /\.ts$/.test(f))
        .filter((f) => !f.startsWith('docs/'))
    ),
  ];

  return {
    candidate: {
      id: entry.id,
      title: entry.title,
      area: entry.area,
      kind,
      size,
      witness: entry.witness?.split(';')[0],
      files,
      flags,
    },
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      json: { type: 'string' },
      rejected: { type: 'boolean', default: false },
    },
  });

  const text = readFileSync(join(root, 'ROADMAP.md'), 'utf8');
  const entries = parseEntries(text);
  const present = new Set(entries.map((e) => e.id));
  const ready = entries.filter((e) => /^ready\b/.test(e.status));

  const candidates: Candidate[] = [];
  const rejected: { id: string; title: string; reason: string }[] = [];
  for (const entry of ready) {
    const { candidate, reason } = classify(entry, present);
    if (candidate) candidates.push(candidate);
    else rejected.push({ id: entry.id, title: entry.title, reason: reason! });
  }

  const byArea = new Map<string, Candidate[]>();
  for (const c of candidates) byArea.set(c.area, [...(byArea.get(c.area) ?? []), c]);

  console.log(`${entries.length} entries, ${ready.length} ready, ${candidates.length} candidates.\n`);
  for (const [area, list] of byArea) {
    console.log(`## ${area} (${list.length})`);
    for (const c of list) {
      const meta = [c.kind, c.size, c.witness].filter(Boolean).join(', ');
      const flags = c.flags.length > 0 ? `  [${c.flags.join('; ')}]` : '';
      console.log(`  ${c.id.padEnd(8)} ${c.title.slice(0, 90)}`);
      console.log(`  ${''.padEnd(8)} ${meta}${flags}`);
    }
    console.log('');
  }

  if (values.rejected) {
    console.log(`## Ready but not candidates (${rejected.length})`);
    for (const r of rejected) console.log(`  ${r.id.padEnd(8)} ${r.reason.padEnd(40)} ${r.title.slice(0, 70)}`);
  }

  if (values.json) {
    writeFileSync(values.json, JSON.stringify({ generated: new Date().toISOString(), candidates }, null, 2) + '\n');
    console.log(`\nQueue written to ${values.json}.`);
  }
}

main();
