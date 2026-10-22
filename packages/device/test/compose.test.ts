import { describe, expect, it } from "vitest"

import { composeNodes } from "../src/android/compose.ts"
import { deviceNodes, type DriverNode } from "../src/tree.ts"

/** A Compose screen as the driver reads it: a text field, a button and a checkbox. */
const COMPOSE: readonly DriverNode[] = [
  { index: 0, type: "android.view.View", kind: "group" },
  {
    index: 1,
    type: "android.widget.EditText",
    editable: true,
    identifier: "email",
    parentIndex: 0,
  },
  { index: 2, type: "android.widget.TextView", label: "Work email", parentIndex: 1 },
  /* The button: a tappable view with the test tag, its label in a text, its role in an empty child. */
  { index: 3, type: "android.view.View", identifier: "join", hittable: true, parentIndex: 0 },
  { index: 4, type: "android.widget.TextView", label: "Join the waitlist", parentIndex: 3 },
  { index: 5, type: "android.widget.Button", kind: "button", parentIndex: 3 },
  { index: 6, type: "android.view.View", hittable: true, parentIndex: 0 },
  { index: 7, type: "android.widget.TextView", label: "Send me news", parentIndex: 6 },
  { index: 8, type: "android.widget.CheckBox", checked: true, parentIndex: 6 },
]

describe("a Jetpack Compose screen", () => {
  it("reads each control as one element with its role, label, test id and state", () => {
    const nodes = deviceNodes(composeNodes(COMPOSE))

    expect(nodes.find((node) => node.testId === "join")).toMatchObject({
      ref: "e4",
      role: "button",
      name: "Join the waitlist",
    })
    expect(nodes.find((node) => node.role === "checkbox")).toMatchObject({
      ref: "e7",
      name: "Send me news",
      checked: true,
    })
    /* The empty role children are gone; the texts stay, as on any Android screen. */
    expect(nodes.map((node) => node.ref)).toEqual(["e1", "e2", "e3", "e4", "e5", "e7", "e8"])
  })

  it("leaves a View-based screen as it was", () => {
    const views: readonly DriverNode[] = [
      { index: 0, type: "android.widget.LinearLayout" },
      { index: 1, type: "android.widget.Button", label: "Pay", hittable: true, parentIndex: 0 },
      /* An unnamed button inside a group that is not a tappable Compose view. */
      { index: 2, type: "android.widget.FrameLayout", parentIndex: 0 },
      { index: 3, type: "android.widget.Button", parentIndex: 2 },
    ]

    expect(composeNodes(views)).toEqual(views)
  })
})
