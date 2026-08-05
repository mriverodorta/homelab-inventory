#!/usr/bin/env bun

const process = Bun.spawn(['git', 'config', 'core.hooksPath', '.githooks'], {
  cwd: new URL('../', import.meta.url).pathname,
  stdout: 'inherit',
  stderr: 'inherit',
})

const exitCode = await process.exited
if (exitCode !== 0) process.exit(exitCode)
console.log('Installed repository hooks from .githooks/.')
