import type { ReactNode } from 'react'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

export type InspectorTab = {
  value: string
  label: string
  content: ReactNode
}

export function InspectorTabs({
  tabs,
  defaultValue,
  status,
}: {
  tabs: InspectorTab[]
  defaultValue?: string
  status?: ReactNode
}) {
  if (tabs.length === 0) {
    return null
  }

  return (
    <Tabs defaultValue={defaultValue ?? tabs[0].value} className="min-w-0 gap-4">
      <TabsList
        variant="line"
        className="sticky top-[-1.25rem] z-10 flex !h-auto w-full justify-start gap-2 overflow-x-auto overflow-y-hidden border-b border-[#e5dccf] bg-[#fbf7ef]/95 px-0 py-1 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="!h-9 flex-none rounded-none px-2 text-[11px] font-black uppercase tracking-[0.09em] text-[#75695d] data-active:text-[#20242c]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {status}
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="m-0 min-w-0 space-y-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
