import { ItemView, Notice, WorkspaceLeaf, normalizePath } from 'obsidian';
import { MoodleCourse, MoodleSection, getCourses, getCourseContents, downloadFile, MoodleTokenError } from './MoodleApi';
import { buildCourseTree, renderSections } from './MoodleTree';
import MoodlePlugin from './main';

export const MOODLE_VIEW_TYPE = 'moodle-courses';

export class MoodleView extends ItemView {
	private plugin: MoodlePlugin;
	private sectionsMap: Map<number, MoodleSection[]> = new Map();
	private courses: MoodleCourse[] = [];
	private showHidden = false;
	private treeEl: HTMLElement;
	private showHiddenBtn: HTMLButtonElement;

	constructor(leaf: WorkspaceLeaf, plugin: MoodlePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MOODLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Moodle courses';
	}

	getIcon(): string {
		return 'graduation-cap';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('moodle-view');

		const header = contentEl.createDiv({ cls: 'moodle-header' });
		header.createEl('span', { text: 'Moodle courses', cls: 'moodle-title' });

		const buttons = header.createDiv({ cls: 'moodle-header-buttons' });

		this.showHiddenBtn = buttons.createEl('button', {
			text: '👁',
			cls: 'moodle-header-btn',
			title: 'Show hidden courses',
		});
		this.showHiddenBtn.onclick = () => {
			this.showHidden = !this.showHidden;
			this.showHiddenBtn.setText(this.showHidden ? '🙈' : '👁');
			this.showHiddenBtn.title = this.showHidden ? 'Hide hidden courses' : 'Show hidden courses';
			this.renderTree();
		};

		const refreshBtn = buttons.createEl('button', {
			text: '↻',
			cls: 'moodle-header-btn',
			title: 'Refresh',
		});
		refreshBtn.onclick = () => { void this.refresh(); };

		this.treeEl = contentEl.createDiv({ cls: 'moodle-tree' });

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async refresh(): Promise<void> {
		this.sectionsMap.clear();
		this.treeEl.empty();

		const { wstoken, userId } = this.plugin.settings;

		if (!wstoken || !userId) {
			this.treeEl.createEl('p', {
				text: 'Not connected. Go to settings and log in.',
				cls: 'moodle-empty',
			});
			return;
		}

		this.treeEl.createEl('p', { text: 'Loading courses…', cls: 'moodle-loading' });

		try {
			this.courses = await getCourses(wstoken, userId);
		} catch (e) {
			this.treeEl.empty();
			if (e instanceof MoodleTokenError) {
				await this.clearStaleToken();
				this.treeEl.createEl('p', {
					text: 'Session expired. Click the graduation cap icon or log in again in settings.',
					cls: 'moodle-error',
				});
			} else {
				this.treeEl.createEl('p', {
					text: `Failed to load courses: ${(e as Error).message}`,
					cls: 'moodle-error',
				});
			}
			return;
		}

		this.renderTree();
	}

	private renderTree(): void {
		this.treeEl.empty();
		buildCourseTree(this.treeEl, this.courses, this.sectionsMap, {
			courseRenames: this.plugin.settings.courseRenames,
			hiddenCourses: this.plugin.settings.hiddenCourses,
			showHidden: this.showHidden,
			onExpandCourse: (course, detailsEl) => this.loadCourseSections(course, detailsEl),
			onFileClick: (filename, fileurl) => { void this.handleFileClick(filename, fileurl); },
			onCourseRename: (courseId, newName) => { void this.handleCourseRename(courseId, newName); },
			onCourseHide: (courseId, hidden) => { void this.handleCourseHide(courseId, hidden); },
		});
	}

	private async loadCourseSections(course: MoodleCourse, detailsEl: HTMLDetailsElement): Promise<void> {
		const contentEl = detailsEl.querySelector('.moodle-course-content') as HTMLElement;
		if (!contentEl) return;

		const { wstoken } = this.plugin.settings;
		try {
			const sections = await getCourseContents(wstoken, course.id);
			this.sectionsMap.set(course.id, sections);
			renderSections(contentEl, sections, (filename, fileurl) => { void this.handleFileClick(filename, fileurl); });
		} catch (e) {
			contentEl.empty();
			if (e instanceof MoodleTokenError) {
				await this.clearStaleToken();
				contentEl.createEl('p', { text: 'Session expired. Log in again.', cls: 'moodle-error' });
			} else {
				contentEl.createEl('p', { text: `Error: ${(e as Error).message}`, cls: 'moodle-error' });
			}
			new Notice(`Moodle: failed to load ${course.fullname}`);
		}
	}

	/** Clear an expired/invalid token so the next action triggers a fresh login. */
	private async clearStaleToken(): Promise<void> {
		this.plugin.settings.wstoken = '';
		this.plugin.settings.userId = 0;
		await this.plugin.saveSettings();
	}

	private async handleCourseRename(courseId: number, newName: string): Promise<void> {
		const key = String(courseId);
		if (newName) {
			this.plugin.settings.courseRenames[key] = newName;
		} else {
			delete this.plugin.settings.courseRenames[key];
		}
		await this.plugin.saveSettings();
	}

	private async handleCourseHide(courseId: number, hidden: boolean): Promise<void> {
		const key = String(courseId);
		if (hidden) {
			this.plugin.settings.hiddenCourses[key] = true;
		} else {
			delete this.plugin.settings.hiddenCourses[key];
		}
		await this.plugin.saveSettings();
		this.renderTree();
	}

	private async handleFileClick(filename: string, fileurl: string): Promise<void> {
		const { wstoken } = this.plugin.settings;
		const vault = this.app.vault;

		const activeFile = this.app.workspace.getActiveFile();
		const folder = activeFile?.parent?.path ?? '';

		// Use only the basename — a server-supplied filename must never be able
		// to escape the target folder via path separators or `..`.
		let safeName = filename.split(/[/\\]/).pop() ?? '';
		safeName = safeName.replace(/^\.+/, '').trim();
		if (!safeName) {
			new Notice(`Invalid filename: ${filename}`);
			return;
		}

		const targetPath = normalizePath(folder ? `${folder}/${safeName}` : safeName);

		if (vault.getAbstractFileByPath(targetPath)) {
			new Notice(`Already exists: ${safeName}`);
			return;
		}

		try {
			new Notice(`Downloading ${safeName}…`);
			const data = await downloadFile(wstoken, fileurl);
			await vault.createBinary(targetPath, data);
			new Notice(`Saved: ${safeName}`);
		} catch (e) {
			new Notice(`Failed to download ${safeName}: ${(e as Error).message}`);
		}
	}
}
