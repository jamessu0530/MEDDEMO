import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { IconMotionController } from "@/components/icons/use-icon-motion"

import "./index.css"
import App from "./App.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IconMotionController />
    <App />
  </StrictMode>
)
