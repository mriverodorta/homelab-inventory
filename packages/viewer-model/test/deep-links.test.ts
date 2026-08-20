import { describe, expect, it } from 'vitest'

import { parseShareDeepLink } from '../src'

describe('share deep links', () => {
  it('parses item and connection focus', () => {
    expect(parseShareDeepLink('?view=view_canvas_0001&item=item_server_0001')).toEqual({
      viewId: 'view_canvas_0001',
      itemId: 'item_server_0001',
      connectionId: null,
    })
    expect(parseShareDeepLink('?view=view_canvas_0001&connection=connection_uplink_001')).toEqual({
      viewId: 'view_canvas_0001',
      itemId: null,
      connectionId: 'connection_uplink_001',
    })
  })

  it('rejects ambiguous and malformed focus', () => {
    expect(parseShareDeepLink('?view=view_canvas_0001&item=item_server_0001&connection=connection_uplink_001'))
      .toBeNull()
    expect(parseShareDeepLink('?view=../private')).toBeNull()
  })
})
