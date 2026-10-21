# README hero

The banner at the top of the repository's README: `hero-dark.png` and `hero-light.png`, 1600×800
(an 800×400 page at 2×). The README picks one with `prefers-color-scheme`.

Every tile on the right is a screenshot of danwo's own UI, made fresh from `examples/shop`:

- the fault grid and the failed trial from a `danwo matrix` run, with the shop's planted
  duplicate-webhook bug (`SHOP_BUG=no-dedupe`) turned on;
- the failed trial's steps and verdict, the clean run's replay, its provider waterfall and calls;
- the overview's figures and the matrix verdict card;
- the pull request comment `packages/github` writes for that matrix run, in GitHub's style;
- the run's `danwo matrix` output as a terminal shows it.

## Regenerate

From the repository root, after `bun install`:

```sh
bun run readme-hero
```

It takes about a minute. It copies the shop to a temporary folder, runs `danwo test` and the matrix
there, serves the dashboard on a free port, captures the tiles in both colour schemes, renders
`hero.html` with them and writes the two PNGs here. It stops the dashboard and deletes the copy when
it is done. If `oxipng` is installed, it shrinks the PNGs too.

To change only the layout or the text, edit `hero.html` and compose from the tiles of the last
run:

```sh
bun run readme-hero --reuse
```

| File        | What it is                                                      |
| ----------- | --------------------------------------------------------------- |
| `hero.html` | The banner page: the left panel, and the wall of tilted tiles   |
| `tiles.css` | The styles of the two tiles drawn as HTML: PR comment, terminal |
| `render.ts` | Makes the runs, captures the tiles and renders the PNGs         |

The text is set in Inter and Geist Mono from `packages/dashboard/public/fonts`, the same files
the website uses. The lockup is `brand/svg/danwo-lockup-horizontal-on-dark.svg` on the dark banner
and `-on-light.svg` on the light one.
