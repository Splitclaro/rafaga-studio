import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, aptGet } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_jykusfseqhizxclghlnx",
  dirs: ["./src/trigger"],
  runtime: "node",
  maxDuration: 3600,
  retries: { enabledInDev: false, default: { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, factor: 2, randomize: true } },
  build: {
    extensions: [
      ffmpeg(),
      aptGet({ packages: ["fonts-liberation", "fonts-dejavu-core", "fontconfig"] }),
    ],
  },
});
