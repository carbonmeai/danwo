/** A provider's logo: one image, or a pair that swaps with the theme. */

/** Where a logo's files are, under `/icons/`. */
export interface LogoFiles {
  readonly src: string
  /** The version for dark surfaces. */
  readonly dark?: string | undefined
}

/** The logo as one or two `<img>`s; decorative unless `alt` is given. */
export function Logo({
  files,
  alt = "",
  className,
}: {
  readonly files: LogoFiles
  readonly alt?: string
  readonly className?: string
}) {
  const classes = (theme: string) => [className, theme].filter(Boolean).join(" ")

  if (!files.dark) return <img src={`/icons/${files.src}`} alt={alt} className={className} />

  return (
    <>
      <img src={`/icons/${files.src}`} alt={alt} className={classes("only-light")} />
      <img src={`/icons/${files.dark}`} alt="" className={classes("only-dark")} />
    </>
  )
}
