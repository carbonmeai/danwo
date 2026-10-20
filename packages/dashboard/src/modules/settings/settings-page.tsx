import { Grid, Stack, styled } from "@danwo/ui/jsx"
import { Kbd } from "@danwo/ui/primitives/kbd"
import type { ReactNode } from "react"

import { Ident } from "../../components/code.tsx"
import { Page } from "../../components/page.tsx"
import { Section } from "../../components/panel.tsx"
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

/**
 * The project as the dashboard reads it: where it is, which config file sets it up, and what its
 * `.danwo` folder keeps. Read only; danwo is set up in its config file.
 */
export function SettingsPage({ settings }: { readonly settings: ProjectSettings }) {
  return (
    <Page
      crumbs={["Settings"]}
      title="Settings"
      detail="danwo is set up in code, in the project's config file; this page shows what the dashboard reads."
    >
      <Stack gap="2" maxW="56rem">
        <Section title="Project">
          <Grid as="dl" gridTemplateColumns="12rem minmax(0, 1fr)" rowGap="2" columnGap="4">
            <Fact label="Folder">
              <Ident>{settings.root}</Ident>
            </Fact>
            <Fact label="Config file">
              {settings.config ? (
                <Ident>{settings.config}</Ident>
              ) : (
                <>
                  None found. <Ident>danwo init</Ident> writes one.
                </>
              )}
            </Fact>
            <Fact label="Recordings kept">
              {settings.runsKept} runs in <Ident>.danwo/runs</Ident>; the latest {settings.keepRuns}{" "}
              keep theirs (<Ident>record.keepRuns</Ident>)
            </Fact>
            <Fact label="History kept">
              {settings.historyKept} runs in <Ident>.danwo/history</Ident>; the latest 200 are kept
            </Fact>
            <Fact label="Feedback">
              Votes on recordings go to <Ident>.danwo/feedback.jsonl</Ident>, on this machine only
            </Fact>
          </Grid>
        </Section>
        <Section title="Keyboard">
          <Grid as="dl" gridTemplateColumns="12rem minmax(0, 1fr)" rowGap="2" columnGap="4">
            {KEYS.map(([keys, does]) => (
              <Fact key={keys} label={does}>
                <Kbd>{keys}</Kbd>
              </Fact>
            ))}
          </Grid>
        </Section>
      </Stack>
    </Page>
  )
}
