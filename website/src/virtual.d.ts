/** Modules the website's Vite plugin generates at build time. */

declare module "virtual:danwo/code-samples" {
  /** The example shop's test and config, highlighted, one per code tab. */
  const samples: readonly { readonly label: string; readonly html: string }[]

  export default samples
}
