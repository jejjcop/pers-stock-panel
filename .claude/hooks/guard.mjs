#!/usr/bin/env node
/**
 * Guardrail hook: runs before every Bash/Edit/Write call by any agent (or by you in Claude Code).
 * Exit code 2 blocks the call, and the stderr message is shown to the agent so it can adapt.
 *
 * Principle: agents write code; only the orchestrator (or a human) handles git remotes, secrets,
 * CI config and the guardrails themselves.
 */
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw || '{}');
  const path = String(input.file_path ?? input.notebook_path ?? '').replace(/\\/g, '/');
  const command = String(input.command ?? '');

  const protectedPaths = [
    [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, 'secrets file'],
    [/(^|\/)\.git\//, 'git internals'],
    [/(^|\/)\.github\//, 'CI configuration'],
    [/(^|\/)\.claude\//, 'agent guardrails'],
  ];

  const dangerousCommands = [
    [/\bgit\s+push\b/, 'agents never push; the orchestrator does'],
    [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|branch\s+-D)/, 'destructive git command'],
    [/--no-verify\b/, 'skipping git hooks'],
    [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\.\.)/i, 'recursive delete outside the project'],
    [/\b(migrate:fresh|migrate:reset|db:wipe)\b/, 'wipes the database'],
    [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|php)\b/, 'piping a download into a shell'],
    [/\bcat\b[^|;]*\.env\b(?!\.example)/, 'reading secrets'],
  ];

  if (path && ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const hit = protectedPaths.find(([re]) => re.test(path));
    if (hit) return block(`Blocked: ${path} is protected (${hit[1]}).`);
  }
  if (tool === 'Bash') {
    const hit = dangerousCommands.find(([re]) => re.test(command));
    if (hit) return block(`Blocked: "${command.slice(0, 80)}" (${hit[1]}).`);
  }
  process.exit(0);
});

function block(reason) {
  process.stderr.write(`${reason} If you really need this, stop and explain why in your final message so a human can decide.\n`);
  process.exit(2);
}
