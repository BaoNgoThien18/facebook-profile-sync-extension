(() => {
  const FacebookAPI = {
    // 1. Lấy thông tin tài khoản Facebook hiện tại & Token fb_dtsg, lsd
    async getAccountAndDtsg(options = {}) {
      const fetchImpl = options.fetchImpl || fetch;
      let dtsg = "";
      let userId = "";
      let name = "Facebook User";

      let cUserId = "";
      let iUserId = "";
      let activePageId = null;
      let isFanpageMode = false;

      let lsd = "";
      let spinR = "";
      let spinB = "trunk";
      let hsi = "";

      // 1. Đọc cookie c_user và i_user qua chrome.cookies API trên tất cả các domain có thể có
      if (options.getCookies) {
        try {
          const cookies = await options.getCookies();
          const cUserCookie = cookies.find((c) => c.name === "c_user");
          const iUserCookie = cookies.find((c) => c.name === "i_user");
          if (cUserCookie?.value) cUserId = String(cUserCookie.value).trim();
          if (iUserCookie?.value && iUserCookie.value !== "0" && iUserCookie.value !== "null") {
            iUserId = String(iUserCookie.value).trim();
          }
          if (iUserId && iUserId !== cUserId) {
            activePageId = iUserId;
            isFanpageMode = true;
            userId = iUserId;
          } else if (cUserId) {
            userId = cUserId;
          }
        } catch (_) {}
      } else if (typeof chrome !== "undefined" && chrome.cookies) {
        try {
          const [cUrl, cDomain, cSub] = await Promise.all([
            chrome.cookies.getAll({ url: "https://www.facebook.com" }),
            chrome.cookies.getAll({ domain: ".facebook.com" }),
            chrome.cookies.getAll({ domain: "facebook.com" }),
          ]);
          const allCookies = [...(cUrl || []), ...(cDomain || []), ...(cSub || [])];
          const cUserCookie = allCookies.find((c) => c.name === "c_user");
          const iUserCookie = allCookies.find((c) => c.name === "i_user");

          if (cUserCookie?.value) {
            cUserId = String(cUserCookie.value).trim();
          }
          if (iUserCookie?.value && iUserCookie.value !== "0" && iUserCookie.value !== "null") {
            iUserId = String(iUserCookie.value).trim();
          }

          if (iUserId && iUserId !== cUserId) {
            activePageId = iUserId;
            isFanpageMode = true;
            userId = iUserId;
          } else if (cUserId) {
            userId = cUserId;
          }
        } catch (e) {
          console.warn("[FacebookAPI] Không đọc được cookies Facebook:", e);
        }
      }

      // Các trang duyệt để lấy DTSG token và Tên người dùng thật
      const targetUrls = [
        "https://www.facebook.com/?_rdr",
        "https://www.facebook.com/me",
        "https://mbasic.facebook.com/profile.php",
        "https://mbasic.facebook.com/me",
        "https://www.facebook.com/help/463972400461409/?_rdr",
      ];

      for (const url of targetUrls) {
        if (dtsg && userId && name && name !== "Facebook User" && lsd) break;

        try {
          const res = await fetchImpl(url, {
            method: "GET",
            credentials: "include",
            headers: {
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Cache-Control": "no-cache",
            },
          });

          if (res.ok) {
            const html = await res.text();

            // Trích xuất DTSG token toàn diện
            if (!dtsg) {
              const m1 = html.match(/\["DTSGInit(?:ial)?Data",\s*\[\],\s*\{"token":"([^"]+)"/i);
              const m2 = html.match(/DTSGInit(?:ial)?Data[^\}]+"token":"([^"]+)"/i);
              const m3 = html.match(/"token":"(NA[a-zA-Z0-9_\-:]+|AQ[a-zA-Z0-9_\-:]+)"/);
              const m4 = html.match(/name="fb_dtsg"\s+value="([^"]+)"/i);
              const m5 = html.match(/"f":"(NA[a-zA-Z0-9_\-:]+)"/);

              const found = m1?.[1] || m2?.[1] || m3?.[1] || m4?.[1] || m5?.[1];
              if (found) dtsg = found;
            }

            // Trích xuất LSD token
            if (!lsd) {
              const mLsd1 = html.match(/\["LSD",\s*\[\],\s*\{"token":"([^"]+)"/i);
              const mLsd2 = html.match(/"LSD"[^\}]+"token":"([^"]+)"/i);
              const mLsd3 = html.match(/name="lsd"\s+value="([^"]+)"/i);
              const foundLsd = mLsd1?.[1] || mLsd2?.[1] || mLsd3?.[1];
              if (foundLsd) lsd = foundLsd;
            }

            if (!spinR) {
              spinR = html.match(/"__spin_r"\s*:\s*(\d+)/i)?.[1] || "";
            }
            if (!spinB || spinB === "trunk") {
              spinB = html.match(/"__spin_b"\s*:\s*"([^"]+)"/i)?.[1] || "trunk";
            }
            if (!hsi) {
              hsi = html.match(/"__hsi"\s*:\s*"(\d+)"/i)?.[1] || "";
            }

            // Trích xuất CurrentUserInitialData (chứa ACCOUNT_ID, USER_ID, NAME)
            const mAcc = html.match(/"CurrentUserInitialData"[^}]*?"ACCOUNT_ID":"(\d+)"/);
            const mUid = html.match(/"CurrentUserInitialData"[^}]*?"USER_ID":"(\d+)"/);
            if (mAcc && mAcc[1] && !cUserId) {
              cUserId = mAcc[1];
            }

            if (mAcc && mUid && mAcc[1] !== mUid[1] && mUid[1] !== "0") {
              activePageId = mUid[1];
              isFanpageMode = true;
              userId = mUid[1];
            }

            if (!name || name === "Facebook User") {
              const mName1 = html.match(/"CurrentUserInitialData"[^}]*?"NAME":"([^"]+)"/);
              const mName2 = html.match(/"CurrentUserInitialData"[^}]*?"SHORT_NAME":"([^"]+)"/);
              const mName3 = html.match(/"NAME":"([^"]+)"/);
              const rawName = mName1?.[1] || mName2?.[1] || mName3?.[1];
              if (rawName && rawName !== "null" && rawName !== "Facebook") {
                try {
                  name = JSON.parse(`"${rawName}"`);
                } catch (_) {
                  name = rawName;
                }
              }
            }

            // Trích xuất tên từ thẻ title
            if (!name || name === "Facebook User") {
              const mTitle = html.match(/<title[^>]*>([^<]+?)<\/title>/i);
              if (mTitle && mTitle[1]) {
                let cleanTitle = mTitle[1].replace(/\s*\|\s*Facebook\s*$/i, "").replace(/\s*-\s*Facebook\s*$/i, "").trim();
                if (
                  cleanTitle &&
                  !cleanTitle.toLowerCase().includes("facebook") &&
                  !cleanTitle.toLowerCase().includes("log in") &&
                  !cleanTitle.toLowerCase().includes("đăng nhập") &&
                  !cleanTitle.toLowerCase().includes("trung tâm trợ giúp")
                ) {
                  name = cleanTitle;
                }
              }
            }

            // Trích xuất actorID
            const mActor = html.match(/"actorID":"(\d+)"/) || html.match(/"page_id":"(\d+)"/) || html.match(/"delegate_page_id":"(\d+)"/);
            const isPageActor = html.includes('"is_page_actor":true') || html.includes('"is_page":true');
            if (mActor && mActor[1] && mActor[1] !== "0") {
              const foundActorId = mActor[1];
              if (cUserId && foundActorId !== cUserId) {
                activePageId = foundActorId;
                isFanpageMode = true;
                userId = foundActorId;
              }
            } else if (isPageActor) {
              isFanpageMode = true;
              if (!activePageId && userId && userId !== cUserId) {
                activePageId = userId;
              }
            }

            if (!userId || userId === "0") {
              if (mUid && mUid[1] && mUid[1] !== "0") {
                userId = mUid[1];
              }
            }
          }
        } catch (err) {
          console.warn(`[FacebookAPI] Lỗi fetch ${url}:`, err);
        }
      }

      if (!userId || userId === "0") {
        throw new Error("Chưa đăng nhập Facebook trên trình duyệt. Hãy đăng nhập facebook.com.");
      }

      const FB_CLIENT_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";
      const realUserId = cUserId || userId;
      let avatar = `https://graph.facebook.com/${realUserId}/picture?height=100&access_token=${FB_CLIENT_TOKEN}`;

      // Thử lấy Avatar ảnh thật chất lượng cao qua GraphQL Hovercard
      if (dtsg) {
        try {
          const fdHover = new FormData();
          fdHover.append("fb_dtsg", dtsg);
          fdHover.append("av", realUserId);
          fdHover.append("__user", realUserId);
          fdHover.append("__a", "1");
          fdHover.append("doc_id", "27838033792508877");
          fdHover.append(
            "variables",
            JSON.stringify({
              actionBarRenderLocation: "WWW_COMET_HOVERCARD",
              context: "DEFAULT",
              entityID: realUserId,
              scale: 2,
            })
          );

          const hRes = await fetchImpl("https://www.facebook.com/api/graphql/", {
            method: "POST",
            credentials: "include",
            body: fdHover,
          });

          if (hRes.ok) {
            let hText = await hRes.text();
            if (hText.startsWith("for (;;);")) hText = hText.slice(9);
            const hJson = JSON.parse(hText);
            const entity = hJson.data?.entity || hJson.data?.node || {};
            const fetchedName = entity.title?.text || entity.name || entity.subtitle?.text;
            if (fetchedName && typeof fetchedName === "string" && (!name || name === "Facebook User")) {
              name = fetchedName.trim();
            }
            if (entity.profile_picture?.uri) {
              avatar = entity.profile_picture.uri;
            }
          }
        } catch (eHover) {
          console.warn("[FacebookAPI] Hovercard GraphQL gặp lỗi:", eHover);
        }
      }

      // Fallback 2: fetch mbasic profile của chính userId
      if (!name || name === "Facebook User") {
        try {
          const mbRes = await fetchImpl(`https://mbasic.facebook.com/${realUserId}`, {
            method: "GET",
            credentials: "include",
          });
          if (mbRes.ok) {
            const mbHtml = await mbRes.text();
            const mbTitle = mbHtml.match(/<title[^>]*>([^<]+?)<\/title>/i);
            if (mbTitle && mbTitle[1]) {
              let t = mbTitle[1].replace(/\s*\|\s*Facebook\s*$/i, "").trim();
              if (t && !t.toLowerCase().includes("facebook") && !t.toLowerCase().includes("log in")) {
                name = t;
              }
            }
          }
        } catch (_) {}
      }

      return {
        userId,
        cUserId: realUserId,
        name: name || "Facebook User",
        avatar,
        dtsg,
        lsd,
        spinR,
        spinB,
        hsi,
        activePageId: activePageId || (isFanpageMode ? userId : null),
        isFanpageMode: isFanpageMode || !!activePageId,
      };
    },

    // 2. Lấy danh sách Fanpage mà tài khoản quản lý (4 chiến lược kế thừa từ Boclinkaff)
    async getUserPages({ dtsg, userId, fetchImpl = fetch } = {}) {
      const pageMap = new Map();
      const currentUserId = String(userId || "");

      function parsePagesRecursively(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const item of obj) parsePagesRecursively(item);
          return;
        }

        if (obj.id && obj.name && obj.name !== "Facebook User") {
          const pId = String(obj.id);
          const isPage =
            obj.__typename === "Page" ||
            obj.category !== undefined ||
            obj.is_published !== undefined ||
            obj.access_token ||
            (pId !== currentUserId);

          if (isPage && !pageMap.has(pId)) {
            const avatar =
              obj.picture?.data?.url ||
              obj.profile_picture?.uri ||
              `https://graph.facebook.com/${pId}/picture?height=100`;
            pageMap.set(pId, {
              id: pId,
              name: String(obj.name).trim(),
              avatar,
              accessToken: obj.access_token || null,
            });
          }
        }

        for (const k of Object.keys(obj)) {
          parsePagesRecursively(obj[k]);
        }
      }

      // =========================================================================
      // CHIẾN LƯỢC 1: ProfileSwitcher GraphQL (Chuẩn Facebook Web hiện đại)
      // =========================================================================
      if (dtsg) {
        const switcherDocIds = ["6148386455243355", "5276388902441029", "3798950483501718"];
        for (const docId of switcherDocIds) {
          if (pageMap.size > 0) break;
          try {
            const fd = new FormData();
            fd.append("fb_dtsg", dtsg || "");
            fd.append("av", currentUserId);
            fd.append("__user", currentUserId);
            fd.append("__a", "1");
            fd.append("doc_id", docId);
            fd.append("variables", JSON.stringify({ count: 50, scale: 1.5 }));

            const res = await fetchImpl("https://www.facebook.com/api/graphql/", {
              method: "POST",
              credentials: "include",
              body: fd,
            });

            if (res.ok) {
              let text = await res.text();
              if (text.startsWith("for (;;);")) text = text.slice(9);
              const lines = text.split("\n").filter((l) => l.trim().length > 0);
              for (const line of lines) {
                try {
                  const json = JSON.parse(line);
                  parsePagesRecursively(json);
                } catch (_) {}
              }
            }
          } catch (e1) {
            console.warn(`[FacebookAPI] Chiến lược 1 (doc_id: ${docId}) lỗi:`, e1);
          }
        }
      }

      if (pageMap.size > 0) {
        return Array.from(pageMap.values());
      }

      // =========================================================================
      // CHIẾN LƯỢC 2: Thử lấy qua Ads Token (me/accounts)
      // =========================================================================
      try {
        const adsRes = await fetchImpl("https://adsmanager.facebook.com/adsmanager/manage/campaigns?metuscors=0", {
          method: "GET",
          credentials: "include",
        });
        if (adsRes.ok) {
          const adsHtml = await adsRes.text();
          const tokenMatch = adsHtml.match(/EAAB[a-zA-Z0-9]+/);
          if (tokenMatch && tokenMatch[0]) {
            const token = tokenMatch[0];
            const graphRes = await fetchImpl(
              `https://graph.facebook.com/v21.0/me/accounts?access_token=${token}&fields=access_token,id,name,picture,is_published&limit=100`
            );
            if (graphRes.ok) {
              const graphJson = await graphRes.json();
              if (Array.isArray(graphJson.data)) {
                for (const p of graphJson.data) {
                  const pId = String(p.id);
                  pageMap.set(pId, {
                    id: pId,
                    name: p.name,
                    avatar: p.picture?.data?.url || `https://graph.facebook.com/${pId}/picture?height=100`,
                    accessToken: p.access_token || null,
                  });
                }
              }
            }
          }
        }
      } catch (e2) {
        console.warn("[FacebookAPI] Quét Fanpage qua Ads token gặp lỗi:", e2);
      }

      if (pageMap.size > 0) {
        return Array.from(pageMap.values());
      }

      // =========================================================================
      // CHIẾN LƯỢC 3: Quét trực tiếp từ mbasic.facebook.com/pages/ và bookmarks
      // =========================================================================
      const mbasicPageUrls = [
        "https://mbasic.facebook.com/pages/?category=your_pages",
        "https://mbasic.facebook.com/pages/",
        "https://mbasic.facebook.com/bookmarks/pages/",
      ];
      for (const pUrl of mbasicPageUrls) {
        if (pageMap.size > 0) break;
        try {
          const res = await fetchImpl(pUrl, {
            method: "GET",
            credentials: "include",
          });
          if (res.ok) {
            const html = await res.text();
            const pageLinkRegex = /<a\s+[^>]*href=["']\/(?:pages\/[^\/]+\/|profile\.php\?id=)?(\d{4,31})[^"']*["'][^>]*>(.*?)<\/a>/gi;
            let match;
            while ((match = pageLinkRegex.exec(html)) !== null) {
              const pId = match[1];
              let pName = match[2].replace(/<[^>]+>/g, "").trim();
              if (pId && pName && pId !== currentUserId && !["settings", "help", "notifications"].includes(pName.toLowerCase())) {
                if (!pageMap.has(pId)) {
                  pageMap.set(pId, {
                    id: pId,
                    name: pName,
                    avatar: `https://graph.facebook.com/${pId}/picture?height=100`,
                    accessToken: null,
                  });
                }
              }
            }
          }
        } catch (e3) {
          console.warn(`[FacebookAPI] Chiến lược 3 (${pUrl}) lỗi:`, e3);
        }
      }

      if (pageMap.size > 0) {
        return Array.from(pageMap.values());
      }

      // =========================================================================
      // CHIẾN LƯỢC 4: Quét qua Comet HTML /pages/?category=your_pages
      // =========================================================================
      try {
        const res = await fetchImpl("https://www.facebook.com/pages/?category=your_pages&_rdr", {
          method: "GET",
          credentials: "include",
        });
        if (res.ok) {
          const html = await res.text();
          const scriptMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs);
          for (const sm of scriptMatches) {
            try {
              const data = JSON.parse(sm[1]);
              parsePagesRecursively(data);
            } catch (_) {}
          }
        }
      } catch (e4) {
        console.warn("[FacebookAPI] Quét Fanpage qua Comet HTML gặp lỗi:", e4);
      }

      const FB_CLIENT_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";
      const finalPages = Array.from(pageMap.values()).map((p) => {
        if (!p.avatar || !p.avatar.startsWith("http")) {
          p.avatar = `https://graph.facebook.com/${p.id}/picture?height=100&access_token=${FB_CLIENT_TOKEN}`;
        } else if (p.avatar.includes("graph.facebook.com") && !p.avatar.includes("access_token")) {
          p.avatar += `&access_token=${FB_CLIENT_TOKEN}`;
        }
        return p;
      });

      return finalPages;
    },
  };

  globalThis.FacebookAPI = FacebookAPI;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { FacebookAPI };
  }
})();
