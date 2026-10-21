/** The bar over a page: where it is, and the page's own actions. */
export function Topbar({ page }: { readonly page: string }) {
  return (
    <header className="shell-topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Lumen</span>
        <span aria-current="page">{page}</span>
      </nav>
      <span className="badge badge-success">Beta</span>
    </header>
  )
}
