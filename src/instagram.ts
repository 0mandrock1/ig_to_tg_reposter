import { chromium, type Browser } from 'playwright';

export interface IgPost {
  ig_id: string;
  text: string;
  media_urls: string[]; // photo URLs (empty for video posts)
  video_url: string | null; // set for reels/video posts
  taken_at: number; // unix seconds
}

interface RawMediaNode {
  id: string;
  is_video: boolean;
  video_url?: string;
  display_url: string;
  edge_media_to_caption?: { edges: Array<{ node: { text: string } }> };
  edge_sidecar_to_children?: { edges: Array<{ node: RawMediaNode }> };
  taken_at_timestamp: number;
}

function parsePost(node: RawMediaNode): IgPost {
  const text = node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';

  if (node.is_video) {
    return {
      ig_id: node.id,
      text,
      media_urls: [],
      video_url: node.video_url ?? null,
      taken_at: node.taken_at_timestamp,
    };
  }

  const mediaUrls: string[] = [];
  if (node.edge_sidecar_to_children?.edges?.length) {
    for (const { node: child } of node.edge_sidecar_to_children.edges) {
      if (!child.is_video) mediaUrls.push(child.display_url);
    }
  } else {
    mediaUrls.push(node.display_url);
  }

  return {
    ig_id: node.id,
    text,
    media_urls: mediaUrls,
    video_url: null,
    taken_at: node.taken_at_timestamp,
  };
}

/** Anonymous (logged-out) scraper of a public Instagram profile's post grid (posts + reels). */
export class InstagramClient {
  private browser: Browser | undefined;

  async login(): Promise<void> {
    await this.browser?.close();
    this.browser = await chromium.launch({ headless: true });
  }

  /**
   * Stories are intentionally not supported: Instagram requires an authenticated
   * session to view stories at all, even for public accounts, which would
   * reintroduce the login/ban-risk problem this anonymous scraper avoids.
   */
  async fetchUserPosts(targetUsername: string, limit = 20): Promise<IgPost[]> {
    if (!this.browser) throw new Error('not started - call login() first');

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const posts: IgPost[] = [];
    const seen = new Set<string>();

    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/v1/users/web_profile_info') && !url.includes('/graphql/query')) return;
      try {
        const json = await response.json();
        const user = json?.data?.user;
        const edges: Array<{ node: RawMediaNode }> =
          user?.edge_owner_to_timeline_media?.edges ?? user?.edge_felix_video_timeline?.edges ?? [];
        for (const { node } of edges) {
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          posts.push(parsePost(node));
        }
      } catch {
        // non-JSON or unrelated response, ignore
      }
    });

    try {
      await page.goto(`https://www.instagram.com/${targetUsername}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      // scroll a few times to trigger lazy-loaded pagination requests, best-effort
      for (let i = 0; i < 5 && posts.length < limit; i++) {
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(2000);
      }
    } finally {
      await context.close();
    }

    posts.sort((a, b) => b.taken_at - a.taken_at);
    return posts.slice(0, limit);
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
