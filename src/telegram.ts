import { Telegraf } from 'telegraf';
import type { InputMediaPhoto } from 'telegraf/types';
import { withRetry } from './retry.js';

const CAPTION_LIMIT = 1024; // Telegram caption limit for media messages
const MEDIA_GROUP_LIMIT = 10; // Telegram hard cap per sendMediaGroup call

export class TelegramPublisher {
  private bot: Telegraf;
  private channel: string;

  constructor(botToken: string, channelUsername: string) {
    this.bot = new Telegraf(botToken);
    this.channel = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
  }

  async publishPost(text: string, mediaUrls: string[], videoUrl: string | null = null): Promise<void> {
    const caption = text.length > CAPTION_LIMIT ? `${text.slice(0, CAPTION_LIMIT - 1)}…` : text;

    if (videoUrl) {
      await withRetry(
        () => this.bot.telegram.sendVideo(this.channel, videoUrl, { caption }),
        'sendVideo',
        '[telegram]',
      );
      return;
    }

    if (mediaUrls.length === 0) {
      await withRetry(
        () => this.bot.telegram.sendMessage(this.channel, text || ' '),
        'sendMessage',
        '[telegram]',
      );
      return;
    }

    if (mediaUrls.length === 1) {
      await withRetry(
        () => this.bot.telegram.sendPhoto(this.channel, mediaUrls[0], { caption }),
        'sendPhoto',
        '[telegram]',
      );
      return;
    }

    const cappedUrls = mediaUrls.slice(0, MEDIA_GROUP_LIMIT);
    if (mediaUrls.length > MEDIA_GROUP_LIMIT) {
      console.error(`[telegram] post has ${mediaUrls.length} photos, sending only first ${MEDIA_GROUP_LIMIT}`);
    }

    const media: InputMediaPhoto[] = cappedUrls.map((url, i) => ({
      type: 'photo',
      media: url,
      ...(i === 0 ? { caption } : {}),
    }));

    await withRetry(
      () => this.bot.telegram.sendMediaGroup(this.channel, media),
      'sendMediaGroup',
      '[telegram]',
    );
  }
}
