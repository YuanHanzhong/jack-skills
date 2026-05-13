#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';

const home = os.homedir();
const configPath = path.join(home, '.claude.json');

try {
  // 读取配置文件
  const content = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(content);

  // 检查是否存在 zai-mcp-server
  if (!config.mcpServers || !config.mcpServers['zai-mcp-server']) {
    console.log('✅ zai-mcp-server 已经不存在于配置中');
    process.exit(0);
  }

  // 删除 zai-mcp-server
  delete config.mcpServers['zai-mcp-server'];

  // 写回文件
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  console.log('✅ 成功从用户级配置中移除 zai-mcp-server');
  console.log(`📁 配置文件: ${configPath}`);
  console.log('\n⚠️  请重启 Claude Code 以使更改生效');

} catch (error) {
  console.error('❌ 操作失败:', error.message);
  process.exit(1);
}
