import { useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  createEmptyHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from '@/lib/history'
import type { ProjectState } from '@/types/inventory'

type ProjectHistoryOptions = {
  projectRef: MutableRefObject<ProjectState | null>
  setProject: Dispatch<SetStateAction<ProjectState | null>>
  setSelectedItemId: Dispatch<SetStateAction<string | null>>
  setSelectedConnectionId: Dispatch<SetStateAction<string | number | null>>
  setValidationMessage: (message: string | null) => void
  scheduleProjectSave: (project: ProjectState) => void
}

export function useProjectHistory({
  projectRef,
  setProject,
  setSelectedItemId,
  setSelectedConnectionId,
  setValidationMessage,
  scheduleProjectSave: scheduleLegacyProjectSave,
}: ProjectHistoryOptions) {
  const [history, setHistory] = useState<HistoryState<ProjectState>>(() => createEmptyHistory())

  function undoProjectChange() {
    setHistory((currentHistory) => {
      const currentProject = projectRef.current

      if (!currentProject) {
        return currentHistory
      }

      const result = undoHistory(currentHistory, currentProject)

      if (!result) {
        return currentHistory
      }

      const projectChanged = result.project !== currentProject
      const rebasedProject = projectChanged
        ? { ...result.project, revision: currentProject.revision }
        : currentProject
      projectRef.current = rebasedProject
      setProject(rebasedProject)

      if (projectChanged) {
        scheduleLegacyProjectSave(rebasedProject)
      }
      setSelectedItemId((current) => (current && rebasedProject.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && rebasedProject.connections.some((connection) => connection.id === current)
          ? current
          : null,
      )
      setValidationMessage(null)

      return result.history
    })
  }

  function redoProjectChange() {
    setHistory((currentHistory) => {
      const currentProject = projectRef.current

      if (!currentProject) {
        return currentHistory
      }

      const result = redoHistory(currentHistory, currentProject)

      if (!result) {
        return currentHistory
      }

      const projectChanged = result.project !== currentProject
      const rebasedProject = projectChanged
        ? { ...result.project, revision: currentProject.revision }
        : currentProject
      projectRef.current = rebasedProject
      setProject(rebasedProject)

      if (projectChanged) {
        scheduleLegacyProjectSave(rebasedProject)
      }
      setSelectedItemId((current) => (current && rebasedProject.items[current] ? current : null))
      setSelectedConnectionId((current) =>
        current && rebasedProject.connections.some((connection) => connection.id === current)
          ? current
          : null,
      )
      setValidationMessage(null)

      return result.history
    })
  }


  return {
    history,
    setHistory,
    undoProjectChange,
    redoProjectChange,
  }
}
