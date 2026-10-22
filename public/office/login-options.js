// Telegram and guest login on the gate, next to the office password.
// A guest inside the office can also switch to Telegram and keep what it has.
export function attachLoginOptions({ api, deviceKey, start, fail, done, isGuest, upgraded }) {
  const $ = (id) => document.getElementById(id);
  const guest = $("guest-login");
  // Guests and new Telegram accounts use the same office password field.
  const password = () => $("office-password").value;
  const askPassword = (text) => {
    fail(text);
    $("office-password").focus();
  };
  guest.addEventListener("click", async () => {
    start();
    if (!password()) return askPassword("請先輸入辦公室密碼");
    guest.disabled = true;
    const result = await api("/api/office/guest", { method: "POST", token: "", body: { password: password() } });
    guest.disabled = false;
    if (!result.ok || !result.profile) return fail(result.error || "沒有進去，請再試一次");
    done(result);
  });
  window.onTelegramAuth = async (user) => {
    start();
    const result = await api("/api/office/telegram", { method: "POST", token: "", body: { auth: user, deviceKey: deviceKey(), password: password() } });
    if (result.needsPassword) return askPassword("第一次用 Telegram 登入，請先輸入辦公室密碼，再按一次 Telegram");
    if (!result.ok || !result.profile) return fail(result.error || "Telegram 登入失敗");
    done(result);
  };
  let bot = "";
  const widget = (box, onauth) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = bot;
    script.dataset.size = "large";
    script.dataset.radius = "10";
    script.dataset.userpic = "false";
    script.dataset.onauth = onauth;
    box.append(script);
  };
  const paint = () => { $("tg-upgrade-open").hidden = !bot || !isGuest(); };
  const upgradeError = (text) => { $("tg-upgrade-error").textContent = text; };
  $("tg-upgrade-open").addEventListener("click", () => {
    upgradeError("");
    $("tg-upgrade").hidden = false;
    if (!$("tg-upgrade-widget").childElementCount) widget($("tg-upgrade-widget"), "onTelegramUpgrade(user)");
    $("tg-upgrade-password").focus();
  });
  $("tg-upgrade-close").addEventListener("click", () => { $("tg-upgrade").hidden = true; });
  window.onTelegramUpgrade = async (user) => {
    upgradeError("");
    const pass = $("tg-upgrade-password").value;
    if (!pass) {
      upgradeError("請先輸入辦公室密碼，再按一次 Telegram");
      $("tg-upgrade-password").focus();
      return;
    }
    const result = await api("/api/office/telegram/upgrade", { method: "POST", body: { auth: user, deviceKey: deviceKey(), password: pass } });
    if (!result.ok || !result.profile) return upgradeError(result.error || "沒有切換成功，請再試一次");
    $("tg-upgrade-password").value = "";
    $("tg-upgrade").hidden = true;
    upgraded(result);
    paint();
  };
  // The buttons only show when the owner has set up a bot.
  void api("/api/office/telegram", { token: "" }).then((config) => {
    if (!config.ok || typeof config.bot !== "string" || !config.bot) return;
    bot = config.bot;
    widget($("tg-login"), "onTelegramAuth(user)");
    $("tg-login").hidden = false;
    paint();
  });
  return { paint };
}
