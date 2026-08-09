#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const outputDir = await mkdtemp(join(tmpdir(), 'cloudflare-ai-worker-tests-'));

try {
  await build({
    entryPoints: ['test/*.test.ts'],
    outdir: outputDir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
    packages: 'bundle',
    logLevel: 'warning',
  });

  const files = (await readdir(outputDir)).filter((file) => file.endsWith('.test.js'));
  if (!files.length) throw new Error('No test files were compiled.');

  const child = spawn(process.execPath, ['--test', ...files.map((file) => join(outputDir, file))], {
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
