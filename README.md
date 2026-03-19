# ✂️ DM 裁切工具

一個用於裁切 DM 圖片商品區域的純前端工具，支援多框選取、智慧對齊參考線、批次下載 ZIP。

## 功能

- 📂 載入本地 DM 圖片
- 🖱 滑鼠拖拉框選商品區域
- ✏️ 點擊側欄直接重新命名裁切項目
- 🔲 選取後可拖移、縮放（8 個把手）
- 📐 智慧參考線吸附（Figma 風格）
- ⌥ Alt + 拖移複製框
- ↩ 復原最後一個裁切
- 🔍 縮放預覽（20% ~ 200%）
- ⬇ 單張下載 / 全部打包 ZIP 下載

## 開發

```bash
npm install
npm run dev
```


## 打包

```bash
npm run build
```

輸出至 `dist/`，可直接部署至 Netlify / Vercel / GitHub Pages。

## 技術

- [Vite](https://vitejs.dev/)
- SCSS
- [JSZip](https://stuk.github.io/jszip/)
- 原生 Canvas API
