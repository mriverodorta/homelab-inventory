export function commandText(command) {
  return command.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ')
}

export async function run(command, options = {}) {
  if (options.log !== false) console.log(`\n$ ${commandText(command)}`)
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdin: options.stdin ?? 'ignore',
    stdout: options.capture ? 'pipe' : 'inherit',
    stderr: options.capture ? 'pipe' : 'inherit',
  })
  const exitCode = await child.exited
  const stdout = options.capture ? await new Response(child.stdout).text() : ''
  const stderr = options.capture ? await new Response(child.stderr).text() : ''
  if (exitCode !== 0 && !options.allowFailure) {
    const detail = stderr.trim() || stdout.trim()
    throw new Error(`${command[0]} exited with code ${exitCode}${detail ? `: ${detail}` : '.'}`)
  }
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

export async function commandAvailable(command, options = {}) {
  const result = await run(command, { ...options, capture: true, allowFailure: true, log: false })
  return result.exitCode === 0
}
