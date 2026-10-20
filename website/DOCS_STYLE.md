# Writing danwo's docs

The website's docs are written for people. They are hand-written MDX in `content/docs/`. The
guides in `packages/skill/guides/` stay as they are: dense, complete and written for coding agents.
The Reference tab is still generated from `danwo spec`.

## What a page looks like

Every page follows the same shape, in this order:

1. **What it is.** One or two sentences under the title. Say what the thing does, not how it is
   built.
2. **Why you'd use it.** One short paragraph: the problem it solves, in the reader's terms.
3. **A minimal example.** Working code within the first screen, before any detail.
4. **Steps.** One idea per section. Each section is a heading that names a task ("Write the
   invariant", "Run the matrix"), a short paragraph and a snippet.
5. **Options in a table**, never in prose: name, what it does, default.
6. **Callouts** for gotchas only: `Note` for something easy to miss, `Warning` for something that
   breaks, `Tip` for a shortcut. At most two or three per page.
7. **A diagram** when a flow is hard to picture from text (requests through the proxy, a matrix
   run). Draw the real flow, not decoration.
8. **Next.** Two to four cards at the end, each a page the reader likely wants now.

## Pacing that reads well

Measured on docs that developers find easy to read (an introduction, a quickstart, core concepts,
a platform page, a feature page, a reference page and an examples page):

- **Page length:** an introduction is about 40 lines; a concept or feature page 100 to 300; a
  quickstart is long but entirely inside numbered steps; reference pages are the long ones.
- **Heading rhythm:** a `##` every 15 to 30 lines, named as a task or a question; `###` only
  inside a long section.
- **Code appears early:** on the introduction, after one paragraph; on a concept page, after a
  table or two sentences.
- **Snippet size:** 5 to 20 lines with a filename tab; a fragment is titled as a fragment.
  "Bad" and "good" versions of the same snippet sit next to each other when a rule is subtle.
- **Introducing a concept:** one sentence that defines it, an example, then the rules as short
  bullets.
- **Tables:** for options, comparisons and outcomes (two to four columns). **Callouts:** rare,
  mostly prerequisites. **Collapsible blocks:** for edge cases most readers skip.
- **Linking onwards:** inline links on first mention, and a "Next" row of two to four cards on
  every page.

## Length and pacing

- **Short pages.** Aim for one screen to three screens. A topic that needs more becomes several
  pages in its own sidebar section: Fault matrix → Overview, Writing invariants, Running it,
  Reading results, Planning and budget, Fault kinds, Common findings.
- **Headings often.** A `##` heading every 10 to 30 lines, so the "On this page" list reads like a
  table of contents of tasks.
- **Code early and often.** The first snippet appears before the second heading. Most sections
  have one.
- **Small snippets.** 5 to 20 lines. Show the part that matters; link to a full example for the
  rest.

## Voice

- **Plain English, second person:** "you write the test", "danwo replays it".
- **Short sentences.** One concept per paragraph, three sentences or fewer.
- **Explain a term before using it.** The first time a page says "invariant", "egress proxy" or
  "trial", it says what that is in a few words, and links to its page.
- **Concrete over abstract.** Name the real thing: "a Stripe charge made twice", not "a
  consistency issue".
- **Say what the reader sees.** Show real command output in `text` blocks, trimmed to the lines
  that matter.

## Code

- **Every complete snippet has a filename tab** (`title="tests/checkout.danwo.ts"`) and is
  complete enough to copy: imports included, real API only, checked against `danwo spec` and
  `examples/shop`.
- **A partial snippet says so in its title**, such as `title="danwo.config.ts · the model"`. The
  build type-checks only blocks whose title ends in `.ts`, so partial snippets must not.
- **Several files of one example** go in blocks titled with their paths. They are checked
  together, so one can import another by its relative path.
- **Terminal commands** in `sh` blocks without a prompt sign. Output in a separate `text` block.

## Components

| Use                                                 | Component                                              |
| --------------------------------------------------- | ------------------------------------------------------ |
| A sequence the reader follows                       | `<Steps>` with `<Step>`                                |
| The same thing two ways (npm or bun, web or mobile) | `<Tabs items={[…]}>` with `<Tab>`                      |
| A gotcha                                            | `<Callout type="warn">` (or `info`, `idea`)            |
| Where to go next                                    | `<Cards>` with `<Card title href>`                     |
| A flow                                              | a diagram component from `src/components/diagrams.tsx` |

## Links

- **Inline, on first mention:** link a concept the first time a page names it.
- **Next cards at the end** of every page: two to four, each with a one-line reason to go there.
- **Reference for the details:** a guide page explains how; a full option list belongs on the
  Reference tab, and the page links there.

## What not to do

- No walls of text. A paragraph over four lines is split or turned into a list or a table.
- No option lists in prose.
- No jargon before it's explained.
- No snippet without the sentence above it saying what it shows.
