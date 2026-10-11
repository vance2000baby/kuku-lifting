# 別肌動 — 專案說明（給 Claude Code）

個人用的手機健身紀錄 App：記錄每組重量與次數、體重與 InBody 數據，並用圖表追蹤長期進度。
原本以 claude.ai Artifact 發布，現在是可安裝到 iPhone 主畫面的 PWA，部署在 GitHub Pages。

使用者只有一位（App 擁有者本人），主要情境是在健身房組間單手操作，介面語言為繁體中文。

App 名稱是「別肌動」（2026-10-04 由「酷酷擼鐵」改名）。以下內部識別刻意沿用舊名，**不要改**：localStorage key `gymlog-v1`（改了會讀不到既有資料）、匯出格式的 `app: 'gymlog'`（舊備份要能匯入）、快取前綴 `kuku-`、repo 名稱 `kuku-lifting`（改了 Pages 網址會變，已安裝的 App 會失效）。

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

## 畫面

- **進度頁**由上到下：備份提醒 → 訓練月曆（`calendar()`）→ 時間範圍 → 每週訓練量 → 動作 → 訓練紀錄。
- **新增動作**（`openAdd()` / `drawSugg()`）：
  - 沒輸入時是瀏覽模式：部位篩選（`ui.addCat`，只列出有動作的部位）、「最近做過」（動作超過 8 個才顯示）、再按部位分組（`groupByCat()`，組內最近做過的在前）。
  - 有輸入時是搜尋模式：`matchName()` 以空白分詞、每個詞都要出現、忽略大小寫與空白。符合的動作排最前面，「建立新動作」是最下面的一行，按了才展開建立表單（`ui.creating`），部位會預設為目前篩選的部位。
  - 注音／拼音選字中（`isComposing`）不重新搜尋，等 `compositionend`。
  - Enter：名稱完全相同就加入；只有一個符合就加入那個；建立表單已展開且選了部位就建立；否則收起鍵盤。
  - 用 `openSheet(…, {tall:true, head})`：搜尋框放在標題列（`opts.head` 取代標題，標題留給讀屏），面板頂端固定在狀態列下方。拖動結果列表會收起鍵盤（像 iOS 內建搜尋）。輸入或切換部位時 `suggTop()` 把列表捲回頂端。
  - 搜尋框用 `type="search"`、提示文字不要出現「名稱」：iOS 會把疑似姓名欄位加上「自動填寫聯絡人」。鍵盤上方的 ︿﹀✓ 工具列是 iOS 自己的，網頁無法移除。
- **動作庫**（`openLib()`）同樣按部位分組。
- **Sheet 與 iOS 鍵盤**：iOS 開鍵盤時不會縮小 layout viewport，只會縮小 `visualViewport`，所以 `trackKeyboard()` 把鍵盤高度、可見高度、可見區頂端寫成 `--kb`、`--vvh`、`--vvtop`。iOS 鍵盤是半透明的，所以 sheet 一律延伸到螢幕底部（底色在鍵盤後面透出來），用 `padding-bottom: max(safe-b, --kb)` 把內容推到鍵盤上方；不要把 sheet 的 `bottom` 設成 `--kb`，鍵盤後面會透出底下的頁面，看起來像被截斷。`.sheet.tall` 頂端固定在狀態列下方，內容變多變少、鍵盤開合時都不會動；內容會隨輸入變化的 sheet 都要用 `tall`。
- **訓練月曆**：週一開頭（與 `weekKey()` 一致），有已完成組的日子（`sessionDates()`）填滿主色，點一下跳到那天的訓練頁；今天以外框標示。月份存在 `ui.calMonth`（`'YYYY-MM'`），不受時間範圍影響；最早只能往前翻到第一次訓練的月份，最晚到本月。

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

風格是**克制的 Apple Liquid Glass**：可讀性第一，玻璃只用在浮在內容上的控制層，內容層保持實心。不要加光澤、光暈、背景漸層、回彈動畫或多層玻璃；新效果若沒有改善層次就不要加。

- **Token** 都定義在 `:root`，並有 dark mode 版本（`prefers-color-scheme` 以及 `data-theme`，兩個 dark 區塊要同步修改）。
  - 顏色只能用 semantic token：`--bg --surface --surface-raised --elevated --fill --fill-2 --fill-raised --text --text-2 --text-3 --border --divider --divider-raised --primary --primary-press --on-primary --primary-soft --success --warning --warning-soft --error --disabled --press`。部位色 `--cat-*` 只用在圖表。只有一個強調色（`--primary`）。
  - `--press`：按壓／選取的淡色疊層（列、icon button、tab 選取膠囊）。`--thumb`、`--knob`：segmented 滑塊、toggle 圓鈕。
  - 浮在頁面上的表面（sheet、對話框）會把 `--fill`、`--divider` 換成 `-raised` 版本，深色模式下輸入框和分隔線才看得見。
- **材質只有兩種**（`.mat-chrome`、`.mat-overlay`）：

  | 材質 | 背景 | 模糊 | 邊緣 | 陰影 | 用途 |
  |---|---|---|---|---|---|
  | `.mat-chrome` | `--mat-chrome`（淺 70% / 深 70%） | `--mat-chrome-blur` 14px＋飽和 | 0.5px `--mat-stroke`＋1px 上緣 `--mat-highlight` | `--shadow-float` | 底部浮動面板（工具列＋分頁） |
  | `.mat-overlay` | `--mat-overlay`（94%，接近不透明） | `--mat-overlay-blur` 24px | 0.5px `--mat-stroke` | `--shadow-overlay` | sheet、對話框、toast（承載表單與文字） |

  - 內容（卡片、列表、表單、圖表、數字）一律實心，不要加材質。
  - Fallback：`prefers-reduced-transparency` 或不支援 `backdrop-filter` 時材質變實心；`prefers-contrast: more` 時邊緣加深、材質實心、`--text-3` 改用 `--text-2`。這些用 `:root:root:root` 提高權重以蓋過 dark 區塊。
- **版面層次**（由下到上）：內容 → `.edge-top`（狀態列下的漸層淡出）→ 底部面板 `.bars` → scrim → sheet → toast → 對話框。
  - `.bars` 是唯一的浮動面板：上排是工具列 `#dock`（只在訓練頁、或休息計時中出現），下排是分頁 `.tabs`。`renderTabs()` 只建一次，之後只更新 `aria-current` 和 `--tab-i`，選取膠囊 `.tab-lens` 會滑過去。
  - 高度：`--h-bars`（只有分頁）、`--h-bars-dock`（含工具列）；頁面底部留白、toast 位置都由這兩個變數和 `--tab-b` 算出，改版面時只改 token。
- **字級**：`.t-display`（32，主頁標題）/ `.t-h1`（26，詳細頁標題）/ `.t-h2`（20，動作名稱）/ `.t-h3`（17，區段標題）/ `.t-body`（17）/ `.t-callout`（15）/ `.t-caption`（13）/ `.t-label`（13 medium）。最小 13px（tab bar 標籤 12px 是唯一例外）。只有標題用粗體，層次靠字級與字重。數字加 `.num`。數值與單位之間用不換行空格（`setsText()`），避免「35 / kg×10」被拆開。字體用系統字體（iPhone 上是 SF 與蘋方）。
- **間距**：`--s1` 到 `--s8`（4、8、12、16、20、24、32、40）。
- **圓角依元件類型**：`--r-xs` 8（segmented 滑塊）、`--r-sm` 10（輸入框、chips、segmented 軌道）、`--r-md` 14（內容按鈕）、`--r-lg` 18（卡片）、`--r-xl` 24（sheet、對話框）、`--r-bar` 30（底部面板，內部膠囊同心：30 − 6 = 24）、`--r-full`（圓形與膠囊）。
- **尺寸**：`--h-control` 44（最小觸控）、`--h-input` 48、`--h-button` 50、`--h-tabrow` 50；圖示 `--icon-xs/sm/-/lg` = 18/20/22/24。
- **動態**：`--dur-1/2/3`（.15/.25/.38s）＋`--ease`（無回彈）；sheet 用 `--ease-sheet`。按壓回饋用底色或透明度，不用放大縮小（勾選圓圈的輕微縮放除外）。`prefers-reduced-motion` 時全部關閉。
- **元件**：`.btn`（primary／secondary／plain／destructive／danger）、`.iconbtn`、`.group` + `.row`、`.seg`、`.choices`、`.field`、`.unitfield`、`.toggle`、`openSheet()` / `actionSheet()`、`toast()`、`askConfirm()`、`.empty`、`.notice`。新畫面請重用這些元件。
- **表單**：兩欄 grid 一律 `repeat(2,minmax(0,1fr))`，否則輸入框的預設寬度會把右欄擠出手機畫面。日期輸入框都加 `required`（iOS 日期選擇器才不會出現「重置」），清空時會還原。
- **觸控**：觸控目標至少 44px。頁面只能垂直捲動：`html` 設定 `touch-action: manipulation` 和 `overflow-x: clip`，`.set` 設定 `touch-action: pan-y`，左滑刪除由 JS 處理。

## PWA 任務清單

狀態（2026-10-01）：1–7 已完成，8 尚未做（目前資料量很小，localStorage 足夠）。9 見下方「部署」。

1. **Manifest**：新增 `manifest.webmanifest`，內容包含 `name`、`short_name`「別肌動」、`display: standalone`、`start_url`、`scope`、`theme_color`、`background_color`（`#F6F5F2`），以及 192、512 和 maskable 圖示。
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
