import { App, Modal, Setting, TFolder, normalizePath } from 'obsidian';

/** `{ path }` to set/clear (null = clear), or `null` if the user cancelled. */
export type FolderMappingResult = { path: string | null } | null;

export function promptFolderMapping(
	app: App,
	label: string,
	current: string | undefined,
): Promise<FolderMappingResult> {
	return new Promise((resolve) => {
		new FolderMapModal(app, label, current, resolve).open();
	});
}

class FolderMapModal extends Modal {
	private label: string;
	private current: string | undefined;
	private resolve: (value: FolderMappingResult) => void;
	private settled = false;
	private value: string;

	constructor(
		app: App,
		label: string,
		current: string | undefined,
		resolve: (value: FolderMappingResult) => void,
	) {
		super(app);
		this.label = label;
		this.current = current;
		this.resolve = resolve;
		this.value = current ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Set download folder' });
		contentEl.createEl('p', {
			text: `Files in “${this.label}” will be saved to this vault folder. `
				+ 'Nested sections and folders inherit it unless they have their own mapping.',
		});

		const folders = this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.map(f => f.path)
			.filter(p => p.length > 0)
			.sort((a, b) => a.localeCompare(b));

		const datalistId = 'moodle-folder-options';
		const datalist = contentEl.createEl('datalist');
		datalist.id = datalistId;
		for (const p of folders) datalist.createEl('option', { value: p });

		new Setting(contentEl)
			.setName('Vault folder')
			.setDesc('Type a path (created if missing) or pick an existing folder.')
			.addText(text => {
				text.setPlaceholder('e.g. University/ASK/Sheets');
				text.setValue(this.value);
				text.onChange(v => { this.value = v; });
				text.inputEl.setAttr('list', datalistId);
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.save();
					}
				});
				const inputEl = text.inputEl;
				setTimeout(() => inputEl.focus(), 50);
			});

		const buttons = new Setting(contentEl);
		buttons.addButton(btn => btn
			.setButtonText('Save')
			.setCta()
			.onClick(() => this.save()));
		if (this.current) {
			buttons.addButton(btn => btn
				.setButtonText('Clear mapping')
				.setWarning()
				.onClick(() => this.settle({ path: null })));
		}
		buttons.addButton(btn => btn
			.setButtonText('Cancel')
			.onClick(() => this.close()));
	}

	private save(): void {
		const path = normalizePath(this.value.trim());
		// Empty / root resolves to "no mapping".
		if (!path || path === '/' || path === '.') {
			this.settle({ path: null });
		} else {
			this.settle({ path });
		}
	}

	private settle(result: { path: string | null }): void {
		this.settled = true;
		this.resolve(result);
		this.close();
	}

	onClose(): void {
		if (!this.settled) this.resolve(null);
		this.contentEl.empty();
	}
}
