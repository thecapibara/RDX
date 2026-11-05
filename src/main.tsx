// Neutralize webview mediaSession so WebKitGTK never claims an orphan MPRIS player on D-Bus (native Rust souvlaki handles MPRIS)
if (typeof document !== "undefined") {
  document.title = "";
}
if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
  try {
    Object.defineProperty(navigator, "mediaSession", {
      get: () => undefined,
      configurable: false,
      enumerable: true,
    });
  } catch {}
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
