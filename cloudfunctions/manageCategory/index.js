const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 默认分类（legacyId 用于迁移旧数据）
const DEFAULT_CATEGORIES = [
  { legacyId: 'meat', name: '荤菜', icon: '🥩', sort: 0 },
  { legacyId: 'vegetable', name: '素菜', icon: '🥬', sort: 1 },
  { legacyId: 'soup', name: '汤类', icon: '🍲', sort: 2 },
  { legacyId: 'rice', name: '主食', icon: '🍚', sort: 3 },
  { legacyId: 'noodle', name: '面食', icon: '🍜', sort: 4 },
  { legacyId: 'cold', name: '凉菜', icon: '🥗', sort: 5 },
  { legacyId: 'dessert', name: '甜点', icon: '🍰', sort: 6 },
  { legacyId: 'drink', name: '饮品', icon: '🥤', sort: 7 },
]

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  const { action, data } = event

  try {
    const userRes = await db.collection('User').doc(currentOpenid).get()
    const coupleId = userRes.data?.coupleId
    if (!coupleId) {
      return { success: false, message: '未绑定伴侣' }
    }

    const col = db.collection('Category')
    const dishCol = db.collection('DishList')

    switch (action) {
      case 'init': {
        // 幂等：已有分类则跳过
        const existing = await col.where({ coupleId }).count()
        if (existing.total > 0) {
          return { success: true, message: '已初始化' }
        }
        // 创建默认分类，并迁移旧菜品数据
        for (const cat of DEFAULT_CATEGORIES) {
          const addRes = await col.add({
            data: {
              name: cat.name,
              icon: cat.icon,
              sort: cat.sort,
              coupleId,
              _openid: currentOpenid,
              createTime: db.serverDate()
            }
          })
          // 迁移：把旧 category='meat' 改为新的 _id
          const newId = addRes._id
          while (true) {
            const dishes = await dishCol.where({ coupleId, category: cat.legacyId }).limit(20).get()
            if (dishes.data.length === 0) break
            for (const dish of dishes.data) {
              await dishCol.doc(dish._id).update({ data: { category: newId } })
            }
          }
        }
        return { success: true, message: '初始化完成' }
      }

      case 'list': {
        const res = await col.where({ coupleId }).orderBy('sort', 'asc').limit(50).get()
        return { success: true, data: res.data }
      }

      case 'add': {
        const maxRes = await col.where({ coupleId }).orderBy('sort', 'desc').limit(1).get()
        const maxSort = maxRes.data.length > 0 ? maxRes.data[0].sort + 1 : 0
        const addRes = await col.add({
          data: {
            name: data.name,
            icon: data.icon,
            sort: maxSort,
            coupleId,
            _openid: currentOpenid,
            createTime: db.serverDate()
          }
        })
        return { success: true, _id: addRes._id }
      }

      case 'update': {
        const doc = await col.doc(data._id).get()
        if (doc.data.coupleId !== coupleId) {
          return { success: false, message: '无权操作' }
        }
        await col.doc(data._id).update({
          data: { name: data.name, icon: data.icon }
        })
        return { success: true }
      }

      case 'remove': {
        const doc = await col.doc(data._id).get()
        if (doc.data.coupleId !== coupleId) {
          return { success: false, message: '无权操作' }
        }
        // 批量转移菜品到目标分类
        if (data.transferTo) {
          while (true) {
            const dishes = await dishCol.where({ coupleId, category: data._id }).limit(20).get()
            if (dishes.data.length === 0) break
            for (const dish of dishes.data) {
              await dishCol.doc(dish._id).update({ data: { category: data.transferTo } })
            }
          }
        }
        await col.doc(data._id).remove()
        return { success: true }
      }

      case 'reorder': {
        // data.orders = [{ _id, sort }, ...]
        for (const item of data.orders) {
          await col.doc(item._id).update({ data: { sort: item.sort } })
        }
        return { success: true }
      }

      case 'countDishes': {
        // 查询某分类下菜品数量
        const countRes = await dishCol.where({ coupleId, category: data._id }).count()
        return { success: true, count: countRes.total }
      }

      default:
        return { success: false, message: '不支持的操作' }
    }
  } catch (e) {
    console.error('manageCategory error', e)
    return { success: false, message: '操作失败', error: e.message }
  }
}
