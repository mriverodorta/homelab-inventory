import { useEffect, useMemo, useRef } from 'react'
import { createProjectGeometrySnapshot, syncProjectGeometry } from '@/engine/geometry'
import type { useDomainEngine } from '@/hooks/use-domain-engine'
import type { ProjectState } from '@/types/inventory'

type DomainEngine = ReturnType<typeof useDomainEngine>

type ProjectGeometrySyncOptions = {
  project: ProjectState | null
  domainEngine: DomainEngine
  setPersistenceWarning(message: string | null): void
}

export function useProjectGeometrySync({
  project,
  domainEngine,
  setPersistenceWarning,
}: ProjectGeometrySyncOptions) {
  const geometryProjectRef = useRef(project)
  if (
    geometryProjectRef.current?.items !== project?.items
    || geometryProjectRef.current?.assignments !== project?.assignments
    || geometryProjectRef.current?.placements !== project?.placements
  ) {
    geometryProjectRef.current = project
  }
  const geometryProject = geometryProjectRef.current
  const projectGeometrySnapshot = useMemo(
    () => (geometryProject ? createProjectGeometrySnapshot(geometryProject) : null),
    [geometryProject],
  )
  const projectGeometrySnapshotRef = useRef(projectGeometrySnapshot)
  projectGeometrySnapshotRef.current = projectGeometrySnapshot

  useEffect(() => {
    const snapshot = projectGeometrySnapshotRef.current
    if (!domainEngine.enabled || !snapshot || domainEngine.state.phase !== 'ready') return
    void syncProjectGeometry(domainEngine.client, snapshot).catch((error) => {
      setPersistenceWarning(
        error instanceof Error ? error.message : 'Canvas geometry synchronization failed.',
      )
    })
  }, [domainEngine.client, domainEngine.enabled, domainEngine.state.phase, projectGeometrySnapshot?.fingerprint, setPersistenceWarning])
}
