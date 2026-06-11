import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MoodlePlugin from './main';
import { CookieJar } from './httpClient';

/** A course/section/folder → vault folder download mapping. `label` is kept for the settings list. */
export interface FolderMapping {
	path: string;
	label: string;
}

export interface MoodlePluginSettings {
	username: string;
	password: string;
	totpSerial: string;
	totpSecret: string;
	wstoken: string;
	userId: number;
	cookies: CookieJar;
	sessionKey: string;
	courseRenames: Record<string, string>; // courseId → custom display name
	hiddenCourses: Record<string, boolean>; // courseId → true if user-hidden
	folderMappings: Record<string, FolderMapping>; // node key → vault download folder
}

export const DEFAULT_SETTINGS: MoodlePluginSettings = {
	username: '',
	password: '',
	totpSerial: '',
	totpSecret: '',
	wstoken: '',
	userId: 0,
	cookies: {},
	sessionKey: '',
	courseRenames: {},
	hiddenCourses: {},
	folderMappings: {},
};

export class MoodleSettingTab extends PluginSettingTab {
	plugin: MoodlePlugin;

	constructor(app: App, plugin: MoodlePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Connection').setHeading();

		// Status
		if (this.plugin.settings.wstoken) {
			const status = containerEl.createDiv({ cls: 'moodle-settings-status moodle-settings-connected' });
			status.createSpan({ text: 'Connected to moodle.rwth-aachen.de' });
		}

		// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH and SSO are acronyms
		new Setting(containerEl).setName('RWTH SSO credentials').setHeading();

		new Setting(containerEl)
			.setName('Username')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH is an acronym
			.setDesc('Your RWTH single sign-on username')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- example username
				.setPlaceholder('ab123456')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('••••••••')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- TOTP is an acronym
			.setName('TOTP serial number')
			.setDesc('From https://idm.rwth-aachen.de/selfservice/MFATokenManager')
			.addText(text => text
				.setPlaceholder('TOTP0001234')
				.setValue(this.plugin.settings.totpSerial)
				.onChange(async (value) => {
					this.plugin.settings.totpSerial = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- TOTP is an acronym
			.setName('TOTP secret (optional)')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- TOTP is an acronym
			.setDesc('If set, TOTP codes are generated automatically. Otherwise you will be prompted each time.')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Leave empty to enter codes manually')
					.setValue(this.plugin.settings.totpSecret)
					.onChange(async (value) => {
						this.plugin.settings.totpSecret = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText('Login')
				.setCta()
				.onClick(async () => {
					const { username, password, totpSerial } = this.plugin.settings;
					if (!username || !password || !totpSerial) {
						// eslint-disable-next-line obsidianmd/ui/sentence-case -- TOTP is an acronym
						new Notice('Please fill in username, password, and TOTP serial.');
						return;
					}
					btn.setDisabled(true);
					btn.setButtonText('Logging in…');
					// performLogin shows its own success/failure Notice and never throws.
					const ok = await this.plugin.performLogin();
					if (ok) {
						this.display();
					} else {
						btn.setDisabled(false);
						btn.setButtonText('Login');
					}
				}));

		this.renderFolderMappings(containerEl);

		if (this.plugin.settings.wstoken) {
			containerEl.createEl('hr');
			new Setting(containerEl)
				.setName('Disconnect')
				.setDesc('Clear stored session and credentials cache.')
				.addButton(btn => btn
					.setButtonText('Disconnect')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.wstoken = '';
						this.plugin.settings.userId = 0;
						this.plugin.settings.cookies = {};
						await this.plugin.saveSettings();
						this.display();
					}));
		}
	}

	private renderFolderMappings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Download folders').setHeading();

		const entries = Object.entries(this.plugin.settings.folderMappings);
		if (entries.length === 0) {
			new Setting(containerEl).setDesc(
				'No folders mapped yet. In the Moodle courses sidebar, hover a course, '
				+ 'section, or folder and click the 📁 button to choose where its files download to.',
			);
			return;
		}

		for (const [key, mapping] of entries) {
			new Setting(containerEl)
				.setName(mapping.label)
				.setDesc(`→ ${mapping.path}`)
				.addExtraButton(btn => btn
					.setIcon('trash')
					.setTooltip('Remove mapping')
					.onClick(async () => {
						delete this.plugin.settings.folderMappings[key];
						await this.plugin.saveSettings();
						this.display();
					}));
		}
	}
}
