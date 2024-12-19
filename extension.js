const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

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
            
            // 如果选中，设置颜色和高亮样式
            if (this.selected) {
                // 自定义颜色效果
                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            } else {
                // 设置工程名和分支名的颜色
                this.resourceUri = vscode.Uri.parse(`project:${this.projectName}`);
            }
        } else {
            this.iconPath = new vscode.ThemeIcon(this.selected ? 'check' : 'folder');
            this.label = this.projectName;
            
            if (this.selected) {
                this.resourceUri = vscode.Uri.parse(`project-selected:${this.projectName}`);
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
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

async function updateProjectDependencies(projectPath, packages) {
    try {
        // 执行 npm install
        const packagesStr = packages.join(' ');
        console.log(`Updating ${projectPath} with packages: ${packagesStr}`);
        await exec(`npm i ${packagesStr}`, { cwd: projectPath });

        // Git 操作
        await exec('git add .', { cwd: projectPath });
        await exec('git commit -m "feat: 更新依赖"', { cwd: projectPath });
        await exec('git push', { cwd: projectPath });

        return true;
    } catch (error) {
        throw new Error(`更新失败: ${error.message}`);
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
                cancellable: false
            }, async (progress) => {
                try {
                    const total = selectedProjects.length;
                    for (let i = 0; i < total; i++) {
                        const project = selectedProjects[i];
                        progress.report({ 
                            message: `正在更新 ${project.projectName} (${i + 1}/${total})`,
                            increment: (100 / total)
                        });
                        
                        await updateProjectDependencies(project.path, packages);
                    }
                    
                    vscode.window.showInformationMessage(`成功更新 ${total} 个项目`);
                } catch (error) {
                    vscode.window.showErrorMessage(`批量更新失败: ${error.message}`);
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
                title: `正在更新项目: ${item.projectName}`,
                cancellable: false
            }, async (progress) => {
                try {
                    progress.report({ message: "正在执行更新..." });
                    await updateProjectDependencies(item.path, packages);
                    vscode.window.showInformationMessage(`项目 ${item.projectName} 更新完成`);
                } catch (error) {
                    vscode.window.showErrorMessage(error.message);
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
    
    // 设置欢迎页面样式
    const config = vscode.workspace.getConfiguration('workbench');
    await config.update('welcomePage.buttonBackground', '#0098FF', vscode.ConfigurationTarget.Global);
    await config.update('welcomePage.buttonHoverBackground', '#0070BE', vscode.ConfigurationTarget.Global);
    
    // 添加颜色装饰器配置
    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const colorCustomizations = {
        'workbench.colorCustomizations': {
            'list.activeSelectionForeground': '#5DAAB5',
            'list.inactiveSelectionForeground': '#5DAAB5',
            'gitDecoration.modifiedResourceForeground': '#D9739F',
            'charts.green': '#4EC9B0'
        }
    };

    // 更新颜色配置
    workbenchConfig.update(
        'colorCustomizations',
        colorCustomizations['workbench.colorCustomizations'],
        vscode.ConfigurationTarget.Global
    );

    // 更新颜色配置后添加更新按钮样式
    const buttonStyles = vscode.workspace.getConfiguration('workbench');
    buttonStyles.update('welcomePage.buttonBackground', '#0098FF', vscode.ConfigurationTarget.Global);
    buttonStyles.update('welcomePage.buttonHoverBackground', '#0070BE', vscode.ConfigurationTarget.Global);
}

module.exports = {
    activate
};

