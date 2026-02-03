/**
 * SessionFi Protocol MVP Entry Point
 *
 * This is the application entry point that renders the React application.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./AMMApp";

// Global styles
const globalStyles = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 16px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  button {
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
  }

  button:hover {
    opacity: 0.9;
  }

  button:active {
    transform: scale(0.98);
  }

  code {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Monaco, monospace;
  }

  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: #1e293b;
  }

  ::-webkit-scrollbar-thumb {
    background: #475569;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #64748b;
  }
`;

// Inject global styles
const styleSheet = document.createElement("style");
styleSheet.textContent = globalStyles;
document.head.appendChild(styleSheet);

// Render application
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
