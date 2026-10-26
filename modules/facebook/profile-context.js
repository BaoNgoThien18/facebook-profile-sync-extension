(() => {
  function readProfileId(doc = document, currentLocation = location) {
    const params = new URLSearchParams(currentLocation.search);
    if (currentLocation.pathname.toLowerCase() === "/profile.php" && /^[1-9]\d{0,31}$/.test(params.get("id") || "")) {
      return params.get("id");
    }

    const metaId = doc.querySelector('meta[property="fb:profile_id"]')?.content || "";
    if (/^[1-9]\d{0,31}$/.test(metaId)) return metaId;

    for (const anchor of doc.querySelectorAll("a[href]")) {
      try {
        const url = new URL(anchor.href, currentLocation.origin);
        if (url.pathname.toLowerCase() === "/profile.php" && /^[1-9]\d{0,31}$/.test(url.searchParams.get("id") || "")) {
          return url.searchParams.get("id");
        }
      } catch (_) {}
    }
    return "";
  }

  function isPersonalProfilePage(doc = document, currentLocation = location) {
    if (!/(^|\.)facebook\.com$/i.test(currentLocation.hostname)) return false;
    const path = currentLocation.pathname.toLowerCase();
    const params = new URLSearchParams(currentLocation.search);
    if (path === "/" || path.startsWith("/pages/") || path.startsWith("/professional_dashboard")) return false;
    if (params.has("asset_id") || params.has("page_id") || doc.querySelector('meta[property="fb:pages"]')) return false;
    if (!readProfileId(doc, currentLocation)) return false;
    if (path === "/profile.php") return true;
    return !!doc.querySelector('a[href*="/friends_all/"], a[href*="directory_personal_details"]');
  }

  function readProfileDetails(doc = document, currentLocation = location) {
    const friendsLink = doc.querySelector('a[href*="/friends_all/"]');
    const profileHeader = friendsLink?.parentElement?.parentElement?.parentElement;
    const headerName = profileHeader?.querySelector("button, [role=\"button\"]")?.textContent?.trim() || "";
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content?.trim() || "";
    const documentTitle = String(doc.title || "").replace(/\s*[|–-]\s*Facebook\s*$/i, "").trim();
    const name = doc.querySelector("h1")?.textContent?.trim() || headerName ||
      (ogTitle && !/^facebook$/i.test(ogTitle) ? ogTitle : "") ||
      (documentTitle && !/^facebook$/i.test(documentTitle) ? documentTitle : "");
    const avatar = doc.querySelector('meta[property="og:image"]')?.content ||
      doc.querySelector('img[alt*="profile" i], img[alt*="perfil" i]')?.src || "";
    return {
      profileId: readProfileId(doc, currentLocation),
      name,
      avatar,
      profileUrl: currentLocation.href,
    };
  }

  globalThis.FacebookProfileContext = { readProfileId, isPersonalProfilePage, readProfileDetails };
})();
