/** Harbor's pages, and which of them need you signed in. */
import "../../kit/kit.css"
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router"

import { AppLayout } from "./layouts.tsx"
import { Dashboard } from "./pages/dashboard.tsx"
import { Settings } from "./pages/settings.tsx"
import { SignIn } from "./pages/sign-in.tsx"
import { SignUp } from "./pages/sign-up.tsx"

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  { path: "/sign-in", element: <SignIn /> },
  { path: "/sign-up", element: <SignUp /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])

const root = document.getElementById("root")

if (root)
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
