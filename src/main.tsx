import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { applyBootTheme } from "@/lib/siteTheme";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as NativeApp } from "@capacitor/app";

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

// Android's back button. Unhandled, it closes the app from any page; the App
// plugin's own default goes back through the WebView's history but then does
// nothing on the first page, so the app can't be left with it. This goes back
// while there is somewhere to go, and from the first page sends the app to the
// background, as Android apps do. iOS has no back button and never fires this.
if (Capacitor.getPlatform() === "android") {
  NativeApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else NativeApp.minimizeApp().catch(() => {});
  }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
