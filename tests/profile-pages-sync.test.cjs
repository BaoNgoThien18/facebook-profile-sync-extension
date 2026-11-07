const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  AbortSignal, URL, URLSearchParams, FormData, Map, Object, Array, String, Error, RegExp, JSON,
  Promise, Number, globalThis: null,
});
context.globalThis = context;
for (const file of [
  'modules/facebook/profile-context.js',
  'modules/ui/status-toast.js',
  'modules/facebook/insights-metrics.js',
  'modules/facebook/page-assets.js',
  'modules/facebook/business-insights-api.js',
  'modules/facebook/facebook-api.js',
  'modules/server/sync-api.js',
  'modules/sync/sync-service.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const { FacebookProfileContext, FacebookInsightsMetrics, FacebookPageAssets, FacebookBusinessInsightsApi, FacebookAPI, ProfilePageSync } = context;
const profileContextSource = fs.readFileSync(path.join(root, 'modules/facebook/profile-context.js'), 'utf8');

test('background accepts dashboard requests and forwards Facebook data to the sync service', async () => {
  let listener;
  const writes = [];
  const chrome = {
    runtime: { id: 'extension-id', onMessage: { addListener: callback => { listener = callback; } } },
    action: { onClicked: { addListener() {} } },
    cookies: { getAll: async () => [] },
    storage: { local: { set: async () => {} } },
  };
  const worker = vm.createContext({
    chrome, URL, Date, Promise, Error,
    importScripts() {},
    ProfilePageSync: { syncPageList: async (profile, pages) => {
      writes.push({ profile, pages });
      return { success: true, profileId: profile.profileId, pageCount: pages.length };
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), worker);
  const send = (message, sender) => new Promise(resolve => {
    assert.equal(listener(message, sender, resolve), true);
  });
  const result = await send({ action: 'SYNC_PROFILE_AND_PAGES', profile: { profileId: '100' }, pages: [] },
    { id: 'extension-id', tab: { url: 'https://www.facebook.com/pages/' } });
  assert.equal(result.success, true);
  assert.equal(writes.length, 1);
  const dashboardResult = await send({ action: 'MANUAL_SYNC' },
    { id: 'extension-id', tab: { url: 'chrome-extension://extension-id/dashboard.html' } });
  assert.equal(dashboardResult.success, false);
});

test('manual sync still fetches views and videos when the employee token is missing', async () => {
  let listener;
  const writes = [];
  const serverCalls = [];
  const chrome = {
    runtime: { id: 'extension-id', onMessage: { addListener: callback => { listener = callback; } } },
    action: { onClicked: { addListener() {} } },
    cookies: { getAll: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }] },
    storage: { local: {
      get: async () => ({}),
      set: async value => { writes.push(value); },
    } },
  };
  const worker = vm.createContext({
    chrome, URL, Date, Promise, Error, console,
    importScripts() {},
    FacebookAPI: {
      getAccountAndDtsg: async () => ({ name: 'Profile A', cUserId: '100', dtsg: 'dtsg', lsd: 'lsd', avatar: '' }),
      getUserPages: async () => [{ id: '200', name: 'Page A' }],
    },
    FacebookBusinessInsightsApi: {
      fetchWeeklyVideosAndViews: async pageId => {
        assert.equal(pageId, '200');
        return { hasData: true, views_7d: 15, video_count_7d: 2 };
      },
    },
    ProfilePageSync: {
      syncPageList: async (profile, pages, options) => {
        serverCalls.push({ profile, pages, options });
        return { success: true, profileId: profile.profileId, pageCount: pages.length };
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), worker);
  const result = await new Promise(resolve => {
    assert.equal(listener({ action: 'MANUAL_SYNC' }, { id: 'extension-id' }, resolve), true);
  });
  assert.equal(result.success, true);
  assert.equal(result.localOnly, true);
  assert.equal(serverCalls.length, 1);
  assert.equal(serverCalls[0].options.enableServerSync, false);
  assert.equal(serverCalls[0].pages[0].views_7d, 15);
  assert.equal(serverCalls[0].pages[0].video_count_7d, 2);
  const pageWrite = writes.find(value => value.profile_page_sync_pages);
  assert.equal(pageWrite.profile_page_sync_pages['100'][0].views_7d, 15);
  assert.equal(pageWrite.profile_page_sync_pages['100'][0].video_count_7d, 2);
});

test('content sync reads the rendered managed Page list and reuses the same profile cache', async () => {
  let listener;
  let uploaded;
  const savedProfile = { id: '100', name: 'Profile A', avatar: '' };
  const chrome = {
    runtime: {
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: (message, callback) => { uploaded = message; callback({ success: true, pageCount: 1 }); },
      lastError: null,
    },
    storage: { local: {
      get: async key => key === 'profile_page_sync_profile'
        ? { profile_page_sync_profile: savedProfile } : {},
      set: async () => {},
    } },
  };
  const browser = vm.createContext({
    window: {}, chrome, URL, URLSearchParams, Date, Promise, Error, Number, String,
    location: { origin: 'https://www.facebook.com', pathname: '/pages/', search: '?category=your_pages' },
    document: { documentElement: { outerHTML: 'rendered Page New 2' } },
    FacebookProfileContext: { isPersonalProfilePage: () => false, readProfileDetails: () => ({ name: '' }) },
    FacebookPageAssets: { parsePageAssetMap: html => html === 'rendered Page New 2'
      ? [{ pageId: '200', name: 'New 2' }] : [] },
    ProfileSyncStatus: { showStatus() {} },
    DOMParser: class { parseFromString() { return {}; } },
    fetch: async () => ({ ok: true, text: async () => '<html>empty shell</html>' }),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), browser);
  const result = await new Promise(resolve => listener({ action: 'RUN_MANUAL_SYNC', profileId: '100' }, {}, resolve));
  assert.equal(result.success, true);
  assert.equal(uploaded.profile.name, 'Profile A');
  assert.equal(uploaded.pages[0].id, '200');
});

function detectProfile({ hostname = 'www.facebook.com', pathname = '/', search = '', selectors = {}, links = [] } = {}) {
  const browser = vm.createContext({
    module: { exports: {} }, URL, URLSearchParams, Date, Math, String, Number, Set, Map, Error,
    location: { hostname, pathname, search, href: `https://${hostname}${pathname}${search}`, origin: `https://${hostname}` },
    document: {
      body: {}, documentElement: {}, title: 'Profile | Facebook',
      querySelector: selector => selectors[selector] || null,
      querySelectorAll: selector => selector === 'a[href]' ? links : [],
    },
  });
  browser.globalThis = browser;
  vm.runInContext(profileContextSource, browser);
  return browser.FacebookProfileContext.isPersonalProfilePage(browser.document, browser.location);
}

test('profile detector allows own-profile route and profile DOM markers', () => {
  assert.equal(detectProfile({ pathname: '/profile.php', search: '?id=100' }), true);
  assert.equal(detectProfile({ pathname: '/kats.pierce', links: [
    { href: 'https://www.facebook.com/profile.php?entry=edit&id=100' },
  ], selectors: { 'a[href*="/friends_all/"], a[href*="directory_personal_details"]': {} } }), true);
});

test('profile detector rejects home, Page and business surfaces', () => {
  assert.equal(detectProfile({ pathname: '/' }), false);
  assert.equal(detectProfile({ pathname: '/pages/example/200', links: [
    { href: 'https://www.facebook.com/profile.php?id=200' },
  ] }), false);
  assert.equal(detectProfile({ hostname: 'business.facebook.com', pathname: '/latest/home', search: '?asset_id=200' }), false);
  assert.equal(detectProfile({ pathname: '/kats.pierce', links: [
    { href: 'https://www.facebook.com/profile.php?id=100' },
  ], selectors: {
    'meta[property="fb:pages"]': { content: '200' },
    'a[href*="/friends_all/"], a[href*="directory_personal_details"]': {},
  } }), false);
});

test('profile name reader uses the profile header when Facebook title is generic', () => {
  const profileButton = { textContent: 'Aline Motta' };
  const header = { querySelector: () => profileButton };
  const friendsLink = { parentElement: { parentElement: { parentElement: header } } };
  const doc = {
    title: 'Facebook',
    querySelector(selector) { return selector === 'a[href*="/friends_all/"]' ? friendsLink : null; },
    querySelectorAll() { return []; },
  };
  const browser = vm.createContext({
    URL, URLSearchParams, Date, Math, String, Number, Set, Map, Error,
    location: { hostname: 'www.facebook.com', pathname: '/kats.pierce/', search: '', href: 'https://www.facebook.com/kats.pierce/', origin: 'https://www.facebook.com' },
    document: doc,
  });
  browser.globalThis = browser;
  vm.runInContext(profileContextSource, browser);
  assert.equal(browser.FacebookProfileContext.readProfileDetails(doc, browser.location).name, 'Aline Motta');
});

test('syncs profile and Page records from the request-only managed Page list', async () => {
  const calls = [];
  const result = await ProfilePageSync.syncPageList({
    profileId: '100', name: 'Profile A', avatar: 'https://img.test/profile.png',
  }, [{ pageId: '200', name: 'Page A', avatar: 'https://img.test/page.png' }], {
    getUserApiToken: async () => 'test_token_123',
    getCookies: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }],
    syncProfile: async profile => { calls.push({ kind: 'profile', profile }); },
    syncPages: async pages => { calls.push({ kind: 'pages', pages }); },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, profileId: '100', pageCount: 1 });
  assert.equal(calls[0].profile.fb_uid, '100');
  assert.equal(calls[1].pages[0].page_uid, '200');
  assert.equal(calls[1].pages[0].avatar_url, 'https://img.test/page.png');
});

test('scans pages locally when the employee token is missing', async () => {
  const calls = [];
  const stored = [];
  const previousChrome = context.chrome;
  context.chrome = {
    storage: { local: {
      get: async () => ({}),
      set: async value => { stored.push(value); },
    } },
  };
  try {
    const result = await ProfilePageSync.syncPageList({
      profileId: '100', name: 'Profile A', avatar: 'https://img.test/profile.png',
    }, [{ pageId: '200', name: 'Page A', views_7d: 12, video_count_7d: 3 }], {
      getUserApiToken: async () => '',
      getCookies: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }],
      syncProfile: async profile => { calls.push({ kind: 'profile', profile }); },
      syncPages: async pages => { calls.push({ kind: 'pages', pages }); },
      enableServerSync: true,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, profileId: '100', pageCount: 1 });
    assert.equal(calls.length, 0);
    assert.equal(stored[0].profile_page_sync_pages['100'][0].views_7d, 12);
    assert.equal(stored[0].profile_page_sync_pages['100'][0].video_count_7d, 3);
  } finally {
    if (previousChrome === undefined) delete context.chrome;
    else context.chrome = previousChrome;
  }
});

test('skips server sync when enableServerSync is false but succeeds locally', async () => {
  const calls = [];
  const result = await ProfilePageSync.syncPageList({
    profileId: '100', name: 'Profile A', avatar: 'https://img.test/profile.png',
  }, [{ pageId: '200', name: 'Page A' }], {
    getCookies: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }],
    syncProfile: async profile => { calls.push({ kind: 'profile', profile }); },
    syncPages: async pages => { calls.push({ kind: 'pages', pages }); },
    enableServerSync: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, profileId: '100', pageCount: 1 });
  assert.equal(calls.length, 0); // Không gọi syncProfile và syncPages lên server
});

test('syncs the profile when Facebook has no active managed Pages', async () => {
  const calls = [];
  const result = await ProfilePageSync.syncPageList({
    profileId: '100', name: 'Profile A', avatar: 'https://img.test/profile.png',
  }, [], {
    getUserApiToken: async () => 'test_token_123',
    getCookies: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }],
    syncProfile: async profile => { calls.push({ kind: 'profile', profile }); },
    syncPages: async pages => { calls.push({ kind: 'pages', pages }); },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, profileId: '100', pageCount: 0 });
  assert.deepEqual(calls.map(call => call.kind), ['profile', 'pages']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].pages)), []);
});

test('rejects Page identity and mismatched profiles before server writes', async () => {
  for (const [profileId, cookies] of [
    ['100', [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '200' }]],
    ['200', [{ name: 'c_user', value: '100' }]],
  ]) {
    let writes = 0;
    await assert.rejects(ProfilePageSync.syncPageList({ profileId, name: 'Profile' }, [{ id: '200', name: 'Page' }], {
      getCookies: async () => cookies,
      syncProfile: async () => { writes++; },
      syncPages: async () => { writes++; },
    }));
    assert.equal(writes, 0);
  }
});

test('does not overwrite a real profile name with a Facebook placeholder', async () => {
  let writes = 0;
  await assert.rejects(ProfilePageSync.syncPageList({ profileId: '100', name: 'Facebook User' }, [], {
    getCookies: async () => [{ name: 'c_user', value: '100' }],
    syncProfile: async () => { writes++; },
  }), /tên profile/);
  assert.equal(writes, 0);
});

test('extracts Page follower and seven-day view metrics from keyed Facebook response fields', () => {
  const metrics = FacebookInsightsMetrics.extractMetrics([{ data: {
    page: { follower_count: 128, insights: { views: 17 } },
  } }], { last7Days: true });
  assert.deepEqual(JSON.parse(JSON.stringify(metrics)), { follow_count: 128, views_7d: 17 });
});

test('ignores failed metrics responses and does not treat range views as seven-day views by default', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(FacebookInsightsMetrics.extractMetrics([
    { data: { metrics: { __typename: 'TofuErrorQueryResult', follower_count: 999 } } },
    { data: { page: { views: 77 } } },
  ]))), {});
});

test('reads follower total from the rendered Portuguese Business Suite audience screen', () => {
  const metrics = FacebookInsightsMetrics.readVisibleMetrics({
    body: { innerText: 'Insights Público Seguidores Total 0 Faixa etária e gênero' },
    querySelectorAll: () => [],
  }, { pathname: '/latest/insights/people/', search: '?asset_id=134' });
  assert.deepEqual(JSON.parse(JSON.stringify(metrics)), { follow_count: 0 });
});

test('reads seven-day views from visible Business Suite text when metric cards are not buttons', () => {
  const metrics = FacebookInsightsMetrics.readVisibleMetrics({
    body: { innerText: 'Visão geral do conteúdo Visualizações 7 100% Visualizações de 3 segundos 0 0%' },
    querySelectorAll: () => [],
  }, { pathname: '/latest/insights/content_summary', search: '?time_range=%2522LAST_7D%2522' });
  assert.deepEqual(JSON.parse(JSON.stringify(metrics)), { views_7d: 7 });
});

test('maps Facebook Page IDs to Business Suite asset IDs from the managed Page list', () => {
  const pageLink = { getAttribute: () => '/profile.php?id=61595840758905', innerText: 'Finaline', textContent: 'Finaline' };
  const avatarImage = { getAttribute: key => key === 'xlink:href' ? 'https://scontent.example/page-finaline.jpg' : null };
  const avatarLink = {
    getAttribute: () => '/profile.php?id=61595840758905&__tn__=%3C',
    innerText: '', textContent: '', querySelector: () => avatarImage,
  };
  const assetLink = { getAttribute: () => '/latest/inbox/all?asset_id=1344846568720021' };
  const outerCard = {
    parentElement: null,
    querySelectorAll(selector) {
      if (selector.includes('profile.php')) return [avatarLink, pageLink];
      return [];
    },
  };
  const card = {
    parentElement: outerCard,
    querySelectorAll(selector) {
      if (selector.includes('profile.php')) return [pageLink];
      if (selector.includes('asset_id')) return [assetLink];
      return [];
    },
  };
  let parent = card;
  for (let i = 0; i < 13; i++) {
    parent = { parentElement: parent, querySelectorAll: () => [] };
  }
  assetLink.parentElement = parent;
  class Parser { parseFromString() { return { querySelectorAll: () => [assetLink] }; } }
  assert.deepEqual(JSON.parse(JSON.stringify(FacebookPageAssets.parsePageAssetMap('<html/>', Parser))), [
    { pageId: '61595840758905', assetId: '1344846568720021', name: 'Finaline', avatar: 'https://scontent.example/page-finaline.jpg' },
  ]);
});

test('maps vanity URL Pages when the card exposes its numeric ID through page_id', () => {
  const nameLink = { getAttribute: () => '/meraki1984sv', innerText: 'Gao Đỏ Chuyên Hóng', textContent: 'Gao Đỏ Chuyên Hóng' };
  const pageIdLink = { getAttribute: () => '/ad_center/create/ad/?page_id=106145064581604', innerText: '', textContent: '' };
  const assetLink = { getAttribute: () => '/latest/inbox/all?asset_id=106145064581604' };
  const card = {
    parentElement: null,
    querySelectorAll(selector) {
      if (selector.includes('profile.php')) return [];
      if (selector.includes('page_id=')) return [pageIdLink];
      if (selector.includes('a[href]')) return [nameLink, pageIdLink, assetLink];
      if (selector.includes('img[src]')) return [];
      return [];
    },
  };
  assetLink.parentElement = card;
  class Parser { parseFromString() { return { querySelectorAll: () => [assetLink] }; } }
  assert.deepEqual(JSON.parse(JSON.stringify(FacebookPageAssets.parsePageAssetMap('<html/>', Parser))), [
    { pageId: '106145064581604', name: 'Gao Đỏ Chuyên Hóng' },
  ]);
});

test('requests the actual seven-day Insights GraphQL query and sums its daily points', async () => {
  let request;
  const result = await FacebookBusinessInsightsApi.fetchPageViews7d('1344846568720021', {
    fb_dtsg: 'test-dtsg', lsd: 'test-lsd',
  }, async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => 'for (;;);{"data":{"tofu_metrics_query":{"__typename":"TofuTimeSeriesWithoutBreakdownMetricsQueryResult","points":[{"value":0},{"value":7}]}}}' };
  });
  assert.equal(request.url, 'https://business.facebook.com/api/graphql/');
  assert.equal(request.options.credentials, 'include');
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get('doc_id'), '10032545723449890');
  assert.equal(JSON.parse(body.get('variables')).arg.id, '1344846568720021');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { views_7d: 7 });
});

test('FacebookBusinessInsightsApi.fetchWeeklyVideosAndViews extracts video count and total views for last 7d', async () => {
  let request;
  const fakeApiResponse = 'for (;;);' + JSON.stringify({
    data: {
      bizweb_unified_table: {
        edges: [
          {
            node: {
              id: "v1",
              video_status: "PUBLISHED",
              metrics: { VIEWS: 1250, REACH: 3000 }
            }
          },
          {
            node: {
              id: "v2",
              content_type: "REELS_VIDEO",
              views: 3500
            }
          },
          {
            node: {
              id: "post3",
              video_status: null,
              content_type: "IMAGE",
              metrics: { VIEWS: 0 }
            }
          }
        ]
      }
    }
  });

  const result = await FacebookBusinessInsightsApi.fetchWeeklyVideosAndViews('649510394916531', {
    fb_dtsg: 'test-dtsg', lsd: 'test-lsd',
  }, async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => fakeApiResponse };
  });

  assert.equal(request.url, 'https://business.facebook.com/api/graphql/');
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get('doc_id'), '27989945277348632');
  assert.equal(body.get('fb_api_req_friendly_name'), 'useBizWebUnifiedTableInitialLoad_data_refetchable');
  assert.equal(body.get('av'), '649510394916531');

  const vars = JSON.parse(body.get('variables'));
  assert.deepEqual(vars.ids, ['649510394916531']);
  assert.equal(vars.timeRange.type, 'LAST_7D');

  assert.equal(result.video_count_7d, 2);
  assert.equal(result.views_7d, 4750);
});

test('uploads metrics only to the cached managed Page for the active personal profile', async () => {
  let uploaded;
  const result = await ProfilePageSync.syncMetrics('Page A', { follow_count: 128, views_7d: 17 }, {
    getCookies: async () => [{ name: 'c_user', value: '100' }, { name: 'i_user', value: '0' }],
    getStorage: async () => ({ profile_page_sync_pages: { 100: [{ id: '200', name: 'Page A' }] } }),
    syncPages: async pages => { uploaded = pages; },
  });
  assert.equal(result.success, true);
  assert.equal(uploaded[0].page_uid, '200');
  assert.equal(uploaded[0].follow_count, 128);
  assert.equal(uploaded[0].views_7d, 17);
});

test('FacebookAPI.getAccountAndDtsg extracts DTSG, LSD and user details from Facebook HTML', async () => {
  const fakeHtml = `
    <html>
      <head>
        <script>["DTSGInitialData",[],{"token":"NA_test_token_123"}]</script>
        <script>["LSD",[],{"token":"lsd_test_token"}]</script>
        <script>"CurrentUserInitialData",{"ACCOUNT_ID":"100088991234","USER_ID":"100088991234","NAME":"Nguyen Van A"}</script>
      </head>
      <body></body>
    </html>
  `;
  const account = await FacebookAPI.getAccountAndDtsg({
    getCookies: async () => [{ name: 'c_user', value: '100088991234' }],
    fetchImpl: async () => ({
      ok: true,
      text: async () => fakeHtml,
    }),
  });
  assert.equal(account.userId, '100088991234');
  assert.equal(account.cUserId, '100088991234');
  assert.equal(account.name, 'Nguyen Van A');
  assert.equal(account.dtsg, 'NA_test_token_123');
  assert.equal(account.lsd, 'lsd_test_token');
});

test('FacebookAPI.getUserPages extracts pages via Strategy 1 (ProfileSwitcher GraphQL)', async () => {
  const fakeGraphQLResponse = 'for (;;);{"data":{"viewer":{"profile_switcher_eligible_profiles":[{"id":"20001","name":"Page Mot","__typename":"Page","picture":{"data":{"url":"https://cdn.example/p1.jpg"}}},{"id":"20002","name":"Page Hai","__typename":"Page","profile_picture":{"uri":"https://cdn.example/p2.jpg"}}]}}}';
  const pages = await FacebookAPI.getUserPages({
    dtsg: 'test-dtsg',
    userId: '100088991234',
    fetchImpl: async (url) => {
      if (url.includes('/api/graphql/')) {
        return { ok: true, text: async () => fakeGraphQLResponse };
      }
      return { ok: false };
    },
  });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].id, '20001');
  assert.equal(pages[0].name, 'Page Mot');
  assert.equal(pages[0].avatar, 'https://cdn.example/p1.jpg');
  assert.equal(pages[1].id, '20002');
  assert.equal(pages[1].name, 'Page Hai');
});

test('FacebookAPI.getUserPages falls back to Strategy 2 (Ads Token + Graph API)', async () => {
  const pages = await FacebookAPI.getUserPages({
    dtsg: null, // Bỏ qua Chiến lược 1
    userId: '100088991234',
    fetchImpl: async (url) => {
      if (url.includes('adsmanager.facebook.com')) {
        return { ok: true, text: async () => 'window.__TOKEN = "EAAB123456789xyz";' };
      }
      if (url.includes('graph.facebook.com/v21.0/me/accounts')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: '30001', name: 'Ads Fanpage', access_token: 'EAAB_PAGE_TOKEN', picture: { data: { url: 'https://cdn.example/ads.jpg' } } },
            ],
          }),
        };
      }
      return { ok: false };
    },
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].id, '30001');
  assert.equal(pages[0].name, 'Ads Fanpage');
  assert.equal(pages[0].accessToken, 'EAAB_PAGE_TOKEN');
});

test('FacebookAPI.getUserPages falls back to Strategy 3 (mbasic HTML Scraping)', async () => {
  const fakeMbasicHtml = `
    <div>
      <a href="/pages/category/40001/">Shop Thoi Trang</a>
      <a href="/profile.php?id=40002">Phu Kien Dien Thoai</a>
      <a href="/help">Help</a>
    </div>
  `;
  const pages = await FacebookAPI.getUserPages({
    dtsg: null,
    userId: '100088991234',
    fetchImpl: async (url) => {
      if (url.includes('adsmanager.facebook.com')) {
        return { ok: false };
      }
      if (url.includes('mbasic.facebook.com/pages/')) {
        return { ok: true, text: async () => fakeMbasicHtml };
      }
      return { ok: false };
    },
  });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].id, '40001');
  assert.equal(pages[0].name, 'Shop Thoi Trang');
  assert.equal(pages[1].id, '40002');
  assert.equal(pages[1].name, 'Phu Kien Dien Thoai');
});


test('reads the rendered content summary page into one insights payload', () => {
  const fixture = path.join(root, 'request/contewnt-insignt.html');
  if (!fs.existsSync(fixture)) return;
  const html = fs.readFileSync(fixture, 'utf8');
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&');
  const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map(match => ({
    getAttribute: () => match[1],
  }));
  const context = vm.createContext({ Date, String, Number, Math, RegExp, Array, document: {} });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'modules/facebook/content-summary.js'), 'utf8'), context);
  const insights = context.FacebookContentSummary.readContentSummary({
    body: { innerText: visible },
    location: { href: 'https://business.facebook.com/latest/insights/content_summary?asset_id=1438624289328026' },
    querySelectorAll: () => anchors,
  }, 'https://business.facebook.com/latest/insights/content_summary?asset_id=1438624289328026');
  assert.equal(insights.asset_id, '1438624289328026');
  assert.equal(insights.range.days, 28);
  assert.equal(insights.overview.views, 1269600);
  assert.equal(insights.overview.viewers, 881081);
  assert.equal(insights.overview.three_second_views, 587100);
  assert.equal(insights.overview.interactions, 55600);
  assert.equal(insights.overview.watch_time, '105d 20h');
  assert.equal(insights.formats.reels, 13);
  assert.equal(insights.formats.stories, 1);
  assert.equal(insights.formats.views.reels, 1269587);
  assert.equal(insights.formats.views.photo, 9);
  assert.equal(insights.formats.views.others, 6);
  assert.equal(insights.formats.interactions.reels, 55623);
  assert.equal(insights.formats.interactions.photo, 1);
  assert.equal(insights.contents.length, 8);
  assert.equal(insights.contents[0].views, 510500);
  assert.ok(insights.contents.every(item => item.content_id && item.content_url === `https://www.facebook.com/1438624289328026/posts/${item.content_id}`));
  assert.ok(insights.contents[0].links.some(link => link.startsWith('https://threadchico.com/')));
  assert.equal(insights.contents[0].content_url, 'https://www.facebook.com/1438624289328026/posts/122110256031516759');
});

test('stores the video thumbnail from the content card image', () => {
  const context = vm.createContext({ Date, String, Number, Math, RegExp, Array, document: {} });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'modules/facebook/content-summary.js'), 'utf8'), context);
  const insights = context.FacebookContentSummary.readContentSummary({
    body: { innerText: 'Last 28 days: Oct 8, 2026 - Nov 4, 2026 Views 1.2M 10% Viewers 100,000 1% 3-second views 10K 1% Content interactions 1K 1% Watch time 1d 2h 1% Reels 1 Stories 0 Top content by views Sample caption Sun Nov 1, 1:00 am 10K 20 1 2 Top content formats' },
    location: { href: 'https://business.facebook.com/latest/insights/content_summary?asset_id=1438624289328026' },
    querySelectorAll: () => [{
      getAttribute: () => '/latest/insights/object_insights/?content_id=122110256031516759',
      querySelector: () => ({ getAttribute: () => 'https://scontent.example/video-thumb.jpg' }),
    }],
  });
  assert.equal(insights.contents[0].thumbnail, 'https://scontent.example/video-thumb.jpg');
  assert.equal(insights.contents[0].content_url, 'https://www.facebook.com/1438624289328026/posts/122110256031516759');
});

test('FacebookBusinessInsightsApi parses actual request/contents response correctly', async () => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.resolve(__dirname, '../request/contents');
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const startJson = content.indexOf('{"data":');
  if (startJson === -1) return;
  const jsonStr = content.slice(startJson).trim().split('\n')[0];
  const parsed = JSON.parse(jsonStr);

  const result = FacebookBusinessInsightsApi.parseWeeklyVideosAndViews([parsed]);
  assert.equal(result.hasData, true);
  assert.equal(result.video_count_7d, 11);
  assert.equal(result.views_7d, 465);
});

test('FacebookBusinessInsightsApi parses request/list-content stream and extracts contents list', async () => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.resolve(__dirname, '../request/list-content');
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const startJson = content.indexOf('{"data":');
  if (startJson === -1) return;
  const rawPayload = content.slice(startJson);

  const chunks = FacebookBusinessInsightsApi.parseResponse(rawPayload);
  assert.ok(chunks.length > 0);

  const stats = FacebookBusinessInsightsApi.parseWeeklyVideosAndViews(chunks.slice(0, 1));
  assert.equal(stats.video_count_7d, 8);
  assert.equal(stats.views_7d, 591349);

  const contents = FacebookBusinessInsightsApi.extractContentsFromResponses(chunks, '61595502776441');
  assert.equal(contents.length, 8);
  assert.equal(contents[0].content_id, '1147682911067071');
  assert.equal(contents[0].views, 281);
  assert.equal(contents[1].views, 18495);
  assert.ok(contents[2].links.length > 0);
  assert.ok(contents[0].content_url.includes('facebook.com/61595502776441/videos/1147682911067071'));
});
