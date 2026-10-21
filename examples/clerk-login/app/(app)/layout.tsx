import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"
import type { ReactNode } from "react"

import { Logo } from "../logo.tsx"
import { Nav } from "./nav.tsx"

/**
 * The signed-in app: a sidebar with the pages, and a top bar with Clerk's organization switcher
 * and user menu (which signs out).
 */
export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <Logo />
        <Nav />
        <p className="shell-sidebar-footer">Tested with danwo</p>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <OrganizationSwitcher
            hidePersonal={false}
            afterCreateOrganizationUrl="/organization"
            afterSelectOrganizationUrl="/organization"
          />
          <UserButton />
        </header>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  )
}
