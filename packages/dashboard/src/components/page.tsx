import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Fragment, type ReactNode } from "react"

import { CopyLink } from "./copy-link.tsx"

/**
 * The top bar over every page: where the page sits, as a breadcrumb trail ending in the page
 * itself, with a link to copy on the right, under a single hairline.
 */
function TopBar({ crumbs }: { readonly crumbs: readonly ReactNode[] }) {
  return (
    <HStack
      as="nav"
      aria-label="Breadcrumb"
      position="sticky"
      top="0"
      zIndex="4"
      h="11"
      px="5"
      gap="1.5"
      bg="surface.page"
      color="ink.muted"
      boxShadow="inset 0 -1px 0 {colors.hairline}"
      whiteSpace="nowrap"
      minW="0"
      css={{ "& a": { rounded: "md", _hover: { color: "ink.strong" } } }}
    >
      {crumbs.map((crumb, i) => (
        <Fragment key={i}>
          {i > 0 ? <Icons.caretRight size={14} color="ink.faint" flexShrink="0" /> : null}
          {i === crumbs.length - 1 ? (
            <styled.span
              color="ink.strong"
              fontWeight="600"
              overflow="hidden"
              textOverflow="ellipsis"
              aria-current="page"
            >
              {crumb}
            </styled.span>
          ) : (
            <styled.span flexShrink="0">{crumb}</styled.span>
          )}
        </Fragment>
      ))}
      <Box flex="1" />
      <CopyLink />
    </HStack>
  )
}

/**
 * A page: the top bar, then a centred column with the page's title, what it is about and any
 * actions on its right, and the content beneath.
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
      <Box maxW="1120px" mx="auto" px={{ base: "4", md: "6" }} pt="10" pb="24">
        <HStack alignItems="flex-start" gap="4" mb="6" flexWrap="wrap">
          <Stack gap="1" minW="0" flex="1">
            <styled.h1 fontSize="17px" fontWeight="600" lineHeight="1.35" overflowWrap="anywhere">
              {title}
            </styled.h1>
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
