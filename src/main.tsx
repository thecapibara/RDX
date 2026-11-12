import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initThemes } from "./services/theme";

// Initialize theme variables and background mode
initThemes();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
