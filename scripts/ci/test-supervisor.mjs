#!/usr/bin/env bun

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const DEFAULT_JOBS = Object.freeze([
  { id: 'vitest', command: ['bun', 'run', 'test:vitest'] },
  { id: 'bun', command: ['bun', 'run', 'test:bun'] },
])

function signalProcess(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function startJob({ job, root, logRoot, environment, spawnProcess }) {
  if (!job?.id || !Array.isArray(job.command) || job.command.length === 0) {
    throw new Error('Concurrent test jobs require an id and command.')
  }
  const logFile = path.join(logRoot, `${job.id}.log`)
  const handle = await fs.open(logFile, 'w', 0o600)
  const started = performance.now()
  let child
  try {
    child = spawnProcess(job.command[0], job.command.slice(1), {
      cwd: root,
      env: { ...environment, ...(job.env ?? {}) },
      detached: process.platform !== 'win32',
      stdio: ['ignore', handle.fd, handle.fd],
    })
  } catch (error) {
    await handle.close()
    throw error
  }

  const completion = new Promise((resolve) => {
    let spawnError = null
    child.once('error', (error) => { spawnError = error })
    child.once('close', async (code, signal) => {
      await handle.close()
      resolve({
        id: job.id,
        code: Number.isInteger(code) ? code : -1,
        signal,
        error: spawnError,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        logFile,
      })
    })
  })
  return { id: job.id, child, completion, logFile }
}

async function stopJobs(entries, timeoutMs) {
  for (const entry of entries) signalProcess(entry.child, 'SIGTERM')
  const completed = Promise.all(entries.map((entry) => entry.completion))
  const finished = await Promise.race([
    completed.then(() => true),
    Bun.sleep(timeoutMs).then(() => false),
  ])
  if (!finished) {
    for (const entry of entries) signalProcess(entry.child, 'SIGKILL')
  }
  await completed
}

export async function runConcurrentTestFamilies({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  jobs = DEFAULT_JOBS,
  logRoot = null,
  environment = process.env,
  spawnProcess = spawn,
  output = console.log,
  shutdownTimeoutMs = 2_000,
} = {}) {
  const privateLogRoot = logRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), 'hli-tests-'))
  const started = performance.now()
  const entries = []
  try {
    await fs.mkdir(privateLogRoot, { recursive: true, mode: 0o700 })
    for (const job of jobs) {
      entries.push(await startJob({
        job,
        root,
        logRoot: privateLogRoot,
        environment,
        spawnProcess,
      }))
    }

    let resolveFailure
    const firstFailure = new Promise((resolve) => { resolveFailure = resolve })
    const completions = entries.map((entry) => entry.completion.then((result) => {
      if (result.code !== 0) resolveFailure(result)
      return result
    }))
    const all = Promise.all(completions)
    const outcome = await Promise.race([
      all.then((results) => ({ results })),
      firstFailure.then((failure) => ({ failure })),
    ])

    if (outcome.failure) {
      await stopJobs(entries.filter((entry) => entry.id !== outcome.failure.id), shutdownTimeoutMs)
      const results = await all
      const logs = await Promise.all(results.map(async (result) => ({
        id: result.id,
        text: await fs.readFile(result.logFile, 'utf8').catch(() => ''),
      })))
      for (const log of logs) {
        if (log.text) output(`\n[${log.id}]\n${log.text.trimEnd()}`)
      }
      const detail = outcome.failure.error ? `: ${outcome.failure.error.message}` : ''
      throw new Error(`${outcome.failure.id} failed with exit code ${outcome.failure.code}${detail}`)
    }

    const results = outcome.results
    for (const result of results) output(`[tests] ${result.id} passed in ${(result.durationMs / 1_000).toFixed(2)}s`)
    return {
      jobs: results.map(({ id, durationMs }) => ({ id, durationMs })),
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    }
  } finally {
    for (const entry of entries) signalProcess(entry.child, 'SIGKILL')
    await fs.rm(privateLogRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) await runConcurrentTestFamilies()
