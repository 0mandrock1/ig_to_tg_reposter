import { Telegraf } from 'telegraf';
import type { InputMediaPhoto, InputMediaVideo } from 'telegraf/types';
import type { IgMedia } from './instagram.js';
import { withRetry } from './retry.js';

const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;
const MEDIA_GROUP_LIMIT = 10;

function splitTelegramText(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > TEXT_LIMIT) {
    const window = remaining.slice(0, TEXT_LIMIT);
    const minimum = Math.floor(TEXT_LIMIT / 2);
    let cut = window.lastIndexOf('\n\n');
    if (cut < minimum) cut = window.lastIndexOf('\n');
    if (cut < minimum) {
      const sentences = [...window.matchAll(/[.!?…](?=\s)/gu)];
      cut = sentences.length ? sentences[sentences.length - 1].index + 1 : -1;
    }
    if (cut < minimum) cut = window.lastIndexOf(' ');
    if (cut < minimum) cut = TEXT_LIMIT;
    if (cut < remaining.length && /[\uD800-\uDBFF]/u.test(remaining[cut - 1])) cut--;

    parts.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

export function planPostText(text: string, hasMedia: boolean): { caption: string; messages: string[] } {
  const fullText = text.trim();
  if (hasMedia && fullText.length <= CAPTION_LIMIT) {
    return { caption: fullText, messages: [] };
  }
  return {
    caption: '',
    messages: splitTelegramText(fullText || (hasMedia ? '' : ' ')),
  };
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

  async publishPost(text: string, media: IgMedia[]): Promise<number[]> {
    const { caption, messages } = planPostText(text, media.length > 0);
    const sentIds: number[] = [];

    try {
      if (media.length === 1) {
        const item = media[0];
        const message = item.kind === 'video'
          ? await withRetry(
              () => this.bot.telegram.sendVideo(this.channel, telegramMedia(item), { caption }),
              'sendVideo',
              '[telegram]',
            )
          : await withRetry(
              () => this.bot.telegram.sendPhoto(this.channel, telegramMedia(item), { caption }),
              'sendPhoto',
              '[telegram]',
            );
        sentIds.push(message.message_id);
      } else if (media.length > 1) {
        const capped = media.slice(0, MEDIA_GROUP_LIMIT);
        if (media.length > MEDIA_GROUP_LIMIT) {
          console.warn(`[telegram] post has ${media.length} media items, sending first ${MEDIA_GROUP_LIMIT}`);
        }
        const group: Array<InputMediaPhoto | InputMediaVideo> = capped.map((item, index) => ({
          type: item.kind === 'video' ? 'video' : 'photo',
          media: telegramMedia(item),
          ...(index === 0 && caption ? { caption } : {}),
        })) as Array<InputMediaPhoto | InputMediaVideo>;
        const sent = await withRetry(
          () => this.bot.telegram.sendMediaGroup(this.channel, group),
          'sendMediaGroup',
          '[telegram]',
        );
        sentIds.push(...sent.map((message) => message.message_id));
      }

      for (const part of messages) {
        const message = await withRetry(
          () => this.bot.telegram.sendMessage(this.channel, part),
          'sendMessage',
          '[telegram]',
        );
        sentIds.push(message.message_id);
      }
      return sentIds;
    } catch (error) {
      for (const id of sentIds.reverse()) {
        try {
          await this.bot.telegram.deleteMessage(this.channel, id);
        } catch (cleanupError) {
          console.error(`[telegram] failed to clean up message ${id}: ${(cleanupError as Error).message}`);
        }
      }
      throw error;
    }
  }
}
