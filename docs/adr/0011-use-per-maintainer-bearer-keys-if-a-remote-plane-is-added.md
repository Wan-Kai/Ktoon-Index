# 远端管理面使用独立 Bearer API Key

如果未来部署远端管理面，第一版认证采用每位维护者独立的随机 Bearer API Key，而不是共享 Basic Auth 用户名密码。服务端只保存 Key 哈希，CLI 将原始 Key 保存到系统 Keychain；这种方案保持低成本，同时支持识别和单独撤销维护者，之后仍可迁移到 GitHub App 登录。
