(() => {
  const PAGE_CACHE_KEY = "profile_page_sync_pages";
  async function validateProfileSession(profile, getCookies = () => chrome.cookies.getAll({ domain: "facebook.com" }), options = {}) {
    const cookies = await getCookies();
    const cookie = name => String(cookies.find(item => item.name === name)?.value || "");
    const profileId = String(profile?.profileId || "");
    const cUser = cookie("c_user");
    const iUser = cookie("i_user");
    if (!/^[1-9]\d{0,31}$/.test(cUser)) throw new Error("Không tìm thấy phiên Facebook cá nhân đang đăng nhập.");
    if (!/^[1-9]\d{0,31}$/.test(profileId)) throw new Error("Không đọc được ID profile đang mở.");
    if (profileId !== cUser) throw new Error("Profile đang mở không khớp tài khoản Facebook đăng nhập.");
    if (!options.allowFanpageMode && iUser && iUser !== "0" && iUser !== cUser) {
      throw new Error("Facebook đang dùng danh tính Page. Hãy chuyển về profile cá nhân.");
    }
    return profileId;
  }

  async function syncPageList(profile, pages, dependencies = {}) {
    const getCookies = dependencies.getCookies || (() => chrome.cookies.getAll({ domain: "facebook.com" }));
    const profileId = await validateProfileSession(profile, getCookies, { allowFanpageMode: !!dependencies.allowFanpageMode });
    const profileName = String(profile?.name || "").trim();
    if (!profileName || /^facebook(?: user)?$/i.test(profileName)) {
      throw new Error("Không đọc được tên profile Facebook. Hãy mở profile cá nhân rồi đồng bộ lại.");
    }
    const syncProfile = dependencies.syncProfile || FacebookSyncApi.syncProfile;
    const syncPages = dependencies.syncPages || FacebookSyncApi.syncPages;
    if (!Array.isArray(pages)) throw new Error("Response danh sách Page Facebook không hợp lệ.");
    const safePages = pages.map(page => ({ ...page, id: page.id || page.pageId }))
      .filter(page => /^[1-9]\d{0,31}$/.test(String(page.id)) && String(page.id) !== profileId);

    await syncProfile({
      fb_uid: profileId,
      name: profileName,
      avatar_url: profile?.avatar || undefined,
      profile_status: "Live",
    });
    await syncPages(safePages.map(page => ({
      page_uid: String(page.id),
      name: String(page.name || `Page ${page.id}`).trim(),
      ...(page.avatar ? { avatar_url: String(page.avatar) } : {}),
      fb_profile_uid: profileId,
      page_status: "Hoạt động",
      page_url: `https://facebook.com/${page.id}`,
    })));

    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      const saved = await chrome.storage.local.get(PAGE_CACHE_KEY);
      await chrome.storage.local.set({ [PAGE_CACHE_KEY]: {
        ...(saved?.[PAGE_CACHE_KEY] || {}),
        [profileId]: safePages.map(page => ({
          id: String(page.id),
          name: String(page.name || "").trim(),
          ...(page.avatar ? { avatar: String(page.avatar) } : {}),
        })),
      }, profile_page_sync_profile: {
        id: profileId,
        name: profileName,
        avatar: String(profile?.avatar || ""),
        profileUrl: String(profile?.profileUrl || ""),
      } });
    }

    return { success: true, profileId, pageCount: safePages.length };
  }

  async function syncMetrics(pageName, metrics, dependencies = {}) {
    const getCookies = dependencies.getCookies || (() => chrome.cookies.getAll({ domain: "facebook.com" }));
    const profileId = await validateProfileSession({ profileId: "" }, getCookies).catch(async error => {
      const cookies = await getCookies();
      const current = String(cookies.find(item => item.name === "c_user")?.value || "");
      if (!/^[1-9]\d{0,31}$/.test(current)) throw error;
      const activeIdentity = String(cookies.find(item => item.name === "i_user")?.value || "0");
      if (activeIdentity !== "0" && activeIdentity !== current) throw new Error("Hãy chuyển về profile cá nhân trước khi đồng bộ metrics.");
      return current;
    });
    const getStorage = dependencies.getStorage || (() => chrome.storage.local.get(PAGE_CACHE_KEY));
    const cached = await getStorage();
    const pages = cached?.[PAGE_CACHE_KEY]?.[profileId] || [];
    const matched = pages.find(page => page.name === String(pageName || "").trim());
    if (!matched) throw new Error("Page đang mở chưa khớp Page nào đã đồng bộ trong profile này.");

    const update = {};
    for (const key of ["follow_count", "views_7d"]) {
      const value = metrics?.[key];
      if (Number.isSafeInteger(value) && value >= 0) update[key] = value;
    }
    if (!Object.keys(update).length) return { success: true, skipped: true, pageName: matched.name };

    const uploadPages = dependencies.syncPages || FacebookSyncApi.syncPages;
    await uploadPages([{
      page_uid: matched.id,
      name: matched.name,
      fb_profile_uid: profileId,
      page_url: `https://facebook.com/${matched.id}`,
      page_status: "Hoạt động",
      ...update,
    }]);
    return { success: true, pageName: matched.name, ...update };
  }

  globalThis.ProfilePageSync = { validateProfileSession, syncPageList, syncMetrics };
})();
