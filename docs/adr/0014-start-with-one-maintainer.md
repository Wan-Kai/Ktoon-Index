# 第一阶段只支持一个维护者

AI Index 第一阶段只允许站点所有者本人拥有仓库写权限，Agent 复用其本地 `gh auth` 身份调用 CLI。系统不实现 Owner/Editor、GitHub Team 授权、Bearer Key、委托凭证或远端管理服务，避免用可被本地绕过的逻辑伪装成安全的多人权限；真正需要多人维护时再引入远端强制管理面。
