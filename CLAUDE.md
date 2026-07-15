# ig_to_tg_reposter

Node.js бот: моніторить Instagram-акаунт і репостить пости (текст + фото) у Telegram-канал. Мультиінстансний — кожен екземпляр керується через `.env`. Деплой на Hetzner VPS (PM2).

**Задача (one-off):** ініціалізувати публічний GitHub репо `ig_to_tg_reposter`, скаффолдити структуру проєкту, задеплоїти на VPS у `/root/tg_bots/alyonapsy/`.

## Стек
- Node.js (ESM) + TypeScript
- Telegram: `telegraf`
- Instagram scraping: спочатку research → `instagram-private-api` або puppeteer
- SQLite: `better-sqlite3` — архів постів, стан
- PM2 для деплою

## Структура
```
src/
  instagram.ts   — scraper, збір постів (текст + всі фото)
  telegram.ts    — публікація в канал
  db.ts          — SQLite: posts(ig_id, text, media_urls, reposted_at, old_reposted_at)
  index.ts       — main loop (polling)
  cli.ts         — /post-old entrypoint
dist/            — скомпільований вихід
.env             — НЕ комітити
.env.example     — комітити
ecosystem.config.js — PM2
```

## ENV (.env.example)
```
IG_USERNAME=          # логін Instagram
IG_PASSWORD=          # пароль Instagram
IG_TARGET_ACCOUNT=    # акаунт без @ (напр. alyona_psy_kh)
TG_BOT_TOKEN=         # токен бота від @BotFather
TG_CHANNEL_USERNAME=  # @username каналу (без id — бот резолвить сам)
POLL_INTERVAL_MS=300000
```

## Команди
```
npm run build      # tsc
npm run start      # node dist/index.js
npm run dev        # ts-node src/index.ts
npm run post-old   # node dist/cli.js post-old
```

## Конвенції
- Credentials — лише через process.env, ніяких хардкодів
- Канал: відправка на `@${process.env.TG_CHANNEL_USERNAME}` — без прив'язки по id
- SQLite-стан: дублі виключаються по `ig_id`; `/post-old` виключає пости з непустим `old_reposted_at`
- Retry з exponential backoff (max 3) на всіх мережевих запитах
- Затримка між Instagram-запитами: рандом 2–5 сек
- `/post-old`: random з архіву, де `old_reposted_at IS NULL`; після репосту — оновити поле
- Graceful shutdown: SIGTERM/SIGINT → flush + close DB
- PM2: `ecosystem.config.js` з `watch: false`, `restart_delay: 5000`

## Агенти / команди
- `research-expert` — перед реалізацією scraper: порівняти `instagram-private-api` vs puppeteer, обрати + задокументувати рішення
- `typescript-expert` — архітектура модулів, типізація, ESM config
- `/checkpoint:create` — перед зміною логіки scraping або DB-схеми
- `/checkpoint:restore` — rollback
- `/code-review` — перед кожним git push
- `/validate-and-fix` — lint + fix loop
- `/git:commit` — stage + commit

## GitHub
Репо: `ig_to_tg_reposter` (публічний)
- Ініціалізувати git, додати `.gitignore` (node_modules, dist, .env, *.db)
- Перший коміт: scaffold (CLAUDE.md, .env.example, tsconfig, package.json, ecosystem.config.js)
- `git remote add origin git@github.com:<YOUR_GITHUB_USER>/ig_to_tg_reposter.git && git push -u origin main`
- Замінити `<YOUR_GITHUB_USER>` на реальний username перед push


## Reading rules / token optimization
- Читай лише релевантні файли. Спершу `/code-search` для пошуку, не сліпий обхід дерева.
- Не перечитуй CLAUDE.md — він уже в контексті.
- Не вантаж великі файли цілком, якщо вистачає фрагмента; читай по діапазону рядків.
- Не дублюй контекст і не переказуй уже відоме. Compressed prose: імператив, без вступів/підсумків, один факт — один раз.
- Перед записом — переконайся, що зміни мінімальні й точкові; не роздувай рішення.
- Мутуюча дія → звірка з реальним станом (re-read зміненого, тест), не з припущенням.
