import { Box, Grid, styled } from "@danwo/ui/jsx"
import type { ReactNode } from "react"

import { AppSidebar, MobileBar } from "./app-sidebar.tsx"

/** The app: the grey sidebar on the left, and the white page that scrolls beside it. */
export function AppShell({
  project,
  children,
}: {
  readonly project: string
  readonly children: ReactNode
}) {
  return (
    <Grid
      gridTemplateColumns={{ base: "minmax(0, 1fr)", md: "220px minmax(0, 1fr)" }}
      gap="0"
      minH="100vh"
      bg="surface.page"
      color="ink.strong"
    >
      <styled.a
        href="#main"
        position="absolute"
        left="-9999px"
        _focus={{
          left: "4",
          top: "2",
          zIndex: "10",
          bg: "surface.pop",
          boxShadow: "pop",
          px: "3",
          py: "1.5",
          rounded: "lg",
        }}
      >
        Skip to content
      </styled.a>
      <AppSidebar project={project} />
      <Box minW="0">
        <MobileBar />
        <Box as="main" id="main">
          {children}
        </Box>
      </Box>
    </Grid>
  )
}
