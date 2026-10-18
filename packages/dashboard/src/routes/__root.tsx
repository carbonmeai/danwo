import { Box, Flex, HStack, styled } from "@danwo/ui/jsx"
import { ThemeProvider, useTheme } from "@danwo/ui/primitives/theme"
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { FAVICON, Wordmark } from "../components/brand.tsx"
import { Empty } from "../components/status.tsx"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "danwo" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: FAVICON },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <Empty title="Nothing at this address" hint={<Link to="/">Back to the runs</Link>} />
  ),
})

const NavLink = styled(Link, {
  base: {
    color: "signal.quiet",
    fontSize: "1.5",
    fontWeight: "500",
    px: "3",
    h: "8",
    display: "inline-flex",
    alignItems: "center",
    rounded: "md",
    _hover: { color: "signal.ink", bg: "signal.raised" },
    "&[data-status=active]": { color: "signal.ink", bg: "signal.raised" },
  },
})

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  )
}

/** Switches between the light and dark themes. */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <styled.button
      type="button"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      w="8"
      h="8"
      rounded="md"
      color="signal.quiet"
      cursor="pointer"
      _hover={{ color: "signal.ink", bg: "signal.raised" }}
      onClick={() => setTheme(next)}
      aria-label={`Use the ${next} theme`}
      title={`Use the ${next} theme`}
    >
      {next === "dark" ? <MoonIcon /> : <SunIcon />}
    </styled.button>
  )
}

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <Flex direction="column" minH="100vh" bg="signal.ground" color="signal.ink">
      <styled.a
        href="#main"
        position="absolute"
        left="-9999px"
        _focus={{
          left: "4",
          top: "3",
          zIndex: "10",
          bg: "signal.panel",
          px: "3",
          py: "1.5",
          rounded: "md",
        }}
      >
        Skip to content
      </styled.a>
      <Box
        as="header"
        bg="signal.panel"
        borderBottomWidth="1px"
        borderColor="signal.rule"
        position="sticky"
        top="0"
        zIndex="5"
      >
        <HStack justify="space-between" px="6" h="14" maxW="80rem" mx="auto">
          <HStack gap="8">
            <Link to="/" aria-label="danwo, all runs">
              <Wordmark />
            </Link>
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
      </Box>
      <Box as="main" id="main" flex="1" px="6" pt="8" pb="16" maxW="80rem" w="full" mx="auto">
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
