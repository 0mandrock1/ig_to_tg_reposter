import { Telegraf } from 'telegraf';
import type { InputMediaPhoto, InputMediaVideo } from 'telegraf/types';
import type { IgMedia } from './instagram.js';
import { withRetry } from './retry.js';

const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;
const MEDIA_GROUP_LIMIT = 10;

function splitText(text: string, limit: number): [string, string] {
  if (text.length <= limit) return [text, ''];
  const boundary = text.lastIndexOf(' ', limit);
  const newline = text.lastIndexOf('\n', limit);
  const cut = Math.max(boundary, newline);
  const splitAt = cut >= Math.floor(limit * 0.75) ? cut : limit;
  return [text.slice(0, splitAt).trimEnd(), text.slice(splitAt).trimStart()];
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

  private async sendText(text: string): Promise<number[]> {
    const ids: number[] = [];
    let remaining = text;
    while (remaining) {
      const [part, rest] = splitText(remaining, TEXT_LIMIT);
      const message = await withRetry(
        () => this.bot.telegram.sendMessage(this.channel, part),
        'sendMessage',
        '[telegram]',
      );
      ids.push(message.message_id);
      remaining = rest;
    }
    return ids;
  }

  async publishPost(text: string, media: IgMedia[]): Promise<number[]> {
    const [caption, remainder] = splitText(text, CAPTION_LIMIT);

    if (media.length === 0) {
      return this.sendText(text || ' ');
    }

    if (media.length === 1) {
      const item = media[0];
      if (item.kind === 'video') {
        const message = await withRetry(
          () => this.bot.telegram.sendVideo(this.channel, telegramMedia(item), { caption }),
          'sendVideo',
          '[telegram]',
        );
        return [message.message_id, ...await this.sendText(remainder)];
      }

      const message = await withRetry(
        () => this.bot.telegram.sendPhoto(this.channel, telegramMedia(item), { caption }),
        'sendPhoto',
        '[telegram]',
      );
      return [message.message_id, ...await this.sendText(remainder)];
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

    const messages = await withRetry(
      () => this.bot.telegram.sendMediaGroup(this.channel, group),
      'sendMediaGroup',
      '[telegram]',
    );
    return [...messages.map((message) => message.message_id), ...await this.sendText(remainder)];
  }
}
