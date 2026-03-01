// 云函数入口文件 - 绑定伴侣
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 生成 coupleId：两个 openid 排序后拼接
function generateCoupleId(openid1, openid2) {
  return [openid1, openid2].sort().join('_')
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const { inviteCode } = event

  if (!inviteCode || inviteCode.length !== 6) {
    return { success: false, message: '邀请码格式不正确' }
  }

  try {
    // 查询当前用户
    const currentUserRes = await db.collection('User').doc(currentOpenid).get().catch(() => null)
    if (!currentUserRes || !currentUserRes.data) {
      return { success: false, message: '请先完成注册' }
    }

    const currentUser = currentUserRes.data

    // 检查当前用户是否已绑定
    if (currentUser.bindStatus === 'bound' && currentUser.partnerId) {
      return { success: false, message: '你已经绑定了伴侣' }
    }

    // 查询邀请码对应的用户
    const partnerRes = await db.collection('User')
      .where({ inviteCode: inviteCode.toUpperCase() })
      .get()

    if (partnerRes.data.length === 0) {
      return { success: false, message: '邀请码不存在' }
    }

    const partner = partnerRes.data[0]

    // 检查是否是自己的邀请码
    if (partner._id === currentOpenid) {
      return { success: false, message: '不能绑定自己' }
    }

    // 检查对方是否已绑定
    if (partner.bindStatus === 'bound' && partner.partnerId) {
      return { success: false, message: 'TA已经绑定了伴侣' }
    }

    // 生成 coupleId
    const coupleId = generateCoupleId(currentOpenid, partner._id)
    const bindTime = db.serverDate()

    // 双向绑定
    await db.collection('User').doc(currentOpenid).update({
      data: {
        partnerId: partner._id,
        bindStatus: 'bound',
        bindTime,
        coupleId
      }
    })

    await db.collection('User').doc(partner._id).update({
      data: {
        partnerId: currentOpenid,
        bindStatus: 'bound',
        bindTime,
        coupleId
      }
    })

    console.log('bind partner success', currentOpenid, partner._id, 'coupleId:', coupleId)

    return {
      success: true,
      message: '绑定成功',
      partner: {
        openid: partner._id,
        nickname: partner.nickname
      },
      coupleId
    }
  } catch (err) {
    console.error('bind partner error', err)
    return {
      success: false,
      message: '绑定失败，请重试',
      error: err.message
    }
  }
}
