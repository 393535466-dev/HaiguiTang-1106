Page({
  back() { wx.navigateBack({ delta: 1 }) },
  openPlatformPrivacy() { if (wx.openPrivacyContract) wx.openPrivacyContract({ fail() {} }) }
})
