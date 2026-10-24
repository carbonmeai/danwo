/** SvelteKit's app-wide types: the error a page shows carries its message only. */
declare global {
  namespace App {
    interface Error {
      message: string
    }
  }
}

export {}
