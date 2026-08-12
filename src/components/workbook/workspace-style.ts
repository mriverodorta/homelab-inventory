import type { WorkspaceColorKey } from '@/lib/workbook-api'

export const WORKSPACE_COLORS: Record<WorkspaceColorKey, { edge: string; active: string }> = {
  blue: { edge: '#3976a8', active: '#eaf3fa' },
  green: { edge: '#408566', active: '#eaf5ef' },
  amber: { edge: '#b77b22', active: '#fff4dc' },
  red: { edge: '#a95247', active: '#faece9' },
  violet: { edge: '#7657a8', active: '#f1ecf8' },
  cyan: { edge: '#277e86', active: '#e7f5f6' },
  pink: { edge: '#a55378', active: '#f8eaf0' },
  gray: { edge: '#737373', active: '#f0f0ee' },
}

export function workspaceColor(colorKey: string) {
  return WORKSPACE_COLORS[colorKey as WorkspaceColorKey] ?? WORKSPACE_COLORS.gray
}
