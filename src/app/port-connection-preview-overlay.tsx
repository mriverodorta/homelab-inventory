import { useEffect, useRef } from 'react'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { ConnectionEndpoint } from '@/types/inventory'

export type PortConnectionPreview = {
  from: ConnectionEndpoint
  origin: CanvasPortDragPoint
  pointer: CanvasPortDragPoint
  mode: 'click' | 'drag'
}

export function PortConnectionPreviewOverlay({ preview }: { preview: PortConnectionPreview }) {
  const lineRef = useRef<SVGLineElement | null>(null)
  const pointerRef = useRef<SVGCircleElement | null>(null)

  useEffect(() => {
    let animationFrame = 0

    const setPointerPosition = (x: number, y: number) => {
      lineRef.current?.setAttribute('x2', String(x))
      lineRef.current?.setAttribute('y2', String(y))
      pointerRef.current?.setAttribute('cx', String(x))
      pointerRef.current?.setAttribute('cy', String(y))
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)

      animationFrame = window.requestAnimationFrame(() => {
        setPointerPosition(event.clientX, event.clientY)
      })
    }

    window.addEventListener('pointermove', handlePointerMove)

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [])

  return (
    <svg className="pointer-events-none fixed inset-0 z-30 h-screen w-screen">
      <line
        ref={lineRef}
        x1={preview.origin.x}
        y1={preview.origin.y}
        x2={preview.pointer.x}
        y2={preview.pointer.y}
        stroke="#ddb668"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="10 8"
      />
      <circle cx={preview.origin.x} cy={preview.origin.y} r="5" fill="#ddb668" />
      <circle
        ref={pointerRef}
        cx={preview.pointer.x}
        cy={preview.pointer.y}
        r="5"
        fill="#fff2c7"
        stroke="#ddb668"
        strokeWidth="3"
      />
    </svg>
  )
}
