import { AbsoluteFill } from "remotion"

import { useCopy } from "../copy.ts"
import { Exit, Words } from "../kit.tsx"
import { C } from "../theme.ts"

/** The one question danwo answers for every change. */
export function Question() {
  const [broke, sure] = useCopy().question

  return (
    <AbsoluteFill style={{ justifyContent: "center", textAlign: "center" }}>
      <Exit at={100} duration={14}>
        <AbsoluteFill style={{ justifyContent: "center" }}>
          <Words text={broke.text} start={4} size={104} stagger={4} />
          <Words text={sure.text} start={30} size={104} stagger={4} color={C.muted} />
        </AbsoluteFill>
      </Exit>
    </AbsoluteFill>
  )
}
