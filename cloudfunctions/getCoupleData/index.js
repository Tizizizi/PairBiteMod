const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const {
    collection,
    docId,
    orderBy = 'createTime',
    order = 'desc',
    limit = 100,
    skip = 0,
    countOnly = false,
    todayOnly = false
  } = event

  try {
    // 获取当前用户信息
    const userRes = await db.collection('User').doc(currentOpenid).get()
    const currentUser = userRes.data

    if (!currentUser) {
      return { success: false, message: '用户不存在' }
    }

    // 获取当前 coupleId
    const coupleId = currentUser.coupleId

    // 如果没有 coupleId（未绑定），返回空数据
    if (!coupleId) {
      if (countOnly) {
        return { success: true, total: 0 }
      }
      return { success: true, data: [], total: 0 }
    }

    // 如果查询单个文档
    if (docId) {
      const docRes = await db.collection(collection).doc(docId).get()
      const doc = docRes.data
      // 验证是否属于当前 coupleId
      if (doc.coupleId !== coupleId) {
        return { success: false, message: '无权访问' }
      }
      return { success: true, data: doc }
    }

    // 构建 where 条件：按 coupleId 查询
    let whereCondition = { coupleId }

    // 如果只查今天的数据
    if (todayOnly) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      whereCondition.createTime = _.gte(today)
    }

    // 如果只需要统计数量
    if (countOnly) {
      const countRes = await db.collection(collection)
        .where(whereCondition)
        .count()
      return {
        success: true,
        total: countRes.total
      }
    }

    // 查询数据
    const res = await db.collection(collection)
      .where(whereCondition)
      .orderBy(orderBy, order)
      .skip(skip)
      .limit(limit)
      .get()

    return {
      success: true,
      data: res.data,
      total: res.data.length
    }
  } catch (e) {
    console.error('getCoupleData error', e)
    return { success: false, message: '查询失败', error: e.message }
  }
}
