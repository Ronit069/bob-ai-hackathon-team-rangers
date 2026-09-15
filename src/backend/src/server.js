// ChainSentinel backend entry point (Phase 3: REST API).
import { createApp } from "./app.js";
import { config } from "./common/config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`ChainSentinel backend listening on ${config.port} (Phase 3)`);
});
