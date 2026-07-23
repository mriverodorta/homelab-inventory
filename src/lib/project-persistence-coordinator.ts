export class ProjectPersistenceCoordinator {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private readonly onActivityChange: (active: boolean) => void

  constructor(onActivityChange: (active: boolean) => void = () => {}) {
    this.onActivityChange = onActivityChange
  }

  run<T>(settleLegacyPersistence: () => Promise<void>, mutation: () => Promise<T>): Promise<T> {
    this.pending += 1
    if (this.pending === 1) this.onActivityChange(true)

    const operation = this.tail.then(async () => {
      await settleLegacyPersistence()
      return mutation()
    })
    this.tail = operation.then(() => undefined, () => undefined)

    return operation.finally(() => {
      this.pending -= 1
      if (this.pending === 0) this.onActivityChange(false)
    })
  }
}
