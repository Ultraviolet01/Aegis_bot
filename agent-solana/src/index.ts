import { AegisMonitor } from "./monitor";
import { config } from "./config";

async function main() {
  // Pass the configured dry-run decision explicitly so the execution mode in the
  // log line below is the mode actually in force.
  const monitor = new AegisMonitor({ dryRun: config.dryRun });

  // Graceful shutdown on SIGINT/SIGTERM
  process.on("SIGINT", () => {
    console.log("[Aegis] SIGINT received — shutting down");
    monitor.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("[Aegis] SIGTERM received — shutting down");
    monitor.stop();
    process.exit(0);
  });

  await monitor.start();
}

main().catch((err) => {
  console.error("[Aegis] Fatal error:", err);
  process.exit(1);
});
