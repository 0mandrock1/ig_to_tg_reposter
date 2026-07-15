import { Telegraf } from 'telegraf';
import type { InputMediaPhoto } from 'telegraf/types';

const MAX_RETRIES = 3;
const CAPTION_LIMIT = 1024; // Telegram caption limit for media messages

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const backoffMs = 2 ** attempt * 1000;
      console.error(`[telegram] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}

export class TelegramPublisher {
  private bot: Telegraf;
  private channel: string;

  constructor(botToken: string, channelUsername: string) {
    this.bot = new Telegraf(botToken);
    this.channel = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
  }

  async publishPost(text: string, mediaUrls: string[]): Promise<void> {
    const caption = text.length > CAPTION_LIMIT ? `${text.slice(0, CAPTION_LIMIT - 1)}…` : text;

    if (mediaUrls.length === 0) {
      await withRetry(() => this.bot.telegram.sendMessage(this.channel, text || ' '), 'sendMessage');
      return;
    }

    if (mediaUrls.length === 1) {
      await withRetry(
        () => this.bot.telegram.sendPhoto(this.channel, mediaUrls[0], { caption }),
        'sendPhoto',
      );
      return;
    }

    const media: InputMediaPhoto[] = mediaUrls.map((url, i) => ({
      type: 'photo',
      media: url,
      ...(i === 0 ? { caption } : {}),
    }));

    await withRetry(() => this.bot.telegram.sendMediaGroup(this.channel, media), 'sendMediaGroup');
  }
}
