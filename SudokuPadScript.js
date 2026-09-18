// ==UserScript==
// @name         SudokuPad 题库与全能备份助手
// @namespace    https://sudokupad.app/
// @version      3.1
// @description  为 SudokuPad 提供题库管理、多版本 WebDAV 云备份、云端快照回溯与本地 JSON 导入导出全能工具
// @author       You
// @match        *://sudokupad.app/*
// @match        *://*.sudokupad.app/*
// @icon         https://sudokupad.app/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 1. 标题捕获与题目解析 ====================
    function getTitleCache() {
        try {
            return JSON.parse(localStorage.getItem('sudoku_helper_title_cache') || '{}');
        } catch { return {}; }
    }

    function saveTitleCache(cache) {
        localStorage.setItem('sudoku_helper_title_cache', JSON.stringify(cache));
    }

    function captureCurrentPuzzleTitle() {
        try {
            const uWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const puzzle = uWin.framework?.app?.puzzle || uWin.puzzle || uWin.app?.puzzle;
            let title = puzzle?.title;
            let author = puzzle?.author;
            let puzzleId = puzzle?.id;

            if (!title && document.title && !document.title.startsWith('SudokuPad')) {
                const clean = document.title.replace(/\s*-\s*SudokuPad.*$/i, '').trim();
                const parts = clean.split(/\s+by\s+/i);
                title = parts[0]?.trim();
                if (!author && parts[1]) author = parts[1].trim();
            }

            if (!puzzleId) {
                const m = location.href.match(/puzzleid=([^&]+)/i);
                if (m) puzzleId = m[1];
            }

            const shortid = location.pathname.replace(/^\//, '');
            if (title && (puzzleId || shortid)) {
                const cache = getTitleCache();
                const key = puzzleId || shortid;
                if (!cache[key] || cache[key].title !== title) {
                    cache[key] = { title, author: author || '' };
                    saveTitleCache(cache);
                }
            }
        } catch (e) {}
    }
    setTimeout(captureCurrentPuzzleTitle, 2000);
    setInterval(captureCurrentPuzzleTitle, 5000);

    function getPuzzles() {
        const titleCache = getTitleCache();
        const puzzles = [];

        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('progress_')) {
                try {
                    const val = JSON.parse(localStorage.getItem(k));
                    const parts = k.split('_');
                    const puzzleId = val.puzzleId || parts.slice(2).join('_');
                    const shortid = val.shortid || '';

                    let title = '';
                    let author = parts[2] || '未知作者';

                    if (titleCache[puzzleId]?.title) {
                        title = titleCache[puzzleId].title;
                        if (titleCache[puzzleId].author) author = titleCache[puzzleId].author;
                    } else if (shortid && titleCache[shortid]?.title) {
                        title = titleCache[shortid].title;
                    } else if (val.title) {
                        title = val.title;
                    } else if (shortid && shortid.includes('/')) {
                        const sub = shortid.split('/').pop();
                        title = sub.charAt(0).toUpperCase() + sub.slice(1);
                    }

                    const link = shortid ? `https://sudokupad.app/${shortid}` : `https://sudokupad.app/?puzzleid=${puzzleId}`;

                    puzzles.push({
                        title,
                        author,
                        shortid: shortid || '无',
                        puzzleId: puzzleId || '',
                        time: val.time ? new Date(val.time).toLocaleString('zh-CN', { hour12: false }) : '未知时间',
                        rawTime: val.time || 0,
                        link
                    });
                } catch (e) {}
            }
        }
        return puzzles.sort((a, b) => b.rawTime - a.rawTime);
    }

    // ==================== 2. 全量数据获取 ====================
    function getFullBackupData() {
        const backup = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            backup[k] = localStorage.getItem(k);
        }
        return backup;
    }

    function applyImportedData(data) {
        let count = 0;
        Object.entries(data).forEach(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : v;
            localStorage.setItem(k, val);
            count++;
        });
        return count;
    }

    // ==================== 3. WebDAV 云端交互 ====================
    function getWebDAVConfig() {
        return {
            url: GM_getValue('webdav_url', ''),
            user: GM_getValue('webdav_user', ''),
            pass: GM_getValue('webdav_pass', '')
        };
    }

    function saveWebDAVConfig(cfg) {
        let u = cfg.url.trim();
        if (u && !u.endsWith('/')) u += '/';
        GM_setValue('webdav_url', u);
        GM_setValue('webdav_user', cfg.user.trim());
        GM_setValue('webdav_pass', cfg.pass.trim());
    }

    function getAuthHeader(cfg) {
        return 'Basic ' + btoa(unescape(encodeURIComponent(cfg.user + ':' + cfg.pass)));
    }

    function generateBackupFileName() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        return `sudokupad_backup_${ts}.json`;
    }

    function fetchWebDAVFileList(callback) {
        const cfg = getWebDAVConfig();
        if (!cfg.url || !cfg.user || !cfg.pass) {
            alert('⚠️ 请先配置 WebDAV 服务器地址与账户密码！');
            return;
        }

        GM_xmlhttpRequest({
            method: 'PROPFIND',
            url: cfg.url,
            headers: {
                'Authorization': getAuthHeader(cfg),
                'Depth': '1'
            },
            onload: function(res) {
                if (res.status >= 200 && res.status < 300 || res.status === 207) {
                    try {
                        const parser = new DOMParser();
                        const xml = parser.parseFromString(res.responseText, 'text/xml');
                        const responses = xml.getElementsByTagNameNS('*', 'response');
                        const files = [];

                        for (let i = 0; i < responses.length; i++) {
                            const r = responses[i];
                            const hrefEl = r.getElementsByTagNameNS('*', 'href')[0];
                            if (!hrefEl) continue;
                            const fullHref = decodeURIComponent(hrefEl.textContent);
                            const name = fullHref.split('/').filter(Boolean).pop();

                            if (name && name.startsWith('sudokupad_backup_') && name.endsWith('.json')) {
                                const lmEl = r.getElementsByTagNameNS('*', 'getlastmodified')[0];
                                const lm = lmEl ? new Date(lmEl.textContent) : new Date(0);
                                const szEl = r.getElementsByTagNameNS('*', 'getcontentlength')[0];
                                const sz = szEl ? (parseInt(szEl.textContent, 10) / 1024).toFixed(1) + ' KB' : '未知大小';

                                files.push({
                                    name,
                                    url: cfg.url + name,
                                    time: lm.toLocaleString('zh-CN', { hour12: false }),
                                    rawTime: lm.getTime(),
                                    size: sz
                                });
                            }
                        }

                        files.sort((a, b) => b.rawTime - a.rawTime || b.name.localeCompare(a.name));
                        callback(null, files);
                    } catch (e) {
                        callback('解析目录 XML 失败: ' + e.message);
                    }
                } else if (res.status === 401) {
                    callback('账号或密码错误（401 Unauthorized）');
                } else {
                    callback(`请求失败（HTTP ${res.status}）`);
                }
            },
            onerror: () => callback('网络连接失败，请检查 WebDAV 地址！')
        });
    }

    function restoreFromFileUrl(url, displayName) {
        const cfg = getWebDAVConfig();
        if (!confirm(`确定要还原【${displayName}】的数据吗？\n当前本地记录将会被合并更新。`)) return;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: { 'Authorization': getAuthHeader(cfg) },
            onload: function(res) {
                if (res.status === 200) {
                    try {
                        const data = JSON.parse(res.responseText);
                        const count = applyImportedData(data);
                        alert(`🎉 成功还原 ${count} 条记录！页面即将刷新。`);
                        location.reload();
                    } catch (e) {
                        alert('❌ 备份文件损坏：' + e.message);
                    }
                } else {
                    alert(`❌ 下载文件失败（HTTP ${res.status}）`);
                }
            },
            onerror: () => alert('❌ 下载文件失败，请检查网络！')
        });
    }

    // ==================== 4. 弹窗 UI 渲染 ====================
    function showModal() {
        const existing = document.getElementById('sudoku-helper-modal');
        if (existing) {
            existing.remove();
            return;
        }

        const puzzles = getPuzzles();
        const cfg = getWebDAVConfig();

        const modal = document.createElement('div');
        modal.id = 'sudoku-helper-modal';
        modal.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 840px; max-width: 96vw; max-height: 88vh; background: #1c1b2c; color: #e2e8f0;
            border: 1px solid #36344d; border-radius: 12px; z-index: 2147483647;
            box-shadow: 0 20px 60px rgba(0,0,0,0.85); display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
        `;

        modal.innerHTML = `
            <!-- 顶部标题栏 -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; background:#222035; border-bottom:1px solid #2d2b42;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:18px;">📚</span>
                    <span style="font-size:16px; font-weight:bold; color:#fff;">SudokuPad 题库与云同步</span>
                    <span style="font-size:13px; color:#94a3b8; font-weight:normal;">(${puzzles.length} 道题)</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <button id="toggle-settings-btn" style="background:#37354b; border:none; color:#e2e8f0; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:12px; display:flex; align-items:center; gap:5px;">
                        <span>⚙️</span> WebDAV 设置
                    </button>
                    <button id="modal-close-btn" style="background:#f43f5e; border:none; color:#fff; border-radius:6px; padding:5px 12px; cursor:pointer; font-weight:bold; font-size:13px;">✕</button>
                </div>
            </div>

            <!-- WebDAV 设置折叠抽屉 -->
            <div id="webdav-settings-panel" style="display:none; padding:14px 20px; background:#161524; border-bottom:1px solid #2e2c45; font-size:13px;">
                <div style="font-weight:bold; color:#38bdf8; margin-bottom:8px;">⚙️ 配置 WebDAV 账户 (支持坚果云 / Nextcloud / Alist / InfiniCLOUD 等)</div>
                <div style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div>
                        <label style="color:#94a3b8; font-size:12px; display:block; margin-bottom:3px;">服务器目录 URL (末尾保留斜杠):</label>
                        <input id="cfg-url" type="text" placeholder="https://dav.jianguoyun.com/dav/sudoku/" value="${cfg.url}" style="width:92%; padding:6px 8px; background:#0f0e18; border:1px solid #3b3952; border-radius:4px; color:#fff;" />
                    </div>
                    <div>
                        <label style="color:#94a3b8; font-size:12px; display:block; margin-bottom:3px;">用户名 / 邮箱:</label>
                        <input id="cfg-user" type="text" placeholder="注册账号邮箱" value="${cfg.user}" style="width:90%; padding:6px 8px; background:#0f0e18; border:1px solid #3b3952; border-radius:4px; color:#fff;" />
                    </div>
                    <div>
                        <label style="color:#94a3b8; font-size:12px; display:block; margin-bottom:3px;">密码 / 应用密码:</label>
                        <input id="cfg-pass" type="password" placeholder="坚果云请填应用密码" value="${cfg.pass}" style="width:90%; padding:6px 8px; background:#0f0e18; border:1px solid #3b3952; border-radius:4px; color:#fff;" />
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="cfg-save-btn" style="background:#10b981; border:none; color:#fff; border-radius:4px; padding:6px 16px; cursor:pointer; font-weight:bold; font-size:12px;">保存配置</button>
                </div>
            </div>

            <!-- 第二行操作栏：搜索 + 云端功能组 + 分隔线 + 本地功能组 -->
            <div style="display:flex; gap:8px; padding:12px 20px; background:#1e1d30; border-bottom:1px solid #2d2b42; align-items:center; flex-wrap:wrap;">
                <!-- 搜索框 -->
                <input id="puzzle-search-input" type="text" placeholder="🔍 搜索作者、标题或短链 ID..." style="flex:1; min-width:140px; padding:7px 12px; background:#121120; border:1px solid #36344d; border-radius:8px; color:#fff; outline:none; font-size:13px;" />

                <!-- ☁️ 云端三色功能按钮组 -->
                <div style="display:flex; gap:6px; align-items:center;">
                    <button id="btn-cloud-upload" title="生成带时间戳的云端快照文件" style="background:#7c3aed; border:none; color:#fff; border-radius:8px; padding:7px 12px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:5px; white-space:nowrap;">
                        ☁️ 新增备份到云端
                    </button>
                    <button id="btn-cloud-sync-latest" title="自动拉取并合并最新的一条云端快照" style="background:#0891b2; border:none; color:#fff; border-radius:8px; padding:7px 12px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:5px; white-space:nowrap;">
                        🔄 同步最新备份
                    </button>
                    <button id="btn-cloud-versions" title="查看云端所有历史快照版本并选择性还原" style="background:#d97706; border:none; color:#fff; border-radius:8px; padding:7px 12px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:5px; white-space:nowrap;">
                        📜 云端版本列表
                    </button>
                </div>

                <!-- 竖直分隔条 -->
                <div style="width:1px; height:20px; background:#383652; margin:0 2px;"></div>

                <!-- 💾 本地导入导出按钮组 -->
                <div style="display:flex; gap:6px; align-items:center;">
                    <button id="btn-local-export" title="将全部进度和配置保存为本地 JSON 文件" style="background:#2563eb; border:none; color:#fff; border-radius:8px; padding:7px 11px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:4px; white-space:nowrap;">
                        📥 本地导出
                    </button>
                    <button id="btn-local-import" title="从电脑本地选择 JSON 备份文件合并还原" style="background:#10b981; border:none; color:#fff; border-radius:8px; padding:7px 11px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:4px; white-space:nowrap;">
                        📤 本地导入
                    </button>
                    <input type="file" id="local-import-file-input" accept=".json" style="display:none;" />
                </div>
            </div>

            <!-- 主内容滚动区 -->
            <div id="main-content-scroll" style="flex:1; overflow-y:auto; padding:10px 20px;">
                <div id="puzzle-list-view"></div>
                <div id="version-list-view" style="display:none;"></div>
            </div>
        `;

        document.body.appendChild(modal);

        const puzzleListView = modal.querySelector('#puzzle-list-view');
        const versionListView = modal.querySelector('#version-list-view');
        const searchInput = modal.querySelector('#puzzle-search-input');
        const settingsPanel = modal.querySelector('#webdav-settings-panel');

        // 渲染题目列表
        function renderPuzzleList(filterText = '') {
            versionListView.style.display = 'none';
            puzzleListView.style.display = 'block';

            const kw = filterText.trim().toLowerCase();
            const filtered = puzzles.filter(p =>
                p.title.toLowerCase().includes(kw) ||
                p.author.toLowerCase().includes(kw) ||
                p.shortid.toLowerCase().includes(kw)
            );

            if (filtered.length === 0) {
                puzzleListView.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">没有找到匹配的题目</div>';
                return;
            }

            puzzleListView.innerHTML = filtered.map((p, idx) => {
                const titlePart = p.title ? `<span style="color:#38bdf8;">#${idx + 1} ${p.title}</span> <span style="color:#64748b; margin:0 4px;">·</span> ` : '';
                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #2a283e;">
                    <div>
                        <div style="font-weight:bold; font-size:15px; color:#38bdf8;">
                            ${titlePart ? titlePart : `#${idx + 1} `}作者: ${p.author}
                        </div>
                        <div style="font-size:12px; color:#94a3b8; margin-top:5px;">
                            短链: <code style="background:#11101d; border:1px solid #2e2c44; padding:2px 6px; border-radius:4px; font-family:monospace; color:#cbd5e1;">${p.shortid}</code>
                            <span style="margin:0 6px; color:#475569;">|</span>
                            保存时间: ${p.time}
                        </div>
                    </div>
                    <a href="${p.link}" target="_blank" style="background:#1890ff; color:#fff; text-decoration:none; padding:7px 18px; border-radius:6px; font-size:13px; font-weight:bold; white-space:nowrap; transition:background 0.2s;">
                        打开
                    </a>
                </div>
            `}).join('');
        }

        renderPuzzleList();

        // 搜索过滤
        searchInput.oninput = (e) => renderPuzzleList(e.target.value);

        // 关闭弹窗
        modal.querySelector('#modal-close-btn').onclick = () => modal.remove();

        // WebDAV 设置折叠与保存
        modal.querySelector('#toggle-settings-btn').onclick = () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        };

        modal.querySelector('#cfg-save-btn').onclick = () => {
            saveWebDAVConfig({
                url: modal.querySelector('#cfg-url').value,
                user: modal.querySelector('#cfg-user').value,
                pass: modal.querySelector('#cfg-pass').value
            });
            alert('✅ WebDAV 配置已保存！');
            settingsPanel.style.display = 'none';
        };

        // 1. 新增备份到云端
        const btnUpload = modal.querySelector('#btn-cloud-upload');
        btnUpload.onclick = () => {
            const currentCfg = getWebDAVConfig();
            if (!currentCfg.url || !currentCfg.user || !currentCfg.pass) {
                settingsPanel.style.display = 'block';
                alert('⚠️ 请先配置 WebDAV 账户与目录 URL！');
                return;
            }

            const fileName = generateBackupFileName();
            const targetUrl = currentCfg.url + fileName;
            const originalText = btnUpload.innerText;
            btnUpload.innerText = '⏳ 上传中...';
            btnUpload.disabled = true;

            const payload = JSON.stringify(getFullBackupData(), null, 2);

            GM_xmlhttpRequest({
                method: 'PUT',
                url: targetUrl,
                headers: {
                    'Authorization': getAuthHeader(currentCfg),
                    'Content-Type': 'application/json;charset=utf-8'
                },
                data: payload,
                onload: function(res) {
                    btnUpload.innerText = originalText;
                    btnUpload.disabled = false;
                    if (res.status >= 200 && res.status < 300 || res.status === 201 || res.status === 204) {
                        alert(`✅ 成功备份到云端！\n快照文件: ${fileName}`);
                    } else if (res.status === 401) {
                        alert('❌ 权限错误：WebDAV 账号或密码不正确！');
                    } else {
                        alert(`❌ 上传失败（HTTP ${res.status}）：请确认 WebDAV 目录是否存在。`);
                    }
                },
                onerror: () => {
                    btnUpload.innerText = originalText;
                    btnUpload.disabled = false;
                    alert('❌ 请求失败，请检查网络或 WebDAV 目录地址！');
                }
            });
        };

        // 2. 同步最新备份
        const btnSyncLatest = modal.querySelector('#btn-cloud-sync-latest');
        btnSyncLatest.onclick = () => {
            const originalText = btnSyncLatest.innerText;
            btnSyncLatest.innerText = '⏳ 检索最新...';
            btnSyncLatest.disabled = true;

            fetchWebDAVFileList((err, files) => {
                btnSyncLatest.innerText = originalText;
                btnSyncLatest.disabled = false;

                if (err) {
                    alert('❌ ' + err);
                    return;
                }
                if (files.length === 0) {
                    alert('⚠️ 云端暂无备份文件，请先点击【☁️ 新增备份到云端】！');
                    return;
                }

                const latest = files[0];
                restoreFromFileUrl(latest.url, latest.name + ` (${latest.time})`);
            });
        };

        // 3. 云端版本列表
        const btnVersions = modal.querySelector('#btn-cloud-versions');
        btnVersions.onclick = () => {
            if (versionListView.style.display === 'block') {
                renderPuzzleList(searchInput.value);
                return;
            }

            versionListView.innerHTML = '<div style="text-align:center; padding:35px; color:#94a3b8;">⏳ 正在读取 WebDAV 云端备份列表...</div>';
            puzzleListView.style.display = 'none';
            versionListView.style.display = 'block';

            fetchWebDAVFileList((err, files) => {
                if (err) {
                    versionListView.innerHTML = `
                        <div style="text-align:center; padding:30px; color:#f43f5e;">
                            <div>❌ 读取云端列表失败：${err}</div>
                            <button id="back-to-puzzles" style="margin-top:14px; background:#37354b; border:none; color:#fff; border-radius:4px; padding:6px 14px; cursor:pointer;">返回题库</button>
                        </div>
                    `;
                    modal.querySelector('#back-to-puzzles').onclick = () => renderPuzzleList();
                    return;
                }

                if (files.length === 0) {
                    versionListView.innerHTML = `
                        <div style="text-align:center; padding:30px; color:#94a3b8;">
                            <div>云端暂无历史版本</div>
                            <button id="back-to-puzzles" style="margin-top:14px; background:#37354b; border:none; color:#fff; border-radius:4px; padding:6px 14px; cursor:pointer;">返回题库</button>
                        </div>
                    `;
                    modal.querySelector('#back-to-puzzles').onclick = () => renderPuzzleList();
                    return;
                }

                versionListView.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #333148;">
                        <span style="font-weight:bold; color:#f59e0b; font-size:14px;">📜 云端历史快照列表 (共 ${files.length} 个版本)</span>
                        <button id="back-to-puzzles" style="background:#37354b; border:none; color:#fff; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px;">返回题库</button>
                    </div>
                    ${files.map((f, i) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #2a283e;">
                            <div>
                                <div style="font-weight:bold; font-size:14px; color:#e2e8f0; display:flex; align-items:center; gap:6px;">
                                    <span>${i === 0 ? '🟢 [最新]' : `⚪ [版本 ${files.length - i}]`}</span>
                                    <span>${f.name}</span>
                                </div>
                                <div style="font-size:12px; color:#94a3b8; margin-top:4px;">
                                    备份时间: ${f.time} | 大小: ${f.size}
                                </div>
                            </div>
                            <button class="restore-snapshot-btn" data-url="${f.url}" data-name="${f.name}" style="background:#0891b2; border:none; color:#fff; border-radius:6px; padding:6px 14px; font-size:12px; font-weight:bold; cursor:pointer;">
                                还原此版本
                            </button>
                        </div>
                    `).join('')}
                `;

                modal.querySelector('#back-to-puzzles').onclick = () => renderPuzzleList();
                modal.querySelectorAll('.restore-snapshot-btn').forEach(btn => {
                    btn.onclick = () => restoreFromFileUrl(btn.getAttribute('data-url'), btn.getAttribute('data-name'));
                });
            });
        };

        // 4. 本地导出功能
        modal.querySelector('#btn-local-export').onclick = () => {
            const dataStr = JSON.stringify(getFullBackupData(), null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `sudokupad_local_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        };

        // 5. 本地导入功能
        const localFileInput = modal.querySelector('#local-import-file-input');
        modal.querySelector('#btn-local-import').onclick = () => localFileInput.click();
        localFileInput.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        const count = applyImportedData(data);
                        alert(`✅ 成功导入 ${count} 条本地记录！页面即将刷新。`);
                        location.reload();
                    } catch (err) {
                        alert('❌ 本地文件解析失败，请检查是否是合法的 JSON 文件！\n' + err.message);
                    }
                };
                reader.readAsText(e.target.files[0]);
            }
        };
    }

    // ==================== 5. 悬浮按钮常驻 ====================
    function ensureTriggerButton() {
        if (document.getElementById('sudoku-helper-trigger-btn')) return;
        if (!document.body) return;

        const btn = document.createElement('button');
        btn.id = 'sudoku-helper-trigger-btn';
        btn.innerText = '📚 题库与同步';
        btn.style.cssText = `
            position: fixed !important; bottom: 30px !important; right: 30px !important;
            z-index: 2147483646 !important; background: #222035 !important; color: #fff !important;
            border: 1px solid #4a4766 !important; padding: 8px 16px !important; border-radius: 20px !important;
            cursor: pointer !important; box-shadow: 0 4px 16px rgba(0,0,0,0.8) !important;
            font-size: 13px !important; font-weight: bold !important; transition: all 0.2s;
        `;
        btn.onmouseover = () => btn.style.background = '#322f4c';
        btn.onmouseout = () => btn.style.background = '#222035';
        btn.onclick = showModal;

        document.body.appendChild(btn);
    }

    setInterval(ensureTriggerButton, 1000);

    window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            showModal();
        }
    });
})();