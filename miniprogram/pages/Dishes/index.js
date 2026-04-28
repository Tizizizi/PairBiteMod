const app = getApp()

Page({
  data: {
    isBound: false,
    dishes: [],
	allDishes: [],     // 新增：存储所有已加载的原始数据
    filteredDishes: [],
	hasMore: true,     // 新增
    page: 0,           // 新增
    pageSize: 10,      // 新增
    search: '',
    loading: true,
    partnerName: '对方',
    partnerNickname: '对方',
    myNickname: '我',
    myOpenid: '',
    showFilterPanel: false,
    filterType: '',
    filterCategoryId: '',
    filterCreator: '',
    filterExpandedCats: {},
    parentCats: [],
    childrenMap: {},
    allCategories: [],
    showSortPanel: false,
    sortField: 'createTime',
    sortOrder: 'desc',
    filterLabel: '筛选',
    sortLabel: '添加日期↓',
  },

  _loaded: false,

  async onShow() {
    app.setKitchenTitle()
    await app.loadUserInfo(true)
    await app.loadCategories(true)
    this.buildCategoryData()
    this.loadUserData()
    if (!this._loaded) {
      await this.loadDishes(true)
      this._loaded = true
    }
  },

  loadUserData() {
    const myOpenid = app.globalData.currentUser?._id || ''
    const myNickname = app.globalData.currentUser?.nickname || '我'
    const partnerNickname = app.globalData.partner?.nickname || '对方'
    this.setData({ myOpenid, myNickname, partnerNickname, partnerName: partnerNickname })
  },

  buildCategoryData() {
    const all = app.globalData.categories || []
    const parentCats = all.filter(c => !c.parentId).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const childrenMap = {}
    parentCats.forEach(p => {
      childrenMap[p._id] = all.filter(c => c.parentId === p._id).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    })
    this.setData({ allCategories: all, parentCats, childrenMap })
  },

  _getCategoryLabels(categoryId) {
    const all = this.data.allCategories
    const cat = all.find(c => c._id === categoryId)
    if (!cat) return []
    if (cat.parentId) {
      const parent = all.find(c => c._id === cat.parentId)
      return [
        { text: parent ? parent.icon + ' ' + parent.name : '', isParent: true },
        { text: cat.icon + ' ' + cat.name, isParent: false }
      ].filter(l => l.text)
    }
    return [{ text: cat.icon + ' ' + cat.name, isParent: true }]
  },

  _getNickname(openid) {
    if (openid === app.globalData.currentUser?._id) return app.globalData.currentUser?.nickname || '我'
    if (openid === app.globalData.partner?.openid) return app.globalData.partner?.nickname || '对方'
    return '未知'
  },

  async loadDishes(reset = false) {
    if (reset) {
      this.setData({ page: 0, dishes: [], allDishes: [], filteredDishes: [], hasMore: true })
    }
    this.setData({ loading: true })
    try {
      const { page, pageSize, allDishes: existing } = this.data
      const res = await wx.cloud.callFunction({
        name: 'getCoupleData',
        data: { collection: app.globalData.collectionDishList, orderBy: 'createTime', order: 'desc', skip: page * pageSize, limit: pageSize }
      })
      if (!res.result?.success) throw new Error(res.result?.message || '加载失败')

      const newDishes = res.result.data.map(item => ({
        ...item,
        createTimeText: this.formatDateTime(item.createTime),
        creatorNickname: this._getNickname(item._openid),
        categoryLabels: this._getCategoryLabels(item.category),
      }))

      await app.convertFileURLs(newDishes, ['imageUrl'])

      const allDishes = reset ? newDishes : [...existing, ...newDishes]
      this.setData({
        dishes: allDishes,
        allDishes,
        hasMore: newDishes.length === pageSize,
        page: page + 1,
        loading: false
      })
      this.applyFilterAndSort()
    } catch (e) {
      console.error('加载菜品失败', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onSearch(e) {
    this.setData({ search: e.detail.value.trim() })
    this.applyFilterAndSort()
  },

  toggleFilterPanel() {
    this.setData({ showFilterPanel: !this.data.showFilterPanel, showSortPanel: false, filterExpandedCats: {} })
  },

  // 展开/折叠筛选面板中的二级类目
  toggleFilterCat(e) {
    const id = e.currentTarget.dataset.id
    const expanded = Object.assign({}, this.data.filterExpandedCats)
    expanded[id] = !expanded[id]
    this.setData({ filterExpandedCats: expanded })
  },

  selectCategoryFilter(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.filterCategoryId) {
      this.setData({ filterCategoryId: '', filterType: '', filterLabel: '筛选', showFilterPanel: false })
    } else {
      const cat = this.data.allCategories.find(c => c._id === id)
      this.setData({
        filterCategoryId: id, filterCreator: '', filterType: 'category',
        filterLabel: cat ? cat.icon + ' ' + cat.name : '分类', showFilterPanel: false
      })
    }
    this.applyFilterAndSort()
  },

  selectCreatorFilter(e) {
    const who = e.currentTarget.dataset.who
    if (who === this.data.filterCreator) {
      this.setData({ filterCreator: '', filterType: '', filterLabel: '筛选', showFilterPanel: false })
    } else {
      const label = who === 'me' ? this.data.myNickname : this.data.partnerNickname
      this.setData({
        filterCreator: who, filterCategoryId: '', filterType: 'creator',
        filterLabel: label, showFilterPanel: false
      })
    }
    this.applyFilterAndSort()
  },

  clearFilter() {
    this.setData({ filterType: '', filterCategoryId: '', filterCreator: '', filterLabel: '筛选', showFilterPanel: false, filterExpandedCats: {} })
    this.applyFilterAndSort()
  },

  toggleSortPanel() {
    this.setData({ showSortPanel: !this.data.showSortPanel, showFilterPanel: false })
  },

  selectSort(e) {
    const field = e.currentTarget.dataset.field
    let { sortOrder } = this.data
    if (field === this.data.sortField) {
      sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'
    } else {
      sortOrder = 'desc'
    }
    const arrow = sortOrder === 'desc' ? '↓' : '↑'
    const labels = { createTime: '添加日期', orderCount: '点菜次数' }
    this.setData({ sortField: field, sortOrder, sortLabel: labels[field] + arrow, showSortPanel: false })
    this.applyFilterAndSort()
  },

  applyFilterAndSort() {
    let { dishes, search, filterType, filterCategoryId, filterCreator, myOpenid, sortField, sortOrder, childrenMap } = this.data
    let result = [].concat(dishes)

    if (search) result = result.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))

    if (filterType === 'category' && filterCategoryId) {
      const children = childrenMap[filterCategoryId] || []
      const ids = [filterCategoryId, ...children.map(c => c._id)]
      result = result.filter(d => ids.includes(d.category))
    }

    if (filterType === 'creator' && filterCreator) {
      if (filterCreator === 'me') result = result.filter(d => d._openid === myOpenid)
      else result = result.filter(d => d._openid && d._openid !== myOpenid)
    }

    result.sort((a, b) => {
      let va, vb
      if (sortField === 'orderCount') {
        va = a.orderCount || 0; vb = b.orderCount || 0
      } else {
        va = new Date(a.createTime || 0).getTime()
        vb = new Date(b.createTime || 0).getTime()
      }
      return sortOrder === 'desc' ? vb - va : va - vb
    })

    this.setData({ filteredDishes: result })
  },

  closeAllPanels() { this.setData({ showFilterPanel: false, showSortPanel: false }) },
  loadMore() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadDishes()
    }
  },

  onReachBottom() {
    this.loadMore()
  },
  toAddPage() {
    this._loaded = false
    wx.navigateTo({ url: '/pages/DishAdd/index' })
  },

  toDetailPage(e) {
    this._loaded = false
    const id = e.currentTarget.dataset.id
    const dish = this.data.dishes.find(item => item._id === id)
    const imageUrl = dish?.imageUrl ? encodeURIComponent(dish.imageUrl) : ''
    wx.navigateTo({ url: `/pages/DishDetail/index?id=${id}&imageUrl=${imageUrl}` })
  },

  showDeleteConfirm(e) {
    const id = e.currentTarget.dataset.id
    const dish = this.data.dishes.find(item => item._id === id)
    wx.showModal({
      title: '删除菜品', content: `确定要删除「${dish.name}」吗？`, confirmColor: '#E53935',
      success: async (res) => { if (res.confirm) await this.deleteDish(id) }
    })
  },

  async deleteDish(id) {
    wx.showLoading({ title: '删除中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateCoupleData',
        data: { collection: app.globalData.collectionDishList, docId: id, action: 'remove' }
      })
      wx.hideLoading()
      if (!res.result?.success) throw new Error()
      const allDishes = this.data.allDishes.filter(item => item._id !== id)
      this.setData({ dishes: allDishes, allDishes })
      this.applyFilterAndSort()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '删除失败', icon: 'none' }) }
  },

  // 年月日 时分格式
  formatDateTime(date) {
    if (!date) return ''
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''
    const Y = d.getFullYear()
    const M = (d.getMonth() + 1).toString().padStart(2, '0')
    const D = d.getDate().toString().padStart(2, '0')
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${Y}-${M}-${D} ${h}:${m}`
  },
})
