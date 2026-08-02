import type { ReactNode } from 'react'
import { Boxes } from 'lucide-react'

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f1ea] p-4 text-[#20242c]">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-[#d9d1c4] bg-[#fffdf9] shadow-xl shadow-black/5">
        <header className="border-b border-[#e2dbcf] p-6">
          <div className="mb-5 grid size-11 place-items-center rounded-md bg-[#20242c] text-white"><Boxes className="size-5" /></div>
          <h1 className="text-2xl font-black">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[#746b61]">{description}</p>
        </header>
        <div className="p-6">{children}</div>
      </section>
    </main>
  )
}
