(() => {
  if (window.__profilePageSyncLoaded) return;
  window.__profilePageSyncLoaded = true;

  const STORAGE_KEY = "profile_page_sync_last_success";
  let inFlight = false;

  async function requestManagedPages() {
    const onManagedPages = location.pathname.startsWith("/pages/") &&
      new URLSearchParams(location.search).get("category") === "your_pages";
    if (onManagedPages) {
      const visiblePages = FacebookPageAssets.parsePageAssetMap(document.documentElement.outerHTML);
      if (visiblePages.length) {
        return visiblePages.map(asset => ({ id: asset.pageId, name: asset.name, avatar: asset.avatar }));
      }
    }
    const response = await fetch(new URL("/pages/?category=your_pages", location.origin), {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Facebook không trả danh sách Page (HTTP ${response.status}).`);
    const html = await response.text();
    const assets = FacebookPageAssets.parsePageAssetMap(html);
    if (!assets.length && !onManagedPages) {
      throw new Error("Facebook chỉ trả trang Page rỗng cho request. Hãy mở mục Page bạn quản lý, chờ danh sách hiện rồi đồng bộ lại.");
    }
    if (!assets.length && onManagedPages &&
        FacebookPageAssets.inspectPageReferences(document.documentElement.outerHTML).pageIdLinks > 0) {
      throw new Error("Đã thấy Page trên Facebook nhưng chưa đọc được ID và tên Page.");
    }
    return assets.map(asset => ({ id: asset.pageId, name: asset.name, avatar: asset.avatar }));
  }

  async function requestProfileDetails(profileId) {
    // Facebook often returns only the app shell to fetch(), while the visible
    // profile header is populated later by client-side requests.
    if (FacebookProfileContext.isPersonalProfilePage(document, location)) {
      const visible = FacebookProfileContext.readProfileDetails(document, location);
      if (visible.profileId === profileId && visible.name) return visible;
    }
    const profileUrl = new URL(`/profile.php?id=${encodeURIComponent(profileId)}`, location.origin);
    const response = await fetch(profileUrl, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Facebook profile trả HTTP ${response.status}.`);
    const html = await response.text();
    const profile = FacebookProfileContext.readProfileDetails(new DOMParser().parseFromString(html, "text/html"), profileUrl);
    if (!profile.name) {
      const saved = await chrome.storage.local.get("profile_page_sync_profile");
      const cached = saved.profile_page_sync_profile;
      if (cached?.id === profileId && cached.name && !/^facebook(?: user)?$/i.test(cached.name)) {
        return { profileId, name: cached.name, avatar: cached.avatar || "", profileUrl: cached.profileUrl || profileUrl.href };
      }
      throw new Error("Facebook chưa trả tên profile. Hãy mở trang profile cá nhân, chờ tải xong rồi đồng bộ lại.");
    }
    profile.profileId = profileId;
    profile.profileUrl = profileUrl.href;
    return profile;
  }

  // --- FLOATING SYNC WIDGET GÓC DƯỚI BÊN PHẢI ---
  function injectFloatingSyncWidget() {
    if (typeof document === "undefined" || !document?.getElementById) return;
    if (document.getElementById("bug-sync-widget-root")) return;
    if (!document.body) return;

    const container = document.createElement("div");
    container.id = "bug-sync-widget-root";
    container.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none;
      touch-action: none;
    `;

    // Toast status info
    const statusMsg = document.createElement("div");
    statusMsg.id = "bug-sync-status-msg";
    statusMsg.style.cssText = `
      display: none;
      background: rgba(30, 30, 35, 0.92);
      color: #fff;
      padding: 7px 14px;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 500;
      max-width: 280px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
      animation: fadeIn 0.2s ease;
      white-space: nowrap;
    `;

    // Button container
    const btn = document.createElement("button");
    btn.id = "bug-sync-floating-btn";
    btn.type = "button";
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px 8px 10px;
      background: linear-gradient(135deg, #e11d48, #be123c);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 99px;
      font-size: 13px;
      font-weight: 700;
      cursor: grab;
      box-shadow: 0 6px 20px rgba(225, 29, 72, 0.4);
      transition: box-shadow 0.2s ease, opacity 0.2s ease;
      outline: none;
    `;

    const logoUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL("assets/icons/icon-48.png") : "";
    const logoImg = logoUrl
      ? `<img src="${logoUrl}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;box-shadow:0 1px 3px rgba(0,0,0,0.3);flex-shrink:0;">`
      : `<svg id="bug-sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`;

    const spinSvg = `
      <svg id="bug-sync-spinner" style="display:none;width:15px;height:15px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
    `;

    btn.innerHTML = `
      ${logoImg}
      ${spinSvg}
      <span id="bug-sync-btn-text">Đồng bộ</span>
    `;

    // Sub-link "Xem chi tiết"
    const detailLink = document.createElement("a");
    detailLink.id = "bug-sync-detail-link";
    detailLink.textContent = "Xem chi tiết";
    detailLink.style.cssText = `
      font-size: 11px;
      color: #64748b;
      text-decoration: underline;
      cursor: pointer;
      padding-right: 10px;
      font-weight: 500;
      transition: color 0.15s ease;
    `;
    detailLink.onmouseenter = () => { detailLink.style.color = "#e11d48"; };
    detailLink.onmouseleave = () => { detailLink.style.color = "#64748b"; };

    detailLink.onclick = (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
    };

    // --- CƠ CHẾ KÉO THẢ (DRAG & DROP) ---
    let isDragging = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    const onPointerDown = (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;

      // Chuyển sang fixed vị trí top/left để di chuyển mượt mà
      container.style.right = "auto";
      container.style.bottom = "auto";
      container.style.left = `${origLeft}px`;
      container.style.top = `${origTop}px`;
      btn.style.cursor = "grabbing";

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasMoved = true;
      }
      let newLeft = origLeft + dx;
      let newTop = origTop + dy;

      // Giới hạn trong màn hình viewport
      const pad = 10;
      newLeft = Math.max(pad, Math.min(window.innerWidth - container.offsetWidth - pad, newLeft));
      newTop = Math.max(pad, Math.min(window.innerHeight - container.offsetHeight - pad, newTop));

      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
    };

    const onPointerUp = () => {
      isDragging = false;
      btn.style.cursor = "grab";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    btn.addEventListener("pointerdown", onPointerDown);

    // Keyframe spin animation
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      @keyframes bugSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      .bug-spinning { animation: bugSpin 0.9s linear infinite; }
    `;
    document.head?.appendChild(styleEl);

    // Click Đồng bộ ngay (chỉ kích hoạt nếu không phải là thao tác kéo thả)
    btn.onclick = async (e) => {
      if (hasMoved) return; // Nếu vừa kéo thả thì không trigger click
      if (inFlight) return;

      inFlight = true;
      const textSpan = btn.querySelector("#bug-sync-btn-text");
      const spinner = btn.querySelector("#bug-sync-spinner");

      textSpan.textContent = "Đang đồng bộ…";
      if (spinner) {
        spinner.style.display = "inline-block";
        spinner.classList.add("bug-spinning");
      }
      btn.style.opacity = "0.9";
      btn.style.pointerEvents = "none";

      statusMsg.style.display = "block";
      statusMsg.textContent = "Đang quét dữ liệu Facebook…";
      statusMsg.style.color = "#93c5fd";

      chrome.runtime.sendMessage({ action: "MANUAL_SYNC" }, (res) => {
        inFlight = false;
        if (spinner) {
          spinner.classList.remove("bug-spinning");
          spinner.style.display = "none";
        }
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
        textSpan.textContent = "Đồng bộ";

        if (res?.success) {
          statusMsg.textContent = `✓ Đã đồng bộ ${res.pageCount || 0} Page thành công!`;
          statusMsg.style.color = "#86efac";
          setTimeout(() => { statusMsg.style.display = "none"; }, 4000);
        } else {
          statusMsg.textContent = `✗ ${res?.error || "Lỗi đồng bộ"}`;
          statusMsg.style.color = "#fca5a5";
          setTimeout(() => { statusMsg.style.display = "none"; }, 5000);
        }
      });
    };

    container.appendChild(statusMsg);
    container.appendChild(btn);
    container.appendChild(detailLink);
    document.body.appendChild(container);
  }

  // Khởi chạy widget khi DOM sẵn sàng
  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectFloatingSyncWidget);
    } else {
      injectFloatingSyncWidget();
    }
  }
  if (typeof setInterval !== "undefined") {
    setInterval(injectFloatingSyncWidget, 2500);
  }

  async function syncProfileAndPages(profileId) {
    if (inFlight) return { success: false, skipped: true };
    if (!/^[1-9]\d{0,31}$/.test(String(profileId || ""))) {
      throw new Error("Không đọc được ID profile Facebook đang đăng nhập.");
    }
    inFlight = true;

    try {
      ProfileSyncStatus.showStatus("Đang gọi request lấy profile và danh sách Page Facebook...");
      const profile = await requestProfileDetails(profileId);
      const pages = await requestManagedPages();
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "SYNC_PROFILE_AND_PAGES", profile, pages }, response => {
          const transportError = chrome.runtime.lastError?.message;
          if (transportError) reject(new Error(transportError));
          else resolve(response);
        });
      });
      if (!result?.success) throw new Error(result?.error || "Không đồng bộ được profile và Page.");

      const syncedAt = Date.now();
      const pageCount = Number(result.pageCount) || 0;
      const syncMessage = pageCount > 0
        ? `Đã đồng bộ profile và ${pageCount} Page.`
        : "Đã đồng bộ profile; Facebook hiện không có Page đang hoạt động để đồng bộ.";
      const saved = await chrome.storage.local.get(STORAGE_KEY);
      await chrome.storage.local.set({
        [STORAGE_KEY]: { ...(saved?.[STORAGE_KEY] || {}), [profileId]: syncedAt },
        profile_page_sync_status: {
          state: "success",
          message: syncMessage,
          checkedAt: syncedAt,
          profileId,
          pageCount,
        },
      });
      ProfileSyncStatus.showStatus(syncMessage);
      return { success: true, profileId, pageCount, syncedAt };
    } catch (error) {
      const message = error?.message || "Đồng bộ thất bại.";
      await chrome.storage.local.set({ profile_page_sync_status: {
        state: "error", message, checkedAt: Date.now(), profileId,
      } });
      ProfileSyncStatus.showStatus(message, true);
      return { success: false, error: message };
    } finally {
      inFlight = false;
    }
  }

  async function collectProfileAndPages(profileId) {
    if (!/^[1-9]\d{0,31}$/.test(String(profileId || ""))) {
      throw new Error("Không đọc được ID profile Facebook đang đăng nhập.");
    }
    const profile = await requestProfileDetails(profileId);
    const pages = await requestManagedPages();
    return { success: true, profile, pages };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "READ_CONTENT_SUMMARY") {
      try {
        const insights = globalThis.FacebookContentSummary?.readContentSummary(document, location.href);
        const ready = Number.isFinite(insights?.overview?.views) || (insights?.contents || []).length > 0;
        sendResponse({ success: true, ready, insights });
      } catch (error) {
        sendResponse({ success: false, ready: false, error: error?.message || "Không đọc được Content Insights." });
      }
      return true;
    }
    if (message?.action === "COLLECT_PROFILE_AND_PAGES") {
      collectProfileAndPages(message.profileId).then(sendResponse).catch(error => {
        sendResponse({ success: false, error: error?.message || "Không đọc được profile và Page." });
      });
      return true;
    }
    if (message?.action !== "RUN_MANUAL_SYNC") return false;
    syncProfileAndPages(message.profileId).then(sendResponse).catch(error => {
      sendResponse({ success: false, error: error?.message || "Đồng bộ Facebook thất bại." });
    });
    return true;
  });
})();
