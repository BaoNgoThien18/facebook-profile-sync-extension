(() => {
  let timer = null;

  function showStatus(message, isError = false) {
    if (!document.body) return;
    let toast = document.getElementById("profile-page-sync-status");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "profile-page-sync-status";
      toast.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:420px;padding:12px 16px;border:1px solid #dbe3ef;border-radius:12px;background:#fff;box-shadow:0 8px 28px #0002;font:600 14px/1.4 system-ui,sans-serif;";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.color = isError ? "#b42318" : "#1d4ed8";
    clearTimeout(timer);
    if (!isError) timer = setTimeout(() => toast.remove(), 7000);
  }

  globalThis.ProfileSyncStatus = { showStatus };
})();
