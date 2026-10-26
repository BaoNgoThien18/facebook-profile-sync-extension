(() => {
  const API_BASE = "https://facebook.buglab.vn/api/v1/sync";

  async function getUserApiToken() {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      try {
        const data = await chrome.storage.local.get("buglab_user_api_token");
        return (data?.buglab_user_api_token || "").trim();
      } catch (_) {}
    }
    return "";
  }

  async function postJson(path, body) {
    const token = await getUserApiToken();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers["X-API-Key"] = token;
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.message || `Server từ chối đồng bộ ${path} (HTTP ${response.status}).`);
    }
    return result;
  }

  async function syncProfile(profile) {
    return postJson("profiles", { profiles: [profile] });
  }

  async function syncPages(pages) {
    if (!pages.length) return { success: true, skipped: true };
    return postJson("pages", { pages });
  }

  globalThis.FacebookSyncApi = { postJson, syncProfile, syncPages };
})();
