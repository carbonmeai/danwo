# danwo brand assets

Typeface: Young Serif (SIL Open Font License). The wordmark is already converted to outlines, so the font does not need to be installed.
Colours: black #0A0A0A, white #FFFFFF.

## Which file

- On dark backgrounds: `*-on-dark` (white tile, black mark, white wordmark)
- On light backgrounds: `*-on-light` (black tile, white mark, black wordmark)
- `danwo-glyph-*`: the two squares with no tile, for inline UI
- `favicon.svg`, `favicon.ico`, `png/apple-touch-icon.png`, `png/icon-192.png`, `png/icon-512.png`: browser and app icons
- `png/logomark/rounded/` and `png/logomark/square/`: the logomark on a rounded or square tile, on dark and on light, at 128, 256, 512 and 1024 px; `png/danwo-logomarks.zip` holds the same set as one download

## Web

Copy the files you need into your app's public folder; the paths below assume they sit at its root.

```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" href="/svg/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/png/apple-touch-icon.png" />

<picture>
  <source srcset="/svg/danwo-lockup-horizontal-on-dark.svg" media="(prefers-color-scheme: dark)" />
  <img src="/svg/danwo-lockup-horizontal-on-light.svg" alt="dánwò" height="32" />
</picture>
```
