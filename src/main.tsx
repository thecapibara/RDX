import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initThemes } from "./services/theme";
import { getEffectiveLabsState } from "./services/labs";

// Initialize theme variables, background mode, and RDX Labs Eco state
initThemes();
getEffectiveLabsState();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
