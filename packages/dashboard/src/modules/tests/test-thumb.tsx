import { Icons } from "@danwo/ui/icons/base"
import { Box, styled } from "@danwo/ui/jsx"

import { useScreenshot } from "../record/use-screenshot.ts"
import type { Thumb } from "./tests-data.ts"

const FRAME = { w: "24", h: "14", rounded: "md", overflow: "hidden", flexShrink: "0" } as const

/** A screenshot thumbnail, fetched once its row scrolls near the screen. */
function Still({ dir, file }: { readonly dir: string; readonly file: string }) {
  const { src, ref } = useScreenshot(dir, file, true)

  return (
    <Box ref={ref} {...FRAME} bg="surface.track">
      {src ? <styled.img src={src} alt="" w="full" h="full" objectFit="cover" /> : null}
    </Box>
  )
}

/** A picture of a test's latest kept recording: a frame of its video, else a screenshot. */
export function TestThumb({ thumb }: { readonly thumb: Thumb | undefined }) {
  if (thumb?.video)
    return (
      <Box {...FRAME} bg="surface.track">
        <styled.video
          src={`${thumb.video}#t=1`}
          preload="metadata"
          muted
          playsInline
          aria-hidden="true"
          w="full"
          h="full"
          objectFit="cover"
        />
      </Box>
    )

  if (thumb?.screenshot) return <Still dir={thumb.dir} file={thumb.screenshot} />

  return (
    <Box
      {...FRAME}
      display="grid"
      placeItems="center"
      bg="surface.panel"
      color="ink.faint"
      title="No recording kept yet"
    >
      <Icons.galleryVertical size={16} />
    </Box>
  )
}
