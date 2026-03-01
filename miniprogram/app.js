App({
  async onLaunch() {
    this.initcloud()

    this.globalData = {
      // 当前用户信息（动态获取）
      currentUser: null,
      // 伴侣信息（动态获取）
      partner: null,
      // 用户信息是否已加载
      userLoaded: false,
      // 用户信息加载Promise
      userLoadPromise: null,

      // 云数据库集合名称
      collectionDishList: 'DishList',
      collectionOrderList: 'OrderList',

      // 应用信息
      appName: '帕恰狗的小厨房',
      version: '1.0.0',

      // 菜品分类
      categories: [
        { id: 'meat', name: '荤菜', icon: '🥩' },
        { id: 'vegetable', name: '素菜', icon: '🥬' },
        { id: 'soup', name: '汤类', icon: '🍲' },
        { id: 'rice', name: '主食', icon: '🍚' },
        { id: 'noodle', name: '面食', icon: '🍜' },
        { id: 'cold', name: '凉菜', icon: '🥗' },
        { id: 'dessert', name: '甜点', icon: '🍰' },
        { id: 'drink', name: '饮品', icon: '🥤' },
      ],
    }
  },

  flag: false,

  /**
   * 初始化云开发环境
   */
  async initcloud() {
    const normalinfo = require('./envList.js').envList || []
    if (normalinfo.length != 0 && normalinfo[0].envId != null) {
      wx.cloud.init({
        traceUser: true,
        env: normalinfo[0].envId
      })
      this.cloud = () => {
        return wx.cloud
      }
    } else {
      this.cloud = () => {
        wx.showModal({
          content: '帕恰狗找不到云环境啦~',
          showCancel: false
        })
        throw new Error('无云开发环境')
      }
    }
  },

  // 获取云数据库实例
  async database() {
    return (await this.cloud()).database()
  },

  // 加载用户信息（带缓存）
  async loadUserInfo(forceRefresh = false) {
    // 如果已加载且不强制刷新，直接返回
    if (this.globalData.userLoaded && !forceRefresh) {
      return {
        currentUser: this.globalData.currentUser,
        partner: this.globalData.partner
      }
    }

    // 如果正在加载中，等待加载完成
    if (this.globalData.userLoadPromise && !forceRefresh) {
      return this.globalData.userLoadPromise
    }

    // 开始加载
    this.globalData.userLoadPromise = this._doLoadUserInfo()
    return this.globalData.userLoadPromise
  },

  // 实际加载用户信息
  async _doLoadUserInfo() {
    try {
      const res = await wx.cloud.callFunction({ name: 'createUser' })
      if (res.result && res.result.success) {
        this.globalData.currentUser = res.result.user
        this.globalData.partner = res.result.partner
        this.globalData.userLoaded = true
        return {
          currentUser: res.result.user,
          partner: res.result.partner
        }
      }
    } catch (e) {
      console.error('load user info error', e)
    }
    return { currentUser: null, partner: null }
  },

  // 更新用户昵称
  async updateNickname(nickname) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'createUser',
        data: { nickname }
      })
      if (res.result && res.result.success) {
        this.globalData.currentUser = res.result.user
        return true
      }
    } catch (e) {
      console.error('update nickname error', e)
    }
    return false
  },

  // 绑定伴侣
  async bindPartner(inviteCode) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'bindPartner',
        data: { inviteCode }
      })
      if (res.result && res.result.success) {
        // 刷新用户信息
        await this.loadUserInfo(true)
        return { success: true, partner: res.result.partner }
      }
      return { success: false, message: res.result?.message || '绑定失败' }
    } catch (e) {
      console.error('bind partner error', e)
      return { success: false, message: '绑定失败，请重试' }
    }
  },

  // 解除绑定
  async unbindPartner() {
    try {
      const res = await wx.cloud.callFunction({ name: 'unbindPartner' })
      if (res.result && res.result.success) {
        this.globalData.partner = null
        if (this.globalData.currentUser) {
          this.globalData.currentUser.partnerId = ''
          this.globalData.currentUser.bindStatus = 'unbound'
          this.globalData.currentUser.coupleId = ''
        }
        return { success: true }
      }
      return { success: false, message: res.result?.message || '解绑失败' }
    } catch (e) {
      console.error('unbind partner error', e)
      return { success: false, message: '解绑失败，请重试' }
    }
  },

  // 检查是否已绑定伴侣
  isBound() {
    return this.globalData.currentUser?.bindStatus === 'bound' && this.globalData.partner
  },

  // 检查用户信息是否完整（有昵称和头像）
  isProfileComplete() {
    const user = this.globalData.currentUser
    return user?.nickname && user?.avatarUrl
  },

  // 获取伴侣名字
  getPartnerName() {
    return this.globalData.partner?.nickname || '对方'
  },

  // 获取当前用户名字
  getCurrentUserName() {
    return this.globalData.currentUser?.nickname || '我'
  },

  // 根据 openid 获取显示名称
  getDisplayName(openid) {
    if (openid === this.globalData.currentUser?._id) {
      return '你'
    }
    if (openid === this.globalData.partner?.openid) {
      return this.globalData.partner?.nickname || '对方'
    }
    return '未知'
  },

  // 获取厨房名称（自定义或默认）
  getKitchenName() {
    return this.globalData.currentUser?.kitchenName || this.globalData.appName
  },

  // 设置页面导航栏标题为厨房名称
  setKitchenTitle() {
    const title = this.getKitchenName()
    wx.setNavigationBarTitle({ title })
  },

  // 更新厨房名称（同步到伴侣）
  async updateKitchenName(name) {
    if (!name || name.length > 8) {
      return { success: false, message: '名称不能超过8个字' }
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'updateKitchenName',
        data: { kitchenName: name }
      })
      if (res.result?.success) {
        this.globalData.currentUser.kitchenName = name
        return { success: true }
      }
      return { success: false, message: res.result?.message || '更新失败' }
    } catch (e) {
      console.error('update kitchen name error', e)
      return { success: false, message: '更新失败' }
    }
  },
})
