#!/usr/bin/env node

/**
 * probe-reviewer-isolation.js
 *
 * Hard gate of Commit 1 of Phase 1 of cross-review-mcp.
 *
 * Goal: empirically validate whether the contained reviewer spawn works
 * with the real set of MCPs, or whether a fallback to bypass is needed.
 *
 * Tests two independent paths:
 *
 *   CODEX reviewer:
 *     codex -a never -s read-only exec --skip-git-repo-check
 *       -c mcp_servers.<destructive>.enabled=false (for each item in the
 *       disable list)
 *
 *   CLAUDE reviewer:
 *     claude -p --permission-mode default
 *       --strict-mcp-config --mcp-config reviewer-minimal.mcp.json
 *       --disallowed-tools "Write,Edit,NotebookEdit"
 *
 * In each case: spawn the CLI, pass a probe prompt, observe whether:
 *   (a) listed tools include only the expected ones (memory, ultrathink,
 *       code-reasoning, docs)
 *   (b) invocation of a "safe" tool (memory.search_nodes) works
 *   (c) the agent finishes with "STATUS: PROBE_DONE"
 *
 * If everything passes: CONTAINED baseline is viable. Adopt.
 * If an essential tool is auto-denied: switch to bypass with a
 * justification.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXCLUSIONS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'reviewer-configs', 'peer-exclusions.json'), 'utf8')
);
const REVIEWER_MCP_JSON = path.join(ROOT, 'reviewer-configs', 'reviewer-minimal.mcp.json');

// -c mcp_servers.<x>.enabled=false so funciona para servers que ja existem em
// config.toml. Descobrimos os existentes e aplicamos a intersecao.
function listCodexConfiguredServers() {
  const configPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.codex',
    'config.toml'
  );
  if (!fs.existsSync(configPath)) return [];
  const content = fs.readFileSync(configPath, 'utf8');
  const names = new Set();
  const re = /^\[mcp_servers\.([^\].]+)\]/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

const CONFIGURED_CODEX_SERVERS = listCodexConfiguredServers();

const PROBE_PROMPT = `
You are inside a REVIEWER ISOLATION PROBE. The test measures dispatcher
capability, not your narrated assessment of tool visibility.

Do exactly this:

1. Invoke the MCP tool "search_nodes" on the "memory" server with argument
   {"query": "probe-test"}. Make the call EXPLICITLY. Do not pre-check
   availability, do not list tools, do not reason about whether the tool exists.
   Attempt the call directly. If the dispatcher refuses it, that is the
   intended signal for this probe.

2. Report the tool's response (or the error message) verbatim.

3. End your entire response with exactly this line on its own as the very
   last line:
STATUS: PROBE_DONE
`.trim();

function runCodexContained() {
  // (1) Disable de MCP externos: intersecao com o que esta em config.toml
  // (override de server inexistente gera "invalid transport").
  const effectiveDisable = EXCLUSIONS.codex_disable.filter((name) =>
    CONFIGURED_CODEX_SERVERS.includes(name)
  );
  const skipped = EXCLUSIONS.codex_disable.filter(
    (name) => !CONFIGURED_CODEX_SERVERS.includes(name)
  );
  if (skipped.length) {
    console.log(`[probe:codex] unconfigured mcp_servers (skip): ${skipped.join(', ')}`);
  }
  const disableArgs = effectiveDisable.flatMap((name) => [
    '-c',
    `mcp_servers.${name}.enabled=false`,
  ]);

  // (2) Disable de apps/conectores OpenAI-curated via namespace 'apps.*'.
  // Doc oficial: https://developers.openai.com/codex/config-reference
  const appsDisableArgs = (EXCLUSIONS.codex_apps_disable || []).flatMap((id) => [
    '-c',
    `apps.${id}.enabled=false`,
  ]);

  // (3) approval_mode=approve para tools MCP essenciais do reviewer.
  // Isso permite operar sob '-a never -s read-only' sem precisar bypass total.
  const approveArgs = (EXCLUSIONS.codex_approve_tools || []).flatMap(({ server, tool }) => [
    '-c',
    `mcp_servers.${server}.tools.${tool}.approval_mode=approve`,
  ]);

  const args = [
    '-a', 'never',
    '-s', 'read-only',
    'exec',
    '--skip-git-repo-check',
    ...disableArgs,
    ...appsDisableArgs,
    ...approveArgs,
    '-',
  ];
  console.log(
    `[probe:codex] disables: ${effectiveDisable.length} mcp_servers, ${EXCLUSIONS.codex_apps_disable?.length || 0} apps, ${EXCLUSIONS.codex_approve_tools?.length || 0} approve-tool entries`
  );
  console.log(`\n[probe:codex] spawn: codex ${args.slice(0, 12).join(' ')} ... [+ ${disableArgs.length / 2} disables, prompt via stdin]`);
  const t0 = Date.now();
  const res = spawnSync('codex', args, {
    encoding: 'utf8',
    input: PROBE_PROMPT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 300000,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  return {
    target: 'codex',
    mode: 'contained (-a never -s read-only)',
    status: res.status,
    elapsed_sec: Number(elapsed),
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function runClaudeContained() {
  const args = [
    '-p',
    '--output-format', 'text',
    '--permission-mode', 'default',
    '--strict-mcp-config',
    '--mcp-config', REVIEWER_MCP_JSON,
    '--disallowed-tools', 'Write,Edit,NotebookEdit',
  ];
  console.log(`\n[probe:claude] spawn: claude ${args.slice(0, 10).join(' ')} ... [prompt via stdin]`);
  const t0 = Date.now();
  const res = spawnSync('claude', args, {
    encoding: 'utf8',
    input: PROBE_PROMPT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 300000,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  return {
    target: 'claude',
    mode: 'contained (--permission-mode default + --strict-mcp-config)',
    status: res.status,
    elapsed_sec: Number(elapsed),
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function classify(result) {
  const { stdout, stderr } = result;
  const combined = `${stdout}\n${stderr}`;
  // Eventos do dispatcher no stderr sao a verdade. Narracao do agente no
  // stdout e heuristica fraca — agente pode dizer "None directly visible" e
  // mesmo assim invocar com sucesso se chamar explicitamente.
  const memorySucceeded = /mcp:\s*memory\/search_nodes\s*\(completed\)/i.test(combined);
  const memoryFailed = /mcp:\s*memory\/search_nodes\s*\(failed\)/i.test(combined);
  const memoryStarted = /mcp:\s*memory\/search_nodes\s*started/i.test(combined);
  const autoDenied = /user cancelled MCP tool call|permission denied/i.test(combined);
  const codexAppsInvoked = /mcp:\s*codex_apps\//i.test(combined);
  const hasProbeDone = /^STATUS:\s*PROBE_DONE\s*$/m.test(stdout);
  return {
    memorySucceeded,
    memoryFailed,
    memoryStarted,
    autoDenied,
    codexAppsInvoked,
    hasProbeDone,
  };
}

function verdict(flags) {
  if (flags.memorySucceeded && !flags.codexAppsInvoked) {
    return 'CONTAINED_MODE_VIABLE';
  }
  if (flags.memoryFailed || flags.autoDenied) {
    return 'CONTAINED_MODE_FAILED_READ_ONLY_MCP_BLOCKED';
  }
  if (flags.codexAppsInvoked) {
    return 'CONTAINED_MODE_INCOMPLETE_CODEX_APPS_LEAK';
  }
  if (!flags.memoryStarted && !flags.hasProbeDone) {
    return 'PROBE_DID_NOT_COMPLETE';
  }
  if (!flags.memoryStarted && flags.hasProbeDone) {
    return 'AGENT_DID_NOT_ATTEMPT_CALL';
  }
  return 'INCONCLUSIVE';
}

function main() {
  const targets = process.argv.slice(2);
  const runAll = targets.length === 0;
  const runCodex = runAll || targets.includes('codex');
  const runClaude = runAll || targets.includes('claude');

  const results = [];

  if (runCodex) {
    console.log('=== PROBE: CODEX reviewer under -a never -s read-only ===');
    const r = runCodexContained();
    const flags = classify(r);
    const v = verdict(flags);
    console.log(`\n[codex] verdict=${v} | elapsed=${r.elapsed_sec}s | exit=${r.status}`);
    console.log(`[codex] flags: ${JSON.stringify(flags)}`);
    console.log('--- stdout ---');
    console.log(r.stdout.slice(0, 4000));
    if (r.stderr) {
      console.log('--- stderr (tail) ---');
      console.log(r.stderr.slice(-1500));
    }
    results.push({ ...r, flags, verdict: v });
  }

  if (runClaude) {
    console.log('\n=== PROBE: CLAUDE reviewer under restricted permission mode ===');
    const r = runClaudeContained();
    const flags = classify(r);
    const v = verdict(flags);
    console.log(`\n[claude] verdict=${v} | elapsed=${r.elapsed_sec}s | exit=${r.status}`);
    console.log(`[claude] flags: ${JSON.stringify(flags)}`);
    console.log('--- stdout ---');
    console.log(r.stdout.slice(0, 4000));
    if (r.stderr) {
      console.log('--- stderr (tail) ---');
      console.log(r.stderr.slice(-1500));
    }
    results.push({ ...r, flags, verdict: v });
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  ${r.target}: ${r.verdict} (${r.elapsed_sec}s)`);
  }

  const outPath = path.join(ROOT, 'probe-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n[probe] results saved to ${outPath}`);

  // Aggregator: categorizar cada verdict em {viable, failure, inconclusive}
  // e combinar. Sem match por string exata (o bug anterior procurava
  // 'CONTAINED_MODE_FAILED' mas verdicts reais tem suffix).
  const isViable = (v) => v === 'CONTAINED_MODE_VIABLE';
  const isFailure = (v) => v.startsWith('CONTAINED_MODE_FAILED') || v.startsWith('CONTAINED_MODE_INCOMPLETE');
  const overall = results.every((r) => isViable(r.verdict))
    ? 'ALL_CONTAINED_VIABLE'
    : results.some((r) => isFailure(r.verdict))
    ? 'NEED_ADJUSTMENT_FOR_AT_LEAST_ONE'
    : 'MIXED_OR_INCONCLUSIVE';
  console.log(`[probe] overall=${overall}`);
  process.exit(overall === 'ALL_CONTAINED_VIABLE' ? 0 : 1);
}

main();
