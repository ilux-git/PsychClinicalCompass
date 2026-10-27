import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { InteractionProvider } from "./Interaction";
import "./styles.css";
import "./workspace.css";
import "./brand-theme.css";
import "./telegram.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InteractionProvider><App /></InteractionProvider>
  </StrictMode>,
);
