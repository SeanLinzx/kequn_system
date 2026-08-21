/** 爆品促销海报 — AI 与方案 API 封装 */
(function () {
  const TEXT_MODEL = "deepseek-v4-flash";
  const SEARCH_MODEL = "doubao-seed-2-0-pro-260215";
  const IMAGE_MODEL = "doubao-seedream-4-0-250828";
  const IMAGE_SIZE = "1440x2560";
  const LS_KEY = "fenqun_promo_plans";
  const LS_LIBRARY_KEY = "fenqun_poster_library";

  /** 生图构图约束：避免模型输出手机样机/边框 */
  const POSTER_COMPOSITION_RULES =
    "整张画面就是完整竖版促销海报本身，铺满画幅、全出血满版构图。" +
    "禁止出现手机边框、手机外壳、iPhone/Android mockup、设备样机、平板边框、屏幕相框、" +
    "UI界面截图、App界面、手持手机、3D手机模型、样机展示、海报嵌在手机里。" +
    "直接生成可上门店竖屏电子屏的促销海报，不要任何设备外框。";

  const API_BASE =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? ""
      : "/fenqun/api";

  function apiUrl(path) {
    return API_BASE + path;
  }

  async function postJson(path, body) {
    const resp = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err || "HTTP " + resp.status);
    }
    return resp.json();
  }

  async function getJson(path) {
    const resp = await fetch(apiUrl(path));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, timeoutMs);
    try {
      const resp = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
      return resp;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("请求超时（" + Math.round(timeoutMs / 1000) + "s），请检查网络或稍后重试");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function extractResponsesText(data) {
    if (!data) return "";
    if (data.output_text) return data.output_text;
    if (Array.isArray(data.output)) {
      return data.output
        .flatMap(function (item) {
          if (item.type !== "message" || !Array.isArray(item.content)) return [];
          return item.content
            .filter(function (c) {
              return (c.type === "output_text" || c.type === "text") && c.text;
            })
            .map(function (c) {
              return c.text;
            });
        })
        .join("\n");
    }
    return data.choices?.[0]?.message?.content || "";
  }

  /** 联网搜索须走 Responses API，见火山方舟 Web Search 文档 */
  async function callResponses(input, opts) {
    opts = opts || {};
    const body = {
      model: SEARCH_MODEL,
      input: input,
    };
    if (opts.tools) body.tools = opts.tools;
    const resp = await fetchWithTimeout(
      apiUrl("/v3/responses"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts.timeoutMs || 120000,
    );
    const rawText = await resp.text();
    if (!resp.ok) {
      throw new Error(
        "Responses 接口错误 HTTP " + resp.status + (rawText ? "：" + rawText.slice(0, 200) : ""),
      );
    }
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("Responses 返回非 JSON：" + rawText.slice(0, 120));
    }
    if (data.error) throw new Error(data.error.message || "Responses 接口返回错误");
    return extractResponsesText(data);
  }

  async function callAI(messages, opts) {
    opts = opts || {};
    const body = {
      model: TEXT_MODEL,
      stream: false,
      temperature: opts.temperature != null ? opts.temperature : 0.4,
      messages: messages,
    };
    if (opts.tools) body.tools = opts.tools;
    if (opts.responseFormat) body.response_format = opts.responseFormat;
    const resp = await fetchWithTimeout(
      apiUrl("/v3/chat/completions"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts.timeoutMs || 120000,
    );
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error("AI 接口错误 HTTP " + resp.status + (errText ? "：" + errText.slice(0, 120) : ""));
    }
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "AI 接口返回错误");
    return data.choices?.[0]?.message?.content || "";
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isRetryableAiError(err) {
    const msg = String((err && err.message) || err || "");
    return /502|503|504|Bad Gateway|timeout|超时|AbortError|fetch failed/i.test(msg);
  }

  async function callAIWithRetry(messages, opts) {
    opts = opts || {};
    const maxAttempts = opts.retries != null ? opts.retries : 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await callAI(messages, opts);
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts && isRetryableAiError(e)) {
          await sleep(1500 * attempt);
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error("AI 请求失败");
  }

  function parseJsonArray(text) {
    return safeParseJson(text, "array");
  }

  function parseJsonObject(text) {
    return safeParseJson(text, "object");
  }

  function safeParseJson(text, kind) {
    if (!text || !String(text).trim()) {
      throw new Error("AI 返回为空");
    }
    let cleaned = String(text)
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      /* fall through */
    }
    const pattern = kind === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
    const m = cleaned.match(pattern);
    if (!m) throw new Error("未找到 JSON " + (kind === "array" ? "数组" : "对象"));
    try {
      return JSON.parse(m[0]);
    } catch (e) {
      throw new Error("JSON 解析失败：" + (e.message || e));
    }
  }

  function normalizePoster(p, slot, idx) {
    var skus = p.recommendedSkus || p.skus || [];
    if (!Array.isArray(skus)) skus = String(skus).split(/[、,，/]/).map(function (s) {
      return s.trim();
    }).filter(Boolean);
    return {
      id: slot.id + "-" + (idx + 1),
      slotId: slot.id,
      slotLabel: slot.label,
      headline: p.headline || p.title || "",
      subline: p.subline || p.subtitle || p.desc || "",
      imagePrompt: p.imagePrompt || p.prompt || "",
      promotionPlan: p.promotionPlan || p.promoPlan || "",
      salesStrategy: p.salesStrategy || p.strategy || "",
      staffExecution: p.staffExecution || p.staffGuide || "",
      hotWords: Array.isArray(p.hotWords)
        ? p.hotWords
        : p.hotWord
          ? [p.hotWord]
          : [],
      recommendedSkus: skus.slice(0, 3),
      angle: p.angle || "",
      imageUrl: "",
      imageBase64: "",
    };
  }

  const PERSONA_NEED_MAP = {
    上班族: ["通勤补能、提神醒脑", "便携即食、快速结账", "办公室分享小包装"],
    中青年: ["解馋零嘴、追剧必备", "社交分享装", "潮流新品尝鲜"],
    家庭主妇: ["亲子分享、健康轻食", "家庭囤货、组合优惠", "下午茶搭配"],
    学生: ["课间解馋、平价量足", "网红爆款、同学分享", "甜味/辣味偏好"],
    退休老人: ["传统口味、散称自选", "低糖健康、坚果糕点", "慢享型零食"],
  };

  function scoreSkusForSlot(context, slot, hotWords) {
    const lib = context.skuLibrary || [];
    const clusters = new Set(slot.topCategories || []);
    const hints = [];
    (slot.personaPrefs || []).forEach(function (p) {
      (p.skuHints || []).forEach(function (h) {
        hints.push(h);
      });
    });
    (hotWords || []).forEach(function (w) {
      hints.push(w.kw || w.marketingLabel || "");
    });
    const personaSet = new Set(slot.mainPersonas || []);
    return lib
      .map(function (sku) {
        const name = sku.name || "";
        const cluster = sku.cluster || "";
        let score = (sku.sales || 0) / 1000;
        const reasons = [];
        if (clusters.has(cluster)) {
          score += 5000;
          reasons.push("时段热销品类");
        }
        hints.forEach(function (h) {
          if (h && (name.indexOf(h) >= 0 || cluster.indexOf(h) >= 0)) {
            score += 3000;
            reasons.push("匹配「" + h + "」偏好");
          }
        });
        (sku.tags || []).forEach(function (tag) {
          if (personaSet.has(tag)) {
            score += 2500;
            reasons.push("主力客群「" + tag + "」常购");
          }
        });
        return {
          sku: sku,
          score: score,
          reason: reasons.length ? reasons.slice(0, 2).join("；") : "门店热销单品",
        };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
  }

  function prefilterSkus(context, slot, hotWords) {
    return scoreSkusForSlot(context, slot, hotWords)
      .slice(0, 8)
      .map(function (x) {
        return x.sku;
      });
  }

  function recommendSkusForSlot(context, slot, hotWords, limit) {
    limit = limit || 8;
    return scoreSkusForSlot(context, slot, hotWords)
      .slice(0, Math.max(5, Math.min(10, limit)))
      .map(function (item) {
        return {
          name: item.sku.name || "",
          category: item.sku.category || "",
          cluster: item.sku.cluster || "",
          sales: item.sku.sales || 0,
          reason: item.reason,
        };
      });
  }

  function buildSlotAnalysis(context, slot, selectedWords) {
    const shares = slot.personaShares || {};
    const personaInsights = (slot.personaPrefs || []).map(function (pref) {
      const persona = pref.persona;
      const share = shares[persona];
      const hints = pref.skuHints || [];
      const needs = (PERSONA_NEED_MAP[persona] || [])
        .concat(
          hints.slice(0, 3).map(function (h) {
            return "偏好" + h + "类";
          }),
        )
        .slice(0, 4);
      return {
        persona: persona,
        share: share != null ? Math.round(share * 1000) / 10 : null,
        topClusters: pref.topClusters || [],
        needs: needs,
      };
    });
    return {
      slotId: slot.id,
      slotLabel: slot.label,
      goal: slot.goal || "",
      bucketDesc: slot.bucketDesc || "",
      mainPersonas: slot.mainPersonas || [],
      topCategories: slot.topCategories || [],
      personaInsights: personaInsights,
      recommendedSkus: recommendSkusForSlot(context, slot, selectedWords, 10),
    };
  }

  function getSelectedSkusForSlot(context, slot, selectedWords, slotSkuSelections) {
    const picked = slotSkuSelections && slotSkuSelections[slot.id];
    if (picked && picked.length) {
      const lib = context.skuLibrary || [];
      const byName = {};
      lib.forEach(function (s) {
        byName[s.name] = s;
      });
      return picked
        .map(function (name) {
          return byName[name] || { name: name, cluster: "" };
        })
        .filter(function (s) {
          return s.name;
        });
    }
    return prefilterSkus(context, slot, selectedWords).slice(0, 5);
  }

  function buildSlotBrief(context, slot, selectedWords, slotSkuSelections) {
    const skus = getSelectedSkusForSlot(context, slot, selectedWords, slotSkuSelections);
    const skuText = skus
      .map(function (s) {
        return (s.name || "") + "(" + (s.cluster || "") + ")";
      })
      .join("、");
    const hotText = selectedWords
      .slice(0, 5)
      .map(function (w) {
        return (w.marketingLabel || w.kw || "") + "[" + (w.tag || "微博") + "]";
      })
      .join("、");
    return (
      "slotId=" +
      slot.id +
      " 时段=" +
      slot.label +
      " 目标=" +
      (slot.goal || "") +
      " 人群=" +
      (slot.mainPersonas || []).join("、") +
      " 品类=" +
      (slot.topCategories || []).join("、") +
      " 候选SKU=" +
      skuText +
      " 选用热搜=" +
      hotText
    );
  }

  const PLAN_SYSTEM_PROMPT =
    "你是线下零食门店促销策划师。根据各时段人群、用户已选定的候选 SKU 与热点话题，为每个时段生成 2 张可落地执行的促销海报方案。" +
    "每张海报必须：借势热点吸引进店；recommendedSkus 最多 3 个单品，且必须仅从输入的候选SKU中选择，不得编造未提供的商品名。" +
    "字段：headline(≤14字)、subline(≤20字)、imagePrompt(9:16竖版满版海报，主标题超大醒目，禁止手机边框/设备样机/mockup)、promotionPlan(落地促销方案：活动价/组合/限时机制)、salesStrategy(策略说明)、staffExecution(店员执行版：分步骤口语化，含陈列位置/话术/收银动作)、hotWords(数组)、recommendedSkus(≤3个)、angle。" +
    "严格只输出 JSON：{\"slots\":[{\"slotId\":\"...\",\"posters\":[...]},...]}，slots 数量与输入一致，每时段 posters 长度 2。";

  function mergeHotTopics() {
    var lists = Array.prototype.slice.call(arguments);
    var seen = {};
    var out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (w) {
        var key = String(w.kw || w.marketingLabel || "").trim();
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(w);
      });
    });
    return out;
  }

  async function enrichHotTopics(date, weiboWords, onProgress) {
    onProgress("补充美团热搜、时代热点与零售行业话题…");
    var weiboBrief = (weiboWords || [])
      .slice(0, 8)
      .map(function (w) {
        return (w.kw || "") + "[" + (w.source || "微博") + "]";
      })
      .join("、");
    var system =
      "你是消费热点分析师。请联网检索并提炼当天/当周中国消费者感兴趣的热点话题。" +
      "必须覆盖以下来源（各来源至少 2 条，不与微博重复）：①美团/本地生活热搜 ②当代时代热点/季节情绪 ③线下零食便利店/社区门店行业属性 ④本周网络热议。" +
      "不必强行关联零食品类，但要适合门店电子屏海报借势。排除政治敏感、灾难伤亡、恶性犯罪。" +
      "只输出 JSON 数组，每项：{\"kw\":\"话题\",\"tag\":\"来源标签\",\"marketingLabel\":\"海报短标题\",\"note\":\"来源+说明\",\"source\":\"meituan|时代热点|行业|本周\"}。";
    var user =
      "今天是 " +
      date +
      "。已有微博热搜：" +
      (weiboBrief || "无") +
      "。请补充其他来源话题 8-12 条。";
    var raw = await callResponses(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { tools: [{ type: "web_search" }], timeoutMs: 120000 },
    );
    return parseJsonArray(raw).map(function (item) {
      return Object.assign({ source: item.source || "综合" }, item);
    });
  }

  async function generatePosterPlans(context, selectedWords, date, onProgress, slotSkuSelections) {
    onProgress = onProgress || function () {};
    const slots = context.timeSlots || [];
    if (!slots.length) throw new Error("时段数据为空，请检查 promo-context.json");
    if (!selectedWords || !selectedWords.length) {
      throw new Error("请至少选择 1 个热点话题");
    }
    if (slotSkuSelections) {
      slots.forEach(function (slot) {
        const picked = slotSkuSelections[slot.id] || [];
        if (!picked.length) {
          throw new Error("时段 " + slot.label + " 未选择任何 SKU，请返回 Step 2 配置选品");
        }
      });
    }

    onProgress("正在分批次生成 " + slots.length + " 个时段的海报策略（每批 2 个时段）…");
    return await generatePosterPlansChunked(
      context,
      selectedWords,
      date,
      onProgress,
      2,
      slotSkuSelections,
    );
  }

  function mapSlotResults(context, slots, slotResults) {
    const byId = {};
    slotResults.forEach(function (item) {
      if (item && item.slotId) byId[item.slotId] = item.posters || [];
    });
    return slots.map(function (slot) {
      const postersRaw = byId[slot.id] || [];
      if (!postersRaw.length) {
        throw new Error("时段 " + slot.label + " 未生成海报方案");
      }
      return {
        slotId: slot.id,
        slotLabel: slot.label,
        goal: slot.goal,
        mainPersonas: slot.mainPersonas,
        topCategories: slot.topCategories,
        posters: postersRaw.slice(0, 3).map(function (p, idx) {
          return normalizePoster(p, slot, idx);
        }),
      };
    });
  }

  function createFallbackSlotPlan(context, slot, selectedWords, slotSkuSelections) {
    const hot = selectedWords[0] || {};
    const kw = String(hot.kw || hot.marketingLabel || "今日热卖").slice(0, 14);
    const skus = getSelectedSkusForSlot(context, slot, selectedWords, slotSkuSelections)
      .slice(0, 3)
      .map(function (s) {
        return s.name || "";
      })
      .filter(Boolean);
    const skuText = skus.length ? skus.join("、") : "门店爆款";
    return {
      slotId: slot.id,
      slotLabel: slot.label,
      goal: slot.goal,
      mainPersonas: slot.mainPersonas,
      topCategories: slot.topCategories,
      posters: [0, 1].map(function (idx) {
        return normalizePoster(
          {
            headline: kw,
            subline: idx === 0 ? "路过别错过，限时特惠" : "组合更划算，带走更开心",
            imagePrompt:
              "9:16竖版满版零食门店促销海报，主标题「" +
              kw +
              "」超大醒目，" +
              slot.label +
              "时段氛围，高对比营销风，无手机边框无设备样机",
            promotionPlan: "主推 " + skuText + "，收银台组合特价，限时加购第二件半价",
            salesStrategy: "借势「" + kw + "」话题引流，" + slot.label + "针对" + (slot.mainPersonas || []).join("、") + "转化",
            staffExecution:
              "1. 门口/收银台陈列「" +
              skuText +
              "」\n2. 主动话术：今天「" +
              kw +
              "」很火，这款正好搭\n3. 收银时推荐组合装并扫码加会员",
            hotWords: [kw],
            recommendedSkus: skus,
            angle: idx === 0 ? "热点引流" : "组合转化",
          },
          slot,
          idx,
        );
      }),
    };
  }

  async function generateSlotChunkAI(context, chunkSlots, selectedWords, date, slotSkuSelections) {
    const hotSummary = selectedWords
      .slice(0, 5)
      .map(function (w) {
        return w.kw || w.marketingLabel;
      })
      .join("、");
    const slotBriefs = chunkSlots
      .map(function (slot) {
        return buildSlotBrief(context, slot, selectedWords, slotSkuSelections);
      })
      .join("\n");
    const user =
      "日期：" +
      date +
      "\n用户选定的热点话题（必须在海报中借势）：" +
      hotSummary +
      "\n\n各时段信息：\n" +
      slotBriefs;

    const raw = await callAIWithRetry(
      [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      {
        responseFormat: { type: "json_object" },
        temperature: 0.5,
        timeoutMs: 90000,
        retries: 3,
      },
    );
    const parsed = parseJsonObject(raw);
    const slotResults = parsed.slots || parsed.timeSlots || [];
    if (!slotResults.length) throw new Error("AI 未返回 slots 数组");
    return mapSlotResults(context, chunkSlots, slotResults);
  }

  async function generateSingleSlotPlan(context, slot, selectedWords, date, slotSkuSelections) {
    const user = buildSlotBrief(context, slot, selectedWords, slotSkuSelections);
    const raw = await callAIWithRetry(
      [
        {
          role: "system",
          content:
            PLAN_SYSTEM_PROMPT +
            " 若只生成一个时段，输出 {\"slots\":[{\"slotId\":\"" +
            slot.id +
            "\",\"posters\":[...]}]}",
        },
        { role: "user", content: "日期：" + date + "\n" + user },
      ],
      {
        responseFormat: { type: "json_object" },
        temperature: 0.5,
        timeoutMs: 90000,
        retries: 3,
      },
    );
    const parsed = parseJsonObject(raw);
    const slotItem = (parsed.slots || [])[0] || parsed;
    const postersRaw = slotItem.posters || [];
    if (!postersRaw.length) throw new Error("posters 为空");
    return {
      slotId: slot.id,
      slotLabel: slot.label,
      goal: slot.goal,
      mainPersonas: slot.mainPersonas,
      topCategories: slot.topCategories,
      posters: postersRaw.slice(0, 3).map(function (p, idx) {
        return normalizePoster(p, slot, idx);
      }),
    };
  }

  async function generatePosterPlansChunked(
    context,
    selectedWords,
    date,
    onProgress,
    chunkSize,
    slotSkuSelections,
  ) {
    const slots = context.timeSlots;
    const slotsOut = [];
    chunkSize = chunkSize || 2;

    for (let i = 0; i < slots.length; i += chunkSize) {
      const chunk = slots.slice(i, i + chunkSize);
      const from = i + 1;
      const to = Math.min(i + chunkSize, slots.length);
      onProgress("生成策略 " + from + "-" + to + "/" + slots.length + "…");

      try {
        const chunkResults = await generateSlotChunkAI(
          context,
          chunk,
          selectedWords,
          date,
          slotSkuSelections,
        );
        slotsOut.push.apply(slotsOut, chunkResults);
      } catch (chunkErr) {
        console.warn("批次策略失败，改逐时段生成", chunkErr);
        for (let j = 0; j < chunk.length; j++) {
          const slot = chunk[j];
          onProgress("单独生成 " + (i + j + 1) + "/" + slots.length + " · " + slot.label + "…");
          try {
            slotsOut.push(
              await generateSingleSlotPlan(context, slot, selectedWords, date, slotSkuSelections),
            );
          } catch (slotErr) {
            console.warn("时段 AI 失败，使用备用方案", slotErr);
            onProgress("时段 " + slot.label + " 使用备用方案（AI 暂不可用）…");
            slotsOut.push(
              createFallbackSlotPlan(context, slot, selectedWords, slotSkuSelections),
            );
          }
        }
      }
    }
    return slotsOut;
  }

  async function checkApiAvailable() {
    try {
      const resp = await fetch(apiUrl("/promo-plans"), { method: "GET" });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async function searchHotWords(date, staticTrends, onProgress) {
    onProgress = onProgress || function () {};
    var weiboWords = [];
    onProgress("正在拉取微博热搜…");
    try {
      var weibo = await getJson("/weibo-hot?limit=12");
      weiboWords = (weibo.words || []).map(function (w) {
        return Object.assign({ source: w.source || "微博" }, w);
      });
    } catch (e) {
      console.warn("微博热搜接口失败", e);
    }

    var enriched = [];
    try {
      enriched = await enrichHotTopics(date, weiboWords, onProgress);
    } catch (e) {
      console.warn("热点补充失败", e);
      onProgress("热点补充失败，仅使用微博热搜…");
    }

    var merged = mergeHotTopics(weiboWords, enriched);
    if (merged.length >= 5) {
      return {
        words: merged.slice(0, 20),
        source: enriched.length ? "mixed" : "weibo",
        message:
          "已汇总 " +
          merged.length +
          " 个话题（微博 " +
          weiboWords.length +
          " · 美团/时代/行业等 " +
          enriched.length +
          "）",
      };
    }

    onProgress("话题不足，AI 联网全量检索中…");
    var system =
      "你是消费热点分析师。联网检索微博热搜、美团热搜、当代热点、零食零售行业属性、本周热议，提炼 12-15 个当天/当周感兴趣话题。" +
      "只输出 JSON 数组，每项含 kw, tag, marketingLabel, note, source(微博/meituan/时代热点/行业/本周)。排除政治/灾难/恶性事件。";
    var user = "今天是 " + date + "。请输出适合门店海报借势的话题列表。";
    try {
      var raw = await callResponses(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { tools: [{ type: "web_search" }], timeoutMs: 120000 },
      );
      var arr = parseJsonArray(raw);
      merged = mergeHotTopics(weiboWords, arr);
      if (merged.length >= 5) {
        return {
          words: merged.slice(0, 20),
          source: "web",
          message: "已通过联网检索汇总 " + merged.length + " 个热点话题",
        };
      }
    } catch (e) {
      console.warn("联网热词失败", e);
    }

    var fallback = mergeHotTopics(
      weiboWords,
      (staticTrends || []).slice(0, 10).map(function (w) {
        return Object.assign({ source: w.source || "内置" }, w);
      }),
    );
    return {
      words: fallback.slice(0, 15),
      source: "fallback",
      message: "已使用可用话题 " + fallback.length + " 个（部分来源可能不可用）",
    };
  }

  function sanitizeImagePrompt(text) {
    if (!text) return "";
    return String(text)
      .replace(/适合手机竖屏[^，。]*/g, "适合门店竖屏电子屏")
      .replace(/手机[竖横]屏/g, "竖屏电子屏")
      .replace(/手机边框|手机外壳|设备样机|mockup|Mockup|样机展示/g, "")
      .trim();
  }

  function buildFinalImagePrompt(poster) {
    const headline = (poster.headline || "").trim();
    const subline = (poster.subline || "").trim();
    const hotWords = Array.isArray(poster.hotWords) ? poster.hotWords.join("、") : "";
    const skus = Array.isArray(poster.recommendedSkus)
      ? poster.recommendedSkus.slice(0, 4).join("、")
      : "";
    const base = sanitizeImagePrompt(poster.imagePrompt || "");
    return (
      "9:16竖版零食门店促销海报，全出血满版构图，适合门店竖屏电子屏直接播放。" +
      "画面顶部1/3为超大醒目营销主标题「" +
      headline +
      "」，字体极大、加粗、高对比度、极具引流冲击力，必须清晰可读。" +
      (subline ? "副标题「" + subline + "」以中等字号置于主标题下方。" : "") +
      (hotWords ? "海报视觉元素必须与今日热词「" + hotWords + "」强关联。" : "") +
      (skus ? "画面展示真实商品：" + skus + "。" : "") +
      (base ? base + "。" : "") +
      POSTER_COMPOSITION_RULES +
      " 明亮吸睛、商业摄影质感、线下门店引流风格，禁止横版构图。"
    );
  }

  async function generatePosterImage(promptOrPoster) {
    const prompt =
      typeof promptOrPoster === "string"
        ? promptOrPoster
        : buildFinalImagePrompt(promptOrPoster);
    const resp = await fetch(apiUrl("/v3/images/generations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: prompt,
        size: IMAGE_SIZE,
        response_format: "url",
        watermark: false,
      }),
    });
    if (!resp.ok) throw new Error("生图接口错误 HTTP " + resp.status);
    const data = await resp.json();
    const item = data.data?.[0] || {};
    const url = item.url || "";
    const b64 = item.b64_json || "";
    if (b64) {
      return {
        url: url,
        finalPrompt: prompt,
        imageBase64: "data:image/png;base64," + b64,
      };
    }
    if (!url) throw new Error("未返回图片 URL");
    return { url: url, finalPrompt: prompt, imageBase64: "" };
  }

  async function generatePosterImageForPoster(poster) {
    const result = await generatePosterImage(poster);
    poster.finalPrompt = result.finalPrompt;
    if (result.imageBase64) {
      poster.imageBase64 = result.imageBase64;
      poster.imageUrl = result.url || "";
      return result.url || result.imageBase64;
    }
    poster.imageUrl = result.url;
    return result.url;
  }

  async function revisePosterWithFeedback(poster, feedback) {
    const system =
      "你是零食门店促销海报策划师。用户会给出当前海报方案与自然语言修改建议。" +
      "请根据建议更新 headline、subline、imagePrompt、salesStrategy、hotWords、recommendedSkus。" +
      "imagePrompt 必须是 9:16 竖版满版门店促销海报，必须包含 headline 文字，并强调超大醒目营销字体与关联热词。" +
      "禁止手机边框、设备样机、mockup、UI截图或「海报在手机里」的效果。" +
      "只输出 JSON 对象，字段：headline, subline, imagePrompt, salesStrategy, hotWords, recommendedSkus, angle。";
    const user =
      "当前方案：\n" +
      JSON.stringify(
        {
          headline: poster.headline,
          subline: poster.subline,
          imagePrompt: poster.imagePrompt,
          salesStrategy: poster.salesStrategy,
          hotWords: poster.hotWords,
          recommendedSkus: poster.recommendedSkus,
          angle: poster.angle,
        },
        null,
        2,
      ) +
      "\n\n用户修改建议：" +
      (feedback || "无") +
      "\n\n请输出更新后的 JSON。";
    const raw = await callAI([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const updated = parseJsonObject(raw);
    return Object.assign({}, poster, updated, {
      finalPrompt: "",
      imageUrl: "",
      imageBase64: "",
    });
  }

  async function regeneratePosterWithFeedback(poster, feedback) {
    const revised = await revisePosterWithFeedback(poster, feedback);
    const url = await generatePosterImageForPoster(revised);
    if (!revised.imageBase64 && revised.imageUrl) {
      try {
        revised.imageBase64 = await urlToBase64(revised.imageUrl);
      } catch (e) {
        console.warn("转 base64 失败，保留 URL 展示", e);
      }
    }
    return revised;
  }

  async function urlToBase64(url) {
    if (!url) throw new Error("图片 URL 为空");
    if (url.indexOf("data:") === 0) return url;
    const resp = await fetch(
      apiUrl("/image-proxy?url=" + encodeURIComponent(url)),
    );
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        "图片代理失败 HTTP " + resp.status + (errText ? "：" + errText.slice(0, 120) : ""),
      );
    }
    const data = await resp.json();
    if (data.dataUrl) return data.dataUrl;
    throw new Error("图片代理未返回 dataUrl");
  }

  /** 生图 URL 经服务端代理，供 img 标签跨域展示 */
  function proxyImageUrl(url) {
    if (!url || url.indexOf("data:") === 0) return url;
    return apiUrl("/image-proxy?format=raw&url=" + encodeURIComponent(url));
  }

  async function persistPosterImage(poster) {
    if (poster.imageBase64) return poster.imageBase64;
    if (!poster.imageUrl) throw new Error("无可用图片");
    poster.imageBase64 = await urlToBase64(poster.imageUrl);
    return poster.imageBase64;
  }

  /** localStorage 容量约 5MB，不可存 base64 大图，仅保留 URL 与策略字段 */
  function stripPosterForStorage(poster) {
    if (!poster || typeof poster !== "object") return poster;
    const out = Object.assign({}, poster);
    if (out.imageBase64) {
      const b64 = String(out.imageBase64);
      // 保留体积很小的 SVG 占位图，去掉 AI 生图大 base64
      if (b64.length > 80000 && b64.indexOf("image/svg+xml") < 0) {
        delete out.imageBase64;
      }
    }
    return out;
  }

  function stripPlanForStorage(plan) {
    if (!plan || typeof plan !== "object") return plan;
    const out = Object.assign({}, plan);
    if (Array.isArray(out.timeSlots)) {
      out.timeSlots = out.timeSlots.map(function (slot) {
        const s = Object.assign({}, slot);
        if (Array.isArray(s.posters)) {
          s.posters = s.posters.map(stripPosterForStorage);
        }
        return s;
      });
    }
    return out;
  }

  function compactLocalStoragePlans() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const all = JSON.parse(raw);
      const next = {};
      Object.keys(all).forEach(function (date) {
        next[date] = stripPlanForStorage(all[date]);
      });
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("压缩本地方案缓存失败，已清空旧缓存", e);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  function compactLocalLibrary() {
    try {
      const raw = localStorage.getItem(LS_LIBRARY_KEY);
      if (!raw) return;
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return;
      localStorage.setItem(
        LS_LIBRARY_KEY,
        JSON.stringify(items.map(stripPosterForStorage).slice(0, 100)),
      );
    } catch (e) {
      console.warn("压缩本地海报库失败，已清空旧缓存", e);
      try {
        localStorage.removeItem(LS_LIBRARY_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  function loadLocalPlans() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveLocalPlan(plan) {
    try {
      const all = loadLocalPlans();
      all[plan.date] = stripPlanForStorage(plan);
      localStorage.setItem(LS_KEY, JSON.stringify(all));
      return true;
    } catch (e) {
      console.warn("localStorage 方案保存失败", e);
      if (e.name === "QuotaExceededError") {
        try {
          const lite = {};
          lite[plan.date] = stripPlanForStorage(plan);
          localStorage.setItem(LS_KEY, JSON.stringify(lite));
          return true;
        } catch (e2) {
          console.warn("localStorage 仍不足，跳过本地缓存", e2);
        }
      }
      return false;
    }
  }

  async function savePlan(plan) {
    const forPersist = stripPlanForStorage(plan);
    let serverOk = false;
    let localOk = false;
    let serverErr = null;
    try {
      await postJson("/promo-plans", forPersist);
      serverOk = true;
    } catch (e) {
      serverErr = e;
      console.warn("服务端保存失败", e);
    }
    localOk = saveLocalPlan(forPersist);
    if (!serverOk && !localOk) {
      const msg =
        serverErr && serverErr.message
          ? "保存失败：" + serverErr.message
          : "保存失败：本地存储空间不足，请清理浏览器站点数据后重试";
      throw new Error(msg);
    }
    return { serverOk: serverOk, localOk: localOk };
  }

  async function loadPlan(date) {
    try {
      return await getJson("/promo-plans/" + date);
    } catch {
      const local = loadLocalPlans()[date];
      if (local) return local;
      throw new Error("方案不存在");
    }
  }

  async function listPlanDates() {
    const local = Object.keys(loadLocalPlans());
    try {
      const remote = await getJson("/promo-plans");
      const set = new Set(local.concat(remote.dates || []));
      return Array.from(set).sort().reverse();
    } catch {
      return local.sort().reverse();
    }
  }

  function loadLocalLibrary() {
    try {
      return JSON.parse(localStorage.getItem(LS_LIBRARY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveLocalLibrary(items) {
    try {
      const lite = (items || []).map(stripPosterForStorage).slice(0, 100);
      localStorage.setItem(LS_LIBRARY_KEY, JSON.stringify(lite));
      return true;
    } catch (e) {
      console.warn("localStorage 海报库保存失败", e);
      if (e.name === "QuotaExceededError") {
        try {
          localStorage.setItem(
            LS_LIBRARY_KEY,
            JSON.stringify((items || []).slice(0, 20).map(stripPosterForStorage)),
          );
          return true;
        } catch (e2) {
          console.warn("localStorage 仍不足，跳过本地海报库缓存", e2);
        }
      }
      return false;
    }
  }

  function posterToLibraryItem(poster, meta) {
    meta = meta || {};
    return {
      id: poster.id + "-" + Date.now(),
      posterId: poster.id,
      date: meta.date || "",
      slotLabel: poster.slotLabel || meta.slotLabel || "",
      headline: poster.headline || "",
      subline: poster.subline || "",
      imagePrompt: poster.imagePrompt || "",
      finalPrompt: poster.finalPrompt || buildFinalImagePrompt(poster),
      salesStrategy: poster.salesStrategy || "",
      promotionPlan: poster.promotionPlan || "",
      staffExecution: poster.staffExecution || "",
      hotWords: poster.hotWords || [],
      recommendedSkus: (poster.recommendedSkus || []).slice(0, 3),
      imageUrl: poster.imageUrl || "",
      imageBase64: poster.imageBase64 || "",
      savedAt: new Date().toISOString(),
    };
  }

  async function saveToLibrary(poster, meta) {
    const item = posterToLibraryItem(poster, meta);
    const local = loadLocalLibrary();
    local.unshift(stripPosterForStorage(item));
    saveLocalLibrary(local.slice(0, 200));
    try {
      await postJson("/promo-library", stripPosterForStorage(item));
    } catch (e) {
      console.warn("海报库服务端保存失败，已存 localStorage", e);
    }
    return item;
  }

  async function saveAllToLibrary(posters, meta) {
    const items = [];
    for (let i = 0; i < posters.length; i++) {
      items.push(await saveToLibrary(posters[i], meta));
    }
    return items;
  }

  async function loadLibrary() {
    try {
      const remote = await getJson("/promo-library");
      if (Array.isArray(remote.items) && remote.items.length) {
        saveLocalLibrary(remote.items);
        return remote.items;
      }
    } catch (e) {
      console.warn("加载远程海报库失败", e);
    }
    return loadLocalLibrary();
  }

  async function removeFromLibrary(id) {
    const local = loadLocalLibrary().filter(function (x) {
      return x.id !== id;
    });
    saveLocalLibrary(local);
    try {
      await fetch(apiUrl("/promo-library/" + encodeURIComponent(id)), { method: "DELETE" });
    } catch (e) {
      console.warn("删除远程海报失败", e);
    }
  }

  compactLocalStoragePlans();
  compactLocalLibrary();

  window.FQ_PROMO = {
    TEXT_MODEL: TEXT_MODEL,
    IMAGE_MODEL: IMAGE_MODEL,
    IMAGE_SIZE: IMAGE_SIZE,
    API_BASE: API_BASE,
    checkApiAvailable: checkApiAvailable,
    searchHotWords: searchHotWords,
    buildSlotAnalysis: buildSlotAnalysis,
    recommendSkusForSlot: recommendSkusForSlot,
    generatePosterPlans: generatePosterPlans,
    generatePosterImage: generatePosterImage,
    generatePosterImageForPoster: generatePosterImageForPoster,
    buildFinalImagePrompt: buildFinalImagePrompt,
    revisePosterWithFeedback: revisePosterWithFeedback,
    regeneratePosterWithFeedback: regeneratePosterWithFeedback,
    urlToBase64: urlToBase64,
    proxyImageUrl: proxyImageUrl,
    persistPosterImage: persistPosterImage,
    savePlan: savePlan,
    loadPlan: loadPlan,
    listPlanDates: listPlanDates,
    loadLocalPlans: loadLocalPlans,
    saveToLibrary: saveToLibrary,
    saveAllToLibrary: saveAllToLibrary,
    loadLibrary: loadLibrary,
    removeFromLibrary: removeFromLibrary,
    loadLocalLibrary: loadLocalLibrary,
  };
})();
