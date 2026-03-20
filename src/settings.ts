import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MoodlePlugin from './main';

export interface MoodlePluginSettings {
	username: string;
	password: string;
	totpSerial: string;
	totpSecret: string;
	wstoken: string;
	userId: number;
	cookies: Record<string, string>;
	sessionKey: string;
	courseRenames: Record<string, string>; // courseId → custom display name
	hiddenCourses: Record<string, boolean>; // courseId → true if user-hidden
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
		containerEl.createEl('h2', { text: 'Moodle Courses' });

		// Status
		if (this.plugin.settings.wstoken) {
			const status = containerEl.createDiv({ cls: 'moodle-settings-status' });
			status.createSpan({ text: 'Connected to moodle.rwth-aachen.de' });
			status.style.color = 'var(--text-success)';
			status.style.marginBottom = '12px';
		}

		containerEl.createEl('h3', { text: 'RWTH SSO Credentials' });

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Your RWTH Single Sign-On username')
			.addText(text => text
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
			.setName('TOTP secret (optional)')
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
						new Notice('Please fill in username, password, and TOTP serial.');
						return;
					}
					btn.setDisabled(true);
					btn.setButtonText('Logging in…');
					try {
						await this.plugin.performLogin();
						new Notice('Connected to RWTH Moodle!');
						this.display();
					} catch (e) {
						new Notice(`Login failed: ${(e as Error).message}`);
						btn.setDisabled(false);
						btn.setButtonText('Login');
					}
				}));

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
}
