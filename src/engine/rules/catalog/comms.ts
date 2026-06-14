// Patterns adapted from gitleaks (MIT). See ./CREDITS.md.
import type { RuleSpec } from '../define';

/**
 * Communication / email provider tokens (SendGrid, Mailgun, Mailchimp, Slack & Discord
 * webhooks, Telegram). Fixed prefixes / fixed host URLs keep these high-precision.
 */
export const commsSpecs: readonly RuleSpec[] = [
  {
    id: 'sendgrid-api-key',
    name: 'SendGrid API Key',
    severity: 'high',
    // `SG.` + 22 url-safe chars + `.` + 43 url-safe chars (SendGrid v3 key shape).
    pattern: /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b/g,
    keywords: ['SG.'],
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a SendGrid API key — it can send mail from your account.',
  },
  {
    id: 'mailgun-private-key',
    name: 'Mailgun Private API Key',
    severity: 'high',
    // `key-` + 32 hex chars. Loose-ish body → entropy floor + placeholder gate.
    pattern: /\bkey-[0-9a-f]{32}\b/g,
    keywords: ['key-'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    mask: { kind: 'prefix', head: 4 },
    message: 'Looks like a Mailgun private API key.',
  },
  {
    id: 'mailchimp-api-key',
    name: 'Mailchimp API Key',
    severity: 'high',
    // 32 hex chars + `-us<n>` datacenter suffix — the `-us` suffix is the precision.
    pattern: /\b[0-9a-f]{32}-us[0-9]{1,2}\b/g,
    keywords: ['-us'],
    entropyFloor: 3.0,
    gatePlaceholder: true,
    mask: { kind: 'middle', head: 4, tail: 5 },
    message: 'Looks like a Mailchimp API key.',
  },
  {
    id: 'slack-webhook-url',
    name: 'Slack Webhook URL',
    severity: 'high',
    // The full incoming-webhook URL; the host path is the precision.
    pattern:
      /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{43,56}/g,
    keywords: ['hooks.slack.com'],
    mask: { kind: 'middle', head: 30, tail: 4 },
    message: 'Looks like a Slack incoming-webhook URL — anyone with it can post to your channel.',
  },
  {
    id: 'discord-webhook-url',
    name: 'Discord Webhook URL',
    severity: 'high',
    // `discord(app).com/api/webhooks/<id>/<token>`.
    pattern:
      /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{17,20}\/[0-9A-Za-z_-]{60,68}/g,
    keywords: ['discord', 'webhooks'],
    mask: { kind: 'middle', head: 40, tail: 4 },
    message: 'Looks like a Discord webhook URL — anyone with it can post to your channel.',
  },
  {
    id: 'telegram-bot-token',
    name: 'Telegram Bot Token',
    severity: 'high',
    // `<8-10 digit bot id>:<35 url-safe>` — the digits-colon-body shape is the precision.
    pattern: /\b[0-9]{8,10}:AA[0-9A-Za-z_-]{32,33}\b/g,
    keywords: [':AA'],
    mask: { kind: 'middle', head: 4, tail: 4 },
    message: 'Looks like a Telegram bot token — it can control your bot.',
  },
];
