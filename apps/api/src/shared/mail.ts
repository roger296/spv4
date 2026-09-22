/**
 * Outbound email. With SMTP_URL set, sends through nodemailer; otherwise logs the message,
 * which is what development and tests want. Every send is recorded in `lastMails` for tests.
 */
import { getEnv } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export const lastMails: MailMessage[] = [];

export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  lastMails.push(msg);
  if (lastMails.length > 50) lastMails.shift();
  if (!env.SMTP_URL) {
    if (env.NODE_ENV !== 'test') console.log(`[mail] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, attachments: msg.attachments });
}
