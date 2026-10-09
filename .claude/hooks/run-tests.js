// Claude Code "Stop" hook: when Claude finishes a turn in which the code
// changed, run the PHP and browser tests. If they fail, Claude is told to
// keep going and fix them (or explain); if they pass, a short note is shown.
//
// Tests only run when the code differs from the last tested state, so plain
// questions do not wait for a test run.

const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const stateFile = path.join(__dirname, '.last-tested');
// Everything that can change how the app or the tests behave.
const watchedPaths = ['public', 'src', 'tests', 'composer.json', 'composer.lock', 'package.json', 'package-lock.json', 'phpunit.xml', 'playwright.config.js'];

function readStdin() {
    try {
        return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function git(args) {
    // Git's warnings (e.g. about line endings) are not wanted in the output.
    return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

// A fingerprint of the uncommitted code changes: the diff against the last
// commit plus the contents of new files. Null when nothing has changed.
function changesFingerprint() {
    const status = git(['status', '--porcelain=v1', '-uall', '--', ...watchedPaths]);
    if (status.trim() === '') {
        return null;
    }

    const hash = crypto.createHash('sha1');
    hash.update(git(['rev-parse', 'HEAD']));
    hash.update(git(['diff', 'HEAD', '--', ...watchedPaths]));
    status.split('\n')
        .filter((line) => line.startsWith('??'))
        .map((line) => line.slice(3).trim())
        .forEach((file) => {
            hash.update(file);
            hash.update(fs.readFileSync(path.join(projectDir, file)));
        });
    return hash.digest('hex');
}

function run(label, command, args) {
    const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', env: { ...process.env, CI: '' }, maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    return { label, passed: result.status === 0, output };
}

// The lines that say what passed or failed, without the full test output.
function summary({ label, passed, output }) {
    const lines = output.split(/\r?\n/).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
    if (passed) {
        const total = lines.reverse().find((line) => /OK \(\d+ tests|\d+ passed/.test(line));
        return `${label}: ${total ? total.trim() : 'passed'}`;
    }
    return `${label} FAILED:\n${lines.slice(-60).join('\n')}`;
}

const input = readStdin();
let fingerprint;
try {
    fingerprint = changesFingerprint();
} catch (error) {
    // Not able to tell what changed (e.g. git missing): stay out of the way.
    process.exit(0);
}

let lastTested = null;
try {
    lastTested = fs.readFileSync(stateFile, 'utf8').trim();
} catch {
    // No tests have run yet.
}
if (fingerprint === null || fingerprint === lastTested) {
    process.exit(0);
}

const results = [
    run('PHP tests', 'php', ['vendor/bin/phpunit', '--colors=never']),
    run('Browser tests', process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--reporter=line']),
];

if (results.every((result) => result.passed)) {
    fs.writeFileSync(stateFile, `${fingerprint}\n`);
    process.stdout.write(JSON.stringify({ systemMessage: `Tests passed after the changes. ${results.map(summary).join('. ')}` }));
    process.exit(0);
}

const report = results.filter((result) => !result.passed).map(summary).join('\n\n');
if (input.stop_hook_active) {
    // Claude was already sent back once for failing tests; tell the user
    // instead of looping.
    process.stdout.write(JSON.stringify({ systemMessage: `Tests are still failing after the changes:\n${report}` }));
    process.exit(0);
}

process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `The automatic test run after your changes failed. Fix the failures, or if a test is now wrong, update it and tell the user why. Do not finish with failing tests without telling the user.\n\n${report}`,
}));
