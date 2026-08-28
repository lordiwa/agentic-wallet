import { ChatPanel } from "./components/ChatPanel";
import { OverviewCards } from "./components/OverviewCards";
import { ReviewTray } from "./components/ReviewTray";
import { StrategySection } from "./components/StrategySection";
import { SyncButton } from "./components/SyncButton";
import { TransactionsTable } from "./components/TransactionsTable";

/**
 * Read-only dashboard: overview cards, sync trigger, F2-E strategy
 * indicators/charts, review tray, transactions table, and the F3-D chat
 * assistant.
 */
export function Dashboard() {
  return (
    <main>
      <h1>Agentic Wallet</h1>
      <SyncButton />
      <OverviewCards />
      <StrategySection />
      <ReviewTray />
      <TransactionsTable />
      <ChatPanel />
    </main>
  );
}
