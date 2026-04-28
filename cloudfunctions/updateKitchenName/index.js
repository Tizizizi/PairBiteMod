// 云函数入口文件 - 更新厨房名称
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const { kitchenName } = event

  // 验证名称
  if (!kitchenName || kitchenName.length > 8) {
    return { success: false, message: '名称不能超过8个字' }
  }

  try {
    // 获取当前用户
    const userRes = await db.collection('User').doc(currentOpenid).get()
    const currentUser = userRes.data

    if (!currentUser) {
      return { success: false, message: '用户不存在' }
    }

    // 更新当前用户的厨房名称
    await db.collection('User').doc(currentOpenid).update({
      data: { kitchenName }
    })

    // 如果已绑定伴侣，同步更新伴侣的厨房名称
    if (currentUser.partnerId) {
      await db.collection('User').doc(currentUser.partnerId).update({
        data: { kitchenName }
      }).catch(() => {})
    }

    console.log('update kitchen name success', currentOpenid, kitchenName)

    return { success: true }
  } catch (err) {
    console.error('update kitchen name error', err)
    return {
      success: false,
      message: '更新失败',
      error: err.message
    }
  }
}
