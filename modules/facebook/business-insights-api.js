(() => {
  const ENDPOINT = "https://business.facebook.com/api/graphql/";
  const DOC_ID = "10032545723449890";
  const FRIENDLY_NAME = "useBizWebInsightsPrivateSingleLineChartWithoutBreakdownQuery";

  const POSTS_DOC_ID = "27989945277348632";
  const POSTS_FRIENDLY_NAME = "useBizWebUnifiedTableInitialLoad_data_refetchable";

  function parseResponse(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];

    // 1. Thử parse dạng chuẩn mỗi dòng một JSON (newline-delimited JSON)
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedLines = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line.replace(/^for \(;;\);/, "")));
      } catch (_) {}
    }
    if (parsedLines.length > 0 && parsedLines.length === lines.length) {
      return parsedLines;
    }

    // 2. Fallback: Parse chuỗi stream / multipart gồm nhiều JSON object nối tiếp hoặc cách nhau bởi khoảng trắng
    const chunks = [];
    let remaining = text.replace(/^for \(;;\);/, "").trimStart();
    while (remaining.length > 0) {
      try {
        chunks.push(JSON.parse(remaining));
        break;
      } catch (_) {
        let depth = 0;
        let inString = false;
        let escape = false;
        let endIdx = -1;
        for (let i = 0; i < remaining.length; i++) {
          const c = remaining[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (c === "\\") {
            escape = true;
            continue;
          }
          if (c === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (c === "{" || c === "[") depth++;
            else if (c === "}" || c === "]") {
              depth--;
              if (depth === 0) {
                endIdx = i + 1;
                break;
              }
            }
          }
        }
        if (endIdx !== -1) {
          try {
            chunks.push(JSON.parse(remaining.slice(0, endIdx)));
          } catch (_) {}
          remaining = remaining.slice(endIdx).trimStart();
        } else {
          break;
        }
      }
    }
    return chunks;
  }

  function extractContentsFromResponses(responses, pageUid) {
    const list = [];
    const seenIds = new Set();

    for (const res of (Array.isArray(responses) ? responses : [responses])) {
      const edges = res?.data?.tofu_unified_table?.content?.edges;
      if (!Array.isArray(edges)) continue;

      for (const edge of edges) {
        const node = edge?.node || {};
        const header = node.header || {};
        const entityInfo = header.entity?.entity_info || {};
        const fields = node.fields || {};

        const videoId = entityInfo.video?.id || entityInfo.entity_id || node.row_id;
        const idStr = String(videoId || "");
        if (idStr && seenIds.has(idStr)) continue;
        if (idStr) seenIds.add(idStr);

        const title = entityInfo.title || "";
        const createdAtSec = entityInfo.created_at || (fields.date?.renderer?.date_time);
        const publishedAtStr = createdAtSec ? new Date(createdAtSec * 1000).toISOString() : "";
        const thumbnail = entityInfo.image_source?.uri || null;

        // Views
        let views = fields.views?.renderer?.result?.value;
        if (views === undefined || views === null) {
          views = fields.views?.renderer?.value_for_sort;
        }
        const numViews = Number.isFinite(views) && views >= 0 ? views : 0;

        // Reactions / Comments / Shares
        const reactions = fields.net_reactions?.renderer?.result?.value ?? 0;
        const comments = fields.net_comments?.renderer?.result?.value ?? 0;
        const shares = fields.shares?.renderer?.result?.value ?? 0;

        // Trích xuất links sản phẩm từ tiêu đề
        const links = (title.match(/https?:\/\/[^\s<>"#]+/g) || []).map(l => l.trim());

        const ownerId = entityInfo.owner?.entity_id || pageUid;
        const contentUrl = ownerId && idStr
          ? `https://facebook.com/${ownerId}/videos/${idStr}`
          : (idStr ? `https://facebook.com/${idStr}` : null);

        list.push({
          title,
          published_at: publishedAtStr,
          content_id: idStr,
          content_url: contentUrl,
          thumbnail,
          links,
          views: numViews,
          reactions,
          comments,
          shares,
        });
      }
    }

    return list;
  }

  function sumViews(responses) {
    let total = null;
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(visit);
      if (value.__typename === "TofuErrorQueryResult") return;
      if (value.__typename === "TofuTimeSeriesWithoutBreakdownMetricsQueryResult" && Array.isArray(value.points)) {
        const values = value.points.map(point => point?.value).filter(v => Number.isSafeInteger(v) && v >= 0);
        if (values.length) total = values.reduce((sum, v) => sum + v, 0);
      }
      for (const child of Object.values(value)) visit(child);
    };
    responses.forEach(visit);
    return total;
  }

  function parseWeeklyVideosAndViews(responses) {
    let totalViews = 0;
    let videoCount = 0;
    let hasVideoData = false;
    const seenPostIds = new Set();

    // Duyệt sâu để tìm các bài đăng / video và trích xuất view
    const visit = (item) => {
      if (!item || typeof item !== "object") return;

      // 1. Cấu trúc chuẩn BizWebUnifiedTableRow (như trong query Content Management Posts)
      if (item.node && item.node.fields) {
        const node = item.node;
        const fields = node.fields || {};
        const header = node.header || {};
        const rowId = node.row_id || node.id;

        if (!rowId || !seenPostIds.has(String(rowId))) {
          const videoCell = fields.video_status || {};
          const isVideoStatus = Boolean(videoCell.renderer);
          const entityInfo = header.entity?.entity_info || {};
          const isVideo = isVideoStatus || Boolean(entityInfo.video) ||
            String(entityInfo.__typename || "").includes("Video") ||
            String(entityInfo.business_content_type || "").includes("VIDEO");

          // Trích xuất views từ fields.views.renderer.result.value hoặc value_for_sort
          const viewsCell = fields.views || {};
          const renderer = viewsCell.renderer || {};
          let viewsVal = renderer.result?.value;
          if (viewsVal === undefined || viewsVal === null) {
            viewsVal = renderer.value_for_sort;
          }
          const numViews = Number.isFinite(viewsVal) && viewsVal >= 0 ? viewsVal : 0;

          if (isVideo || numViews > 0) {
            if (rowId) seenPostIds.add(String(rowId));
            hasVideoData = true;
            videoCount += 1;
            totalViews += numViews;
            return;
          }
        }
      }

      // 2. Fallback cho các cấu trúc khác
      const obj = item.node && typeof item.node === "object" ? item.node : item;
      const isVideo = Boolean(
        obj.video_status ||
        obj.VIDEO_STATUS ||
        obj.is_video === true ||
        String(obj.content_type || "").toUpperCase().includes("VIDEO") ||
        String(obj.post_type || "").toUpperCase().includes("VIDEO") ||
        String(obj.__typename || "").toUpperCase().includes("VIDEO")
      );

      // Trích xuất views
      let views = null;
      const metrics = obj.metrics || obj.cells || obj;
      const viewCandidates = [
        metrics.VIEWS,
        metrics.views,
        metrics.view_count,
        metrics.VIDEO_VIEWS,
        metrics.video_views,
        metrics.VIDEO_THREE_SECOND_VIEWS,
        metrics.three_second_views,
        obj.views,
        obj.view_count,
      ];

      for (const cand of viewCandidates) {
        const val = typeof cand === "object" && cand !== null ? (cand.value ?? cand.count) : cand;
        const num = typeof val === "string" ? parseInt(val.replace(/[^\d]/g, ""), 10) : val;
        if (Number.isSafeInteger(num) && num >= 0) {
          views = num;
          break;
        }
      }

      const idKey = obj.id || obj.post_id || obj.video_id;
      if (isVideo || (views !== null && views > 0)) {
        if (idKey && seenPostIds.has(String(idKey))) return;
        if (idKey) seenPostIds.add(String(idKey));

        hasVideoData = true;
        videoCount += 1;
        if (views !== null) {
          totalViews += views;
        }
        return;
      }

      if (Array.isArray(item)) {
        item.forEach(visit);
      } else {
        for (const child of Object.values(item)) {
          visit(child);
        }
      }
    };

    responses.forEach(res => visit(res));

    return {
      video_count_7d: hasVideoData ? videoCount : 0,
      views_7d: hasVideoData ? totalViews : 0,
      hasData: hasVideoData,
    };
  }

  async function fetchWeeklyVideosAndViews(pageId, requestContext, fetchImpl = fetch) {
    const id = String(pageId || "");
    if (!/^[1-9]\d{0,31}$/.test(id)) throw new Error("Thiếu Page ID / Asset ID hợp lệ.");
    if (!requestContext?.fb_dtsg || !requestContext?.lsd) throw new Error("Chưa lấy được token Facebook.");

    const variables = {
      callerID: "BIZWEB_PUBLISHED_POSTS",
      count: 50,
      filters: [{ param: "UNIFIED_TABLE_FEATURE", values: [] }],
      ids: [id],
      initialFilters: [{ param: "UNIFIED_TABLE_FEATURE", values: ["LOAD_ONLY_VISIBLE_COLUMNS_IN_VIEWPORT"] }],
      scale: 1,
      searchString: "",
      selectionStyle: null,
      skipAllIDs: false,
      sortDirection: "DESC",
      sortKey: "DATE",
      timeRange: { type: "LAST_28D" },
      visibleColumnKeys: [
        "TITLE", "DATE", "VIDEO_STATUS", "REACH", "VIEWS", "VIEWERS",
        "NEW_FOLLOWS", "NET_INTERACTIONS", "NET_REACTIONS", "NET_COMMENTS",
        "SHARES", "NET_SAVES", "LINK_CLICKS", "VIDEO_PLAY_TIME",
        "VIDEO_AVERAGE_PLAY_TIME", "VIDEO_THREE_SECOND_VIEWS", "INSTREAM_ADS_ESTIMATED_EARNINGS"
      ],
      __relay_internal__pv__shouldFetchAssociatedAdsInforelayprovider: true,
      __relay_internal__pv__shouldFetchAMPostPreviewrelayprovider: false,
      __relay_internal__pv__shouldFetchEPAPostVariantImagerelayprovider: false
    };

    const body = new URLSearchParams({
      av: id,
      __a: "1",
      fb_dtsg: requestContext.fb_dtsg,
      lsd: requestContext.lsd,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: POSTS_FRIENDLY_NAME,
      server_timestamps: "true",
      variables: JSON.stringify(variables),
      doc_id: POSTS_DOC_ID,
    });

    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
      },
      body: body.toString(),
    });

    if (!response.ok) throw new Error(`Business Suite posts API trả HTTP ${response.status}.`);
    const parsed = parseResponse(await response.text());
    const stats = parseWeeklyVideosAndViews(parsed);
    const contents = extractContentsFromResponses(parsed, id);
    return {
      ...stats,
      contents,
    };
  }

  async function fetchPageViews7d(assetId, requestContext, fetchImpl = fetch) {
    const id = String(assetId || "");
    if (!/^[1-9]\d{0,31}$/.test(id)) throw new Error("Thiếu Business Suite asset ID của Page.");
    if (!requestContext?.fb_dtsg || !requestContext?.lsd) throw new Error("Chưa lấy được token request Facebook từ profile.");

    const body = new URLSearchParams({
      __a: "1",
      fb_dtsg: requestContext.fb_dtsg,
      lsd: requestContext.lsd,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: FRIENDLY_NAME,
      variables: JSON.stringify({
        arg: { compare_time_range: null, event: "VIEW", id, time_granularity: "DAILY", time_range: { type: "LAST_7D" }, tofu_metric: "COUNT" },
        callerID: "BIZWEB_PROFILE_PLUS_INSIGHTS",
      }),
      doc_id: DOC_ID,
    });
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`Insights Facebook trả HTTP ${response.status}.`);
    const pointsTotal = sumViews(parseResponse(await response.text()));
    if (pointsTotal === null) throw new Error("Request Insights chưa trả timeseries view 7 ngày cho Page.");
    return { views_7d: pointsTotal };
  }

  globalThis.FacebookBusinessInsightsApi = {
    parseResponse,
    sumViews,
    fetchPageViews7d,
    parseWeeklyVideosAndViews,
    fetchWeeklyVideosAndViews,
    extractContentsFromResponses,
  };
})();
