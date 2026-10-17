/** The ARIA roles `getByRole` accepts, so a role an agent typed can be checked before it is used. */
import type { Page } from "playwright-core"

export type AriaRole = Parameters<Page["getByRole"]>[0]

/** WAI-ARIA's roles as Playwright knows them, space-separated. */
const ROLES = new Set(
  `alert alertdialog application article banner blockquote button caption cell checkbox code
  columnheader combobox complementary contentinfo definition deletion dialog directory document
  emphasis feed figure form generic grid gridcell group heading img insertion link list listbox
  listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio
  navigation none note option paragraph presentation progressbar radio radiogroup region row
  rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript
  superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree
  treegrid treeitem`.split(/\s+/),
)

export function isAriaRole(value: string): value is AriaRole {
  return ROLES.has(value)
}
