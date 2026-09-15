import { hiplingoLogoUrl } from "@hiplingo/brand";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSigner from "./components/PublicSigner";
import "./index.css";
import "@hiplingo/media-player/compact-now-playing-bar.css";
import "./components/compact-now-playing-host.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Root element with id="root" was not found');
}

let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

if (!favicon) {
  favicon = document.createElement("link");
  favicon.rel = "icon";
  document.head.append(favicon);
}

favicon.href = hiplingoLogoUrl;

const signerRouteMatch = window.location.pathname.match(/^\/sign\/([^/]+)\/?$/);
const signerToken = signerRouteMatch
  ? decodeURIComponent(signerRouteMatch[1])
  : null;

createRoot(rootElement).render(
  <StrictMode>
    {signerToken ? <PublicSigner token={signerToken} /> : <App />}
  </StrictMode>,
);
