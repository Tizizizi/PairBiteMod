// 云函数入口文件 - 解除绑定
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID

  try {
    // 查询当前用户
    const currentUserRes = await db.collection('User').doc(currentOpenid).get().catch(() => null)
    if (!currentUserRes || !currentUserRes.data) {
      return { success: false, message: '用户不存在' }
    }

    const currentUser = currentUserRes.data

    // 检查是否已绑定
    if (currentUser.bindStatus !== 'bound' || !currentUser.partnerId) {
      return { success: false, message: '你还没有绑定伴侣' }
    }

    const partnerId = currentUser.partnerId

    // 解除当前用户的绑定（清空 coupleId）
    await db.collection('User').doc(currentOpenid).update({
      data: {
        partnerId: '',
        bindStatus: 'unbound',
        coupleId: ''
      }
    })

    // 解除对方的绑定（清空 coupleId）
    await db.collection('User').doc(partnerId).update({
      data: {
        partnerId: '',
        bindStatus: 'unbound',
        coupleId: ''
      }
    }).catch(() => {})

    console.log('unbind partner success', currentOpenid, partnerId)

    return {
      success: true,
      message: '已解除绑定'
    }
  } catch (err) {
    console.error('unbind partner error', err)
    return {
      success: false,
      message: '解除绑定失败，请重试',
      error: err.message
    }
  }
}
