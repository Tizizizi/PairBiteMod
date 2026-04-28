const app = getApp()

const DEFAULT_EMOJIS = ['🥩', '🥬', '🍲', '🍚', '🍜', '🥗', '🍰', '🥤', '🍳', '🍕', '🌮', '🍣', '🥘', '🍝', '🥙', '🍱', '🧁', '🍺', '☕', '🫕', '🍽️', '🔥', '⭐', '🌶️']

Page({
  data: {
    categories: [],
    parentCats: [],
    childrenMap: {},
    expandedId: '',
    loading: true,
    showModal: false,
    editingId: '',
    editingParentId: '',
    tempName: '',
    tempIcon: '🍽️',
    emojiList: [],
    customIcon: '',
    hasCustomEmojis: false,  // 是否有自定义emoji
    showTransferModal: false,
    deletingCategory: null,
    deletingDishCount: 0,
    transferTarget: '',
    transferOptions: [],
    sortChanged: false,
  },

  async onShow() {
    this.loadCustomEmojis()
    await this.loadCategories()
  },

  // ===== emoji 管理 =====

  // 加载自定义emoji，合并到图标库
  loadCustomEmojis() {
    const custom = wx.getStorageSync('customEmojis') || []
    const merged = [...DEFAULT_EMOJIS]
    custom.forEach(e => { if (!merged.includes(e)) merged.push(e) })
    this.setData({ emojiList: merged, hasCustomEmojis: custom.length > 0 })
  },

  // 保存自定义emoji到本地缓存
  _saveCustomEmoji(emoji) {
    const custom = wx.getStorageSync('customEmojis') || []
    if (!custom.includes(emoji)) {
      custom.push(emoji)
      wx.setStorageSync('customEmojis', custom)
    }
  },

  // 使用自定义emoji：加入图标库 + 选中
  useCustomIcon() {
    const emoji = this.data.customIcon
    if (!emoji) return
    const emojiList = [].concat(this.data.emojiList)
    if (!emojiList.includes(emoji)) emojiList.push(emoji)
    this.setData({ tempIcon: emoji, emojiList, customIcon: '', hasCustomEmojis: true })
    this._saveCustomEmoji(emoji)
  },

  // 长按删除自定义emoji
  removeEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji
    // 默认emoji不能删
    if (DEFAULT_EMOJIS.includes(emoji)) {
      wx.showToast({ title: '默认图标不可删除', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除图标',
      content: `确定要从图标库中删除「${emoji}」吗？`,
      success: (res) => {
        if (!res.confirm) return
        // 从本地缓存删除
        let custom = wx.getStorageSync('customEmojis') || []
        custom = custom.filter(e => e !== emoji)
        wx.setStorageSync('customEmojis', custom)
        // 从当前列表删除
        const emojiList = this.data.emojiList.filter(e => e !== emoji)
        const updates = { emojiList, hasCustomEmojis: custom.length > 0 }
        // 如果删的是当前选中的，重置
        if (this.data.tempIcon === emoji) updates.tempIcon = '🍽️'
        this.setData(updates)
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // 重置图标库为默认
  resetEmojis() {
    wx.showModal({
      title: '重置图标库',
      content: '将清除所有自定义图标，恢复为默认的24个，确定？',
      success: (res) => {
        if (!res.confirm) return
        wx.removeStorageSync('customEmojis')
        this.setData({ emojiList: [...DEFAULT_EMOJIS], hasCustomEmojis: false })
        wx.showToast({ title: '已重置', icon: 'success' })
      }
    })
  },

  // ===== 分类管理 =====

  async loadCategories() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'list' } })
      if (res.result?.success) {
        const all = res.result.data
        this._buildHierarchy(all)
        app.globalData.categories = all
        app.globalData.categoriesLoaded = true
      }
    } catch (e) {
      console.error('load categories error', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
    this.setData({ loading: false })
  },

  _buildHierarchy(all) {
    const parentCats = all.filter(c => !c.parentId).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const childrenMap = {}
    parentCats.forEach(p => {
      childrenMap[p._id] = all.filter(c => c.parentId === p._id).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    })
    this.setData({ categories: all, parentCats, childrenMap, sortChanged: false })
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expandedId: this.data.expandedId === id ? '' : id })
  },

  showAddParentModal() {
    this.setData({ showModal: true, editingId: '', editingParentId: '', tempName: '', tempIcon: '🍽️', customIcon: '' })
  },
  showAddChildModal(e) {
    this.setData({ showModal: true, editingId: '', editingParentId: e.currentTarget.dataset.parentid, tempName: '', tempIcon: '🍽️', customIcon: '' })
  },
  editCategory(e) {
    const id = e.currentTarget.dataset.id
    const cat = this.data.categories.find(c => c._id === id)
    if (!cat) return
    this.setData({ showModal: true, editingId: id, editingParentId: cat.parentId || '', tempName: cat.name, tempIcon: cat.icon, customIcon: '' })
  },

  selectEmoji(e) { this.setData({ tempIcon: e.currentTarget.dataset.emoji, customIcon: '' }) },
  onCustomIconInput(e) { this.setData({ customIcon: e.detail.value }) },
  onNameInput(e) {
    let v = e.detail.value
    if (v.length > 6) v = v.slice(0, 6)
    this.setData({ tempName: v })
    return v
  },
  closeModal() { this.setData({ showModal: false }) },

  async saveCategory() {
    const { tempName, tempIcon, editingId, editingParentId, customIcon } = this.data
    if (!tempName.trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return }
    // 检查是否输入了emoji但没点使用
    if (customIcon && customIcon !== tempIcon) {
      wx.showToast({ title: '请先点击"使用"确认图标', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      if (editingId) {
        await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'update', data: { _id: editingId, name: tempName.trim(), icon: tempIcon } } })
      } else {
        await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'add', data: { name: tempName.trim(), icon: tempIcon, parentId: editingParentId } } })
      }
      wx.hideLoading()
      this.setData({ showModal: false })
      await this.loadCategories()
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) }
  },

  // ===== 排序 =====

  moveParentUp(e) {
    const idx = parseInt(e.currentTarget.dataset.index)
    if (idx <= 0) return
    const arr = JSON.parse(JSON.stringify(this.data.parentCats))
    const temp = arr[idx]; arr[idx] = arr[idx - 1]; arr[idx - 1] = temp
    this.setData({ parentCats: arr, sortChanged: true })
  },

  moveParentDown(e) {
    const idx = parseInt(e.currentTarget.dataset.index)
    if (idx >= this.data.parentCats.length - 1) return
    const arr = JSON.parse(JSON.stringify(this.data.parentCats))
    const temp = arr[idx]; arr[idx] = arr[idx + 1]; arr[idx + 1] = temp
    this.setData({ parentCats: arr, sortChanged: true })
  },

  moveChildUp(e) {
    const parentId = e.currentTarget.dataset.parentid
    const idx = parseInt(e.currentTarget.dataset.index)
    if (idx <= 0) return
    const map = JSON.parse(JSON.stringify(this.data.childrenMap))
    const arr = map[parentId]
    const temp = arr[idx]; arr[idx] = arr[idx - 1]; arr[idx - 1] = temp
    this.setData({ childrenMap: map, sortChanged: true })
  },

  moveChildDown(e) {
    const parentId = e.currentTarget.dataset.parentid
    const idx = parseInt(e.currentTarget.dataset.index)
    const map = JSON.parse(JSON.stringify(this.data.childrenMap))
    const arr = map[parentId]
    if (idx >= arr.length - 1) return
    const temp = arr[idx]; arr[idx] = arr[idx + 1]; arr[idx + 1] = temp
    this.setData({ childrenMap: map, sortChanged: true })
  },

  async saveSortOrder() {
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const parentOrders = this.data.parentCats.map((cat, i) => ({ _id: cat._id, sort: i }))
      await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'reorder', data: { orders: parentOrders } } })

      const childrenMap = this.data.childrenMap
      for (const parentId of Object.keys(childrenMap)) {
        const children = childrenMap[parentId]
        if (children && children.length > 0) {
          const childOrders = children.map((cat, i) => ({ _id: cat._id, sort: i }))
          await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'reorder', data: { orders: childOrders } } })
        }
      }

      wx.hideLoading()
      this.setData({ sortChanged: false })
      app.globalData.categoriesLoaded = false
      await this.loadCategories()
      wx.showToast({ title: '排序已保存', icon: 'success' })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) }
  },

  // ===== 删除 =====
  async deleteCategory(e) {
    const id = e.currentTarget.dataset.id
    const cat = this.data.categories.find(c => c._id === id)
    if (!cat) return
    if (!cat.parentId && this.data.parentCats.length <= 1) {
      wx.showToast({ title: '至少保留一个一级分类', icon: 'none' }); return
    }
    wx.showLoading({ title: '检查中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'countDishes', data: { _id: id } } })
      wx.hideLoading()
      const count = res.result?.count || 0
      if (count === 0) {
        wx.showModal({
          title: '确认删除',
          content: cat.parentId ? `确定删除子分类「${cat.icon} ${cat.name}」？` : `确定删除「${cat.icon} ${cat.name}」及其所有子分类？`,
          success: async (r) => {
            if (!r.confirm) return
            wx.showLoading({ title: '删除中...', mask: true })
            await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'remove', data: { _id: id } } })
            wx.hideLoading()
            app.globalData.categoriesLoaded = false
            await this.loadCategories()
            wx.showToast({ title: '已删除', icon: 'success' })
          }
        })
      } else {
        const opts = this.data.categories.filter(c => c._id !== id)
        this.setData({ showTransferModal: true, deletingCategory: cat, deletingDishCount: count, transferTarget: '', transferOptions: opts })
      }
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) }
  },

  selectTransferTarget(e) { this.setData({ transferTarget: e.currentTarget.dataset.id }) },
  closeTransferModal() { this.setData({ showTransferModal: false }) },

  async confirmDelete() {
    if (!this.data.transferTarget) return
    wx.showLoading({ title: '转移中...', mask: true })
    try {
      await wx.cloud.callFunction({ name: 'manageCategory', data: { action: 'remove', data: { _id: this.data.deletingCategory._id, transferTo: this.data.transferTarget } } })
      wx.hideLoading()
      this.setData({ showTransferModal: false })
      app.globalData.categoriesLoaded = false
      await this.loadCategories()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) }
  },

  preventBubble() {},
})
