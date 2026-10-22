import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { MAIL_TIMEOUT_MS, type Mailer } from "./alerts";

/** SES v2 with the default credential chain (the EC2 instance role on AWS). Off unless both addresses are set. */
export function sesMailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  const to = env.MIA_ALERT_EMAIL_TO?.trim();
  const from = env.MIA_ALERT_EMAIL_FROM?.trim();
  if (!to || !from) return null;
  const client = new SESv2Client({ region: env.AWS_REGION || "eu-central-1" });
  return {
    async send({ subject, text }) {
      await client.send(new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" } } } },
      }), { abortSignal: AbortSignal.timeout(MAIL_TIMEOUT_MS) });
    },
  };
}

/**
 * On a public deploy (MIA_PUBLIC_ORIGIN) without a mailer every alert is only stored (Mia then tells her she could not
 * reach the carer).
 * Startup does not refuse (a demo must still run), but says so loudly on stderr.
 */
export function alertEmailOffWarning(env: Record<string, string | undefined>, mailerOn: boolean): string | null {
  if (mailerOn || !env.MIA_PUBLIC_ORIGIN?.trim()) return null;
  return "[mia] WARNING: alert email OFF on a public deploy (MIA_PUBLIC_ORIGIN is set): alerts are only stored and the carer is NOT mailed. Set MIA_ALERT_EMAIL_TO and MIA_ALERT_EMAIL_FROM.";
}

/** For logs: "tom@example.com" → "t***@example.com". Never the full address (journald, screen recordings). */
export function maskEmail(addr: string | undefined): string {
  const a = addr?.trim() ?? "";
  const at = a.lastIndexOf("@");
  if (at < 0) return "***";
  return `${a.slice(0, Math.min(at, 1))}***${a.slice(at)}`;
}
