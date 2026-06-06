export type ModelLabId =
  | "user_churn"
  | "member_lifecycle"
  | "product_pricing"
  | "campaign_roi"
  | "rfm_segmentation"
  | "repurchase_probability"
  | "sales_forecast"
  | "inventory_risk"
  | "coupon_sensitivity"
  | "channel_attribution"
  | "hero_product_potential"
  | "negative_review_risk"
  | "customer_ltv"
  | "price_sensitivity"
  | "category_cross_sell"
  | "basket_affinity"
  | "regional_sales_forecast"
  | "return_risk"
  | "member_upgrade_potential"
  | "marketing_fatigue"
  | "churn_winback_value"
  | "lead_conversion_score"
  | "community_activity_prediction"
  | "benefit_match"
  | "price_band_gap"
  | "competitor_substitution_risk"
  | "sku_keep_or_drop"
  | "content_seeding_conversion";

export const SUPPORTED_MODELS = new Set<ModelLabId>([
  "user_churn",
  "member_lifecycle",
  "product_pricing",
  "campaign_roi",
  "rfm_segmentation",
  "repurchase_probability",
  "sales_forecast",
  "inventory_risk",
  "coupon_sensitivity",
  "channel_attribution",
  "hero_product_potential",
  "negative_review_risk",
  "customer_ltv",
  "price_sensitivity",
  "category_cross_sell",
  "basket_affinity",
  "regional_sales_forecast",
  "return_risk",
  "member_upgrade_potential",
  "marketing_fatigue",
  "churn_winback_value",
  "lead_conversion_score",
  "community_activity_prediction",
  "benefit_match",
  "price_band_gap",
  "competitor_substitution_risk",
  "sku_keep_or_drop",
  "content_seeding_conversion",
]);

const OUTPUT_SCHEMA = (modelId: string) => `

仅返回以下 JSON 格式，不含 markdown 代码块或任何其他文字：
{
  "modelId": "${modelId}",
  "summary": {
    "kpis": [
      { "label": "指标名", "value": "数值字符串", "sub": "补充说明（可选）", "variant": "neutral|success|warning|danger" }
    ],
    "keyInsights": ["洞察1", "洞察2", "洞察3"],
    "recommendations": ["建议1", "建议2", "建议3"]
  },
  "rows": [
    {
      "id": "行唯一标识",
      "label": "显示名称（可选）",
      "score": 0.00,
      "tier": "tier_key",
      "tierLabel": "等级中文标签",
      "tierColor": "red|orange|amber|green|blue|purple|neutral",
      "primaryConclusion": "该条目的核心结论（一句话）",
      "attributes": [{ "key": "属性名", "value": "属性值" }]
    }
  ]
}`;

function churnPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户行为数据，预测用户流失风险。

字段说明：
- user_id：用户唯一标识
- days_since_last_active：距最近活跃天数（越大风险越高）
- login_frequency_30d：近30日登录次数（越少风险越高）
- purchase_count_90d：近90日购买次数（越少风险越高）
- total_spend_90d：近90日消费金额（元，可选）
- is_member：是否会员 0/1（可选）

tier 分级（score = 流失概率 0-1）：
- critical (red)：score > 0.7，极高流失风险，tierLabel = "极高风险"
- high (orange)：score 0.4-0.7，高风险，tierLabel = "高风险"
- medium (amber)：score 0.2-0.4，中风险，tierLabel = "中风险"
- low (green)：score < 0.2，低风险，tierLabel = "低风险"

summary.kpis 输出 4 个：整体风险等级（variant danger/warning/success）、预估整体流失率（如"38.5%"）、极高风险用户数（variant danger）、分析用户总数（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("user_churn")}`;
}

function lifecyclePrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户数据，识别会员生命周期阶段。

字段说明：
- user_id：用户唯一标识
- register_days：注册天数（距今）
- last_purchase_days：距最近购买天数
- purchase_count_total：历史总购买次数
- purchase_freq_30d：近30日购买次数（可选）
- avg_order_value：平均客单价（元，可选）
- membership_level：会员等级（可选）

tier 分级（score = 生命周期健康分 0-1，0=最差，1=最活跃成熟用户）：
- churned (red)：score < 0.1，极长时间未活跃，tierLabel = "已流失"
- at_risk (orange)：score 0.1-0.3，长期未购买但历史有价值，tierLabel = "流失风险"
- declining (amber)：score 0.3-0.5，活跃度下降，tierLabel = "衰退期"
- growing (green)：score 0.5-0.75，近期活跃且频次上升，tierLabel = "成长期"
- mature (green)：score 0.75-0.9，高频高价值稳定用户，tierLabel = "成熟期"
- new_customer (blue)：注册 < 30天，score 0-0.6，tierLabel = "新客"

summary.kpis 输出 4 个：成熟期用户数（variant success）、流失风险+已流失合计（variant danger）、新客数（variant neutral）、成长期用户数（variant success）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("member_lifecycle")}`;
}

function pricingPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条商品定价数据，给出定价建议。

字段说明：
- product_id：商品唯一标识
- product_name：商品名称（可选）
- cost：单位成本（元）
- current_price：当前售价（元）
- competitor_price：竞品参考价（元，可选）
- sales_30d：近30日销量（可选）
- category：品类（可选）

tier 分级（score = 定价合理度 0-1，0=严重偏差，1=完全合理）：
- severely_overpriced (red)：毛利 > 80% 且显著高于竞品，score < 0.2，tierLabel = "严重偏高"
- overpriced (amber)：毛利过高或明显高于竞品，score 0.2-0.45，tierLabel = "定价偏高"
- optimal (green)：毛利合理且竞争力强，score 0.45-0.85，tierLabel = "定价合理"
- underpriced (blue)：毛利率 < 15% 或显著低于竞品，score < 0.4，tierLabel = "定价偏低"

每个商品在 attributes 中包含：当前毛利率、建议价格区间（如有竞品价）、主要问题

summary.kpis 输出 4 个：定价偏低商品数（variant warning）、定价合理数（variant success）、定价偏高数（variant danger）、平均毛利率（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("product_pricing")}`;
}

function campaignPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 个活动方案，测算预期效益与 ROI。

字段说明：
- activity_name：活动名称
- activity_type：活动类型（满减/买赠/折扣/积分等）
- target_users：目标触达用户数
- hist_participation_rate：历史参与率（0-1）
- benefit_per_user：每用户利益点金额（元）
- expected_arpu：预期参与用户人均贡献收入（元，可选）
- budget_cap：活动预算上限（元，可选）

tier 分级（score = 活动效益综合评分 0-1）：
- high_value (green)：ROI ≥ 2.0 或预期收益显著，score > 0.7，tierLabel = "高价值"
- moderate (blue)：ROI 1.0-2.0，score 0.4-0.7，tierLabel = "中等价值"
- marginal (amber)：ROI 0.5-1.0，score 0.2-0.4，tierLabel = "边际价值"
- low_value (red)：ROI < 0.5 或成本超预算，score < 0.2，tierLabel = "建议调整"

每个活动在 attributes 中包含：预估参与人数、预估总成本（元）、预估 ROI（若有 expected_arpu）、盈亏平衡参与率

summary.kpis 输出 4 个：高价值活动数（variant success）、平均预估参与率（variant neutral）、总预估利益发放金额（variant warning）、建议调整活动数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("campaign_roi")}`;
}

function rfmPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条会员交易汇总数据，进行 RFM 会员分层。

字段说明：
- user_id：用户唯一标识
- recency_days：距最近一次购买天数（越小越好）
- frequency_12m：近12个月购买次数
- monetary_12m：近12个月消费金额（元）
- avg_order_value：平均客单价（元，可选）
- membership_level：会员等级（可选）

分层规则（score = 会员价值综合分 0-1）：
- champions (purple)：高频、高金额、近期购买，score > 0.8，tierLabel = "冠军客户"
- loyal (green)：稳定复购且价值较高，score 0.6-0.8，tierLabel = "忠诚客户"
- potential (blue)：近期购买但频次/金额仍有提升空间，score 0.4-0.6，tierLabel = "潜力客户"
- hibernating (amber)：历史有价值但近期沉睡，score 0.2-0.4，tierLabel = "沉睡客户"
- lost (red)：长时间未购买且价值低，score < 0.2，tierLabel = "流失客户"

summary.kpis 输出 4 个：高价值客户数（variant success）、沉睡/流失客户数（variant danger）、平均消费金额（variant neutral）、可提升客户数（variant warning）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("rfm_segmentation")}`;
}

function repurchasePrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户订单行为数据，预测未来30天复购概率。

字段说明：
- user_id：用户唯一标识
- last_purchase_days：距最近购买天数
- purchase_count_180d：近180日购买次数
- avg_order_value：平均客单价（元）
- category_count：购买过的品类数（可选）
- coupon_used_rate：优惠券使用率 0-1（可选）
- last_category：最近购买品类（可选）

分层规则（score = 未来30天复购概率 0-1）：
- likely (green)：score > 0.7，高概率复购，tierLabel = "高复购概率"
- nurture (blue)：score 0.4-0.7，需要轻触达促进，tierLabel = "可培育复购"
- hesitant (amber)：score 0.2-0.4，复购犹豫，tierLabel = "复购犹豫"
- unlikely (red)：score < 0.2，短期复购概率低，tierLabel = "低复购概率"

summary.kpis 输出 4 个：高复购概率用户数（variant success）、平均复购概率（variant neutral）、需券激励用户数（variant warning）、低复购用户数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("repurchase_probability")}`;
}

function salesForecastPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条商品销售数据，预测未来30天销量并给出备货建议。

字段说明：
- product_id：商品唯一标识
- product_name：商品名称（可选）
- sales_7d：近7日销量
- sales_30d：近30日销量
- stock_on_hand：当前库存
- price：当前售价（元，可选）
- promotion_flag：是否有促销 0/1（可选）
- category：品类（可选）

分层规则（score = 未来销量增长/销售动能 0-1）：
- surge (green)：score > 0.75，销量高速增长，tierLabel = "高增长"
- stable (blue)：score 0.45-0.75，销量稳定，tierLabel = "稳定销售"
- slow (amber)：score 0.2-0.45，销量放缓，tierLabel = "增长放缓"
- declining (red)：score < 0.2，销量下滑，tierLabel = "销量下滑"

每个商品 attributes 中包含：预估30日销量、建议备货量、趋势判断
summary.kpis 输出 4 个：高增长商品数（variant success）、预估总销量（variant neutral）、需补货商品数（variant warning）、下滑商品数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("sales_forecast")}`;
}

function inventoryRiskPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条商品库存数据，识别缺货、滞销与周转风险。

字段说明：
- product_id：商品唯一标识
- product_name：商品名称（可选）
- stock_on_hand：当前库存
- sales_30d：近30日销量
- lead_time_days：补货提前期天数
- gross_margin_rate：毛利率 0-1（可选）
- shelf_life_days：剩余保质期/可售周期天数（可选）
- category：品类（可选）

分层规则（score = 库存风险 0-1）：
- stockout (red)：高销量低库存，即将缺货，score > 0.75，tierLabel = "缺货风险"
- overstock (orange)：低销量高库存或临期，score 0.55-0.75，tierLabel = "滞销积压"
- turnover_warning (amber)：周转偏慢或安全库存不足，score 0.3-0.55，tierLabel = "周转预警"
- healthy (green)：库存健康，score < 0.3，tierLabel = "库存健康"

每个商品 attributes 中包含：库存可售天数、补货/清仓建议、风险原因
summary.kpis 输出 4 个：缺货风险商品数（variant danger）、滞销积压商品数（variant warning）、库存健康商品数（variant success）、平均可售天数（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("inventory_risk")}`;
}

function couponSensitivityPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户促销响应数据，预测优惠券敏感度与最优券策略。

字段说明：
- user_id：用户唯一标识
- orders_180d：近180日订单数
- coupon_orders_180d：近180日使用优惠券订单数
- avg_discount_rate：历史平均折扣率 0-1（可选）
- avg_order_value：平均客单价（元）
- last_purchase_days：距最近购买天数
- gross_margin_rate：毛利率 0-1（可选）

分层规则（score = 优惠券敏感度 0-1）：
- high_sensitive (orange)：score > 0.75，高度依赖优惠，tierLabel = "高券敏感"
- medium_sensitive (amber)：score 0.45-0.75，适度优惠可激活，tierLabel = "中券敏感"
- low_sensitive (green)：score 0.2-0.45，不宜过度让利，tierLabel = "低券敏感"
- no_coupon_needed (blue)：score < 0.2，无券也可能转化，tierLabel = "无需强券"

每个用户 attributes 中包含：建议券面额、最小激励力度、利润风险
summary.kpis 输出 4 个：高券敏感用户数（variant warning）、无需强券用户数（variant success）、平均建议券力度（variant neutral）、利润风险用户数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("coupon_sensitivity")}`;
}

function channelAttributionPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条渠道投放数据，评估渠道贡献与预算重分配机会。

字段说明：
- channel：渠道名称
- impressions：曝光量
- clicks：点击量
- conversions：转化数
- spend：投放花费（元）
- revenue：转化收入（元）
- new_customers：新客数（可选）
- assisted_conversions：助攻转化数（可选）

分层规则（score = 渠道综合贡献 0-1）：
- scale_up (green)：ROI 高且转化量可观，score > 0.75，tierLabel = "建议加码"
- maintain (blue)：表现稳定，score 0.5-0.75，tierLabel = "维持投放"
- optimize (amber)：成本偏高或转化偏弱，score 0.25-0.5，tierLabel = "需要优化"
- cut_back (red)：ROI 低且消耗高，score < 0.25，tierLabel = "建议缩减"

每个渠道 attributes 中包含：CTR、CVR、CPA、ROI、预算建议
summary.kpis 输出 4 个：建议加码渠道数（variant success）、总 ROI（variant neutral）、需优化渠道数（variant warning）、建议缩减渠道数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("channel_attribution")}`;
}

function heroProductPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条商品经营数据，评估爆品潜力与投放优先级。

字段说明：
- product_id：商品唯一标识
- product_name：商品名称（可选）
- sales_30d：近30日销量
- revenue_30d：近30日销售额（元）
- growth_rate_30d：近30日销量/销售额增长率 0-1或百分比
- conversion_rate：转化率 0-1（可选）
- gross_margin_rate：毛利率 0-1（可选）
- review_score：评价分 0-5（可选）
- category：品类（可选）

分层规则（score = 爆品潜力 0-1）：
- hero_candidate (purple)：score > 0.8，高增长高转化高毛利，tierLabel = "爆品候选"
- growth_candidate (green)：score 0.6-0.8，具备放量机会，tierLabel = "增长潜力"
- niche_stable (blue)：score 0.35-0.6，小众稳定，tierLabel = "稳定长尾"
- weak_candidate (amber)：score < 0.35，增长或转化不足，tierLabel = "暂缓投入"

每个商品 attributes 中包含：投放优先级、核心拉动因子、主要短板
summary.kpis 输出 4 个：爆品候选数（variant success）、增长潜力商品数（variant success）、建议暂缓数（variant warning）、平均潜力分（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("hero_product_potential")}`;
}

function negativeReviewPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条订单/商品体验数据，预测差评风险并定位风险原因。

字段说明：
- order_id：订单唯一标识
- product_id：商品ID（可选）
- product_name：商品名称（可选）
- delivery_delay_days：配送延迟天数
- refund_flag：是否退款/售后 0/1
- customer_service_contacts：客服沟通次数
- product_quality_score：商品质量评分 0-5（可选）
- logistics_score：物流评分 0-5（可选）
- order_amount：订单金额（元，可选）

分层规则（score = 差评风险 0-1）：
- critical (red)：score > 0.75，极高差评风险，tierLabel = "极高差评风险"
- high (orange)：score 0.5-0.75，高风险，tierLabel = "高差评风险"
- medium (amber)：score 0.25-0.5，中风险，tierLabel = "中差评风险"
- low (green)：score < 0.25，低风险，tierLabel = "低差评风险"

每条记录 attributes 中包含：主要风险源、建议补救动作、优先级
summary.kpis 输出 4 个：高风险订单数（variant danger）、平均差评风险（variant neutral）、需客服介入数（variant warning）、低风险订单数（variant success）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("negative_review_risk")}`;
}

function customerLtvPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条客户价值数据，预测未来12个月客户生命周期价值 LTV。

字段说明：
- user_id：用户唯一标识
- total_spend_12m：近12个月消费金额（元）
- purchase_count_12m：近12个月购买次数
- avg_order_value：平均客单价（元）
- last_purchase_days：距最近购买天数
- gross_margin_rate：毛利率 0-1（可选）
- membership_level：会员等级（可选）

分层规则（score = 未来价值潜力 0-1）：
- premium (purple)：score > 0.8，高未来价值，tierLabel = "高价值客户"
- growth (green)：score 0.6-0.8，价值成长中，tierLabel = "成长价值"
- stable (blue)：score 0.35-0.6，稳定贡献，tierLabel = "稳定价值"
- low_value (amber)：score 0.15-0.35，价值偏低，tierLabel = "低价值"
- at_risk (red)：score < 0.15，价值衰退，tierLabel = "价值衰退"

每个用户 attributes 中包含：预估12月LTV、价值驱动因素、运营动作
summary.kpis 输出 4 个：高价值客户数（variant success）、预估总LTV（variant neutral）、价值衰退客户数（variant danger）、成长价值客户数（variant success）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("customer_ltv")}`;
}

function priceSensitivityPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户价格行为数据，判断价格敏感度与可接受价格带。

字段说明：
- user_id：用户唯一标识
- avg_order_value：平均客单价（元）
- discount_order_rate：折扣订单占比 0-1
- full_price_order_rate：原价订单占比 0-1
- category_avg_price：常购品类均价（元，可选）
- coupon_used_rate：优惠券使用率 0-1（可选）
- income_level：收入/消费力等级（可选）

分层规则（score = 价格敏感度 0-1）：
- very_sensitive (red)：score > 0.75，价格高度敏感，tierLabel = "高度敏感"
- sensitive (orange)：score 0.5-0.75，较敏感，tierLabel = "价格敏感"
- balanced (blue)：score 0.25-0.5，价格与价值均衡，tierLabel = "价值均衡"
- insensitive (green)：score < 0.25，低敏感，tierLabel = "低敏感"

每个用户 attributes 中包含：可接受价格带、折扣依赖、推荐定价策略
summary.kpis 输出 4 个：高敏感用户数（variant danger）、低敏感用户数（variant success）、平均敏感度（variant neutral）、可溢价用户数（variant success）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("price_sensitivity")}`;
}

function categoryCrossSellPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户品类购买数据，预测跨品类购买机会。

字段说明：
- user_id：用户唯一标识
- purchased_categories：已购品类列表或文本
- primary_category：主购品类
- purchase_count_12m：近12个月购买次数
- total_spend_12m：近12个月消费金额（元）
- last_purchase_days：距最近购买天数
- browsing_categories：浏览/加购品类列表（可选）

分层规则（score = 跨品类购买潜力 0-1）：
- high_cross_sell (green)：score > 0.75，高跨购潜力，tierLabel = "高跨购机会"
- moderate (blue)：score 0.45-0.75，中等机会，tierLabel = "可推荐跨购"
- narrow (amber)：score 0.2-0.45，品类偏窄，tierLabel = "需培育"
- low (red)：score < 0.2，跨购机会低，tierLabel = "低跨购机会"

每个用户 attributes 中包含：推荐品类、触发理由、推荐场景
summary.kpis 输出 4 个：高跨购机会用户数（variant success）、推荐品类覆盖数（variant neutral）、需培育用户数（variant warning）、低机会用户数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("category_cross_sell")}`;
}

function basketAffinityPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条购物篮/订单商品数据，识别商品组合关联和套装机会。

字段说明：
- basket_id：购物篮或订单ID
- product_ids：购物篮商品ID列表或文本
- product_names：商品名称列表（可选）
- category_names：品类列表（可选）
- basket_amount：购物篮金额（元）
- item_count：商品件数
- customer_segment：客户分层（可选）

分层规则（score = 组合销售机会 0-1）：
- bundle_ready (green)：score > 0.75，强组合机会，tierLabel = "强套装机会"
- affinity (blue)：score 0.45-0.75，存在关联，tierLabel = "关联推荐"
- weak (amber)：score 0.2-0.45，弱关联，tierLabel = "弱关联"
- no_signal (neutral)：score < 0.2，关联信号弱，tierLabel = "暂无信号"

每个购物篮 attributes 中包含：建议组合、加购触发点、客单价提升空间
summary.kpis 输出 4 个：强套装机会数（variant success）、平均购物篮金额（variant neutral）、可加购机会数（variant warning）、弱信号数量（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("basket_affinity")}`;
}

function regionalSalesPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条门店/区域销售数据，预测未来30天销售趋势。

字段说明：
- region_id：区域或门店ID
- region_name：区域或门店名称（可选）
- sales_7d：近7日销售额（元）
- sales_30d：近30日销售额（元）
- footfall_30d：近30日客流（可选）
- conversion_rate：转化率 0-1（可选）
- avg_order_value：客单价（元，可选）
- promotion_days_30d：近30日促销天数（可选）

分层规则（score = 区域销售增长动能 0-1）：
- high_growth (green)：score > 0.75，高增长，tierLabel = "高增长区域"
- stable (blue)：score 0.45-0.75，稳定，tierLabel = "稳定区域"
- pressure (amber)：score 0.2-0.45，增长承压，tierLabel = "增长承压"
- declining (red)：score < 0.2，下滑，tierLabel = "销售下滑"

每个区域 attributes 中包含：预估30日销售额、增长驱动/拖累因素、运营建议
summary.kpis 输出 4 个：高增长区域数（variant success）、预估总销售额（variant neutral）、承压区域数（variant warning）、下滑区域数（variant danger）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("regional_sales_forecast")}`;
}

function returnRiskPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条订单/商品数据，预测退货风险。

字段说明：
- order_id：订单唯一标识
- product_id：商品ID
- product_name：商品名称（可选）
- category：品类（可选）
- order_amount：订单金额（元）
- discount_rate：折扣率 0-1（可选）
- previous_return_rate：用户历史退货率 0-1（可选）
- size_issue_flag：尺码/规格风险 0/1（可选）
- delivery_delay_days：配送延迟天数（可选）

分层规则（score = 退货风险 0-1）：
- critical (red)：score > 0.75，极高退货风险，tierLabel = "极高退货风险"
- high (orange)：score 0.5-0.75，高风险，tierLabel = "高退货风险"
- medium (amber)：score 0.25-0.5，中风险，tierLabel = "中退货风险"
- low (green)：score < 0.25，低风险，tierLabel = "低退货风险"

每条记录 attributes 中包含：风险原因、预防动作、售后优先级
summary.kpis 输出 4 个：高风险订单数（variant danger）、平均退货风险（variant neutral）、需售后干预数（variant warning）、低风险订单数（variant success）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("return_risk")}`;
}

function memberUpgradePrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条会员数据，预测会员升级潜力。

字段说明：
- user_id：用户唯一标识
- current_level：当前会员等级
- points_balance：当前积分
- spend_to_next_level：距离下一等级还需消费金额（元）
- purchase_count_90d：近90日购买次数
- total_spend_90d：近90日消费金额（元）
- last_purchase_days：距最近购买天数

分层规则（score = 升级潜力 0-1）：
- ready (green)：score > 0.8，临近升级且活跃，tierLabel = "即将升级"
- pushable (blue)：score 0.55-0.8，适合激励升级，tierLabel = "可推动升级"
- nurture (amber)：score 0.3-0.55，需要培育，tierLabel = "升级培育"
- low (neutral)：score < 0.3，短期升级可能低，tierLabel = "低升级可能"

每个会员 attributes 中包含：升级缺口、推荐激励、预计升级周期
summary.kpis 输出 4 个：即将升级会员数（variant success）、可推动升级数（variant success）、需培育会员数（variant warning）、平均升级潜力（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("member_upgrade_potential")}`;
}

function marketingFatiguePrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户触达数据，预测营销触达疲劳度和退订/反感风险。

字段说明：
- user_id：用户唯一标识
- messages_30d：近30日触达次数
- opens_30d：近30日打开次数
- clicks_30d：近30日点击次数
- conversions_30d：近30日转化次数
- unsubscribe_flag：是否已退订/拒收 0/1（可选）
- last_message_days：距最近触达天数（可选）
- complaints_30d：近30日投诉/负反馈次数（可选）

分层规则（score = 触达疲劳风险 0-1）：
- exhausted (red)：score > 0.75，高疲劳/反感，tierLabel = "高疲劳风险"
- saturated (orange)：score 0.5-0.75，触达饱和，tierLabel = "触达饱和"
- balanced (blue)：score 0.25-0.5，频率可控，tierLabel = "频率适中"
- under_touched (green)：score < 0.25，仍可触达，tierLabel = "可增加触达"

每个用户 attributes 中包含：建议触达频率、降噪动作、风险原因
summary.kpis 输出 4 个：高疲劳用户数（variant danger）、触达饱和用户数（variant warning）、可增加触达用户数（variant success）、平均疲劳度（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("marketing_fatigue")}`;
}

function churnWinbackPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条流失/沉睡用户数据，评估挽回价值与优先级。

字段说明：
- user_id：用户唯一标识
- last_purchase_days：距最近购买天数
- historical_ltv：历史累计消费金额（元）
- purchase_count_total：历史总购买次数
- gross_margin_rate：毛利率 0-1（可选）
- last_category：最后购买品类（可选）
- previous_winback_response：历史召回响应 0/1（可选）

分层规则（score = 挽回价值 0-1）：
- priority (purple)：score > 0.8，高价值且可挽回，tierLabel = "优先挽回"
- worth_trying (green)：score 0.55-0.8，值得尝试，tierLabel = "值得挽回"
- low_margin (amber)：score 0.25-0.55，价值有限，tierLabel = "谨慎挽回"
- do_not_disturb (neutral)：score < 0.25，短期不建议触达，tierLabel = "暂不挽回"

每个用户 attributes 中包含：预估挽回价值、建议权益、触达优先级
summary.kpis 输出 4 个：优先挽回用户数（variant success）、预估可挽回价值（variant neutral）、谨慎挽回数（variant warning）、暂不挽回数（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("churn_winback_value")}`;
}

function leadConversionPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条潜客线索数据，预测转化评分与跟进优先级。

字段说明：
- lead_id：线索唯一标识
- source_channel：线索来源渠道
- visits_30d：近30日访问次数
- product_views_30d：近30日商品浏览次数
- add_to_cart_count：加购次数
- inquiry_count：咨询次数
- coupon_claimed_flag：是否领券 0/1（可选）
- days_since_first_touch：首次触达距今天数（可选）

分层规则（score = 转化概率 0-1）：
- hot (red)：score > 0.75，高意向，tierLabel = "高热潜客"
- warm (orange)：score 0.5-0.75，有明确兴趣，tierLabel = "温热潜客"
- nurture (blue)：score 0.25-0.5，需要培育，tierLabel = "培育潜客"
- cold (neutral)：score < 0.25，低意向，tierLabel = "冷潜客"

每条线索 attributes 中包含：推荐跟进动作、转化触发点、优先级
summary.kpis 输出 4 个：高热潜客数（variant success）、平均转化评分（variant neutral）、需培育线索数（variant warning）、冷潜客数（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("lead_conversion_score")}`;
}

function communityActivityPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条私域社群用户数据，预测未来7天活跃度。

字段说明：
- user_id：用户唯一标识
- messages_30d：近30日发言次数
- reactions_30d：近30日点赞/互动次数
- checkins_30d：近30日签到次数
- purchases_90d：近90日购买次数
- days_since_last_active：距最近社群活跃天数
- group_tenure_days：入群天数（可选）

分层规则（score = 未来活跃概率 0-1）：
- core_active (green)：score > 0.75，核心活跃，tierLabel = "核心活跃"
- active (blue)：score 0.5-0.75，稳定活跃，tierLabel = "稳定活跃"
- slipping (amber)：score 0.25-0.5，活跃下滑，tierLabel = "活跃下滑"
- silent (red)：score < 0.25，沉默风险，tierLabel = "沉默风险"

每个用户 attributes 中包含：活跃驱动因素、社群运营动作、内容偏好建议
summary.kpis 输出 4 个：核心活跃用户数（variant success）、沉默风险用户数（variant danger）、活跃下滑用户数（variant warning）、平均活跃概率（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("community_activity_prediction")}`;
}

function benefitMatchPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条会员偏好与行为数据，匹配最适合的会员权益。

字段说明：
- user_id：用户唯一标识
- membership_level：会员等级
- purchase_categories：购买品类列表或文本
- avg_order_value：平均客单价（元）
- coupon_used_rate：优惠券使用率 0-1
- service_usage_count：服务权益使用次数（可选）
- points_redeemed_12m：近12月积分兑换次数（可选）

分层规则（score = 权益匹配强度 0-1）：
- strong_match (green)：score > 0.75，权益高度匹配，tierLabel = "强匹配"
- good_match (blue)：score 0.5-0.75，匹配良好，tierLabel = "良好匹配"
- test_needed (amber)：score 0.25-0.5，需要测试，tierLabel = "需测试"
- weak_match (neutral)：score < 0.25，匹配弱，tierLabel = "弱匹配"

每个会员 attributes 中包含：推荐权益、匹配理由、预期效果
summary.kpis 输出 4 个：强匹配会员数（variant success）、需测试会员数（variant warning）、权益覆盖类型数（variant neutral）、弱匹配会员数（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("benefit_match")}`;
}

function priceBandGapPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条品类价格带数据，识别价格带空位和增长机会。

字段说明：
- category：品类
- price_band：价格带名称或区间
- sales_30d：近30日销量
- revenue_30d：近30日销售额（元）
- competitor_sku_count：竞品 SKU 数
- own_sku_count：自有 SKU 数
- conversion_rate：转化率 0-1（可选）
- gross_margin_rate：毛利率 0-1（可选）

分层规则（score = 价格带机会 0-1）：
- white_space (purple)：score > 0.8，明显空位机会，tierLabel = "价格空位"
- growth_gap (green)：score 0.55-0.8，增长机会，tierLabel = "增长缺口"
- crowded (amber)：score 0.25-0.55，竞争拥挤，tierLabel = "竞争拥挤"
- unattractive (neutral)：score < 0.25，吸引力低，tierLabel = "机会较低"

每个价格带 attributes 中包含：机会原因、建议商品策略、竞争强度
summary.kpis 输出 4 个：价格空位数（variant success）、增长缺口数（variant success）、拥挤价格带数（variant warning）、平均机会分（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("price_band_gap")}`;
}

function competitorSubstitutionPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条用户/商品竞品行为数据，预测竞品替代风险。

字段说明：
- user_id：用户唯一标识
- own_brand_purchases_90d：近90日自品牌购买次数
- competitor_views_30d：近30日竞品浏览次数
- competitor_purchases_90d：近90日竞品购买次数（可选）
- price_gap_rate：自品牌相对竞品价差率（可选）
- satisfaction_score：满意度评分 0-5（可选）
- category：品类（可选）

分层规则（score = 竞品替代风险 0-1）：
- critical (red)：score > 0.75，高替代风险，tierLabel = "高替代风险"
- elevated (orange)：score 0.5-0.75，风险上升，tierLabel = "风险上升"
- watch (amber)：score 0.25-0.5，需要观察，tierLabel = "观察名单"
- loyal (green)：score < 0.25，替代风险低，tierLabel = "相对稳固"

每个用户 attributes 中包含：替代原因、竞品承接方向、保留策略
summary.kpis 输出 4 个：高替代风险用户数（variant danger）、风险上升用户数（variant warning）、相对稳固用户数（variant success）、平均替代风险（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("competitor_substitution_risk")}`;
}

function skuKeepOrDropPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条 SKU 经营数据，给出保留、优化或下架决策建议。

字段说明：
- sku_id：SKU 唯一标识
- sku_name：SKU 名称（可选）
- sales_90d：近90日销量
- revenue_90d：近90日销售额（元）
- gross_margin_rate：毛利率 0-1
- stock_on_hand：当前库存
- return_rate：退货率 0-1（可选）
- review_score：评价分 0-5（可选）
- category：品类（可选）

分层规则（score = 保留价值 0-1）：
- keep (green)：score > 0.75，建议保留加码，tierLabel = "保留加码"
- optimize (blue)：score 0.5-0.75，保留但需优化，tierLabel = "优化保留"
- clear_stock (amber)：score 0.25-0.5，先清库存，tierLabel = "清库存观察"
- drop (red)：score < 0.25，建议下架，tierLabel = "建议下架"

每个 SKU attributes 中包含：决策理由、下一步动作、库存处理建议
summary.kpis 输出 4 个：保留加码SKU数（variant success）、优化保留SKU数（variant warning）、建议下架SKU数（variant danger）、需清库存SKU数（variant warning）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("sku_keep_or_drop")}`;
}

function contentSeedingPrompt(rows: Record<string, unknown>[]): string {
  return `分析以下 ${rows.length} 条内容种草数据，预测内容带来的转化潜力。

字段说明：
- content_id：内容唯一标识
- platform：平台名称
- impressions：曝光量
- engagements：互动量
- saves_or_favorites：收藏/保存数
- clicks：商品点击数
- conversions：转化数（可选）
- product_price：关联商品价格（元，可选）
- audience_match_score：人群匹配分 0-1（可选）

分层规则（score = 种草转化潜力 0-1）：
- convert_now (green)：score > 0.75，高转化潜力，tierLabel = "高转化潜力"
- nurture (blue)：score 0.5-0.75，适合二次追投，tierLabel = "可追投"
- awareness (amber)：score 0.25-0.5，偏曝光种草，tierLabel = "种草蓄水"
- weak (neutral)：score < 0.25，转化信号弱，tierLabel = "信号较弱"

每条内容 attributes 中包含：转化驱动因素、追投建议、素材优化点
summary.kpis 输出 4 个：高转化内容数（variant success）、可追投内容数（variant success）、种草蓄水内容数（variant warning）、平均潜力分（variant neutral）

数据：${JSON.stringify(rows)}
${OUTPUT_SCHEMA("content_seeding_conversion")}`;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function buildModelLabPrompt(modelId: ModelLabId, rows: Record<string, unknown>[], workspaceRoot?: string): string {
  if (workspaceRoot) {
    try {
      const p = join(workspaceRoot, ".pi", "models", `${modelId}.json`);
      const content = readFileSync(p, "utf-8");
      const def = JSON.parse(content);
      if (def.promptTemplate) {
        let prompt = def.promptTemplate;
        prompt = prompt.replace("{{rowsCount}}", String(rows.length));
        prompt = prompt.replace("{{rowsJson}}", JSON.stringify(rows, null, 2));
        prompt = prompt.replace("{{outputSchema}}", OUTPUT_SCHEMA(modelId));
        return prompt;
      }
    } catch {
      // Ignore and fallback to hardcoded
    }
  }

  switch (modelId) {
    case "user_churn": return churnPrompt(rows);
    case "member_lifecycle": return lifecyclePrompt(rows);
    case "product_pricing": return pricingPrompt(rows);
    case "campaign_roi": return campaignPrompt(rows);
    case "rfm_segmentation": return rfmPrompt(rows);
    case "repurchase_probability": return repurchasePrompt(rows);
    case "sales_forecast": return salesForecastPrompt(rows);
    case "inventory_risk": return inventoryRiskPrompt(rows);
    case "coupon_sensitivity": return couponSensitivityPrompt(rows);
    case "channel_attribution": return channelAttributionPrompt(rows);
    case "hero_product_potential": return heroProductPrompt(rows);
    case "negative_review_risk": return negativeReviewPrompt(rows);
    case "customer_ltv": return customerLtvPrompt(rows);
    case "price_sensitivity": return priceSensitivityPrompt(rows);
    case "category_cross_sell": return categoryCrossSellPrompt(rows);
    case "basket_affinity": return basketAffinityPrompt(rows);
    case "regional_sales_forecast": return regionalSalesPrompt(rows);
    case "return_risk": return returnRiskPrompt(rows);
    case "member_upgrade_potential": return memberUpgradePrompt(rows);
    case "marketing_fatigue": return marketingFatiguePrompt(rows);
    case "churn_winback_value": return churnWinbackPrompt(rows);
    case "lead_conversion_score": return leadConversionPrompt(rows);
    case "community_activity_prediction": return communityActivityPrompt(rows);
    case "benefit_match": return benefitMatchPrompt(rows);
    case "price_band_gap": return priceBandGapPrompt(rows);
    case "competitor_substitution_risk": return competitorSubstitutionPrompt(rows);
    case "sku_keep_or_drop": return skuKeepOrDropPrompt(rows);
    case "content_seeding_conversion": return contentSeedingPrompt(rows);
  }
  const exhaustive: never = modelId;
  throw new Error(`unsupported model lab id: ${exhaustive}`);
}
