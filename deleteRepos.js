(() => {
    const $ = (id) => document.getElementById(id);
    const state = {
        repos: [],           // 原始列表（全部）
        filtered: [],        // 过滤后
        selected: new Set(), // full_name 集合
    };

    const headers = () => ({
        'Authorization': 'token ' + ($('token').value || ''),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    });

    const log = (msg) => {
        const box = $('log');
        const now = new Date().toLocaleTimeString();
        box.textContent += `[${now}] ${msg}\n`;
        box.scrollTop = box.scrollHeight;
    };

    const api = async (url, opts = {}) => {
        const res = await fetch(url, {...opts, headers: {...headers(), ...(opts.headers || {})}});
        return res;
    };

    // 拉取repos
    async function fetchAllRepos(user) {
        const perPage = 100;

        const url = `https://api.github.com/user/repos?affiliation=owner&per_page=${perPage}`;
        log(`GET ${url}`);
        const res = await api(url);
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`拉取失败 HTTP ${res.status}: ${txt}`);
        }
        const chunk = await res.json();

        // 只保留关键字段
        return chunk.map(r => ({
            full_name: r.full_name,
            name: r.name,
            html_url: r.html_url,
            fork: !!r.fork,
            private: !!r.private,
            archived: !!r.archived,
        }));
    }

    function applyFilter() {
        const onlyForks = $('fForks').checked;
        const onlyPrivate = $('fPrivate').checked;
        const hideArchived = $('fArchived').checked;
        const match = ($('fMatch').value || '').trim().toLowerCase();

        state.filtered = state.repos.filter(r => {
            if (onlyForks && !r.fork) return false;
            if (onlyPrivate && !r.private) return false;
            if (hideArchived && r.archived) return false;
            if (match && !r.name.toLowerCase().includes(match)) return false;
            return true;
        });
        renderTable();
    }

    function renderTable() {
        const tbody = $('tbody');
        tbody.innerHTML = '';
        $('repoCount').textContent = `共 ${state.repos.length} 个，当前显示 ${state.filtered.length}`;

        if (state.filtered.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6" class="muted">没有匹配的仓库</td>`;
            tbody.appendChild(tr);
            updateButtons();
            return;
        }

        for (const r of state.filtered) {
            const tr = document.createElement('tr');
            const checked = state.selected.has(r.full_name) ? 'checked' : '';
            tr.innerHTML = `
                <td><input type="checkbox" data-full="${r.full_name}" ${checked}></td>
                <td>
                  <div class="name">
                    <a target="_blank" rel="noopener noreferrer" href="${r.html_url}">${r.full_name}</a>
                    <div class="badges">
                      ${r.fork ? '<span class="badge">fork</span>' : ''}
                      ${r.private ? '<span class="badge">private</span>' : ''}
                      ${r.archived ? '<span class="badge">archived</span>' : ''}
                    </div>
                  </div>
                </td>
                <td>${r.fork ? '✔️' : '—'}</td>
                <td>${r.private ? '✔️' : '—'}</td>
                <td>${r.archived ? '✔️' : '—'}</td>
                <td class="status" id="st:${r.full_name}">—</td>
            `;
            tbody.appendChild(tr);
        }

        // 事件委托：选中逻辑
        tbody.onclick = (e) => {
            const t = e.target;
            if (t && t.matches('input[type="checkbox"][data-full]')) {
                const key = t.getAttribute('data-full');
                if (t.checked) state.selected.add(key); else state.selected.delete(key);
                updateButtons();
            }
        };

        updateButtons();
    }

    function updateButtons() {
        const any = state.selected.size > 0;
        $('deleteBtn').disabled = !any;
    }

    $('selectAll').onclick = () => {
        // 如果当前视图里尚未全选，则全选；否则清除这些项
        const inView = new Set(state.filtered.map(r => r.full_name));
        const allSelected = state.filtered.every(r => state.selected.has(r.full_name));
        if (allSelected) {
            for (const k of Array.from(state.selected)) if (inView.has(k)) state.selected.delete(k);
        } else {
            for (const r of state.filtered) state.selected.add(r.full_name);
        }
        renderTable();
    };

    $('checkAll').onclick = (e) => {
        // 表头小复选框：行为与“全选/反选”一致
        $('selectAll').click();
        // 同步其自身勾选状态（根据是否已经全选）
        const allSelected = state.filtered.every(r => state.selected.has(r.full_name));
        e.target.checked = allSelected;
    };

    $('fForks').onchange = $('fPrivate').onchange = $('fArchived').onchange = $('fMatch').oninput = applyFilter;

    $('clearToken').onclick = () => {
        $('token').value = '';
        log('已清空 token（仅从内存移除，未写入任何存储）');
    };

    $('load').onclick = async () => {
        try {
            $('deleteBtn').disabled = true;
            state.selected.clear();
            $('tbody').innerHTML = `<tr><td colspan="6" class="muted">加载中…</td></tr>`;

            const user = $('user').value.trim();
            if (!user) {
                alert('请输入 GitHub 用户名');
                return;
            }
            if (!$('token').value) {
                alert('请输入 PAT（需 delete_repo 权限）');
                return;
            }

            const all = await fetchAllRepos(user);
            state.repos = all;
            applyFilter();
            log(`已加载 ${all.length} 个仓库。`);
        } catch (err) {
            log('❌ ' + (err && err.message ? err.message : err));
            alert('加载失败：' + err);
        }
    };

    $('deleteBtn').onclick = async () => {
        if (state.selected.size === 0) return;

        const dryRun = $('dryRun').checked;
        const total = state.selected.size;
        if (!dryRun) {
            const confirmText = `将删除 ${total} 个仓库，此操作不可恢复。\n\n请输入 YES 继续：`;
            const ans = prompt(confirmText, '');
            if (ans !== 'YES') {
                log('已取消删除');
                return;
            }
        }

        const items = Array.from(state.selected);
        let ok = 0, fail = 0;

        for (const full of items) {
            const cell = document.getElementById(`st:${full}`);
            if (dryRun) {
                cell.textContent = 'will delete';
                cell.style.color = '#f59e0b';
                log(`DRY‑RUN  ${full}`);
                continue;
            }

            const url = `https://api.github.com/repos/${full}`;
            log(`DELETE ${url}`);
            try {
                const res = await api(url, {method: 'DELETE'});
                if (res.status === 204) {
                    ok++;
                    cell.textContent = 'deleted';
                    cell.style.color = '#22c55e';
                } else {
                    fail++;
                    const txt = await res.text();
                    cell.textContent = `fail ${res.status}`;
                    cell.style.color = '#ef4444';
                    log(`失败 ${full}: HTTP ${res.status} ${txt}`);
                }
            } catch (e) {
                fail++;
                cell.textContent = 'error';
                cell.style.color = '#ef4444';
                log(`异常 ${full}: ${e.message || e}`);
            }
        }

        if (!dryRun) {
            log(`完成：成功 ${ok}，失败 ${fail}`);
            // 从 state 中移除已成功删除的
            state.repos = state.repos.filter(r => !state.selected.has(r.full_name));
            state.selected.clear();
            applyFilter();
        } else {
            log(`Dry‑run 完成：共标记 ${items.length} 个将删除`);
        }
    };
})();
