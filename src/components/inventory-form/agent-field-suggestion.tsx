import { useState } from 'react'
import { ScanSearch } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function AgentFieldSuggestionButton({
  label,
  currentValue,
  detectedValue,
  sourceLocator,
  onApply,
}: {
  label: string
  currentValue: string
  detectedValue: unknown
  sourceLocator: string
  onApply: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const detected = displayValue(detectedValue)
  const replacesValue = currentValue.trim() !== '' && currentValue.trim() !== detected.trim()

  function requestApply() {
    if (replacesValue) {
      setConfirming(true)
      return
    }
    onApply()
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-[#2f7668] hover:bg-[#d3eee7] hover:text-[#143733]"
              aria-label={`Use detected ${label}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                requestApply()
              }}
            >
              <ScanSearch />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Use detected value from {sourceLocator}: {detected}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace {label.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              The current value “{currentValue}” will be replaced with “{detected}”, detected from {sourceLocator}. You can undo this change from the workspace history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current value</AlertDialogCancel>
            <AlertDialogAction onClick={onApply}>Use detected value</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
