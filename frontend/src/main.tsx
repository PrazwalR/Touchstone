import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/globals.css";
import "./styles/instrument.css";
import "./styles/app.css";
import "./styles/refined.css";
import "./styles/demo.css";
import "./styles/lab.css";
import "./styles/glass.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
