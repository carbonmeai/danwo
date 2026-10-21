/** The bar over a page: where it is, and which model answers. */
export function Topbar({ page }: { readonly page: string }) {
  return (
    <header className="shell-topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Support</span>
        <span aria-current="page">{page}</span>
      </nav>
      <span className="badge badge-info">AI assistant</span>
    </header>
  )
}
