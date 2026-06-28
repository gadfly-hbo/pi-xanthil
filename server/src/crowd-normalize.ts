// Chinese → English enum normalization for crowd detail data.
// X-CROWD10 v2 §8.2.1: server-side mapping layer on D-CROWD2 import path.
// Pure function, zero LLM.

export interface NormalizeResult {
  normalized: string;
  failed: boolean;
}

// ─── Mapping tables ──────────────────────────────────────────────────────────────

const GENDER_MAP: Record<string, string> = {
  "女": "F",
  "男": "M",
  "其他": "O",
};

const CITY_TIER_MAP: Record<string, string> = {
  "一线": "T1",
  "新一线": "T1_NEW",
  "二线": "T2",
  "三线": "T3",
  "四线及以下": "T4_PLUS",
  "四线": "T4",
  "五线及以下": "T5_PLUS",
};

const PRICE_SENSITIVITY_MAP: Record<string, string> = {
  "高": "high",
  "中等": "mid",
  "中": "mid",
  "低": "low",
};

const DISCOUNT_RESPONSE_MAP: Record<string, string> = {
  "优惠券": "coupon",
  "限时秒杀": "flash_sale",
  "会员价": "member_price",
  "满减": "full_reduction",
  "无明显偏好": "none",
  "无偏好": "none",
  "打折": "discount",
};

const CHANNEL_MAP: Record<string, string> = {
  "小红书": "xhs",
  "抖音": "douyin",
  "微信": "wechat_mp",
  "微信公众号": "wechat_mp",
  "微信小程序": "wechat_mini",
  "天猫": "tmall",
  "京东": "jd",
  "淘宝": "taobao",
  "拼多多": "pdd",
  "线下门店": "offline",
  "抖音商城": "douyin_mall",
  "快手": "kuaishou",
  "得物": "dewu",
};

const LIFECYCLE_MAP: Record<string, string> = {
  "新客": "new",
  "活跃": "active",
  "复购": "repeat",
  "沉睡": "dormant",
  "流失": "churned",
  "潜客": "prospect",
};

const SCENARIO_MAP: Record<string, string> = {
  "周末出游": "weekend_outing",
  "自我犒赏": "self_reward",
  "刚需补货": "essential_restock",
  "节日送礼": "gift_giving",
  "家庭采购": "family_shopping",
  "通勤": "commute",
  "朋友聚餐": "friend_dining",
  "日常购物": "daily_shopping",
};

// Column prefix → dimension mapping (v2 wide-table)
export const PREFIX_DIMENSION_MAP: Record<string, string> = {
  "dem_": "demographic",
  "con_": "consumption_power",
  "pri_sens_": "price_sensitivity",
  "pri_dis_": "price_sensitivity",
  "cha_": "channel_preference",
  "lif_": "lifecycle",
};

// ─── Per-field normalize dispatch ────────────────────────────────────────────────

const FIELD_MAPS: Record<string, Record<string, string>> = {
  gender: GENDER_MAP,
  city_tier: CITY_TIER_MAP,
  price_sensitivity_level: PRICE_SENSITIVITY_MAP,
  discount_response: DISCOUNT_RESPONSE_MAP,
  preferred_channel: CHANNEL_MAP,
  lifecycle_stage: LIFECYCLE_MAP,
  scenario_top2: SCENARIO_MAP,
};

// Fields that use slash-separated multi-values (e.g. "周末出游/自我犒赏")
const SLASH_SEPARATED_FIELDS = new Set(["interest_top3", "scenario_top2"]);

export function normalizeEnumValue(fieldName: string, value: string): NormalizeResult {
  const trimmed = value.trim();
  if (!trimmed) return { normalized: "", failed: false };

  // Slash-separated multi-value: normalize each part independently
  if (SLASH_SEPARATED_FIELDS.has(fieldName)) {
    const parts = trimmed.split("/").map((p) => p.trim()).filter(Boolean);
    const normalizedParts: string[] = [];
    let anyFailed = false;
    for (const part of parts) {
      const r = normalizeSingleValue(fieldName, part);
      normalizedParts.push(r.normalized);
      if (r.failed) anyFailed = true;
    }
    return { normalized: normalizedParts.join("/"), failed: anyFailed };
  }

  return normalizeSingleValue(fieldName, trimmed);
}

function normalizeSingleValue(fieldName: string, value: string): NormalizeResult {
  const map = FIELD_MAPS[fieldName];
  if (map) {
    const mapped = map[value];
    if (mapped) return { normalized: mapped, failed: false };
    // Try case-insensitive match
    const lower = value.toLowerCase();
    for (const [cn, en] of Object.entries(map)) {
      if (cn.toLowerCase() === lower) return { normalized: en, failed: false };
    }
    return { normalized: value, failed: true };
  }
  // No mapping for this field → pass through (not a failure)
  return { normalized: value, failed: false };
}

// ─── Bulk normalize a row ────────────────────────────────────────────────────────

export interface NormalizeRowResult {
  values: Record<string, string>;
  failedFields: string[];
}

export function normalizeRow(
  columns: string[],
  row: Record<string, unknown>,
): NormalizeRowResult {
  const values: Record<string, string> = {};
  const failedFields: string[] = [];
  for (const col of columns) {
    const raw = String(row[col] ?? "").trim();
    const result = normalizeEnumValue(col, raw);
    values[col] = result.normalized;
    if (result.failed) failedFields.push(col);
  }
  return { values, failedFields };
}
