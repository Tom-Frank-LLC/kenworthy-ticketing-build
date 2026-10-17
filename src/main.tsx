import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { applyBootTheme } from "@/lib/siteTheme";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

// Before the first paint, not inside a component. The published site theme
// lives in app_config, so learning it costs a round-trip; painting from the
// local cache first is what stops every page load from flashing the code's
// colours and then snapping to the published ones. The fetch reconciles a
// moment later and is the authority. See src/lib/siteTheme.ts.
applyBootTheme();

// The iOS app draws under the status bar (viewport-fit=cover; the header pads
// itself by env(safe-area-inset-top)). The page is always dark — a published
// theme changes the accents, never the background — so the clock and battery
// are drawn light. Style.Dark means "for a dark background". No-op on the web.
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
