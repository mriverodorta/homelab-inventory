import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SystemsWorkspace } from '@/components/workbook/systems-workspace'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'project-1',
  metadata: { name: 'Default Project', version: 1, updatedAt: '2026-08-11T00:00:00.000Z', projectId: 1, workspaceId: 2 },
  items: {
    'server:1': { id: 1, type: 'server', name: 'HP EliteDesk 800 G6', hardwareClass: 'desktop', usageRole: 'server', manufacturer: 'HP', model: 'EliteDesk 800 G6' },
    'nas:1': { id: 1, type: 'nas', name: 'Synology DS620slim', manufacturer: 'Synology', model: 'DS620slim' },
    'cpu:1': { id: 1, type: 'cpu', name: 'Intel Core i5-10500T', scope: 'global' },
  },
  placements: [],
  assignments: [],
  connections: [],
}

describe('SystemsWorkspace', () => {
  it('lists project compute hosts without loose components', () => {
    render(<SystemsWorkspace project={project} agentStatus={null} registryLinkedItemKeys={new Set()} onSelectItem={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Systems' })).toBeVisible()
    expect(screen.getAllByText('HP EliteDesk 800 G6')[0]).toBeVisible()
    expect(screen.getAllByText('Synology DS620slim')[0]).toBeVisible()
    expect(screen.queryByText('Intel Core i5-10500T')).not.toBeInTheDocument()
  })

  it('filters by type and opens a host', () => {
    const onSelectItem = vi.fn()
    render(<SystemsWorkspace project={project} agentStatus={null} registryLinkedItemKeys={new Set()} onSelectItem={onSelectItem} />)
    fireEvent.click(screen.getByRole('button', { name: 'NAS' }))
    expect(screen.queryByText('HP EliteDesk 800 G6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Synology DS620slim' }))
    expect(onSelectItem).toHaveBeenCalledWith('nas:1')
  })
})
