import 'dotenv/config';
import { Db } from './db.js';
import { InstagramClient } from './instagram.js';
import { TelegramPublisher } from './telegram.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

const IG_TARGET_ACCOUNT = requireEnv('IG_TARGET_ACCOUNT');
const TG_BOT_TOKEN = requireEnv('TG_BOT_TOKEN');
const TG_CHANNEL_USERNAME = requireEnv('TG_CHANNEL_USERNAME');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 300000);

const db = new Db();
const ig = new InstagramClient();
const tg = new TelegramPublisher(TG_BOT_TOKEN, TG_CHANNEL_USERNAME);

let stopping = false;
let timer: NodeJS.Timeout | undefined;
let loopPromise: Promise<void> | undefined;

async function pollOnce(): Promise<void> {
  console.log('[index] polling instagram for new posts...');
  const posts = await ig.fetchUserPosts(IG_TARGET_ACCOUNT, 20);

  // process oldest-first so channel order matches posting order for any new batch
  for (const post of [...posts].reverse()) {
    if (stopping) return;
    if (db.exists(post.ig_id)) continue;

    try {
      await tg.publishPost(post.text, post.media_urls, post.video_url);
      db.insert(post);
      db.markReposted(post.ig_id);
      console.log(`[index] reposted ${post.ig_id}`);
    } catch (err) {
      console.error(`[index] failed to repost ${post.ig_id}: ${(err as Error).message}`);
    }
  }
}

async function loop(): Promise<void> {
  try {
    await pollOnce();
  } catch (err) {
    console.error(`[index] poll cycle failed: ${(err as Error).message}`);
    try {
      await ig.login();
      console.log('[index] restarted browser after failure');
    } catch (restartErr) {
      console.error(`[index] browser restart failed: ${(restartErr as Error).message}`);
    }
  }
  if (!stopping) {
    timer = setTimeout(() => {
      loopPromise = loop();
    }, POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  await ig.login();
  console.log('[index] browser started, starting poll loop');
  loopPromise = loop();
  await loopPromise;
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[index] received ${signal}, shutting down`);
  stopping = true;
  if (timer) clearTimeout(timer);
  if (loopPromise) await loopPromise;
  await ig.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (err) => {
  console.error('[index] fatal error:', err);
  await ig.close();
  db.close();
  process.exit(1);
});
