import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { applyBootTheme } from "@/lib/siteTheme";

// Before the first paint, not inside a component. The published site theme
// lives in app_config, so learning it costs a round-trip; painting from the
// local cache first is what stops every page load from flashing the code's
// colours and then snapping to the published ones. The fetch reconciles a
// moment later and is the authority. See src/lib/siteTheme.ts.
applyBootTheme();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
