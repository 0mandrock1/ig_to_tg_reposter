import Database from 'better-sqlite3';
import path from 'node:path';
import type { IgPost } from './instagram.js';

export interface PostRow {
  ig_id: string;
  text: string;
  media_urls: string;
  video_url: string | null;
  media_json: string | null;
  permalink: string | null;
  taken_at: number | null;
  reposted_at: string | null;
  old_reposted_at: string | null;
  tg_message_ids: string | null;
}

export class Db {
  private db: Database.Database;

  constructor(dbPath = path.resolve(process.cwd(), 'posts.db')) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        ig_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        media_urls TEXT NOT NULL DEFAULT '[]',
        video_url TEXT,
        media_json TEXT,
        permalink TEXT,
        taken_at INTEGER,
        reposted_at TEXT,
        old_reposted_at TEXT,
        tg_message_ids TEXT
      );
    `);

    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>).map((row) => row.name),
    );
    const additions: Array<[string, string]> = [
      ['video_url', 'TEXT'],
      ['media_json', 'TEXT'],
      ['permalink', 'TEXT'],
      ['taken_at', 'INTEGER'],
      ['tg_message_ids', 'TEXT'],
    ];
    for (const [name, type] of additions) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
    }
  }

  exists(igId: string): boolean {
    return this.db.prepare('SELECT 1 FROM posts WHERE ig_id = ?').get(igId) !== undefined;
  }

  insert(post: IgPost): void {
    const imageUrls = post.media.filter((item) => item.kind === 'image').map((item) => item.url);
    const firstVideo = post.media.find((item) => item.kind === 'video')?.url ?? null;
    const mediaJson = JSON.stringify(
      post.media.map(({ kind, url, filename, headers }) => ({ kind, url, filename, headers })),
    );
    this.db
      .prepare(`
        INSERT OR IGNORE INTO posts
          (ig_id, text, media_urls, video_url, media_json, permalink, taken_at, reposted_at, old_reposted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `)
      .run(
        post.ig_id,
        post.text,
        JSON.stringify(imageUrls),
        firstVideo,
        mediaJson,
        post.permalink,
        post.taken_at || null,
      );
  }

  markReposted(igId: string): void {
    this.db.prepare('UPDATE posts SET reposted_at = ? WHERE ig_id = ?').run(new Date().toISOString(), igId);
  }

  markOldReposted(igId: string): void {
    this.db.prepare('UPDATE posts SET old_reposted_at = ? WHERE ig_id = ?').run(new Date().toISOString(), igId);
  }

  setTelegramMessageIds(igId: string, messageIds: number[]): void {
    this.db.prepare('UPDATE posts SET tg_message_ids = ? WHERE ig_id = ?').run(JSON.stringify(messageIds), igId);
  }

  getRandomUnpostedOld(): PostRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM posts WHERE old_reposted_at IS NULL AND reposted_at IS NULL ORDER BY RANDOM() LIMIT 1',
      )
      .get() as PostRow | undefined;
  }

  getLatestUnpostedOld(limit: number): PostRow[] {
    return this.db
      .prepare(`
        SELECT * FROM posts
        WHERE old_reposted_at IS NULL AND reposted_at IS NULL
        ORDER BY COALESCE(taken_at, 0) DESC, rowid DESC
        LIMIT ?
      `)
      .all(limit) as PostRow[];
  }

  close(): void {
    this.db.close();
  }
}
