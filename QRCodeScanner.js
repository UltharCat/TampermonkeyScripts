// ==UserScript==
// @name         网页二维码识别与解析工具 (QR Code Scanner)
// @namespace    https://github.com/tampermonkey-qr-scanner
// @version      1.0.0
// @description  全能网页二维码扫描解析：支持 Alt+点击图片快速识别、鼠标悬浮微标识别、Ctrl+V 截图粘贴识别、拖拽图片识别、上传本地图片识别及批量扫描本页所有二维码。
// @author       Assistant
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = 'tm-qr-scan-';

    /* ========================================================
       1. 注入样式
       ======================================================== */
    const styles = `
        .${PREFIX}toast {
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(30, 41, 59, 0.95);
            color: #ffffff;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
            z-index: 2147483647;
            opacity: 0;
            pointer-events: none;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .${PREFIX}toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* 模态框遮罩 */
        .${PREFIX}modal-mask {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483646;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
        .${PREFIX}modal-mask.show {
            opacity: 1;
            pointer-events: auto;
        }

        /* 模态框主体 */
        .${PREFIX}modal {
            background: #ffffff;
            color: #1e293b;
            width: 90%;
            max-width: 480px;
            border-radius: 16px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transform: scale(0.95);
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .${PREFIX}modal-mask.show .${PREFIX}modal {
            transform: scale(1);
        }

        /* 模态框头部 */
        .${PREFIX}modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid #f1f5f9;
        }
        .${PREFIX}modal-title {
            font-size: 16px;
            font-weight: 600;
            color: #0f172a;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .${PREFIX}modal-close {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 20px;
            line-height: 1;
            color: #94a3b8;
            padding: 4px;
            border-radius: 6px;
            transition: background 0.15s, color 0.15s;
        }
        .${PREFIX}modal-close:hover {
            color: #0f172a;
            background: #f1f5f9;
        }

        /* 模态框内容 */
        .${PREFIX}modal-body {
            padding: 20px;
            max-height: 65vh;
            overflow-y: auto;
        }
        .${PREFIX}preview-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            background: #f8fafc;
            border-radius: 8px;
            padding: 12px;
            border: 1px dashed #cbd5e1;
        }
        .${PREFIX}preview-img {
            max-height: 120px;
            max-width: 100%;
            object-fit: contain;
            border-radius: 4px;
        }
        .${PREFIX}result-label {
            font-size: 12px;
            font-weight: 600;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        .${PREFIX}result-text {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            font-size: 14px;
            line-height: 1.5;
            color: #0f172a;
            word-break: break-all;
            white-space: pre-wrap;
            max-height: 180px;
            overflow-y: auto;
            user-select: text;
        }

        /* 模态框底部按钮 */
        .${PREFIX}modal-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding: 14px 20px;
            background: #f8fafc;
            border-top: 1px solid #f1f5f9;
        }
        .${PREFIX}btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            border: 1px solid transparent;
            text-decoration: none !important;
        }
        .${PREFIX}btn-primary {
            background: #2563eb;
            color: #ffffff !important;
        }
        .${PREFIX}btn-primary:hover {
            background: #1d4ed8;
        }
        .${PREFIX}btn-secondary {
            background: #ffffff;
            color: #334155 !important;
            border-color: #cbd5e1;
        }
        .${PREFIX}btn-secondary:hover {
            background: #f1f5f9;
            color: #0f172a !important;
        }

        /* 悬浮球 */
        .${PREFIX}fab {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #2563eb;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
            cursor: pointer;
            z-index: 2147483640;
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s;
            user-select: none;
        }
        .${PREFIX}fab:hover {
            transform: scale(1.08);
            background: #1d4ed8;
        }
        .${PREFIX}fab svg {
            width: 22px;
            height: 22px;
            fill: currentColor;
        }

        /* 悬浮菜单 */
        .${PREFIX}fab-menu {
            position: fixed;
            bottom: 84px;
            right: 30px;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            padding: 8px 0;
            min-width: 170px;
            z-index: 2147483641;
            opacity: 0;
            transform: translateY(10px) scale(0.95);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            border: 1px solid #e2e8f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .${PREFIX}fab-menu.show {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }
        .${PREFIX}menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            font-size: 13px;
            color: #334155;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
        }
        .${PREFIX}menu-item:hover {
            background: #f1f5f9;
            color: #0f172a;
        }
        .${PREFIX}menu-divider {
            height: 1px;
            background: #e2e8f0;
            margin: 6px 0;
        }

        /* 鼠标悬停在图片上时右上角的小标签 */
        .${PREFIX}hover-badge {
            position: absolute;
            background: rgba(37, 99, 235, 0.9);
            color: #ffffff;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 4px 8px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            cursor: pointer;
            z-index: 2147483630;
            pointer-events: auto;
            display: flex;
            align-items: center;
            gap: 4px;
            backdrop-filter: blur(2px);
            transition: transform 0.15s ease, background 0.15s ease;
        }
        .${PREFIX}hover-badge:hover {
            background: rgba(29, 78, 216, 1);
            transform: scale(1.05);
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.documentElement.appendChild(styleEl);

    /* ========================================================
       2. UI 组件构建
       ======================================================== */
    // Toast 提示
    const toastEl = document.createElement('div');
    toastEl.className = `${PREFIX}toast`;
    document.body.appendChild(toastEl);
    let toastTimer = null;
    function showToast(msg, duration = 2500) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('show');
        }, duration);
    }

    // 模态弹窗
    const maskEl = document.createElement('div');
    maskEl.className = `${PREFIX}modal-mask`;
    maskEl.innerHTML = `
        <div class="${PREFIX}modal">
            <div class="${PREFIX}modal-header">
                <div class="${PREFIX}modal-title">
                    <span>🔍</span> 二维码识别结果
                </div>
                <button class="${PREFIX}modal-close" title="关闭 (Esc)">✕</button>
            </div>
            <div class="${PREFIX}modal-body">
                <div class="${PREFIX}preview-wrapper">
                    <img class="${PREFIX}preview-img" alt="二维码预览" />
                </div>
                <div class="${PREFIX}result-label">解析内容</div>
                <div class="${PREFIX}result-text"></div>
            </div>
            <div class="${PREFIX}modal-footer">
                <button class="${PREFIX}btn ${PREFIX}btn-secondary" id="${PREFIX}btn-copy">📋 复制内容</button>
                <a class="${PREFIX}btn ${PREFIX}btn-primary" id="${PREFIX}btn-open" target="_blank" rel="noopener noreferrer" style="display: none;">🔗 打开链接</a>
            </div>
        </div>
    `;
    document.body.appendChild(maskEl);

    const closeBtn = maskEl.querySelector(`.${PREFIX}modal-close`);
    const previewImg = maskEl.querySelector(`.${PREFIX}preview-img`);
    const resultText = maskEl.querySelector(`.${PREFIX}result-text`);
    const copyBtn = maskEl.querySelector(`#${PREFIX}btn-copy`);
    const openBtn = maskEl.querySelector(`#${PREFIX}btn-open`);

    function closeModal() {
        maskEl.classList.remove('show');
    }
    closeBtn.addEventListener('click', closeModal);
    maskEl.addEventListener('click', (e) => {
        if (e.target === maskEl) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && maskEl.classList.contains('show')) {
            closeModal();
        }
    });

    let currentResultData = '';
    function showResult(text, previewSrc = '') {
        currentResultData = text;
        resultText.textContent = text;
        if (previewSrc) {
            previewImg.src = previewSrc;
            previewImg.parentElement.style.display = 'flex';
        } else {
            previewImg.parentElement.style.display = 'none';
        }

        const isUrl = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(text.trim());
        if (isUrl) {
            openBtn.href = text.trim();
            openBtn.style.display = 'inline-flex';
        } else {
            openBtn.style.display = 'none';
        }

        copyBtn.textContent = '📋 复制内容';
        maskEl.classList.add('show');
    }

    copyBtn.addEventListener('click', () => {
        if (!currentResultData) return;
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(currentResultData);
        } else {
            navigator.clipboard.writeText(currentResultData);
        }
        copyBtn.textContent = '✅ 已复制！';
        setTimeout(() => {
            copyBtn.textContent = '📋 复制内容';
        }, 2000);
    });

    /* ========================================================
       3. 核心：二维码解析算法 (BarcodeDetector + jsQR 双引擎)
       ======================================================== */
    async function decodeCanvasOrImageData(canvas, ctx) {
        const width = canvas.width;
        const height = canvas.height;
        if (!width || !height) return null;

        // 1. 优先尝试现代浏览器原生 BarcodeDetector
        if ('BarcodeDetector' in window) {
            try {
                const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                const barcodes = await detector.detect(canvas);
                if (barcodes && barcodes.length > 0) {
                    return barcodes[0].rawValue;
                }
            } catch (err) {}
        }

        // 2. 降级使用 jsQR
        if (typeof jsQR !== 'undefined') {
            const imgData = ctx.getImageData(0, 0, width, height);
            const code = jsQR(imgData.data, width, height, {
                inversionAttempts: 'attemptBoth',
            });
            if (code && code.data) {
                return code.data;
            }
        }

        return null;
    }

    async function decodeImageElement(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.videoWidth || img.width || 300;
        canvas.height = img.naturalHeight || img.videoHeight || img.height || 300;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return await decodeCanvasOrImageData(canvas, ctx);
    }

    // 解决跨域 Canvas Tainted 问题
    function loadImageFromUrl(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject(new Error('空图片地址'));

            if (url.startsWith('data:') || url.startsWith('blob:')) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Base64/Blob 图片加载失败'));
                img.src = url;
                return;
            }

            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    onload: function (response) {
                        if (response.status >= 200 && response.status < 300) {
                            const blob = response.response;
                            const objectUrl = URL.createObjectURL(blob);
                            const img = new Image();
                            img.onload = () => {
                                URL.revokeObjectURL(objectUrl);
                                resolve(img);
                            };
                            img.onerror = () => {
                                URL.revokeObjectURL(objectUrl);
                                reject(new Error('图片解析失败'));
                            };
                            img.src = objectUrl;
                        } else {
                            reject(new Error(`跨域请求失败: ${response.status}`));
                        }
                    },
                    onerror: () => reject(new Error('网络请求异常'))
                });
            } else {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('跨域图片加载受阻'));
                img.src = url;
            }
        });
    }

    async function scanFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            showToast('请选择有效的图片文件！');
            return;
        }
        showToast('正在解析二维码...');
        const reader = new FileReader();
        reader.onload = async function (e) {
            const dataUrl = e.target.result;
            const img = new Image();
            img.onload = async () => {
                const result = await decodeImageElement(img);
                if (result) {
                    showResult(result, dataUrl);
                } else {
                    showToast('未能识别到二维码，请确认图片清晰度');
                }
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    async function scanElement(el) {
        if (!el) return;
        showToast('正在识别中...');

        try {
            let result = null;
            let previewSrc = '';

            if (el instanceof HTMLCanvasElement) {
                const ctx = el.getContext('2d');
                result = await decodeCanvasOrImageData(el, ctx);
                previewSrc = el.toDataURL();
            } else if (el instanceof HTMLVideoElement) {
                result = await decodeImageElement(el);
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = el.videoWidth;
                tmpCanvas.height = el.videoHeight;
                tmpCanvas.getContext('2d').drawImage(el, 0, 0);
                previewSrc = tmpCanvas.toDataURL();
            } else if (el instanceof HTMLImageElement) {
                previewSrc = el.currentSrc || el.src;
                const imgObj = await loadImageFromUrl(previewSrc);
                result = await decodeImageElement(imgObj);
            } else {
                const bg = window.getComputedStyle(el).backgroundImage;
                if (bg && bg !== 'none') {
                    const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) {
                        previewSrc = match[1];
                        const imgObj = await loadImageFromUrl(previewSrc);
                        result = await decodeImageElement(imgObj);
                    }
                }

                if (!result) {
                    const childImg = el.querySelector('img, canvas');
                    if (childImg) return scanElement(childImg);
                }
            }

            if (result) {
                showResult(result, previewSrc);
            } else {
                showToast('未检测到有效的二维码');
            }
        } catch (err) {
            console.error('[QR-Scanner] 解析异常:', err);
            showToast('识别失败: ' + (err.message || '未知错误'));
        }
    }

    /* ========================================================
       4. 触发方式一：Alt + 单击任意图片/元素
       ======================================================== */
    document.addEventListener('click', (e) => {
        if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            scanElement(e.target);
        }
    }, true);

    /* ========================================================
       5. 触发方式二：剪贴板粘贴 (Ctrl + V)
       ======================================================== */
    document.addEventListener('paste', (e) => {
        const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
            return;
        }

        const items = (e.clipboardData || window.clipboardData).items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    e.preventDefault();
                    scanFile(blob);
                    break;
                }
            }
        }
    });

    /* ========================================================
       6. 触发方式三：拖拽图片到网页
       ======================================================== */
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
        }
    });
    window.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                e.preventDefault();
                scanFile(file);
            }
        }
    });

    /* ========================================================
       7. 触发方式四：鼠标悬浮小图标
       ======================================================== */
    const hoverBadge = document.createElement('div');
    hoverBadge.className = `${PREFIX}hover-badge`;
    hoverBadge.innerHTML = `<span>🔍</span> 识别`;
    hoverBadge.style.display = 'none';
    document.body.appendChild(hoverBadge);

    let activeHoverTarget = null;
    let hideBadgeTimer = null;

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target === hoverBadge || hoverBadge.contains(target)) return;

        const isImg = target instanceof HTMLImageElement && (target.naturalWidth > 60 || target.width > 60);
        const isCanvas = target instanceof HTMLCanvasElement && target.width > 60;

        if (isImg || isCanvas) {
            clearTimeout(hideBadgeTimer);
            activeHoverTarget = target;
            const rect = target.getBoundingClientRect();
            const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
            const scrollY = window.pageYOffset || document.documentElement.scrollTop;

            hoverBadge.style.left = `${rect.right + scrollX - 65}px`;
            hoverBadge.style.top = `${rect.top + scrollY + 8}px`;
            hoverBadge.style.display = 'flex';
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target === hoverBadge || hoverBadge.contains(e.target)) return;
        hideBadgeTimer = setTimeout(() => {
            hoverBadge.style.display = 'none';
        }, 300);
    });

    hoverBadge.addEventListener('mouseenter', () => clearTimeout(hideBadgeTimer));
    hoverBadge.addEventListener('mouseleave', () => { hoverBadge.style.display = 'none'; });

    hoverBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeHoverTarget) scanElement(activeHoverTarget);
    });

    /* ========================================================
       8. 触发方式五：右下角悬浮球与功能菜单
       ======================================================== */
    const fabEl = document.createElement('div');
    fabEl.className = `${PREFIX}fab`;
    fabEl.title = '二维码识别助手';
    fabEl.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="M4 4h6v6H4V4zm2 2v2h2V6H6zm8-2h6v6h-6V4zm2 2v2h2V6h-2zM4 14h6v6H4v-6zm2 2v2h2v-2H6zm10-2h2v2h-2v-2zm-2 2h2v2h-2v-2zm4 0h2v2h-2v-2zm-2 2h2v2h-2v-2zm2 2h2v2h-2v-2zM4 2v2H2v2h2v2H2v2h2v2H2v2h2v2H2v2h2v2H2v2h4v-2h2v2h2v-2h2v2h2v-2h2v2h4v-2h2v-2h-2v-2h2v-2h-2v-2h2V8h-2V6h2V4h-2V2H4zm8 10h2v2h-2v-2z"/>
        </svg>
    `;

    const fabMenuEl = document.createElement('div');
    fabMenuEl.className = `${PREFIX}fab-menu`;
    fabMenuEl.innerHTML = `
        <div class="${PREFIX}menu-item" id="${PREFIX}menu-upload">
            <span>📁</span> 上传本地图片识别
        </div>
        <div class="${PREFIX}menu-item" id="${PREFIX}menu-paste">
            <span>📋</span> 粘贴截图识别
        </div>
        <div class="${PREFIX}menu-item" id="${PREFIX}menu-scan-page">
            <span>🖼️</span> 扫描本页所有二维码
        </div>
        <div class="${PREFIX}menu-divider"></div>
        <div class="${PREFIX}menu-item" style="font-size: 11px; color: #94a3b8; cursor: default;">
            💡 快捷技巧: Alt + 点击图片直接识别
        </div>
    `;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            scanFile(e.target.files[0]);
            fileInput.value = '';
        }
    });

    document.body.appendChild(fabEl);
    document.body.appendChild(fabMenuEl);

    fabEl.addEventListener('click', (e) => {
        e.stopPropagation();
        fabMenuEl.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!fabMenuEl.contains(e.target) && e.target !== fabEl) {
            fabMenuEl.classList.remove('show');
        }
    });

    fabMenuEl.querySelector(`#${PREFIX}menu-upload`).addEventListener('click', () => {
        fabMenuEl.classList.remove('show');
        fileInput.click();
    });

    fabMenuEl.querySelector(`#${PREFIX}menu-paste`).addEventListener('click', async () => {
        fabMenuEl.classList.remove('show');
        try {
            const clipboardItems = await navigator.clipboard.read();
            let foundImage = false;
            for (const item of clipboardItems) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    scanFile(blob);
                    foundImage = true;
                    break;
                }
            }
            if (!foundImage) {
                showToast('剪贴板未发现图片，请截图后直接按 Ctrl+V 粘贴！');
            }
        } catch (e) {
            showToast('请直接在网页上按 Ctrl + V 粘贴截图识别！');
        }
    });

    async function scanAllImagesOnPage() {
        const images = Array.from(document.querySelectorAll('img, canvas'));
        if (images.length === 0) {
            showToast('本页未发现图片或 Canvas 元素');
            return;
        }

        showToast(`正在扫描本页 ${images.length} 个元素，请稍候...`);
        let detected = [];

        for (const el of images) {
            try {
                let code = null;
                if (el instanceof HTMLCanvasElement) {
                    code = await decodeCanvasOrImageData(el, el.getContext('2d'));
                } else if (el instanceof HTMLImageElement) {
                    const src = el.currentSrc || el.src;
                    if (src && (el.naturalWidth > 40 || el.width > 40)) {
                        const img = await loadImageFromUrl(src);
                        code = await decodeImageElement(img);
                    }
                }
                if (code && !detected.some(item => item.code === code)) {
                    detected.push({ code, el });
                }
            } catch (ignore) {}
        }

        if (detected.length === 0) {
            showToast('未在当前页面的图片中找到二维码');
        } else if (detected.length === 1) {
            scanElement(detected[0].el);
        } else {
            const summary = detected.map((d, idx) => `[#${idx + 1}] ${d.code}`).join('\n\n');
            showResult(summary);
            showToast(`成功识别到 ${detected.length} 个二维码！`);
        }
    }

    fabMenuEl.querySelector(`#${PREFIX}menu-scan-page`).addEventListener('click', () => {
        fabMenuEl.classList.remove('show');
        scanAllImagesOnPage();
    });

    /* ========================================================
       9. 油猴原生菜单注册
       ======================================================== */
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('🖼️ 扫描本页所有二维码', scanAllImagesOnPage);
        GM_registerMenuCommand('📁 上传本地图片识别', () => fileInput.click());
    }

})();
