#!/usr/bin/env bash
# =============================================================================
# gbrain Hermes Profile 批量修复脚本
# =============================================================================
# 功能：一键修复/验证所有 Hermes profile 的 gbrain 配置
# 使用：bash tools/fix-gbrain-hermes-profiles.sh [--fix|--verify]
# =============================================================================

set -euo pipefail

MODE="${1:-verify}"
FIX=false
[[ "$MODE" == "--fix" ]] && FIX=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

log_pass() { echo -e "${GREEN}✅${NC} $1"; ((PASS++)) || true; }
log_fail() { echo -e "${RED}❌${NC} $1"; ((FAIL++)) || true; }
log_info() { echo -e "${YELLOW}ℹ️${NC} $1"; }

# ---------------------------------------------------------------------------
# 1. 验证 ~/.zshrc
# ---------------------------------------------------------------------------
log_info "检查 ~/.zshrc..."
if ! grep -q 'export GBRAIN_HOME=' ~/.zshrc; then
  if $FIX; then
    echo '' >> ~/.zshrc
    echo '# gbrain 配置' >> ~/.zshrc
    echo 'export GBRAIN_HOME="/Users/jack"' >> ~/.zshrc
    log_pass "已添加 GBRAIN_HOME 到 ~/.zshrc"
  else
    log_fail "~/.zshrc 缺少 GBRAIN_HOME"
  fi
else
  log_pass "~/.zshrc 已配置 GBRAIN_HOME"
fi

if ! grep -q 'export DASHSCOPE_API_KEY=' ~/.zshrc; then
  log_fail "~/.zshrc 缺少 DASHSCOPE_API_KEY"
else
  log_pass "~/.zshrc 已配置 DASHSCOPE_API_KEY"
fi

# ---------------------------------------------------------------------------
# 2. 验证 ~/.gbrain/config.json
# ---------------------------------------------------------------------------
log_info "检查 ~/.gbrain/config.json..."
if [[ ! -r ~/.gbrain/config.json ]]; then
  log_fail "~/.gbrain/config.json 不存在"
elif ! grep -q '"litellm":' ~/.gbrain/config.json; then
  if $FIX; then
    cat > ~/.gbrain/config.json << 'JSONEOF'
{
  "engine": "pglite",
  "database_path": "/Users/jack/.gbrain/brain.pglite",
  "provider_base_urls": {
    "litellm": "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  "embedding_model": "litellm:text-embedding-v4",
  "embedding_dimensions": 1024
}
JSONEOF
    log_pass "已修复 ~/.gbrain/config.json"
  else
    log_fail "~/.gbrain/config.json 缺少 litellm provider_base_urls"
  fi
else
  log_pass "~/.gbrain/config.json 配置正确"
fi

# ---------------------------------------------------------------------------
# 3. 验证 profile home .zshenv
# ---------------------------------------------------------------------------
log_info "检查 profile home .zshenv..."
ZSHENV_CONTENT='export GBRAIN_HOME="/Users/jack"
export DASHSCOPE_API_KEY="sk-80d31ded7eb54767a01cb4b7c0fcec9a"
export LITELLM_API_KEY="$DASHSCOPE_API_KEY"
export BUN_INSTALL="/Users/jack/.bun"
export PATH="/Users/jack/.bun/bin:/Users/jack/.local/bin:/usr/local/bin:$PATH"'

PROFILES_DIR="$HOME/.hermes/profiles"
for p in "$PROFILES_DIR"/*; do
  name=$(basename "$p")
  home_dir="$p/home"
  zshenv_file="$home_dir/.zshenv"
  bashrc_file="$home_dir/.bashrc"
  
  if [[ ! -f "$zshenv_file" ]]; then
    if $FIX; then
      mkdir -p "$home_dir"
      echo "$ZSHENV_CONTENT" > "$zshenv_file"
      echo "$ZSHENV_CONTENT" > "$bashrc_file"
      log_pass "$name: home/.zshenv 和 home/.bashrc 已创建"
    else
      log_fail "$name: home/.zshenv 不存在"
    fi
  else
    log_pass "$name: home/.zshenv 存在"
  fi
done

# ---------------------------------------------------------------------------
# 4. 本地功能验证
# ---------------------------------------------------------------------------
log_info "验证本地 gbrain 功能..."

if command -v gbrain &> /dev/null; then
  log_pass "gbrain 命令可用 ($(gbrain --version))"
else
  log_fail "gbrain 命令不可用"
fi

if command -v bun &> /dev/null; then
  log_pass "bun 命令可用 ($(bun --version))"
else
  log_fail "bun 命令不可用"
fi

# 模拟 Hermes 环境测试
SIM_TEST=$(env -i HOME=/Users/jack/.hermes/profiles/main/home PATH=/usr/bin:/bin:/usr/local/bin SHELL=/bin/zsh USER=jack LOGNAME=jack TERM=xterm-256color zsh -c '
source ~/.zshenv 2>/dev/null
if [[ -n "${GBRAIN_HOME:-}" && -n "${DASHSCOPE_API_KEY:-}" ]]; then
  echo "HERMES_OK"
else
  echo "HERMES_FAIL"
fi
' 2>&1)

if echo "$SIM_TEST" | grep -q "HERMES_OK"; then
  log_pass "模拟 Hermes 环境：gbrain 配置可继承"
else
  log_fail "模拟 Hermes 环境：gbrain 配置丢失"
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo "                         验证结果汇总"
echo "======================================================================"
echo -e "通过: ${GREEN}$PASS${NC}  |  失败: ${RED}$FAIL${NC}"

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}所有检查通过 ✅${NC}"
  echo ""
  echo "gbrain 配置说明："
  echo "  - 全局配置: ~/.zshrc (GBRAIN_HOME + DASHSCOPE_API_KEY)"
  echo "  - gbrain 配置: ~/.gbrain/config.json"
  echo "  - Profile home 配置: ~/.hermes/profiles/*/home/.zshenv"
  echo "  - 新增 profile 时自动继承（通过 profile home .zshenv）"
  exit 0
else
  echo -e "${RED}存在 $FAIL 个问题${NC}"
  if ! $FIX; then
    echo "运行 'bash tools/fix-gbrain-hermes-profiles.sh --fix' 自动修复"
  fi
  exit 1
fi
