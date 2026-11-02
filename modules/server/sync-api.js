(() => {
  const API_BASE = "https://facebook.buglab.vn/api/v1";

  async function getUserApiToken() {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      try {
        const data = await chrome.storage.local.get("buglab_user_api_token");
        return (data?.buglab_user_api_token || "").trim();
      } catch (_) {}
    }
    return "";
  }

  async function verifyUserToken(token) {
    const rawToken = String(token || "").trim();
    if (!rawToken) {
      return { valid: false, message: "Vui lòng nhập API Token của nhân viên." };
    }
    try {
      const response = await fetch(`${API_BASE}/profiles?limit=1`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": rawToken,
          Authorization: `Bearer ${rawToken}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 200 && data?.success) {
        return { valid: true };
      }
      if (response.status === 401) {
        return { valid: false, message: data?.message || "Token nhân viên không hợp lệ hoặc đã bị khóa." };
      }
      return { valid: false, message: data?.message || `Lỗi kiểm tra token (HTTP ${response.status}).` };
    } catch (err) {
      return { valid: false, message: `Không thể kết nối máy chủ kiểm tra token: ${err.message || err}` };
    }
  }

  async function postJson(path, body) {
    const token = await getUserApiToken();
    if (!token) {
      throw new Error("Bạn chưa nhập Token nhân viên. Vui lòng vào Cài đặt nhập Token trước khi sử dụng tool.");
    }
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Key": token,
      "Authorization": `Bearer ${token}`,
    };

    const response = await fetch(`${API_BASE}/sync/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      if (response.status === 401) {
        throw new Error(result?.message || "Token nhân viên không hợp lệ hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại token.");
      }
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

  globalThis.FacebookSyncApi = { getUserApiToken, verifyUserToken, postJson, syncProfile, syncPages };
})();
