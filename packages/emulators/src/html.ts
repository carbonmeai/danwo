const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Text made safe to put in HTML, inside elements or quoted attributes. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)

/** A hosted page: the document shell around `body`, styled with `style`. */
export function htmlPage(title: string, style: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${style}</style></head>
<body><main>${body}</main></body>
</html>`
}
