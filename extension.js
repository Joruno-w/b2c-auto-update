const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class ProjectItem extends vscode.TreeItem {
	constructor(label, path) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.path = path;
		this.checkbox = false;
		this.contextValue = 'project';
		this.command = {
				title: 'Toggle Selection',
				command: 'dependency-updater.toggleSelection',
				arguments: [this]
		};
		// 使用文件夹图标
		this.iconPath = this.checkbox 
				? new vscode.ThemeIcon('check') 
				: new vscode.ThemeIcon('folder');
		this.description = path;
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


	clearProjects() {
		this.projects = [];
		this.refresh();
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

	setProjects(folderPath) {
		try {
			this.projects = [];
			const items = fs.readdirSync(folderPath);

			items.forEach(item => {
				const itemPath = path.join(folderPath, item);
				if (fs.statSync(itemPath).isDirectory()) {
					const packageJsonPath = path.join(itemPath, 'package.json');
					if (fs.existsSync(packageJsonPath)) {
						this.projects.push(new ProjectItem(item, itemPath));
					}
				}
			});

			this.refresh();
			if (this.projects.length === 0) {
				vscode.window.showInformationMessage('未找到包含 package.json 的项目');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`读取文件夹失败: ${error.message}`);
		}
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
        return this.packages.map((pkg, index) => new PackageInfoItem(pkg, index));
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
}

function activate(context) {
	const provider = new DependencyUpdaterProvider();
	const inputProvider = new PackageInputProvider();
	
	vscode.window.registerTreeDataProvider('dependencyUpdaterView', provider);
	vscode.window.registerTreeDataProvider('packageInputView', inputProvider);

	let selectFolder = vscode.commands.registerCommand('dependency-updater.selectFolder', async () => {
		const result = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			title: '选择项目根目录'
		});

		if (result && result[0]) {
			provider.setProjects(result[0].fsPath);
		}
	});

	let toggleSelection = vscode.commands.registerCommand('dependency-updater.toggleSelection', (item) => {
		item.checkbox = !item.checkbox;
		item.iconPath = new vscode.ThemeIcon(item.checkbox ? 'check' : 'package');
		provider.refresh();
	});

	let inputPackage = vscode.commands.registerCommand('dependency-updater.inputPackage', async () => {
		const result = await vscode.window.showInputBox({
			placeHolder: '输入包名@版本号，例如：lodash@4.17.21',
			validateInput: text => {
				return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';
			}
		});

		if (result) {
			inputProvider.addPackage(result);
		}
	});

	let addPackage = vscode.commands.registerCommand('dependency-updater.addPackage', async () => {
        const result = await vscode.window.showInputBox({
            placeHolder: '输入包名@版本号，例如：lodash@4.17.21',
            validateInput: text => {
                return text.includes('@') ? null : '请按照 包名@版本号 的格式输入';
            }
        });

        if (result) {
            inputProvider.addPackage(result);
        }
    });

    let editPackage = vscode.commands.registerCommand('dependency-updater.editPackage', async (item) => {
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
    });

    let deletePackage = vscode.commands.registerCommand('dependency-updater.deletePackage', (item) => {
        inputProvider.deletePackage(item.index);
    });

    context.subscriptions.push(addPackage, editPackage, deletePackage);

	// 注册清空项目列表命令
	let clearProjects = vscode.commands.registerCommand('dependency-updater.clearProjects', () => {
		provider.clearProjects();
	});

	context.subscriptions.push(selectFolder, clearProjects);
	context.subscriptions.push(selectFolder, toggleSelection);
	context.subscriptions.push(inputPackage);
}

module.exports = {
	activate
};

