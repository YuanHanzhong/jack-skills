#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 跨平台 VS Code 用户配置目录
function getVSCodeUserDir() {
  const home = homedir();
  switch (platform()) {
    case 'win32': {
      // Windows: %APPDATA%\Code\User
      // 标准路径: C:\Users\<username>\AppData\Roaming\Code\User
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, 'Code', 'User');
    }
    case 'darwin': return path.join(home, 'Library', 'Application Support', 'Code', 'User');
    default:       return path.join(home, '.config', 'Code', 'User');
  }
}

// 配置文件路径
const vscodeUserDir = getVSCodeUserDir();
const projectConfigPath = path.join(__dirname, '..', '.vscode', 'settings.json');
const userConfigPath = path.join(vscodeUserDir, 'settings.json');
const backupPath = path.join(vscodeUserDir, 'settings.json.backup');

console.log('📝 VSCode 配置合并工具\n');
console.log(`项目配置：${projectConfigPath}`);
console.log(`用户配置：${userConfigPath}\n`);

// 读取项目配置
let projectConfig;
try {
  const projectContent = fs.readFileSync(projectConfigPath, 'utf-8');
  projectConfig = JSON.parse(projectContent);
  console.log('✅ 项目配置读取成功');
} catch (err) {
  console.error('❌ 读取项目配置失败:', err.message);
  process.exit(1);
}

// 读取用户配置（如果存在）
let userConfig = {};
if (fs.existsSync(userConfigPath)) {
  try {
    const userContent = fs.readFileSync(userConfigPath, 'utf-8');
    userConfig = JSON.parse(userContent);
    console.log('✅ 用户配置读取成功');

    // 备份用户配置
    fs.copyFileSync(userConfigPath, backupPath);
    console.log(`✅ 用户配置已备份到：${backupPath}\n`);
  } catch (err) {
    console.error('❌ 读取用户配置失败:', err.message);
    process.exit(1);
  }
} else {
  console.log('⚠️  用户配置文件不存在，将创建新文件\n');
}

// 合并配置
const mergedConfig = { ...userConfig };

// 更新 markdown-preview-enhanced 所有配置
const mpeKeys = Object.keys(projectConfig).filter(k => k.startsWith('markdown-preview-enhanced'));
console.log('📌 更新 Markdown Preview Enhanced 配置:');
mpeKeys.forEach(key => {
  if (mergedConfig[key] !== projectConfig[key]) {
    console.log(`   ${key}: ${JSON.stringify(mergedConfig[key])} → ${JSON.stringify(projectConfig[key])}`);
  } else {
    console.log(`   ${key}: ✓ (无变化)`);
  }
  mergedConfig[key] = projectConfig[key];
});

// 合并 workbench.editorAssociations
console.log('\n📌 更新 workbench.editorAssociations:');
const userEditorAssoc = mergedConfig.workbench?.editorAssociations || {};
const projectEditorAssoc = projectConfig.workbench?.editorAssociations || {};

// 保留用户配置中的非 Markdown 关联
const preservedAssoc = {};
for (const [pattern, editor] of Object.entries(userEditorAssoc)) {
  if (!pattern.toLowerCase().includes('md') && !pattern.endsWith('.md')) {
    preservedAssoc[pattern] = editor;
  }
}

// 合并用户保留的配置 + 项目的 Markdown 配置
const finalEditorAssoc = {
  ...preservedAssoc,
  ...projectEditorAssoc
};

console.log(`   保留了 ${Object.keys(preservedAssoc).length} 项用户自定义关联`);
console.log(`   添加/更新了 ${Object.keys(projectEditorAssoc).length} 项 Markdown 关联`);

if (!mergedConfig.workbench) {
  mergedConfig.workbench = {};
}
mergedConfig.workbench.editorAssociations = finalEditorAssoc;

// 写入合并后的配置
try {
  fs.writeFileSync(userConfigPath, JSON.stringify(mergedConfig, null, 2) + '\n', 'utf-8');
  console.log(`\n✅ 配置已写入用户级别：${userConfigPath}`);
} catch (err) {
  console.error(`\n❌ 写入配置失败: ${err.message}`);
  process.exit(1);
}

// 统计信息
console.log('\n📊 合并统计:');
console.log(`   总配置项数：${Object.keys(mergedConfig).length}`);
console.log(`   MPE 配置项：${mpeKeys.length}`);
console.log(`   编辑器关联：${Object.keys(finalEditorAssoc).length}`);
console.log(`   其他个人设置：${Object.keys(mergedConfig).filter(k => !k.startsWith('markdown-preview-enhanced') && k !== 'workbench').length}`);

console.log('\n✨ 合并完成！');
console.log('💡 提示：重启 VSCode 使配置生效');
console.log(`🔄 如需恢复：复制 ${backupPath} 回到 ${userConfigPath}`);
