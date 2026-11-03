(() => {
  const KEY_PAGES = "profile_page_sync_pages";
  const KEY_PROFILE = "profile_page_sync_profile";
  const KEY_SUCCESS = "profile_page_sync_last_success";
  const KEY_STATUS = "profile_page_sync_status";
  const KEY_USER_TOKEN = "buglab_user_api_token";
  const KEY_SERVER_SYNC_ENABLED = "buglab_server_sync_enabled";
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
    const tbody = $("#pages-tbody");
    if (!tbody) return;
    tbody.replaceChildren();
    const items = Array.isArray(pages) ? pages : [];
    $("#page-count").textContent = String(items.length);
    $("#pages-count-label").textContent = `${items.length} Page${items.length === 1 ? "" : "s"}`;
    $("#empty-state").hidden = items.length > 0;
    $("#pages-table").hidden = items.length === 0;

    const FB_CLIENT_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";
    for (const page of items) {
      const tr = document.createElement("tr");

      // Cột 1: Page Avatar + Tên
      const tdPage = document.createElement("td");
      const infoWrap = document.createElement("div");
      infoWrap.className = "table-page-info";

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
        infoWrap.append(image);
      } else {
        infoWrap.append(makePageInitial(page.name));
      }

      const textWrap = document.createElement("div");
      const nameEl = document.createElement("strong");
      nameEl.textContent = page.name || `Page ${page.id}`;
      const subEl = document.createElement("span");
      subEl.textContent = "Meta Business Suite";
      textWrap.append(nameEl, subEl);
      infoWrap.append(textWrap);
      tdPage.append(infoWrap);

      // Cột 2: ID Page
      const tdId = document.createElement("td");
      tdId.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
      tdId.textContent = page.id;

      // Cột 3: Video 7 ngày
      const tdVideos = document.createElement("td");
      const videoBadge = document.createElement("span");
      videoBadge.className = "badge-count";
      const vidCount = Number.isSafeInteger(page.video_count_7d) ? page.video_count_7d : "—";
      videoBadge.textContent = `${vidCount} video`;
      tdVideos.append(videoBadge);

      // Cột 4: Lượt xem 7 ngày
      const tdViews = document.createElement("td");
      const viewsBadge = document.createElement("span");
      viewsBadge.className = "badge-views";
      const viewsCount = Number.isSafeInteger(page.views_7d) ? page.views_7d.toLocaleString() : "—";
      viewsBadge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${viewsCount} views`;
      tdViews.append(viewsBadge);

      // Cột 5: Trạng thái
      const tdStatus = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = "page-ok";
      statusBadge.textContent = "Đã đồng bộ";
      tdStatus.append(statusBadge);

      // Cột 6: Thao tác mở Business Suite
      const tdAction = document.createElement("td");
      tdAction.style.textAlign = "right";
      const openBtn = document.createElement("button");
      openBtn.className = "btn-table-action";
      openBtn.type = "button";
      openBtn.textContent = "Mở MBS ↗";
      openBtn.onclick = () => {
        if (chrome?.tabs?.create) {
          chrome.tabs.create({ url: `https://business.facebook.com/latest/home?asset_id=${page.id}` });
        }
      };
      tdAction.append(openBtn);

      tr.append(tdPage, tdId, tdVideos, tdViews, tdStatus, tdAction);
      tbody.append(tr);
    }
  }

  function makePageInitial(name = "P") {
    const initial = document.createElement("span");
    initial.className = "page-avatar";
    initial.textContent = String(name).trim().charAt(0).toUpperCase() || "P";
    return initial;
  }

  function switchView(view) {
    document.querySelectorAll(".nav-item").forEach(item => {
      const match = item.dataset.view === view;
      item.classList.toggle("active", match);
      if (match) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    $("#view-title").textContent = titleByView[view] || "Profile Sync";

    const isSync = view === "sync";
    const isSettings = view === "settings";
    const isSoon = !isSync && !isSettings;

    $("#view-sync").classList.toggle("active", isSync);
    $("#view-sync").hidden = !isSync;

    const settingsEl = $("#view-settings");
    if (settingsEl) {
      settingsEl.classList.toggle("active", isSettings);
      settingsEl.hidden = !isSettings;
      if (isSettings) loadSettings();
    }

    const soon = $("#view-soon");
    soon.hidden = !isSoon;
    soon.classList.toggle("active", isSoon);
    $("#soon-title").textContent = titleByView[view] || "Sắp có";
  }

  async function checkTokenRequirement() {
    if (!chrome?.storage?.local) return "";
    const res = await chrome.storage.local.get(KEY_USER_TOKEN);
    const token = (res?.[KEY_USER_TOKEN] || "").trim();
    const banner = $("#token-required-banner");
    const syncBtn = $("#sync-now-button");

    if (!token) {
      if (banner) banner.hidden = false;
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.title = "Vui lòng nhập Token nhân viên trong Cài đặt trước khi sử dụng.";
      }
      return "";
    } else {
      if (banner) banner.hidden = true;
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.title = "";
      }
      return token;
    }
  }

  async function refresh() {
    if (!chrome?.storage?.local) return;
    try {
      await checkTokenRequirement();
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


  async function loadSettings() {
    if (!chrome?.storage?.local) return;
    const res = await chrome.storage.local.get([KEY_USER_TOKEN, KEY_SERVER_SYNC_ENABLED]);
    const token = res?.[KEY_USER_TOKEN] || "";
    const input = $("#input-user-token");
    if (input) input.value = token;

    const toggle = $("#toggle-server-sync");
    if (toggle) {
      // Mặc định là bật (true) nếu chưa từng thiết lập
      toggle.checked = res?.[KEY_SERVER_SYNC_ENABLED] !== false;
    }
  }

  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
    switchView(button.dataset.view);
  }));

  $("#btn-goto-settings")?.addEventListener("click", () => {
    switchView("settings");
    const input = $("#input-user-token");
    if (input) {
      setTimeout(() => input.focus(), 150);
    }
  });

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
    const saveBtn = $("#btn-save-token");
    const token = (input?.value || "").trim();

    if (!token) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = "save-status-msg error";
        statusEl.textContent = "✗ Vui lòng nhập token nhân viên trước khi lưu.";
      }
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.lastChild.textContent = " Đang kiểm tra token…";
    }

    // Xác thực token với server BugLab trước khi cho lưu
    let verifyResult = { valid: false, message: "" };
    if (typeof FacebookSyncApi !== "undefined" && FacebookSyncApi.verifyUserToken) {
      verifyResult = await FacebookSyncApi.verifyUserToken(token);
    } else {
      // Fallback kiểm tra trực tiếp
      try {
        const resp = await fetch("https://facebook.buglogin.com/api/v1/profiles?limit=1", {
          headers: { Accept: "application/json", "X-API-Key": token, Authorization: `Bearer ${token}` },
        });
        const d = await resp.json().catch(() => null);
        if (resp.status === 200) verifyResult = { valid: true };
        else verifyResult = { valid: false, message: d?.message || "Token không hợp lệ." };
      } catch (e) {
        verifyResult = { valid: false, message: "Không thể kết nối máy chủ để kiểm tra token." };
      }
    }

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.lastChild.textContent = " Lưu Token";
    }

    if (!verifyResult.valid) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = "save-status-msg error";
        statusEl.textContent = `✗ ${verifyResult.message || "Token không hợp lệ hoặc đã bị khóa."}`;
      }
      return;
    }

    if (!chrome?.storage?.local) return;
    await chrome.storage.local.set({ [KEY_USER_TOKEN]: token });

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = "save-status-msg success";
      statusEl.textContent = "✓ Token hợp lệ! Đã lưu thành công.";
      setTimeout(() => {
        statusEl.hidden = true;
      }, 3500);
    }

    await checkTokenRequirement();
  });

  // Toggle server sync checkbox
  $("#toggle-server-sync")?.addEventListener("change", async (e) => {
    if (!chrome?.storage?.local) return;
    const isEnabled = e.target.checked;
    await chrome.storage.local.set({ [KEY_SERVER_SYNC_ENABLED]: isEnabled });
  });

  $("#sync-now-button").addEventListener("click", async () => {
    const token = await checkTokenRequirement();
    if (!token) {
      $("#sync-status").textContent = "Vui lòng cấu hình Token nhân viên trong Cài đặt trước.";
      switchView("settings");
      const input = $("#input-user-token");
      if (input) setTimeout(() => input.focus(), 150);
      return;
    }

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
  loadSettings();
})();
