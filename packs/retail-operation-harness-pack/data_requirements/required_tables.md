# 零售分析最小必需表结构

为了运行零售分析，系统需要以下最小数据集：

## 必需表 1：订单表 (`orders`)
| 字段名 | 含义 | 必填 | 备注 |
|---|---|---|---|
| `order_id` | 订单 ID | 是 | 唯一标识 |
| `customer_id` | 客户 ID | 是 | 用于复购与客群分析 |
| `order_time` | 下单时间 | 是 | 需包含日期和时间 |
| `store_id` | 门店 ID | 否 | 用于门店分析 |
| `channel` | 渠道 | 否 | 如线上、线下、私域 |
| `order_amount` | 订单金额 | 是 | 标价金额 |
| `discount_amount` | 优惠金额 | 是 | 促销折扣 |
| `payment_amount` | 实付金额 | 是 | 净销售额计算基础 |
| `order_status` | 订单状态 | 是 | 需区分已完成、已取消、退款等 |

## 必需表 2：订单明细表 (`order_items`)
| 字段名 | 含义 | 必填 | 备注 |
|---|---|---|---|
| `order_id` | 订单 ID | 是 | 关联 orders 表 |
| `sku_id` | 商品 ID | 是 | 关联 products 表 |
| `quantity` | 购买数量 | 是 | 用于连带、销量分析 |
| `item_amount` | 商品金额 | 是 | 分摊前金额 |
| `item_discount` | 商品优惠 | 是 | 分摊优惠 |
| `item_payment` | 商品实付 | 是 | 分摊后实付 |

## 必需表 3：商品表 (`products`)
| 字段名 | 含义 | 必填 | 备注 |
|---|---|---|---|
| `sku_id` | 商品 ID | 是 | 唯一标识 |
| `sku_name` | 商品名称 | 是 | 可读名称 |
| `category_l1` | 一级品类 | 是 | 品类分析基准 |
| `category_l2` | 二级品类 | 否 | 细分品类 |
| `brand` | 品牌 | 否 | - |
| `price` | 标价 | 是 | - |
| `cost` | 成本 | 否 | 用于毛利计算 |

## 必需表 4：客户表 (`customers`)
| 字段名 | 含义 | 必填 | 备注 |
|---|---|---|---|
| `customer_id` | 客户 ID | 是 | 唯一标识 |
| `register_time` | 注册时间 | 是 | 判断新老客依据 |
| `gender` | 性别 | 否 | - |
| `age_group` | 年龄段 | 否 | - |
| `member_level` | 会员等级 | 否 | 价值分层 |
