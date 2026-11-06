(() => {
  function metricValue(token) {
    const match = String(token || "").trim().match(/^(\d+(?:[.,]\d+)?)([KkMm])?$/);
    if (!match) return null;
    let amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    const suffix = (match[2] || "").toLowerCase();
    if (suffix === "k") amount *= 1000;
    if (suffix === "m") amount *= 1000000;
    return Math.round(amount);
  }

  function cleanPercent(value) {
    return value ? String(value).replace(/M%$/, "%") : null;
  }

  function dedupeCaption(value) {
    const text = String(value || "").replace(/^Boost content See all content\s*/i, "").replace(/\s+/g, " ").trim();
    const middle = Math.floor(text.length / 2);
    for (let offset = -24; offset <= 24; offset += 1) {
      const cut = middle + offset;
      if (cut < 8 || cut > text.length - 8) continue;
      const left = text.slice(0, cut).trim();
      const right = text.slice(cut).trim();
      if (left === right) return left;
    }
    return text;
  }

  function integer(value) {
    const amount = Number(String(value || "").replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : null;
  }

  function readFormats(flat, reels, stories) {
    const section = (String(flat).split(/Top content formats/i)[1] || "").slice(0, 900);
    const published = section.match(/Published content[\s\S]{0,180}?Reels\s+(\d+)\s+Stories\s+(\d+)/i);
    const views = section.match(/\bViews\b[\s\S]{0,160}?Reels\s+([\d,]+)\s+Photo\s+([\d,]+)\s+Others\s+([\d,]+)/i);
    const interactions = section.match(/Content interactions[\s\S]{0,160}?Reels\s+([\d,]+)\s+Photo\s+([\d,]+)/i);
    return {
      reels: published ? Number(published[1]) : (reels ? Number(reels[1]) : null),
      stories: published ? Number(published[2]) : (stories ? Number(stories[1]) : null),
      views: views ? { reels: integer(views[1]), photo: integer(views[2]), others: integer(views[3]) } : null,
      interactions: interactions ? { reels: integer(interactions[1]), photo: integer(interactions[2]) } : null,
    };
  }

  function readContentSummary(doc = document, pageUrl = "") {
    const raw = String(doc.body?.innerText || doc.body?.textContent || "");
    const flat = raw.replace(/[\u200B-\u200D\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
    const asset = String(pageUrl || doc.location?.href || "").match(/asset_id=(\d+)/);
    const rangeMatch = flat.match(/Last\s+(\d+)\s+days:\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+[–-]\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i);
    const viewsLabel = flat.match(/\bViews\s+([\d.,]+[KkMm]?)\s+([\d.,]+M?%)/i);
    const breakdown = flat.match(/Views breakdown\s+.{0,80}?Total\s+([\d,]{4,})\s+[\d.,]+M?%\s+From organic\s+([\d,]+)\s+[\d.,]+M?%\s+From ads\s+([\d,]+)/i);
    const viewers = flat.match(/\bViewers\s+([\d,]{3,})\s+([\d.,]+M?%)/i);
    const threeSecond = flat.match(/3-second views\s+([\d.,]+[KkMm]?)\s+([\d.,]+M?%)/i);
    const interactions = flat.match(/Content interactions\s+([\d.,]+[KkMm]?)\s+([\d.,]+M?%)/i);
    const watch = flat.match(/Watch time\s+(\d+d\s+\d+h)\s+([\d.,]+M?%)/i);
    const reels = flat.match(/\bReels\s+(\d+)\b/i);
    const stories = flat.match(/\bStories\s+(\d+)\b/i);

    const section = (flat.split(/Top content by views/i)[1] || "").split(/Top content formats/i)[0];
    const datePattern = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{1,2}:\d{2}\s*(?:am|pm)/g;
    const dates = [...section.matchAll(datePattern)];
    const contents = dates.map((date, index) => {
      const previous = index === 0 ? 0 : dates[index - 1].index + dates[index - 1][0].length;
      const next = index + 1 < dates.length ? dates[index + 1].index : section.length;
      const after = section.slice(date.index + date[0].length, next).trim();
      const metricMatch = after.match(/^((?:[\d.,]+[KkMm]?\s+){3}[\d.,]+[KkMm]?)/);
      const metrics = metricMatch ? metricMatch[1].trim().split(/\s+/) : [];
      let caption = section.slice(previous, date.index);
      if (index > 0) caption = caption.replace(/^((?:[\d.,]+[KkMm]?\s+){3}[\d.,]+[KkMm]?)/, "");
      caption = dedupeCaption(caption);
      return {
        published_at: date[0],
        title: caption,
        links: [...caption.matchAll(/https?:\/\/[^\s#]+/g)].map(item => item[0]),
        views: metricValue(metrics[0]),
        reactions: metricValue(metrics[1]),
        comments: metricValue(metrics[2]),
        shares: metricValue(metrics[3]),
      };
    }).filter(item => item.title || item.views !== null);

    const anchors = typeof doc.querySelectorAll === "function" ? [...doc.querySelectorAll("a[href]")] : [];
    const contentAnchors = anchors.filter(anchor => /content_id=\d+/.test(
      String(anchor.getAttribute?.("href") || anchor.href || "").replace(/&amp;/g, "&"),
    ));
    const pageId = asset ? asset[1] : null;
    contents.forEach((item, index) => {
      const anchor = contentAnchors[index];
      if (!anchor) return;
      const href = String(anchor.getAttribute?.("href") || anchor.href || "").replace(/&amp;/g, "&");
      const absolute = href.startsWith("http") ? href : `https://business.facebook.com${href.startsWith("/") ? "" : "/"}${href}`;
      item.content_id = (absolute.match(/content_id=(\d+)/) || [])[1] || null;
      // The card itself only links to Business Suite insights. The public post URL redirects to the video.
      item.content_url = pageId && item.content_id
        ? `https://www.facebook.com/${pageId}/posts/${item.content_id}`
        : absolute;
      const image = typeof anchor.querySelector === "function" ? anchor.querySelector("img") : null;
      const thumbnail = String(image?.getAttribute?.("src") || image?.src || "").replace(/&amp;/g, "&");
      if (/^https?:\/\//.test(thumbnail)) item.thumbnail = thumbnail;
    });

    const overviewViews = breakdown ? Number(breakdown[1].replace(/,/g, "")) : (viewsLabel ? metricValue(viewsLabel[1]) : null);
    return {
      source: "content_summary",
      asset_id: asset ? asset[1] : null,
      url: String(pageUrl || doc.location?.href || ""),
      range: rangeMatch ? { days: Number(rangeMatch[1]), from: rangeMatch[2], to: rangeMatch[3] } : null,
      overview: {
        views_label: viewsLabel ? viewsLabel[1] : null,
        views: Number.isFinite(overviewViews) ? overviewViews : null,
        views_change: viewsLabel ? cleanPercent(viewsLabel[2]) : null,
        views_organic: breakdown ? Number(breakdown[2].replace(/,/g, "")) : null,
        views_ads: breakdown ? Number(breakdown[3].replace(/,/g, "")) : null,
        viewers: viewers ? Number(viewers[1].replace(/,/g, "")) : null,
        viewers_change: viewers ? cleanPercent(viewers[2]) : null,
        three_second_views_label: threeSecond ? threeSecond[1] : null,
        three_second_views: threeSecond ? metricValue(threeSecond[1]) : null,
        interactions_label: interactions ? interactions[1] : null,
        interactions: interactions ? metricValue(interactions[1]) : null,
        watch_time: watch ? watch[1] : null,
        watch_time_change: watch ? cleanPercent(watch[2]) : null,
      },
      formats: readFormats(flat, reels, stories),
      contents,
      captured_at: new Date().toISOString(),
    };
  }

  globalThis.FacebookContentSummary = { metricValue, readContentSummary };
})();
