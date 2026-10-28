# mini-office 開發規範

小遊戲大廳 + 多人 3D 虛擬辦公室，跑在 Cloudflare Workers（靜態檔 + 一個 SQLite Durable Object）。

## 隱私與作者

- 這是個人專案：程式碼、文件、commit、PR 不得出現任何公司資訊（公司名、網域、內部系統、工作信箱、本機絕對路徑）。
- Commit 作者一律是 `Naco <44918604+NacoHayashi@users.noreply.github.com>`，用 repo-local `git config` 設定，不可用其他信箱。
- commit 前先確認 `git config user.email` 是上面這個信箱。

## 專案結構

- `games/*.html`：各小遊戲的獨立原始檔，可單獨開啟。
- `games/bbq.html`：燒肉屋原始檔，**不要修改**。
- `src/games.json`：大廳卡片與記分設定清單。
- `scripts/build.mjs`：由 `games/` 產生 `public/games/index.html`（產物，不要手改）。
- `scripts/bundle-office.mjs`、`scripts/office-*.mjs`：打包辦公室用的 three.js 擴充到 `public/office/vendor/`。
- `src/index.ts`：Worker 進入點與路由分派。
- `src/office-room.ts`：辦公室 Durable Object 進入點（請求分派、WebSocket、移動、聊天、外觀）。
- `src/room-*.ts`：辦公室 Durable Object 依功能分開的部分：`room-base`（共用狀態與儲存）、`room-login`（登入、配對、訪客）、`room-admin`（管理頁）、`room-scores`（分數）、`room-seats`（椅子）、`room-toys`（玩具、碰撞）、`room-snacks`（零食、廁所）、`room-whisper`（悄悄話）、`room-furniture`（擺設編輯）。
- `src/content.ts`：地圖、角色造型、家具定義與輸入正規化。
- `src/migrations.ts`：資料表結構、版本遷移、備份與還原。
- `src/snacks.ts`：零食櫃與販賣機庫存。
- `src/pairing.ts`、`src/admin-session.ts`、`src/crypto.ts`、`src/http.ts`：裝置配對、管理員工作階段、共用工具。
- `public/office/game.js`：辦公室前端進入點（畫面迴圈、版面、啟動）；同目錄依功能分檔：`office-state.js`（共用狀態）、`net.js`（連線）、`login.js`、`movement.js`、`input.js`、`interact.js`、`edit-mode.js`、`whisper.js`、`people.js`、`chat.js`、`actions.js`、`arcade.js`、`look-editor.js`、`debug.js`。
- `public/office/world3d.js`：3D 場景主體與繪製；`world-*.js` 分別是材質、房間、家具、角色、名牌、預覽、鏡頭。
- `public/office/avatar.js`：角色外型、配件與動作。
- `public/office/furnish.js`：載入 Kenney GLB 家具。
- `public/office/toon.js`：卡通材質與家具描邊。
- `public/office/snacks.js`、`public/office/lala.js`：零食互動、Lala 櫃檯人員朝向。
- `public/office/monitors.js`：有人坐在桌前時那張桌子的螢幕亮起，起身就暗。
- `panel/`：管理頁的頁面、腳本與樣式；`public/office/office.css`：辦公室樣式。
- `public/office/vendor/`：打包好的第三方程式，不要手改。
- `tests/unit.mjs`、`tests/office.e2e.mjs`、`tests/lobby.e2e.mjs`：單元、辦公室 e2e、大廳 e2e。

## 架構

- 不引入前後端框架（React、Vue、Express 等），維持原生 JS + TypeScript Worker。
- 拆模組時一個功能一個檔案，不要切成很多小檔。
- 只用 SQLite Durable Object，不用 KV、D1 或 key-value 後端；不刪既有 migration。
- 新增遊戲：`games/<id>.html` + `src/games.json` 一筆，再 `npm run build`，兩者與產物一起提交。

## 部署

- main 會自動部署到 Cloudflare Workers，main 必須隨時可部署。
- 未完成或未通過檢查的變更不得進 main。

## 開 PR 前檢查

依序執行，全部通過才開 PR：

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`（之後 `public/games/index.html` 與 `games/bbq.html` 不可有未提交差異）
- `npm run test:e2e:ci`
- 動到大廳或遊戲時，另跑 `node tests/lobby.e2e.mjs`（CI 也會跑）。

## PR 與文件

- 一個 PR 一個 squash commit，標題為繁中短句。
- PR 描述每個功能一句繁中。
- PR 描述、README、commit 不寫 API endpoint、密碼編碼方式或任何資安實作細節。
- README 只寫部署步驟。

## 美術

- 角色為 Chiikawa 風格，眼睛是黑色圓點。
- 角色不加黑色外框；家具外框可保留。
- 3D 家具用 Kenney 或同風格 CC0 GLB，透過 `public/office/furnish.js` 載入，並在 `public/office/assets/kenney/LICENSE.txt` 註明來源與授權。
- 不要用方塊堆疊代替現成模型；找不到現成模型就不改。

## UI

- 圓角與 padding 全站一致且適中。
- 手機友善：觸控目標夠大、版面不溢出、不依賴 hover。
- 頂部導覽列左右分開浮動，兩邊高度、padding、圓角一致。
- 圖示按鈕為同尺寸正方形。

## 操作

- 桌機：左鍵拖曳旋轉視角；往下拖更俯視、往上拖更貼地；不提供右鍵拖曳。
- 手機：單指滑動轉視角、搖桿控制移動、雙指縮放。
- 坐著時仍可轉動與縮放視角，不會因此站起。
- 按 T 進入聊天。

## 連線與帳號

- 登入後的動作（改名、換角色、排行榜、送分數）盡量走已建立的 WebSocket，不另開 HTTP 請求。
- 同一 ID 可同時在多台裝置登入。
- 「下班」會登出該 ID 的所有裝置。

## Cursor Cloud specific instructions

- Node.js 22。`npm ci` 之後再跑 `npx playwright install --with-deps chromium`，端對端測試才找得到瀏覽器。
- 本機伺服器是 `npm run dev`。沒有 `.dev.vars` 就從 `.dev.vars.example` 複製。預設埠 8787。
- `npm run test:e2e:ci` 會自己再起一台伺服器，同樣用 8787。開發伺服器已在聽這個埠時，先停掉，或改設 `E2E_PORT`。
