import { Box, Flex, HStack, styled } from "@danwo/ui/jsx"
import { ThemeProvider, useTheme } from "@danwo/ui/primitives/theme"
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "danwo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <Box p="8" color="text.secondary">
      Nothing here.
    </Box>
  ),
})

const NavLink = styled(Link, {
  base: {
    color: "text.secondary",
    fontSize: "1",
    px: "2",
    py: "1",
    rounded: "md",
    _hover: { color: "text.primary" },
    "&[data-status=active]": { color: "text.primary", bg: "background.muted" },
  },
})

/** Switches between the light and dark themes. */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <styled.button
      type="button"
      fontSize="1"
      color="text.secondary"
      cursor="pointer"
      onClick={() => setTheme(next)}
      aria-label={`Use the ${next} theme`}
    >
      {next === "dark" ? "Dark" : "Light"}
    </styled.button>
  )
}

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <Flex direction="column" minH="100vh" bg="background.app" color="text.primary">
      <HStack
        as="header"
        justify="space-between"
        px="6"
        py="3"
        borderBottomWidth="1px"
        borderColor="border.subtle"
      >
        <HStack gap="4">
          <styled.span fontWeight="semibold">danwo</styled.span>
          <HStack as="nav" gap="1" aria-label="Sections">
            <NavLink to="/" activeOptions={{ exact: true }}>
              Runs
            </NavLink>
            <NavLink to="/insights">Insights</NavLink>
            <NavLink to="/impact">Impact</NavLink>
          </HStack>
        </HStack>
        <ThemeSwitch />
      </HStack>
      <Box as="main" flex="1" px="6" py="6" maxW="80rem" w="full" mx="auto">
        {children}
      </Box>
    </Flex>
  )
}

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Shell>
            <Outlet />
          </Shell>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
