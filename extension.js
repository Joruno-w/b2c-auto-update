const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

// 获取包管理器类型
async function getPackageManager(projectPath) {
    const lockFiles = {
        'package-lock.json': 'npm',
        'yarn.lock': 'yarn',
        'pnpm-lock.yaml': 'pnpm'
    };

    for (const [file, manager] of Object.entries(lockFiles)) {
        if (fs.existsSync(path.join(projectPath, file))) {
            return manager;
        }
    }
    return 'npm'; // 默认使用 npm
}

// 检查并切换 Node 版本
async function switchNodeVersion(projectPath) {
    try {
        const nvmrcPath = path.join(projectPath, '.nvmrc');
        if (fs.existsSync(nvmrcPath)) {
            const requiredVersion = fs.readFileSync(nvmrcPath, 'utf8').trim();
            const currentVersion = (await exec('node -v')).stdout.trim();
            
            const requiredMajor = requiredVersion.match(/v?(\d+)/)[1];
            const currentMajor = currentVersion.match(/v?(\d+)/)[1];

            if (requiredMajor !== currentMajor) {
                await exec(`nvm use ${requiredVersion}`);
            }
        }
    } catch (error) {
        throw new Error(`Node版本切换失败: ${error.message}`);
    }
}

async function updateDependency(projectPath, packageName, version) {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // 更新依赖版本
    if (packageJson.dependencies && packageJson.dependencies[packageName]) {
        packageJson.dependencies[packageName] = version;
    } else if (packageJson.devDependencies && packageJson.devDependencies[packageName]) {
        packageJson.devDependencies[packageName] = version;
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

async function updateProjectDependencies(projectPath, packages, token) {
    try {
        // 检查是否已取消
        if (token.isCancellationRequested) {
            throw new Error('操作已取消');
        }

        // 切换 Node 版本
        await switchNodeVersion(projectPath);

        if (token.isCancellationRequested) {
            throw new Error('操作已取消');
        }

        // 获取包管理器
        const packageManager = await getPackageManager(projectPath);
        
        // 更新 package.json 中的版本
        for (const pkg of packages) {
            if (token.isCancellationRequested) {
                throw new Error('操作已取消');
            }
            const [name, version] = pkg.split('@').filter(Boolean);
            await updateDependency(projectPath, name, version);
        }

        if (token.isCancellationRequested) {
            throw new Error('操作已取消');
        }

        // 执行安装
        const installCmd = {
            npm: 'npm install',
            yarn: 'yarn install',
            pnpm: 'pnpm install'
        }[packageManager];

        await exec(installCmd, { cwd: projectPath });

        if (token.isCancellationRequested) {
            throw new Error('操作已取消');
        }

        // Git 操作
        await exec('git add .', { cwd: projectPath });
        await exec('git commit -m "feat: 更新依赖"', { cwd: projectPath });
        await exec('git push', { cwd: projectPath });

        return true;
    } catch (error) {
        if (error.message === '操作已取消') {
            throw error;
        }
        throw new Error(`更新失败: ${error.message}`);
    }
}

async function getGitBranch(projectPath) {
    try {
        const { stdout } = await exec('git rev-parse --abbrev-ref HEAD', {
            cwd: projectPath
        });
        return stdout.trim();
    } catch (error) {
        return null;
    }
}

class ProjectItem extends vscode.TreeItem {
    constructor(label, projectPath, provider) {
        super('', vscode.TreeItemCollapsibleState.None);
        this.path = projectPath;
        this.contextValue = 'project';
        this.tooltip = projectPath;
        this.provider = provider;
        this.projectName = path.basename(projectPath);
        this.selected = false;
        
        // 添加点击命令
        this.command = {
            title: 'Toggle Selection',
            command: 'dependency-updater.toggleProject',
            arguments: [this]
        };
        
        this.updateBranchInfo();
    }

    async updateBranchInfo() {
        const branch = await getGitBranch(this.path);
        if (branch) {
            this.iconPath = new vscode.ThemeIcon(this.selected ? 'check' : 'git-branch');
            this.label = this.projectName;
            this.description = `on ${branch}`;
            
            // 分支名用绿色
            if (this.selected) {
                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
            } else {
                this.resourceUri = vscode.Uri.parse(`project:${this.projectName}`);
            }
        } else {
            // 文件名用红色
            this.iconPath = new vscode.ThemeIcon(this.selected ? 'check' : 'folder');
            this.label = this.projectName;
            this.description = '';
            
            if (this.selected) {
                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
            }
        }
        
        if (this.provider) {
            this.provider.refresh();
        }
    }

    toggleSelection() {
        this.selected = !this.selected;
        this.updateBranchInfo();
    }
}

class NoProjectsItem extends vscode.TreeItem {
    constructor() {
        super('暂无项目，请点击右上角按钮选择项目文件夹', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('folder-library');
    }
}

class DependencyUpdaterProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.projects = [];
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        if (this.projects.length === 0) {
            return [new NoProjectsItem()];
        }
        return this.projects;
    }

    async setProjects(folderPath) {
        try {
            this.projects = [];
            const items = fs.readdirSync(folderPath);

            for (const item of items) {
                const itemPath = path.join(folderPath, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    const packageJsonPath = path.join(itemPath, 'package.json');
                    if (fs.existsSync(packageJsonPath)) {
                        // 传入 provider 实例以便刷新
                        const projectItem = new ProjectItem(item, itemPath, this);
                        this.projects.push(projectItem);
                    }
                }
            }

            // 更新视图状态
            await vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', this.projects.length > 0);
            
            this.refresh();
            if (this.projects.length === 0) {
                vscode.window.showInformationMessage('未找到包含 package.json 的项目');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`读取文件夹失败: ${error.message}`);
        }
    }

    clearProjects() {
        this.projects = [];
        vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', false);
        this.refresh();
    }

    getSelectedProjects() {
        return this.projects.filter(project => project.selected);
    }
}

class PackageInfoItem extends vscode.TreeItem {
    constructor(packageInfo, index) {
        super(packageInfo, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'package';
        this.index = index;
    }
}

class PackageInputProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.packages = [];
    }

    getTreeItem(element) {
        return element;
    }

    getChildren() {
        return this.packages.length === 0 
            ? []
            : this.packages.map((pkg, index) => new PackageInfoItem(pkg, index));
    }

    addPackage(info) {
        this.packages.push(info);
        this._onDidChangeTreeData.fire();
    }

    editPackage(index, info) {
        this.packages[index] = info;
        this._onDidChangeTreeData.fire();
    }

    deletePackage(index) {
        this.packages.splice(index, 1);
        this._onDidChangeTreeData.fire();
    }

    clearPackages() {
        this.packages = [];
        this._onDidChangeTreeData.fire();
    }
}

async function activate(context) {
    const provider = new DependencyUpdaterProvider();
    const inputProvider = new PackageInputProvider();
    
    // 先注册所有命令
    const commands = [
        vscode.commands.registerCommand('dependency-updater.addPackage', async () => {
            const result = await vscode.window.showInputBox({
                placeHolder: '输入包名@版本号，例如：lodash@4.17.21',
                validateInput: text => {
                    return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';
                }
            });

            if (result) {
                inputProvider.addPackage(result);
            }
        }),
        vscode.commands.registerCommand('dependency-updater.selectFolder', async () => {
            const result = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                title: '选择项目根目录'
            });

            if (result && result[0]) {
                provider.setProjects(result[0].fsPath);
            }
        }),

        vscode.commands.registerCommand('dependency-updater.clearProjects', () => {
            provider.clearProjects();
        }),

        vscode.commands.registerCommand('dependency-updater.editPackage', async (item) => {
            const result = await vscode.window.showInputBox({
                value: item.label,
                placeHolder: '输入包名@版本号，例如：lodash@4.17.21',
                validateInput: text => {
                    return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';
                }
            });

            if (result) {
                inputProvider.editPackage(item.index, result);
            }
        }),

        vscode.commands.registerCommand('dependency-updater.deletePackage', (item) => {
            inputProvider.deletePackage(item.index);
        }),

        vscode.commands.registerCommand('dependency-updater.clearPackages', () => {
            inputProvider.clearPackages();
        }),

        vscode.commands.registerCommand('dependency-updater.toggleProject', (item) => {
            if (item instanceof ProjectItem) {
                item.toggleSelection();
                provider.refresh();
            }
        }),

        // 添加更新依赖命令
        vscode.commands.registerCommand('dependency-updater.updateDependencies', async () => {
            const selectedProjects = provider.getSelectedProjects();
            const packages = inputProvider.packages;

            // 检查是否有选中的项目和包
            if (!selectedProjects.length) {
                vscode.window.showInformationMessage('请选择要更新的项目');
                return;
            }

            if (!packages.length) {
                vscode.window.showInformationMessage('请添加要更新的依赖包');
                return;
            }

            // 显示更新进度
            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "批量更新依赖",
                cancellable: true  // 启用取消功能
            }, async (progress, token) => {
                try {
                    const total = selectedProjects.length;
                    for (let i = 0; i < total; i++) {
                        if (token.isCancellationRequested) {
                            vscode.window.showInformationMessage('已取消更新操作');
                            return;
                        }

                        const project = selectedProjects[i];
                        progress.report({ 
                            message: `正在更新「${project.projectName}」(${i + 1}/${total})`,
                            increment: (100 / total)
                        });
                        
                        await updateProjectDependencies(project.path, packages, token);
                    }
                    
                    vscode.window.showInformationMessage(`成功更新 ${total} 个项目`);
                } catch (error) {
                    if (error.message === '操作已取消') {
                        vscode.window.showInformationMessage('已取消更新操作');
                    } else {
                        vscode.window.showErrorMessage(`批量更新失败: ${error.message}`);
                    }
                }
            });
        }),

        vscode.commands.registerCommand('dependency-updater.updateProject', async (item) => {
            if (!(item instanceof ProjectItem)) {
                return;
            }

            const packages = inputProvider.packages;
            if (!packages.length) {
                vscode.window.showInformationMessage('请先添加要更新的包');
                return;
            }

            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在更新项目「${item.projectName}」`,
                cancellable: true  // 启用取消功能
            }, async (progress, token) => {
                try {
                    await updateProjectDependencies(item.path, packages, token);
                    vscode.window.showInformationMessage(`项目「${item.projectName}」更新完成`);
                } catch (error) {
                    if (error.message === '操作已取消') {
                        vscode.window.showInformationMessage('已取消更新操作');
                    } else {
                        vscode.window.showErrorMessage(error.message);
                    }
                }
            });
        })
    ];
    
    // 然后注册视图
    const views = [
        vscode.window.createTreeView('packageInputView', {
            treeDataProvider: inputProvider,
            showCollapseAll: true
        }),
        vscode.window.createTreeView('dependencyUpdaterView', {
            treeDataProvider: provider,
            showCollapseAll: true
        })
    ];

    // 添加到订阅列表
    context.subscriptions.push(...commands, ...views);

    // 初始化上下文状态
    await vscode.commands.executeCommand('setContext', 'dependency-updater:hasProjects', false);
}

module.exports = {
    activate
};

