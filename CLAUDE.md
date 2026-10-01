# 酷酷擼鐵 — 專案說明（給 Claude Code）

個人用的手機健身紀錄 App：記錄每組重量與次數、體重與 InBody 數據，並用圖表追蹤長期進度。
原本以 claude.ai Artifact 發布，現在是可安裝到 iPhone 主畫面的 PWA，部署在 GitHub Pages。

使用者只有一位（App 擁有者本人），主要情境是在健身房組間單手操作，介面語言為繁體中文。

## 檔案結構

```
index.html             整個 App（HTML + CSS + JS 單一檔案）
sw.js                  Service Worker（app shell 快取）
manifest.webmanifest   PWA manifest
icons/                 App 圖示（180 apple-touch、192、512、maskable 512）
vendor/                Chart.js 4.4.1 UMD（本地副本，離線用）
.nojekyll              讓 GitHub Pages 直接提供檔案，不跑 Jekyll
CLAUDE.md              本文件
README.md              簡短說明
private/               個人資料備份，已列入 .gitignore，絕對不可 commit 或部署
```

`private/酷酷擼鐵備份-2026-10-01.json` 是從 Artifact 版匯出的真實資料。PWA 完成後，在 App 內「設定 → 匯入備份」匯入即可。
GitHub Pages 的 repo 是公開的，任何個人資料檔都不能放進 repo。

## 架構

- 單一 `index.html`，沒有 build step，沒有框架。
- 畫面以 template string 產生，狀態改變後呼叫 `render()` 整頁重繪；只有輸入中的即時更新走 `refreshLive(i)`，避免輸入框失去焦點。
- 互動一律用 event delegation：元素帶 `data-act="..."`，由 `document.body` 上的單一 click handler 的 `switch(act)` 分派。新增互動時沿用這個模式。
- 全域狀態：`S`（持久資料）與 `ui`（畫面狀態，不存檔）。
- 圖表用 Chart.js 4.4.1（UMD），從 `vendor/chart.umd.min.js` 載入，不依賴網路。

### 儲存層（`initStore()`）

`store` 是一個 adapter，提供 `load / saveMeta / saveSession / delSession / saveBody / delBody`。

- 目前只有 local 實作：`localStorage` key `gymlog-v1`，整個 `S` 序列化存成一個值。寫入失敗會丟出例外（例如 `QuotaExceededError`）。
- 寫入經 `queue(key, fn)` 做 500ms debounce，成功時不提示，失敗才顯示 toast。`flushSaves()` 會立即寫入所有待寫入的資料；App 進入背景、套用新版重新載入之前都會呼叫。
- 啟動時呼叫 `navigator.storage.persist()`。
- 換成 IndexedDB 時，只要換掉 `initStore()` 裡的實作，維持同一組介面。
- localStorage 另外有一個 `gymlog-backup-snooze`，存備份提醒「稍後」到哪一天（這台裝置的便利設定，不屬於 `S`）。

### PWA 與 Service Worker

- `manifest.webmanifest` 的 `start_url`、`scope`、`id` 都是 `./`，圖示路徑也都是相對路徑，所以不管 GitHub Pages 的子路徑（`/<repo>/`）是什麼都能用。新增路徑時一律用相對路徑，不要用 `/` 開頭。
- `sw.js`：install 時以 `cache: 'reload'` 預先快取 `SHELL` 清單，cache-first；導覽請求一律回傳快取的 `index.html`；activate 時刪除其他 `kuku-*` 快取。沒有 `skipWaiting()` / `clients.claim()`，新版要等頁面同意才接手。
- 更新流程（`initSW()`）：App 開著時發現新版 → toast「有新版本／重新載入」，按下後送 `skipWaiting` 給等待中的 worker，`controllerchange` 時先 `flushSaves()` 再重新載入。若新版在 App 關著時就裝好了，下次開啟時自動套用。iOS 從背景回到前景不會重新導覽，所以 `visibilitychange` 時也會呼叫 `reg.update()`。
- **每次部署前都要遞增 `sw.js` 的 `VERSION`**（只要有任何檔案改動）。cache-first 代表不改版本號，使用者就永遠拿到舊檔案。新增需要離線使用的檔案時，也要加進 `SHELL`。
- iOS 設定：`apple-mobile-web-app-status-bar-style` 用 `default`（內容不會跑到狀態列底下；`black-translucent` 的白色狀態列文字在淺色背景上看不見）。

## 資料模型

```js
S = {
  meta: {
    v: 4,                 // schema 版本，見 migrate()
    unit: 'kg' | 'lb',    // 顯示單位（只影響顯示）
    height: 175,          // cm，用於 BMI
    rest: 90,             // 預設組間休息秒數
    autoRest: false,      // 完成一組後是否自動計時
    lastBackup?: ISO,     // 最後一次匯出備份的時間（匯入備份時，若備份的 exported 較新也會更新）
    exercises: {
      [name]: {
        cat: '腿'|'背'|'胸'|'肩'|'手臂'|'核心'|'其他',
        unit: 'kg'|'lb',                       // 新組的預設單位
        load: 'single'|'double'|'assist',      // 重量計算方式
        sides: 1|2,                            // 舊欄位，與 load 同步保留
        rest?: 120,                            // 個別休息秒數
        note?: '座位5…'
      }
    }
  },
  sessions: {             // key = 'YYYY-MM-DD'
    [date]: { date, items: [ { name, sets: [ { w, r, u, done?, add? } ] } ] }
  },
  body: {                 // key = 'YYYY-MM-DD'
    [date]: { date, weight?, fatPct?, muscle?, fatMass?, visceral?, bmr? }
  }
}
```

- `w` 是使用者輸入的原始數字，`u` 是那一組的單位。重量類身體數據（weight、muscle、fatMass）一律以 **kg** 儲存。
- `migrate()`：v3 強制 `autoRest=false`；v4 加入 `done` 旗標（舊資料凡有次數的組都標為完成）；每次啟動清除「沒有任何紀錄、也沒有備註」的孤兒動作。修改 schema 時遞增 `v`，並在 `migrate()` 補遷移。
- 匯出格式：`{ app: 'gymlog', version, exported, meta, sessions, body }`。匯入時會檢查 `app === 'gymlog'`，並以合併方式寫入。
- 匯出：支援 `navigator.canShare({ files })` 時用 `navigator.share`（iOS 分享選單 → 儲存到「檔案」），否則退回 Blob 下載。使用者取消分享不算備份。
- 備份提醒：`backupDue()` 在超過 14 天沒備份時成立（從沒備份過就從最早一筆紀錄起算）。設定頁顯示「上次備份」，逾期時改用 warning 色；`backupNotice()` 只出現在「進度」和「身體」頁，不會在訓練中打擾，按「稍後」隱藏 3 天。

## 領域規則（改動時務必維持）

- **單位**：所有計算先用 `setKg(x)` 換成 kg，顯示時再用 `fromKg()` 轉成顯示單位。每一組可以有不同單位。
- **重量計算類型**
  - `single`：實際重量。
  - `double`：輸入單邊重量，訓練量 ×2；最重一組、PR、1RM 用單邊重量比較。
  - `assist`：輸入機器輔助重量，實際負荷＝當天體重−輔助（`x.add` 為 true 時改為體重＋負重）。體重取 `bwOn(date)`：當天或之前最近一筆，沒有的話取最早一筆。
- **完成狀態**：只有 `done && r` 的組才計入訓練量、歷史、PR（`isDone()`）。新增的組是空的，灰色 placeholder 由 `placeholder()` 動態計算：同一次訓練的上一組，否則取上次訓練的同一組。按完成時，空欄位會自動帶入 placeholder 的值。
- **PR**：已完成的組，實際負荷大於這個動作「今天以前」的最重一組。
- **估算 1RM**：Epley 公式 `w × (1 + r/30)`，r = 1 時就等於 w。
- **刪除**：從今天移除動作時，如果這個動作在其他天都沒出現過，就一併從動作庫移除。刪除操作都附有 toast「復原」。
- **原生對話框**：`confirm()`、`alert()` 在 Artifact 的 iframe 裡會被擋，所以全部改用 `askConfirm()`。PWA 雖然能用原生對話框，但為了一致性繼續沿用。

## Design system（請遵守，不要寫死數值）

- **Token** 都定義在 `:root`，並有 dark mode 版本（`prefers-color-scheme` 以及 `data-theme`）。顏色只能用 semantic token：`--bg --surface --elevated --fill --fill-2 --text --text-2 --text-3 --border --divider --primary --on-primary --primary-soft --success --warning --error --disabled`。部位色 `--cat-*` 只用在圖表。
- **字級**：使用 `.t-display / .t-h1 / .t-h2 / .t-h3 / .t-body / .t-callout / .t-caption / .t-label`，最小 13px（tab bar 標籤 12px 是唯一例外）。數字加 `.num`（tabular-nums）。字體一律用系統字體。
- **間距**：`--s1` 到 `--s8`（4、8、12、16、20、24、32、40）。
- **圓角**：只有 `--r-sm` 10、`--r-md` 14、`--r-lg` 20，`--r-full` 只給圓形元素用。
- **陰影**：`--e1` 只用在浮在內容上的層（sheet、對話框、toast），內容區保持平面。
- **元件**：`.btn`（primary／secondary／plain／destructive）、`.group` + `.row`（列表）、`.seg`（segmented control）、`.choices`、`.field`、`.unitfield`、`.toggle`、`openSheet()` / `actionSheet()`、`toast()`、`askConfirm()`、`.empty`。新畫面請重用這些元件。
- **觸控**：觸控目標至少 44px。頁面只能垂直捲動：`html` 設定 `touch-action: manipulation` 和 `overflow-x: clip`，`.set` 設定 `touch-action: pan-y`，左滑刪除由 JS 處理。

## PWA 任務清單

狀態（2026-10-01）：1–7 已完成，8 尚未做（目前資料量很小，localStorage 足夠）。9 見下方「部署」。

1. **Manifest**：新增 `manifest.webmanifest`，內容包含 `name`、`short_name`「酷酷擼鐵」、`display: standalone`、`start_url`、`scope`、`theme_color`、`background_color`（`#F6F5F2`），以及 192、512 和 maskable 圖示。
2. **iOS 設定**：在 `<head>` 加入 `apple-touch-icon`（180×180）、`apple-mobile-web-app-capable`、`apple-mobile-web-app-title`、`apple-mobile-web-app-status-bar-style`。
3. **App 圖示**：需要重新設計，建議簡潔、使用主色深綠。
4. **Service Worker**：app shell 採 cache-first 策略，快取名稱要帶版本號，更新時清除舊快取。發現新版時提示使用者重新載入，或在下次開啟時自動套用。
5. **Chart.js 本地化**：放進 repo（例如 `vendor/chart.umd.min.js`），讓 App 完全離線可用。
6. **移除 Artifact runtime 依賴**：
   - `initStore()` 的 db 分支。
   - `exportData()` 裡的 `claude.use('downloads')`：改成 `navigator.share({ files })`（iOS 會叫出分享選單，可存到「檔案」App），不支援時再退回 Blob 下載。
7. **儲存持久化**：啟動時呼叫 `navigator.storage.persist()`。在設定頁顯示最後備份時間，超過 14 天沒備份就在適當時機提醒。
8. **（可選）儲存空間升級**：資料量變大時，從 localStorage 換成 IndexedDB。保持 `store` adapter 的介面不變。
9. **部署**：用 GitHub Pages，把 `private/` 以外的檔案推上 repo，並確認 `start_url` 和 `scope` 跟 Pages 的子路徑一致。

## 驗收（iPhone 實機）

- 用 Safari「加入主畫面」後，以全螢幕開啟，沒有網址列；安全區域（瀏海、Home 指示條）沒有遮到內容。
- 開飛航模式還能打開並記錄，恢復網路後也正常。
- 匯入 `private/` 裡的備份後，9/30 的引體向上實際負荷顯示為 17 kg（71 − 54）。
- 完成一組、自動帶入上次數字、PR、左滑刪除與復原、休息計時、kg／lb 切換、深色模式都正常。
- 頁面不會左右滑動，連點按鈕不會觸發放大。
