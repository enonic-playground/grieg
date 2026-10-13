// Runs the MCP conformance suite against a running XP and fails when a check listed in
// conformance-allowlist.json no longer passes. `--update` rewrites the list from this run.
//
// The suite sends no auth, so a local proxy adds the bearer token. It forwards `Host` verbatim:
// the DNS-rebinding scenario depends on it.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const SUITE = '@modelcontextprotocol/conformance@0.2.0-alpha.12';
const REQUIREMENTS = '2026-07-28';
const MCP_PATH = '/api/com.enonic.app.grieg:mcp';
const PROXY_PORT = 3999;

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWLIST = path.join(import.meta.dirname, 'conformance-allowlist.json');
const RESULT_DIR = /^server-(.+)-\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

type Allowlist = Record<string, string[]>;
type Check = { id: string; status: string };

const token = process.env.GRIEG_MCP_TOKEN;
if (token == null || token === '') {
  console.error('Set GRIEG_MCP_TOKEN to a personal MCP key, or the `mcp.token` of the running XP.');
  process.exit(2);
}
const xp = new URL(process.env.GRIEG_XP_URL ?? 'http://localhost:8080');
const update = process.argv.includes('--update');

function startProxy(): Promise<http.Server> {
  const client = xp.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    const upstream = client.request(
      {
        protocol: xp.protocol,
        hostname: xp.hostname,
        port: xp.port,
        method: req.method,
        path: MCP_PATH,
        headers: { ...req.headers, authorization: `Bearer ${token}` },
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROXY_PORT, '127.0.0.1', () => resolve(server));
  });
}

function runSuite(outputDir: string): Promise<void> {
  const args = ['dlx', SUITE, 'server', '--url', `http://localhost:${PROXY_PORT}/mcp`];
  args.push('--requirements', REQUIREMENTS, '-o', outputDir);
  const child = spawn('pnpm', args, { cwd: ROOT, stdio: 'inherit' });
  // The suite exits non-zero on any failing check, so only a kill counts as an incomplete run.
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (_code, signal) =>
      signal == null ? resolve() : reject(new Error(`Suite killed by ${signal}`)),
    );
  });
}

function readResults(outputDir: string): Map<string, Check[]> {
  const results = new Map<string, Check[]>();
  if (!existsSync(outputDir)) return results;
  for (const entry of readdirSync(outputDir)) {
    const scenario = RESULT_DIR.exec(entry)?.[1];
    const file = path.join(outputDir, entry, 'checks.json');
    if (scenario == null || !existsSync(file)) continue;
    results.set(scenario, JSON.parse(readFileSync(file, 'utf8')) as Check[]);
  }
  return results;
}

function passing(results: Map<string, Check[]>): Allowlist {
  const list: Allowlist = {};
  for (const [scenario, checks] of [...results].toSorted(([a], [b]) => a.localeCompare(b))) {
    const failing = new Set(checks.filter((c) => c.status !== 'SUCCESS').map((c) => c.id));
    const ids = [...new Set(checks.map((check) => check.id))].filter((id) => !failing.has(id));
    if (ids.length > 0) list[scenario] = ids.toSorted();
  }
  return list;
}

// A check passes only when it ran and every occurrence of its id succeeded.
function regressions(allowlist: Allowlist, results: Map<string, Check[]>): string[] {
  const failed: string[] = [];
  for (const [scenario, ids] of Object.entries(allowlist)) {
    const checks = results.get(scenario);
    for (const id of ids) {
      const matching = checks?.filter((check) => check.id === id) ?? [];
      const status =
        checks == null ? 'scenario missing' : matching.length === 0 ? 'check missing' : undefined;
      const bad = matching.find((check) => check.status !== 'SUCCESS');
      if (status != null || bad != null) failed.push(`${scenario}/${id}: ${status ?? bad?.status}`);
    }
  }
  return failed;
}

const outputDir = path.join(
  ROOT,
  '.tmp/conformance',
  new Date().toISOString().replaceAll(':', '-'),
);
mkdirSync(outputDir, { recursive: true });

const proxy = await startProxy();
try {
  await runSuite(outputDir);
} finally {
  proxy.close();
}

const results = readResults(outputDir);
if (results.size === 0) {
  console.error(`No results in ${outputDir}; the suite did not run.`);
  process.exit(1);
}

const current = passing(results);
if (update) {
  const previous = existsSync(ALLOWLIST)
    ? (JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist)
    : {};
  const missing = Object.keys(previous).filter((scenario) => !results.has(scenario));
  if (missing.length > 0) {
    console.error(`Not updating: no results for ${missing.join(', ')}; the run looks incomplete.`);
    process.exit(1);
  }
  writeFileSync(ALLOWLIST, `${JSON.stringify(current, null, 2)}\n`);
  console.log(
    `Wrote ${Object.keys(current).length} scenarios to ${path.relative(ROOT, ALLOWLIST)}.`,
  );
  process.exit(0);
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist;
const failed = regressions(allowlist, results);
const newlyPassing = Object.entries(current).flatMap(([scenario, ids]) =>
  ids.filter((id) => !allowlist[scenario]?.includes(id)).map((id) => `${scenario}/${id}`),
);

if (newlyPassing.length > 0) {
  console.log(
    `\nPassing but not allowlisted (run with --update to add):\n  ${newlyPassing.join('\n  ')}`,
  );
}
if (failed.length > 0) {
  console.error(`\nAllowlisted checks that no longer pass:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nAll allowlisted checks pass. Results: ${path.relative(ROOT, outputDir)}`);
