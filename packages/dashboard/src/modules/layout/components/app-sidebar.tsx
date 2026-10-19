import { Icons } from "@danwo/ui/icons/base"
import { Box, Flex, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { Mark, Wordmark } from "./brand.tsx"
import { ThemeSwitch } from "./theme-switch.tsx"

/** A sidebar entry: 30px tall, an icon in the muted colour, the current page on a grey fill. */
const NavLink = styled(Link, {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "2",
    h: "30px",
    px: "2",
    rounded: "lg",
    color: "ink.soft",
    "& svg": { color: "ink.muted" },
    _hover: { bg: "surface.hover", color: "ink.strong" },
    "&[data-status=active]": {
      bg: "surface.active",
      color: "ink.strong",
      fontWeight: "500",
      "& svg": { color: "ink.strong" },
    },
  },
})

/** The dashboard's sections, in the order the sidebar lists them. */
function Sections({ direction }: { readonly direction: "row" | "column" }) {
  return (
    <Flex as="nav" aria-label="Sections" direction={direction} gap="1px">
      <NavLink to="/" activeOptions={{ exact: true }}>
        <Icons.queueList size={16} />
        Runs
      </NavLink>
      <NavLink to="/insights">
        <Icons.chartBars size={16} />
        Insights
      </NavLink>
      <NavLink to="/impact">
        <Icons.hierarchy size={16} />
        Impact
      </NavLink>
    </Flex>
  )
}

/** The project's folder name with its initials on a tile, as the sidebar's footer shows it. */
function ProjectChip({ name }: { readonly name: string }) {
  return (
    <HStack gap="2" minW="0" color="ink.soft">
      <Box
        display="inline-grid"
        placeItems="center"
        w="5"
        h="5"
        flexShrink="0"
        rounded="6px"
        bg="surface.active"
        color="ink.soft"
        fontSize="0.625"
        fontWeight="600"
        textTransform="uppercase"
        aria-hidden="true"
      >
        {name.slice(0, 2)}
      </Box>
      <styled.span overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={name}>
        {name}
      </styled.span>
    </HStack>
  )
}

/**
 * The grey sidebar on wide screens: the mark, the sections, and the project with the theme switch.
 * Its column runs the page's full height; the content stays in view as the page scrolls.
 */
export function AppSidebar({ project }: { readonly project: string }) {
  return (
    <Box display={{ base: "none", md: "block" }} bg="surface.sidebar" minW="0">
      <Flex as="aside" direction="column" position="sticky" top="0" h="100vh">
        <HStack h="11" px="3">
          <Link to="/" aria-label="danwo, all runs">
            <Wordmark />
          </Link>
        </HStack>
        <Stack gap="0">
          <styled.span px="4" pt="18px" pb="1.5" color="ink.muted" fontSize="1" fontWeight="500">
            Project
          </styled.span>
          <Box px="2">
            <Sections direction="column" />
          </Box>
        </Stack>
        <HStack mt="auto" h="12" pl="4" pr="2.5" justify="space-between" gap="2">
          <ProjectChip name={project} />
          <ThemeSwitch />
        </HStack>
      </Flex>
    </Box>
  )
}

/** The same sections as a bar across the top, for narrow screens. */
export function MobileBar() {
  return (
    <HStack
      display={{ base: "flex", md: "none" }}
      h="11"
      px="3"
      gap="2"
      bg="surface.sidebar"
      justify="space-between"
      overflowX="auto"
    >
      <Link to="/" aria-label="danwo, all runs">
        <Mark />
      </Link>
      <Box flex="1" minW="0">
        <Sections direction="row" />
      </Box>
      <ThemeSwitch />
    </HStack>
  )
}
