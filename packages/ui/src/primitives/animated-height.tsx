import type React from "react"
import { useEffect, useRef, useState } from "react"

import { MotionDiv } from "./framer"

type AnimateChangeInHeightProps = {
  children: React.ReactNode
  className?: string
  duration?: number
}

export const AnimateChangeInHeight: React.FC<AnimateChangeInHeightProps> = ({
  children,
  className = "",
  duration = 0.2,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | "auto">("auto")

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        // We only have one entry, so we can use entries[0].
        const observedHeight = entries[0]?.contentRect.height ?? "auto"

        setHeight(observedHeight)
      })

      resizeObserver.observe(containerRef.current)

      return () => {
        // Cleanup the observer when the component is unmounted
        resizeObserver.disconnect()
      }
    }
  }, [])

  return (
    <MotionDiv
      animate={{ height }}
      className={className}
      style={{ height, overflow: "hidden" }}
      transition={{ duration }}
    >
      <div ref={containerRef}>{children}</div>
    </MotionDiv>
  )
}
