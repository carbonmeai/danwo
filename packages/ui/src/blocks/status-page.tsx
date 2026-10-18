import { Box, Flex, HStack, styled } from "@danwo/ui/jsx"
import { Link, useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Illustrations } from "../illustrations"
import { Button } from "../primitives/button"

/**
 * A whole-page state centred in whatever area it fills: a large faded code behind a line illustration, a title, a
 * line of detail and the way out. The not-found and error pages are both built from it, so every dead end in the
 * app looks the same.
 */
const StatusPage = ({
  code,
  illustration,
  title,
  detail,
  children,
}: {
  code: string
  illustration: ReactNode
  title: string
  detail: string
  children: ReactNode
}) => (
  <Flex
    role="alert"
    direction="column"
    align="center"
    justify="center"
    textAlign="center"
    gap="5"
    flex="1"
    w="full"
    minH="full"
    py="16"
    px="6"
    data-status-page={code}
  >
    <Box position="relative" display="grid" placeItems="center">
      <styled.span
        aria-hidden
        position="absolute"
        fontSize="12"
        fontWeight="700"
        lineHeight="1"
        letterSpacing="-0.04em"
        color="brand.panel.4"
        userSelect="none"
      >
        {code}
      </styled.span>
      <Flex
        position="relative"
        align="center"
        justify="center"
        w="7.5rem"
        h="7.5rem"
        rounded="2xl"
        bg="brand.panel.3"
        // A slight tilt keeps the dead end light-hearted.
        transform="rotate(-6deg)"
      >
        {illustration}
      </Flex>
    </Box>
    <Flex direction="column" align="center" gap="1.5" maxW="26rem">
      <styled.h1 fontSize="3" fontWeight="600" textWrap="balance">
        {title}
      </styled.h1>
      <styled.p fontSize="1.5" color="text.muted" textWrap="pretty">
        {detail}
      </styled.p>
    </Flex>
    <HStack gap="2" flexWrap="wrap" justify="center">
      {children}
    </HStack>
  </Flex>
)

/** Where a dead end sends the member: Home unless the page knows a better parent. */
type Way = { label: string; to: string; search?: Record<string, string> }

export const NotFoundPage = ({
  title = "This page wandered off",
  detail = "We looked under every table and inside every collection, but nothing lives at this address. It may have been moved or deleted.",
  back = { label: "Back to Home", to: "/" },
}: {
  title?: string
  detail?: string
  back?: Way
}) => (
  <StatusPage code="404" illustration={<Illustrations.search />} title={title} detail={detail}>
    <Link to={back.to} search={back.search}>
      <Button>{back.label}</Button>
    </Link>
  </StatusPage>
)

/**
 * The router's error boundary: a render or loader failure lands here instead of a blank or crashed page. Try again
 * resets the boundary and reloads the route's data; the message itself shows only in development.
 */
export const ErrorPage = ({ error, reset }: { error: unknown; reset?: () => void }) => {
  const router = useRouter()
  const message = error instanceof Error ? error.message : null

  return (
    <StatusPage
      code="500"
      illustration={<Illustrations.unplugged />}
      title="Something came unplugged"
      detail="It's not you, it's us. Try again, and if it keeps happening, head home and come back in a moment."
    >
      <Button
        onClick={() => {
          reset?.()
          void router.invalidate()
        }}
      >
        Try again
      </Button>
      <Link to="/">
        <Button variant="soft">Back to Home</Button>
      </Link>
      {import.meta.env.DEV && message && (
        <styled.code
          display="block"
          w="full"
          mt="2"
          px="3"
          py="2"
          rounded="lg"
          bg="brand.panel.3"
          color="text.muted"
          fontFamily="mono"
          fontSize="1"
          textAlign="left"
          maxW="32rem"
          overflowX="auto"
          whiteSpace="pre-wrap"
        >
          {message}
        </styled.code>
      )}
    </StatusPage>
  )
}
