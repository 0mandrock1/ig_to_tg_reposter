# ig_to_tg_reposter

Node.js/TypeScript engine для Instagram → Telegram reposting. Один codebase, окремий runtime-dir/.env/posts.db на кожен instance.

## Instagram flow

- Публічний profile discovery: logged-out Playwright через SOCKS5 Cloudflare WARP.
- З DOM беруться stable post/reel permalinks; логін, cookies та Instagram credentials не потрібні.
- Кожен permalink резолвиться через `@postfetch/core@0.12.x` за схемою Ultimate Media Manager: public page/mobile/embed/GraphQL fallbacks.
- Media завантажується самим ботом через той самий WARP path і upload-иться в Telegram як bytes, тому Instagram CDN headers/short-lived URLs не перекладаються на Telegram.
- Підтримуються single photo, reels/video та mixed photo/video carousels до Telegram media-group limit 10.

WARP endpoint задається `WARP_PROXY`; production instance очікує SOCKS5 proxy, напр. `socks5h://127.0.0.1:1080`.

## Commands

```sh
npm run build
npm run start
npm run backfill -- 20
npm run seed -- 8
npm run post-old
```

`backfill` архівує видимі пости без publish. `seed` публікує latest archived N у chronological order усередині вибраної пачки.

## Runtime model

`dist/` і `node_modules/` можуть бути shared із generic repo. Instance тримає власні `.env`, `posts.db`, PM2 config та, за потреби, WARP sidecar.
