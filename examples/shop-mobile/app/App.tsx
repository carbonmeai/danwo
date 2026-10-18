/*
 * The shop's app: shows the user's credits and buys 500 more through Stripe Checkout, opened in a
 * Custom Tab. The shop's server creates the Checkout Session and grants credits from Stripe's
 * webhook; the app only asks it for the balance. Its server is `http://shop.danwo.test`, a name
 * the device reaches through danwo's proxy, so the build needs no address baked in.
 */
import * as Linking from "expo-linking"
import { StatusBar } from "expo-status-bar"
import * as WebBrowser from "expo-web-browser"
import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

const SHOP = "http://shop.danwo.test"
const USER = "u1"
/**
 * After a checkout the app asks the server for the balance every second for a while, so credits a
 * webhook grants a little later still show up.
 */
const REFRESH_MS = 1_000
const REFRESH_FOR_MS = 15_000

/** The user's credits as the server has them, or undefined before the first answer. */
async function fetchCredits(): Promise<number | undefined> {
  const res = await fetch(`${SHOP}/credits?user=${USER}`)

  if (!res.ok) return undefined

  const body: unknown = await res.json()

  return typeof body === "object" &&
    body !== null &&
    "credits" in body &&
    typeof body.credits === "number"
    ? body.credits
    : undefined
}

/** The Checkout page's address in the server's answer. */
function checkoutUrl(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "url" in body && typeof body.url === "string"
    ? body.url
    : undefined
}

export default function App() {
  const [credits, setCredits] = useState<number | undefined>(undefined)
  const [status, setStatus] = useState("Ready")
  const returned = Linking.useURL()

  const paid = returned?.startsWith("danwoshop://done") === true

  useEffect(() => {
    let live = true

    const refresh = () => {
      fetchCredits()
        .then((value) => {
          if (live && value !== undefined) setCredits(value)
        })
        .catch(() => undefined)
    }

    refresh()

    const timer = paid ? setInterval(refresh, REFRESH_MS) : undefined
    const stop = setTimeout(() => clearInterval(timer), REFRESH_FOR_MS)

    return () => {
      live = false
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [paid, returned])

  useEffect(() => {
    if (returned?.startsWith("danwoshop://done")) setStatus("Thanks for your order")
    if (returned?.startsWith("danwoshop://cancel")) setStatus("Checkout cancelled")
  }, [returned])

  async function buy() {
    setStatus("Opening checkout")

    try {
      const res = await fetch(`${SHOP}/checkout?user=${USER}`, { method: "POST" })

      if (!res.ok) {
        setStatus("Checkout is unavailable, try again")

        return
      }

      const url = checkoutUrl(await res.json())

      if (url === undefined) {
        setStatus("Checkout is unavailable, try again")

        return
      }

      await WebBrowser.openBrowserAsync(url)
    } catch {
      setStatus("Checkout is unavailable, try again")
    }
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Danwo Shop
      </Text>
      <Text testID="credits" style={styles.credits}>
        {credits === undefined ? "Credits: …" : `Credits: ${credits}`}
      </Text>
      <Pressable testID="buy" accessibilityRole="button" onPress={buy} style={styles.button}>
        <Text style={styles.label}>Buy 500 credits</Text>
      </Pressable>
      <Text testID="status">{status}</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  title: { fontSize: 24, fontWeight: "600" },
  credits: { fontSize: 18 },
  button: {
    backgroundColor: "#635bff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  label: { color: "#fff", fontSize: 16 },
})
