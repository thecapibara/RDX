// Prevent WebKitGTK from registering a buggy, non-teardown MPRIS D-Bus bridge that hangs in Linux panels/shades
try {
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    Object.defineProperty(navigator, "mediaSession", {
      get: () => undefined,
      configurable: false,
    });
  }
} catch {}
if (typeof document !== "undefined") {
  document.title = "";
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
