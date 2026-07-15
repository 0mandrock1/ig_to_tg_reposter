import Database from 'better-sqlite3';
import path from 'node:path';

export interface Post {
  ig_id: string;
  text: string;
  media_urls: string; // JSON-encoded string[]
  reposted_at: string | null;
  old_reposted_at: string | null;
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
        media_urls TEXT NOT NULL,
        reposted_at TEXT,
        old_reposted_at TEXT
      );
    `);
  }

  exists(igId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM posts WHERE ig_id = ?').get(igId);
    return row !== undefined;
  }

  insert(post: { ig_id: string; text: string; media_urls: string[] }): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO posts (ig_id, text, media_urls, reposted_at, old_reposted_at) VALUES (?, ?, ?, NULL, NULL)',
      )
      .run(post.ig_id, post.text, JSON.stringify(post.media_urls));
  }

  markReposted(igId: string): void {
    this.db
      .prepare('UPDATE posts SET reposted_at = ? WHERE ig_id = ?')
      .run(new Date().toISOString(), igId);
  }

  markOldReposted(igId: string): void {
    this.db
      .prepare('UPDATE posts SET old_reposted_at = ? WHERE ig_id = ?')
      .run(new Date().toISOString(), igId);
  }

  getRandomUnpostedOld(): Post | undefined {
    return this.db
      .prepare('SELECT * FROM posts WHERE old_reposted_at IS NULL ORDER BY RANDOM() LIMIT 1')
      .get() as Post | undefined;
  }

  getAllUnpostedOld(): Post[] {
    return this.db
      .prepare('SELECT * FROM posts WHERE old_reposted_at IS NULL')
      .all() as Post[];
  }

  close(): void {
    this.db.close();
  }
}
