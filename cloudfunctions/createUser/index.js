// 云函数入口文件 - 创建/获取用户
// 注意：本版本不再做服务端头像 URL 转换。
// 头像统一在前端通过 app.convertFileURLs() 转换，命中客户端缓存可避免重复请求。
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 生成6位随机邀请码
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { nickname, avatarUrl } = event

  try {
    // 查询用户是否已存在
    const userRes = await db.collection('User').doc(openid).get().catch(() => null)

    if (userRes && userRes.data) {
      // 用户已存在，更新传入的字段
      const updateData = {}
      if (nickname) updateData.nickname = nickname
      if (avatarUrl) updateData.avatarUrl = avatarUrl

      if (Object.keys(updateData).length > 0) {
        await db.collection('User').doc(openid).update({ data: updateData })
        if (nickname) userRes.data.nickname = nickname
        if (avatarUrl) userRes.data.avatarUrl = avatarUrl
      }

      // 查询伴侣信息（直接返回 cloud:// 地址，由前端缓存层转换）
      let partner = null
      if (userRes.data.partnerId) {
        const partnerRes = await db.collection('User').doc(userRes.data.partnerId).get().catch(() => null)
        if (partnerRes && partnerRes.data) {
          partner = {
            openid: partnerRes.data._id,
            nickname: partnerRes.data.nickname,
            avatarUrl: partnerRes.data.avatarUrl   // 原始 cloud:// 地址
          }
        }
      }

      return {
        success: true,
        isNew: false,
        user: userRes.data,                         // 原始 cloud:// 地址
        partner
      }
    }

    // 用户不存在，创建新用户
    // 生成唯一邀请码
    let inviteCode = generateInviteCode()
    let codeExists = true
    let attempts = 0
    while (codeExists && attempts < 10) {
      const existingCode = await db.collection('User')
        .where({ inviteCode })
        .count()
      if (existingCode.total === 0) {
        codeExists = false
      } else {
        inviteCode = generateInviteCode()
        attempts++
      }
    }

    const newUser = {
      _id: openid,
      nickname: nickname || '',
      avatarUrl: '',
      partnerId: '',
      inviteCode,
      bindStatus: 'unbound',
      createTime: db.serverDate()
    }

    await db.collection('User').add({ data: newUser })

    return {
      success: true,
      isNew: true,
      user: newUser,
      partner: null
    }
  } catch (err) {
    console.error('create user error', err)
    return {
      success: false,
      error: err.message
    }
  }
}
