(() => {
  const isFacebookId = value => /^[1-9]\d{0,31}$/.test(String(value || ""));

  function readQueryId(anchor, key) {
    try {
      return new URL(anchor.getAttribute("href"), "https://www.facebook.com").searchParams.get(key) || "";
    } catch (_) {
      return "";
    }
  }

  function isPageNameLink(anchor) {
    const text = String(anchor.innerText || anchor.textContent || "").trim();
    if (!text) return false;
    try {
      const path = new URL(anchor.getAttribute("href"), "https://www.facebook.com").pathname;
      return !/^\/(?:latest|ad_center|pages|photo|photos|stories|notifications|business)/i.test(path);
    } catch (_) {
      return false;
    }
  }

  function readPageAvatar(card, pageId) {
    for (let scope = card, depth = 0; scope && depth < 12; scope = scope.parentElement, depth++) {
      const links = [...scope.querySelectorAll('a[href*="profile.php?id="]')];
      const ids = new Set(links.map(link => readQueryId(link, "id")).filter(isFacebookId));
      if ([...ids].some(id => id !== pageId)) break;
      const avatarLink = links.find(link => readQueryId(link, "id") === pageId &&
        link.querySelector?.("svg image, img[src]"));
      const image = avatarLink?.querySelector?.("svg image, img[src]");
      if (!image) continue;
      const source = image.getAttribute("xlink:href") || image.getAttribute("href") ||
        image.currentSrc || image.getAttribute("src") || "";
      if (/^https?:\/\//i.test(source)) return source;
    }
    return "";
  }

  function parsePageAssetMap(html, Parser = DOMParser) {
    if (typeof html !== "string" || !html || typeof Parser !== "function") return [];
    const doc = new Parser().parseFromString(html, "text/html");
    const anchors = [...doc.querySelectorAll('a[href*="asset_id="],a[href*="page_id="]')];
    const mapped = new Map();

    for (const assetAnchor of anchors) {
      const assetId = readQueryId(assetAnchor, "asset_id") || readQueryId(assetAnchor, "page_id");
      if (!isFacebookId(assetId)) continue;

      let card = assetAnchor.parentElement;
      // Facebook wraps each Page card in many layout divs (13 levels in the
      // current managed-Page UI). Stop when a single Page ID is found.
      for (let depth = 0; card && depth < 24; depth++, card = card.parentElement) {
        const pageLinks = [...card.querySelectorAll('a[href*="profile.php?id="]')];
        const pageLinksById = new Map();
        for (const pageLink of pageLinks) {
          const pageId = readQueryId(pageLink, "id");
          if (!isFacebookId(pageId)) continue;
          const current = pageLinksById.get(pageId);
          const currentHasText = String(current?.innerText || current?.textContent || "").trim();
          const candidateHasText = String(pageLink.innerText || pageLink.textContent || "").trim();
          if (!current || (!currentHasText && candidateHasText)) pageLinksById.set(pageId, pageLink);
        }
        // Prefer the numeric Facebook Page ID. Some Pages use a vanity URL and
        // expose their numeric ID only in the card's page_id query parameter.
        let pageId = pageLinksById.size === 1 ? [...pageLinksById.keys()][0] : "";
        if (!pageId && pageLinksById.size === 0) {
          const pageIds = new Set([...card.querySelectorAll('a[href*="page_id="]')]
            .map(link => readQueryId(link, "page_id"))
            .filter(isFacebookId));
          if (pageIds.size === 1) pageId = [...pageIds][0];
        }
        // Ignore ancestors that combine multiple Page cards; keep walking until
        // the request's asset link can be associated with a single Page.
        if (!pageId) continue;

        const pageLink = pageLinksById.get(pageId);
        const nameLink = (pageLink && isPageNameLink(pageLink) ? pageLink : null) ||
          [...card.querySelectorAll("a[href]")].find(isPageNameLink);
        const name = String(nameLink?.innerText || nameLink?.textContent || "").trim();
        if (name) {
          const avatar = readPageAvatar(card, pageId);
          const previous = mapped.get(pageId) || {};
          mapped.set(pageId, {
            ...previous,
            pageId,
            ...(assetId !== pageId ? { assetId } : previous.assetId ? { assetId: previous.assetId } : {}),
            name,
            ...(avatar ? { avatar } : previous.avatar ? { avatar: previous.avatar } : {}),
          });
        }
        break;
      }
    }

    return [...mapped.values()];
  }

  function inspectPageReferences(html, Parser = DOMParser) {
    if (typeof html !== "string" || !html || typeof Parser !== "function") {
      return { pageIdLinks: 0, pageIdQueryLinks: 0, assetIdLinks: 0 };
    }
    const doc = new Parser().parseFromString(html, "text/html");
    return {
      pageIdLinks: doc.querySelectorAll('a[href*="profile.php?id="]').length,
      pageIdQueryLinks: doc.querySelectorAll('a[href*="page_id="]').length,
      assetIdLinks: doc.querySelectorAll('a[href*="asset_id="]').length,
    };
  }

  globalThis.FacebookPageAssets = { parsePageAssetMap, inspectPageReferences };
})();
