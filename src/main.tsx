// Title and mediaSession suppression to prevent WebKitGTK from registering orphan MPRIS players on Linux D-Bus
if (typeof document !== "undefined") {
  document.title = "";
}
if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "",
      artist: "",
      album: "",
    });
    navigator.mediaSession.playbackState = "none";
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
