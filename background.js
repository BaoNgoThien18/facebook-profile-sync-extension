importScripts(
  "modules/facebook/facebook-api.js",
  "modules/server/sync-api.js",
  "modules/sync/sync-service.js",
);

async function setupDNRRules() {
  if (typeof chrome === "undefined" || !chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map((r) => r.id);
    if (ruleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
      });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1,
          priority: 1,
          condition: {
            urlFilter: "||facebook.com/api/graphql*",
            resourceTypes: ["xmlhttprequest", "other"],
            excludedInitiatorDomains: ["facebook.com"],
          },
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://www.facebook.com" },
              { header: "Referer", operation: "set", value: "https://www.facebook.com/" },
              { header: "Sec-Fetch-Site", operation: "set", value: "same-origin" },
              { header: "Sec-Fetch-Mode", operation: "set", value: "cors" },
              { header: "Sec-Fetch-Dest", operation: "set", value: "empty" },
            ],
          },
        },
        {
          id: 2,
          priority: 1,
          condition: {
            urlFilter: "||business.facebook.com/api/graphql*",
            resourceTypes: ["xmlhttprequest", "other"],
            initiatorDomains: [chrome.runtime?.id || "chrome-extension"],
          },
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://business.facebook.com" },
              { header: "Referer", operation: "set", value: "https://business.facebook.com/latest" },
              { header: "Sec-Fetch-Site", operation: "set", value: "same-origin" },
            ],
          },
        },
      ],
    });
  } catch (err) {
    console.warn("[DNR Rules] Không thể thiết lập header rules:", err);
  }
}

if (typeof chrome !== "undefined") {
  chrome.runtime?.onInstalled?.addListener(() => { setupDNRRules(); });
  chrome.runtime?.onStartup?.addListener(() => { setupDNRRules(); });
  setupDNRRules();
}

async function setSyncStatus(state, message, details = {}) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
    await chrome.storage.local.set({ profile_page_sync_status: {
      state,
      message,
      checkedAt: Date.now(),
      ...details,
    } });
  }
}

async function runManualSync() {
  const cookies = (typeof chrome !== "undefined" && chrome.cookies?.getAll)
    ? await chrome.cookies.getAll({ domain: "facebook.com" })
    : [];
  const cookie = name => String(cookies.find(item => item.name === name)?.value || "");
  const profileId = cookie("c_user");
  if (!/^[1-9]\d{0,31}$/.test(profileId)) {
    throw new Error("Hãy đăng nhập Facebook trước khi đồng bộ.");
  }

  await setSyncStatus("checking", "Đang kết nối Facebook API và trích xuất token...", { profileId });

  let account = null;
  let pages = [];

  // 1. Thử lấy dữ liệu trực tiếp bằng FacebookAPI (chuẩn Boclinkaff)
  if (typeof FacebookAPI !== "undefined" && FacebookAPI.getAccountAndDtsg) {
    try {
      account = await FacebookAPI.getAccountAndDtsg();
      const realUid = account.cUserId || account.userId || profileId;
      await setSyncStatus("checking", "Đang quét danh sách Fanpage Facebook...", { profileId: realUid });
      pages = await FacebookAPI.getUserPages({
        dtsg: account.dtsg,
        userId: realUid,
      });
    } catch (apiError) {
      console.warn("[Background] FacebookAPI trực tiếp gặp lỗi, thử fallback qua Tab:", apiError);
    }
  }

  // 2. Fallback qua Tab content script nếu direct fetch chưa thành công
  if (!account || !account.name || account.name === "Facebook User") {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      const tabs = await chrome.tabs.query({ url: [
        "https://facebook.com/*",
        "https://www.facebook.com/*",
        "https://*.facebook.com/*",
      ] });
      const facebookTabs = tabs.filter(tab => {
        if (tab.id == null) return false;
        try { return new URL(tab.url).hostname !== "business.facebook.com"; }
        catch (_) { return false; }
      });
      facebookTabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
        Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
      const targetTab = facebookTabs[0];

      if (targetTab?.id != null) {
        try {
          const tabResult = await chrome.tabs.sendMessage(targetTab.id, { action: "RUN_MANUAL_SYNC", profileId });
          if (tabResult?.success) return tabResult;
        } catch (_) {}
      }
    }
  }

  const realProfileId = account?.cUserId || account?.userId || profileId;
  const realName = account?.name && account.name !== "Facebook User" ? account.name : `Facebook User ${realProfileId}`;

  await setSyncStatus("checking", "Đang lưu dữ liệu Profile và Page lên hệ thống BugLab...", {
    profileId: realProfileId,
    pageCount: pages.length,
  });

  const syncResult = await ProfilePageSync.syncPageList({
    profileId: realProfileId,
    name: realName,
    avatar: account?.avatar || `https://graph.facebook.com/${realProfileId}/picture?height=100`,
    profileUrl: `https://facebook.com/${realProfileId}`,
  }, pages, { allowFanpageMode: true });

  if (!syncResult?.success) {
    throw new Error(syncResult?.error || "Đồng bộ Facebook lên hệ thống thất bại.");
  }

  const syncedAt = Date.now();
  const pageCount = Number(syncResult.pageCount ?? pages.length) || 0;
  const syncMessage = pageCount > 0
    ? `Đã đồng bộ profile và ${pageCount} Page.`
    : "Đã đồng bộ profile; Facebook hiện không có Page đang hoạt động để đồng bộ.";

  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    const saved = await chrome.storage.local.get(["profile_page_sync_last_success", "profile_page_sync_pages"]);
    await chrome.storage.local.set({
      profile_page_sync_profile: {
        id: realProfileId,
        name: realName,
        avatar: account?.avatar || `https://graph.facebook.com/${realProfileId}/picture?height=100`,
        profileUrl: `https://facebook.com/${realProfileId}`,
      },
      profile_page_sync_pages: {
        ...(saved?.profile_page_sync_pages || {}),
        [realProfileId]: pages.map(p => ({
          id: String(p.id || p.pageId),
          name: String(p.name || "Facebook Page"),
          avatar: String(p.avatar || ""),
        })),
      },
      profile_page_sync_last_success: {
        ...(saved?.profile_page_sync_last_success || {}),
        [realProfileId]: syncedAt,
      },
      profile_page_sync_status: {
        state: "success",
        message: syncMessage,
        checkedAt: syncedAt,
        profileId: realProfileId,
        pageCount,
      },
    });
  }

  return { success: true, profileId: realProfileId, pageCount, syncedAt };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.action?.onClicked?.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.action === "SYNC_PROFILE_AND_PAGES") {
      const url = sender.tab?.url || "";
      let isFacebookTab = false;
      try { isFacebookTab = /(^|\.)facebook\.com$/i.test(new URL(url).hostname); }
      catch (_) {}
      if (!isFacebookTab) {
        sendResponse({ success: false, error: "Yêu cầu đồng bộ không đến từ tab Facebook." });
        return false;
      }
      ProfilePageSync.syncPageList(message.profile, message.pages)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error?.message || "Server không nhận dữ liệu Facebook." }));
      return true;
    }
    if (message?.action !== "MANUAL_SYNC") return false;
    runManualSync().then(sendResponse).catch(async error => {
      const messageText = error?.message || "Không đồng bộ được Facebook.";
      await setSyncStatus("error", messageText);
      sendResponse({ success: false, error: messageText });
    });
    return true;
  });
}

if (typeof module !== "undefined") {
  module.exports = { runManualSync };
}
