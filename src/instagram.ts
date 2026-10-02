import { downloadBlob, postfetch } from '@postfetch/core';
import fetch from 'node-fetch';
import { chromium, type Browser } from 'playwright';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type IgMediaKind = 'image' | 'video';

export interface IgPostRef {
  ig_id: string;
  permalink: string;
}

export interface IgMedia {
  kind: IgMediaKind;
  url: string;
  filename: string;
  headers: Record<string, string>;
  data?: Buffer;
}

export interface IgPost extends IgPostRef {
  text: string;
  media: IgMedia[];
  taken_at: number;
}

const DEFAULT_WARP_PROXY = 'socks5h://127.0.0.1:1080';
const MAX_MEDIA_BYTES = 50_000_000;
const PROFILE_SETTLE_MS = 8_000;

function headersToRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;
  if (typeof (value as { forEach?: unknown }).forEach === 'function') {
    (value as { forEach: (cb: (v: string, k: string) => void) => void }).forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }
  if (Array.isArray(value)) {
    for (const [k, v] of value as Array<[string, string]>) result[k] = v;
    return result;
  }
  for (const [k, v] of Object.entries(value as Record<string, string>)) result[k] = String(v);
  return result;
}

function postRefFromHref(href: string): IgPostRef | null {
  const match = href.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const [, kind, code] = match;
  const canonicalKind = kind === 'reels' ? 'reel' : kind;
  return {
    ig_id: code,
    permalink: `https://www.instagram.com/${canonicalKind}/${code}/`,
  };
}

/**
 * Public Instagram reader.
 *
 * Discovery is done in a logged-out Chromium session behind the same WARP path
 * used by ultimate-media-manager. Individual post resolution is delegated to
 * @postfetch/core, which tries Instagram's public page/mobile/embed/GraphQL
 * fallbacks and returns normalized ordered media.
 */
export class InstagramClient {
  private browser: Browser | undefined;
  private readonly proxyUrl: string;
  private readonly proxyAgent: SocksProxyAgent;
  private readonly warpFetch: typeof globalThis.fetch;

  constructor(proxyUrl = process.env.WARP_PROXY ?? DEFAULT_WARP_PROXY) {
    this.proxyUrl = proxyUrl;
    this.proxyAgent = new SocksProxyAgent(proxyUrl);
    this.warpFetch = (async (input: any, init?: any) => {
      const normalizedInput =
        typeof input === 'string' || input instanceof URL ? input : input?.url ?? String(input);
      const response = await fetch(normalizedInput, {
        ...(init as object),
        agent: this.proxyAgent,
      } as Parameters<typeof fetch>[1]);
      return response as unknown as Response;
    }) as typeof globalThis.fetch;
  }

  async login(): Promise<void> {
    await this.browser?.close();
    const playwrightProxy = this.proxyUrl.replace(/^socks5h:/, 'socks5:');
    this.browser = await chromium.launch({
      headless: true,
      proxy: { server: playwrightProxy },
    });
  }

  async fetchUserPostRefs(targetUsername: string, limit = 20): Promise<IgPostRef[]> {
    if (!this.browser) throw new Error('not started - call login() first');

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();

    try {
      await page.goto(`https://www.instagram.com/${targetUsername}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(PROFILE_SETTLE_MS);

      if (/\/accounts\/login\/?/.test(page.url())) {
        throw new Error('Instagram redirected profile discovery to login');
      }

      const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href')).filter((href): href is string => Boolean(href)),
      );

      const refs: IgPostRef[] = [];
      const seen = new Set<string>();
      for (const href of hrefs) {
        const ref = postRefFromHref(href);
        if (!ref || seen.has(ref.ig_id)) continue;
        seen.add(ref.ig_id);
        refs.push(ref);
        if (refs.length >= limit) break;
      }

      if (refs.length === 0) {
        throw new Error(`Instagram profile loaded but no post permalinks were discovered for ${targetUsername}`);
      }

      return refs;
    } finally {
      await context.close();
    }
  }

  async fetchPost(ref: IgPostRef, downloadMedia = false): Promise<IgPost> {
    const result = await postfetch(ref.permalink, {
      fetch: this.warpFetch,
      preferredWidth: 1080,
      tryMaxBytes: MAX_MEDIA_BYTES,
    });

    const media: IgMedia[] = [];
    for (const item of result.items) {
      if (item.kind !== 'image' && item.kind !== 'video') continue;
      let data: Buffer | undefined;
      if (downloadMedia) {
        const blob = await downloadBlob(item, { fetch: this.warpFetch });
        data = Buffer.from(await blob.arrayBuffer());
      }
      media.push({
        kind: item.kind,
        url: item.url,
        filename: item.filename,
        headers: headersToRecord(item.headers),
        ...(data ? { data } : {}),
      });
    }

    const createdAt = result.metadata?.createdAt;
    const takenAtMs = createdAt ? Date.parse(createdAt) : NaN;

    return {
      ig_id: result.id || ref.ig_id,
      permalink: ref.permalink,
      text: result.metadata?.text ?? '',
      media,
      taken_at: Number.isFinite(takenAtMs) ? Math.floor(takenAtMs / 1000) : 0,
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}
