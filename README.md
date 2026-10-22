# 小遊戲大廳

## 部署

Cloudflare Git 建置維持：

- 建置指令：`npm run build`
- 部署指令：`npx wrangler deploy`

### 第一次部署

1. 安裝依賴：

   ```bash
   npm install
   ```

2. 設定必要的密鑰。可以用 `npx wrangler secret put <名稱>`，或到 Cloudflare 控制台的 Worker 設定頁新增 Secret。密鑰不要寫進 `wrangler.toml`。
3. 建置並部署：

   ```bash
   npm run build
   npx wrangler deploy
   ```

第一次部署會套用 `wrangler.toml` 裡的 `[[migrations]]`。之後不要刪掉這段設定。

### 上線後

1. 到管理頁設定辦公室密碼。
2. 把密碼給要進來的人。
3. 想開放 Telegram 登入時，用 `npx wrangler secret put TELEGRAM_BOT_TOKEN` 設定機器人權杖，在 Worker 設定加入純文字變數 `TELEGRAM_BOT_USERNAME`（機器人名稱），並在 BotFather 用 `/setdomain` 設成你的網域；沒設定就不會出現 Telegram 按鈕。
