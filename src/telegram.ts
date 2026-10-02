import { Telegraf } from 'telegraf';
import type { InputMediaPhoto, InputMediaVideo } from 'telegraf/types';
import type { IgMedia } from './instagram.js';
import { withRetry } from './retry.js';

const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;
const MEDIA_GROUP_LIMIT = 10;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function telegramMedia(media: IgMedia): string | { source: Buffer; filename: string } {
  return media.data ? { source: media.data, filename: media.filename } : media.url;
}

export class TelegramPublisher {
  private bot: Telegraf;
  private channel: string;

  constructor(botToken: string, channelUsername: string) {
    this.bot = new Telegraf(botToken);
    this.channel = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
  }

  async publishPost(text: string, media: IgMedia[]): Promise<void> {
    const caption = clip(text, CAPTION_LIMIT);

    if (media.length === 0) {
      await withRetry(
        () => this.bot.telegram.sendMessage(this.channel, clip(text || ' ', TEXT_LIMIT)),
        'sendMessage',
        '[telegram]',
      );
      return;
    }

    if (media.length === 1) {
      const item = media[0];
      if (item.kind === 'video') {
        await withRetry(
          () => this.bot.telegram.sendVideo(this.channel, telegramMedia(item), { caption }),
          'sendVideo',
          '[telegram]',
        );
      } else {
        await withRetry(
          () => this.bot.telegram.sendPhoto(this.channel, telegramMedia(item), { caption }),
          'sendPhoto',
          '[telegram]',
        );
      }
      return;
    }

    const capped = media.slice(0, MEDIA_GROUP_LIMIT);
    if (media.length > MEDIA_GROUP_LIMIT) {
      console.warn(`[telegram] post has ${media.length} media items, sending first ${MEDIA_GROUP_LIMIT}`);
    }

    const group: Array<InputMediaPhoto | InputMediaVideo> = capped.map((item, index) => ({
      type: item.kind === 'video' ? 'video' : 'photo',
      media: telegramMedia(item),
      ...(index === 0 && caption ? { caption } : {}),
    })) as Array<InputMediaPhoto | InputMediaVideo>;

    await withRetry(
      () => this.bot.telegram.sendMediaGroup(this.channel, group),
      'sendMediaGroup',
      '[telegram]',
    );
  }
}
