const HELP_FLAGS = new Set(['--help', '-h'])

export function parseLocalReleaseCommand(args) {
  const [command, ...options] = args
  if (!command || command === 'help' || args.some((argument) => HELP_FLAGS.has(argument))) {
    return { command: 'help', options: [] }
  }
  return { command, options }
}
