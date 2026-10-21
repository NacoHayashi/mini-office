const $ = (id) => document.getElementById(id);
let signedIn = false;

async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 503) {
    const error = new Error(data.error || "未授權");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) throw new Error(data.error || "沒有成功");
  return data;
}

function showLogin(message) {
  signedIn = false;
  $("panel").hidden = true;
  $("login").hidden = false;
  $("login-error").textContent = message || "";
}

function when(ms) {
  if (!ms) return "—";
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function render(data) {
  $("login").hidden = true;
  $("panel").hidden = false;
  $("pw-state").textContent = data.hasPassword
    ? "已設定辦公室密碼（不會顯示內容）。"
    : "尚未設定密碼，訪客還不能進入。";
  const body = $("members");
  body.replaceChildren();
  $("empty").hidden = data.members.length > 0;
  for (const member of data.members) {
    const row = document.createElement("tr");
    row.dataset.id = member.id;
    const id = document.createElement("td");
    id.textContent = `@${member.id}`;
    const name = document.createElement("td");
    name.textContent = member.displayName;
    const status = document.createElement("td");
    const dot = document.createElement("span");
    dot.className = member.online ? "dot on" : "dot";
    status.append(dot, document.createTextNode(member.online ? "在線" : "離線"));
    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row";
    const kick = document.createElement("button");
    kick.type = "button";
    kick.className = "ghost";
    kick.textContent = "踢出";
    kick.disabled = !member.online;
    kick.addEventListener("click", async () => {
      if (!confirm(`要把 @${member.id} 踢下線嗎？`)) return;
      await api("/api/office/admin/kick", { method: "POST", body: { id: member.id } });
      await refresh();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "移除";
    remove.addEventListener("click", async () => {
      if (!confirm(`要移除 @${member.id} 嗎？這個 ID 會空出來。`)) return;
      await api(`/api/office/admin/members/${encodeURIComponent(member.id)}`, { method: "DELETE" });
      await refresh();
    });
    wrap.append(kick, remove);
    actions.append(wrap);
    row.append(id, name, status, actions);
    body.appendChild(row);
    const extra = document.createElement("tr");
    extra.className = "devices";
    extra.dataset.for = member.id;
    const cell = document.createElement("td");
    cell.colSpan = 4;
    const list = document.createElement("div");
    for (const device of member.devices || []) {
      const line = document.createElement("div");
      line.className = "device";
      const label = document.createElement("span");
      label.textContent = `加入 ${when(device.createdAt)} · 最後上線 ${when(device.lastSeen)}`;
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "ghost";
      drop.textContent = "移除裝置";
      drop.addEventListener("click", async () => {
        if (!confirm("要移除這台裝置嗎？它需要重新加入。")) return;
        await api(`/api/office/admin/members/${encodeURIComponent(member.id)}/devices/${encodeURIComponent(device.id)}`, {
          method: "DELETE",
        });
        await refresh();
      });
      line.append(label, drop);
      list.appendChild(line);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "還沒有加入的裝置";
      list.appendChild(empty);
    }
    cell.appendChild(list);
    extra.appendChild(cell);
    body.appendChild(extra);
  }
}

async function refresh() {
  const data = await api("/api/office/admin/overview");
  render(data);
}

$("form-token").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = $("seed-input").value.trim();
  try {
    await api("/api/office/admin/session", { method: "POST", body: {}, token: value });
    $("seed-input").value = "";
    signedIn = true;
    await refresh();
  } catch (error) {
    showLogin(error.message);
  }
});

$("form-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("new-password").value.trim();
  if (password !== $("new-password2").value.trim()) {
    $("pw-error").textContent = "兩次密碼不一樣";
    return;
  }
  $("pw-error").textContent = "";
  try {
    await api("/api/office/admin/password", { method: "POST", body: { password } });
    $("new-password").value = "";
    $("new-password2").value = "";
    showLogin("已更新密碼，請重新進入。所有人需要重新輸入。");
  } catch (error) {
    if (error.status === 401 || error.status === 503) showLogin(error.message);
    else $("pw-error").textContent = error.message;
  }
});

$("export-backup").addEventListener("click", async () => {
  if (!confirm("這份備份含有敏感資料。確定要下載嗎？")) return;
  $("backup-error").textContent = "";
  const response = await fetch("/api/office/admin/export", { credentials: "same-origin" });
  if (response.status === 401 || response.status === 503) {
    showLogin("請重新進入");
    return;
  }
  if (!response.ok) {
    $("backup-error").textContent = "沒有匯出";
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "office-backup.json";
  link.click();
  URL.revokeObjectURL(url);
});
$("import-backup").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files && $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  if (!confirm("要還原這份備份嗎？現在的成員、分數和擺設會被蓋掉。")) return;
  $("backup-error").textContent = "";
  try {
    const response = await fetch("/api/office/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: await file.text(),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 503) {
      showLogin(data.error || "請重新進入");
      return;
    }
    if (!response.ok) throw new Error(data.error || "沒有還原");
    await refresh();
  } catch (error) {
    $("backup-error").textContent = error.message;
  }
});
$("refresh").addEventListener("click", () => refresh().catch((error) => showLogin(error.message)));
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/office/admin/logout", { method: "POST", body: {} });
  } catch {
    /* the cookie is cleared either way */
  }
  showLogin("");
});
$("revoke-admins").addEventListener("click", async () => {
  if (!confirm("要登出所有管理登入嗎？")) return;
  try {
    await api("/api/office/admin/sessions/revoke", { method: "POST", body: {} });
  } catch {
    /* this browser is signed out either way */
  }
  showLogin("所有管理登入都已結束。");
});

refresh()
  .then(() => {
    signedIn = true;
  })
  .catch(() => showLogin(""));

setInterval(() => {
  if (!signedIn || $("panel").hidden) return;
  refresh().catch(() => {});
}, 3000);
