import { describe, expect, it } from "vitest"

import { type Entity, Store } from "../src/store.ts"

interface Pet extends Entity {
  name: string
  kind: string
  tags?: string[]
}

function storeAt(iso: string) {
  let now = new Date(iso)

  return {
    store: new Store(() => now),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

describe("Collection", () => {
  it("assigns increasing ids and timestamps from the store's clock", () => {
    const { store } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets")
    const first = pets.insert({ name: "Rex", kind: "dog" })
    const second = pets.insert({ name: "Tom", kind: "cat" })

    expect([first.id, second.id]).toEqual([1, 2])
    expect(first.created_at).toBe("2026-01-01T00:00:00.000Z")
    expect(pets.get(2)).toEqual(second)
  })

  it("keeps an explicit id and continues after it", () => {
    const { store } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets")

    pets.insert({ id: 10, name: "Rex", kind: "dog" })

    expect(pets.insert({ name: "Tom", kind: "cat" }).id).toBe(11)
  })

  it("finds by indexed and unindexed fields, in insertion order", () => {
    const { store } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets", ["kind"])

    pets.insert({ name: "Rex", kind: "dog" })
    pets.insert({ name: "Tom", kind: "cat" })
    pets.insert({ name: "Fido", kind: "dog" })

    expect(pets.findBy("kind", "dog").map((p) => p.name)).toEqual(["Rex", "Fido"])
    expect(pets.findOneBy("name", "Tom")?.kind).toBe("cat")
    expect(pets.findOneBy("name", "Nobody")).toBeUndefined()
  })

  it("updates fields and the index, bumping updated_at only", () => {
    const { store, advance } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets", ["kind"])
    const rex = pets.insert({ name: "Rex", kind: "dog" })

    advance(1000)
    const changed = pets.update(rex.id, { kind: "wolf", id: 99, created_at: "never" })

    expect(changed).toMatchObject({ id: 1, kind: "wolf", created_at: rex.created_at })
    expect(changed?.updated_at).toBe("2026-01-01T00:00:01.000Z")
    expect(pets.findBy("kind", "dog")).toEqual([])
    expect(pets.findBy("kind", "wolf")).toHaveLength(1)
    expect(pets.update(42, { name: "ghost" })).toBeUndefined()
  })

  it("deletes, counts and clears", () => {
    const { store } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets", ["kind"])

    pets.insert({ name: "Rex", kind: "dog" })
    pets.insert({ name: "Tom", kind: "cat" })

    expect(pets.delete(1)).toBe(true)
    expect(pets.delete(1)).toBe(false)
    expect(pets.findBy("kind", "dog")).toEqual([])
    expect(pets.count()).toBe(1)
    expect(pets.count((p) => p.kind === "dog")).toBe(0)

    pets.clear()

    expect(pets.all()).toEqual([])
    expect(pets.insert({ name: "New", kind: "cat" }).id).toBe(1)
  })
})

describe("Store", () => {
  it("returns the same collection for a name", () => {
    const store = new Store()

    expect(store.collection("a")).toBe(store.collection("a"))
    expect(store.collection("a")).not.toBe(store.collection("b"))
  })

  it("resets collections and values", () => {
    const store = new Store()

    store.collection<Pet>("pets").insert({ name: "Rex", kind: "dog" })
    store.setData("counter", 3)
    store.reset()

    expect(store.collection("pets").count()).toBe(0)
    expect(store.getData("counter")).toBeUndefined()
  })

  it("snapshots to plain JSON and restores rows, ids, indexes and values", () => {
    const { store } = storeAt("2026-01-01T00:00:00.000Z")
    const pets = store.collection<Pet>("pets", ["kind"])

    pets.insert({ name: "Rex", kind: "dog", tags: ["good"] })
    store.setData("seen", new Map([["key", { at: 1, ids: new Set([1, 2]) }]]))

    const snapshot = store.snapshot()
    const json = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot

    pets.insert({ name: "Tom", kind: "cat" })
    store.setData("seen", new Map())
    store.restore(json)

    expect(pets.all().map((p) => p.name)).toEqual(["Rex"])
    expect(pets.findBy("kind", "dog")).toHaveLength(1)
    expect(pets.insert({ name: "Next", kind: "cat" }).id).toBe(2)
    expect(store.getData("seen")).toEqual(new Map([["key", { at: 1, ids: new Set([1, 2]) }]]))
  })

  it("keeps snapshots independent of later changes", () => {
    const store = new Store()
    const pets = store.collection<Pet>("pets")
    const rex = pets.insert({ name: "Rex", kind: "dog", tags: ["a"] })
    const snapshot = store.snapshot()

    rex.tags?.push("b")
    pets.update(rex.id, { name: "Changed" })
    store.restore(snapshot)

    expect(pets.get(rex.id)).toMatchObject({ name: "Rex", tags: ["a"] })
  })
})
