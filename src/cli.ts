import 'dotenv/config';
import { Db, type PostRow } from './db.js';
import { InstagramClient, type IgMedia, type IgPostRef } from './instagram.js';
import { TelegramPublisher } from './telegram.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

function legacyMedia(post: PostRow): IgMedia[] {
  const result: IgMedia[] = [];
  if (post.video_url) {
    result.push({ kind: 'video', url: post.video_url, filename: `${post.ig_id}.mp4`, headers: {} });
  }
  const photos: string[] = JSON.parse(post.media_urls || '[]');
  photos.forEach((url, i) =>
    result.push({ kind: 'image', url, filename: `${post.ig_id}_${i + 1}.jpg`, headers: {} }),
  );
  return result;
}

async function resolveArchivedPost(ig: InstagramClient, post: PostRow, download = true) {
  if (!post.permalink) return { text: post.text, media: legacyMedia(post) };
  const ref: IgPostRef = { ig_id: post.ig_id, permalink: post.permalink };
  const resolved = await ig.fetchPost(ref, download);
  return { text: resolved.text || post.text, media: resolved.media };
}

async function postOld(db: Db, ig: InstagramClient, tg: TelegramPublisher): Promise<void> {
  const post = db.getRandomUnpostedOld();
  if (!post) {
    console.log('[cli] no unposted archive entries left');
    return;
  }
  const resolved = await resolveArchivedPost(ig, post, true);
  await tg.publishPost(resolved.text, resolved.media);
  db.markOldReposted(post.ig_id);
  console.log(`[cli] posted old post ${post.ig_id}`);
}

async function seed(db: Db, ig: InstagramClient, tg: TelegramPublisher, count: number): Promise<void> {
  const selected = db.getLatestUnpostedOld(count);
  let posted = 0;
  for (const post of [...selected].reverse()) {
    const resolved = await resolveArchivedPost(ig, post, true);
    await tg.publishPost(resolved.text, resolved.media);
    db.markOldReposted(post.ig_id);
    posted++;
    console.log(`[cli] seeded ${post.ig_id} (${posted}/${selected.length})`);
  }
  console.log(`[cli] seeded ${posted} posts`);
}

async function backfill(db: Db, ig: InstagramClient, targetAccount: string, count: number): Promise<void> {
  await ig.login();
  try {
    const refs = await ig.fetchUserPostRefs(targetAccount, count);
    let inserted = 0;
    for (const ref of refs) {
      if (db.exists(ref.ig_id)) continue;
      const post = await ig.fetchPost(ref, false);
      db.insert(post);
      inserted++;
      console.log(`[cli] archived ${post.ig_id}`);
    }
    console.log(`[cli] archived ${inserted}/${refs.length} posts (${refs.length - inserted} already known)`);
  } finally {
    await ig.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const db = new Db();
  const ig = new InstagramClient();

  try {
    if (command === 'post-old') {
      const tg = new TelegramPublisher(requireEnv('TG_BOT_TOKEN'), requireEnv('TG_CHANNEL_USERNAME'));
      await postOld(db, ig, tg);
    } else if (command === 'seed') {
      const count = Math.max(1, Number(process.argv[3] ?? 8));
      const tg = new TelegramPublisher(requireEnv('TG_BOT_TOKEN'), requireEnv('TG_CHANNEL_USERNAME'));
      await seed(db, ig, tg, count);
    } else if (command === 'backfill') {
      const count = Math.max(1, Number(process.argv[3] ?? 20));
      await backfill(db, ig, requireEnv('IG_TARGET_ACCOUNT'), count);
    } else {
      console.error('usage: cli.js <post-old|seed [count]|backfill [count]>');
      process.exitCode = 1;
    }
  } finally {
    await ig.close();
    db.close();
  }
}

main().catch((err) => {
  console.error('[cli] fatal error:', err);
  process.exit(1);
});
