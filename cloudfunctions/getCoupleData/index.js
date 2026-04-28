const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const {
    collection, docId,
    orderBy = 'createTime', order = 'desc',
    limit = 100, skip = 0,
    countOnly = false, todayOnly = false
  } = event

  try {
    const userRes = await db.collection('User').doc(currentOpenid).get()
    const currentUser = userRes.data
    if (!currentUser) return { success: false, message: '用户不存在' }

    const coupleId = currentUser.coupleId
    if (!coupleId) {
      if (countOnly) return { success: true, total: 0 }
      return { success: true, data: [], total: 0 }
    }

    if (docId) {
      const docRes = await db.collection(collection).doc(docId).get()
      const doc = docRes.data
      if (doc.coupleId !== coupleId) return { success: false, message: '无权访问' }
      return { success: true, data: doc }
    }

    let whereCondition = { coupleId }

    if (todayOnly) {
      // 北京时间零点
      const now = new Date()
      const bjOffset = 8 * 60 * 60 * 1000
      const bjNow = new Date(now.getTime() + bjOffset)
      const bjTodayStart = new Date(Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate()) - bjOffset)
      whereCondition.createTime = _.gte(bjTodayStart)
    }

    if (countOnly) {
      const countRes = await db.collection(collection).where(whereCondition).count()
      return { success: true, total: countRes.total }
    }

    const res = await db.collection(collection)
      .where(whereCondition)
      .orderBy(orderBy, order)
      .skip(skip)
      .limit(limit)
      .get()

    return { success: true, data: res.data, total: res.data.length }
  } catch (e) {
    console.error('getCoupleData error', e)
    return { success: false, message: '查询失败', error: e.message }
  }
}
