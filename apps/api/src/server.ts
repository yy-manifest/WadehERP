import { buildApp } from "./app";

const app = buildApp();
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info({ port }, "api_listening");
});
