import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const server = serve(
  { fetch: createApp().fetch, hostname: "0.0.0.0", port },
  (info) => {
    console.info(`Tooled Voice API listening on http://localhost:${info.port}`);
  }
);

function shutdown(signal: string) {
  console.info(`${signal} received, closing API server`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
