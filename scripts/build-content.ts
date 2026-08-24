import { contentScaffoldStatus } from "../src/content/index.ts";

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    command: "build:content",
    phase: contentScaffoldStatus.phase,
    generated: false,
  })}\n`,
);
