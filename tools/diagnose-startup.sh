#!/usr/bin/env bash
# Claude Code 启动性能诊断脚本
# 用途：清理缓存、测试网络、监控启动时间

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Claude Code 启动性能诊断工具"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 备份缓存
echo "📦 Step 1: 备份现有缓存..."
timestamp=$(date +%Y%m%d-%H%M%S)

if [ -d ~/.claude/cache ]; then
  mv ~/.claude/cache ~/.claude/cache.backup-$timestamp
  echo "  ✅ 已备份：~/.claude/cache.backup-$timestamp"
else
  echo "  ⚠️  缓存目录不存在"
fi

if [ -f ~/.claude/stats-cache.json ]; then
  mv ~/.claude/stats-cache.json ~/.claude/stats-cache.json.backup-$timestamp
  echo "  ✅ 已备份：~/.claude/stats-cache.json.backup-$timestamp"
else
  echo "  ⚠️  stats-cache.json 不存在"
fi

echo ""

# 网络诊断
echo "🌐 Step 2: 网络诊断..."

echo "  测试 Anthropic API 域名解析..."
if command -v nslookup &> /dev/null; then
  time nslookup api.anthropic.com || echo "  ⚠️  DNS 解析失败"
else
  echo "  ⚠️  nslookup 命令不可用"
fi

echo ""
echo "  测试 Statsig API 域名解析..."
if command -v nslookup &> /dev/null; then
  time nslookup api.statsig.com || echo "  ⚠️  DNS 解析失败"
else
  echo "  ⚠️  nslookup 命令不可用"
fi

echo ""

# 启动时间测试
echo "⏱️  Step 3: 启动时间测试（3 次）..."
echo "  即将连续启动 Claude Code 3 次，请在每次启动后立即退出（Ctrl+C 或 /exit）"
echo ""

for i in {1..3}; do
  echo "  🚀 测试 $i/3..."

  # 记录启动时间
  start_time=$(date +%s%3N)

  # 启动 Claude Code（注意：这会进入交互模式，需要用户手动退出）
  # claude

  end_time=$(date +%s%3N)
  duration=$((end_time - start_time))

  echo "  ⏱️  启动耗时：${duration}ms"

  # 提取最新日志的 showSetupScreens 耗时
  latest_log=$(ls -t ~/.claude/debug/*.txt | head -1)
  if [ -f "$latest_log" ]; then
    setup_time=$(grep "showSetupScreens() completed" "$latest_log" | tail -1 | grep -oP '\d+ms' || echo "未找到")
    echo "  📊 showSetupScreens 耗时：$setup_time"
  fi

  echo ""
  sleep 2
done

echo ""

# 日志分析
echo "📋 Step 4: 分析最近 5 次启动日志..."
echo ""

for log in $(ls -t ~/.claude/debug/*.txt | head -5); do
  session_id=$(basename "$log" .txt)
  setup_time=$(grep "showSetupScreens() completed" "$log" | tail -1 | grep -oP '\d+ms' || echo "未找到")
  http_error=$(grep -c "node:_http_client" "$log" || echo "0")

  if [ "$http_error" -gt 0 ]; then
    status="🔴 异常（HTTP 错误）"
  else
    status="✅ 正常"
  fi

  echo "  ${session_id:0:8}: $setup_time - $status"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  诊断完成！"
echo ""
echo "  📊 结果解读："
echo "    - showSetupScreens < 2000ms：正常"
echo "    - showSetupScreens > 10000ms：异常（网络超时）"
echo ""
echo "  📁 完整报告：04_ADS/2_进行中/26-0215-10-exec-task_plan-Claude启动性能优化.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
