import { css } from "@danwo/ui/css"
import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack } from "@danwo/ui/jsx"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@danwo/ui/primitives/sidebar"
import { Span } from "@danwo/ui/primitives/typography"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { useActiveRuns } from "../../live/use-live.ts"
import { BrandImage } from "./brand.tsx"
import { ThemeSwitch } from "./theme-switch.tsx"

/** One section of the dashboard in the sidebar: its icon, its name, and a count when it has one. */
function Section({
  to,
  label,
  icon,
  active,
  badge,
}: {
  readonly to: "/" | "/tests" | "/runs" | "/matrix" | "/insights" | "/impact" | "/settings"
  readonly label: string
  readonly icon: ReactNode
  readonly active: boolean
  readonly badge?: ReactNode
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link to={to}>
          {icon}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {badge === undefined ? null : <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
}

/** A dot and a count on Runs while runs are going, so a live run is never more than a glance away. */
function LiveBadge() {
  const live = useActiveRuns()?.active.length ?? 0

  if (live === 0) return null

  return (
    <HStack gap="1" color="verdict.notJudged.fg" aria-label={`${live} running`}>
      <Span w="1.5" h="1.5" rounded="full" bg="currentColor" />
      {live}
    </HStack>
  )
}

/** The heading link: one row the height of a small button, rounded and tinted on hover. */
const projectLink = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  minW: "0",
  flex: "1",
  h: "8",
  px: "1",
  rounded: "md",
  _hover: { bg: "surface.hover" },
  _focusVisible: { outline: "none", boxShadow: "0 0 0 3px {colors.ring}" },
  "[data-collapsible=icon] &": { flex: "none", px: "0" },
})

/**
 * The sidebar's heading, in one row: the brand's mark on its tile and the project's name beside it,
 * as a workspace sits at the top of an app's sidebar; only the tile when the sidebar is the icon
 * rail.
 */
function ProjectName({ name }: { readonly name: string }) {
  return (
    <Link to="/" aria-label={`The tests of ${name}`} title={name} className={projectLink}>
      <BrandImage kind="mark" height={24} decorative />
      <Span
        fontSize="2"
        fontWeight="600"
        minW="0"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        css={{ "[data-collapsible=icon] &": { display: "none" } }}
      >
        {name}
      </Span>
    </Link>
  )
}

/**
 * The sidebar: the project, the dashboard's sections, and the theme switch. It collapses to a rail
 * of icons (the trigger, the rail on its edge, or Cmd/Ctrl+B), with each section's name as a
 * tooltip there.
 */
export function AppSidebar({ project }: { readonly project: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const on = (prefix: string) => pathname.startsWith(prefix)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <HStack
          gap="2"
          justify="space-between"
          w="full"
          css={{ "[data-collapsible=icon] &": { justifyContent: "center" } }}
        >
          <ProjectName name={project} />
          <SidebarTrigger
            h="7"
            w="7"
            p="0"
            css={{ "[data-collapsible=icon] &": { display: "none" } }}
          />
        </HStack>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu aria-label="Sections">
            <Section to="/" label="Overview" icon={<Icons.home />} active={pathname === "/"} />
            <Section to="/tests" label="Tests" icon={<Icons.checklist />} active={on("/tests")} />
            <Section
              to="/runs"
              label="Runs"
              icon={<Icons.queueList />}
              active={on("/runs") || on("/records")}
              badge={<LiveBadge />}
            />
            <Section to="/matrix" label="Matrix" icon={<Icons.grid />} active={on("/matrix")} />
            <Section
              to="/insights"
              label="Insights"
              icon={<Icons.chartBars />}
              active={on("/insights")}
            />
            <Section
              to="/impact"
              label="Impact"
              icon={<Icons.hierarchy />}
              active={on("/impact")}
            />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup mt="auto">
          <SidebarMenu>
            <Section
              to="/settings"
              label="Settings"
              icon={<Icons.setting />}
              active={on("/settings")}
            />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Box
          display="none"
          css={{ "[data-collapsible=icon] &": { display: "flex", justifyContent: "center" } }}
        >
          <SidebarTrigger h="7" w="7" p="0" />
        </Box>
        <HStack
          justify="space-between"
          px="1"
          css={{ "[data-collapsible=icon] &": { justifyContent: "center", px: "0" } }}
        >
          <Box opacity="0.55" css={{ "[data-collapsible=icon] &": { display: "none" } }}>
            <BrandImage kind="wordmark" height={13} />
          </Box>
          <ThemeSwitch />
        </HStack>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
