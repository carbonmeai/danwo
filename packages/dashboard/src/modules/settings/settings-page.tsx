import { Grid, Stack, styled } from "@danwo/ui/jsx"
import { Kbd } from "@danwo/ui/primitives/kbd"
import type { ReactNode } from "react"

import { Ident } from "../../components/code.tsx"
import { Page } from "../../components/page.tsx"
import { Section } from "../../components/panel.tsx"
import { Bone } from "../../components/skeleton.tsx"
import type { ProjectSettings } from "./settings-data.ts"

/** One fact as a label and its value. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <styled.dt color="ink.muted">{label}</styled.dt>
      <styled.dd overflowWrap="anywhere">{children}</styled.dd>
    </>
  )
}

const KEYS: readonly (readonly [string, string])[] = [
  ["⌘ B", "Collapse or expand the sidebar"],
  ["j  k", "Move through a list"],
  ["/", "Jump to a list's filter"],
  ["Enter", "Open the row picked"],
  ["Esc", "Close a recording open over the page"],
]

/** Facts as a list of labels and their values. */
function Facts({ children }: { readonly children: ReactNode }) {
  return (
    <Grid as="dl" gridTemplateColumns="12rem minmax(0, 1fr)" rowGap="2" columnGap="4">
      {children}
    </Grid>
  )
}

/** The keys the dashboard answers to; they need nothing loaded. */
function Keyboard() {
  return (
    <Section title="Keyboard">
      <Facts>
        {KEYS.map(([keys, does]) => (
          <Fact key={keys} label={does}>
            <Kbd>{keys}</Kbd>
          </Fact>
        ))}
      </Facts>
    </Section>
  )
}

/** What the page is, under its title. */
const DETAIL =
  "danwo is set up in code, in the project's config file; this page shows what the dashboard reads."

/** The project's facts, each value given as what to show: the loaded one, or a bone. */
function ProjectFacts({
  root,
  config,
  runsKept,
  keepRuns,
  historyKept,
}: {
  readonly root: ReactNode
  readonly config: ReactNode
  readonly runsKept: ReactNode
  readonly keepRuns: ReactNode
  readonly historyKept: ReactNode
}) {
  return (
    <Section title="Project">
      <Facts>
        <Fact label="Folder">{root}</Fact>
        <Fact label="Config file">{config}</Fact>
        <Fact label="Recordings kept">
          {runsKept} runs in <Ident>.danwo/runs</Ident>; the latest {keepRuns} keep theirs (
          <Ident>record.keepRuns</Ident>)
        </Fact>
        <Fact label="History kept">
          {historyKept} runs in <Ident>.danwo/history</Ident>; the latest 200 are kept
        </Fact>
        <Fact label="Feedback">
          Votes on recordings go to <Ident>.danwo/feedback.jsonl</Ident>, on this machine only
        </Fact>
      </Facts>
    </Section>
  )
}

/** {@link SettingsPage} while the project's facts load: the facts' words, their values as bones. */
export function SettingsSkeleton() {
  const count = <Bone inline w="1.5rem" />

  return (
    <Page crumbs={["Settings"]} title="Settings" detail={DETAIL} loading="Loading the settings">
      <Stack gap="2" maxW="56rem">
        <ProjectFacts
          root={<Bone w="20rem" />}
          config={<Bone w="8rem" />}
          runsKept={count}
          keepRuns={count}
          historyKept={count}
        />
        <Keyboard />
      </Stack>
    </Page>
  )
}

/**
 * The project as the dashboard reads it: where it is, which config file sets it up, and what its
 * `.danwo` folder keeps. Read only; danwo is set up in its config file.
 */
export function SettingsPage({ settings }: { readonly settings: ProjectSettings }) {
  return (
    <Page crumbs={["Settings"]} title="Settings" detail={DETAIL}>
      <Stack gap="2" maxW="56rem">
        <ProjectFacts
          root={<Ident>{settings.root}</Ident>}
          config={
            settings.config ? (
              <Ident>{settings.config}</Ident>
            ) : (
              <>
                None found. <Ident>danwo init</Ident> writes one.
              </>
            )
          }
          runsKept={settings.runsKept}
          keepRuns={settings.keepRuns}
          historyKept={settings.historyKept}
        />
        <Keyboard />
      </Stack>
    </Page>
  )
}
