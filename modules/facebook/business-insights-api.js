(() => {
  const ENDPOINT = "https://business.facebook.com/api/graphql/";
  const DOC_ID = "10032545723449890";
  const FRIENDLY_NAME = "useBizWebInsightsPrivateSingleLineChartWithoutBreakdownQuery";

  function parseResponse(raw) {
    return String(raw || "").split(/\r?\n/).map(line => {
      try { return JSON.parse(line.replace(/^for \(;;\);/, "")); } catch (_) { return null; }
    }).filter(Boolean);
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

  globalThis.FacebookBusinessInsightsApi = { parseResponse, sumViews, fetchPageViews7d };
})();
