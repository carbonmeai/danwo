import { Box, HStack, Stack } from "@danwo/ui/jsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@danwo/ui/primitives/breadcrumb"
import { Heading } from "@danwo/ui/primitives/typography"
import { Fragment, type ReactNode } from "react"

import { CopyLink } from "./copy-link.tsx"

/**
 * The top bar over every page: where the page sits, as a breadcrumb trail ending in the page
 * itself, with a link to copy on the right, under a single hairline.
 */
function TopBar({ crumbs }: { readonly crumbs: readonly ReactNode[] }) {
  return (
    <HStack
      position="sticky"
      top="0"
      zIndex="4"
      h="11"
      px="5"
      gap="1.5"
      bg="surface.page"
      boxShadow="inset 0 -1px 0 {colors.hairline}"
      minW="0"
    >
      <Breadcrumb aria-label="Breadcrumb" minW="0" flex="1">
        <BreadcrumbList fontSize="1.5" flexWrap="nowrap" whiteSpace="nowrap">
          {crumbs.map((crumb, i) => (
            <Fragment key={i}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem minW="0" flexShrink={i === crumbs.length - 1 ? "1" : "0"}>
                {i === crumbs.length - 1 ? (
                  <BreadcrumbPage fontWeight="600" overflow="hidden" textOverflow="ellipsis">
                    {crumb}
                  </BreadcrumbPage>
                ) : (
                  crumb
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <CopyLink />
    </HStack>
  )
}

/**
 * A page: the top bar, then the page's title, what it is about and any actions on its right, and
 * the content beneath, using the window's width up to a wide screen's.
 */
export function Page({
  crumbs,
  title,
  detail,
  actions,
  children,
}: {
  readonly crumbs: readonly ReactNode[]
  readonly title: ReactNode
  readonly detail?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <>
      <TopBar crumbs={crumbs} />
      <Box maxW="1600px" mx="auto" px={{ base: "4", md: "8" }} pt="8" pb="24" w="full" minW="0">
        <HStack alignItems="flex-start" gap="4" mb="6" flexWrap="wrap">
          <Stack gap="1" minW="0" flex="1">
            <Heading
              as="h1"
              fontSize="17px"
              fontWeight="600"
              lineHeight="1.35"
              overflowWrap="anywhere"
            >
              {title}
            </Heading>
            {detail === undefined ? null : (
              <Box color="ink.muted" fontSize="13.5px">
                {detail}
              </Box>
            )}
          </Stack>
          {actions === undefined ? null : (
            <HStack gap="2" flexShrink="0" flexWrap="wrap">
              {actions}
            </HStack>
          )}
        </HStack>
        {children}
      </Box>
    </>
  )
}
