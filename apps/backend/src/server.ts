import { buildBackendApp } from "./app.js";

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "127.0.0.1";

const app = buildBackendApp({
  logger: true
});

await app.listen({
  host,
  port
});

console.log(`Braze backend MVP listening on http://${host}:${port}`);

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return 8787;
  }

  const parsedPort = Number.parseInt(rawPort, 10);

  if (Number.isNaN(parsedPort)) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}
