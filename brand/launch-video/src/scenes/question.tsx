import { AbsoluteFill } from "remotion"

import { Exit, Words } from "../kit.tsx"
import { C } from "../theme.ts"

/** The one question danwo answers for every change. */
export function Question() {
  return (
    <AbsoluteFill style={{ justifyContent: "center", textAlign: "center" }}>
      <Exit at={100} duration={14}>
        <AbsoluteFill style={{ justifyContent: "center" }}>
          <Words text="What did this change break," start={4} size={104} stagger={4} />
          <Words text="and how sure are we?" start={30} size={104} stagger={4} color={C.muted} />
        </AbsoluteFill>
      </Exit>
    </AbsoluteFill>
  )
}
