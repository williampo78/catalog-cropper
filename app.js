import './style.scss';
import JSZip from 'jszip';

const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = document.getElementById('fileInput');
  const hint = document.getElementById('hint');
  const cropList = document.getElementById('cropList');
  const countBadge = document.getElementById('countBadge');
  const listCount = document.getElementById('listCount');
  const btnUndo = document.getElementById('btnUndo');
  const btnClearAll = document.getElementById('btnClearAll');
  const btnDownloadAll = document.getElementById('btnDownloadAll');
  const btnDownloadAll2 = document.getElementById('btnDownloadAll2');
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomLabel = document.getElementById('zoomLabel');


  let img = null;
  let scale = 1;
  let crops = []; // { name, x, y, w, h, dataUrl }
  let selectedIndex = -1;
  let activeGuides = []; // { type:'h'|'v', pos: number } 原始座標

  // 互動模式：'idle' | 'creating' | 'moving' | 'resizing'
  let mode = 'idle';
  let createStart = { x: 0, y: 0 };
  let createEnd = { x: 0, y: 0 };
  let moveOffset = { x: 0, y: 0 };
  let resizeHandle = null; // 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br'
  let resizeOrig = null;   // 調整前的快照
  let dragStartCanvas = { x: 0, y: 0 };

  const HANDLE_R = 7;    // 把手點擊偵測半徑 (canvas px)
  const HANDLE_D = 5;    // 把手繪製半徑
  const SNAP_PX = 8;     // 吸附閾值 (canvas px)

  // ── 載入圖片 ──────────────────────────────────────
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      img = new Image();
      img.onload = () => {
        scale = Math.min(1, window.innerWidth * 0.75 / img.width);
        zoomSlider.value = Math.round(scale * 100);
        zoomLabel.textContent = Math.round(scale * 100) + '%';
        resizeCanvas();
        drawCanvas();
        hint.style.display = 'none';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  // ── 縮放 ──────────────────────────────────────────
  zoomSlider.addEventListener('input', () => {
    if (!img) return;
    scale = zoomSlider.value / 100;
    zoomLabel.textContent = zoomSlider.value + '%';
    resizeCanvas();
    drawCanvas();
  });

  function applyZoom(newScale) {
    const clamped = Math.min(2, Math.max(0.2, newScale));
    scale = clamped;
    zoomSlider.value = Math.round(clamped * 100);
    zoomLabel.textContent = Math.round(clamped * 100) + '%';
    resizeCanvas();
    drawCanvas();
  }

  // Ctrl + 滾輪縮放，同時阻止瀏覽器預設縮放
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.03 : 0.03;
    applyZoom(scale + delta);
  }, { passive: false });

  function resizeCanvas() {
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
  }

  // ── 產生裁切圖 ──────────────────────────────────
  function makeCropDataUrl(x, y, w, h) {
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    return off.toDataURL('image/jpeg', 0.9);
  }

  // ── 把手座標（canvas 座標系） ──────────────────────
  function getHandles(c) {
    const cx = c.x * scale, cy = c.y * scale;
    const cw = c.w * scale, ch = c.h * scale;
    return {
      tl: { x: cx,          y: cy },
      tc: { x: cx + cw / 2, y: cy },
      tr: { x: cx + cw,     y: cy },
      ml: { x: cx,          y: cy + ch / 2 },
      mr: { x: cx + cw,     y: cy + ch / 2 },
      bl: { x: cx,          y: cy + ch },
      bc: { x: cx + cw / 2, y: cy + ch },
      br: { x: cx + cw,     y: cy + ch },
    };
  }

  function hitHandle(c, mx, my) {
    for (const [name, pos] of Object.entries(getHandles(c))) {
      if (Math.abs(mx - pos.x) <= HANDLE_R && Math.abs(my - pos.y) <= HANDLE_R) return name;
    }
    return null;
  }

  function hitCropBody(c, mx, my) {
    return mx >= c.x * scale && mx <= (c.x + c.w) * scale
        && my >= c.y * scale && my <= (c.y + c.h) * scale;
  }

  const HANDLE_CURSORS = {
    tl: 'nw-resize', tc: 'n-resize',  tr: 'ne-resize',
    ml: 'w-resize',                    mr: 'e-resize',
    bl: 'sw-resize', bc: 's-resize',  br: 'se-resize',
  };

  // ── 智慧參考線計算（Figma 風格） ────────────────────
  function computeGuides(movingIdx) {
    const c = crops[movingIdx];
    const thresh = SNAP_PX / scale; // 轉換為原始座標閾值
    const guides = [];
    const snap = { x: null, y: null };

    const ml = c.x, mt = c.y, mr2 = c.x + c.w, mb2 = c.y + c.h;
    const mcx = ml + c.w / 2, mcy = mt + c.h / 2;

    crops.forEach((other, i) => {
      if (i === movingIdx) return;
      const ol = other.x, ot = other.y, or2 = other.x + other.w, ob2 = other.y + other.h;
      const ocx = ol + other.w / 2, ocy = ot + other.h / 2;

      // ── 垂直參考線（x 軸對齊）──
      const vChecks = [
        { diff: Math.abs(ml  - ol),  pos: ol,  snapX: ol },
        { diff: Math.abs(ml  - or2), pos: or2, snapX: or2 },
        { diff: Math.abs(mr2 - ol),  pos: ol,  snapX: ol  - c.w },
        { diff: Math.abs(mr2 - or2), pos: or2, snapX: or2 - c.w },
        { diff: Math.abs(mcx - ocx), pos: ocx, snapX: ocx - c.w / 2 },
      ];
      vChecks.forEach(ch => {
        if (ch.diff < thresh) {
          guides.push({ type: 'v', pos: ch.pos });
          if (snap.x === null) snap.x = ch.snapX;
        }
      });

      // ── 水平參考線（y 軸對齊）──
      const hChecks = [
        { diff: Math.abs(mt  - ot),  pos: ot,  snapY: ot },
        { diff: Math.abs(mt  - ob2), pos: ob2, snapY: ob2 },
        { diff: Math.abs(mb2 - ot),  pos: ot,  snapY: ot  - c.h },
        { diff: Math.abs(mb2 - ob2), pos: ob2, snapY: ob2 - c.h },
        { diff: Math.abs(mcy - ocy), pos: ocy, snapY: ocy - c.h / 2 },
      ];
      hChecks.forEach(ch => {
        if (ch.diff < thresh) {
          guides.push({ type: 'h', pos: ch.pos });
          if (snap.y === null) snap.y = ch.snapY;
        }
      });
    });

    return { guides, snap };
  }

  function applySnap(c, snap) {
    if (snap.x !== null) c.x = Math.round(Math.max(0, Math.min(img.width  - c.w, snap.x)));
    if (snap.y !== null) c.y = Math.round(Math.max(0, Math.min(img.height - c.h, snap.y)));
  }

  // ── 繪製 Canvas ────────────────────────────────────
  function drawCanvas(creatingRect) {
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // ── 智慧參考線（在所有框之下繪製）──
    if (activeGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#e8116e';
      ctx.lineWidth = 1;
      activeGuides.forEach(g => {
        ctx.beginPath();
        if (g.type === 'v') {
          ctx.moveTo(g.pos * scale, 0);
          ctx.lineTo(g.pos * scale, canvas.height);
        } else {
          ctx.moveTo(0, g.pos * scale);
          ctx.lineTo(canvas.width, g.pos * scale);
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    crops.forEach((c, i) => {
      const cx = c.x * scale, cy = c.y * scale;
      const cw = c.w * scale, ch = c.h * scale;
      const isSel = i === selectedIndex;

      // 框線
      ctx.strokeStyle = isSel ? '#2ecc71' : '#e94560';
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.strokeRect(cx, cy, cw, ch);

      // 選中時背景
      if (isSel) {
        ctx.fillStyle = 'rgba(46,204,113,0.08)';
        ctx.fillRect(cx, cy, cw, ch);
      }

      // 標籤
      ctx.font = 'bold 12px sans-serif';
      const label = `${i + 1}. ${c.name}`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = isSel ? 'rgba(46,204,113,0.9)' : 'rgba(233,69,96,0.85)';
      ctx.fillRect(cx, cy - 20, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx + 5, cy - 5);

      // 把手（只有選中時顯示）
      if (isSel) {
        for (const pos of Object.values(getHandles(c))) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#2ecc71';
          ctx.lineWidth = 1.5;
          ctx.fillRect(pos.x - HANDLE_D, pos.y - HANDLE_D, HANDLE_D * 2, HANDLE_D * 2);
          ctx.strokeRect(pos.x - HANDLE_D, pos.y - HANDLE_D, HANDLE_D * 2, HANDLE_D * 2);
        }
      }
    });

    // 新建中的框
    if (creatingRect) {
      ctx.strokeStyle = '#f39c12';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(creatingRect.x, creatingRect.y, creatingRect.w, creatingRect.h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(243,156,18,0.1)';
      ctx.fillRect(creatingRect.x, creatingRect.y, creatingRect.w, creatingRect.h);
    }
  }

  // ── 調整大小邏輯 ──────────────────────────────────
  function applyResize(c, orig, handle, ddx, ddy) {
    let { x, y, w, h } = orig;
    if (handle === 'tl') { x += ddx; y += ddy; w -= ddx; h -= ddy; }
    else if (handle === 'tc') { y += ddy; h -= ddy; }
    else if (handle === 'tr') { w += ddx; y += ddy; h -= ddy; }
    else if (handle === 'ml') { x += ddx; w -= ddx; }
    else if (handle === 'mr') { w += ddx; }
    else if (handle === 'bl') { x += ddx; w -= ddx; h += ddy; }
    else if (handle === 'bc') { h += ddy; }
    else if (handle === 'br') { w += ddx; h += ddy; }

    // 最小尺寸保護
    if (w < 10) { if (['tl', 'ml', 'bl'].includes(handle)) x = orig.x + orig.w - 10; w = 10; }
    if (h < 10) { if (['tl', 'tc', 'tr'].includes(handle)) y = orig.y + orig.h - 10; h = 10; }

    // 邊界保護
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (x + w > img.width) w = img.width - x;
    if (y + h > img.height) h = img.height - y;

    c.x = x; c.y = y; c.w = w; c.h = h;
  }

  function normalizeRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  function getCanvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ── 滑鼠事件 ──────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    if (!img) return;
    const { x, y } = getCanvasPos(e);

    if (mode === 'idle') {
      // 更新游標樣式
      if (selectedIndex >= 0) {
        const h = hitHandle(crops[selectedIndex], x, y);
        if (h) { canvas.style.cursor = HANDLE_CURSORS[h]; return; }
        if (hitCropBody(crops[selectedIndex], x, y)) { canvas.style.cursor = 'move'; return; }
      }
      for (let i = crops.length - 1; i >= 0; i--) {
        if (hitCropBody(crops[i], x, y)) { canvas.style.cursor = 'move'; return; }
      }
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (mode === 'creating') {
      createEnd = { x, y };
      drawCanvas(normalizeRect(createStart.x, createStart.y, x, y));
      return;
    }

    if (mode === 'moving') {
      const c = crops[selectedIndex];
      let nx = Math.round((x - moveOffset.x) / scale);
      let ny = Math.round((y - moveOffset.y) / scale);
      nx = Math.max(0, Math.min(img.width - c.w, nx));
      ny = Math.max(0, Math.min(img.height - c.h, ny));
      c.x = nx; c.y = ny;

      // 計算智慧參考線並吸附
      const { guides, snap } = computeGuides(selectedIndex);
      applySnap(c, snap);
      activeGuides = guides;
      drawCanvas();
      return;
    }

    if (mode === 'resizing') {
      const ddx = Math.round((x - dragStartCanvas.x) / scale);
      const ddy = Math.round((y - dragStartCanvas.y) / scale);
      applyResize(crops[selectedIndex], resizeOrig, resizeHandle, ddx, ddy);
      activeGuides = [];
      drawCanvas();
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!img) return;
    const { x, y } = getCanvasPos(e);
    dragStartCanvas = { x, y };

    // 1. 先檢查已選中框的把手
    if (selectedIndex >= 0) {
      const h = hitHandle(crops[selectedIndex], x, y);
      if (h) {
        mode = 'resizing';
        resizeHandle = h;
        resizeOrig = { ...crops[selectedIndex] };
        return;
      }
    }

    // 2. Alt + 點擊框體 → 複製並拖移（類 Figma Alt+drag）
    if (e.altKey) {
      for (let i = crops.length - 1; i >= 0; i--) {
        if (hitCropBody(crops[i], x, y)) {
          const copy = { ...crops[i], name: `商品${crops.length + 1}` };
          crops.push(copy);
          selectedIndex = crops.length - 1;
          mode = 'moving';
          moveOffset = { x: x - copy.x * scale, y: y - copy.y * scale };
          drawCanvas();
          renderList();
          updateButtons();
          return;
        }
      }
    }

    // 3. 點到任何框 → 選取並移動
    for (let i = crops.length - 1; i >= 0; i--) {
      if (hitCropBody(crops[i], x, y)) {
        selectedIndex = i;
        mode = 'moving';
        moveOffset = { x: x - crops[i].x * scale, y: y - crops[i].y * scale };
        drawCanvas();
        renderList();
        return;
      }
    }

    // 4. 空白處 → 新建框
    selectedIndex = -1;
    mode = 'creating';
    createStart = { x, y };
    createEnd = { x, y };
    activeGuides = [];
    drawCanvas();
  });

  canvas.addEventListener('mouseup', () => {
    if (!img) return;

    if (mode === 'creating') {
      const rect = normalizeRect(createStart.x, createStart.y, createEnd.x, createEnd.y);
      mode = 'idle';
      if (rect.w < 10 || rect.h < 10) { drawCanvas(); return; }
      const ox = Math.round(rect.x / scale);
      const oy = Math.round(rect.y / scale);
      const ow = Math.round(rect.w / scale);
      const oh = Math.round(rect.h / scale);
      const autoName = `商品${crops.length + 1}`;
      crops.push({ x: ox, y: oy, w: ow, h: oh, dataUrl: makeCropDataUrl(ox, oy, ow, oh), name: autoName });
      selectedIndex = crops.length - 1;
      drawCanvas();
      renderList();
      updateButtons();
      // 自動進入側欄重新命名
      setTimeout(() => focusRename(selectedIndex), 80);
      return;
    }

    if (mode === 'moving' || mode === 'resizing') {
      mode = 'idle';
      activeGuides = [];
      const c = crops[selectedIndex];
      c.dataUrl = makeCropDataUrl(c.x, c.y, c.w, c.h);
      renderList();
      drawCanvas();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (mode === 'creating') { mode = 'idle'; activeGuides = []; drawCanvas(); return; }
    if (mode === 'moving' || mode === 'resizing') {
      mode = 'idle';
      activeGuides = [];
      const c = crops[selectedIndex];
      if (c) c.dataUrl = makeCropDataUrl(c.x, c.y, c.w, c.h);
      renderList();
      drawCanvas();
    }
  });

  // ESC 取消選取 / Delete 刪除選中框
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // 輸入框內不觸發
    if (e.key === 'Escape') { selectedIndex = -1; activeGuides = []; drawCanvas(); renderList(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex >= 0) {
      deleteCrop(selectedIndex);
    }
  });

  // ── 側欄清單 ──────────────────────────────────────
  function renderList() {
    if (crops.length === 0) {
      cropList.innerHTML = `<div class="empty-state"><div class="icon">✂️</div><p>尚無裁切項目<br>框選商品後會顯示在這裡</p></div>`;
      countBadge.textContent = '0';
      listCount.textContent = '0';
      return;
    }
    countBadge.textContent = crops.length;
    listCount.textContent = crops.length;
    cropList.innerHTML = crops.map((c, i) => `
      <div class="crop-item${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
        <img class="crop-thumb" src="${c.dataUrl}" alt="${c.name}" />
        <div class="crop-info">
          <input class="crop-name-input" data-index="${i}" value="${c.name.replace(/"/g, '&quot;')}" title="點擊編輯名稱" />
          <div class="crop-size">${c.w} × ${c.h} px</div>
        </div>
        <div class="crop-actions">
          <button class="icon-btn" data-action="download" data-index="${i}" title="下載">⬇</button>
          <button class="icon-btn" data-action="delete"   data-index="${i}" title="刪除">🗑</button>
        </div>
      </div>
    `).join('');
  }

  cropList.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (btn) {
      const i = parseInt(btn.dataset.index);
      if (btn.dataset.action === 'download') downloadSingle(i);
      if (btn.dataset.action === 'delete')   deleteCrop(i);
      return;
    }
    const item = e.target.closest('.crop-item');
    if (item && e.target.tagName !== 'INPUT') {
      selectedIndex = parseInt(item.dataset.index);
      drawCanvas();
      renderList();
    }
  });

  // 側欄名稱 inline 編輯
  cropList.addEventListener('input', (e) => {
    if (!e.target.classList.contains('crop-name-input')) return;
    const i = parseInt(e.target.dataset.index);
    crops[i].name = e.target.value;
    drawCanvas();
  });

  cropList.addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('crop-name-input')) return;
    const i = parseInt(e.target.dataset.index);
    selectedIndex = i;
    drawCanvas();
    // 選取全部文字方便修改
    e.target.select();
  });

  cropList.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('crop-name-input')) return;
    if (e.key === 'Enter') { e.target.blur(); canvas.focus(); }
  });

  function focusRename(i) {
    const input = cropList.querySelector(`.crop-name-input[data-index="${i}"]`);
    if (input) { input.focus(); input.select(); }
  }

  function deleteCrop(i) {
    crops.splice(i, 1);
    if (selectedIndex >= crops.length) selectedIndex = crops.length - 1;
    drawCanvas();
    renderList();
    updateButtons();
  }

  // ── 下載 ──────────────────────────────────────────
  function downloadSingle(i) {
    const c = crops[i];
    const a = document.createElement('a');
    a.href = c.dataUrl;
    a.download = `${c.name}.jpg`;
    a.click();
  }

  async function downloadAll() {
    if (crops.length === 0) return;
    const zip = new JSZip();
    const nameCount = {};
    crops.forEach((c) => {
      let filename = c.name;
      if (nameCount[filename] !== undefined) {
        nameCount[filename]++;
        filename = `${c.name}_${nameCount[filename]}`;
      } else {
        nameCount[filename] = 0;
      }
      zip.file(`${filename}.jpg`, c.dataUrl.split(',')[1], { base64: true, compression: 'DEFLATE' });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crops.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  btnDownloadAll.addEventListener('click', downloadAll);
  btnDownloadAll2.addEventListener('click', downloadAll);

  // ── 復原 / 清除 ───────────────────────────────────
  btnUndo.addEventListener('click', () => {
    if (crops.length === 0) return;
    crops.pop();
    if (selectedIndex >= crops.length) selectedIndex = crops.length - 1;
    drawCanvas();
    renderList();
    updateButtons();
  });

  btnClearAll.addEventListener('click', () => {
    if (!confirm('確定要清除所有裁切項目？')) return;
    crops = [];
    selectedIndex = -1;
    drawCanvas();
    renderList();
    updateButtons();
  });

  function updateButtons() {
    const has = crops.length > 0;
    btnUndo.disabled = !has;
    btnClearAll.disabled = !has;
    btnDownloadAll.disabled = !has;
    btnDownloadAll2.disabled = !has;
  }

