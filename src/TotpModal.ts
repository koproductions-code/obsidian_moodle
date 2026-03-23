import { App, Modal, Setting } from 'obsidian';

export function promptTotp(app: App, totpSerial: string): Promise<string | null> {
	return new Promise((resolve) => {
		new TotpModal(app, totpSerial, resolve).open();
	});
}

class TotpModal extends Modal {
	private totpSerial: string;
	private resolve: (value: string | null) => void;
	private submitted = false;

	constructor(app: App, totpSerial: string, resolve: (value: string | null) => void) {
		super(app);
		this.totpSerial = totpSerial;
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH and TOTP are acronyms
		contentEl.createEl('h2', { text: 'RWTH TOTP code' });
		contentEl.createEl('p', {
			text: `Enter the TOTP code for generator ${this.totpSerial}:`,
		});

		let value = '';
		new Setting(contentEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- TOTP is an acronym
			.setName('TOTP code')
			.addText(text => {
				text.setPlaceholder('123456');
				text.onChange(v => { value = v; });
				// Submit on Enter
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter') {
						this.submitted = true;
						this.resolve(value);
						this.close();
					}
				});
				// Auto-focus
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Submit')
				.setCta()
				.onClick(() => {
					this.submitted = true;
					this.resolve(value);
					this.close();
				}));
	}

	onClose(): void {
		if (!this.submitted) {
			this.resolve(null);
		}
	}
}
