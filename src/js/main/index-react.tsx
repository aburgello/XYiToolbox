import React from "react";
import ReactDOM from "react-dom/client";
import { initBolt } from "../lib/utils/bolt";
import { sfx } from "../lib/utils/sfx";
import "../index.scss";
import "./tailwind.css";
import Main from "./main";

initBolt();
sfx.preload();

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>
);
