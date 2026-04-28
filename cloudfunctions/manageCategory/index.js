const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
        const existing = await col.where({ coupleId }).count()
        if (existing.total > 0) {
          return { success: true, message: '已初始化' }
        }
        for (const cat of DEFAULT_CATEGORIES) {
          const addRes = await col.add({
            data: {
              name: cat.name,
              icon: cat.icon,
              sort: cat.sort,
              parentId: '',  // 默认都是一级类目
              coupleId,
              _openid: currentOpenid,
              createTime: db.serverDate()
            }
          })
          const newId = addRes._id
		  let maxLoop = 50
          while (maxLoop-- > 0) {
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
        const res = await col.where({ coupleId }).orderBy('sort', 'asc').limit(100).get()
        return { success: true, data: res.data }
      }

      case 'add': {
        // 支持 parentId 字段，为空则是一级类目
        const parentId = data.parentId || ''
        const maxRes = await col.where({ coupleId, parentId }).orderBy('sort', 'desc').limit(1).get()
        const maxSort = maxRes.data.length > 0 ? maxRes.data[0].sort + 1 : 0
        const addRes = await col.add({
          data: {
            name: data.name,
            icon: data.icon,
            sort: maxSort,
            parentId,
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
        const updateData = { name: data.name, icon: data.icon }
        if (data.parentId !== undefined) {
          updateData.parentId = data.parentId
        }
        await col.doc(data._id).update({ data: updateData })
        return { success: true }
      }

      case 'remove': {
        const doc = await col.doc(data._id).get()
        if (doc.data.coupleId !== coupleId) {
          return { success: false, message: '无权操作' }
        }
        // 如果是一级类目，同时删除其下的所有二级类目
        if (!doc.data.parentId) {
          const children = await col.where({ coupleId, parentId: data._id }).get()
          for (const child of children.data) {
            // 转移子类目下的菜品
            if (data.transferTo) {
			  let maxLoop = 50
              while (maxLoop-- > 0) {
                const dishes = await dishCol.where({ coupleId, category: child._id }).limit(20).get()
                if (dishes.data.length === 0) break
                for (const dish of dishes.data) {
                  await dishCol.doc(dish._id).update({ data: { category: data.transferTo } })
                }
              }
            }
            await col.doc(child._id).remove()
          }
        }
        // 转移当前类目下的菜品
        if (data.transferTo) {
          let maxLoop = 50
          while (maxLoop-- > 0) {
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
        for (const item of data.orders) {
          await col.doc(item._id).update({ data: { sort: item.sort } })
        }
        return { success: true }
      }

      case 'countDishes': {
        // 统计该分类及其子分类下的菜品总数
        let total = 0
        const countRes = await dishCol.where({ coupleId, category: data._id }).count()
        total += countRes.total
        // 查子分类
        const children = await col.where({ coupleId, parentId: data._id }).get()
        for (const child of children.data) {
          const childCount = await dishCol.where({ coupleId, category: child._id }).count()
          total += childCount.total
        }
        return { success: true, count: total }
      }

      default:
        return { success: false, message: '不支持的操作' }
    }
  } catch (e) {
    console.error('manageCategory error', e)
    return { success: false, message: '操作失败', error: e.message }
  }
}
