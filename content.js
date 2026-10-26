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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== "RUN_MANUAL_SYNC") return false;
    syncProfileAndPages(message.profileId).then(sendResponse).catch(error => {
      sendResponse({ success: false, error: error?.message || "Đồng bộ Facebook thất bại." });
    });
    return true;
  });
})();
