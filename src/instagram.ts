import { IgApiClient, IgLoginRequiredError } from 'instagram-private-api';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_PATH = path.resolve(process.cwd(), 'ig-session.json');
const MAX_RETRIES = 3;

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

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const backoffMs = 2 ** attempt * 1000;
      console.error(`[instagram] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
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
        await withRetry(() => this.ig.account.currentUser(), 'session validation');
        this.loggedIn = true;
        return;
      } catch {
        console.error('[instagram] saved session invalid, logging in fresh');
      }
    }

    await withRetry(async () => {
      await this.ig.simulate.preLoginFlow();
      await this.ig.account.login(this.username, this.password);
    }, 'login');
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
    );
    await randomDelay();

    const feed = this.ig.feed.user(userId);
    const posts: IgPost[] = [];

    while (posts.length < limit) {
      let items;
      try {
        items = await withRetry(() => feed.items(), 'fetch feed page');
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
