(() => {
  const KEY_PAGES = "profile_page_sync_pages";
  const KEY_PROFILE = "profile_page_sync_profile";
  const KEY_SUCCESS = "profile_page_sync_last_success";
  const KEY_STATUS = "profile_page_sync_status";
  const KEY_USER_TOKEN = "buglab_user_api_token";
  const titleByView = {
    sync: "Đồng bộ profile & Page",
    posts: "Bài đăng",
    automation: "Tự động hóa",
    activity: "Hoạt động",
    settings: "Cài đặt tài khoản & Token",
  };
  const $ = selector => document.querySelector(selector);

  async function getOpenFacebookTabs() {
    if (!chrome?.tabs?.query) return [];
    const tabs = await chrome.tabs.query({ url: [
      "https://facebook.com/*",
      "https://www.facebook.com/*",
      "https://*.facebook.com/*",
    ] });
    return tabs.filter(tab => {
      try { return new URL(tab.url).hostname !== "business.facebook.com"; }
      catch (_) { return false; }
    });
  }

  function renderPages(pages) {
    const list = $("#pages-list");
    list.replaceChildren();
    const items = Array.isArray(pages) ? pages : [];
    $("#page-count").textContent = String(items.length);
    $("#pages-count-label").textContent = `${items.length} Page${items.length === 1 ? "" : "s"}`;
    $("#empty-state").hidden = items.length > 0;
    const FB_CLIENT_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";
    for (const page of items) {
      const row = document.createElement("div");
      row.className = "page-row";
      let pageAvatar = page.avatar;
      if (pageAvatar && pageAvatar.includes("graph.facebook.com") && !pageAvatar.includes("access_token")) {
        pageAvatar += `&access_token=${FB_CLIENT_TOKEN}`;
      } else if (!pageAvatar && page.id) {
        pageAvatar = `https://graph.facebook.com/${page.id}/picture?height=100&access_token=${FB_CLIENT_TOKEN}`;
      }
      if (pageAvatar) {
        const image = document.createElement("img");
        image.className = "page-avatar";
        image.src = pageAvatar;
        image.alt = "";
        image.onerror = () => { image.replaceWith(makePageInitial(page.name)); };
        row.append(image);
      } else row.append(makePageInitial(page.name));
      const copy = document.createElement("div");
      copy.className = "page-copy";
      const name = document.createElement("strong");
      name.textContent = page.name || `Page ${page.id}`;
      const id = document.createElement("span");
      id.textContent = `ID ${page.id}`;
      copy.append(name, id);
      const ok = document.createElement("span");
      ok.className = "page-ok";
      ok.textContent = "Đã đồng bộ";
      row.append(copy, ok);
      list.append(row);
    }
  }

  function makePageInitial(name = "P") {
    const initial = document.createElement("span");
    initial.className = "page-avatar";
    initial.textContent = String(name).trim().charAt(0).toUpperCase() || "P";
    return initial;
  }

  async function refresh() {
    if (!chrome?.storage?.local) return;
    try {
      const [data, facebookTabs] = await Promise.all([
        chrome.storage.local.get([KEY_PAGES, KEY_PROFILE, KEY_SUCCESS, KEY_STATUS]),
        getOpenFacebookTabs(),
      ]);
      const profile = data[KEY_PROFILE];
      const syncStatus = data[KEY_STATUS];
      const pagesByProfile = data[KEY_PAGES] || {};
      const pages = profile?.id ? pagesByProfile[profile.id] || [] : [];
      const lastSync = profile?.id ? Number((data[KEY_SUCCESS] || {})[profile.id] || 0) : 0;
      const hasFacebookTab = facebookTabs.length > 0;

    $("#profile-name").textContent = profile?.name || "Chưa đồng bộ profile";
    $("#profile-id").textContent = profile?.id
      ? `Facebook ID ${profile.id}`
      : "Sẵn sàng · nhấn Đồng bộ ngay";
    $("#profile-state-text").textContent = profile?.id ? "Đã đồng bộ" : "Chưa đồng bộ";
    $(".profile-state").classList.toggle("pending", !profile?.id);
    const FB_CLIENT_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";
    const avatar = $("#profile-avatar");
    let avatarSrc = profile?.avatar;
    if (avatarSrc && avatarSrc.includes("graph.facebook.com") && !avatarSrc.includes("access_token")) {
      avatarSrc += `&access_token=${FB_CLIENT_TOKEN}`;
    } else if (!avatarSrc && profile?.id) {
      avatarSrc = `https://graph.facebook.com/${profile.id}/picture?height=100&access_token=${FB_CLIENT_TOKEN}`;
    }

    if (avatarSrc) {
      avatar.src = avatarSrc;
      avatar.hidden = false;
      $("#profile-initial").hidden = true;
      avatar.onerror = () => {
        avatar.hidden = true;
        $("#profile-initial").hidden = false;
      };
    } else {
      avatar.hidden = true;
      $("#profile-initial").hidden = false;
    }
    $("#sync-time").textContent = lastSync ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSync)) : "Chưa có dữ liệu";
    renderPages(pages);
    $("#empty-state h3").textContent = lastSync ? "Không có Page đang hoạt động" : "Chưa có dữ liệu đồng bộ";
    $("#empty-state-message").textContent = lastSync && pages.length === 0
      ? "Profile đã đồng bộ. Facebook hiện không có Page đang hoạt động trong danh sách quản lý."
      : "Nhấn “Đồng bộ ngay” để kết nối và tự động tải thông tin Profile & Fanpage qua API.";
    $("#open-facebook").hidden = !!profile?.id;
    $("#sync-status").textContent = syncStatus?.message || "Sẵn sàng đồng bộ";
    $("#sync-status").title = syncStatus?.checkedAt
      ? `Lần kiểm tra: ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(syncStatus.checkedAt))}`
      : "";
    } catch (err) {
      console.error("Dashboard refresh error:", err);
    }
  }


  async function loadUserToken() {
    if (!chrome?.storage?.local) return;
    const res = await chrome.storage.local.get(KEY_USER_TOKEN);
    const token = res?.[KEY_USER_TOKEN] || "";
    const input = $("#input-user-token");
    if (input) input.value = token;
  }

  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
    const view = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach(item => { item.classList.toggle("active", item === button); item.removeAttribute("aria-current"); });
    button.setAttribute("aria-current", "page");
    $("#view-title").textContent = titleByView[view] || "Profile Sync";
    
    // Switch views
    const isSync = view === "sync";
    const isSettings = view === "settings";
    const isSoon = !isSync && !isSettings;

    $("#view-sync").classList.toggle("active", isSync);
    $("#view-sync").hidden = !isSync;

    const settingsEl = $("#view-settings");
    if (settingsEl) {
      settingsEl.classList.toggle("active", isSettings);
      settingsEl.hidden = !isSettings;
      if (isSettings) loadUserToken();
    }

    const soon = $("#view-soon");
    soon.hidden = !isSoon;
    soon.classList.toggle("active", isSoon);
    $("#soon-title").textContent = titleByView[view] || "Sắp có";
  }));

  // Toggle token input password / text
  $("#btn-toggle-token-visibility")?.addEventListener("click", () => {
    const input = $("#input-user-token");
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  });

  // Save token button
  $("#btn-save-token")?.addEventListener("click", async () => {
    const input = $("#input-user-token");
    const statusEl = $("#save-token-status");
    const token = (input?.value || "").trim();

    if (!chrome?.storage?.local) return;
    await chrome.storage.local.set({ [KEY_USER_TOKEN]: token });

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = "save-status-msg success";
      statusEl.textContent = token ? "✓ Đã lưu token thành công!" : "✓ Đã xóa token.";
      setTimeout(() => {
        statusEl.hidden = true;
      }, 3000);
    }
  });

  $("#sync-now-button").addEventListener("click", () => {
    const button = $("#sync-now-button");
    button.disabled = true;
    button.lastChild.textContent = " Đang đồng bộ…";
    $("#sync-status").textContent = "Đang gọi request Facebook…";
    chrome.runtime.sendMessage({ action: "MANUAL_SYNC" }, async response => {
      const transportError = chrome.runtime.lastError?.message;
      if (transportError || !response?.success) {
        $("#sync-status").textContent = response?.error || transportError || "Đồng bộ thất bại.";
      } else {
        const pageCount = Number(response.pageCount) || 0;
        $("#sync-status").textContent = pageCount > 0
          ? `Đã đồng bộ profile và ${pageCount} Page.`
          : "Đã đồng bộ profile; không có Page đang hoạt động.";
      }
      button.disabled = false;
      button.lastChild.textContent = " Đồng bộ ngay";
      await refresh();
    });
  });
  $("#open-facebook").addEventListener("click", () => {
    if (chrome?.tabs?.create) chrome.tabs.create({ url: "https://www.facebook.com/me/" });
  });
  chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && [KEY_PAGES, KEY_PROFILE, KEY_SUCCESS, KEY_STATUS].some(key => changes[key])) refresh();
  });
  chrome?.tabs?.onActivated?.addListener(() => refresh());
  chrome?.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") refresh();
  });
  chrome?.tabs?.onRemoved?.addListener(() => refresh());
  refresh();
  loadUserToken();
})();
