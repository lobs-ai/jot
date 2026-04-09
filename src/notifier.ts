import { loadConfig } from './config.js';

export interface ProcessResult {
  processedCount: number;
  actionItemsFound: string[];
  urgentItems: string[];
  staleNotes: string[];
  summary: string;
}

export interface Notifier {
  deliver(result: ProcessResult): Promise<void>;
}

export class DiscordNotifier implements Notifier {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async deliver(result: ProcessResult): Promise<void> {
    if (!this.webhookUrl) {
      console.log('Discord webhook not configured');
      return;
    }

    const body = this.buildDiscordPayload(result);
    
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        console.error('Discord notification failed:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
    }
  }

  private buildDiscordPayload(result: ProcessResult): object {
    const fields: { name: string; value: string; inline?: boolean }[] = [];

    if (result.actionItemsFound.length > 0) {
      fields.push({
        name: 'Action Items',
        value: result.actionItemsFound.slice(0, 5).map(a => `• ${a}`).join('\n'),
        inline: false
      });
    }

    if (result.urgentItems.length > 0) {
      fields.push({
        name: 'Urgent',
        value: result.urgentItems.slice(0, 5).map(a => `• ${a}`).join('\n'),
        inline: false
      });
    }

    if (result.staleNotes.length > 0) {
      fields.push({
        name: 'Stale Notes',
        value: `${result.staleNotes.length} note(s) need review`,
        inline: false
      });
    }

    return {
      embeds: [{
        title: 'Jot Update',
        description: result.summary,
        color: result.urgentItems.length > 0 ? 15158332 : 3447003,
        fields,
        footer: { text: `Processed ${result.processedCount} notes` },
        timestamp: new Date().toISOString()
      }]
    };
  }
}

export class TerminalNotifier implements Notifier {
  async deliver(result: ProcessResult): Promise<void> {
    console.log('\n=== Jot Notification ===\n');
    console.log(result.summary);
    
    if (result.actionItemsFound.length > 0) {
      console.log(`\n${result.actionItemsFound.length} action item(s) found:`);
      result.actionItemsFound.slice(0, 5).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item}`);
      });
    }
    
    if (result.urgentItems.length > 0) {
      console.log(`\n⚠ ${result.urgentItems.length} urgent item(s):`);
      result.urgentItems.slice(0, 5).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item}`);
      });
    }
    
    console.log('');
  }
}

export class WebhookNotifier implements Notifier {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async deliver(result: ProcessResult): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      });
    } catch (error) {
      console.error('Webhook notification failed:', error);
    }
  }
}

export class NoNotifier implements Notifier {
  async deliver(_result: ProcessResult): Promise<void> {
    // Do nothing
  }
}

export function createNotifier(): Notifier {
  const config = loadConfig();
  const notifierType = config.notifier || 'none';
  const webhookUrl = config.discordWebhook || '';

  switch (notifierType) {
    case 'discord':
      return new DiscordNotifier(webhookUrl);
    case 'terminal':
      return new TerminalNotifier();
    case 'webhook':
      return new WebhookNotifier(webhookUrl);
    default:
      return new NoNotifier();
  }
}

export function shouldNotify(result: ProcessResult, mode?: string): boolean {
  const config = loadConfig();
  const deliveryMode = mode || config.deliveryMode || 'urgent';

  if (deliveryMode === 'always') return true;
  if (deliveryMode === 'urgent') {
    return result.urgentItems.length > 0 || result.actionItemsFound.length > 0 || result.staleNotes.length > 0;
  }
  if (deliveryMode === 'digest') {
    const now = new Date();
    const digestTimeStr = config.digestTime || '08:00';
    const [hours, minutes] = digestTimeStr.split(':').map(Number);
    const digestTime = new Date(now);
    digestTime.setHours(hours, minutes, 0, 0);
    return now >= digestTime && now.getTime() < digestTime.getTime() + 60000;
  }
  return false;
}
