(() => {
  const FOLLOW_KEYS = new Set(["follow_count", "follower_count", "followers_count", "page_fans", "fan_count", "page_followers_count", "total_followers"]);
  const VIEW_KEYS = new Set(["views_7d", "page_views_7d", "views_count_7d", "total_views", "view_count", "views_count", "page_views", "content_views", "views"]);

  function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
    if (typeof value !== "string") return null;
    const text = value.trim().replace(/\s/g, "");
    const match = text.match(/^(\d[\d.,]*)(тыс\.?|mil|k|m)?$/i);
    if (!match) return null;
    let amount = Number(match[1].replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    const suffix = (match[2] || "").toLowerCase();
    if (["mil", "k", "тыс", "тыс."].includes(suffix)) amount *= 1000;
    else if (suffix === "m") amount *= 1_000_000;
    return Math.floor(amount);
  }

  function extractMetrics(responses, { last7Days = false } = {}) {
    const found = { follow_count: [], views_7d: [] };
    const visit = (value, parentKey = "") => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(item => visit(item, parentKey));
      const typename = String(value.__typename || "");
      if (/TofuErrorQueryResult/i.test(typename)) return;
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase();
        const number = numberValue(child);
        if (number !== null && FOLLOW_KEYS.has(normalized)) found.follow_count.push(number);
        if (number !== null && VIEW_KEYS.has(normalized) && (last7Days || /_7d$/.test(normalized))) found.views_7d.push(number);
        visit(child, normalized);
      }
    };
    for (const response of Array.isArray(responses) ? responses : [responses]) visit(response);
    const metrics = {};
    if (found.follow_count.length) metrics.follow_count = Math.max(...found.follow_count);
    if (found.views_7d.length) metrics.views_7d = Math.max(...found.views_7d);
    return metrics;
  }

  function readVisibleMetrics(doc = document, currentLocation = location) {
    if (!/\/latest\/insights\//i.test(currentLocation.pathname)) return {};
    const text = String(doc.body?.innerText || doc.body?.textContent || "").replace(/[\s\u200B-\u200D\uFEFF]+/g, " ");
    const metrics = {};
    const follower = text.match(/(?:followers|seguidores|abonnenten|follower)[^\d]{0,500}?total\s*[:：]?\s*([\d.,]+(?:\s*(?:mil|k|m))?)/i);
    if (follower) metrics.follow_count = numberValue(follower[1]);

    const dateLabel = [...doc.querySelectorAll("button,[role=button]")].map(node => `${node.innerText || node.textContent || ""} ${node.getAttribute("aria-label") || ""}`).join(" ");
    const is7d = /last\s+7\s+days|últimos\s+7\s+dias|ultimos\s+7\s+dias|últimos\s+7\s+day/i.test(dateLabel) ||
      /time_range=.*LAST_7D/i.test(currentLocation.search);
    if (is7d && /content_summary/i.test(currentLocation.pathname)) {
      for (const node of doc.querySelectorAll("button,[role=button]")) {
        const label = `${node.innerText || node.textContent || ""} ${node.getAttribute("aria-label") || ""}`;
        if (!/(views|visualizações|visualizacoes|visualizaciones)/i.test(label)) continue;
        if (/(3\s*(?:second|segundo)|video)/i.test(label)) continue;
        const number = label.match(/(?:views|visualizações|visualizacoes|visualizaciones)\D{0,30}(\d[\d.,]*(?:\s*(?:mil|k|m))?)/i);
        if (number) {
          metrics.views_7d = numberValue(number[1]);
          break;
        }
      }
      if (!Number.isSafeInteger(metrics.views_7d)) {
        const visibleViews = text.match(/(?:views|visualizações|visualizacoes)\s*([\d.,]+(?:\s*(?:mil|k|m))?)/i);
        if (visibleViews) metrics.views_7d = numberValue(visibleViews[1]);
      }
    }
    for (const key of Object.keys(metrics)) if (metrics[key] === null) delete metrics[key];
    return metrics;
  }

  function readSelectedPageName(doc = document, knownPages = []) {
    const controls = [...doc.querySelectorAll('[role="combobox"],button[aria-haspopup="listbox"]')];
    const texts = controls.map(node => `${node.innerText || node.textContent || ""} ${node.getAttribute("aria-label") || ""}`);
    for (const page of knownPages) {
      if (texts.some(text => text.includes(page.name))) return page.name;
    }
    return knownPages.length === 1 ? knownPages[0].name : "";
  }

  globalThis.FacebookInsightsMetrics = { numberValue, extractMetrics, readVisibleMetrics, readSelectedPageName };
})();
