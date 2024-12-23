/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./extension.js":
/*!**********************!*\
  !*** ./extension.js ***!
  \**********************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

eval("const vscode = __webpack_require__(/*! vscode */ \"vscode\");\nconst fs = __webpack_require__(/*! fs */ \"fs\");\nconst path = __webpack_require__(/*! path */ \"path\");\nconst util = __webpack_require__(/*! util */ \"util\");\nconst exec = util.promisify((__webpack_require__(/*! child_process */ \"child_process\").exec));\n\n// 获取包管理器类型\nasync function getPackageManager(projectPath) {\n    const lockFiles = {\n        'pnpm-lock.yaml': 'pnpm',\n        'yarn.lock': 'yarn',\n        'package-lock.json': 'npm',\n    };\n\n    for (const [file, manager] of Object.entries(lockFiles)) {\n        if (fs.existsSync(path.join(projectPath, file))) {\n            return manager;\n        }\n    }\n    return 'npm'; // 默认使用 npm\n}\n\n// 检查并切换 Node 版本\nasync function switchNodeVersion(projectPath) {\n    try {\n        const nvmrcPath = path.join(projectPath, '.nvmrc');\n        if (fs.existsSync(nvmrcPath)) {\n            const requiredVersion = fs.readFileSync(nvmrcPath, 'utf8').trim();\n            const currentVersion = (await exec('node -v')).stdout.trim();\n            \n            const requiredMajor = requiredVersion.match(/v?(\\d+)/)[1];\n            const currentMajor = currentVersion.match(/v?(\\d+)/)[1];\n\n            if (requiredMajor !== currentMajor) {\n                // 获取环境变量\n                const home = process.env.HOME || process.env.USERPROFILE;\n                const nvmScript = path.join(home, '.nvm/nvm.sh');\n                const bashProfile = path.join(home, '.bash_profile');\n                const zshrc = path.join(home, '.zshrc');\n\n                let shell = '/bin/bash';\n                let initScript = '';\n\n                // 检查并加载 shell 配置文件\n                if (fs.existsSync(zshrc)) {\n                    shell = '/bin/zsh';\n                    initScript = `source ${zshrc} && `;\n                } else if (fs.existsSync(bashProfile)) {\n                    initScript = `source ${bashProfile} && `;\n                }\n\n                if (fs.existsSync(nvmScript)) {\n                    // 构建完整的命令\n                    const cmd = `${initScript}source \"${nvmScript}\" && nvm use ${requiredMajor} && export NVM_DIR=\"$HOME/.nvm\" && [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"`;\n                    \n                    // 执行命令并获取新的 node 路径\n                    const { stdout: nvmOutput } = await exec(cmd, { shell });\n                    console.log('nvm output:', nvmOutput);\n\n                    // 更新当前进程的 PATH\n                    const { stdout: nodePath } = await exec('which node', { shell });\n                    const nodeDir = path.dirname(nodePath.trim());\n                    process.env.PATH = `${nodeDir}:${process.env.PATH}`;\n\n                    // 验证版本切换\n                    const { stdout: newVersion } = await exec('node -v');\n                    console.log(`Node version switched to: ${newVersion.trim()}`);\n                } else {\n                    console.warn('未找到 nvm 安装，跳过 Node 版本切换');\n                }\n            }\n        }\n    } catch (error) {\n        console.warn(`Node版本切换失败 (非致命错误): ${error.message}`);\n    }\n}\n\nasync function updateDependency(projectPath, packageName, version) {\n    const packageJsonPath = path.join(projectPath, 'package.json');\n    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));\n    \n    // 更新依赖版本\n    if (packageJson.dependencies && packageJson.dependencies[packageName]) {\n        packageJson.dependencies[packageName] = version;\n    } else if (packageJson.devDependencies && packageJson.devDependencies[packageName]) {\n        packageJson.devDependencies[packageName] = version;\n    }\n\n    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));\n}\n\nasync function updateProjectDependencies(projectPath, packages, token) {\n    try {\n        // 检查是否已取消\n        if (token.isCancellationRequested) {\n            throw new Error('操作已取消');\n        }\n\n        // 切换 Node 版本\n        await switchNodeVersion(projectPath);\n\n        if (token.isCancellationRequested) {\n            throw new Error('操作已取消');\n        }\n\n        // 获取包管理器\n        const packageManager = await getPackageManager(projectPath);\n        \n        // 更新 package.json 中的版本\n        for (const pkg of packages) {\n            if (token.isCancellationRequested) {\n                throw new Error('操作已取消');\n            }\n            const [name, version] = pkg.split('@').filter(Boolean);\n            await updateDependency(projectPath, name, version);\n        }\n\n        if (token.isCancellationRequested) {\n            throw new Error('操作已取消');\n        }\n\n        // 执行安装\n        const installCmd = {\n            npm: 'npm install',\n            yarn: 'yarn install',\n            pnpm: 'pnpm install'\n        }[packageManager];\n\n        await exec(installCmd, { cwd: projectPath });\n\n        if (token.isCancellationRequested) {\n            throw new Error('操作已取消');\n        }\n\n        // Git 操作\n        await exec('git add .', { cwd: projectPath });\n        await exec('git commit -m \"feat: 更新依赖\"', { cwd: projectPath });\n        await exec('git push', { cwd: projectPath });\n\n        return true;\n    } catch (error) {\n        if (error.message === '操作已取消') {\n            throw error;\n        }\n        throw new Error(`更新失败: ${error.message}`);\n    }\n}\n\nasync function getGitBranch(projectPath) {\n    try {\n        const { stdout } = await exec('git rev-parse --abbrev-ref HEAD', {\n            cwd: projectPath\n        });\n        return stdout.trim();\n    } catch (error) {\n        return null;\n    }\n}\n\nclass ProjectItem extends vscode.TreeItem {\n    constructor(label, projectPath, provider) {\n        super('', vscode.TreeItemCollapsibleState.None);\n        this.path = projectPath;\n        this.contextValue = 'project';\n        this.tooltip = projectPath;\n        this.provider = provider;\n        this.projectName = path.basename(projectPath);\n        this.selected = false;\n        \n        // 添加点击命令\n        this.command = {\n            title: 'Toggle Selection',\n            command: 'dependency-updater.toggleProject',\n            arguments: [this]\n        };\n        \n        this.updateBranchInfo();\n    }\n\n    async updateBranchInfo() {\n        const branch = await getGitBranch(this.path);\n        if (branch) {\n            this.iconPath = new vscode.ThemeIcon(this.selected ? 'check' : 'git-branch');\n            this.label = this.projectName;\n            this.description = `on ${branch}`;\n            \n            // 分支名用绿色\n            if (this.selected) {\n                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);\n                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));\n            } else {\n                this.resourceUri = vscode.Uri.parse(`project:${this.projectName}`);\n            }\n        } else {\n            // 文件名用红色\n            this.iconPath = new vscode.ThemeIcon(this.selected ? 'check' : 'folder');\n            this.label = this.projectName;\n            this.description = '';\n            \n            if (this.selected) {\n                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);\n                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));\n            }\n        }\n        \n        if (this.provider) {\n            this.provider.refresh();\n        }\n    }\n\n    toggleSelection() {\n        this.selected = !this.selected;\n        this.updateBranchInfo();\n    }\n}\n\nclass NoProjectsItem extends vscode.TreeItem {\n    constructor() {\n        super('暂无项目，请点击右上角按钮选择项目文件夹', vscode.TreeItemCollapsibleState.None);\n        this.iconPath = new vscode.ThemeIcon('folder-library');\n    }\n}\n\nclass DependencyUpdaterProvider {\n    constructor() {\n        this._onDidChangeTreeData = new vscode.EventEmitter();\n        this.onDidChangeTreeData = this._onDidChangeTreeData.event;\n        this.projects = [];\n    }\n\n    refresh() {\n        this._onDidChangeTreeData.fire();\n    }\n\n    getTreeItem(element) {\n        return element;\n    }\n\n    getChildren() {\n        if (this.projects.length === 0) {\n            return [new NoProjectsItem()];\n        }\n        return this.projects;\n    }\n\n    async setProjects(folderPath) {\n        try {\n            this.projects = [];\n            const items = fs.readdirSync(folderPath);\n\n            for (const item of items) {\n                const itemPath = path.join(folderPath, item);\n                if (fs.statSync(itemPath).isDirectory()) {\n                    const packageJsonPath = path.join(itemPath, 'package.json');\n                    if (fs.existsSync(packageJsonPath)) {\n                        // 传入 provider 实例以便刷新\n                        const projectItem = new ProjectItem(item, itemPath, this);\n                        this.projects.push(projectItem);\n                    }\n                }\n            }\n\n            // 更新视图状态\n            await vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', this.projects.length > 0);\n            \n            this.refresh();\n            if (this.projects.length === 0) {\n                vscode.window.showInformationMessage('未找到包含 package.json 的项目');\n            }\n        } catch (error) {\n            vscode.window.showErrorMessage(`读取文件夹失败: ${error.message}`);\n        }\n    }\n\n    clearProjects() {\n        this.projects = [];\n        vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', false);\n        this.refresh();\n    }\n\n    getSelectedProjects() {\n        return this.projects.filter(project => project.selected);\n    }\n}\n\nclass PackageInfoItem extends vscode.TreeItem {\n    constructor(packageInfo, index) {\n        super(packageInfo, vscode.TreeItemCollapsibleState.None);\n        this.iconPath = new vscode.ThemeIcon('package');\n        this.contextValue = 'package';\n        this.index = index;\n    }\n}\n\nclass PackageInputProvider {\n    constructor() {\n        this._onDidChangeTreeData = new vscode.EventEmitter();\n        this.onDidChangeTreeData = this._onDidChangeTreeData.event;\n        this.packages = [];\n    }\n\n    getTreeItem(element) {\n        return element;\n    }\n\n    getChildren() {\n        return this.packages.length === 0 \n            ? []\n            : this.packages.map((pkg, index) => new PackageInfoItem(pkg, index));\n    }\n\n    addPackage(info) {\n        this.packages.push(info);\n        this._onDidChangeTreeData.fire();\n    }\n\n    editPackage(index, info) {\n        this.packages[index] = info;\n        this._onDidChangeTreeData.fire();\n    }\n\n    deletePackage(index) {\n        this.packages.splice(index, 1);\n        this._onDidChangeTreeData.fire();\n    }\n\n    clearPackages() {\n        this.packages = [];\n        this._onDidChangeTreeData.fire();\n    }\n}\n\nasync function activate(context) {\n    const provider = new DependencyUpdaterProvider();\n    const inputProvider = new PackageInputProvider();\n    \n    // 先注册所有命令\n    const commands = [\n        vscode.commands.registerCommand('dependency-updater.addPackage', async () => {\n            const result = await vscode.window.showInputBox({\n                placeHolder: '输入包名@版本号，例如：lodash@4.17.21',\n                validateInput: text => {\n                    return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';\n                }\n            });\n\n            if (result) {\n                inputProvider.addPackage(result);\n            }\n        }),\n        vscode.commands.registerCommand('dependency-updater.selectFolder', async () => {\n            const result = await vscode.window.showOpenDialog({\n                canSelectFolders: true,\n                canSelectFiles: false,\n                canSelectMany: false,\n                title: '选择项目根目录'\n            });\n\n            if (result && result[0]) {\n                provider.setProjects(result[0].fsPath);\n            }\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.clearProjects', () => {\n            provider.clearProjects();\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.editPackage', async (item) => {\n            const result = await vscode.window.showInputBox({\n                value: item.label,\n                placeHolder: '输入包名@版本号，例如：lodash@4.17.21',\n                validateInput: text => {\n                    return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';\n                }\n            });\n\n            if (result) {\n                inputProvider.editPackage(item.index, result);\n            }\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.deletePackage', (item) => {\n            inputProvider.deletePackage(item.index);\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.clearPackages', () => {\n            inputProvider.clearPackages();\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.toggleProject', (item) => {\n            if (item instanceof ProjectItem) {\n                item.toggleSelection();\n                provider.refresh();\n            }\n        }),\n\n        // 添加更新依赖命令\n        vscode.commands.registerCommand('dependency-updater.updateDependencies', async () => {\n            const selectedProjects = provider.getSelectedProjects();\n            const packages = inputProvider.packages;\n\n            // 检查是否有选中的项目和包\n            if (!selectedProjects.length) {\n                vscode.window.showInformationMessage('请选择要更新的项目');\n                return;\n            }\n\n            if (!packages.length) {\n                vscode.window.showInformationMessage('请添加要更新的依赖包');\n                return;\n            }\n\n            // 显示更新进度\n            return vscode.window.withProgress({\n                location: vscode.ProgressLocation.Notification,\n                title: \"批量更新依赖\",\n                cancellable: true  // 启用取消功能\n            }, async (progress, token) => {\n                try {\n                    const total = selectedProjects.length;\n                    for (let i = 0; i < total; i++) {\n                        if (token.isCancellationRequested) {\n                            vscode.window.showInformationMessage('已取消更新操作');\n                            return;\n                        }\n\n                        const project = selectedProjects[i];\n                        progress.report({ \n                            message: `正在更新「${project.projectName}」(${i + 1}/${total})`,\n                            increment: (100 / total)\n                        });\n                        \n                        await updateProjectDependencies(project.path, packages, token);\n                    }\n                    \n                    vscode.window.showInformationMessage(`成功更新 ${total} 个项目`);\n                } catch (error) {\n                    if (error.message === '操作已取消') {\n                        vscode.window.showInformationMessage('已取消更新操作');\n                    } else {\n                        vscode.window.showErrorMessage(`批量更新失败: ${error.message}`);\n                    }\n                }\n            });\n        }),\n\n        vscode.commands.registerCommand('dependency-updater.updateProject', async (item) => {\n            if (!(item instanceof ProjectItem)) {\n                return;\n            }\n\n            const packages = inputProvider.packages;\n            if (!packages.length) {\n                vscode.window.showInformationMessage('请先添加要更新的包');\n                return;\n            }\n\n            return vscode.window.withProgress({\n                location: vscode.ProgressLocation.Notification,\n                title: `正在更新项目「${item.projectName}」`,\n                cancellable: true  // 启用取消功能\n            }, async (progress, token) => {\n                try {\n                    await updateProjectDependencies(item.path, packages, token);\n                    vscode.window.showInformationMessage(`项目「${item.projectName}」更新完成`);\n                } catch (error) {\n                    if (error.message === '操作已取消') {\n                        vscode.window.showInformationMessage('已取消更新操作');\n                    } else {\n                        vscode.window.showErrorMessage(error.message);\n                    }\n                }\n            });\n        })\n    ];\n    \n    // 然后注册视图\n    const views = [\n        vscode.window.createTreeView('packageInputView', {\n            treeDataProvider: inputProvider,\n            showCollapseAll: true\n        }),\n        vscode.window.createTreeView('dependencyUpdaterView', {\n            treeDataProvider: provider,\n            showCollapseAll: true\n        })\n    ];\n\n    // 添加到订阅列表\n    context.subscriptions.push(...commands, ...views);\n\n    // 初始化上下文状态\n    await vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', false);\n}\n\nmodule.exports = {\n    activate\n};\n\n\n\n//# sourceURL=webpack://dependency-updater/./extension.js?");

/***/ }),

/***/ "vscode":
/*!*************************!*\
  !*** external "vscode" ***!
  \*************************/
/***/ ((module) => {

"use strict";
module.exports = require("vscode");

/***/ }),

/***/ "child_process":
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ "fs":
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ "path":
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ "util":
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
/***/ ((module) => {

"use strict";
module.exports = require("util");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./extension.js");
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;