const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const { collection, docId, action, data } = event

  try {
    // 获取当前用户信息
    const userRes = await db.collection('User').doc(currentOpenid).get()
    const currentUser = userRes.data

    if (!currentUser) {
      return { success: false, message: '用户不存在' }
    }

    // 获取当前 coupleId
    const coupleId = currentUser.coupleId

    // 验证文档是否属于当前 coupleId
    if (docId) {
      const docRes = await db.collection(collection).doc(docId).get()
      const doc = docRes.data
      if (doc.coupleId !== coupleId) {
        return { success: false, message: '无权操作' }
      }
    }

    // 执行操作
    let result
    switch (action) {
      case 'update':
        result = await db.collection(collection).doc(docId).update({ data })
        return { success: true, updated: result.stats.updated }

      case 'remove':
        result = await db.collection(collection).doc(docId).remove()
        return { success: true, removed: result.stats.removed }

      case 'inc':
        // 特殊操作：自增字段
        const incData = {}
        for (const key in data) {
          incData[key] = _.inc(data[key])
        }
        result = await db.collection(collection).doc(docId).update({ data: incData })
        return { success: true, updated: result.stats.updated }

      default:
        return { success: false, message: '不支持的操作' }
    }
  } catch (e) {
    console.error('updateCoupleData error', e)
    return { success: false, message: '操作失败', error: e.message }
  }
}
