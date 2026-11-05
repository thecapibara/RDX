// Suppress WebKitGTK built-in MPRIS registration.
// WebKit's MediaSessionGLib aborts D-Bus registration if metadata.title is locked to an empty string ("").
// This prevents WebKit from spawning the orphan "LOCALHOST" card while native Rust souvlaki handles MPRIS.
if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
  try {
    const emptyMeta = new MediaMetadata({ title: "" });
    navigator.mediaSession.metadata = emptyMeta;

    Object.defineProperty(navigator.mediaSession, "metadata", {
      get: () => emptyMeta,
      set: () => {},
      configurable: false,
      enumerable: true,
    });

    navigator.mediaSession.setActionHandler = () => {};
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
