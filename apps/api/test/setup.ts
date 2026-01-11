process.on("unhandledRejection", (reason) => {
  // Make Vitest show the real stack and fail deterministically
  // eslint-disable-next-line no-console
  console.error("UNHANDLED_REJECTION:", reason);
  throw reason instanceof Error ? reason : new Error(String(reason));
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("UNCAUGHT_EXCEPTION:", err);
  throw err;
});
