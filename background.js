importScripts(
  "modules/facebook/facebook-api.js",
  "modules/facebook/business-insights-api.js",
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
          },
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Origin", operation: "set", value: "https://business.facebook.com" },
              { header: "Referer", operation: "set", value: "https://business.facebook.com/latest/posts/published_posts/" },
              { header: "Sec-Fetch-Site", operation: "set", value: "same-origin" },
              { header: "Sec-Fetch-Mode", operation: "set", value: "cors" },
              { header: "Sec-Fetch-Dest", operation: "set", value: "empty" },
              { header: "X-ASBD-ID", operation: "set", value: "359341" },
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        finish();
      }
    }).catch(() => {});
  });
}

async function readContentSummaryTab(tabId) {
  const started = Date.now();
  while (Date.now() - started < 28000) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: "READ_CONTENT_SUMMARY" });
      if (response?.ready && response.insights) return response.insights;
    } catch (_) {}
    await delay(1000);
  }
  return null;
}

function applyInsights(page, insights) {
  page.insights = insights;
  if (Number.isFinite(insights?.overview?.views)) page.views_7d = insights.overview.views;
  const published = Number(insights?.formats?.reels || 0) + Number(insights?.formats?.stories || 0);
  const counted = published || (Array.isArray(insights?.contents) ? insights.contents.length : 0);
  if (counted > 0) page.video_count_7d = counted;
}

async function scrapeContentSummaries(pages, profileId) {
  if (!pages.length || typeof chrome === "undefined" || !chrome.tabs?.create) return 0;
  let tab = null;
  let scraped = 0;
  try {
    tab = await chrome.tabs.create({ url: "about:blank", active: false });
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const assetId = String(page.assetId || page.asset_id || page.id || page.pageId || "");
      if (!/^[1-9]\d{0,31}$/.test(assetId)) continue;
      const url = `https://business.facebook.com/latest/insights/content_summary?asset_id=${assetId}`;
      await setSyncStatus("checking", `Đang mở Content Insights ${index + 1}/${pages.length} và đợi trang tải...`, { profileId });
      await chrome.tabs.update(tab.id, { url });
      await waitForTabComplete(tab.id);
      const insights = await readContentSummaryTab(tab.id);
      if (insights?.overview || insights?.contents?.length) {
        applyInsights(page, insights);
        scraped += 1;
      }
    }
  } catch (error) {
    console.warn("[Background] Không đọc được Content Insights:", error);
  } finally {
    if (tab?.id != null) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
  return scraped;
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
  // Không có token vẫn quét Page, số video và lượt xem để hiện trên dashboard.
  // Token chỉ dùng khi đẩy dữ liệu lên server.
  let employeeToken = "";
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    const tokenData = await chrome.storage.local.get("buglab_user_api_token");
    employeeToken = (tokenData?.buglab_user_api_token || "").trim();
  }

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

  // 2. Fallback qua Tab chỉ để lấy tên profile và danh sách Page.
  // Không kết thúc ở đây: view và video luôn được quét ở bước sau.
  const needsTabList = !account || !account.name || account.name === "Facebook User" || !pages.length;
  if (needsTabList && typeof chrome !== "undefined" && chrome.tabs?.query) {
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
        const collected = await chrome.tabs.sendMessage(targetTab.id, { action: "COLLECT_PROFILE_AND_PAGES", profileId });
        if (collected?.success) {
          const collectedName = String(collected.profile?.name || "").trim();
          if (collectedName && !/^facebook(?: user)?$/i.test(collectedName)) {
            account = {
              ...(account || {}),
              name: collectedName,
              cUserId: collected.profile?.profileId || account?.cUserId || profileId,
              avatar: collected.profile?.avatar || account?.avatar || "",
            };
          }
          if (!pages.length && Array.isArray(collected.pages)) pages = collected.pages;
        }
      } catch (_) {}
    }
  }

  const statsProfileId = account?.cUserId || account?.userId || profileId;
  const scrapedCount = await scrapeContentSummaries(pages, statsProfileId);
  if (!scrapedCount && pages.length && account?.dtsg && typeof FacebookBusinessInsightsApi !== "undefined" && FacebookBusinessInsightsApi.fetchWeeklyVideosAndViews) {
    await setSyncStatus("checking", `Đang lấy video và views 7 ngày qua cho ${pages.length} Page...`, { profileId: statsProfileId });
    for (const page of pages) {
      const pageId = page.id || page.pageId;
      if (!pageId) continue;
      try {
        const stats = await FacebookBusinessInsightsApi.fetchWeeklyVideosAndViews(pageId, {
          fb_dtsg: account.dtsg,
          lsd: account.lsd || "cB4dmWcFc9EdW3lIItBEZs",
        });
        if (stats?.hasData || Number.isSafeInteger(stats?.views_7d) || Number.isSafeInteger(stats?.video_count_7d)) {
          page.views_7d = Number.isSafeInteger(stats.views_7d) ? stats.views_7d : 0;
          page.video_count_7d = Number.isSafeInteger(stats.video_count_7d) ? stats.video_count_7d : 0;
        }
      } catch (statErr) {
        console.warn(`[Background] Không lấy được stats video 7d cho page ${pageId}:`, statErr);
      }
    }
  }

  const realProfileId = account?.cUserId || account?.userId || profileId;
  const realName = account?.name && account.name !== "Facebook User" ? account.name : `Facebook User ${realProfileId}`;

  // Kiểm tra cài đặt đồng bộ server. Không có token thì chỉ lưu local.
  let isServerSyncOn = Boolean(employeeToken);
  if (employeeToken && typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    const config = await chrome.storage.local.get("buglab_server_sync_enabled");
    isServerSyncOn = config?.buglab_server_sync_enabled !== false;
  }

  const statusMsg = !employeeToken
    ? "Đã lấy video và lượt xem. Đang lưu trên dashboard, không đẩy server…"
    : isServerSyncOn
      ? "Đang lưu dữ liệu Profile, Page, video và lượt xem lên hệ thống BugLab..."
      : "Đã lấy video và lượt xem. Đang lưu trên dashboard (Server sync: Tắt)...";

  await setSyncStatus("checking", statusMsg, {
    profileId: realProfileId,
    pageCount: pages.length,
  });

  const syncResult = await ProfilePageSync.syncPageList({
    profileId: realProfileId,
    name: realName,
    avatar: account?.avatar || `https://graph.facebook.com/${realProfileId}/picture?height=100`,
    profileUrl: `https://facebook.com/${realProfileId}`,
  }, pages, { allowFanpageMode: true, enableServerSync: isServerSyncOn });

  if (!syncResult?.success) {
    throw new Error(syncResult?.error || "Đồng bộ Facebook thất bại.");
  }

  const syncedAt = Date.now();
  const pageCount = Number(syncResult.pageCount ?? pages.length) || 0;
  let syncMessage = pageCount > 0
    ? `Đã đồng bộ profile và ${pageCount} Page.`
    : "Đã đồng bộ profile; Facebook hiện không có Page đang hoạt động để đồng bộ.";
  if (!employeeToken) {
    syncMessage += " Đã quét số video và lượt xem. Chưa đẩy server vì chưa có Token.";
  } else if (!isServerSyncOn) {
    syncMessage += " (Chế độ chỉ hiển thị Dashboard)";
  }

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
          views_7d: p.views_7d ?? null,
          video_count_7d: p.video_count_7d ?? null,
          ...(p.insights ? { insights: p.insights } : {}),
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

  return { success: true, profileId: realProfileId, pageCount, syncedAt, localOnly: !employeeToken };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // Thay đổi: Không tự động mở dashboard khi click action icon nữa, chỉ kích hoạt đồng bộ hoặc mở popup
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
    if (message?.action === "OPEN_DASHBOARD") {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
      sendResponse({ success: true });
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
