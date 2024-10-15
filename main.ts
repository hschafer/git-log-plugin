import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { execSync } from "child_process";

interface GitRepo {
	name: string;
	path: string;
}

interface GitLogPluginSettings {
	repos: GitRepo[];
	lastSelectedRepos: string[];
}

const DEFAULT_SETTINGS: GitLogPluginSettings = {
	repos: [],
	lastSelectedRepos: [],
};

export default class GitLogPlugin extends Plugin {
	settings: GitLogPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "insert-git-log",
			name: "Insert Git Log",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.insertGitLog(editor, view);
			},
		});

		this.addSettingTab(new GitLogSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async insertGitLog(editor: Editor, view: MarkdownView) {
		const fileName = view.file?.basename ?? "";
		let date: string | null = null;

		if (this.isDailyNote(fileName)) {
			date = this.extractDateFromFileName(fileName);
		} else {
			date = await this.promptForDate();
		}

		if (date) {
			const selectedRepos = await this.promptForRepos();
			if (selectedRepos.length > 0) {
				let gitLog = "";
				for (const repo of selectedRepos) {
					gitLog += `>[!NOTE]- \`git log\` for ${repo.name}\n`;
					gitLog += "> ```\n";
					gitLog += "> " + this.getGitLog(date, repo.path) + "\n";
					gitLog += "> ```\n";
					gitLog += "\n";
				}
				editor.replaceSelection(gitLog);
			} else {
				new Notice("No repositories selected. Git log not inserted.");
			}
		} else {
			new Notice("No date provided. Git log not inserted.");
		}
	}

	isDailyNote(fileName: string | null): boolean {
		return fileName?.match(/^\d{4}-\d{2}-\d{2}$/) !== null;
	}

	extractDateFromFileName(fileName: string | null): string | null {
		return fileName?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || null;
	}

	async promptForDate(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new DatePromptModal(this.app, (result) => {
				resolve(result);
			});
			modal.open();
		});
	}

	async promptForRepos(): Promise<GitRepo[]> {
		return new Promise((resolve) => {
			const modal = new RepoSelectionModal(
				this.app,
				this.settings.repos,
				this.settings.lastSelectedRepos,
				async (result) => {
					this.settings.lastSelectedRepos = result.map(
						(repo) => repo.name
					);
					await this.saveSettings();
					resolve(result);
				}
			);
			modal.open();
		});
	}

	getGitLog(date: string, repoPath: string): string {
		try {
			const command = `git -C "${repoPath}" log --oneline --no-merges --date=short --format="%h %s" --after="${date} 00:00:00" --before="${date} 23:59:59"`;
			const output = execSync(command).toString().trim();
			return output || "No commits found for the specified date.";
		} catch (error) {
			console.error("Error executing git log:", error);
			return "Error: Unable to retrieve git log.";
		}
	}
}

class DatePromptModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Enter date (YYYY-MM-DD)" });
		const input = contentEl.createEl("input", { type: "date" });
		const submitButton = contentEl.createEl("button", { text: "Continue" });
		submitButton.addEventListener("click", () => {
			this.close();
			this.onSubmit(input.value);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RepoSelectionModal extends Modal {
	repos: GitRepo[];
	onSubmit: (result: GitRepo[]) => void;
	selectedRepos: GitRepo[];
	lastSelectedRepos: string[];

	constructor(
		app: App,
		repos: GitRepo[],
		lastSelectedRepos: string[],
		onSubmit: (result: GitRepo[]) => void
	) {
		super(app);
		this.repos = repos;
		this.onSubmit = onSubmit;
		this.lastSelectedRepos = lastSelectedRepos;
		this.selectedRepos = repos.filter((repo) =>
			lastSelectedRepos.includes(repo.name)
		);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Select Repositories" });

		this.repos.forEach((repo) => {
			const checkbox = contentEl.createEl("input", {
				type: "checkbox",
				attr: { id: repo.name },
			});
			contentEl.createEl("label", {
				text: repo.name,
				attr: { for: repo.name },
			});
			contentEl.createEl("br");

			// Check the checkbox if it was selected last time
			if (this.lastSelectedRepos.includes(repo.name)) {
				checkbox.checked = true;
			}

			checkbox.addEventListener("change", (e) => {
				if ((e.target as HTMLInputElement).checked) {
					this.selectedRepos.push(repo);
				} else {
					this.selectedRepos = this.selectedRepos.filter(
						(r) => r.name !== repo.name
					);
				}
			});
		});

		const submitButton = contentEl.createEl("button", {
			text: "Insert Git Log",
		});
		submitButton.addEventListener("click", () => {
			this.close();
			this.onSubmit(this.selectedRepos);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class GitLogSettingTab extends PluginSettingTab {
	plugin: GitLogPlugin;

	constructor(app: App, plugin: GitLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Git Log Plugin Settings" });

		new Setting(containerEl)
			.setName("Add Repository")
			.setDesc("Add a new Git repository")
			.addButton((button) =>
				button.setButtonText("+").onClick(async () => {
					const modal = new AddRepoModal(
						this.app,
						async (name, path) => {
							this.plugin.settings.repos.push({ name, path });
							await this.plugin.saveSettings();
							this.display();
						}
					);
					modal.open();
				})
			);

		this.plugin.settings.repos.forEach((repo, index) => {
			new Setting(containerEl)
				.setName(repo.name)
				.setDesc(repo.path)
				.addButton((button) =>
					button.setButtonText("Delete").onClick(async () => {
						this.plugin.settings.repos.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
		});
	}
}

class AddRepoModal extends Modal {
	onSubmit: (name: string, path: string) => void;

	constructor(app: App, onSubmit: (name: string, path: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Add Repository" });

		const nameInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "Repository Name",
		});
		contentEl.createEl("br");
		const pathInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "Repository Path",
		});
		contentEl.createEl("br");

		const submitButton = contentEl.createEl("button", { text: "Add" });
		submitButton.addEventListener("click", () => {
			this.close();
			this.onSubmit(nameInput.value, pathInput.value);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
