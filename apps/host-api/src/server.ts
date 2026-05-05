import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = await createApp();

await app.listen({ port, host });
app.log.info(`host-api listening on http://${host}:${port}`);
