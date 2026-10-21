# The examples' kit

The look every example app shares: a calm, dense product UI with a sidebar, cards, forms and
tables, in light and dark. It is plain CSS, so it works in any framework, and each example carries
its own copy so it still works when you copy the folder out of this repository.

| File           | What it holds                                                                       |
| -------------- | ----------------------------------------------------------------------------------- |
| `kit.css`      | The tokens (`--kit-*` variables), a small reset, and the class components below     |
| `tailwind.css` | The same tokens as a Tailwind v4 `@theme`, for examples styled with utility classes |
| `sync.ts`      | Copies both files into each example's `kit/` folder                                 |

## Plain CSS or Tailwind

Both look the same, because the Tailwind theme only points at the kit's variables.

- **Plain CSS:** import `kit/kit.css` and use the classes. Pick this for frameworks that don't ship
  Tailwind by default (Astro, SvelteKit, Nuxt, a bare Vite app), or when the example has little
  layout of its own.
- **Tailwind:** import Tailwind, then `kit/kit.css`, then `kit/tailwind.css`. Use the kit's
  classes for components (`card`, `btn`, `input`) and utilities for layout (`grid gap-4`,
  `md:grid-cols-2`). Pick this where Tailwind is what the framework's users expect, as in Next.js.

```css
/* app/globals.css in a Tailwind example */
@import "tailwindcss";
@import "../kit/kit.css";
@import "../kit/tailwind.css";
```

The kit's rules sit in the `base` and `components` layers, so an example's own CSS and Tailwind's
utilities always win over them.

## Tokens

| Group  | Variables                                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour | `--kit-bg`, `--kit-surface`, `--kit-fg`, `--kit-fg-muted`, `--kit-border`, `--kit-primary`, and `--kit-danger`, `--kit-success`, `--kit-warning`, `--kit-info` with their `-bg` and `-border` |
| Type   | `--kit-font-sans`, `--kit-font-mono`, `--kit-text-xs` to `--kit-text-3xl` (body is 14px)                                                                                                      |
| Space  | `--kit-space-1` to `--kit-space-12`, 4px apart                                                                                                                                                |
| Radius | `--kit-radius-sm` to `--kit-radius-2xl`, and `--kit-radius-full`                                                                                                                              |
| Layout | `--kit-sidebar-width`, `--kit-topbar-height`, `--kit-content-width`                                                                                                                           |

With Tailwind the same values are `bg-surface`, `text-muted`, `border-border`, `rounded-xl`,
`text-sm` and so on.

The theme follows the system. Set `data-theme="light"` or `data-theme="dark"` on `<html>` to pin
it; Tailwind's `dark:` variant follows the same rule.

## Components

| Class                                                                                               | What it is                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `shell`, `shell-sidebar`, `shell-brand`, `shell-nav`, `shell-main`, `shell-topbar`, `shell-content` | The app frame: a sidebar, a top bar and the page beside them      |
| `breadcrumb`, `page-header`, `page-title`, `page-description`                                       | Where a page is, and its title                                    |
| `card`, `card-header`, `card-title`, `card-description`, `card-body`, `card-footer`                 | A bordered panel                                                  |
| `btn` with `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `btn-sm`, `btn-lg`            | Buttons; `aria-busy="true"` shows a spinner                       |
| `field`, `label`, `input`, `hint`, `error`                                                          | A form field; `aria-invalid="true"` marks the input in red        |
| `table-wrap`, `table`                                                                               | A table with a rounded border; `num` right-aligns a cell          |
| `badge` with `badge-success`, `badge-warning`, `badge-danger`, `badge-info`                         | A small status label                                              |
| `toast` with `toast-success`, `toast-error`, `toast-floating`                                       | A message after an action, inline or pinned to the corner         |
| `empty`, `empty-icon`, `empty-title`, `empty-text`                                                  | What to show when there is nothing yet                            |
| `stepper`                                                                                           | An `<ol>` of steps; `aria-current="step"` and `is-done` mark them |
| `stat`, `stat-label`, `stat-value`                                                                  | A number with its label                                           |
| `stack`, `row`, `muted`                                                                             | Small layout helpers                                              |

```html
<section class="card">
  <div class="card-header">
    <h2 class="card-title">Request an invite</h2>
  </div>
  <form class="card-body stack">
    <div class="field">
      <label class="label" for="email">Work email</label>
      <input id="email" class="input" type="email" />
    </div>
    <button class="btn btn-primary">Join the waitlist</button>
  </form>
</section>
```

## Changing the kit

Edit `kit.css` or `tailwind.css` here, never an example's copy, then copy it into every example:

```sh
node examples/_kit/sync.ts
```

A new example gets its first copy with `node examples/_kit/sync.ts with-vite`. A unit test
(`scripts/test/examples.test.ts`) fails while any copy differs from the kit.
