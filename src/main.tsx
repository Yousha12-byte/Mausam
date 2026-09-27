import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/globals.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* Installed builds get a service worker so the app opens with no network.
   In dev this is a no-op, which keeps hot reload honest. */
registerSW({ immediate: true });
