import 'dotenv/config';
import { Db } from './db.js';
import { InstagramClient } from './instagram.js';
import { TelegramPublisher } from './telegram.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

async function postOld(db: Db, tg: TelegramPublisher): Promise<void> {
  const post = db.getRandomUnpostedOld();
  if (!post) {
    console.log('[cli] no unposted archive entries left');
    return;
  }
  const mediaUrls: string[] = JSON.parse(post.media_urls);
  await tg.publishPost(post.text, mediaUrls, post.video_url);
  db.markOldReposted(post.ig_id);
  console.log(`[cli] posted old post ${post.ig_id}`);
}

/** Fetch historical posts from Instagram into the local archive without posting them. */
async function backfill(db: Db, ig: InstagramClient, targetAccount: string, count: number): Promise<void> {
  await ig.login();
  try {
    const posts = await ig.fetchUserPosts(targetAccount, count);
    let inserted = 0;
    for (const post of posts) {
      if (db.exists(post.ig_id)) continue;
      db.insert(post);
      inserted++;
    }
    console.log(`[cli] archived ${inserted}/${posts.length} posts (${posts.length - inserted} already known)`);
  } finally {
    await ig.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const db = new Db();

  try {
    if (command === 'post-old') {
      const tg = new TelegramPublisher(requireEnv('TG_BOT_TOKEN'), requireEnv('TG_CHANNEL_USERNAME'));
      await postOld(db, tg);
    } else if (command === 'backfill') {
      const count = Number(process.argv[3] ?? 20);
      const ig = new InstagramClient();
      await backfill(db, ig, requireEnv('IG_TARGET_ACCOUNT'), count);
    } else {
      console.error('usage: cli.js <post-old|backfill [count]>');
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('[cli] fatal error:', err);
  process.exit(1);
});
