import { ChatPanel } from "./components/ChatPanel";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { OverviewCards } from "./components/OverviewCards";
import { ReviewTray } from "./components/ReviewTray";
import { StrategySection } from "./components/StrategySection";
import { SyncButton } from "./components/SyncButton";
import { SyncStatus } from "./components/SyncStatus";
import { TransactionsTable } from "./components/TransactionsTable";
import { RefreshProvider } from "./lib/refresh";

/**
 * Read-only dashboard: overview cards, sync trigger, F2-E strategy
 * indicators/charts, review tray, transactions table, and the F3-D chat
 * assistant.
 *
 * Todo cuelga de `RefreshProvider`: el dashboard se deja abierto mientras el
 * sync corre del otro lado, asi que cada seccion vuelve a pedir sus datos en
 * cada tick (ver lib/refresh.tsx). `ConnectionBanner` va primero a proposito
 * — antes de leer un numero hay que saber de que backend salio, o si es la
 * demostracion.
 */
export function Dashboard() {
  return (
    <RefreshProvider>
      <main>
        <h1>Agentic Wallet</h1>
        <ConnectionBanner />
        <SyncStatus />
        <SyncButton />
        <OverviewCards />
        <StrategySection />
        <ReviewTray />
        <TransactionsTable />
        <ChatPanel />
      </main>
    </RefreshProvider>
  );
}
