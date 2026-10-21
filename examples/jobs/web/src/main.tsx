/** The app's frame: the sidebar, and the page the path names. */
import "../../kit/kit.css"
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { DigestList } from "./pages/digest-list.tsx"
import { DigestPage } from "./pages/digest-page.tsx"
import { NewDigest } from "./pages/new-digest.tsx"
import { Link, usePath } from "./router.tsx"

const DIGEST = /^\/digests\/([0-9a-f-]{36})$/

function Page({ path }: { readonly path: string }) {
  if (path === "/digests/new") return <NewDigest />

  const id = DIGEST.exec(path)?.[1]

  return id ? <DigestPage key={id} id={id} /> : <DigestList />
}

function App() {
  const path = usePath()

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <span className="shell-logo" aria-hidden="true">
            N
          </span>
          Northwind Digest
        </div>
        <nav className="shell-nav" aria-label="Main">
          <span className="shell-nav-label">Newsletter</span>
          <Link to="/" aria-current={path === "/" ? "page" : undefined}>
            Digests
          </Link>
          <Link to="/digests/new" aria-current={path === "/digests/new" ? "page" : undefined}>
            New digest
          </Link>
        </nav>
        <p className="shell-sidebar-footer">Tested with danwo</p>
      </aside>
      <div className="shell-main">
        <Page path={path} />
      </div>
    </div>
  )
}

const root = document.getElementById("root")

if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
