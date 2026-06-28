# 零售业务对象本体 (Retail Business Objects)

这是零售 Harness 包的核心语义结构，第一版包含以下核心对象及关系。

## 核心对象 (Objects)
1. **Customer (消费者/会员)**：产生购买行为的主体。
2. **Order (订单)**：单次购买行为的记录。
3. **OrderItem (订单明细)**：订单中具体包含的商品及数量金额。
4. **Product (商品)**：售卖的实体，通常精确到 SKU 级别。
5. **Category (品类)**：商品的逻辑分组。
6. **Store (门店)** / **Channel (渠道)**：销售发生的场所或链路。

## 核心关系 (Relationships)
- `Customer` 产生 (`places`) `Order`
- `Order` 包含 (`contains`) `Product` (通过 `OrderItem`)
- `Product` 属于 (`belongs_to`) `Category`
- `Order` 发生于 (`occurs_in`) `Channel` / `Store`

Agent 在进行数据查询、聚合和文字表述时，必须严格遵守以上语义关系，不混用对象层级（例如：不应说“商品产生了复购”，应说“消费者对特定商品产生了复购”）。
