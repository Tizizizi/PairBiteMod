const app = getApp()

Page({
  data: {
    categories: [],
    loading: true,
    // 添加/编辑弹窗
    showModal: false,
    editingIndex: -1,
    tempName: '',
    tempIcon: '🍽️',
    emojiList: ['🥩', '🥬', '🍲', '🍚', '🍜', '🥗', '🍰', '🥤', '🍳', '🍕', '🌮', '🍣', '🥘', '🍝', '🥙', '🍱', '🧁', '🍺', '☕', '🫕', '🍽️', '🔥', '⭐', '🌶️'],
    customIcon: '',
    // 删除转移弹窗
    showTransferModal: false,
    deletingCategory: null,
    deletingDishCount: 0,
    transferTarget: '',
    transferOptions: [],
    sortChanged: false,
  },

  async onShow() {
    await this.loadCategories()
  },

  async loadCategories() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageCategory',
        data: { action: 'list' }
      })
      if (res.result?.success) {
        this.setData({ categories: res.result.data })
        // 同步到全局
        app.globalData.categories = res.result.data
        app.globalData.categoriesLoaded = true
      }
    } catch (e) {
      console.error('load categories error', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
    this.setData({ loading: false })
  },

  // 显示添加弹窗
  showAddModal() {
    this.setData({
      showModal: true,
      editingIndex: -1,
      tempName: '',
      tempIcon: '🍽️',
      customIcon: ''
    })
  },

  // 点击分类进入编辑
  editCategory(e) {
    const index = e.currentTarget.dataset.index
    const cat = this.data.categories[index]
    this.setData({
      showModal: true,
      editingIndex: index,
      tempName: cat.name,
      tempIcon: cat.icon
    })
  },

  selectEmoji(e) {
    this.setData({ tempIcon: e.currentTarget.dataset.emoji, customIcon: '' })
  },

  onCustomIconInput(e) {
    this.setData({ customIcon: e.detail.value })
  },

  useCustomIcon() {
    if (this.data.customIcon) {
      this.setData({ tempIcon: this.data.customIcon })
    }
  },

  onNameInput(e) {
    let value = e.detail.value
    if (value.length > 6) value = value.slice(0, 6)
    this.setData({ tempName: value })
    return value
  },

  closeModal() {
    this.setData({ showModal: false })
  },

  // 保存分类（新增或编辑）
  async saveCategory() {
    const { tempName, tempIcon, editingIndex, categories } = this.data
    if (!tempName.trim()) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...', mask: true })

    try {
      if (editingIndex >= 0) {
        // 编辑
        await wx.cloud.callFunction({
          name: 'manageCategory',
          data: {
            action: 'update',
            data: { _id: categories[editingIndex]._id, name: tempName.trim(), icon: tempIcon }
          }
        })
      } else {
        // 新增
        await wx.cloud.callFunction({
          name: 'manageCategory',
          data: {
            action: 'add',
            data: { name: tempName.trim(), icon: tempIcon }
          }
        })
      }

      wx.hideLoading()
      this.setData({ showModal: false })
      await this.loadCategories()
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('save category error', e)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  // 删除分类
  async deleteCategory(e) {
    if (this.data.categories.length <= 1) {
      wx.showToast({ title: '至少保留一个分类', icon: 'none' })
      return
    }
    const index = e.currentTarget.dataset.index
    const cat = this.data.categories[index]

    wx.showLoading({ title: '检查中...', mask: true })

    try {
      // 查询该分类下菜品数量
      const res = await wx.cloud.callFunction({
        name: 'manageCategory',
        data: { action: 'countDishes', data: { _id: cat._id } }
      })
      wx.hideLoading()

      const count = res.result?.count || 0

      if (count === 0) {
        // 无菜品，直接确认删除
        wx.showModal({
          title: '确认删除',
          content: `确定删除「${cat.icon} ${cat.name}」分类？`,
          success: async (modalRes) => {
            if (!modalRes.confirm) return
            wx.showLoading({ title: '删除中...', mask: true })
            await wx.cloud.callFunction({
              name: 'manageCategory',
              data: { action: 'remove', data: { _id: cat._id } }
            })
            wx.hideLoading()
            await this.loadCategories()
            wx.showToast({ title: '已删除', icon: 'success' })
          }
        })
      } else {
        // 有菜品，弹出转移弹窗
        const transferOptions = this.data.categories.filter(c => c._id !== cat._id)
        this.setData({
          showTransferModal: true,
          deletingCategory: cat,
          deletingDishCount: count,
          transferTarget: '',
          transferOptions
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('delete category error', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  selectTransferTarget(e) {
    this.setData({ transferTarget: e.currentTarget.dataset.id })
  },

  closeTransferModal() {
    this.setData({ showTransferModal: false })
  },

  // 确认转移并删除
  async confirmDelete() {
    const { deletingCategory, transferTarget } = this.data
    if (!transferTarget) return

    wx.showLoading({ title: '转移中...', mask: true })

    try {
      await wx.cloud.callFunction({
        name: 'manageCategory',
        data: {
          action: 'remove',
          data: { _id: deletingCategory._id, transferTo: transferTarget }
        }
      })
      wx.hideLoading()
      this.setData({ showTransferModal: false })
      await this.loadCategories()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('transfer and delete error', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 上移（本地交换）
  moveUp(e) {
    const index = e.currentTarget.dataset.index
    if (index <= 0) return
    const categories = [].concat(this.data.categories)
    const temp = categories[index]
    categories[index] = categories[index - 1]
    categories[index - 1] = temp
    this.setData({ categories, sortChanged: true })
  },

  // 下移（本地交换）
  moveDown(e) {
    const index = e.currentTarget.dataset.index
    if (index >= this.data.categories.length - 1) return
    const categories = [].concat(this.data.categories)
    const temp = categories[index]
    categories[index] = categories[index + 1]
    categories[index + 1] = temp
    this.setData({ categories, sortChanged: true })
  },

  // 保存排序
  async saveSortOrder() {
    const orders = this.data.categories.map((cat, i) => ({ _id: cat._id, sort: i }))
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      await wx.cloud.callFunction({
        name: 'manageCategory',
        data: { action: 'reorder', data: { orders } }
      })
      wx.hideLoading()
      this.setData({ sortChanged: false })
      // 同步到全局
      app.globalData.categories = this.data.categories
      wx.showToast({ title: '排序已保存', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  preventBubble() {},
})
