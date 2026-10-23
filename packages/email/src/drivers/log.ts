import { emailMessageSchema, type EmailMessage, type Mailer } from "../message";

export interface LogMailer extends Mailer {
  readonly sent: readonly EmailMessage[];
}

type LogMailerOptions = {
  log?: (line: string) => void;
};

export function createLogMailer({ log = console.info }: LogMailerOptions = {}): LogMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      const parsed = emailMessageSchema.parse(message);
      sent.push(parsed);
      log(`[email:log] to=${parsed.to} subject="${parsed.subject}"`);
    },
  };
}
