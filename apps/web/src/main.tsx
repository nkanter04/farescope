import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme } from "./theme.ts";
import { loadAccounts } from "./accountSlots.tsx";

// Accounts (Clerk) load before the first render, and only when configured.
void Promise.all([applyTheme(), loadAccounts().catch(() => null)]).then(([, accounts]) => {
  const app = <App />;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {accounts ? <accounts.AccountProvider>{app}</accounts.AccountProvider> : app}
    </StrictMode>,
  );
});
