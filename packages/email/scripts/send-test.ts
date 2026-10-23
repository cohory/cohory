import { z } from "zod";

import { emailErrorCode, getMailer, parseEmailEnv, testEmail } from "../src/index";

const recipient = z.email().safeParse(process.argv[2]);
if (!recipient.success) {
  console.error("Usage: pnpm email:test you@example.com");
  process.exit(2);
}

const env = parseEmailEnv();
const route = env.driver === "smtp" ? `SMTP ${env.host}:${env.port}` : "the log driver";

try {
  await getMailer().send({ to: recipient.data, ...testEmail() });
  console.info(`Sent a test email to ${recipient.data} through ${route}.`);
  process.exit(0);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Could not send through ${route} (${emailErrorCode(error)}): ${reason}`);
  process.exit(1);
}
