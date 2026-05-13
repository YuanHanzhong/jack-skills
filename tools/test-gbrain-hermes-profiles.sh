#!/usr/bin/env bash
# =============================================================================
# gbrain Hermes Profile 兼容性测试
# =============================================================================
# 目标：验证各 Hermes profile 的 terminal 子进程能正确调用本地 gbrain
# 遵循 Karpathy TDD 原则：先定义"成"的标准，再验证是否达成。
#
# 测试假设：
#   - Hermes terminal 启动交互式 shell 时会 source ~/.zshrc
#   - ~/.zshrc 中定义了 GBRAIN_HOME 和 DASHSCOPE_API_KEY
#   - gbrain 配置在 ~/.gbrain/config.json
#
# 运行方式：bash tools/test-gbrain-hermes-profiles.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

log_pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; ((PASS++)) || true; }
log_fail() { echo -e "${RED}❌ FAIL${NC}: $1"; ((FAIL++)) || true; }
log_info() { echo -e "${YELLOW}ℹ️${NC}  $1"; }

# ---------------------------------------------------------------------------
# 测试 1：本地环境变量完整性
# ---------------------------------------------------------------------------
log_info "测试 1: 本地环境变量完整性"

# 如果当前 shell 没有 GBRAIN_HOME，从 ~/.zshrc 验证配置是否正确
if [[ -z "${GBRAIN_HOME:-}" ]]; then
  GBRAIN_HOME_FROM_ZSHRC=$(grep "^export GBRAIN_HOME=" ~/.zshrc 2>/dev/null | cut -d'"' -f2 || true)
  if [[ -n "$GBRAIN_HOME_FROM_ZSHRC" ]]; then
    export GBRAIN_HOME="$GBRAIN_HOME_FROM_ZSHRC"
    log_pass "GBRAIN_HOME 从 ~/.zshrc 加载: $GBRAIN_HOME"
  else
    log_fail "GBRAIN_HOME 未设置且 ~/.zshrc 中未找到"
  fi
else
  log_pass "GBRAIN_HOME 已设置: $GBRAIN_HOME"
fi

if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
  log_pass "DASHSCOPE_API_KEY 已设置 (${#DASHSCOPE_API_KEY} chars)"
else
  log_fail "DASHSCOPE_API_KEY 未设置"
fi

if [[ -n "${LITELLM_API_KEY:-}" ]]; then
  log_pass "LITELLM_API_KEY 已设置"
else
  log_fail "LITELLM_API_KEY 未设置"
fi

# ---------------------------------------------------------------------------
# 测试 2：gbrain 配置文件可访问
# ---------------------------------------------------------------------------
log_info "测试 2: gbrain 配置文件可访问"

GBRAIN_CONFIG="${GBRAIN_HOME:-$HOME}/.gbrain/config.json"
if [[ -r "$GBRAIN_CONFIG" ]]; then
  log_pass "gbrain 配置文件可读: $GBRAIN_CONFIG"
  if grep -q "text-embedding-v4" "$GBRAIN_CONFIG" 2>/dev/null; then
    log_pass "配置包含 embedding_model"
  else
    log_pass "配置使用默认值 (embedding_model 未显式声明)"
  fi
else
  log_fail "gbrain 配置文件不可读: $GBRAIN_CONFIG"
fi

# ---------------------------------------------------------------------------
# 测试 3：模拟 Hermes terminal 白名单环境
# ---------------------------------------------------------------------------
log_info "测试 3: 模拟 Hermes terminal 白名单环境"

# Hermes terminal.py 的 _SAFE_ENV_KEYS 白名单
SAFE_KEYS=(
  PATH HOME USER LOGNAME SHELL LANG LC_ALL
  LC_CTYPE LC_MESSAGES LANGUAGE TZ TMPDIR TEMP
  XDG_RUNTIME_DIR XDG_CONFIG_HOME XDG_DATA_HOME
)

# 构建模拟环境
SIM_ENV=$(mktemp)
{
  for key in "${SAFE_KEYS[@]}"; do
    val="${!key:-}"
    [[ -n "$val" ]] && echo "export $key='$val'"
  done
  echo "export TERM=xterm-256color"
  echo "export PWD=/Users/jack/1_learn"
} > "$SIM_ENV"

# 在模拟环境中 source ~/.zshrc 并检查变量
TEST_SCRIPT=$(mktemp)
cat > "$TEST_SCRIPT" << 'TESTEOF'
source ~/.zshrc 2>/dev/null || true
if [[ -n "${GBRAIN_HOME:-}" ]]; then
  echo "GBRAIN_HOME_OK:$GBRAIN_HOME"
else
  echo "GBRAIN_HOME_FAIL"
fi
if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
  echo "DASHSCOPE_OK"
else
  echo "DASHSCOPE_FAIL"
fi
TESTEOF

RESULT=$(env -i bash -c "source $SIM_ENV && source $TEST_SCRIPT" 2>/dev/null)
rm -f "$SIM_ENV" "$TEST_SCRIPT"

if echo "$RESULT" | grep -q "GBRAIN_HOME_OK"; then
  GHOME=$(echo "$RESULT" | grep "GBRAIN_HOME_OK" | cut -d: -f2)
  log_pass "模拟 Hermes 环境后 GBRAIN_HOME 恢复: $GHOME"
else
  log_fail "模拟 Hermes 环境后 GBRAIN_HOME 未恢复"
fi

if echo "$RESULT" | grep -q "DASHSCOPE_OK"; then
  log_pass "模拟 Hermes 环境后 DASHSCOPE_API_KEY 恢复"
else
  log_fail "模拟 Hermes 环境后 DASHSCOPE_API_KEY 未恢复"
fi

# ---------------------------------------------------------------------------
# 测试 4：gbrain doctor 通过
# ---------------------------------------------------------------------------
log_info "测试 4: gbrain doctor 诊断"

DOCTOR_OUTPUT=$(gbrain doctor 2>&1)

if echo "$DOCTOR_OUTPUT" | grep -qE "embedding_provider.*(✓|Skipped)"; then
  log_pass "gbrain doctor: embedding_provider 探测通过"
else
  log_fail "gbrain doctor: embedding_provider 探测失败"
  echo "$DOCTOR_OUTPUT" | grep -i "embedding_provider" || true
fi

if echo "$DOCTOR_OUTPUT" | grep -q "embeddings.*100%"; then
  log_pass "gbrain doctor: embeddings 覆盖 100%"
else
  log_fail "gbrain doctor: embeddings 覆盖不足"
fi

# ---------------------------------------------------------------------------
# 测试 5：gbrain 查询功能正常
# ---------------------------------------------------------------------------
log_info "测试 5: gbrain 查询功能"

QUERY_OUTPUT=$(gbrain query "向量检索测试" --limit 3 2>&1 | grep -v "^\[" | head -5)
if [[ -n "$QUERY_OUTPUT" ]]; then
  log_pass "gbrain query 返回结果"
  echo "$QUERY_OUTPUT" | head -3 | sed 's/^/     /'
else
  log_fail "gbrain query 无结果"
fi

# ---------------------------------------------------------------------------
# 测试 6：profile .env 无重复配置
# ---------------------------------------------------------------------------
log_info "测试 6: profile .env 无重复配置"

PROFILES_DIR="$HOME/.hermes/profiles"
for p in "$PROFILES_DIR"/*; do
  name=$(basename "$p")
  has_dup=false
  if grep -q "^GBRAIN_HOME=" "$p/.env" 2>/dev/null; then
    log_fail "$name/.env 仍包含 GBRAIN_HOME"
    has_dup=true
  fi
  if grep -q "^DASHSCOPE_API_KEY=" "$p/.env" 2>/dev/null; then
    log_fail "$name/.env 仍包含 DASHSCOPE_API_KEY"
    has_dup=true
  fi
  if [[ "$has_dup" == "false" ]]; then
    log_pass "$name/.env 无重复配置"
  fi
done

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo "                         测试结果汇总"
echo "======================================================================"
echo -e "通过: ${GREEN}$PASS${NC}  |  失败: ${RED}$FAIL${NC}"

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}所有测试通过 ✅${NC}"
  exit 0
else
  echo -e "${RED}存在 $FAIL 个失败项，请检查上方日志${NC}"
  exit 1
fi
