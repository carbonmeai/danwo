import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from "remotion"

import { CopyProvider, EN, ZH } from "./copy.ts"
import { Backdrop, clamp } from "./kit.tsx"
import { Agents } from "./scenes/agents.tsx"
import { Drive } from "./scenes/drive.tsx"
import { Emulate } from "./scenes/emulate.tsx"
import { Explain } from "./scenes/explain.tsx"
import { Hook } from "./scenes/hook.tsx"
import { Matrix } from "./scenes/matrix.tsx"
import { Outro } from "./scenes/outro.tsx"
import { Proof } from "./scenes/proof.tsx"
import { Question } from "./scenes/question.tsx"
import { Reveal } from "./scenes/reveal.tsx"

/**
 * The scenes in order, by the frame each starts on. The music builds quietly for 16 seconds and
 * drops at frame 480, where the reveal lands the mark; it fades from 40 seconds under the end card.
 */
const SCENES = [
  { from: 0, to: 138, Scene: Hook },
  { from: 138, to: 285, Scene: Proof },
  { from: 285, to: 400, Scene: Question },
  { from: 400, to: 585, Scene: Reveal },
  { from: 585, to: 735, Scene: Drive },
  { from: 735, to: 900, Scene: Emulate },
  { from: 900, to: 1065, Scene: Matrix },
  { from: 1065, to: 1155, Scene: Explain },
  { from: 1155, to: 1290, Scene: Agents },
  { from: 1290, to: 1440, Scene: Outro },
] as const

export const DURATION = 1440

/** danwo's launch film: the problem, the reveal on the drop, five features and the end card. */
export function Launch({ lang }: { readonly lang: "en" | "zh" }) {
  return (
    <CopyProvider value={lang === "zh" ? ZH : EN}>
      <AbsoluteFill style={{ background: "#0a0a0a" }}>
        <Backdrop />
        <Audio
          src={staticFile("audio/music.mp3")}
          volume={(f) =>
            interpolate(f, [0, 12, DURATION - 30, DURATION], [0, 0.85, 0.85, 0], clamp)
          }
        />
        {SCENES.map(({ from, to, Scene }) => (
          <Sequence key={from} from={from} durationInFrames={to - from}>
            <Scene />
          </Sequence>
        ))}
      </AbsoluteFill>
    </CopyProvider>
  )
}
