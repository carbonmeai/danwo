import { redirect } from "next/navigation"

export default function AdminHome(): never {
  redirect("/admin/orders")
}
