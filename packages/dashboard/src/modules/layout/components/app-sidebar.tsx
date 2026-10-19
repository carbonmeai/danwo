import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, styled } from "@danwo/ui/jsx"
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
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { useActiveRuns } from "../../live/use-live.ts"
import { Mark } from "./brand.tsx"
import { ThemeSwitch } from "./theme-switch.tsx"

/** One section of the dashboard in the sidebar: its icon, its name, and a count when it has one. */
function Section({
  to,
  label,
  icon,
  active,
  badge,
}: {
  readonly to: "/" | "/runs" | "/insights" | "/impact"
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
      <styled.span w="1.5" h="1.5" rounded="full" bg="currentColor" />
      {live}
    </HStack>
  )
}

/** The project the dashboard reads, as the sidebar's heading: danwo's mark and the folder's name. */
function ProjectName({ name }: { readonly name: string }) {
  return (
    <Link to="/" aria-label={`danwo, the tests of ${name}`}>
      <HStack gap="2" minW="0" h="8" px="1">
        <Box flexShrink="0" display="inline-flex">
          <Mark />
        </Box>
        <styled.span
          fontWeight="600"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          title={name}
          css={{ "[data-collapsible=icon] &": { display: "none" } }}
        >
          {name}
        </styled.span>
      </HStack>
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
  const onTests =
    pathname === "/" || pathname.startsWith("/tests") || pathname.startsWith("/records")

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
            <Section to="/" label="Tests" icon={<Icons.checklist />} active={onTests} />
            <Section
              to="/runs"
              label="Runs"
              icon={<Icons.queueList />}
              active={pathname.startsWith("/runs")}
              badge={<LiveBadge />}
            />
            <Section
              to="/insights"
              label="Insights"
              icon={<Icons.chartBars />}
              active={pathname.startsWith("/insights")}
            />
            <Section
              to="/impact"
              label="Impact"
              icon={<Icons.hierarchy />}
              active={pathname.startsWith("/impact")}
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
          <styled.span
            color="ink.muted"
            fontSize="1"
            css={{ "[data-collapsible=icon] &": { display: "none" } }}
          >
            Theme
          </styled.span>
          <ThemeSwitch />
        </HStack>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
