import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./index.css";

// autoUpdate + immediate: cuando el deploy trae un SW nuevo, éste hace
// skipWaiting/clientsClaim y este registro recarga la página sola.
// Sin esto la pestaña se quedaba con la versión vieja hasta recargar a mano.
registerSW({ immediate: true });

// Sin StrictMode a propósito: evita que React monte/desmonte dos veces en dev
// y cree dos instancias de Phaser.
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
