import React from "react";
import { createRoot } from "react-dom/client";
import Planner from "./Planner";
import "./planner.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Planner />
  </React.StrictMode>,
);
