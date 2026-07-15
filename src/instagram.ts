import { IgApiClient, IgLoginRequiredError } from 'instagram-private-api';
import fs from 'node:fs';
import path from 'node:path';
import { withRetry } from './retry.js';

const SESSION_PATH = path.resolve(process.cwd(), 'ig-session.json');

export interface IgPost {
  ig_id: string;
  text: string;
  media_urls: string[];
  taken_at: number; // unix seconds
}

function randomDelay(minMs = 2000, maxMs = 5000): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InstagramClient {
  private ig = new IgApiClient();
  private loggedIn = false;

  constructor(
    private username: string,
    private password: string,
  ) {}

  async login(): Promise<void> {
    this.ig.state.generateDevice(this.username);

    if (fs.existsSync(SESSION_PATH)) {
      try {
        const saved = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
        await this.ig.state.deserialize(saved);
        await withRetry(() => this.ig.account.currentUser(), 'session validation', '[instagram]');
        this.loggedIn = true;
        return;
      } catch {
        console.error('[instagram] saved session invalid, logging in fresh');
      }
    }

    await withRetry(
      async () => {
        await this.ig.simulate.preLoginFlow();
        await this.ig.account.login(this.username, this.password);
      },
      'login',
      '[instagram]',
    );
    await this.saveSession();
    this.loggedIn = true;
  }

  private async saveSession(): Promise<void> {
    const serialized = await this.ig.state.serialize();
    delete (serialized as { constants?: unknown }).constants;
    fs.writeFileSync(SESSION_PATH, JSON.stringify(serialized), { mode: 0o600 });
  }

  /** Fetch posts for a target account (text + all photo URLs), most recent first. */
  async fetchUserPosts(targetUsername: string, limit = 20): Promise<IgPost[]> {
    if (!this.loggedIn) throw new Error('not logged in');

    const userId = await withRetry(
      () => this.ig.user.getIdByUsername(targetUsername),
      `resolve user id for ${targetUsername}`,
      '[instagram]',
    );
    await randomDelay();

    const feed = this.ig.feed.user(userId);
    const posts: IgPost[] = [];

    while (posts.length < limit) {
      let items;
      try {
        items = await withRetry(() => feed.items(), 'fetch feed page', '[instagram]');
      } catch (err) {
        if (err instanceof IgLoginRequiredError) {
          this.loggedIn = false;
        }
        throw err;
      }
      if (items.length === 0) break;

      for (const item of items) {
        const mediaUrls: string[] = [];
        if (item.carousel_media?.length) {
          for (const m of item.carousel_media) {
            const url = m.image_versions2?.candidates?.[0]?.url;
            if (url) mediaUrls.push(url);
          }
        } else {
          const url = item.image_versions2?.candidates?.[0]?.url;
          if (url) mediaUrls.push(url);
        }

        posts.push({
          ig_id: String(item.id),
          text: item.caption?.text ?? '',
          media_urls: mediaUrls,
          taken_at: item.taken_at,
        });
      }

      if (!feed.isMoreAvailable() || posts.length >= limit) break;
      await randomDelay();
    }

    return posts.slice(0, limit);
  }
}
