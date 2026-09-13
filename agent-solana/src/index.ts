import { AegisMonitor } from "./monitor";

async function main() {
  const monitor = new AegisMonitor();

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
