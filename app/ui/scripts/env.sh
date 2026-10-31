# 让当前 shell 优先使用 nvm 的 Node 24（WorkBuddy 自带的 22 在 PATH 更前面）
# 用法：source ui/scripts/env.sh && npm run dev
export PATH="/d/Software/Scoop/persist/nvm/nodejs/v24.22.1:$PATH"
node -v
