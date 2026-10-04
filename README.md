# 別肌動

個人健身紀錄 App：記錄組數、重量、次數，追蹤體重與 InBody，並用圖表呈現長期進度。
單一 HTML 檔案的 PWA，不需要 build，可以加到 iPhone 主畫面並離線使用。開發脈絡請見 `CLAUDE.md`。

本機預覽：

    python3 -m http.server 8000
    # 開啟 http://localhost:8000

部署：推到 GitHub 後由 GitHub Pages（main 分支根目錄）提供。每次部署前記得遞增 `sw.js` 的 `VERSION`。
